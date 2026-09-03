// Inspect the composer dock region: how the cost-meter line and the dsh-git
// line are laid out (stacked? overlapping? same row?).
import { chromium } from "playwright-core";
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:3080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(5000);

const studyRow = page.locator('div[class*=projectRow]', { hasText: "study-后台" }).first();
if (await studyRow.count() > 0) { await studyRow.click(); await page.waitForTimeout(1200); }
const rows = page.locator('div[class*=sessionRow]');
const n = await rows.count();
for (let i = 0; i < n; i++) {
  const text = (await rows.nth(i).textContent()).trim();
  if (text.length > 3 && !text.startsWith("新会话")) { await rows.nth(i).click(); break; }
}
await page.waitForTimeout(4500);

const dockInfo = await page.evaluate(() => {
  const out = [];
  // Find the composer-dock footer container: locate the git dock element and
  // walk up to its parent, then describe all children.
  const gitDock = document.querySelector('[data-dsh-git="dock"]');
  if (!gitDock) return { found: false };
  let container = gitDock.parentElement;
  // climb to the footer wrapper (the composer.dock slot container)
  for (let i = 0; i < 4 && container; i++) {
    if ((container.children.length >= 2 && container.textContent.includes("本会话")) || container.querySelectorAll("*").length > 10) break;
    container = container.parentElement;
  }
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
      cls: String(el.className).slice(0, 40),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      display: cs.display, position: cs.position
    };
  };
  const walk = (el, depth) => {
    if (!el || depth > 3) return;
    out.push(describe(el));
    for (const child of el.children) walk(child, depth + 1);
  };
  walk(container, 0);
  return { found: true, containerText: (container.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200), tree: out.slice(0, 20) };
});
console.log(JSON.stringify(dockInfo, null, 1));
await browser.close();
