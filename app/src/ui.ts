import { CATEGORY_LABELS, DIMS, FILTER_LABELS, FIRST_YEAR, PANDEMIC_YEAR, colorFor, fmtInt, type Layer, type Meta } from "./config";
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
    const li = h("li", {}, h("span", { class: "sw", style: `background:${colorFor(layer, k)}` }), label);
    li.addEventListener("pointerenter", () => onHover?.(i));
    li.addEventListener("pointerleave", () => onHover?.(null));
    ul.append(li);
  });
  return ul;
}

export function describeSlice(s: Slice): string {
  const parts = DIMS.filter((d) => s[d] !== "all").map((d) => FILTER_LABELS[d].values[s[d]]);
  const yrs = s.y0 === s.y1 ? `${s.y0}` : `${s.y0}–${s.y1}`;
  return `${parts.length ? parts.join(" · ") : "All Americans 15+"} · ${yrs}`;
}

/** "n = 936 respondents" badge, with suppression and 2020 flags. */
export function sampleBadge(meta: Meta, s: Slice, n: number | null): HTMLElement {
  const wrap = h("div", { class: "sample" });
  if (n === null) {
    wrap.append(h("span", { class: "n" }, "n = …"));
  } else {
    const small = n < meta.minN;
    wrap.append(h("span", { class: `n ${small ? "warn" : ""}` }, `n = ${fmtInt.format(n)} respondents`));
    if (small) wrap.append(h("span", { class: "flag" }, `⚠ Suppressed: fewer than ${meta.minN}`));
  }
  if (s.y0 <= PANDEMIC_YEAR && s.y1 >= PANDEMIC_YEAR) wrap.append(pandemicFlag());
  return wrap;
}

export function pandemicFlag(): HTMLElement {
  return h("span", { class: "flag", title: "BLS suspended ATUS data collection from mid-March to mid-May 2020. 2020 estimates use the pandemic-method weight TU20FWGT and cover only the rest of the year." }, "⚑ Includes 2020 (collection suspended Mar–May)");
}

export function suppressedNotice(meta: Meta, n: number): HTMLElement {
  return h("div", { class: "suppressed" },
    h("strong", {}, "Not enough people in this slice."),
    ` Only ${fmtInt.format(n)} respondents match (minimum ${meta.minN}). Widen the filters or the year range.`);
}

function select(label: string, value: string, options: [string, string][], onChange: (v: string) => void): HTMLElement {
  const sel = h("select", { "aria-label": label });
  for (const [v, t] of options) {
    const o = h("option", { value: v }, t);
    if (v === value) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  return h("label", { class: "field" }, h("span", {}, label), sel);
}

/** One row of filter controls for a slice. */
export function filterRow(meta: Meta, s: Slice, title: string | null, onChange: (s: Slice) => void, opts: { years?: boolean } = {}): HTMLElement {
  const row = h("div", { class: "filters" });
  if (title) row.append(h("span", { class: "slice-tag" }, title));
  if (opts.years !== false) {
    const years: [string, string][] = [];
    for (let y = FIRST_YEAR; y <= meta.latestYear; y++) years.push([String(y), y === PANDEMIC_YEAR ? `${y} ⚑` : String(y)]);
    row.append(
      select("From", String(s.y0), years, (v) => onChange({ ...s, y0: Math.min(+v, s.y1), y1: Math.max(+v, s.y1) })),
      select("To", String(s.y1), years, (v) => onChange({ ...s, y0: Math.min(+v, s.y0), y1: Math.max(+v, s.y0) })),
    );
  }
  for (const d of DIMS) {
    const vals = Object.entries(FILTER_LABELS[d].values) as [string, string][];
    row.append(select(FILTER_LABELS[d].label, s[d], vals, (v) => onChange({ ...s, [d]: v })));
  }
  return row;
}
