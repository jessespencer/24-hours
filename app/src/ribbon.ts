import * as d3 from "d3";
// Side-effect import: adds selection.transition(). d3's package marks itself side-effect
// free, so without this the production bundle drops it (the dev server doesn't).
import "d3-transition";
import { CATEGORY_LABELS, NBINS, clockLabel, colorFor, pct, type Grid, type Layer } from "./config";
import { tooltip } from "./ui";

const TICKS = [0, 180, 360, 540, 720, 900, 1080, 1260, 1440];
let clipSeq = 0;

interface Opts {
  height: number;
  /** Called with the hovered minute (or null) so other views can follow. */
  onHover?: (minute: number | null) => void;
  /** Makes the ribbon a scrubber: press and drag to set the time. */
  scrub?: (minute: number) => void;
  /** Compact strip: no y axis or direct labels (used as the day scrubber). */
  compact?: boolean;
}

/** Stacked-area "time ribbon": weighted share of people in each category by time of day. */
export class Ribbon {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private gAreas: d3.Selection<SVGGElement, unknown, null, undefined>;
  private gLabels: d3.Selection<SVGGElement, unknown, null, undefined>;
  private gAxis: d3.Selection<SVGGElement, unknown, null, undefined>;
  private cursor: d3.Selection<SVGLineElement, unknown, null, undefined>;
  private marker: d3.Selection<SVGLineElement, unknown, null, undefined>;
  private knob: d3.Selection<SVGGElement, unknown, null, undefined>;
  private clipRect: d3.Selection<SVGRectElement, unknown, null, undefined>;
  private track: d3.Selection<SVGRectElement, unknown, null, undefined>;
  private minute: number | null = null;
  private overlay: d3.Selection<SVGRectElement, unknown, null, undefined>;
  private grid: Grid | null = null;
  private layer: Layer = "act";
  private width = 600;
  private m = { t: 8, r: 8, b: 26, l: 40 };
  private x = d3.scaleLinear();
  private y = d3.scaleLinear();
  private hoverCat: number | null = null;

  private el: HTMLElement;
  private opts: Opts;

  constructor(el: HTMLElement, opts: Opts) {
    this.el = el;
    this.opts = opts;
    // Compact (scrubber): the strip fills the whole control height as a pill, so it
    // nests in the dock like every other control. Time labels sit inside it.
    if (opts.compact) this.m = { t: 0, r: 0, b: 0, l: 0 };
    this.svg = d3.select(el).append("svg").attr("class", `ribbon${opts.compact ? " ribbon--strip" : ""}`).attr("role", "img");
    const clipId = `strip-clip-${++clipSeq}`;
    const defs = this.svg.append("defs");
    this.clipRect = defs.append("clipPath").attr("id", clipId).append("rect");
    this.track = this.svg.append("rect").attr("class", "strip-track").style("display", opts.compact ? "inline" : "none");
    this.gAreas = this.svg.append("g");
    if (opts.compact) this.gAreas.attr("clip-path", `url(#${clipId})`);
    this.gLabels = this.svg.append("g").attr("class", "direct-labels");
    this.gAxis = this.svg.append("g").attr("class", "axis");
    this.marker = this.svg.append("line").attr("class", "time-marker").style("display", "none");
    this.knob = this.svg.append("g").attr("class", "playhead").style("display", "none");
    // Playhead: a rounded handle that sits inside the strip, like a video scrubber.
    this.knob.append("rect").attr("class", "playhead__handle").attr("x", -3.5).attr("width", 7).attr("rx", 3.5);
    this.cursor = this.svg.append("line").attr("class", "cursor").style("display", "none");
    this.overlay = this.svg.append("rect").attr("fill", "transparent").style("cursor", "crosshair");
    let dragging = false;
    const scrubTo = (ev: PointerEvent) => {
      const [mx] = d3.pointer(ev, this.svg.node());
      this.opts.scrub?.(Math.max(0, Math.min(1439, this.x.invert(mx))));
    };
    if (opts.scrub) this.overlay.style("cursor", "ew-resize");
    this.overlay
      .on("pointerdown", (ev: PointerEvent) => {
        if (!this.opts.scrub) return;
        dragging = true;
        (ev.target as Element).setPointerCapture(ev.pointerId);
        scrubTo(ev);
      })
      .on("pointerup pointercancel", () => (dragging = false))
      .on("pointermove", (ev: PointerEvent) => {
        if (dragging) scrubTo(ev);
        this.hover(ev);
      })
      .on("pointerleave", () => {
        this.cursor.style("display", "none");
        this.hoverCat = null;
        this.paintHighlight();
        tooltip.hide();
        this.opts.onHover?.(null);
      });
    new ResizeObserver(() => this.render(false)).observe(el);
  }

  update(grid: Grid | null, layer: Layer, animate = true) {
    const first = !this.grid && !!grid && !this.opts.compact;
    this.grid = grid;
    this.layer = layer;
    this.render(animate);
    if (first) {
      // First data: the day draws itself from 4 a.m. to 4 a.m. (CSS wipe; off under reduced motion).
      const node = this.svg.node()!;
      node.classList.remove("is-revealing");
      void node.getBoundingClientRect();
      node.classList.add("is-revealing");
    }
  }

  setTime(minute: number | null) {
    this.minute = minute;
    if (minute === null) {
      this.marker.style("display", "none");
      this.knob.style("display", "none");
      return;
    }
    const x = this.x(minute);
    if (this.opts.compact) {
      // Keep the whole handle inside the rounded strip.
      // Keep the handle clear of the pill's rounded ends.
      const inset = (this.opts.height - this.m.t - this.m.b) / 2 - 4;
      const cx = Math.max(this.m.l + inset, Math.min(this.width - this.m.r - inset, x));
      this.knob.style("display", null).attr("transform", `translate(${cx},0)`);
      return;
    }
    this.marker.style("display", null).attr("x1", x).attr("x2", x);
  }

  highlight(cat: number | null) {
    this.hoverCat = cat;
    this.paintHighlight();
  }

  private stackData() {
    const g = this.grid!;
    const rows = d3.range(NBINS).map((b) => {
      const r: Record<string, number> = { b };
      g.forEach((row, c) => (r[c] = row[b] / 10000));
      return r;
    });
    const keys = g.map((_, c) => String(c)).reverse(); // first category (sleep / home / alone) on top
    return d3.stack<Record<string, number>>().keys(keys)(rows);
  }

  private render(animate: boolean) {
    this.width = Math.max(this.opts.compact ? 120 : 280, this.el.clientWidth);
    const { t, r, b, l } = this.m;
    const h = this.opts.height;
    this.svg.attr("viewBox", `0 0 ${this.width} ${h}`).attr("width", this.width).attr("height", h);
    this.x.domain([0, 1440]).range([l, this.width - r]);
    this.y.domain([0, 1]).range([h - b, t]);
    this.overlay.attr("x", l).attr("y", t).attr("width", this.width - l - r).attr("height", h - t - b);
    this.cursor.attr("y1", t).attr("y2", h - b);
    this.marker.attr("y1", t).attr("y2", h - b);
    if (this.opts.compact) {
      const stripH = h - t - b;
      const radius = stripH / 2;
      for (const r0 of [this.clipRect, this.track]) r0.attr("x", l).attr("y", t).attr("width", this.width - l - r).attr("height", stripH).attr("rx", radius);
      this.knob.select("rect").attr("y", t + 6).attr("height", stripH - 12);
    }
    if (this.minute !== null) this.setTime(this.minute);

    const narrow = this.width < 520;
    const ax = this.gAxis.selectAll<SVGGElement, null>("g.x").data([null]).join("g").attr("class", "x");
    if (this.opts.compact) {
      // The strip carries no axis: its shape shows the day, the big clock shows the
      // time, and hovering gives the exact slot.
      ax.selectAll("*").remove();
    } else {
      ax.attr("transform", `translate(0,${h - b})`);
      ax.call(d3.axisBottom(this.x).tickValues(narrow ? TICKS.filter((_, i) => i % 2 === 0) : TICKS)
        .tickFormat((d) => clockLabel(+d, true)).tickSizeOuter(0));
    }
    const ay = this.gAxis.selectAll<SVGGElement, null>("g.y").data([null]).join("g").attr("class", "y")
      .attr("transform", `translate(${l},0)`);
    if (this.opts.compact) ay.selectAll("*").remove();
    else ay.call(d3.axisLeft(this.y).ticks(4).tickFormat(d3.format(".0%")).tickSize(0).tickPadding(8));

    // The empty track only shows while data loads; once bands cover it, it would just fringe the edges.
    if (this.opts.compact) this.track.style("display", this.grid ? "none" : "inline");
    if (!this.grid) {
      this.gAreas.selectAll("path").remove();
      this.gLabels.selectAll("text").remove();
      return;
    }
    const series = this.stackData();
    const xAt = (i: number) => this.x(i * 10 + 5);
    const area = d3.area<d3.SeriesPoint<Record<string, number>>>()
      .x((_, i) => (i === 0 ? this.x(0) : i === NBINS - 1 ? this.x(1440) : xAt(i))).y0((d) => this.y(d[0])).y1((d) => this.y(d[1])).curve(d3.curveMonotoneX);
    const keys = CATEGORY_LABELS[this.layer];
    const order = Object.keys(keys);
    const catOf = (s: d3.Series<Record<string, number>, string>) => Number(s.key);

    const paths = this.gAreas.selectAll<SVGPathElement, d3.Series<Record<string, number>, string>>("path")
      .data(series, (s) => `${this.layer}-${s.key}`)
      .join("path")
      .attr("class", "band")
      .attr("fill", (s) => colorFor(this.layer, order[catOf(s)]))
      .attr("data-cat", (s) => catOf(s));
    (animate ? paths.transition().duration(450) : paths).attr("d", area);

    // Direct labels at each band's thickest point, only where they fit.
    const candidates = this.opts.compact ? [] : series.flatMap((s) => {
      let best = -1, bi = 0;
      s.forEach((d, i) => {
        if (i < 3 || i > NBINS - 4) return;
        const th = this.y(d[0]) - this.y(d[1]);
        if (th > best) (best = th), (bi = i);
      });
      const name = keys[order[catOf(s)]];
      const fits = best >= 15 && name.length * 7.6 < (this.width - l - r) * 0.3;
      return fits ? [{ cat: catOf(s), x: xAt(bi), y: (this.y(s[bi][0]) + this.y(s[bi][1])) / 2, name, th: best }] : [];
    });
    // Greedy de-collision: thickest bands claim their spot first; skip any label that overlaps.
    const anchorX = (d: { x: number }) => (d.x < l + 60 ? 0 : d.x > this.width - r - 60 ? 1 : 0.5);
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const labels = candidates.sort((p, q) => q.th - p.th).filter((d) => {
      const w = d.name.length * 7.6 + 6;
      const x0 = d.x - anchorX(d) * w;
      const box = { x0, x1: x0 + w, y0: d.y - 8, y1: d.y + 8 };
      if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) return false;
      placed.push(box);
      return true;
    });
    this.gLabels.selectAll<SVGTextElement, (typeof labels)[number]>("text")
      .data(labels, (d) => `${this.layer}-${d.cat}`)
      .join("text")
      .attr("text-anchor", (d) => ["start", "middle", "end"][anchorX(d) * 2])
      .attr("dominant-baseline", "middle")
      .text((d) => d.name)
      .attr("x", (d) => d.x)
      .attr("y", (d) => d.y);
    this.paintHighlight();
  }

  private paintHighlight() {
    const hc = this.hoverCat;
    this.gAreas.selectAll<SVGPathElement, unknown>("path.band")
      .classed("dim", function () {
        return hc !== null && Number((this as SVGPathElement).dataset.cat) !== hc;
      });
  }

  private hover(ev: PointerEvent) {
    if (!this.grid) return;
    const [mx, my] = d3.pointer(ev, this.svg.node());
    const minute = Math.max(0, Math.min(1439, this.x.invert(mx)));
    const bin = Math.min(NBINS - 1, Math.floor(minute / 10));
    const xm = this.x(bin * 10 + 5);
    this.cursor.style("display", null).attr("x1", xm).attr("x2", xm);
    // Which band is under the pointer?
    const share = this.y.invert(my);
    let acc = 0, under: number | null = null;
    for (let c = this.grid.length - 1; c >= 0; c--) {
      // stack order is reversed: last category at the bottom
      acc += this.grid[c][bin] / 10000;
      if (share <= acc) {
        under = c;
        break;
      }
    }
    this.hoverCat = under;
    this.paintHighlight();
    const keys = CATEGORY_LABELS[this.layer];
    const order = Object.keys(keys);
    const rows = this.grid
      .map((row, c) => ({ c, v: row[bin] }))
      .filter((d) => d.v > 0)
      .map((d) => `<tr class="${d.c === under ? "hl" : ""}"><td><span class="sw" style="background:${colorFor(this.layer, order[d.c])}"></span>${keys[order[d.c]]}</td><td class="num">${pct(d.v)}</td></tr>`)
      .join("");
    tooltip.show(ev, `<div class="tt-title">${clockLabel(bin * 10)} – ${clockLabel(bin * 10 + 10)}</div><table>${rows}</table>`);
    this.opts.onHover?.(bin * 10 + 5);
  }
}
