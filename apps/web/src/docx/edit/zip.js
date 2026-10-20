// DOCX(ZIP) 부분 교체: 바꾼 부품만 새로 압축해 넣고, 나머지는 압축된 바이트 그대로 복사한다(무손실 저장).
// 브라우저 Worker와 Node(시험)에서 같이 쓰도록 Web 표준(DataView·CompressionStream)만 쓴다. ZIP64·암호·다중 디스크는 지원하지 않는다(throw).
const td = new TextDecoder(), te = new TextEncoder();
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

async function pipe(u8, stream) {
  const out = new Response(new Blob([u8]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const inflateRaw = (u8) => pipe(u8, new DecompressionStream('deflate-raw'));
export const deflateRaw = (u8) => pipe(u8, new CompressionStream('deflate-raw'));

/** @returns {{entries: Array<{name,flags,method,crc,csize,usize,localOff,localLen,cd: Uint8Array}>}} */
export function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Object.assign(new Error('ZIP 끝 레코드를 찾지 못했다'), { code: 'zip_bad' });
  const count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOff === 0xffffffff) throw Object.assign(new Error('ZIP64는 지원하지 않는다'), { code: 'zip64' });
  const entries = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw Object.assign(new Error('중앙 디렉터리가 깨졌다'), { code: 'zip_bad' });
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const e = {
      flags: dv.getUint16(p + 8, true), method: dv.getUint16(p + 10, true), crc: dv.getUint32(p + 16, true), csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true),
      localOff: dv.getUint32(p + 42, true), name: td.decode(u8.subarray(p + 46, p + 46 + nameLen)), cd: u8.slice(p, p + 46 + nameLen + extraLen + commentLen),
    };
    const lh = e.localOff;
    if (lh + 30 > u8.length || dv.getUint32(lh, true) !== 0x04034b50) throw Object.assign(new Error('로컬 헤더가 깨졌다'), { code: 'zip_bad' });
    e.localLen = 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true) + e.csize + ((e.flags & 8) ? 16 : 0);   // 데이터 서술자(bit 3)가 있으면 뒤에 16바이트
    if (e.localOff + e.localLen > u8.length) throw Object.assign(new Error('부품이 파일 밖이다'), { code: 'zip_bad' });
    entries.push(e);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries };
}
export function hasEncrypted(zip) { return zip.entries.some((e) => e.flags & 1); }

export async function readPart(u8, e) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), lh = e.localOff;
  const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
  const raw = u8.subarray(start, start + e.csize);
  if (e.method === 0) return raw.slice();
  if (e.method === 8) return inflateRaw(raw);
  throw Object.assign(new Error(`지원하지 않는 압축 방식 ${e.method}`), { code: 'zip_method' });
}
export const partText = async (u8, e) => td.decode(await readPart(u8, e));

/** changes: Map(이름 → 새 바이트). 나머지 부품은 원본 바이트(지역 헤더 + 압축 데이터)를 그대로 복사한다. */
export async function rewriteZip(u8, changes) {
  const { entries } = readZip(u8);
  const locals = [], cds = [];
  let off = 0;
  for (const e of entries) {
    let local, cd = e.cd.slice();
    const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    if (changes.has(e.name)) {
      const data = changes.get(e.name), comp = await deflateRaw(data), name = te.encode(e.name);
      local = new Uint8Array(30 + name.length + comp.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 8, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true);
      const crc = crc32(data);
      lv.setUint32(14, crc, true); lv.setUint32(18, comp.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
      local.set(name, 30); local.set(comp, 30 + name.length);
      dv.setUint16(8, 0x0800, true); dv.setUint16(10, 8, true); dv.setUint32(16, crc, true); dv.setUint32(20, comp.length, true); dv.setUint32(24, data.length, true);
    } else local = u8.subarray(e.localOff, e.localOff + e.localLen);
    dv.setUint32(42, off, true);
    locals.push(local); cds.push(cd); off += local.length;
  }
  const cdLen = cds.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(off + cdLen + 22);
  let o = 0; for (const l of locals) { out.set(l, o); o += l.length; }
  const cdStart = o; for (const c of cds) { out.set(c, o); o += c.length; }
  const ev = new DataView(out.buffer, o);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cdLen, true); ev.setUint32(16, cdStart, true);
  return out;
}
