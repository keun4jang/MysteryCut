/**
 * 채널 소개문(정보 탭) 교체(11/12, 사장님 승인 "추천대로") — 수익창출 심사자가 가장 먼저 보는 곳에
 * '공개 기록에 근거한 사건 분석 채널'이라는 성격과 AI 음성 사용을 밝힌다.
 *
 *   npx tsx scripts/updateChannelAbout.mts            # 지금 소개문과 바뀔 소개문만 출력
 *   npx tsx scripts/updateChannelAbout.mts --apply    # 실제 교체(channels.update, 쿼터 50)
 *
 * 영상은 건드리지 않는다. 지금 소개문은 로그에 그대로 남겨 되돌릴 수 있게 한다.
 */
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";

const ABOUT = [
  "미스터리 컷은 실제로 기록된 사건과 미스터리를 위키백과 등 공개 자료에 근거해 정리하는 사건 분석 채널입니다.",
  "",
  "· 수요일 — 한 사건을 처음부터 끝까지 깊게 따라가는 심층 다큐",
  "· 토요일 — 한 가지 주제로 묶은 실제 사건 기록",
  "· 쇼츠 — 사건의 핵심을 1분 안에",
  "",
  "확인된 사실과 추측을 구분해 전하고, 기록에 없는 내용은 '기록에 없다'고 말합니다.",
  "모든 영상의 설명란에 참고 자료를 밝힙니다. 내레이션은 AI 음성을 사용하고, 사진은 분위기를 위한 자료 이미지입니다.",
].join("\n");

const apply = process.argv.includes("--apply");
const token = await getYoutubeAccessToken();
const H = { Authorization: `Bearer ${token}` };
const j = (await (await fetch("https://www.googleapis.com/youtube/v3/channels?part=brandingSettings&mine=true", { headers: H })).json()) as {
  items?: Array<{ id: string; brandingSettings: { channel?: Record<string, unknown>; watch?: Record<string, unknown> } }>;
};
const ch = j.items?.[0];
if (!ch) throw new Error(`채널 조회 실패: ${JSON.stringify(j).slice(0, 200)}`);
const before = String(ch.brandingSettings.channel?.description ?? "");
console.log("=== 지금 소개문(되돌릴 때 이 내용을 쓰세요) ===\n" + (before || "(비어 있음)"));
console.log("\n=== 바뀔 소개문 ===\n" + ABOUT);
if (before.trim() === ABOUT.trim()) {
  console.log("\n이미 같은 내용 — 할 일 없음");
  process.exit(0);
}
if (!apply) {
  console.log("\n(미리보기 — --apply 로 실제 교체)");
  process.exit(0);
}
// brandingSettings 는 통째로 덮어쓰므로 받은 channel·watch 를 그대로 두고 description 만 바꾼다
const body = {
  id: ch.id,
  brandingSettings: {
    ...ch.brandingSettings,
    channel: { ...(ch.brandingSettings.channel ?? {}), description: ABOUT },
  },
};
const up = await fetch("https://www.googleapis.com/youtube/v3/channels?part=brandingSettings", {
  method: "PUT",
  headers: { ...H, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
if (!up.ok) {
  console.error(`❌ 교체 실패: HTTP ${up.status} ${(await up.text()).slice(0, 300)}`);
  process.exit(1);
}
console.log("\n✅ 소개문 교체 완료");
