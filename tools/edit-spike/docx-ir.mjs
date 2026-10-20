// IR(office_oxide, 우리 WASM 래퍼) 문단 열과 document.xml 문단 열을 맞춰 보는 도구. 출처 보존 방식 P2(문단 열 정렬)의 타당성 점검용.
import { readFileSync } from 'node:fs';
const wd = new URL('../../apps/web/src/wasm/', import.meta.url);
const { default: init, SheetflyDoc } = await import(new URL('fmt_docx.js', wd));
await init({ module_or_path: readFileSync(new URL('fmt_docx_bg.wasm', wd)) });

export function irOf(bytes) { const d = new SheetflyDoc(new Uint8Array(bytes), 'docx'); try { return JSON.parse(d.toJson()); } finally { d.free(); } }
const spanText = (c) => (c.type === 'text' ? c.text ?? c.span?.text ?? '' : c.type === 'line_break' ? '\n' : '');
const inl = (content) => (content ?? []).map((c) => (c.text !== undefined ? c.text : c.type === 'line_break' ? '\n' : spanText(c))).join('');

/** IR을 문서 순서의 글 블록 목록으로 편다: [{kind, text}] */
export function flattenIr(ir) {
  const out = [];
  const block = (el) => {
    switch (el.type) {
      case 'heading': case 'paragraph': out.push({ kind: el.type, text: inl(el.content) }); break;
      case 'list': for (const it of el.items ?? []) listItem(it); break;
      case 'table': for (const r of el.rows ?? []) for (const c of r.cells ?? []) for (const e of c.content ?? []) block(e); break;
      case 'text_box': for (const e of el.content ?? []) block(e); break;
      default: out.push({ kind: el.type, text: null });
    }
  };
  const listItem = (it) => { for (const e of it.content ?? []) { if (e.type === 'paragraph' || e.type === 'heading') out.push({ kind: 'list', text: inl(e.content) }); else block(e); } for (const n of it.nested ?? []) (n.items ? n.items : [n]).forEach(listItem); };
  for (const s of ir.ir.sections) for (const e of s.elements) block(e);
  return out;
}
export const dump = (ir) => JSON.stringify(ir.ir.sections[0].elements.slice(0, 40), null, 0).slice(0, 3000);

/** XML 문단 열과 IR 글 블록 열을 문서 순서로 맞춘다. IR은 빈 문단·쪽 나누기 문단을 문단으로 두지 않는다. 맞는 XML 문단 번호(없으면 -1) 배열을 돌려준다. */
export function align(blocks, xmlParas, window = 12) {
  const map = []; let j = 0;
  for (const b of blocks) {
    if (b.text === null) { map.push(-1); continue; }       // 문단이 아닌 블록(표·그림·쪽 나누기 …)
    let hit = -1;
    for (let k = j; k < Math.min(xmlParas.length, j + window); k++) if (xmlParas[k].all === b.text) { hit = k; break; }
    map.push(hit); if (hit >= 0) j = hit + 1;
  }
  return map;
}
