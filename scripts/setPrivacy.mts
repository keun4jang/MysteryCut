/**
 * data/unverifiedPosts.json 에 적힌 게시 영상을 유튜브에서 비공개로 돌린다.
 *
 * 사용: npx tsx scripts/setPrivacy.mts [--apply]
 *   기본은 미리보기 — 제목/ID 로 어떤 영상이 잡히는지만 출력. --apply 를 붙여야 실제 변경.
 * 쿼터: playlistItems.list 1/페이지 + videos.list 1/50개 + videos.update 50/건.
 * 되돌리기: 스튜디오에서 공개로 바꾸면 된다(비공개는 삭제가 아니라 조회수·댓글이 그대로 남는다).
 */
import fs from "node:fs/promises";
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";

interface Target {
  caseKeys: string[];
  title?: string;
  videoId?: string;
}
interface Status {
  privacyStatus: string;
  license?: string;
  embeddable?: boolean;
  publicStatsViewable?: boolean;
  madeForKids?: boolean;
  selfDeclaredMadeForKids?: boolean;
  containsSyntheticMedia?: boolean;
}

const apply = process.argv.includes("--apply");
const { videos: targets } = JSON.parse(await fs.readFile("data/unverifiedPosts.json", "utf8")) as {
  videos: Target[];
};
const token = await getYoutubeAccessToken();
const H = { Authorization: `Bearer ${token}` };

const ch = (await (
  await fetch("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true", { headers: H })
).json()) as { items?: Array<{ contentDetails: { relatedPlaylists: { uploads: string } } }> };
const uploads = ch.items?.[0]?.contentDetails.relatedPlaylists.uploads;
if (!uploads) throw new Error(`채널 조회 실패: ${JSON.stringify(ch).slice(0, 200)}`);

const ids: string[] = [];
let pageToken = "";
do {
  const pl = (await (
    await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${pageToken ? `&pageToken=${pageToken}` : ""}`,
      { headers: H },
    )
  ).json()) as { items?: Array<{ contentDetails: { videoId: string } }>; nextPageToken?: string };
  for (const it of pl.items ?? []) ids.push(it.contentDetails.videoId);
  pageToken = pl.nextPageToken ?? "";
} while (pageToken);

const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
const videos = new Map<string, { title: string; status: Status }>();
for (let i = 0; i < ids.length; i += 50) {
  const res = (await (
    await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${ids.slice(i, i + 50).join(",")}`,
      { headers: H },
    )
  ).json()) as { items?: Array<{ id: string; snippet: { title: string }; status: Status }> };
  for (const v of res.items ?? []) videos.set(v.id, { title: v.snippet.title, status: v.status });
}
console.log(`채널 영상 ${videos.size}개 조회 — 대상 ${targets.length}건${apply ? " (실제 변경 모드)" : " (미리보기 모드)"}`);

let unresolved = 0;
let failed = 0;
let changed = 0;
for (const t of targets) {
  const matches = t.videoId
    ? videos.has(t.videoId) ? [t.videoId] : []
    : [...videos].filter(([, v]) => norm(v.title) === norm(t.title ?? "")).map(([id]) => id);
  const label = t.caseKeys.join(", ");
  if (!matches.length) {
    unresolved++;
    console.log(`\n❓ 못 찾음 [${label}] ${t.videoId ?? t.title}`);
    continue;
  }
  if (matches.length > 1) console.log(`\n⚠️ 같은 제목 ${matches.length}개 — 전부 대상으로 본다 [${label}]`);
  for (const id of matches) {
    const v = videos.get(id)!;
    console.log(`\n• ${id} | 현재 ${v.status.privacyStatus} | ${v.title}\n  [${label}]`);
    if (!apply || v.status.privacyStatus === "private") continue;

    // part=status 업데이트는 status 객체를 통째로 덮는다 — 빠진 필드가 기본값으로
    // 돌아가지 않게 현재 값을 그대로 싣고 privacyStatus 만 바꾼다.
    const s = v.status;
    const status = {
      privacyStatus: "private",
      ...(s.license !== undefined ? { license: s.license } : {}),
      ...(s.embeddable !== undefined ? { embeddable: s.embeddable } : {}),
      ...(s.publicStatsViewable !== undefined ? { publicStatsViewable: s.publicStatsViewable } : {}),
      selfDeclaredMadeForKids: s.selfDeclaredMadeForKids ?? s.madeForKids ?? false,
      ...(s.containsSyntheticMedia !== undefined ? { containsSyntheticMedia: s.containsSyntheticMedia } : {}),
    };
    const res = await fetch("https://www.googleapis.com/youtube/v3/videos?part=status", {
      method: "PUT",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) {
      changed++;
      console.log("  → ✅ 비공개로 변경");
    } else {
      failed++;
      console.log(`  → ❌ 변경 실패 (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
  }
}

console.log(`\n요약: 변경 ${changed}건 / 실패 ${failed}건 / 못 찾음 ${unresolved}건`);
if (failed || unresolved) process.exitCode = 1;
