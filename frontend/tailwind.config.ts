import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    // Replaces Tailwind's palette, so a colour outside .clauderules generates no CSS.
    colors: {
      transparent: "transparent",
      current: "currentColor",
      white: "#ffffff",
      // The dim layer behind a dialog: the ground colour, not pure black.
      scrim: "var(--scrim)",
      ground: "var(--ground)",
      surface: "var(--surface)",
      header: {
        DEFAULT: "var(--header)",
        line: "var(--header-line)",
        warning: "var(--header-warning)",
        "warning-line": "var(--header-warning-line)",
        danger: "var(--header-danger)",
        "danger-line": "var(--header-danger-line)",
        data: "var(--header-data)",
        "data-line": "var(--header-data-line)",
        positive: "var(--header-positive)",
        "positive-line": "var(--header-positive-line)",
      },
      raised: "var(--raised)",
      "raised-hover": "var(--raised-hover)",
      "row-hover": "var(--row-hover)",
      "danger-fill": "var(--danger-fill)",
      "danger-fill-hover": "var(--danger-fill-hover)",
      line: "var(--border)",
      rule: "var(--rule)",
      control: "var(--control)",
      ink: "var(--text)",
      ink2: "var(--text-2)",
      muted: "var(--muted)",
      accent: "var(--accent)",
      data: "var(--data)",
      sev: {
        critical: "var(--sev-critical)",
        high: "var(--sev-high)",
        moderate: "var(--sev-moderate)",
        low: "var(--sev-low)",
      },
      positive: "var(--positive)",
      negative: "var(--negative)",
      warning: "var(--warning)",
      tone: {
        danger: "var(--pill-negative-bg)",
        "danger-line": "var(--pill-negative-line)",
        "danger-ink": "var(--pill-negative-ink)",
        warning: "var(--pill-warning-bg)",
        "warning-line": "var(--pill-warning-line)",
        "warning-ink": "var(--pill-warning-ink)",
        info: "var(--pill-info-bg)",
        "info-line": "var(--pill-info-line)",
        "info-ink": "var(--pill-info-ink)",
        success: "var(--pill-positive-bg)",
        "success-line": "var(--pill-positive-line)",
        "success-ink": "var(--pill-positive-ink)",
        neutral: "var(--pill-neutral-bg)",
        "neutral-line": "var(--pill-neutral-line)",
        "neutral-ink": "var(--pill-neutral-ink)",
      },
      heat: {
        1: "var(--heat-1)",
        2: "var(--heat-2)",
        3: "var(--heat-3)",
      },
    },
    fontSize: {
      xs: ["12px", "16px"],
      sm: ["13px", "20px"],
      base: ["14px", "20px"],
      md: ["16px", "22px"],
      lg: ["20px", "26px"],
      title: ["26px", "32px"],
      kpi: ["32px", "36px"],
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-public-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      keyframes: {
        "rise-in": {
          "0%": { transform: "translateY(6px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "slide-in": {
          "0%": { transform: "translateY(-10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "drawer-in": {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
        "fade-out": {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        travel: {
          "0%": { offsetDistance: "0%", opacity: "0" },
          "8%": { opacity: "1" },
          "92%": { opacity: "1" },
          "100%": { offsetDistance: "100%", opacity: "0" },
        },
        // Liveness: once per server answer, never on a timer of its own.
        beat: {
          "0%": { scale: "1", opacity: "0.8" },
          "100%": { scale: "3.2", opacity: "0" },
        },
        countdown: {
          "0%": { scale: "0 1" },
          "100%": { scale: "1 1" },
        },
        land: {
          "0%": { scale: "0.3", opacity: "0.9" },
          "100%": { scale: "2.6", opacity: "0" },
        },
        arrive: {
          "0%": { translate: "0 -6px", opacity: "0", backgroundColor: "var(--raised)" },
          "20%": { translate: "0 0", opacity: "1", backgroundColor: "var(--raised)" },
          "100%": { backgroundColor: "transparent" },
        },
        // Charts drawing in as their data arrives. Most start from nothing and end at the
        // element's own value, so one keyframe serves every bar, segment and needle.
        wipe: {
          "0%": { clipPath: "inset(0 100% 0 0)" },
          "100%": { clipPath: "inset(0 0 0 0)" },
        },
        "grow-up": { "0%": { scale: "1 0" } },
        "grow-x": { "0%": { scale: "0 1" } },
        pop: { "0%": { scale: "0", opacity: "0" } },
        sweep: { "0%": { strokeDasharray: "0 400" } },
        needle: { "0%": { rotate: "0deg" } },
        draw: {
          "0%": { strokeDasharray: "1 1", strokeDashoffset: "1" },
          "100%": { strokeDasharray: "1 1", strokeDashoffset: "0" },
        },
      },
      animation: {
        "rise-in": "rise-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "slide-in": "slide-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "fade-in": "fade-in 120ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "fade-out": "fade-out 120ms ease-in both",
        "drawer-in": "drawer-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "scale-in": "scale-in 120ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        travel: "travel 1400ms ease-in-out both",
        // A decelerating curve, so marks settle like something with weight. `backwards` hands each
        // element back its own style when the animation ends, so later changes can transition.
        beat: "beat 900ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        // A clock, so it runs at an even pace. The interval is set inline from the poll.
        countdown: "countdown 4000ms linear both",
        land: "land 700ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        arrive: "arrive 2400ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        wipe: "wipe 900ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        "grow-up": "grow-up 600ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        "grow-x": "grow-x 700ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        pop: "pop 420ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        sweep: "sweep 1000ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        needle: "needle 1000ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        draw: "draw 900ms cubic-bezier(0.65, 0, 0.35, 1) backwards",
      },
    },
  },
  plugins: [
    // `dense:` styles the one-screen Overview: on `.one-screen` and inside it, and only on a window
    // wide and tall enough to hold every block. Anything smaller keeps the scrolling layout.
    plugin(({ addVariant }) =>
      addVariant("dense", [
        "@media (min-width: 1280px) and (min-height: 740px) { &.one-screen }",
        "@media (min-width: 1280px) and (min-height: 740px) { .one-screen & }",
      ]),
    ),
  ],
};

export default config;
