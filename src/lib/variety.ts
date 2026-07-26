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
    pick: { voice: "ko-KR-HyunsuMultilingualNeural", rate: "+15%", pitch: "-6Hz", label: "Hyunsu 기본" },
  },
  {
    weight: 2,
    pick: { voice: "ko-KR-HyunsuMultilingualNeural", rate: "+10%", pitch: "-8Hz", label: "Hyunsu 저음" },
  },
  {
    weight: 2,
    pick: { voice: "ko-KR-InJoonNeural", rate: "+10%", pitch: "-5Hz", label: "InJoon" },
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
  };
}
