/**
 * Render every store asset to store/assets/ at its exact required size.
 *
 * Chrome Web Store sizes:
 *   small promo tile   440 x 280
 *   marquee promo tile 1400 x 560
 *   screenshots        1280 x 800
 *
 * Run: node store/src/render.mjs
 */
import { chromium } from '/home/palani/.nvm/versions/node/v22.23.2/lib/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(SRC, '..', 'assets');
fs.mkdirSync(OUT, { recursive: true });

const TARGETS = [
  { file: 'tile-small.html',   out: 'promo-tile-small-440x280.png',   w: 440,  h: 280 },
  { file: 'tile-marquee.html', out: 'promo-tile-marquee-1400x560.png', w: 1400, h: 560 },
  ...[1, 2, 3, 4, 5].map(n => ({
    file: `shot-${n}.html`, out: `screenshot-${n}-1280x800.png`, w: 1280, h: 800
  }))
];

const only = process.argv.slice(2);
const list = only.length ? TARGETS.filter(t => only.some(o => t.file.includes(o))) : TARGETS;

const browser = await chromium.launch({
  executablePath: '/home/palani/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
});

for (const t of list) {
  const src = path.join(SRC, t.file);
  if (!fs.existsSync(src)) { console.log('skip (missing):', t.file); continue; }

  const page = await browser.newPage({ viewport: { width: t.w, height: t.h }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + src);
  // Webfonts must be in before the shot, or the layout is measured on fallbacks
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  const el = await page.$('.stage');
  const box = await el.boundingBox();
  await el.screenshot({ path: path.join(OUT, t.out) });
  await page.close();

  const ok = Math.round(box.width) === t.w && Math.round(box.height) === t.h;
  console.log(
    (ok ? 'OK  ' : 'SIZE') + '  ' + t.out.padEnd(34) +
    Math.round(box.width) + 'x' + Math.round(box.height) +
    (ok ? '' : '  EXPECTED ' + t.w + 'x' + t.h) +
    (errs.length ? '  ERRORS: ' + errs.join('; ') : '')
  );
}

await browser.close();
