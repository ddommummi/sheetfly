// 용량 예산 검사: 압축 크기(brotli q11)가 budgets.json의 상한을 넘으면 종료 코드 1.
// 사용: node check-budget.mjs <budgets.json> <이름=파일경로>...   (예: wasm=pkg/rhwp_bg.wasm js=pkg/rhwp.js)
// 예산 수치는 1단계 실측을 근거로 한 **잠정값**이며 오너 승인 전이다 (docs/decisions.md).
import { readFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';

const [budgetPath, ...pairs] = process.argv.slice(2);
const budgets = JSON.parse(readFileSync(budgetPath, 'utf8'));
let failed = false;
let total = 0;
for (const pair of pairs) {
  const [name, file] = pair.split('=');
  const buf = readFileSync(file);
  const br = brotliCompressSync(buf, { params: {
    [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length;
  total += br;
  const limit = budgets.brotliBytes?.[name];
  const ok = limit === undefined || br <= limit;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: brotli ${br} B${limit !== undefined ? ` (limit ${limit})` : ''}`);
  if (!ok) failed = true;
}
const tl = budgets.brotliBytes?.total;
if (tl !== undefined) {
  const ok = total <= tl;
  console.log(`${ok ? 'ok  ' : 'FAIL'} total: brotli ${total} B (limit ${tl})`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
