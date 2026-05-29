#!/usr/bin/env python3
"""Build all downloaded COMCBT exam assets for the app."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PART_FOLDERS = {
    1: Path("/Users/hhj/Desktop/공인중개사_1차_필기_기출문제_학생용_PDF"),
    2: Path("/Users/hhj/Desktop/공인중개사_2차_필기_기출문제_학생용_PDF"),
}


def pdf_pages(pdf_path: Path) -> int:
    output = subprocess.check_output(["pdfinfo", str(pdf_path)], text=True, errors="ignore")
    match = re.search(r"Pages:\s+(\d+)", output)
    if not match:
        raise RuntimeError(f"page count not found: {pdf_path}")
    return int(match.group(1))


def load_rounds(folder: Path) -> dict[str, int]:
    manifest = json.loads((folder / "download_manifest.json").read_text(encoding="utf-8"))
    rounds: dict[str, int] = {}
    for item in manifest.get("saved", []):
        title = item.get("postTitle", "")
        match = re.search(r"\((\d+)회", title)
        if match:
            rounds[item["file"]] = int(match.group(1))
    return rounds


def fallback_round(date: str) -> int:
    if date == "20050522":
        return 15
    return int(date[:4]) - 1989


def exam_id_for(part: int, year: int, date: str) -> str:
    if year == 2024 and part == 1:
        return "agent-2024-part1"
    return f"agent-{date}-part{part}"


def main() -> None:
    template_table = ROOT / "assets/exams/agent-2024-part1/answer-table.png"
    if not template_table.exists():
        raise RuntimeError("Build agent-2024-part1 first so answer templates are available")

    built: list[str] = []
    failed: list[tuple[str, str]] = []

    for part, folder in PART_FOLDERS.items():
        rounds = load_rounds(folder)
        for pdf_path in sorted(folder.glob("*.pdf")):
            match = re.search(rf"공인중개사{part}차(\d{{8}})", pdf_path.name)
            if not match:
                failed.append((pdf_path.name, "date not found"))
                continue

            date = match.group(1)
            year = int(date[:4])
            round_no = rounds.get(pdf_path.name) or fallback_round(date)

            pages = pdf_pages(pdf_path)
            exam_id = exam_id_for(part, year, date)
            base_command = [
                "python3",
                str(ROOT / "scripts/build_exam_assets.py"),
                "--pdf",
                str(pdf_path),
                "--exam-id",
                exam_id,
                "--year",
                str(year),
                "--round",
                str(round_no),
                "--part",
                str(part),
            ]
            command_tail = [
                "--question-pages",
                str(pages - 1),
                "--last-page",
                str(pages),
                "--template-table",
                str(template_table),
            ]
            if exam_id != "agent-2024-part1":
                command_tail.append("--auto-answers")

            try:
                command = base_command + command_tail
                completed = subprocess.run(command, cwd=ROOT, check=True, text=True, capture_output=True)
                print(completed.stdout, end="")
                built.append(exam_id)
            except Exception as exc:
                if pages - 1 == pages:
                    failed.append((pdf_path.name, str(exc)))
                    continue
                retry_tail = command_tail.copy()
                qp_index = retry_tail.index("--question-pages") + 1
                retry_tail[qp_index] = str(pages)
                try:
                    completed = subprocess.run(base_command + retry_tail, cwd=ROOT, check=True, text=True, capture_output=True)
                    print(completed.stdout, end="")
                    built.append(exam_id)
                except Exception as retry_exc:
                    failed.append((pdf_path.name, str(retry_exc)))

    print(f"built: {len(built)}")
    for exam_id in built:
        print(f"  {exam_id}")
    if failed:
        print(f"failed: {len(failed)}")
        for name, reason in failed:
            print(f"  {name}: {reason}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
