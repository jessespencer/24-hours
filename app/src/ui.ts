import { chipSelect } from "./components";
import { CATEGORY_LABELS, DIMS, FILTER_LABELS, FIRST_YEAR, PANDEMIC_YEAR, colorFor, fmtInt, type Dim, type Layer, type Meta } from "./config";
import { icons } from "./icons";
import type { Slice } from "./state";

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

class Tooltip {
  private el = h("div", { class: "tooltip", role: "tooltip" });
  constructor() {
    document.body.append(this.el);
  }
  show(ev: { clientX: number; clientY: number }, html: string) {
    this.el.innerHTML = html;
    if (this.el.style.display !== "block") {
      this.el.classList.remove("is-in");
      void this.el.offsetWidth;
      this.el.classList.add("is-in");
    }
    this.el.style.display = "block";
    const { width, height } = this.el.getBoundingClientRect();
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + width > innerWidth - 8) x = ev.clientX - width - 14;
    if (y + height > innerHeight - 8) y = Math.max(8, innerHeight - height - 8);
    this.el.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
  }
  hide() {
    this.el.style.display = "none";
  }
}
export const tooltip = new Tooltip();

export function legend(layer: Layer, onHover?: (cat: number | null) => void): HTMLElement {
  const keys = CATEGORY_LABELS[layer];
  const ul = h("ul", { class: "legend", "aria-label": "Legend" });
  Object.entries(keys).forEach(([k, label], i) => {
    const li = h("li", { tabindex: "0", style: `--i:${i}` }, h("span", { class: "sw", style: `background:${colorFor(layer, k)}` }), label);
    li.addEventListener("pointerenter", () => onHover?.(i));
    li.addEventListener("pointerleave", () => onHover?.(null));
    li.addEventListener("focus", () => onHover?.(i));
    li.addEventListener("blur", () => onHover?.(null));
    ul.append(li);
  });
  return ul;
}

export function describeSlice(s: Slice): string {
  const parts = DIMS.filter((d) => s[d] !== "all").map((d) => FILTER_LABELS[d].values[s[d]]);
  const yrs = s.y0 === s.y1 ? `${s.y0}` : `${s.y0}–${s.y1}`;
  return `${parts.length ? parts.join(" · ") : "All Americans 15+"} · ${yrs}`;
}

const pill = (cls: string, icon: string, text: string, title?: string) => {
  const el = h("span", { class: `pill ${cls}`, ...(title ? { title } : {}) });
  el.innerHTML = icon;
  el.append(h("span", {}, text));
  return el;
};

/** Sample-size pill, plus suppression and 2020 flags. */
const lastCounts = new Map<string, number>();
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Tween a number in an element's text (ease-out), e.g. "8,782 respondents". */
function countUp(el: HTMLElement, from: number, to: number, suffix: string) {
  const dur = 520, t0 = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = `${fmtInt.format(Math.round(from + (to - from) * e))}${suffix}`;
    if (k < 1 && el.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Sample-size pill, plus suppression and 2020 flags. With a `key`, the count
 * ticks from the last value shown under that key to the new one.
 */
export function sampleBadge(meta: Meta, s: Slice, n: number | null, key?: string): HTMLElement {
  const wrap = h("div", { class: "sample" });
  if (n === null) wrap.append(pill("pill--quiet is-loading", icons.users, key && lastCounts.has(key) ? `${fmtInt.format(lastCounts.get(key)!)} respondents` : "Counting respondents…"));
  else {
    const small = n < meta.minN;
    const p = pill(small ? "pill--warn" : "pill--quiet", icons.users, `${fmtInt.format(n)} respondents`, "Unweighted number of survey diaries in this slice");
    const prev = key ? lastCounts.get(key) : undefined;
    if (key) lastCounts.set(key, n);
    if (prev !== undefined && prev !== n && !reduceMotion()) {
      const label = p.lastElementChild as HTMLElement;
      label.textContent = `${fmtInt.format(prev)} respondents`; // start from the old value: no flash of the final one
      countUp(label, prev, n, " respondents");
    }
    wrap.append(p);
    if (small) wrap.append(pill("pill--warn", icons.info, `Suppressed: under ${meta.minN}`));
  }
  if (s.y0 <= PANDEMIC_YEAR && s.y1 >= PANDEMIC_YEAR) wrap.append(pandemicFlag());
  return wrap;
}

export function flagPill(text: string, title: string): HTMLElement {
  return pill("pill--warn", icons.flag, text, title);
}

export function pandemicFlag(): HTMLElement {
  return flagPill("Includes 2020: no interviews mid-Mar to mid-May", "BLS suspended ATUS data collection from mid-March to mid-May 2020. 2020 estimates use the pandemic-method weight TU20FWGT and cover only the rest of the year.");
}

export function suppressedNotice(meta: Meta, n: number): HTMLElement {
  return h("div", { class: "empty" },
    h("div", { class: "empty__title" }, "Too few people to say"),
    h("p", {}, `Only ${fmtInt.format(n)} respondents match these filters, and estimates need at least ${meta.minN}. Try a wider year range or fewer filters.`));
}

/** Sentence fragments for each filter value, so the filters read as a phrase. */
const PHRASES: Record<Dim, Record<string, string>> = {
  sex: { all: "Everyone", m: "Men", f: "Women" },
  age: { all: "of all ages", "15-24": "aged 15–24", "25-34": "aged 25–34", "35-44": "aged 35–44", "45-54": "aged 45–54", "55-64": "aged 55–64", "65+": "aged 65+" },
  emp: { all: "with any job status", employed: "who are employed", ft: "working full-time", pt: "working part-time", unemp: "who are unemployed", nilf: "not in the labor force" },
  kids: { all: "with or without kids", none: "with no kids at home", any: "with kids at home", u6: "with a child under 6", "6-12": "whose youngest is 6–12", "13-17": "whose youngest is 13–17" },
  day: { all: "on any day", weekday: "on weekdays", weekend: "on weekends", holiday: "on holidays" },
};

/**
 * Filters as a sentence: "Everyone · of all ages · … · on weekdays · 2023–2025".
 * Each fragment is a chip-styled native select; changed fragments are tinted.
 */
export function filterSentence(meta: Meta, s: Slice, onChange: (s: Slice) => void, opts: { years?: boolean; tone?: "a" | "b"; lead?: string; defaults: Slice }): HTMLElement {
  const row = h("div", { class: `sentence${opts.tone ? ` sentence--${opts.tone}` : ""}` });
  if (opts.lead) row.append(h("span", { class: `slice-tag slice-tag--${opts.tone ?? "a"}`, "aria-hidden": "true" }, opts.lead));
  const words = h("div", { class: "sentence__words" });
  for (const d of DIMS) {
    const vals = Object.entries(PHRASES[d]) as [string, string][];
    words.append(chipSelect(`${opts.lead ? `Slice ${opts.lead}: ` : ""}${FILTER_LABELS[d].label}`, s[d], vals, (v) => onChange({ ...s, [d]: v }), { defaultValue: "all", tone: opts.tone }));
  }
  if (opts.years !== false) {
    const years: [string, string][] = [];
    for (let y = FIRST_YEAR; y <= meta.latestYear; y++) years.push([String(y), y === PANDEMIC_YEAR ? `${y} ⚑` : String(y)]);
    const yr = h("span", { class: "sentence__years" },
      h("span", { class: "sentence__glue" }, "in"),
      chipSelect("From year", String(s.y0), years, (v) => onChange({ ...s, y0: Math.min(+v, s.y1), y1: Math.max(+v, s.y1) }), { defaultValue: String(opts.defaults.y0), tone: opts.tone }),
      h("span", { class: "sentence__glue" }, "to"),
      chipSelect("To year", String(s.y1), years, (v) => onChange({ ...s, y0: Math.min(+v, s.y0), y1: Math.max(+v, s.y0) }), { defaultValue: String(opts.defaults.y1), tone: opts.tone }));
    words.append(yr);
  }
  row.append(words);
  const dirty = DIMS.some((d) => s[d] !== "all") || (opts.years !== false && (s.y0 !== opts.defaults.y0 || s.y1 !== opts.defaults.y1));
  if (dirty) {
    const reset = h("button", { type: "button", class: "text-btn", title: "Reset these filters" });
    reset.innerHTML = icons.reset;
    reset.append(h("span", {}, "Reset"));
    reset.addEventListener("click", () => onChange(opts.years === false ? { ...opts.defaults, y0: s.y0, y1: s.y1 } : { ...opts.defaults }));
    row.append(reset);
  }
  return row;
}
