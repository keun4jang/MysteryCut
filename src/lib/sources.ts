/**
 * 사실 검증용 원문 수집 — 위키백과 API (무료·무제한, 키 불필요).
 *
 * 지금까지는 소재 발굴부터 대본까지 LLM 한 번의 호출로 만들었다. 실존 사건·
 * 판결·사망을 다루면서 출처 대조가 0회였다는 뜻이고, 실제로 "이거 사기라고
 * 밝혀진 건 왜 얘기 안 해요" 같은 댓글이 달렸다. 롱폼은 10분 내내 사실을
 * 나열하므로 이 위험이 몇 배로 커진다.
 *
 * 그래서 대본을 쓰기 전에 사건 원문을 받아오고, 대본은 그 원문에 근거해서만
 * 쓰게 한다. 유료 검색 API 를 쓸 수 없으므로(비용 0 원칙) 위키백과를 쓴다.
 * 완벽한 1차 사료는 아니지만, 연도·인명·지명·결말이 통째로 지어내진 것을
 * 막는 것만으로도 신뢰도가 크게 오른다. 문서에 걸린 외부 링크를 함께 모아
 * 설명란 참고자료로 노출해 '독자적 조사'의 근거도 남긴다.
 */

const UA = "MysteryCutBot/1.0 (https://github.com/keun4jang/MysteryCut; educational mystery documentary channel)";

export interface SourceDoc {
  title: string;
  url: string;
  lang: "ko" | "en";
  /** 문서 본문(평문). 프롬프트에 넣기 위해 길이를 자른다 */
  extract: string;
  /** 문서에 걸린 외부 참고 링크 (설명란 인용용) */
  references: string[];
}

/** 문서 1건에서 가져올 본문 최대 길이 (프롬프트 토큰 보호) */
const MAX_EXTRACT = 12_000;
/** 전체 합계 상한 */
const MAX_TOTAL = 30_000;

/**
 * 관련성 검사 — 위키백과 검색은 어떤 질의에도 '뭔가'를 돌려준다.
 * 실측(2026-08): "헬렌 브랙" → '1953년 미술', 존재하지 않는 사건명 → '증강 현실'.
 * 무관한 문서를 '사건 원문'이라고 프롬프트에 넣으면 검증이 아니라 오염이 된다.
 * 그래서 검색어의 고유 토큰이 문서 제목이나 도입부에 실제로 있는지 확인한다.
 */
const STOP_TOKENS = new Set([
  "사건", "미스터리", "실종", "사망", "의문사", "괴담", "전설", "실화", "진실",
  "case", "cases", "mystery", "mysteries", "disappearance", "disappeared",
  "murder", "murders", "death", "incident", "unsolved", "the", "of", "and",
]);

function norm(s: string): string {
  return s.toLowerCase().replace(/[^0-9a-z\uac00-\ud7a3]+/g, " ").trim();
}

function queryTokens(s: string): string[] {
  return norm(s)
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_TOKENS.has(t));
}

/**
 * 제목 적중을 필수로 본다.
 *
 * 도입부 적중만으로 통과시켰더니 "헬렌 브랙" 검색에 '1953년 미술' 문서가
 * 뚫렸다(그 문서에 헬렌 프랑켄탈러와 브라크가 등장해 두 토큰이 다 걸렸다).
 * 사건 문서라면 사건 이름이 제목에 있는 것이 정상이므로 제목을 필수 조건으로
 * 둔다. 이러면 제목이 많이 다른 좋은 사건을 놓칠 수 있지만, 그때는 호출부가
 * 다른 사건을 고르면 그만이다. 틀린 원문을 '검증된 사실'로 넣는 쪽이 훨씬 나쁘다.
 */
function scoreOne(query: string, titleN: string, leadN: string): { ok: boolean; score: number } {
  const qt = queryTokens(query);
  if (!qt.length) return { ok: false, score: 0 };
  let titleHits = 0;
  let score = 0;
  for (const t of qt) {
    if (titleN.includes(t)) {
      titleHits += 1;
      score += 2;
    } else if (leadN.includes(t)) {
      score += 1;
    }
  }
  // 제목 적중이 없으면 탈락. 검색어가 길면(3토큰 이상) 한 토큰만 우연히
  // 걸린 경우를 배제하기 위해 근거를 더 요구한다.
  const ok = titleHits >= 1 && (qt.length <= 2 || titleHits >= 2 || score >= 3);
  return { ok, score };
}

/**
 * 관련성은 '이 문서를 찾아낸 검색어' 하나가 아니라 **전체 검색어**로 판정한다.
 *
 * 실측 버그(2026-08-19): 영어 검색어 "Bobby Dunbar" 로 한국어 위키를 검색해
 * 정답 문서인 '바비 던바 실종 사건'을 찾았는데, 한글 제목에 ASCII 토큰이
 * 없다는 이유로 탈락시켰다. 검색어 목록에는 한국어 표기도 함께 들어오므로
 * 그중 하나라도 제목에 걸리면 관련 문서로 본다.
 */
function isRelevant(
  terms: string[],
  title: string,
  extract: string,
): { ok: boolean; score: number } {
  const titleN = norm(title);
  const leadN = norm(extract.slice(0, 1500));
  let best = { ok: false, score: 0 };
  for (const t of terms) {
    const r = scoreOne(t, titleN, leadN);
    if (r.ok && !best.ok) best = r;
    else if (r.ok === best.ok && r.score > best.score) best = r;
  }
  return best;
}

async function api(lang: string, params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams({ format: "json", origin: "*", ...params });
  const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${qs}`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`위키백과 ${lang} HTTP ${res.status}`);
  return res.json();
}

/** 검색어로 문서 제목 후보를 찾는다 */
async function searchTitles(lang: string, query: string, limit = 2): Promise<string[]> {
  const json = (await api(lang, {
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: String(limit),
  })) as { query?: { search?: Array<{ title: string }> } };
  return (json.query?.search ?? []).map((s) => s.title);
}

/** 문서 본문(평문)과 외부 링크를 받는다 */
async function fetchDoc(lang: "ko" | "en", title: string): Promise<SourceDoc | null> {
  const json = (await api(lang, {
    action: "query",
    prop: "extracts|extlinks",
    explaintext: "1",
    redirects: "1",
    ellimit: "40",
    titles: title,
  })) as {
    query?: {
      pages?: Record<
        string,
        { title?: string; extract?: string; extlinks?: Array<{ "*": string }> }
      >;
    };
  };
  const page = Object.values(json.query?.pages ?? {})[0];
  const extract = page?.extract?.trim();
  if (!extract || extract.length < 400) return null; // 토막글은 검증에 쓸모없다

  // 참고자료로 쓸 만한 외부 링크만 (위키미디어 내부·아카이브 봇 링크 제외)
  const references = (page?.extlinks ?? [])
    .map((l) => l["*"])
    .filter((u) => /^https?:\/\//i.test(u))
    .filter((u) => !/wikimedia|wikidata|wikipedia|archive\.org\/wayback|doi\.org\/10\.\d+\/zenodo/i.test(u))
    .slice(0, 4);

  return {
    title: page?.title ?? title,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent((page?.title ?? title).replace(/ /g, "_"))}`,
    lang,
    extract: extract.slice(0, MAX_EXTRACT),
    references,
  };
}

/**
 * 검색어 목록으로 원문을 모은다. 한국어 문서를 먼저 찾고, 없거나 짧으면 영어로.
 * 실패는 조용히 넘긴다 — 출처가 하나도 없으면 호출부가 다른 사건을 고르게 한다.
 */
export async function gatherSources(terms: string[]): Promise<SourceDoc[]> {
  const out: SourceDoc[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (const lang of ["ko", "en"] as const) {
    for (const term of terms) {
      if (total >= MAX_TOTAL || out.length >= 3) break;
      const q = term.trim();
      if (!q) continue;
      try {
        const titles = await searchTitles(lang, q);
        for (const t of titles) {
          const key = `${lang}:${t}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const doc = await fetchDoc(lang, t);
          if (!doc) continue;
          const { ok, score } = isRelevant(terms, doc.title, doc.extract);
          if (!ok) {
            console.log(`  ↩︎ 무관한 문서 제외: "${doc.title}" (검색어 "${q}", 점수 ${score})`);
            continue;
          }
          out.push(doc);
          total += doc.extract.length;
          break; // 검색어당 문서 1건이면 충분
        }
      } catch (e) {
        console.warn(`  ⚠️ 위키백과 조회 실패(${lang}/${q}): ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  return out;
}

/** 프롬프트에 붙일 원문 블록 */
export function sourcesPromptBlock(docs: SourceDoc[]): string {
  if (!docs.length) return "";
  const body = docs
    .map(
      (d, i) =>
        `[출처 ${i + 1}] ${d.title} (${d.lang === "ko" ? "한국어 위키백과" : "영문 위키백과"})\n${d.extract}`,
    )
    .join("\n\n---\n\n");
  return [
    "",
    "[★★사건 원문 — 대본의 사실은 전부 여기서만 가져와라]",
    "아래는 이번 사건에 대해 실제로 수집한 백과사전 원문이다. 대본에 쓰는 연도·인명·지명·",
    "수사 경과·판결·결말은 **반드시 이 원문에 적힌 것만** 사용하라. 원문에 없는 사실을",
    "지어내지 마라. 원문과 충돌하는 내용을 쓰지 마라.",
    "- 원문에 '조작으로 밝혀졌다', '해명됐다', '~로 결론났다'는 내용이 있으면 반드시 대본 후반에 포함하라. 이걸 빼면 시청자가 댓글로 지적한다.",
    "- 원문에 없어서 확인이 안 되는 대목은 단정하지 말고 '기록에 남아 있지 않다'고 말하거나 아예 빼라.",
    "- 원문이 추측·설이라고 표시한 것은 사실처럼 쓰지 말고 '~라는 주장이 있다'로 처리하라.",
    "",
    body,
    "",
  ].join("\n");
}

/** 설명란·캡션에 붙일 참고자료 목록 */
export function sourcesCitation(docs: SourceDoc[]): string {
  if (!docs.length) return "";
  const lines: string[] = ["주요 참고 자료"];
  let n = 1;
  for (const d of docs) {
    lines.push(`${n++}. ${d.title} — ${d.url}`);
    for (const r of d.references.slice(0, 2)) lines.push(`${n++}. ${r}`);
  }
  lines.push("");
  lines.push("영상 속 인물·장소 이미지는 실제 사건 자료가 아닌 내용 이해를 위한 자료 이미지입니다.");
  return lines.join("\n");
}
