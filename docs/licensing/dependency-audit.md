# 의존성 라이선스·보안 감사 (2026-10-18, rhwp `1a76570` / v0.8.7)

> 법률 자문이 아니다. 대상은 `third_party/rhwp/Cargo.lock`의 Rust 크레이트 그래프(기본 피처)다. 도구: `cargo-deny 0.20.2`, `cargo-about 0.9.2`, Rust 1.93.1(rhwp가 고정한 툴체인). 재현 명령은 맨 아래.

## 요약

| 검사 | 결과 |
|---|---|
| 라이선스 (`cargo deny check licenses`, `licensing/deny.toml`) | **통과** — 크레이트 203개, 금지 라이선스(GPL/AGPL/SSPL/불명) 0건 |
| 출처 (`sources`) | **통과** — crates.io 외 레지스트리·git 의존성 없음 |
| bans | 통과 (정책 조정 1건, 아래) |
| 보안 권고 (`advisories`) | **실패 6건 + yank 1건** — 아래 상세. 도달 가능성은 낮으나 업스트림 갱신 필요 |

## 라이선스 분포 (203개)

MIT OR Apache-2.0 계열이 대부분(약 140개)이고 MIT 단독 27개, BSD-3-Clause 계열 약 9개, Zlib 계열 약 12개이다. 표현식에 비허용 항목이 섞인 것은 모두 **허용 항목을 선택할 수 있는 OR 표현식**이다.

| 크레이트 | 표현식 | 선택 |
|---|---|---|
| `r-efi 6.0.0` | MIT OR Apache-2.0 OR **LGPL-2.1-or-later** | MIT 선택. `cargo tree -i r-efi@5.3.0|6.0.0 --target {wasm32-unknown-unknown, x86_64-pc-windows-msvc, x86_64-unknown-linux-gnu}`가 모두 "nothing to print" → 이 세 타깃의 빌드에는 들어오지 않음 (Android·iOS는 미확인) |
| `pcx 0.2.5` | MIT OR Apache-2.0 OR **WTFPL** | MIT 선택 |
| `fiat-crypto`, `byteorder`, `memchr`, `ryu`, `blake3` 등 | Unlicense·CC0·BSL-1.0·BSD-1-Clause 대안 포함 | permissive 대안 존재 |

`cargo about`이 크레이트별로 하나씩 고른 최종 분포(생성물 `THIRD_PARTY_LICENSES` 요약): MIT 192, BSD-3-Clause 7, Apache-2.0 6, Zlib 2, BSD-2-Clause 1, Unicode-3.0 1.

## 보안 권고 상세

| ID | 대상 | 내용 | 도달 가능성 (우리 사용 방식) |
|---|---|---|---|
| RUSTSEC-2026-0368, -0369 | `zip 8.6.0` | `ZipArchive::extract()`/`ZipStreamReader::extract()`가 심볼릭 링크로 목적지 밖을 쓸 수 있음 | rhwp 소스·크레이트에 `.extract(` 호출 **0건**(grep). 메모리에서 항목을 읽을 뿐 디스크에 풀지 않는 것으로 보임 → 도달 불가로 판단하나 **코드 전수 검증은 안 함** |
| RUSTSEC-2026-0367 | `zip 8.6.0` | `extract()`가 SUID/SGID 비트 보존 | 위와 동일 |
| RUSTSEC-2026-0206 | `rustybuzz` | **유지보수 중단** 선언 | 조판(셰이핑)의 핵심 의존성. 수정이 영영 안 나옴 → 중장기 리스크 |
| RUSTSEC-2026-0192 | `ttf-parser` | **유지보수 중단** 선언 | 폰트 파싱 핵심. 신뢰할 수 없는 폰트 입력 경로가 있는지는 **미확인** |
| RUSTSEC-2024-0436 | `paste` | 유지보수 중단 | 매크로. 런타임 위험 낮음 |
| (yanked) | `chacha20 0.10.1` | yank된 버전 | rhwp의 서명·봉인 기능 경로(`chacha20poly1305`). 뷰어에는 불필요 |

- `zip 9.0.0` 이상에서 수정된다고 권고문에 적혀 있다. rhwp는 8.x를 쓰고 있으므로 **업스트림이 올리거나, 우리 `fmt-hwp` 어댑터/컨테이너 계층이 자체 `container/` 크레이트로 대체**하는 방안을 2단계 전에 결정한다.
- 이 6건은 **서브모듈을 고친다고 해결되는 일이 아니다** (PRD 2절: 포크 패치 최후의 수단). 대응은 (a) 업스트림 갱신 대기, (b) 우리 쪽에서 해당 코드 경로를 쓰지 않음, (c) 필요 시 포크 패치 순으로 한다.

## 정책 조정 기록

- `[bans] wildcards`를 `allow`로 했다. 업스트림 `Cargo.toml`이 워크스페이스 내부 크레이트를 버전 없는 path 의존성으로 선언해 deny가 오류를 낸다. 업스트림 파일은 수정하지 않는다. 우리 자체 크레이트에는 별도로 `deny`를 적용한다.

## 범위 밖 / 미수행

- **npm 의존성 미감사.** rhwp의 `rhwp-studio`, `rhwp-chrome` 등은 우리가 쓰지 않으므로 이번에 감사하지 않았다. 우리 프런트(2단계)의 npm 의존성은 그때 `license-checker`로 감사한다.
- 선택 피처(`native-skia`, `gpu`)와 비기본 워크스페이스 멤버(`bindings/Native`, `tools/*`)는 제외했다. 뷰어 전용 최소 빌드에서 쓰지 않을 예정이다.
- **업스트림 `THIRD_PARTY_LICENSES.md`는 현행이 아니다.** 예: `cfb` 0.14(문서) ↔ 0.15(Cargo.toml), `quick-xml` 0.41 ↔ 0.42, `wasm-bindgen` 0.2.125 ↔ 0.2.127(Cargo.lock). 우리는 그 문서를 신뢰하지 않고 `Cargo.lock`에서 직접 생성한다.
- `ed25519-dalek`: 업스트림 문서는 2.2.0 BSD-3-Clause, Cargo.toml은 `"3"`. 생성물 기준으로 확인한다.
- 업스트림이 "직접 포팅한 알고리즘"으로 Volexity `hwp-extract`(BSD-3-Clause)와 한컴 `hwpx-owpml-model`·`dvc`(Apache-2.0)를 **참조**했다고 밝힌다. 포팅분의 고지는 업스트림 `THIRD_PARTY_LICENSES.md`에 있다. **우리 `THIRD_PARTY_LICENSES`에는 아직 이 항목이 없다** → 서브모듈 파일을 그대로 쓰는 이상 그 고지도 수록해야 하는지 오너/변호사가 판단해야 하며, 안전하게는 해당 절을 부록으로 옮겨 싣는 것이 낫다. (할 일)

## 재현

```sh
export RUSTUP_TOOLCHAIN=1.93.1
cargo deny --locked --manifest-path third_party/rhwp/Cargo.toml --config licensing/deny.toml check
licensing/build-third-party.sh > THIRD_PARTY_LICENSES
```
