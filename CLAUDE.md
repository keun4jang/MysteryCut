# 미스터리 컷 (MysteryCut) — 작업 안내

실제 기록된 미스터리·사건을 위키백과 등 공개 자료로 정리해 유튜브(쇼츠·롱폼)와 인스타그램에 자동 게시하는 시스템.
게시는 GitHub Actions 가 돌린다(사장님 컴퓨터가 꺼져 있어도 됨). 이 폴더는 코드·이력의 사본이다.

## 꼭 지킬 것 (사장님 지시)
- **항상 한국어로 답한다.** 사장님은 개발자가 아니다 — 쉬운 말로, 결과부터.
- **법에 걸리지 않는 선에서만.** 5년 이내 사건·생존 인물이 특정되는 사건·성범죄 중심·아동 피해·정치 논란은 다루지 않는다.
  확정판결이 없는 사람을 '범인'이라 부르지 않는다. 원문에 없는 사실을 만들지 않는다.
- **2026-01-01 이전에 올린 옛 '새미했다' 영상은 절대 건드리지 않는다**(수정·삭제·비공개·댓글 모두 금지, `scripts/legacyGuard.mts`).
- **업로드 시각은 매번 다르게, 17:00~23:00 KST 사이.**
- **비용이 드는 것은 사장님 승인 없이 쓰지 않는다**(Gemini 무료 등급, edge-tts, Pexels, AI Horde 등 무료만).
- **비밀 키·클라이언트 JSON 파일을 절대 커밋하지 않는다.** 키는 GitHub 저장소 Secrets 에만 있다(로컬 `.env` 는 읽지도 출력하지도 않는다).
- 실패는 바로 보고하고, 작업이 끝나면 이어가기 메모를 갱신한다.

## 어디에 무엇이
- 운영 브랜치: `claude/mystery-reels-automation-ymzy1t` (기본 브랜치 — 여기에 푸시하면 다음 게시부터 반영)
- 이어가기 메모(지금까지의 결정·상태): 형제 폴더 `../chat-archive/sessions/MysteryCut/<세션>/handoff.md`
  (GitHub: keun4jang/claude-chat-archive). 수익화·법무 점검 보고서도 같은 폴더.
- 쇼츠: `src/index.ts`(소재 선정·대본·게이트) → `.github/workflows/post-reel.yml` (화·목·토·일)
- 롱폼: `src/longform.ts` → `post-longform.yml` (수 = 단일 사건 심층, 토 = 테마 몰아보기)
- 화면: `src/remotion/*` (롱폼 스타일 팩 `stylePacks.ts`), 배경 사진 `src/assistants/broll.ts`, 동물 그림 `src/assistants/animalArt.ts`
- 안전 게이트 회귀 검사: `npx tsx scripts/testSafetyGates.mts` (네트워크 불필요)
- 주간 리포트: `ypp-report.yml`(수익창출 조건), `stats-report.yml`(조회·구조 점검)

## 확인 명령
```
npm ci
npm run typecheck
npx tsx scripts/testSafetyGates.mts
```
실제 게시·드라이런은 키가 필요해 로컬에서 돌리지 않는다 — GitHub Actions 에서 `dry_run` 으로 실행한다.
