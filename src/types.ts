import { z } from "zod";

/** 1단계: 스토리 구상 어시스트 산출물 */
export const StoryIdeaSchema = z.object({
  /**
   * 사건/전설의 고유 식별자 (영어 소문자 슬러그). 제목이 달라도 같은 사건이면 같은 값.
   * 중복 게시 방지에 사용. 예: "brazil-lead-masks-1966", "dyatlov-pass-1959".
   */
  caseKey: z.string(),
  /** 썸네일(커버) 카드용 초자극 문구 — 6~16자, 최대 2줄('\n' 허용). 피드에서 시선을 잡는 한 방 */
  thumbTitle: z.string(),
  /** 썸네일 상단 빨간 배지 문구 — 소재 종류에 맞춰 4~7자 (예: '실화 미제사건', '실화 법정사건') */
  thumbBadge: z.string(),
  /** 릴스 훅(첫 3초 자막) — 스크롤을 멈추게 하는 한 문장 */
  hook: z.string(),
  /** 미스터리 제목 */
  title: z.string(),
  /** 소재/배경 (도시전설, 미해결 사건 등) */
  premise: z.string(),
  /** 전체 줄거리 요약 (2~4문장) */
  synopsis: z.string(),
  /** 반전 또는 열린 결말 포인트 */
  twist: z.string(),
  /** 실화/실제 사건 기반 여부 */
  basedOnRealEvents: z.boolean(),
  /** 실화 기반일 때: 알려진 사실과 추측을 구분한 짧은 메모 (캡션 신뢰도/면책에 사용) */
  factNote: z.string(),
  /** 분위기 키워드 (배경/BGM/색감 결정에 사용) */
  moodKeywords: z.array(z.string()),
});
export type StoryIdea = z.infer<typeof StoryIdeaSchema>;

/** 2단계: 대본 어시스트 산출물 — 자막/나레이션 세그먼트 단위 */
export const ReelScriptSchema = z.object({
  title: z.string(),
  /** 순서대로 재생될 세그먼트 (한 문장 ≈ 한 자막 카드) */
  segments: z.array(
    z.object({
      /** 화면 자막이자 TTS 나레이션 텍스트 (한국어) */
      text: z.string(),
      /** 영어 번역 자막 (한글 자막 아래 표시. 나레이션에는 안 쓰임) */
      textEn: z.string(),
      /** 화면 강조용(선택) — 이 세그먼트의 감정/톤 */
      emphasis: z.enum(["normal", "tension", "reveal"]).default("normal"),
      /** 이 장면의 배경 스톡 검색어 (영어, Pexels 검색용). 예: "foggy dark forest night" */
      visualQuery: z.string(),
      /**
       * 비주얼 챕터(장면) 번호 — 같은 장소·같은 국면의 세그먼트는 같은 번호.
       * 한 장면(2~3세그먼트)이 배경 사진 1장을 나눠 쓴다. 누락 시 자동 묶음 폴백.
       */
      scene: z.number().int().min(0).optional(),
    }),
  ),
});
export type ReelScript = z.infer<typeof ReelScriptSchema>;

/** 3단계: 캡션/키워드 어시스트 산출물 */
export const ReelMetadataSchema = z.object({
  /** 게시물 본문 캡션(한국어) — 해시태그 없이 키워드를 문장에 녹여 씀 (첫 줄이 후킹) */
  caption: z.string(),
  /** 캡션의 영어 번역 — 게시 시 한국어 아래에 붙어 글로벌 시청자 대응 */
  captionEn: z.string(),
  /** 검색 키워드 (# 없음) — 유튜브 내부 태그(snippet.tags) 전용, 화면/본문 미표시 */
  hashtags: z.array(z.string()),
});
export type ReelMetadata = z.infer<typeof ReelMetadataSchema>;

/** 나레이션 완료된 세그먼트 (오디오 경로 + 길이 + 배경) */
export interface NarratedSegment {
  text: string;
  /** 영어 번역 자막 (한글 자막 아래 표시) */
  textEn: string;
  emphasis: "normal" | "tension" | "reveal";
  /** public/ 기준 상대경로 (예: audio/seg-0.mp3) — staticFile() 로 참조 */
  audioSrc: string;
  durationInSeconds: number;
  visualQuery: string;
  /** 배경 이미지 public/ 상대경로 (예: broll/scene-0.jpg). 없으면 그라디언트 폴백 */
  bgSrc?: string;
  /** 비주얼 챕터 번호 (0부터 연속, scenes.ts 가 정규화). 미지정 시 세그먼트 = 장면 */
  sceneIndex?: number;
  /** 장면 안에서 몇 번째 컷인지 (0부터) — 같은 사진의 크롭·줌 변주에 사용 */
  shot?: number;
}

/** 장르 구분 — 색보정·강조색·썸네일 마커를 소재 성격에 맞춰 고정한다 */
export type ReelGenre = "coldCase" | "court" | "history" | "folklore";

/**
 * 장르 고정 색보정(그레이드) — Node 쪽(grade.ts)에서 결정해 props 로 내려보낸다.
 * 렌더 코드는 여기 담긴 값을 그대로 쓰기만 하므로 결정성이 유지된다.
 */
export interface ReelGrade {
  genre: ReelGenre;
  /** 배경 사진에 거는 CSS filter (장르 고정값 + 사건별 ±지터) */
  bgFilter: string;
  /** 화면 전체에 얹는 장르 틴트 (CSS gradient 문자열) */
  tintCss: string;
  /** 장르 강조색 — 자막 패널 강조바·라벨·썸네일 마커 */
  accent: string;
  /** 필름 그레인 불투명도 (0.025~0.045, 0이면 끔) */
  grainOpacity: number;
  /** 그레인 노이즈 시드 (정적 패턴 — 프레임마다 동일해야 렌더가 결정적) */
  grainSeed: number;
  /** 썸네일 텍스트 마커: 코너 브래킷 / 좌측 세로바 (caseKey 시드로 로테이션) */
  thumbMarker: "brackets" | "bar";
}

/** 영상 비주얼 테마 (버라이어티 팩이 실행마다 랜덤 선택) */
export interface ReelTheme {
  /** 강조색: normal/tension/reveal 자막 색 */
  colors: { normal: string; tension: string; reveal: string };
  /** 자막 배경 스타일: 방송형 매트 패널 / 배경 없음(그림자만) / 가로 바 */
  boxStyle: "box" | "minimal" | "bar";
  /** 켄번즈 줌 방향: 확대 / 축소 / 세그먼트마다 교차 */
  kenburns: "in" | "out" | "mixed";
  /** 장르 고정 색보정 — index.ts 가 소재 확정 후 채운다 (미지정 시 무보정) */
  grade?: ReelGrade;
}

/** Remotion 컴포지션 입력 props */
export interface ReelInputProps {
  title: string;
  segments: NarratedSegment[];
  moodKeywords: string[];
  /** BGM public/ 상대경로 (예: bgm/track.mp3). 없으면 무음 */
  bgmSrc?: string;
  /** 비주얼 테마 (없으면 기본값) */
  theme?: ReelTheme;
  /** 썸네일(커버) 카드 문구 — 있으면 맨 앞 2프레임에 대형 타이틀 카드 삽입 */
  thumbTitle?: string;
  /** 썸네일 상단 배지 문구 — 미지정 시 '실화 미스터리' */
  thumbBadge?: string;
  // Remotion Composition props 는 인덱스 시그니처(Record<string, unknown>)를 요구
  [key: string]: unknown;
}
