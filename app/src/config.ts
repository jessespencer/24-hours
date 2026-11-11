export type Layer = "act" | "loc" | "who";
export type Grid = number[][]; // [category][bin], basis points (1/100 of a percent)

export interface SliceResult {
  n: number;
  suppressed: boolean;
  act?: Grid;
  loc?: Grid;
  who?: Grid;
}

export interface Meta {
  source: string;
  built: string;
  latestYear: number;
  defaultYears: [number, number];
  minN: number;
  bin: number;
  layers: Record<Layer, string[]>;
  filters: Record<string, Record<string, string>>;
  sharesSql: string;
  nByYear: Record<string, number>;
}

export const FIRST_YEAR = 2003;
export const PANDEMIC_YEAR = 2020;
export const NBINS = 144;

export const LAYER_LABELS: Record<Layer, string> = {
  act: "Activity",
  loc: "Where",
  who: "With whom",
};

/**
 * Labels per category key. Colors live in style.css as --c-<layer>-<key> so the
 * dark theme can step them; colorFor() reads the live value.
 *
 * Activity palette: 12 hues in stack order, validated (dataviz validate_palette.js)
 * for adjacent-pair CVD separation >= 8.4 and normal-vision >= 15 in both themes.
 * Sleep and Eating were re-picked (navy vs teal) so they stay distinct when every
 * blob is on screen at once in the dots view (normal-vision ΔE >= 15.3).
 * "unknown" is a neutral gray fold-in, not a hue.
 */
export const CATEGORY_LABELS: Record<Layer, Record<string, string>> = {
  act: {
    sleep: "Sleep",
    personal_care: "Personal care",
    eating: "Eating & drinking",
    household: "Household",
    caring: "Caring for others",
    shopping: "Shopping & errands",
    work: "Work",
    education: "Education",
    travel: "Travel",
    socializing: "Socializing & community",
    leisure: "Leisure & screens",
    sports: "Sports & exercise",
    unknown: "Unrecorded",
  },
  loc: {
    home: "Home",
    other_home: "Someone else's home",
    workplace: "Workplace",
    stores: "Stores, restaurants, banks",
    other_place: "School, worship, gym, other",
    outdoors: "Outdoors",
    vehicle: "In a car",
    transit_walk: "Walking, transit, plane",
    not_recorded: "Not asked (sleep, grooming)",
  },
  who: {
    alone: "Alone",
    partner: "Spouse / partner",
    own_kids: "Own kids",
    family: "Other family",
    friends: "Friends",
    coworkers: "Coworkers & customers",
    others: "Others",
    not_recorded: "Not asked (sleep, grooming)",
  },
};

export const FILTER_LABELS: Record<string, { label: string; values: Record<string, string> }> = {
  sex: { label: "Sex", values: { all: "Everyone", m: "Men", f: "Women" } },
  age: {
    label: "Age",
    values: { all: "All ages (15+)", "15-24": "15–24", "25-34": "25–34", "35-44": "35–44", "45-54": "45–54", "55-64": "55–64", "65+": "65+" },
  },
  emp: {
    label: "Employment",
    values: { all: "Any", employed: "Employed", ft: "Employed full-time", pt: "Employed part-time", unemp: "Unemployed", nilf: "Not in labor force" },
  },
  kids: {
    label: "Kids in household",
    values: { all: "Any", none: "No kids under 18", any: "Any kids under 18", u6: "Youngest under 6", "6-12": "Youngest 6–12", "13-17": "Youngest 13–17" },
  },
  day: { label: "Day", values: { all: "Any day", weekday: "Weekdays", weekend: "Weekends", holiday: "Holidays" } },
};
export const DIMS = ["sex", "age", "emp", "kids", "day"] as const;
export type Dim = (typeof DIMS)[number];

export function colorFor(layer: Layer, key: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--c-${layer}-${key}`).trim() || "#888";
}

/** The visitor's wall-clock time as minutes since 4:00 a.m. (the diary day's start). */
export function nowMinute(d = new Date()): number {
  return (d.getHours() * 60 + d.getMinutes() - 240 + 1440) % 1440;
}

/** Weekday or weekend for the visitor's current diary day, which runs 4 a.m. to 4 a.m. */
export function todayDayType(d = new Date()): "weekday" | "weekend" {
  const dow = new Date(d.getTime() - 4 * 3600_000).getDay();
  return dow === 0 || dow === 6 ? "weekend" : "weekday";
}

/** Minutes since 4:00 a.m. -> "6:30 a.m." */
export function clockLabel(minute: number, short = false): string {
  const m = (240 + Math.round(minute)) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const ap = h24 < 12 ? "a.m." : "p.m.";
  if (short) return mm === 0 ? `${h} ${ap}` : `${h}:${String(mm).padStart(2, "0")}`;
  return `${h}:${String(mm).padStart(2, "0")} ${ap}`;
}

export const fmtInt = new Intl.NumberFormat("en-US");
export const pct = (bp: number, digits = 1) => `${(bp / 100).toFixed(digits)}%`;
/** Average hours/day in a category from a grid row (basis points per 10-min bin). */
export const hoursOf = (row: number[]) => row.reduce((a, b) => a + b, 0) / 10000 / 6;
