import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        ink: {
          950: "#05070d",
          900: "#0a0f1c",
          800: "#111829",
        },
        signal: {
          DEFAULT: "#5eead4",
          dim: "#2dd4bf",
        },
      },
      boxShadow: {
        "glow-critical": "0 0 18px -2px rgba(244, 63, 94, 0.55)",
        "glow-high": "0 0 18px -2px rgba(251, 146, 60, 0.5)",
        "glow-moderate": "0 0 16px -3px rgba(250, 204, 21, 0.4)",
        "glow-low": "0 0 16px -3px rgba(52, 211, 153, 0.4)",
        "glow-signal": "0 0 22px -4px rgba(94, 234, 212, 0.6)",
        glass: "0 24px 48px -24px rgba(0, 0, 0, 0.75), inset 0 1px 0 0 rgba(255, 255, 255, 0.06)",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.8)", opacity: "0.8" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        "rise-in": {
          "0%": { transform: "translateY(6px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        drift: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(3%, -2%, 0) scale(1.06)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 2s cubic-bezier(0.2, 0.6, 0.4, 1) infinite",
        "rise-in": "rise-in 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        drift: "drift 26s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
