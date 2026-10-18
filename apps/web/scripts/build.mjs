// 웹 앱 빌드: esbuild로 번들(해시 파일명) → dist/ 구성.
//   dist/index.html, licenses.html, 404.html, favicon.svg, _headers
//   dist/assets/{main,worker,theme}-<hash>.js, styles-<hash>.css, rhwp_bg-<hash>.wasm
//   dist/{LICENSE,NOTICE,THIRD_PARTY_LICENSES}.txt  ← 최소화로 소스 주석이 사라지므로 별도 파일로 제공 (PRD 8.3)
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(web, '../..');
const dist = join(web, 'dist');
const wasmDir = join(web, 'src/wasm');

for (const f of ['rhwp.js', 'rhwp_bg.wasm']) {
  if (!existsSync(join(wasmDir, f))) {
    console.error(`src/wasm/${f}가 없다. 먼저 scripts/build-wasm.sh를 실행하라 (npm run build:wasm).`);
    process.exit(1);
  }
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'assets'), { recursive: true });

const result = await build({
  entryPoints: {
    main: join(web, 'src/main.js'),
    worker: join(web, 'src/worker.js'),
    theme: join(web, 'src/theme.js'),
    styles: join(web, 'src/styles.css'),
  },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  entryNames: '[name]-[hash]',
  outdir: join(dist, 'assets'),
  metafile: true,
  logLevel: 'warning',
});

const out = {};
for (const file of Object.keys(result.metafile.outputs)) {
  const name = basename(file);
  out[name.split('-')[0]] = `/assets/${name}`;
}

const wasmBytes = readFileSync(join(wasmDir, 'rhwp_bg.wasm'));
const wasmHash = createHash('sha256').update(wasmBytes).digest('hex');
const wasmName = `rhwp_bg-${wasmHash.slice(0, 10)}.wasm`;
writeFileSync(join(dist, 'assets', wasmName), wasmBytes);
out.wasm = `/assets/${wasmName}`;

let buildInfo = '';
try {
  const bi = JSON.parse(readFileSync(join(wasmDir, 'BUILD_INFO.json'), 'utf8'));
  buildInfo = `엔진 빌드: rhwp ${bi.rhwpCommit.slice(0, 7)} · wasm ${bi.wasmSha256.slice(0, 10)}`;
} catch { buildInfo = `엔진 빌드: wasm ${wasmHash.slice(0, 10)}`; }

const fill = (s) => s
  .replaceAll('%MAIN%', out.main).replaceAll('%WORKER%', out.worker).replaceAll('%THEME%', out.theme)
  .replaceAll('%CSS%', out.styles).replaceAll('%WASM%', out.wasm).replaceAll('%BUILD_INFO%', buildInfo);
for (const f of ['index.html', 'licenses.html', '404.html']) {
  writeFileSync(join(dist, f), fill(readFileSync(join(web, f), 'utf8')));
}
for (const f of readdirSync(join(web, 'public'))) cpSync(join(web, 'public', f), join(dist, f));
for (const f of ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES']) {
  cpSync(join(repo, f), join(dist, `${f}.txt`));
}

// 크기 요약
const size = (p) => statSync(p).size;
const lines = [];
for (const [k, v] of Object.entries(out)) lines.push(`${k.padEnd(7)} ${String(size(join(dist, v))).padStart(10)}  ${v}`);
console.log(lines.join('\n'));
writeFileSync(join(dist, 'BUILD_ASSETS.json'), JSON.stringify(out, null, 2));
console.log('dist 준비 완료');
