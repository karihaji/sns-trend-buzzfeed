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
const MAX_LOCAL_OBSERVATION_QUERIES = 72;
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const JAPAN_HOLIDAYS_CSV_URL = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";
const ANNIVERSARY_SOURCE_LIMIT = 20;
const YAHOO_REALTIME_LIMIT = 28;
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
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));

const stripHtml = (value) => decodeXml(String(value || "").replace(/<[^>]+>/g, " "));
const cleanHtmlText = (value) =>
  stripHtml(value)
    .replace(/\s+/g, " ")
    .replace(/[「」]/g, "")
    .trim();
const cleanupText = (value) =>
  stripHtml(value)
    .replace(/\s+-\s+[^-]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

const humanTrendUrlFor = (keyword) =>
  `https://trends.google.com/trends/explore?geo=JP&q=${encodeURIComponent(keyword || "")}`;

const newsSearchUrlFor = (keyword) =>
  `https://news.google.com/search?q=${encodeURIComponent(keyword || "トレンド")}&hl=ja&gl=JP&ceid=JP%3Aja`;

const yahooRealtimeUrlFor = (keyword) =>
  `https://search.yahoo.co.jp/realtime/search?p=${encodeURIComponent(keyword || "話題")}`;

const absoluteYahooUrl = (url, fallbackKeyword) => {
  if (!url) return yahooRealtimeUrlFor(fallbackKeyword);
  const cleaned = String(url).replace(/\\u0026/g, "&");
  if (cleaned.startsWith("http")) return cleaned;
  if (cleaned.startsWith("/")) return `https://search.yahoo.co.jp${cleaned}`;
  return yahooRealtimeUrlFor(fallbackKeyword);
};

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

const fetchHtml = async (url) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; sns-trend-buzzfeed/1.0; +https://github.com/karihaji/sns-trend-buzzfeed)",
      "accept-language": "ja,en-US;q=0.9,en;q=0.8"
    }
  });
  if (!response.ok) {
    throw new Error(`HTML failed: ${response.status} ${response.statusText} ${url}`);
  }
  return response.text();
};

const extractNextData = (html) => {
  const match = String(html || "").match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(decodeXml(match[1]));
  } catch {
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
};

const collectObjects = (value, predicate, results = []) => {
  if (!value || results.length > 200) return results;
  if (Array.isArray(value)) {
    value.forEach((item) => collectObjects(item, predicate, results));
    return results;
  }
  if (typeof value === "object") {
    if (predicate(value)) results.push(value);
    Object.values(value).forEach((item) => collectObjects(item, predicate, results));
  }
  return results;
};

const parseYahooRealtimePage = (html, query, now) => {
  const data = extractNextData(html);
  if (!data) return [];
  const matomeItems = collectObjects(
    data,
    (item) => typeof item.title === "string" && (item.tweetCount != null || item.isBuzzNow != null || Array.isArray(item.themeList))
  );
  const hashtagItems = collectObjects(data, (item) => typeof item.text === "string" && item.text.startsWith("#"));
  const tweetItems = collectObjects(data, (item) => typeof item.body === "string" && (item.like != null || item.rt != null || item.quote != null));

  const results = [];
  for (const item of matomeItems.slice(0, 8)) {
    const themes = (item.themeList || []).map((theme) => theme.themeName).filter(Boolean);
    const sourceText = `${themes.join(" ")} ${item.title || ""} ${item.summary || ""}`;
    if (!isRelatedToQuery(sourceText, query)) continue;
    const keyword = compactHeadlineTopic(themes[0] || item.title, query);
    if (!isUsableLocalTopic(keyword, sourceText, [])) continue;
    results.push({
      keyword,
      title: cleanupNewsHeadline(item.title),
      summary: cleanupNewsHeadline(item.summary || item.title),
      tweetCount: Number(item.tweetCount || 0),
      isBuzzNow: Boolean(item.isBuzzNow),
      createdAt: item.createdAt ? new Date(Number(item.createdAt) * 1000).toISOString() : null,
      source: "Yahoo!リアルタイム検索",
      observeUrl: absoluteYahooUrl(item.url, keyword),
      query
    });
  }
  for (const item of hashtagItems.slice(0, 6)) {
    const keyword = cleanupNewsHeadline(item.text);
    if (!isRelatedToQuery(keyword, query)) continue;
    results.push({
      keyword,
      title: keyword,
      summary: `${query} の関連ハッシュタグ`,
      tweetCount: 0,
      isBuzzNow: false,
      createdAt: now.toISOString(),
      source: "Yahoo!リアルタイム検索",
      observeUrl: absoluteYahooUrl(item.url, keyword),
      query
    });
  }
  for (const item of tweetItems.slice(0, 8)) {
    if (!isRelatedToQuery(item.body, query)) continue;
    const keyword = compactHeadlineTopic(item.body, query);
    if (!isUsableLocalTopic(keyword, item.body, [])) continue;
    results.push({
      keyword,
      title: keyword,
      summary: cleanupNewsHeadline(item.body).slice(0, 100),
      tweetCount: Number(item.like || 0) + Number(item.rt || 0) + Number(item.quote || 0) + Number(item.reply || 0),
      isBuzzNow: false,
      createdAt: now.toISOString(),
      source: "Yahoo!リアルタイム検索",
      observeUrl: absoluteYahooUrl(item.url, keyword),
      query
    });
  }
  return results;
};

const fetchYahooRealtimePage = async (query, now) => {
  const url = yahooRealtimeUrlFor(query);
  const html = await fetchHtml(url);
  return parseYahooRealtimePage(html, query, now);
};

const cleanupNewsHeadline = (value) =>
  cleanupText(value)
    .replace(/\s+-\s+[^-]+$/u, "")
    .replace(/^\s*(速報|詳報|動画|写真|独自|解説)[：:\s]+/u, "")
    .replace(/【[^】]{1,28}】/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const compactHeadlineTopic = (value, fallback = "") => {
  const headline = cleanupNewsHeadline(value);
  const quoted = [...headline.matchAll(/[「『]([^」』]{2,24})[」』]/gu)]
    .map((match) => cleanupNewsHeadline(match[1]))
    .find((part) => part.length >= 3 && part.length <= 24);
  if (quoted) return quoted;

  const parts = headline
    .split(/[：:、。｜|／/]/u)
    .map((part) => cleanupNewsHeadline(part))
    .filter((part) => part.length >= 3);
  const localPart = parts.find((part) => /鹿児島|屋久島|奄美|種子島|天文館|桜島|指宿|霧島|薩摩|大隅|離島/u.test(part));
  const shortPart = parts.find((part) => part.length <= 28);
  let topic = localPart || shortPart || headline;
  if (topic.length > 32) topic = cleanupTopicKeyword(topic);
  if (topic.length > 32) topic = topic.slice(0, 31).trim();
  return topic || fallback;
};

const meaningfulQueryTerms = (query) =>
  cleanupNewsHeadline(query)
    .replace(/[()（）"“”]/g, " ")
    .split(/\s+|OR|AND|　/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !BROAD_DISPLAY_TERMS.has(normalize(term)))
    .slice(0, 8);

const isRelatedToQuery = (text, query) => {
  const terms = meaningfulQueryTerms(query);
  if (!terms.length) return true;
  return includesAny(text, terms);
};

const hasLocalContext = (text) =>
  /鹿児島|屋久島|奄美|種子島|天文館|桜島|指宿|霧島|薩摩|大隅|南九州|離島|カゴシマ|かごしま|Kagoshima/u.test(text);

const isUsableLocalTopic = (topic, headline, globalExcludes) => {
  const value = cleanupNewsHeadline(topic);
  if (value.length < 3 || value.length > 32) return false;
  if (BROAD_DISPLAY_TERMS.has(normalize(value))) return false;
  if (GENERIC_TITLE_WORDS.has(value)) return false;
  if (includesAny(`${value} ${headline}`, globalExcludes)) return false;
  if (/訃報|死去|逮捕|容疑|事故|事件|火災|災害|被害|不祥事|謝罪|選挙|市議|県議|市長|県知事|裁判/u.test(`${value} ${headline}`)) return false;
  if (/^(鹿児島|屋久島|奄美|種子島|観光|グルメ|イベント|ニュース)$/u.test(value)) return false;
  return true;
};

const weatherSummary = (code) => {
  if ([0, 1].includes(code)) return "晴れ";
  if ([2, 3].includes(code)) return "くもり";
  if ([45, 48].includes(code)) return "霧";
  if ([51, 53, 55, 56, 57].includes(code)) return "霧雨";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "雨";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "観測中";
};

const fetchWeatherContext = async (locations = []) => {
  const results = [];
  for (const location of locations.slice(0, 6)) {
    if (location.latitude == null || location.longitude == null) continue;
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current: "temperature_2m,weather_code,wind_speed_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "Asia/Tokyo",
      forecast_days: "1"
    });
    try {
      const response = await fetch(`${OPEN_METEO_URL}?${params.toString()}`, {
        headers: { "user-agent": "sns-trend-buzzfeed/1.0 (+GitHub Pages dashboard context)" }
      });
      if (!response.ok) throw new Error(`Weather failed: ${response.status} ${response.statusText}`);
      const data = await response.json();
      const code = data.current?.weather_code ?? data.daily?.weather_code?.[0] ?? null;
      results.push({
        id: location.id,
        label: location.label,
        temperature: Math.round(data.current?.temperature_2m ?? data.daily?.temperature_2m_max?.[0] ?? 0),
        high: Math.round(data.daily?.temperature_2m_max?.[0] ?? 0),
        low: Math.round(data.daily?.temperature_2m_min?.[0] ?? 0),
        precipitation: data.daily?.precipitation_probability_max?.[0] ?? null,
        wind: Math.round(data.current?.wind_speed_10m ?? 0),
        weatherCode: code,
        summary: weatherSummary(code)
      });
    } catch (error) {
      console.warn(`Skipped weather "${location.label || location.id}": ${error.message}`);
    }
  }
  return results;
};

const monthDay = (date) => {
  const parts = toJstParts(date);
  return `${parts.month}-${parts.day}`;
};

const daysUntilDate = (mmdd, now) => {
  const parts = toJstParts(now);
  const [month, day] = String(mmdd || "").split("-").map(Number);
  if (!month || !day) return null;
  const base = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 0, 0, 0));
  let target = new Date(Date.UTC(Number(parts.year), month - 1, day, 0, 0, 0));
  if (target < base) target = new Date(Date.UTC(Number(parts.year) + 1, month - 1, day, 0, 0, 0));
  return Math.round((target - base) / (24 * 60 * 60 * 1000));
};

const upcomingAnniversaries = (anniversaries = [], now) =>
  anniversaries
    .map((item) => ({ ...item, daysUntil: daysUntilDate(item.date, now) }))
    .filter((item) => item.daysUntil != null && item.daysUntil <= 14)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 5);

const fetchText = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { "user-agent": "sns-trend-buzzfeed/1.0 (+GitHub Pages dashboard context)" }
  });
  if (!response.ok) throw new Error(`${url} failed: ${response.status} ${response.statusText}`);
  if (options.encoding) {
    const buffer = await response.arrayBuffer();
    return new TextDecoder(options.encoding).decode(buffer);
  }
  return response.text();
};

const mmddFromDays = (now, daysUntil) => {
  const parts = toJstParts(now);
  const base = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + daysUntil, 0, 0, 0));
  const target = toJstParts(base);
  return `${target.month}-${target.day}`;
};

const anniversaryHint = (sourceLabel, daysUntil = 0) => {
  const timing = daysUntil === 0 ? "今日" : daysUntil === 1 ? "明日" : `${daysUntil}日後`;
  return `${timing}の投稿ネタ、朝礼・社内広報の一言、SNS文脈確認`;
};

const cleanAnniversaryTitle = (value) =>
  cleanHtmlText(value)
    .replace(/（.*?）/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/の日の日$/u, "の日")
    .trim();

const isUsefulAnniversaryTitle = (title) => {
  if (!title || title.length < 2 || title.length > 28) return false;
  if (/トップページ|今日は何の日|明日は何の日|記念日・出来事|広告|カテゴリー|雑学|検索/u.test(title)) return false;
  return /の日|開き|節句|七夕|節分|彼岸|土用|十五夜|大晦日|元日|クリスマス|バレンタイン|ハロウィン/u.test(title);
};

const createAnniversaryItem = ({ title, date, daysUntil, source, sourceUrl, category = "記念日", priority = 0 }) => ({
  date,
  title,
  category,
  hint: anniversaryHint(source, daysUntil),
  source,
  sourceUrl,
  priority,
  daysUntil
});

const dedupeAnniversaries = (items) => {
  const seen = new Set();
  return items
    .filter((item) => item.daysUntil != null && item.daysUntil >= 0)
    .sort((a, b) => a.daysUntil - b.daysUntil || (b.priority || 0) - (a.priority || 0) || a.title.localeCompare(b.title, "ja"))
    .filter((item) => {
      const key = normalize(item.title).replace(/\s+/g, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const parseAnchorTitles = (html) =>
  [...String(html || "").matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => cleanAnniversaryTitle(match[1]))
    .filter(isUsefulAnniversaryTitle);

const parseZatsunetaAnniversaries = (html, source, now) => {
  const sections = [];
  const matches = [...String(html || "").matchAll(/<h3\b[^>]*>[\s\S]*?(今日|明日)[\s\S]*?<\/h3>/gi)];
  for (let index = 0; index < matches.length; index += 1) {
    const marker = matches[index];
    const next = matches[index + 1]?.index ?? String(html || "").indexOf("<h3", marker.index + marker[0].length);
    const end = next > marker.index ? next : marker.index + 7000;
    sections.push({
      daysUntil: marker[1] === "明日" ? 1 : 0,
      html: String(html || "").slice(marker.index, end)
    });
  }
  return sections.flatMap((section) =>
    parseAnchorTitles(section.html).slice(0, 12).map((title, index) =>
      createAnniversaryItem({
        title,
        date: mmddFromDays(now, section.daysUntil),
        daysUntil: section.daysUntil,
        source: source.label,
        sourceUrl: source.url,
        category: /開き|節句|七夕|節分|彼岸|土用/u.test(title) ? "季節" : "記念日",
        priority: 120 - section.daysUntil * 20 - index
      })
    )
  );
};

const parseKinenbiAnniversaries = (html, source, now) => {
  const start = String(html || "").indexOf("today_kinenbilist");
  const end = start >= 0 ? String(html || "").indexOf("today_search", start) : -1;
  const segment = start >= 0 ? String(html || "").slice(start, end > start ? end : start + 15000) : html;
  return parseAnchorTitles(segment)
    .slice(0, 12)
    .map((title, index) =>
      createAnniversaryItem({
        title,
        date: monthDay(now),
        daysUntil: 0,
        source: source.label,
        sourceUrl: source.url,
        category: "認定記念日",
        priority: 90 - index
      })
    );
};

const parseYahooKidsAnniversaries = (html, source, now) => {
  const match = String(html || "").match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match) return [];
  try {
    const data = JSON.parse(decodeXml(match[1]));
    const today = data?.props?.pageProps?.todayResponse?.results || {};
    const memoryItems = (today.memories || []).map((item) => item.title).filter(Boolean);
    const calendarItems = (data?.props?.pageProps?.calendarResponse || [])
      .flatMap((month) => month.todayData || [])
      .filter((item) => item.date === today.date)
      .map((item) => item.title);
    return [...memoryItems, ...calendarItems]
      .map(cleanAnniversaryTitle)
      .filter(isUsefulAnniversaryTitle)
      .slice(0, 4)
      .map((title, index) =>
        createAnniversaryItem({
          title,
          date: monthDay(now),
          daysUntil: 0,
          source: source.label,
          sourceUrl: source.url,
          category: "今日は何の日",
          priority: 110 - index
        })
      );
  } catch (error) {
    console.warn(`Skipped ${source.label}: ${error.message}`);
    return [];
  }
};

const fetchExternalAnniversaries = async (sources = [], now) => {
  const activeSources = sources.filter((source) => source.active !== false && source.url);
  const results = [];
  for (const source of activeSources) {
    try {
      const html = await fetchText(source.url);
      if (source.id === "zatsuneta") results.push(...parseZatsunetaAnniversaries(html, source, now));
      else if (source.id === "kinenbi") results.push(...parseKinenbiAnniversaries(html, source, now));
      else if (source.id === "yahoo_kids") results.push(...parseYahooKidsAnniversaries(html, source, now));
    } catch (error) {
      console.warn(`Skipped anniversary source "${source.label || source.id}": ${error.message}`);
    }
  }
  return dedupeAnniversaries(results).slice(0, ANNIVERSARY_SOURCE_LIMIT);
};

const daysUntilIsoDate = (isoDate, now) => {
  const targetTime = Date.parse(`${isoDate}T00:00:00+09:00`);
  if (Number.isNaN(targetTime)) return null;
  const parts = toJstParts(now);
  const baseTime = Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00+09:00`);
  return Math.round((targetTime - baseTime) / (24 * 60 * 60 * 1000));
};

const parseHolidayCsv = (text) =>
  String(text || "")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [date, name] = line.split(",");
      return { date: date?.trim(), title: name?.trim() };
    })
    .filter((item) => item.date && item.title);

const normalizeHolidayDate = (value) => {
  const match = String(value || "").trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

const fetchHolidayContext = async (now) => {
  try {
    const response = await fetch(JAPAN_HOLIDAYS_CSV_URL, {
      headers: { "user-agent": "sns-trend-buzzfeed/1.0 (+GitHub Pages dashboard context)" }
    });
    if (!response.ok) throw new Error(`Holiday CSV failed: ${response.status} ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder("shift_jis").decode(buffer);
    return parseHolidayCsv(text)
      .map((item) => ({
        ...item,
        date: normalizeHolidayDate(item.date),
        category: "祝日",
        hint: "祝日投稿、営業案内、地域イベント確認",
        daysUntil: daysUntilIsoDate(normalizeHolidayDate(item.date), now)
      }))
      .filter((item) => item.daysUntil != null && item.daysUntil >= 0 && item.daysUntil <= 30)
      .sort((a, b) => a.daysUntil - b.daysUntil)
      .slice(0, 4);
  } catch (error) {
    console.warn(`Skipped holidays: ${error.message}`);
    return [];
  }
};

const buildDashboardContext = async (config, now, nowIso) => {
  const configuredAnniversaries = upcomingAnniversaries(config.anniversaries || [], now).map((item) => ({
    ...item,
    source: item.source || "設定",
    priority: item.priority || 30
  }));
  const externalAnniversaries = await fetchExternalAnniversaries(config.anniversarySources || [], now);
  return {
    generatedAt: nowIso,
    weather: await fetchWeatherContext(config.weatherLocations || []),
    anniversaries: dedupeAnniversaries([...externalAnniversaries, ...configuredAnniversaries]).slice(0, 16),
    holidays: await fetchHolidayContext(now)
  };
};

const fetchGoogleTrendItems = async () => {
  const xml = await fetchRss(TRENDS_RSS_URL);
  return parseRssItems(xml).map((item) => ({
    ...item,
    signalType: "daily_trend",
    observeUrl: humanTrendUrlFor(item.keyword)
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
          observeUrl: yahooRealtimeUrlFor(keyword),
          evidenceUrl: source.type === "google_trends" ? humanTrendUrlFor(keyword) : newsSearchUrlFor(keyword)
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
        observeUrl: yahooRealtimeUrlFor(keyword),
        evidenceUrl: `https://news.google.com/search?q=${encodeURIComponent(keyword)}&hl=ja&gl=JP&ceid=JP%3Aja`
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
        observeUrl: yahooRealtimeUrlFor(item.keyword),
        evidenceUrl: `https://news.google.com/search?q=${encodeURIComponent(item.query || item.keyword)}&hl=ja&gl=JP&ceid=JP%3Aja`
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
          observeUrl: yahooRealtimeUrlFor(candidate.keyword),
          evidenceUrl: `https://news.google.com/search?q=${encodeURIComponent(candidate.keyword)}&hl=ja&gl=JP&ceid=JP%3Aja`
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
        observeUrl: yahooRealtimeUrlFor(topic.keyword),
        evidenceUrl: `https://news.google.com/search?q=${encodeURIComponent(topic.query || topic.keyword)}&hl=ja&gl=JP&ceid=JP%3Aja`
      });
    } catch (error) {
      console.warn(`Skipped major topic "${topic.keyword}": ${error.message}`);
    }
  }
  return results;
};

const fetchYahooRealtimeSignals = async (seedItems, globalExcludes, now) => {
  const seeds = [];
  const seenSeeds = new Set();
  for (const item of seedItems) {
    const keyword = cleanupNewsHeadline(item.keyword || item.query || "");
    if (!keyword || keyword.length < 2 || keyword.length > 32) continue;
    const key = normalize(keyword);
    if (seenSeeds.has(key)) continue;
    seenSeeds.add(key);
    seeds.push(keyword);
    if (seeds.length >= YAHOO_REALTIME_LIMIT) break;
  }

  const aggregated = new Map();
  for (const seed of seeds) {
    try {
      const realtimeItems = await fetchYahooRealtimePage(seed, now);
      for (const realtime of realtimeItems) {
        const keyword = cleanupNewsHeadline(realtime.keyword);
        const sourceText = `${keyword} ${realtime.title || ""} ${realtime.summary || ""}`;
        if (!isUsableLocalTopic(keyword, sourceText, globalExcludes)) continue;
        const key = normalize(keyword);
        const existing = aggregated.get(key) || {
          keyword,
          watchlist: {
            id: "actual_public_trend",
            label: "Xで話題",
            includeKeywords: [],
            excludeKeywords: [],
            priority: 128
          },
          signalType: "yahoo_realtime",
          evidenceCount: 0,
          realtimeCount: 0,
          freshness: 0,
          sourceRank: 18,
          observeUrl: realtime.observeUrl || yahooRealtimeUrlFor(keyword),
          evidenceUrl: newsSearchUrlFor(keyword),
          realtimeSources: []
        };
        const reaction = Math.max(1, Math.min(12, Math.ceil((realtime.tweetCount || 0) / 120)));
        existing.evidenceCount += 1 + reaction;
        existing.realtimeCount += realtime.tweetCount || 0;
        existing.freshness += realtime.isBuzzNow ? 12 : 5;
        existing.sourceRank = Math.min(existing.sourceRank, Math.max(1, 18 - reaction - (realtime.isBuzzNow ? 4 : 0)));
        existing.realtimeSources.push(realtime.source);
        if (realtime.isBuzzNow) existing.trendStatusHint = "rising";
        aggregated.set(key, existing);
      }
    } catch (error) {
      console.warn(`Skipped Yahoo realtime "${seed}": ${error.message}`);
    }
  }

  return [...aggregated.values()]
    .map((item) => ({
      ...item,
      sourceRank: Math.max(1, item.sourceRank - Math.min(6, item.evidenceCount)),
      topicSourceCount: 1,
      topicSources: ["Yahoo!リアルタイム検索"]
    }))
    .sort((a, b) => b.evidenceCount - a.evidenceCount || a.sourceRank - b.sourceRank)
    .slice(0, 28);
};

const tierPriority = (tier) => {
  const priorities = { A: 100, B: 82, C: 64 };
  return priorities[tier] || 70;
};

const localSearchUrlFor = (entry, globalExcludes) => {
  const positiveContext = "(SNS OR TikTok OR Instagram OR X OR YouTube OR リール OR 話題 OR 人気 OR イベント OR グルメ OR 観光)";
  const negativeContext = globalExcludes.map((word) => `-${word}`).join(" ");
  const query = `${entry.query || entry.keyword} ${positiveContext} ${negativeContext}`.trim();
  const params = new URLSearchParams({
    q: query,
    hl: "ja",
    gl: "JP",
    ceid: "JP:ja"
  });
  return `${GOOGLE_NEWS_SEARCH_URL}?${params.toString()}`;
};

const absoluteUrl = (url, baseUrl) => {
  try {
    return new URL(decodeXml(url), baseUrl).toString();
  } catch {
    return baseUrl || "";
  }
};

const parseHtmlLatestItems = (html, baseUrl) => {
  const items = [];
  const seen = new Set();
  const anchorMatches = String(html || "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of anchorMatches) {
    const href = absoluteUrl(match[1], baseUrl);
    const title = cleanupNewsHeadline(match[2]);
    if (!href || !title || title.length < 4 || title.length > 80) continue;
    if (/^(続きを読む|詳細|一覧|もっと見る|HOME|トップ|お問い合わせ|プライバシー|Instagram|X|Facebook|LINE)$/iu.test(title)) continue;
    if (seen.has(`${href}:${title}`)) continue;
    seen.add(`${href}:${title}`);
    items.push({
      keyword: title,
      description: title,
      pubDate: "",
      observeUrl: href,
      newsTitles: [],
      sourceRank: items.length + 1
    });
    if (items.length >= 18) break;
  }
  return items;
};

const fetchLocalSourceItems = async (entry) => {
  if (entry.feedUrl) {
    const xml = await fetchRss(entry.feedUrl);
    return parseRssItems(xml)
      .map((item) => ({
        ...item,
        observeUrl: item.observeUrl || entry.sourceUrl || entry.feedUrl,
        sourceLabel: entry.keyword
      }))
      .slice(0, 18);
  }
  if (entry.sourceUrl) {
    const html = await fetchHtml(entry.sourceUrl);
    return parseHtmlLatestItems(html, entry.sourceUrl)
      .map((item) => ({ ...item, sourceLabel: entry.keyword }))
      .slice(0, 18);
  }
  return [];
};

const flattenLocalEntries = (sections) => {
  const entries = [];
  for (const section of sections) {
    for (const entry of section.entries || []) {
      entries.push({
        ...entry,
        sectionId: section.id,
        sectionTitle: section.title,
        sectionDescription: section.description,
        sectionCap: section.cap || 6,
        priority: tierPriority(entry.tier)
      });
    }
  }
  return entries
    .sort((a, b) => b.priority - a.priority || String(a.keyword).localeCompare(String(b.keyword), "ja"))
    .slice(0, MAX_LOCAL_OBSERVATION_QUERIES);
};

const fetchLocalObservationSignals = async (sections, globalExcludes, previousLatest, now, timeLabel, nowIso) => {
  const sectionCounts = {};
  const results = [];
  const entries = flattenLocalEntries(sections);
  const previousItems = previousLatest.localObservations || [];

  for (const entry of entries) {
    if ((sectionCounts[entry.sectionId] || 0) >= entry.sectionCap) continue;
    try {
      let rssItems = [];
      try {
        rssItems = await fetchLocalSourceItems(entry);
      } catch (error) {
        console.warn(`Skipped local source "${entry.keyword}": ${error.message}`);
      }
      if (!rssItems.length) {
        const url = localSearchUrlFor(entry, globalExcludes);
        const xml = await fetchRss(url);
        rssItems = parseRssItems(xml).map((item) => ({ ...item, sourceLabel: "Googleローカルニュース" }));
      }
      rssItems = rssItems
        .filter((item) => !includesAny(`${item.keyword} ${item.description} ${(item.newsTitles || []).join(" ")}`, globalExcludes))
        .slice(0, 16);
      const candidates = [];

      const directSource = Boolean(entry.feedUrl || entry.sourceUrl);
      const recentItems = rssItems.filter((item) => directSource || daysOld(item.pubDate, now) <= 10);
      for (const item of recentItems.slice(0, directSource ? 8 : 6)) {
        const headline = cleanupNewsHeadline(item.keyword || item.newsTitles?.[0] || "");
        const topic = compactHeadlineTopic(headline, entry.keyword);
        if (!isUsableLocalTopic(topic, `${headline} ${(item.newsTitles || []).join(" ")}`, globalExcludes)) continue;
        if (directSource && !isRelatedToQuery(`${headline} ${(item.newsTitles || []).join(" ")}`, entry.query || entry.keyword) && !hasLocalContext(`${headline} ${entry.query || ""}`)) continue;
        candidates.push({
          keyword: topic,
          headline,
          sourceLabel: item.sourceLabel || entry.keyword,
          freshness: directSource ? Math.max(6, 12 - daysOld(item.pubDate, now)) : Math.max(0, 10 - daysOld(item.pubDate, now)),
          evidenceCount: 1,
          observeUrl: item.observeUrl || entry.sourceUrl || yahooRealtimeUrlFor(topic),
          evidenceUrl: yahooRealtimeUrlFor(topic)
        });
      }

      const byTopic = new Map();
      for (const candidate of candidates) {
        const key = normalize(candidate.keyword);
        const existing = byTopic.get(key) || { ...candidate, evidenceCount: 0, freshness: 0, sourceLabels: new Set(), realtimeCount: 0 };
        existing.evidenceCount += candidate.evidenceCount || 1;
        existing.freshness += candidate.freshness || 0;
        existing.realtimeCount += candidate.realtimeCount || 0;
        existing.sourceLabels.add(candidate.sourceLabel);
        if (candidate.sourceLabel === "Yahoo!リアルタイム検索") existing.observeUrl = candidate.observeUrl;
        byTopic.set(key, existing);
      }

      const topics = [...byTopic.values()]
        .sort((a, b) => b.evidenceCount - a.evidenceCount || b.freshness - a.freshness)
        .slice(0, Math.max(1, Math.min(directSource ? 2 : 1, entry.sectionCap - (sectionCounts[entry.sectionId] || 0))));

      for (const topic of topics) {
        if ((sectionCounts[entry.sectionId] || 0) >= entry.sectionCap) break;
        const id = idFor(`local:${entry.sectionId}:${topic.keyword}`);
        const previousItem = previousItems.find((item) => item.id === id) || null;
        const previousEvidenceCount = previousItem?.evidenceCount ?? null;
        const evidenceChange = previousEvidenceCount == null ? null : topic.evidenceCount - previousEvidenceCount;
        const baseScore = entry.priority + Math.min(30, topic.evidenceCount * 4) + Math.min(20, Math.round(topic.freshness / 4));
        const realtimeBoost = Math.min(18, Math.ceil((topic.realtimeCount || 0) / 250));
        const growthScore = previousEvidenceCount == null ? 0 : Math.max(-18, Math.min(28, evidenceChange * 7));
        const score = Math.max(0, Math.min(100, Math.round(baseScore / 1.38 + realtimeBoost + growthScore)));
        const previousScore = previousItem?.score ?? null;
        const scoreChange = previousScore == null ? score : score - previousScore;

        results.push({
          id,
          keyword: topic.keyword,
          query: entry.query || entry.keyword,
          sourceHeadline: topic.headline,
          sourceLabel: [...topic.sourceLabels].join(" / "),
          observationSeed: entry.keyword,
          localSection: entry.sectionId,
          localSectionTitle: entry.sectionTitle,
          localSectionDescription: entry.sectionDescription,
          localTier: entry.tier || "B",
          tags: entry.tags || [],
          score,
          previousScore,
          scoreChange,
          direction: directionFor(scoreChange, previousScore == null),
          trendStatus: trendStatusFor({ signalType: "local_observation", previousEvidenceCount, evidenceChange }),
          signalType: "local_observation",
          evidenceCount: topic.evidenceCount,
          previousEvidenceCount,
          evidenceChange,
          realtimeCount: topic.realtimeCount || null,
          capturedAt: nowIso,
          series: buildSeries(previousItem, timeLabel, score),
          observeUrl: topic.observeUrl || yahooRealtimeUrlFor(topic.keyword),
          evidenceUrl: topic.evidenceUrl || newsSearchUrlFor(`${topic.keyword} ${entry.query || entry.keyword}`)
        });
        sectionCounts[entry.sectionId] = (sectionCounts[entry.sectionId] || 0) + 1;
      }
    } catch (error) {
      console.warn(`Skipped local observation "${entry.keyword}": ${error.message}`);
    }
  }

  return results.sort((a, b) => b.score - a.score || tierPriority(b.localTier) - tierPriority(a.localTier)).slice(0, 80);
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
  if (signalType === "yahoo_realtime") return "actual_trend";
  if (signalType === "topic_trend") return "actual_topic";
  if (signalType === "major_topic") return evidenceChange == null ? "major_topic" : evidenceChange > 0 ? "rising" : "major_topic";
  if (signalType === "local_observation") {
    if (previousEvidenceCount == null) return "candidate";
    if (evidenceChange >= 2) return "rising";
    if (evidenceChange > 0) return "warming";
    if (evidenceChange < 0) return "cooling";
    return "flat";
  }
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
  const sourcePoints = signalType === "daily_trend" ? 42 : signalType === "yahoo_realtime" ? 44 : signalType === "topic_trend" ? 30 : signalType === "major_topic" ? 22 : signalType === "discovered_phrase" ? 12 : signalType === "configured_rss" ? 8 : 0;
  const standalonePenalty = signalType === "watchlist_rss" ? 34 : 0;
  const hygienePoints = 5;
  const rawScore = Math.round(rankPoints + previousDeltaPoints + continuityPoints + watchlistPoints + evidencePoints + growthPoints + sourcePoints + hygienePoints - standalonePenalty);
  if (signalType === "daily_trend" || signalType === "yahoo_realtime") {
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
  const localObservationSections = await readJson(path.join(CONFIG_DIR, "local-observation.json"), []);
  const dashboardContextConfig = await readJson(path.join(CONFIG_DIR, "dashboard-context.json"), {});
  const globalExcludes = await readJson(path.join(CONFIG_DIR, "exclude.json"), []);
  const previousLatest = await readJson(path.join(DATA_DIR, "latest-trends.json"), { items: [] });
  const history = await readJson(path.join(DATA_DIR, "trend-history.json"), { items: [] });
  const topicSourceSignals = await fetchTopicSourceSignals(topicSources, globalExcludes, now);
  const dailyTrendItems = topicSources.length ? [] : await fetchGoogleTrendItems();
  const majorTopicSignals = await fetchMajorTopicSignals(majorTopics, globalExcludes, now);
  const discoverySignals = await fetchDiscoverySignals(discoveryQueries, watchlists, globalExcludes, now);
  const configuredSignals = await fetchConfiguredSignals(configuredQueries, watchlists, globalExcludes, now);
  const watchlistSignals = await fetchWatchlistSignals(watchlists, globalExcludes, now);
  const yahooRealtimeSignals = await fetchYahooRealtimeSignals(
    [...topicSourceSignals, ...majorTopicSignals, ...discoverySignals, ...configuredSignals, ...watchlistSignals],
    globalExcludes,
    now
  );
  const localObservations = await fetchLocalObservationSignals(localObservationSections, globalExcludes, previousLatest, now, timeLabel, nowIso);
  const context = await buildDashboardContext(dashboardContextConfig, now, nowIso);
  const rawItems = [...yahooRealtimeSignals, ...topicSourceSignals, ...dailyTrendItems, ...majorTopicSignals, ...discoverySignals, ...configuredSignals, ...watchlistSignals];

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
        realtimeCount: raw.realtimeCount || null,
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
    items,
    localObservations,
    context
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
