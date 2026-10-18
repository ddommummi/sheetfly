# Sheetfly

문서 한 장을 가볍게 연다. (프로젝트 이름은 **가결정**이며, 이름 확정 전 확인 항목은 `docs/decisions.md`에서 추적한다.)

광고·추적 없이, 문서가 기기 밖으로 나가지 않는 초경량 오픈소스 문서 도구를 목표로 한다. 웹 → Windows → 모바일 순으로 같은 Rust 코어를 재사용해 확장하고, 뷰어에서 시작해 편집·다른 오피스 포맷·PDF 편집까지 점진적으로 넓힌다.

## 상태

**1단계 (저장소 구성·측정·감사) 완료, 2단계 준비 중.** 아직 사용할 수 있는 제품이 없다.
수치 목표는 모두 가설이며, 실측값은 [`docs/phase1/report.md`](docs/phase1/report.md)와 [`docs/decisions.md`](docs/decisions.md)에 있다.

## 저장소 구성

| 경로 | 내용 |
|---|---|
| `third_party/rhwp/` | HWP/HWPX 엔진. 고정 커밋 서브모듈 (아래 Acknowledgements) |
| `tools/measure/` | 1단계 측정 하네스 (헤드리스 Chromium에서 WASM 열기·렌더 시간 측정) |
| `docs/` | 결정 기록, 라이선스·상표 조사, 측정 보고서 |
| `licenses/` | 업스트림 라이선스 원문 사본 (수정 없음) |
| `NOTICE` | 출처·저작권 고지 |

서브모듈을 받으려면: `git clone --recurse-submodules <repo>` (업스트림 작업 트리가 약 5GB이므로 `git clone --recurse-submodules --shallow-submodules`를 권장).

## 라이선스

Sheetfly 자체 코드는 **MIT License**이다 ([`LICENSE`](LICENSE), Copyright (c) 2026 ddommummi). 서브모듈과 의존성은 각자의 라이선스를 따르며, [`NOTICE`](NOTICE), [`THIRD_PARTY_LICENSES`](THIRD_PARTY_LICENSES), [`licenses/`](licenses/)에 수록한다. 소스 파일마다 라이선스 헤더를 붙이지는 않는다(루트 `LICENSE`가 적용됨).

## Acknowledgements

본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

- HWP/HWPX 처리는 [rhwp](https://github.com/edwardkim/rhwp) (Copyright (c) 2025-2026 Edward Kim, MIT License)를 고정 버전 의존성으로 사용한다. 원 저작권 문구는 `licenses/rhwp-LICENSE-MIT.txt`에 원문 그대로 있다.
- 업스트림 하위 코드(예: `vendor/svg2pdf`)의 라이선스도 `licenses/`와 `NOTICE`에 수록한다.

## 비제휴 고지

"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 상표입니다.
본 프로젝트는 한글과컴퓨터와 제휴, 후원, 승인 관계가 없는 독립적인 오픈소스 프로젝트입니다.

This project is independent and is not affiliated with, sponsored by, or endorsed by Hancom Inc. "Hangul", "Hancom", "HWP" and "HWPX" are trademarks of Hancom Inc.
