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

for (const [f, script] of [['rhwp.js', 'build-wasm.sh'], ['rhwp_bg.wasm', 'build-wasm.sh'], ['fmt_docx.js', 'build-docx-wasm.sh'], ['fmt_docx_bg.wasm', 'build-docx-wasm.sh']]) {
  if (!existsSync(join(wasmDir, f))) {
    console.error(`src/wasm/${f}가 없다. 먼저 scripts/${script}를 실행하라 (npm run build:wasm).`);
    process.exit(1);
  }
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'assets'), { recursive: true });

const result = await build({
  entryPoints: {
    main: join(web, 'src/main.js'),
    worker: join(web, 'src/worker.js'),
    docxworker: join(web, 'src/docx-worker.js'),
    editor: join(web, 'src/editor.js'),        // 편집(지연 로딩): 첫 화면 예산에 들어가지 않는다
    hwpedit: join(web, 'src/hwp-edit.js'),
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
// 배포 산출물의 파일명에는 업스트림 이름을 쓰지 않는다 (PRD 8.8). 출처 표기는 /licenses에 있다.
const wasmName = `engine-${wasmHash.slice(0, 10)}.wasm`;
writeFileSync(join(dist, 'assets', wasmName), wasmBytes);
out.wasm = `/assets/${wasmName}`;

// DOCX 엔진(fmt-docx = office_oxide 어댑터). 지연 로딩이라 첫 화면 전송량에는 들어가지 않는다.
const docxBytes = readFileSync(join(wasmDir, 'fmt_docx_bg.wasm'));
const docxName = `docx-${createHash('sha256').update(docxBytes).digest('hex').slice(0, 10)}.wasm`;
writeFileSync(join(dist, 'assets', docxName), docxBytes);
out.docxwasm = `/assets/${docxName}`;

let buildInfo = '';
try {
  const bi = JSON.parse(readFileSync(join(wasmDir, 'BUILD_INFO.json'), 'utf8'));
  buildInfo = `엔진 빌드: rhwp ${bi.rhwpCommit.slice(0, 7)}${bi.rhwpPatches?.length ? `+패치${bi.rhwpPatches.length}` : ''} · wasm ${bi.wasmSha256.slice(0, 10)}`;
} catch { buildInfo = `엔진 빌드: wasm ${wasmHash.slice(0, 10)}`; }

const fill = (s) => s
  .replaceAll('%MAIN%', out.main).replaceAll('%WORKER%', out.worker).replaceAll('%THEME%', out.theme)
  .replaceAll('%CSS%', out.styles).replaceAll('%WASM%', out.wasm)
  .replaceAll('%EDITOR%', out.editor).replaceAll('%HWP_EDIT%', out.hwpedit).replaceAll('%DOCX_WORKER%', out.docxworker).replaceAll('%DOCX_WASM%', out.docxwasm).replaceAll('%BUILD_INFO%', buildInfo);
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
// 배포물에 LGPL 개발 의존성 흔적이 없는지 확인한다 (D-028). 있으면 빌드 실패.
await import('./check-dist.mjs');
