// 문서(정적) 페이지에서 사용자가 고른 테마를 적용한다. 저장소를 못 쓰면 시스템 설정을 따른다.
try {
  const t = localStorage.getItem('sheetfly.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch { /* 무시 */ }
