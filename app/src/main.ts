import "./style.css";
import { renderDiff, renderWindowTable } from "./compare";
import { CATEGORY_LABELS, LAYER_LABELS, clockLabel, fmtInt, type Layer, type SliceResult } from "./config";
import { Data } from "./data";
import { Dots } from "./dots";
import { Ribbon } from "./ribbon";
import { Store, type AppState, type Slice, type Theme, type View } from "./state";
import { describeSlice, filterRow, h, legend, sampleBadge, suppressedNotice, tooltip } from "./ui";
import { renderYearPanels } from "./years";

const data = new Data();
await data.loadStatic();
const meta = data.meta;
if (import.meta.env.DEV) Object.assign(window, { __data: data });
const [dy0, dy1] = meta.defaultYears;
const all: Slice = { y0: dy0, y1: dy1, sex: "all", age: "all", emp: "all", kids: "all", day: "all" };

const store = new Store({
  view: innerWidth < 700 ? "ribbon" : "day",
  layer: "act",
  a: all,
  b: { ...all, emp: "employed", kids: "none", day: "weekday" },
  t: 0,
  speed: 1,
  playing: false,
  flows: true,
  year: meta.latestYear,
  win: "evening",
  theme: "auto",
});

const PRESETS: { label: string; a: Partial<Slice>; b: Partial<Slice> }[] = [
  { label: "Employed parents of kids under 6 vs. employed, no kids (weekdays)", a: { emp: "employed", kids: "u6", day: "weekday" }, b: { emp: "employed", kids: "none", day: "weekday" } },
  { label: "Weekdays vs. weekends", a: { day: "weekday" }, b: { day: "weekend" } },
  { label: `2005 vs. ${meta.latestYear}`, a: { y0: 2005, y1: 2005 }, b: { y0: meta.latestYear, y1: meta.latestYear } },
  { label: "Women vs. men", a: { sex: "f" }, b: { sex: "m" } },
  { label: "Ages 65+ vs. 25–34", a: { age: "65+" }, b: { age: "25-34" } },
];

// ---------- shell ----------
const app = document.querySelector<HTMLDivElement>("#app")!;
const themeBtn = h("button", { class: "ghost", "aria-label": "Theme" });
const tabs = h("div", { class: "seg views", role: "tablist", "aria-label": "View" });
const layerSeg = h("div", { class: "seg", role: "tablist", "aria-label": "Color by" });
const filtersEl = h("section", { class: "filter-area" });
const viewEl = h("main", { id: "view" });
const status = h("span", { class: "engine" });

const VIEWS: [View, string][] = [["day", "The day"], ["ribbon", "Time ribbon"], ["compare", "Compare"], ["years", "Years"]];
for (const [v, label] of VIEWS) {
  const b = h("button", { role: "tab", "data-v": v }, label);
  b.addEventListener("click", () => store.set({ view: v }));
  tabs.append(b);
}
for (const l of ["act", "loc", "who"] as Layer[]) {
  const b = h("button", { role: "tab", "data-l": l }, LAYER_LABELS[l]);
  b.addEventListener("click", () => store.set({ layer: l }));
  layerSeg.append(b);
}
themeBtn.addEventListener("click", () => {
  const order: Theme[] = ["auto", "light", "dark"];
  store.set({ theme: order[(order.indexOf(store.state.theme) + 1) % 3] });
});

app.append(
  h("header", {},
    h("div", { class: "title" },
      h("h1", {}, "24 Hours"),
      h("p", { class: "dek" }, "How Americans actually spend their day: what they're doing, where, and with whom, minute by minute. Weighted estimates from the American Time Use Survey, 2003–" + meta.latestYear + ".")),
    h("div", { class: "header-tools" }, status, themeBtn)),
  h("nav", {}, tabs, h("div", { class: "layer-pick" }, h("span", { class: "muted" }, "Color by"), layerSeg)),
  filtersEl,
  viewEl,
  footer(),
);

function footer(): HTMLElement {
  const f = h("footer");
  f.innerHTML = `<p><strong>Source:</strong> U.S. Bureau of Labor Statistics, American Time Use Survey 2003–${meta.latestYear} multi-year microdata (public domain). Estimates are weighted with the ATUS final weight (TUFNWGTP; TU20FWGT for 2020) and cover the civilian noninstitutional population age 15+. The diary day runs 4 a.m. to 4 a.m.</p>
  <p><strong>⚑ 2020:</strong> BLS suspended data collection from mid-March to mid-May 2020; 2020 figures cover the rest of the year only. Slices with fewer than ${meta.minN} respondents are suppressed. The dot animation shows ~1,000 diaries resampled in proportion to survey weight, coarsened to 10-minute steps, with no identifiers.</p>`;
  return f;
}

function applyTheme(t: Theme) {
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  themeBtn.textContent = t === "auto" ? "◐ Auto" : t === "light" ? "☀ Light" : "☾ Dark";
}

function syncNav(s: AppState) {
  tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.v === s.view)));
  layerSeg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.l === s.layer)));
}

function ensureEngine() {
  if (data.engineReady) return;
  data.startEngine((msg) => {
    status.textContent = msg;
  }).catch((e) => {
    status.textContent = "DuckDB failed to load";
    console.error(e);
  });
}

// ---------- filters ----------
let filtersOpen = innerWidth >= 700; // on phones the ribbon comes first; filters fold away
function renderFilters(s: AppState) {
  const details = h("details", {}, h("summary", {}, s.view === "compare" ? "Filters: A vs. B" : `Filters · ${describeSlice(s.a)}`));
  details.open = filtersOpen;
  details.addEventListener("toggle", () => (filtersOpen = details.open));
  filtersEl.replaceChildren(details);
  const box = h("div", { class: "filter-body" });
  details.append(box);
  const years = s.view !== "years";
  if (s.view === "compare") {
    const preset = h("select", { "aria-label": "Preset comparisons" }, h("option", { value: "" }, "Try a comparison…"));
    PRESETS.forEach((p, i) => preset.append(h("option", { value: String(i) }, p.label)));
    preset.addEventListener("change", () => {
      const p = PRESETS[+preset.value];
      if (p) store.set({ a: { ...all, ...p.a }, b: { ...all, ...p.b } });
    });
    box.append(
      h("label", { class: "field preset" }, h("span", {}, "Preset"), preset),
      filterRow(meta, s.a, "A", (a) => store.set({ a })),
      filterRow(meta, s.b, "B", (b) => store.set({ b })),
    );
  } else {
    box.append(filterRow(meta, s.a, null, (a) => store.set({ a }), { years }));
    if (!years) box.append(h("p", { class: "muted small" }, "The Years view uses every filter except the year range."));
  }
}

// ---------- views ----------
let gen = 0; // discard stale async renders
let dots: Dots | null = null;
let dayRibbon: Ribbon | null = null;
let dotStates: Record<Layer, Uint8Array[]> | null = null;
let playTimer = 0;

function chartHead(title: string, s: Slice, n: number | null) {
  const badge = sampleBadge(meta, s, n);
  // ATUS did not ask who was present during work activities (0501xx) until 2010.
  if (store.state.layer === "who" && (s.y0 < 2010 || store.state.view === "years"))
    badge.append(h("span", { class: "flag", title: "Before 2010, ATUS did not ask who was present during work, so work time shows as 'Not asked' in those years." }, "⚑ Pre-2010: company not asked during work"));
  return h("div", { class: "chart-head" }, h("h2", {}, title), h("p", { class: "slice-desc" }, describeSlice(s)), badge);
}

async function getShares(s: Slice, layer: Layer): Promise<SliceResult> {
  if (!data.hasPrecomputed(s)) ensureEngine();
  return data.shares(s, layer);
}

async function renderRibbonView(s: AppState, my: number) {
  const head = h("div");
  const body = h("div", { class: "card" });
  const leg = h("div");
  const holder = h("div", { class: "ribbon-holder" });
  body.append(head, leg, holder);
  viewEl.replaceChildren(body);
  head.append(chartHead(`Share of people by ${s.layer === "act" ? "activity" : s.layer === "loc" ? "location" : "company"}, by time of day`, s.a, null));
  const ribbon = new Ribbon(holder, { height: innerWidth < 600 ? 300 : 400 });
  leg.append(legend(s.layer, (c) => ribbon.highlight(c)));
  holder.classList.add("loading");
  const res = await getShares(s.a, s.layer);
  if (my !== gen) return;
  holder.classList.remove("loading");
  head.replaceChildren(chartHead(`Share of people by ${s.layer === "act" ? "activity" : s.layer === "loc" ? "location" : "company"}, by time of day`, s.a, res.n));
  if (res.suppressed) return holder.replaceChildren(suppressedNotice(meta, res.n));
  ribbon.update(res[s.layer]!, s.layer, false);
}

function clockBar(s: AppState): HTMLElement {
  const play = h("button", { class: "primary", "aria-label": "Play or pause" }, s.playing ? "❚❚ Pause" : "▶ Play");
  play.addEventListener("click", () => store.set({ playing: !store.state.playing }));
  const slider = h("input", { type: "range", min: "0", max: "1439", step: "1", value: String(Math.round(s.t)), "aria-label": "Time of day" });
  slider.addEventListener("input", () => store.set({ t: +slider.value, playing: false }));
  const speed = h("select", { "aria-label": "Speed" });
  for (const v of [0.5, 1, 2, 4]) {
    const o = h("option", { value: String(v) }, `${v}×`);
    if (v === s.speed) o.selected = true;
    speed.append(o);
  }
  speed.addEventListener("change", () => store.set({ speed: +speed.value }));
  const label = h("span", { class: "clock" }, clockLabel(s.t));
  const flows = h("input", { type: "checkbox" });
  flows.checked = s.flows;
  flows.addEventListener("change", () => store.set({ flows: flows.checked }));
  return h("div", { class: "clockbar" }, play, label, slider,
    h("label", { class: "field inline" }, h("span", {}, "Speed"), speed),
    h("label", { class: "field inline", title: "Show people travelling between activities" }, flows, h("span", {}, "Flows")));
}

async function renderDayView(s: AppState, my: number) {
  const head = h("div");
  const card = h("div", { class: "card" });
  const stage = h("div", { class: "dots-holder" });
  const mini = h("div", { class: "mini-ribbon" });
  card.append(head, clockBar(s), stage, h("p", { class: "muted small" }, "Each dot is one survey diary, resampled in proportion to its weight. The strip below is the full weighted estimate; the line marks the current time."), mini);
  viewEl.replaceChildren(card);
  head.append(chartHead("The day, animated", s.a, null));
  dots = new Dots(stage);
  dots.setFlows(s.flows);
  if (import.meta.env.DEV) Object.assign(window, { __dots: dots });
  dots.setMinute(s.t);
  dots.start();
  dayRibbon = new Ribbon(mini, { height: 130, onHover: (m) => m !== null && store.set({ t: m, playing: false }) });
  dayRibbon.setTime(s.t);

  const [res, sample] = await Promise.all([getShares(s.a, s.layer), (ensureEngine(), data.sampleDiaries(s.a))]);
  if (my !== gen) return;
  head.replaceChildren(chartHead("The day, animated", s.a, res.n));
  if (res.suppressed || !sample || sample.n < meta.minN) {
    stage.replaceChildren(suppressedNotice(meta, res.n));
    dots.stop();
    return;
  }
  dotStates = sample.states;
  dots.setLayer(s.layer, dotStates[s.layer]);
  dots.setMinute(store.state.t);
  dayRibbon.update(res[s.layer]!, s.layer, false);
  dayRibbon.setTime(store.state.t);
  stage.setAttribute("aria-label", `${dotStates.act.length} resampled diaries colored by ${LAYER_LABELS[s.layer]}`);
}

async function renderCompareView(s: AppState, my: number) {
  const card = h("div", { class: "card" });
  const pair = h("div", { class: "pair" });
  const colA = h("div"), colB = h("div");
  pair.append(colA, colB);
  const diffHead = h("div", { class: "chart-head" }, h("h2", {}, "Difference, A − B"), h("p", { class: "slice-desc" }, "Percentage-point gap in the share of people in each category, every 10 minutes."));
  const diffEl = h("div", { class: "diff-holder" });
  const tableEl = h("div", { class: "window-table" });
  card.append(legend(s.layer), pair);
  viewEl.replaceChildren(card, h("div", { class: "card" }, diffHead, diffEl), h("div", { class: "card" }, h("div", { class: "chart-head" }, h("h2", {}, "Where the time goes")), tableEl));
  const ribbons: Ribbon[] = [];
  const sync = (m: number | null) => ribbons.forEach((r) => r.setTime(m));
  const mk = (col: HTMLElement, tag: string, sl: Slice) => {
    const head = h("div", {}, chartHead(tag, sl, null));
    const holder = h("div", { class: "ribbon-holder loading" });
    col.append(head, holder);
    const r = new Ribbon(holder, { height: innerWidth < 600 ? 240 : 300, onHover: sync });
    ribbons.push(r);
    return { head, holder, r };
  };
  const A = mk(colA, "A", s.a), B = mk(colB, "B", s.b);
  const [ra, rb] = await Promise.all([getShares(s.a, s.layer), getShares(s.b, s.layer)]);
  if (my !== gen) return;
  for (const [X, res, sl, tag] of [[A, ra, s.a, "A"], [B, rb, s.b, "B"]] as const) {
    X.holder.classList.remove("loading");
    X.head.replaceChildren(chartHead(tag, sl, res.n));
    if (res.suppressed) X.holder.replaceChildren(suppressedNotice(meta, res.n));
    else X.r.update(res[s.layer]!, s.layer, false);
  }
  if (ra.suppressed || rb.suppressed) {
    diffEl.replaceChildren(h("p", { class: "muted" }, "The difference view needs both slices to meet the sample-size minimum."));
    return;
  }
  renderDiff(diffEl, ra[s.layer]!, rb[s.layer]!, s.layer, sync);
  renderWindowTable(tableEl, ra[s.layer]!, rb[s.layer]!, s.layer, s.win, (win) => store.set({ win }));
}

async function renderYearsView(s: AppState, my: number) {
  const card = h("div", { class: "card" });
  const head = h("div");
  const play = h("button", { class: "primary" }, "▶ Play years");
  const slider = h("input", { type: "range", min: "2003", max: String(meta.latestYear), step: "1", value: String(s.year), "aria-label": "Year" });
  const yearLabel = h("span", { class: "clock" }, String(s.year));
  const holder = h("div", { class: "ribbon-holder loading" });
  const panels = h("div");
  card.append(head, h("div", { class: "clockbar" }, play, yearLabel, slider), legend(s.layer), holder);
  viewEl.replaceChildren(card, h("div", { class: "card" }, h("div", { class: "chart-head" }, h("h2", {}, "Average hours per day, 2003–" + meta.latestYear), h("p", { class: "slice-desc" }, `Each panel has its own scale. Dashed line: 2020 (collection suspended Mar–May). Dot: selected year. Click a panel to jump to a year.`)), panels));
  const ribbon = new Ribbon(holder, { height: innerWidth < 600 ? 280 : 360 });

  const byYear = await (async () => {
    if (!DIMS_DEFAULT(s.a)) ensureEngine();
    return data.byYear(s.a, s.layer);
  })();
  if (my !== gen) return;
  holder.classList.remove("loading");

  const showYear = (y: number, animate: boolean) => {
    const res = byYear.get(y)!;
    yearLabel.textContent = String(y);
    slider.value = String(y);
    head.replaceChildren(chartHead(`The average day in ${y}`, { ...s.a, y0: y, y1: y }, res.n));
    if (res.suppressed) holder.replaceChildren(suppressedNotice(meta, res.n));
    else {
      if (!holder.querySelector("svg")) holder.replaceChildren();
      ribbon.update(res[s.layer]!, s.layer, animate);
    }
    renderYearPanels(panels, byYear, s.layer, y, (yy) => store.set({ year: yy }));
  };
  showYear(s.year, false);
  slider.addEventListener("input", () => store.set({ year: +slider.value }));
  let timer = 0;
  play.addEventListener("click", () => {
    if (timer) {
      clearInterval(timer);
      timer = 0;
      play.textContent = "▶ Play years";
      return;
    }
    play.textContent = "❚❚ Pause";
    if (store.state.year >= meta.latestYear) store.set({ year: 2003 });
    timer = window.setInterval(() => {
      if (gen !== my || store.state.year >= meta.latestYear) {
        clearInterval(timer);
        timer = 0;
        play.textContent = "▶ Play years";
        return;
      }
      store.set({ year: store.state.year + 1 });
    }, 900);
  });
  yearsHook = (y) => showYear(y, true);
}
let yearsHook: ((y: number) => void) | null = null;

const DIMS_DEFAULT = (sl: Slice) => sl.sex === "all" && sl.age === "all" && sl.emp === "all" && sl.kids === "all" && sl.day === "all";

function renderView(s: AppState) {
  const my = ++gen;
  dots?.stop();
  dots = null;
  dayRibbon = null;
  yearsHook = null;
  tooltip.hide();
  const run = { day: renderDayView, ribbon: renderRibbonView, compare: renderCompareView, years: renderYearsView }[s.view] ?? renderRibbonView;
  run(s, my).catch((e) => {
    console.error(e);
    viewEl.append(h("p", { class: "suppressed" }, `Something went wrong: ${e?.message ?? e}`));
  });
}

// ---------- animation clock ----------
function setPlaying(on: boolean) {
  cancelAnimationFrame(playTimer);
  if (!on) return;
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(100, now - last);
    last = now;
    // 1× = 15 minutes of diary time per second: a full day in ~96 s.
    const t = (store.state.t + (dt / 1000) * 15 * store.state.speed) % 1440;
    store.set({ t });
    playTimer = requestAnimationFrame(tick);
  };
  playTimer = requestAnimationFrame(tick);
}

function onTime(t: number) {
  dots?.setMinute(t);
  dayRibbon?.setTime(t);
  const clock = viewEl.querySelector<HTMLElement>(".clockbar .clock");
  const slider = viewEl.querySelector<HTMLInputElement>(".clockbar input[type=range]");
  if (store.state.view === "day") {
    if (clock) clock.textContent = clockLabel(t);
    if (slider && document.activeElement !== slider) slider.value = String(Math.round(t));
  }
}

store.on((s, changed) => {
  if (changed.has("theme")) applyTheme(s.theme);
  syncNav(s);
  const structural = ["view", "layer", "a", "b", "win", "theme"].some((k) => changed.has(k as keyof AppState));
  if (structural) {
    if (changed.has("view") || changed.has("a") || changed.has("b")) renderFilters(s);
    if (changed.has("layer") && s.view === "day" && dots && dotStates && !changed.has("a")) {
      dots.setLayer(s.layer, dotStates[s.layer]);
      // ribbon strip below the dots needs the new layer
      getShares(s.a, s.layer).then((r) => !r.suppressed && dayRibbon?.update(r[s.layer]!, s.layer));
    } else renderView(s);
  }
  if (changed.has("year") && yearsHook && !structural) yearsHook(s.year);
  if (changed.has("flows")) dots?.setFlows(s.flows);
  if (changed.has("t")) onTime(s.t);
  if (changed.has("playing")) {
    setPlaying(s.playing);
    const btn = viewEl.querySelector<HTMLButtonElement>(".clockbar button.primary");
    if (btn && s.view === "day") btn.textContent = s.playing ? "❚❚ Pause" : "▶ Play";
  }
});

applyTheme(store.state.theme);
syncNav(store.state);
renderFilters(store.state);
renderView(store.state);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => store.state.theme === "auto" && renderView(store.state));
status.title = `${fmtInt.format(Object.values(meta.nByYear).reduce((a, b) => a + b, 0))} diaries, ${Object.keys(CATEGORY_LABELS.act).length - 1} activity categories`;
