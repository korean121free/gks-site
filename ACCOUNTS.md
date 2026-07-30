# GKS 계정 지도

> 후임자가 첫날 이 문서만 읽으면 됩니다.
> 최종 수정 2026-07-30

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

- GitHub Desktop에서 gks-site를 Push하면 "Fork this repository?" 창이 뜹니다 → **반드시 Cancel.** GKS는 클로드 데스크톱 앱 터미널에서만 push
- Cloudflare 대시보드 북마크는 **GHM 계정 주소**입니다. GKS는 주소를 직접 입력해서 들어가세요

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
- [ ] 2단계 인증을 켜면 백업 코드를 출력해서 단체 보관
- [ ] 자체 도메인을 사면 반드시 **korean121free 계정에** 붙일 것
