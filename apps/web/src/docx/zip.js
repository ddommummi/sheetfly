// 최소 ZIP 읽기(PPTX 슬라이드 자체 해석용). 중앙 디렉터리로 항목을 찾고 DecompressionStream('deflate-raw')로 푼다.
// 신뢰할 수 없는 입력: 항목 수·풀린 크기·전체 풀린 양에 상한, ZIP64·암호화는 거부한다.
const MAX_ENTRIES = 20000;
const MAX_ENTRY = 128 * 1024 * 1024;
const MAX_TOTAL = 512 * 1024 * 1024;
const dec = new TextDecoder();

export function openZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip: no end record');
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) throw new Error('zip: zip64');
  if (count > MAX_ENTRIES || cdOff + cdSize > bytes.length) throw new Error('zip: bad directory');
  const entries = new Map();
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip: bad entry');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { flags, method, csize, usize, off });
    p += 46 + nameLen + extraLen + commentLen;
  }
  let total = 0;
  async function read(name) {
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 1) throw new Error('zip: encrypted');
    if (e.usize > MAX_ENTRY || (total += e.usize) > MAX_TOTAL) throw new Error('zip: too large');
    if (e.off + 30 > bytes.length || dv.getUint32(e.off, true) !== 0x04034b50) throw new Error('zip: bad local header');
    const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true);
    if (start + e.csize > bytes.length) throw new Error('zip: truncated');
    const raw = bytes.subarray(start, start + e.csize);
    if (e.method === 0) return raw;
    if (e.method !== 8) throw new Error('zip: method');
    const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const parts = []; let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > e.usize + 1024 || n > MAX_ENTRY) { reader.cancel().catch(() => {}); throw new Error('zip: bomb'); }
      parts.push(value);
    }
    const out = new Uint8Array(n); let o = 0;
    for (const v of parts) { out.set(v, o); o += v.length; }
    return out;
  }
  return { has: (n) => entries.has(n), names: () => [...entries.keys()], read, async text(name) { const b = await read(name); return b ? dec.decode(b) : null; } };
}
