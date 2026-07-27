/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// GitHub Pages 는 https://<user>.github.io/<repo>/ 하위에 배포되므로 base 를 맞춰야 한다.
// 저장소 이름이 다르면 .env 의 VITE_BASE_PATH 로 덮어쓴다.
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE_PATH ?? (mode === "production" ? "/choco-ads-dashboard/" : "/"),
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
}));
