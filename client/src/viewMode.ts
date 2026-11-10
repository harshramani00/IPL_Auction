// 3D hall or classic layout. Defaults to 3D where the device can take it;
// the viewer's own choice is remembered per browser.
import { useSyncExternalStore } from "react";

export type ViewMode = "3d" | "classic";
const KEY = "ar-view";

function supportsWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

/** Classic for reduced motion, no WebGL2, or a low-memory device. */
function defaultMode(): ViewMode {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (reduced || !supportsWebGL2() || (memory !== undefined && memory <= 2)) return "classic";
  return "3d";
}

function read(): ViewMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "3d" || v === "classic") return v;
  } catch { /* private mode */ }
  return defaultMode();
}

let mode: ViewMode | null = null;
const listeners = new Set<() => void>();

export function setViewMode(next: ViewMode, remember = true): void {
  mode = next;
  if (remember) {
    try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
  }
  listeners.forEach((l) => l());
}

export function useViewMode(): ViewMode {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => (mode ??= read()),
  );
}

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
