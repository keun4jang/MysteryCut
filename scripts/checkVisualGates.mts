/**
 * 시각 문법 게이트 검사 — 날조가 화면에 새어 나가는지 본다.
 *
 *   npx tsx scripts/checkVisualGates.mts
 *
 * 프롬프트로 "지어내지 마라"고 쓰는 것만으로는 안 지켜진다(분량 규칙도 어겼다).
 * 원문에 없는 수·관계·실명이 실제로 걸러지는지 케이스로 확인한다.
 * 통과해야 하는 케이스가 막히는 것도 문제라 양쪽을 다 본다.
 */
import type { SourceDoc } from "../src/lib/sources.js";
import { normalizeVisuals } from "../src/lib/visual/normalize.js";
import type { LongformScript } from "../src/types.js";

const SOURCES: SourceDoc[] = [
  {
    title: "니오스호 참사",
    url: "",
    lang: "ko",
    references: [],
    extract:
      "1986년 8월 21일 카메룬 니오스호에서 다량의 이산화탄소가 분출했다. " +
      "이 사고로 주민 약 1700명이 사망했고 가축 3500마리가 함께 죽었다. " +
      "생존자 4명은 외상이 전혀 없었다고 진술했다. " +
      "일부 학자는 호수 바닥의 화산 활동이 원인이라고 추정한다. " +
      "조사단은 사고 2일 뒤에 현장에 도착했다.",
  },
];

const CASE = { title: "카메룬 니오스호 집단 사망 사건" };

type Visual = NonNullable<
  NonNullable<LongformScript["chapters"][0]["segments"][0]["frame"]>["visual"]
>;

function script(visual: Visual): LongformScript {
  const seg = (text: string, visual?: Visual) => ({
    text,
    textEn: "",
    emphasis: "normal" as const,
    frame: visual ? { kind: "evidence" as const, label: "증거 01", visual } : undefined,
  });
  return {
    title: "", thumbTitle: "", thumbBadge: "", centralQuestion: "", thumbQuery: "",
    description: "", tags: [],
    // 그래픽은 첫·마지막 챕터를 빼고 중반 이후에만 허용된다 → 5챕터의 3번째에 둔다
    chapters: [
      { heading: "도입", visualQuery: "", segments: [seg("도입")] },
      { heading: "배경", visualQuery: "", segments: [seg("배경")] },
      { heading: "본문", visualQuery: "", segments: [seg("본문", visual)] },
      { heading: "본문2", visualQuery: "", segments: [seg("본문2")] },
      { heading: "마무리", visualQuery: "", segments: [seg("마무리")] },
    ],
  } as LongformScript;
}

const REAL_QUOTE = "이 사고로 주민 약 1700명이 사망했고 가축 3500마리가 함께 죽었다.";

type Case = [name: string, shouldPass: boolean, visual: Visual];
const CASES: Case[] = [
  ["원문 그대로 두 수 (통과해야 함)", true, {
    kind: "quantity", title: "사망 규모",
    claims: [
      { text: "주민 사망", value: 1700, unit: "명", role: "사망자", source: { quote: REAL_QUOTE } },
      { text: "가축 폐사", value: 3500, unit: "마리", role: "가축", source: { quote: REAL_QUOTE } },
    ],
  }],
  ["수 하나만 (통과해야 함)", true, {
    kind: "quantity", title: "사망 규모",
    claims: [{ text: "주민 사망", value: 1700, unit: "명", role: "사망자", source: { quote: REAL_QUOTE } }],
  }],
  ["원문에 없는 숫자", false, {
    kind: "quantity",
    claims: [{ text: "주민 사망", value: 1746, unit: "명", role: "사망자", source: { quote: REAL_QUOTE } }],
  }],
  ["인용 자체가 원문에 없음(지어낸 문장)", false, {
    kind: "quantity",
    claims: [{ text: "주민 사망", value: 1700, unit: "명", role: "사망자",
      source: { quote: "이 사고로 주민 1700명이 질식해 숨졌다고 정부가 발표했다." } }],
  }],
  ["연도에서 숫자를 긁어옴 (1986)", false, {
    kind: "quantity",
    claims: [{ text: "경과", value: 1986, unit: "년", role: "경과",
      source: { quote: "1986년 8월 21일 카메룬 니오스호에서 다량의 이산화탄소가 분출했다." } }],
  }],
  ["실명·지명이 화면 글자에 들어감", false, {
    kind: "quantity",
    claims: [{ text: "니오스호 주민 사망", value: 1700, unit: "명", role: "사망자", source: { quote: REAL_QUOTE } }],
  }],
  ["역할어가 허용 목록 밖", false, {
    kind: "quantity",
    claims: [{ text: "주민 사망", value: 1700, unit: "명", role: "희생된 사람들", source: { quote: REAL_QUOTE } }],
  }],
  ["화면 글자가 인용과 무관", false, {
    kind: "quantity",
    claims: [{ text: "정부 은폐 규모", value: 1700, unit: "명", role: "사망자", source: { quote: REAL_QUOTE } }],
  }],
  ["부정 표현이 뒤집힘", false, {
    kind: "quantity",
    claims: [{ text: "외상이 있었다", value: 4, unit: "명", role: "생존자",
      source: { quote: "생존자 4명은 외상이 전혀 없었다고 진술했다." } }],
  }],
  ["지원하지 않는 종류", false, {
    kind: "relation",
    claims: [{ text: "주민 사망", value: 1700, unit: "명", role: "사망자", source: { quote: REAL_QUOTE } }],
  }],
  ["수가 3개 (상한 초과)", false, {
    kind: "quantity",
    claims: [
      { text: "주민 사망", value: 1700, unit: "명", role: "사망자", source: { quote: REAL_QUOTE } },
      { text: "가축 폐사", value: 3500, unit: "마리", role: "가축", source: { quote: REAL_QUOTE } },
      { text: "생존 진술", value: 4, unit: "명", role: "생존자", source: { quote: REAL_QUOTE } },
    ],
  }],
];

let bad = 0;
for (const [name, shouldPass, visual] of CASES) {
  const s = script(visual);
  const drops = normalizeVisuals(s, SOURCES, CASE.title);
  const passed = !!s.chapters[2].segments[0].frame?.visual;
  const ok = passed === shouldPass;
  if (!ok) bad++;
  const reason = drops[0]?.reason ?? "";
  console.log(`${ok ? "OK " : "!! "} ${passed ? "채택" : "폐기"}  ${name}${reason ? `  — ${reason}` : ""}`);
}

// 서로 다른 인용의 두 수는 막대를 그리면 안 된다 (원문에 없는 비교가 된다)
{
  const s = script({
    kind: "quantity",
    claims: [
      { text: "주민 사망", value: 1700, unit: "명", role: "사망자", source: { quote: REAL_QUOTE } },
      { text: "조사 도착", value: 2, unit: "일", role: "경과",
        source: { quote: "조사단은 사고 2일 뒤에 현장에 도착했다." } },
    ],
  });
  normalizeVisuals(s, SOURCES, CASE.title);
  const mode = s.chapters[2].segments[0].frame?.visual?.mode;
  const ok = mode === "pair-nobar";
  if (!ok) bad++;
  console.log(`${ok ? "OK " : "!! "} 다른 인용의 두 수 → 막대 없음 (실제: ${mode ?? "폐기"})`);
}

// 원문이 '추정'이라고 한 것은 화면에서도 단정하면 안 된다
{
  const s = script({
    kind: "quantity",
    claims: [{ text: "화산 활동 원인", value: 1700, unit: "명", role: "사망자",
      source: { quote: "일부 학자는 호수 바닥의 화산 활동이 원인이라고 추정한다." } }],
  });
  normalizeVisuals(s, SOURCES, CASE.title);
  const v = s.chapters[2].segments[0].frame?.visual;
  const ok = !v || v.claims[0].confidence === "hedged";
  if (!ok) bad++;
  console.log(`${ok ? "OK " : "!! "} 원문이 '추정' → hedged 또는 폐기 (실제: ${v?.claims[0].confidence ?? "폐기"})`);
}

console.log(bad ? `\n기대와 다른 케이스 ${bad}건` : "\n전부 기대대로");
process.exit(bad ? 1 : 0);
