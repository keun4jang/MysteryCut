import { config } from "../config.js";
import { generateStructured } from "../lib/llm.js";
import { findSensitiveTerms, softenText } from "../lib/safeText.js";
import { normalizeVisuals } from "../lib/visual/normalize.js";
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
 * **초당 7.08자**다(나레이션 속도는 고정 — 이 값을 건드려서 늘리지 않는다).
 *
 * 러닝타임은 고정 목표가 아니라 **원문이 뒷받침하는 만큼**만 늘린다. 비용은
 * GitHub Actions(공개 저장소라 무료·무제한) · Gemini/edge-tts/Pexels(전부
 * 무료 등급) 어느 쪽도 늘어난 분량 자체에 값을 매기지 않으므로 진짜 상한은
 * '더 말해도 지어내지 않을 수 있는가'뿐이다. 그래서 목표 글자수를 그 회차의
 * 원문 분량(sourceVolume)에 비례해 정하고, MIN~MAX 사이로만 자른다.
 * 얕은 원문을 억지로 채우면 반복(패딩)이나 날조로 이어지므로 floor 는 낮게
 * 두고, 두꺼운 원문(연쇄사건·장기 미제 등)만 ceiling 까지 올라가게 한다.
 *   MIN  2,600자 ≈ 6~7분 (얕은 원문의 하한 — 예전 기본값과 동일)
 *   MAX  6,000자 ≈ 14분 (CI 180분 타임아웃은 이 두 배를 줘도 여유롭다 — 진짜
 *                         병목은 Gemini maxOutputTokens=65536 다. 16k 로는
 *                         3,000자 대본도 중간에 잘렸던 전례가 있어(위 참고),
 *                         컷 수가 많아지는 만큼 JSON 출력도 커진다. 실측으로
 *                         안전 여유를 확인하기 전까지는 이 값을 더 올리지 않는다)
 */
const MIN_CHARS = 2600;
const MAX_CHARS = 6000;
/** 원문 1자당 목표 대본 글자수. 위키 서술을 다 옮기지 않고도 다큐로 재구성하니 1보다 작게 잡는다 */
const CHARS_PER_SOURCE_CHAR = 0.8;

function idealCharsFor(sourceVolume: number): number {
  return Math.min(MAX_CHARS, Math.max(MIN_CHARS, Math.round(sourceVolume * CHARS_PER_SOURCE_CHAR)));
}

export interface LongformOptions {
  /** 1단계에서 확정된 사건 */
  forcedCase: CaseProbe;
  /** 위키백과 원문 — 사실은 전부 여기서만 */
  sources: SourceDoc[];
  /** 이미 다룬 사건(중복 회피 안내용) */
  avoidTitles?: string[];
}

export async function writeLongform(opts: LongformOptions): Promise<LongformScript> {
  const sourceVolume = opts.sources.reduce((n, d) => n + d.extract.length, 0);
  const idealChars = idealCharsFor(sourceVolume);
  const idealMinutes = Math.round((idealChars / 7.08 / 60) * 10) / 10;
  // 챕터 5~12개, 컷 34자 평균으로 역산 — 챕터당 14~20컷 사이가 되도록 챕터 수를 고른다.
  const targetCuts = Math.max(60, Math.round(idealChars / 34));
  const chapterCount = Math.min(12, Math.max(5, Math.round(targetCuts / 17)));
  const cutsPerChapter = Math.round(targetCuts / chapterCount);

  const system = [
    `너는 ${config.channel.language} 시사·사건 다큐멘터리의 작가다. 방송 다큐(그것이 알고 싶다, PD수첩, BBC Panorama)의 구성법으로 '사건 분석' 대본을 쓴다.`,
    `이번 회차 목표는 원문 분량(${sourceVolume}자)에 맞춘 ${idealChars}자(약 ${idealMinutes}분)다 — 회차마다 원문이 뒷받침하는 만큼만 늘어나거나 줄어든다.`,
    "",
    "[★★분량을 늘리는 방법 — 절대 속도나 반복으로 늘리지 마라]",
    "이 채널의 나레이션 속도는 고정이다. 영상을 길게 만드는 유일하게 옳은 방법은",
    "**원문에 있는 새로운 사실을 더 쓰는 것**이다 — 추가 증거, 추가 인물의 진술,",
    "추가 시간대, 추가 반박, 다른 가설. 이미 말한 내용을 다른 표현으로 되풀이해",
    "글자수만 채우는 것은 실패다(재생성 대상이다). 원문에 그만한 사실이 없으면",
    "억지로 늘리지 말고 목표보다 짧게 끝내라 — 지어내는 것보다 짧은 게 낫다.",
    "★그리고 컷이 많아졌다고 뒤로 갈수록 설명문처럼 늘어지면 안 된다. **컷 하나하나가",
    "쇼츠와 똑같이 그 자체로 훅이어야 한다** — 의문을 던지거나, 방금 말한 것을 뒤집거나,",
    "다음 문장을 보고 싶게 만드는 구체적 사실 하나. '배경 설명을 위한 배경 설명'이나",
    "'채우기용 문장'은 컷 수가 아무리 남아도 쓰지 마라.",
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
    "[★구성 — 사건 성격에 맞는 이야기 구조를 골라라]",
    "모든 영상을 같은 8챕터 틀에 넣으면 1년에 100편이 서로 대체 가능해 보인다.",
    "유튜브가 수익창출 부적합 사례로 드는 '템플릿 대량생산'이 바로 그것이다.",
    "아래 넷 중 **이 사건에 가장 맞는 하나**를 골라 그 구조로 써라.",
    "",
    "A) 연대기형 — 시간 흐름이 사건의 핵심일 때 (재난·실종·연쇄사건)",
    "   이전 상황 → 첫 이상 징후 → 확산 → 조사 → 결론 → 남은 문제",
    "B) 조사형 — 단서와 모순이 핵심일 때 (미제사건)",
    "   질문 → 단서 → 모순 → 가설 1 → 가설 2 → 판단",
    "C) 판결 기록형 — 다툼과 판단이 핵심일 때 (법정·유산·명예)",
    "   주장 → 기록 → 반대 기록 → 핵심 쟁점 → 판단 → 이후 영향",
    "D) 전설 검증형 — 전해지는 이야기와 기록이 어긋날 때 (괴담·민담)",
    "   전승 → 변형된 이야기 → 확인된 기록 → 가능한 설명 → 남은 공백",
    "",
    `- 챕터 수는 **약 ${chapterCount}개**(회차 목표 분량에 맞춘 값. 원문에 그만한 사건 전개가`,
    "  없으면 억지로 채우지 말고 줄여도 된다). 구조에 맞게 정하되 개수를 억지로 맞추지 마라.",
    "- 첫 챕터는 사건의 가장 큰 모순을 먼저 던진다(콜드 오픈). 전부 내레이션 화면.",
    "- 마지막 챕터는 번호로 답하는 선택형 질문으로 닫는다. 전부 내레이션 화면.",
    "   ★'구독·팔로우·채널' 금지. '좋아요'와 '댓글'만 쓴다.",
    "- heading 은 14자 이내 한 줄. 화면에 88px 로 뜬다.",
    "",
    "[★한 편의 주된 자료 문법을 하나 정해라]",
    "timeline / evidence+problem / theory / person / verdict 중 **하나를 주연**으로 삼고",
    "나머지는 조연으로 두 종류까지만 쓴다. 매 편 모든 종류를 골고루 쓰면 다 똑같아 보인다.",
    "연대기형이면 timeline 이, 조사형이면 evidence+problem 이, 판결형이면 verdict 가 주연이다.",
    "",
    "[★visual — 사실을 그래픽으로 보여주는 화면]",
    "frame 만 붙이면 그 화면은 '지금 말하는 문장을 100px 로 확대한 것'일 뿐이다.",
    "새 시각 정보가 아니라 자막의 확대판이라, 영상 내내 그것만 반복되면",
    "유튜브가 수익창출 부적합으로 드는 '이미지 슬라이드쇼'와 다를 게 없다.",
    "**수치가 나오는 문장에는 frame 에 visual 을 함께 붙여라.**",
    "",
    "지금 지원하는 종류는 quantity(수치 비교) 하나다. kind 는 'quantity' 로 고정.",
    "- claims 에 수를 1개 또는 2개. 2개면 화면에 막대로 나란히 비교된다.",
    "- 각 claim 에 넣을 것:",
    "  · value  — 숫자. **원문에 그 숫자로 적혀 있는 것만.** 계산하거나 어림하지 마라.",
    "  · unit   — 단위 3자 이내 (명 / 년 / 번 / 건 / 차례 / %)",
    "  · role   — 이 수가 무엇인지. 아래 목록에서만 골라라:",
    "             사망자 / 생존자 / 실종자 / 피해자 / 목격자 / 증인 / 주민 / 승객 /",
    "             직원 / 환자 / 가축 / 재심 청구 / 경과 / 간격 / 조사 기간 / 수색 기간 /",
    "             기록 / 진술 / 신고 / 출동 / 검출 / 불검출 / 건물 / 가구 / 세대",
    "  · text   — 화면에 뜨는 짧은 설명. 실명·지명 금지.",
    "  · source.quote — ★**원문 문장을 글자 그대로 복사**. 요약·의역·번역 금지.",
    "                   코드가 원문과 글자 단위로 대조한다. 한 글자라도 다르면 버려진다.",
    "",
    "★두 수를 나란히 놓으려면 **같은 문장에서 나온 두 수**여야 한다.",
    "  '열여섯 명 중 열두 명이 사망했다' → 16과 12를 함께 놓아도 된다(같은 인용).",
    "  서로 다른 문단의 수를 붙여 놓으면 원문에 없는 비교를 만들어내는 것이다.",
    "★확실하지 않으면 visual 을 아예 붙이지 마라. 빠뜨리는 것이 지어내는 것보다 낫다.",
    "  원문에 없는 숫자를 그래픽으로 그리는 순간 채널이 끝난다.",
    "★첫 챕터와 마지막 챕터에는 visual 을 붙이지 마라.",
    "",
    "[★frame 비율] 전체 문장의 45~60%에 frame 을 붙여라. 너무 적으면 배경 사진만 흐르는",
    "슬라이드쇼가 되고(유튜브가 수익창출 부적합으로 드는 형태다), 너무 많으면 쉴 틈 없이",
    "정보만 쏟아진다. 첫 챕터와 마지막 챕터는 frame 이 아예 없어도 된다.",
    "",
    "[★분량]",
    `- 모든 segments 의 text 글자수 합계가 공백 포함 ${MIN_CHARS}~${MAX_CHARS}자(이번 회차 목표 ${idealChars}자).`,
    `- ★총합을 어림하지 말고 이렇게 맞춰라: **챕터 ${chapterCount}개 × 문장 ${cutsPerChapter}개 안팎 × 한 문장 28~34자**`,
    `  (${chapterCount} × ${cutsPerChapter} × 34 ≈ ${chapterCount * cutsPerChapter * 34}자).`,
    "  ★단, 이 계산은 배분 계획일 뿐이다 — 챕터마다 원문이 뒷받침하는 사실 수가 다르면",
    "  챕터별 문장 수를 계산값과 다르게 가져가도 된다. 억지로 균등 배분하지 마라.",
    "- ★한 문장은 36자를 넘기지 마라. 화면에 100px 로 띄우면 그게 두 줄 상한이다.",
    "- ★frame 이 붙는 문장은 30자 이내로 더 짧게. 자료 화면은 한눈에 읽혀야 한다.",
    "  넘칠 것 같으면 두 문장으로 쪼개고, 뒷 문장에 frame 을 붙여라.",
    "- 쉼표를 3개 이상 넣지 마라. 귀로 들으면 따라오지 못한다.",
    "",
    "[★textEn — 영어 자막]",
    "- 모든 문장에 textEn 을 붙여라. 한국어 문장 바로 아래에 작게 깔린다.",
    "- 직역이 아니라 자연스러운 영어 문장으로. 다큐 나레이션 어투(평서문, 과거형).",
    "- 한 문장당 영어 90자 이내. 넘으면 화면에서 잘린다.",
    "- 한국어 문장 하나 = 영어 문장 하나. 쪼개거나 합치지 마라(자막 싱크가 어긋난다).",
    "- 고유명사·연도는 영어권 표기를 써라(예: 'Strasbourg', '1518').",
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
    "- title: **38~55자.** 형식은 다음과 같다.",
    "  [연도/시대] + [구체적 사물·현상] + [핵심 질문]｜[분류]",
    "  ★검색 가능한 일반 명사를 **앞 22~28자 안에** 넣어라. 뒤로 밀면 검색에 안 걸린다.",
    "  예: '1986년 호수에서 나온 기체는 왜 마을을 덮쳤나｜자연재난 기록'",
    "      '닫힌 방에 남은 두 기록, 어느 쪽이 사실이었나｜판결 기록'",
    "  분류는 '미제사건 기록' / '판결 기록' / '역사 기록' / '전승 검증' 중 하나.",
    "- ★'미스터리'로 끝나는 틀을 쓰지 마라. 답이 밝혀진 사건을 미스터리라고 부르지 마라.",
    "- ★제목과 thumbTitle 이 같은 말을 반복하면 안 된다.",
    "  제목은 **무슨 영상인지 설명**하고, thumbTitle 은 **가장 강한 모순 하나**를 던진다.",
    "  예: 제목 '1986년 호수에서 나온 기체는…' / 썸네일 '외상은 없었다'",
    "",
    "[★thumbTitle — 썸네일에 대문짝만하게 박히는 문구. 조회수를 여기서 번다]",
    "- 형식: 2줄. 실제 개행(\\n)으로 나눠라. **1줄은 6~10자, 2줄(마지막 줄)은 3~6자** (공백 포함).",
    "  마지막 줄은 빨간 박스로 강조된다. 6자를 넘으면 강조가 풀리므로 반드시 짧게 끊어라.",
    "  ★너무 짧아도 안 된다. '명함\\n한 장'처럼 두 줄 합쳐 5자면 화면이 텅 비고 사건이 안 읽힌다.",
    "  같은 소재라도 '그가 남긴 것은\\n명함 한 장'처럼 앞줄에 맥락을 실어라. 합쳐서 10자 이상.",
    "- 마지막 줄에 **핵심 명사**를 놓아라. 꾸밈말로 끝내지 마라.",
    "  좋다: '존재하지 않은\\n예방약' / '아무도 못 본\\n세 번째 손' — 마지막이 사물·인물이다.",
    "  나쁘다: '예방약을\\n나눠 주었다' — 마지막이 서술어라 남는 인상이 없다.",
    "- 다음 넷 중 **최소 하나**를 반드시 써라. 둘을 겹치면 더 좋다.",
    "  ① 숫자 — '열두 명이\\n마신 것' / '37년 만에\\n나온 이름'",
    "     (가장 강력하다. 사람 수·햇수·증거 번호처럼 원문에 있는 숫자를 그대로 써라)",
    "  ② 모순 — '범인 없는\\n살인' / '죽은 사람의\\n지문' / '존재하지 않은\\n예방약'",
    "  ③ 부정 — '끝내 안 열린\\n금고' / '돌아오지 못한\\n열두 명'",
    "  ④ 사물 하나 — '그가 남긴 것은\\n명함 한 장' / '찻잔에 남아 있던\\n가루'",
    "- ★금지어: 충격, 경악, 소름, 역대급, 실화냐, 미친, 대반전, 무서운, 레전드.",
    "  이 채널 시청자는 45세 이상이 87%다. 이런 낱말은 유치해 보여 오히려 안 눌린다.",
    "  게다가 유튜브는 '오해를 부르는 메타데이터'를 수익창출 감점 사유로 든다.",
    "- ★영상이 실제로 답하지 않는 것을 쓰지 마라. 낚시는 시청 지속시간을 무너뜨린다.",
    "  thumbTitle 의 내용은 반드시 chapters 안에서 다뤄져야 한다.",
    "- 물음표를 쓰지 마라. 단정적인 명사구가 더 세다(질문은 centralQuestion 이 맡는다).",
    "- 사건명·인명·지명을 쓰지 마라. 몰라도 궁금해지는 문구여야 한다.",
    "",
    "- thumbBadge: 4~8자 소재 분류. 사건 성격과 일치해야 한다(미제/법정/역사/괴담 등).",
    "  빨간 배지로 뜬다. '실화 미제사건' / '역사 미스터리' / '판결 기록' 처럼 담백하게.",
    "- centralQuestion: 이 영상이 답할 질문 한 문장(25자 안팎). 도입부 화면에 뜬다.",
    "- thumbQuery: 썸네일 배경 사진 검색어(영어 2~4단어). ★챕터 배경과 기준이 다르다.",
    "  챕터 배경은 '분위기'면 되지만 썸네일은 **thumbTitle 과 직결된 상징물**이어야 한다.",
    "  thumbTitle 이 '존재하지 않은 예방약'이면 'empty glass vial dark' 처럼 그 물건을 찍어라.",
    "  좋은 예: 'empty glass vial dark' / 'locked iron door' / 'torn document close up'",
    "           'single teacup shadow' / 'muddy shoe print' / 'burning letter'",
    "  나쁜 예: 'sad family beach' / 'moody landscape' / 'dark forest'",
    "  (실측: 독살 사건 썸네일에 해변 가족사진이 걸렸다. 분위기 사진은 썸네일에서 클릭을 못 만든다.)",
    "  사람 얼굴·연도·실제 지명은 넣지 마라. 사물 하나를 클로즈업하는 검색어가 가장 잘 걸린다.",
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
      user: `위 사건으로 목표 ${idealChars}자(약 ${idealMinutes}분)짜리 사건 분석 다큐 대본을 만들어줘.${feedback}`,
      temperature: 0.9,
      maxRetries: 1,
    })) as LongformScript;

    sanitize(script);
    const chars = totalChars(script);
    const flagged = findSensitiveTerms(collectTexts(script));
    const thumbIssues = thumbTitleIssues(script.thumbTitle);
    const gap = Math.abs(chars - idealChars);
    if (gap < bestGap) {
      best = script;
      bestGap = gap;
    }
    console.log(
      `   📝 롱폼 대본 ${chars}자 / 챕터 ${script.chapters.length}개 / 컷 ${countSegments(script)}개`,
    );
    console.log(`   🖼️  썸네일 문구 "${script.thumbTitle.replace(/\n/g, " / ")}" (${script.thumbBadge})`);
    if (!flagged.length && !thumbIssues.length && chars >= MIN_CHARS && chars <= MAX_CHARS) {
      applyVisualGates(script, opts.sources, opts.forcedCase.title);
      return script;
    }

    feedback = "";
    if (flagged.length) {
      console.warn(`   ⚠️ 연령제한 위험 표현(${flagged.join(", ")}) — 재생성`);
      feedback += `\n★직전 시도에 연령제한을 유발하는 표현(${flagged.join(", ")})이 있었다. 사실은 유지하되 중립 표현으로 다시 써라.`;
    }
    if (thumbIssues.length) {
      console.warn(`   ⚠️ 썸네일 문구 문제: ${thumbIssues.join(" / ")} — 재생성`);
      feedback += `\n★직전 thumbTitle "${script.thumbTitle.replace(/\n/g, "\\n")}"에 문제가 있었다: ${thumbIssues.join(" / ")}.
thumbTitle 규칙을 다시 읽고 고쳐라. 대본 내용은 그대로 둬도 된다.`;
    }
    if (chars < MIN_CHARS || chars > MAX_CHARS) {
      const dir = chars < MIN_CHARS ? "부족" : "초과";
      console.warn(`   ⚠️ 분량 ${dir}(${chars}자) — 재생성`);
      const cuts = countSegments(script);
      const perCut = cuts ? Math.round(chars / cuts) : 0;
      const needCuts = Math.max(60, Math.ceil(idealChars / 41));
      feedback += `\n★직전 대본이 ${cuts}컷 / ${chars}자(컷당 평균 ${perCut}자)로 ${dir}했다. 목표는 ${idealChars}자다.
다시 쓸 때는 총합을 어림하지 말고 **컷 ${needCuts}개, 한 컷 38~44자**로 맞춰라(${needCuts} × 41 ≈ ${needCuts * 41}자).
다 쓴 뒤 컷을 하나씩 세어 범위 밖인 것만 고쳐라. ${
        chars > MAX_CHARS
          ? "지금은 곁가지가 많다 — 핵심 줄기만 남겨라."
          : "지금은 문장이 토막나 있다 — 각 컷을 주어와 근거가 있는 온전한 문장으로 채우고, 증거 검토와 가설 비교를 한 겹 더 파라. ★원문에 정말 그만한 사실이 없으면 억지로 채우지 마라 — 같은 말 반복이나 지어낸 디테일로 늘리면 실패다."
      }`;
    }
  }

  applyVisualGates(best!, opts.sources, opts.forcedCase.title);
  const leftover = findSensitiveTerms(collectTexts(best!));
  if (leftover.length) {
    soften(best!);
    console.warn(`   ⚠️ 재생성에도 위험 표현 잔존(${leftover.join(", ")}) — 자동 중립화`);
  }
  return best!;
}

/** 썸네일 문구에서 걸러야 하는 낚시 상투어 — 45세 이상 시청자에게는 역효과다 */
const THUMB_BANNED = /충격|경악|소름|역대급|실화냐|미친|대반전|무서운|레전드|헐/;

/**
 * thumbTitle 품질 점검.
 *
 * 프롬프트에 규칙을 써 두는 것만으로는 매번 지켜지지 않는다(실측: 분량 규칙도
 * 어겼다). 썸네일 문구는 조회수를 좌우하는데 사람이 매 회차 눈으로 볼 수 없으니
 * 여기서 재서 문제가 있으면 재생성 피드백에 실어 보낸다.
 *
 * 렌더 쪽 규칙(LongformDoc 의 THUMB_BOX_MAX=6)과 숫자를 맞춰야 한다 —
 * 마지막 줄이 6자를 넘으면 빨간 박스 강조가 풀린다.
 */
export function thumbTitleIssues(thumbTitle: string): string[] {
  const lines = (thumbTitle ?? "")
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const issues: string[] = [];

  if (lines.length !== 2) {
    issues.push(`2줄이어야 하는데 ${lines.length}줄이다`);
  }
  const first = lines[0] ?? "";
  const last = lines[lines.length - 1] ?? "";
  if (last.length > 6) {
    issues.push(`마지막 줄 "${last}"이 ${last.length}자다(6자 이내여야 빨간 박스 강조가 걸린다)`);
  }
  // 너무 짧으면 화면이 비고 사건이 안 읽힌다 ('명함 / 한 장' = 5자)
  if (lines.length === 2 && first.length < 6) {
    issues.push(`1줄 "${first}"이 ${first.length}자로 짧다(6~10자여야 한다)`);
  }
  if (first.length > 10) {
    issues.push(`1줄 "${first}"이 ${first.length}자로 길다(6~10자여야 한다)`);
  }
  if (last.length < 3) {
    issues.push(`마지막 줄 "${last}"이 ${last.length}자로 짧다(3~6자여야 한다)`);
  }
  if (/[?？]/.test(thumbTitle)) issues.push("물음표가 들어 있다");
  const banned = THUMB_BANNED.exec(thumbTitle);
  if (banned) issues.push(`낚시 상투어 "${banned[0]}"가 들어 있다`);
  // 숫자·모순·부정 중 하나는 있어야 한다 — 둘 다 없으면 밋밋한 문구다.
  // 한글 수사는 낱말만 보면 '조용한'의 '한'까지 숫자로 잡히므로 단위(명·장·번…)를
  // 뒤에 달고 있을 때만 숫자로 센다.
  const COUNTER = "명|개|장|번|년|달|시간|구|통|건|줄|점|병|잔|자루|차례|번째|가지|사람|밤|살";
  const hasNumber =
    /[0-9]/.test(thumbTitle) ||
    new RegExp(`(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|열한|열두|스물|백|천|만)\\s*(${COUNTER})`).test(
      thumbTitle,
    );
  const hasContrast = /없|않|못|아닌|사라진|지워진|빈|끝내|안 /.test(thumbTitle);
  if (!hasNumber && !hasContrast) {
    issues.push("숫자도 모순·부정 표현도 없다(둘 중 하나는 반드시 필요하다)");
  }
  return issues;
}

/**
 * 원문 대조 게이트를 태우고 결과를 로그로 남긴다.
 *
 * 폐기 사유를 안 찍으면 채택률이 0인 것을 몇 달간 모른다. 그래픽이 하나도
 * 안 붙는데 "잘 돌고 있다"고 착각하는 것이 가장 나쁘다.
 */
function applyVisualGates(script: LongformScript, sources: SourceDoc[], probeTitle: string): void {
  const before = countVisuals(script);
  const drops = normalizeVisuals(script, sources, probeTitle);
  const after = countVisuals(script);
  if (!before) {
    console.log("   📐 그래픽 없음 (모델이 visual 을 안 붙였다)");
    return;
  }
  console.log(`   📐 그래픽 ${after}/${before}개 채택`);
  for (const d of drops) {
    console.log(`      ✗ 챕터${d.chapter + 1} 컷${d.segment + 1} ${d.kind}: ${d.reason}`);
  }
}

function countVisuals(s: LongformScript): number {
  return s.chapters.reduce(
    (n, c) => n + c.segments.filter((g) => g.frame?.visual).length,
    0,
  );
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
      ...c.segments.flatMap((g) => [
        g.text,
        g.textEn ?? "",
        g.frame?.label ?? "",
        g.frame?.support ?? "",
        ...visualTexts(g.frame),
      ]),
    ]),
  ];
}

/**
 * 화면에 뜨는 그래픽 글자들.
 * ★ source.quote 는 절대 포함하면 안 된다 — 순화하거나 줄바꿈을 정리하면
 *   원문과의 글자 단위 대조가 깨져서 그래픽이 전부 폐기된다.
 */
function visualTexts(frame?: LongformScript["chapters"][0]["segments"][0]["frame"]): string[] {
  const v = frame?.visual;
  if (!v) return [];
  return [v.title ?? "", ...(v.claims ?? []).flatMap((c) => [c.text ?? "", c.role ?? ""])];
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
      g.textEn = softenText(g.textEn ?? "");
      if (g.frame?.visual) {
        const v = g.frame.visual;
        if (v.title) v.title = softenText(v.title);
        for (const c of v.claims ?? []) {
          c.text = softenText(c.text ?? "");
          if (c.role) c.role = softenText(c.role);
        }
      }
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
  s.thumbQuery = toSpace(s.thumbQuery ?? "");
  s.description = toBreaks(s.description);
  s.tags = (s.tags ?? []).map((t) => toSpace(t).replace(/^#/, ""));
  for (const c of s.chapters) {
    c.heading = toSpace(c.heading);
    c.visualQuery = toSpace(c.visualQuery);
    for (const g of c.segments) {
      g.text = toSpace(g.text);
      g.textEn = toSpace(g.textEn ?? "");
      if (g.frame?.visual) {
        const v = g.frame.visual;
        if (v.title) v.title = toSpace(v.title);
        for (const c of v.claims ?? []) {
          c.text = toSpace(c.text ?? "");
          if (c.role) c.role = toSpace(c.role);
        }
      }
      if (g.frame) {
        g.frame.label = toSpace(g.frame.label);
        if (g.frame.support) g.frame.support = toSpace(g.frame.support);
      }
    }
  }
}
