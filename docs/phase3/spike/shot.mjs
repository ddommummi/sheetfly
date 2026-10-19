import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pageSvg } from './dl2svg.mjs';
const require = createRequire('/home/user/sheetfly/apps/web/');
const { chromium } = require('playwright-core');
const [,, dlPath, outPrefix] = process.argv;
const dl = JSON.parse(readFileSync(dlPath, 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
for (const [i, pg] of dl.pages.entries()) {
  const svg = pageSvg(pg);
  writeFileSync(`${outPrefix}-p${i}.svg`, svg);
  const blobHtml = `<body style="margin:0;background:#888"><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}"></body>`;
  await page.setViewportSize({ width: Math.ceil(pg.width), height: Math.ceil(pg.height) });
  await page.setContent(blobHtml);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${outPrefix}-p${i}.png` });
}
await browser.close();
console.log('pages', dl.pages.length);
