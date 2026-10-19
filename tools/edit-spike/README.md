# 편집 스파이크 (4-0, 2026-10-19)

현재 배포 중인 뷰어 WASM(`apps/web/src/wasm/rhwp_bg.wasm`, 먼저 `npm run build:wasm`)으로 HWP/HWPX **편집 → 저장 → 다시 열기**가 되는지 재는 스크립트. 결과와 해석은 `docs/phase4/design.md` 부록.

| 스크립트 | 하는 일 |
|---|---|
| `hwp-spike.mjs <샘플…>` | 한 문서에서 입력·클릭 위치·커서·서식·스냅샷 되돌리기·저장(HWP/HWPX)·다시 열기 시간 |
| `hwp-corpus.mjs` | `third_party/rhwp/samples`의 HWP·HWPX 전체에서 입력→저장→다시 열기 성공 여부, 자체 검증(`exportHwpVerify`) 결과 |
| `hwp-loss.mjs` | 저장 때 `contentLoss` 보고서 분포(HWP·HWPX) |
| `hwp-text-eq.mjs` | 원본 → 저장 → 다시 열기 후 문단 수·문단 길이·앞 40자가 같은지(쪽 수 비교보다 강한 무손실 점검) |

실행: `node tools/edit-spike/hwp-corpus.mjs` (샘플 373개에서 약 수 분). 12MB를 넘는 파일은 건너뛴다.
