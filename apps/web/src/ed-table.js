// 편집기 "표" 탭: 표 만들기, 행·열 넣기·지우기, 칸 합치기·나누기, 칸·표 속성, 칸 크기 맞추기, 표 나누기·붙이기, 행열 바꾸기, 표 지우기.
// 구조 편집은 최상위 표만 한다(중첩 표 안의 칸에서는 단추가 꺼진다). 칸 블록은 shift+클릭·끌기로 서로 다른 칸을 이은 선택이다(editor.js).
const TT = {
  create: '표 만들기', createTitle: '캐럿 위치에 표를 넣습니다', rows: '줄 수', cols: '칸 수',
  rowAbove: '위에 줄 넣기', rowBelow: '아래에 줄 넣기', rowDel: '줄 지우기', colLeft: '왼쪽에 칸 넣기', colRight: '오른쪽에 칸 넣기', colDel: '칸 지우기(열)',
  merge: '칸 합치기', split: '칸 나누기', cellProps: '칸 속성…', cellClear: '칸 글 지우기', eqW: '너비 같게', eqH: '높이 같게',
  tblProps: '표 속성…', tblSplit: '표 나누기', tblMerge: '아래 표와 합치기', transpose: '줄·칸 바꾸기', tblDel: '표 지우기',
  nestedNo: '안쪽(중첩) 표에서는 쓸 수 없습니다(칸 크기 맞추기·표 지우기만 됩니다)', needTable: '표 안에서만 쓸 수 있습니다', needBlock: '합치려면 둘 이상의 칸을 끌어 선택하세요', notInCell: '표 안에서는 표를 새로 넣을 수 없습니다',
  lastRow: '마지막 줄은 지울 수 없습니다. 표 전체를 지우려면 "표 지우기"를 누르세요.', lastCol: '마지막 칸(열)은 지울 수 없습니다. 표 전체를 지우려면 "표 지우기"를 누르세요.',
  nRows: '나눌 줄 수', mCols: '나눌 칸 수', equal: '줄 높이를 같게', mergeFirst: '합친 뒤 나누기',
  fill: '배경', fillNone: '없음', fillSolid: '색', fillColor: '배경 색', borderTarget: '테두리 적용 위치', bt: { all: '모두', outer: '바깥', top: '위', bottom: '아래', left: '왼쪽', right: '오른쪽', none: '모두 없음' },
  lineType: '선 종류', lineWidth: '선 굵기', lineColor: '선 색', valign: '세로 맞춤', va: { 0: '위', 1: '가운데', 2: '아래' }, header: '제목 칸',
  pageBreak: '쪽 나눔', pb: { 0: '나누지 않음', 1: '칸 단위로 나눔', 2: '줄 단위로 나눔' }, repeatHeader: '제목 줄 반복', spacing: '칸 사이 간격', padding: '안 여백(HWPUNIT)',
  tblDelAsk: '표를 지울까요?', tblDelBody: '표와 표 안의 글이 모두 지워집니다. 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.', yesDel: '지우기', no: '취소',
};
const LINE_TYPES = [['0', '없음'], ['1', '실선'], ['2', '파선'], ['3', '점선'], ['4', '일점 쇄선'], ['5', '이점 쇄선'], ['6', '긴 파선'], ['7', '원형 점선'], ['8', '이중선'], ['9', '가는선+굵은선'], ['10', '굵은선+가는선'], ['11', '삼중선'], ['12', '물결선']];
const LINE_WIDTHS = ['0.1', '0.12', '0.15', '0.2', '0.25', '0.3', '0.4', '0.5', '0.6', '0.7', '1.0', '1.5', '2.0', '3.0', '4.0', '5.0'].map((w, i) => [String(i), `${w}mm`]);

export function installTable(api) {
  const g = (n) => api.group('table');
  const btns = {};
  const mk = (key, label, title, fn) => { const b = api.btn('', label, title ?? label, fn); b.setAttribute('aria-label', label); btns[key] = b; return b; };
  const run = (fn) => api.enqueue(fn);
  const NESTED_OK = new Set(['eqW', 'eqH', 'tblDel']);

  /** 지금 고른 칸(들)의 표 좌표. 칸 블록이면 그 사각형, 아니면 캐럿이 든 한 칸. 도구줄 상태는 한 박자 늦게 갱신되므로 실행 시점에 Worker에서 새로 읽는다. */
  const sel = async () => {
    const a = api.anchor, p = api.pos;
    if (a && p && a.path && p.path) {
      const cr = await api.req('cellrange', { a, b: p });
      if (cr.range) { const b = cr.range; return { s: b.s, p: b.p, ctrl: b.ctrl, r1: b.r1, c1: b.c1, r2: b.r2, c2: b.c2, rows: b.rows, cols: b.cols, block: true, cells: cr.cells }; }
    }
    const t = p ? (await api.req('tableAt', { pos: p })).table : null;
    if (!t) return null;
    if (t.nested) return { nested: true, s: t.s, p: t.p, path: t.path, rows: t.rows, cols: t.cols, block: false, cells: [t.cell] };   // 안쪽 표: 크기 맞추기·표 지우기만 된다
    return { s: t.s, p: t.p, ctrl: t.ctrl, r1: t.row, c1: t.col, r2: t.row + t.rowSpan - 1, c2: t.col + t.colSpan - 1, rows: t.rows, cols: t.cols, block: false, cells: [t.cell] };
  };
  /** (작업 안에서) 표 칸 번호는 줄 우선 순서라 줄·칸을 넣고 빼면 바뀐다: (줄, 칸)에 있는 칸으로 캐럿을 옮긴다. */
  const placeIn = async (t, row, col) => {
    const r = await api.req('q', { fn: 'getTableCellBboxes', args: [t.s, t.p, t.ctrl] });
    const boxes = r.result ?? [];
    const hit = boxes.find((x) => x.row <= row && row <= x.row + x.rowSpan - 1 && x.col <= col && col <= x.col + x.colSpan - 1) ?? boxes[0];
    await api.placeCaret(hit ? { s: t.s, p: t.p, o: 0, path: [{ controlIndex: t.ctrl, cellIndex: hit.cellIdx, cellParaIndex: 0 }] } : { s: t.s, p: t.p, o: 0, path: null });
  };

  // ── 만들기 ──
  let gp = g();
  gp.append(mk('create', TT.create, TT.createTitle, () => run(async () => {
    if (api.pos?.path) { api.status(TT.notInCell); return; }
    const v = await api.form(TT.create, [{ key: 'rows', label: TT.rows, type: 'number', value: 3, min: 1, max: 100 }, { key: 'cols', label: TT.cols, type: 'number', value: 3, min: 1, max: 30 }]);
    if (!v) return;
    const pos = api.pos; if (!pos) return;
    const res = await api.mutateApi('createTable', [pos.s, pos.p, pos.o, v.rows, v.cols]);
    if (res?.paraIdx == null) return;
    await api.placeCaret({ s: pos.s, p: res.paraIdx, o: 0, path: [{ controlIndex: res.controlIdx ?? 0, cellIndex: 0, cellParaIndex: 0 }] });
  })));

  // ── 줄·칸 ──
  gp = g();
  const rowOp = (below) => run(async () => {
    const t = await sel(); if (!t) return;
    await api.mutateApi('insertTableRow', [t.s, t.p, t.ctrl, below ? t.r2 : t.r1, below]);
    await placeIn(t, below ? t.r2 + 1 : t.r1, t.c1);
  });
  const colOp = (right) => run(async () => {
    const t = await sel(); if (!t) return;
    await api.mutateApi('insertTableColumn', [t.s, t.p, t.ctrl, right ? t.c2 : t.c1, right]);
    await placeIn(t, t.r1, right ? t.c2 + 1 : t.c1);
  });
  gp.append(
    mk('rowAbove', TT.rowAbove, TT.rowAbove, () => rowOp(false)), mk('rowBelow', TT.rowBelow, TT.rowBelow, () => rowOp(true)),
    mk('rowDel', TT.rowDel, TT.rowDel, () => run(async () => {
      const t = await sel(); if (!t) return;
      if (t.r2 - t.r1 + 1 >= t.rows) { api.status(TT.lastRow); return; }
      for (let r = t.r2; r >= t.r1; r--) await api.mutateApi('deleteTableRow', [t.s, t.p, t.ctrl, r], { pos: api.pos });
      await placeIn(t, Math.min(t.r1, t.rows - (t.r2 - t.r1 + 1) - 1), t.c1);
    })),
  );
  gp = g();
  gp.append(
    mk('colLeft', TT.colLeft, TT.colLeft, () => colOp(false)), mk('colRight', TT.colRight, TT.colRight, () => colOp(true)),
    mk('colDel', TT.colDel, TT.colDel, () => run(async () => {
      const t = await sel(); if (!t) return;
      if (t.c2 - t.c1 + 1 >= t.cols) { api.status(TT.lastCol); return; }
      for (let c = t.c2; c >= t.c1; c--) await api.mutateApi('deleteTableColumn', [t.s, t.p, t.ctrl, c], { pos: api.pos });
      await placeIn(t, t.r1, Math.min(t.c1, t.cols - (t.c2 - t.c1 + 1) - 1));
    })),
  );

  // ── 칸 ──
  gp = g();
  gp.append(
    mk('merge', TT.merge, TT.merge, () => run(async () => {
      const t = await sel();
      if (!t || (t.r1 === t.r2 && t.c1 === t.c2)) { api.status(TT.needBlock); return; }
      await api.mutateApi('mergeTableCells', [t.s, t.p, t.ctrl, t.r1, t.c1, t.r2, t.c2]);
      await placeIn(t, t.r1, t.c1);
    })),
    mk('split', TT.split, TT.split, () => run(async () => {
      const t = await sel(); if (!t) return;
      const v = await api.form(TT.split, [
        { key: 'n', label: TT.nRows, type: 'number', value: 1, min: 1, max: 50 }, { key: 'm', label: TT.mCols, type: 'number', value: 2, min: 1, max: 50 },
        { key: 'equal', label: TT.equal, type: 'checkbox', value: true },
      ]);
      if (!v) return;
      if (t.block) await api.mutateApi('splitTableCellsInRange', [t.s, t.p, t.ctrl, t.r1, t.c1, t.r2, t.c2, v.n, v.m, v.equal]);
      else await api.mutateApi('splitTableCellInto', [t.s, t.p, t.ctrl, t.r1, t.c1, v.n, v.m, v.equal, false]);
      await placeIn(t, t.r1, t.c1);
    })),
    mk('cellProps', TT.cellProps, TT.cellProps, () => run(() => cellProps())),
    mk('eqW', TT.eqW, TT.eqW, () => run(() => equalize('w'))),
    mk('eqH', TT.eqH, TT.eqH, () => run(() => equalize('h'))),
  );

  async function cellProps() {
    const t = await sel(); if (!t) return;
    const first = (await api.req('q', { fn: 'getCellProperties', args: [t.s, t.p, t.ctrl, t.cells[0]] })).result ?? {};
    const bl = first.borderLeft ?? {};
    const v = await api.form(TT.cellProps, [
      { key: 'fill', label: TT.fill, type: 'select', value: first.fillType === 'solid' ? 'solid' : 'none', options: [['none', TT.fillNone], ['solid', TT.fillSolid]] },
      { key: 'fillColor', label: TT.fillColor, type: 'color', value: /^#[0-9a-f]{6}$/i.test(first.fillColor ?? '') && first.fillColor !== '#ffffff' ? first.fillColor : '#ffff99' },
      { key: 'target', label: TT.borderTarget, type: 'select', value: 'keep', options: [['keep', '바꾸지 않음'], ...Object.entries(TT.bt)] },
      { key: 'ltype', label: TT.lineType, type: 'select', value: String(bl.type ?? 1), options: LINE_TYPES },
      { key: 'lwidth', label: TT.lineWidth, type: 'select', value: String(bl.width ?? 1), options: LINE_WIDTHS },
      { key: 'lcolor', label: TT.lineColor, type: 'color', value: /^#[0-9a-f]{6}$/i.test(bl.color ?? '') ? bl.color : '#000000' },
      { key: 'valign', label: TT.valign, type: 'select', value: String(first.verticalAlign ?? 0), options: Object.entries(TT.va) },
    ]);
    if (!v) return;
    const line = (on) => ({ type: on ? Number(v.ltype) : 0, width: Number(v.lwidth), color: v.lcolor });
    const props = { verticalAlign: Number(v.valign), fillType: v.fill === 'solid' ? 'solid' : 'none' };
    if (v.fill === 'solid') { props.fillColor = v.fillColor; props.patternType = -1; }
    const edges = { all: ['Left', 'Right', 'Top', 'Bottom'], outer: [], top: ['Top'], bottom: ['Bottom'], left: ['Left'], right: ['Right'], none: ['Left', 'Right', 'Top', 'Bottom'] }[v.target] ?? [];
    for (const e of edges) props[`border${e}`] = line(v.target !== 'none');
    const json = JSON.stringify(props);
    if (t.block || t.cells.length > 1) await api.mutateApi('setCellZoneProperties', [t.s, t.p, t.ctrl, t.r1, t.c1, t.r2, t.c2, json]);
    else await api.mutateApi('setCellProperties', [t.s, t.p, t.ctrl, t.cells[0], json]);
    if (v.target === 'outer') {   // 바깥 테두리: 블록 가장자리 칸마다 해당 변만
      for (const side of [['Top', (x) => x.row === t.r1], ['Bottom', (x) => x.row + x.rowSpan - 1 === t.r2], ['Left', (x) => x.col === t.c1], ['Right', (x) => x.col + x.colSpan - 1 === t.c2]]) {
        const boxes = (await api.req('q', { fn: 'getTableCellBboxes', args: [t.s, t.p, t.ctrl] })).result ?? [];
        for (const x of boxes.filter((b) => t.cells.includes(b.cellIdx) && side[1](b))) await api.mutateApi('setCellProperties', [t.s, t.p, t.ctrl, x.cellIdx, JSON.stringify({ [`border${side[0]}`]: line(true) })]);
      }
    }
  }

  /** 고른 칸들의 너비(또는 높이)를 평균으로 맞춘다. */
  async function equalize(axis) {
    const t = await sel(); if (!t) return;
    const cells = t.block ? t.cells : Array.from({ length: t.rows * t.cols }, (_, i) => i);   // 한 칸만 골랐으면 표 전체
    const info = [];
    const withCell = (c) => JSON.stringify(t.path.map((x, i) => (i === t.path.length - 1 ? { ...x, cellIndex: c } : x)));
    for (const c of cells) {
      if (t.nested) {
        const ci = (await api.req('q', { fn: 'getCellInfoByPath', args: [t.s, t.p, withCell(c)] })).result;
        const pr = (await api.req('q', { fn: 'getCellPropertiesByPath', args: [t.s, t.p, JSON.stringify(t.path), c] })).result;
        if (ci && pr) info.push({ c, span: axis === 'w' ? ci.colSpan : ci.rowSpan, size: axis === 'w' ? pr.width : pr.height });
        continue;
      }
      const ci = (await api.req('q', { fn: 'getCellInfo', args: [t.s, t.p, t.ctrl, c] })).result;
      const pr = (await api.req('q', { fn: 'getCellProperties', args: [t.s, t.p, t.ctrl, c] })).result;
      if (!ci || !pr) continue;
      info.push({ c, span: axis === 'w' ? ci.colSpan : ci.rowSpan, size: axis === 'w' ? pr.width : pr.height });
    }
    const single = info.filter((x) => x.span === 1);
    if (single.length < 2) return;
    const avg = Math.round(single.reduce((a, x) => a + x.size, 0) / single.length);
    const deltas = single.map((x) => ({ cellIdx: x.c, [axis === 'w' ? 'widthDelta' : 'heightDelta']: avg - x.size })).filter((d) => d[axis === 'w' ? 'widthDelta' : 'heightDelta'] !== 0);
    if (!deltas.length) return;
    if (t.nested) await api.mutateApi('resizeTableCellsByPath', [t.s, t.p, JSON.stringify(t.path), JSON.stringify(deltas)]);
    else await api.mutateApi('resizeTableCells', [t.s, t.p, t.ctrl, JSON.stringify(deltas)]);
  }

  // ── 표 ──
  gp = g();
  gp.append(
    mk('tblProps', TT.tblProps, TT.tblProps, () => run(async () => {
      const t = await sel(); if (!t) return;
      const first = (await api.req('q', { fn: 'getTableProperties', args: [t.s, t.p, t.ctrl] })).result ?? {};
      const v = await api.form(TT.tblProps, [
        { key: 'pageBreak', label: TT.pageBreak, type: 'select', value: String(first.pageBreak ?? 1), options: Object.entries(TT.pb) },
        { key: 'repeatHeader', label: TT.repeatHeader, type: 'checkbox', value: !!first.repeatHeader },
        { key: 'cellSpacing', label: TT.spacing, type: 'number', value: first.cellSpacing ?? 0, min: 0, max: 2000, step: 10 },
        { key: 'pl', label: `${TT.padding} 왼쪽`, type: 'number', value: first.paddingLeft ?? 510, min: 0, max: 5000, step: 10 },
        { key: 'pr', label: '오른쪽', type: 'number', value: first.paddingRight ?? 510, min: 0, max: 5000, step: 10 },
        { key: 'pt', label: '위쪽', type: 'number', value: first.paddingTop ?? 141, min: 0, max: 5000, step: 10 },
        { key: 'pb2', label: '아래쪽', type: 'number', value: first.paddingBottom ?? 141, min: 0, max: 5000, step: 10 },
      ]);
      if (!v) return;
      await api.mutateApi('setTableProperties', [t.s, t.p, t.ctrl, JSON.stringify({ pageBreak: Number(v.pageBreak), repeatHeader: v.repeatHeader, cellSpacing: v.cellSpacing, paddingLeft: v.pl, paddingRight: v.pr, paddingTop: v.pt, paddingBottom: v.pb2 })]);
    })),
    mk('tblSplit', TT.tblSplit, TT.tblSplit, () => run(async () => {
      const t = await sel(); if (!t || t.r1 === 0) { api.status('표를 나눌 줄(둘째 줄 이후)에 캐럿을 두세요'); return; }
      await api.mutateApi('splitTable', [t.s, t.p, t.ctrl, t.r1]);
    })),
    mk('tblMerge', TT.tblMerge, TT.tblMerge, () => run(async () => {
      const t = await sel(); if (!t) return;
      await api.mutateApi('mergeTableWithNext', [t.s, t.p, t.ctrl]);
    })),
    mk('transpose', TT.transpose, TT.transpose, () => run(async () => {
      const t = await sel(); if (!t) return;
      await api.mutateApi('transposeTableCellsInPlace', [t.s, t.p, t.ctrl]);
      await placeIn(t, 0, 0);
    })),
    mk('tblDel', TT.tblDel, TT.tblDel, () => run(async () => {
      const t = await sel(); if (!t) return;
      if (!(await api.ask(TT.tblDelAsk, [TT.tblDelBody], TT.yesDel, TT.no))) return;
      if (t.nested) { const up = t.path.slice(0, -1); await api.mutateApi('deleteCellTableControlByPath', [t.s, t.p, JSON.stringify(up), t.path[t.path.length - 1].controlIndex], { pos: { s: t.s, p: t.p, o: 0, path: up.length ? up : null } }); return; }
      await api.mutateApi('deleteTableControl', [t.s, t.p, t.ctrl], { pos: { s: t.s, p: t.p, o: 0, path: null } });
    })),
  );

  // 캐럿이 표 안인지에 따라 단추를 켜고 끈다
  api.onContext(() => {
    const inTable = !!api.tbl;
    for (const [k, b] of Object.entries(btns)) {
      if (k === 'create') { b.disabled = !!api.pos?.path; b.title = b.disabled ? TT.notInCell : TT.createTitle; continue; }
      b.disabled = !inTable || (api.tbl?.nested && !NESTED_OK.has(k));
      if (api.tbl?.nested && !NESTED_OK.has(k)) { b.title = `${b.getAttribute('aria-label')} — ${TT.nestedNo}`; continue; }
      if (!inTable) b.title = `${b.getAttribute('aria-label')} — ${TT.needTable}`; else b.title = b.getAttribute('aria-label');
    }
    if (inTable && btns.merge) btns.merge.disabled = !api.cellBlock;
  });
}
