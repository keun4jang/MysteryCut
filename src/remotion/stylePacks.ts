/**
 * 롱폼 스타일 팩 — 회차마다 화면의 '옷'만 바꾼다.
 *
 * 왜: 매 회차가 같은 오프너·같은 자료 카드로 나가면 유튜브 파트너 심사에서
 * '템플릿으로 찍어낸 채널'로 읽힌다. 그렇다고 회차마다 랜덤으로 흔들면 채널
 * 정체성이 사라지므로, 팩을 3벌로 한정하고 제목 해시로 결정적으로 고른다.
 *
 * ★팩은 스타일(색·카드 모양·테두리·라벨·켄번즈·오프너 배치)만 바꾼다.
 *  프레임 수·등장 타이밍(timing.ts, LONGFORM_OPENER_LEAD, OPENER_* 상수)은
 *  절대 건드리지 않는다 — 설명란 챕터 타임스탬프와 자막 트랙이 그 계산에 묶여 있다.
 *
 * 브라우저 번들에서도 쓰이므로 Node 전용 모듈을 import 하지 않는다.
 */

export const STYLE_PACK_IDS = ["noir", "archive", "casefile"] as const;
export type StylePackId = (typeof STYLE_PACK_IDS)[number];

/** 제목 → 팩. FNV-1a 32bit — 렌더와 Node 어디서 불러도 같은 값 */
export function pickStylePack(title: string, override?: StylePackId): StylePackId {
  if (override && (STYLE_PACK_IDS as readonly string[]).includes(override)) return override;
  let h = 2166136261;
  for (let i = 0; i < title.length; i++) {
    h ^= title.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return STYLE_PACK_IDS[(h >>> 0) % STYLE_PACK_IDS.length];
}

export interface KenBurns {
  /** 챕터 시작 → 끝 배율 */
  scale: [number, number];
  /** 챕터 시작 → 끝 가로 이동(%) — 0 이면 이동 없음 */
  panX: [number, number];
}

export interface StylePack {
  id: StylePackId;
  /** 챕터 번호(1부터)별 켄번즈 */
  kenBurns: (chapterNumber: number) => KenBurns;
  /** 장르 그레이드(bgFilter) 뒤에 덧붙이는 팩 필터. noir 는 "" */
  extraFilter: string;
  /** 장르 틴트 위에 한 겹 더 얹는 팩 틴트(없으면 null) */
  tintCss: string | null;
}

export const STYLE_PACKS: Record<StylePackId, StylePack> = {
  // 지금까지의 룩 — 폴백. 값은 기존 LongformDoc 그대로다.
  noir: {
    id: "noir",
    kenBurns: (n) => ({ scale: n % 2 === 0 ? [1.11, 1.04] : [1.04, 1.11], panX: [0, 0] }),
    extraFilter: "",
    tintCss: null,
  },
  // 오래된 기록 보관소 — 세피아, 천천히 움직이는 사진(배율 폭을 절반으로)
  archive: {
    id: "archive",
    kenBurns: (n) => ({ scale: n % 2 === 0 ? [1.075, 1.04] : [1.04, 1.075], panX: [0, 0] }),
    extraFilter: "sepia(0.42) contrast(1.04)",
    tintCss:
      "radial-gradient(ellipse at 50% 45%, rgba(70,48,22,0.10) 0%, rgba(30,20,8,0.34) 100%)",
  },
  // 수사 파일 — 차가운 색, 줌은 고정 방향 + 좌우로 천천히 훑는다
  casefile: {
    id: "casefile",
    kenBurns: (n) => ({ scale: [1.07, 1.1], panX: n % 2 === 0 ? [1.6, -1.6] : [-1.6, 1.6] }),
    extraFilter: "saturate(0.8) hue-rotate(-8deg)",
    tintCss: "linear-gradient(180deg, rgba(20,38,62,0.20) 0%, rgba(10,20,34,0.10) 100%)",
  },
};

/** archive 팩의 종이·잉크 색 — 종이 위 글자는 그림자 대신 진한 잉크로 대비를 만든다 */
export const PAPER = {
  BG: "linear-gradient(172deg, #F1E9D6 0%, #E9DEC5 58%, #E0D2B4 100%)",
  EDGE: "rgba(92,68,36,0.45)",
  SHADOW: "0 24px 64px rgba(0,0,0,0.62), 0 4px 14px rgba(0,0,0,0.45)",
  INK: "#1E1912",
  INK_SUB: "#3E3426",
  INK_LABEL: "#7A3E1C",
  INK_WARN: "#A3241A",
  INK_REVEAL: "#8E1F14",
  RULE: "rgba(90,62,30,0.55)",
} as const;

/** casefile 팩의 도장·괘선 색 */
export const FILE = {
  STAMP: "#E0453A",
  RULE: "rgba(200,220,240,0.22)",
  RULE_STRONG: "rgba(200,220,240,0.45)",
  TAG: "rgba(214,228,242,0.78)",
} as const;
