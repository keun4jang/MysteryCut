# MysteryCut — 미스터리 릴스 완전 자동화 (무료)

[@mystery.cut](https://www.instagram.com/mystery.cut) 채널용으로,
**미스터리 스토리 구상 → 대본 → 나레이션 → 영상 제작 → 릴스 업로드**를 전부 자동화합니다.

- 💸 **완전 무료 스택** (유료 API 없음)
- 🕵️ 가능하면 **실화(실제 미제사건·역사 속 미스터리)** 기반, 아주 옛날 사건도 OK
- 🎬 **길고 후킹 있는** 스토리로 끝까지 시청 유도, 마지막에 **시청자에게 질문**
- ⏰ **하루 2개**, 매일 **다른 시각**에 게시(자동화 티 안 나게)

```
스토리 구상 ─► 대본 작성 ─► 캡션/해시태그 ─► 나레이션(TTS) ─► 영상 렌더 ─► 인스타 업로드
storyIdeator   scriptWriter   metadataWriter    narrator        Remotion      publisher
```

## 무료 기술 스택

| 단계 | 도구 | 비용 |
|---|---|---|
| 스토리·대본·캡션 | Google **Gemini** (무료 등급) | 무료 (하루 2개는 한도 내) |
| 나레이션 | Microsoft **Edge TTS** (키 불필요) | 무료 |
| 영상 | **Remotion** (오픈소스, 로컬 렌더) | 무료 |
| 업로드 | **Instagram Graph API** | 무료 |
| 스케줄러 | **GitHub Actions** (cron + 랜덤 지연) | 무료 |

> 참고: 무료 등급의 정책/한도는 제공사(Google·Microsoft·GitHub) 사정에 따라 바뀔 수 있습니다.
> 현재 볼륨(하루 2개)에서는 비용이 발생하지 않습니다.

## 준비물 (모두 무료 발급)

1. **Node.js 18+**
2. **Gemini API 키** — https://aistudio.google.com/apikey (무료)
3. **Instagram 프로페셔널 계정** + Facebook 페이지 연동 + Graph API 토큰
   - https://developers.facebook.com 앱 생성 → `instagram_content_publish` 권한
   - `IG_USER_ID`(인스타 비즈니스 계정 ID), 장기 `IG_ACCESS_TOKEN`
   - (TTS는 키가 필요 없습니다.)

### 인스타 최초 셋업 (한 번만)

인스타 프로 계정을 Facebook 페이지에 연결한 뒤, 아래로 `IG_USER_ID`와
장기 `IG_ACCESS_TOKEN`을 한 번에 뽑을 수 있습니다:

1. [Graph API Explorer](https://developers.facebook.com/tools/explorer/)에서
   `instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement, business_management`
   권한으로 **사용자 토큰**을 발급.
2. `.env` 에 `FB_APP_ID`, `FB_APP_SECRET`, `FB_USER_TOKEN`(위 토큰) 입력.
3. 실행:
   ```bash
   npm run setup-instagram
   ```
   출력된 `IG_USER_ID` / `IG_ACCESS_TOKEN`(장기)을 `.env` 또는 GitHub Secrets 에 넣으면 끝.
   (`FB_USER_TOKEN`은 이후 지워도 됩니다.)

## 로컬 실행

```bash
npm install
cp .env.example .env   # GEMINI_API_KEY, IG_* 채우기

npm run ideate                    # 스토리 아이디어만 확인 (Gemini 키만 있으면 됨)
npm run pipeline -- --no-publish  # 업로드 없이 영상 파일까지 생성
npm run pipeline                  # 전체 파이프라인 (인스타 업로드까지)
npm run studio                    # Remotion 스튜디오로 영상 연출 미리보기
```

산출물은 `out/` 에 저장됩니다 (`reel.mp4`, `project.json`).

## 자동 게시 설정 (GitHub Actions)

이 저장소의 `.github/workflows/post-reel.yml` 이 **하루 2번**(오전/저녁 창) 자동 실행되고,
각 실행마다 **0~3시간 랜덤 지연** 후 게시하여 매일 시각이 달라집니다.

저장소 **Settings → Secrets and variables → Actions** 에 등록:

- **Secrets**: `GEMINI_API_KEY`, `IG_USER_ID`, `IG_ACCESS_TOKEN`
- **Variables**(선택): `GEMINI_MODEL`, `TTS_VOICE`, `IG_GRAPH_VERSION`

게시 시간대를 바꾸려면 워크플로의 `cron`(UTC 기준, KST=UTC+9)을 수정하세요.
수동 테스트는 Actions 탭에서 **Run workflow** 로 즉시 실행할 수 있습니다.

## 인스타 토큰 자동 갱신 (60일 만료 대비)

인스타 장기 토큰은 약 60일 후 만료됩니다. `.github/workflows/refresh-token.yml` 이
**매주** 토큰을 재발급하고 저장소의 `IG_ACCESS_TOKEN` 시크릿을 자동으로 갱신합니다.

추가로 등록할 **Secrets**:

- `FB_APP_ID`, `FB_APP_SECRET` — Facebook 개발자 앱의 자격증명 (토큰 재교환용)
- `GH_PAT` — 저장소 시크릿을 쓰기 위한 개인 액세스 토큰
  (Fine-grained PAT: 대상 저장소에 **Secrets: Read and write** 권한)

> 기본 `GITHUB_TOKEN` 으로는 시크릿을 쓸 수 없어 `GH_PAT` 가 필요합니다.
> 로컬에서 즉시 갱신해 보려면: `npm run refresh-token` (새 토큰이 출력됩니다).

> 💡 GitHub Actions 무료 한도: 공개 저장소는 무제한, 비공개는 월 2,000분.
> 짧은 렌더 기준 하루 2개는 비공개에서도 한도 내입니다.

## 단계별 어시스트 (Claude Code 서브에이전트)

`.claude/agents/` 에 단계별 전문 에이전트가 정의되어 있습니다. Claude Code에서
`@story-ideator`, `@script-writer`, `@video-producer`, `@publisher` 로 호출해
해당 단계만 집중적으로 개선할 수 있습니다.

| 어시스트 | 담당 | 코드 |
|---|---|---|
| story-ideator | 실화 기반 스토리 구상·훅 | `src/assistants/storyIdeator.ts` |
| script-writer | 긴 호흡·후킹 대본 | `src/assistants/scriptWriter.ts` |
| video-producer | Remotion 연출·렌더 | `src/remotion/*`, `src/render.ts` |
| publisher | 캡션·업로드 | `src/assistants/metadataWriter.ts`, `publisher.ts` |

## 폴더 구조

```
src/
  index.ts              파이프라인 오케스트레이터 (CLI)
  config.ts             환경설정
  types.ts              단계별 데이터 스키마 (zod)
  render.ts             Remotion 번들 + 렌더
  lib/llm.ts            Gemini 구조화 출력 헬퍼
  assistants/           단계별 어시스트 모듈
  remotion/             영상 컴포지션 (Root, MysteryReel)
.github/workflows/      하루 2개·랜덤 시각 자동 게시
.claude/agents/         Claude Code 단계별 서브에이전트
public/audio/           생성된 나레이션 오디오 (gitignore)
out/                    렌더 결과물 (gitignore)
```

## 안전·정확성

- 실화 기반이라도 **확인되지 않은 부분은 '~라는 설이 있다'**처럼 추측임을 표시합니다(`factNote`).
- 실존 인물(특히 생존 인물) 명예훼손·사적 개인 특정을 금지합니다.
- 자동 게시 전 사람이 한 번 검수하고 싶으면, 워크플로 마지막의 업로드 단계를
  `--no-publish` 로 바꿔 산출물만 만든 뒤 수동 게시할 수 있습니다.

## 다음 개선 아이디어

- 아이디어 중복 방지용 히스토리 저장(생성된 제목/소재 로그를 커밋)
- 장면별 무료 이미지/영상(B-roll) 삽입, 무료 BGM
- 단어 단위 타임스탬프로 자막 하이라이트
- 60일 만료되는 인스타 토큰 자동 갱신 워크플로
