# 3단계-2: BetterOffice DOCX 스파이크 결과 (2026-10-19)

> 목적: 오너가 A(BetterOffice, 쪽 단위 렌더)를 고른 뒤, **채택 전에** 실제 DOCX로 "바이트 → 쪽별 그리기 명령 → SVG"가 되는지, 연결에 무엇이 필요한지 확인했다. 우리 저장소에는 의존성을 추가하지 않았다. 하네스와 변환기 원본은 `docs/phase3/spike/`에 있다(경로는 `<BETTEROFFICE_CHECKOUT>`로 바꿔 둠). 환경: 이 컨테이너 4코어, Rust 1.97.0, BetterOffice `ae7a003`(0.4.3), 네이티브 릴리스 빌드(wasm이 아님).

## 결과
| 항목 | 결과 |
|---|---|
| 실제 DOCX → 쪽 | **된다.** `wordprocessingml-comprehensive.docx`(11KB) 5쪽, 그리기 명령 3,203개. `betteroffice-demo.docx`(6KB) 2쪽, 2,863개 |
| 쪽 모양 | 제목·소문자 대문자·물결 밑줄·형광펜·번호 목록·표·머리글/바닥글이 쪽 안에 배치됨 (`spike/comprehensive-p1.png`). 일부 글자는 빠져 보임(`", ,"` 자리) — 원인은 확인하지 못함(변환기 미완성일 수 있음) |
| 시간(네이티브, 11KB 문서) | 시드 17ms + 조판 15ms + 그리기 명령 42ms ≈ 75ms. **WASM은 더 느릴 것이며 측정하지 않았다.** 큰 문서는 미측정 |
| 그리기 명령 크기 | 5쪽 JSON 1.6MB(대부분 글자 `glyphRun`). 전송 형식으로 쓰려면 줄여야 함 |
| 명령 종류 | `glyphRun`, `text`, `decoration`, `rect`, `line`, `image`(data URL), `shape`(경로). 이 종류를 SVG로 바꾸는 변환기는 약 50줄로 동작 |
| 한국어(한글 글꼴 없음) | **읽을 수 없다.** 한글을 `.notdef` 폭으로 배치해 글자가 겹친다 (`spike/korean-no-hangul-font-p1.png`). 엔진은 죽지 않고 조용히 틀리게 배치한다 |
| 한국어(한글 지원 글꼴 등록) | **정상.** 쪽 안에서 제목·본문이 줄바꿈된다 (`spike/korean-with-hangul-font-p1.png`). 시험에 쓴 글꼴은 Unifont(라틴 폭이 반각이라 영문이 벌어져 보임, 시험용일 뿐) |

## 확인된 호출 순서 (뷰어 경로)
1. `docx_layout::register_measure_font(글꼴 바이트)`로 측정용 글꼴 등록(글꼴당 id).
2. `EngineSession::new` + `seed_from_docx(engine.doc(), docx바이트)`.
3. `docx_parse::parse_docx_s9_wire`로 구역·각주·설정을 읽어 조판 요청(JSON) 구성. `layout_font_requirements_json`이 돌려준 글꼴 요구 키마다 등록한 글꼴 id를 연결(`measurement.fontChains`).
4. `layout_document_with_regions_retained_json(요청)` → 조판.
5. `build_display_list_frame(extras)` → `with_display_list`로 쪽별 `DisplayList`.
- 이 순서는 BetterOffice의 시험 코드(`crates/docx-edit/tests/support/page_fixture.rs`)를 따랐다. 뷰어 전용 단일 함수는 없다. 우리가 이 순서를 감싸는 얇은 wasm 크레이트(`fmt-docx`)를 써야 한다.

## 결정에 영향을 주는 발견
1. **글꼴이 필수다.** 한국어 DOCX는 한글 지원 글꼴을 엔진에 등록해야 읽을 수 있고, 그리는 쪽도 같은 글꼴(또는 같은 폭의 글꼴)이어야 모양이 맞는다. 재배포 가능한 글꼴(OFL 등)을 골라야 하고 D-010(비허용 글꼴 금지)과 `font-audit` 절차를 따라야 한다. 크기와 선택은 오너 결정이다(미측정).
2. **그리는 방식.** 글자 위치를 엔진이 정하므로 브라우저가 같은 글꼴을 가져야 한다. 지금 쓰는 "SVG를 `<img>`로" 방식은 외부 글꼴을 못 불러, SVG마다 글꼴을 data URL로 넣거나 Canvas로 바꿔야 한다. Canvas 방식은 PRD 5.2의 `render-canvas`와 맞는다. 미검증.
3. **배포 빌드 시간.** BetterOffice의 `docx-edit` wasm 빌드는 이 컨테이너(4코어)에서 4분 51초, `wasm-opt -Oz`는 12분 27초였다. Cloudflare 빌드(실측 약 12분 + Initializing 지연)에 더하면 **20분 한도를 넘길 가능성이 높다**(Cloudflare 환경의 DOCX 빌드 시간은 미측정). D-026에서 "현상 유지"로 정했던 전제가 바뀐다: GitHub Actions에서 wasm을 빌드해 올리는 방식(방법 A)이 사실상 필요해질 수 있다.
4. **툴체인.** BetterOffice는 Rust 1.97이 필요하고 rhwp는 1.93.1로 고정이다. 한 빌드에서 두 툴체인을 써야 한다.
5. **wasm-bindgen 버전.** BetterOffice 잠금은 0.2.126, rhwp는 0.2.127. 모듈마다 맞는 CLI가 필요하다.

## 미확인
- WASM에서의 시간·메모리, 큰 문서(수백 쪽), 악성 DOCX 동작, 퍼징.
- 한글 글꼴 후보의 크기·라이선스, 글꼴 부분 집합(subset) 가능성.
- 변환기가 빠뜨린 요소(위 `", ,"`), 도형·차트·글상자·각주 영역·쪽 테두리.
- 우리 뷰어 기능(검색, 확대/축소, 가상화, 취소)을 DisplayList로 구현하는 방법.
