#!/usr/bin/env python3
"""Build 공시법 기출 question bank from the 「공시법 기출 문제풀이 과정 보충자료」 PDF.

문항을 텍스트로 뽑아 assets/gongsi/gongsi-bank.js 로 쓴다.

- 글자 위치는 pdfminer로 읽는다. 일부 글꼴은 ①~⑤, ㄱ~ㅁ 등에 유니코드 대응표가
  없어서 원본을 보고 만든 CID_MAP으로 채운다.
- 양쪽 정렬이라 낱말 중간에서 줄이 바뀌므로 Joiner가 붙여 쓸지 정하고,
  검토해서 틀린 자리는 FORCE_GLUE / FORCE_SPACE로 바로잡는다.
- 지적도면 같은 그림은 그 부분만 이미지로 잘라 쓰고(FIGURES), 토지대장 서식처럼
  모양이 맞지 않는 곳은 OVERRIDES에 손으로 옮겼다.
- 정답: 정답 기호가 텍스트로 안 나오는 페이지가 있어 원본을 보고 옮긴 ANSWERS를
  쓰고, 텍스트로 읽히는 정답과 어긋나면 빌드를 멈춘다.
- 같은 문제가 여러 회차 자료에 다시 실린 경우 처음 나온 것만 남긴다.

Usage:
  python3 scripts/build_gongsi_assets.py path/to/공시법.pdf [--review 검토용.txt]
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
WORD_GAP = 1.8          # pt, 보통 글자 간격보다 이만큼 넓으면 띄어쓰기

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

# 그림이 들어 있어 그 부분만 이미지로 남기는 문항
FIGURES = {"p1-08", "p2-07"}

# 자동 추출로는 모양이 맞지 않아 원본을 보고 손으로 옮긴 부분
OVERRIDES: dict[str, dict] = {
    # 토지대장 서식 → 표
    "p2-04": {
        "table": {
            "title": "토지대장",
            "rows": [
                [{"t": "고유번호", "head": True}, {"t": "4121010100-10158-0000", "span": 2}],
                [{"t": "토지소재", "head": True}, {"t": "△△도 ○○시 ◇◇동", "span": 2}],
                [{"t": "지번", "head": True}, "158", "축척 1:1200"],
                [{"t": "토지 표시", "head": True, "span": 3}],
                [{"t": "지목", "head": True}, {"t": "면적(㎡)", "head": True}, {"t": "사유", "head": True}],
                ["(01) 전", "*100", "(02) 1971년 8월 1일 신규등록(매립준공)"],
                ["(01) 전", "*60", "(20) 1978년 2월 2일 분할되어 본번에 -1을 부함"],
                ["(08) 대", "*60", "(40) 1999년 9월 9일 지목변경"],
                ["(08) 대", "*80", "(30) 2004년 1월 3일 159번과 합병"],
                [{"t": "등급수정 연월일", "head": True}, "1980년 1월 1일 수정", "1983년 1월 1일 수정"],
                [{"t": "토지등급(기준수확량등급)", "head": True}, "82", "91"],
                [{"t": "개별공시지가 기준일", "head": True}, "2003년 1월 1일", "2004년 1월 1일"],
                [{"t": "개별공시지가(원/㎡)", "head": True}, "1,200,000", "1,500,000"],
                [{"t": "토지대장에 의하여 작성한 등본입니다.\n2005년 1월 9일\n△△도 ○○시장", "span": 3}],
            ],
        },
    },
    # 선택지가 ㄱ·ㄴ·ㄷ 세 칸짜리 표
    "p2-19": {
        "box": [
            "• 지적소관청은 축척변경을 하려면 축척변경 시행지역의 토지소유자 ( ㄱ )의 동의를 받아 "
            "축척변경위원회의 의결을 거친 후 ( ㄴ )의 승인을 받아야 한다.",
            "• 축척변경 시행지역의 토지소유자 또는 점유자는 시행공고일부터 ( ㄷ ) 이내에 시행공고일 "
            "현재 점유하고 있는 경계에 경계점표지를 설치하여야 한다.",
        ],
        "options": [
            "ㄱ: 2분의 1 이상, ㄴ: 국토교통부장관, ㄷ: 30일",
            "ㄱ: 2분의 1 이상, ㄴ: 시, 도지사 또는 대도시 시장, ㄷ: 60일",
            "ㄱ: 2분의 1 이상, ㄴ: 국토교통부장관, ㄷ: 60일",
            "ㄱ: 3분의 2 이상, ㄴ: 시, 도지사 또는 대도시 시장, ㄷ: 30일",
            "ㄱ: 3분의 2 이상, ㄴ: 국토교통부장관, ㄷ: 60일",
        ],
    },
}

CIRCLED = {"①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5}


@dataclass
class Line:
    page: int
    y0: float
    y1: float
    x0: float
    text: str    # 공백 제거
    spaced: str  # 띄어쓰기 복원
    x1: float


@dataclass
class Question:
    part: int
    number: int
    start: Line
    answer_line: Line | None = None
    end: Line | None = None  # 다음 문항/자료 머리 (없으면 문서 끝)
    text: str = ""
    body: list[Line] = field(default_factory=list)   # 문항 번호 줄 다음 ~ 정답 줄 전
    after: list[Line] = field(default_factory=list)  # 정답 줄 다음 ~ 다음 문항 전(해설)


def run(cmd: list[str]) -> str:
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


# 일부 글꼴에 유니코드 대응표가 없어 pdfminer가 (cid:N)으로만 내주는 글자들.
# 같은 글꼴 계열이라 CID가 문서 전체에서 같다. 원본을 렌더링해 보고 채웠다.
CID_MAP = {
    59838: "①", 59839: "②", 59840: "③", 59841: "④", 59842: "⑤",
    61967: "ㄱ", 61970: "ㄴ", 61973: "ㄷ", 61975: "ㄹ", 61983: "ㅁ",
    62270: "㉠", 62271: "㉡", 62272: "㉢", 62273: "㉣", 62274: "㉤", 62275: "㉥",
    57255: "‘", 57256: "’", 57259: "“", 57260: "”",
    57755: "「", 57756: "」", 59121: "「", 59122: "」",
    57267: "·", 62059: "·", 51014: "·", 57512: "•", 59049: ":", 62591: "㎡",
    60177: "△", 60197: "◇", 60201: "○",
    3071: "겨", 4095: "남", 6655: "모", 11263: "첨", 13823: "효",
    32577: "筆", 34277: "自", 33792: "者", 37234: "起", 36538: "調", 36715: "議",
    39302: "開", 37086: "賣", 39773: "面", 37700: "轉", 37918: "連", 38003: "選", 41689: "點",
}


def read_lines(pdf: Path) -> list[Line]:
    """페이지별 글자를 눈에 보이는 줄 단위로 묶는다.

    글자 사이 간격이 WORD_GAP보다 넓을 때만 띄어 쓴다(자간이 넓은 페이지의
    "공 간 정 보"를 "공간정보"로). 줄 상자가 쪼개지거나 오른쪽 끝 "정답"이 따로
    떨어지는 페이지가 있어 y 위치로 다시 묶는다.
    """
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTChar

    def walk(element):
        for child in element:
            if isinstance(child, LTChar):
                yield child
            elif hasattr(child, "__iter__"):
                yield from walk(child)

    lines: list[Line] = []
    for page_no, page in enumerate(extract_pages(str(pdf)), start=1):
        height = page.height
        chars = []
        for ch in walk(page):
            if ch.x1 - ch.x0 < 0.5:  # 폭 0인 보이지 않는 글자
                continue
            text = ch.get_text()
            m = re.fullmatch(r"\(cid:(\d+)\)", text)
            if m:
                cid = int(m.group(1))
                if cid not in CID_MAP:
                    raise SystemExit(f"{page_no}쪽: 모르는 글자 (cid:{cid})")
                text = CID_MAP[cid]
            if not text.strip():
                continue
            y0, y1 = height - ch.y1, height - ch.y0
            if y1 <= HEADER_BOTTOM or y0 >= FOOTER_TOP:
                continue
            chars.append((ch.x0, ch.x1, y0, y1, text))
        rows: list[list[tuple]] = []
        for ch in sorted(chars, key=lambda c: (c[2] + c[3]) / 2):
            mid = (ch[2] + ch[3]) / 2
            row = next((r for r in rows if abs(r[0] - mid) < 4.5), None)
            if row is None:
                rows.append([mid, ch])
            else:
                row.append(ch)
        for row in rows:
            row = sorted(row[1:], key=lambda c: c[0])
            # 줄마다 자간이 달라(좁힌 줄은 글자 간격이 음수) 그 줄의 보통 글자 간격보다
            # WORD_GAP 이상 넓을 때 띄어쓰기로 본다.
            gaps = sorted(b[0] - a[1] for a, b in zip(row, row[1:]))
            base = gaps[len(gaps) // 4] if gaps else 0.0
            spaced = row[0][4]
            for prev, ch in zip(row, row[1:]):
                spaced += (" " if ch[0] - prev[1] > base + WORD_GAP else "") + ch[4]
            text = spaced.replace(" ", "")
            if re.fullmatch(r"-\d+-", text):
                continue
            lines.append(Line(page_no, min(c[2] for c in row), max(c[3] for c in row),
                              row[0][0], text, spaced, max(c[1] for c in row)))
    lines.sort(key=lambda l: (l.page, l.y0, l.x0))
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
        if current.answer_line is None:
            current.body.append(line)
            current.text += line.text
        else:
            current.after.append(line)
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


OPTION_RE = re.compile(r"[①②③④⑤]")
ITEM_START_RE = re.compile(r"^(?:[ㄱ-ㅎ]\.|[㉠-㉥]|[•∙·ㆍ])")
ROUND_RE = re.compile(r"\s*\((제?\s*[\d\-]+\s*[회화][^)]*)\)\s*$")
PUNCT = "\"'“”‘’「」｢｣()[],.:;?·․ㆍ"


# 줄바꿈 자리 판단을 사람이 검토해 바로잡은 목록: (앞 줄 끝, 다음 줄 머리)
FORCE_GLUE = [
    ("조사계획을 수", "립한다"), ("않으므로 유지", "는 과수원"), ("제출한 지번", "별조서"),
    ("하며, 확정", "공고일"), ("지적공부의 토지", "소유자를"), ("경우에는 토지", "이동정리결의서"),
    ("경우에는 소유", "자정리"), ("그 등", "기완료"), ("자의 주소", "나 거소"),
    ("사회통념상 동", "일성"), ("의하여 우선", "변제"), ("최초매도인과 최종", "매수인"),
    ("통지하지 않는", "다."), ("기재하지 않는", "다."), ("소유권보존등기", "에서 등기명의인"),
    ("채권자", "는 이의신청"), ("등기상 이해관계", "인이"), ("해당하는 것", "임을"),
    ("신청인의 소유", "임을"), ("변경사항을 정", "리한"), ("그 등기", "원인의"),
    ("전원이 등기의", "무자"), ("패소한 등기의", "무자도"), ("아니하는 사항", "에 대해서는"),
    ("변경된 사실", "이 명백한"), ("공동신청", "에 의하여야"),
]
FORCE_SPACE = [
    ("“학교용지”로", "한다."), ("“공원”으로", "한다."), ("경계점표지", "등으로"),
    ("분할하려는", "경우에는"), ("(제23회", "수정)"), ("증명서를", "발급받으려는"),
    ("지적정리의", "통지를"), ("의뢰하여야", "하는 지적측량"), ("경위의", "측량"),
    ("출석위원", "과반수"), ("유효한", "등기로"), ("위임하게", "할 수"), ("갈음하여", "등기명의인"),
    ("가처분이", "2013"), ("공동신청에", "의한"), ("실효”를", "등기원인"), ("채무자도", "채권자가"),
    ("아니하여도", "가집행"), ("송달증명서를", "첨부"), ("출석하여야", "한다"),
    ("이행판결이", "있는"), ("상속인을", "등기의무자로"), ("거래가액을", "등기하지"),
    ("확인정보", "등을"), ("이용하여", "이의신청정보"), ("취득케", "하는"), ("처분하는", "경우"),
    ("명의수탁자의", "명의로"), ("소멸하는", "경우에는"), ("양도액을", "기록한다"),
    ("부기등기를", "하지"), ("저당권설정등기는", "불가능"), ("(주된", "토지)"),
    ("( ㄱ )부터", "순차적으로"), ("( ㄴ )부터", "순차적으로"), ("지적소관청의", "확인으로"),
    ("행정기관의", "장 또는"), ("증명하거나", "제공한"), ("이하의", "위원으로"),
]


class Joiner:
    """줄바꿈 자리를 띄어 쓸지 붙여 쓸지 정한다.

    양쪽 정렬이라 낱말 중간에서도 줄이 바뀐다("토지소 / 유자의"). 문서 안에서
    줄 끝·줄 머리가 아닌 자리에 나온 낱말들을 사전 삼아, 이어 붙인 말이 사전에
    있거나 줄 머리 조각이 홀로 쓰인 적이 없으면 붙인다.
    """

    def __init__(self, lines: list[Line]):
        self.vocab: set[str] = set()
        self.log: list[str] = []
        for line in lines:
            tokens = line.spaced.split()
            for token in tokens[1:-1]:
                self.vocab.add(self.core(token))

    @staticmethod
    def core(token: str) -> str:
        return token.strip(PUNCT)

    def glue(self, left: str, right: str) -> bool:
        for tail, head in FORCE_GLUE:
            if left.endswith(tail) and right.startswith(head):
                return True
        for tail, head in FORCE_SPACE:
            if left.endswith(tail) and right.startswith(head):
                return False
        a, b = left.split()[-1], right.split()[0]
        if re.search(r"\d\.$", a) and b[0].isdigit():      # "1,029." + "551㎡"
            return True
        if re.fullmatch(r"[\d,.]*\d", a) and re.match(r"[가-힣㎡%]", b):  # "100" + "장"
            return True
        if a[-1] in ",.:;)」｣”’?" or b[0] in "(「｢“‘①②③④⑤":
            return False
        ca, cb = self.core(a), self.core(b)
        if not ca or not cb:
            return False
        if self.core(a + b) in self.vocab:
            return True
        # 줄 끝 조각이 낱말로 쓰인 적이 없으면 낱말이 잘린 것으로 본다.
        return ca not in self.vocab

    def decide(self, left: str, right: str) -> tuple[bool, str]:
        a, b = left.split()[-1], right.split()[0]
        ca, cb = self.core(a), self.core(b)
        tag = f"A{'+' if ca in self.vocab else '-'}B{'+' if cb in self.vocab else '-'}AB{'+' if self.core(a + b) in self.vocab else '-'}"
        return self.glue(left, right), tag

    def join(self, left: str, right: str) -> str:
        if not left:
            return right
        glued, tag = self.decide(left, right)
        self.log.append(f"{'붙임' if glued else '띄움'} {tag}  …{left[-14:]} | {right[:14]}…")
        return left + ("" if glued else " ") + right


def tidy(text: str) -> str:
    """가운뎃점 모양(․ ㆍ ∙ ·)과 그 앞뒤 공백을 하나로 맞추고, 보기 머리표는 •로."""
    text = re.sub(r"^[•∙·ㆍ]\s*", "• ", text.strip())
    return re.sub(r"(?<=\S)\s*[․ㆍ∙·]\s*(?=\S)", "·", text)


def parse_question(q: Question, joiner: Joiner) -> dict:
    """문항 줄들을 발문 / 보기 상자 / 선택지 5개로 나눈다."""
    body = [q.start] + q.body
    stem = re.sub(r"^\d+\s*\.\s*", "", q.start.spaced)
    i = 1
    while i < len(body) and body[i].x0 >= 97 and not OPTION_RE.match(body[i].spaced) \
            and not ITEM_START_RE.match(body[i].spaced) and not ROUND_RE.search(stem):
        stem = joiner.join(stem, body[i].spaced)
        i += 1

    box: list[str] = []
    options: list[str] = []
    box_lines: list[Line] = []
    for line in body[i:]:
        text = line.spaced
        if OPTION_RE.match(text):
            for piece in re.split(r"(?=[①②③④⑤])", text):
                if piece.strip():
                    options.append(piece[1:].strip())
        elif options:
            options[-1] = joiner.join(options[-1], text)
        else:
            box_lines.append(line)
            pieces = [p.strip() for p in re.split(r"\s+(?=[ㄱ-ㅎ]\.\s)", text) if p.strip()]
            for piece in pieces:
                if ITEM_START_RE.match(piece) or not box:
                    box.append(piece)
                else:
                    box[-1] = joiner.join(box[-1], piece)

    item = {
        "stem": tidy(ROUND_RE.sub("", stem)),
        "round": round_label(stem),
        "options": [tidy(o) for o in options],
    }
    if box:
        item["box"] = [tidy(b) for b in box]
    item["_box_lines"] = box_lines
    item["_stem_bottom"] = body[i - 1]

    # 해설: 정답 줄에 붙어 있거나 그 아래 줄들
    explain: list[str] = []
    head = re.sub(r"^정답\s*[:：]?\s*[①②③④⑤]?\s*", "", q.answer_line.spaced)
    rows = ([head] if head else []) + [l.spaced for l in q.after]
    starts = [True] * (1 if head else 0) + [l.x0 < 97 for l in q.after]
    for text, is_start in zip(rows, starts):
        text = re.sub(r"^해\s*설\s*[:：]\s*", "", text)
        if is_start or not explain:
            explain.append(text)
        else:
            explain[-1] = joiner.join(explain[-1], text)
    if explain:
        item["explain"] = [tidy(e) for e in explain]
    return item


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
    parser.add_argument("--review", type=Path, help="검토용 텍스트 덤프 경로")
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

    joiner = Joiner(lines)
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)

    items = []
    problems = []
    with tempfile.TemporaryDirectory() as tmp_name:
        pages = render_pages(args.pdf, Path(tmp_name))
        for q in kept:
            qid = f"p{q.part}-{q.number:02d}"
            parsed = parse_question(q, joiner)
            box_lines = parsed.pop("_box_lines")
            stem_bottom = parsed.pop("_stem_bottom")
            item = {
                "id": qid,
                "subject": SUBJECTS[q.part],
                "part": q.part,
                "number": q.number,
                "round": parsed.pop("round"),
                "answer": ANSWERS[q.part][q.number - 1],
                **parsed,
            }
            if qid in FIGURES or "table" in OVERRIDES.get(qid, {}):
                item.pop("box", None)
            if qid in FIGURES:
                # 그림(지적도면 등)은 글로 옮길 수 없어 그 부분만 잘라 붙인다.
                first_option = next(l for l in q.body if OPTION_RE.match(l.spaced))
                image = stack(span(pages, stem_bottom, stem_bottom.y1 + 1, first_option))
                cols = np.where((np.asarray(image.convert("L")) < 235).any(axis=0))[0]
                image = image.crop((max(cols[0] - 12, 0), 0, min(cols[-1] + 12, image.width), image.height))
                save(image, OUT_DIR / f"{qid}-fig.png")
                item["figure"] = f"./assets/gongsi/{qid}-fig.png"
            item.update(OVERRIDES.get(qid, {}))
            if len(item["options"]) != 5:
                problems.append(f"{qid}: 선택지 {len(item['options'])}개")
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
    if args.review:
        Path(str(args.review) + ".joins").write_text("\n".join(joiner.log), encoding="utf-8")
    for problem in problems:
        print("확인 필요:", problem)
    if args.review:
        with args.review.open("w", encoding="utf-8") as out:
            for item in items:
                out.write(f"\n## {item['id']} {item['round']} 정답 {item['answer']}\n{item['stem']}\n")
                for line in item.get("box", []):
                    out.write(f"  [보기] {line}\n")
                if "figure" in item:
                    out.write("  [그림]\n")
                for n, option in enumerate(item["options"], 1):
                    out.write(f"  {n}) {option}\n")
                for line in item.get("explain", []):
                    out.write(f"  [해설] {line}\n")


if __name__ == "__main__":
    main()
