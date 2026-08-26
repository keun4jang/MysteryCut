/**
 * 사실 검증용 원문 수집 — 위키미디어 자매 프로젝트 API (무료·무제한, 키 불필요).
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
 *
 * ★위키백과만으로는 소재가 마른다(2026-08-25 실측: 후보 4개 중 3개가 원문
 * 미달로 탈락). 그래서 같은 라이선스(CC BY, 상업적 재사용 허용)·같은 API
 * 형태를 쓰는 자매 프로젝트도 함께 뒤진다:
 *   위키뉴스 — 사건 당시 보도 기사. 짧지만 위키백과에 아직 문서가 없는
 *              사건(특히 미제사건)의 유일한 원문인 경우가 있다.
 *   위키문헌 — 조선왕조실록 국역본 등 원문 그대로의 1차 사료.
 * 검증(2026-08-25): en.wikinews.org 검색으로 "Television appeal for 1984
 * murder in Bath, England" 같은 실제 미제사건 기사를 확인했고, 세 프로젝트
 * 모두 같은 TextExtracts 확장(prop=extracts)이 켜져 있어 기존 fetchDoc 로직을
 * 그대로 재사용할 수 있다.
 */

const UA = "MysteryCutBot/1.0 (https://github.com/keun4jang/MysteryCut; educational mystery documentary channel)";

/** 위키미디어 자매 프로젝트 — 전부 같은 api.php 형태, 같은 CC BY 라이선스 */
export type WikiProject = "wikipedia" | "wikinews" | "wikisource";
const PROJECT_DOMAIN: Record<WikiProject, string> = {
  wikipedia: "wikipedia.org",
  wikinews: "wikinews.org",
  wikisource: "wikisource.org",
};
const PROJECT_LABEL_KO: Record<WikiProject, string> = {
  wikipedia: "위키백과",
  wikinews: "위키뉴스",
  wikisource: "위키문헌",
};

export interface SourceDoc {
  title: string;
  url: string;
  lang: "ko" | "en";
  project: WikiProject;
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

async function api(
  project: WikiProject,
  lang: string,
  params: Record<string, string>,
): Promise<unknown> {
  const qs = new URLSearchParams({ format: "json", origin: "*", ...params });
  const res = await fetch(`https://${lang}.${PROJECT_DOMAIN[project]}/w/api.php?${qs}`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`${project} ${lang} HTTP ${res.status}`);
  return res.json();
}

/** 검색어로 문서 제목 후보를 찾는다 */
async function searchTitles(
  project: WikiProject,
  lang: string,
  query: string,
  limit = 2,
): Promise<string[]> {
  const json = (await api(project, lang, {
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: String(limit),
  })) as { query?: { search?: Array<{ title: string }> } };
  return (json.query?.search ?? []).map((s) => s.title);
}

/** 문서 본문(평문)과 외부 링크를 받는다 */
async function fetchDoc(
  project: WikiProject,
  lang: "ko" | "en",
  title: string,
): Promise<SourceDoc | null> {
  const json = (await api(project, lang, {
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

  const domain = PROJECT_DOMAIN[project];
  return {
    title: page?.title ?? title,
    url: `https://${lang}.${domain}/wiki/${encodeURIComponent((page?.title ?? title).replace(/ /g, "_"))}`,
    lang,
    project,
    extract: extract.slice(0, MAX_EXTRACT),
    references,
  };
}

/** 원문 탐색 순서 — 위키백과가 가장 신뢰도 높은 1차 후보, 나머지는 보충용 */
const SEARCH_ORDER: WikiProject[] = ["wikipedia", "wikinews", "wikisource"];

/**
 * 검색어 목록으로 원문을 모은다. 위키백과 → 위키뉴스 → 위키문헌 순으로,
 * 각 프로젝트 안에서는 한국어 문서를 먼저 찾고 없거나 짧으면 영어로.
 * 실패는 조용히 넘긴다 — 출처가 하나도 없으면 호출부가 다른 사건을 고르게 한다.
 */
export async function gatherSources(terms: string[]): Promise<SourceDoc[]> {
  const out: SourceDoc[] = [];
  const seen = new Set<string>();
  let total = 0;
  const done = () => total >= MAX_TOTAL || out.length >= 3;

  for (const project of SEARCH_ORDER) {
    if (done()) break;
    for (const lang of ["ko", "en"] as const) {
      if (done()) break;
      for (const term of terms) {
        if (done()) break;
        const q = term.trim();
        if (!q) continue;
        try {
          const titles = await searchTitles(project, lang, q);
          for (const t of titles) {
            const key = `${project}:${lang}:${t}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const doc = await fetchDoc(project, lang, t);
            if (!doc) continue;
            const { ok, score } = isRelevant(terms, doc.title, doc.extract);
            if (!ok) {
              console.log(
                `  ↩︎ 무관한 문서 제외: "${doc.title}" (${project}/${lang}, 검색어 "${q}", 점수 ${score})`,
              );
              continue;
            }
            out.push(doc);
            total += doc.extract.length;
            break; // 검색어당 문서 1건이면 충분
          }
        } catch (e) {
          console.warn(
            `  ⚠️ ${project} 조회 실패(${lang}/${q}): ${e instanceof Error ? e.message : e}`,
          );
        }
      }
    }
  }
  return out;
}

/**
 * 소재 발굴 그라운딩용 검색어 — 장르별로 나눠 편중을 피한다.
 * '사건', '미스터리' 같은 범용어만 넣으면 위키백과 자체 안내문서(분류·목록
 * 문서)만 걸리므로, 실제 개별 사건 문서가 잘 걸리는 조합으로 골랐다.
 */
const DISCOVERY_QUERIES: Array<{ lang: "ko" | "en"; q: string }> = [
  { lang: "ko", q: "미제 사건" },
  { lang: "ko", q: "실종 사건" },
  { lang: "ko", q: "판결 논란" },
  { lang: "ko", q: "괴담" },
  { lang: "ko", q: "의문사" },
  { lang: "ko", q: "재심 무죄" },
  { lang: "en", q: "unsolved murder" },
  { lang: "en", q: "unexplained disappearance" },
  { lang: "en", q: "wrongful conviction" },
  { lang: "en", q: "cold case" },
  { lang: "en", q: "unsolved mystery" },
];

/** 목록·분류 안내문서처럼 사건 자체가 아닌 문서를 걸러낸다 */
function looksLikeIndexPage(title: string): boolean {
  return /^(목록|분류|List of|Category:|Timeline of)/i.test(title);
}

/**
 * 실제로 위키백과(자매 프로젝트 포함)에 문서가 있는 소재 후보를 검색으로 뽑는다.
 *
 * LLM 이 기억만으로 사건명을 지어내면 나중에 gatherSources 단계에서 대부분
 * 버려진다(실측 2026-08-25: 롱폼 후보 4개 중 3개가 원문 미달로 탈락 — 물괴
 * 소동 2,975자, 저주 미스터리 1,348자, 경석 0건). 대본을 쓰기 전이 아니라
 * **소재를 고르기 전**에 실존 문서 목록을 프롬프트에 실어주면, 모델이 그중
 * 하나를 고를 때 원문 확보 성공률이 크게 오른다. 다만 목록은 참고용이지
 * 강제가 아니다 — 모델이 더 적합한 사건을 알고 있으면 그걸 써도 된다.
 *
 * 매 호출마다 검색어를 무작위로 몇 개만 골라서 써서(고정된 첫 페이지만
 * 반복해서 보여주지 않도록), 회차마다 다른 후보군이 보이게 한다.
 */
export async function discoverCandidateTitles(limit = 24): Promise<string[]> {
  const picks = [...DISCOVERY_QUERIES].sort(() => Math.random() - 0.5).slice(0, 4);
  const titles = new Set<string>();
  for (const { lang, q } of picks) {
    try {
      const found = await searchTitles("wikipedia", lang, q, 8);
      for (const t of found) {
        if (!looksLikeIndexPage(t)) titles.add(t);
      }
    } catch (e) {
      console.warn(`  ⚠️ 소재 후보 검색 실패(${lang}/${q}): ${e instanceof Error ? e.message : e}`);
    }
    if (titles.size >= limit) break;
  }
  return [...titles].slice(0, limit);
}

/** 프롬프트에 붙일 원문 블록 */
export function sourcesPromptBlock(docs: SourceDoc[]): string {
  if (!docs.length) return "";
  const body = docs
    .map(
      (d, i) =>
        `[출처 ${i + 1}] ${d.title} (${d.lang === "ko" ? "한국어" : "영문"} ${PROJECT_LABEL_KO[d.project]})\n${d.extract}`,
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
