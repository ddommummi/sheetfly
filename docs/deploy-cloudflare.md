# Cloudflare Workers 배포 (GitHub 연동)

대시보드에서 GitHub 저장소를 연결하면 `main`(감시 브랜치)에 푸시할 때마다 Cloudflare가 빌드하고 배포한다(Workers Builds).
설정 항목 이름과 한도는 Cloudflare 공식 문서(2026-10-18 확인)를 따랐고, **대시보드 화면 문구는 버전에 따라 다를 수 있다.**

> **배포하면 공개 URL이 생긴다.** PRD 8.7절: 공개 릴리스(웹 배포) 전에 변리사/변호사 검토 여부를 오너가 정한다. 이름·도메인 확인(D-014)도 끝나지 않았다.

## 0. 먼저 알아야 할 것

| 사실 | 영향 |
|---|---|
| 빌드 제한 시간 **20분**, 무료 플랜 2 vCPU / 8GB, 월 3,000분 | WASM 빌드(Rust)가 길다 → 아래 시간 측정 참조 |
| Rust 캐시 없음(캐시 대상은 npm 등 패키지 매니저·프레임워크 디렉터리, `~/.cargo`·`target`은 아님) | 매 빌드가 처음부터 컴파일 |
| Rust 포함 여부·git 서브모듈 지원은 문서에 명시되지 않음 | `scripts/cloudflare-build.sh`가 둘 다 직접 해결 |
| Workers Builds는 `package.json`의 wrangler 버전을 사용 | `apps/web/package.json`에 wrangler 4.151.1을 고정해 둠 |
| Worker 이름은 wrangler 설정의 `name`과 같아야 함 | `apps/web/wrangler.jsonc`의 `sheetfly`와 같게 만든다 |
| 저장소에 `main` 브랜치가 아직 없음 (작업 브랜치 `ccr-b1a46db5-5guuml`만 있음) | 아래 1번 |

## 1. 감시할 브랜치 만들기
현재 원격에는 작업 브랜치뿐이다. 둘 중 하나를 고른다.
- **권장**: GitHub에서 작업 브랜치를 `main`으로 합친다(PR → Merge). `main`이 없으면 저장소 Settings에서 기본 브랜치를 만들거나, 작업 브랜치에서 PR을 열어 `main`을 새로 만든다.
- 임시: Cloudflare의 Git branch를 `ccr-b1a46db5-5guuml`로 지정한다. 브랜치 이름이 길고 바뀔 수 있어 권하지 않는다.

## 2. Cloudflare에서 연결
1. Cloudflare 대시보드 → **Workers & Pages** → **Create application** → Git 공급자 **GitHub** 선택 → 인증 → 저장소 `ddommummi/sheetfly` 선택.
   (처음이면 GitHub에서 "Cloudflare" 앱을 설치하고 이 저장소 접근을 허용하라는 화면이 나온다.)
2. 아래 값으로 설정한다 (**Settings → Build**에서도 바꿀 수 있다).

| 설정 | 값 |
|---|---|
| Git repository | `ddommummi/sheetfly` |
| Git branch | `main` |
| **Root directory** | `apps/web` |
| **Build command** | `bash ../../scripts/cloudflare-build.sh` |
| **Deploy command** | `npx wrangler deploy` (기본값 그대로) |
| Preview command (main이 아닌 브랜치) | `npx wrangler versions upload` (정적 자산만 올리는 이 프로젝트에는 기본 `npx wrangler preview`보다 안전하다. **미검증**) |
| Build variables and secrets | `NODE_VERSION` = `22` (시험한 Node 버전. 선택) |
| Build cache | 켠다 (npm 캐시만 해당) |

   Worker 이름은 **`sheetfly`**여야 한다(`apps/web/wrangler.jsonc`의 `name`과 다르면 빌드가 실패한다).
3. **Save and Deploy**. 이후 `main`에 푸시할 때마다 자동으로 빌드·배포된다.

## 3. 빌드가 하는 일 (`scripts/cloudflare-build.sh`)
1. `scripts/fetch-rhwp.sh`: 서브모듈(3GB+) 대신 빌드에 필요한 파일만 희소 체크아웃(약 105MB, 수 초). 서브모듈이 이미 채워져 있으면 건너뛴다.
2. rustup 설치 → Rust 1.93.1(+wasm32) 설치.
3. `wasm-bindgen` 0.2.127 사전 빌드본 내려받기(`cargo install` 5분 절약). 실패하면 `cargo install`로 대체.
4. `npm ci`
5. `scripts/build-wasm.sh` (기본 `WASM_OPT=0`: `wasm-opt`를 건너뛰어 약 6분 절약, brotli 3.26MB — 예산 3.30MB 안이지만 여유가 작다)
6. `apps/web/scripts/build.mjs` → `apps/web/dist/`

그 다음 Cloudflare가 `npx wrangler deploy`로 `dist/`를 올린다(`wrangler.jsonc`: assets-only, `html_handling`, 404 페이지).

## 4. 시간 (20분 제한)
**깨끗한 환경 시뮬레이션**(빈 HOME, Rust·wasm-bindgen 없음, 저장소만 새로 클론, `WASM_OPT=0`, 이 컨테이너 4 vCPU 2.1GHz): **총 657초(10분 57초)**.

| 단계 | 시간 |
|---|---:|
| 1 rhwp 희소 체크아웃 | 9초 |
| 2 Rust 1.93.1 설치 | 17초 |
| 3 wasm-bindgen 사전 빌드본 | 1초 |
| 4 `npm ci` (캐시 없음) | 6초 |
| 5 WASM 빌드 (의존성 포함 전체 컴파일) | 약 624초 |
| 6 웹 빌드 | 1초 미만 |

- 이 빌드의 산출물로 문서 열기·렌더·검색을 확인했다(결과 동일, 외부 요청·CSP 위반·오류 0).
- **Cloudflare 빌드 서버(무료 2 vCPU)의 속도는 모른다.** 컴파일의 대부분이 단일 스레드(LTO)라 이 환경보다 1.8배까지 느려도 20분 안이지만, 그보다 느리면 실패한다. `WASM_OPT=1`(wasm-opt 적용)은 이 환경에서 약 5.5분이 더 들어 합계 약 16.5분이라 기본값을 `0`으로 했다.
- **실제 첫 빌드(오너 보고, 2026-10-19): 11분 50초, 성공.** 대시보드 목록상 PR #1 머지 커밋의 `main` 빌드다(대시보드 화면으로 확인). 시뮬레이션(10분 57초)보다 약 8% 길고 20분 한도의 약 59%다. `WASM_OPT` 값은 확인하지 못했다(기본값 `0` 가정). 대시보드의 Build 로그에서 단계별 시간을 볼 수 있다.
- **PR #3 머지 빌드(2026-10-19, 오너 보고): 전체 17분 41초, 성공.** 대시보드 단계별: Initializing 5분 36초, Cloning 2분 47초, Installing 7초, Building 8분 28초(cargo 8분 01초, `WASM_OPT=0`이라 wasm-opt 건너뜀), Deploying 약 10초 이상. WASM 13,742,359바이트. 로그에서 `LGPL 검사 통과: dist 14개 파일…`이 **Cloudflare 환경에서 처음 실행돼 통과**했다(D-028).
  - 오너 설명: Initializing 5분은 비프로덕션 브랜치 빌드 설정 때문에 밀린 것이라 감안한다(D-029). 이 설명은 확인하지 못했다. 그 지연을 빼면 약 12분으로, PR #1 빌드(11분 49초)와 비슷하다.
  - 미확인: 20분 한도가 Initializing부터 세는지. 세는 경우 17분 41초는 한도의 88%라 여유가 적다. Cloning 2분 47초가 Cloudflare의 서브모듈 전체 받기 때문인지도 모른다(빌드 로그 1/6 단계의 `rhwp 이미 준비됨`/`희소 체크아웃` 메시지로 구분할 수 있다).
- 시간이 20분에 가까워지면 5번의 대안(GitHub Actions)으로 옮긴다. 지금은 해당 없음.

## 5. 알아 둘 것 (빌드 재현성)
같은 HOME/`CARGO_HOME` 경로에서 다시 빌드하면 WASM이 바이트 단위로 같다(1단계·2단계에서 확인). **경로가 다르면 크기가 약 3.7KB 달라진다**(의존성 크레이트의 panic 위치 문자열에 `~/.cargo/registry/…` 절대 경로가 들어감). 글루 JS와 동작은 같다(위 시뮬레이션 산출물로 확인). 경로와 무관하게 만들려면 `--remap-path-prefix`가 필요하지만 rhwp의 빌드 플래그를 바꾸는 일이라 하지 않았다.

## 6. 막혔을 때
- **빌드가 20분을 넘겨 실패**: Build command를 `WASM_OPT=0 bash ../../scripts/cloudflare-build.sh`로 확실히 하고, 그래도 넘으면 Cloudflare 빌드 대신 GitHub Actions에서 빌드해 `wrangler deploy`로 올리는 방식을 쓴다(`.github/workflows/web.yml`에 배포 단계를 더하고 `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` 시크릿 등록).
- **빌드가 계속 `Queued`로 멈춤 (2026-10-19 실제 발생)**: PR #1 머지 빌드까지는 정상이었고, 그 뒤 브랜치에 푸시한 뒤로 `main` 빌드(PR #2, #3 머지)와 재시도가 모두 `Queued`에서 시작하지 못했다(6분 이상, 오너가 취소). 오너가 Settings → Builds의 **비프로덕션 브랜치 빌드(Builds for non-production branches)를 끄자 해결**됐다. 원인은 확정하지 못했다: 가설은 PR #2 푸시로 생긴 브랜치 빌드(GitHub 체크가 30분 넘게 `in_progress`로 남음)가 끝나지 않고 계정의 동시 빌드 슬롯을 잡아 뒤 빌드를 막았다는 것이다. 이 프로젝트는 `main`만 배포하고 PR/브랜치 검증은 GitHub Actions가 하므로 비프로덕션 빌드를 꺼 둔 상태를 기본으로 한다(위 표의 Preview command는 쓰이지 않는다). 다시 켜려면 막힘 재발에 대비해 먼저 멈춘 브랜치 빌드가 없는지 확인한다.
- **서브모듈/Git 오류**: 빌드 로그 1/6 단계를 본다. 스크립트가 GitHub의 공개 포크(`ddommummi/rhwp`)를 직접 받는다.
- **용량 예산**: 이 빌드는 `npm run budget`을 돌리지 않는다. 필요하면 Build command 끝에 `&& npm run budget`을 붙인다(brotli q11 압축으로 1~2분 더 걸린다).
- **이전 버전으로 되돌리기**: 대시보드에서 Worker의 Deployments/Versions에서 이전 버전을 활성화한다(대시보드 화면 확인 필요).

## 7. 배포 후 확인
- 브라우저 개발자 도구 Network에서 `.wasm`의 Content-Type이 `application/wasm`, Content-Encoding이 `br`인지, 문서를 여는 동안 외부 요청이 0건인지.
- `/licenses`, `/THIRD_PARTY_LICENSES.txt`가 열리고 한글이 깨지지 않는지.
- 대시보드에서 Web Analytics가 꺼져 있는지(PRD 7-B).
- 실제 전송 크기: 로컬 wrangler 런타임에서는 WASM이 약 3.8MB로 내려왔다(우리 측정 3.13MB는 brotli 최고 수준). Cloudflare 실제 값으로 예산을 다시 본다.
