import { z } from "zod";

/** 1단계: 스토리 구상 어시스트 산출물 */
export const StoryIdeaSchema = z.object({
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
      /** 화면 자막이자 TTS 나레이션 텍스트 */
      text: z.string(),
      /** 화면 강조용(선택) — 이 세그먼트의 감정/톤 */
      emphasis: z.enum(["normal", "tension", "reveal"]).default("normal"),
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

/** 나레이션 완료된 세그먼트 (오디오 경로 + 길이) */
export interface NarratedSegment {
  text: string;
  emphasis: "normal" | "tension" | "reveal";
  /** public/ 기준 상대경로 (예: audio/seg-0.mp3) — staticFile() 로 참조 */
  audioSrc: string;
  durationInSeconds: number;
}

/** Remotion 컴포지션 입력 props */
export interface ReelInputProps {
  title: string;
  segments: NarratedSegment[];
  moodKeywords: string[];
  // Remotion Composition props 는 인덱스 시그니처(Record<string, unknown>)를 요구
  [key: string]: unknown;
}
