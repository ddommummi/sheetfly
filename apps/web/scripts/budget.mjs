// dist의 자산 압축 크기(brotli q11)를 tools/measure/budgets.json 상한과 비교한다. 초과하면 종료 코드 1.
// 예산 수치는 1단계 실측 기반 잠정값이며 오너가 승인했다 (docs/decisions.md D-007).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(web, 'dist');
const assets = JSON.parse(readFileSync(join(dist, 'BUILD_ASSETS.json'), 'utf8'));
const budgets = join(web, '../../tools/measure/budgets.json');
const file = (k) => join(dist, assets[k]);
const r = spawnSync(process.execPath, [
  join(web, '../../tools/measure/check-budget.mjs'), budgets,
  `wasm=${file('wasm')}`, `js_main=${file('main')}`, `js_worker=${file('worker')}`, `css=${file('styles')}`,
], { stdio: 'inherit' });
process.exit(r.status ?? 1);
