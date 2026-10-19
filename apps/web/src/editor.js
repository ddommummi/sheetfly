// 편집기(메인 스레드 쪽). "편집" 버튼을 누를 때만 불러온다(지연 로딩) — 열기만 하는 사용자는 이 파일을 받지 않는다.
// 문서 상태는 Worker(hwp-edit.js)가 갖고, 여기서는 입력(키보드·마우스·한글 조합)을 받아 편집 요청으로 바꾸고,
// 캐럿·선택 영역을 쪽 위의 겹침층으로 그리고, 도구줄과 저장을 맡는다. 화면의 쪽은 <img>(SVG)라 글자 입력은 숨은 textarea가 받는다.
// 사용자 동작은 모두 하나의 대기열에서 한 작업씩 순서대로 실행한다. 작업은 "실행되는 시점의" 위치·선택을 읽으므로
// 빠르게 이어 치는 글자나 조합 입력의 연속 갱신이 서로 엇갈리지 않는다.
import { askForm } from './ed-ui.js';
import { installTable } from './ed-table.js';

const T = {
  tabs: { format: '서식', insert: '입력', table: '표', page: '쪽', view: '보기' }, ok: '확인', cancel: '취소',
  undo: '실행 취소 (Ctrl+Z)', redo: '다시 실행 (Ctrl+Y)', bold: '굵게 (Ctrl+B)', italic: '기울임 (Ctrl+I)', underline: '밑줄 (Ctrl+U)',
  sizeDown: '글자 작게', sizeUp: '글자 크게', color: '글자 색', left: '왼쪽 맞춤', center: '가운데 맞춤', right: '오른쪽 맞춤', justify: '양쪽 맞춤',
  font: '글꼴', strike: '취소선', highlight: '형광펜 색', highlightOff: '형광펜 지우기', highlightOffLabel: '지움',
  spacing: '자간', spacingTitle: '글자 사이 간격(자간) %', ratio: '장평', ratioTitle: '글자 폭(장평) %',
  spacingDown: '자간 줄이기', spacingUp: '자간 늘리기', ratioDown: '장평 줄이기', ratioUp: '장평 늘리기',
  lineSpacing: '줄 간격', indentLess: '왼쪽 여백 줄이기', indentMore: '왼쪽 여백 늘리기', marks: '문단 부호 보이기·숨기기',
  save: '저장', saveTitle: '다른 이름으로 저장 (Ctrl+S)', toolbar: '편집 도구', input: '문서 편집 입력',
  saving: '저장 중…', saved: (n) => `${n} 저장했습니다.`, saveCancelled: '저장을 취소했습니다.', saveFailed: '저장하지 못했습니다.',
  opFailed: '이 편집을 적용하지 못했습니다. 실행 취소(Ctrl+Z)로 직전 상태로 돌아갈 수 있습니다.',
  readonlyHere: '이 위치는 아직 편집할 수 없습니다(머리글·각주·개체 등).',
  warnTitle: '저장 전에 확인해 주세요', keepSaving: '그래도 저장', cancelSave: '저장 취소',
  verifyFail: (n) => `저장한 파일을 다시 열어 보니 문서 내용 ${n}곳이 달라졌습니다. 그대로 저장하면 일부 내용이 바뀔 수 있습니다.`,
  reopenFail: '저장한 파일을 다시 열지 못했습니다. 이 파일은 열리지 않을 수 있습니다.',
  pagesChanged: (a, b) => `쪽 수가 ${a}쪽에서 ${b}쪽으로 달라집니다.`,
  hwp3: 'HWP 3.0 문서는 HWP 5.0 형식으로 저장됩니다. 서식이 달라질 수 있습니다.',
  discardTitle: '저장하지 않은 변경 내용이 있습니다', discard: '변경 내용 버리기', stay: '계속 편집',
  discardBody: '이 문서를 닫으면 저장하지 않은 변경 내용이 사라집니다.',
  slowTitle: '이 문서는 편집이 매우 느릴 수 있습니다', slowBody: (s) => `문서를 여는 데만 ${s}초가 걸렸습니다. 편집은 글자를 칠 때마다 문서를 다시 계산하므로 한 글자에 그만큼 걸릴 수 있습니다.`,
  keepEditing: '그래도 편집', cancelEdit: '편집 취소',
};
const SLOW_OPEN_MS = 8000;         // 열기에 이보다 오래 걸린 문서는 편집 전에 알린다(뷰어의 "시간이 걸리고 있습니다" 안내와 같은 기준)
const GAP_MS = 1500;               // 이 시간 안의 연속 입력은 되돌리기 한 묶음
const COMMON_FONTS = ['함초롬바탕', '함초롬돋움', '맑은 고딕', '바탕', '돋움', '굴림', '궁서', '한컴바탕', '한컴돋움', '휴먼명조', '휴먼고딕', 'Arial', 'Times New Roman', 'Calibri'];
const LINE_SPACINGS = [100, 120, 130, 150, 160, 180, 200, 250, 300];
const INDENT_STEP = 2000;           // 왼쪽 여백 한 단계(HWPUNIT, 약 10pt). rhwp가 돌려주는 값은 96dpi 픽셀(=HWPUNIT/150)이다.
const PX_TO_HWPUNIT = 150;
const SZ_MIN = 100, SZ_MAX = 40000; // HWPUNIT(1pt = 100)

const svg = (d) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON = {
  undo: svg('M6 4L3 7l3 3M3 7h6a4 4 0 010 8H7'), redo: svg('M10 4l3 3-3 3M13 7H7a4 4 0 000 8h2'),
  indentLess: svg('M2 3h12M7 7h7M7 11h7M2 15h12M5 6L2 9l3 3'), indentMore: svg('M2 3h12M7 7h7M7 11h7M2 15h12M2 6l3 3-3 3'),
  left: svg('M2 3h12M2 7h8M2 11h12M2 15h8'), center: svg('M2 3h12M4 7h8M2 11h12M4 15h8'), right: svg('M2 3h12M6 7h8M2 11h12M6 15h8'), justify: svg('M2 3h12M2 7h12M2 11h12M2 15h12'),
};

const same = (a, b) => !!a && !!b && a.s === b.s && a.p === b.p && a.o === b.o && JSON.stringify(a.path) === JSON.stringify(b.path);

export class Editor {
  /**
   * @param {{viewer, stage, worker, bar: HTMLElement, fileName: string, meta: object, onDirty: (d: boolean) => void, status: (m: string) => void}} env
   */
  constructor(env) {
    Object.assign(this, env);
    this.pos = null; this.anchor = null; this.rect = null; this.px = -1;
    this.dirty = false; this.active = false;
    this.q = Promise.resolve();
    this.comp = null;                 // { start, len, fmt } 한글 조합 중
    this.pending = {};                // 서식 단추를 먼저 눌렀을 때 다음 입력에 적용할 서식
    this.cur = {};                    // 캐럿 위치의 글자·문단 서식
    this.tbl = null; this.cellBlock = null;   // 캐럿이 든 표 칸 정보 / 칸 블록 선택(서로 다른 칸에 걸친 선택)
    this.cleanups = [];
    this.lastTyped = 0; this.selText = ''; this.dragging = false; this.hitBusy = false; this.hitNext = null; this.keyHandled = false;
    this.#buildToolbar();
    this.#loadFonts();
    this.#buildInput();
    this.#bind();
  }

  /** 글꼴 목록: 이 문서가 쓰는 글꼴 + 흔한 글꼴(브라우저는 설치된 글꼴 목록을 알려주지 않는다). */
  async #loadFonts() {
    let used = [];
    try { used = (await this.#req('fonts')).fonts ?? []; } catch { /* 목록 없이도 동작 */ }
    const seen = new Set();
    this.fontOptions = [...used, ...COMMON_FONTS].filter((f) => f && !seen.has(f) && seen.add(f)).map((f) => [f, f]);
    this.#fillSelect(this.fontSel, this.fontOptions, this.cur.fontFamily ?? '');
  }

  // ── 시작·끝 ───────────────────────────────────────────────────────
  start() {
    this.active = true;
    this.bar.hidden = false;
    document.body.dataset.editing = '1';
    if (!this.pos) this.#placeStart();
    else { this.#draw(); this.#focus(); }
  }
  stop() {
    this.#flushGroup();
    this.active = false;
    this.bar.hidden = true;
    delete document.body.dataset.editing;
    this.#clearOverlays();
    this.input.blur();
  }
  dispose() {
    this.stop();
    for (const [t, type, fn, o] of this.cleanups) t.removeEventListener(type, fn, o);
    this.cleanups = [];
    this.input.remove(); this.bar.replaceChildren();
  }
  async #placeStart() {
    // 보이는 쪽의 위쪽에 캐럿을 둔다
    const page = this.viewer.current;
    const size = this.viewer.sizes[page];
    if (!size) return;
    const r = await this.#call('hit', { page, x: size.w * 0.2, y: Math.max(40, size.h * 0.12) });
    // 시작할 때 놓는 캐럿은 화면을 움직이지 않는다(그 사이 사용자가 다른 쪽으로 이동했을 수 있다)
    if (r?.pos && !this.pos) this.#set(r.pos, r.rect, { scroll: false }); else if (r && !r.pos) this.status(T.readonlyHere);
  }

  // ── 편집 요청 ─────────────────────────────────────────────────────
  #enqueue(fn) {
    const p = this.q.then(fn, fn);
    this.q = p.catch(() => {});
    this.busy = (this.busy ?? 0) + 1; document.body.dataset.editBusy = '1';   // 시험이 "처리가 끝났는지" 볼 수 있게 한다
    this.q.then(() => { if (--this.busy === 0) delete document.body.dataset.editBusy; });
    return p.catch((e) => { this.status(T.opFailed); console.warn('edit', e); return null; });
  }
  #req(op, payload = {}) { return this.worker.request('edit', { op, ...payload }); }
  /** 대기열을 거치는 단순 요청(위치 상태를 읽지 않는 것). */
  #call(op, payload = {}) { return this.#enqueue(() => this.#req(op, payload)); }
  /** (작업 안에서) 문서를 바꾸는 요청과 그 결과 반영: 위치·화면. */
  async #doMutate(op, payload, { keepSel = false } = {}) {
    const r = await this.#req(op, payload);
    if (r.skipped) return r;
    if (r.dirty !== undefined) this.#setDirty(!!r.dirty);
    // 바뀐 곳은 캐럿이 있던 쪽과 새 캐럿이 있는 쪽(줄바꿈이 쪽을 넘길 수 있다). 선택 삭제는 시작 쪽을 모르므로 처음부터.
    const oldPage = this.rect?.page, newPage = r.rect?.page;
    const hot = [oldPage, newPage].filter((x) => x !== undefined);
    this.viewer.refresh(r.sizes, op === 'delrange' || !hot.length ? { hot: hot.length ? hot : null } : { from: Math.min(...hot), hot });
    if (r.pos) this.#set(r.pos, r.rect, { keepSel });
    else { this.#draw(); this.#updateStatus(r); }
    return r;
  }
  /** (작업 안에서) 선택 영역이 있으면 지운다. */
  async #deleteSelNow() {
    if (!this.#hasSel()) return true;
    if (this.cellBlock) {   // 칸 블록: 글만 지운다(칸 구조는 그대로)
      const r = await this.#req('cellclear', { a: this.anchor, b: this.pos });
      this.#setDirty(true); this.viewer.refresh(r.sizes, {});
      this.anchor = null; this.cellBlock = null;
      this.#set(this.pos, this.rect, {});
      return true;
    }
    const r = await this.#doMutate('delrange', { a: this.anchor, b: this.pos });
    return !r.skipped;
  }
  #setDirty(d) { if (d !== this.dirty) { this.dirty = d; this.onDirty(d); } }

  // ── 위치·선택 상태 ────────────────────────────────────────────────
  #set(pos, rect, { extend = false, keepSel = false, keepPx = false, scroll = true } = {}) {
    if (extend) { if (!this.anchor) this.anchor = this.pos; }
    else if (!keepSel) this.anchor = null;
    this.pos = pos; this.rect = rect;
    if (!keepPx) this.px = -1;
    this.#draw(scroll);
    this.#syncSelection();
    this.#scheduleProps();
    this.#focus();
  }
  #hasSel() { return !!this.anchor && !!this.pos && !same(this.anchor, this.pos); }
  #range() { return this.#hasSel() ? [this.anchor, this.pos] : [this.pos, this.pos]; }

  // ── 겹침층(캐럿·선택) ─────────────────────────────────────────────
  #layer(page, cls) {
    const el = this.viewer.pageEls[page];
    if (!el) return null;
    let l = el.querySelector(`:scope > .${cls}`);
    if (!l) { l = document.createElement('div'); l.className = cls; el.append(l); }
    return l;
  }
  #pct(page, x, y, w, h) {
    const sz = this.viewer.sizes[page];
    return `left:${(x / sz.w) * 100}%;top:${(y / sz.h) * 100}%;width:${(w / sz.w) * 100}%;height:${(h / sz.h) * 100}%`;
  }
  #draw(scroll = true) {
    if (this.caretEl) { this.caretEl.remove(); this.caretEl = null; }
    if (!this.active || !this.rect) return;
    if (scroll) this.#ensure();
    if (this.#hasSel()) return;
    const layer = this.#layer(this.rect.page, 'edit-layer');
    if (!layer) return;
    const c = document.createElement('div');
    c.className = 'caret';
    c.style.cssText = this.#pct(this.rect.page, this.rect.x, this.rect.y, 1.5, this.rect.h);
    layer.append(c);
    this.caretEl = c;
  }
  #ensure() { if (this.rect) this.viewer.ensureVisible(this.rect.page, this.rect.y, this.rect.h); }
  #clearOverlays() {
    this.caretEl?.remove(); this.caretEl = null;
    for (const l of this.viewer.pagesEl.querySelectorAll('.sel-layer, .edit-layer')) l.remove();
  }
  async #syncSelection() {
    const ver = this.selVer = (this.selVer ?? 0) + 1;
    for (const l of this.viewer.pagesEl.querySelectorAll('.sel-layer')) l.replaceChildren();
    this.cellBlock = null;
    if (!this.#hasSel()) { this.selText = ''; for (const f of this.ctx ?? []) f(); return; }
    const [a, b] = [this.anchor, this.pos];
    // 서로 다른 표 칸에 걸친 선택이면 "칸 블록"(병합된 칸을 포함하도록 넓힌 사각형)으로 그린다
    if (a.path && b.path) {
      const cr = await this.#call('cellrange', { a, b });
      if (ver !== this.selVer) return;
      if (cr?.range) {
        this.cellBlock = { ...cr.range, cells: cr.cells };
        this.selText = '';
        for (const q of cr.rects) this.#drawSel(q);
        for (const f of this.ctx ?? []) f();
        return;
      }
    }
    const r = await this.#call('selrects', { a, b });
    if (ver !== this.selVer || !r) return;
    for (const q of r.rects) this.#drawSel(q);
    const t = await this.#call('text', { a, b });
    if (ver === this.selVer && t) this.selText = t.text.length > 2_000_000 ? '' : t.text;
  }
  #drawSel(q) {
    const layer = this.#layer(q.page, 'sel-layer');
    if (!layer) return;
    const d = document.createElement('div');
    d.className = 'sel';
    d.style.cssText = this.#pct(q.page, q.x, q.y, q.w, q.h);
    layer.append(d);
  }

  // ── 숨은 입력창 ───────────────────────────────────────────────────
  #buildInput() {
    const ta = document.createElement('textarea');
    ta.className = 'edit-input';
    ta.setAttribute('aria-label', T.input);
    ta.autocapitalize = 'off'; ta.autocomplete = 'off'; ta.spellcheck = false; ta.rows = 1;
    document.body.append(ta);
    this.input = ta;
  }
  /** 모달 대화상자가 닫힌 뒤: 입력창이 포커스를 갖고 있어도 글자가 들어가지 않는 상태가 남으므로 한 번 뺐다가 다시 준다. */
  #refocus() { if (!this.active) return; this.input.blur(); this.#focus(true); }
  #focus(force = false) {
    if (!this.active) return;
    if (this.rect) {
      // 한글 후보 창이 캐럿 근처에 뜨도록 입력창을 캐럿 위치에 둔다
      const el = this.viewer.pageEls[this.rect.page];
      if (el) {
        const b = el.getBoundingClientRect(), z = this.viewer.zoom;
        this.input.style.left = `${Math.round(b.left + this.rect.x * z)}px`;
        this.input.style.top = `${Math.round(b.top + this.rect.y * z)}px`;
        this.input.style.height = `${Math.max(12, Math.round(this.rect.h * z))}px`;
      }
    }
    // 쪽 번호 칸·검색창 같은 다른 입력 칸에 사용자가 있으면 포커스를 빼앗지 않는다(스크롤·확대 때도 호출되므로). 문서를 누르거나 쳤을 때만 force.
    const a = document.activeElement;
    const elsewhere = a && a !== document.body && a !== this.input && a !== this.stage && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(a.tagName) && !a.closest('#edit-bar');
    if (a !== this.input && (force || !elsewhere)) this.input.focus({ preventScroll: true });
  }

  // ── 이벤트 연결 ───────────────────────────────────────────────────
  #on(target, type, fn, opts) {
    const h = fn.bind(this);
    target.addEventListener(type, h, opts);
    this.cleanups.push([target, type, h, opts]);
  }
  #bind() {
    const ta = this.input;
    this.#on(ta, 'keydown', this.#onKey);
    this.#on(ta, 'beforeinput', this.#onBeforeInput);
    this.#on(ta, 'compositionstart', this.#onCompStart);
    this.#on(ta, 'compositionupdate', this.#onCompUpdate);
    this.#on(ta, 'compositionend', this.#onCompEnd);
    this.#on(ta, 'paste', this.#onPaste);
    this.#on(ta, 'copy', (e) => this.#onCopy(e, false));
    this.#on(ta, 'cut', (e) => this.#onCopy(e, true));
    this.#on(this.stage, 'pointerdown', this.#onDown);
    this.#on(window, 'pointermove', this.#onMove);
    this.#on(window, 'pointerup', this.#onUp);
    this.#on(window, 'resize', () => { if (this.active) this.#focus(); });
    this.#on(this.stage, 'scroll', () => { if (this.active) this.#focus(); }, { passive: true });
    this.#on(this.viewer, 'zoomchange', () => { queueMicrotask(() => this.#focus()); });
  }

  // 마우스
  #pageHit(e) {
    const pageEl = e.target.closest?.('.page');
    if (!pageEl) return null;
    const b = pageEl.getBoundingClientRect(), z = this.viewer.zoom;
    return { page: Number(pageEl.dataset.index), x: (e.clientX - b.left) / z, y: (e.clientY - b.top) / z };
  }
  #hitAt(h, extend) {
    // 끌기 중에는 가장 최근 위치만 보낸다
    if (this.hitBusy) { this.hitNext = [h, extend]; return; }
    this.hitBusy = true;
    this.#enqueue(async () => {
      const r = await this.#req('hit', h);
      if (r.pos) { this.#flushGroup(); this.pending = {}; this.#set(r.pos, r.rect, { extend }); }
      else if (!extend) this.status(T.readonlyHere);
    }).finally(() => {
      this.hitBusy = false;
      if (this.hitNext) { const [nh, ne] = this.hitNext; this.hitNext = null; this.#hitAt(nh, ne); }
    });
  }
  #onDown(e) {
    if (!this.active || e.button !== 0) return;
    const h = this.#pageHit(e);
    if (!h) return;
    e.preventDefault();
    this.dragging = true;
    this.#hitAt(h, e.shiftKey);
    this.#focus(true);
  }
  #onMove(e) {
    if (!this.dragging) return;
    const h = this.#pageHit(e);
    if (h) this.#hitAt(h, true);
  }
  #onUp() { this.dragging = false; }

  // 키보드
  #flushGroup() { this.lastTyped = 0; this.#req('mark').catch(() => {}); }
  #group() { const now = performance.now(); const g = now - this.lastTyped < GAP_MS; this.lastTyped = now; return g; }

  #onKey(e) {
    if (!this.active || e.isComposing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    this.keyHandled = true;
    if (mod) {
      const lk = k.toLowerCase();
      if (lk === 'z') { e.preventDefault(); this.#undoRedo(e.shiftKey ? 'redo' : 'undo'); return; }
      if (lk === 'y') { e.preventDefault(); this.#undoRedo('redo'); return; }
      if (lk === 'b') { e.preventDefault(); this.#toggle('bold'); return; }
      if (lk === 'i') { e.preventDefault(); this.#toggle('italic'); return; }
      if (lk === 'u') { e.preventDefault(); this.#toggle('underline'); return; }
      if (lk === 's') { e.preventDefault(); this.save(); return; }
      if (lk === 'a') { e.preventDefault(); this.#selectAll(); return; }
      if (lk === 'c' || lk === 'x' || lk === 'v') return;        // 복사·잘라내기·붙여넣기는 클립보드 이벤트가 처리
      this.keyHandled = false;
      return;
    }
    const nav = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end' }[k];
    if (nav) { e.preventDefault(); this.#move(nav, e.shiftKey); return; }
    if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); this.#delete(k === 'Backspace' ? 'back' : 'fwd'); return; }
    if (k === 'Enter') { e.preventDefault(); this.#enter(); return; }
    if (k === 'Tab') { e.preventDefault(); this.#type('\t'); return; }
    if (k === 'Escape') { if (this.#hasSel()) this.#set(this.pos, this.rect, {}); return; }
    this.keyHandled = false;
  }
  #onBeforeInput(e) {
    if (!this.active) return;
    const t = e.inputType;
    if (t === 'insertCompositionText' || e.isComposing) return;   // 조합 이벤트로 처리
    e.preventDefault();
    if (t === 'insertText' && e.data) this.#type(e.data);
    else if (t === 'insertLineBreak' || t === 'insertParagraph') { if (!this.keyHandled) this.#enter(); }
    else if (t === 'deleteContentBackward') { if (!this.keyHandled) this.#delete('back'); }
    else if (t === 'deleteContentForward') { if (!this.keyHandled) this.#delete('fwd'); }
    this.keyHandled = false;
  }

  #move(kind, extend) {
    return this.#enqueue(async () => {
      if (!this.pos) return;
      this.#flushGroup(); this.pending = {};
      const r = await this.#req('move', { pos: this.pos, kind, px: this.px });
      if (r.pos) this.#set(r.pos, r.rect, { extend, keepPx: kind === 'up' || kind === 'down' });
      if (kind === 'up' || kind === 'down') this.px = r.px;
    });
  }
  #type(text) {
    if (!text) return null;
    return this.#enqueue(async () => {
      if (!this.pos) return;
      if (!(await this.#deleteSelNow())) return;
      const fmt = Object.keys(this.pending).length ? { ...this.pending } : undefined;
      await this.#doMutate('insert', { pos: this.pos, text, group: this.#group(), fmt });
    });
  }
  #enter() {
    return this.#enqueue(async () => {
      if (!this.pos) return;
      if (!(await this.#deleteSelNow())) return;
      this.#flushGroup();
      await this.#doMutate('enter', { pos: this.pos });
    });
  }
  #delete(dir) {
    return this.#enqueue(async () => {
      if (!this.pos) return;
      if (this.#hasSel()) { this.#flushGroup(); await this.#deleteSelNow(); return; }
      await this.#doMutate('del', { pos: this.pos, dir, group: false });
    });
  }
  #selectAll() {
    return this.#enqueue(async () => {
      if (!this.pos) return;
      // 같은 구역의 본문 전체(처음 ~ 마지막 문단 끝)
      const first = { s: this.pos.s, p: 0, o: 0, path: null };
      const last = await this.#req('endOf', { s: this.pos.s });
      if (last.pos) { this.#flushGroup(); this.anchor = first; this.#set(last.pos, last.rect, { extend: true }); }
    });
  }
  #undoRedo(op) {
    return this.#enqueue(async () => {
      this.#flushGroup(); this.pending = {};
      const r = await this.#req(op, { pos: this.pos });
      if (r.empty) return;
      this.#setDirty(true);
      this.viewer.refresh(r.sizes);
      this.#updateStatus(r);
      // 캐럿은 그 편집이 일어난 자리로 돌아간다. 자리가 없어졌으면 문서 처음으로.
      let pos = r.pos ?? this.pos, c = null;
      if (pos) { try { c = await this.#req('caret', { pos }); } catch { c = null; } }
      if (!c?.rect) { pos = { s: 0, p: 0, o: 0, path: null }; c = await this.#req('caret', { pos }); }
      this.#set(pos, c.rect, {});
    });
  }

  // 한글 조합 입력: 조합 중 글자를 문서에 바로 넣고 갱신 때마다 바꿔 넣는다(조합 전체가 되돌리기 한 묶음)
  #onCompStart() {
    if (!this.active) return;
    const c = this.comp = { start: null, len: 0, fmt: Object.keys(this.pending).length ? { ...this.pending } : undefined };
    this.#enqueue(async () => {
      this.#flushGroup();
      if (!(await this.#deleteSelNow())) return;
      c.start = this.pos;
    });
  }
  #onCompUpdate(e) { if (this.comp) this.#applyComp(this.comp, e.data ?? ''); }
  #onCompEnd(e) {
    const c = this.comp;
    if (!c) return;
    this.comp = null;
    this.#applyComp(c, e.data ?? '').then(() => { this.input.value = ''; this.#flushGroup(); });
  }
  #applyComp(c, text) {
    return this.#enqueue(async () => {
      if (!c.start) return;
      const replace = c.len;
      c.len = [...text].length;
      try { await this.#doMutate('insert', { pos: c.start, text, replace, group: true, fmt: c.fmt }); } catch (e) { c.len = replace; throw e; }
    });
  }

  // 클립보드
  #onPaste(e) {
    if (!this.active) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    this.#enqueue(async () => {
      if (!this.pos) return;
      if (!(await this.#deleteSelNow())) return;
      this.#flushGroup();
      await this.#doMutate('paste', { pos: this.pos, text });
    });
  }
  #onCopy(e, cut) {
    if (!this.#hasSel() || !this.selText) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', this.selText);
    if (cut) this.#delete('back');
  }

  // ── 도구줄 ────────────────────────────────────────────────────────
  #btn(cls, label, title, onClick, html) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `btn ${cls}`.trim(); b.title = title; b.setAttribute('aria-label', title);
    if (html) b.innerHTML = html; else b.textContent = label;
    // 단추를 눌러도 입력창의 포커스·선택이 사라지지 않게 한다
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', onClick);
    return b;
  }
  /** 도구줄 선택 상자. options: [[값, 글자]...]. 고르면 fn(값). */
  #select(cls, label, options, fn) {
    const el = document.createElement('select');
    el.className = `select ${cls}`; el.title = label; el.setAttribute('aria-label', label);
    this.#fillSelect(el, options);
    el.addEventListener('change', () => { if (el.value !== '') fn(el.value); });
    return el;
  }
  #fillSelect(el, options, current) {
    el.replaceChildren();
    const opts = [...options];
    if (current !== undefined && current !== '' && !opts.some(([v]) => v === String(current))) opts.unshift([String(current), String(current)]);
    for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; el.append(o); }
    if (current !== undefined) el.value = String(current);
  }
  #colorInput(label, value, fn) {
    const c = document.createElement('input');
    c.type = 'color'; c.className = 'edit-color'; c.value = value; c.title = label; c.setAttribute('aria-label', label);
    c.addEventListener('input', () => fn(c.value));
    return c;
  }
  #buildToolbar() {
    const bar = this.bar;
    bar.replaceChildren();
    bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', T.toolbar);
    this.btn = {}; this.panels = {}; this.tabBtns = {}; this.ctx = [];
    // 첫 줄: 되돌리기·다시 하기 · 탭 · 저장
    const head = document.createElement('div'); head.className = 'edit-tabs'; head.setAttribute('role', 'tablist');
    const hg = document.createElement('div'); hg.className = 'group'; hg.setAttribute('role', 'group');
    hg.append(this.btn.undo = this.#btn('icon', '', T.undo, () => this.#undoRedo('undo'), ICON.undo), this.btn.redo = this.#btn('icon', '', T.redo, () => this.#undoRedo('redo'), ICON.redo));
    this.btn.undo.disabled = true; this.btn.redo.disabled = true;
    head.append(hg);
    for (const [k, label] of Object.entries(T.tabs)) {
      const b = this.#btn('tab', label, label, () => this.#showTab(k));
      b.setAttribute('role', 'tab'); b.dataset.tab = k;
      this.tabBtns[k] = b; head.append(b);
      const pn = document.createElement('div'); pn.className = 'edit-panel'; pn.dataset.panel = k; pn.setAttribute('role', 'tabpanel'); pn.hidden = true;
      this.panels[k] = pn;
    }
    const sp = document.createElement('span'); sp.className = 'spacer'; head.append(sp);
    this.btn.save = this.#btn('primary', T.save, T.saveTitle, () => this.save());
    head.append(this.btn.save);
    bar.append(head, ...Object.values(this.panels));
    this.#buildFormatPanel();
    // 나머지 탭의 기능(표·개체·쪽 …)은 모듈이 자기 탭에 단추를 채운다
    this.api = this.#makeApi();
    installTable(this.api);
    this.#showTab('format');
  }
  #showTab(k) {
    this.tab = k;
    for (const [name, pn] of Object.entries(this.panels)) pn.hidden = name !== k;
    for (const [name, b] of Object.entries(this.tabBtns)) { b.setAttribute('aria-selected', String(name === k)); b.setAttribute('aria-pressed', String(name === k)); }
  }
  /** 도구줄 패널 안의 단추 묶음. */
  #panelGroup(panel) {
    const g = document.createElement('div'); g.className = 'group'; g.setAttribute('role', 'group');
    this.panels[panel].append(g);
    return g;
  }
  #buildFormatPanel() {
    const grp = () => this.#panelGroup('format');
    let g = grp();
    this.fontSel = this.#select('edit-font', T.font, [], (v) => this.#format({ fontName: v }));
    g.append(this.fontSel);
    this.sizeLabel = document.createElement('span'); this.sizeLabel.className = 'edit-size';
    g.append(this.#btn('icon', '−', T.sizeDown, () => this.#size(-1)), this.sizeLabel, this.#btn('icon', '+', T.sizeUp, () => this.#size(1)));
    g = grp();
    g.append(
      this.btn.bold = this.#btn('icon fmt-b', 'B', T.bold, () => this.#toggle('bold')),
      this.btn.italic = this.#btn('icon fmt-i', 'I', T.italic, () => this.#toggle('italic')),
      this.btn.underline = this.#btn('icon fmt-u', 'U', T.underline, () => this.#toggle('underline')),
      this.btn.strikethrough = this.#btn('icon fmt-s', 'S', T.strike, () => this.#toggle('strikethrough')),
    );
    g = grp();
    this.colorInput = this.#colorInput(T.color, '#000000', (v) => this.#format({ textColor: v }));
    this.shadeInput = this.#colorInput(T.highlight, '#ffff00', (v) => this.#format({ shadeColor: v }));
    g.append(this.colorInput, this.shadeInput, this.#btn('', T.highlightOffLabel, T.highlightOff, () => this.#format({ shadeColor: '#ffffff' })));
    g = grp();
    this.spacingLabel = document.createElement('span'); this.spacingLabel.className = 'edit-size'; this.spacingLabel.title = T.spacingTitle;
    this.ratioLabel = document.createElement('span'); this.ratioLabel.className = 'edit-size'; this.ratioLabel.title = T.ratioTitle;
    const cap = (t) => { const e = document.createElement('span'); e.className = 'edit-cap'; e.textContent = t; return e; };
    g.append(
      cap(T.spacing), this.#btn('icon', '−', T.spacingDown, () => this.#spacing(-1)), this.spacingLabel, this.#btn('icon', '+', T.spacingUp, () => this.#spacing(1)),
      cap(T.ratio), this.#btn('icon', '−', T.ratioDown, () => this.#ratio(-5)), this.ratioLabel, this.#btn('icon', '+', T.ratioUp, () => this.#ratio(5)),
    );
    g = grp();
    for (const a of ['left', 'center', 'right', 'justify']) g.append(this.btn[a] = this.#btn('icon', '', T[a], () => this.#align(a), ICON[a]));
    this.lineSel = this.#select('edit-line', T.lineSpacing, LINE_SPACINGS.map((v) => [String(v), `${v}%`]), (v) => this.#paraFmt({ lineSpacing: Number(v), lineSpacingType: 'Percent' }));
    g.append(this.lineSel, this.#btn('icon', '', T.indentLess, () => this.#indent(-1), ICON.indentLess), this.#btn('icon', '', T.indentMore, () => this.#indent(1), ICON.indentMore));
    this.btn.marks = this.#btn('icon', '¶', T.marks, () => this.#toggleMarks());
    g.append(this.btn.marks);
  }

  /** 기능 모듈(ed-*.js)이 쓰는 창구. 모듈은 이 객체로만 편집기와 통신한다. */
  #makeApi() {
    const ed = this;
    return {
      get pos() { return ed.pos; }, get anchor() { return ed.anchor; }, get rect() { return ed.rect; }, get tbl() { return ed.tbl; }, get cellBlock() { return ed.cellBlock; },
      get cur() { return ed.cur; }, get hasSel() { return ed.#hasSel(); }, get fileName() { return ed.fileName; }, get meta() { return ed.meta; },
      group: (panel) => ed.#panelGroup(panel),
      btn: (cls, label, title, fn, html) => ed.#btn(cls, label, title, fn, html),
      select: (cls, label, options, fn) => ed.#select(cls, label, options, fn),
      fillSelect: (el, options, cur) => ed.#fillSelect(el, options, cur),
      colorInput: (label, value, fn) => ed.#colorInput(label, value, fn),
      form: (title, fields) => askForm(title, fields, { ok: T.ok, cancel: T.cancel }).finally(() => ed.#refocus()),
      ask: (title, lines, yes, no) => ed.#ask(title, lines, yes, no),
      status: (m) => ed.status(m),
      enqueue: (fn) => ed.#enqueue(fn),
      req: (op, payload) => ed.#req(op, payload),
      /** 대기열 안에서: 문서를 바꾸는 rhwp API를 부르고 화면·캐럿을 맞춘다. 돌려주는 값은 API의 결과 JSON. */
      mutateApi: (fn, args, opts) => ed.#apiCall(fn, args, opts),
      /** 대기열 안에서: 캐럿을 pos로(없으면 가까운 곳으로) 옮긴다. */
      placeCaret: (pos) => ed.#revalidate(pos),
      onContext: (fn) => ed.ctx.push(fn),
      focus: () => ed.#focus(true),
    };
  }
  /** (작업 안에서) 문서를 바꾸는 rhwp API 호출: 되돌리기 항목·변경 표시·쪽 다시 그리기·캐럿 보정까지. */
  async #apiCall(fn, args, { pos = this.pos, op = 'api' } = {}) {
    this.#flushGroup(); this.pending = {};
    const r = await this.#req(op, { fn, args });
    this.#setDirty(true);
    this.viewer.refresh(r.sizes, {});
    this.#updateStatus(await this.#req('status', {}));
    await this.#revalidate(pos);
    return r.result;
  }
  /** (작업 안에서) 캐럿을 pos에 두되, 그 자리가 없어졌으면(칸·표가 지워진 경우) 같은 문단의 처음, 그것도 없으면 문서 처음으로. */
  async #revalidate(pos) {
    let c = null, at = pos;
    if (at) { try { c = await this.#req('caret', { pos: at }); } catch { c = null; } }
    if (!c?.rect && at?.path) { at = { s: at.s, p: at.p, o: 0, path: null }; try { c = await this.#req('caret', { pos: at }); } catch { c = null; } }
    if (!c?.rect) { at = { s: 0, p: 0, o: 0, path: null }; c = await this.#req('caret', { pos: at }); }
    this.anchor = null;
    this.#set(at, c.rect, {});
  }
  #updateToolbar() {
    for (const f of this.ctx ?? []) f();
    const c = { ...this.cur, ...this.pending };
    for (const k of ['bold', 'italic', 'underline', 'strikethrough']) this.btn[k].setAttribute('aria-pressed', String(!!c[k]));
    const al = this.cur.alignment;
    for (const a of ['left', 'center', 'right', 'justify']) this.btn[a].setAttribute('aria-pressed', String(al === a));
    this.sizeLabel.textContent = c.fontSize ? `${Math.round(c.fontSize / 10) / 10}pt` : '';
    if (c.textColor && /^#[0-9a-f]{6}$/i.test(c.textColor)) this.colorInput.value = c.textColor.toLowerCase();
    if (c.shadeColor && /^#[0-9a-f]{6}$/i.test(c.shadeColor) && c.shadeColor.toLowerCase() !== '#ffffff') this.shadeInput.value = c.shadeColor.toLowerCase();
    this.spacingLabel.textContent = c.spacings ? `${c.spacings[0]}%` : '';
    this.ratioLabel.textContent = c.ratios ? `${c.ratios[0]}%` : '';
    const fam = c.fontFamily ?? '';
    if (this.fontSel.value !== fam) this.#fillSelect(this.fontSel, this.fontOptions ?? [], fam);
    const ls = this.cur.lineSpacing ? String(Math.round(this.cur.lineSpacing)) : '';
    if (ls && this.lineSel.value !== ls) this.#fillSelect(this.lineSel, LINE_SPACINGS.map((v) => [String(v), `${v}%`]), ls);
  }
  #updateStatus(r) {
    if (r && r.canUndo !== undefined) { this.btn.undo.disabled = !r.canUndo; this.btn.redo.disabled = !r.canRedo; }
  }
  #scheduleProps() {
    clearTimeout(this.propsTimer);
    this.propsTimer = setTimeout(async () => {
      if (!this.pos || !this.active) return;
      const r = await this.#call('props', { pos: this.pos });
      if (r) { this.cur = { ...(r.char ?? {}), alignment: r.para?.alignment ?? r.para?.align, lineSpacing: r.para?.lineSpacing, marginLeft: r.para?.marginLeft }; this.tbl = r.table ?? null; this.#updateToolbar(); }
      const s = await this.#call('status', {});
      if (s) this.#updateStatus(s);
    }, 80);
  }

  #format(props) {
    return this.#enqueue(async () => {
      if (!this.pos) return;
      if (this.cellBlock) {
        this.#flushGroup();
        const r = await this.#req('cellfmt', { a: this.anchor, b: this.pos, kind: 'char', props });
        if (r.skipped) { this.status(T.readonlyHere); return; }
        this.#setDirty(true); this.viewer.refresh(r.sizes, {}); this.#scheduleProps();
        this.#updateStatus(await this.#req('status', {}));
      } else if (this.#hasSel()) {
        this.#flushGroup();
        const r = await this.#req('fmt', { a: this.anchor, b: this.pos, props });
        if (r.skipped) { this.status(T.readonlyHere); return; }
        this.#setDirty(true); this.viewer.refresh(r.sizes); this.#scheduleProps();
        this.#updateStatus(await this.#req('status', {}));
      } else { Object.assign(this.pending, props); this.#updateToolbar(); }
      this.#focus();
    });
  }
  #toggle(key) { const now = ({ ...this.cur, ...this.pending })[key]; return this.#format({ [key]: !now }); }
  #size(d) {
    const cur = ({ ...this.cur, ...this.pending }).fontSize ?? 1000;
    return this.#format({ fontSize: Math.min(SZ_MAX, Math.max(SZ_MIN, Math.round(cur / 100) * 100 + d * 100)) });
  }
  #spacing(d) {
    const v = Math.min(50, Math.max(-50, (this.cur.spacings?.[0] ?? 0) + d));
    return this.#format({ spacings: [v, v, v, v, v, v, v] });
  }
  #ratio(d) {
    const v = Math.min(200, Math.max(50, (this.cur.ratios?.[0] ?? 100) + d));
    return this.#format({ ratios: [v, v, v, v, v, v, v] });
  }
  #align(a) { return this.#paraFmt({ alignment: a }); }
  #indent(dir) {
    // 현재 문단의 왼쪽 여백(96dpi 픽셀)을 한 단계씩 늘리거나 줄인다(0 아래로는 내려가지 않는다)
    const now = Math.round((this.cur.marginLeft ?? 0) * PX_TO_HWPUNIT);
    return this.#paraFmt({ marginLeft: Math.max(0, now + dir * INDENT_STEP) });
  }
  #paraFmt(props) {
    return this.#enqueue(async () => {
      if (!this.pos) return;
      this.#flushGroup();
      const [x, y] = this.#range();
      const r = this.cellBlock ? await this.#req('cellfmt', { a: this.anchor, b: this.pos, kind: 'para', props }) : await this.#req('parafmt', { a: x, b: y, props });
      this.#setDirty(true); this.viewer.refresh(r.sizes); this.#scheduleProps();
      this.#updateStatus(await this.#req('status', {}));
      this.#focus();
    });
  }
  #toggleMarks() {
    return this.#enqueue(async () => {
      const on = this.btn.marks.getAttribute('aria-pressed') !== 'true';
      const r = await this.#req('marks', { on });
      this.btn.marks.setAttribute('aria-pressed', String(r.on));
      this.viewer.refresh(r.sizes);   // 보이는 쪽을 모두 다시 그린다(문서 내용은 바뀌지 않는다)
      this.#focus();
    });
  }

  // ── 저장 ──────────────────────────────────────────────────────────
  #ext() { return /\.hwpx$/i.test(this.fileName) ? 'hwpx' : 'hwp'; }
  #suggested() { return `${this.fileName.replace(/\.hwpx?$/i, '')} (편집).${this.#ext()}`; }

  /** 확인 대화상자. 계속하면 true. */
  #ask(title, lines, yes, no) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'dialog';
      dlg.innerHTML = '<form method="dialog"><h2></h2><ul class="dialog-list"></ul><div class="dialog-actions"><button type="button" class="btn" data-no></button><button type="button" class="btn primary" data-yes></button></div></form>';
      dlg.querySelector('h2').textContent = title;
      const ul = dlg.querySelector('ul');
      for (const t of lines) { const li = document.createElement('li'); li.textContent = t; ul.append(li); }
      dlg.querySelector('[data-no]').textContent = no; dlg.querySelector('[data-yes]').textContent = yes;
      const done = (v) => { dlg.close(); dlg.remove(); resolve(v); queueMicrotask(() => this.#refocus()); };
      dlg.querySelector('[data-no]').addEventListener('click', () => done(false));
      dlg.querySelector('[data-yes]').addEventListener('click', () => done(true));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
      document.body.append(dlg);
      dlg.showModal();
      dlg.querySelector('[data-no]').focus();
    });
  }
  /** 저장하지 않은 변경이 있을 때 문서를 닫아도 되는지 묻는다. */
  async confirmSlow(openMs) {
    if (!(openMs > SLOW_OPEN_MS)) return true;
    return this.#ask(T.slowTitle, [T.slowBody(Math.round(openMs / 1000))], T.keepEditing, T.cancelEdit);
  }
  async confirmDiscard() {
    if (!this.dirty) return true;
    return this.#ask(T.discardTitle, [T.discardBody], T.discard, T.stay);
  }

  async save() {
    if (this.saving) return;
    this.saving = true;
    this.btn.save.disabled = true;
    this.status(T.saving);
    try {
      const format = this.#ext();
      const r = await this.#enqueue(async () => { this.#flushGroup(); return this.#req('save', { format }); });
      if (!r) { this.status(T.saveFailed); return; }
      const v = r.verify ?? {};
      const warn = [];
      if (v.checked && v.reopenError) warn.push(T.reopenFail);
      else if (v.checked && !v.ok) warn.push(T.verifyFail(v.diffs));
      if (v.checked && !v.reopenError && v.pagesBefore !== v.pagesAfter) warn.push(T.pagesChanged(v.pagesBefore, v.pagesAfter));
      if (this.meta?.hwp3) warn.push(T.hwp3);
      if (warn.length && !(await this.#ask(T.warnTitle, warn, T.keepSaving, T.cancelSave))) { this.status(T.saveCancelled); return; }
      const blob = new Blob([r.bytes], { type: 'application/octet-stream' });
      const where = await this.#write(blob, this.#suggested());
      if (where === null) { this.status(T.saveCancelled); return; }
      await this.#call('clean');
      this.#setDirty(false);
      this.status(T.saved(where));
    } catch (e) {
      console.warn('save', e);
      this.status(T.saveFailed);
    } finally {
      this.saving = false; this.btn.save.disabled = false;
      this.#focus();
    }
  }

  /** 파일로 쓴다. 저장 위치 선택(File System Access API)이 되면 그것을, 아니면 다운로드를 쓴다. 취소하면 null. */
  async #write(blob, name) {
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const ext = '.' + name.split('.').pop();
        const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: '한글 문서', accept: { 'application/octet-stream': [ext] } }] });
        const w = await h.createWritable();
        await w.write(blob); await w.close();
        return h.name;
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
        // 보안 오류(사용자 동작이 만료됨) 등은 다운로드로 대신한다
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    return name;
  }
}

export function createEditor(env) { return new Editor(env); }
