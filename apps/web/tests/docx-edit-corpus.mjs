// DOCX 편집 모델 왕복 시험(공개 코퍼스): 파일마다 무작위 편집 열 → 저장 → office_oxide로 다시 읽기, 기대하는 글 목록과 비교한다(docx-edit-oracle.mjs).
//   node tests/docx-edit-corpus.mjs <폴더> [--seed N] [--ops N] [--limit N] [--only 부분문자열] [--v] [--json 결과.json]
//   코퍼스는 tools/edit-spike/fetch-docx-corpus.sh로 받는다. 틀린 짝(엉뚱한 문단이 고쳐짐)·저장 뒤 글 불일치·XML 깨짐·바뀌지 않아야 할 ZIP 부품 변경이 있으면 실패(종료 코드 1).
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDocx, rng, hashSeed } from './docx-edit-oracle.mjs';

const argv = process.argv.slice(2), arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const dir = argv[0], SEED = Number(arg('seed', 1)), OPS = Number(arg('ops', 10)), LIMIT = Number(arg('limit', 1e9)), JSON_OUT = arg('json', null), ONLY = arg('only', null), V = argv.includes('--v');
function* walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (/\.(docx|docm|dotx)$/i.test(e.name)) yield p; } }
const files = [...walk(dir)].filter((f) => statSync(f).size <= 25e6 && (!ONLY || f.includes(ONLY))).slice(0, LIMIT);
const res = { files: files.length, opened: 0, skipped: {}, ops: 0, opKinds: {}, fail: [], paragraphs: 0, nonEmpty: 0, nonEmptyMapped: 0, nonEmptyEditable: 0, irBlocks: 0 };
for (const f of files) {
  const name = f.split('/corpus/').pop();
  const r = await checkDocx(new Uint8Array(readFileSync(f)), rng(hashSeed(SEED, name)), OPS, V);   // 파일 경로로 정한 씨앗(--only로 골라도 같은 편집 열)
  if (r.status === 'skip') { res.skipped[r.why] = (res.skipped[r.why] ?? 0) + 1; continue; }
  res.opened++;
  res.paragraphs += r.stats.paragraphs; res.nonEmpty += r.stats.nonEmpty; res.nonEmptyMapped += r.stats.nonEmptyMapped; res.nonEmptyEditable += r.stats.nonEmptyEditable;
  res.ops += r.applied; for (const [k, v] of Object.entries(r.opKinds)) res.opKinds[k] = (res.opKinds[k] ?? 0) + v;
  if (r.status === 'fail') res.fail.push({ f: name, msg: r.failure, applied: r.applied });
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(2) : '-');
console.log(`파일 ${res.files}개 중 열림 ${res.opened}개, 건너뜀 ${JSON.stringify(res.skipped)}`);
console.log(`글이 있는 문단 ${res.nonEmpty}개 중 IR 블록과 확실히 짝지어진 것 ${res.nonEmptyMapped}개(${pct(res.nonEmptyMapped, res.nonEmpty)}%), 편집 가능 ${res.nonEmptyEditable}개(${pct(res.nonEmptyEditable, res.nonEmpty)}%)`);
console.log(`편집 ${res.ops}회: ${JSON.stringify(res.opKinds)}`);
console.log(`실패 ${res.fail.length}개 파일` + (res.fail.length ? ':' : ''));
for (const x of res.fail.slice(0, 25)) console.log(`  ✗ ${x.f}  [편집 ${x.applied}회] ${x.msg}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(res, null, 1));
process.exitCode = res.fail.length ? 1 : 0;
