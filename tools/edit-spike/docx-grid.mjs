// 줄 격자(w:docGrid) 읽기 검증: 어댑터(fmt-docx WASM)가 내는 doc_grid를, Rust와 별개인 정규식 정답과 코퍼스 전체에서 대조한다.
//   node tools/edit-spike/docx-grid.mjs <코퍼스 폴더> [--limit N]      (먼저 scripts/build-docx-wasm.sh)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readZip, readPart } from './docx-zip.mjs';
import { irOf } from './docx-ir.mjs';

const dir = process.argv[2];
const limit = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity;
function* walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (/\.(docx|docm|dotx)$/i.test(e.name)) yield p; } }
const files = [...walk(dir)].filter((f) => statSync(f).size <= 25e6).sort().slice(0, limit);

const KINDS = new Set(['lines', 'linesAndChars', 'snapToChars']);
const attr = (tag, name) => tag.match(new RegExp(`\\s(?:[\\w.-]+:)?${name}="([^"]*)"`))?.[1];
/** 정답: sectPrChange(바뀌기 전 옛 값)를 먼저 지우고 sectPr마다 docGrid를 찾는다. 격자 요소가 없으면 null. */
function truthOf(xml) {
  const noChange = xml.replace(/<(?:[\w.-]+:)?sectPrChange\b[\s\S]*?<\/(?:[\w.-]+:)?sectPrChange>/g, '');
  const out = [];
  for (const m of noChange.matchAll(/<((?:[\w.-]+:)?)sectPr\b(\/>|[^>]*\/>|[^>]*>[\s\S]*?<\/\1sectPr>)/g)) {
    const grid = m[0].match(/<(?:[\w.-]+:)?docGrid\b[^>]*>/)?.[0];
    if (!grid) { out.push(null); continue; }
    const t = attr(grid, 'type'), lp = attr(grid, 'linePitch'), cs = attr(grid, 'charSpace');
    const num = (v) => (v !== undefined && /^-?\d+$/.test(v.trim()) ? Number(v) : undefined);
    const u = num(lp), i = num(cs);
    out.push({ type: KINDS.has(t) ? t : 'default', ...(u !== undefined && u >= 0 && u <= 0xffffffff ? { line_pitch: u } : {}), ...(i !== undefined && i >= -2147483648 && i <= 2147483647 ? { char_space: i } : {}) });
  }
  return out.some(Boolean) ? out : [];
}

let effective = 0, n = 0, withGrid = 0, equal = 0, bothEmpty = 0, missed = 0, extra = 0, valueDiff = 0, irMatch = 0, irMismatch = 0, ms = 0;
const byKind = {}; const bad = [];
for (const f of files) {
  let buf; try { buf = readFileSync(f); } catch { continue; }
  let xml; try { const z = readZip(buf); const e = z.entries.find((x) => x.name === 'word/document.xml'); if (!e || z.entries.some((x) => x.flags & 1)) continue; xml = readPart(buf, e).toString('utf8'); } catch { continue; }
  const t0 = performance.now(); let full; try { full = irOf(buf); } catch { continue; } ms += performance.now() - t0;
  n++;
  const truth = truthOf(xml), got = full.doc_grid ?? [];
  if (!truth.length && !got.length) { bothEmpty++; continue; }
  withGrid++;
  for (const g of truth) if (g) byKind[g.type] = (byKind[g.type] ?? 0) + 1;
  if (truth.some((g) => g && g.type !== 'default')) effective++;   // 격자 종류가 lines·linesAndChars·snapToChars: 줄 높이에 영향을 주는 문서
  if (!truth.length) { extra++; bad.push([f, 'extra', got]); continue; }
  if (!got.length) { missed++; bad.push([f, 'missed', truth]); continue; }
  if (JSON.stringify(truth) === JSON.stringify(got)) equal++; else { valueDiff++; bad.push([f, 'diff', { truth, got }]); }
  if ((full.ir.sections?.length ?? 0) === got.length) irMatch++; else irMismatch++;
}
console.log(`문서 ${n}개 중 줄 격자 요소가 든 문서 ${withGrid}개 (구역별 종류: ${JSON.stringify(byKind)})`);
console.log(`그중 줄 높이에 영향을 주는 종류(lines·linesAndChars·snapToChars)가 든 문서 ${effective}개 (나머지는 type이 없거나 default)`);
console.log(`정답과 완전히 같음 ${equal}/${withGrid}, 못 읽음 ${missed}, 없는데 읽음 ${extra}, 값이 다름 ${valueDiff}`);
console.log(`IR 구역 수와 doc_grid 길이가 같은 문서 ${irMatch}/${irMatch + irMismatch} (같을 때만 구역에 붙일 수 있다)`);
console.log(`IR 읽기 합계 ${Math.round(ms)}ms (doc_grid 포함, 통제하지 않은 한 번의 측정)`);
for (const [f, why, v] of bad.slice(0, 8)) console.log(' ', why, f.slice(dir.length + 1).split('/').pop(), JSON.stringify(v).slice(0, 200));
process.exit(missed + extra + valueDiff ? 1 : 0);
