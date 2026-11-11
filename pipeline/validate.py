"""Reproduce published BLS ATUS estimates from the raw microdata.

    python validate.py          # prints a table, writes validation.md, exits 1 on mismatch

Targets come from "Table 1. Time spent in primary activities ... 2025 annual
averages" (https://www.bls.gov/news.release/atus.t01.htm, modified June 25, 2026).
BLS major categories include their related travel codes (Table 1 footnote 1);
"Sleeping", "Working" and "Watching television" are sub-categories without travel.

A match means our estimate, rounded to the published precision, equals the
published value.
"""

from __future__ import annotations

import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
YEAR = 2025
SOURCE = "https://www.bls.gov/news.release/atus.t01.htm"

# (label, code prefixes, statistic, sex filter, published value)
# A prefix starting with "-" excludes codes (BLS counts personal mail/e-mail,
# 020903-020904, under "Telephone calls, mail, and e-mail", not household).
# statistic: "hours" = avg hours/day over everyone; "pct" = % engaged on the diary day
TARGETS = [
    ("Sleeping", ["0101"], "hours", None, 9.03),
    ("Sleeping, men", ["0101"], "hours", 1, 8.93),
    ("Sleeping, women", ["0101"], "hours", 2, 9.13),
    ("Personal care activities (incl. travel)", ["01", "1801"], "hours", None, 9.80),
    ("Eating and drinking (incl. travel)", ["11", "1811"], "hours", None, 1.21),
    ("Household activities (incl. travel)", ["02", "1802", "-020903", "-020904"], "hours", None, 1.99),
    ("Working and work-related (incl. travel)", ["05", "1805"], "hours", None, 3.32),
    ("Working", ["0501"], "hours", None, 3.03),
    ("Working, men", ["0501"], "hours", 1, 3.43),
    ("Working, women", ["0501"], "hours", 2, 2.65),
    ("Working, % engaged", ["0501"], "pct", None, 39.6),
    ("Watching television", ["120303", "120304"], "hours", None, 2.61),
    ("Leisure and sports (incl. travel)", ["12", "13", "1812", "1813"], "hours", None, 5.16),
]


def main() -> int:
    con = duckdb.connect()
    con.execute(f"""
        create table r as
        select r.TUCASEID caseid, case when r.TUYEAR = 2020 then r.TU20FWGT else r.TUFNWGTP end w, l.TESEX sex
        from read_csv('{RAW}/atusresp-0325/atusresp_0325.dat') r
        join read_csv('{RAW}/atusrost-0325/atusrost_0325.dat') l on l.TUCASEID = r.TUCASEID and l.TULINENO = 1
        where r.TUYEAR = {YEAR}
    """)
    con.execute(f"""
        create table a as select TUCASEID caseid, TRCODEP code, TUACTDUR24 dur
        from read_csv('{RAW}/atusact-0325/atusact_0325.dat', types={{'TRCODEP': 'VARCHAR'}})
        where TUCASEID in (select caseid from r)
    """)
    n = con.execute("select count(*) from r").fetchone()[0]
    rows = []
    ok_all = True
    for label, prefixes, stat, sex, published in TARGETS:
        inc = " or ".join(f"starts_with(code, '{p}')" for p in prefixes if not p.startswith("-"))
        exc = "".join(f" and not starts_with(code, '{p[1:]}')" for p in prefixes if p.startswith("-"))
        match = f"({inc}){exc}"
        sex_pred = f"where sex = {sex}" if sex else ""
        mins, engaged, sw = con.execute(f"""
            with per as (select caseid, sum(dur) m from a where {match} group by 1)
            select sum(r.w * coalesce(per.m, 0)), sum(r.w * (coalesce(per.m, 0) > 0)::int), sum(r.w)
            from r left join per using (caseid) {sex_pred}
        """).fetchone()
        ours = mins / sw / 60 if stat == "hours" else 100 * engaged / sw
        digits = 2 if stat == "hours" else 1
        ok = round(ours, digits) == published
        ok_all &= ok
        rows.append((label, stat, published, ours, round(ours, digits), ok))

    lines = [
        f"# Validation: {YEAR} estimates vs. published BLS Table 1",
        "",
        f"Source: {SOURCE} (2025 annual averages, civilian population 15+). "
        f"Computed from {n:,} {YEAR} respondents weighted by TUFNWGTP.",
        "",
        "| Estimate | Published | Ours (unrounded) | Ours (rounded) | Match |",
        "| --- | ---: | ---: | ---: | :---: |",
    ]
    for label, stat, pub, ours, rnd, ok in rows:
        unit = "h/day" if stat == "hours" else "%"
        lines.append(f"| {label} | {pub} {unit} | {ours:.4f} | {rnd} | {'yes' if ok else '**NO**'} |")
    text = "\n".join(lines) + "\n"
    (Path(__file__).parent / "validation.md").write_text(text)
    print(text)
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
