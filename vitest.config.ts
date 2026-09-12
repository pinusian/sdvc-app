import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    exclude: ["**/node_modules/**", "**/e2e/**"],
    // 기본 5초는 이 기계에 빠듯하다 — 무거운 라우트를 처음 불러오는 데만
    // 그만큼 걸린다. 진짜로 멈춘 것과 그저 느린 것은 여전히 구별된다.
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
