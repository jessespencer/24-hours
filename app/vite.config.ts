import { defineConfig } from "vite";

// Served as a GitHub Pages project site at https://jessedestroys.com/24-hours/.
// The base must match the repo name; data fetches use import.meta.env.BASE_URL.
export default defineConfig({
  base: "/24-hours/",
  build: { target: "es2022" },
  optimizeDeps: { exclude: ["@duckdb/duckdb-wasm"] },
});
