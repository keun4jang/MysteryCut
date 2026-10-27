import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import { writeReelPlan, proposeCase } from "./assistants/producer.js";
import { gatherSources, sourcesCitation, warmStoryControversy, politicalControversy, sameCaseInHistory, isNonCaseTitle, confirmCaseIdentity, type SourceDoc } from "./lib/sources.js";
import { narrate } from "./assistants/narrator.js";
import { attachBroll } from "./assistants/broll.js";
import { renderReel } from "./render.js";
import { publishReel } from "./assistants/publisher.js";
import { publishYouTube } from "./assistants/youtubePublisher.js";
import {
  loadHistory,
  recentAvoidList,
  isDuplicate,
  appendPost,
} from "./assistants/history.js";
import { pickStylePack, isWarmStoryDay, isWarmAngle } from "./lib/variety.js";
import { verifyFacts, type FactItem } from "./lib/factcheck.js";
import { reviewDesign } from "./assistants/artDirector.js";
import { deriveGrade, gradeColors } from "./lib/grade.js";
import { totalDurationInFrames } from "./remotion/timing.js";
import { reelSrt } from "./lib/captions.js";
import type { ReelInputProps } from "./types.js";

/**
 * 전체 파이프라인 오케스트레이터.
 *
 *   스토리 구상 → 대본 → 캡션/해시태그 → 나레이션(TTS) → 영상 렌더 → 인스타 업로드
 *
 * 플래그:
 *   --only=ideate     스토리 아이디어만 생성하고 출력
 *   --no-publish      업로드 단계 생략 (영상 파일까지만 생성)
 *   --seed="소재"      스토리 구상 시 소재 힌트
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 중복 방지: 이미 게시한 사건 목록을 불러와 LLM 에 '겹치지 마라'로 전달
  const history = await loadHistory();
  const avoid = recentAvoidList(history);
  console.log(`🗂️  게시 이력 ${history.posts.length}건 (중복 회피)`);

  // 버라이어티 팩: 영상마다 목소리·비주얼·훅 구성을 랜덤 조합 (동일 템플릿 반복 방지)
  // 목·일요일은 감동 실화 편(10/3 일요일 시험 시작, 10/11 목요일 추가 — variety.ts WARM_WEEKDAYS)
  const pack = pickStylePack({ warm: isWarmStoryDay() });
  console.log(
    `🎲 버라이어티: 보이스=${pack.voice.label} | 자막=${pack.theme.boxStyle} | 줌=${pack.theme.kenburns} | 긴장색=${pack.theme.colors.tension}`,
  );
  console.log(`   🧭 ${pack.topicAngle.split(" — ")[0]} | ${pack.regionAngle.split(" — ")[0]}`);
  console.log(
    `   🎬 ${pack.hookStyle.split(" — ")[0]} | ${pack.signoffStyle.split(" — ")[0]}`,
  );

  const planOpts = {
    hookStyle: pack.hookStyle,
    titleStyle: pack.titleStyle,
    signoffStyle: pack.signoffStyle,
    topicAngle: pack.topicAngle,
    regionAngle: pack.regionAngle,
  };

  // ① 사건 선정 — 중복이거나 원문을 못 찾으면 다른 사건으로 다시 고른다.
  //    중복 검사를 '대본 생성 전'으로 당겨서, 겹친 소재에 대본 생성 비용을
  //    쓰지 않게 했다(예전엔 풀 대본을 만든 뒤에야 중복을 알았다).
  console.log("① 사건 선정 + 원문 수집...");
  let probe = await proposeCase(args.seed, avoid, planOpts);
  let sources: SourceDoc[] = [];
  let probeIsDup = false;
  let rejectReason = "";
  for (let tries = 0; tries < 6; tries++) {
    rejectReason = "";
    // 규칙 비교 → 통과하면 AI 로 전체 이력과 한 번 더 대조(caseKey·제목을 매번 다르게 지어내는 경우)
    probeIsDup = false;
    if (isNonCaseTitle(probe.title)) {
      rejectReason = "실제 사건이 아닌 문서(목록·작품)";
      console.log(`   ↩︎ 실제 사건이 아닌 문서(${probe.title}) — 다른 사건으로`);
    } else if (
      (probeIsDup =
        isDuplicate(history, probe.caseKey, probe.title) || !!(await sameCaseInHistory(probe, history.posts)))
    ) {
      rejectReason = "이미 게시함";
      console.log(`   ♻️  중복 소재(${probe.caseKey}) — 다른 사건으로`);
    } else {
      console.log(`   🔎 후보: ${probe.title} (${probe.caseKey})`);
      sources = await gatherSources(probe.searchTerms, {
        title: probe.title,
        premise: probe.premise,
        protagonistBioOk: true, // 10/13 사장님 결정: 미스터리 편도 주인공 본인 전기 인정(sources.ts)
      });
      // 감동 편은 주인공의 선행에 논란이 있으면 버린다(sources.ts warmStoryControversy)
      const controversy =
        sources.length && isWarmAngle(pack.topicAngle)
          ? await warmStoryControversy(sources, { title: probe.title, premise: probe.premise })
          : sources.length
            ? await politicalControversy(sources, { title: probe.title, premise: probe.premise })
            : null;
      if (sources.length && !controversy) {
        console.log(`   📚 원문 ${sources.length}건 확보: ${sources.map((d) => d.title).join(", ")}`);
        break;
      }
      if (controversy) {
        rejectReason = `채널 기준 위반: ${controversy}`;
        sources = [];
        console.log(`   ↩︎ 논란 소재라 쓰지 않음(${probe.title}) — 다른 사건으로`);
      } else {
        rejectReason = "위키백과 원문 없음";
        console.log(`   ↩︎ 원문을 못 찾음(${probe.searchTerms.join(", ")}) — 다른 사건으로`);
      }
    }
    avoid.caseKeys.push(probe.caseKey);
    // 버린 이유를 같이 넘긴다 — 이유를 모르면 같은 종류(정치·성범죄 사건)를 계속 고른다(10/17 드라이런 6연속 탈락)
    (avoid.rejected ??= []).push(`${probe.title} (${probe.caseKey}) — 버린 이유: ${rejectReason || "기타"}`);
    avoid.titles.push(probe.title);
    if (tries === 5) break;
    probe = await proposeCase(args.seed, avoid, planOpts);
  }
  // ★루프가 '마지막 시도(tries===3)도 중복'으로 끝난 경우를 반드시 걸러야 한다.
  // 예전엔 sources.length 만 봐서, 중복이라 gatherSources 를 아예 안 부른 경우와
  // '중복은 아니지만 원문을 못 찾은' 경우를 구분 못 했다 — 전자를 통과시키면
  // 안전 모드 경고만 찍고 이미 게시한 사건을 다시 대본화·게시한다(롱폼은
  // longform.ts 가 sources 없으면 throw 해서 우연히 막혀 있었는데 쇼츠만 뚫려
  // 있었다, 감사에서 확인). 중복 게시보다 그날 게시 실패(알림)가 낫다.
  if (probeIsDup || isDuplicate(history, probe.caseKey, probe.title)) {
    throw new Error(
      `사건 선정 6회 시도 모두 중복 소재로 귀결(마지막 후보: ${probe.caseKey}) — 중복 게시 방지를 위해 중단합니다.`,
    );
  }
  if (!sources.length) {
    // 원문 없이는 만들지 않는다(감동 편·미스터리 편 공통). 예전엔 미스터리 편만 '안전 모드'로 진행했는데,
    // 10/17 드라이런에서 마지막 후보가 성범죄 소재로 '버려진' 사건(앤드루 몰킨슨)인데도 원문 없이 대본이 만들어졌고
    // 원문에 없는 내용(가석방 제안 등)까지 들어갔다. 지어낸 내용·버린 소재를 내보내느니 그날 실패(알림)가 낫다.
    throw new Error(
      `6회 시도 모두 원문을 못 찾았거나 논란 소재였음(마지막 후보: ${probe.caseKey}) — 원문 없는 대본을 내보내지 않으려고 중단합니다.`,
    );
  }

  // ② 확정된 사건 + 원문에 근거해 대본·캡션 생성
  console.log("②~③ 대본·캡션 생성...");
  const { idea, script, metadata } = await writeReelPlan(args.seed, avoid, {
    ...planOpts,
    forcedCase: probe,
    sources,
  });

  // 수집한 원문을 설명란 참고자료로 (유튜브에만 노출)
  if (sources.length) metadata.sourcesCitation = sourcesCitation(sources);

  // 완성 원고를 원문과 한 줄씩 대조해 틀린 사실을 고친다(10/17 '총리'(실제 국철 총재)·'시속 수백 킬로' 통과 사례).
  // 고친 뒤에도 틀린 줄이 남으면 그날은 게시하지 않는다.
  const factItems: FactItem[] = [
    { id: "title", text: idea.title, apply: (f) => { idea.title = f; script.title = f; } },
    { id: "thumb", text: idea.thumbTitle, apply: (f) => { idea.thumbTitle = f; } },
    { id: "hook", text: idea.hook, apply: (f) => { idea.hook = f; } },
    { id: "caption/en", text: metadata.caption, apply: (f, en) => { metadata.caption = f; if (en) metadata.captionEn = en; } },
    ...script.segments.map((seg, i): FactItem => ({
      id: `s${i + 1}/en`,
      text: seg.text,
      apply: (f, en) => { seg.text = f; if (en) seg.textEn = en; },
    })),
  ];
  const sourceText = sources.map((d) => `[${d.title}]\n${d.extract}`).join("\n\n");
  if (!(await verifyFacts(factItems, sourceText, probe.title))) {
    throw new Error(`원고 사실 검증 실패 — 교정 후에도 원문과 어긋난 줄이 남음(${idea.caseKey}). 틀린 내용을 내보내지 않으려고 중단합니다.`);
  }

  // 원고가 실제로 다룬 사건과 caseKey 가 맞는지 — 어긋나면 바로잡고, 바로잡은 사건이 이미 게시한 것이면 중단
  const corrected = await confirmCaseIdentity(
    { caseKey: idea.caseKey, title: probe.title },
    [idea.title, ...script.segments.map((s) => s.text)].join("\n"),
  );
  if (corrected) {
    idea.caseKey = corrected.caseKey;
    if (
      isDuplicate(history, corrected.caseKey, corrected.caseName) ||
      (await sameCaseInHistory({ ...probe, caseKey: corrected.caseKey, title: corrected.caseName }, history.posts))
    ) {
      throw new Error(`원고가 실제로 다룬 사건(${corrected.caseName})이 이미 게시한 사건 — 중복 게시 방지를 위해 중단합니다.`);
    }
  }

  console.log(`   💡 ${idea.title} — ${idea.hook}`);
  // 완성 제목으로 한 번 더 — 10/12·10/16 에 caseKey 만 바꾼 같은 사건이 게시됐다. 중복 게시보다 그날 실패(알림)가 낫다.
  if (isDuplicate(history, idea.caseKey, idea.title)) {
    throw new Error(`완성된 제목이 이미 게시한 사건과 겹침(${idea.title}, ${idea.caseKey}) — 중복 게시 방지를 위해 중단합니다.`);
  }
  console.log(`   🔑 caseKey: ${idea.caseKey}`);
  console.log(`   📝 세그먼트 ${script.segments.length}개`);

  // 장르 고정 색보정 — 소재가 확정된 지금 시점에 장르를 판별해 테마에 채운다.
  // 자막 강조색도 랜덤 팔레트 대신 장르 색으로 교체(채널 룩 고정).
  const grade = deriveGrade(idea.caseKey, idea.thumbBadge, pack.topicAngle);
  pack.theme.grade = grade;
  pack.theme.colors = gradeColors(grade.genre);
  console.log(`   🎨 장르 그레이드: ${grade.genre} (마커=${grade.thumbMarker})`);

  if (args.only === "ideate") {
    console.log(JSON.stringify(idea, null, 2));
    return;
  }

  console.log("④ 나레이션(TTS) 합성...");
  const segments = await narrate(script, pack.voice);
  {
    // 최종 러닝타임 예측 로그 — 목표 구간(95~108초) 검증용
    const chars = script.segments.reduce((n, s) => n + s.text.length, 0);
    const secs = totalDurationInFrames(segments, 30, true) / 30;
    console.log(`   ⏱️ 대본 ${chars}자 → 예상 러닝타임 ${secs.toFixed(1)}초`);
    if (secs > 115) {
      console.warn(
        `   ⚠️ 115초 초과(${secs.toFixed(1)}초) — 인스타 릴스 도달률이 120초부터 3.5%대로 떨어지는 구간. 분량 기준 조정 필요.`,
      );
    } else if (secs < 85) {
      console.warn(`   ⚠️ 85초 미만(${secs.toFixed(1)}초) — 목표(95~108초)보다 짧음. 분량 기준 확인 필요.`);
    }
  }

  console.log("④-b 배경 자료화면(Pexels)...");
  await attachBroll(segments);

  const inputProps: ReelInputProps = {
    title: idea.title,
    segments,
    moodKeywords: idea.moodKeywords,
    bgmSrc: await findBgm(grade.genre === "warm"),
    theme: pack.theme,
    thumbTitle: idea.thumbTitle || idea.title,
    thumbBadge: idea.thumbBadge,
  };

  // 산출물을 out/ 에 함께 저장 (재현/디버깅용)
  await fs.mkdir(config.paths.out, { recursive: true });
  await fs.writeFile(
    path.join(config.paths.out, "project.json"),
    JSON.stringify({ idea, script, metadata, inputProps }, null, 2),
  );

  console.log("⑤ 영상 렌더...");
  const videoPath = await renderReel(inputProps);
  console.log(`   🎬 ${videoPath}`);

  // 첫 프레임(썸네일 카드)을 이미지로 추출 — 유튜브 커스텀 썸네일용
  // (유튜브는 첫 프레임을 자동 채택하지 않으므로 thumbnails.set 으로 직접 지정)
  const thumbPath = await extractThumb(videoPath);
  // 아트디렉터 디자인 검수 — 로그만 남기고 게시는 막지 않는다(주간 아트디렉터 점검이 모아서 디자인 코드를 고침)
  await reviewDesign({ kind: "shorts", videoPath, thumbPath, title: idea.title });

  if (args.publish) {
    // 인스타·유튜브를 각각 독립 게시 (한쪽이 실패해도 다른 쪽은 진행)
    let anyFail = false;
    let anyPublished = false;

    console.log("⑥ 인스타그램 업로드...");
    try {
      const { mediaId } = await publishReel(videoPath, metadata);
      console.log(`   ✅ 인스타 게시 완료 (media id: ${mediaId})`);
      anyPublished = true;
    } catch (e) {
      anyFail = true;
      console.error(`   ❌ 인스타 게시 실패: ${e instanceof Error ? e.message : String(e)}`);
    }

    let ytVideoId: string | undefined;
    if (config.youtube.enabled) {
      console.log("⑦ 유튜브 업로드...");
      try {
        const { videoId } = await publishYouTube(
          videoPath,
          idea,
          metadata,
          thumbPath,
          // 썸네일 카드가 맨 앞 1프레임을 차지하므로 컴포지션과 같은 조건을 써야 싱크가 맞는다
          reelSrt(segments, Boolean(inputProps.thumbTitle), 30),
          reelSrt(segments, Boolean(inputProps.thumbTitle), 30, "en"),
        );
        ytVideoId = videoId;
        console.log(`   ✅ 유튜브 게시 완료: https://youtu.be/${videoId}`);
        anyPublished = true;
      } catch (e) {
        anyFail = true;
        console.error(`   ❌ 유튜브 게시 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      console.log("   ⏭️  유튜브 미설정(YT_CLIENT_ID/SECRET/REFRESH_TOKEN) — 유튜브 게시 건너뜀");
    }

    // 한 곳이라도 실제 게시됐으면 이력에 기록 (소재·해시태그 회피용)
    if (anyPublished) await appendPost(idea, metadata.hashtags, pack.topicAngle.split(" — ")[0].replace(/^소재 각도: /, ""));

    // 썸네일 카드를 저장소 thumbnails/ 폴더에 보관 — 유튜브가 쇼츠 썸네일
    // API 를 열기 전까지 수동 지정용 원본으로 사용 (워크플로가 커밋)
    if (anyPublished && thumbPath) await archiveThumb(thumbPath, idea.caseKey, ytVideoId);

    if (anyFail) process.exitCode = 1; // 하나라도 실패하면 워크플로가 알 수 있게
  } else {
    console.log("   ⏭️  업로드 생략 (--no-publish). 영상 파일만 생성했습니다.");
  }
  // 게시분·드라이런 모두 원고 전문을 로그에 남긴다 — 영상 아티팩트를 못 내려받는 환경에서도
  // 사실·표현을 사후 검토할 수 있게(감동 편 점검·주간 감사용).
  console.log("   📜 검토용 원고 ────────");
  console.log(`   제목: ${idea.title}`);
  console.log(`   썸네일: ${(idea.thumbTitle ?? "").replace(/\n/g, " / ")} [${idea.thumbBadge ?? ""}]`);
  script.segments.forEach((s, i) => console.log(`   ${String(i + 1).padStart(2, "0")}. ${s.text}`));
  console.log(`   캡션: ${metadata.caption.replace(/\n/g, " ")}`);
  console.log("   ────────────────");
}

const execFileAsync = promisify(execFile);

/**
 * 게시된 영상의 썸네일 카드를 thumbnails/날짜-사건키-영상ID.jpg 로 보관.
 * 실패해도 게시 결과에는 영향 없음.
 */
async function archiveThumb(
  thumbPath: string,
  caseKey: string,
  videoId?: string,
): Promise<void> {
  try {
    const dir = "thumbnails";
    await fs.mkdir(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const name = `${date}-${caseKey}${videoId ? `-${videoId}` : ""}.jpg`;
    await fs.copyFile(thumbPath, path.join(dir, name));
    console.log(`   🗂️  썸네일 보관: thumbnails/${name}`);
  } catch (e) {
    console.warn(`   ⚠️ 썸네일 보관 실패(게시는 완료됨): ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * 렌더된 영상의 첫 프레임(썸네일 카드)을 jpg 로 추출.
 * ffmpeg 미설치/실패 시 undefined (썸네일 지정만 생략, 게시는 계속).
 */
async function extractThumb(videoPath: string): Promise<string | undefined> {
  const thumbPath = path.join(config.paths.out, "thumb.jpg");
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      videoPath,
      "-vf",
      "select=eq(n\\,0)",
      "-frames:v",
      "1",
      "-q:v",
      "2",
      thumbPath,
    ]);
    const st = await fs.stat(thumbPath);
    if (st.size < 1024 || st.size > 2 * 1024 * 1024) throw new Error(`비정상 크기 ${st.size}B`);
    console.log(`   🖼️  썸네일 추출: ${thumbPath} (${Math.round(st.size / 1024)}KB)`);
    return thumbPath;
  } catch (e) {
    console.warn(`   ⚠️ 썸네일 추출 실패(게시는 계속): ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/**
 * public/bgm/ 에 mp3 가 있으면 그 상대경로 반환 (없으면 undefined)
 * @param warm 감동 실화 편 — warm*.mp3 만 쓴다. 그 외엔 warm*.mp3 를 빼고 고른다(으스스한 사건에 잔잔한 곡이 깔리지 않게).
 */
async function findBgm(warm = false): Promise<string | undefined> {
  try {
    const files = (await fs.readdir(config.paths.bgm)).filter(
      (f) => f.toLowerCase().endsWith(".mp3") && (f.startsWith("aaa-") || f.startsWith("warm") === warm),
    );
    // BGM_URL 오버라이드(aaa- 접두사)가 있으면 그것을 우선, 없으면 랜덤(영상마다 다른 분위기)
    const override = files.find((f) => f.startsWith("aaa-"));
    const mp3 = override ?? files[Math.floor(Math.random() * files.length)];
    if (mp3) {
      console.log(`   🎵 BGM: bgm/${mp3}${override ? " (override)" : " (랜덤)"}`);
      return `bgm/${mp3}`;
    }
  } catch {
    /* bgm 폴더 없음 */
  }
  console.log("   🎵 BGM 없음 (public/bgm/ 에 mp3 를 넣으면 자동 적용)");
  return undefined;
}

function parseArgs(argv: string[]) {
  const args = { only: "", seed: "" as string | undefined, publish: true };
  for (const a of argv) {
    if (a.startsWith("--only=")) args.only = a.slice("--only=".length);
    else if (a.startsWith("--seed=")) args.seed = a.slice("--seed=".length);
    else if (a === "--no-publish") args.publish = false;
  }
  if (!args.seed) args.seed = undefined;
  return args;
}

main().catch((err) => {
  console.error("파이프라인 실패:", err);
  process.exit(1);
});
