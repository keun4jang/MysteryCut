/**
 * 게시 이력·썸네일·상태 파일을 레이스 없이 커밋·푸시한다.
 *
 * 사용: npx tsx scripts/commitPostHistory.mts <branch> "<커밋 메시지>"
 *
 * 왜 이 스크립트인가 — 2026-08-24 실측 사고: 쇼츠와 롱폼 워크플로가 몇 초
 * 간격으로 같은 브랜치에 푸시하다가 `git pull --rebase` 가 history.json 에서
 * 충돌했다. rebase 는 중단된 채 `git push`(HEAD가 원격과 동일) 가 "Everything
 * up-to-date" 를 찍고 스텝은 성공으로 끝났고, 그날 쇼츠의 이력 항목
 * (lee-hyung-ho-1991)은 조용히 유실됐다. 이력이 빠지면 중복 회피가 그 사건을
 * 몰라 같은 소재를 다시 게시할 수 있다 — 무인 채널에서 가장 나쁜 종류의
 * 조용한 실패다.
 *
 * 해법: 텍스트 병합(rebase)을 아예 하지 않는다.
 *   ① 파이프라인이 만든 결과(이력 항목·썸네일·상태 파일)를 먼저 스냅샷
 *   ② 원격 최신으로 리셋 → 스냅샷을 그 위에 **데이터 수준으로 합성**
 *      (이력은 caseKey+날짜 기준 합집합 — 어느 쪽 항목도 잃지 않는다)
 *   ③ 커밋·푸시. 실패하면(레이스로 인한 푸시 거부든, fetch/push 의 일시적
 *      네트워크 장애든) ②부터 재시도.
 * 몇 번을 반복해도 결과가 같은 결정적(idempotent) 절차라 레이스가 없다.
 *
 * 5회 모두 실패하면 종료 코드 1 — 스텝이 실패로 표시돼 메일 알림이 온다.
 * (이력 유실을 조용히 넘기는 것보다 알림이 낫다.)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [branch, message] = process.argv.slice(2);
if (!branch || !message) {
  console.error("사용법: npx tsx scripts/commitPostHistory.mts <branch> <commit message>");
  process.exit(1);
}

const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

const HISTORY = "data/history.json";
/** 이력 외에 파이프라인이 갱신할 수 있는 상태 파일 (있을 때만 커밋) */
const STATE_FILES = [
  "data/geminiModel.txt",
  "data/igGraphVersion.txt",
  "data/latestLongform.json",
  "data/longformPlaylist.json",
];

interface Post {
  caseKey: string;
  at: string;
  [k: string]: unknown;
}
/**
 * ★파일 없음과 JSON 손상을 구분한다. 손상을 '빈 이력'으로 위장하면, 원격에
 * 실제로 90여 건이 있어도 손상된 순간부터 readPosts→[] 로 읽혀 merged 가
 * localPosts 뿐인 파일로 push 돼 전체 이력이 영구 대체될 수 있다(감사에서
 * 확인된 시나리오). 손상이면 예외를 던져 이 스크립트를 실패시킨다 — 조용한
 * 이력 파괴보다 잡 실패 메일이 낫다.
 */
const readPosts = (file: string): Post[] => {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  let parsed: { posts?: Post[] };
  try {
    parsed = JSON.parse(raw) as { posts?: Post[] };
  } catch (e) {
    throw new Error(`${file} 파싱 실패 — 손상된 파일로 보임: ${e instanceof Error ? e.message : e}`);
  }
  return Array.isArray(parsed.posts) ? parsed.posts : [];
};

// ── ① 스냅샷 ────────────────────────────────────────────────────────────
const localPosts = readPosts(HISTORY);
const stateSnapshot = new Map<string, string>();
for (const f of STATE_FILES) {
  if (fs.existsSync(f)) stateSnapshot.set(f, fs.readFileSync(f, "utf8"));
}
// 새로 생기거나 바뀐 썸네일 — 리셋하면 트래킹 여부와 무관하게 사라질 수 있어 복사해 둔다.
// -uall: 폴더가 통째로 새것이면 porcelain 이 "?? thumbnails/" 한 줄로 뭉뚱그리는데,
// 파일 단위로 풀어서 받아야 개별 복사가 된다 (실측: 스크래치 테스트에서 발견).
const thumbFiles = git("status", "--porcelain", "-uall", "thumbnails/")
  .split("\n")
  .map((l) => l.slice(3).trim())
  .filter((f) => f && fs.existsSync(f) && fs.statSync(f).isFile());
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thumbs-"));
for (const f of thumbFiles) {
  if (fs.existsSync(f)) fs.cpSync(f, path.join(tmp, path.basename(f)));
}

git("config", "user.name", "mystery-cut-bot");
git("config", "user.email", "actions@users.noreply.github.com");

// ── ②③ 원격 위에 합성 → 푸시 (레이스·일시적 네트워크 장애 시 반복) ──────
// ★fetch/reset 도 push 와 같은 try 블록 안에 둔다. 예전엔 push 거부만 재시도
// 대상이라, fetch 한 번의 일시적 네트워크 장애가 재시도 없이 스크립트를
// 곧장 죽였다 — 하필 이 스크립트는 '네트워크 장애를 견디자'는 목적으로 만든
// 것이라 모순이었다(감사에서 발견).
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let done = false;
for (let attempt = 1; attempt <= 5 && !done; attempt++) {
  try {
    git("fetch", "origin", branch);
    git("reset", "--hard", `origin/${branch}`);

    // 이력 합집합: 원격에 이미 있는 항목 + 이번 실행 항목 중 원격에 없는 것.
    // 식별자는 caseKey+날짜 — 같은 사건을 같은 날 두 번 넣는 일은 없다.
    const remotePosts = readPosts(HISTORY);
    const seen = new Set(remotePosts.map((p) => `${p.caseKey} ${p.at}`));
    const merged = [...remotePosts, ...localPosts.filter((p) => !seen.has(`${p.caseKey} ${p.at}`))];
    fs.mkdirSync(path.dirname(HISTORY), { recursive: true });
    fs.writeFileSync(HISTORY, `${JSON.stringify({ posts: merged }, null, 2)}\n`, "utf8");

    for (const [f, body] of stateSnapshot) fs.writeFileSync(f, body, "utf8");
    fs.mkdirSync("thumbnails", { recursive: true });
    for (const f of thumbFiles) {
      const saved = path.join(tmp, path.basename(f));
      if (fs.existsSync(saved)) fs.cpSync(saved, f);
    }

    git("add", HISTORY, "thumbnails/", ...[...stateSnapshot.keys()]);
    let hasChanges = true;
    try {
      git("diff", "--cached", "--quiet");
      hasChanges = false;
    } catch {
      /* 스테이징된 변경이 있음(diff --cached --quiet 는 변경 있으면 비정상 종료) */
    }
    if (!hasChanges) {
      console.log("변경 없음 — 커밋 생략");
      done = true;
      break;
    }

    git("commit", "-m", message);
    git("push", "origin", `HEAD:${branch}`);
    console.log(`이력 커밋·푸시 완료 (시도 ${attempt}회차, 이력 ${merged.length}건)`);
    done = true;
  } catch (e) {
    console.log(
      `${attempt}회차 실패(레이스 또는 일시적 네트워크 장애) — ${attempt * 3}s 후 원격 위에 재합성: ${e instanceof Error ? e.message : e}`,
    );
    await sleep(attempt * 3000);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
if (!done) {
  console.error("❌ 5회 시도에도 이력 푸시 실패 — 이력 유실 위험. 수동 확인 필요.");
  process.exit(1);
}
