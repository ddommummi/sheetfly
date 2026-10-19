// 편집기 공용 UI 부품: 값을 입력받는 대화상자(askForm). 스타일은 기존 .dialog·.btn·.select·.field를 그대로 쓴다.
/**
 * @param {string} title
 * @param {Array<{key:string,label:string,type:'number'|'select'|'color'|'text'|'checkbox'|'file',value?:any,min?:number,max?:number,step?:number,options?:[string,string][],hint?:string,accept?:string}>} fields
 * @param {{ok:string,cancel:string}} labels
 * @returns {Promise<Record<string, any>|null>} 확인하면 {key: 값}, 취소하면 null
 */
export function askForm(title, fields, labels) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    const form = document.createElement('form');
    form.method = 'dialog';
    const h = document.createElement('h2'); h.textContent = title;
    const body = document.createElement('div'); body.className = 'dialog-fields';
    const inputs = {};
    for (const f of fields) {
      const row = document.createElement('label'); row.className = 'dialog-field';
      if (f.type === 'checkbox') {
        const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!f.value; inputs[f.key] = i;
        const t = document.createElement('span'); t.textContent = f.label;
        row.append(i, t);
      } else {
        const t = document.createElement('span'); t.className = 'dialog-label'; t.textContent = f.label;
        let i;
        if (f.type === 'select') {
          i = document.createElement('select'); i.className = 'select';
          for (const [v, text] of f.options ?? []) { const o = document.createElement('option'); o.value = v; o.textContent = text; i.append(o); }
          i.value = String(f.value ?? '');
        } else {
          i = document.createElement('input');
          i.type = f.type === 'file' ? 'file' : f.type === 'color' ? 'color' : f.type === 'number' ? 'number' : 'text';
          i.className = f.type === 'color' ? 'edit-color' : 'search-input';
          if (f.type === 'number') { if (f.min != null) i.min = String(f.min); if (f.max != null) i.max = String(f.max); i.step = String(f.step ?? 1); }
          if (f.accept) i.accept = f.accept;
          if (f.type !== 'file') i.value = String(f.value ?? '');
        }
        inputs[f.key] = i;
        row.append(t, i);
      }
      if (f.hint) { const hint = document.createElement('small'); hint.className = 'dialog-hint'; hint.textContent = f.hint; row.append(hint); }
      body.append(row);
    }
    const actions = document.createElement('div'); actions.className = 'dialog-actions';
    const no = document.createElement('button'); no.type = 'button'; no.className = 'btn'; no.textContent = labels.cancel;
    const yes = document.createElement('button'); yes.type = 'submit'; yes.className = 'btn primary'; yes.textContent = labels.ok;
    actions.append(no, yes);
    form.append(h, body, actions);
    dlg.append(form);
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    no.addEventListener('click', () => done(null));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const i = inputs[f.key];
        if (f.type === 'checkbox') out[f.key] = i.checked;
        else if (f.type === 'number') {
          let v = Number(i.value);
          if (!Number.isFinite(v)) v = Number(f.value ?? 0);
          if (f.min != null) v = Math.max(f.min, v);
          if (f.max != null) v = Math.min(f.max, v);
          out[f.key] = v;
        } else if (f.type === 'file') out[f.key] = i.files?.[0] ?? null;
        else out[f.key] = i.value;
      }
      done(out);
    });
    document.body.append(dlg);
    dlg.showModal();
    const first = body.querySelector('input,select'); first?.focus();
  });
}
