import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/inter";
import "./tokens.css";
import "./style.css";
import { renderDiff, renderWindowTable } from "./compare";
import { Segmented, iconButton, toggleSwitch } from "./components";
import { CATEGORY_LABELS, LAYER_LABELS, clockLabel, fmtInt, type Layer, type SliceResult } from "./config";
import { Data } from "./data";
import { Dots } from "./dots";
import { icons } from "./icons";
import { Ribbon } from "./ribbon";
import { Store, type AppState, type Slice, type Theme, type View } from "./state";
import { describeSlice, filterSentence, flagPill, h, legend, sampleBadge, suppressedNotice, tooltip } from "./ui";
import { renderYearPanels } from "./years";

const data = new Data();
await data.loadStatic();
const meta = data.meta;
if (import.meta.env.DEV) Object.assign(window, { __data: data });
const [dy0, dy1] = meta.defaultYears;
const all: Slice = { y0: dy0, y1: dy1, sex: "all", age: "all", emp: "all", kids: "all", day: "all" };
const totalDiaries = Object.values(meta.nByYear).reduce((a, b) => a + b, 0);

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
  { label: "Parents of toddlers vs. no kids", a: { emp: "employed", kids: "u6", day: "weekday" }, b: { emp: "employed", kids: "none", day: "weekday" } },
  { label: "Weekdays vs. weekends", a: { day: "weekday" }, b: { day: "weekend" } },
  { label: `2005 vs. ${meta.latestYear}`, a: { y0: 2005, y1: 2005 }, b: { y0: meta.latestYear, y1: meta.latestYear } },
  { label: "Women vs. men", a: { sex: "f" }, b: { sex: "m" } },
  { label: "65+ vs. 25–34", a: { age: "65+" }, b: { age: "25-34" } },
];

const HEADLINES: Record<View, { kicker: string; title: string; dek: string }> = {
  day: {
    kicker: "The day",
    title: "What is America doing right now?",
    dek: `Each dot is one person's day, drawn from ${fmtInt.format(totalDiaries)} survey diaries. Press play and watch the country wake up, go to work, come home and fall asleep.`,
  },
  ribbon: {
    kicker: "Time ribbon",
    title: "The shape of an ordinary day",
    dek: "The share of people doing each thing, every ten minutes from 4 a.m. to 4 a.m. Hover anywhere for the exact split.",
  },
  compare: {
    kicker: "Compare",
    title: "Two lives, side by side",
    dek: "Pick any two groups and see where their hours go differently, down to the ten-minute slot.",
  },
  years: {
    kicker: "Years",
    title: `Twenty-three years of days`,
    dek: `How the average day has shifted from 2003 to ${meta.latestYear}. 2020 is flagged: interviews paused for two months that spring.`,
  },
};

// ---------- shell ----------
const app = document.querySelector<HTMLDivElement>("#app")!;
const status = h("span", { class: "engine", role: "status", "aria-live": "polite" });
const themeBtn = iconButton("Theme", icons.auto, () => {
  const order: Theme[] = ["auto", "light", "dark"];
  store.set({ theme: order[(order.indexOf(store.state.theme) + 1) % 3] });
}, "icon-btn--ghost");

const nav = new Segmented<View>(
  "View",
  [
    { value: "day", label: "The day" },
    { value: "ribbon", label: "Ribbon" },
    { value: "compare", label: "Compare" },
    { value: "years", label: "Years" },
  ],
  store.state.view,
  (v) => store.set({ view: v }),
  { kind: "tabs", variant: "nav" },
);

const lensSwatches: Record<Layer, string[]> = {
  act: ["--c-act-sleep", "--c-act-work", "--c-act-leisure"],
  loc: ["--c-loc-home", "--c-loc-workplace", "--c-loc-vehicle"],
  who: ["--c-who-alone", "--c-who-partner", "--c-who-own_kids"],
};
const lens = new Segmented<Layer>(
  "Color by",
  (["act", "loc", "who"] as Layer[]).map((l) => ({ value: l, label: LAYER_LABELS[l], swatches: lensSwatches[l] })),
  store.state.layer,
  (l) => store.set({ layer: l }),
  { variant: "lens" },
);

const heroEl = h("section", { class: "hero container" });
const controlsEl = h("section", { class: "controls container", "aria-label": "Who and how" });
const viewEl = h("main", { id: "view", class: "container", tabindex: "-1" });

const skip = h("a", { class: "skip-link", href: "#view" }, "Skip to the chart");
const wordmark = h("a", { class: "wordmark", href: "?", "aria-label": "24 Hours, home" }, h("span", { class: "wordmark__num" }, "24"), h("span", { class: "wordmark__word" }, "Hours"));
app.append(
  skip,
  h("header", { class: "topbar" },
    h("div", { class: "topbar__inner container" }, wordmark, h("nav", { class: "topbar__nav", "aria-label": "Views" }, nav.el), h("div", { class: "topbar__tools" }, status, themeBtn))),
  heroEl,
  controlsEl,
  viewEl,
  footer(),
);

function footer(): HTMLElement {
  const f = h("footer", { class: "footer container" });
  f.innerHTML = `
    <div class="footer__grid">
      <div>
        <h3>The data</h3>
        <p>U.S. Bureau of Labor Statistics, American Time Use Survey, 2003–${meta.latestYear} multi-year microdata (public domain). ${fmtInt.format(totalDiaries)} diaries from people 15 and older, each covering 4 a.m. to 4 a.m.</p>
      </div>
      <div>
        <h3>The math</h3>
        <p>Every number is weighted with the ATUS final weight (TU20FWGT for 2020). Groups with fewer than ${meta.minN} respondents are hidden rather than guessed at.</p>
      </div>
      <div>
        <h3>The dots</h3>
        <p>About 1,000 diaries resampled in proportion to their weight, coarsened to ten-minute steps, with no identifiers. Dots swap diaries inside a blob, so none traces one person.</p>
      </div>
      <div>
        <h3>2020</h3>
        <p>BLS paused interviews from mid-March to mid-May 2020. Figures for that year cover the rest of it only, and are flagged wherever they appear.</p>
      </div>
    </div>`;
  return f;
}

function applyTheme(t: Theme) {
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  themeBtn.innerHTML = t === "auto" ? icons.auto : t === "light" ? icons.sun : icons.moon;
  const name = `Theme: ${t === "auto" ? "match system" : t}. Click to change.`;
  themeBtn.setAttribute("aria-label", name);
  themeBtn.title = name;
}

function ensureEngine() {
  if (data.engineReady) return;
  data.startEngine((msg) => {
    status.textContent = msg;
    status.classList.toggle("is-busy", !!msg);
  }).catch((e) => {
    status.textContent = "Couldn't load the diaries";
    console.error(e);
  });
}

// ---------- hero + controls ----------
function renderHero(s: AppState) {
  const hd = HEADLINES[s.view];
  heroEl.replaceChildren(
    h("p", { class: "kicker" }, `American Time Use Survey · ${hd.kicker}`),
    h("h1", { class: "headline" }, hd.title),
    h("p", { class: "dek" }, hd.dek),
  );
}

let foldOpen = false;
function renderControls(s: AppState) {
  const lensWrap = h("div", { class: "controls__lens" }, h("span", { class: "label-caps" }, "Color by"), lens.el);
  if (s.view === "compare") {
    const presets = h("div", { class: "presets", role: "group", "aria-label": "Example comparisons" }, h("span", { class: "label-caps" }, "Try"));
    for (const p of PRESETS) {
      const active = Object.entries(p.a).every(([k, v]) => s.a[k as keyof Slice] === v) && Object.entries(p.b).every(([k, v]) => s.b[k as keyof Slice] === v);
      const b = h("button", { type: "button", class: `preset${active ? " is-active" : ""}`, "aria-pressed": String(active) }, p.label);
      b.addEventListener("click", () => store.set({ a: { ...all, ...p.a }, b: { ...all, ...p.b } }));
      presets.append(b);
    }
    const swap = iconButton("Swap A and B", icons.swap, () => store.set({ a: store.state.b, b: store.state.a }), "icon-btn--ghost swap-btn");
    controlsEl.replaceChildren(
      h("div", { class: "controls__row" }, presets, lensWrap),
      h("div", { class: "controls__pair" },
        filterSentence(meta, s.a, (a) => store.set({ a }), { tone: "a", lead: "A", defaults: all }),
        swap,
        filterSentence(meta, s.b, (b) => store.set({ b }), { tone: "b", lead: "B", defaults: all })),
    );
  } else {
    const years = s.view !== "years";
    // On phones the sentence folds into a one-line summary; on wider screens it's always open.
    const fold = h("details", { class: "fold" },
      h("summary", { class: "fold__summary" }, h("span", { class: "label-caps" }, "Showing"), h("span", { class: "fold__text" }, describeSlice(s.a)), h("span", { class: "fold__edit" }, "Edit")),
      h("div", { class: "controls__who" }, h("span", { class: "label-caps fold__label" }, "Showing"), filterSentence(meta, s.a, (a) => store.set({ a }), { years, defaults: all })));
    fold.open = foldOpen || innerWidth > 720;
    fold.addEventListener("toggle", () => innerWidth <= 720 && (foldOpen = fold.open));
    controlsEl.replaceChildren(h("div", { class: "controls__row" }, fold, lensWrap));
  }
}

// ---------- views ----------
let gen = 0; // discard stale async renders
let dots: Dots | null = null;
let dayRibbon: Ribbon | null = null;
let dotStates: Record<Layer, Uint8Array[]> | null = null;
let playTimer = 0;

function chartHead(title: string, s: Slice, n: number | null, opts: { tag?: "a" | "b"; desc?: string } = {}) {
  const badge = sampleBadge(meta, s, n, opts.tag ?? "main");
  // ATUS did not ask who was present during work activities (0501xx) until 2010.
  if (store.state.layer === "who" && (s.y0 < 2010 || store.state.view === "years"))
    badge.append(flagPill("Before 2010: company not asked at work", "Before 2010, ATUS did not ask who was present during work, so work time shows as 'Not asked' in those years."));
  const titleEl = h("h2", { class: "chart-title" });
  if (opts.tag) titleEl.append(h("span", { class: `slice-tag slice-tag--${opts.tag}`, "aria-hidden": "true" }, opts.tag.toUpperCase()));
  titleEl.append(title);
  return h("div", { class: "chart-head" }, titleEl, h("p", { class: "slice-desc" }, opts.desc ?? describeSlice(s)), badge);
}

async function getShares(s: Slice, layer: Layer): Promise<SliceResult> {
  if (!data.hasPrecomputed(s)) ensureEngine();
  return data.shares(s, layer);
}

const layerNoun = (l: Layer) => (l === "act" ? "activity" : l === "loc" ? "place" : "company");

async function renderRibbonView(s: AppState, my: number) {
  const head = h("div");
  const holder = h("div", { class: "ribbon-holder is-loading" });
  const card = h("section", { class: "card card--chart" });
  card.append(head, h("div"), holder);
  viewEl.replaceChildren(card);
  const title = `Share of people by ${layerNoun(s.layer)}, through the day`;
  head.append(chartHead(title, s.a, null));
  const ribbon = new Ribbon(holder, { height: innerWidth < 600 ? 320 : 440 });
  card.children[1].replaceWith(legend(s.layer, (c) => ribbon.highlight(c)));
  const res = await getShares(s.a, s.layer);
  if (my !== gen) return;
  holder.classList.remove("is-loading");
  head.replaceChildren(chartHead(title, s.a, res.n));
  if (res.suppressed) return holder.replaceChildren(suppressedNotice(meta, res.n));
  ribbon.update(res[s.layer]!, s.layer, false);
}

function splitClock(t: number): [string, string] {
  const [time, ampm] = clockLabel(t).split(" ");
  return [time, ampm];
}

async function renderDayView(s: AppState, my: number) {
  const [time, ampm] = splitClock(s.t);
  const clockTime = h("span", { class: "clock-display__time" }, time);
  const clockAmpm = h("span", { class: "clock-display__ampm" }, ampm);
  const badgeSlot = h("div");
  const stage = h("div", { class: "dots-holder" });

  const play = iconButton(s.playing ? "Pause" : "Play", s.playing ? icons.pause : icons.play, () => store.set({ playing: !store.state.playing }), "play-btn");
  const scrubber = h("div", {
    class: "scrubber",
    role: "slider",
    tabindex: "0",
    "aria-label": "Time of day",
    "aria-valuemin": "0",
    "aria-valuemax": "1439",
  });
  scrubber.addEventListener("keydown", (ev) => {
    const step = ev.shiftKey ? 60 : 10;
    const t = store.state.t;
    const next = ev.key === "ArrowRight" || ev.key === "ArrowUp" ? t + step
      : ev.key === "ArrowLeft" || ev.key === "ArrowDown" ? t - step
      : ev.key === "Home" ? 0 : ev.key === "End" ? 1439 : ev.key === "PageUp" ? t + 120 : ev.key === "PageDown" ? t - 120 : null;
    if (next !== null) {
      ev.preventDefault();
      store.set({ t: (next + 1440) % 1440, playing: false });
    } else if (ev.key === " " || ev.key === "Enter") {
      ev.preventDefault();
      store.set({ playing: !store.state.playing });
    }
  });
  const speed = new Segmented<string>("Playback speed", [0.5, 1, 2, 4].map((v) => ({ value: String(v), label: v === 0.5 ? "½×" : `${v}×` })), String(s.speed), (v) => store.set({ speed: +v }), { size: "sm" });
  const flows = toggleSwitch("Flows", s.flows, (v) => store.set({ flows: v }), "Show people travelling between activities");

  const card = h("section", { class: "card stage" },
    h("div", { class: "stage__top" },
      h("div", { class: "clock-display", "aria-live": "off" }, clockTime, clockAmpm),
      badgeSlot),
    stage,
    h("div", { class: "dock" },
      play,
      scrubber,
      h("div", { class: "dock__opts" }, speed.el, flows)),
    h("div", { class: "stage__legend" }, legend(s.layer)),
    h("p", { class: "fineprint" }, "Each dot is one survey diary, resampled in proportion to its weight. The strip is the full weighted estimate: drag it to move through the day, or use the arrow keys. Space plays and pauses."));
  viewEl.replaceChildren(card);
  badgeSlot.append(sampleBadge(meta, s.a, null, "main"));

  dots = new Dots(stage);
  dots.setFlows(s.flows);
  if (import.meta.env.DEV) Object.assign(window, { __dots: dots });
  dots.setMinute(s.t);
  dots.start();
  dayRibbon = new Ribbon(scrubber, { height: innerWidth <= 720 ? 44 : 48, compact: true, scrub: (m) => store.set({ t: m, playing: false }) });
  syncClock(s.t);

  const [res, sample] = await Promise.all([getShares(s.a, s.layer), (ensureEngine(), data.sampleDiaries(s.a))]);
  if (my !== gen) return;
  badgeSlot.replaceChildren(sampleBadge(meta, s.a, res.n, "main"));
  if (res.suppressed || !sample || sample.n < meta.minN) {
    stage.replaceChildren(suppressedNotice(meta, res.n));
    dots.stop();
    return;
  }
  dotStates = sample.states;
  dots.setLayer(s.layer, dotStates[s.layer]);
  dots.setMinute(store.state.t);
  dayRibbon.update(res[s.layer]!, s.layer, false);
  syncClock(store.state.t);
  stage.setAttribute("role", "img");
  stage.setAttribute("aria-label", `${dotStates.act.length} resampled diaries grouped by ${layerNoun(s.layer)}`);
}

function syncClock(t: number) {
  dots?.setMinute(t);
  dayRibbon?.setTime(t);
  const [time, ampm] = splitClock(t);
  const ct = viewEl.querySelector(".clock-display__time"), ca = viewEl.querySelector(".clock-display__ampm");
  if (ct) ct.textContent = time;
  if (ca) ca.textContent = ampm;
  const sc = viewEl.querySelector(".scrubber");
  if (sc) {
    sc.setAttribute("aria-valuenow", String(Math.round(t)));
    sc.setAttribute("aria-valuetext", clockLabel(t));
  }
}

async function renderCompareView(s: AppState, my: number) {
  const pair = h("div", { class: "pair" });
  const diffEl = h("div", { class: "diff-holder" });
  const tableEl = h("div", { class: "window-table" });
  viewEl.replaceChildren(
    h("section", { class: "card card--chart" }, legend(s.layer), pair),
    h("div", { class: "split" },
      h("section", { class: "card" }, h("div", { class: "chart-head" }, h("h2", { class: "chart-title" }, "Where they differ"), h("p", { class: "slice-desc" }, "Gap in the share of people doing each thing, every ten minutes. Blue: more of A. Red: more of B.")), diffEl),
      h("section", { class: "card" }, h("div", { class: "chart-head" }, h("h2", { class: "chart-title" }, "Where the time goes")), tableEl)),
  );
  const ribbons: Ribbon[] = [];
  const sync = (m: number | null) => ribbons.forEach((r) => r.setTime(m));
  const mk = (tag: "a" | "b", sl: Slice) => {
    const head = h("div", {}, chartHead(describeSlice(sl), sl, null, { tag, desc: "" }));
    const holder = h("div", { class: "ribbon-holder is-loading" });
    pair.append(h("div", { class: `pair__col pair__col--${tag}` }, head, holder));
    const r = new Ribbon(holder, { height: innerWidth < 600 ? 240 : 300, onHover: sync });
    ribbons.push(r);
    return { head, holder, r };
  };
  const A = mk("a", s.a), B = mk("b", s.b);
  const [ra, rb] = await Promise.all([getShares(s.a, s.layer), getShares(s.b, s.layer)]);
  if (my !== gen) return;
  for (const [X, res, sl, tag] of [[A, ra, s.a, "a"], [B, rb, s.b, "b"]] as const) {
    X.holder.classList.remove("is-loading");
    X.head.replaceChildren(chartHead(describeSlice(sl), sl, res.n, { tag, desc: "" }));
    if (res.suppressed) X.holder.replaceChildren(suppressedNotice(meta, res.n));
    else X.r.update(res[s.layer]!, s.layer, false);
  }
  if (ra.suppressed || rb.suppressed) {
    diffEl.replaceChildren(h("p", { class: "muted" }, "The difference view needs both groups to have enough respondents."));
    return;
  }
  renderDiff(diffEl, ra[s.layer]!, rb[s.layer]!, s.layer, sync);
  renderWindowTable(tableEl, ra[s.layer]!, rb[s.layer]!, s.layer, s.win, (win) => store.set({ win }));
}

async function renderYearsView(s: AppState, my: number) {
  const head = h("div");
  const play = iconButton("Play through the years", icons.play, () => toggleYears(), "play-btn");
  const slider = h("input", { type: "range", class: "range", min: "2003", max: String(meta.latestYear), step: "1", value: String(s.year), "aria-label": "Year" });
  const yearDisplay = h("span", { class: "year-display" }, String(s.year));
  const ticks = h("div", { class: "range-ticks", "aria-hidden": "true" });
  for (let y = 2003; y <= meta.latestYear; y++) ticks.append(h("span", { class: y === 2020 ? "is-flag" : y % 5 === 0 ? "is-major" : "" }, y % 5 === 0 || y === 2003 || y === 2020 || y === meta.latestYear ? `’${String(y).slice(2)}` : ""));
  const holder = h("div", { class: "ribbon-holder is-loading" });
  const panels = h("div");
  viewEl.replaceChildren(
    h("section", { class: "card card--chart" },
      h("div", { class: "years-top" }, yearDisplay, head),
      h("div", { class: "dock dock--years" }, play, h("div", { class: "range-wrap" }, slider, ticks)),
      legend(s.layer), holder),
    h("section", { class: "card" }, h("div", { class: "chart-head" }, h("h2", { class: "chart-title" }, `Hours per day, 2003–${meta.latestYear}`), h("p", { class: "slice-desc" }, "Each panel has its own scale. The dashed line marks 2020. Click a panel to jump to that year.")), panels),
  );
  const ribbon = new Ribbon(holder, { height: innerWidth < 600 ? 280 : 380 });

  const byYear = await (async () => {
    if (!DIMS_DEFAULT(s.a)) ensureEngine();
    return data.byYear(s.a, s.layer);
  })();
  if (my !== gen) return;
  holder.classList.remove("is-loading");

  const showYear = (y: number, animate: boolean) => {
    const res = byYear.get(y)!;
    if (yearDisplay.textContent !== String(y)) {
      yearDisplay.textContent = String(y);
      yearDisplay.classList.remove("is-tick");
      void yearDisplay.offsetWidth;
      yearDisplay.classList.add("is-tick");
    }
    yearDisplay.classList.toggle("is-flag", y === 2020);
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
  const setBtn = (on: boolean) => {
    play.innerHTML = on ? icons.pause : icons.play;
    play.setAttribute("aria-label", on ? "Pause" : "Play through the years");
  };
  function toggleYears() {
    if (timer) {
      clearInterval(timer);
      timer = 0;
      setBtn(false);
      return;
    }
    setBtn(true);
    if (store.state.year >= meta.latestYear) store.set({ year: 2003 });
    timer = window.setInterval(() => {
      if (gen !== my || store.state.year >= meta.latestYear) {
        clearInterval(timer);
        timer = 0;
        setBtn(false);
        return;
      }
      store.set({ year: store.state.year + 1 });
    }, 900);
  }
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
  viewEl.dataset.view = s.view;
  const run = { day: renderDayView, ribbon: renderRibbonView, compare: renderCompareView, years: renderYearsView }[s.view] ?? renderRibbonView;
  run(s, my).catch((e) => {
    console.error(e);
    viewEl.append(h("div", { class: "empty" }, h("div", { class: "empty__title" }, "Something went wrong"), h("p", {}, String(e?.message ?? e))));
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

// Space toggles play on the Day view when focus isn't in a control.
addEventListener("keydown", (ev) => {
  if (ev.key !== " " || store.state.view !== "day") return;
  const t = ev.target as HTMLElement;
  if (t.closest("button, input, select, textarea, [role=slider], a")) return;
  ev.preventDefault();
  store.set({ playing: !store.state.playing });
});

store.on((s, changed) => {
  if (changed.has("theme")) applyTheme(s.theme);
  if (changed.has("view")) {
    nav.set(s.view);
    renderHero(s);
  }
  if (changed.has("layer")) lens.set(s.layer);
  const structural = ["view", "layer", "a", "b", "win", "theme"].some((k) => changed.has(k as keyof AppState));
  if (structural) {
    if (changed.has("view") || changed.has("a") || changed.has("b")) renderControls(s);
    if (changed.has("layer") && s.view === "day" && dots && dotStates && !changed.has("a")) {
      dots.setLayer(s.layer, dotStates[s.layer]);
      viewEl.querySelector(".stage__legend")?.replaceChildren(legend(s.layer));
      getShares(s.a, s.layer).then((r) => !r.suppressed && dayRibbon?.update(r[s.layer]!, s.layer));
    } else renderView(s);
  }
  if (changed.has("year") && yearsHook && !structural) yearsHook(s.year);
  if (changed.has("flows")) dots?.setFlows(s.flows);
  if (changed.has("t")) syncClock(s.t);
  if (changed.has("playing")) {
    setPlaying(s.playing);
    const btn = viewEl.querySelector<HTMLButtonElement>(".stage .play-btn");
    if (btn) {
      btn.innerHTML = s.playing ? icons.pause : icons.play;
      btn.setAttribute("aria-label", s.playing ? "Pause" : "Play");
      btn.title = s.playing ? "Pause" : "Play";
    }
    viewEl.classList.toggle("is-playing", s.playing);
  }
});

// The top bar lifts off the page only once you've scrolled.
const topbar = app.querySelector<HTMLElement>(".topbar")!;
const onScroll = () => topbar.classList.toggle("is-scrolled", scrollY > 8);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

applyTheme(store.state.theme);
renderHero(store.state);
renderControls(store.state);
renderView(store.state);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => store.state.theme === "auto" && renderView(store.state));
// Canvas labels use Inter: redraw once the font is ready.
document.fonts?.ready.then(() => dots?.refreshTheme());
status.title = `${fmtInt.format(totalDiaries)} diaries, ${Object.keys(CATEGORY_LABELS.act).length - 1} activity categories`;
