export type Theme = "dark" | "light";

const STORAGE_KEY = "shadowguard:theme";

/** Read the viewer's saved theme choice, defaulting to dark if none is stored. */
export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* Storage may be unavailable in private browsing modes. */
  }
  return "dark";
}

/** Switches the root theme class (`html.light` / `html.dark`) and remembers the choice. */
export function applyTheme(theme: Theme, persist = true) {
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* The theme toggle still works for this visit. */
    }
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    const ground = getComputedStyle(root).getPropertyValue("--ground").trim();
    if (ground) meta.content = ground;
  }
}
