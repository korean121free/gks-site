# GKS 계정 지도

> 후임자가 첫날 이 문서만 읽으면 됩니다.
> 최종 수정 2026-08-15

## 원칙

1. **GKS 자산은 GKS 계정에만.** GHM 계정이나 개인 계정을 섞지 않습니다.
2. **폴더가 신분입니다.** `C:\GitHub\gks-site` 폴더에서 실행하면 자동으로 GKS 계정이 됩니다. 도구의 "기본 로그인"에 의존하지 않습니다.
3. **도구가 실수를 막습니다.** `worker/wrangler.toml` 의 `account_id` 때문에, 다른 계정으로 배포하려 하면 wrangler가 거부합니다.

## 계정

| 서비스 | 계정 | 용도 |
|---|---|---|
| GitHub | **korean121free** (korean121free@gmail.com) | 저장소 `korean121free/gks-site` |
| Cloudflare | **korean121free@gmail.com** | Pages `gks-site`, Worker `gks-class`, D1 `gks-class-log` |
| LiveKit Cloud | **korean121free@gmail.com** | 프로젝트 `gks` — 화상 수업방 |
| 구글폼·시트 | (기존 GKS 운영 계정) | 학생·선생님 지원, 통합관리시트 |

### ⚠️ GKS 것이 아닌 계정 — 절대 섞지 말 것

| 계정 | 실제 용도 |
|---|---|
| ssyhsarahkim-tech (GitHub) | **GHM 전용** — GitHub Desktop이 이 계정으로 로그인돼 있음 |
| ssyhsarahkim@gmail.com (Cloudflare) | **GHM 전용** — ghm.co.kr 등 프로젝트 6개 |

- **위 두 줄은 데스크톱 이야기입니다.** 데스크톱의 GitHub Desktop은 GHM 계정이라, 거기서 gks-site를 Push하면 "Fork this repository?" 창이 뜹니다 → **반드시 Cancel.** 데스크톱에서 GKS는 클로드 데스크톱 앱 터미널에서만 push
- Cloudflare 대시보드 북마크는 **GHM 계정 주소**입니다. GKS는 주소를 직접 입력해서 들어가세요

### 컴퓨터 2대 — 어느 컴퓨터에서 무엇으로 푸시하나 (2026-08-15 확인)

| 컴퓨터 | GitHub Desktop 로그인 | gks-site 커밋·푸시 |
|---|---|---|
| 데스크톱 (기존 PC) | ssyhsarahkim-tech (**GHM 전용**) | ❌ GitHub Desktop 금지 — Fork 창 뜨면 Cancel. 터미널(gh CLI)로만 |
| **노트북 (LG 그램)** | **korean121free (GKS 전용)** | ✅ **GitHub Desktop으로 바로 가능** — Commit to main → Push origin |

노트북은 GKS 전용으로 쓰고, GHM 작업은 노트북에서 하지 않습니다. 두 단체가 컴퓨터 단위로 분리되어 계정이 섞일 일이 없습니다.

## 인증 방식

| | GHM | GKS |
|---|---|---|
| 폴더 | `C:\GitHub\good-ghm` | `C:\GitHub\gks-site` |
| GitHub | GitHub Desktop 로그인 | `gh` CLI (korean121free) |
| Cloudflare | wrangler 기본 로그인 | **`worker/.cf-token`** + `worker/wr.bat` |

`worker/wr.bat` 은 그 폴더의 `.cf-token` 만 읽어서 wrangler를 실행합니다. GHM 쪽 기본 로그인은 건드리지 않습니다.

```
worker\wr.bat whoami
worker\wr.bat deploy
```

`.cf-token` 은 `.gitignore` 에 들어 있어 GitHub에 올라가지 않습니다.
토큰을 잃어버리면: Cloudflare → My Profile → API Tokens → Create Custom Token
(권한: Workers Scripts=Edit, D1=Edit, Workers R2 Storage=Edit, Account Settings=Read)

## 배포된 것

| | 값 |
|---|---|
| 홈페이지 | https://gks-site-fie.pages.dev (GitHub push → 자동 재배포) |
| 수업 서버 | https://gks-class.korean121free.workers.dev |
| Cloudflare 계정 번호 | `ef455f05c07e1a9a08d899ea85d560c3` |
| D1 기록 저장소 | `gks-class-log` (`1f336c5e-c7c9-480b-a5a0-c3a2c3c32939`) |
| LiveKit 주소 | `wss://gks-577c6bjr.livekit.cloud` |
| R2 사진 저장소 | **아직 안 켬** — 대시보드에서 R2 활성화 후 사용 가능 |

## 비밀값 (코드·문서에 절대 적지 않음)

Cloudflare에 암호화되어 저장됩니다. 확인용 명령: `worker\wr.bat secret list`

| 이름 | 어디서 나오나 |
|---|---|
| `LIVEKIT_API_KEY` | LiveKit → Settings → Keys |
| `LIVEKIT_API_SECRET` | 같은 화면 (만들 때 한 번만 보임) |
| `ADMIN_KEY` | 관리 화면(admin.html) 비밀번호 — 직접 정함 |

넣는 법:

```
worker\wr.bat secret put LIVEKIT_API_KEY
```

## 남은 숙제

- [ ] **korean121free 비밀번호가 크롬 비밀번호 관리자에만 있음** → 단체 문서로 옮기기. 지금은 이 컴퓨터가 고장나면 GKS 자산에 아무도 못 들어감
- [ ] 복구 이메일을 개인 메일이 아닌 단체 메일로
- **2단계 인증은 서비스마다 스위치가 따로입니다.** 하나를 켜도 나머지는 안 켜집니다
  - [x] **구글 korean121free@gmail.com — 켜져 있음** (2021-12-08부터, 패스키 3개, 구글 메시지 기기 2대, 인증 전화번호 등록됨). 확인 2026-07-31. **여기가 뿌리** — 아래 둘이 모두 이 계정에 매달려 있음
  - [x] **Cloudflare — 켜져 있음** ("Email two-factor authentication is active", 백업 코드 8개 발급됨). 확인 2026-07-31, 화면은 `/profile/access-management/authentication/two-factor`. 여기가 홈페이지·수업 서버·**D1의 학생 기록과 수업 사진**을 쥐고 있음 — 방침 9항 "계정 접근 통제"를 실제로 뒷받침하는 곳
    - `/profile/settings` 의 `Email — Verified` 를 보고 착각하지 말 것. 그건 메일 주소 확인 표시일 뿐 2단계 인증이 아님
    - ⚠️ Backup codes 의 **`Regenerate` 를 누르지 말 것.** 누르는 순간 이미 보관 중인 8개가 전부 무효가 됨
  - [ ] **GitHub — 꺼져 있음** (확인 2026-07-31). 단, 이 계정은 **비밀번호가 아예 없고**(Password: Not configured) 구글 로그인으로만 들어감 → 실질적으로 위 구글 2단계 인증이 막아주고 있음. 급하지 않음
- [x] 2단계 인증 **백업 코드 발급·보관** — 구글·Cloudflare 둘 다 받아서 `_internal/` 에 보관 (2026-07-31)
  - 보관 위치는 `C:\GitHub\gks-site\_internal\` — **GHM(good-ghm)과 같은 이름**이라 두 저장소에서 습관이 하나입니다. [.gitignore](.gitignore) 의 `_internal/` 로 깃에서 제외됨 (2026-07-31 확인). **파일 내용은 절대 커밋하지 말 것 — 공개 저장소입니다**
  - 이 폴더를 다른 데로 옮긴다면 반드시 `C:\GitHub` **바깥**으로. 저장소 안의 다른 폴더로 옮기면 위 보호가 사라짐
- [x] **컴퓨터 밖 사본 확보** — `_internal` 문서들을 zip으로 묶어 **그린 계정 구글 드라이브**에 보관 (2026-07-31). 이 컴퓨터가 고장나도 그 계정으로 들어가면 열쇠가 있음
  - zip에 **비밀번호는 걸지 않음.** 따라서 **그린 계정의 2단계 인증**과 **파일 공유 설정("제한됨")** 이 유일한 방어선. 그 계정 보안이 곧 GKS 전체 보안임
  - korean121free 구글 백업 코드를 **korean121free 자신의 드라이브**에는 두지 말 것 — 그 계정에 못 들어갈 때 쓰는 열쇠라 꺼낼 수 없게 됨. 그린 계정처럼 **다른 계정**이어야 함
- [ ] 자체 도메인을 사면 반드시 **korean121free 계정에** 붙일 것
