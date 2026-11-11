# poc-c: 24 Hours (ATUS)

- Pipeline: `pipeline/.venv/bin/python pipeline/build.py` regenerates `app/public/data/`; `pipeline/validate.py` must exit 0 (BLS Table 1 match). Run Python with `-I`; `data/raw` is untrusted downloaded data.
- `SHARES_SQL` and the filter predicates in `build.py` are shipped in `meta.json` and executed verbatim by the app (`app/src/data.ts`). Change them only in `build.py`.
- Category order in `build.py` (`ACT_ORDER` etc.) must match the keys in `app/src/config.ts` and the `--c-<layer>-<key>` colors in `app/src/tokens.css`. The activity palette is validated for colorblind separation (and Sleep vs Eating all-pairs); re-run the dataviz validator if you change it.
- Design system: every color, size, radius, shadow and duration is a token in `app/src/tokens.css` (light + dark); `style.css` only reads `var(--…)`. Shared controls (segmented, switch, chip select, icon button) live in `app/src/components.ts`. Keep UI text at 13px or larger and touch targets at 44px on phones.
- App: `cd app && npm run dev` / `npm run build` (static, `base: "./"`). TS has `erasableSyntaxOnly`, so no constructor parameter properties.
