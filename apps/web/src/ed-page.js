// 편집기 "쪽" 탭과 입력 탭의 쪽·각주 단추: 쪽 설정(용지·방향·여백), 단 설정, 쪽 테두리·배경, 쪽 감추기, 쪽·단 나누기, 새 번호,
// 머리글·바닥글(대화상자로 줄 단위 편집), 쪽 번호 넣기, 각주·미주(넣기·편집·지우기).
// 머리글·바닥글·각주는 본문처럼 글 위에서 바로 고치는 대신 대화상자로 고친다(그 안의 글은 캐럿 층이 아직 다루지 않는다).
const TP = {
  pageSetup: '쪽 설정…', cols: '단 설정…', border: '쪽 테두리·배경…', hide: '쪽 감추기…', pbreak: '쪽 나누기', cbreak: '단 나누기', newNum: '새 번호로 시작…',
  header: '머리글…', footer: '바닥글…', pageNo: '쪽 번호 넣기…', fnIns: '각주 넣기', enIns: '미주 넣기', fnEdit: '각주·미주 편집…', fnDel: '각주·미주 지우기',
  paper: '용지', paperSizes: [['A4', 'A4 (210×297)', 59528, 84188], ['A3', 'A3 (297×420)', 84188, 119055], ['A5', 'A5 (148×210)', 41953, 59528], ['B5', 'B5 (176×250)', 49890, 70866],
    ['B4', 'B4 (250×353)', 70866, 100063], ['Letter', 'Letter (8.5×11in)', 61200, 79200], ['Legal', 'Legal (8.5×14in)', 61200, 100800], ['custom', '사용자 지정', 0, 0]],
  width: '너비(mm)', height: '높이(mm)', orient: '방향', orients: [['0', '세로'], ['1', '가로']], mTop: '위 여백(mm)', mBottom: '아래 여백(mm)', mLeft: '왼쪽 여백(mm)', mRight: '오른쪽 여백(mm)',
  mHeader: '머리말 여백(mm)', mFooter: '꼬리말 여백(mm)', mGutter: '제본 여백(mm)', startNo: '쪽 번호 시작(0은 이어서)',
  colCount: '단 수', colType: '단 종류', colTypes: [['0', '일반'], ['1', '배분'], ['2', '평행']], same: '같은 너비', spacing: '단 간격(mm)',
  lineType: '선 종류', lineWidth: '선 굵기', lineColor: '선 색', fill: '배경', fillNone: '없음', fillSolid: '색', fillColor: '배경 색',
  hHeader: '머리말 감추기', hFooter: '꼬리말 감추기', hMaster: '바탕쪽 감추기', hBorder: '테두리 감추기', hFill: '배경 감추기', hNum: '쪽 번호 감추기',
  newNo: '시작할 번호', applyTo: '적용 쪽', applies: [['0', '양쪽'], ['1', '짝수 쪽'], ['2', '홀수 쪽']], align: '정렬', aligns: [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']],
  hfText: '내용(줄마다 한 문단)', hfHint: '쪽 번호는 {쪽}, 전체 쪽 수는 {전체쪽}, 파일 이름은 {파일이름}. 비우고 확인하면 지웁니다.',
  where: '넣을 곳', wheres: [['footer', '바닥글'], ['header', '머리글']], fmt: '모양', fmts: [['{쪽}', '3'], ['- {쪽} -', '- 3 -'], ['{쪽} / {전체쪽}', '3 / 12'], ['쪽 {쪽}', '쪽 3']],
  fnText: '각주 내용(줄마다 한 문단)', noFn: '캐럿 근처에 각주·미주가 없습니다', fnDelAsk: '각주를 지울까요?', fnDelBody: '각주(미주)와 그 내용이 지워집니다. 실행 취소로 되돌릴 수 있습니다.', del: '지우기', no: '취소',
};
const MM = 283.465;
const mm = (hu) => Math.round((hu / MM) * 10) / 10;
const hu = (v) => Math.round(v * MM);
const LINES = [['0', '없음'], ['1', '실선'], ['2', '파선'], ['3', '점선'], ['4', '일점 쇄선'], ['8', '이중선']];
const WIDTHS = ['0.1', '0.12', '0.15', '0.2', '0.25', '0.3', '0.4', '0.5', '0.6', '0.7', '1.0', '1.5', '2.0', '3.0', '4.0', '5.0'].map((w, i) => [String(i), `${w}mm`]);

export function installPage(api) {
  const run = (fn) => api.enqueue(fn);
  const mk = (label, title, fn) => { const b = api.btn('', label, title ?? label, fn); b.setAttribute('aria-label', label); return b; };
  const q = async (fn, args) => (await api.req('q', { fn, args })).result;

  // ── 쪽 탭 ──
  let g = api.group('page');
  g.append(mk(TP.pageSetup, null, () => run(pageSetup)), mk(TP.cols, null, () => run(colSetup)), mk(TP.border, null, () => run(pageBorder)), mk(TP.hide, null, () => run(pageHide)));
  g = api.group('page');
  g.append(
    mk(TP.pbreak, null, () => run(async () => { const p = api.pos; if (!p || p.path) return; await api.mutateApi('insertPageBreak', [p.s, p.p, p.o]); })),
    mk(TP.cbreak, null, () => run(async () => { const p = api.pos; if (!p || p.path) return; await api.mutateApi('insertColumnBreak', [p.s, p.p, p.o]); })),
    mk(TP.newNum, null, () => run(newNumber)),
  );
  g = api.group('page');
  g.append(mk(TP.header, null, () => run(() => headerFooter(true))), mk(TP.footer, null, () => run(() => headerFooter(false))), mk(TP.pageNo, null, () => run(pageNumber)));

  // ── 입력 탭: 각주·미주 ──
  g = api.group('insert');
  g.append(mk(TP.fnIns, null, () => run(() => noteInsert('insertFootnote'))), mk(TP.enIns, null, () => run(() => noteInsert('insertEndnote'))), mk(TP.fnEdit, null, () => run(noteEdit)), mk(TP.fnDel, null, () => run(noteDelete)));

  const sec = () => api.pos?.s ?? 0;

  async function pageSetup() {
    const s = sec();
    const pd = await q('getPageDef', [s]), sd = await q('getSectionDef', [s]);
    if (!pd) return;
    const known = TP.paperSizes.find(([, , w, h]) => Math.abs(w - pd.width) < 60 && Math.abs(h - pd.height) < 60)?.[0] ?? 'custom';
    const v = await api.form(TP.pageSetup, [
      { key: 'paper', label: TP.paper, type: 'select', value: known, options: TP.paperSizes.map(([k, t]) => [k, t]) },
      { key: 'w', label: TP.width, type: 'number', value: mm(pd.width), min: 30, max: 1200, step: 0.1, hint: '용지가 "사용자 지정"일 때만 쓰입니다(세로 기준 값).' },
      { key: 'h', label: TP.height, type: 'number', value: mm(pd.height), min: 30, max: 1200, step: 0.1 },
      { key: 'orient', label: TP.orient, type: 'select', value: pd.landscape ? '1' : '0', options: TP.orients },
      { key: 'mt', label: TP.mTop, type: 'number', value: mm(pd.marginTop), min: 0, step: 0.1 }, { key: 'mb', label: TP.mBottom, type: 'number', value: mm(pd.marginBottom), min: 0, step: 0.1 },
      { key: 'ml', label: TP.mLeft, type: 'number', value: mm(pd.marginLeft), min: 0, step: 0.1 }, { key: 'mr', label: TP.mRight, type: 'number', value: mm(pd.marginRight), min: 0, step: 0.1 },
      { key: 'mh', label: TP.mHeader, type: 'number', value: mm(pd.marginHeader), min: 0, step: 0.1 }, { key: 'mf', label: TP.mFooter, type: 'number', value: mm(pd.marginFooter), min: 0, step: 0.1 },
      { key: 'mg', label: TP.mGutter, type: 'number', value: mm(pd.marginGutter ?? 0), min: 0, step: 0.1 },
      { key: 'start', label: TP.startNo, type: 'number', value: sd?.pageNum ?? 0, min: 0, max: 100000 },
    ]);
    if (!v) return;
    const preset = TP.paperSizes.find(([k]) => k === v.paper);
    const w = preset && preset[2] ? preset[2] : hu(v.w), h = preset && preset[3] ? preset[3] : hu(v.h);
    const json = { width: w, height: h, landscape: v.orient === '1', marginTop: hu(v.mt), marginBottom: hu(v.mb), marginLeft: hu(v.ml), marginRight: hu(v.mr), marginHeader: hu(v.mh), marginFooter: hu(v.mf), marginGutter: hu(v.mg) };
    await api.mutateApi('setPageDef', [s, JSON.stringify(json)]);
    if (v.start !== (sd?.pageNum ?? 0)) await api.mutateApi('setSectionDef', [s, JSON.stringify({ pageNum: v.start })]);
  }

  async function colSetup() {
    const s = sec();
    const c = await q('getColumnDef', [s]); if (!c) return;
    const v = await api.form(TP.cols, [
      { key: 'n', label: TP.colCount, type: 'number', value: c.columnCount ?? 1, min: 1, max: 8 },
      { key: 'type', label: TP.colType, type: 'select', value: String(c.columnType ?? 0), options: TP.colTypes },
      { key: 'same', label: TP.same, type: 'checkbox', value: c.sameWidth !== false },
      { key: 'sp', label: TP.spacing, type: 'number', value: mm(c.spacing ?? 1134), min: 0, max: 100, step: 0.5 },
    ]);
    if (!v) return;
    await api.mutateApi('setColumnDef', [s, v.n, Number(v.type), v.same ? 1 : 0, hu(v.sp)]);
  }

  async function pageBorder() {
    const s = sec();
    const b = await q('getPageBorderFill', [s]); if (!b) return;
    const bl = b.borderLeft ?? {};
    const v = await api.form(TP.border, [
      { key: 'type', label: TP.lineType, type: 'select', value: String(bl.type ?? 0), options: LINES },
      { key: 'width', label: TP.lineWidth, type: 'select', value: String(bl.width ?? 1), options: WIDTHS },
      { key: 'color', label: TP.lineColor, type: 'color', value: /^#[0-9a-f]{6}$/i.test(bl.color ?? '') ? bl.color : '#000000' },
      { key: 'fill', label: TP.fill, type: 'select', value: b.fillType === 'solid' ? 'solid' : 'none', options: [['none', TP.fillNone], ['solid', TP.fillSolid]] },
      { key: 'fc', label: TP.fillColor, type: 'color', value: /^#[0-9a-f]{6}$/i.test(b.fillColor ?? '') && b.fillColor !== '#ffffff' ? b.fillColor : '#ffffcc' },
    ]);
    if (!v) return;
    const line = { type: Number(v.type), width: Number(v.width), color: v.color };
    const json = { borderLeft: line, borderRight: line, borderTop: line, borderBottom: line, fillType: v.fill === 'solid' ? 'solid' : 'none' };
    if (v.fill === 'solid') json.fillColor = v.fc;
    await api.mutateApi('setPageBorderFill', [s, JSON.stringify(json)]);
  }

  async function pageHide() {
    const p = api.pos; if (!p || p.path) return;
    const h = (await q('getPageHide', [p.s, p.p])) ?? {};
    const v = await api.form(TP.hide, [
      { key: 'hh', label: TP.hHeader, type: 'checkbox', value: !!h.hideHeader }, { key: 'hf', label: TP.hFooter, type: 'checkbox', value: !!h.hideFooter },
      { key: 'hm', label: TP.hMaster, type: 'checkbox', value: !!h.hideMasterPage }, { key: 'hb', label: TP.hBorder, type: 'checkbox', value: !!h.hideBorder },
      { key: 'hfill', label: TP.hFill, type: 'checkbox', value: !!h.hideFill }, { key: 'hn', label: TP.hNum, type: 'checkbox', value: !!h.hidePageNum },
    ]);
    if (!v) return;
    await api.mutateApi('setPageHide', [p.s, p.p, v.hh, v.hf, v.hm, v.hb, v.hfill, v.hn]);
  }

  async function newNumber() {
    const p = api.pos; if (!p || p.path) return;
    const v = await api.form(TP.newNum, [{ key: 'n', label: TP.newNo, type: 'number', value: 1, min: 0, max: 100000 }]);
    if (!v) return;
    await api.mutateApi('insertNewNumber', [p.s, p.p, p.o, v.n]);
  }

  // ── 머리글·바닥글 ──
  async function headerFooter(header) {
    const s = sec();
    let applyTo = 0;
    const cur = await api.req('hfget', { s, header, applyTo });
    const v = await api.form(header ? TP.header : TP.footer, [
      { key: 'applyTo', label: TP.applyTo, type: 'select', value: '0', options: TP.applies },
      { key: 'align', label: TP.align, type: 'select', value: 'center', options: TP.aligns },
      { key: 'text', label: TP.hfText, type: 'textarea', value: cur.lines.join('\n'), rows: 4, hint: TP.hfHint },
    ]);
    if (!v) return;
    applyTo = Number(v.applyTo);
    const lines = v.text.split('\n');
    await api.req('mark', {});
    const r = await api.req('hfset', { s, header, applyTo, lines: lines.every((x) => x.trim() === '') ? [] : lines, alignment: v.align });
    api.setDirty(true); api.viewer.refresh(r.sizes, {});
    await api.placeCaret(api.pos);
  }

  async function pageNumber() {
    const s = sec();
    const v = await api.form(TP.pageNo, [
      { key: 'where', label: TP.where, type: 'select', value: 'footer', options: TP.wheres },
      { key: 'align', label: TP.align, type: 'select', value: 'center', options: TP.aligns },
      { key: 'fmt', label: TP.fmt, type: 'select', value: '{쪽}', options: TP.fmts },
    ]);
    if (!v) return;
    const header = v.where === 'header';
    const cur = await api.req('hfget', { s, header, applyTo: 0 });
    const lines = cur.exists ? [...cur.lines.filter((x) => x.trim() !== ''), v.fmt] : [v.fmt];
    const r = await api.req('hfset', { s, header, applyTo: 0, lines, alignment: v.align });
    api.setDirty(true); api.viewer.refresh(r.sizes, {});
    await api.placeCaret(api.pos);
  }

  // ── 각주·미주 ──
  async function noteInsert(fn) {
    const p = api.pos; if (!p || p.path) return;
    const res = await api.mutateApi(fn, [p.s, p.p, p.o]);
    if (res?.paraIdx == null) return;
    const v = await api.form(fn === 'insertFootnote' ? TP.fnIns : TP.enIns, [{ key: 'text', label: TP.fnText, type: 'textarea', value: '', rows: 4 }]);
    if (!v || !v.text) return;
    const r = await api.req('fnset', { s: p.s, p: res.paraIdx, ctrl: res.controlIdx ?? 0, lines: v.text.split('\n') });
    api.setDirty(true); api.viewer.refresh(r.sizes, {});
    await api.placeCaret(api.pos);
  }
  async function noteEdit() {
    const p = api.pos; if (!p) return;
    const f = (await api.req('fnat', { pos: p })).fn;
    if (!f) { api.status(TP.noFn); return; }
    const v = await api.form(TP.fnEdit, [{ key: 'text', label: TP.fnText, type: 'textarea', value: f.lines.join('\n'), rows: 4 }]);
    if (!v) return;
    const r = await api.req('fnset', { s: p.s, p: p.p, ctrl: f.ctrl, lines: v.text.split('\n') });
    api.setDirty(true); api.viewer.refresh(r.sizes, {});
    await api.placeCaret(api.pos);
  }
  async function noteDelete() {
    const p = api.pos; if (!p) return;
    const f = (await api.req('fnat', { pos: p })).fn;
    if (!f) { api.status(TP.noFn); return; }
    if (!(await api.ask(TP.fnDelAsk, [TP.fnDelBody], TP.del, TP.no))) return;
    await api.mutateApi('deleteFootnote', [p.s, p.p, f.ctrl]);
  }
}
