/**
 * 저축은행 업계 뉴스 허브 - Cloudflare Worker 백엔드
 *
 * KV 네임스페이스 바인딩 이름: SB_NEWS  (Cloudflare 대시보드/wrangler.toml에서 이 이름으로 바인딩)
 *
 * 환경변수(Secret):
 *   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET  - 네이버 뉴스 검색 오픈API
 *   GEMINI_API_KEY                        - 광고/보도자료성 기사 필터링용
 *
 * 저장 키:
 *   news:latest -> { updatedAt, articles: [...] }
 *
 * 동작:
 *   - Cron(scheduled)이 30분마다 전체 수집 파이프라인을 돌려 KV에 저장
 *   - GET /api/news는 KV 값을 그대로 반환 (없거나 너무 오래됐으면 즉시 한 번 수집해서 응답)
 *   - GET /api/refresh는 수동으로 즉시 재수집 (테스트/강제 새로고침용, 인증 없음 - 공개 뉴스라 민감정보 아님)
 */

const KEYWORDS = [
  '저축은행',
  'OK저축은행',
  'SBI저축은행',
  '웰컴저축은행',
  '페퍼저축은행',
  '애큐온저축은행',
  '저축은행중앙회',
  '저축은행 금리',
  '금융위원회 저축은행',
];

const MAX_AGE_HOURS = 72;
const NAVER_DISPLAY = 20;
const STALE_MS = 60 * 60 * 1000; // KV 값이 이보다 오래되면 응답 전에 즉시 재수집

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .trim();
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function fetchNaverNews(keyword, env) {
  const url =
    'https://openapi.naver.com/v1/search/news.json' +
    '?query=' + encodeURIComponent(keyword) +
    '&display=' + NAVER_DISPLAY +
    '&sort=date';

  const resp = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET,
    },
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  if (!data.items) return [];

  return data.items.map((item) => {
    const link = item.originallink || item.link;
    return {
      title: stripHtml(item.title),
      description: stripHtml(item.description),
      link,
      source: hostnameOf(link),
      pubDate: item.pubDate,
      keyword,
    };
  });
}

// 제목 비교용 정규화: 공백/특수문자 제거, 소문자화
function normalizeTitle(title) {
  return title.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

function bigrams(str) {
  const set = new Set();
  for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
  return set;
}

function jaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const g of setA) if (setB.has(g)) inter++;
  return inter / (setA.size + setB.size - inter);
}

// 같은 기사를 여러 매체가 보도한 경우(제목 유사도 높음) 하나로 묶기
function dedupeAndGroup(articles) {
  const byLink = new Map();
  for (const a of articles) {
    if (!byLink.has(a.link)) byLink.set(a.link, a);
  }
  const unique = [...byLink.values()];

  const groups = [];
  const used = new Array(unique.length).fill(false);
  const normBigrams = unique.map((a) => bigrams(normalizeTitle(a.title)));

  for (let i = 0; i < unique.length; i++) {
    if (used[i]) continue;
    const group = [unique[i]];
    used[i] = true;
    for (let j = i + 1; j < unique.length; j++) {
      if (used[j]) continue;
      if (jaccard(normBigrams[i], normBigrams[j]) >= 0.75) {
        group.push(unique[j]);
        used[j] = true;
      }
    }
    group.sort((a, b) => new Date(a.pubDate) - new Date(b.pubDate));
    const primary = group[0];
    const otherSources = [...new Set(group.slice(1).map((g) => g.source))].filter(
      (s) => s !== primary.source
    );
    const keywords = [...new Set(group.map((g) => g.keyword))];
    groups.push({ ...primary, otherSources, keywords });
  }
  return groups;
}

function withinFreshness(article, maxAgeHours) {
  const t = new Date(article.pubDate).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= maxAgeHours * 3600 * 1000;
}

const OG_IMAGE_TIMEOUT_MS = 5000;
const MAX_IMAGE_FETCH = 30; // Worker 서브리퀘스트 한도 보호 + 실제로 화면에 노출될 만큼만

// 기사 원문의 og:image(그 기사에 실제로 쓰인 대표 사진)를 가져온다.
// 네이버 이미지 검색 등으로 "연관된" 이미지를 따로 찾는 대신, 해당 기사 그 자체의 이미지를 쓴다.
async function fetchOgImage(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OG_IMAGE_TIMEOUT_MS);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SavingsBankNewsBot/1.0)' },
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const html = await resp.text();
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    if (!match) return null;
    const img = match[1];
    return img.startsWith('//') ? 'https:' + img : img;
  } catch {
    return null; // 느리거나 차단하는 매체는 그냥 이미지 없이 표시
  }
}

async function attachImages(articles) {
  const targets = articles.slice(0, MAX_IMAGE_FETCH);
  const images = await Promise.all(targets.map((a) => fetchOgImage(a.link)));
  targets.forEach((a, i) => {
    if (images[i]) a.image = images[i];
  });
  return articles;
}

async function classifyAds(articles, env) {
  if (articles.length === 0) return articles;

  const list = articles
    .map((a, i) => `${i}. 제목: ${a.title}\n   설명: ${a.description}\n   출처: ${a.source}`)
    .join('\n\n');

  const prompt =
    '아래는 저축은행 업계 관련 키워드로 수집된 뉴스 기사 후보 목록입니다.\n\n' +
    '각 기사가 (A) 실제 보도 기사인지, 또는 (B) 광고/보도자료/협찬/특정 상품 홍보성 콘텐츠인지 판별하세요.\n' +
    '(B)에 해당하는 예: 특정 상품·이벤트 단순 홍보, "무료체험", 협찬기사, 블로그/카페형 홍보글, 보험·대출 상품 광고성 기사.\n' +
    '실제 뉴스 보도만 keep:true로, 광고/홍보성이면 keep:false로 표시하세요.\n\n' +
    list +
    '\n\n아래 JSON 배열 형식으로만, 다른 설명 없이 응답하세요: [{"i":0,"keep":true}, {"i":1,"keep":false}, ...]';

  try {
    const resp = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=' +
        env.GEMINI_API_KEY,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );
    if (!resp.ok) return articles;
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return articles;
    const decisions = JSON.parse(match[0]);
    const keepSet = new Set(
      decisions.filter((d) => d.keep !== false).map((d) => d.i)
    );
    return articles.filter((_, i) => keepSet.has(i));
  } catch {
    // 분류 실패 시 안전하게 전체 유지 (과도한 삭제보다 낫다고 판단)
    return articles;
  }
}

async function collectNews(env) {
  const results = await Promise.all(KEYWORDS.map((k) => fetchNaverNews(k, env)));
  const all = results.flat();

  const fresh = all.filter((a) => withinFreshness(a, MAX_AGE_HOURS));
  const grouped = dedupeAndGroup(fresh);
  const filtered = await classifyAds(grouped, env);

  filtered.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const payload = { updatedAt: new Date().toISOString(), articles: filtered };
  await env.SB_NEWS.put('news:latest', JSON.stringify(payload));
  return payload;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (path === '/api/news' && request.method === 'GET') {
        const raw = await env.SB_NEWS.get('news:latest');
        let payload = raw ? JSON.parse(raw) : null;

        const isStale = !payload || Date.now() - new Date(payload.updatedAt).getTime() > STALE_MS;
        if (isStale) {
          payload = await collectNews(env);
        }
        return json(payload);
      }

      if (path === '/api/refresh' && request.method === 'GET') {
        const payload = await collectNews(env);
        return json(payload);
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(collectNews(env));
  },
};
