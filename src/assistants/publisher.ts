import fs from "node:fs/promises";
import { config } from "../config.js";
import type { ReelMetadata } from "../types.js";

const V = config.instagram.graphVersion;
// 컨테이너 생성/게시는 모드에 따라 graph.instagram.com 또는 graph.facebook.com
const GRAPH = `${config.instagram.apiBase}/${V}`;

/**
 * 업로드 어시스트 — 렌더된 mp4 를 Instagram 릴스로 게시.
 *
 * Instagram API(Instagram Login)는 바이트 직접 업로드 대신 "공개 URL(video_url)"을
 * 요구한다. 그래서 렌더 결과물을 GitHub 릴리스에 임시로 올려 공개 URL 을 만들고,
 * 그 URL 로 컨테이너를 생성 → 처리 완료 대기 → 게시한 뒤, 임시 릴리스를 삭제한다.
 *
 * 흐름: 임시 공개 호스팅 → 컨테이너 생성(video_url) → 처리 완료 폴링 → 게시 → 정리.
 */
export async function publishReel(
  videoPath: string,
  metadata: ReelMetadata,
): Promise<{ mediaId: string }> {
  const caption = buildCaption(metadata);

  // 1) 영상을 공개 URL 로 임시 호스팅 (인스타가 이 URL 에서 영상을 내려받아 처리)
  const { videoUrl, cleanup } = await hostVideoPublicly(videoPath);
  try {
    // 2) video_url 로 미디어 컨테이너 생성
    const containerId = await createContainer(caption, videoUrl);
    // 3) 인스타가 영상을 내려받아 처리 완료할 때까지 대기
    await waitUntilFinished(containerId);
    // 4) 게시
    const mediaId = await publish(containerId);
    return { mediaId };
  } finally {
    // 5) 임시 호스팅 정리 (게시 완료 후엔 URL 불필요)
    await cleanup().catch(() => {});
  }
}

function buildCaption(m: ReelMetadata): string {
  // 해시태그는 붙이지 않는다 — 키워드는 본문 문장에 자연스럽게 녹아 있음
  return m.caption;
}

/**
 * 렌더 mp4 를 GitHub 릴리스 에셋으로 임시 업로드해 공개 URL 을 만든다.
 * (GitHub Actions 가 자동 제공하는 GITHUB_TOKEN / GITHUB_REPOSITORY 사용)
 * 반환한 cleanup() 은 그 임시 릴리스와 태그를 지운다.
 */
async function hostVideoPublicly(
  videoPath: string,
): Promise<{ videoUrl: string; cleanup: () => Promise<void> }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repo = process.env.GITHUB_REPOSITORY?.trim(); // "owner/name"
  if (!token || !repo) {
    throw new Error(
      "인스타 업로드용 공개 호스팅 실패: GITHUB_TOKEN/GITHUB_REPOSITORY 가 없습니다. (워크플로에서 GITHUB_TOKEN 전달 + permissions: contents: write 필요)",
    );
  }
  const [owner, name] = repo.split("/");
  const api = "https://api.github.com";
  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // 고유 태그 (동시 실행 충돌 방지). 파이프라인 런타임이라 Date 사용 가능.
  const tag = `media-${Date.now()}`;

  // 1) 임시 릴리스 생성
  const relRes = await fetch(`${api}/repos/${owner}/${name}/releases`, {
    method: "POST",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: tag,
      body: "임시 미디어 호스팅 (자동 생성/삭제)",
      prerelease: true,
    }),
  });
  const rel = (await relRes.json()) as { id?: number; error?: unknown };
  if (!relRes.ok || !rel.id) {
    throw new Error(`임시 릴리스 생성 실패: ${JSON.stringify(rel).slice(0, 300)}`);
  }
  const releaseId = rel.id;

  // 2) mp4 를 릴리스 에셋으로 업로드
  const bytes = await fs.readFile(videoPath);
  const upRes = await fetch(
    `https://uploads.github.com/repos/${owner}/${name}/releases/${releaseId}/assets?name=reel.mp4`,
    {
      method: "POST",
      headers: { ...ghHeaders, "Content-Type": "video/mp4" },
      body: new Uint8Array(bytes),
    },
  );
  const asset = (await upRes.json()) as { browser_download_url?: string; error?: unknown };
  if (!upRes.ok || !asset.browser_download_url) {
    await deleteRelease(api, owner, name, releaseId, tag, ghHeaders);
    throw new Error(`릴리스 에셋 업로드 실패: ${JSON.stringify(asset).slice(0, 300)}`);
  }

  const cleanup = () => deleteRelease(api, owner, name, releaseId, tag, ghHeaders);
  return { videoUrl: asset.browser_download_url, cleanup };
}

async function deleteRelease(
  api: string,
  owner: string,
  name: string,
  releaseId: number,
  tag: string,
  headers: Record<string, string>,
): Promise<void> {
  await fetch(`${api}/repos/${owner}/${name}/releases/${releaseId}`, {
    method: "DELETE",
    headers,
  });
  await fetch(`${api}/repos/${owner}/${name}/git/refs/tags/${tag}`, {
    method: "DELETE",
    headers,
  });
}

async function createContainer(caption: string, videoUrl: string): Promise<string> {
  const params = new URLSearchParams({
    media_type: "REELS",
    video_url: videoUrl,
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

async function waitUntilFinished(containerId: string): Promise<void> {
  for (let attempt = 0; attempt < 45; attempt++) {
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
