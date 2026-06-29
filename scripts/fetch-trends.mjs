import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CONFIG_DIR = path.join(ROOT, "config");
const DATA_DIR = path.join(ROOT, "data");
const SNAPSHOT_DIR = path.join(DATA_DIR, "snapshots");
const TRENDS_RSS_URL = "https://trends.google.co.jp/trending/rss?geo=JP";
const GOOGLE_NEWS_SEARCH_URL = "https://news.google.com/rss/search";
const MAX_WATCH_QUERIES = 80;
const STANDALONE_WATCHLISTS = new Set(["sns_platform", "format", "seasonal", "local_leisure"]);
const BROAD_DISPLAY_TERMS = new Set([
  "tiktok",
  "instagram",
  "youtube",
  "youtube shorts",
  "xで話題",
  "threads",
  "sns",
  "リール",
  "ミーム",
  "バズ",
  "ランキング",
  "話題",
  "話題の",
  "人気",
  "人気の",
  "流行",
  "流行りの",
  "イベント",
  "旅行",
  "観光",
  "温泉",
  "グルメ",
  "フェリー",
  "ボウリング",
  "スポーツ観戦",
  "鹿児島",
  "屋久島",
  "奄美",
  "南九州",
  "梅雨",
  "夏休み",
  "花火",
  "お盆",
  "クリスマス",
  "年末年始",
  "父の日",
  "母の日",
  "記念日",
  "祝日",
  "トレンド音源",
  "ネットミーム",
  "tiktokミーム",
  "あるある",
  "流行ネタ"
]);

const DAILY_TREND_ALLOW_PATTERNS = [
  /アニメ|漫画|マンガ|映画|ドラマ|ゲーム|ガンプラ|キャラクター|VTuber|YouTuber|アイドル|音楽|ライブ|フェス|スポーツ|野球|サッカー|バレー|バスケ|旅行|観光|グルメ|カフェ|スイーツ|ラーメン|温泉|花火|夏休み|梅雨|鹿児島|屋久島|奄美|南九州|かわいい|便利|懐かしい|面白い|新作|発売|コラボ/u
];

const DAILY_TREND_BLOCK_PATTERNS = [
  /訃報|死去|死亡|逮捕|容疑|事件|事故|火災|災害|地震|被害|炎上|批判|謝罪|不祥事|選挙|政治|戦争|紛争|株価|株|日経平均|kospi|政策|裁判|告発|脱線|運転見合わせ|攻撃|大統領|皇位|継承|イラン|異種移植/u
];

const GENERAL_TOPIC_BLOCK_PATTERNS = [
  /訃報|死去|死亡|逮捕|容疑|事件|事故|火災|災害|地震|被害|炎上|謝罪|不祥事|選挙|政治|戦争|紛争|裁判|告発|脱線|運転見合わせ|攻撃|大統領|皇位|継承|イラン|株価|株|日経平均|半導体関連株|異種移植|軍事|ロシア|会見|市政|雨雲|霧雨|注意|日経/u
];

const GENERIC_TITLE_WORDS = new Set(["ニュース", "速報", "まとめ", "今日", "写真", "動画", "発表", "公式", "最新"]);

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
};

const writeJson = async (file, data) => {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
};

const normalize = (value) => String(value || "").toLowerCase();
const includesAny = (text, words) => words.some((word) => normalize(text).includes(normalize(word)));
const idFor = (keyword) => crypto.createHash("sha1").update(keyword).digest("hex").slice(0, 12);
const toJstParts = (date) => {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return parts;
};

const toJstIso = (date) => {
  const parts = toJstParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00+09:00`;
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const decodeXml = (value) =>
  value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");

const stripHtml = (value) => decodeXml(String(value || "").replace(/<[^>]+>/g, " "));
const cleanupText = (value) =>
  stripHtml(value)
    .replace(/\s+-\s+[^-]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

const getTag = (entry, tag) => {
  const match = entry.match(new RegExp(`<${escapeRegExp(tag)}[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`, "i"));
  return match ? decodeXml(match[1]).trim() : "";
};

const extractNewsTitles = (entry) => {
  const matches = [...entry.matchAll(/<ht:news_item_title[^>]*>([\s\S]*?)<\/ht:news_item_title>/gi)];
  return matches.map((match) => decodeXml(match[1]).trim()).filter(Boolean);
};

const parseRssItems = (xml) => {
  const entries = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  return entries.map((entry, index) => ({
    keyword: getTag(entry, "title"),
    sourceRank: index + 1,
    approxTraffic: getTag(entry, "ht:approx_traffic"),
    pubDate: getTag(entry, "pubDate"),
    description: getTag(entry, "description"),
    newsTitles: extractNewsTitles(entry),
    observeUrl: getTag(entry, "link")
  }));
};

const cleanupTopicKeyword = (value) => {
  let text = cleanupText(value)
    .replace(/\s+-\s+[^-]+$/u, "")
    .replace(/（[^）]{1,24}）/gu, "")
    .replace(/\([^)]{1,24}\)/gu, "")
    .replace(/【[^】]{1,24}】/gu, "")
    .replace(/^[「『]|[」』]$/gu, "")
    .trim();
  if (/Gemini/i.test(text)) return "Gemini";
  if (/^W杯/u.test(text)) return "W杯";
  if (/大谷翔平/u.test(text)) return "大谷翔平";
  if (/バレー男子日本代表/u.test(text)) return "バレー男子日本代表";
  if (/趣里＆白洲迅/u.test(text)) return "趣里＆白洲迅";
  if (text.length > 14 && /が/u.test(text)) text = text.split(/が/u)[0].trim();
  const parts = text.split(/[：:、。|｜]/u).map((part) => part.trim()).filter(Boolean);
  return (parts.find((part) => part.length >= 3 && part.length <= 36) || text).replace(/\s+/g, " ").trim();
};

const isUsableGeneralTopic = (keyword, sourceText, globalExcludes) => {
  const value = cleanupTopicKeyword(keyword);
  if (value.length < 3 || value.length > 28) return false;
  if (GENERIC_TITLE_WORDS.has(value)) return false;
  if (/[「」『』“”]|…/.test(value)) return false;
  if (/ニュースの現場|真相|明かす|語る|追いかけている|単なる直感|練習中|苛立つ|低い雲|天気|雨雲|霧雨|注意|市政|混沌の世界|メニュー写真|パフォーマー/u.test(value)) return false;
  if (includesAny(`${value} ${sourceText}`, globalExcludes)) return false;
  if (GENERAL_TOPIC_BLOCK_PATTERNS.some((pattern) => pattern.test(`${value} ${sourceText}`))) return false;
  return true;
};

const candidatePatterns = [
  /#[\p{L}\p{N}_一-龠ぁ-んァ-ヶー]{2,30}/gu,
  /([\p{L}\p{N}一-龠ぁ-んァ-ヶー]{2,24}(?:構文|界隈|チャレンジ|ダンス|音源|ミーム|あるある|選手権|してみた|作ってみた|検証|ルーティン|ビフォーアフター|テンプレ|ネタ|ハック|診断|ポーズ|加工|コーデ|メイク|レシピ|グッズ))/gu,
  /((?:平成|昭和|令和|夏休み|花火|鹿児島|屋久島|奄美|南九州)[\p{L}\p{N}一-龠ぁ-んァ-ヶー]{1,14}(?:ネタ|旅行|グルメ|観光|イベント|あるある|チャレンジ|テンプレ))/gu
];

const normalizeCandidate = (value) =>
  cleanupText(value)
    .replace(/^#/, "")
    .replace(/^[【\[(（「『]+|[】\])）」』]+$/gu, "")
    .replace(/[、。！？!?.].*$/u, "")
    .trim();

const compactCandidate = (value) => {
  const normalized = normalizeCandidate(value);
  const suffixMatch = normalized.match(/([\p{L}\p{N}一-龠ぁ-んァ-ヶー]{2,14}(?:構文|界隈|チャレンジ|ダンス|音源|ミーム|あるある|選手権|してみた|作ってみた|検証|ルーティン|ビフォーアフター|テンプレ|ネタ|ハック|診断|ポーズ|加工|コーデ|メイク|レシピ|グッズ))$/u);
  return suffixMatch ? suffixMatch[1] : normalized;
};

const isGoodCandidate = (candidate, globalExcludes) => {
  const value = normalizeCandidate(candidate);
  const key = normalize(value);
  if (value.length < 3 || value.length > 28) return false;
  if (BROAD_DISPLAY_TERMS.has(key)) return false;
  if (/^\d+$/.test(value)) return false;
  if (includesAny(value, globalExcludes)) return false;
  if (/^[のにをがはへとで、。・\s]|^(だけ|た|ikTok)/u.test(value)) return false;
  if (/[…。！？!?]/u.test(value)) return false;
  if (/ニュース|記事|速報|発表|発売|発売日|会見|容疑|逮捕|募集中|予感|爆誕|大賞20\d{2}|キャンペーン|プレゼント|宣伝部/u.test(value)) return false;
  if (/これは|こちら|まとめ|おすすめ|ランキング|と言われています|しなくてもOK|瞬間/u.test(value)) return false;
  if (/^(明日|本日|今日|昨日|今週|来週|公式|動画|画像|写真)/u.test(value)) return false;
  if (/にチャレンジ|でTikTok|で広がる|コラボして|バズる|使った|紹介する|投稿チャレンジ|良くなる|下ネタ|ボイスを使った/u.test(value)) return false;
  return true;
};

const extractCandidates = (rssItems, globalExcludes) => {
  const phrases = [];
  for (const item of rssItems) {
    const text = cleanupText(`${item.keyword} ${item.description} ${(item.newsTitles || []).join(" ")}`);
    for (const pattern of candidatePatterns) {
      for (const match of text.matchAll(pattern)) {
        const raw = match[1] || match[0];
        const candidate = compactCandidate(raw);
        if (isGoodCandidate(candidate, globalExcludes)) {
          phrases.push({ keyword: candidate, pubDate: item.pubDate });
        }
      }
    }
  }
  return phrases;
};

const fetchRss = async (url) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": "sns-trend-buzzfeed/1.0 (+GitHub Pages trend watcher)"
    }
  });
  if (!response.ok) {
    throw new Error(`RSS failed: ${response.status} ${response.statusText} ${url}`);
  }
  return response.text();
};

const fetchGoogleTrendItems = async () => {
  const xml = await fetchRss(TRENDS_RSS_URL);
  return parseRssItems(xml).map((item) => ({
    ...item,
    signalType: "daily_trend",
    observeUrl: item.observeUrl || "https://trends.google.co.jp/trends/"
  }));
};

const fetchTopicSourceSignals = async (sources, globalExcludes, now) => {
  const aggregated = new Map();
  for (const source of sources) {
    try {
      const xml = await fetchRss(source.url);
      const items = parseRssItems(xml).slice(0, source.type === "google_trends" ? 20 : 30);
      for (const item of items) {
        const keyword = cleanupTopicKeyword(item.keyword);
        const sourceText = `${item.keyword} ${item.description || ""} ${(item.newsTitles || []).join(" ")}`;
        if (!isUsableGeneralTopic(keyword, sourceText, globalExcludes)) continue;
        if (source.type === "google_trends" && DAILY_TREND_BLOCK_PATTERNS.some((pattern) => pattern.test(`${keyword} ${sourceText}`))) continue;
        const key = normalize(keyword);
        const existing = aggregated.get(key) || {
          keyword,
          sourceRank: item.sourceRank,
          signalType: source.type === "google_trends" ? "daily_trend" : "topic_trend",
          sources: [],
          evidenceCount: 0,
          freshness: 0,
          observeUrl: item.observeUrl || source.url
        };
        existing.sources.push({ id: source.id, label: source.label, priority: source.priority || 60, rank: item.sourceRank });
        existing.evidenceCount += source.type === "google_trends" ? 3 : 1;
        existing.freshness += Math.max(0, 7 - daysOld(item.pubDate, now));
        existing.sourceRank = Math.min(existing.sourceRank, item.sourceRank);
        if (source.type === "google_trends") existing.signalType = "daily_trend";
        aggregated.set(key, existing);
      }
    } catch (error) {
      console.warn(`Skipped topic source "${source.id}": ${error.message}`);
    }
  }

  return [...aggregated.values()].map((item) => {
    const topSource = [...item.sources].sort((a, b) => b.priority - a.priority || a.rank - b.rank)[0];
    return {
      ...item,
      watchlist: {
        id: item.signalType === "daily_trend" ? "actual_public_trend" : "public_topic",
        label: item.signalType === "daily_trend" ? "実トレンド" : topSource?.label || "公開話題",
        includeKeywords: [],
        excludeKeywords: [],
        priority: topSource?.priority || 70
      },
      sourceRank: Math.max(1, item.sourceRank - Math.min(8, item.sources.length * 2 + Math.round(item.freshness / 8))),
      evidenceCount: item.evidenceCount,
      topicSourceCount: item.sources.length,
      topicSources: item.sources.map((source) => source.label)
    };
  });
};

const classifyDailyTrend = (raw, globalExcludes) => {
  const text = `${raw.keyword} ${raw.description || ""} ${(raw.newsTitles || []).join(" ")}`;
  if (includesAny(text, globalExcludes)) return null;
  if (DAILY_TREND_BLOCK_PATTERNS.some((pattern) => pattern.test(text))) return null;
  if (!DAILY_TREND_ALLOW_PATTERNS.some((pattern) => pattern.test(text))) return null;
  return {
    id: "actual_public_trend",
    label: "実トレンド",
    includeKeywords: [],
    excludeKeywords: [],
    priority: 120
  };
};

const chooseWatchlist = (keyword, watchlists) => {
  const matches = watchlists
    .filter((watchlist) => includesAny(keyword, watchlist.includeKeywords || []))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  return matches[0] || null;
};

const keywordCatalog = (watchlists) => {
  const seen = new Set();
  const items = [];
  for (const watchlist of watchlists) {
    if (!STANDALONE_WATCHLISTS.has(watchlist.id)) continue;
    for (const keyword of watchlist.includeKeywords || []) {
      const key = normalize(keyword);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ keyword, watchlist });
    }
  }
  return items
    .sort((a, b) => (b.watchlist.priority || 0) - (a.watchlist.priority || 0))
    .slice(0, MAX_WATCH_QUERIES);
};

const searchUrlFor = (keyword, excludeWords, rawQuery = null) => {
  const positiveContext = "(SNS OR TikTok OR Instagram OR YouTube OR X OR リール OR ミーム OR 話題 OR 流行 OR 人気)";
  const negativeContext = excludeWords.map((word) => `-${word}`).join(" ");
  const query = `${rawQuery ? rawQuery : `"${keyword}" ${positiveContext}`} ${negativeContext}`.trim();
  const params = new URLSearchParams({
    q: query,
    hl: "ja",
    gl: "JP",
    ceid: "JP:ja"
  });
  return `${GOOGLE_NEWS_SEARCH_URL}?${params.toString()}`;
};

const daysOld = (pubDate, now) => {
  const time = Date.parse(pubDate);
  if (Number.isNaN(time)) return 7;
  return Math.max(0, (now.getTime() - time) / (24 * 60 * 60 * 1000));
};

const fetchWatchlistSignals = async (watchlists, globalExcludes, now) => {
  const catalog = keywordCatalog(watchlists);
  const results = [];

  for (const { keyword, watchlist } of catalog) {
    if (BROAD_DISPLAY_TERMS.has(normalize(keyword))) continue;
    const excludeWords = [...globalExcludes, ...(watchlist.excludeKeywords || [])];
    const url = searchUrlFor(keyword, excludeWords);
    try {
      const xml = await fetchRss(url);
      const rssItems = parseRssItems(xml)
        .filter((item) => !includesAny(`${item.keyword} ${item.description}`, excludeWords))
        .slice(0, 20);
      if (!rssItems.length) continue;

      const recentItems = rssItems.filter((item) => daysOld(item.pubDate, now) <= 7);
      const freshness = recentItems.reduce((sum, item) => sum + Math.max(0, 7 - daysOld(item.pubDate, now)), 0);
      results.push({
        keyword,
        watchlist,
        sourceRank: Math.max(1, 30 - Math.min(29, recentItems.length + Math.round(freshness / 7))),
        signalType: "watchlist_rss",
        evidenceCount: recentItems.length || rssItems.length,
        observeUrl: `https://news.google.com/search?q=${encodeURIComponent(keyword)}&hl=ja&gl=JP&ceid=JP%3Aja`
      });
    } catch (error) {
      console.warn(`Skipped watchlist keyword "${keyword}": ${error.message}`);
    }
  }

  return results;
};

const fetchConfiguredSignals = async (queries, watchlists, globalExcludes, now) => {
  const byWatchlist = new Map(watchlists.map((watchlist) => [watchlist.id, watchlist]));
  const results = [];

  for (const item of queries) {
    const baseWatchlist = byWatchlist.get(item.watchlist);
    if (!baseWatchlist) continue;
    const watchlist = { ...baseWatchlist, priority: item.priority || baseWatchlist.priority };
    const excludeWords = [...globalExcludes, ...(baseWatchlist.excludeKeywords || [])];
    const url = searchUrlFor(item.keyword, excludeWords, item.query || item.keyword);
    try {
      const xml = await fetchRss(url);
      const rssItems = parseRssItems(xml)
        .filter((entry) => !includesAny(`${entry.keyword} ${entry.description}`, excludeWords))
        .slice(0, 20);
      if (!rssItems.length) continue;

      const recentItems = rssItems.filter((entry) => daysOld(entry.pubDate, now) <= 7);
      const freshness = recentItems.reduce((sum, entry) => sum + Math.max(0, 7 - daysOld(entry.pubDate, now)), 0);
      results.push({
        keyword: item.keyword,
        watchlist,
        sourceRank: Math.max(1, 26 - Math.min(25, recentItems.length + Math.round(freshness / 6))),
        signalType: "configured_rss",
        evidenceCount: recentItems.length || rssItems.length,
        observeUrl: `https://news.google.com/search?q=${encodeURIComponent(item.query || item.keyword)}&hl=ja&gl=JP&ceid=JP%3Aja`
      });
    } catch (error) {
      console.warn(`Skipped configured query "${item.keyword}": ${error.message}`);
    }
  }

  return results;
};

const fetchDiscoverySignals = async (queries, watchlists, globalExcludes, now) => {
  const byWatchlist = new Map(watchlists.map((watchlist) => [watchlist.id, watchlist]));
  const aggregated = new Map();

  for (const query of queries) {
    const baseWatchlist = byWatchlist.get(query.watchlist);
    if (!baseWatchlist) continue;
    const watchlist = { ...baseWatchlist, priority: query.priority || baseWatchlist.priority };
    const excludeWords = [...globalExcludes, ...(baseWatchlist.excludeKeywords || [])];
    const url = searchUrlFor(query.id, excludeWords, query.query);
    try {
      const xml = await fetchRss(url);
      const rssItems = parseRssItems(xml)
        .filter((entry) => !includesAny(`${entry.keyword} ${entry.description} ${(entry.newsTitles || []).join(" ")}`, excludeWords))
        .slice(0, 30);
      const candidates = extractCandidates(rssItems, excludeWords);
      for (const candidate of candidates) {
        const key = normalize(candidate.keyword);
        const existing = aggregated.get(key) || {
          keyword: candidate.keyword,
          watchlist,
          signalType: "discovered_phrase",
          evidenceCount: 0,
          freshness: 0,
          queryPriority: query.priority || 80,
          observeUrl: `https://news.google.com/search?q=${encodeURIComponent(candidate.keyword)}&hl=ja&gl=JP&ceid=JP%3Aja`
        };
        existing.evidenceCount += 1;
        existing.freshness += Math.max(0, 7 - daysOld(candidate.pubDate, now));
        existing.queryPriority = Math.max(existing.queryPriority, query.priority || 80);
        if ((query.priority || 0) > (existing.watchlist.priority || 0)) existing.watchlist = watchlist;
        aggregated.set(key, existing);
      }
    } catch (error) {
      console.warn(`Skipped discovery query "${query.id}": ${error.message}`);
    }
  }

  return [...aggregated.values()]
    .map((item) => ({
      ...item,
      watchlist: { ...item.watchlist, priority: Math.max(item.watchlist.priority || 0, item.queryPriority) },
      sourceRank: Math.max(1, 24 - Math.min(23, item.evidenceCount * 3 + Math.round(item.freshness / 6)))
    }))
    .filter((item) => item.evidenceCount >= 1)
    .sort((a, b) => b.evidenceCount - a.evidenceCount || b.queryPriority - a.queryPriority)
    .slice(0, 45);
};

const fetchMajorTopicSignals = async (topics, globalExcludes, now) => {
  const results = [];
  for (const topic of topics) {
    const url = searchUrlFor(topic.keyword, globalExcludes, topic.query || topic.keyword);
    try {
      const xml = await fetchRss(url);
      const rssItems = parseRssItems(xml)
        .filter((entry) => !includesAny(`${entry.keyword} ${entry.description} ${(entry.newsTitles || []).join(" ")}`, globalExcludes))
        .slice(0, 30);
      const recentItems = rssItems.filter((entry) => daysOld(entry.pubDate, now) <= 7);
      if (!recentItems.length) continue;
      const freshness = recentItems.reduce((sum, entry) => sum + Math.max(0, 7 - daysOld(entry.pubDate, now)), 0);
      results.push({
        keyword: topic.keyword,
        watchlist: {
          id: "major_topic",
          label: topic.category || "大型トピック",
          includeKeywords: [],
          excludeKeywords: [],
          priority: topic.priority || 90
        },
        sourceRank: Math.max(1, 20 - Math.min(19, recentItems.length + Math.round(freshness / 6))),
        signalType: "major_topic",
        evidenceCount: recentItems.length,
        observeUrl: `https://news.google.com/search?q=${encodeURIComponent(topic.query || topic.keyword)}&hl=ja&gl=JP&ceid=JP%3Aja`
      });
    } catch (error) {
      console.warn(`Skipped major topic "${topic.keyword}": ${error.message}`);
    }
  }
  return results;
};

const trendFromHistory = (history, keyword) => {
  const id = idFor(keyword);
  const matches = (history.items || []).filter((item) => item.id === id);
  return matches[matches.length - 1] || null;
};

const yesterdayMatch = (history, keyword, now) => {
  const id = idFor(keyword);
  const parts = toJstParts(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const datePrefix = `${parts.year}-${parts.month}-${parts.day}`;
  const matches = (history.items || []).filter((item) => item.id === id && String(item.capturedAt || "").startsWith(datePrefix));
  return matches[matches.length - 1] || null;
};

const trendStatusFor = ({ signalType, previousEvidenceCount, evidenceChange }) => {
  if (signalType === "daily_trend") return "actual_trend";
  if (signalType === "topic_trend") return "actual_topic";
  if (signalType === "major_topic") return evidenceChange == null ? "major_topic" : evidenceChange > 0 ? "rising" : "major_topic";
  if (previousEvidenceCount == null) return "candidate";
  if (evidenceChange >= 3) return "rising";
  if (evidenceChange > 0) return "warming";
  if (evidenceChange < 0) return "cooling";
  return "flat";
};

const scoreItem = ({ rank, previousRank, previousItem, watchlist, evidenceCount = 0, signalType, previousEvidenceCount = null, evidenceChange = null }) => {
  const rankPoints = Math.max(0, 42 - rank * 2);
  const rankChange = previousRank ? previousRank - rank : 0;
  const previousDeltaPoints = previousRank ? Math.max(-8, Math.min(18, rankChange * 3)) : 0;
  const continuityPoints = previousItem ? Math.min(15, (previousItem.appearCount || 1) * 5) : 0;
  const watchlistPoints = Math.min(16, Math.round((watchlist.priority || 70) / 7));
  const evidencePoints = Math.min(18, evidenceCount * 2);
  const growthPoints =
    previousEvidenceCount == null
      ? 0
      : Math.max(-35, Math.min(42, evidenceChange * 10));
  const sourcePoints = signalType === "daily_trend" ? 42 : signalType === "topic_trend" ? 30 : signalType === "major_topic" ? 22 : signalType === "discovered_phrase" ? 12 : signalType === "configured_rss" ? 8 : 0;
  const standalonePenalty = signalType === "watchlist_rss" ? 34 : 0;
  const hygienePoints = 5;
  const rawScore = Math.round(rankPoints + previousDeltaPoints + continuityPoints + watchlistPoints + evidencePoints + growthPoints + sourcePoints + hygienePoints - standalonePenalty);
  if (signalType === "daily_trend") {
    return Math.max(65, Math.min(100, rawScore));
  }
  if (signalType === "topic_trend") {
    return Math.max(58, Math.min(96, rawScore));
  }
  if (signalType === "major_topic") {
    return Math.max(60, Math.min(100, rawScore));
  }
  if (signalType !== "daily_trend" && previousEvidenceCount == null) {
    return Math.max(0, Math.min(55, rawScore));
  }
  if (signalType !== "daily_trend" && evidenceChange <= 0) {
    return Math.max(0, Math.min(65, rawScore));
  }
  return Math.max(0, Math.min(100, rawScore));
};

const directionFor = (scoreChange, isNew) => {
  if (isNew) return "new";
  if (scoreChange >= 5) return "up";
  if (scoreChange <= -5) return "down";
  return "flat";
};

const buildSeries = (previousItem, currentTime, score) => {
  const previousSeries = previousItem?.series || [];
  return [...previousSeries.slice(-5), { time: currentTime, score }].slice(-6);
};

const main = async () => {
  const now = new Date();
  const nowIso = toJstIso(now);
  const parts = toJstParts(now);
  const timeLabel = `${parts.hour}:${parts.minute}`;
  const snapshotName = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}.json`;

  const watchlists = await readJson(path.join(CONFIG_DIR, "watchlists.json"), []);
  const topicSources = await readJson(path.join(CONFIG_DIR, "topic-sources.json"), []);
  const configuredQueries = await readJson(path.join(CONFIG_DIR, "observe-queries.json"), []);
  const discoveryQueries = await readJson(path.join(CONFIG_DIR, "discovery-queries.json"), []);
  const majorTopics = await readJson(path.join(CONFIG_DIR, "major-topics.json"), []);
  const globalExcludes = await readJson(path.join(CONFIG_DIR, "exclude.json"), []);
  const previousLatest = await readJson(path.join(DATA_DIR, "latest-trends.json"), { items: [] });
  const history = await readJson(path.join(DATA_DIR, "trend-history.json"), { items: [] });
  const topicSourceSignals = await fetchTopicSourceSignals(topicSources, globalExcludes, now);
  const dailyTrendItems = topicSources.length ? [] : await fetchGoogleTrendItems();
  const majorTopicSignals = await fetchMajorTopicSignals(majorTopics, globalExcludes, now);
  const discoverySignals = await fetchDiscoverySignals(discoveryQueries, watchlists, globalExcludes, now);
  const configuredSignals = await fetchConfiguredSignals(configuredQueries, watchlists, globalExcludes, now);
  const watchlistSignals = await fetchWatchlistSignals(watchlists, globalExcludes, now);
  const rawItems = [...topicSourceSignals, ...dailyTrendItems, ...majorTopicSignals, ...discoverySignals, ...configuredSignals, ...watchlistSignals];

  const scoredItems = rawItems
    .map((raw) => {
      const watchlist =
        raw.watchlist ||
        chooseWatchlist(`${raw.keyword} ${(raw.newsTitles || []).join(" ")} ${raw.description || ""}`, watchlists) ||
        (raw.signalType === "daily_trend" ? classifyDailyTrend(raw, globalExcludes) : null);
      if (!watchlist) return null;
      const excludeWords = [...globalExcludes, ...(watchlist.excludeKeywords || [])];
      const matchText = `${raw.keyword} ${(raw.newsTitles || []).join(" ")} ${raw.description || ""}`;
      if (includesAny(matchText, excludeWords)) return null;

      const previousItem = trendFromHistory(history, raw.keyword);
      const previousLatestItem = (previousLatest.items || []).find((item) => item.id === idFor(raw.keyword));
      const previousRank = previousLatestItem?.rank || previousItem?.rank || null;
      const rank = raw.sourceRank;
      const evidenceCount = raw.evidenceCount || null;
      const previousEvidenceCount = previousLatestItem?.evidenceCount ?? previousItem?.evidenceCount ?? null;
      const evidenceChange = previousEvidenceCount == null || evidenceCount == null ? null : evidenceCount - previousEvidenceCount;
      const score = scoreItem({
        rank,
        previousRank,
        previousItem,
        watchlist,
        evidenceCount: evidenceCount || 0,
        signalType: raw.signalType,
        previousEvidenceCount,
        evidenceChange
      });
      const previousScore = previousLatestItem?.score || previousItem?.score || null;
      const yesterdayItem = yesterdayMatch(history, raw.keyword, now);
      const yesterdayScore = yesterdayItem?.score || null;
      const scoreChange = previousScore == null ? score : score - previousScore;
      const yesterdayChange = yesterdayScore == null ? null : score - yesterdayScore;

      return {
        id: idFor(raw.keyword),
        keyword: raw.keyword,
        watchlist: watchlist.id,
        watchlistLabel: watchlist.label,
        rank,
        previousRank,
        rankChange: previousRank == null ? null : previousRank - rank,
        score,
        previousScore,
        scoreChange,
        yesterdayScore,
        yesterdayChange,
        direction: directionFor(scoreChange, previousScore == null),
        trendStatus: trendStatusFor({ signalType: raw.signalType, previousEvidenceCount, evidenceChange }),
        appearCount: previousItem ? (previousItem.appearCount || 1) + 1 : 1,
        signalType: raw.signalType,
        evidenceCount,
        previousEvidenceCount,
        evidenceChange,
        topicSourceCount: raw.topicSourceCount || null,
        topicSources: raw.topicSources || null,
        capturedAt: nowIso,
        series: buildSeries(previousItem, timeLabel, score),
        observeUrl: raw.observeUrl || "https://trends.google.co.jp/trends/"
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.rank - b.rank);

  const byId = new Map();
  for (const item of scoredItems) {
    const existing = byId.get(item.id);
    if (!existing || item.score > existing.score) {
      byId.set(item.id, item);
    }
  }

  const items = [...byId.values()].sort((a, b) => b.score - a.score || a.rank - b.rank).slice(0, 60);

  const latest = {
    updatedAt: nowIso,
    source: "Google Trends RSS JP",
    note: "Google Trends RSSと公開RSS検索から候補フレーズを抽出し、ウォッチリストと除外語でSNS投稿向けテーマに絞り込んでいます。",
    items
  };
  const nextHistory = {
    items: [...(history.items || []), ...items].slice(-1200)
  };

  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await writeJson(path.join(DATA_DIR, "latest-trends.json"), latest);
  await writeJson(path.join(DATA_DIR, "trend-history.json"), nextHistory);
  await writeJson(path.join(SNAPSHOT_DIR, snapshotName), latest);

  console.log(`Saved ${items.length} trend items at ${nowIso}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
