// 최소 XML 해석기(Worker에는 DOMParser가 없다). 요소 이름은 접두사를 뗀 이름, 속성은 이름 그대로(r:embed 등).
// 노드: { n: 이름, a: 속성, c: 자식 요소[], t: 글자(<t> 요소는 공백 포함, 나머지는 공백만이면 비움) }. 신뢰할 수 없는 입력이므로 깊이·노드 수에 상한을 둔다.
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unesc = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e) => {
  if (e[0] === '#') { const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : ''; }
  return ENT[e] ?? m;
}));

export function parseXml(s, { maxDepth = 80, maxNodes = 3_000_000 } = {}) {
  let i = 0, nodes = 0;
  const N = s.length;
  const stack = [];
  let root = null;
  while (i < N) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i && stack.length) { const top = stack[stack.length - 1]; const txt = s.slice(i, lt); if (top.n === 't' || /\S/.test(txt)) top.t += unesc(txt); }
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? N : e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt + 9); const end = e < 0 ? N : e; if (stack.length) stack[stack.length - 1].t += s.slice(lt + 9, end); i = e < 0 ? N : e + 3; continue; }
    if (s[lt + 1] === '?' || s[lt + 1] === '!') { const e = s.indexOf('>', lt + 2); i = e < 0 ? N : e + 1; continue; }
    // 태그 끝('>')을 찾되 속성값 안의 '>'를 건너뛴다
    let j = lt + 1, q = 0;
    while (j < N) { const ch = s.charCodeAt(j); if (q) { if (ch === q) q = 0; } else if (ch === 34 || ch === 39) q = ch; else if (ch === 62) break; j++; }
    if (j >= N) break;
    const body = s.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === '/') { stack.pop(); continue; }
    if (++nodes > maxNodes) throw new Error('xml: too many nodes');
    const self = body.endsWith('/');
    const inner = self ? body.slice(0, -1) : body;
    const sp = inner.search(/\s/);
    const rawName = sp < 0 ? inner : inner.slice(0, sp);
    const colon = rawName.indexOf(':');
    const node = { n: colon < 0 ? rawName : rawName.slice(colon + 1), a: {}, c: [], t: '' };
    if (sp >= 0) { const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let m; const rest = inner.slice(sp); while ((m = re.exec(rest))) node.a[m[1]] = unesc(m[3] ?? m[4]); }
    if (stack.length) stack[stack.length - 1].c.push(node); else if (!root) root = node;
    if (!self) { if (stack.length >= maxDepth) throw new Error('xml: too deep'); stack.push(node); }
  }
  if (!root) throw new Error('xml: empty');
  return root;
}

export const kid = (n, name) => (n ? n.c.find((x) => x.n === name) : undefined);
export const kids = (n, name) => (n ? n.c.filter((x) => x.n === name) : []);
export const path = (n, ...names) => { let cur = n; for (const nm of names) { cur = kid(cur, nm); if (!cur) return undefined; } return cur; };
export const num = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
