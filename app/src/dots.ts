import { CATEGORY_LABELS, NBINS, colorFor, type Layer } from "./config";

const UI_FONT = `"Inter Variable", system-ui, sans-serif`;

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// ---- Tuning (per 60 fps frame) ----
/** How quickly a settled dot eases into its spot (higher = snappier, no overshoot). */
const SETTLE = 0.14;
/** Travel speed in px/frame at the midpoint of a trip. */
const TRAVEL_SPEED = 3.2;
/** Long trips bend toward the ring's center so they share paths; short hops stay gentle arcs. */
const PATH_BUNDLE = 0.3;
/** Extra bow to the traveller's right (share of trip length): A→B and B→A use separate lanes. */
const PATH_BOW = 0.05;
/** Spread of travellers around the shared path (px), so a busy route reads as a stream. */
const LANE_WIDTH = 3;
/** Minimum clear space between neighbouring blobs (px), leaving room for labels. */
const BLOB_GAP = 30;
const CENTER_EASE = 0.06;

interface Cluster {
  x: number;
  y: number;
  r: number;
  count: number;
  ux: number;
  uy: number;
}

/**
 * Canvas animation of ~1,000 resampled diaries.
 *
 * - Every settled dot sits on its own spot of a sunflower spiral, so blobs are
 *   crisp grains of distinct dots, and their size is the headline.
 * - Spots are sticky: a dot that stays never moves.
 * - Particles are interchangeable carriers of anonymous diaries. When k diaries
 *   leave A for B, the k dots on A's rim facing B carry them, so blobs erode on
 *   the side people head toward. Arrivals take B's free spots facing where they
 *   came from.
 * - Each diary switches at its own moment within a 10-minute bin, so movement
 *   trickles instead of pulsing.
 * - Travellers follow a shared, slightly bundled path per route; no trails.
 * - Blob centers are pushed apart so neighbouring blobs never touch.
 */
export class Dots {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private states: Uint8Array[] = [];
  private layer: Layer = "act";
  private n = 0;
  // Per particle
  private diary = new Int32Array(0);
  private cur = new Int16Array(0);
  private slot = new Int32Array(0);
  private moving = new Uint8Array(0);
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private x0 = new Float32Array(0);
  private y0 = new Float32Array(0);
  private s = new Float32Array(0);
  private lane = new Float32Array(0);
  // Per diary
  private phase = new Float32Array(0);
  // Per cluster
  private clusters: Cluster[] = [];
  private cx = new Float32Array(0);
  private cy = new Float32Array(0);
  private cr = new Float32Array(0);
  private spacing = 4;
  private dotR = 2;
  private w = 800;
  private hgt = 520;
  private colors: string[] = [];
  private ink = { primary: "#000", secondary: "#555" };
  private raf = 0;
  private calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private flows = true;
  minute = 0;

  constructor(el: HTMLElement) {
    this.el = el;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "dots";
    this.canvas.setAttribute("role", "img");
    el.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    this.refreshTheme();
  }

  refreshTheme() {
    const cs = getComputedStyle(document.documentElement);
    this.ink = { primary: cs.getPropertyValue("--text-1").trim(), secondary: cs.getPropertyValue("--text-2").trim() };
    this.colors = Object.keys(CATEGORY_LABELS[this.layer]).map((k) => colorFor(this.layer, k));
  }

  /** Show (true) or fade (false) dots that are travelling between blobs. */
  setFlows(on: boolean) {
    this.flows = on;
  }

  setSample(states: Uint8Array[]) {
    const n = states.length;
    if (n !== this.n) {
      this.n = n;
      const jitter = (s: number, c: number) => new Float32Array(n).map(() => c + (Math.random() - 0.5) * s);
      this.px = jitter(60, this.w / 2);
      this.py = jitter(60, this.hgt / 2);
      this.x0 = new Float32Array(n);
      this.y0 = new Float32Array(n);
      this.s = new Float32Array(n);
      this.moving = new Uint8Array(n);
      this.lane = new Float32Array(n).map(() => (Math.random() - 0.5) * 2 * LANE_WIDTH);
    }
    this.states = states;
    this.diary = Int32Array.from({ length: n }, (_, i) => i);
    this.phase = new Float32Array(n).map(() => Math.random() * 10);
    this.cur = new Int16Array(n).fill(-1);
    this.slot = new Int32Array(n).fill(-1);
    this.sync(true);
  }

  setLayer(layer: Layer, states: Uint8Array[]) {
    this.layer = layer;
    this.refreshTheme();
    this.cx = new Float32Array(0);
    this.setSample(states);
  }

  setMinute(m: number) {
    this.minute = m;
    this.sync(false);
  }

  start() {
    if (this.raf) return;
    const tick = () => {
      this.step();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  counts(): number[] {
    return this.clusters.map((c) => c.count);
  }

  private resize() {
    this.w = Math.max(300, this.el.clientWidth);
    this.hgt = Math.round(Math.min(620, Math.max(380, this.w * 0.62)));
    const dpr = devicePixelRatio || 1;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.hgt * dpr;
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.hgt}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.spacing = Math.max(2.6, Math.min(4.4, Math.min(this.w, this.hgt) / 125));
    this.dotR = Math.max(1.3, Math.min(2.1, Math.min(this.w, this.hgt) / 260));
    this.placeClusters();
  }

  /** Category of diary d now; each diary switches within ±5 min of the bin edge. */
  private stateOfDiary(d: number): number {
    const b = Math.min(NBINS - 1, Math.max(0, Math.floor((this.minute + this.phase[d] - 5) / 10)));
    return this.states[d][b];
  }

  /** Offset of sunflower spot k from its blob's center. */
  private offset(k: number): [number, number] {
    const rr = this.spacing * Math.sqrt(k + 0.5);
    return [rr * Math.cos(k * GOLDEN), rr * Math.sin(k * GOLDEN)];
  }

  /** Target centers on a ring, clamped to the canvas, then pushed apart so blobs keep a clear gap. */
  private placeClusters() {
    const K = Object.keys(CATEGORY_LABELS[this.layer]).length;
    const counts = new Array(K).fill(0);
    for (let i = 0; i < this.n; i++) if (this.cur[i] >= 0) counts[this.cur[i]]++;
    const ccx = this.w / 2, ccy = this.hgt / 2 + 6;
    const R = Math.min(this.w * 0.36, this.hgt * 0.36);
    const cl: Cluster[] = counts.map((count, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / K;
      return {
        x: ccx + R * Math.cos(a) * (this.w > this.hgt ? 1.25 : 1),
        y: ccy + R * Math.sin(a),
        r: this.spacing * Math.sqrt(count + 0.5),
        count,
        ux: Math.cos(a),
        uy: Math.sin(a),
      };
    });
    const clamp = (c: Cluster) => {
      c.x = Math.max(c.r + 8, Math.min(this.w - c.r - 8, c.x));
      c.y = Math.max(c.r + 44, Math.min(this.hgt - c.r - 38, c.y));
    };
    for (let iter = 0; iter < 40; iter++) {
      cl.forEach(clamp);
      let moved = false;
      for (let i = 0; i < K; i++)
        for (let j = i + 1; j < K; j++) {
          const a = cl[i], b = cl[j];
          if (!a.count || !b.count) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.01;
          const need = a.r + b.r + BLOB_GAP - d;
          if (need <= 0) continue;
          moved = true;
          // Bigger blobs move less.
          const wa = b.r / (a.r + b.r), wb = a.r / (a.r + b.r);
          a.x -= (dx / d) * need * wa;
          a.y -= (dy / d) * need * wa;
          b.x += (dx / d) * need * wb;
          b.y += (dy / d) * need * wb;
        }
      if (!moved) break;
    }
    cl.forEach(clamp);
    this.clusters = cl;
    if (this.cx.length !== K) {
      this.cx = Float32Array.from(cl, (c) => c.x);
      this.cy = Float32Array.from(cl, (c) => c.y);
      this.cr = Float32Array.from(cl, (c) => c.r);
    }
  }

  /**
   * Fill each blob's spots 0..N-1. Dots keep their spot when it still exists;
   * everyone else (arrivals, plus stayers stranded past a shrunken rim) takes a
   * free spot, preferring the side they approach from.
   */
  private assignSlots() {
    const K = this.clusters.length;
    const members: number[][] = Array.from({ length: K }, () => []);
    for (let p = 0; p < this.n; p++) members[this.cur[p]].push(p);
    members.forEach((ids, c) => {
      const N = ids.length;
      const taken = new Uint8Array(N);
      const need: number[] = [];
      for (const p of ids) {
        const k = this.slot[p];
        if (k >= 0 && k < N && !taken[k]) taken[k] = 1;
        else need.push(p);
      }
      if (!need.length) return;
      const free: number[] = [];
      for (let k = 0; k < N; k++) if (!taken[k]) free.push(k);
      const fo = free.map((k) => this.offset(k));
      const used = new Uint8Array(free.length);
      const ox = this.clusters[c].x, oy = this.clusters[c].y;
      for (const p of need) {
        // Direction this dot approaches from: where its trip started, or where it sits now.
        const fx0 = this.moving[p] ? this.x0[p] : this.px[p], fy0 = this.moving[p] ? this.y0[p] : this.py[p];
        let ux = fx0 - ox, uy = fy0 - oy;
        const len = Math.hypot(ux, uy) || 1;
        ux /= len;
        uy /= len;
        let best = -1, bestScore = -Infinity;
        for (let j = 0; j < free.length; j++) {
          if (used[j]) continue;
          const [fx, fy] = fo[j];
          // Prefer spots facing the approach; among those, inner ones first.
          const sc = fx * ux + fy * uy - 0.35 * Math.hypot(fx, fy);
          if (sc > bestScore) (bestScore = sc), (best = j);
        }
        used[best] = 1;
        this.slot[p] = free[best];
      }
    });
  }

  private depart(p: number, dest: number) {
    this.cur[p] = dest;
    this.moving[p] = 1;
    this.slot[p] = -1;
    this.x0[p] = this.px[p];
    this.y0[p] = this.py[p];
    this.s[p] = 0;
  }

  /** Move diaries whose category changed, peeling dots off the rim that faces each destination. */
  private sync(force: boolean) {
    const n = this.n;
    if (!n) return;
    if (force) {
      for (let p = 0; p < n; p++) {
        this.cur[p] = this.stateOfDiary(this.diary[p]);
        this.moving[p] = 0;
        this.slot[p] = -1;
      }
      this.placeClusters();
      this.assignSlots();
      return;
    }
    const byOrigin = new Map<number, number[]>();
    let any = false;
    for (let p = 0; p < n; p++) {
      const ns = this.stateOfDiary(this.diary[p]);
      if (ns === this.cur[p]) continue;
      any = true;
      if (this.moving[p]) {
        this.depart(p, ns); // changed course mid-trip
        continue;
      }
      const a = this.cur[p];
      if (!byOrigin.has(a)) byOrigin.set(a, []);
      byOrigin.get(a)!.push(p);
    }
    if (!any) return;

    for (const [a, leaving] of byOrigin) {
      const pool: number[] = [];
      for (let p = 0; p < n; p++) if (this.cur[p] === a && !this.moving[p]) pool.push(p);
      const ax = this.cx[a], ay = this.cy[a];
      const departures = leaving.map((p) => ({ d: this.diary[p], dest: this.stateOfDiary(this.diary[p]) }));
      const chosen = new Set<number>();
      const carrier = new Map<number, { d: number; dest: number }>();
      for (const dep of departures) {
        let ux = this.cx[dep.dest] - ax, uy = this.cy[dep.dest] - ay;
        const len = Math.hypot(ux, uy) || 1;
        ux /= len;
        uy /= len;
        let best = -1, bestScore = -Infinity;
        for (const p of pool) {
          if (chosen.has(p)) continue;
          const sc = (this.px[p] - ax) * ux + (this.py[p] - ay) * uy;
          if (sc > bestScore) (bestScore = sc), (best = p);
        }
        chosen.add(best);
        carrier.set(best, dep);
      }
      // Staying diaries displaced from chosen dots move into unchosen dots whose diary left.
      const leavingSet = new Set(leaving);
      const homeless = [...chosen].filter((p) => !leavingSet.has(p)).map((p) => this.diary[p]);
      leaving.filter((p) => !chosen.has(p)).forEach((p, i) => (this.diary[p] = homeless[i]));
      for (const [p, dep] of carrier) {
        this.diary[p] = dep.d;
        this.depart(p, dep.dest);
      }
    }
    this.placeClusters();
    this.assignSlots();
  }

  /** Control point of a trip's quadratic curve. */
  private control(sx: number, sy: number, tx: number, ty: number): [number, number] {
    const hubX = this.w / 2, hubY = this.hgt / 2 + 6;
    const mx = (sx + tx) / 2, my = (sy + ty) / 2;
    const lx = tx - sx, ly = ty - sy;
    const len = Math.hypot(lx, ly) || 1;
    const pull = PATH_BUNDLE * Math.min(1, len / (Math.min(this.w, this.hgt) * 0.6));
    const bow = PATH_BOW * len;
    return [mx + (hubX - mx) * pull - (ly / len) * bow, my + (hubY - my) * pull + (lx / len) * bow];
  }

  /** Advance one animation frame (public so dev tooling can drive it while hidden). */
  step() {
    const { ctx, n } = this;
    const K = this.clusters.length;
    this.clusters.forEach((c, k) => {
      this.cx[k] += (c.x - this.cx[k]) * CENTER_EASE;
      this.cy[k] += (c.y - this.cy[k]) * CENTER_EASE;
      this.cr[k] += (c.r - this.cr[k]) * CENTER_EASE;
    });

    for (let p = 0; p < n; p++) {
      const c = this.cur[p];
      if (c < 0) continue;
      const [ox, oy] = this.slot[p] >= 0 ? this.offset(this.slot[p]) : [0, 0];
      const tx = this.cx[c] + ox, ty = this.cy[c] + oy;
      if (this.moving[p]) {
        const sx = this.x0[p], sy = this.y0[p];
        const [kx, ky] = this.control(sx, sy, tx, ty);
        const len = Math.hypot(tx - sx, ty - sy) || 1;
        const ease = 0.35 + 1.3 * Math.sin(Math.PI * Math.min(0.999, this.s[p]));
        this.s[p] = Math.min(1, this.s[p] + (this.calm ? 3 : 1) * (TRAVEL_SPEED / (len * 1.15)) * ease);
        const t = this.s[p], u = 1 - t;
        const lane = this.lane[p] * Math.sin(Math.PI * t);
        const nx = -(ty - sy) / len, ny = (tx - sx) / len;
        this.px[p] = u * u * sx + 2 * u * t * kx + t * t * tx + nx * lane;
        this.py[p] = u * u * sy + 2 * u * t * ky + t * t * ty + ny * lane;
        if (t >= 1) this.moving[p] = 0;
      } else {
        this.px[p] += (tx - this.px[p]) * SETTLE;
        this.py[p] += (ty - this.py[p]) * SETTLE;
      }
    }

    ctx.clearRect(0, 0, this.w, this.hgt);
    const r = this.dotR;
    // Blobs first, then travellers on top.
    for (const travelling of [0, 1]) {
      if (travelling) ctx.globalAlpha = this.flows ? 0.9 : 0.12;
      for (let k = 0; k < K; k++) {
        ctx.fillStyle = this.colors[k];
        ctx.beginPath();
        for (let p = 0; p < n; p++) {
          if (this.cur[p] !== k || this.moving[p] !== travelling) continue;
          ctx.moveTo(this.px[p] + r, this.py[p]);
          ctx.arc(this.px[p], this.py[p], r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Labels ride the eased centers.
    const labels = Object.values(CATEGORY_LABELS[this.layer]);
    const small = this.w < 560;
    ctx.textBaseline = "middle";
    // Biggest blobs claim label space first; smaller ones nudge up/down to fit, or skip.
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    const lineGap = small ? 15 : 17;
    const order = this.clusters.map((_, k) => k).sort((a, b) => this.clusters[b].count - this.clusters[a].count);
    for (const k of order) {
      const c = this.clusters[k];
      if (!c.count && small) continue;
      const d = Math.max(this.cr[k], 6) + 10;
      const x = this.cx[k] + c.ux * d, y = this.cy[k] + c.uy * d;
      const centered = Math.abs(c.ux) < 0.3;
      const pctText = n ? `${((100 * c.count) / n).toFixed(1)}%` : "";
      ctx.font = `600 ${small ? 13 : 14}px ${UI_FONT}`;
      const wLabel = ctx.measureText(labels[k]).width;
      ctx.font = `500 13px ${UI_FONT}`;
      const wPct = ctx.measureText(pctText).width;
      const wMax = Math.max(wLabel, wPct);
      const anchor = centered ? 0.5 : c.ux > 0 ? 0 : 1;
      const left = Math.max(4, Math.min(this.w - 4 - wMax, x - anchor * wMax));
      const baseY = centered ? y + (c.uy > 0 ? 8 : -14) : y - 6;
      let yy = -1;
      for (const dy of [0, -16, 16, -32, 32]) {
        const ty = Math.max(12, Math.min(this.hgt - 30, baseY + dy));
        const box = { l: left - 3, r: left + wMax + 3, t: ty - 9, b: ty + lineGap + 9 };
        if (!placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t)) {
          placed.push(box);
          yy = ty;
          break;
        }
      }
      if (yy < 0) continue;
      const lineX = (wd: number) => left + anchor * (wMax - wd);
      ctx.textAlign = "left";
      ctx.font = `600 ${small ? 13 : 14}px ${UI_FONT}`;
      ctx.fillStyle = c.count ? this.ink.primary : this.ink.secondary;
      ctx.fillText(labels[k], lineX(wLabel), yy);
      ctx.font = `500 13px ${UI_FONT}`;
      ctx.fillStyle = this.ink.secondary;
      ctx.fillText(pctText, lineX(wPct), yy + lineGap);
    }
  }
}
