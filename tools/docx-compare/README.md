# DOCX 조판 정확도 비교 (우리 엔진 vs BetterOffice)

우리 조판 엔진(`apps/web/src/docx/`)을 **정교한 다른 엔진(BetterOffice, Apache-2.0)의 조판 결과와 비교**해 쪽 수·쪽 경계가 얼마나 같은지 잰다 (`docs/phase3/layout-engine-design.md` 정확도 기준).
**Word와의 일치는 아니다**(Word가 없어 측정하지 못했다). 이 도구는 개발 전용이며 배포물에 들어가지 않는다.

## 준비 (1회)
1. BetterOffice를 임의 폴더에 받는다 (`git clone --depth 1 https://github.com/openooxml/betteroffice`, 커밋 `ae7a003`로 측정).
2. `bo-reference.rs`를 새 Cargo 프로젝트의 `src/main.rs`로 두고 `bo-reference-Cargo.toml.txt`를 `Cargo.toml`로 쓴다(`<BETTEROFFICE_CHECKOUT>` 치환). **Rust 1.97(안정판)** 필요 — BetterOffice의 `yrs`가 1.93.1에서 컴파일되지 않는다. `cargo build --release` → 실행 파일이 `BO_REF`.
3. 우리 쪽: `scripts/build-docx-wasm.sh`(WASM), `apps/web`에서 `npm ci`.
4. 번들: `cd apps/web && node_modules/.bin/esbuild src/docx/index.js --bundle --format=iife --global-name=SheetflyDocx --outfile=$OUT/docx-bundle.js`.

## 실행
```sh
export BO_REF=… BO_ROOT=<BetterOffice 폴더> OUT=/tmp/docx-compare FONT=/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf
find $BO_ROOT -name '*.docx' | sort > $OUT/batch/files.txt   # 또는 파일 경로를 인수로
node tools/docx-compare/batch.mjs          # 전체: 쪽 수 일치율, 쪽별 첫/끝 줄 일치율
node tools/docx-compare/compare.mjs ir.json bo-displaylist.json out/prefix   # 한 문서의 쪽별 비교와 PNG
```
- 측정에서는 **두 엔진 모두 한 글꼴(Carlito)로 통일**한다(`setFontOverride`). BetterOffice는 글꼴 바이트를 등록하는 방식이고 우리는 브라우저 Canvas라 같은 글꼴일 때만 비교가 의미 있다.
- 비교 문서는 BetterOffice 저장소의 DOCX 111개(대부분 조판 회귀용 합성 문서)이며 **실제 업무 문서 코퍼스가 아니다**.
