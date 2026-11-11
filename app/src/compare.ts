import * as d3 from "d3";
import { CATEGORY_LABELS, NBINS, clockLabel, colorFor, type Grid, type Layer } from "./config";
import { h, tooltip } from "./ui";

export const WINDOWS: Record<string, { label: string; from: number; to: number }> = {
  day: { label: "Whole day", from: 0, to: 1440 },
  morning: { label: "Morning, 6–9 a.m.", from: 120, to: 300 },
  workday: { label: "Workday, 9 a.m.–5 p.m.", from: 300, to: 780 },
  evening: { label: "Evening, 5–10 p.m.", from: 780, to: 1080 },
  night: { label: "Night, 10 p.m.–4 a.m.", from: 1080, to: 1440 },
};

/** Average minutes per person spent in each category within [from, to). */
function minutesIn(grid: Grid, from: number, to: number): number[] {
  return grid.map((row) => {
    let m = 0;
    for (let b = from / 10; b < to / 10; b++) m += (row[b] / 10000) * 10;
    return m;
  });
}

function diverging(): (v: number) => string {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string) => cs.getPropertyValue(k).trim();
  return d3.interpolateRgbBasis([v("--div-b-2"), v("--div-b-1"), v("--div-mid"), v("--div-a-1"), v("--div-a-2")]);
}

/** Heat strip of A − B share (percentage points) per category × 10-minute bin. */
export function renderDiff(el: HTMLElement, a: Grid, b: Grid, layer: Layer, onHover?: (minute: number | null) => void) {
  el.replaceChildren();
  const keys = CATEGORY_LABELS[layer];
  const order = Object.keys(keys);
  const width = Math.max(300, el.clientWidth);
  const narrow = width < 560;
  const m = { t: 6, r: 8, b: 26, l: narrow ? 108 : 172 };
  const rowH = narrow ? 16 : 18;
  const hgt = m.t + m.b + rowH * order.length;
  const x = d3.scaleLinear().domain([0, 1440]).range([m.l, width - m.r]);
  const diff = a.map((row, c) => row.map((v, i) => (v - b[c][i]) / 100)); // percentage points
  const maxAbs = Math.max(5, d3.max(diff.flat(), (d) => Math.abs(d)) ?? 5);
  const interp = diverging();
  const color = (d: number) => interp(0.5 + d / (2 * maxAbs));

  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${width} ${hgt}`).attr("width", width).attr("height", hgt).attr("class", "diff");
  const cw = (width - m.l - m.r) / NBINS;
  order.forEach((k, c) => {
    const g = svg.append("g").attr("transform", `translate(0,${m.t + c * rowH})`);
    g.append("rect").attr("x", m.l - (narrow ? 12 : 14)).attr("y", rowH / 2 - 4).attr("width", 8).attr("height", 8).attr("rx", 2).attr("fill", colorFor(layer, k));
    g.append("text").attr("class", "row-label").attr("x", m.l - (narrow ? 16 : 18)).attr("y", rowH / 2).attr("text-anchor", "end").attr("dominant-baseline", "middle").text(keys[k]);
    g.selectAll("rect.cell").data(diff[c]).join("rect").attr("class", "cell")
      .attr("x", (_, i) => m.l + i * cw).attr("y", 1).attr("width", cw + 0.3).attr("height", rowH - 2).attr("fill", color);
  });
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${hgt - m.b})`)
    .call(d3.axisBottom(x).tickValues(narrow ? [0, 360, 720, 1080, 1440] : [0, 180, 360, 540, 720, 900, 1080, 1260, 1440]).tickFormat((d) => clockLabel(+d, true)).tickSizeOuter(0));
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", width - m.l - m.r).attr("height", rowH * order.length).attr("fill", "transparent")
    .on("pointermove", (ev: PointerEvent) => {
      const [mx, my] = d3.pointer(ev);
      const bin = Math.max(0, Math.min(NBINS - 1, Math.floor((mx - m.l) / cw)));
      const c = Math.max(0, Math.min(order.length - 1, Math.floor((my - m.t) / rowH)));
      const d = diff[c][bin];
      tooltip.show(ev, `<div class="tt-title">${keys[order[c]]} · ${clockLabel(bin * 10)}–${clockLabel(bin * 10 + 10)}</div>
        <table><tr><td>A</td><td class="num">${(a[c][bin] / 100).toFixed(1)}%</td></tr>
        <tr><td>B</td><td class="num">${(b[c][bin] / 100).toFixed(1)}%</td></tr>
        <tr class="hl"><td>A − B</td><td class="num">${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} pts</td></tr></table>`);
      onHover?.(bin * 10 + 5);
    })
    .on("pointerleave", () => {
      tooltip.hide();
      onHover?.(null);
    });

  const scale = h("div", { class: "div-scale" },
    h("span", {}, `B higher (−${maxAbs.toFixed(0)} pts)`),
    h("span", { class: "bar", style: `background:linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((t) => interp(t)).join(",")})` }),
    h("span", {}, `A higher (+${maxAbs.toFixed(0)} pts)`));
  el.append(scale);
}

/** Minutes-per-person table for a time window, sorted by largest gap. */
export function renderWindowTable(el: HTMLElement, a: Grid, b: Grid, layer: Layer, win: string, onWin: (w: string) => void) {
  el.replaceChildren();
  const W = WINDOWS[win] ?? WINDOWS.evening;
  const keys = CATEGORY_LABELS[layer];
  const order = Object.keys(keys);
  const ma = minutesIn(a, W.from, W.to), mb = minutesIn(b, W.from, W.to);
  const rows = order.map((k, c) => ({ k, label: keys[k], a: ma[c], b: mb[c], d: ma[c] - mb[c] })).sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
  const maxD = Math.max(1, ...rows.map((r) => Math.abs(r.d)));

  const tabs = h("div", { class: "seg", role: "tablist" });
  for (const [k, w] of Object.entries(WINDOWS)) {
    const btn = h("button", { role: "tab", "aria-selected": String(k === win) }, w.label);
    btn.addEventListener("click", () => onWin(k));
    tabs.append(btn);
  }
  const fmt = (m: number) => (W.to - W.from >= 600 ? `${(m / 60).toFixed(2)} h` : `${m.toFixed(0)} min`);
  const top = rows.filter((r) => Math.abs(r.d) >= 3).slice(0, 3);
  const sentence = top.length
    ? `${W.label}: compared with B, A spends ` + top.map((r) => `${Math.abs(r.d).toFixed(0)} ${r.d > 0 ? "more" : "fewer"} minutes on ${r.label.toLowerCase()}`).join(", ") + "."
    : `${W.label}: no category differs by 3 minutes or more.`;

  const table = h("table", { class: "wtable" });
  table.innerHTML = `<thead><tr><th>${layer === "act" ? "Activity" : layer === "loc" ? "Where" : "With whom"}</th><th class="num">A</th><th class="num">B</th><th class="num">A − B</th><th class="bar-col"></th></tr></thead>`;
  const tb = h("tbody");
  for (const r of rows) {
    const tr = h("tr");
    const pctW = (Math.abs(r.d) / maxD) * 50;
    tr.innerHTML = `<td><span class="sw" style="background:${colorFor(layer, r.k)}"></span>${r.label}</td>
      <td class="num">${fmt(r.a)}</td><td class="num">${fmt(r.b)}</td>
      <td class="num">${r.d >= 0 ? "+" : "−"}${fmt(Math.abs(r.d))}</td>
      <td class="bar-col"><div class="dbar"><span class="${r.d >= 0 ? "pos" : "neg"}" style="width:${pctW}%;${r.d >= 0 ? "left:50%" : `left:${50 - pctW}%`}"></span></div></td>`;
    tb.append(tr);
  }
  table.append(tb);
  el.append(tabs, h("p", { class: "callout" }, sentence), table);
}
