/**
 * 클릭률 0.5~0.6% 롱폼 4편의 새 썸네일 계획. 이 목록 밖의 영상은 교체 도구가 건드리지 않는다.
 * 문구의 근거는 data/history.json(caseKey)과 data/retitlePlan.json(videoId)에 있는 기록이다.
 */
import fs from "node:fs";
import { thumbTitleIssues } from "../src/assistants/longformProducer.js";

export interface ThumbRefreshItem {
  videoId: string;
  /** 첫 사건 — 배경 색 보정과 사실 대조 기준 */
  caseKey: string;
  thumbTitle: string;
  thumbBadge: string;
  /** Pexels 검색어(broll.ts 의 인물·로고 제외 필터를 그대로 탄다) */
  thumbQuery: string;
  /** 지금 썸네일 원본(되돌리기용, 저장소에 있음) */
  originalThumb: string;
}

export const THUMB_REFRESH_PLAN: ThumbRefreshItem[] = [
  {
    videoId: "sJtCZB24COQ",
    caseKey: "lists-of-problems",
    // 7대 난제 중 이미 풀린 문제가 있으므로 '못 푼'이라고 쓰지 않는다
    thumbTitle: "천재들이 매달린\n7대 난제",
    thumbBadge: "역사 기록",
    thumbQuery: "chalkboard math equations",
    originalThumb: "thumbnails/2026-10-26-lf-compilation-sJtCZB24COQ.jpg",
  },
  {
    videoId: "Kn5tlh9Zo54",
    caseKey: "ieodo-legend-island",
    thumbTitle: "돌아오지 못한\n전설의 섬",
    thumbBadge: "전승 기록",
    thumbQuery: "lone rock stormy sea",
    originalThumb: "thumbnails/2026-11-07-lf-compilation-Kn5tlh9Zo54.jpg",
  },
  {
    videoId: "6CkeHpMCG6k",
    caseKey: "baskerville-hall-1901",
    thumbTitle: "사라지지 않은\n괴견 전설",
    thumbBadge: "전승 기록",
    thumbQuery: "black dog dark fog",
    originalThumb: "thumbnails/2026-11-02-lf-compilation-6CkeHpMCG6k.jpg",
  },
  {
    videoId: "uum3ZrVIpQc",
    caseKey: "phantom-of-heilbronn-2009",
    thumbTitle: "40곳에 남은\n같은 DNA",
    thumbBadge: "수사 기록",
    thumbQuery: "test tubes rack laboratory dark", // 11/24 'cotton swab' 은 사람(검체 채취) 사진이 걸림
    originalThumb: "thumbnails/2026-11-11-lf-single-phantom-of-heilbronn-2009-uum3ZrVIpQc.jpg",
  },
];

/** 이 영상에 대해 저장소에 남아 있는 기록(제목·개요·새 제목) */
export function recordedFacts(item: ThumbRefreshItem): string {
  const history = JSON.parse(fs.readFileSync("data/history.json", "utf8")) as {
    posts: Array<{ caseKey: string; title: string; premise?: string }>;
  };
  const retitle = JSON.parse(fs.readFileSync("data/retitlePlan.json", "utf8")) as Array<{ id: string; to: string }>;
  return [
    ...history.posts.filter((p) => p.caseKey === item.caseKey).flatMap((p) => [p.title, p.premise ?? ""]),
    ...retitle.filter((r) => r.id === item.videoId).map((r) => r.to),
  ].join("\n");
}

/** 문구 규칙 + 숫자 원문 대조. 비어 있으면 통과 */
export function planIssues(item: ThumbRefreshItem): string[] {
  const facts = recordedFacts(item);
  if (!facts.trim()) return [`${item.caseKey} 기록을 찾지 못했다`];
  return thumbTitleIssues(item.thumbTitle, facts);
}
