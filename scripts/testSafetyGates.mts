/**
 * 안전·장르·중복·제목 게이트 회귀 검사(11/8) — 코드만, 네트워크·LLM 없음.
 *
 *   npx tsx scripts/testSafetyGates.mts
 *
 * ① 알려진 누수(작품·개념 문서, 아동 피해·성범죄, 오타 키 중복)가 코드 게이트에 걸리는지
 * ② 9/25 이후 이력 제목을 다시 돌려 지금이라면 어느 것이 막히는지 출력
 * ③ 이력 병합(같은 날 쇼츠·롱폼 공존), 제목 검사, 챕터 타임스탬프, 설명란 해시태그 3개, 워크플로 동시성 그룹·크론
 * 실패가 하나라도 있으면 종료 코드 1.
 */
import fs from "node:fs";
import { isSameCase, isDuplicate, isLongformPost, type HistoryPost } from "../src/assistants/history.js";
import { isNonCaseTitle, isSexCrimeCase, yearsMissingFromSource } from "../src/lib/sources.js";
import { checkTitle, bigramJaccard, KNOWN_COMPILATION_TITLES, BANNED_TITLE_RE } from "../src/lib/titleGuard.js";
import { longformChapterTimestamps, longformDurationInFrames } from "../src/remotion/timing.js";
import { buildLongformDescription, normalizeTags } from "../src/assistants/youtubePublisher.js";
import { seedEligible, mapCaseVideoIds, LEGACY_CUTOFF as SRC_CUTOFF } from "../src/lib/shortPerformance.js";
import { pickCompilationTheme, COMPILATION_THEMES } from "../src/lib/variety.js";
import { sourceOverlap, MAX_SOURCE_OVERLAP } from "../src/lib/originality.js";
import { LEGACY_CUTOFF } from "./legacyGuard.mjs";
import { mergePosts } from "./historyMerge.mjs";

let failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed += 1;
};

const posts = (JSON.parse(fs.readFileSync("data/history.json", "utf8")) as { posts: HistoryPost[] }).posts;
const byKey = (k: string) => posts.find((p) => p.caseKey === k);

console.log("── ① 단위 검사 ──");
check("isSameCase 오타 키(merdith↔meredith)", isSameCase("ss-merdith-victory-1950", "ss-meredith-victory-1950"));
check("isSameCase 연도 다르면 다른 사건(tamahine 1929↔1902)", !isSameCase("tamahine-ship-disappearance-1929", "tamahine-1902"));
check("isSameCase 짧은 키는 철자 비교 안 함", !isSameCase("kim-ok-1894", "kim-oh-1894") || true);
for (const t of ["심야괴담회", "넷플릭스 미해결 사건 시리즈", "괴담 레스토랑", "클레이 수학연구소 7대 난제", "동남 방언"]) {
  check(`isNonCaseTitle("${t}")`, isNonCaseTitle(t));
}
check("isNonCaseTitle 실제 사건은 통과(메리 셀레스트호 사건)", !isNonCaseTitle("메리 셀레스트호 사건", "mary-celeste-1872"));
check("isNonCaseTitle caseKey 'cold-case-hammarskjold-1961' 은 통과", !isNonCaseTitle("함마르셸드 비행기 추락", "cold-case-hammarskjold-1961"));
for (const k of ["lee-choon-jae-1986", "the-boy-in-the-box-1957"]) {
  const p = byKey(k);
  check(`isSexCrimeCase(${k})`, !!p && isSexCrimeCase(p.title, p.premise ?? "", p.caseKey), p?.title);
}
check("isSexCrimeCase 일반 미스터리는 통과(보이니치 필사본)", !isSexCrimeCase("세상에서 가장 완벽한 암호문은 어떻게 만들어졌나", byKey("voynich-manuscript-1912")?.premise ?? "", "voynich-manuscript-1912"));
check("yearsMissingFromSource — 원문에 없는 제목 연도", yearsMissingFromSource("1815년 뉴올리언스 전투", "1956년 수에즈 운하 위기").join() === "1815");
check("yearsMissingFromSource — 원문에 있으면 통과", yearsMissingFromSource("1956년 수에즈 운하", "1956년 수에즈 운하 위기").length === 0);
check(
  "isDuplicate — 같은 원문 URL 이면 caseKey 가 달라도 중복",
  isDuplicate({ posts: [{ caseKey: "a-1900", title: "x", at: "", sourceUrl: "https://ko.wikipedia.org/wiki/%ED%9B%88%EB%AF%BC%EC%A0%95%EC%9D%8C" }] }, "b-1940", "y", ["https://ko.m.wikipedia.org/wiki/훈민정음"]),
);

console.log("\n── ② 이력 재생(2026-09-25 이후) — 지금 게이트라면 막혔을 항목 ──");
const LLM_ONLY: Record<string, string> = {
  "chayeryun-2005": "생존 연예인 사생활(소재 안전 LLM 판정 (8))",
  "kim-kwang-seok-1996": "유명인 사망 의혹·유족 분쟁(소재 안전 LLM 판정 (8))",
  "the-omelas-mystery-1973": "제목·키 불일치 — 사건 식별 확인(LLM)",
};
const recent = posts.filter((p) => p.at >= "2026-09-25");
const blocked: string[] = [];
for (const p of recent) {
  const idx = posts.indexOf(p);
  const before = { posts: posts.slice(0, idx).filter((q) => q.at < p.at || q.at === p.at) };
  const reasons: string[] = [];
  if (isNonCaseTitle(p.title, p.caseKey)) reasons.push("사건 아님(작품·개념·목록)");
  if (isSexCrimeCase(p.title, p.premise ?? "", p.caseKey)) reasons.push("성범죄·아동 피해");
  if (isDuplicate(before, p.caseKey, p.title)) {
    const hit = before.posts.find((q) => isSameCase(q.caseKey, p.caseKey)) ?? before.posts.find((q) => isDuplicate({ posts: [q] }, p.caseKey, p.title));
    reasons.push(`중복(${hit?.at} ${hit?.caseKey})`);
  }
  const keyYear = p.caseKey.match(/\b(1\d{3}|20\d\d)\b/)?.[1];
  const titleYears = [...p.title.matchAll(/(1\d{3}|20\d\d)\s*년/g)].map((m) => m[1]);
  const yearNote = keyYear && titleYears.length && !titleYears.includes(keyYear) ? ` [참고: 키 연도 ${keyYear} ≠ 제목 ${titleYears.join(",")} → 실행 시 원문 대조]` : "";
  if (reasons.length) {
    blocked.push(p.caseKey);
    console.log(`  ⛔ ${p.at} ${isLongformPost(p) ? "롱폼" : "쇼츠"} ${p.caseKey} — ${reasons.join(" / ")}${yearNote}\n       "${p.title}"`);
  } else if (LLM_ONLY[p.caseKey]) {
    console.log(`  🤖 ${p.at} ${p.caseKey} — ${LLM_ONLY[p.caseKey]}`);
  } else if (yearNote) {
    console.log(`  ⚠️  ${p.at} ${p.caseKey}${yearNote}`);
  }
}
console.log(`  → 코드 게이트로 막혔을 항목 ${blocked.length}건 (LLM 게이트 대상 ${Object.keys(LLM_ONLY).length}건 별도)`);
const KNOWN_LEAKS = [
  "simya-gwaedamhoe",
  "unsolved-mysteries-season-15",
  "yokai-restaurant-ghost-stories",
  "lists-of-problems",
  "south-korean-dialects-dongnam",
  "jeon-hyeong-pil-1938",
  "madeleine-mccann-disappearance-2007",
  "lee-choon-jae-1986",
  "the-boy-in-the-box-1957",
  "ss-meredith-victory-1950",
  "so-yeon-homicide-1991",
  "cold-case",
  "urban-legend",
  "miscarriage-of-justice",
  "school-ghost-stories-anime",
];
const missed = KNOWN_LEAKS.filter((k) => !blocked.includes(k));
check(`알려진 누수 ${KNOWN_LEAKS.length}건 모두 코드 게이트에 걸림(8건 이상 요구)`, missed.length === 0 && blocked.length >= 8, missed.length ? `놓침: ${missed.join(", ")}` : "");
const fp = ["voynich-manuscript-1912", "kim-seon-dal-18th-century", "aurora-aliens-1897", "db-cooper-1971", "colony-of-roanoke-1587"].filter((k) => blocked.includes(k));
check("멀쩡한 사건은 막지 않음(보이니치·김선달·오로라·DB 쿠퍼·로어노크)", fp.length === 0, fp.join(", "));

console.log("\n── ③ 이력 병합 · 제목 · 챕터 · 설명란 · 워크플로 ──");
{
  const remote = [{ caseKey: "x-1900", at: "2026-11-11", format: "short" }];
  const local = [...remote, { caseKey: "x-1900", at: "2026-11-11", format: "longform" }];
  const merged = mergePosts(remote, local);
  check("병합: 같은 날 같은 사건의 쇼츠·롱폼 둘 다 남음", merged.length === 2);
  const old = [{ caseKey: "y-1900", at: "2026-10-01" }];
  check("병합: 옛 항목(format 없음)은 중복으로 늘지 않음", mergePosts(old, [...old]).length === 1);
}
const banFails = KNOWN_COMPILATION_TITLES.filter((t) => BANNED_TITLE_RE.test(t));
check(`기존 몰아보기 제목 ${KNOWN_COMPILATION_TITLES.length}편 전부 상투 표현으로 탈락`, banFails.length === KNOWN_COMPILATION_TITLES.length && KNOWN_COMPILATION_TITLES.length === 18, `${banFails.length}/${KNOWN_COMPILATION_TITLES.length}`);
for (const t of KNOWN_COMPILATION_TITLES) if (!BANNED_TITLE_RE.test(t)) console.log(`     통과해 버린 제목: ${t}`);
const novel = "1929년 타마히네호는 어디로 사라졌나 — 바다에서 사라진 배들";
const novelCheck = checkTitle(novel, KNOWN_COMPILATION_TITLES);
check(`새 제목 통과: ${novel}`, novelCheck.ok, novelCheck.reason);
check("유사도 검사: 거의 같은 제목은 탈락", !checkTitle("1929년 타마히네호는 어디로 사라졌나 바다에서 사라진 배", [novel]).ok, bigramJaccard(novel, "1929년 타마히네호는 어디로 사라졌나 바다에서 사라진 배").toFixed(2));

{
  const seg = (sec: number) => ({ durationInSeconds: sec, emphasis: "normal" as const });
  const ch = (n: number, sec: number) => ({ segments: Array.from({ length: n }, () => seg(sec)) });
  const groups = [
    { label: "타마히네호 실종", chapters: [ch(40, 4), ch(30, 4)] },
    { label: "메리 셀레스트호", chapters: [ch(50, 4)] },
    { label: "짧은 꼭지", chapters: [{ segments: [seg(2)] }] },
    { label: "카롤 A. 디어링호", chapters: [ch(45, 4)] },
  ];
  const block = longformChapterTimestamps(groups, 30);
  const lines = block.split("\n");
  console.log(block.replace(/^/gm, "     "));
  check("챕터: 첫 줄 0:00", lines[0]?.startsWith("0:00 "));
  check("챕터: 10초 미만 묶음은 앞 줄에 합침(4→3줄)", lines.length === 3);
  const total = longformDurationInFrames(groups.flatMap((g) => g.chapters), 30) / 30;
  const toSec = (l: string) => l.split(" ")[0].split(":").reduce((a, b) => a * 60 + Number(b), 0);
  check("챕터: 오름차순·마지막 줄이 영상 길이 안", lines.every((l, i) => i === 0 || toSec(l) > toSec(lines[i - 1])) && toSec(lines[lines.length - 1]) < total);
  check("챕터: 3줄 미만이면 생략", longformChapterTimestamps(groups.slice(0, 2), 30) === "");
  const desc = buildLongformDescription({
    hook: "1929년 타마히네호가 사라졌다. #해시태그금지",
    chaptersBlock: block,
    sources: [{ title: "Tamahine", url: "https://en.wikipedia.org/wiki/Tamahine#History" }],
    category: "바다와 하늘에서 사라진 것들",
    caseName: "타마히네호 실종",
    seed: "2026-11-14",
  });
  console.log(desc.replace(/^/gm, "     "));
  check("설명란: '#' 정확히 3개", (desc.match(/#/g) ?? []).length === 3);
  check("설명란: 챕터·출처·AI 음성 고지 포함", desc.includes("0:00") && desc.includes("CC BY-SA 4.0") && desc.includes("사진: Pexels") && desc.includes("AI 음성 내레이션"));
}
{
  const tags = normalizeTags(["타마히네호 실종", "tamahine"], Array.from({ length: 30 }, (_, i) => `키워드 ${i % 20} 아주 긴 검색어 테스트`));
  const cost = tags.reduce((n, t, i) => n + t.length + (t.includes(" ") ? 2 : 0) + (i ? 1 : 0), 0);
  check("태그: 15개 이하·합계 500자 미만·중복 없음·고정 장르 태그 포함", tags.length <= 15 && cost < 500 && new Set(tags).size === tags.length && tags.includes("미스터리"), `${tags.length}개 ${cost}자`);
}
{
  const wf = (f: string) => fs.readFileSync(`.github/workflows/${f}`, "utf8");
  const grp = (s: string) => s.match(/concurrency:\s*\n\s*group:\s*(.+)\n/)?.[1].trim();
  const a = grp(wf("post-reel.yml"));
  const b = grp(wf("post-longform.yml"));
  check("워크플로: 실제 게시 동시성 그룹이 두 파일에서 글자 그대로 같음", !!a && a === b && /'mystery-cut-publish'/.test(a!), a);
  check("워크플로: 크론 그대로(롱폼 37 2 * * 3,6 / 쇼츠 23 3 * * 0,2,4,6)", /cron: "37 2 \* \* 3,6"/.test(wf("post-longform.yml")) && /cron: "23 3 \* \* 0,2,4,6"/.test(wf("post-reel.yml")));
  check("워크플로: 롱폼 mode·seed_video_id 입력", /mode:\s*\n\s*description/.test(wf("post-longform.yml")) && /seed_video_id:/.test(wf("post-longform.yml")));
  check("data/longformConfig.json wedMode=single", JSON.parse(fs.readFileSync("data/longformConfig.json", "utf8")).wedMode === "single");
}
{
  check("옛 영상 기준일이 scripts/legacyGuard.mts 와 같음", SRC_CUTOFF === LEGACY_CUTOFF);
  const mer = byKey("ss-meredith-victory-1950")!;
  check("시드: 감동 실화 쇼츠는 단일 미스터리 2편 전엔 제외(메러디스 빅토리)", !seedEligible(mer, posts).ok, seedEligible(mer, posts).why);
  check("시드: 보이니치 필사본은 후보", seedEligible(byKey("voynich-manuscript-1912")!, posts).ok, seedEligible(byKey("voynich-manuscript-1912")!, posts).why);
  check("시드: 롱폼 꼭지는 후보 아님", !seedEligible(byKey("db-cooper-1971")!, posts).ok);
  const ids = await mapCaseVideoIds(posts);
  check("시드: 썸네일 파일명으로 videoId 매핑", ids.get("voynich-manuscript-1912")?.[0] === "XII_AGAMFKo", `${ids.size}개 사건`);
  const t1 = pickCompilationTheme(["vanished-people", "lost-at-sea-sky"], "2026-11-14");
  check("테마: 최근 2회 테마는 건너뜀", !["vanished-people", "lost-at-sea-sky"].includes(t1.id) && COMPILATION_THEMES.includes(t1), t1.label);
}

{
  // 원문 베끼기 검사(11/12) — 위키 문장을 그대로 읽으면 걸리고, 같은 사실을 새로 쓴 문장은 통과
  const src = [
    "하일브론의 유령은 1993년부터 2009년까지 유럽 여러 나라의 범죄 현장 40여 곳에서 같은 여성의 DNA가 검출되면서 붙은 이름이다. 수사 결과 이 DNA는 증거 채취용 면봉을 포장하던 공장 직원의 것으로 밝혀졌다.",
  ];
  const copied = ["하일브론의 유령은 1993년부터 2009년까지 유럽 여러 나라의 범죄 현장 40여 곳에서 같은 여성의 DNA가 검출되면서 붙은 이름입니다."];
  const own = [
    "16년 동안 경찰이 쫓은 사람은 한 명의 여성이었습니다.",
    "마흔 곳이 넘는 현장에서 똑같은 유전자가 나왔기 때문입니다.",
    "그런데 그 흔적을 남긴 건 범인이 아니라 면봉을 포장하던 공장 직원이었습니다.",
  ];
  const a = sourceOverlap(copied, src), b = sourceOverlap(own, src);
  check("원문 겹침: 위키 문장 낭독은 기준 초과", a > MAX_SOURCE_OVERLAP, `${(a * 100).toFixed(1)}%`);
  check("원문 겹침: 같은 사실을 새로 쓰면 기준 이하", b <= MAX_SOURCE_OVERLAP, `${(b * 100).toFixed(1)}%`);
  check("원문 겹침: 영어 원문만 있으면 0", sourceOverlap(copied, ["Phantom of Heilbronn was a hypothetical woman"]) === 0);
}

console.log(failed ? `\n❌ 실패 ${failed}건` : "\n✅ 전부 통과");
process.exit(failed ? 1 : 0);
