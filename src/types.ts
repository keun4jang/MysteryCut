import { z } from "zod";

/** 1단계: 스토리 구상 어시스트 산출물 */
export const StoryIdeaSchema = z.object({
  /**
   * 사건/전설의 고유 식별자 (영어 소문자 슬러그). 제목이 달라도 같은 사건이면 같은 값.
   * 중복 게시 방지에 사용. 예: "brazil-lead-masks-1966", "dyatlov-pass-1959".
   */
  caseKey: z.string(),
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
    }),
  ),
});
export type ReelScript = z.infer<typeof ReelScriptSchema>;

/** 3단계: 캡션/해시태그 어시스트 산출물 */
export const ReelMetadataSchema = z.object({
  /** 인스타 게시물 캡션 (첫 줄이 후킹) */
  caption: z.string(),
  /** 해시태그 (# 포함) */
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
  /** 배경 이미지 public/ 상대경로 (예: broll/seg-0.jpg). 없으면 그라디언트 폴백 */
  bgSrc?: string;
}

/** 영상 비주얼 테마 (버라이어티 팩이 실행마다 랜덤 선택) */
export interface ReelTheme {
  /** 강조색: normal/tension/reveal 자막 색 */
  colors: { normal: string; tension: string; reveal: string };
  /** 자막 배경 스타일: 반투명 박스 / 배경 없음(그림자만) / 가로 바 */
  boxStyle: "box" | "minimal" | "bar";
  /** 켄번즈 줌 방향: 확대 / 축소 / 세그먼트마다 교차 */
  kenburns: "in" | "out" | "mixed";
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
  // Remotion Composition props 는 인덱스 시그니처(Record<string, unknown>)를 요구
  [key: string]: unknown;
}
