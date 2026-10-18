// dist/를 Cloudflare Workers Static Assets와 같은 규칙으로 서빙하는 개발·시험용 서버.
//  - dist/_headers를 그대로 읽어 적용 (CSP 포함) → 개발 중에도 실제 배포와 같은 CSP로 시험한다
//  - html_handling auto-trailing-slash: /licenses → licenses.html, /licenses/ → 307 /licenses
//  - not_found_handling 404-page: 없는 경로는 404.html + 404
//  - Accept-Encoding에 br이 있으면 텍스트·WASM을 brotli로 압축 (전송 크기 확인용)
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.DIST || join(web, 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.wasm', '.svg', '.txt', '.json']);

function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) { cur = { pattern: raw.trim(), headers: [] }; rules.push(cur); }
    else if (cur) { const i = raw.indexOf(':'); cur.headers.push([raw.slice(0, i).trim(), raw.slice(i + 1).trim()]); }
  }
  return rules;
}
const matches = (pattern, path) => {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(path);
};
const rules = existsSync(join(root, '_headers')) ? parseHeaders(readFileSync(join(root, '_headers'), 'utf8')) : [];

const cache = new Map();
function pick(pathname) {
  let p = decodeURIComponent(pathname);
  if (p.endsWith('/') && p !== '/') return { redirect: p.slice(0, -1) };
  if (p === '/') p = '/index.html';
  const candidates = [p, p + '.html'];
  for (const c of candidates) {
    const abs = normalize(join(root, c));
    if (abs.startsWith(root) && existsSync(abs) && statSync(abs).isFile() && !/\/_headers$/.test(abs)) return { file: abs, status: 200 };
  }
  return { file: join(root, '404.html'), status: 404 };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const sel = pick(url.pathname);
  const headers = {};
  for (const r of rules) if (matches(r.pattern, url.pathname)) for (const [k, v] of r.headers) headers[k] = headers[k] ? `${headers[k]}, ${v}` : v;
  if (sel.redirect) { res.writeHead(307, { ...headers, Location: sel.redirect }); return res.end(); }
  if (!existsSync(sel.file)) { res.writeHead(404, headers); return res.end('not found'); }
  const ext = extname(sel.file);
  let body = cache.get(sel.file);
  if (!body) { body = readFileSync(sel.file); cache.set(sel.file, body); }
  headers['Content-Type'] = TYPES[ext] || 'application/octet-stream';
  if (COMPRESSIBLE.has(ext) && /\bbr\b/.test(req.headers['accept-encoding'] || '')) {
    const key = sel.file + '#br';
    let br = cache.get(key);
    if (!br) { br = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }); cache.set(key, br); }
    headers['Content-Encoding'] = 'br'; headers['Vary'] = 'Accept-Encoding';
    body = br;
  }
  headers['Content-Length'] = body.length;
  res.writeHead(sel.status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
});

const port = Number(process.env.PORT || process.argv[2] || 8787);
server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}  (dist: ${root})`));
export { server };
