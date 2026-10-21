// DOCX 편집 모델 시험 보조: Node에서 office_oxide WASM을 올려 IR을 읽고, 편집 전후 IR 글을 비교한다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const wd = join(here, '../src/wasm');
const { default: init, SheetflyDoc } = await import(join(wd, 'fmt_docx.js'));
await init({ module_or_path: readFileSync(join(wd, 'fmt_docx_bg.wasm')) });
const { flattenIr } = await import('../src/docx/edit/ir.js');

export function irOf(bytes) { const d = new SheetflyDoc(new Uint8Array(bytes), 'docx'); try { return JSON.parse(d.toJson()); } finally { d.free(); } }
/** IR 글 블록의 글 목록(글이 있는 블록만, 비어 있지 않은 것) */
export const irTexts = (full) => flattenIr(full).filter((b) => b.text).map((b) => b.text);
