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
  /**
   * 참고자료 목록 — LLM 이 만드는 값이 아니라 파이프라인이 위키백과 수집 결과로
   * 채워 넣는다. 유튜브 설명란 하단에만 붙는다(인스타는 링크가 안 걸려 제외).
   */
  sourcesCitation: z.string().optional(),
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

// ─────────────────────────────────────────────────────────────
// 롱폼(가로형 사건 분석 다큐) — 쇼츠와 완전히 다른 구조
//
// 쇼츠 대본을 6배로 늘리면 중간이 전부 배경 설명이 되어 시청 지속률이 무너진다.
// 그래서 별도 스키마를 쓴다: 사건을 '챕터'로 나누고, 챕터마다 화면에 띄울
// 자료(타임라인·인물·증거·가설)를 데이터로 받는다. 이 자료 카드가 스톡 사진
// 슬라이드쇼와 진짜 다큐를 가르는 지점이고, 항목이 하나씩 등장하면서
// 4~7초마다 화면이 바뀌는 효과도 같이 얻는다.
// ─────────────────────────────────────────────────────────────

/**
 * 자료 프레임 종류 — 화면 전체를 쓰는 '한 장짜리 사건 기록판'의 성격.
 *
 * 예전에는 챕터마다 여러 항목을 나열하는 카드를 띄웠다. 그런데 가로 16:9 를
 * 휴대폰 세로로 보면 영상 높이가 221pt 로 줄어, 카드 본문이 8.6pt(iOS 기본
 * 본문의 절반)로 표시돼 사실상 못 읽었다. 글자만 키우면 한 화면에 항목이
 * 하나도 안 들어가므로, 형식 자체를 '화면당 한 항목'으로 바꿨다.
 */
export const LONGFORM_FRAME_KINDS = [
  "question", // label = '오늘 확인할 것' — 도입부의 핵심 질문
  "timeline", // label = 시점
  "person", // label = 역할(핵심 인물 등)
  "evidence", // label = 증거 번호·이름
  "theory", // label = 가설 이름
  "problem", // label = 남은 문제 / 기록 불일치 (증거·가설의 반박을 별도 화면으로)
  "verdict", // label = 공식 결론
] as const;
export type LongformFrameKind = (typeof LONGFORM_FRAME_KINDS)[number];

/** 한 문장에 붙는 자료 프레임 (없으면 그냥 내레이션 화면) */
export const LongformFrameSchema = z.object({
  kind: z.enum(LONGFORM_FRAME_KINDS),
  /** 화면 상단 분류 표시. 예: '1948. 01. 26.' / '핵심 인물' / '증거 03' / '남은 문제' */
  label: z.string(),
  /** 아래에 한 줄 더 붙일 보조 문장 (선택, 30자 이내) */
  support: z.string().optional(),
});

export const LongformScriptSchema = z.object({
  /** 유튜브 영상 제목 */
  title: z.string(),
  /** 썸네일 대형 문구 — 4~8자씩 최대 2줄('\n') */
  thumbTitle: z.string(),
  /** 썸네일 배지 (쇼츠와 동일 규칙) */
  thumbBadge: z.string(),
  /** 이 영상이 답할 핵심 질문 한 문장 (도입부에 화면 표시) */
  centralQuestion: z.string(),
  /**
   * 썸네일 배경 전용 스톡 검색어 (영어).
   * 챕터 배경은 '분위기'를 맡지만 썸네일은 **제목과 직결된 상징물**이어야 한다.
   * 1챕터 사진을 그대로 쓰면 독살 사건에 해변 가족사진이 걸리는 일이 생긴다(실측).
   */
  thumbQuery: z.string(),
  /** 게시글 설명 본문 */
  description: z.string(),
  /** 유튜브 내부 검색 태그 (# 없이) */
  tags: z.array(z.string()),
  chapters: z.array(
    z.object({
      /** 챕터 제목 — 챕터 시작 0.8초 동안만 크게 표시하고 사라진다 */
      heading: z.string(),
      /** 이 챕터 배경 스톡 검색어 (영어). 시대 재현이 아니라 상징·분위기 */
      visualQuery: z.string(),
      segments: z.array(
        z.object({
          /**
           * 나레이션이자 **화면의 중심 텍스트**.
           * 자료 프레임에서는 이 문장이 그대로 96px 로 크게 뜬다 — 그래서
           * 자막과 카드를 따로 띄울 필요가 없고 시선이 한 곳에 모인다.
           */
          text: z.string(),
          /**
           * 영어 번역 — 한국어 문장 바로 아래에 작게 깔린다.
           * 시청자의 22%가 미국이라 붙이지만, 주 독자는 한국어 쪽이므로
           * 크기는 작게 간다(나레이션에는 쓰이지 않는다).
           */
          textEn: z.string(),
          emphasis: z.enum(["normal", "tension", "reveal"]).default("normal"),
          /** 있으면 자료 프레임, 없으면 하단 자막만 있는 내레이션 화면 */
          frame: LongformFrameSchema.optional(),
        }),
      ),
    }),
  ),
});
export type LongformScript = z.infer<typeof LongformScriptSchema>;

/** 나레이션이 끝난 롱폼 챕터 */
export interface NarratedChapter {
  heading: string;
  visualQuery: string;
  segments: Array<{
    text: string;
    /** 영어 번역 자막 (한국어 문장 아래 작게) */
    textEn?: string;
    emphasis: "normal" | "tension" | "reveal";
    audioSrc: string;
    durationInSeconds: number;
    frame?: { kind: LongformFrameKind; label: string; support?: string };
  }>;
  /** 배경 이미지 public/ 상대경로 */
  bgSrc?: string;
  /**
   * 이 챕터 배경에 걸 밝기 배수 (0.68~0.86).
   * Pexels 가 사진마다 주는 avg_color 로 Node 쪽에서 계산한다 — 밝은 사진은
   * 더 누르고 어두운 사진은 덜 눌러야 흰 자막이 항상 읽히면서도 사진이
   * 형태를 잃지 않는다. 미지정 시 기본값 사용.
   */
  bgBrightness?: number;
}

/** 롱폼 Remotion 컴포지션 입력 props */
export interface LongformInputProps {
  title: string;
  thumbTitle: string;
  thumbBadge: string;
  centralQuestion: string;
  chapters: NarratedChapter[];
  /** 썸네일 배경 이미지 (public/ 상대경로). 없으면 1챕터 배경으로 폴백 */
  thumbBgSrc?: string;
  bgmSrc?: string;
  grade?: ReelGrade;
  [key: string]: unknown;
}
