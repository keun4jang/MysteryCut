import { config } from "../config.js";
import { generateStructured } from "../lib/llm.js";
import { findSensitiveTerms, softenText } from "../lib/safeText.js";
import { sourcesPromptBlock, type SourceDoc } from "../lib/sources.js";
import { LongformScriptSchema, type LongformScript } from "../types.js";
import type { CaseProbe } from "./producer.js";

/**
 * 롱폼(가로형 사건 분석 다큐) 대본 생성.
 *
 * ★쇼츠 대본을 늘려 쓰는 것이 가장 흔한 실패다. '사건 → 의문 → 반전'을 8분으로
 * 늘리면 중간 5분이 전부 배경 설명이 되어 시청자가 빠진다. 그래서 구조 자체를
 * 바꾼다: 확인된 사실과 나중에 드러난 문제를 구분하고, 가설을 비교하고,
 * 각 챕터에 화면으로 띄울 자료(타임라인·인물·증거·가설)를 데이터로 받는다.
 *
 * 이 구조는 시청 지속률뿐 아니라 수익창출 심사에도 필요하다. 유튜브는
 * '해설이나 교육적 가치가 부족한 이미지 슬라이드쇼'를 부적합 사례로 든다.
 */

/** 러닝타임 기준 — 롱폼은 나레이션을 느리게 읽어서(+8%) 초당 약 7.7자 */
const MIN_CHARS = 2400;
const IDEAL_CHARS = 2900;
const MAX_CHARS = 3400;

export interface LongformOptions {
  /** 1단계에서 확정된 사건 */
  forcedCase: CaseProbe;
  /** 위키백과 원문 — 사실은 전부 여기서만 */
  sources: SourceDoc[];
  /** 이미 다룬 사건(중복 회피 안내용) */
  avoidTitles?: string[];
}

export async function writeLongform(opts: LongformOptions): Promise<LongformScript> {
  const system = [
    `너는 ${config.channel.language} 시사·사건 다큐멘터리의 작가다. 방송 다큐(그것이 알고 싶다, PD수첩, BBC Panorama)의 구성법으로 6~8분짜리 '사건 분석' 대본을 쓴다.`,
    "출력은 LongformScript JSON 하나다.",
    "",
    "[★이번 회차 사건 — 바꾸지 마라]",
    `- 사건: ${opts.forcedCase.title}`,
    `- 개요: ${opts.forcedCase.premise}`,
    sourcesPromptBlock(opts.sources),
    "",
    "[★주 시청자층]",
    "실측: 45세 이상이 87%(55~64세 35%, 65세 이상 30%). 남성 58%. 한국 65%.",
    "- 어려운 외래어·영어 약어 대신 쉬운 우리말. 굳이 쓰면 한 번 풀어 설명하라.",
    "- 인물은 이름을 여러 개 늘어놓지 말고 '남편', '첫 번째 목격자', '담당 형사'처럼 역할로 불러라. 이름이 꼭 필요하면 영상 전체에서 3명까지만.",
    "- 사건 관계를 중간중간 다시 정리해줘라. 한 번 놓치면 끝까지 못 따라온다.",
    "- 자극적인 묘사보다 '왜 설명이 안 되는가'의 논리로 끌고 가라.",
    "",
    "[★구성 — 챕터 7~9개. 아래 순서를 지켜라]",
    "1) 콜드 오픈: 사건의 가장 큰 모순을 먼저 던진다. 배경 설명 없이 바로. cardKind='none'.",
    "   예: 'DNA는 한 여성을 범인으로 지목했습니다. 그런데 그 여성은 존재하지 않았습니다.'",
    "2) 오늘의 질문: 이 영상에서 확인할 것 2~3가지를 예고한다. cardKind='none'.",
    "3) 배경: 연도·장소·등장인물·사건이 알려진 계기. cardKind='persons', cardItems 에 인물 3~5명(label=호칭, main=이 사건에서의 역할).",
    "4) 시간순 재구성: 사건의 전개를 순서대로. cardKind='timeline', cardItems 에 6~9개(label=시점(연도·날짜·시각), main=그때 무슨 일이 있었는지 한 줄).",
    "5) 핵심 증거와 모순: cardKind='evidence', cardItems 에 3~5개.",
    "   label=증거 이름, main=확인된 사실, sub=나중에 드러난 문제점. 이 챕터가 쇼츠와 롱폼을 가르는 핵심이다.",
    "6) 가설 비교: cardKind='theories', cardItems 에 2~4개.",
    "   label=가설 이름(사고 / 계획된 범죄 / 기록 오류 등), main=이 가설로 설명되는 점, sub=이 가설로 설명 안 되는 점.",
    "7) 결론 또는 현재 상태: 공식 결론과 아직 남은 의문. cardKind='none'.",
    "8) 마무리: 시청자에게 번호로 답하는 선택형 질문. cardKind='none'.",
    "   예: '여러분은 몇 번이라고 보십니까. 1번 사고, 2번 계획된 범죄, 3번 기록의 오류.'",
    "   ★'구독·팔로우·채널' 같은 말은 절대 쓰지 마라. '좋아요'와 '댓글'만 쓴다.",
    "",
    "[★분량]",
    `- 모든 챕터 segments 의 text 글자수 합계가 공백 포함 ${MIN_CHARS}~${MAX_CHARS}자(목표 ${IDEAL_CHARS}자).`,
    "- 챕터당 segments 5~10개. 한 segment 는 한 문장(대략 25~45자). 화면 자막 한 장이 된다.",
    "- 문장에 쉼표를 3개 이상 넣지 마라. 귀로 들으면 따라오지 못한다.",
    "",
    "[★자료 카드 작성 규칙 — 화면에 그대로 뜨는 글자다]",
    "- label 은 12자 이내, main 은 34자 이내, sub 는 34자 이내로 짧게. 길면 화면에서 잘린다.",
    "- 나레이션이 그 항목을 말하는 순서와 cardItems 순서를 일치시켜라. 항목이 하나씩 등장한다.",
    "- 카드에 넣는 내용은 나레이션과 똑같은 문장이면 안 된다. 나레이션은 풀어서 말하고, 카드는 요약이다.",
    "",
    "[★사실 정확성 — 이 채널의 생명줄]",
    "- 원문에 없는 연도·인명·지명·수치를 지어내지 마라. 확인 안 되면 아예 빼라.",
    "- 원문이 '추정', '주장', '설'이라고 한 것을 사실로 단정하지 마라.",
    "- 원문에 조작·해명·공식 결론이 있으면 반드시 포함하라. 빼면 시청자가 댓글로 지적한다.",
    "- 등장인물의 속마음·동기를 사실처럼 서술하지 마라. '법원은 …라고 판단했습니다' 처럼 판단 주체를 밝혀라.",
    "",
    "[★제목·썸네일]",
    "- title: 25자 안팎. '미스터리'로 끝나는 틀을 쓰지 마라. 모순·질문·판결·증거 중 하나를 앞세워라.",
    "  예: 'DNA가 가리킨 범인은 존재하지 않았다' / '죽은 아들이 법정에 나타난 날'",
    "- thumbTitle: 4~8자씩 최대 2줄, 줄바꿈은 실제 개행(\\n)으로. 예: '존재하지 않은\\n범인'",
    "- thumbBadge: 4~8자 소재 분류. 사건 성격과 일치해야 한다(미제/법정/역사/괴담 등).",
    "- centralQuestion: 이 영상이 답할 질문 한 문장(25자 안팎). 도입부 화면에 뜬다.",
    "",
    "[★안전]",
    "- 자살·자해·극단적 선택·투신·음독 같은 표현 금지(연령제한 유발). '타살 혐의점을 찾지 못했다'처럼 중립적으로.",
    "- 성행위·신체 묘사 금지. 불륜은 '부정한 관계', '내연 관계' 같은 판결문 어투로.",
    "- 생존 인물이 특정되는 최근 사건은 다루지 마라. 실명·정확한 지역명(시·군·구·동)·정확한 날짜는 피하고 연도까지만.",
    "",
    "[description] 사건 요약 3~4문장 + 이 영상에서 다루는 쟁점. 해시태그(#) 금지. 마지막 줄에 '※ 실제 사건 기록을 바탕으로 재구성했습니다. 영상 속 이미지는 자료 이미지입니다.'",
    "[tags] # 없이 검색 키워드 8~12개.",
    opts.avoidTitles?.length
      ? `\n[이미 다룬 사건 — 겹치지 마라] ${opts.avoidTitles.slice(-40).join(" / ")}`
      : "",
  ].join("\n");

  let best: LongformScript | undefined;
  let bestGap = Number.POSITIVE_INFINITY;
  let feedback = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const script = (await generateStructured({
      schema: LongformScriptSchema,
      system,
      user: `위 사건으로 6~8분짜리 사건 분석 다큐 대본을 만들어줘.${feedback}`,
      temperature: 0.9,
      maxRetries: 1,
    })) as LongformScript;

    sanitize(script);
    const chars = totalChars(script);
    const flagged = findSensitiveTerms(collectTexts(script));
    const gap = Math.abs(chars - IDEAL_CHARS);
    if (gap < bestGap) {
      best = script;
      bestGap = gap;
    }
    console.log(
      `   📝 롱폼 대본 ${chars}자 / 챕터 ${script.chapters.length}개 / 컷 ${countSegments(script)}개`,
    );
    if (!flagged.length && chars >= MIN_CHARS && chars <= MAX_CHARS) return script;

    feedback = "";
    if (flagged.length) {
      console.warn(`   ⚠️ 연령제한 위험 표현(${flagged.join(", ")}) — 재생성`);
      feedback += `\n★직전 시도에 연령제한을 유발하는 표현(${flagged.join(", ")})이 있었다. 사실은 유지하되 중립 표현으로 다시 써라.`;
    }
    if (chars < MIN_CHARS || chars > MAX_CHARS) {
      const dir = chars < MIN_CHARS ? "부족" : "초과";
      console.warn(`   ⚠️ 분량 ${dir}(${chars}자) — 재생성`);
      feedback += `\n★직전 대본이 ${chars}자로 ${dir}했다(목표 ${IDEAL_CHARS}자). ${
        chars > MAX_CHARS
          ? "곁가지를 쳐내고 핵심 줄기만 남겨라."
          : "증거 검토와 가설 비교를 한 겹 더 파서 채워라. 같은 말 반복으로 늘리면 실패다."
      }`;
    }
  }

  const leftover = findSensitiveTerms(collectTexts(best!));
  if (leftover.length) {
    soften(best!);
    console.warn(`   ⚠️ 재생성에도 위험 표현 잔존(${leftover.join(", ")}) — 자동 중립화`);
  }
  return best!;
}

export function totalChars(s: LongformScript): number {
  return s.chapters.reduce((n, c) => n + c.segments.reduce((m, g) => m + g.text.length, 0), 0);
}

export function countSegments(s: LongformScript): number {
  return s.chapters.reduce((n, c) => n + c.segments.length, 0);
}

function collectTexts(s: LongformScript): string[] {
  return [
    s.title,
    s.thumbTitle,
    s.centralQuestion,
    s.description,
    ...s.chapters.flatMap((c) => [
      c.heading,
      ...c.segments.map((g) => g.text),
      ...c.cardItems.flatMap((i) => [i.label, i.main, i.sub ?? ""]),
    ]),
  ];
}

function soften(s: LongformScript): void {
  s.title = softenText(s.title);
  s.thumbTitle = softenText(s.thumbTitle);
  s.centralQuestion = softenText(s.centralQuestion);
  s.description = softenText(s.description);
  for (const c of s.chapters) {
    c.heading = softenText(c.heading);
    for (const g of c.segments) g.text = softenText(g.text);
    for (const i of c.cardItems) {
      i.label = softenText(i.label);
      i.main = softenText(i.main);
      if (i.sub) i.sub = softenText(i.sub);
    }
  }
}

/** LLM 이 줄바꿈을 '\n' 두 글자로 내보내는 문제 정리 (쇼츠와 동일) */
function sanitize(s: LongformScript): void {
  const toBreaks = (t: string) =>
    (t ?? "")
      .replace(/\\+n/g, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const toSpace = (t: string) => toBreaks(t).replace(/\s*\n\s*/g, " ").trim();

  s.title = toSpace(s.title);
  s.thumbTitle = toBreaks(s.thumbTitle);
  s.thumbBadge = toSpace(s.thumbBadge);
  s.centralQuestion = toSpace(s.centralQuestion);
  s.description = toBreaks(s.description);
  s.tags = (s.tags ?? []).map((t) => toSpace(t).replace(/^#/, ""));
  for (const c of s.chapters) {
    c.heading = toSpace(c.heading);
    c.visualQuery = toSpace(c.visualQuery);
    for (const g of c.segments) g.text = toSpace(g.text);
    for (const i of c.cardItems) {
      i.label = toSpace(i.label);
      i.main = toSpace(i.main);
      if (i.sub) i.sub = toSpace(i.sub);
    }
  }
}
