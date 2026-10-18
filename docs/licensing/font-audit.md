# rhwp 번들 폰트 라이선스 감사 (2026-10-18, rhwp `1a76570`)

> 법률 자문이 아니다. 폰트 파일 내부 `name` 테이블(저작권 ID 0, 라이선스 설명 ID 13, 라이선스 URL ID 14)을 `tools/measure/font_name_audit.py`로 읽은 결과와 업스트림 `assets/fonts/FONTS.md`의 주장을 대조했다. 원자료는 [`font-name-table.tsv`](font-name-table.tsv).

## 결론 (먼저)

1. **Sheetfly는 현 단계에서 rhwp의 번들 폰트를 하나도 재배포하지 않는다.** 서브모듈 안에 파일이 있을 뿐이고, 우리 빌드 산출물(웹, 설치 파일)에는 넣지 않는다. 폰트를 쓰려면 아래 "사용 전 확인" 절차를 거쳐 개별 승인한다.
2. **PRD 8.4절의 "한컴 번들 폰트 사용 금지"는 지켜진다.** 한컴·Microsoft 폰트는 업스트림 Git에도 없다(`FONTS.md`가 "Git 미포함"이라고 밝히며, `git ls-files`에서 폰트 확장자(`ttf/otf/woff/woff2/ttc`) 파일은 `assets/fonts/`, `ttfs/`, `tests/fixtures/fonts/` 밖에 없고 그 안에도 한컴·MS 폰트명은 없었다). 한계: 확장자 기준 검색이므로 PDF·HWP 샘플 문서에 내장된 폰트나 소스에 바이트 배열로 박힌 폰트는 확인하지 못했다.
3. 업스트림의 폰트 라이선스 표기에는 **파일 내부 표기와 어긋나거나 검증되지 않은 항목**이 있다. 아래 표 참조.

## 범위

| 위치 | 파일 수 | 비고 |
|---|---|---|
| `assets/fonts/` | WOFF2 36개 (22.65MB) + `SourceHanSerifK-OFL.txt` | 웹 배포용 |
| `ttfs/opensource/`, `ttfs/redistributable/` | TTF/OTF 4개 | 메트릭 생성·재현용 원본 |
| `tests/fixtures/fonts/` | 7개 (`RHWP*Smoke*`, `RHWPHostFixture*`) | 테스트 전용 합성 폰트. 우리 산출물에 넣지 않는다 |

## 계열별 판정

| 폰트 | 업스트림 FONTS.md 주장 | 파일 내부 표기 | 판정 |
|---|---|---|---|
| Pretendard (9종) | OFL 1.1 | © 2023 Kil Hyung-jin, OFL 1.1 문구 + URL | **확인됨.** OFL 전문 사본은 동봉해야 함 |
| Spoqa Han Sans | OFL 1.1 | © 2015 Spoqa, OFL 1.1 문구 | **확인됨** |
| D2Coding (2종) | OFL 1.1 | © NHN, OFL 1.1 문구 | **확인됨** |
| Gowun Batang / Dodum | OFL 1.1 | © Gowun Project Authors, OFL URL | 라이선스 URL만 있음 (사실상 확인) |
| Nanum Gothic / Myeongjo / Gothic Coding | OFL 1.1 (Google Fonts) | © NHN, 라이선스 문구 **없음** (Gothic Coding은 URL만) | **미검증** — 출처(Google Fonts) 원본의 OFL을 별도 확인해야 함 |
| Noto Sans KR (3종) | OFL 1.1 | © 2014-2021 Adobe, **Reserved Font Name 'Source'**, 라이선스 문구는 일부 파일에만 | **주의** — RFN 아래 |
| Noto Serif KR (2종) | OFL 1.1 | © 2017-2024 Adobe, URL | 라이선스 URL만 있음 |
| Source Han Serif K Old Hangul subset | OFL 1.1 (+`SourceHanSerifK-OFL.txt`) | © 2017-2024 Adobe, **RFN 'Source'** | **주의** — RFN 아래 |
| Latin Modern Math | GUST Font License | © B. Jackowski 외 (GUST) | **PRD 허용 목록 밖** (폰트는 OFL-1.1만 허용). 오너 판단 필요 |
| **Cafe24 써라운드 / 슈퍼매직** | "카페24 무료 배포" | © Cafe24 Corp. **All Rights Reserved**, 라이선스 문구 없음, URL `fonts.cafe24.com` | **미검증.** 재배포 조건을 확인하지 못함 → **사용 금지 권고** |
| **행복고딕 (Happiness Sans, 4종)** | "행복나눔재단 무료 배포" | © 2022 **THE HYUNDAI**, All rights reserved, 라이선스 문구·URL 없음 | **불일치·미검증.** 저작권자가 FONTS.md의 출처 설명과 다름 → **사용 금지 권고** |

### Reserved Font Name 주의 (Noto Sans KR, Source Han Serif K subset)

- 두 계열 파일 모두 저작권 줄에 `Reserved Font Name 'Source'`가 남아 있다.
- OFL 1.1은 RFN이 지정된 폰트를 **수정(서브셋·인스턴스 생성 포함)한 버전**에 그 이름을 쓰지 못하게 한다. 업스트림은 Noto Sans KR를 가변 폰트에서 `wght=400` 인스턴스로 만들고 글리프를 추가했으며(`FONTS.md`), Source Han Serif는 옛한글 서브셋이다.
- 파일명·내부 패밀리명이 RFN을 어기는지, 허락을 받았는지는 **미확인**이다. (PRD 8.4절이 "서브셋 시 이름 규정 확인"을 요구한 바로 그 사안.) 우리가 서브셋을 직접 만들 때는 RFN이 없는 원본(예: Noto 계열 공식 배포본)을 받아 이름을 바꿔 쓰는 방식을 기본으로 한다.

### 라이선스 사본 부재

`assets/fonts/`에는 OFL 전문 사본이 `SourceHanSerifK-OFL.txt` 하나뿐이다. OFL은 폰트와 함께 라이선스 사본을 배포하도록 요구하므로, 폰트를 쓰게 되면 각 폰트의 원 저작권 줄 + OFL 전문을 `THIRD_PARTY_LICENSES`와 `/licenses`에 수록해야 한다.

## 글꼴 메트릭 표 (법률 검토 항목)

- `src/renderer/font_metrics_generated.rs`(2.2MB 소스)가 WASM `.rodata`의 큰 부분(전체의 13.8%인 1.9MB 중 상당 부분)을 이룬다고 보이나, 표별 기여도는 측정하지 못했다.
- 업스트림 `ttfs/FONTS.md`는 이 표를 한컴 오피스·시스템 폰트에서 **추출한 글자 폭·높이 수치**라 하고, "사실의 나열은 저작물이 아니다"라는 입장이다. 이는 업스트림의 법적 견해이며 **우리가 검증한 것이 아니다.** 변호사 검토 항목에 포함한다. 한컴/MS 폰트 파일 자체는 저장소에 없다.

## 사용 전 확인 절차 (폰트를 쓰게 될 때)

1. 폰트 원 배포처에서 원본과 라이선스 파일을 받는다 (업스트림 사본이 아니라).
2. 원 저작권 줄, RFN 여부, 라이선스 전문을 `THIRD_PARTY_LICENSES`에 수록한다.
3. 서브셋/변환 시 RFN 규정을 확인하고 이름을 바꾼다.
4. 결정을 `docs/decisions.md`에 기록하고 오너가 승인한다.
