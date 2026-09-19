/**
 * Render the extension icon at every size Chrome asks for.
 *
 * The 16px toolbar rendering is the binding constraint: at that size only a
 * silhouette survives, so the glyph is drawn at two levels of detail rather
 * than scaled down from a single master.
 *
 * Concept: the substitution itself. The upper row is broken into segments, the
 * way a 32-character extension ID reads to a human; the lower row is one solid
 * bar, the way a name reads. Tag and card shapes were tried first and both
 * failed the size test: a horizontal tag reads as a back arrow at 32px, and a
 * card loses its upper row entirely at 16px.
 *
 * Run: node icons/src/icon.mjs
 */
import { chromium } from '/home/palani/.nvm/versions/node/v22.23.2/lib/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(SRC, '..');

// The accent used across the options page and every store asset.
const G1 = '#6C63F2', G2 = '#4338CA';
const S = 128;

/**
 * @param {number} px               rendered size
 * @param {'full'|'mark'} detail    'mark' drops to three fatter segments
 * @param {number} padPct           breathing room around the squircle
 * @param {boolean} plate           false renders the glyph alone, for the site
 */
function svg(px, detail, padPct, plate = true) {
  const pad = S * padPct;
  const box = S - pad * 2;
  const mark = detail === 'mark';

  // Both rows share a left edge, so the lower one reads as the upper one
  // replaced rather than as a separate object.
  const x = 30;
  const segs = mark ? [[x, 18], [x + 23, 26], [x + 55, 13]]
                    : [[x, 14], [x + 18, 22], [x + 44, 11], [x + 59, 15]];
  const segY = mark ? 40 : 43, segH = mark ? 11 : 9;
  const barY = mark ? 68 : 69, barH = mark ? 15 : 14, barW = mark ? 62 : 56;

  const glyph =
    segs.map(([sx, sw]) =>
      `<rect x="${sx}" y="${segY}" width="${sw}" height="${segH}" rx="${segH / 2}" fill="#fff" opacity=".5"/>`
    ).join('') +
    `<rect x="${x}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="#fff"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${G1}"/><stop offset="1" stop-color="${G2}"/>
    </linearGradient>
  </defs>
  ${plate ? `<rect x="${pad}" y="${pad}" width="${box}" height="${box}" rx="${box * 0.235}" fill="url(#g)"/>` : ''}
  ${glyph}
</svg>`;
}

const TARGETS = [
  { px: 16,  detail: 'mark', pad: 0.015, out: 'icon16.png'  },
  { px: 32,  detail: 'full', pad: 0.015, out: 'icon32.png'  },
  { px: 48,  detail: 'full', pad: 0.03,  out: 'icon48.png'  },
  { px: 128, detail: 'full', pad: 0.055, out: 'icon128.png' },
  { px: 512, detail: 'full', pad: 0.055, out: 'icon512.png' },
];

// Vector copies for the listing site and anything that wants to scale.
fs.writeFileSync(path.join(SRC, 'icon.svg'), svg(512, 'full', 0.055));
fs.writeFileSync(path.join(SRC, 'icon-mark.svg'), svg(512, 'full', 0, false));

const browser = await chromium.launch({
  executablePath: '/home/palani/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
});

for (const t of TARGETS) {
  const page = await browser.newPage({ viewport: { width: t.px, height: t.px }, deviceScaleFactor: 1 });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>` +
    svg(t.px, t.detail, t.pad)
  );
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(OUT, t.out), omitBackground: true });
  await page.close();
  console.log('OK   ' + t.out.padEnd(14) + t.px + 'x' + t.px + '  (' + t.detail + ')');
}

await browser.close();
