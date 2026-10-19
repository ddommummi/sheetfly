# 결정 기록

날짜순으로 추가한다. 항목마다 무엇을 / 왜 / 검토한 대안을 적는다. 상태: **적용**(에이전트가 실행·되돌릴 수 있음), **제안**(오너 승인 필요, 아직 실행 안 함).
수치의 근거는 [`docs/phase1/report.md`](phase1/report.md).

---

## 2026-10-18 · 1단계

### D-001 rhwp를 `third_party/rhwp`에 고정 커밋 서브모듈로 연결 — 적용 (포크 `ddommummi/rhwp` 연결 완료)
- **무엇**: `edwardkim/rhwp` `main`의 `1a76570e833917d15817415a53c09ad61ab3203f`(v0.8.7)을 서브모듈로 고정. `.gitmodules` URL은 **업스트림을 임시로 가리킨다.**
- **왜**: PRD 2절 기본 방향. 오너 계정에 rhwp 포크가 **없음**(`list_repos` 확인). 포크 생성은 외부에 보이는 작업이라 승인 없이 하지 않았다.
- **대안**: 포크를 에이전트가 직접 생성(승인 전이라 기각); rhwp를 복사해 단절(PRD 2절이 기본 방향으로 두지 않음).
- **오너 결정(2026-10-18)**: 포크해서 진행한다. 에이전트의 포크 시도는 세션 접근 범위(`ddommummi/sheetfly`만 허용) 때문에 거부되었고, 범위를 넓히려면 원본 저장소에 쓰기 권한을 붙여야 해서 우회하지 않았다 → **오너가 GitHub에서 직접 포크**하고 알려주면 에이전트가 이어서 진행한다.
- **포크 연결(2026-10-18)**: 오너가 `ddommummi/rhwp`(공개, `main`만 복사)를 만들었다. 포크 `main` = `1a76570e…`로 우리 고정 커밋과 **동일함을 `git ls-remote`로 확인**했고, `.gitmodules` URL을 포크로 교체했다. 업스트림 `devel`은 이미 앞서 있다(`224a3260…`) — 고정은 계속 `main`.
- **남은 오너 결정**: 기준 브랜치(`main`/`devel`)와 갱신 주기. 포크의 GitHub Actions는 켜지 않기를 권한다(rhwp 워크플로가 무겁다) — 설정은 에이전트가 확인하지 못했다.

### D-002 통합 방식: 서브모듈 의존을 유지하되 `paint` IR은 우리 쪽에 새로 정의할 계획 — 제안
- **무엇**: `fmt-hwp`는 `DocumentCore` 위의 얇은 어댑터. 타 포맷이 쓸 그리기 중간 표현은 rhwp의 `PageLayerTree`를 그대로 쓰지 않고 우리 `paint/` 크레이트에 포맷 중립으로 정의, `fmt-hwp`가 변환. (3단계 전에 확정)
- **왜**: `PageLayerTree`는 뼈대·`PaintOp`는 범용이지만 노드가 HWP 전용 타입(`TextRunNode`의 `para_index` 등, `GroupKind::Table`…)에 묶여 있고 rhwp 본체 안에 있어, 쓰려면 rhwp 전체에 의존하게 된다. 근거: `docs/phase1/rhwp-library-assessment.md` 2절.
- **검토한 대안**: (가) `PageLayerTree` 그대로 사용 — 가능하나 타 포맷이 HWP 노드를 흉내 내야 함; (나) 우리 IR(채택 제안); 요소 추출(PRD 2절 4번) — 현 단계에서 필요성 근거 부족.
- **한계**: 다른 포맷 출력을 실제로 담아 본 것은 아니다. 코드 읽기+스파이크 호출 근거.

### D-003 워크스페이스 구성 규칙 — 적용
- **무엇**: 루트 `Cargo.toml`에 (1) `exclude = ["third_party/rhwp"]`, (2) rhwp와 같은 `[patch.crates-io] svg2pdf`, (3) rhwp와 같은 `[profile.release]` 복제, (4) `Cargo.lock`은 rhwp의 락을 시드로 시작(우리 락 패키지 중 rhwp 락과 버전이 다른 것은 0개, 우리 스파이크 크레이트 2개만 추가).
- **왜**: 서브모듈이 워크스페이스 폴더 안에 있으면 `multiple workspace roots` 오류; `[patch]`·`[profile]`은 워크스페이스 루트에서만 적용되어 의존하는 쪽이 복제하지 않으면 사라진다(실제로 첫 네이티브 스파이크는 LTO 없이 빌드됨).
- **대안**: 서브모듈을 폴더 밖에 두기(구조 원칙 5.2와 충돌).
- **후속**: 서브모듈 포인터를 올릴 때 `Cargo.lock`도 같은 절차로 다시 시드해야 한다.

### D-004 빌드 툴체인: rhwp가 고정한 Rust 1.93.1로 측정 — 적용 / 우리 고정 정책은 제안
- **무엇**: 측정은 모두 1.93.1(`rust-toolchain.toml`). 우리 워크스페이스를 1.97 안정판으로 빌드할 수 있는지는 **미확인**.
- **제안**: 우리 루트에도 `rust-toolchain.toml`로 1.93.1을 고정하고, 서브모듈 갱신 시 같이 올린다.

### D-005 WASM 빌드 설정: `wasm-opt -Oz`(명시 기능 목록) 채택, `opt-level="z"` 보류 — 제안
- **무엇**: 릴리스 빌드 후 `wasm-opt -Oz --enable-bulk-memory --enable-sign-ext --enable-mutable-globals --enable-nontrapping-float-to-int --enable-multivalue --enable-reference-types`. `--all-features`는 쓰지 않는다.
- **왜**: brotli 3.26→3.13MB(−4.2%), 속도 차이는 반복 편차 이내(열기 p50 67→71ms, 쪽 SVG 10.1→10.3ms). `opt-level="z"`는 −14.3%(2.80MB)지만 열기 p50 +74%(67→117ms), 쪽 SVG +44%; z+Oz는 −23.0%(2.51MB)지만 열기 +82%. `--all-features` 산출물은 Chromium이 로드하지 못했다(`unknown import kind`).
- **대안**: `opt-level="z"` 전역(속도 손실 큼), 혼합 전략(rhwp가 단일 크레이트라 지금은 불가).

### D-006 뷰어 전용 빌드는 "래퍼"로 불가 — 포크 패치 후보로 이관 — 제안
- **무엇**: rhwp를 의존성으로 쓰는 얇은 WASM 셸(`spikes/rhwp-wasm`)은 3.39MB(brotli)로 rhwp 그대로(3.26MB)보다 크다. 편집·직렬화 코드가 `DocumentCore`와 얽혀 LTO로 안 떨어진다.
- **다음**: 기능 플래그 포크 패치(후보 목록 `docs/patches/README.md`). 추정 이득은 원본 기준 약 −17%(편집 ~12% + 이미지 디코더 ~5%)이며 **압축 후 이득은 미검증**. 패치 비용·갱신 부담(PRD 2절 트레이드오프)과 이득을 보고 오너가 결정.

### D-007 용량 예산과 수치 목표 — 오너 승인(2026-10-18), 적용 / CI는 미작성
- **무엇**: `tools/measure/budgets.json`: WASM brotli ≤3.30MB, JS ≤40KB, 합계 ≤3.34MB. 현재 3.16MB. `tools/measure/check-budget.mjs`로 로컬 검증 완료(기준 통과, 얇은 셸은 실패).
- **왜**: 회귀 방지선이지 목표치가 아니다. 목표(예: ≈2.6MB)는 D-006 결과 이후에 정한다.
- **CI 워크플로는 아직 만들지 않았다**(Actions 환경에서 검증할 수 없고 빌드가 10분 이상이라 오너가 예산을 확정한 뒤 추가).
- **기타 수치 목표**: `docs/phase1/report.md` 4절의 제안을 **오너가 제안대로 승인**했다(2026-10-18). 요지: 웹 초기 전송 회귀 방지선 ≤3.34MB(brotli), ≤1MB 문서 첫 쪽까지 p50 ≤150ms(p95 목표는 "첫 쪽 먼저" 패치 이후 재설정), 쪽당 렌더는 SVG 기준 ≈10ms·Canvas 기준 ≈16ms, 큰 문서는 열기 상한 대신 로딩 표시·취소 UI를 요구사항으로 등재, Windows 설치 파일 목표는 4단계 전까지 보류.
- **주의**: 승인된 것은 "제안 수치"이며 측정 환경은 컨테이너 한 곳이다(D-015). 오너 기기 재측정 결과에 따라 재조정할 수 있다.

### D-008 한컴 명세 이용조건과 고지 문구 — 오너 승인(2026-10-18): 의무 문장을 우리 산출물에 넣는다
- **무엇**: 한컴 HWP 5.0 문서(rev 1.3, 2018-11-08)의 저작권 절은 개발 결과물의 **제품 UI·매뉴얼·도움말·소스에 모두** 정해진 문장을 쓰도록 요구한다. 또한 이 문서 자체의 배포는 무수정 최신본만 허용한다. 상세: `docs/licensing/hwp-spec-terms.md`.
- **조치(적용)**: README·NOTICE에 의무 문장을 넣었다. 명세 PDF는 저장소에 넣지 않는다.
- **오너 결정(2026-10-18)**: 한컴이 요구한 문장을 우리 산출물에 넣는다. 반영 위치: README·NOTICE(1단계), 소스 진입점 주석(스파이크 2곳 반영, `crates/` 생성 시 각 크레이트 루트에 추가), 앱 UI·웹 `/licenses`·도움말(2단계). rhwp가 같은 문장을 이미 갖고 있어도(`src/lib.rs`, studio 정보 대화상자, README) 우리 산출물에는 별도로 쓴다. 문장은 직접 작성하며 rhwp의 UI 문구 파일을 복사하지 않는다.
- **PRD와의 차이(초안 문안 정리 필요)**: PRD 8.6절 한국어 초안("…공개한 HWP 문서 파일 명세를 참고하여 개발되었습니다")은 한컴이 요구한 문장과 다르다. 의무 문장 + 비제휴 문단 병기를 제안한다.
- **미확인**: 이 PDF가 최신 개정본인지. 문장을 UI에 넣을 위치(2단계). 정확한 문구(PDF가 "한글"을 전용 글리프로 인쇄)는 변호사 확인.

### D-009 프로젝트 라이선스: MIT, 저작권자 Dongwook Kim — 오너 결정(2026-10-18), 적용
- **무엇**: 루트 `LICENSE`(MIT, `Copyright (c) 2026 Dongwook Kim`). 스파이크 `Cargo.toml`에 `license = "MIT"`(`publish = false` 유지). `NOTICE`, `THIRD_PARTY_LICENSES` 서문, README 갱신.
- **왜**: rhwp가 MIT이고 의존성 203개가 모두 허용 라이선스라 충돌이 없다. MIT는 어떤 라이선스로 쓰든 허용하므로 rhwp에 의해 강제된 선택은 아니다.
- **검토한 대안**: Apache-2.0(특허 사용 허락·상표 조항 명시), `MIT OR Apache-2.0` 이중 라이선스, MPL-2.0(파일 단위 카피레프트).
- **헤더 정책**: 소스 파일마다 라이선스 헤더를 붙이지 않는다(루트 `LICENSE`가 적용). 소스에는 한컴 요구 문장(D-008)만 넣는다. 업스트림 파일의 원 저작권 주석은 절대 건드리지 않는다.
- **유지**: rhwp의 MIT 고지(Edward Kim 줄)는 영구 유지 — `licenses/rhwp-LICENSE-MIT.txt`(무수정 사본), `NOTICE`, `THIRD_PARTY_LICENSES`.
- **저작권자 표기**: 처음에는 GitHub 사용자명(`ddommummi`)으로 반영했다가, 오너가 `Dongwook Kim`으로 수정하도록 지시했다(같은 날). 이 표기가 법적 이름과 일치하는지는 에이전트가 확인할 수 없다(오너 확인).

### D-010 번들 폰트: rhwp의 폰트를 하나도 재배포하지 않는다 — 적용
- **무엇**: 서브모듈 안에만 있고 우리 산출물에는 넣지 않는다. 쓰게 되면 원 배포처에서 원본·라이선스를 받아 개별 승인.
- **왜**: Cafe24(All Rights Reserved, 조건 불명)와 행복고딕(저작권자 "THE HYUNDAI"인데 업스트림은 "행복나눔재단 무료 배포"라 적음)은 재배포 조건 미확인; Nanum 계열은 파일 내부에 라이선스 문구가 없음; Noto Sans KR/Source Han Serif subset은 `Reserved Font Name 'Source'`가 남아 있음; Latin Modern Math(GUST)는 PRD 허용 목록(OFL) 밖. 상세: `docs/licensing/font-audit.md`.
- **글꼴 메트릭 표**(2.2MB 소스, 한컴/MS 글꼴에서 추출한 수치): 업스트림은 "사실 데이터"라는 입장이나 우리가 검증하지 않았다 → **변호사 검토 항목**.

### D-011 의존성 보안·라이선스 감사 결과와 대응 방침 — 적용(정책) / 제안(대응)
- **결과**: 라이선스·출처·bans 통과(203개, 금지 0건). `advisories`는 `zip 8.6.0`(RUSTSEC-2026-0367/0368/0369, 모두 `extract()` 계열), `rustybuzz`·`ttf-parser`·`paste`(유지보수 중단), `chacha20 0.10.1`(yanked). rhwp에 `.extract(` 호출 0건. 상세: `docs/licensing/dependency-audit.md`.
- **정책 적용**: `licensing/deny.toml`(PRD 8.2절 허용 목록), 업스트림 매니페스트의 wildcard path 의존성 때문에 `wildcards="allow"`.
- **제안**: 업스트림 갱신을 기다리되, 2단계 전에 컨테이너 계층(`container/`)에서 `zip` 사용을 우리가 통제할지 결정. `rustybuzz`/`ttf-parser`는 조판 핵심이라 대체 비용이 커서 **장기 리스크로 등재**만 한다.
- **미수행**: npm 의존성 감사(2단계 프런트에서), `cargo-fuzz` 퍼징.
- **업스트림 `THIRD_PARTY_LICENSES.md`는 현행이 아님**(cfb, quick-xml, wasm-bindgen 버전 불일치). 우리는 `Cargo.lock`에서 `licensing/build-third-party.sh`로 직접 생성한다. 업스트림 "직접 포팅한 알고리즘"(Volexity hwp-extract BSD-3-Clause 등) 고지를 우리 `THIRD_PARTY_LICENSES`에 옮겨 실을지는 **오너/변호사 판단**(할 일).

### D-012 DOCX 등 타 포맷 엔진 후보 (3단계 입력) — 잠정, 미검증
- **BetterOffice** (`openooxml/betteroffice`): GitHub 표기 Apache-2.0, DOCX/XLSX/PPTX, 쪽 나눔·렌더링·편집·저장을 갖는다고 README가 서술, WASM npm 패키지 있음, 별 302. 크기·최신 커밋 날짜는 확인 못함. README의 자체 벤치마크(DOCX 쪽수 63/63 vs LibreOffice 44/63)는 **자가 보고이며 검증하지 않았다.**
- **office_oxide** (`yfedoseev/office_oxide`): MIT OR Apache-2.0로 표기, DOCX/XLSX/PPTX 읽기·쓰기·변환과 구형 포맷 읽기, WASM 바인딩 있음. 출력이 텍스트·Markdown·HTML·IR 중심이고 **쪽 렌더링은 명시되지 않음** → 뷰어용 후보로는 BetterOffice가 앞선다고 보이나 가설.
- **다음**: 3단계 시작 전에 두 후보의 LICENSE 전문, 의존성 라이선스(`cargo-deny`), WASM 크기, 샘플 출력을 직접 확인.

### D-013 Windows·모바일 셸 후보 — 미착수
- **이유**: 이 환경(Linux 컨테이너)에서 Windows/Tauri 실측이 불가능하다. 네이티브 쪽당 렌더 p50 5.5ms로 WASM(10.1ms)보다 약 1.8배 빠르다는 점만 확인했다(집계 방식이 달라 대략적).
- **다음**: 4단계 전에 오너 기기에서 Tauri 2 스파이크(설치 파일 크기, 콜드 스타트).

### D-014 이름 확정 전 확인 (오너가 직접, PRD 2-1절) — 기록만
- [ ] GitHub 조직/사용자명 `sheetfly`
- [ ] npm `sheetfly`, crates.io `sheetfly` (스코프 포함)
- [ ] 도메인 (`.com` 구매 가능 여부 또는 `.app`/`.dev`/`.io`/`.org`)
- [ ] KIPRIS "SHEETFLY"/"시트플라이" (9류, 42류)
- [ ] 앱스토어·구글 플레이·크롬 웹스토어 이름 중복
- [ ] 변리사 검토 시 상표 출원 여부
- 에이전트는 상표 출원·도메인 구매·스토어 등록을 하지 않는다(PRD 11절 8번). 이 항목은 확인 결과를 오너가 알려 주면 갱신한다.

### D-015 측정 방법의 한계 — 기록
- 단일 환경(2.1GHz 4 vCPU 컨테이너, 한글 글꼴 없음). 코퍼스는 업스트림 샘플(합성 픽스처 다수). 병리 문서 1개, 암호 문서 2개는 변형 비교에서 제외. 변형 간 비교는 번갈아 3회, 반복 편차 약 ±10%. 오너 기기 재측정 권장.
- 샘플 문서는 출처·라이선스를 확인하지 못해 우리 저장소에 복사하지 않았다(경로 목록만).

---

## 2026-10-18 · 2단계 (웹 뷰어 MVP)

수치와 검증 결과는 [`docs/phase2/report.md`](phase2/report.md).

### D-016 웹 구조: 바닐라 JS + esbuild, 문서당 Worker 1개, 쪽은 SVG를 `<img>`로 표시 — 적용
- **무엇**: 프레임워크 없이 ES 모듈. esbuild(개발 의존성, MIT)로 번들·최소화·해시 파일명. 엔진(rhwp WASM)은 Web Worker에서 구동하고 메인 스레드는 메시지만 주고받는다. 문서를 열 때마다 새 Worker를 띄우고(열기 취소·엔진 죽음이 이미 열린 문서에 영향을 주지 않음), 성공하면 이전 Worker를 종료한다. 쪽은 엔진이 만든 SVG를 blob URL `<img>`로 보여 준다. 페이지 로드 직후와 문서를 연 직후에 다음 Worker를 미리 올려 둔다.
- **왜**: (1) 엔진의 Canvas2D 렌더는 `HtmlCanvasElement`가 필요해 Worker에서 쓸 수 없다(메인 스레드에서 돌리면 조판·렌더가 UI를 멈춘다). SVG 경로는 Worker에서 동작하고 1단계 측정에서 더 빠르다(쪽당 p50 10ms vs Canvas 16ms). (2) `<img>` 안의 SVG는 스크립트·외부 로딩이 실행되지 않아, 문서에서 나온 SVG를 DOM에 직접 넣는 것보다 안전하다. 코퍼스 40개 문서 샘플에서 SVG에 `<script>`/`foreignObject`/외부 URL이 없고 이미지는 `data:`뿐임을 확인했다. (3) 문서당 Worker는 WASM trap(엔진 panic) 뒤의 인스턴스를 재사용하지 않게 해 준다.
- **대안**: Canvas2D를 메인 스레드에서(UI 멈춤), 인라인 SVG(XSS·CSP 부담, 텍스트 선택은 가능), 단일 Worker 재사용(취소·크래시 시 열린 문서를 잃음).
- **트레이드오프**: `<img>` 안의 SVG는 페이지의 웹 글꼴을 못 쓰고 시스템 글꼴만 쓴다(D-021). 텍스트 선택·복사는 지원하지 않는다(후속 과제).

### D-017 열기 한도와 취소 — 적용
- **무엇**: 파일 100MB 초과는 열기 전에 거절한다. 8초가 지나면 "시간이 걸리고 있습니다" 안내와 함께 취소 버튼이 항상 보이며, 취소는 Worker를 종료해 즉시 반영된다. 승인된 요구사항("큰 문서는 열기 시간 상한 대신 로딩 표시·취소 UI")의 구현이다.
- **왜**: 병리 문서는 195초, 2.3MB·314쪽 문서도 UI에서 17.7초가 걸렸다(엔진 한계). 샘플 코퍼스 최대는 약 13.6MB. 100MB는 4GB WASM 메모리 한계 안에서 안전하다고 본 임의 값이다 — 오너가 조정할 수 있다.

### D-018 오류 분류와 엔진 panic 방어 — 적용
- **무엇**: Worker가 엔진 오류를 코드(`password_required`, `wrong_password`, `drm`, `corrupt`, `worker_crashed` …)로 바꾼다. 엔진 메시지는 사용자에게 보이지 않고 우리 문구만 보인다. WASM trap은 `fatal`로 표시해 그 Worker를 버린다. 손상으로 구역이 0개가 된 문서는 엔진 `getPageInfo`가 panic하므로(`rendering.rs` `get_page_info_native`의 index out of bounds) 열기 전에 `sectionCount === 0`을 걸러 "손상 문서"로 안내한다.
- **근거**: 손상 변형 코퍼스(2,100건)에서 5건의 panic이 모두 이 원인이었고, 방어 후 같은 시드와 새 시드(1,200건) 모두 panic 0건.
- **업스트림 보고는 하지 않았다**(원본에 글을 올리려면 오너 승인 필요, PRD 11절 7번). 재현 자료는 `docs/phase2/report.md`에 있다.

### D-019 검색: 쪽별 텍스트 배치를 직접 훑는 자체 구현 — 적용
- **무엇**: 엔진의 `searchAllText`는 쪽 번호·좌표를 주지 않는다. Worker가 `getPageTextLayout`(TextRun 위치, 글자별 x 경계)을 쪽마다 읽어 같은 줄의 연속 TextRun을 이어 붙여 찾고, 강조 사각형을 만든다. 결과는 쪽 순서로 스트리밍하고 새 검색은 이전 검색을 취소한다. 최대 5,000건.
- **한계**: 줄 바꿈·표 셀·글상자 경계를 넘는 일치는 못 찾는다. 대소문자 구분 옵션 외의 정규화(전각/반각, 공백 개수)는 하지 않는다. 383쪽 문서 전체 검색 약 2.5초.

### D-020 배포 설정: Workers Static Assets(assets-only) — 설정 작성, 배포는 하지 않음
- **무엇**: `apps/web/wrangler.jsonc`(`html_handling: auto-trailing-slash` → `/licenses`가 `licenses.html`, `not_found_handling: 404-page`), `public/_headers`. 문법은 Cloudflare 공식 문서로 2026-10-18에 확인했다. CSP는 PRD 7-B 초안에 `form-action 'none'`, `frame-ancestors 'none'`(다른 사이트 임베드 미지원 — 지원이 필요하면 오너가 정책 결정), `Permissions-Policy`를 더했다.
- **미수행(오너)**: Cloudflare 계정·도메인·API 토큰 결정, 실제 배포. 따라서 `.wasm` MIME·Brotli 압축·`.txt` 문자 인코딩을 **실제 Cloudflare에서는 확인하지 못했다**(개발 서버가 같은 규칙을 흉내 낸 결과만 있다).
- **한도 확인**: 파일당 25MiB(WASM 11.7MB), 무료 플랜 버전당 20,000개 파일.

### D-021 글꼴: 번들하지 않고 시스템 글꼴 — 적용, 위험 기록
- **무엇**: 웹 글꼴을 내려받지 않는다(D-010). 엔진이 낸 글꼴 스택(한컴/MS 글꼴명 → Nanum/Noto/Malgun Gothic 등 → serif/sans-serif)을 브라우저가 시스템 글꼴로 해석한다.
- **위험**: 한글 글꼴이 없는 기기에서는 글자가 □로 보일 수 있다(Windows·macOS·Android·iOS에는 한글 글꼴이 기본 포함되어 가능성은 낮다고 보나 **미시험**). 글꼴이 다르면 줄 바꿈은 엔진의 메트릭 기준이라 그대로이고 글자 모양만 달라진다.
- **후속**: OFL 글꼴 서브셋 지연 로딩은 `<img>` SVG가 웹 글꼴을 못 쓰는 문제(D-016) 때문에 구조 변경이 필요하다(예: SVG를 DOM에 넣거나 글꼴을 SVG에 data URI로 포함).

### D-022 빌드 산출물과 재현성 — 적용
- **무엇**: WASM·글루는 커밋하지 않고(`apps/web/src/wasm/`는 gitignore) `scripts/build-wasm.sh`로 만든다. 같은 스크립트로 처음부터 다시 빌드한 WASM이 개발용 산출물과 **sha256이 같음**(`2e478e5c…`)을 확인했다(빌드 13분 19초). 배포 파일명은 `engine-<hash>.wasm`로 업스트림 이름을 쓰지 않는다. 생성된 글루·WASM 내부 문자열(`rhwp_bg.wasm` 등)에는 업스트림 이름이 남지만 사용자에게 보이지 않는다 — 변호사 검토 항목.
- **라이선스 보완**: 업스트림이 rhwp 코드에 "직접 포팅"했다고 밝힌 Volexity hwp-extract(BSD-3-Clause)의 고지를 `THIRD_PARTY_LICENSES`에 원문 그대로 추가했다(WASM에 포함되므로). 한컴 `hwpx-owpml-model`/`dvc`(Apache-2.0)는 스펙 참조일 뿐 코드 복사가 아니라고 업스트림이 밝혀 같은 절에 원문으로 수록했다.

### D-023 CI는 초안만 — 미검증
- `.github/workflows/web.yml`(빌드·예산·E2E·코퍼스·cargo-deny), `fuzz.yml`(rhwp의 cargo-fuzz 타깃 3개). 모두 `workflow_dispatch` 전용이다. 액션 SHA는 업스트림(rhwp) 워크플로가 고정해 둔 값을 가져왔고 **직접 검증하지 않았다.** YAML 문법만 확인했고 Actions에서 실행해 본 적은 없다. 첫 수동 실행이 통과하면 `pull_request`/`push` 트리거를 켠다(오너 결정).
- 같은 시험은 이 환경에서 로컬로 실행해 통과시켰다(결과는 phase2 보고서).


### D-024 첫 문서 예열과 UI 기준 속도 목표 미달 — 예열 적용 / 목표 수정은 제안
- **무엇**: 페이지 로드 후 첫 Worker가 가상 문서(생성 → 텍스트 삽입 → HWP 내보내기 → 다시 읽기 → 렌더·텍스트 배치)로 엔진을 한 번 돌려 예열한다(약 100ms, 파일을 고르는 동안). 이후 Worker는 예열하지 않는다(같은 렌더러의 최적화된 코드를 공유).
- **왜**: 세션 첫 문서가 느렸다(UI p50 980ms). 예열 후 645ms(p95 1,619→1,169ms). 반복을 늘려도 이득이 더 없어 1회.
- **미달**: 승인된 "≤1MB 문서 첫 쪽까지 p50 ≤150ms"는 엔진만 재면 103ms지만 UI 기준으로는 이후 문서 269ms, 첫 문서 645ms다(이 컨테이너). 원인 분석과 개선 후보(ImageBitmap 전달 등, 미시험)는 phase2 보고서 5절. 수정안: "UI 기준 이후 문서 ≤300ms, 첫 문서 ≤700ms" — **오너 결정**.
- **대안**: 예열 없음(첫 문서 느림), 매 Worker 예열(CPU 낭비), 메인 스레드 렌더(UI 멈춤).


### D-025 Git 연동 배포: Cloudflare Workers Builds + 희소 체크아웃 빌드 스크립트 — 설정 준비, 실제 연결은 오너
- **무엇**: 오너가 "GitHub 연동으로 배포"를 원해 `scripts/cloudflare-build.sh`(희소 체크아웃 → Rust → wasm-bindgen 사전 빌드본 → WASM → 웹)와 `docs/deploy-cloudflare.md`를 만들었다. Cloudflare 설정: Root directory `apps/web`, Build command `bash ../../scripts/cloudflare-build.sh`, Deploy command 기본 `npx wrangler deploy`. `apps/web`에 wrangler 4.151.1을 고정(Workers Builds는 `package.json`의 wrangler를 사용).
- **왜 이렇게**: 공식 문서상 빌드 제한 20분, Rust 캐시 없음, Rust 포함·서브모듈 지원은 명시되지 않음. 서브모듈은 3GB+라 `scripts/fetch-rhwp.sh`로 필요한 파일만(약 57~105MB, 수 초) 받는다 — 같은 WASM이 빌드됨을 확인(sha256 일치). `wasm-opt`는 기본 생략(약 6분 절약, brotli +4%).
- **실측**: 빈 HOME의 깨끗한 환경에서 657초(10분 57초). **Cloudflare 서버 속도는 미확인**이라 첫 실제 빌드 시간을 보고 판단한다.
- **대안**: GitHub Actions에서 빌드해 `wrangler deploy`(시간 제한 없음, 시크릿 필요), 빌드된 WASM을 저장소에 커밋(저장소 비대·산출물 불일치 위험으로 기각).
- **전제(오너)**: 저장소에 `main`이 없다(작업 브랜치만 있음) → `main` 생성/머지 필요. 배포 = 공개 URL 생성이므로 PRD 8.7 검토 게이트. 에이전트는 Cloudflare 계정에 접근할 수 없어 실제 연결·배포를 하지 못했다.
- **개발 의존성 영향**: wrangler가 선택적 LGPL(sharp-libvips) 패키지 14개를 끌어온다(배포물에 미포함). `docs/licensing/dependency-audit.md`에 기록, 오너 확인 항목.
- **D-022 정정**: 빌드 "바이트 동일"은 같은 HOME/CARGO_HOME 경로에서만 성립한다. 경로가 다르면 의존성 panic 위치 문자열 때문에 약 3.7KB 달라진다(글루·동작은 동일).


---

### D-026 GitHub Actions 첫 실행과 빌드 시간 — 현상 유지 (2026-10-19)
`Web` 워크플로를 `workflow_dispatch`로 3회 실행했다(브랜치 `ccr-b1a46db5-5guuml`). 1차는 E2E 16개가 실패했다. 앱 문제가 아니라 희소 체크아웃에 `samples/`가 없어서였고, `RHWP_SAMPLES=1`일 때만 샘플을 받도록 `scripts/fetch-rhwp.sh`를 고쳤다. 2·3차는 전 단계 통과(build, 예산, E2E 21/21, 코퍼스 150개, cargo-deny 필수 항목).
- WASM 빌드 단계: 캐시 없음 9분 15초, rust-cache 적중 7분 20초(절감 약 20%). 전체 약 11~13분. 단계별 분해는 하지 않았다(rhwp 본체 재컴파일과 wasm-opt 때문이라는 설명은 추정).
- 검토한 대안: (A) Actions에서 wasm을 미리 빌드해 릴리스로 올리고 Cloudflare는 내려받기, (B) 포크에 뷰어 전용 기능 플래그. **오너 결정: 현상 유지.** A·B 모두 하지 않는다. 포크 패치는 계속 0개(D-006).
- 현재 구성에서 Cloudflare 빌드는 소스에서 직접 빌드하며 20분 한도 안(시뮬레이션 10분 57초, wasm-opt 끔)이다. 실제 Cloudflare 환경의 시간은 연결 후에야 알 수 있다.
- 트리거는 계속 수동이다. 푸시/PR 자동 실행은 켜지 않았다(항목 16은 "첫 수동 실행 완료"로 갱신).

### D-027 공개 전 확인 항목에 대한 오너 응답 (2026-10-19)
- **변리사/변호사 미팅(PRD 8.7)**: 오너가 "따로 필요 없다"고 판단. 법률 검토 없이 공개하는 것은 오너의 결정이며, 이 저장소의 라이선스·고지 문서(`docs/licensing/`)는 법률 자문이 아니라는 점은 그대로다.
- **이름·도메인(D-014)**: `sheetfly.com`, `sheetfly.app`은 이미 다른 곳이 등록해 사용할 수 없다. 다른 TLD(`.dev`, `.io`, `.org`), Cloudflare 기본 주소(`*.workers.dev`), 이름 변경 중 선택은 미정. 두 도메인에 무엇이 올라와 있는지(경쟁 서비스·상표 사용 여부)와 KIPRIS 검색은 아직 확인 전.
- **개발 의존성 LGPL(D-025)**: 처음엔 오너가 판단을 못 했으나 이후 허용으로 확정 → D-028.

### D-028 개발 의존성 LGPL 허용 + 배포물 검사 (2026-10-19, 오너 승인)
- **결정(오너)**: `wrangler → miniflare → sharp`가 선택적으로 끌어오는 `@img/sharp-libvips-*`(LGPL-3.0-or-later) 등 개발 전용 의존성을 허용한다. 근거: 개발 도구에만 쓰이고 `dist/`에 들어가지 않으며 우리가 재배포하지 않는다(법률 판단 아님, `docs/licensing/dependency-audit.md`).
- **조건과 안전장치**: `apps/web/scripts/check-dist.mjs`가 `dist/`의 모든 파일 이름과 내용에서 `libvips`, `GNU Lesser General Public`, `LGPL-`, `LGPL `을 찾고 있으면 빌드를 실패시킨다. `scripts/build.mjs` 끝에서 호출하므로 로컬·GitHub Actions·Cloudflare 빌드 모두에서 돈다. `npm run check:dist`로 단독 실행도 된다. 소문자 `lgpl`은 검사하지 않는다: WASM 안의 무관한 표에 우연히 나오기 때문이다(실측: 현재 WASM에 소문자 `lgpl` 1건, 나머지 표지 0건).
- **시험**: 현재 `dist/` 통과, `libvips` 문자열과 `sharp` 이름을 심은 임시 dist는 실패(종료 코드 1)를 확인했다.
- **한계**: 정확한 문자열과 파일 이름만 본다. 다른 표기(예: 라이선스 식별자를 약어로만 적은 경우)는 못 잡는다. 새 LGPL 의존성이 생기면 `dependency-audit.md`를 갱신한다.

### D-029 Cloudflare: 비프로덕션 브랜치 빌드 끔 (2026-10-19, 오너 조치)
- **현상**: PR #1 머지 빌드(11분 49초, 성공)가 활성 배포가 됐고, 그 뒤 PR #2·#3 머지 빌드와 재시도가 모두 `Queued`에서 멈춰 오너가 취소했다. 오너가 **Builds for non-production branches를 끄자** PR #3 빌드가 진행됐다.
- **원인은 확정하지 못했다**(가설은 `docs/deploy-cloudflare.md` 6절). 이 환경에서 Cloudflare 상태를 볼 수 없다.
- **결정**: 비프로덕션 빌드는 끈 채로 운영한다. 검증은 GitHub Actions(수동 실행)가, 배포는 `main`만 한다. 이전 문서의 Preview command(`wrangler versions upload`)는 쓰이지 않는다.

## 2026-10-19 · 3단계 (DOCX 뷰어)

### D-030 DOCX 엔진 평가 결과와 선택지 — 오너 결정 대기
- **무엇**: BetterOffice(Apache-2.0, 쪽 조판·`DisplayList`)와 office_oxide(MIT OR Apache-2.0, 텍스트·IR·HTML, 조판 없음)를 소스 읽기·wasm32 빌드·`cargo deny`로 비교했다. 상세와 한계: `docs/phase3/engine-evaluation.md`.
- **측정**: brotli q11 — BetterOffice docx-edit 4.69MB(원본 30.1MB), office_oxide 0.77MB(원본 2.8MB). rhwp는 3.13MB. BetterOffice는 Rust 1.97 필요(rhwp 고정 1.93.1에서는 `yrs`가 컴파일 실패).
- **권고**: 단계적(office_oxide 읽기 보기 먼저, 쪽 단위 렌더는 이후 선택). **어느 엔진도 의존성에 추가하지 않았다.** 엔진 선택·라이선스 추가·지연 로딩 용량 예산은 오너 승인 후.
- **미확인**: 실제 DOCX 출력·시간, 한국어 글꼴 정확도.

### D-031 3단계 방향: A(BetterOffice 쪽 단위 렌더) 선택 — 오너 결정(2026-10-19), 스파이크 결과 (`docs/phase3/spike-report.md`)
- **결정(오너)**: "최소한 쪽 단위로는 나뉘어 보여야 완전한 뷰어" → D-030의 A를 선택. 아직 의존성에는 추가하지 않았다(스파이크만).
- **스파이크 결과**: 실제 DOCX가 쪽 단위 그리기 명령으로 나오고 SVG로 그려진다(네이티브 약 75ms, WASM 미측정). 호출 순서와 변환기 확인.
- **발견 5가지(결정 필요)**: 한글 글꼴 필수(없으면 겹쳐 읽을 수 없음), 그리기 방식(SVG img vs Canvas), 배포 빌드 시간(20분 한도 위험 → 방법 A 사실상 필요), Rust 툴체인 2개, wasm-bindgen 버전 2개.
- **다음 오너 결정**: 한글 글꼴 선택·크기, 지연 로딩 용량 예산, 빌드 방식 변경(GitHub Actions로 wasm 빌드·릴리스 후 내려받기, D-026 변경 필요).

### D-032 자체 조판 엔진: office_oxide IR 위에 우리 조판 층 — 오너 결정(2026-10-19)
- **결정(오너)**: "직접 조판엔진 제작". D-031(A: BetterOffice)을 대체한다. office_oxide(MIT OR Apache-2.0, **MIT 선택 가정**)를 `third_party/office_oxide`로 고정(`5d183f4`, 수정 없음)하고 IR만 쓴다. 조판은 `apps/web/src/docx/`에 직접 만든다. 설계: `docs/phase3/layout-engine-design.md`.
- **근거**: 빌드·툴체인·크기 부담이 작고(Rust 1.93.1 공용, wasm brotli 0.77MB, 글꼴 번들 불필요), 한국어 글꼴 재배포 문제를 피한다. 대가는 조판 엔진을 직접 만들고 유지하는 부담과 기기 글꼴 의존이다.
- **검증 방식**: BetterOffice 조판 결과를 정답 기준으로 쪽 수·쪽 경계를 비교한다(Word와의 일치는 측정하지 못한다).
- **라이선스**: office_oxide는 MIT 또는 Apache-2.0. `THIRD_PARTY_LICENSES`·`NOTICE` 갱신은 통합 단계(M5)에서 한다. 미완.
- **한계(알려진)**: IR이 필드를 평문으로 풀어 쪽 번호가 틀린다. 기기 글꼴 의존. 표 행 쪼개기·각주 하단 배치·다단·글 감싸기는 v1 이후.

### D-033 3단계 구현 결과와 지연 로딩 예산 제안 (2026-10-19)
- **구현**: D-032 방향대로 구현했다. `crates/fmt-docx`(office_oxide 래퍼), `apps/web/src/docx/`(조판 엔진), `docx-worker.js`, 형식 판별(`kindOf`), 안내 문구. 상세와 한계: `docs/phase3/report.md`.
- **측정**: BetterOffice 대비 쪽 수 일치 105/111(94.6%), 완전 일치 51/111(45.9%); 변이 14,331개 충돌 0; 300쪽 0.53초; E2E 29/29. 합성 문서 기준이며 Word 일치는 미측정.
- **예산 제안(오너 승인 전)**: 지연 로딩 자산 brotli — WASM ≤700,000B(실측 635,785), JS ≤20,000B(실측 11,907), 합계 ≤720,000B. `tools/measure/budgets-docx.json`, `apps/web/scripts/budget.mjs`가 검사한다. 첫 화면 합계 예산(3,340,000B)은 그대로이며 실측 3,148,838B.
- **빌드 영향**: Cloudflare 빌드에 DOCX WASM 단계가 추가된다(`scripts/cloudflare-build.sh` 5단계). 시간은 클린 환경 시뮬레이션으로 측정(아래 참조).

## 오너 결정/확인 요청 목록 (1단계 종료 시점)

| # | 항목 | 시급도 |
|---|---|---|
| 1 | ~~프로젝트 라이선스 선택 (D-009)~~ — 완료: MIT / Dongwook Kim | 완료 |
| 2 | 한컴 의무 문장 + PRD 8.6절 고지 문안 확정 (D-008) | 2단계 전 |
| 3 | ~~rhwp 포크 생성, 서브모듈 URL 교체~~ — 완료. 남은 것: 기준 브랜치·갱신 주기 (D-001) | 진행 중 |
| 4 | ~~수치 목표(예산) 승인 (D-007, report 4절)~~ — 완료(제안대로) | 완료 |
| 5 | 뷰어 전용 포크 패치 진행 여부 (D-006) | 2단계 중 |
| 6 | `paint` IR 분리 방침 (D-002) | 3단계 전 |
| 7 | 이름·도메인 확인 결과 (D-014) | 배포 전 |
| 8 | Cafe24·행복고딕 폰트 사용 금지 확정 (D-010), 글꼴 메트릭 표 법률 검토 | 배포 전 |
| 9 | Windows 셸 스파이크를 오너 기기에서 실행 (D-013) | 4단계 전 |
| 10 | 변리사/변호사 검토 여부 (PRD 8.7) | 공개 릴리스 전 |
| 11 | `hwpctl`(한컴 호환 레이어) 제외 확정 — 이번에 제품에 포함하지 않음 | 기본값 유지 |
| 12 | 기여 정책(CLA/DCO), 유료화 여부, Cloudflare 계정/토큰 방식, PDF 엔진 | PRD 10절 그대로 |

### 2단계 종료 시점에 추가된 요청
| # | 항목 | 시급도 |
|---|---|---|
| 13 | UI 기준 속도 목표 수정안 승인과 오너 기기 재측정 (D-024, phase2 보고서 5절) | 3단계 전 |
| 14 | Cloudflare 계정·토큰·도메인 결정 → 첫 배포와 7-B 확인 (D-020) | 공개 전 |
| 15 | 엔진 panic(구역 0개 문서의 `getPageInfo`)을 업스트림에 알릴지 (D-018) — 원본에 글을 올리는 일이라 승인 전에는 안 함 | 선택 |
| 16 | ~~CI 첫 수동 실행~~ — 완료(D-026). 남은 일: 푸시/PR 자동 트리거 활성화 시점 | 선택 |
| 17 | `frame-ancestors`(임베드)·100MB 한도 (D-017, D-020) | 공개 전 |
| 18 | ~~Cloudflare 연결과 첫 빌드 시간 확인~~ — 완료: 오너가 연결, 첫 빌드 11분 50초 성공(D-025, `docs/deploy-cloudflare.md` 4절). 남은 일: 공개 URL의 공개 범위와 법률 검토(항목 10) | 공개 전 |
| 19 | ~~wrangler 개발 의존성의 선택적 LGPL 패키지 허용 여부~~ — 완료: 허용 + 배포물 검사(D-028) | 완료 |
| 20 | ~~DOCX 엔진 선택~~ — 완료: A(BetterOffice) 선택(D-031). 남은 결정은 21번 | 완료 |
| 21 | ~~한글 글꼴 선택·빌드 방식 변경·Canvas 전환~~ — D-032로 대체(글꼴 번들 없음, SVG 유지, 빌드는 office_oxide가 작아 현 구조 유지 가능성) | 대체됨 |
| 22 | office_oxide 라이선스 선택(MIT 가정)·고지 갱신, 조판 정확도 목표 승인(쪽 수 일치 ≥90% 가설) (D-032) | 3단계 통합 전 |
| 23 | 지연 로딩 예산 승인(D-033), 조판 정확도 목표·실제 문서 코퍼스 확보 방안, 다음 작업 우선순위(쪽 번호 필드/다단/떠 있는 개체), office_oxide 라이선스 선택 확인 | 3단계 마무리 |
