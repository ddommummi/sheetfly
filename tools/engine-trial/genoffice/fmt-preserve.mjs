// 편집 전후 문단의 "글자별 서식 서명"이 같은가: 서식이 보존됐는지 런 합치기인지 구분한다.
import { readFileSync } from 'node:fs';
import { readZip, readPart } from '../../edit-spike/docx-zip.mjs';
import { indexParagraphs } from '../../edit-spike/docx-xml.mjs';
import { parseDocx, saveDocx } from './work/out-node.mjs';
const rows = JSON.parse(readFileSync(new URL('out/edit-rows.json', import.meta.url))).filter((r) => r.ge?.ok);
const MARK = 'Ⅹ';
const canon = (rpr) => !rpr ? '' : [...rpr.matchAll(/<(w:[A-Za-z]+)((?:\s+[\w:.-]+="[^"]*")*)\s*\/?>/g)].filter((m) => m[1] !== 'w:rPr').map((m) => m[1] + [...m[2].matchAll(/([\w:.-]+)="([^"]*)"/g)].map((a) => `${a[1]}=${a[2]}`).sort().join(',')).sort().join('|');
function sigs(xml, para) {   // 문단의 글자별 서식 서명 배열(글 w:t·탭만)
  const out = [];
  for (const run of para.runs) { const sig = canon(run.rPr ? xml.slice(run.rPr[0], run.rPr[1]) : ''); for (const it of run.items) if (it.kind === 'w:t' || it.kind === 'w:tab') for (const _ of [...it.text]) out.push(sig); }
  return out;
}
const byDoc = new Map(); for (const r of rows) (byDoc.get(r.f) ?? byDoc.set(r.f, []).get(r.f)).push(r);
let n = 0, same = 0, textSame = 0, diffs = []; let pPrSame = 0;
const pprOf = (xml, p) => (p.pPr ? xml.slice(p.pPr[0], p.pPr[1]).replace(/\s+/g, '') : '');
for (const [f, rs] of byDoc) {
  const buf = readFileSync(process.argv[2] + '/' + f);
  const doc = await parseDocx(new Uint8Array(buf)); const raw = doc.internal.documentXml; const els = doc.extras.elements; const xp = indexParagraphs(raw);
  for (const r of rs) {
    const b = doc.blocks.find((x) => x.docxIndex === r.idx); const el = els[r.idx]; const op = xp.find((q) => q.start === el.start && q.depth === 0);
    const runs = JSON.parse(JSON.stringify(b.runs)); let k = runs.length - 1; while (k >= 0 && typeof runs[k].text !== 'string') k--; runs[k].text += MARK;
    const gen = { type: 'paragraph', styleId: b.styleId, list: b.list, format: b.format, rawPPr: b.rawPPr, bookmarks: b.bookmarks, hiddenBookmarks: b.hiddenBookmarks, commentStarts: b.commentStarts, commentEnds: b.commentEnds, runs };
    const out = Buffer.from(await saveDocx(doc, doc.blocks.filter((x) => !x.hidden).map((x) => (x === b ? { kind: 'generated', block: gen, docxIndex: b.docxIndex } : { kind: 'original', docxIndex: x.docxIndex })), { savedAt: '2026-01-01T00:00:00Z' }));
    const z = readZip(out); const nx = readPart(out, z.entries.find((e) => e.name === 'word/document.xml')).toString('utf8');
    // 새 문서에서 같은 순서의 문단을 찾는다: 앞쪽 문단 수가 같다고 보고 같은 위치의 문단 번호 사용
    const oi = xp.indexOf(op); const np = indexParagraphs(nx)[oi]; if (!np) continue;
    const so = sigs(raw, op), sn = sigs(nx, np).slice(0, -1);       // 새 쪽은 끼운 글자 하나를 뺀다
    n++;
    const ts = op.text === np.text.slice(0, -1); if (ts) textSame++;
    const fs = so.length === sn.length && so.every((s, i) => s === sn[i]); if (fs) same++; else if (diffs.length < 4) { const i = so.findIndex((s, i) => s !== sn[i]); diffs.push({ f: f.split('/').pop(), idx: r.idx, at: i, old: so[i], new: sn[i] }); }
    if (pprOf(raw, op) === pprOf(nx, np)) pPrSame++;
  }
}
console.log(`시험 ${n}건: 글 일치 ${textSame} (${(100 * textSame / n).toFixed(1)}%), 글자별 서식 서명 일치 ${same} (${(100 * same / n).toFixed(1)}%), 문단 속성(pPr) 일치 ${pPrSame} (${(100 * pPrSame / n).toFixed(1)}%)`);
console.log('서식 서명이 달라진 예:', JSON.stringify(diffs, null, 1));
