// 손상 변형 도구 (코퍼스 시험과 E2E가 같은 변형을 재현하도록 공유한다).
// 손상 변형: 씨앗 고정 PRNG(mulberry32)로 재현 가능하게 만든다.
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function mutate(buf, rand, kind) {
  const b = Buffer.from(buf);
  if (kind === 'flip') { const n = 1 + Math.floor(rand() * 16); for (let i = 0; i < n; i++) b[Math.floor(rand() * b.length)] ^= 1 << Math.floor(rand() * 8); return b; }
  if (kind === 'truncate') return b.subarray(0, Math.max(1, Math.floor(b.length * rand())));
  if (kind === 'zero') { const len = Math.min(b.length, 1 + Math.floor(rand() * 4096)); const at = Math.floor(rand() * (b.length - len + 1)); b.fill(0, at, at + len); return b; }
  if (kind === 'ff') { const len = Math.min(b.length, 1 + Math.floor(rand() * 512)); const at = Math.floor(rand() * (b.length - len + 1)); b.fill(0xff, at, at + len); return b; }
  if (kind === 'swap') { const len = Math.min(b.length >> 1, 1 + Math.floor(rand() * 2048)); const a = Math.floor(rand() * (b.length - len)), c = Math.floor(rand() * (b.length - len)); const t = Buffer.from(b.subarray(a, a + len)); b.copy(b, a, c, c + len); t.copy(b, c); return b; }
  return b;
}
export const KINDS = ['flip', 'truncate', 'zero', 'ff', 'swap'];
