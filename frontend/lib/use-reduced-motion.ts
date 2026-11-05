const STORAGE_KEY = "shadowguard:reduce-motion";

/** The header's animations button: read the viewer's saved choice. */
export function loadReducedMotion(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Switches off motion for the whole page (see `.reduce-motion` in globals.css) and remembers the choice. */
export function applyReducedMotion(reduced: boolean) {
  document.documentElement.classList.toggle("reduce-motion", reduced);
  try {
    localStorage.setItem(STORAGE_KEY, reduced ? "1" : "0");
  } catch {
    /* The button still works for this visit. */
  }
}
