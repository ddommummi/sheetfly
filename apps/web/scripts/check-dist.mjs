// 배포물(dist)에 LGPL 개발 의존성의 흔적이 있으면 종료 코드 1.
// 배경: wrangler → miniflare → sharp가 선택적으로 @img/sharp-libvips-*(LGPL-3.0-or-later)를 설치한다.
// 개발 전용이라 허용하되(docs/decisions.md D-028) 배포물에는 절대 들어가면 안 된다.
// `lgpl` 같은 짧은 문자열은 WASM 안의 무관한 표(언어 코드 등)에도 우연히 나오므로 검사하지 않는다.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
const pathBad = /libvips|sharp/i;
const markers = ['libvips', 'GNU Lesser General Public', 'LGPL-', 'LGPL '].map((m) => [m, Buffer.from(m)]);

function* walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const found = [];
let n = 0;
for (const p of walk(dist)) {
  n++;
  const rel = relative(dist, p);
  if (pathBad.test(rel)) found.push(`${rel}: 파일 이름`);
  const buf = readFileSync(p);
  for (const [m, b] of markers) if (buf.includes(b)) found.push(`${rel}: "${m}" 포함`);
}
if (found.length) {
  console.error(`배포물에 LGPL 흔적 ${found.length}건 (개발 의존성은 dist에 들어가면 안 된다, D-028):`);
  for (const f of found) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`LGPL 검사 통과: dist ${n}개 파일에서 libvips/LGPL 흔적 없음`);
