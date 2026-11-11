import * as duckdb from "@duckdb/duckdb-wasm";
import ehWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import mvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import { DIMS, NBINS, type Grid, type Layer, type Meta, type SliceResult } from "./config";
import { sliceKey, type Slice } from "./state";

const base = import.meta.env.BASE_URL;

export class Data {
  meta!: Meta;
  private pre: Record<string, SliceResult> = {};
  private cache = new Map<string, Promise<SliceResult>>();
  private conn?: duckdb.AsyncDuckDBConnection;
  private ready?: Promise<void>;
  /** Serialize queries: one connection, one statement at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  async loadStatic() {
    const [meta, pre] = await Promise.all([
      fetch(`${base}data/meta.json`).then((r) => r.json()),
      fetch(`${base}data/slices.json`).then((r) => r.json()),
    ]);
    this.meta = meta;
    this.pre = pre;
  }

  /** Start DuckDB-WASM and load the per-respondent Parquet files (~20 MB). */
  startEngine(onProgress?: (msg: string) => void): Promise<void> {
    this.ready ??= (async () => {
      onProgress?.("Starting DuckDB…");
      const bundle = await duckdb.selectBundle({
        mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
        eh: { mainModule: ehWasm, mainWorker: ehWorker },
      });
      const worker = new Worker(bundle.mainWorker!);
      const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      onProgress?.("Downloading diaries…");
      const files = ["respondents", "episodes"];
      const bufs = await Promise.all(files.map((f) => fetch(`${base}data/${f}.parquet`).then((r) => r.arrayBuffer())));
      await Promise.all(files.map((f, i) => db.registerFileBuffer(`${f}.parquet`, new Uint8Array(bufs[i]))));
      this.conn = await db.connect();
      onProgress?.("Indexing…");
      for (const f of files) await this.conn.query(`create table ${f} as select * from '${f}.parquet'`);
      onProgress?.("");
    })();
    return this.ready;
  }

  get engineReady() {
    return !!this.conn;
  }

  private async sql<T = Record<string, unknown>>(q: string): Promise<T[]> {
    await this.startEngine();
    const run = this.queue.then(() => this.conn!.query(q));
    this.queue = run.catch(() => undefined);
    const table = await run;
    return table.toArray().map((r) => r.toJSON() as T);
  }

  where(s: Slice, ignoreYears = false): string {
    const preds = ignoreYears ? ["true"] : [`year between ${s.y0} and ${s.y1}`];
    for (const d of DIMS) if (s[d] !== "all") preds.push(this.meta.filters[d][s[d]]);
    return preds.join(" and ");
  }

  hasPrecomputed(s: Slice) {
    return sliceKey(s) in this.pre;
  }

  /** Weighted shares per 10-minute bin for one slice and layer. */
  shares(s: Slice, layer: Layer): Promise<SliceResult> {
    const key = `${sliceKey(s)}#${layer}`;
    const pre = this.pre[sliceKey(s)];
    if (pre) return Promise.resolve(pre);
    if (!this.cache.has(key)) this.cache.set(key, this.computeShares(s, layer));
    return this.cache.get(key)!;
  }

  /** Always runs the SQL (bypasses the precomputed cache). */
  async computeShares(s: Slice, layer: Layer): Promise<SliceResult> {
    const where = this.where(s);
    const [{ n }] = await this.sql<{ n: bigint }>(`select count(*) as n from respondents where ${where}`);
    const count = Number(n);
    if (count < this.meta.minN) return { n: count, suppressed: true };
    const q = this.meta.sharesSql
      .replaceAll("{where}", where)
      .replaceAll("{layer}", layer)
      .replaceAll("{BIN}", String(this.meta.bin));
    const rows = await this.sql<{ cat: number; bin: bigint | number; share: number }>(q);
    const grid: Grid = this.meta.layers[layer].map(() => new Array(NBINS).fill(0));
    for (const r of rows) grid[r.cat][Number(r.bin)] = Math.round(r.share * 10000);
    return { n: count, suppressed: false, [layer]: grid };
  }

  /** Per-year grids for the Years view, honoring every filter except the year range. */
  async byYear(s: Slice, layer: Layer): Promise<Map<number, SliceResult>> {
    const out = new Map<number, SliceResult>();
    const isDefault = DIMS.every((d) => s[d] === "all");
    const years: number[] = [];
    for (let y = 2003; y <= this.meta.latestYear; y++) years.push(y);
    if (isDefault) {
      for (const y of years) out.set(y, this.pre[sliceKey({ ...s, y0: y, y1: y })]);
      return out;
    }
    const results = await Promise.all(years.map((y) => this.shares({ ...s, y0: y, y1: y }, layer)));
    years.forEach((y, i) => out.set(y, results[i]));
    return out;
  }

  /**
   * Resampled, anonymized diaries for the dot animation: `k` respondents drawn
   * with probability proportional to their final weight (Efraimidis–Spirakis),
   * identifiers dropped, and each diary coarsened to the state at the middle of
   * every 10-minute bin. Returned in random order.
   */
  async sampleDiaries(s: Slice, k = 1000): Promise<{ n: number; states: Record<Layer, Uint8Array[]> } | null> {
    const where = this.where(s);
    const [{ n }] = await this.sql<{ n: bigint }>(`select count(*) as n from respondents where ${where}`);
    if (Number(n) < this.meta.minN) return { n: Number(n), states: { act: [], loc: [], who: [] } };
    const rows = await this.sql<{ rid: number; start: number; stop: number; act: number; loc: number; who: number }>(`
      with pick as (select rid from respondents where ${where} order by -ln(random()) / w limit ${k})
      select e.rid, e.start, e.stop, e.act, e.loc, e.who from episodes e join pick using (rid) order by e.rid, e.start`);
    const byRid = new Map<number, typeof rows>();
    for (const r of rows) {
      if (!byRid.has(r.rid)) byRid.set(r.rid, []);
      byRid.get(r.rid)!.push(r);
    }
    const states: Record<Layer, Uint8Array[]> = { act: [], loc: [], who: [] };
    const diaries = [...byRid.values()].sort(() => Math.random() - 0.5);
    for (const eps of diaries) {
      const a = new Uint8Array(NBINS), l = new Uint8Array(NBINS), w = new Uint8Array(NBINS);
      let j = 0;
      for (let b = 0; b < NBINS; b++) {
        const m = b * 10 + 5;
        while (j < eps.length - 1 && eps[j].stop <= m) j++;
        a[b] = eps[j].act;
        l[b] = eps[j].loc;
        w[b] = eps[j].who;
      }
      states.act.push(a);
      states.loc.push(l);
      states.who.push(w);
    }
    return { n: Number(n), states };
  }
}
