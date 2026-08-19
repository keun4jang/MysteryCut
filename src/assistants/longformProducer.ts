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

/**
 * 러닝타임 기준.
 *
 * 실측(2026-08-19 첫 드라이런): 2,295자 / 69컷 → 324초. 즉 호흡까지 포함해
 * **초당 7.08자**다. 처음에 7.7자/초로 잡았더니 5분 24초가 나와 목표(6~8분)에
 * 미달했다. 실측값으로 다시 계산한다:
 *   6분(360초) ≈ 2,550자 / 7분(420초) ≈ 2,975자 / 8분(480초) ≈ 3,400자
 */
const MIN_CHARS = 2600;
const IDEAL_CHARS = 3000;
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
    "[★화면 구조 — 이게 이 대본의 핵심이다]",
    "이 영상은 화면이 두 종류뿐이다. 각 문장(segment)이 어느 쪽인지 네가 정한다.",
    "  · **내레이션 화면** — frame 없음. 배경 사진 위에 그 문장이 하단 자막으로만 뜬다.",
    "  · **자료 화면** — frame 있음. 그 문장이 화면 한가운데 아주 크게 뜨고, 위에 분류(label)가 붙는다.",
    "    ★자료 화면에는 하단 자막이 따로 없다. 그 문장 자체가 화면이다.",
    "",
    "그래서 frame 을 붙인 문장은 **화면에 크게 띄워도 말이 되는 완결된 한 문장**이어야 한다.",
    "  좋은 예: '찻잔에서 독성 물질이 검출됐습니다.' / '그 여성은 존재하지 않았습니다.'",
    "  나쁜 예: '그리고 그 다음이 문제였는데요.' (화면에 크게 띄울 내용이 아니다)",
    "",
    "[★frame 종류와 label]",
    "  question — 2번 챕터에서 이 영상의 핵심 질문 한 문장에만. label 은 '오늘 확인할 것'",
    "  timeline — label 은 시점만. '1948년 1월 26일' / '1948년'. 시각·설명은 label 에 넣지 마라.",
    "  person   — label 은 역할. '핵심 인물' / '첫 목격자' / '담당 검사'",
    "  evidence — label 은 '증거 01' 처럼 번호. 그 챕터 안에서 1부터 순서대로.",
    "  theory   — label 은 '가설 1' / '가설 2'",
    "  problem  — label 은 '남은 문제' / '설명 안 되는 점' / '기록 불일치'",
    "  verdict  — label 은 '공식 결론' / '법원의 판단'",
    "  support(선택) — 본문 아래 한 줄 더. 30자 이내. 없어도 되면 넣지 마라.",
    "",
    "[★★반박은 같은 화면에 넣지 말고 다음 문장으로 분리하라]",
    "예전에는 한 항목에 '확인된 사실'과 '그러나 …'를 같이 넣었다. 화면이 경고문처럼 보이고",
    "글자도 작아진다. 이제는 두 문장으로 나눠라:",
    "  문장 A (frame evidence, label '증거 02') '찻잔에서 독성 물질이 검출됐습니다.'",
    "  문장 B (frame problem,  label '남은 문제') '하지만 지문은 하나도 나오지 않았습니다.'",
    "",
    "[★구성 — 챕터 8개. 아래 순서를 지켜라]",
    "1) 콜드 오픈: 사건의 가장 큰 모순을 먼저 던진다. 전부 내레이션 화면(frame 없음).",
    "2) 오늘의 질문: 확인할 것 2~3가지를 예고한다. 그중 **핵심 질문 한 문장에만** question frame 을 붙이고 나머지는 내레이션 화면.",
    "3) 배경: 연도·장소·인물. person frame 3~4개 + 내레이션 문장들.",
    "4) 시간순 재구성: timeline frame 5~7개(각각 다른 시점). 사이사이 내레이션 문장.",
    "5) 핵심 증거: evidence frame 3~4개 + 각각의 반박을 problem frame 으로.",
    "6) 가설 비교: theory frame 2~3개 + 각 가설의 problem frame.",
    "7) 결론: verdict frame 1~2개 + 아직 남은 의문 problem frame 1개.",
    "8) 마무리: 번호로 답하는 선택형 질문. 전부 내레이션 화면.",
    "   ★'구독·팔로우·채널' 금지. '좋아요'와 '댓글'만 쓴다.",
    "",
    "[★frame 비율] 전체 문장의 45~60%에 frame 을 붙여라. 너무 적으면 배경 사진만 흐르는",
    "슬라이드쇼가 되고(유튜브가 수익창출 부적합으로 드는 형태다), 너무 많으면 쉴 틈 없이",
    "정보만 쏟아진다. 1·2·8번 챕터는 frame 이 아예 없어도 된다.",
    "",
    "[★분량]",
    `- 모든 segments 의 text 글자수 합계가 공백 포함 ${MIN_CHARS}~${MAX_CHARS}자(목표 ${IDEAL_CHARS}자).`,
    "- ★총합을 어림하지 말고 이렇게 맞춰라: **챕터 8개 × 문장 10~12개 × 한 문장 30~38자**",
    `  (8 × 11 × 34 ≈ ${IDEAL_CHARS}자).`,
    "- ★한 문장은 40자를 넘기지 마라. 화면에 크게 띄우면 40자가 두 줄 상한이다.",
    "  40자가 넘을 것 같으면 두 문장으로 쪼개라.",
    "- 쉼표를 3개 이상 넣지 마라. 귀로 들으면 따라오지 못한다.",
    "",
    "[★label·support 작성 규칙 — 화면에 그대로 뜨는 글자다]",
    "- label 12자 이내 / support 30자 이내. 넘으면 화면에서 잘린다.",
    "- support 는 본문을 되풀이하지 마라. 본문이 충분하면 아예 생략하라.",
    "- 화면에 크게 뜨는 것은 본문(text)이다. label 은 그게 무슨 자료인지 알려주는 꼬리표다.",
    "",
    "[★배경 검색어(visualQuery) — 시대 재현을 시도하지 마라]",
    "무료 스톡에는 1948년 도쿄도, 1970년대 서울도 없다. 'vintage Tokyo street 1948' 로 검색하면",
    "현대 사진에 빈티지 필터만 씌운 결과가 나온다. 실측으로 1948년 은행 사건 영상에 현대식",
    "자동차와 우산 쓴 행인 사진이 배경으로 깔렸다. 시청자에게 잘못된 역사적 인상을 준다.",
    "",
    "그래서 visualQuery 는 **사건 재현이 아니라 상징물·분위기**로 써라. 영어 2~5단어.",
    "  좋은 예: 'rainy window dark' / 'typewriter paper close up' / 'empty office vintage desk'",
    "           'glass cup dark table' / 'bank vault detail' / 'old document texture'",
    "           'ink handwriting macro' / 'anonymous silhouette umbrella' / 'iron bars shadow'",
    "  나쁜 예: 'vintage Tokyo street 1948' / 'Japanese bank poisoning 1948' / 'old Seoul court 1930'",
    "- 연도·국가·실제 사건명·인물명을 검색어에 넣지 마라.",
    "- 사람 얼굴이 정면으로 크게 나오는 사진은 피해라(실존 인물로 오해된다).",
    "  필요하면 'silhouette', 'back view', 'hands only' 처럼 익명성을 넣어라.",
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

  for (let attempt = 0; attempt < 3; attempt++) {
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
      const cuts = countSegments(script);
      const perCut = cuts ? Math.round(chars / cuts) : 0;
      const needCuts = Math.max(72, Math.ceil(IDEAL_CHARS / 41));
      feedback += `\n★직전 대본이 ${cuts}컷 / ${chars}자(컷당 평균 ${perCut}자)로 ${dir}했다. 목표는 ${IDEAL_CHARS}자다.
다시 쓸 때는 총합을 어림하지 말고 **컷 ${needCuts}개, 한 컷 38~44자**로 맞춰라(${needCuts} × 41 ≈ ${needCuts * 41}자).
다 쓴 뒤 컷을 하나씩 세어 범위 밖인 것만 고쳐라. ${
        chars > MAX_CHARS
          ? "지금은 곁가지가 많다 — 핵심 줄기만 남겨라."
          : "지금은 문장이 토막나 있다 — 각 컷을 주어와 근거가 있는 온전한 문장으로 채우고, 증거 검토와 가설 비교를 한 겹 더 파라. 같은 말 반복으로 늘리면 실패다."
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
      ...c.segments.flatMap((g) => [g.text, g.frame?.label ?? "", g.frame?.support ?? ""]),
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
    for (const g of c.segments) {
      g.text = softenText(g.text);
      if (g.frame) {
        g.frame.label = softenText(g.frame.label);
        if (g.frame.support) g.frame.support = softenText(g.frame.support);
      }
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
    for (const g of c.segments) {
      g.text = toSpace(g.text);
      if (g.frame) {
        g.frame.label = toSpace(g.frame.label);
        if (g.frame.support) g.frame.support = toSpace(g.frame.support);
      }
    }
  }
}
