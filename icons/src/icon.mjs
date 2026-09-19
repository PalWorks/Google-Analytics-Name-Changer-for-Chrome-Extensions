/**
 * Render the extension icon at every size Chrome asks for.
 *
 * Run: node icons/src/icon.mjs
 *
 * CONCEPT: an extension puzzle piece with analytics bars inside it. The two
 * halves of what this tool is: a Chrome extension (the puzzle piece is the
 * universal symbol for one) and Google Analytics reporting (ascending bars, in
 * the warm amber that reads as analytics rather than as our own indigo).
 *
 * ON TRADEMARKS: this deliberately does NOT reproduce the Chrome Web Store logo
 * or the Google Analytics logo. Both are Google marks, and putting either inside
 * a third-party extension's icon invites a rejection under the store's
 * impersonation and intellectual-property policy, and implies an endorsement
 * that does not exist. A puzzle piece and a bar chart are generic shapes that
 * carry the same meaning and belong to nobody. Keep it that way.
 *
 * ON SIZES: the 16px toolbar rendering is the binding constraint. At that size
 * only a silhouette survives, so the glyph is drawn at two levels of detail
 * rather than scaled down from one master: the small one gets a larger piece
 * and two fatter bars, because three thin bars turn to mush.
 */
import { chromium } from '/home/palani/.nvm/versions/node/v22.23.2/lib/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(SRC, '..');
const S = 128;   // design grid

const DEFS = `<defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6C63F2"/><stop offset="1" stop-color="#4338CA"/>
    </linearGradient>
    <linearGradient id="a" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#E37400"/><stop offset="1" stop-color="#FBBC04"/>
    </linearGradient>
  </defs>`;

const plate = pad => {
  const p = S * pad, b = S - p * 2;
  return `<rect x="${p}" y="${p}" width="${b}" height="${b}" rx="${b * 0.235}" fill="url(#g)"/>`;
};

/** Generic extension puzzle piece: knob on top, socket on the left. */
function puzzle(x, y, w, h, fill, r) {
  const kn = w * 0.155;
  const cx = x + w * 0.5;
  return `<path fill="${fill}" fill-rule="evenodd" d="
    M ${x + r} ${y + kn}
    H ${cx - kn * 1.15}
    a ${kn} ${kn} 0 0 1 ${kn * 2.3} 0
    H ${x + w - r} a ${r} ${r} 0 0 1 ${r} ${r}
    V ${y + h - r} a ${r} ${r} 0 0 1 -${r} ${r}
    H ${x + r} a ${r} ${r} 0 0 1 -${r} -${r}
    V ${y + h * 0.60 + kn} a ${kn} ${kn} 0 0 0 0 -${kn * 2.3}
    V ${y + kn + r} a ${r} ${r} 0 0 1 ${r} -${r} Z"/>`;
}

function bars(x, y, w, h, heights) {
  const n = heights.length, bw = w / (n * 1.72), gap = (w - bw * n) / (n - 1);
  return heights.map((f, i) => {
    const bh = h * f;
    return `<rect x="${x + i * (bw + gap)}" y="${y + h - bh}" width="${bw}" height="${bh}" rx="${bw * 0.34}" fill="url(#a)"/>`;
  }).join('');
}

/**
 * @param {number} px               rendered size
 * @param {'full'|'mark'} detail    'mark' is the 16px simplification
 * @param {number} padPct           breathing room around the squircle
 * @param {boolean} withPlate       false renders the glyph alone, for the site
 */
function svg(px, detail, padPct, withPlate = true) {
  const mark = detail === 'mark';
  const x = mark ? 22 : 26, y = mark ? 26 : 28;
  const w = mark ? 86 : 78, h = mark ? 78 : 74;
  const r = mark ? 11 : 10;

  const glyph = puzzle(x, y, w, h, '#fff', r) + (mark
    ? bars(x + 18, y + 26, w - 34, h - 40, [0.55, 1])
    : bars(x + 17, y + 24, w - 32, h - 36, [0.42, 0.7, 1]));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${S} ${S}">
  ${DEFS}
  ${withPlate ? plate(padPct) : ''}
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
