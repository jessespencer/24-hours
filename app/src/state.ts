import { DIMS, type Dim, type Layer } from "./config";

export type View = "day" | "ribbon" | "compare" | "years";
export type Theme = "auto" | "light" | "dark";

export interface Slice {
  y0: number;
  y1: number;
  sex: string;
  age: string;
  emp: string;
  kids: string;
  day: string;
}

export interface AppState {
  view: View;
  layer: Layer;
  a: Slice;
  b: Slice;
  t: number; // minutes since 4:00 a.m.
  live: boolean; // t follows the visitor's local clock
  speed: number;
  playing: boolean;
  flows: boolean; // show dots travelling between blobs
  year: number;
  win: string; // compare window
  theme: Theme;
}

/** Canonical key shared with the pipeline's slices.json. */
export const sliceKey = (s: Slice) => `${s.y0}-${s.y1}|${DIMS.map((d) => s[d]).join("|")}`;

const encodeSlice = (s: Slice) => [`${s.y0}-${s.y1}`, ...DIMS.map((d) => s[d])].join(",");

function decodeSlice(v: string | null, fallback: Slice): Slice {
  if (!v) return fallback;
  const [yr, ...rest] = v.split(",");
  const [y0, y1] = yr.split("-").map(Number);
  const s: Slice = { ...fallback };
  if (y0 && y1) Object.assign(s, { y0: Math.min(y0, y1), y1: Math.max(y0, y1) });
  DIMS.forEach((d: Dim, i) => {
    if (rest[i]) s[d] = rest[i];
  });
  return s;
}

type Listener = (s: AppState, changed: Set<keyof AppState>) => void;

export class Store {
  state: AppState;
  private listeners: Listener[] = [];

  constructor(defaults: AppState) {
    const p = new URLSearchParams(location.search);
    const num = (k: string, d: number) => (p.has(k) && !Number.isNaN(Number(p.get(k))) ? Number(p.get(k)) : d);
    this.state = {
      view: (p.get("v") as View) || defaults.view,
      layer: (p.get("layer") as Layer) || defaults.layer,
      a: decodeSlice(p.get("a"), defaults.a),
      b: decodeSlice(p.get("b"), defaults.b),
      t: num("t", defaults.t),
      // A link with an explicit time is a frozen moment; without one, follow the clock.
      live: defaults.live && !p.has("t"),
      speed: num("speed", defaults.speed),
      playing: false,
      flows: p.get("flows") !== "0",
      year: num("year", defaults.year),
      win: p.get("win") || defaults.win,
      theme: (p.get("theme") as Theme) || defaults.theme,
    };
  }

  on(fn: Listener) {
    this.listeners.push(fn);
  }

  set(patch: Partial<AppState>) {
    const changed = new Set<keyof AppState>();
    for (const [k, v] of Object.entries(patch) as [keyof AppState, unknown][]) {
      if (JSON.stringify(this.state[k]) !== JSON.stringify(v)) changed.add(k);
    }
    if (!changed.size) return;
    this.state = { ...this.state, ...patch };
    this.writeUrl();
    this.listeners.forEach((fn) => fn(this.state, changed));
  }

  private urlTimer = 0;
  private writeUrl() {
    clearTimeout(this.urlTimer);
    this.urlTimer = window.setTimeout(() => {
      const s = this.state;
      const p = new URLSearchParams();
      p.set("v", s.view);
      p.set("layer", s.layer);
      p.set("a", encodeSlice(s.a));
      if (s.view === "compare") {
        p.set("b", encodeSlice(s.b));
        p.set("win", s.win);
      }
      if (s.view === "years") p.set("year", String(s.year));
      if (!s.live) p.set("t", String(Math.round(s.t)));
      if (!s.flows) p.set("flows", "0");
      if (s.speed !== 1) p.set("speed", String(s.speed));
      if (s.theme !== "auto") p.set("theme", s.theme);
      history.replaceState(null, "", `${location.pathname}?${p.toString().replaceAll("%2C", ",")}`);
    }, 150);
  }
}
