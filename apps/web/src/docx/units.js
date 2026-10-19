// DOCX 단위 변환. 화면 96dpi 기준 px.
export const twipsToPx = (t) => t / 15;
export const halfPtToPx = (h) => (h * 2) / 3;
export const emuToPx = (e) => e / 9525;
export const rgb = (c) => (Array.isArray(c) ? `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}` : null);
