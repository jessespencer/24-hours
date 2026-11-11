"""Generate maps/activity_map.csv from the 2003-2025 multi-year lexicon.

Run once (or after a new lexicon release); the CSV is the reviewed source of
truth that build.py reads. Hand-edit the CSV freely; re-running this script
overwrites it.

    python make_activity_map.py ../data/docs/lexicon.txt ../data/raw/atusact-0325/atusact_0325.dat
"""

import csv
import re
import sys
from pathlib import Path

import duckdb

# First matching prefix wins. Order matters: 0101 before 01, 1201 before 12.
RULES: list[tuple[str, str]] = [
    # BLS publishes personal mail and e-mail with telephone calls, not household.
    ("020903", "socializing"),
    ("020904", "socializing"),
    ("0101", "sleep"),
    ("01", "personal_care"),
    ("11", "eating"),
    ("05", "work"),
    ("06", "education"),
    ("02", "household"),
    ("03", "caring"),
    ("04", "caring"),
    ("07", "shopping"),
    ("08", "shopping"),
    ("09", "shopping"),
    ("10", "shopping"),
    ("1201", "socializing"),
    ("1202", "socializing"),
    ("14", "socializing"),
    ("15", "socializing"),
    ("16", "socializing"),
    ("12", "leisure"),
    ("13", "sports"),
    ("18", "travel"),
    ("50", "unknown"),
]

TIER1 = {
    "01": "Personal care",
    "02": "Household activities",
    "03": "Caring for household members",
    "04": "Caring for nonhousehold members",
    "05": "Work and work-related",
    "06": "Education",
    "07": "Consumer purchases",
    "08": "Professional and personal care services",
    "09": "Household services",
    "10": "Government services and civic obligations",
    "11": "Eating and drinking",
    "12": "Socializing, relaxing, and leisure",
    "13": "Sports, exercise, and recreation",
    "14": "Religious and spiritual",
    "15": "Volunteer activities",
    "16": "Telephone calls",
    "18": "Traveling",
    "50": "Data codes",
}


def category_for(code: str) -> tuple[str, str]:
    for prefix, cat in RULES:
        if code.startswith(prefix):
            return cat, prefix
    raise ValueError(f"no rule for {code}")


def main(lexicon_txt: str, activity_dat: str) -> None:
    lex: dict[str, str] = {}
    for line in Path(lexicon_txt).read_text().splitlines():
        m = re.match(r"^(\d{6})\s+(.+?)\s*$", line)
        if m and m.group(1) not in lex:
            desc = re.sub(r"\s+", " ", m.group(2)).replace("Sleepl essness", "Sleeplessness").replace("Househol d", "Household")
            lex[m.group(1)] = desc

    used = {
        r[0]
        for r in duckdb.sql(
            f"select distinct TRCODEP from read_csv('{activity_dat}', types={{'TRCODEP':'VARCHAR'}})"
        ).fetchall()
    }
    codes = sorted(set(lex) | used)
    out = Path(__file__).parent / "maps" / "activity_map.csv"
    out.parent.mkdir(exist_ok=True)
    with out.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["code", "description", "tier1", "category", "rule_prefix", "in_data"])
        for code in codes:
            cat, prefix = category_for(code)
            w.writerow([code, lex.get(code, "(not in lexicon)"), TIER1.get(code[:2], "?"), cat, prefix, int(code in used)])
    missing = sorted(used - set(lex))
    print(f"wrote {out}: {len(codes)} codes, {len(used)} used in data, {len(missing)} used but not in lexicon: {missing}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
