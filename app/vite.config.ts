import { defineConfig } from "vite";

export default defineConfig({
  base: "./", // static build works from any subpath
  build: { target: "es2022" },
  optimizeDeps: { exclude: ["@duckdb/duckdb-wasm"] },
});
