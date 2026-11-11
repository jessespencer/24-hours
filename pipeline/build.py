"""ATUS 2003-2025 multi-year microdata -> compact Parquet + precomputed slices.

    python build.py            # reads ../data/raw, writes ../app/public/data

Outputs
  respondents.parquet  one row per respondent: shuffled id, year, final weight,
                       coarse demographics only (no dates, geography, raw age)
  episodes.parquet     each diary as run-length-encoded minutes 0..1440
                       (0 = 4:00 a.m.), one row per run of identical
                       (activity category, location group, companion group)
  slices.json          weighted shares per 10-minute bin for common slices
  meta.json            category orders, filter values, sample sizes, build info
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
MAPS = Path(__file__).resolve().parent / "maps"
OUT = ROOT / "app" / "public" / "data"

LATEST_YEAR = 2025
DEFAULT_YEARS = (2023, 2025)
MIN_N = 100  # unweighted respondents; below this a slice is suppressed
BIN = 10
NBINS = 1440 // BIN

ACT_ORDER = [
    "sleep", "personal_care", "eating", "household", "caring", "shopping",
    "work", "education", "travel", "socializing", "leisure", "sports", "unknown",
]
WHERE_ORDER = [
    "home", "other_home", "workplace", "stores", "other_place", "outdoors",
    "vehicle", "transit_walk", "not_recorded",
]
WHO_ORDER = ["alone", "partner", "own_kids", "family", "friends", "coworkers", "others", "not_recorded"]

# Filter dimensions. Each value maps to a SQL predicate on respondents.
FILTERS: dict[str, dict[str, str]] = {
    "sex": {"m": "sex = 1", "f": "sex = 2"},
    "age": {
        "15-24": "age_band = 0", "25-34": "age_band = 1", "35-44": "age_band = 2",
        "45-54": "age_band = 3", "55-64": "age_band = 4", "65+": "age_band = 5",
    },
    "emp": {
        "employed": "emp in (1, 2)", "ft": "emp = 1", "pt": "emp = 2",
        "unemp": "emp = 3", "nilf": "emp = 4",
    },
    "kids": {
        "none": "kids = 0", "any": "kids > 0", "u6": "kids = 1",
        "6-12": "kids = 2", "13-17": "kids = 3",
    },
    "day": {"weekday": "day = 0", "weekend": "day = 1", "holiday": "day = 2"},
}
DIMS = list(FILTERS)


def path(p: Path) -> str:
    return str(p).replace("'", "''")


def load(con: duckdb.DuckDBPyConnection) -> None:
    t0 = time.time()
    for name in ["activity_map", "where_map", "who_map"]:
        con.execute(f"create table {name} as select * from read_csv('{path(MAPS / (name + '.csv'))}', all_varchar=true)")

    con.execute(f"""
        create table resp as
        select TUCASEID as caseid, TUYEAR as year,
               -- Weight choice (see README): 2020 has only the pandemic-method
               -- weight TU20FWGT; every other year uses the standard TUFNWGTP.
               case when TUYEAR = 2020 then TU20FWGT else TUFNWGTP end as w,
               TELFS, TRDPFTPT, TRCHILDNUM, TRYHHCHILD, TRHOLIDAY, TUDIARYDAY
        from read_csv('{path(RAW / 'atusresp-0325/atusresp_0325.dat')}')
    """)
    con.execute(f"""
        create table rost1 as
        select TUCASEID as caseid, TEAGE as age, TESEX as sex
        from read_csv('{path(RAW / 'atusrost-0325/atusrost_0325.dat')}') where TULINENO = 1
    """)
    con.execute(f"""
        create table act as
        select TUCASEID as caseid, TUACTIVITY_N as n,
               TUCUMDUR24 - TUACTDUR24 as start, TUCUMDUR24 as stop,
               TRCODEP as code, TEWHERE as tewhere
        from read_csv('{path(RAW / 'atusact-0325/atusact_0325.dat')}', types={{'TRCODEP': 'VARCHAR'}})
    """)
    con.execute(f"""
        create table who as
        select TUCASEID as caseid, TUACTIVITY_N as n, TUWHO_CODE as code
        from read_csv('{path(RAW / 'atuswho-0325/atuswho_0325.dat')}')
    """)
    print(f"loaded raw in {time.time() - t0:.1f}s")


def check(con: duckdb.DuckDBPyConnection) -> None:
    """Hard checks: every diary is a complete 1,440-minute day, every code is mapped."""
    bad = con.execute("""
        select count(*) from (
          select caseid, sum(stop - start) s, min(start) a, max(stop) b,
                 sum(case when start <> prev_stop then 1 else 0 end) gaps
          from (select *, coalesce(lag(stop) over (partition by caseid order by n), 0) prev_stop from act)
          group by caseid) where s <> 1440 or a <> 0 or b <> 1440 or gaps > 0
    """).fetchone()[0]
    assert bad == 0, f"{bad} diaries do not tile 0..1440"
    unmapped = con.execute("select count(*) from act left join activity_map m using (code) where m.category is null").fetchone()[0]
    assert unmapped == 0, f"{unmapped} activity rows have no category"
    unmapped = con.execute("select count(distinct tewhere) from act where tewhere::varchar not in (select tewhere from where_map)").fetchone()[0]
    assert unmapped == 0, "unmapped TEWHERE values"
    unmapped = con.execute("select count(distinct code) from who where code::varchar not in (select tuwho_code from who_map)").fetchone()[0]
    assert unmapped == 0, "unmapped TUWHO_CODE values"
    bad_w = con.execute("select count(*) from resp where w is null or w <= 0").fetchone()[0]
    assert bad_w == 0, f"{bad_w} respondents without a positive weight"
    print("checks passed: all diaries tile 1,440 minutes; all codes mapped; all weights positive")


def enum_case(col: str, order: list[str]) -> str:
    return "case " + " ".join(f"when {col} = '{k}' then {i}" for i, k in enumerate(order)) + " end"


def transform(con: duckdb.DuckDBPyConnection) -> None:
    con.execute(f"""
        create table respondents as
        select row_number() over (order by hash(r.caseid::varchar || '24-hours'))::uinteger - 1 as rid,
               r.caseid, r.year::usmallint as year, r.w::float as w,
               l.sex::utinyint as sex,
               (case when l.age < 25 then 0 when l.age < 35 then 1 when l.age < 45 then 2
                     when l.age < 55 then 3 when l.age < 65 then 4 else 5 end)::utinyint as age_band,
               (case when r.TELFS in (1, 2) and r.TRDPFTPT = 1 then 1
                     when r.TELFS in (1, 2) then 2
                     when r.TELFS in (3, 4) then 3 else 4 end)::utinyint as emp,
               (case when r.TRCHILDNUM = 0 then 0 when r.TRYHHCHILD < 6 then 1
                     when r.TRYHHCHILD < 13 then 2 else 3 end)::utinyint as kids,
               (case when r.TRHOLIDAY = 1 then 2 when r.TUDIARYDAY in (1, 7) then 1 else 0 end)::utinyint as day
        from resp r join rost1 l using (caseid)
    """)
    n_resp = con.execute("select count(*) from resp").fetchone()[0]
    n = con.execute("select count(*) from respondents").fetchone()[0]
    assert n == n_resp, f"lost respondents joining roster: {n_resp} -> {n}"

    con.execute(f"""
        create table who_grp as
        select w.caseid, w.n, arg_min(m."group", m.priority::int) as grp
        from who w join who_map m on m.tuwho_code = w.code::varchar
        group by all
    """)
    con.execute(f"""
        create table ep_raw as
        select p.rid, a.n, a.start, a.stop,
               {enum_case('am.category', ACT_ORDER)} as act,
               {enum_case('wm."group"', WHERE_ORDER)} as loc,
               {enum_case("coalesce(wg.grp, 'not_recorded')", WHO_ORDER)} as who
        from act a
        join respondents p using (caseid)
        join activity_map am using (code)
        join where_map wm on wm.tewhere = a.tewhere::varchar
        left join who_grp wg on wg.caseid = a.caseid and wg.n = a.n
    """)
    # Run-length merge consecutive episodes that land in the same three buckets.
    con.execute("""
        create table episodes as
        with e as (
          select *, case when act = lag(act) over w and loc = lag(loc) over w and who = lag(who) over w
                         then 0 else 1 end as brk
          from ep_raw window w as (partition by rid order by n)),
        g as (select *, sum(brk) over (partition by rid order by n) as grp from e)
        select rid::uinteger as rid, min(start)::usmallint as start, max(stop)::usmallint as stop,
               any_value(act)::utinyint as act, any_value(loc)::utinyint as loc, any_value(who)::utinyint as who
        from g group by rid, grp order by rid, start
    """)
    raw, merged = con.execute("select (select count(*) from ep_raw), (select count(*) from episodes)").fetchone()
    print(f"episodes: {raw:,} raw -> {merged:,} merged runs")


def where_sql(sl: dict) -> str:
    preds = [f"year between {sl['y0']} and {sl['y1']}"]
    for d in DIMS:
        v = sl.get(d, "all")
        if v != "all":
            preds.append(FILTERS[d][v])
    return " and ".join(preds)


def slice_key(sl: dict) -> str:
    return f"{sl['y0']}-{sl['y1']}|" + "|".join(sl.get(d, "all") for d in DIMS)


# Weighted share of people in each category, per 10-minute bin. A difference
# array (+w at an episode's start minute, -w at its stop) gives the weighted
# number of people in each category at every minute; summing 10 minutes and
# dividing by 10 x total weight is the share. Same math as expanding every
# diary into 1,440 one-minute slots, without materializing 373M rows.
# The app runs this exact string in DuckDB-WASM (shipped in meta.json).
SHARES_SQL = """
with r as (select rid, w from respondents where {where}),
tot as (select sum(w) as sw from r),
e as (select e.{layer} as cat, e.start, e.stop, r.w from episodes e join r using (rid)),
d as (select cat, m, sum(dw) as dw from (
        select cat, start as m, w as dw from e union all select cat, stop as m, -w as dw from e)
      group by cat, m),
g as (select c.cat, t.m from (select distinct cat from d) c, range(0, 1440) t(m)),
cum as (select g.cat, g.m, sum(coalesce(d.dw, 0)) over (partition by g.cat order by g.m rows unbounded preceding) as active
        from g left join d using (cat, m))
select cat, m // {BIN} as bin, sum(active) / ({BIN} * (select sw from tot)) as share from cum group by cat, bin
"""


def shares(con: duckdb.DuckDBPyConnection, sl: dict) -> dict:
    where = where_sql(sl)
    n, sw = con.execute(f"select count(*), sum(w) from respondents where {where}").fetchone()
    out: dict = {"n": n, "suppressed": n < MIN_N}
    if n < MIN_N:
        return out
    for layer, order in [("act", ACT_ORDER), ("loc", WHERE_ORDER), ("who", WHO_ORDER)]:
        grid = [[0] * NBINS for _ in order]
        for cat, b, s in con.execute(SHARES_SQL.format(where=where, layer=layer, BIN=BIN)).fetchall():
            grid[cat][b] = round(s * 10000)  # basis points
        out[layer] = grid
    return out


def precompute(con: duckdb.DuckDBPyConnection) -> dict:
    y0, y1 = DEFAULT_YEARS
    base = {"y0": y0, "y1": y1}
    todo: list[dict] = [base]
    for d in DIMS:
        for v in FILTERS[d]:
            todo.append({**base, d: v})
    # Compare presets
    todo += [
        {**base, "emp": "employed", "kids": "u6", "day": "weekday"},
        {**base, "emp": "employed", "kids": "none", "day": "weekday"},
    ]
    # One slice per year for the Years view
    for y in range(2003, LATEST_YEAR + 1):
        todo.append({"y0": y, "y1": y})
    t0 = time.time()
    res = {}
    for sl in todo:
        res[slice_key(sl)] = shares(con, sl)
    print(f"precomputed {len(res)} slices in {time.time() - t0:.1f}s")
    return res


def write(con: duckdb.DuckDBPyConnection, slices: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    con.execute(f"""copy (select rid, year, w, sex, age_band, emp, kids, day from respondents order by rid)
                    to '{path(OUT / 'respondents.parquet')}' (format parquet, compression zstd)""")
    con.execute(f"""copy (select * from episodes order by rid, start)
                    to '{path(OUT / 'episodes.parquet')}' (format parquet, compression zstd, row_group_size 1000000)""")
    (OUT / "slices.json").write_text(json.dumps(slices, separators=(",", ":")))
    per_year = con.execute("select year, count(*) from respondents group by 1 order by 1").fetchall()
    meta = {
        "source": "BLS American Time Use Survey 2003-2025 multi-year microdata (released June 2026)",
        "built": time.strftime("%Y-%m-%d"),
        "latestYear": LATEST_YEAR,
        "defaultYears": list(DEFAULT_YEARS),
        "minN": MIN_N,
        "bin": BIN,
        "layers": {"act": ACT_ORDER, "loc": WHERE_ORDER, "who": WHO_ORDER},
        "filters": FILTERS,  # value -> SQL predicate; the app reuses these verbatim
        "sharesSql": SHARES_SQL,
        "nByYear": {str(y): c for y, c in per_year},
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1))
    for f in sorted(OUT.iterdir()):
        print(f"  {f.name:24s} {f.stat().st_size / 1e6:6.2f} MB")


def main() -> None:
    con = duckdb.connect()
    con.execute("set preserve_insertion_order = false")
    load(con)
    check(con)
    transform(con)
    slices = precompute(con)
    write(con, slices)


if __name__ == "__main__":
    sys.exit(main())
