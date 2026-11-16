// DOCX 편집 계층(Worker 쪽, 4-2-3). 편집을 시작할 때만 불러온다(docx-worker.js가 동적으로 import) — 열기만 하는 사용자는 이 파일을 받지 않는다.
// 문서 상태(문단 조각·IR 거울·조판 줄·되돌리기)는 편집 세션(docx/edit/session.js)이 갖고, 여기서는 편집기(editor.js)가 보내는 메시지를 세션 호출로 바꾼다.
// 메시지 계약은 hwp-edit.js와 같다: m.op = hit caret move wordat text selrects props status clean mark endOf fonts view insert enter del delrange paste undo redo save …
// 위치(pos)는 { s: 0, p: 문서 전체 문단 번호, o: 문단 글 안 code point 번호, path: null, aff? } (docs/phase4/design-docx.md 5절).
import { DocxEditSession } from './docx/edit/session.js';
import { EditError } from './docx/edit/model.js';
import { flattenIr } from './docx/edit/ir.js';

/**
 * 편집 세션을 연다. 문서 단위로 편집할 수 없으면(암호 ZIP·UTF-16·변경 내용 추적·문서 보호 등) { code: 'edit_locked', message: 이유 }를 던진다.
 * @param {{bytes: Uint8Array, full: object, measure: object, layoutDocument: Function, readIr: (bytes: Uint8Array) => Promise<object>}} env
 */
export async function openEdit({ bytes, full, measure, layoutDocument, readIr }) {
  let session;
  try { session = await DocxEditSession.open(bytes, full, measure, { layoutDocument, readIr }); } catch (e) {
    if (e instanceof EditError) throw { code: 'edit_locked', message: e.message };
    throw e;
  }
  if (session.model.docLock) throw { code: 'edit_locked', message: session.model.docLock };
  return { session, readIr, count: session.pageCount };
}

// XML 1.0이 글에 허용하지 않는 제어 문자(탭·줄바꿈 제외)와 양끝이 안 맞는 서로게이트는 넣지 않는다.
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f￾￿]/g;
const clean = (t) => String(t ?? '').replace(CTRL, '').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');

const texts = (full) => flattenIr(full).filter((b) => b.text).map((b) => b.text);
/** 두 글 목록이 달라진 곳의 수(길이 차이도 센다). */
function diffCount(a, b) {
  let d = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
}

/** 편집 뒤 화면 갱신에 필요한 정보: 쪽 수·크기(바뀔 때만), 어느 쪽부터 다시 그릴지, 변경 표시·되돌리기 상태. */
function out(ctx, r) {
  const s = ctx.session, v = r.view, o = { pos: r.pos, rect: r.rect, pageCount: s.pageCount, dirty: s.model.dirty, ...s.status() };
  if (v) o.from = v.full ? 0 : v.from;
  if (v?.full || s.pageCount !== ctx.count) { o.sizes = s.sizes(); ctx.count = s.pageCount; }
  return o;
}

async function dispatch(ctx, m) {
  const s = ctx.session;
  switch (m.op) {
    case 'hit': {
      if (m.enter) return { pos: null, rect: null };   // 머리글·바닥글·각주 두 번 누르기(4-2-5에서)
      const r = s.hit({ page: m.page, x: m.x, y: m.y });
      return { pos: r.pos, rect: r.rect ?? null, locked: r.locked ?? null };
    }
    case 'caret': return s.caret({ pos: m.pos });
    case 'move': return s.move({ pos: m.pos, kind: m.kind, px: m.px ?? -1 });
    case 'wordat': return s.wordat({ pos: m.pos, whole: !!m.whole });
    case 'text': return s.text({ a: m.a, b: m.b });
    case 'selrects': return s.selrects({ a: m.a, b: m.b });
    case 'props': return { char: null, para: null, table: null, lock: m.pos ? s.lock(m.pos.p) : null };
    case 'status': return s.status();
    case 'clean': s.clean(); return {};
    case 'mark': s.mark(); return {};
    case 'endOf': {
      const a = s.move({ pos: { s: 0, p: 0, o: 0, path: null }, kind: 'docstart' }), b = s.move({ pos: { s: 0, p: 0, o: 0, path: null }, kind: 'docend' });
      return { pos: b.pos, rect: b.rect, first: a.pos };
    }
    case 'fonts': return { fonts: [] };
    case 'view': case 'marks': return { on: false, pageCount: s.pageCount };
    case 'pasterich': return { fallback: true };   // 이 계층은 글만 붙인다
    case 'insert': return out(ctx, await s.insert({ pos: m.pos, text: clean(m.text), group: !!m.group, replace: m.replace | 0 }));
    case 'enter': return out(ctx, await s.enter({ pos: m.pos }));
    case 'del': return out(ctx, await s.del({ pos: m.pos, dir: m.dir }));
    case 'delrange': return out(ctx, await s.delrange({ a: m.a, b: m.b }));
    case 'paste': return out(ctx, await s.paste({ pos: m.pos, text: clean(m.text) }));
    case 'undo': case 'redo': {
      const r = await (m.op === 'undo' ? s.undo() : s.redo());
      if (!r.pos) return { empty: true, pageCount: s.pageCount, dirty: s.model.dirty, ...s.status() };
      return out(ctx, r);
    }
    case 'save': {
      const t0 = performance.now();
      const bytes = await s.save();
      const tExport = performance.now() - t0;
      // 저장한 바이트를 다시 읽어(office_oxide) 문단마다 글이 지금 문서와 같은지 점검한다: 문서 XML 고치기와 화면(IR) 쪽 편집이 어긋나지 않았는지 보는 안전망.
      let verify;
      try {
        const re = await ctx.readIr(bytes), d = diffCount(texts(s.full), texts(re));
        verify = { checked: true, ok: d === 0, diffs: d };
      } catch (e) { verify = { checked: true, ok: false, reopenError: String(e && e.message || e).slice(0, 120) }; }
      return { bytes, verify, exportMs: Math.round(tExport), totalMs: Math.round(performance.now() - t0) };
    }
    default: return {};   // copysel(엔진 내부 클립보드)·cellrange 같은 DOCX에 없는 기능
  }
}

/** 메시지 처리. 편집할 수 없는 문단·범위는 오류가 아니라 { skipped: true, notice }로 알려 편집기가 안내한다. */
export async function run(ctx, m) {
  try { return await dispatch(ctx, m); } catch (e) {
    if (e instanceof EditError && (e.code === 'locked' || e.code === 'not_sibling')) {
      // 안내 문구: "문단 3은 편집할 수 없다: 이유"의 문단 번호(내부 번호)는 사용자에게 의미가 없다
      const notice = e.code === 'locked' ? `이 문단은 편집할 수 없습니다: ${e.message.replace(/^문단 \d+은 편집할 수 없다: /, '')}` : e.message;
      return { skipped: true, notice, dirty: ctx.session.model.dirty, ...ctx.session.status() };
    }
    throw e;
  }
}
