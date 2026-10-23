// 같은 문단에 같은 한 글자를 넣어 저장했을 때 변경 범위를 두 방식으로 잰다.
//   A) docx-engine saveDocx (문단을 모델에서 다시 만들어 끼움)   B) 우리 S2 insertText (w:t 안에 글자만 끼움)
// 지표: ① 바뀐 부품 목록(압축 푼 바이트 기준) ② document.xml의 바뀐 창(공통 앞·뒤를 뺀 크기) ③ 문단 재생성 무손실 여부(새 창에서 끼운 글자를 빼면 원래 창과 같은가)
//   node edit-loss.mjs <코퍼스 폴더> <out.json> [--per-doc N]
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readZip, readPart } from '../../edit-spike/docx-zip.mjs';
import { indexParagraphs, insertText } from '../../edit-spike/docx-xml.mjs';
import { parseDocx, saveDocx } from './work/out-node.mjs';

const [dir, outPath] = process.argv.slice(2);
const perDoc = process.argv.includes('--per-doc') ? Number(process.argv[process.argv.indexOf('--per-doc') + 1]) : 2;
function* walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) yield* walk(p); else if (/\.(docx|docm|dotx)$/i.test(e.name)) yield p; } }
const files = [...walk(dir)].filter((f) => statSync(f).size <= 25e6).sort();
const MARK = 'Ⅹ';   // 끼울 글자(원문에 없을 법한 한 글자)

function parts(buf) {
  const z = readZip(buf); const m = new Map();
  for (const e of z.entries) { if (e.name.endsWith('/')) continue; try { m.set(e.name, readPart(buf, e)); } catch { m.set(e.name, null); } }
  return m;
}
function window(a, b) {   // a→b에서 공통 앞·뒤를 뺀 구간 크기
  const m = Math.min(a.length, b.length); let i = 0; while (i < m && a[i] === b[i]) i++;
  let j = 0; while (j < m - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return { pre: i, oldWin: a.slice(i, a.length - j), newWin: b.slice(i, b.length - j) };
}
const rows = [];
for (const f of files) {
  const buf = readFileSync(f);
  let z; try { z = readZip(buf); } catch { continue; }
  const ent = z.entries.find((e) => e.name === 'word/document.xml'); if (!ent || z.entries.some((e) => e.flags & 1)) continue;
  let doc; try { doc = await parseDocx(new Uint8Array(buf)); } catch { continue; }
  const raw = readPart(buf, ent).toString('utf8');
  if (doc.internal.documentXml !== raw) continue;          // Strict 정규화 문서는 바이트 비교가 의미 없어 제외
  const xp = indexParagraphs(raw);
  const els = doc.extras.elements;
  const origParts = parts(buf);
  let done = 0;
  for (const b of doc.blocks) {
    if (done >= perDoc) break;
    if (b.type !== 'paragraph' || !b.runs?.length || b.hidden || b.docxIndex == null || b.sdtShell) continue;
    const el = els[b.docxIndex]; if (!el || !raw.startsWith('<w:p', el.start)) continue;
    const p = xp.find((q) => q.start === el.start && q.depth === 0);
    if (!p || !p.editable || p.text === '') continue;          // 우리 규칙상 편집 가능한 글 문단만
    if (b.runs.some((r) => r.instrField || r.refField || r.ins || r.del || r.sdtCheckboxXml || r.image || r.math || r.noteRef)) continue;
    const row = { f: f.slice(dir.length + 1), idx: b.docxIndex, paraLen: el.end - el.start };
    // --- B) 우리 S2 ---
    const nx = insertText(raw, p, [...p.text].length, MARK);
    if (nx == null) { row.s2 = { ok: false }; } else { const w = window(raw, nx); row.s2 = { ok: true, win: w.newWin.length }; }
    // --- A) docx-engine ---
    try {
      const runs = JSON.parse(JSON.stringify(b.runs)); let k = runs.length - 1; while (k >= 0 && typeof runs[k].text !== 'string') k--;
      if (k < 0) { row.ge = { ok: false, why: 'no-text-run' }; rows.push(row); done++; continue; }
      runs[k].text += MARK;
      const gen = { type: 'paragraph', styleId: b.styleId, list: b.list, format: b.format, rawPPr: b.rawPPr, bookmarks: b.bookmarks, hiddenBookmarks: b.hiddenBookmarks, commentStarts: b.commentStarts, commentEnds: b.commentEnds, runs };
      const finalBlocks = doc.blocks.filter((x) => !x.hidden).map((x) => (x === b ? { kind: 'generated', block: gen, docxIndex: b.docxIndex } : { kind: 'original', docxIndex: x.docxIndex }));
      const out = await saveDocx(doc, finalBlocks, { savedAt: '2026-01-01T00:00:00Z' });
      const np = parts(Buffer.from(out));
      const changed = [], added = [], removed = [];
      for (const [name, v] of origParts) { if (!np.has(name)) removed.push(name); else if (v == null || !np.get(name) || Buffer.compare(v, np.get(name)) !== 0) changed.push(name); }
      for (const name of np.keys()) if (!origParts.has(name)) added.push(name);
      const ndx = np.get('word/document.xml')?.toString('utf8') ?? '';
      const w = window(raw, ndx);
      const lossless = w.newWin.replace(MARK, '') === w.oldWin;       // 끼운 글자를 빼면 원래 구간과 같은가
      row.ge = { ok: true, changed, added, removed, win: w.newWin.length, oldWin: w.oldWin.length, lossless };
    } catch (e) { row.ge = { ok: false, why: String(e.message ?? e).slice(0, 80) }; }
    rows.push(row); done++;
  }
}
writeFileSync(outPath, JSON.stringify(rows));
console.log('편집 시험 수', rows.length);
