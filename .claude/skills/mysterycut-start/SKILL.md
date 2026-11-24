---
name: mysterycut-start
description: 사장님이 "미스터리컷 시작"(또는 "미스터리 컷 시작", "미스터리컷 이어서")이라고 하면 쓴다. PC·GitHub에 저장된 미스터리 컷 프로젝트를 최신으로 맞추고(없으면 GitHub에서 받아 저장), 이어가기 메모를 읽어 지난 작업을 이어받은 뒤, 최근 성과와 개선사항을 한국어로 보고한다.
---

# 미스터리컷 시작

사장님은 개발자가 아니다. 모든 보고는 한국어로, 쉬운 말로, 결과부터. 이 저장소의 `CLAUDE.md` 규칙(법·옛 영상 금지·무료만·비밀 키 금지)을 그대로 지킨다.

## 1. 저장소 맞추기 (PC·클라우드 공통)

작업 폴더 = 이 저장소(MysteryCut). 아카이브 = 형제 폴더 `../chat-archive` (클라우드에서는 `/home/user/claude-chat-archive` 도 확인).

1. 프로젝트 저장소
   - `git fetch origin claude/mystery-reels-automation-ymzy1t`
   - 지금 브랜치가 운영 브랜치가 아니면 알리고, 작업 전 운영 브랜치 기준으로 맞출지 판단한다(클라우드 세션은 지정된 작업 브랜치 규칙을 따른다).
   - 로컬 변경이 없고 뒤처져 있으면 `git pull --ff-only`. 로컬 변경이 있으면 **덮어쓰지 말고** 무엇이 바뀌었는지 보여 주고 "GitHub에 올릴까요?"를 묻는다.
   - `node_modules` 가 없으면 `npm ci`. `npx tsx --version` 이 실패하면(새 npm 이 esbuild 설치 스크립트를 막은 경우) `npm install-scripts approve esbuild protobufjs` 후 `npm rebuild esbuild` 를 시도하고 결과를 알린다.
2. 아카이브 저장소
   - 없으면 받는다: `git clone https://github.com/keun4jang/claude-chat-archive.git ../chat-archive` (비공개 — 로그인 창이 뜨면 사장님께 로그인 부탁).
   - 있으면 로컬 변경이 없을 때 `git pull --ff-only`.
   - 1.45GB 이상이라 처음 받을 때 몇 분 걸린다고 먼저 말한다.
3. 받거나 갱신한 것은 디스크에 그대로 남는다(= PC 자동 저장). 실패하면 이유를 한 줄로 바로 알린다.

## 2. 지난 작업 이어받기

- 아카이브의 `sessions/MysteryCut/*/handoff.md` 중 가장 최근에 수정된 파일을 읽는다. 끝부분(최근 날짜 항목)이 지금 상태다.
- 같은 폴더의 보고서(`plan10-revenue-legal-*.md`, `ypp-plan-*.md`)는 필요할 때만 읽는다.
- `git log --oneline -15 origin/claude/mystery-reels-automation-ymzy1t` 로 최근 변경을 본다.

## 3. 최근 성과 (키 없이 볼 수 있는 것부터)

1. `data/reports/ypp-latest.md` — 매주 월요일 자동 리포트(구독자·공개 롱폼 시청시간·도달 예상일·형식별 성과·심사 점검·쇼츠 동물 그림 비교). 날짜를 함께 말한다.
2. 최근 게시 결과: 공개 저장소라 아래가 인증 없이 된다.
   - `curl -s "https://api.github.com/repos/keun4jang/MysteryCut/actions/workflows/post-reel.yml/runs?per_page=6&event=schedule"`
   - `.../post-longform.yml/runs?per_page=3&event=schedule`
   - 실패(conclusion=failure)가 있으면 맨 먼저 말한다.
3. `data/history.json` 의 최근 게시 목록(날짜·제목·형식). 유튜브 링크는 `videoId` 로 `https://youtu.be/<id>`.
4. 숫자를 지어내지 않는다. 리포트가 오래됐거나 없으면 "최신 수치는 월요일 리포트 이후 갱신"이라고 말하고, 원하면 GitHub Actions 에서 `ypp-report.yml` 을 수동 실행하도록 안내한다(클라우드 세션이면 직접 실행).

## 4. 보고 형식 (짧게)

1. 저장 상태 — PC·GitHub 가 최신인지, 새로 받은 것이 있는지 (한두 줄)
2. 최근 게시 — 지난 1주일 쇼츠·롱폼 성공/실패, 링크 1~2개
3. 성과 — 구독자, 공개 롱폼 시청시간 / 목표(3,000·4,000시간), 지난주 대비 변화, 잘된 영상 1개
4. 최근 개선사항 — 이어가기 메모 최신 항목 3~5개를 쉬운 말로
5. 다음 할 일 / 사장님이 정할 것 — 있으면 1~3개
그다음 "무엇부터 할까요?"로 끝낸다.

## 5. 작업이 끝날 때

- 바꾼 것은 운영 브랜치(또는 세션의 지정 브랜치)에 커밋·푸시해 GitHub 와 PC 가 같아지게 한다. 비밀 키·클라이언트 JSON 은 절대 커밋하지 않는다(`.gitignore` 에 막혀 있음).
- 이어가기 메모(handoff.md)에 오늘 한 일을 한두 줄 추가하고 아카이브도 푸시한다.
