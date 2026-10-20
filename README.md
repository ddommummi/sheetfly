# Sheetfly

문서 한 장을 가볍게 연다. (프로젝트 이름은 **가결정**이며, 이름 확정 전 확인 항목은 `docs/decisions.md`에서 추적한다.)

광고·추적 없이, 문서가 기기 밖으로 나가지 않는 초경량 오픈소스 문서 도구를 목표로 한다. 웹 → Windows → 모바일 순으로 같은 Rust 코어를 재사용해 확장하고, 뷰어에서 시작해 편집·다른 오피스 포맷·PDF 편집까지 점진적으로 넓힌다.

## 상태

**1단계(저장소 구성·측정·감사) 완료, 2단계(웹 뷰어 MVP: HWP/HWPX 읽기 전용) 구현·검증 완료, 3단계(DOCX 뷰어) 진행 중: DOCX·RTF·DOC·XLSX·XLS·PPTX·PPT 열기·쪽 단위 보기 구현(자체 조판 엔진, 정확도·한계는 `docs/phase3/report.md`, RTF·DOC는 `docs/decisions.md` D-035, XLSX·PPTX는 D-038).** 아직 공개 배포는 하지 않았다. **4단계(편집, 웹) 중 4-1(HWP/HWPX 편집: 글·서식·표·그림·도형·수식·쪽 설정·머리글·각주·링크·찾아 바꾸기·새 문서·다른 이름으로 저장 등 rhwp 편집 API 대부분)을 구현했다(`docs/phase4/report.md`, D-042·D-044).** 다음은 4-2(DOCX) 설계서 → … → Windows 앱 → 모바일 → PDF 순이다(`docs/roadmap.md`, D-040).
측정값과 결정은 [`docs/phase1/report.md`](docs/phase1/report.md), [`docs/phase2/report.md`](docs/phase2/report.md), [`docs/decisions.md`](docs/decisions.md)에 있다.

## 저장소 구성

| 경로 | 내용 |
|---|---|
| `third_party/rhwp/` | HWP/HWPX 엔진. 고정 커밋 서브모듈 (아래 Acknowledgements) |
| `third_party/office_oxide/` | DOCX·DOC 읽기(IR). 포크(`ddommummi/office_oxide`)의 고정 커밋 서브모듈, 수정 없음 |
| `crates/fmt-docx/` | office_oxide 어댑터(WASM): IR + 제목 스타일 보완 |
| `apps/web/` | 웹 뷰어 (바닐라 JS, Worker + WASM). 배포 설정(`wrangler.jsonc`, `public/_headers`) 포함 |
| `scripts/` | WASM 빌드 스크립트 (`build-wasm.sh`) |
| `tools/measure/` | 측정 하네스·용량 예산 검사 (헤드리스 Chromium에서 WASM 열기·렌더 시간 측정) |
| `spikes/` | 1단계 스파이크 (rhwp를 의존성으로 쓰는 네이티브/WASM 예제) |
| `licensing/` | 서드파티 라이선스 생성·정책 (`cargo-about`, `cargo-deny`) |
| `docs/` | 결정 기록, 라이선스·상표 조사, 측정 보고서 |
| `licenses/` | 업스트림 라이선스 원문 사본 (수정 없음) |
| `NOTICE` | 출처·저작권 고지 |

서브모듈을 받으려면: `git clone --recurse-submodules <repo>` (업스트림 작업 트리가 약 5GB이므로 `git clone --recurse-submodules --shallow-submodules`를 권장).

## 웹 앱 실행

```sh
git clone --recurse-submodules --shallow-submodules <repo>
cd sheetfly/apps/web && npm ci
npm run build:wasm   # rhwp를 WASM으로 빌드한다 (약 15분). 필요: rustup, wasm-bindgen-cli 0.2.127
npm run dev          # 빌드 후 http://127.0.0.1:8787 (배포와 같은 _headers/CSP 적용)
npm run test:e2e     # Chromium E2E (먼저 npm run build)
npm run test:corpus  # 샘플 코퍼스 크래시 시험
npm run budget       # 용량 예산 검사
```

문서는 브라우저 안(Web Worker + WASM)에서만 처리되고 서버로 전송되지 않는다. 배포는 Cloudflare Workers Static Assets(assets-only)를 쓰며 설정은 `apps/web/wrangler.jsonc`에 있다. GitHub 연동 배포 절차는 [`docs/deploy-cloudflare.md`](docs/deploy-cloudflare.md).

## 라이선스

Sheetfly 자체 코드는 **MIT License**이다 ([`LICENSE`](LICENSE), Copyright (c) 2026 Dongwook Kim). 서브모듈과 의존성은 각자의 라이선스를 따르며, [`NOTICE`](NOTICE), [`THIRD_PARTY_LICENSES`](THIRD_PARTY_LICENSES), [`licenses/`](licenses/)에 수록한다. 소스 파일마다 라이선스 헤더를 붙이지는 않는다(루트 `LICENSE`가 적용됨).

## Acknowledgements

본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

- DOCX·DOC·XLSX·XLS·PPTX·PPT 읽기는 [office_oxide](https://github.com/yfedoseev/office_oxide) (Copyright (c) 2026 Yury Fedoseev, MIT OR Apache-2.0 중 MIT로 사용)를 수정 없이 쓴다. "OfficeOxide"는 해당 저자의 상표이며 본 프로젝트와 제휴 관계가 없다. 쪽 나눔은 Sheetfly가 직접 하며, RTF는 Sheetfly가 직접 만든 변환기(`apps/web/src/docx/rtf.js`)로 읽는다.
- HWP/HWPX 처리는 [rhwp](https://github.com/edwardkim/rhwp) (Copyright (c) 2025-2026 Edward Kim, MIT License)를 고정 버전 의존성으로 사용한다. 원 저작권 문구는 `licenses/rhwp-LICENSE-MIT.txt`에 원문 그대로 있다.
- 업스트림 하위 코드(예: `vendor/svg2pdf`)의 라이선스도 `licenses/`와 `NOTICE`에 수록한다.

## 비제휴 고지

"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 상표입니다.
본 프로젝트는 한글과컴퓨터와 제휴, 후원, 승인 관계가 없는 독립적인 오픈소스 프로젝트입니다.

This project is independent and is not affiliated with, sponsored by, or endorsed by Hancom Inc. "Hangul", "Hancom", "HWP" and "HWPX" are trademarks of Hancom Inc.
