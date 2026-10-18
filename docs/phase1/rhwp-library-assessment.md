# rhwp 라이브러리 사용성 평가 (PRD 2절 "먼저 확인할 것" 1~4)

기준: rhwp v0.8.7, 커밋 `1a76570e833917d15817415a53c09ad61ab3203f` (2026-10-06, `main`). 모든 서술은 이 커밋의 소스를 읽고 스파이크로 확인한 것이다.

## 1. 라이브러리 의존성으로 쓸 수 있는가 → **쓸 수 있다. 단 "뷰어 전용"으로 잘라 쓰는 길은 없다.**

**증거(스파이크)**: `spikes/rhwp-lib`가 rhwp를 `path` 의존성(`default-features = false`)으로 걸어 `DocumentCore::from_bytes` → `page_count` → `build_page_layer_tree(0)` → `render_page_svg_native(0)`을 호출한다. 네이티브 릴리스 빌드 6분 25초, 실행 파일 16.4MB (이 빌드는 우리 워크스페이스의 기본 릴리스 프로필, 즉 LTO 없음으로 만들었다 — rhwp의 `[profile.release]`도 워크스페이스 루트에서만 적용되기 때문이다. 이후 우리 루트에 같은 프로필을 복제했다). 샘플 4개를 열어 쪽 수, `PageLayerTree`의 그룹/리프/`PaintOp` 종류 개수까지 읽었다.

**공개 표면** (`src/lib.rs`): `parse_document(&[u8]) -> Document`, `DocumentCore`(문서 + 조판 + 편집 명령을 한 구조체에 담음), `serialize_document`, `paint`, `renderer`, `model` 등이 모두 `pub mod`다.

**막히는 점 / 알아야 할 것**

| # | 사실 | 영향 |
|---|---|---|
| a | 크레이트가 **하나**(`rhwp`, 약 71.6만 줄)이고 모든 모듈이 무조건 컴파일된다. 기능 플래그는 `console_error_panic_hook`, `native-skia`, `gpu`, `subsecond-dev`, `tracing`뿐이다. `parser`/`serializer`/`document_core::commands`(편집)/`agent`/`mcp_serve`/`pq_sign` 같은 것을 끌 플래그가 **없다**. | 뷰어 전용 최소 빌드는 **포크 패치**(기능 플래그 신설)가 있어야 한다. **측정으로 확인함**: `spikes/rhwp-wasm`(rhwp를 의존성으로 쓰고 열기·쪽 수·SVG 3개 API만 export하는 얇은 셸, LTO 적용)은 brotli 3.39MB로, rhwp 그대로의 3.26MB보다 **오히려 크다.** `document_core::commands` 0.90MB, `serializer`, `hwpjson`이 그대로 남는다. 래퍼만으로는 줄일 수 없다. |
| b | `DocumentCore`는 편집 가능한 코어다. 읽기 전용 타입이 따로 없다. | 뷰어에서도 편집 코드가 링크 대상이다(LTO가 어디까지 지우는지는 측정 필요). |
| c | 서브모듈이 **우리 워크스페이스 폴더 안**에 있으면 rhwp 자신의 `[workspace]`와 충돌해 `multiple workspace roots found` 오류가 난다. | 루트 `Cargo.toml`에 `exclude = ["third_party/rhwp"]` 필요 (적용함). |
| d | rhwp의 `[patch.crates-io] svg2pdf = { path = "vendor/svg2pdf" }`는 **rhwp가 워크스페이스 루트일 때만** 적용된다. 의존하는 쪽이 따로 걸지 않으면 crates.io의 원본 svg2pdf가 쓰이고 PDF 결정화·그러데이션 패치가 빠진다. | 우리 루트에 같은 `[patch]`를 복제 (적용함). 네이티브 PDF 경로에만 해당하며 WASM에는 영향 없음. |
| e | 우리 `Cargo.lock`을 새로 만들면 의존성 버전이 rhwp가 고정한 것과 달라질 수 있다. | rhwp의 `Cargo.lock`을 시드로 복사 후 빌드. 결과: 우리 락의 210개 패키지 중 208개가 rhwp 락과 **버전 동일**(나머지 2개는 우리 스파이크 크레이트). 서브모듈 갱신 때 락도 함께 갱신하는 절차가 필요. |
| f | `rust-toolchain.toml`이 **1.93.1**로 고정. 현재 기본 툴체인은 1.97.0. | rhwp 디렉터리 안에서 빌드하면 1.93.1이 자동 설치된다. 우리 워크스페이스는 1.97로 빌드될지 **미확인**(이번엔 1.93.1로 고정해 측정). 툴체인 고정 방침은 오너 결정 사항으로 올린다. |
| g | 빌드가 느리다: 네이티브 릴리스 13분 18초(CLI 포함), WASM 릴리스 7분 42초, 스파이크 6분 25초 (4코어, 단일 크레이트에 LTO + `codegen-units=1`). | CI 비용. 증분 재빌드 전략(sccache 등)은 후속 과제. |
| h | 서브모듈 작업 트리가 **약 5.4GB**(`.git` 3.3GB, `mydocs/` 2.7GB, `pdf/` 1.3GB, `samples/` 690MB, `tools/` 582MB). | 클론이 무겁다. `git submodule` 얕은 클론/희소 체크아웃 가능 여부는 포크 확정 후 평가. |
| i | 업스트림은 `edwardkim/rhwp`의 `main`이 릴리스 브랜치이고 `devel`에서 개발한다(`AGENTS.md`). 이번 고정은 `main`의 v0.8.7이다. | 가져올 기준 브랜치는 오너 결정(PRD 10절). |

## 2. `PageLayerTree`가 다른 포맷의 결과도 담을 수 있는가 → **구조는 가능, 지금 모양으로는 "그대로"는 어렵다.**

**범용인 부분**
- `PageLayerTree { page_width, page_height, profile, root: LayerNode, resources, text_sources }`
- `LayerNodeKind = Group | ClipRect | Leaf { ops: Vec<PaintOp> }` — 트리 뼈대는 포맷 중립이다.
- `PaintOp`에는 `Line`, `Rectangle`, `Ellipse`, `Path`, `Image`, `TextRun`, `GlyphRun`, `GlyphOutline`, `TextDecoration`, `RawSvg` 같은 일반 그리기 연산이 있다. DOCX/PPTX/PDF의 결과를 표현하는 데 충분해 보인다. 스파이크에서 문서 쪽 0의 연산 종류를 세어 보니 `TextRun`, `Line`, `Rectangle`, `Image`, `Path`, `PageBackground`, `TextDecoration`뿐이었다.

**HWP에 묶인 부분**
- `LayerNode`/`PaintOp`가 `crate::renderer::render_tree`의 노드 타입(`TextRunNode`, `TableNode`, `TableCellNode`, `FormObjectNode`, `FootnoteMarkerNode`, `EquationNode` 등)을 그대로 들고 있다.
- `TextRunNode`는 `char_shape_id`, `para_shape_id`, `section_index`, `para_index`, `char_start`, `cell_context`, `border_fill_id`, `field_marker` 같은 **HWP 모델·편집용 필드**를 갖는다. 대부분 `Option`이라 다른 포맷은 `None`으로 채울 수는 있다.
- `GroupKind`에 `MasterPage`, `Header`, `Footer`, `FootnoteArea`, `Table(TableNode)`, `TableCell(TableCellNode)` 같은 HWP 문서 구조가 박혀 있다.
- `paint/` 모듈이 `crate::model`(19곳), `crate::renderer`(76곳), `crate::document_core`(2곳)를 참조한다. 즉 `paint`만 떼어 쓸 수 없다.
- **`paint`와 `render_tree`는 별도 크레이트가 아니라 rhwp 본체 안에 있다.** DOCX 어댑터가 `PageLayerTree`를 쓰려면 rhwp 전체에 의존하게 된다.

**판정**
- (가) rhwp 전체에 의존하고 `PageLayerTree`를 그대로 쓴다: 가능하나, 다른 포맷 엔진이 HWP 전용 노드 타입을 흉내 내야 하고 rhwp 크기가 모든 포맷 모듈에 딸려 온다.
- (나) 우리 `paint/` 크레이트에 **포맷 중립 IR을 새로 정의**하고, `fmt-hwp` 어댑터가 `PageLayerTree`를 그 IR로 변환한다: 변환 비용(복사·메모리)이 있지만 PRD 5절의 구조 원칙(아래쪽 공유)에 맞고 다른 포맷이 rhwp에 묶이지 않는다.
- **권고: (나)**를 기본으로 한다. 단 3단계(DOCX) 시작 전에 BetterOffice가 자체 렌더 경로(DOCX 쪽 레이아웃 + XLSX/PPTX 렌더링을 갖춤)를 가지는지 확인해 그 출력을 우리 IR에 맞출 수 있는지 스파이크로 검증한다. (아래 5절)
- 이 판정은 **코드 읽기 + 스파이크 호출까지**의 근거이며, 실제로 다른 포맷의 출력을 `PageLayerTree`에 담아 그려 본 것은 **아니다.**

## 3. HWP와 무관한 모듈의 재사용성

내부 의존을 `crate::model|parser|document_core|renderer|paint|serializer` 참조 수로 측정했다.

| 모듈 | 줄 수 | rhwp 내부 의존 | 재사용 판정 |
|---|---|---|---|
| `crates/rhwp-ooxml-chart` | 9,743 | 없음 (`quick-xml`만) | **즉시 재사용 가능.** 별도 크레이트. DOCX/XLSX/PPTX 차트에 쓸 수 있음 |
| `src/ole_chart` | 3,142 | 없음 | 쉬움 (파일 단위 추출 필요) |
| `src/document_core/table_calc` | 1,059 | 없음 | 쉬움 (표 계산식 — HWP 고유 의미가 있는지는 미확인) |
| `src/eps.rs` | 1,956 | 없음 | 쉬움 |
| `src/emf` | 3,474 | `renderer` 1곳 | 약간 손질 (대부분 독립) |
| `src/wmf` | 19,500 | `renderer` 1곳 | 약간 손질 |
| `src/renderer/equation` | 8,305 | `model` 4곳, `renderer` 5곳 | 중간 (수식 구조는 HWP 수식 문법 기반일 가능성이 있어 DOCX의 OMML과는 별개 — **미확인**) |
| `src/paint` | 17,170 | `model` 19, `renderer` 76, `document_core` 2 | 어려움 (2절) |

- 위 "쉬움" 판정은 **참조 수 기준**이다. 해당 모듈을 실제로 다른 곳에서 컴파일해 본 것은 아니다.
- 파일을 우리 저장소로 복사해 쓰면 원 저작권 주석을 유지하고 출처를 `NOTICE`/`docs/patches/`에 기록해야 한다(PRD 2절). 가능하면 복사 대신 **서브모듈의 크레이트를 의존성으로** 쓴다(`rhwp-ooxml-chart`는 그렇게 가능).

## 4. 통합 방식 판정 (PRD 2절 4번에 대한 입력 — 오너 결정 필요)

- 1, 3번 결과로 **"고정 버전 의존성(서브모듈)" 기본 방향은 유지 가능**하다. 라이브러리로 호출되고, HWP 어댑터(`fmt-hwp`)는 `DocumentCore` 위에 얇게 만들 수 있다.
- 다만 **뷰어 전용 빌드와 용량 예산**은 rhwp 크기가 그대로 모든 곳에 딸려 오는 구조라 어렵다(용량 측정은 `report.md`). 요소 추출 방식으로 전환할지는 이 측정값을 보고 오너와 협의한다. 지금 단계의 권고는 **서브모듈 유지 + 3단계 전까지 `paint` IR은 우리 쪽 신규 정의(나)로 분리 계획**이다.

## 5. 미확인 / 다음에 할 것

- 다른 포맷 출력을 `PageLayerTree`에 실제로 담아 보는 스파이크 (3단계 전).
- BetterOffice(Apache-2.0)가 DOCX 레이아웃·XLSX/PPTX 렌더링을 가진다는 README 서술의 실제 검증(소스·산출물·WASM 크기). office_oxide(MIT OR Apache-2.0)는 README상 텍스트·Markdown·HTML·IR 추출이 중심이고 렌더링은 명시되지 않았다.
- 우리 워크스페이스를 1.97(안정판)로 빌드할 수 있는지.
