"""Extract the private Ozar vocabulary source with pdfplumber."""

import argparse
from bisect import bisect_right
from collections import Counter
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import re
from statistics import median
import unicodedata

import pdfplumber


TABLE_TOP = 56
CELL_NAMES = ("ex", "def", "term", "number")
LTR_RUN = re.compile(r"[A-Za-z0-9]+(?:[ .:/+–-][A-Za-z0-9]+)*")
UNIT_SIZE = 100
UNIT_COUNT = 20


@dataclass
class Issue:
    page: int
    unit: int
    n: int | None
    reason: str


def is_mark(character):
    return unicodedata.category(character).startswith("M")


def glyph_text(glyph):
    return unicodedata.normalize("NFKC", glyph["text"])


def visual_line(glyphs):
    bases = []
    marks = []
    for glyph in glyphs:
        value = glyph_text(glyph)
        if not value:
            continue
        (marks if all(is_mark(char) for char in value) else bases).append((glyph, value))

    bases.sort(key=lambda item: item[0]["x0"])
    if not bases:
        return ""

    printed = [glyph for glyph, value in bases if not value.isspace()]
    bases = [
        (glyph, value) for glyph, value in bases
        if not value.isspace() or not any(
            other["x0"] < (glyph["x0"] + glyph["x1"]) / 2 < other["x1"]
            for other in printed
        )
    ]

    letters = [
        (index, glyph)
        for index, (glyph, value) in enumerate(bases)
        if value and "\u05d0" <= value[0] <= "\u05ea"
    ]
    marks_by_letter = {}
    for glyph, value in marks:
        if not letters:
            continue
        x = (glyph["x0"] + glyph["x1"]) / 2
        index, letter = min(
            letters,
            key=lambda item: (
                max(item[1]["x0"] - x, x - item[1]["x1"], 0),
                abs((item[1]["x0"] + item[1]["x1"]) / 2 - x),
            ),
        )
        if letter["x0"] - 1.5 <= x <= letter["x1"] + 1.5:
            marks_by_letter.setdefault(index, []).extend(value)

    clusters = []
    right_edge = None
    for index, (glyph, value) in enumerate(bases):
        if right_edge is not None and glyph["x0"] - right_edge >= 2.3:
            clusters.append(" ")
        right_edge = max(right_edge or glyph["x1"], glyph["x1"])
        if value.isspace():
            clusters.append(" ")
            continue
        for mark in marks_by_letter.get(index, []):
            if mark in "\u05c1\u05c2" and value[0] != "ש":
                continue
            if mark not in value:
                value += mark
        if value[0] != "ש":
            value = value.replace("\u05c1", "").replace("\u05c2", "")
        clusters.append(value)

    reversed_line = "".join(reversed(clusters)).strip()
    logical_line = LTR_RUN.sub(lambda match: match[0][::-1], reversed_line)
    logical_line = re.sub(r"\s+", " ", logical_line)
    return unicodedata.normalize("NFC", logical_line)


def cell_text(glyphs):
    lines = []
    for glyph in sorted(glyphs, key=lambda item: item["bottom"]):
        if not lines or glyph["bottom"] - lines[-1][0] > 2:
            lines.append((glyph["bottom"], []))
        lines[-1][1].append(glyph)
    return " ".join(filter(None, (visual_line(line) for _, line in lines)))


def table_layout(page):
    example_rules = [
        rect
        for rect in page.rects
        if 0 < rect["height"] < 1.5 and 17 < rect["x0"] < 40
        and 276 < rect["x1"] < 294 and rect["width"] > 230
    ]
    if not example_rules:
        return None
    rules = sorted(rect["top"] + rect["height"] / 2 for rect in example_rules)
    distinct = []
    for y in rules:
        if not distinct or y - distinct[-1] > 1:
            distinct.append(y)
    table_y = {round(rect["top"], 2) for rect in example_rules}
    borders = [
        rect for rect in page.rects
        if round(rect["top"], 2) in table_y and 0 < rect["height"] < 1.5
    ]
    edges = []
    for lower, upper in ((276, 294), (423, 447), (526, 547)):
        separators = [
            (rect["x0"] + rect["x1"]) / 2 for rect in borders
            if 0.2 <= rect["width"] <= 1.5 and lower < rect["x0"] < upper
        ]
        if not separators:
            return None
        edges.append(median(separators))

    right_edges = [
        rect["x1"] for rect in borders if 526 < rect["x0"] < 547 and rect["width"] > 25
    ]
    if not right_edges:
        return None
    return distinct, median(rect["x0"] for rect in example_rules), edges, median(right_edges)


def read_rows(page, layout):
    rules, example_start, edges, table_end = layout
    rows = [[[] for _ in CELL_NAMES] for _ in rules]
    for glyph in page.chars:
        y = (glyph["top"] + glyph["bottom"]) / 2
        x = (glyph["x0"] + glyph["x1"]) / 2
        if TABLE_TOP <= y < rules[-1] and example_start - 1 <= x <= table_end + 1:
            rows[bisect_right(rules, y)][bisect_right(edges, x)].append(glyph)
    for cells in rows:
        yield dict(zip(CELL_NAMES, map(cell_text, cells), strict=True))


def is_header(row):
    return row["term"] == "מונח" or (
        not row["def"] and not row["ex"] and len(row["term"]) <= 2
    )


def parse_document(path):
    entries = []
    issues = []
    continuations = []
    corrections = []
    source_pages = {}
    previous = None
    previous_page = None
    unit = 0

    with pdfplumber.open(path) as document:
        for page in document.pages:
            layout = table_layout(page)
            if not layout:
                page.close()
                continue

            seen_number = False
            rows = list(read_rows(page, layout))
            for index, row in enumerate(rows):
                if is_header(row) and not row["number"].isdigit():
                    continue
                if row["term"].replace(" ", "") == "מונח" or row["number"].startswith("יחידה "):
                    continue
                raw_number = row.pop("number")
                if not raw_number and not row["term"] and not seen_number:
                    if previous and previous_page == page.page_number - 1 and any(row.values()):
                        for field in ("def", "ex"):
                            if row[field]:
                                previous[field] = " ".join(filter(None, [previous[field], row[field]]))
                        continuations.append({"page": page.page_number, "unit": unit, "n": previous["n"]})
                    elif any(row.values()):
                        issues.append(Issue(page.page_number, unit, None, "unattached continuation"))
                    continue
                if not raw_number.isdecimal():
                    if any(row.values()) and not is_header(row):
                        issues.append(Issue(page.page_number, unit, None, "unreadable row number"))
                    continue

                number = int(raw_number)
                # The book can repeat a number and then skip the next. Recover the
                # intervening number only when both adjacent printed rows confirm it.
                next_number = next(
                    (int(item["number"]) for item in rows[index + 1:] if item["number"].isdecimal()),
                    None,
                )
                if previous and number == previous["n"] and next_number == number + 2:
                    number += 1
                    corrections.append({
                        "page": page.page_number, "unit": unit, "printed": int(raw_number), "n": number,
                    })
                if previous is None or (number == 1 and previous["n"] - number >= 20):
                    unit += 1
                elif number <= previous["n"]:
                    issues.append(Issue(page.page_number, unit, number, "duplicate or out-of-order number"))
                    continue
                entry = {"unit": unit, "n": number, "term": row["term"], "def": row["def"], "ex": row["ex"]}
                entries.append(entry)
                source_pages[(unit, number)] = page.page_number
                previous = entry
                previous_page = page.page_number
                seen_number = True
            page.close()

    unit_counts = Counter(entry["unit"] for entry in entries)
    keys = {(entry["unit"], entry["n"]) for entry in entries}
    if len(unit_counts) != UNIT_COUNT:
        issues.append(Issue(0, 0, None, f"expected {UNIT_COUNT} units, found {len(unit_counts)}"))
    for unit in range(1, UNIT_COUNT + 1):
        for number in range(1, UNIT_SIZE + 1):
            if (unit, number) not in keys:
                issues.append(Issue(0, unit, number, "number not extracted"))
    for entry in entries:
        page = source_pages[(entry["unit"], entry["n"])]
        for field in ("term", "def", "ex"):
            if not entry[field]:
                issues.append(Issue(page, entry["unit"], entry["n"], f"{field} is empty"))
            elif "\ufffd" in entry[field] or "(cid:" in entry[field]:
                issues.append(Issue(page, entry["unit"], entry["n"], f"{field} contains an undecoded glyph"))

    return entries, {
        "entries": len(entries),
        "unit_counts": dict(sorted(unit_counts.items())),
        "continuations": continuations,
        "numbering_corrections": corrections,
        "issues": [asdict(issue) for issue in issues],
    }


def write_json(path, contents):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(contents, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("source/vocab.pdf"))
    parser.add_argument("--output", type=Path, default=Path("work/vocab-extracted.json"))
    parser.add_argument("--report", type=Path, default=Path("work/vocab-parse-report.json"))
    args = parser.parse_args()
    entries, report = parse_document(args.source)
    write_json(args.output, entries)
    write_json(args.report, report)
    print(f'{len(entries)} entries, {len(report["unit_counts"])} units, {len(report["issues"])} issues.')


if __name__ == "__main__":
    main()
