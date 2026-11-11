# 24 Hours: how Americans actually spend their day

An interactive, static web app built from American Time Use Survey (ATUS)
microdata. It shows what people are doing, where, and with whom at every point of
the day, and lets you slice that by who they are.

- **The day:** about 1,000 resampled diaries shown as dots that move between activity blobs as a 24-hour clock runs. Blobs grow and shrink at the edge facing where people come from or go to. Play/pause, scrub, speed, a live share per blob, and a Flows toggle that fades the dots in transit.
- **Time ribbon:** stacked area of the weighted share of people in each category, in 10-minute bins. Hover for exact shares. This is the default view on phones.
- **Compare:** two slices side by side, a difference heat strip (A − B, in percentage points), and a minutes-per-person table for a chosen time window (whole day, morning, workday, evening, night). Presets are included.
- **Color by:** any view can be recolored by activity, location ("Where"), or company ("With whom").
- **Years:** a 2003–2025 scrubber that animates the average day, plus small multiples of hours per day by year. 2020 is flagged.
- **Filters:** year range, sex, age band, employment, presence and age of the youngest child, and weekday/weekend/holiday, written as a sentence of chips ("Everyone · aged 25–34 · on weekdays · 2023–2025"). Every chart shows its unweighted sample size.
- **Other:** light and dark themes, keyboard control (arrow keys scrub the day, Space plays), and a phone layout with folded filters and a thumb-reach play dock. All state lives in the URL.

## Run it

```bash
cd app && npm install && npm run dev
```

`npm run build` writes a static site to `app/dist/`, about 100 MB (mostly the
DuckDB-WASM binaries plus 20 MB of data). It works from any subpath.

## Rebuild the data

The pipeline reads the BLS files from `data/raw/`, which is gitignored. BLS
returns 403 to scripted downloads, so get the files from a browser. On the
[2003–2025 multi-year page](https://www.bls.gov/tus/data/datafiles-0325.htm),
download these five zips: Respondent, Roster, Activity, Who, and ATUS-CPS. Unzip
each one into `data/raw/<zip name>/`, for example
`data/raw/atusact-0325/atusact_0325.dat`. To regenerate the activity mapping,
also download the 2003–2025 Coding Lexicon PDF.

```bash
cd pipeline
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python build.py      # ~2 s → app/public/data/{respondents,episodes}.parquet, slices.json, meta.json
.venv/bin/python validate.py   # reproduces published BLS figures; exits 1 on any mismatch
```

`build.py` fails with an error if any diary doesn't cover exactly 1,440 minutes,
if any activity, location, or companion code is unmapped, or if any respondent
lacks a positive weight.

## Sources

U.S. Bureau of Labor Statistics, *American Time Use Survey, 2003–2025 multi-year
microdata files* (released June 2026). The data is a U.S. government work and is
in the public domain. The pipeline uses these files:

| File | Used for |
| --- | --- |
| Activity (`atusact`) | Episodes: pooled 6-digit code `TRCODEP`, start and stop (`TUCUMDUR24 − TUACTDUR24`, `TUCUMDUR24`), location `TEWHERE` |
| Who (`atuswho`) | Who was present (`TUWHO_CODE`) for each activity |
| Respondent (`atusresp`) | Final weights, labor force (`TELFS`, `TRDPFTPT`), children (`TRCHILDNUM`, `TRYHHCHILD`), diary day (`TUDIARYDAY`, `TRHOLIDAY`) |
| Roster (`atusrost`) | Respondent's age and sex (`TEAGE`, `TESEX`, line 1) |
| ATUS-CPS (`atuscps`) | Downloaded but not needed for the current filters. The roster's age and sex are the ATUS-updated values. Use this file to add race, education, or income filters. |

Activity codes are the **pooled** multi-year codes (`TRCODEP`) from the
2003–2025 lexicon, so code changes across years are already harmonized.

## Weights

Every estimate is weighted. The data dictionary (`TU20FWGT` and `TUFNWGTP`
entries) says:

| Years | Weight | Why |
| --- | --- | --- |
| 2003–2019, 2021–2025 | `TUFNWGTP` | The standard ATUS final weight. |
| 2020 | `TU20FWGT` | `TUFNWGTP` is missing for every 2020 case. BLS built `TU20FWGT` with a new method because collection was suspended from mid-March to mid-May 2020. |

`TU20FWGT` is also populated for most 2019 cases as a bridge to the new
method. This project uses `TUFNWGTP` for 2019, which matches BLS's published 2019
numbers. A share is `Σ wᵢ · minutesᵢ / (10 · Σ wᵢ)` per 10-minute bin.
Multi-year slices sum raw weights, so each year counts in proportion to its
weighted population. 2020 counts somewhat less because its weights cover only
part of the year.

## Validation

`pipeline/validate.py` recomputes 2025 annual averages from the raw microdata and
compares them with BLS's published [Table 1](https://www.bls.gov/news.release/atus.t01.htm)
(2025 annual averages, modified June 25, 2026). All 13 estimates match exactly
at the published precision:

| Estimate | Published | Ours (unrounded) | Match |
| --- | ---: | ---: | :---: |
| Sleeping | 9.03 h/day | 9.0327 | yes |
| Sleeping, men | 8.93 h/day | 8.9298 | yes |
| Sleeping, women | 9.13 h/day | 9.1308 | yes |
| Personal care activities (incl. travel) | 9.80 h/day | 9.8009 | yes |
| Eating and drinking (incl. travel) | 1.21 h/day | 1.2122 | yes |
| Household activities (incl. travel) | 1.99 h/day | 1.9926 | yes |
| Working and work-related (incl. travel) | 3.32 h/day | 3.3159 | yes |
| Working | 3.03 h/day | 3.0301 | yes |
| Working, men | 3.43 h/day | 3.4275 | yes |
| Working, women | 2.65 h/day | 2.6514 | yes |
| Working, % engaged | 39.6 % | 39.5960 | yes |
| Watching television | 2.61 h/day | 2.6105 | yes |
| Leisure and sports (incl. travel) | 5.16 h/day | 5.1607 | yes |

Household activities only matched after excluding personal mail and e-mail
(020903 and 020904). BLS counts those under "Telephone calls, mail, and e-mail",
so the category map files them under Socializing & community too.

Two internal checks back this up:

- **The browser computes the same numbers as the pipeline.** The app runs the
  pipeline's shares SQL in DuckDB-WASM. For two test slices and two layers each,
  the browser and the pipeline agreed to 0 basis points.
- **The bins add up.** Every 10-minute bin sums to 100% ± 0.03%, which is
  rounding.

## Category mapping

The mapping is in [`pipeline/maps/activity_map.csv`](pipeline/maps/activity_map.csv),
one row per 6-digit code with its lexicon description and the rule that placed
it. `make_activity_map.py` generates it from the lexicon and its prefix rules,
which are listed in order below. You can edit the CSV by hand. `build.py` reads
the CSV, not the rules.

| Category | ATUS codes |
| --- | --- |
| Sleep | 0101 (sleeping, sleeplessness) |
| Personal care | rest of 01 (grooming, health self-care, personal activities, emergencies) |
| Eating & drinking | 11 |
| Household | 02, except 020903 and 020904 |
| Caring for others | 03, 04 (household and nonhousehold members) |
| Shopping & errands | 07, 08, 09, 10 (purchases, professional and personal services, household services, government services) |
| Work | 05 (working, work-related, other income, job search) |
| Education | 06 |
| Travel | 18 (all travel, kept separate rather than folded into its purpose) |
| Socializing & community | 1201, 1202, 14 (religious), 15 (volunteering), 16 (telephone calls), 020903, 020904 (mail and e-mail) |
| Leisure & screens | rest of 12 (TV, games, computer, reading, relaxing, arts and entertainment) |
| Sports & exercise | 13 |
| Unrecorded | 50 (BLS data codes: insufficient detail, unable to recall, refused) |

**Where** ([`where_map.csv`](pipeline/maps/where_map.csv)) groups `TEWHERE` into
these places:

- Home
- Someone else's home
- Workplace
- Stores, restaurants, banks
- School, worship, gym, other
- Outdoors
- In a car (driver, passenger, or taxi)
- Walking, transit, plane
- Not asked

**With whom** ([`who_map.csv`](pipeline/maps/who_map.csv)): an activity can have
several people present, but a stacked chart needs one category per minute. Each
activity takes the highest-priority group present, in this order:

1. Own kids
2. Spouse or partner
3. Coworkers and customers
4. Friends
5. Other family
6. Others
7. Alone

Activities with no companion record are "Not asked".

## Suppression and privacy

- **Small slices are suppressed.** Any slice with fewer than 100 unweighted
  respondents shows a notice instead of a chart. In Compare, the difference view
  needs both slices to clear the threshold. In Years, a suppressed year drops out
  of the line. The threshold is `MIN_N` in `build.py` and is shipped to the app.
- **The shipped files hold no identifiers.** `respondents.parquet` contains a
  shuffled row id (not `TUCASEID`), year, weight, and coarse codes: sex, age
  band, employment, kids, and day type. It has no dates, geography, raw age,
  occupation, or income. `episodes.parquet` is each diary, run-length-encoded into
  12 activity × 9 location × 8 companion buckets. Both files are derived from
  BLS's public-use file.
- **The dots use resampled, anonymized diaries.** For the current slice, the
  browser draws 1,000 respondents in proportion to their weight
  (Efraimidis–Spirakis). It drops their ids, coarsens each diary to the state at
  the midpoint of every 10-minute bin, and shuffles the order. Each diary then
  switches within ±5 minutes of its bin edge, and dots swap diaries freely
  inside a blob, so no dot traces one person's day. A dot carries no
  demographic attributes, and the app never displays a single diary.

## How the 1,440-minute slots are implemented

Each diary is expanded logically into 1,440 one-minute slots starting at 4:00
a.m. Storing those slots for 258,954 respondents would take 373M rows, so the
pipeline doesn't materialize them. Instead:

- **Episodes are run-length encoded.** Each episode is a run of slots, and
  adjacent runs that fall in the same three buckets are merged. That brings
  4,994,172 episodes down to 4,678,761, or 18 MB of Parquet.
- **Shares come from a difference array.** Each run adds +w at its start minute
  and −w at its stop minute. A cumulative sum then gives the weighted number of
  people in each category at every minute. This is exactly the slot math, and it
  computes the full 2003–2025 population in about 0.5 s in the browser.

## Known caveats

- **2020** is a partial year (no interviews from mid-March to mid-May) with its
  own weight. Any view whose years include 2020 shows a ⚑ flag.
- **Companions during work before 2010.** ATUS didn't ask who was present during
  work activities (0501xx) until 2010. 98% of pre-2010 work time is "Not asked",
  so With-whom comparisons across 2010 aren't like-for-like. The UI flags this.
- **Location and companions are not collected** for sleep, grooming, and private
  personal activities. Those minutes show as "Not asked" in the Where and With
  whom views.
- **Only primary activities count.** Secondary activities aren't in these
  numbers: childcare while doing something else, TV on in the background,
  "eating while working".
- **Holiday slices are small**, about 120 respondents per year. Pool several
  years.
- **Coworker codes changed in 2010.** Code 55 was split into 59–62. All of them
  map to "Coworkers & customers".
- **Ages are top-coded** at 80 (2003–04) and 85 (2005+). Bands use 65+, so this
  doesn't matter here.
- **The dots are a sample.** Their cluster percentages carry roughly ±1.5 points
  of sampling noise. The ribbon strip under the dots shows the full weighted
  estimate.

## Layout

```
pipeline/   build.py, validate.py, make_activity_map.py, maps/*.csv
app/        Vite + TypeScript + D3 + DuckDB-WASM; public/data/ is generated by build.py
data/       raw BLS downloads and extracted docs (gitignored)
```
