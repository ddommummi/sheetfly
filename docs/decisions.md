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

## 오너 결정/확인 요청 목록 (1단계 종료 시점)

| # | 항목 | 시급도 |
|---|---|---|
| 1 | ~~프로젝트 라이선스 선택 (D-009)~~ — 완료: MIT / Dongwook Kim | 완료 |
| 2 | 한컴 의무 문장 + PRD 8.6절 고지 문안 확정 (D-008) | 2단계 전 |
| 3 | ~~rhwp 포크 생성, 서브모듈 URL 교체~~ — 완료. 남은 것: 기준 브랜치·갱신 주기 (D-001) | 2단계 전 |
| 4 | ~~수치 목표(예산) 승인 (D-007, report 4절)~~ — 완료(제안대로) | 완료 |
| 5 | 뷰어 전용 포크 패치 진행 여부 (D-006) | 2단계 중 |
| 6 | `paint` IR 분리 방침 (D-002) | 3단계 전 |
| 7 | 이름·도메인 확인 결과 (D-014) | 배포 전 |
| 8 | Cafe24·행복고딕 폰트 사용 금지 확정 (D-010), 글꼴 메트릭 표 법률 검토 | 배포 전 |
| 9 | Windows 셸 스파이크를 오너 기기에서 실행 (D-013) | 4단계 전 |
| 10 | 변리사/변호사 검토 여부 (PRD 8.7) | 공개 릴리스 전 |
| 11 | `hwpctl`(한컴 호환 레이어) 제외 확정 — 이번에 제품에 포함하지 않음 | 기본값 유지 |
| 12 | 기여 정책(CLA/DCO), 유료화 여부, Cloudflare 계정/토큰 방식, PDF 엔진 | PRD 10절 그대로 |
