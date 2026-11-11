import * as d3 from "d3";
import { CATEGORY_LABELS, PANDEMIC_YEAR, colorFor, hoursOf, type Layer, type SliceResult } from "./config";
import { h, tooltip } from "./ui";

/** Small multiples: average hours/day in each category, by year, with 2020 flagged. */
export function renderYearPanels(el: HTMLElement, byYear: Map<number, SliceResult>, layer: Layer, year: number, onPick: (y: number) => void) {
  el.replaceChildren();
  const keys = CATEGORY_LABELS[layer];
  const order = Object.keys(keys);
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const width = Math.max(300, el.clientWidth);
  const cols = width < 520 ? 2 : width < 900 ? 3 : 4;
  const pw = Math.floor((width - (cols - 1) * 12) / cols);
  const ph = 104;
  const m = { t: 22, r: 10, b: 16, l: 34 };
  const x = d3.scaleLinear().domain([years[0], years[years.length - 1]]).range([m.l, pw - m.r]);
  const grid = h("div", { class: "panels", style: `grid-template-columns: repeat(${cols}, 1fr)` });

  order.forEach((k, c) => {
    const pts = years.map((y) => {
      const r = byYear.get(y);
      const g = r && !r.suppressed ? r[layer] : undefined;
      return { y, v: g ? hoursOf(g[c]) : null };
    });
    const vals = pts.filter((p) => p.v !== null).map((p) => p.v!) as number[];
    if (!vals.length) return;
    const [lo, hi] = d3.extent(vals) as [number, number];
    const pad = Math.max(0.05, (hi - lo) * 0.15);
    const yS = d3.scaleLinear().domain([Math.max(0, lo - pad), hi + pad]).range([ph - m.b, m.t]);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${pw} ${ph}`).attr("width", pw).attr("height", ph).attr("class", "panel");
    svg.append("text").attr("class", "panel-title").attr("x", 0).attr("y", 11).text(keys[k]);
    const cur = pts.find((p) => p.y === year);
    svg.append("text").attr("class", "panel-value").attr("x", pw).attr("y", 11).attr("text-anchor", "end")
      .text(cur?.v != null ? `${cur.v.toFixed(2)} h` : "");
    svg.append("line").attr("class", "pandemic").attr("x1", x(PANDEMIC_YEAR)).attr("x2", x(PANDEMIC_YEAR)).attr("y1", m.t).attr("y2", ph - m.b);
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
      .call(d3.axisLeft(yS).tickValues(yS.domain()).tickFormat((d) => `${(+d).toFixed(1)}h`).tickSize(3));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${ph - m.b})`)
      .call(d3.axisBottom(x).tickValues([years[0], 2010, PANDEMIC_YEAR, years[years.length - 1]]).tickFormat((d) => `’${String(d).slice(2)}`).tickSize(3));
    const line = d3.line<{ y: number; v: number | null }>().defined((p) => p.v !== null).x((p) => x(p.y)).y((p) => yS(p.v ?? 0));
    svg.append("path").attr("d", line(pts)).attr("fill", "none").attr("stroke", colorFor(layer, k)).attr("stroke-width", 2);
    svg.selectAll("circle.pt").data(pts.filter((p) => p.v !== null)).join("circle").attr("class", "pt")
      .attr("cx", (p) => x(p.y)).attr("cy", (p) => yS(p.v!)).attr("r", (p) => (p.y === year ? 4.5 : p.y === PANDEMIC_YEAR ? 3 : 0))
      .attr("fill", (p) => (p.y === PANDEMIC_YEAR && p.y !== year ? "none" : colorFor(layer, k)))
      .attr("stroke", (p) => (p.y === year ? "var(--surface-1)" : colorFor(layer, k))).attr("stroke-width", 1.5);
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", pw - m.l - m.r).attr("height", ph - m.t - m.b).attr("fill", "transparent")
      .style("cursor", "pointer")
      .on("pointermove", (ev: PointerEvent) => {
        const yr = Math.round(x.invert(d3.pointer(ev)[0]));
        const p = pts.find((q) => q.y === yr);
        tooltip.show(ev, `<div class="tt-title">${keys[k]} · ${yr}${yr === PANDEMIC_YEAR ? " ⚑" : ""}</div>${p?.v != null ? `${p.v.toFixed(2)} hours/day` : "suppressed"}${yr === PANDEMIC_YEAR ? "<br><small>Collection suspended mid-Mar–mid-May</small>" : ""}`);
      })
      .on("pointerleave", () => tooltip.hide())
      .on("click", (ev: PointerEvent) => onPick(Math.round(x.invert(d3.pointer(ev)[0]))));
    grid.append(svg.node()!);
  });
  el.append(grid);
}
