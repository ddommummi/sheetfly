// docx-engine 파싱 경로를 변형별로 번들해 크기를 잰다. 변형: full → -tiff → -emf → +jszip-shim
//   node trim-bundle.mjs   (cwd 무관, ../bundle 작업공간을 쓴다)
import { build } from './work/node_modules/esbuild/lib/main.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const root = here + 'work/';
mkdirSync(here + 'out/variants', { recursive: true });
const stub = (name, src) => { const p = here + 'out/variants/' + name; writeFileSync(p, src); return p; };
const tiffStub = stub('utif2-stub.mjs', 'export default { decode(){ throw new Error("tiff disabled") }, decodeImage(){ throw new Error("tiff disabled") }, toRGBA8(){ throw new Error("tiff disabled") } };\n');
const emfStub = stub('emf-stub.mjs', 'export const DEFAULT_DPI_SCALE = 1; export async function convertEmfToDataUrl(){ return null } export async function convertWmfToDataUrl(){ return null }\n');
const shim = here + 'jszip-shim.mjs';

function plugin({ tiff, emf, jszip }) {
  return { name: 'trim', setup(b) {
    if (tiff) b.onResolve({ filter: /^utif2$/ }, () => ({ path: tiffStub }));
    if (emf) b.onResolve({ filter: /emf-converter\/index\.mjs$/ }, () => ({ path: emfStub }));
    if (jszip) b.onResolve({ filter: /^jszip$/ }, () => ({ path: shim }));
  } };
}
const sizes = (file) => { const b = readFileSync(file); return { raw: b.length, gzip: gzipSync(b, { level: 9 }).length, brotli: brotliCompressSync(b).length }; };
const rows = [];
const variants = [
  ['V0 full (parse)',                 'entry-parse.ts',      {}],
  ['V1 −TIFF',                        'entry-parse.ts',      { tiff: true }],
  ['V2 −TIFF −EMF',                   'entry-parse.ts',      { tiff: true, emf: true }],
  ['V3 −TIFF −EMF +JSZip shim',       'entry-parse.ts',      { tiff: true, emf: true, jszip: true }],
  ['S0 full (parse+save)',            'entry-parse-save.ts', {}],
  ['S2 −TIFF −EMF (parse+save)',      'entry-parse-save.ts', { tiff: true, emf: true }],
];
for (const [label, entry, opt] of variants) {
  const out = here + 'out/variants/' + label.split(' ')[0] + '.js';
  await build({ entryPoints: [root + entry], bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: out, plugins: [plugin(opt)], logLevel: 'error', absWorkingDir: root });
  rows.push({ label, ...sizes(out), file: out });
}
// 분리해서 따로 받을 조각: EMF 변환기, TIFF(utif2)
const lazy = [];
for (const [label, src] of [['EMF/WMF 변환기(지연 청크)', root + 'packages/docx-engine/src/vendor/emf-converter/index.mjs'], ['TIFF utif2(지연 청크)', root + 'node_modules/utif2/UTIF.js']]) {
  const out = here + 'out/variants/lazy-' + label.slice(0, 3) + '.js';
  await build({ entryPoints: [src], bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: out, logLevel: 'error', absWorkingDir: root, ...(src.endsWith('UTIF.js') ? { format: 'esm' } : {}) });
  lazy.push({ label, ...sizes(out) });
}
const f = (n) => n.toLocaleString('en-US');
console.log('| 변형 | raw | gzip | brotli |\n|---|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.label} | ${f(r.raw)} | ${f(r.gzip)} | ${f(r.brotli)} |`);
console.log('\n| 지연 청크(필요할 때만) | raw | gzip | brotli |\n|---|---:|---:|---:|');
for (const r of lazy) console.log(`| ${r.label} | ${f(r.raw)} | ${f(r.gzip)} | ${f(r.brotli)} |`);
writeFileSync(here + 'out/variants/sizes.json', JSON.stringify({ rows, lazy }));
