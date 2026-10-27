# 이음오피스 한글 재현 파일 검사 (2026-10-27)

`pblsketch/openoffice`(이음오피스, Apache-2.0)의 `apps/hwp/tests/fixtures/`에는 **한컴 한글 2024로 저장한 공개 재현 파일**(글은 채움 문구로 교체)이 있다. 그쪽이 rhwp에 얹는 패치 9개가 고치는 문제를 재현하는 파일이고, 위아래 관계를 보는 시험(`engine-layout.test.ts`)이 붙어 있다. `check.mjs`는 그 단언 중 4개를 한 엔진(WASM)에 돌려 통과/실패를 낸다. 결과와 해석은 `docs/phase4/trial-korean-lineheight.md`.

**주의: 외부에서 받은 WASM 빌드를 실행한다.** 신뢰할 수 있는 출처인지 확인하고 돌린다(2026-10-27 오너 허가).

```sh
git clone --depth 1 https://github.com/pblsketch/openoffice /tmp/ieum
mkdir -p /tmp/rhwp-npm && (cd /tmp/rhwp-npm && npm pack @rhwp/core@0.8.7 && tar xzf rhwp-core-0.8.7.tgz)
F=/tmp/ieum/apps/hwp/tests/fixtures; G=/tmp/ieum/vendor/rhwp-core/rhwp.js
node tools/engine-trial/ieum-fixtures/check.mjs $G /tmp/rhwp-npm/package/rhwp_bg.wasm $F             # 패치 없는 rhwp v0.8.7
node tools/engine-trial/ieum-fixtures/check.mjs $G /tmp/ieum/vendor/rhwp-core/rhwp_bg.wasm $F       # 이음오피스 패치 9개를 얹은 빌드
```
글루(`rhwp.js`)는 두 빌드가 바이트까지 같고 WASM만 다르다(이음오피스 README).
