# 3단계-1: DOCX 엔진 평가 (2026-10-19)

> 법률 자문이 아니다. 두 후보의 소스를 읽고 빌드·측정한 결과다. **어느 엔진도 실제 DOCX 문서로 실행해 보지 않았다**(렌더 정확도·열기 시간은 미측정). 이 문서의 수치는 아래 "측정 방법"의 한계를 따른다.

## 한 줄 결론
- **BetterOffice**는 DOCX를 쪽 단위로 조판해 렌더러 독립 그리기 명령(`DisplayList`)을 낸다(PRD 5.1의 "같은 렌더러" 방향). 대신 **크고(brotli 4.69MB, 측정), 호스트가 글꼴을 등록해야 하며, 연결 코드가 많다.**
- **office_oxide**는 **작고(brotli 0.77MB, 측정) 6개 포맷(DOCX/XLSX/PPTX/DOC/XLS/PPT)을 한 모듈로 읽지만** 쪽 나눔·조판이 없다. 텍스트·Markdown·HTML·포맷 중립 IR만 낸다.
- 오너 결정이 필요하다(아래 "선택지"). 에이전트는 어느 쪽도 의존성으로 추가하지 않았다.

## 후보 비교
| | BetterOffice `0.4.3` (`ae7a003`) | office_oxide `0.1.15` (`5d183f4`) |
|---|---|---|
| 라이선스 | Apache-2.0 (`NOTICE`: Elia Hilse, The OpenOOXML Project) | MIT OR Apache-2.0 |
| 하는 일 | DOCX 파싱·**쪽 조판**·`DisplayList`·편집·협업(CRDT). XLSX/PPTX/VSDX도 별도 크레이트 | 텍스트 추출, Markdown, HTML, IR. **렌더링·조판 없음** |
| 규모 | DOCX 관련 Rust 약 30만 줄(docx-edit 16.7만, docx-layout 7.1만, docx-parse 5.4만), TS 약 7만 줄 | 훨씬 작음(단일 크레이트) |
| WASM 구조 | 모듈 4개(opc, layout, edit, parse)를 wasm-pack으로 따로 빌드. 연결(JS)이 상당 | 단일 모듈(`--features wasm`) |
| 쪽 단위 보기 | 가능 | 불가능(흐르는 HTML) |
| 필요한 Rust | **1.97(안정판) 필요.** rhwp가 고정한 1.93.1에서는 `yrs 0.27.3`이 `if let` 가드로 컴파일 실패(E0658) | 1.97에서 빌드됨. 1.93.1은 시험 안 함 |
| 입력 안전 | 한도 지정 API(`open_with_limits`), 퍼징 있음 | 한도·XML bomb 시험 자료 있음, 퍼징 있음 |

### 측정 (wasm32 release, 위 두 커밋, Rust 1.97.0)
| 모듈 | 원본 | `wasm-opt -Oz` 후 | brotli q11 |
|---|---|---|---|
| rhwp(참고, 2단계 측정, `wasm-opt -Oz`) | — | — | **3.13MB** |
| BetterOffice `docx-edit` (`wasm,tiff,metafile`; parse·layout 포함) | 30,089,499 | 21,092,218 | **4,694,603** |
| office_oxide (`--features wasm`) | 2,809,857 | 2,520,782 | **766,101** |

측정 방법의 한계: ① `wasm-bindgen` 변환 전 원본에 `wasm-opt`를 적용했다(BetterOffice 잠금 파일은 0.2.126, 우리 CLI는 0.2.127이라 변환을 건너뜀). 글루 JS는 포함하지 않았다. ② BetterOffice는 렌더(JS 쪽 TypeScript)와 글꼴을 뺀 값이다. ③ 두 모듈 모두 열기·렌더 시간은 재지 않았다. ④ `docx-edit` 하나가 parse·layout을 크레이트 의존으로 포함하므로 "편집 포함 전체" 값이다. 뷰어 전용으로 줄일 수 있는지는 확인하지 못했다.

### 글꼴 (BetterOffice)
- 조판은 **호스트가 글꼴 바이트(sfnt)를 등록해 글자 폭을 재는 구조**다. 쓰는 글꼴이 없으면 합성 지표로 측정해 쪽 나눔이 Word와 달라질 수 있다(`missing_font_chains`).
- 저장소에 OFL 글꼴이 포함되어 있다: `packages/fonts` 65면(약 15MB), `packages/fonts-cjk` 약 34MB. 한국어 DOCX는 맑은 고딕·바탕 등을 쓰는 경우가 많고, 그 글꼴은 재배포할 수 없다(D-010). **한국어 문서의 쪽 나눔 정확도는 미확인이다.**

### 라이선스·의존성 감사 (`cargo deny`, `licensing/deny.toml`, licenses·sources)
- office_oxide: **통과**.
- BetterOffice: 1건 거부 — `webpki-roots 1.0.9`(`CDLA-Permissive-2.0`, 루트 인증서 데이터의 허용형 라이선스). 이것은 `betteroffice-redact-cli`(HTTP 클라이언트 `ureq`)에서만 들어오고, **DOCX wasm 경로(`cargo tree -p betteroffice-docx-edit`, 103개 크레이트)에는 없다.** 허용 목록에 `CDLA-Permissive-2.0`을 추가할지는 오너 결정 사항이다(라이선스 영향).
- BetterOffice의 DOCX 경로도 `rustybuzz`·`ttf-parser`(유지보수 중단 권고)를 포함한다(rhwp와 같다).
- BetterOffice 저장소는 `THIRD-PARTY-NOTICES.md`에 eigenpal docx editor(Apache-2.0) 파생을 밝힌다. 채택 시 이 고지도 `THIRD_PARTY_LICENSES`·`NOTICE`에 옮겨야 한다.
- 번들할 글꼴은 OFL-1.1이며 라이선스 전문 동봉이 필요하다(채택하는 경우).

## 선택지 (오너 결정)
| | A. BetterOffice로 쪽 단위 렌더 | B. office_oxide로 읽기 보기(흐르는 문서) | C. 단계적 |
|---|---|---|---|
| 전송량(지연 로딩, DOCX 열 때만) | +4.7MB(brotli, 글꼴·글루 별도) | +0.77MB | B 먼저, 이후 A를 선택 |
| 보이는 결과 | Word에 가까운 쪽(글꼴 의존) | 텍스트·표·이미지의 흐르는 보기 | |
| XLSX/PPTX | 별도 모듈·렌더 코드 필요 | 텍스트·표 수준으로 같은 모듈 | |
| 연결 작업 | 큼(조판 입력 생성, 글꼴 등록, DisplayList→SVG) | 작음(IR→DOM) | |
| 툴체인 | Rust 1.97 추가 | 1.97(또는 시험 필요) | |
| 주 위험 | 한국어 글꼴 정확도, 규모, 유지 | "뷰어"로서 기대 미달(쪽 모양 아님) | |

에이전트 권고는 **C(B부터)**다. 이유: PRD 원칙 순서에서 속도·용량이 정확도·기능 폭보다 앞서고, B는 측정된 크기가 A의 1/6이며 6개 포맷을 한 모듈로 덮는다. 다만 B는 쪽 단위 모양을 주지 않는다는 점이 제품 가치에 충분한지는 오너가 판단해야 한다. A는 B 이후 "정확한 쪽 보기"를 원할 때 같은 UI에 더하는 선택으로 남긴다.

## 승인이 필요한 항목
1. 엔진 선택 (A/B/C).
2. 새 의존성의 라이선스 추가(B: MIT OR Apache-2.0 중 MIT 선택 가정, A: Apache-2.0 + 글꼴 OFL-1.1 + eigenpal 고지).
3. (A 선택 시) `CDLA-Permissive-2.0` 허용 여부는 DOCX 경로에 없으므로 불필요할 수 있음.
4. 지연 로딩되는 DOCX 모듈의 용량 예산(현 예산은 첫 로드 기준: 합계 3.34MB, wasm 3.30MB. D-007).

## 미확인
- 두 엔진의 실제 DOCX 출력과 시간, Korean 문서 정확도, 대용량·악성 파일 동작, `office_oxide`의 HTML 품질.
- BetterOffice 뷰어 전용 최소 빌드 가능성, 그 크기.
- 다른 후보(`yukiyokotani/office-open-xml-viewer`, `rwml` 등)는 읽지 않았다.
