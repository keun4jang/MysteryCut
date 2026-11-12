/**
 * AI Horde — 자원봉사 GPU 로 돌아가는 무료 이미지 생성(익명 키, 과금 없음). 11/12 동물 그림체 시험용.
 * 느리고(장당 수 분) 초당 2건 요청 제한이 있다. 실패하면 빈 배열(호출부가 기존 사진으로 폴백).
 */
const H = { apikey: "0000000000", "Content-Type": "application/json", "Client-Agent": "mystery-cut:1.0:anon" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function hordeGenerate(
  prompt: string,
  negative: string,
  width: number,
  height: number,
  n = 2,
  timeoutMs = 25 * 60_000,
): Promise<Buffer[]> {
  try {
    let id: string | undefined;
    for (let t = 0; t < 4 && !id; t++) {
      const res = await fetch("https://aihorde.net/api/v2/generate/async", {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          prompt: `${prompt} ### ${negative}`,
          params: { width, height, steps: 28, cfg_scale: 6, sampler_name: "k_dpmpp_2m", karras: true, n },
          models: ["AlbedoBase XL (SDXL)", "Juggernaut XL"],
          nsfw: false,
          censor_nsfw: true,
          r2: true,
        }),
      });
      const j = (await res.json()) as { id?: string; message?: string };
      id = j.id;
      if (!id) {
        console.log(`   🦊 Horde 요청 거절(${res.status} ${j.message ?? ""}) — 재시도`);
        await sleep(3000 * (t + 1));
      }
    }
    if (!id) return [];
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await sleep(10_000);
      const c = (await (await fetch(`https://aihorde.net/api/v2/generate/check/${id}`, { headers: H })).json()) as {
        done?: boolean;
        faulted?: boolean;
      };
      if (c.faulted) return [];
      if (!c.done) continue;
      const st = (await (await fetch(`https://aihorde.net/api/v2/generate/status/${id}`, { headers: H })).json()) as {
        generations?: Array<{ img: string; censored?: boolean }>;
      };
      const out: Buffer[] = [];
      for (const g of st.generations ?? []) {
        if (g.censored) continue;
        const r = await fetch(g.img);
        if (r.ok) out.push(Buffer.from(await r.arrayBuffer()));
      }
      return out;
    }
    console.log("   🦊 Horde 시간 초과");
  } catch (e) {
    console.log(`   🦊 Horde 오류: ${e instanceof Error ? e.message : e}`);
  }
  return [];
}
