/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// GitHub Pages 는 https://<user>.github.io/<repo>/ 하위에 배포된다.
// GitHub Actions 가 넣어주는 VITE_BASE_PATH(예: /choco-ads-app/) 를 base 로 쓰고,
// 없으면 상대경로("./")로 떨어뜨려 어떤 하위 경로에서도 자원을 찾게 한다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: env.VITE_BASE_PATH || (mode === "production" ? "./" : "/"),
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"],
    },
  };
});
