# 업스트림(rhwp) 패치 기록

PRD 2절 포크 운영 방침: rhwp 수정은 최후의 수단이며, 패치는 전용 브랜치에 모으고 이 폴더에 "무엇을, 왜, 나중에 되돌릴 수 있는지"를 기록한다.

## 현재 상태 (2026-10-21)

**적용된 패치: 1개** (`tools/rhwp-patches/`). 서브모듈 `third_party/rhwp`는 업스트림 `edwardkim/rhwp`의 `main` 커밋 `1a76570e833917d15817415a53c09ad61ab3203f`(v0.8.7)에 그대로 고정되어 있고 **서브모듈 커밋은 수정하지 않는다**. 패치는 빌드 때만 작업 트리에 얹고 끝나면 되돌린다(`scripts/rhwp-patches.sh`, `scripts/build-wasm.sh`가 호출). 그래서 포크(`ddommummi/rhwp`)는 업스트림 추적용 그대로이고, 갱신 때 패치가 맞지 않으면 빌드가 바로 실패해 알 수 있다. Cloudflare 빌드(`scripts/cloudflare-build.sh`)와 CI도 `build-wasm.sh`를 거치므로 자동으로 적용된다. 적용된 패치는 `apps/web/src/wasm/BUILD_INFO.json`의 `rhwpPatches`(이름·sha256)와 화면 아래 "엔진 빌드: rhwp 1a76570+패치1"에 남는다.

| 패치 | 무엇을 | 왜 | 확인 | 되돌리기 |
|---|---|---|---|---|
| `0001-stale-inline-picture-line` | 줄이 하나뿐인 본문 문단에서 글자처럼 취급한 그림이 저장된 줄 높이의 1.25배를 넘으면 줄 높이를 그림에 맞춘다(`document.rs`: 호출 한 줄 + 함수 하나, 추가만) | 그림을 넣은 뒤 줄 정보가 갱신되지 않은 파일에서 그림이 뒤 문단과 겹치고 아래쪽이 가려진다(한글 뷰어는 정상) — D-049 | `rhwp/samples` 한컴 실물 1,205개 중 달라지는 문서는 오너 제공 문서와 `issue5169_viewtext_changetracking.hwp`(겹침이 풀림)뿐. `npm run test:rhwp-patches` | 패치 파일 삭제 |

### 업스트림을 갱신할 때 (패치가 있을 때)
1. 서브모듈 포인터를 새 커밋으로 올린다(아래 포크 운영 절차).
2. `scripts/rhwp-patches.sh status` — `conflict`가 나오면 패치를 새 코드에 맞게 다시 만든다. 호출 한 줄은 줄 정보를 보정하는 단계(`reflow_zero_height_paragraphs` 호출) 앞에 둔다. 컴파일 오류는 `LineSeg` 필드, `TAG_IMPLEMENTATION_PROPERTY`, `Picture.common.treat_as_char`/`height` 이름 변경을 확인한다.
3. **업스트림이 같은 문제를 고쳤는지 먼저 본다** — 패치 없이(`RHWP_PATCHES=0 scripts/build-wasm.sh`) 오너 문서와 `issue5169` 3쪽이 이미 정상이면 패치를 버린다. 둘 다 적용되면 조용히 중복될 수 있다(컴파일로 잡히지 않는다).
4. `rhwp/samples` 전체를 패치 전후 `rhwp dump-pages`로 비교해 달라지는 문서가 이번 2개뿐인지 확인한다(방법: `tools/rhwp-patches/README.md`).

### 포크 운영 절차
```sh
# 서브모듈 안에서 (리모트 설정은 로컬 .git/config라 커밋되지 않으므로 클론마다 한 번)
git -C third_party/rhwp remote add upstream https://github.com/edwardkim/rhwp
git -C third_party/rhwp remote set-url --push upstream DISABLED   # 업스트림으로의 실수 push 방지
```
- 패치는 포크 브랜치가 아니라 이 저장소의 `tools/rhwp-patches/*.patch`로 둔다(2026-10-21 오너 결정). 서브모듈 포인터는 업스트림 커밋을 가리킨다.
- 업스트림 갱신: `git fetch upstream main` → 서브모듈 포인터 갱신 → 루트 `Cargo.lock`을 rhwp 락으로 다시 시드(`docs/decisions.md` D-003) → 회귀 테스트(`tools/measure`) → `docs/patches/` 갱신.
- 포크의 `main`에는 패치를 넣지 않는다(업스트림 추적용으로 유지).

## 패치 후보 (미착수, 오너 승인 필요)

| 후보 | 목적 | 근거 | 되돌리기 |
|---|---|---|---|
| 뷰어 전용 기능 플래그 | `document_core::commands`, `serializer`, `hwpjson`, `zopfli` 등을 컴파일에서 제외 | `docs/phase1/report.md` 1절: 편집 코드 약 12% + 이미지 디코더 약 5% (추정). 래퍼만으로는 줄지 않음(얇은 셸이 오히려 큼) | 플래그 기본값을 켜 두면 업스트림 동작과 동일 |
| 점진적 조판(첫 쪽 먼저) | 열기 시간에서 전체 쪽 나눔 분리 | 763쪽 문서 열기 3.4~5.0초 | 새 API 추가 형태로 하면 기존 API 불변 |
| 큰 표 문서 성능 | 병리 사례 195초(브라우저)/419초(네이티브) | `issue2063_huge_cellbreak_table.hwp` | 업스트림 변경을 가져오는 쪽을 먼저 확인 |

패치가 늘수록 갱신 비용이 커지므로, 가능한 한 `fmt-hwp` 어댑터와 우리 쪽 코드에서 해결하는 것을 우선한다.

## 복사해 온 업스트림 파일

`licenses/` 아래 파일은 업스트림 파일의 **무수정 사본**이다(원본과 `cmp`로 일치 확인).

| 우리 파일 | 업스트림 원본 |
|---|---|
| `licenses/rhwp-LICENSE-MIT.txt` | `third_party/rhwp/LICENSE` |
| `licenses/svg2pdf-LICENSE-MIT.txt`, `-APACHE.txt`, `svg2pdf-NOTICE.txt` | `third_party/rhwp/vendor/svg2pdf/LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE` |
| `licenses/SourceHanSerifK-OFL.txt` | `third_party/rhwp/assets/fonts/SourceHanSerifK-OFL.txt` |
