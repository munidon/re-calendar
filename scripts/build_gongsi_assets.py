#!/usr/bin/env python3
"""Build 공시법 기출 assets from the 「공시법 기출 문제풀이 과정 보충자료」 PDF.

기존 기출문제 스크립트와 마찬가지로 텍스트 레이어는 문항 번호 · "정답" 줄의
위치를 찾는 데만 쓰고, 화면에는 렌더링한 페이지를 잘라낸 이미지를 보여준다.

- 문제 이미지: 문항 번호 줄 ~ "정답" 줄 직전 (페이지를 넘기면 이어 붙인다)
- 해설 이미지: "정답" 줄 ~ 다음 문항 직전 ("정답" 줄 말고 내용이 있을 때만)
- 정답: 일부 페이지는 정답 기호가 텍스트로 추출되지 않아 원본을 보고 옮긴
  ANSWERS를 쓰고, 텍스트로 읽히는 정답과 어긋나면 빌드를 멈춘다.
- 같은 문제가 여러 회차 자료에 다시 실린 경우 처음 나온 것만 남긴다.

Usage:
  python3 scripts/build_gongsi_assets.py path/to/공시법.pdf
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

OUT_DIR = Path("assets/gongsi")
DPI = 200
SCALE = DPI / 72.0
CROP_X = (76.0, 524.0)  # pt, 본문 좌우 여백
HEADER_BOTTOM = 75.0    # pt, 머리말("공시법 기출 문제풀이 과정 보충자료") 아래
FOOTER_TOP = 784.0      # pt, 쪽 번호("- 3 -") 위
PAD = 4.0               # pt

# 자료 회차(기출문제풀이 1~8) → 과목
SUBJECTS = {1: "jijeok", 2: "jijeok", 3: "jijeok",
            4: "deunggi", 5: "deunggi", 6: "deunggi", 7: "deunggi", 8: "deunggi"}

# 원본을 보고 옮긴 정답(자료 회차별, 문항 순서대로)
ANSWERS = {
    1: [3, 5, 5, 5, 3, 5, 1, 2, 2, 2, 1, 3, 1, 2, 4, 2, 3],
    2: [3, 5, 5, 3, 3, 1, 2, 2, 5, 3, 4, 3, 4, 1, 4, 4, 4, 5, 4, 2, 3, 4],
    3: [2, 1, 5, 5, 2, 4, 4, 4, 3, 1, 4, 4, 5, 2, 4, 3, 3, 3, 2, 2, 3, 5],
    4: [4, 3, 5, 3, 2, 2, 4, 1, 3, 5, 1, 5, 5, 1, 1, 5, 4, 5, 2, 5, 3],
    5: [5, 3, 1, 2, 4, 1, 2, 2, 4, 3, 1, 1],
    6: [2, 1, 3, 5, 1, 4, 3, 1, 1, 1, 1, 1, 1, 2, 5, 5, 2, 5, 3, 1, 1, 4],
    7: [5, 3, 1, 2, 1, 3, 1, 4, 4, 3, 3, 4, 5, 2, 4, 1, 2],
    8: [4, 3, 4, 4, 2, 1, 5, 4, 3, 2, 5, 5, 3, 3, 5, 2],
}

CIRCLED = {"①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5}


@dataclass
class Line:
    page: int
    y0: float
    y1: float
    x0: float
    text: str  # 공백 제거


@dataclass
class Question:
    part: int
    number: int
    start: Line
    answer_line: Line | None = None
    end: Line | None = None  # 다음 문항/자료 머리 (없으면 문서 끝)
    text: str = ""
    lines: list[Line] = field(default_factory=list)


def run(cmd: list[str]) -> str:
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def read_lines(pdf: Path) -> list[Line]:
    xml = run(["pdftotext", "-bbox-layout", str(pdf), "-"])
    xml = re.sub(r"<!DOCTYPE[^>]*>", "", xml)
    root = ET.fromstring(xml)
    ns = {"x": "http://www.w3.org/1999/xhtml"}
    lines: list[Line] = []
    for page_no, page in enumerate(root.iter("{http://www.w3.org/1999/xhtml}page"), start=1):
        page_lines = []
        for line in page.iterfind(".//x:line", ns):
            words = [w.text or "" for w in line.iterfind("x:word", ns)]
            text = "".join(words).replace(" ", "")
            y0, y1 = float(line.get("yMin")), float(line.get("yMax"))
            if not text or y1 <= HEADER_BOTTOM or y0 >= FOOTER_TOP or re.fullmatch(r"-\d+-", text):
                continue
            page_lines.append(Line(page_no, y0, y1, float(line.get("xMin")), text))
        page_lines.sort(key=lambda l: (l.y0, l.x0))
        lines.extend(page_lines)
    return lines


def find_questions(lines: list[Line]) -> list[Question]:
    questions: list[Question] = []
    part = 0
    current: Question | None = None
    for line in lines:
        header = re.match(r"기출문제풀이(\d)", line.text)
        if header:
            part = int(header.group(1))
            if current:
                current.end = current.end or line
            current = None
            continue
        expected = (current.number + 1) if current and current.part == part else 1
        m = re.match(r"^(\d+)\.", line.text)
        if part and m and int(m.group(1)) == expected and line.x0 < 92:
            if current:
                current.end = current.end or line
            current = Question(part, expected, line)
            questions.append(current)
            continue
        if not current:
            continue
        if current.answer_line is None and line.text.startswith("정답"):
            current.answer_line = line
            continue
        current.lines.append(line)
        if current.answer_line is None:
            current.text += line.text
    for q in questions:
        q.text = q.start.text + q.text
    return questions


def render_pages(pdf: Path, tmp: Path) -> dict[int, Image.Image]:
    run(["pdftoppm", "-png", "-r", str(DPI), str(pdf), str(tmp / "page")])
    pages = {}
    for path in sorted(tmp.glob("page-*.png")):
        pages[int(path.stem.split("-")[1])] = Image.open(path).convert("RGB")
    return pages


def crop(pages: dict[int, Image.Image], page: int, y0: float, y1: float) -> Image.Image | None:
    image = pages[page]
    box = (int(CROP_X[0] * SCALE), int(max(y0, HEADER_BOTTOM) * SCALE),
           int(CROP_X[1] * SCALE), int(min(y1, FOOTER_TOP) * SCALE))
    if box[3] - box[1] < 4:
        return None
    region = image.crop(box)
    ink = np.asarray(region.convert("L")) < 235
    rows = np.where(ink.any(axis=1))[0]
    if rows.size == 0:
        return None
    top, bottom = max(rows[0] - 12, 0), min(rows[-1] + 12, region.height)
    return region.crop((0, top, region.width, bottom))


def cut_above(image: Image.Image, stop: Line) -> float:
    """stop 줄 글자 바로 위의 빈 줄 높이(pt).

    텍스트 레이어의 줄 상자가 실제 글자와 어긋난 페이지가 있어서, stop 줄이 놓인
    칸(x0~오른쪽)의 잉크 덩어리 중 줄 상자와 가장 많이 겹치는 것을 픽셀로 찾아
    그 위에서 자른다.
    """
    x0, x1 = int(stop.x0 * SCALE), int(CROP_X[1] * SCALE)
    top = int(max(stop.y0 - 40, HEADER_BOTTOM) * SCALE)
    bottom = int((stop.y1 + 10) * SCALE)
    ink = (np.asarray(image.crop((x0, top, x1, bottom)).convert("L")) < 235).any(axis=1)
    bands, start = [], None
    for y, on in enumerate(list(ink) + [False]):
        if on and start is None:
            start = y
        elif not on and start is not None:
            bands.append((start, y))
            start = None
    s0, s1 = stop.y0 * SCALE - top, stop.y1 * SCALE - top
    best = max(bands, key=lambda b: min(b[1], s1) - max(b[0], s0), default=None)
    if best is None or best[0] == 0 or min(best[1], s1) - max(best[0], s0) <= 0:
        return stop.y0 - PAD
    return (top + best[0] - 2) / SCALE


def span(pages, start: Line, start_y: float, stop: Line | None) -> list[Image.Image]:
    """start 줄 위쪽부터 stop 줄 직전까지(페이지가 바뀌면 나눠서) 잘라낸다."""
    last_page = stop.page if stop else max(pages)
    parts = []
    for page in range(start.page, last_page + 1):
        y0 = start_y if page == start.page else HEADER_BOTTOM
        y1 = cut_above(pages[page], stop) if stop and page == stop.page else FOOTER_TOP
        piece = crop(pages, page, y0, y1)
        if piece:
            parts.append(piece)
    return parts


def stack(parts: list[Image.Image]) -> Image.Image:
    gap = 16
    width = max(p.width for p in parts)
    canvas = Image.new("RGB", (width, sum(p.height for p in parts) + gap * (len(parts) - 1)), "white")
    y = 0
    for p in parts:
        canvas.paste(p, (0, y))
        y += p.height + gap
    return canvas


def save(image: Image.Image, path: Path) -> None:
    image.quantize(colors=32, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)


def normalize(text: str) -> str:
    text = re.sub(r"\(제?[\d\-]+회[^)]*\)", "", text)
    return re.sub(r"[^가-힣A-Za-z0-9]", "", text)


def round_label(text: str) -> str:
    m = re.search(r"\((제?\s*[\d\-]+\s*[회화][^)]*)\)", text)
    if not m:
        return ""
    label = m.group(1).replace("화", "회")
    return label if label.startswith("제") else f"제{label}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    args = parser.parse_args()

    lines = read_lines(args.pdf)
    questions = find_questions(lines)

    by_part: dict[int, list[Question]] = {}
    for q in questions:
        by_part.setdefault(q.part, []).append(q)
    for part, expected in ANSWERS.items():
        found = len(by_part.get(part, []))
        if found != len(expected):
            raise SystemExit(f"자료 {part}: 문항 {found}개 발견, 정답 {len(expected)}개")
    for q in questions:
        if q.answer_line is None:
            raise SystemExit(f"자료 {q.part} {q.number}번: 정답 줄을 찾지 못함")
        printed = next((CIRCLED[c] for c in q.answer_line.text if c in CIRCLED), None)
        manual = ANSWERS[q.part][q.number - 1]
        if printed is not None and printed != manual:
            raise SystemExit(f"자료 {q.part} {q.number}번: 텍스트 정답 {printed} ≠ 입력 정답 {manual}")

    # 중복 문항: 본문(회차 표기 제외)이 거의 같으면 처음 것만 남긴다.
    kept: list[Question] = []
    dropped: list[tuple[Question, Question]] = []
    for q in questions:
        norm = normalize(q.text)
        twin = next((k for k in kept if difflib.SequenceMatcher(None, norm, normalize(k.text)).ratio() > 0.9), None)
        if twin:
            if ANSWERS[twin.part][twin.number - 1] != ANSWERS[q.part][q.number - 1]:
                raise SystemExit(f"중복 문항 정답 불일치: {q.part}-{q.number} / {twin.part}-{twin.number}")
            dropped.append((q, twin))
        else:
            kept.append(q)

    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)

    items = []
    with tempfile.TemporaryDirectory() as tmp_name:
        pages = render_pages(args.pdf, Path(tmp_name))
        for q in kept:
            qid = f"p{q.part}-{q.number:02d}"
            save(stack(span(pages, q.start, q.start.y0 - PAD, q.answer_line)), OUT_DIR / f"{qid}.png")

            item = {
                "id": qid,
                "subject": SUBJECTS[q.part],
                "part": q.part,
                "number": q.number,
                "round": round_label(q.text),
                "answer": ANSWERS[q.part][q.number - 1],
                "image": f"./assets/gongsi/{qid}.png",
            }
            # 해설: "정답" 줄과 같은 줄에 붙어 있거나 그 아래에 이어진다.
            ans = q.answer_line
            has_explain = re.sub(r"정답[:：]?[①-⑤]?", "", ans.text) != "" or any(
                (l.page, l.y1) > (ans.page, ans.y0 + 1) for l in q.lines
            )
            if has_explain:
                save(stack(span(pages, ans, ans.y0 - PAD, q.end)), OUT_DIR / f"{qid}-exp.png")
                item["explain"] = f"./assets/gongsi/{qid}-exp.png"
            items.append(item)

    bank = OUT_DIR / "gongsi-bank.js"
    bank.write_text(
        "// scripts/build_gongsi_assets.py 로 생성 — 직접 고치지 말 것\n"
        f"export const GONGSI_QUESTIONS = {json.dumps(items, ensure_ascii=False, indent=1)};\n",
        encoding="utf-8",
    )

    for subject in ("jijeok", "deunggi"):
        print(subject, sum(1 for i in items if i["subject"] == subject))
    for q, twin in dropped:
        print(f"중복 제외: 자료{q.part} {q.number}번 = 자료{twin.part} {twin.number}번")
    print("해설 있음:", sum(1 for i in items if "explain" in i))


if __name__ == "__main__":
    main()
