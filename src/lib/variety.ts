import type { ReelTheme } from "../types.js";

/**
 * 버라이어티 팩 — 영상마다 포맷이 달라 보이도록 실행 시 랜덤 조합을 뽑는다.
 * (동일 템플릿 반복 신호를 줄여 unoriginal/inauthentic 분류 위험을 낮추고,
 *  시청자에게도 매번 다른 느낌을 준다)
 */

export interface VoicePick {
  voice: string;
  rate: string;
  pitch: string;
  label: string;
}

// 목소리 로테이션: 사용자가 고른 Hyunsu(-6Hz,+15%)를 주력으로, 변형·InJoon 을 섞음
const VOICES: Array<{ weight: number; pick: VoicePick }> = [
  {
    weight: 3,
    pick: { voice: "ko-KR-HyunsuMultilingualNeural", rate: "+28%", pitch: "-6Hz", label: "Hyunsu 기본" },
  },
  {
    weight: 2,
    pick: { voice: "ko-KR-HyunsuMultilingualNeural", rate: "+24%", pitch: "-8Hz", label: "Hyunsu 저음" },
  },
  {
    weight: 2,
    pick: { voice: "ko-KR-InJoonNeural", rate: "+24%", pitch: "-5Hz", label: "InJoon" },
  },
];

// 강조색 팔레트 (normal/tension/reveal)
const PALETTES: Array<ReelTheme["colors"]> = [
  { normal: "#ffffff", tension: "#ffd76b", reveal: "#ff5a5a" }, // 클래식(노랑/빨강)
  { normal: "#ffffff", tension: "#ffb257", reveal: "#ff6b4d" }, // 엠버(주황 계열)
  { normal: "#ffffff", tension: "#8ed4ff", reveal: "#ff5a5a" }, // 아이스(차가운 파랑 긴장)
  { normal: "#ffffff", tension: "#cdb6ff", reveal: "#ff5f87" }, // 바이올렛(보라 긴장/핑크 반전)
];

const BOX_STYLES: Array<ReelTheme["boxStyle"]> = ["box", "minimal", "bar"];
const KENBURNS: Array<ReelTheme["kenburns"]> = ["in", "out", "mixed"];

// 오프닝 훅 구조 로테이션 (대본 프롬프트에 주입)
const HOOK_STYLES = [
  "훅 방식: '실화 선언형' — 첫 문장에서 지어낸 얘기가 아님을 밝히며 시작. 예: '이거 지어낸 얘기 아니에요. 1922년에 실제로 있었던 일이거든요.'",
  "훅 방식: '장면 투입형' — 사건의 가장 기괴한 순간을 먼저 던지고 시작. 예: '한밤중, 등대 불이 꺼졌어요. 그리고 세 사람이 사라졌죠.' 그 다음에 실화임을 밝힘.",
  "훅 방식: '질문형' — 시청자에게 소름 돋는 질문을 먼저 던지고 시작. 예: '만약 집 안에서 낯선 발자국을 발견하면 어떻게 하실 건가요?' 그 다음 실화임을 밝힘.",
  "훅 방식: '숫자/팩트 충격형' — 믿기 힘든 구체적 사실 하나로 시작. 예: '편지 200통. 발신인은 죽은 사람이었어요.' 그 다음 실화임을 밝힘.",
];

/**
 * 소재 각도 로테이션 — 실종·의문사에 쏠리는 걸 막는다.
 * (실측: 초기 46건 중 실종 41% + 의문사 26% = 67%로 편중)
 * 실종·의문사는 여전히 강력한 소재라 가중치를 남기되, 나머지 각도를 골고루 섞는다.
 */
const TOPIC_ANGLES: Array<{ weight: number; pick: string }> = [
  {
    weight: 2,
    pick: "소재 각도: '설명되지 않는 현상' — 하늘에서 떨어진 것, 집단으로 목격된 이상 현상, 물리적으로 말이 안 되는 흔적, 반복되는 괴이한 소리·빛. 사람의 실종이 아니라 '현상 자체'가 주인공.",
  },
  {
    weight: 2,
    pick: "소재 각도: '기묘한 인물' — 정체가 끝내 밝혀지지 않은 사람, 이해할 수 없는 행동을 반복한 사람, 남긴 물건·기록이 더 수수께끼인 사람. 죽음이나 실종이 중심이 아니어도 된다.",
  },
  {
    weight: 2,
    pick: "소재 각도: '풀리지 않은 물건·기록' — 해독되지 않은 암호문, 출처 불명의 사진·필름·녹음, 설명 안 되는 고문서·지도·유물. 사건보다 '물건'이 주인공.",
  },
  {
    weight: 2,
    pick: "소재 각도: '집단이 겪은 이상 사건' — 마을 전체·승객 전원·학교 전체가 동시에 겪은 설명 불가한 일. 집단 환각, 집단 목격, 원인 불명의 집단 증상.",
  },
  {
    weight: 2,
    pick: "소재 각도: '기이한 장소' — 들어간 사람마다 이상한 일이 생기는 건물·숲·바다, 지도에서 지워진 마을, 버려진 시설에 남은 흔적. 장소가 주인공.",
  },
  {
    weight: 2,
    pick: "소재 각도: '미해결 범죄·협박' — 잡히지 않은 범인, 정체불명의 편지·전화·메시지, 동기를 알 수 없는 사건. (죽음 묘사는 최소화하고 '왜 설명이 안 되는지'에 집중)",
  },
  {
    weight: 2,
    pick: "소재 각도: '뒤집힌 상식' — 과학·법·역사의 정설을 흔든 사건, 나중에 완전히 다르게 밝혀진 이야기, 예상 밖의 결말이 난 분쟁.",
  },
  {
    weight: 3,
    pick: "소재 각도: '실종·행방불명' — 사람이 흔적 없이 사라진 사건. (최근 이 각도가 과하게 반복됐으니 정말 신선한 사건일 때만 고르고, 아니면 다른 각도를 택하라)",
  },
  {
    weight: 2,
    pick: "소재 각도: '설명되지 않는 죽음' — 사인이 끝내 규명되지 않은 사건. (표현은 중립적으로, 방법 묘사 금지)",
  },
];

/**
 * 지역 로테이션 — 소재가 해외에 쏠리는 걸 막는다.
 * (실측: 초기 46건 중 국내 소재 0건, 45건이 해외)
 * 한국 소재는 시청자 공감·검색 유입에 유리하지만 명예훼손 리스크가 크므로
 * '안전한 유형'(전설·수백 년 전 역사·30년 이상 된 공적 사건)으로만 한정한다.
 */
const REGION_ANGLES: Array<{ weight: number; pick: string }> = [
  {
    weight: 3,
    pick: `지역: '한국' — 국내 소재를 골라라. 단 아래 안전 유형 안에서만 고른다(법적 리스크 회피).
  · 한국 전설·민담·괴담 (장산범, 에밀레종, 옛 마을 괴담 등) — 실존 인물이 없어 가장 안전
  · 조선·고려·삼국 시대 역사 미스터리 (실록·야사에 남은 설명 안 되는 기록, 왕실 의문사 논쟁 등)
  · 30년 이상 지난, 언론·수사기관이 공식 발표해 널리 알려진 미제사건
  · 확정 판결로 사실관계가 정리된 기이한 사건 (아래 (C) 규칙 준수)
  ★생존 인물이 특정될 수 있는 최근 사건은 절대 금지. 실명·정확한 지역명 금지.`,
  },
  { weight: 2, pick: "지역: '아시아(한국 외)' — 일본·중국·대만·동남아·인도·중앙아시아 등의 사건이나 전승." },
  { weight: 2, pick: "지역: '유럽' — 영국·프랑스·독일·북유럽·동유럽·러시아 등의 사건이나 전승." },
  { weight: 2, pick: "지역: '미주' — 북미·중남미의 사건이나 전승. 미국에만 쏠리지 말고 캐나다·멕시코·브라질 등도." },
  { weight: 2, pick: "지역: '그 외 지역' — 아프리카·중동·오세아니아·극지·대양(선박·섬) 등 덜 다뤄진 지역." },
];

function weightedPick<T>(items: Array<{ weight: number; pick: T }>): T {
  const total = items.reduce((a, i) => a + i.weight, 0);
  let r = Math.random() * total;
  for (const i of items) {
    r -= i.weight;
    if (r <= 0) return i.pick;
  }
  return items[items.length - 1].pick;
}

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export interface StylePack {
  voice: VoicePick;
  theme: ReelTheme;
  hookStyle: string;
  /** 이번 회차에 다룰 소재 각도 (실종 편중 방지) */
  topicAngle: string;
  /** 이번 회차에 다룰 지역 (해외 편중 방지) */
  regionAngle: string;
}

export function pickStylePack(): StylePack {
  return {
    voice: weightedPick(VOICES),
    theme: {
      colors: pick(PALETTES),
      boxStyle: pick(BOX_STYLES),
      kenburns: pick(KENBURNS),
    },
    hookStyle: pick(HOOK_STYLES),
    topicAngle: weightedPick(TOPIC_ANGLES),
    regionAngle: weightedPick(REGION_ANGLES),
  };
}
