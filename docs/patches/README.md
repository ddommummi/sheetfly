# 업스트림(rhwp) 패치 기록

PRD 2절 포크 운영 방침: rhwp 수정은 최후의 수단이며, 패치는 전용 브랜치에 모으고 이 폴더에 "무엇을, 왜, 나중에 되돌릴 수 있는지"를 기록한다.

## 현재 상태 (2026-10-18)

**적용된 패치: 없음.** 서브모듈 `third_party/rhwp`는 업스트림 `edwardkim/rhwp`의 `main` 커밋 `1a76570e833917d15817415a53c09ad61ab3203f`(v0.8.7)에 그대로 고정되어 있고 작업 트리에 수정이 없다(`git -C third_party/rhwp status`가 깨끗함).

서브모듈 URL은 **오너 포크 `https://github.com/ddommummi/rhwp`**를 가리킨다(2026-10-18 연결, 포크 `main` = 고정 커밋 `1a76570`, `git ls-remote`로 확인). 업스트림 `edwardkim/rhwp`는 `upstream` 리모트로 **변경을 가져오는 용도로만** 쓴다. 업스트림에 대한 이슈/PR/코멘트는 오너 승인 후에만 한다.

### 포크 운영 절차
```sh
# 서브모듈 안에서 (리모트 설정은 로컬 .git/config라 커밋되지 않으므로 클론마다 한 번)
git -C third_party/rhwp remote add upstream https://github.com/edwardkim/rhwp
git -C third_party/rhwp remote set-url --push upstream DISABLED   # 업스트림으로의 실수 push 방지
```
- 패치 브랜치: 포크의 `sheetfly/patches`(패치 착수 시 생성). 서브모듈 포인터는 그 브랜치의 커밋을 가리킨다.
- 업스트림 갱신: `git fetch upstream main` → 패치 브랜치를 그 위로 리베이스 → 서브모듈 포인터 갱신 → 루트 `Cargo.lock`을 rhwp 락으로 다시 시드(`docs/decisions.md` D-003) → 회귀 테스트(`tools/measure`) → `docs/patches/` 갱신.
- 포크의 `main`에는 직접 패치를 넣지 않는다(업스트림 추적용으로 유지).

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
