import fs from "node:fs/promises";
import { config } from "../config.js";
import type { ReelMetadata } from "../types.js";

const V = config.instagram.graphVersion;
// 컨테이너 생성/게시는 모드에 따라 graph.instagram.com 또는 graph.facebook.com
const GRAPH = `${config.instagram.apiBase}/${V}`;
// 리줌 업로드 호스트는 두 방식 모두 동일
const RUPLOAD = `https://rupload.facebook.com/ig-api-upload/${V}`;

/**
 * 업로드 어시스트.
 * 렌더된 mp4 를 Instagram Graph API 로 릴스 게시합니다.
 * (인스타 프로페셔널 계정 + Facebook 연동 + IG_USER_ID / IG_ACCESS_TOKEN 필요)
 *
 * 흐름: 컨테이너 생성 → 리줌 업로드 → 처리 완료 폴링 → 게시.
 */
export async function publishReel(
  videoPath: string,
  metadata: ReelMetadata,
): Promise<{ mediaId: string }> {
  const caption = buildCaption(metadata);
  const bytes = await fs.readFile(videoPath);

  // 1) 리줌 업로드용 미디어 컨테이너 생성
  const containerId = await createContainer(caption);

  // 2) 영상 바이트 업로드
  await uploadBytes(containerId, bytes);

  // 3) 처리 완료까지 대기
  await waitUntilFinished(containerId);

  // 4) 게시
  const mediaId = await publish(containerId);
  return { mediaId };
}

function buildCaption(m: ReelMetadata): string {
  const tags = m.hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  return `${m.caption}\n\n${tags}`;
}

async function createContainer(caption: string): Promise<string> {
  const params = new URLSearchParams({
    media_type: "REELS",
    upload_type: "resumable",
    caption,
    access_token: config.instagram.accessToken,
  });
  const res = await fetch(`${GRAPH}/${config.instagram.userId}/media`, {
    method: "POST",
    body: params,
  });
  const json = (await res.json()) as { id?: string; error?: unknown };
  if (!res.ok || !json.id) {
    throw new Error(`컨테이너 생성 실패: ${JSON.stringify(json)}`);
  }
  return json.id;
}

async function uploadBytes(containerId: string, bytes: Buffer): Promise<void> {
  const res = await fetch(`${RUPLOAD}/${containerId}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${config.instagram.accessToken}`,
      offset: "0",
      file_size: String(bytes.byteLength),
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(bytes),
  });
  const json = (await res.json()) as { success?: boolean; error?: unknown };
  if (!res.ok || json.success === false) {
    throw new Error(`영상 업로드 실패: ${JSON.stringify(json)}`);
  }
}

async function waitUntilFinished(containerId: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(4000);
    const res = await fetch(
      `${GRAPH}/${containerId}?fields=status_code,status&access_token=${config.instagram.accessToken}`,
    );
    const json = (await res.json()) as { status_code?: string; status?: string };
    if (json.status_code === "FINISHED") return;
    if (json.status_code === "ERROR") {
      throw new Error(`영상 처리 실패: ${JSON.stringify(json)}`);
    }
    console.log(`  ⏳ 처리 중... (${json.status_code ?? "IN_PROGRESS"})`);
  }
  throw new Error("영상 처리 시간 초과");
}

async function publish(containerId: string): Promise<string> {
  const params = new URLSearchParams({
    creation_id: containerId,
    access_token: config.instagram.accessToken,
  });
  const res = await fetch(`${GRAPH}/${config.instagram.userId}/media_publish`, {
    method: "POST",
    body: params,
  });
  const json = (await res.json()) as { id?: string; error?: unknown };
  if (!res.ok || !json.id) {
    throw new Error(`게시 실패: ${JSON.stringify(json)}`);
  }
  return json.id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
