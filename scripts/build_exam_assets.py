#!/usr/bin/env python3
"""Build image-based exam assets from COMCBT PDFs.

The app intentionally shows rendered/cropped question images instead of trying
to parse question text. This script uses the PDF text layer only to locate
question-number anchors, then crops the rendered page images.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image


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

MANUAL_ANSWERS = {
    "agent-2024-part1": [
        4, 2, 4, 1, 5, 5, 2, 4, 1, 3,
        2, 1, 5, 4, 2, 3, 3, 1, 5, 5,
        4, 1, 4, 3, 5, 4, 3, 2, 3, 2,
        4, 2, 3, 5, 1, 1, 2, 3, 5, 1,
        3, 5, 3, 3, 2, 5, 5, 1, 1, 2,
        4, 3, 5, 2, 4, 5, 1, 2, 2, 1,
        4, 4, 2, 3, 5, 5, 1, 5, 1, 5,
        1, 4, 3, 3, 3, 1, 1, 1, 2, 4,
    ],
}


@dataclass(frozen=True)
class Anchor:
    page: int
    col: int
    y: float


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def render_pdf(pdf_path: Path, tmp_dir: Path, dpi: int) -> None:
    tmp_dir.mkdir(parents=True, exist_ok=True)
    run(["pdftoppm", "-png", "-r", str(dpi), str(pdf_path), str(tmp_dir / "page")])


def write_bbox_html(pdf_path: Path, html_path: Path, first_page: int, last_page: int) -> None:
    run([
        "pdftotext",
        "-bbox-layout",
        "-f",
        str(first_page),
        "-l",
        str(last_page),
        str(pdf_path),
        str(html_path),
    ])


def parse_question_anchors(html_path: Path, question_count: int) -> dict[int, Anchor]:
    root = ET.fromstring(html_path.read_text(errors="ignore"))
    pages = [node for node in root.iter() if node.tag.endswith("page")]
    anchors: dict[int, Anchor] = {}

    for page_no, page in enumerate(pages, start=1):
        for word in [node for node in page.iter() if node.tag.endswith("word")]:
            text = "".join(word.itertext()).strip()
            if not re.fullmatch(r"\d{1,3}\.", text):
                continue

            number = int(text[:-1])
            x_min = float(word.attrib["xMin"])
            y_min = float(word.attrib["yMin"])
            is_question_gutter = 15 <= x_min <= 35 or 295 <= x_min <= 315

            if 1 <= number <= question_count and is_question_gutter:
                anchors[number] = Anchor(
                    page=page_no,
                    col=0 if x_min < 200 else 1,
                    y=y_min,
                )

    missing = [number for number in range(1, question_count + 1) if number not in anchors]
    if missing:
        raise RuntimeError(f"question anchors missing: {missing}")

    return anchors


def unit_index(anchor: Anchor) -> int:
    return (anchor.page - 1) * 2 + anchor.col


def regions_between(current: Anchor, next_anchor: Anchor | None) -> list[tuple[int, int, float, float]]:
    top_y = 58.0
    bottom_y = 815.0

    if next_anchor is None:
        return [(current.page, current.col, current.y, bottom_y)]

    start_unit = unit_index(current)
    end_unit = unit_index(next_anchor)
    regions: list[tuple[int, int, float, float]] = []

    for unit in range(start_unit, end_unit + 1):
        page = unit // 2 + 1
        col = unit % 2
        if unit == start_unit == end_unit:
            regions.append((page, col, current.y, next_anchor.y))
        elif unit == start_unit:
            regions.append((page, col, current.y, bottom_y))
        elif unit == end_unit:
            regions.append((page, col, top_y, next_anchor.y))
        else:
            regions.append((page, col, top_y, bottom_y))

    return regions


def trim_vertical(image: Image.Image, pad: int = 10) -> Image.Image:
    gray = image.convert("L")
    width, height = gray.size
    pixels = gray.load()
    content_rows: list[int] = []

    for y in range(height):
        dark_pixels = 0
        for x in range(width):
            if pixels[x, y] < 246:
                dark_pixels += 1
                if dark_pixels > 3:
                    break
        if dark_pixels > 3:
            content_rows.append(y)

    if not content_rows:
        return image

    top = max(0, content_rows[0] - pad)
    bottom = min(height, content_rows[-1] + pad + 1)
    return image.crop((0, top, width, bottom))


def trim_after_large_vertical_gap(image: Image.Image, min_gap: int = 90, pad: int = 12) -> Image.Image:
    gray = image.convert("L")
    arr = np.array(gray)
    content_rows = [
        y for y in range(arr.shape[0])
        if int((arr[y, :] < 246).sum()) > 3
    ]

    if not content_rows:
        return image

    previous = content_rows[0]
    for y in content_rows[1:]:
        if y - previous >= min_gap:
            return image.crop((0, 0, image.width, min(image.height, previous + pad)))
        previous = y

    return image


def crop_region(
    page_images: dict[int, Image.Image],
    page: int,
    col: int,
    y1: float,
    y2: float,
    scale: float,
) -> Image.Image | None:
    col_bounds = {0: (18.0, 292.0), 1: (300.0, 576.0)}
    top_y = 58.0
    bottom_y = 815.0
    x1, x2 = col_bounds[col]
    y1 = max(top_y, y1 - 4)
    y2 = min(bottom_y, y2 - 8)

    if y2 <= y1 + 2:
        return None

    page_image = page_images[page]
    crop_box = (
        round(x1 * scale),
        round(y1 * scale),
        round(x2 * scale),
        round(y2 * scale),
    )
    return trim_vertical(page_image.crop(crop_box))


def build_question_images(
    tmp_dir: Path,
    out_dir: Path,
    anchors: dict[int, Anchor],
    question_count: int,
    dpi: int,
    question_pages: int,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    scale = dpi / 72.0
    page_images = {
        page_no: Image.open(tmp_dir / f"page-{page_no:02d}.png").convert("RGB")
        for page_no in range(1, question_pages + 1)
    }

    for number in range(1, question_count + 1):
        pieces: list[Image.Image] = []
        for region in regions_between(anchors[number], anchors.get(number + 1)):
            piece = crop_region(page_images, *region, scale)
            if piece and piece.height > 12:
                pieces.append(piece)

        if not pieces:
            raise RuntimeError(f"no image pieces for question {number}")

        gap_px = 20
        width = max(piece.width for piece in pieces)
        height = sum(piece.height for piece in pieces) + gap_px * (len(pieces) - 1) + 32
        canvas = Image.new("RGB", (width + 32, height), "white")
        y = 16
        for piece in pieces:
            x = 16 + (width - piece.width) // 2
            canvas.paste(piece, (x, y))
            y += piece.height + gap_px

        if number == question_count:
            canvas = trim_after_large_vertical_gap(canvas)

        canvas.save(out_dir / f"q{number:03d}.png", optimize=True)


def green_pixel_bounds(image: Image.Image) -> tuple[int, int, list[tuple[int, int]]]:
    pixels = image.load()
    width, height = image.size
    green_rows: list[int] = []
    x_bounds: list[int] = []

    for y in range(height):
        row_xs = []
        for x in range(width):
            r, g, b = pixels[x, y]
            if g > 180 and r < 150 and b < 150:
                row_xs.append(x)
        if len(row_xs) > 50:
            green_rows.append(y)
            x_bounds.extend([min(row_xs), max(row_xs)])

    if not green_rows:
        raise RuntimeError("answer table green rows not found")

    bands: list[tuple[int, int]] = []
    start = previous = green_rows[0]
    for y in green_rows[1:]:
        if y == previous + 1:
            previous = y
        else:
            bands.append((start, previous))
            start = previous = y
    bands.append((start, previous))

    return min(x_bounds), max(x_bounds) + 1, bands


def write_answer_table_crop(tmp_dir: Path, out_dir: Path, last_page: int) -> Path:
    image = Image.open(tmp_dir / f"page-{last_page:02d}.png").convert("RGB")
    width, height = image.size
    rough_crop = image.crop((int(width * 0.30), int(height * 0.40), width - 30, height - 60))
    x1, x2, bands = green_pixel_bounds(rough_crop)
    y1 = bands[0][0]
    last_green_height = bands[-1][1] - bands[-1][0] + 1
    y2 = min(rough_crop.height, bands[-1][1] + last_green_height + 8)
    table_crop = rough_crop.crop((
        max(0, x1 - 4),
        max(0, y1 - 4),
        min(rough_crop.width, x2 + 4),
        y2,
    ))
    path = out_dir / "answer-table.png"
    table_crop.save(path, optimize=True)
    return path


def normalized_answer_cell(image: Image.Image, box: tuple[int, int, int, int]) -> np.ndarray:
    crop = image.crop(box).convert("L")
    arr = np.array(crop)
    mask = arr < 150
    ys, xs = np.where(mask)

    if len(xs) == 0:
        return np.zeros((32, 32), dtype=np.float32)

    x1 = max(0, int(xs.min()) - 2)
    x2 = min(arr.shape[1], int(xs.max()) + 3)
    y1 = max(0, int(ys.min()) - 2)
    y2 = min(arr.shape[0], int(ys.max()) + 3)
    glyph = crop.crop((x1, y1, x2, y2)).resize((32, 32))
    return (np.array(glyph) < 180).astype(np.float32)


def answer_cell_images(answer_table_path: Path, expected_count: int) -> list[np.ndarray]:
    image = Image.open(answer_table_path).convert("RGB")
    x1, x2, bands = green_pixel_bounds(image)
    expected_rows = expected_count // 10
    if len(bands) != expected_rows:
        raise RuntimeError(f"answer table has {len(bands)} rows, expected {expected_rows}")

    col_width = (x2 - x1) / 10
    cells: list[np.ndarray] = []
    for row_index, (green_y1, green_y2) in enumerate(bands):
        answer_y1 = green_y2 + 2
        if row_index + 1 < len(bands):
            answer_y2 = bands[row_index + 1][0] - 2
        else:
            green_height = green_y2 - green_y1 + 1
            answer_y2 = green_y2 + green_height + 2

        for col_index in range(10):
            box = (
                int(x1 + col_index * col_width + 8),
                int(answer_y1 + 3),
                int(x1 + (col_index + 1) * col_width - 8),
                int(answer_y2 - 3),
            )
            cells.append(normalized_answer_cell(image, box))

    return cells


def build_answer_templates(template_table_path: Path) -> list[tuple[int, np.ndarray]]:
    template_answers = MANUAL_ANSWERS["agent-2024-part1"]
    cells = answer_cell_images(template_table_path, len(template_answers))
    return list(zip(template_answers, cells))


def extract_answers_from_table(
    answer_table_path: Path,
    expected_count: int,
    template_table_path: Path,
) -> list[int]:
    templates = build_answer_templates(template_table_path)
    answers: list[int] = []
    for cell in answer_cell_images(answer_table_path, expected_count):
        distance, label = min(
            (float(np.mean(np.abs(cell - template))), label)
            for label, template in templates
        )
        if distance > 0.20:
            raise RuntimeError(f"answer cell classification is uncertain: distance={distance:.3f}")
        answers.append(label)
    return answers


def write_exam_json(
    out_dir: Path,
    exam_id: str,
    year: int,
    round_no: int,
    part: int,
    answers: list[int],
) -> None:
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
        "source": "COMCBT 학생용 PDF 렌더 이미지 기반",
        "answerSource": "마지막 페이지 우하단 정답표 이미지 수동 보정",
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
        json.dumps(exam, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def update_index(index_path: Path, exam_id: str, year: int, round_no: int, part: int) -> None:
    index_path.parent.mkdir(parents=True, exist_ok=True)
    if index_path.exists():
        index = json.loads(index_path.read_text(encoding="utf-8"))
    else:
        index = {"exams": []}

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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--exam-id", required=True)
    parser.add_argument("--year", required=True, type=int)
    parser.add_argument("--round", required=True, type=int)
    parser.add_argument("--part", required=True, type=int, choices=[1, 2])
    parser.add_argument("--question-pages", required=True, type=int)
    parser.add_argument("--last-page", required=True, type=int)
    parser.add_argument("--dpi", default=220, type=int)
    parser.add_argument("--tmp-dir", default=Path("tmp/pdfs"), type=Path)
    parser.add_argument("--out-root", default=Path("assets/exams"), type=Path)
    parser.add_argument("--template-table", default=Path("assets/exams/agent-2024-part1/answer-table.png"), type=Path)
    parser.add_argument("--auto-answers", action="store_true")
    args = parser.parse_args()

    if args.part not in PART_CONFIG:
        raise RuntimeError(f"unsupported part: {args.part}")

    tmp_dir = args.tmp_dir / args.exam_id
    out_dir = args.out_root / args.exam_id
    html_path = tmp_dir / "questions.html"

    render_pdf(args.pdf, tmp_dir, args.dpi)
    write_bbox_html(args.pdf, html_path, 1, args.question_pages)

    question_count = PART_CONFIG[args.part]["question_count"]
    anchors = parse_question_anchors(html_path, question_count)
    build_question_images(tmp_dir, out_dir, anchors, question_count, args.dpi, args.question_pages)
    answer_table_path = write_answer_table_crop(tmp_dir, out_dir, args.last_page)

    if args.auto_answers:
        answers = extract_answers_from_table(answer_table_path, question_count, args.template_table)
    else:
        answers = MANUAL_ANSWERS.get(args.exam_id)
        if not answers:
            raise RuntimeError(f"manual answers missing for {args.exam_id}")

    write_exam_json(out_dir, args.exam_id, args.year, args.round, args.part, answers)
    update_index(args.out_root / "exam-index.json", args.exam_id, args.year, args.round, args.part)

    print(f"Built {question_count} question images for {args.exam_id}")
    print(f"Answer table crop: {out_dir / 'answer-table.png'}")
    print(f"Exam JSON: {out_dir / 'exam.json'}")


if __name__ == "__main__":
    main()
