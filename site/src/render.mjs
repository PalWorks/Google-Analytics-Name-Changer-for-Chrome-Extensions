/**
 * Render the listing site's Open Graph image at the exact size the social
 * scrapers expect (1200 x 630). Run: node site/src/render.mjs
 */
import { chromium } from '/home/palani/.nvm/versions/node/v22.23.2/lib/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(SRC, '..');
fs.mkdirSync(OUT, { recursive: true });

const W = 1200, H = 630;
const browser = await chromium.launch({
  executablePath: '/home/palani/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + path.join(SRC, 'og.html'));
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

const el = await page.$('.stage');
const box = await el.boundingBox();
await el.screenshot({ path: path.join(OUT, 'og-image.png') });
await browser.close();

const ok = Math.round(box.width) === W && Math.round(box.height) === H;
console.log((ok ? 'OK  ' : 'SIZE') + '  og-image.png  ' + Math.round(box.width) + 'x' + Math.round(box.height) +
            (ok ? '' : '  EXPECTED ' + W + 'x' + H) + (errs.length ? '  ERRORS: ' + errs.join('; ') : ''));
