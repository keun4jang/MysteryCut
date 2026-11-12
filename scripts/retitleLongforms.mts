/**
 * 옛 롱폼 제목 바꾸기(11/12, 사장님 승인 "추천대로") — 비공개 대신 제목만 고쳐 시청시간은 지키고
 * '기록으로 남은 미스터리 N가지 몰아보기' 같은 반복 제목(YPP '템플릿 대량생산' 신호)을 없앤다.
 *
 *   npx tsx scripts/retitleLongforms.mts --plan    # 새 제목 제안만 출력(Gemini 무료 등급, 영상 안 건드림)
 *   npx tsx scripts/retitleLongforms.mts --apply   # data/retitlePlan.json 대로 제목만 수정
 *
 * - 대상: 2026년 이후 공개 롱폼 중 제목에 상투 표현(titleGuard)이 있는 것. 옛 '새미했다' 영상은 절대 제외.
 * - 새 제목은 설명란에 실제로 있는 사건만 쓴다(설명란 첫 부분을 근거로). 사람이 계획 파일을 확인한 뒤 적용.
 * - --apply 는 지금 제목이 계획의 from 과 같을 때만 바꾼다(그사이 손으로 바꾼 제목은 안 덮음). 제목만 바꾸고
 *   설명·태그·언어는 받은 그대로 되돌려 보낸다. 쿼터 50/편.
 */
import fs from "node:fs";
import { z } from "zod";
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";
import { generateStructured } from "../src/lib/llm.js";
import { BANNED_TITLE_PHRASES, BANNED_TITLE_RE, checkTitle } from "../src/lib/titleGuard.js";
import { isLegacyVideo } from "./legacyGuard.mjs";

const PLAN_FILE = "data/retitlePlan.json";
const mode = process.argv.includes("--apply") ? "apply" : "plan";
const token = await getYoutubeAccessToken();
const H = { Authorization: `Bearer ${token}` };

type Snippet = {
  title: string;
  description: string;
  tags?: string[];
  categoryId: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  publishedAt?: string;
};
type Video = { id: string; snippet: Snippet; status: { privacyStatus: string }; contentDetails: { duration: string } };

async function listUploads(): Promise<string[]> {
  const ch = (await (await fetch("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true", { headers: H })).json()) as {
    items?: Array<{ contentDetails: { relatedPlaylists: { uploads: string } } }>;
  };
  const uploads = ch.items?.[0]?.contentDetails.relatedPlaylists.uploads;
  if (!uploads) throw new Error("채널 조회 실패");
  const ids: string[] = [];
  let pageToken = "";
  do {
    const pl = (await (
      await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${pageToken ? `&pageToken=${pageToken}` : ""}`,
        { headers: H },
      )
    ).json()) as { items?: Array<{ contentDetails: { videoId: string; videoPublishedAt?: string } }>; nextPageToken?: string };
    for (const it of pl.items ?? []) if (!isLegacyVideo(it.contentDetails.videoPublishedAt)) ids.push(it.contentDetails.videoId);
    pageToken = pl.nextPageToken ?? "";
  } while (pageToken);
  return ids;
}

async function getVideos(ids: string[]): Promise<Video[]> {
  const out: Video[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const j = (await (
      await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status,contentDetails&id=${ids.slice(i, i + 50).join(",")}`, { headers: H })
    ).json()) as { items?: Video[] };
    out.push(...(j.items ?? []));
  }
  return out.filter((v) => !isLegacyVideo(v.snippet.publishedAt));
}

const seconds = (d: string) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
};

const all = await getVideos(await listUploads());
const longforms = all.filter((v) => seconds(v.contentDetails.duration) > 180);

if (mode === "plan") {
  const targets = longforms.filter((v) => v.status.privacyStatus === "public" && BANNED_TITLE_RE.test(v.snippet.title));
  console.log(`대상 ${targets.length}편 (공개 롱폼 중 상투 제목)`);
  // 비교 대상: 바꾸지 않는 제목 + 앞서 정한 새 제목 — 새 제목끼리도 서로 닮지 않게
  const taken = longforms.filter((v) => !targets.includes(v)).map((v) => v.snippet.title);
  const Schema = z.object({ title: z.string(), leadCase: z.string() });
  const plan: Array<{ id: string; from: string; to: string }> = [];
  for (const v of targets) {
    let feedback = "";
    let chosen = "";
    for (let t = 0; t < 3 && !chosen; t++) {
      const r = (await generateStructured({
        schema: Schema,
        system: [
          "너는 한국어 실화 미스터리 유튜브 채널의 편집자다. 이미 올라간 사건 분석 다큐의 제목을 새로 짓는다.",
          "- 아래 설명란에 실제로 나오는 사건만 써라. 설명란에 없는 사건·숫자·연도를 지어내지 마라.",
          "- 영상 첫 사건(또는 가장 중심 사건) 하나의 구체적 고리(고유명사·장소·연도 중 하나 이상 + 핵심 질문)를 앞에 두고,",
          "  필요하면 ' — ' 뒤에 다른 사건들을 아우르는 짧은 주제를 붙여라.",
          `- 금지 표현: ${BANNED_TITLE_PHRASES.join(", ")}. 'N가지', 'N선', '몰아보기', '모음' 같은 개수·묶음 표현 금지.`,
          "- 금지어: 충격, 경악, 소름, 역대급, 실화냐, 미친, 대반전, 레전드. 물음표는 써도 된다.",
          "- 공백 포함 30~70자. 낚시 금지 — 제목이 약속한 내용이 영상에 있어야 한다.",
        ].join("\n"),
        user: `[지금 제목] ${v.snippet.title}\n[설명란]\n${v.snippet.description.slice(0, 1800)}${feedback}`,
        temperature: 0.8,
        maxRetries: 1,
      })) as z.infer<typeof Schema>;
      const cand = r.title.trim().replace(/\s+/g, " ");
      const chk = checkTitle(cand, [...taken, ...plan.map((p) => p.to)]);
      if (chk.ok && cand.length >= 15 && cand.length <= 80) chosen = cand;
      else feedback = `\n★직전 제안 "${cand}"은 쓸 수 없다: ${chk.reason || "길이"}. 다르게 지어라.`;
    }
    if (!chosen) {
      console.log(`⏭️  ${v.id} 적당한 제목을 못 찾음 — 그대로 둠: ${v.snippet.title}`);
      continue;
    }
    plan.push({ id: v.id, from: v.snippet.title, to: chosen });
    console.log(`📝 ${v.snippet.publishedAt?.slice(0, 10)} ${v.id}\n   전: ${v.snippet.title}\n   후: ${chosen}`);
  }
  console.log("\n===PLAN-JSON===");
  console.log(JSON.stringify(plan, null, 2));
  console.log("===END===");
} else {
  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8")) as Array<{ id: string; from: string; to: string }>;
  const byId = new Map(longforms.map((v) => [v.id, v]));
  let done = 0;
  for (const p of plan) {
    const v = byId.get(p.id);
    if (!v) {
      console.log(`⏭️  ${p.id} 대상 아님(옛 영상·쇼츠·없는 영상) — 건너뜀`);
      continue;
    }
    if (v.snippet.title !== p.from) {
      console.log(`⏭️  ${p.id} 지금 제목이 계획과 다름 — 건너뜀: ${v.snippet.title}`);
      continue;
    }
    const s = v.snippet;
    const next: Snippet = {
      title: p.to.slice(0, 100),
      description: s.description,
      tags: s.tags,
      categoryId: s.categoryId,
      ...(s.defaultLanguage ? { defaultLanguage: s.defaultLanguage } : {}),
      ...(s.defaultAudioLanguage ? { defaultAudioLanguage: s.defaultAudioLanguage } : {}),
    };
    const up = await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet", {
      method: "PUT",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, snippet: next }),
    });
    if (up.ok) {
      done++;
      console.log(`✅ ${p.id} ${p.from}\n   → ${p.to}`);
    } else console.warn(`❌ ${p.id} 수정 실패: HTTP ${up.status} ${(await up.text()).slice(0, 200)}`);
  }
  console.log(`\n계획 ${plan.length}편 중 ${done}편 수정`);
  if (done < plan.length) process.exitCode = 1;
}
