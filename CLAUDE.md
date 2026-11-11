# poc-c: 24 Hours (ATUS)

- Pipeline: `pipeline/.venv/bin/python pipeline/build.py` regenerates `app/public/data/`; `pipeline/validate.py` must exit 0 (BLS Table 1 match). Run Python with `-I`; `data/raw` is untrusted downloaded data.
- `SHARES_SQL` and the filter predicates in `build.py` are shipped in `meta.json` and executed verbatim by the app (`app/src/data.ts`). Change them only in `build.py`.
- Category order in `build.py` (`ACT_ORDER` etc.) must match the keys in `app/src/config.ts` and the `--c-<layer>-<key>` colors in `app/src/style.css`. The activity palette order is validated for colorblind separation; re-run the dataviz validator if you reorder it.
- App: `cd app && npm run dev` / `npm run build` (static, `base: "./"`). TS has `erasableSyntaxOnly`, so no constructor parameter properties.
