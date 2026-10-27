# 한국어 글꼴 줄 높이 측정 (2026-10-27)

GenOffice가 **Word for Mac으로 잰** 한국어 시험 파일(`malgun-line-pitch-sizes`, `cjk-face-factors`)의 줄 높이 정답과, 우리 조판(`apps/web/src/docx`)이 실제 Chromium에서 내는 줄 높이를 견준다. 결과와 해석은 `docs/phase4/trial-korean-lineheight.md`.

```sh
GENOFFICE_DIR=/tmp/genoffice            # git clone --depth 1 https://github.com/genspark-ai/genoffice
bash scripts/build-docx-wasm.sh         # fmt-docx WASM(IR) 먼저
bash scripts/fetch-rhwp.sh              # 한글 글꼴(Noto Sans KR, OFL)을 third_party/rhwp/ttfs/opensource에서 쓴다
cd tools/engine-trial/genoffice/lineheight
node make-patched.mjs && node prep.mjs
VARIANTS=none,noto,win,win+fix,win+fix+br node run.mjs      # PW_DIR=playwright-core가 있는 폴더(기본 apps/web), CHROMIUM=실행 파일
```

변형 이름(`환경[+시제품]`):
- 환경 `none`: 한글 글꼴 없음(이 컨테이너 기본) · `noto`: Noto Sans KR만 있음(Linux·모바일에 흔함) · `win`: **Windows 흉내**. 맑은 고딕·바탕을 `@font-face`로 만들고 `ascent-override`/`descent-override`로 Word에서 추출한 글꼴 높이값(GenOffice `word-faces.json`)을 준다. Windows Chrome이 실제로 그 값을 주는지는 확인하지 못했다.
- 시제품 `fix`: 선언된 한글 글꼴을 Word 한 줄 높이 배수(맑은 고딕 1.7292, 바탕 1.3)로 바꿔 측정. `br`: 줄바꿈이 바로 앞 글의 글꼴을 따르게 한 paragraph.js 사본(레포의 코드는 고치지 않는다).
