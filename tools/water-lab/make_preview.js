// Renders assets/figures/water-lab-preview.png (1200 x 1200) from a real Live Water Lab run in headless Chromium:
// start, select a central molecule, pull it with the arrow keys for about 1 ps, pause, capture the viewport.
// Usage: node tools/water-lab/make_preview.js http://127.0.0.1:8765/
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 632, height: 1200 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(BASE + 'lab/water/?test=1', { waitUntil: 'networkidle' });
  await p.click('.wl-start-big');
  await p.waitForFunction(() => window.__waterLab && window.__waterLab.ready && window.__waterLab.snap, null, { timeout: 90000 });
  await p.waitForTimeout(1500);
  await p.$eval('#wl-k', (e) => { e.value = '3'; e.dispatchEvent(new Event('input', { bubbles: true })); });   // firm tether, 3.47 N/m
  await p.focus('.wl-canvas');
  await p.keyboard.press('n');
  await p.waitForTimeout(500);
  for (let i = 0; i < 10; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100); }
  await p.waitForFunction(() => window.__waterLab.snap.pulling && Math.hypot(...window.__waterLab.snap.Ftether) * 69.477 > 380, null, { timeout: 60000 });
  await p.click('.wl-pause');
  await p.waitForTimeout(600);
  const box = await p.locator('.wl-canvas').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.wheel(0, -420);                               // zoom in about the cell centre (about 1.9x)
  await p.waitForTimeout(400);
  await p.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__waterLabClean = true; window.__waterLab.redraw(); });
  await p.waitForTimeout(300);
  const out = path.resolve(__dirname, '../../assets/figures/water-lab-preview.png');
  await p.locator('.wl-canvas').screenshot({ path: out, clip: undefined });
  const { execFileSync } = require('child_process');
  execFileSync('python3', ['-c', `from PIL import Image; im=Image.open('${out}'); w,h=im.size; im.crop((0,(h-1200)//2,1200,(h-1200)//2+1200)).save('${out}', optimize=True)`]);
  console.log('wrote', out);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
