// Shared Chrome discovery for the `test/ui/*.mjs` browser scripts.
//
// These scripts are Windows-only, manual, and outside the gate (`test/render.mjs`
// is the SSR half). The documented default is the system Chrome install path, but
// a machine may have no system-wide Chrome at all — the Playwright-bundled
// Chromium is an equally good target. Discover it by directory rather than pinning
// a revision: the bundled revision changes with every Playwright release.
//
// DSH_GIT_UI_CHROME always wins when set.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function findChrome() {
  const explicit = process.env.DSH_GIT_UI_CHROME;
  if (explicit !== undefined && explicit !== "") return explicit;
  if (process.env.LOCALAPPDATA !== undefined) {
    const cache = join(process.env.LOCALAPPDATA, "ms-playwright");
    if (existsSync(cache)) {
      const revisions = readdirSync(cache)
        .filter((name) => name.startsWith("chromium-"))
        .sort()
        .reverse();
      for (const revision of revisions) {
        const candidate = join(cache, revision, "chrome-win64", "chrome.exe");
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return "C:/Program Files/Google/Chrome/Application/chrome.exe";
}
