// 시제품(B)용 paragraph.js 사본을 만든다: 줄바꿈(line_break)이 문서 기본 글꼴이 아니라 바로 앞 글의 글꼴을 따르게 한다.
// 레포의 paragraph.js는 고치지 않는다. 결과는 out/lineheight/paragraph.patched.js(gitignore).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const here = new URL('.', import.meta.url);
const src = readFileSync(new URL('../../../../apps/web/src/docx/paragraph.js', here), 'utf8');
const swap = (s, a, b) => { if (!s.includes(a)) throw new Error('paragraph.js가 바뀌어 패턴을 못 찾았다: ' + a.slice(0, 50)); return s.replace(a, b); };
let out = swap(src, "      const st = runStyle(r);\n      const src = r.text;", "      const st = runStyle(r);\n      prevSt = st;\n      const src = r.text;");
out = swap(out, "      const t = { kind: 'br', text: '\\n', st: runStyle({}) };", "      const t = { kind: 'br', text: '\\n', st: prevSt ?? runStyle({}) };   // 시제품: 줄바꿈은 바로 앞 글의 글꼴을 따른다");
out = swap(out, "  let prevRunLastWord = false;\n  let cp = 0;", "  let prevRunLastWord = false;\n  let prevSt = null;\n  let cp = 0;");
mkdirSync(new URL('../out/lineheight/', here), { recursive: true });
writeFileSync(new URL('../out/lineheight/paragraph.patched.js', here), out);
console.log('만듦: out/lineheight/paragraph.patched.js');
