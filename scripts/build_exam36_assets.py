#!/usr/bin/env python3
"""Build image-based exam assets for the 36th (2025) exam from official PDFs.

The 36th-round PDFs are HWP "Print To PDF" booklets with a broken text layer,
so question-number anchors are located from the rendered images instead:
lines flush with the column gutter whose first glyph is a plain digit
(circled choice markers are wider) are OCR-verified against the expected
question sequence with tesseract.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image


DPI = 220
INK_THRESHOLD = 160
SHAPE_INK_THRESHOLD = 210  # includes anti-aliased thin strokes so circled digits stay connected
LINE_INK_MIN = 3
CANDIDATE_BAND_PX = 48
MAX_DIGIT_COMPONENT_WIDTH = 28

PART_CONFIG = {
    1: {
        "question_count": 80,
        "subjects": [
            {"name": "부동산학개론", "start": 1, "end": 40},
            {"name": "민법", "start": 41, "end": 80},
        ],
    },
    2: {
        "question_count": 120,
        "subjects": [
            {"name": "공인중개사법령", "start": 1, "end": 40},
            {"name": "부동산공법", "start": 41, "end": 80},
            {"name": "부동산공시법&세법", "start": 81, "end": 120},
        ],
    },
}

# 2025년 제36회 공인중개사 자격시험 정답 (정답 공고 PDF 기준)
ANSWERS_PART1 = [
    1, 1, 3, 3, 4, 3, 5, 1, 3, 5,
    1, 5, 2, 1, 4, 2, 5, 3, 2, 2,
    4, 2, 4, 5, 5, 1, 3, 4, 2, 3,
    2, 3, 5, 1, 2, 5, 4, 4, 3, 1,
    2, 3, 1, 5, 3, 1, 2, 3, 4, 3,
    4, 2, 1, 5, 4, 4, 3, 1, 2, 5,
    4, 4, 2, 5, 1, 3, 5, 4, 1, 4,
    5, 3, 2, 2, 5, 2, 3, 5, 1, 2,
]
ANSWERS_PART2_SESSION1 = [
    5, 2, 1, 1, 4, 3, 5, 5, 1, 4,
    3, 3, 3, 4, 5, 4, 5, 2, 5, 4,
    2, 3, 5, 1, 3, 1, 4, 2, 4, 3,
    2, 1, 3, 2, 3, 1, 2, 4, 2, 2,
    3, 4, 2, 5, 2, 3, 5, 5, 4, 4,
    1, 2, 5, 5, 2, 4, 3, 5, 1, 4,
    2, 3, 4, 5, 4, 3, 2, 2, 5, 1,
    1, 2, 1, 4, 4, 2, 1, 3, 3, 1,
]
ANSWERS_PART2_SESSION2 = [
    1, 1, 1, 4, 1, 2, 4, 5, 3, 3,
    5, 4, 1, 4, 4, 2, 5, 3, 3, 1,
    2, 1, 2, 5, 5, 5, 5, 5, 4, 1,
    3, 3, 4, 4, 5, 2, 2, 1, 3, 2,
]


@dataclass(frozen=True)
class Line:
    page: int
    col: int
    y0: int
    y1: int
    left_x: int


@dataclass(frozen=True)
class Anchor:
    page: int
    col: int
    y: int


@dataclass
class PdfLayout:
    pages: dict[int, Image.Image]
    gray: dict[int, np.ndarray]
    ink: dict[int, np.ndarray]
    col_bounds: list[tuple[int, int]]
    top_y: int
    bottom_y: dict[int, int]


def render_pdf(pdf_path: Path, tmp_dir: Path) -> dict[int, Image.Image]:
    tmp_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["pdftoppm", "-png", "-r", str(DPI), str(pdf_path), str(tmp_dir / "page")],
        check=True,
    )
    pages: dict[int, Image.Image] = {}
    for path in sorted(tmp_dir.glob("page-*.png")):
        number = int(path.stem.split("-")[-1])
        pages[number] = Image.open(path).convert("RGB")
    return pages


def analyze_layout(pages: dict[int, Image.Image]) -> PdfLayout:
    gray = {number: np.array(image.convert("L")) for number, image in pages.items()}
    ink = {number: page_gray < INK_THRESHOLD for number, page_gray in gray.items()}
    first = ink[1]
    height, width = first.shape

    col_ink = np.zeros(width, dtype=np.int64)
    for page_ink in ink.values():
        col_ink += page_ink.sum(axis=0)
    content_x = np.where(col_ink > 0)[0]
    x_min, x_max = int(content_x.min()), int(content_x.max())

    center = slice(int(width * 0.40), int(width * 0.60))
    gap_cols = np.where(col_ink[center] == 0)[0] + int(width * 0.40)
    if len(gap_cols) == 0:
        raise RuntimeError("column gap not found")
    gap_start, gap_end = int(gap_cols.min()), int(gap_cols.max())

    col_bounds = [(max(0, x_min - 4), gap_start - 2), (gap_end + 2, min(width, x_max + 6))]

    bottom_y: dict[int, int] = {}
    for number, page_ink in ink.items():
        rows = np.where(page_ink.sum(axis=1) > LINE_INK_MIN)[0]
        # The page footer is the last contiguous ink row group; exclude it.
        groups: list[tuple[int, int]] = []
        for row in rows:
            if groups and row <= groups[-1][1] + 3:
                groups[-1] = (groups[-1][0], int(row))
            else:
                groups.append((int(row), int(row)))
        if groups and groups[-1][1] >= height * 0.96:
            bottom_y[number] = groups[-1][0] - 12
        else:
            bottom_y[number] = height - 40

    return PdfLayout(pages=pages, gray=gray, ink=ink, col_bounds=col_bounds, top_y=76, bottom_y=bottom_y)


def segment_lines(layout: PdfLayout, page: int, col: int) -> list[Line]:
    x0, x1 = layout.col_bounds[col]
    sub = layout.ink[page][layout.top_y : layout.bottom_y[page], x0:x1]
    row_ink = sub.sum(axis=1)
    lines: list[Line] = []
    in_line = False
    start = 0
    for y in range(len(row_ink)):
        if row_ink[y] > LINE_INK_MIN and not in_line:
            in_line = True
            start = y
        elif row_ink[y] <= LINE_INK_MIN and in_line:
            in_line = False
            segment = sub[start:y, :]
            xs = np.where(segment.any(axis=0))[0]
            lines.append(
                Line(page=page, col=col, y0=layout.top_y + start, y1=layout.top_y + y, left_x=x0 + int(xs.min()))
            )
    if in_line:
        segment = sub[start:, :]
        xs = np.where(segment.any(axis=0))[0]
        lines.append(
            Line(page=page, col=col, y0=layout.top_y + start, y1=layout.bottom_y[page], left_x=x0 + int(xs.min()))
        )
    return lines


def label_components(ink: np.ndarray) -> np.ndarray:
    height, width = ink.shape
    labels = np.zeros((height, width), dtype=np.int32)
    next_label = 0
    for start_y, start_x in zip(*np.where(ink)):
        if labels[start_y, start_x]:
            continue
        next_label += 1
        stack = [(int(start_y), int(start_x))]
        labels[start_y, start_x] = next_label
        while stack:
            y, x = stack.pop()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < height and 0 <= nx < width and ink[ny, nx] and not labels[ny, nx]:
                        labels[ny, nx] = next_label
                        stack.append((ny, nx))
    return labels


def component_hole_ratio(component: np.ndarray) -> float:
    """Fraction of the component's bounding box that is enclosed background."""
    ys, xs = np.where(component)
    box = component[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    height, width = box.shape
    free = ~box
    seen = np.zeros_like(free)
    stack = [
        (y, x)
        for y in range(height)
        for x in range(width)
        if (y in (0, height - 1) or x in (0, width - 1)) and free[y, x]
    ]
    for y, x in stack:
        seen[y, x] = True
    while stack:
        y, x = stack.pop()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < height and 0 <= nx < width and free[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                stack.append((ny, nx))
    holes = int((free & ~seen).sum())
    return holes / (height * width)


def first_glyph_metrics(layout: PdfLayout, line: Line) -> tuple[int, float]:
    """Width and enclosed-hole ratio of the line's leading glyph.

    The crop gets vertical margin because thin glyphs can be clipped by line
    segmentation, but the leading glyph is located within the line's own rows.
    """
    margin = 8
    y0 = max(0, line.y0 - margin)
    crop = layout.gray[line.page][y0 : line.y1 + margin, line.left_x : line.left_x + 130]
    ink = crop < SHAPE_INK_THRESHOLD
    core = ink[line.y0 - y0 : line.y0 - y0 + (line.y1 - line.y0), :]
    if not core.any():
        return 0, 0.0
    labels = label_components(ink)
    core_cols = np.where(core.any(axis=0))[0]
    first_col = int(core_cols.min())
    core_rows = np.where(core[:, first_col])[0] + (line.y0 - y0)
    label = int(labels[core_rows[0], first_col])
    component = labels == label
    xs = np.where(component.any(axis=0))[0]
    width = int(xs.max() - xs.min() + 1)
    return width, component_hole_ratio(component)


def ocr_variants(image: Image.Image) -> list[str]:
    outputs: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        for scale in (3, 4, 2):
            resized = image.resize((image.width * scale, image.height * scale), Image.LANCZOS)
            path = Path(tmp) / "cand.png"
            resized.save(path)
            for psm in ("7", "8", "13"):
                result = subprocess.run(
                    [
                        "tesseract", str(path), "stdout", "--psm", psm,
                        "-c", "tessedit_char_whitelist=0123456789.",
                    ],
                    capture_output=True,
                    text=True,
                )
                text = result.stdout.strip().replace(" ", "")
                if text:
                    outputs.append(text)
    return outputs


def ocr_matches(layout: PdfLayout, line: Line, expected: int) -> bool:
    token = f"{expected}."
    width = 34 * len(str(expected)) + 26
    page_image = layout.pages[line.page].convert("L")
    crop = page_image.crop((line.left_x - 6, line.y0 - 7, line.left_x + width, line.y1 + 9))
    for text in ocr_variants(crop):
        if text.startswith(token):
            return True
        if text.rstrip(".") == str(expected) and text.endswith("."):
            return True
    return False


def find_anchors(layout: PdfLayout, question_count: int) -> dict[int, Anchor]:
    """Question-start lines in reading order.

    Shape gating (narrow leading digit glyph flush with the column gutter) is
    selective enough that the candidates are exactly the question starts, so
    numbers are assigned by sequence; OCR is a cross-check because tesseract
    confuses some bold digits (e.g. 7 read as 1).
    """
    candidates: list[Line] = []
    for page in sorted(layout.pages):
        for col in (0, 1):
            for line in segment_lines(layout, page, col):
                x0, _ = layout.col_bounds[col]
                if line.left_x > x0 + CANDIDATE_BAND_PX:
                    continue
                if line.y1 - line.y0 < 18:
                    continue
                glyph_width, hole_ratio = first_glyph_metrics(layout, line)
                if glyph_width == 0 or glyph_width >= 55:
                    continue
                if glyph_width > MAX_DIGIT_COMPONENT_WIDTH and hole_ratio > 0.25:
                    continue  # circled choice marker
                candidates.append(line)

    if len(candidates) != question_count:
        for line in candidates:
            print(f"  candidate p{line.page} col{line.col} y{line.y0}")
        raise RuntimeError(f"found {len(candidates)} question candidates, expected {question_count}")

    mismatches = [
        number
        for number, line in enumerate(candidates, start=1)
        if not ocr_matches(layout, line, number)
    ]
    if mismatches:
        print(f"  OCR could not confirm questions {mismatches} (verify images visually)")
    if len(mismatches) > question_count * 0.2:
        raise RuntimeError(f"too many OCR mismatches: {mismatches}")

    return {
        number: Anchor(page=line.page, col=line.col, y=line.y0)
        for number, line in enumerate(candidates, start=1)
    }


def unit_index(anchor: Anchor) -> int:
    return (anchor.page - 1) * 2 + anchor.col


def trim_vertical(image: Image.Image, pad: int = 10) -> Image.Image:
    arr = np.array(image.convert("L"))
    content = np.where((arr < 246).sum(axis=1) > 3)[0]
    if len(content) == 0:
        return image
    top = max(0, int(content.min()) - pad)
    bottom = min(image.height, int(content.max()) + pad + 1)
    return image.crop((0, top, image.width, bottom))


def trim_after_large_vertical_gap(image: Image.Image, min_gap: int = 90, pad: int = 12) -> Image.Image:
    arr = np.array(image.convert("L"))
    content_rows = np.where((arr < 246).sum(axis=1) > 3)[0]
    if len(content_rows) == 0:
        return image
    previous = int(content_rows[0])
    for y in content_rows[1:]:
        if int(y) - previous >= min_gap:
            return image.crop((0, 0, image.width, min(image.height, previous + pad)))
        previous = int(y)
    return image


def drop_trailing_header_box(image: Image.Image) -> Image.Image:
    """Remove a following-subject header box from the tail of a question image."""
    arr = np.array(image.convert("L"))
    ink_counts = ((arr < 246).sum(axis=1))
    content = ink_counts > 3
    blocks: list[tuple[int, int]] = []
    gap = 0
    start = None
    for y in range(len(content)):
        if content[y]:
            if start is None:
                start = y
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= 18:
                blocks.append((start, y - gap))
                start = None
    if start is not None:
        blocks.append((start, len(content) - 1))
    if len(blocks) < 2:
        return image
    last_start, last_end = blocks[-1]
    has_box_border = (ink_counts[last_start : last_end + 1] >= image.width * 0.5).any()
    if not has_box_border:
        return image
    return image.crop((0, 0, image.width, blocks[-2][1] + 13))


def question_regions(layout: PdfLayout, current: Anchor, nxt: Anchor | None) -> list[tuple[int, int, int, int]]:
    """Regions as (page, col, y0, y1) in pixels."""
    if nxt is None:
        return [(current.page, current.col, current.y, layout.bottom_y[current.page])]

    regions: list[tuple[int, int, int, int]] = []
    for unit in range(unit_index(current), unit_index(nxt) + 1):
        page = unit // 2 + 1
        col = unit % 2
        y0 = current.y if unit == unit_index(current) else layout.top_y
        y1 = nxt.y if unit == unit_index(nxt) else layout.bottom_y[page]
        regions.append((page, col, y0, y1))
    return regions


def build_question_images(
    layout: PdfLayout,
    anchors: dict[int, Anchor],
    question_count: int,
    out_dir: Path,
    number_offset: int = 0,
    subject_boundaries: frozenset[int] = frozenset(),
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for number in range(1, question_count + 1):
        pieces: list[Image.Image] = []
        for page, col, y0, y1 in question_regions(layout, anchors[number], anchors.get(number + 1)):
            y0 = max(layout.top_y, y0 - 12)
            y1 = min(layout.bottom_y[page], y1 - 14)
            if y1 <= y0 + 6:
                continue
            x0, x1 = layout.col_bounds[col]
            piece = trim_vertical(layout.pages[page].crop((x0, y0, x1, y1)))
            if piece.height > 12:
                pieces.append(piece)

        if not pieces:
            raise RuntimeError(f"no image pieces for question {number}")

        gap_px = 20
        width = max(piece.width for piece in pieces)
        height = sum(piece.height for piece in pieces) + gap_px * (len(pieces) - 1) + 32
        canvas = Image.new("RGB", (width + 32, height), "white")
        y = 16
        for piece in pieces:
            canvas.paste(piece, (16 + (width - piece.width) // 2, y))
            y += piece.height + gap_px
        if number == question_count:
            canvas = trim_after_large_vertical_gap(canvas)
        if number in subject_boundaries:
            canvas = drop_trailing_header_box(canvas)
        canvas.save(out_dir / f"q{number + number_offset:03d}.png", optimize=True)


def write_exam_json(out_dir: Path, exam_id: str, year: int, round_no: int, part: int, answers: list[int]) -> None:
    config = PART_CONFIG[part]
    question_count = config["question_count"]
    if len(answers) != question_count:
        raise RuntimeError(f"{exam_id} has {len(answers)} answers, expected {question_count}")
    exam = {
        "examId": exam_id,
        "year": year,
        "round": round_no,
        "part": part,
        "questionCount": question_count,
        "pointPerQuestion": 2.5,
        "source": "제36회 공인중개사 자격시험 문제지 PDF 렌더 이미지 기반",
        "answerSource": "2025년 제36회 공인중개사 자격시험 정답 PDF",
        "subjects": config["subjects"],
        "questions": [
            {
                "number": number,
                "imagePath": f"./assets/exams/{exam_id}/q{number:03d}.png",
                "answer": answers[number - 1],
            }
            for number in range(1, question_count + 1)
        ],
    }
    (out_dir / "exam.json").write_text(
        json.dumps(exam, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def update_index(index_path: Path, exam_id: str, year: int, round_no: int, part: int) -> None:
    index = json.loads(index_path.read_text(encoding="utf-8"))
    entry = {
        "examId": exam_id,
        "year": year,
        "round": round_no,
        "part": part,
        "questionCount": PART_CONFIG[part]["question_count"],
        "dataPath": f"./assets/exams/{exam_id}/exam.json",
        "status": "available",
    }
    index["exams"] = [item for item in index["exams"] if item["examId"] != exam_id]
    index["exams"].append(entry)
    index["exams"].sort(key=lambda item: (item["part"], -item["year"], item["round"]))
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_pdf(pdf_path: Path, tmp_dir: Path, question_count: int) -> tuple[PdfLayout, dict[int, Anchor]]:
    print(f"Rendering {pdf_path.name} ...")
    pages = render_pdf(pdf_path, tmp_dir)
    layout = analyze_layout(pages)
    anchors = find_anchors(layout, question_count)
    print(f"  found {len(anchors)} question anchors")
    return layout, anchors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--part1-pdf", required=True, type=Path)
    parser.add_argument("--part2-session1-pdf", required=True, type=Path)
    parser.add_argument("--part2-session2-pdf", required=True, type=Path)
    parser.add_argument("--tmp-dir", default=Path("tmp/exam36"), type=Path)
    parser.add_argument("--out-root", default=Path("assets/exams"), type=Path)
    args = parser.parse_args()

    year, round_no, date = 2025, 36, "20251025"

    part1_id = f"agent-{date}-part1"
    layout, anchors = build_pdf(args.part1_pdf, args.tmp_dir / "part1", 80)
    out_dir = args.out_root / part1_id
    build_question_images(layout, anchors, 80, out_dir, subject_boundaries=frozenset({40}))
    write_exam_json(out_dir, part1_id, year, round_no, 1, ANSWERS_PART1)
    update_index(args.out_root / "exam-index.json", part1_id, year, round_no, 1)
    print(f"Built {part1_id}")

    part2_id = f"agent-{date}-part2"
    out_dir = args.out_root / part2_id
    layout, anchors = build_pdf(args.part2_session1_pdf, args.tmp_dir / "part2s1", 80)
    build_question_images(layout, anchors, 80, out_dir, subject_boundaries=frozenset({40}))
    layout, anchors = build_pdf(args.part2_session2_pdf, args.tmp_dir / "part2s2", 40)
    build_question_images(layout, anchors, 40, out_dir, number_offset=80)
    write_exam_json(out_dir, part2_id, year, round_no, 2, ANSWERS_PART2_SESSION1 + ANSWERS_PART2_SESSION2)
    update_index(args.out_root / "exam-index.json", part2_id, year, round_no, 2)
    print(f"Built {part2_id}")


if __name__ == "__main__":
    main()
