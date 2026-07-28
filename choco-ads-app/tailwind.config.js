/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#12131A",
          muted: "#5C606E",
          faint: "#8C90A0",
        },
        line: "#E3E5EC",
        surface: {
          DEFAULT: "#FFFFFF",
          sunken: "#F6F7FA",
          raised: "#FFFFFF",
        },
        brand: {
          50: "#EEF3FE",
          100: "#D9E4FD",
          500: "#2F5FE0",
          600: "#2450C6",
          700: "#1C3F9E",
        },
        good: { DEFAULT: "#0E8A5F", soft: "#E6F5EF" },
        bad: { DEFAULT: "#C8352F", soft: "#FCEBEA" },
        warn: { DEFAULT: "#B5730E", soft: "#FDF3E3" },
      },
      fontFamily: {
        sans: ["Pretendard Variable", "Pretendard", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["11px", "16px"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(18,19,26,0.04), 0 0 0 1px rgba(18,19,26,0.05)",
      },
    },
  },
  plugins: [],
};
