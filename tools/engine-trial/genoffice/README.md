# GenOffice docx-engine 시험 (4-2 스파이크, 2026-10-23)

office_oxide IR(현재 DOCX 읽기)과 GenOffice의 `docx-engine`(`genspark-ai/genoffice`, Apache-2.0)을 **같은 DOCX 코퍼스, 같은 정답지**로 견주는 도구. 결과와 해석은 `docs/phase4/trial-genoffice-docx.md`.

GenOffice 소스는 이 저장소에 넣지 않는다. `setup.sh`가 바깥 체크아웃에서 `work/`(gitignore)로 읽기 전용 복사해 번들만 만든다.

## 준비
```sh
git clone --depth 1 https://github.com/genspark-ai/genoffice /tmp/genoffice     # 시험한 커밋은 보고서에 있다
sh tools/edit-spike/fetch-docx-corpus.sh /tmp/docx-corpus                       # 공개 DOCX 749개
bash scripts/fetch-office-oxide.sh && bash scripts/fetch-rhwp.sh && WASM_OPT=0 bash scripts/build-docx-wasm.sh   # office_oxide IR(fmt-docx WASM)
GENOFFICE_DIR=/tmp/genoffice bash tools/engine-trial/genoffice/setup.sh        # work/ 생성
mkdir -p tools/engine-trial/genoffice/out
```

## 실행 (이 폴더에서, 코퍼스 경로를 `$C`로)
| 스크립트 | 하는 일 | 출력 |
|---|---|---|
| `xml-survey.mjs` | (라이브러리) `word/document.xml`을 엔진과 무관하게 훑어 정답지를 만든다: 글 문단과 분류(body·table·sdt·textbox), 기능 출현 | — |
| `ge-survey.mjs $C out/ge-rows.json` | docx-engine: 열림·시간, 앵커(`docxIndex`) 일관성, 글 문단→블록 연결, 구조로 내는 기능(모델 재귀 탐색) | `out/ge-rows.json` |
| `oo-survey.mjs $C out/oo-rows.json` | office_oxide IR(우리 fmt-docx WASM): IR이 구조로 내는 기능, 기존 P2 정렬의 분류별 결과 | `out/oo-rows.json` |
| `analyze.mjs` | 위 둘을 합쳐 보고서의 (a)(b) 표와 시간표를 낸다 | 표준출력 |
| `table-coverage.mjs $C` | 표 모델이 XML 표 글 문단을 얼마나 담는가(중첩 표 포함) | 표준출력 |
| `edit-loss.mjs $C out/edit-rows.json` | 같은 문단에 같은 한 글자를 넣어 저장: docx-engine `saveDocx` vs 우리 S2 `insertText`의 변경 범위 | `out/edit-rows.json` |
| `edit-summary.mjs` | 위 결과 집계(변경 창 크기, 바뀐 부품, 문단 재생성 무손실 비율) | 표준출력 |
| `loss-detail.mjs $C` | 재생성에서 빠지는 태그·속성 분류 | 표준출력 |
| `fmt-preserve.mjs $C` | 편집 전후 글자별 서식 서명이 같은가(서식 보존인지 런 합치기인지) | 표준출력 |
| `trim-bundle.mjs` | 파싱 경로 번들 변형별 크기(TIFF·EMF 스텁, JSZip shim)와 지연 청크 크기 | `out/variants/*.js` |
| `parity.mjs $C` | 축소 번들(V3)이 전체 번들(V0)과 같은 파싱 결과를 내는가 | 표준출력 |
| `ir-schema.mjs $C` | office_oxide IR이 코퍼스에서 내는 요소 종류와 키 | 표준출력 |
| `jszip-shim.mjs` | 읽기 전용 JSZip 호환 shim(`DecompressionStream`만 사용). 실험용 | — |

## 측정 때 잡은 오류 (다시 만들 때 주의)
- `docxIndex`는 `<w:body>` 직속 자식 번호가 아니다. docx-engine은 **최상위 SDT를 펼쳐서** 요소를 센다. 독립 스캐너의 번호와 비교하면 앵커가 틀린 것처럼 보인다. 엔진의 `extras.elements`(정규화된 `internal.documentXml` 기준)로 검증해야 한다.
- 엔진은 ISO Strict 네임스페이스를 Transitional로 바꾼다(코퍼스의 Open XML SDK `O14ISOStrict` 파일 453개). 이런 문서는 원본 바이트와 `documentXml`이 달라서 바이트 비교 시험에서 뺀다.
- 기능 탐지를 최상위 블록만 보면 표 칸·머리글 안 기능이 빠진다. 모델 전체를 재귀로 훑고, "구조로 낸 것"과 "원문 조각만 보존한 것"을 나눈다.
- 탐지기 키 이름은 소스에서 확인한다(탭 정지는 `tabs`가 아니라 `tabStops`였다).
- JSZip은 앞쪽 UTF-8 BOM을 문자열에 남기지만 `TextDecoder`는 기본으로 뗀다(`ignoreBOM: true`).
