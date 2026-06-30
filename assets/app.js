const pageKind = document.body.dataset.page || "list";
const basePath = pageKind === "home" ? "." : "..";
const paths = {
  site: `${basePath}/config/site.json`,
  links: `${basePath}/config/links.json`,
  latest: `${basePath}/data/latest-trends.json`
};

const formatDateTitle = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${month}月${day}日の最新SNSトレンド`;
};

const formatUpdated = (value) => {
  if (!value) return "未取得";
  const date = new Date(value);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
};

const loadJson = async (url, fallback) => {
  try {
    const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } catch (error) {
    console.warn(`Failed to load ${url}`, error);
    return fallback;
  }
};

const safeExternalAttrs = (anchor) => {
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
};

const newsSearchUrl = (keyword) =>
  `https://news.google.com/search?q=${encodeURIComponent(keyword || "トレンド")}&hl=ja&gl=JP&ceid=JP%3Aja`;

const trendsExploreUrl = (keyword) =>
  `https://trends.google.com/trends/explore?geo=JP&q=${encodeURIComponent(keyword || "")}`;

const readableTrendUrl = (item) => {
  const url = item?.observeUrl || "";
  if (/trending\/rss|trends\.google\.[^/]+\/trending\/rss/i.test(url)) {
    return trendsExploreUrl(item?.keyword);
  }
  if (/\/rss|application\/rss|output=rss/i.test(url)) {
    return newsSearchUrl(item?.keyword);
  }
  return url || newsSearchUrl(item?.keyword);
};

const signed = (value) => {
  if (value === null || value === undefined) return "-";
  return value > 0 ? `+${value}` : String(value);
};

const directionLabel = (direction) => {
  const labels = { up: "↑", flat: "→", down: "↓", new: "NEW" };
  return labels[direction] || "観測";
};

const signalLabel = (signalType) => {
  const labels = {
    discovered_phrase: "発見フレーズ",
    configured_rss: "重点観測",
    daily_trend: "検索トレンド",
    topic_trend: "公開RSS",
    major_topic: "大型トピック",
    watchlist_rss: "補助観測"
  };
  return labels[signalType] || "観測";
};

const statusLabel = (status) => {
  const labels = {
    actual_trend: "実トレンド",
    actual_topic: "公開話題",
    major_topic: "大型話題",
    rising: "伸長",
    warming: "微増",
    flat: "安定",
    cooling: "減少",
    candidate: "判定待ち"
  };
  return labels[status] || "観測";
};

const classForValue = (value) => {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "";
};

const create = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const sparkline = (series = []) => {
  const wrap = create("div", "spark");
  const values = series.length ? series.map((point) => point.score) : [0];
  const max = Math.max(...values, 1);
  values.forEach((value) => {
    const bar = document.createElement("span");
    bar.style.height = `${Math.max(10, Math.round((value / max) * 34))}px`;
    wrap.append(bar);
  });
  return wrap;
};

const metric = (label, value, className = "") => {
  const box = create("div", "metric");
  box.append(create("span", "metric-label", label));
  box.append(create("span", `metric-value ${className}`.trim(), value));
  return box;
};

const trendCard = (item) => {
  const card = create("article", `trend-card category-${categoryKey(item)}`);
  const top = create("div", "trend-title-row");
  const left = create("div");
  left.append(create("div", "keyword", `#${item.keyword}`));
  left.append(create("span", "tag", item.watchlistLabel || "観測"));
  left.append(create("span", "tag signal-tag", signalLabel(item.signalType)));
  const status = statusLabel(item.trendStatus);
  if (status !== item.watchlistLabel && status !== signalLabel(item.signalType)) {
    left.append(create("span", "tag status-tag", status));
  }
  top.append(left);
  top.append(create("span", `badge ${item.direction || "flat"}`, directionLabel(item.direction)));

  const metrics = create("div", "metrics");
  metrics.append(metric("観測スコア", item.score ?? "-", ""));
  metrics.append(metric("前回比", signed(item.scoreChange), classForValue(item.scoreChange)));
  metrics.append(metric("前日比", signed(item.yesterdayChange), classForValue(item.yesterdayChange)));
  metrics.append(metric("順位変動", signed(item.rankChange), classForValue(item.rankChange)));
  metrics.append(metric("観測件数", item.evidenceCount ? `${item.evidenceCount}件` : "-", ""));
  metrics.append(metric("観測増減", signed(item.evidenceChange), classForValue(item.evidenceChange)));
  metrics.append(metric("継続", `${item.appearCount || 1}回`, ""));

  const link = safeExternalAttrs(create("a", "open-link", "詳しく見る ↗"));
  link.href = readableTrendUrl(item);

  card.append(top, metrics, sparkline(item.series), link);
  return card;
};

const shortSignalText = (item) => {
  const parts = [statusLabel(item.trendStatus), signalLabel(item.signalType)];
  if (item.evidenceCount) parts.push(`観測 ${item.evidenceCount}件`);
  if (item.evidenceChange !== null && item.evidenceChange !== undefined) parts.push(`増減 ${signed(item.evidenceChange)}`);
  if (item.topicSourceCount) parts.push(`観測面 ${item.topicSourceCount}`);
  return parts.join(" / ");
};

const simpleTrendRow = (item) => {
  const row = safeExternalAttrs(create("a", "simple-trend-row"));
  row.href = readableTrendUrl(item);
  row.append(create("span", "simple-keyword", `#${item.keyword}`));
  row.append(create("span", "simple-meta", shortSignalText(item)));
  row.append(create("span", `simple-badge ${item.direction || "flat"}`, directionLabel(item.direction)));
  return row;
};

const linkCard = (link) => {
  const card = safeExternalAttrs(create("a", "link-card"));
  card.href = link.url;
  card.append(create("span", "tag", link.label));
  card.append(create("h3", "", link.title));
  card.append(create("p", "", link.description));
  card.append(create("span", "open-link", "開く ↗"));
  return card;
};

const renderEmpty = (target, message) => {
  target.replaceChildren(create("div", "empty", message));
};

const sortBy = (items, selector) => [...items].sort((a, b) => selector(b) - selector(a));
const categoryKey = (item) => {
  const label = item.watchlistLabel || "";
  const keyword = item.keyword || "";
  if (
    label.includes("スポーツ") ||
    /MLB|アスレチックス|大谷翔平|バレー|ネーションズリーグ|F1|相撲|野球|サッカー|W杯|ワールドカップ|クラブW杯|FIFA|日本代表|田中碧|久保建英|三笘薫|堂安律|森保|アロンソ|アルゼンチン|スウェーデン|浦和|鹿島|横浜FM|ヴィッセル/u.test(keyword)
  )
    return "sports";
  if (label.includes("テクノロジー") || /Gemini|Android|iPhone|AI|スマホ|ゲーム/u.test(keyword)) return "technology";
  if (label.includes("エンタメ") || label === "SNSトレンド" || /ガンダム|ミス・コンテスト|acosta|池田朱那|趣里|白洲迅|目黒蓮/u.test(keyword)) return "entertainment";
  if (label.includes("季節")) return "seasonal";
  if (label.includes("ビジネス")) return "business";
  if (label.includes("地域")) return "local";
  return "general";
};

const balancedTake = (items, limit, caps = {}, options = {}) => {
  const counts = {};
  const result = [];
  for (const item of items) {
    const key = categoryKey(item);
    const cap = caps[key] ?? limit;
    if ((counts[key] || 0) >= cap) continue;
    if (options.maxConsecutive) {
      const tail = result.slice(-options.maxConsecutive);
      if (tail.length === options.maxConsecutive && tail.every((tailItem) => categoryKey(tailItem) === key)) continue;
    }
    counts[key] = (counts[key] || 0) + 1;
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
};

const trendWeight = (item) => {
  const weights = { actual_trend: 5, rising: 4, warming: 3, flat: 2, candidate: 1, cooling: 0 };
  return (weights[item.trendStatus] ?? 0) * 1000 + (item.score || 0);
};
const isActualTrend = (item) => item.signalType === "daily_trend" || item.trendStatus === "actual_trend";
const isActualTopic = (item) => item.signalType === "topic_trend" || item.trendStatus === "actual_topic";
const isMajorTopic = (item) => item.signalType === "major_topic" || item.trendStatus === "major_topic";
const isSports = (item) => categoryKey(item) === "sports";
const isGrowingObservation = (item) => ["rising", "warming"].includes(item.trendStatus) && !isActualTrend(item) && !isActualTopic(item) && !isMajorTopic(item);
const isEvergreen = (item) =>
  !isActualTrend(item) &&
  !isActualTopic(item) &&
  !isMajorTopic(item) &&
  ["flat", "cooling"].includes(item.trendStatus) &&
  ((item.appearCount || 0) >= 2 || (item.evidenceCount || 0) >= 3);

const publicHeatScore = (item) => {
  const score = item.score || 0;
  const evidence = item.evidenceCount || 0;
  const rankBonus = Math.max(0, 100 - (item.rank || 99));
  if (isActualTrend(item)) return 4600 + score * 3 + rankBonus * 2 + evidence * 18;
  if (isMajorTopic(item)) return 4500 + score * 2 + evidence * 14 + rankBonus;
  if (isActualTopic(item)) return 4300 + score * 3 + (item.topicSourceCount || 1) * 90 + evidence * 26 + rankBonus;
  return trendWeight(item);
};

const trendClusterKey = (item) => {
  const keyword = item.keyword || "";
  if (/FIFAワールドカップ2026|ワールドカップ|W杯/u.test(keyword) && !/クラブ/u.test(keyword)) return "worldcup";
  return keyword.toLowerCase().replace(/\s+/g, "");
};

const dedupeTrendTopics = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = trendClusterKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const compactMetricText = (item) => {
  if (isActualTrend(item)) return `実トレンド　${item.rank ? `順位 ${item.rank}位` : "公開トレンド"}`;
  if (isActualTopic(item)) return `公開話題　観測面 ${item.topicSourceCount || 1}`;
  if (isMajorTopic(item)) return `大型話題　観測件数 ${item.evidenceCount ? `${item.evidenceCount}件` : "-"}`;
  if (isGrowingObservation(item)) return `${statusLabel(item.trendStatus)}　観測増減 ${signed(item.evidenceChange)}`;
  if (isEvergreen(item)) return `定番　観測件数 ${item.evidenceCount ? `${item.evidenceCount}件` : "-"}`;
  return `${statusLabel(item.trendStatus)}　観測増減 ${signed(item.evidenceChange)}`;
};

const rankedTrendItems = (items) =>
  balancedTake(
    dedupeTrendTopics(sortBy(items.filter((item) => isActualTrend(item) || isActualTopic(item) || isMajorTopic(item)), publicHeatScore)),
    20,
    { sports: 4, technology: 4, entertainment: 7, seasonal: 4, local: 3, business: 2, general: 7 },
    { maxConsecutive: 2 }
  );

const evergreenItems = (items) =>
  balancedTake(
    sortBy(items.filter(isEvergreen), (item) => (item.appearCount || 0) * 20 + (item.evidenceCount || 0)),
    20,
    { sports: 3, technology: 3, entertainment: 5, seasonal: 5, local: 5, general: 6 }
  );

const categoryName = (key) => {
  const names = {
    entertainment: "エンタメ",
    sports: "スポーツ",
    technology: "テック",
    seasonal: "季節",
    local: "地域",
    business: "ビジネス",
    general: "一般"
  };
  return names[key] || "一般";
};

const trendPill = (item) => {
  const anchor = safeExternalAttrs(create("a", `trend-pill category-${categoryKey(item)}`));
  anchor.href = readableTrendUrl(item);
  anchor.append(create("span", "", `#${item.keyword}`));
  anchor.append(create("small", "", compactMetricText(item)));
  return anchor;
};

const listHeroTrend = (item) => {
  const anchor = safeExternalAttrs(create("a", `list-hero-trend ${item ? `category-${categoryKey(item)}` : ""}`.trim()));
  anchor.href = readableTrendUrl(item);
  anchor.append(create("span", "tag", item ? compactMetricText(item) : "観測待ち"));
  anchor.append(create("strong", "", item ? `#${item.keyword}` : "トレンド取得待ち"));
  anchor.append(create("small", "", item ? shortSignalText(item) : "GitHub Actionsの取得後に最新の観測結果が表示されます。"));
  return anchor;
};

const listSummaryTile = (label, value, detail) => {
  const tile = create("div", "list-summary-tile");
  tile.append(create("span", "", label));
  tile.append(create("strong", "", value));
  tile.append(create("small", "", detail));
  return tile;
};

const contextDateLabel = (daysUntil) => {
  if (daysUntil === 0) return "今日";
  if (daysUntil === 1) return "明日";
  return `${daysUntil}日後`;
};

const contextEventRow = (item) => {
  const row = create("div", "context-event-row");
  row.append(create("span", "context-date", contextDateLabel(item.daysUntil)));
  const copy = create("div");
  copy.append(create("strong", "", item.title || "記念日"));
  copy.append(create("small", "", `${item.category || "記念日"} / ${item.hint || "投稿文脈を確認"}`));
  row.append(copy);
  return row;
};

const weatherTile = (item) => {
  const tile = create("div", "weather-tile");
  tile.append(create("span", "", item.label || "地域"));
  tile.append(create("strong", "", item.summary || "観測中"));
  tile.append(create("small", "", `${item.temperature ?? "-"}℃ / 降水 ${item.precipitation ?? "-"}%`));
  return tile;
};

const listContextPanel = (context = {}) => {
  const panel = create("div", "list-context-panel");
  const head = create("div", "list-panel-head");
  head.append(create("h2", "", "今日の運用メモ"));
  head.append(create("span", "section-count", "投稿文脈"));

  const events = [...(context.holidays || []), ...(context.anniversaries || [])]
    .sort((a, b) => (a.daysUntil ?? 99) - (b.daysUntil ?? 99))
    .slice(0, 4);
  const eventList = create("div", "context-event-list");
  if (events.length) {
    eventList.replaceChildren(...events.map(contextEventRow));
  } else {
    eventList.append(create("div", "empty mini-empty", "近い記念日・祝日は設定待ちです。"));
  }

  const weatherGrid = create("div", "weather-grid");
  const weather = (context.weather || []).slice(0, 4);
  if (weather.length) {
    weatherGrid.replaceChildren(...weather.map(weatherTile));
  } else {
    weatherGrid.append(create("div", "empty mini-empty", "天気は次回取得時に反映されます。"));
  }

  panel.append(head, eventList, weatherGrid);
  return panel;
};

const compactContextStrip = (context = {}) => {
  const events = [...(context.holidays || []), ...(context.anniversaries || [])]
    .sort((a, b) => (a.daysUntil ?? 99) - (b.daysUntil ?? 99))
    .slice(0, 2);
  const wrap = create("div", "compact-context");
  wrap.append(create("span", "compact-context-label", "今日のネタ"));
  if (!events.length) {
    wrap.append(create("strong", "", "記念日取得待ち"));
    return wrap;
  }
  events.forEach((item) => {
    const chip = create("span", "compact-context-chip", `${contextDateLabel(item.daysUntil)}: ${item.title}`);
    wrap.append(chip);
  });
  return wrap;
};

const listOverview = ({ items, mainTrends, evergreen, growing, localObservations, context }) => {
  const wrap = create("section", "list-overview");
  const focus = create("div", "list-focus-panel");
  const focusHead = create("div", "list-panel-head");
  focusHead.append(create("h2", "", "実トレンドの現在地"));
  focusHead.append(create("span", "section-count", `${mainTrends.length}件`));
  const hero = listHeroTrend(mainTrends[0]);
  const focusList = create("div", "list-focus-list");
  focusList.replaceChildren(...mainTrends.slice(1, 6).map(trendPill));
  focus.append(focusHead, hero, focusList);

  const insight = create("div", "list-insight-panel");
  const insightHead = create("div", "list-panel-head");
  insightHead.append(create("h2", "", "観測バランス"));
  insightHead.append(create("span", "section-count", `${items.length}件`));
  const summaryGrid = create("div", "list-summary-grid");
  summaryGrid.append(
    listSummaryTile("実トレンド", `${mainTrends.length}`, "主役候補"),
    listSummaryTile("定番ワード", `${evergreen.length}`, "準メイン"),
    listSummaryTile("伸長検知", `${growing.length}`, "増加候補"),
    listSummaryTile("ローカル棚", `${localObservations.length}`, "別枠観測")
  );
  const counts = items.reduce((acc, item) => {
    const key = categoryKey(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const categoryEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const bars = create("div", "list-category-strip");
  const maxCategory = Math.max(...categoryEntries.map((entry) => entry[1]), 1);
  bars.replaceChildren(...categoryEntries.map(([key, count]) => categoryBar(key, count, maxCategory)));
  insight.append(insightHead, summaryGrid, bars);
  wrap.append(focus, insight, listContextPanel(context));
  return wrap;
};

const localObservationLabel = (item) => {
  const tier = item.localTier ? `優先 ${item.localTier}` : "観測";
  const evidence = item.evidenceCount ? `観測 ${item.evidenceCount}件` : "観測中";
  return `${tier} / ${statusLabel(item.trendStatus)} / ${evidence}`;
};

const localObservationCard = (item) => {
  const card = safeExternalAttrs(create("a", "local-card"));
  card.href = item.observeUrl || "https://news.google.com/";
  const top = create("div", "local-card-top");
  top.append(create("span", "local-tier", item.localTier || "B"));
  top.append(create("span", "local-section-label", item.localSectionTitle || "ローカル観測"));
  card.append(top);
  card.append(create("strong", "", `#${item.keyword}`));
  card.append(create("span", "local-meta", localObservationLabel(item)));
  const tags = create("div", "local-tags");
  (item.tags || []).slice(0, 3).forEach((tag) => tags.append(create("span", "", tag)));
  if (tags.childElementCount) card.append(tags);
  return card;
};

const localObservationRow = (item) => {
  const row = safeExternalAttrs(create("a", "local-row"));
  row.href = item.observeUrl || "https://news.google.com/";
  row.append(create("span", "local-row-word", `#${item.keyword}`));
  row.append(create("span", "local-row-section", item.localSectionTitle || "ローカル観測"));
  row.append(create("span", "local-row-meta", localObservationLabel(item)));
  return row;
};

const groupLocalObservations = (items) => {
  const groups = new Map();
  for (const item of items || []) {
    const key = item.localSection || "local";
    const group = groups.get(key) || {
      id: key,
      title: item.localSectionTitle || "ローカル観測",
      description: item.localSectionDescription || "",
      items: []
    };
    group.items.push(item);
    groups.set(key, group);
  }
  const groupOrder = {
    local_subculture: 10,
    local_vtubers: 9,
    local_idols_music: 8,
    local_cosplay_popculture: 7,
    local_anikura_dj: 6,
    local_esports_game: 5,
    local_media: 4,
    local_creators: 3,
    local_family_events: 2,
    local_leisure_islands: 1,
    local_facilities_events: 0,
    local_official: 0
  };
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: sortBy(group.items, (item) => item.score || 0)
    }))
    .sort((a, b) => (groupOrder[b.id] || 0) - (groupOrder[a.id] || 0) || b.items.length - a.items.length);
};

const localDisplayWeight = (item) => {
  const sectionBoosts = {
    local_subculture: 24,
    local_vtubers: 22,
    local_cosplay_popculture: 20,
    local_anikura_dj: 18,
    local_idols_music: 16,
    local_esports_game: 12
  };
  const tierBoosts = { A: 12, B: 6, C: 0 };
  return (item.score || 0) + (sectionBoosts[item.localSection] || 0) + (tierBoosts[item.localTier] || 0);
};

const localObservationShelf = (items, options = {}) => {
  const wrap = create("section", options.home ? "dashboard-panel local-shelf home-local-shelf" : "section local-shelf");
  const head = create("div", options.home ? "panel-head" : "section-head");
  head.append(create("h2", "", "ローカルSNS観測棚"));
  head.append(create("span", "section-count", `${items.length}件`));
  const lead = create("p", "local-shelf-lead", "サブカル、地域メディア、観光、グルメ、週末イベントを通常トレンドと分けて観測しています。");
  const cards = create("div", "local-card-grid");
  const topItems = sortBy(items, localDisplayWeight).slice(0, options.home ? 6 : 8);
  if (topItems.length) cards.replaceChildren(...topItems.map(localObservationCard));
  else renderEmpty(cards, "ローカルSNS観測は次回取得後に表示されます。");
  wrap.append(head, lead, cards);
  return wrap;
};

const localObservationSections = (items) => {
  const wrap = create("section", "section local-detail-section");
  const head = create("div", "section-head");
  head.append(create("h2", "", "ローカル観測：カテゴリ別"));
  head.append(create("span", "section-count", `${items.length}件`));
  const groupsWrap = create("div", "local-groups");
  const groups = groupLocalObservations(items).slice(0, 12);
  groupsWrap.replaceChildren(
    ...groups.map((group) => {
      const detail = create("details", "local-group");
      const summary = create("summary", "", `${group.title}（${group.items.length}件）`);
      const description = create("p", "local-group-description", group.description);
      const rows = create("div", "local-row-list");
      rows.replaceChildren(...group.items.slice(0, 8).map(localObservationRow));
      detail.append(summary, description, rows);
      return detail;
    })
  );
  wrap.append(head, groupsWrap);
  return wrap;
};

const categoryBar = (key, count, max) => {
  const row = create("div", "category-bar");
  row.append(create("span", "category-label", categoryName(key)));
  const track = create("span", "bar-track");
  const fill = create("span", "bar-fill");
  fill.style.width = `${Math.max(8, Math.round((count / Math.max(max, 1)) * 100))}%`;
  track.append(fill);
  row.append(track);
  row.append(create("span", "category-count", `${count}`));
  return row;
};

const statTile = (label, value, detail) => {
  const tile = create("div", "stat-tile");
  tile.append(create("span", "stat-label", label));
  tile.append(create("strong", "", value));
  tile.append(create("span", "stat-detail", detail));
  return tile;
};

const renderHome = ({ site, links, latest }) => {
  document.title = site.siteName || "SNSトレンドバズフィード";
  const items = latest.items || [];
  const localObservations = latest.localObservations || [];
  const mainTrends = rankedTrendItems(items);
  const evergreen = evergreenItems(items);
  const growing = sortBy(items.filter(isGrowingObservation), (item) => item.evidenceChange || 0).slice(0, 8);
  const heroTarget = document.querySelector("[data-home-hero]");
  const dashboardTarget = document.querySelector("[data-home-dashboard]");
  const topItem = mainTrends[0];

  const heroCopy = create("div", "hero-copy");
  heroCopy.append(create("span", "tag", topItem ? compactMetricText(topItem) : "観測待ち"));
  heroCopy.append(create("h2", "", topItem ? `#${topItem.keyword}` : "トレンド取得待ち"));
  heroCopy.append(create("p", "", topItem ? shortSignalText(topItem) : "GitHub Actionsの取得後に最新の観測結果が表示されます。"));
  const heroActions = create("div", "hero-actions");
  const listLink = create("a", "primary-action", "詳細リストを見る");
  listLink.href = "./list/";
  heroActions.append(listLink);
  heroCopy.append(heroActions);

  const heroStats = create("div", "hero-stats");
  heroStats.append(statTile("実トレンド", `${mainTrends.length}`, "主役候補"));
  heroStats.append(statTile("定番ワード", `${evergreen.length}`, "継続観測"));
  heroStats.append(statTile("伸長候補", `${growing.length}`, "増加検知"));
  heroStats.append(statTile("最終更新", formatUpdated(latest.updatedAt), "Asia/Tokyo"));
  heroTarget.replaceChildren(heroCopy, heroStats);

  const counts = items.reduce((acc, item) => {
    const key = categoryKey(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const categoryEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCategory = Math.max(...categoryEntries.map((entry) => entry[1]), 1);

  const leadPanel = create("section", "dashboard-panel lead-panel");
  const leadHead = create("div", "panel-head");
  leadHead.append(create("h2", "", "いま見るべき話題"));
  leadHead.append(create("span", "section-count", `${mainTrends.length}件`));
  const leadList = create("div", "pill-list");
  leadList.replaceChildren(...mainTrends.slice(0, 7).map(trendPill));
  leadPanel.append(leadHead, leadList);

  const evergreenPanel = create("section", "dashboard-panel");
  const evergreenHead = create("div", "panel-head");
  evergreenHead.append(create("h2", "", "定番・継続ワード"));
  evergreenHead.append(create("span", "section-count", `${evergreen.length}件`));
  const evergreenList = create("div", "compact-dashboard-list");
  evergreenList.replaceChildren(...evergreen.slice(0, 6).map(simpleTrendRow));
  evergreenPanel.append(evergreenHead, evergreenList);

  const categoryPanel = create("section", "dashboard-panel");
  const categoryHead = create("div", "panel-head");
  categoryHead.append(create("h2", "", "カテゴリ構成"));
  categoryHead.append(create("span", "section-count", `${items.length}件`));
  const bars = create("div", "category-bars");
  bars.replaceChildren(...categoryEntries.map(([key, count]) => categoryBar(key, count, maxCategory)));
  categoryPanel.append(categoryHead, bars);

  const growingPanel = create("section", "dashboard-panel");
  const growingHead = create("div", "panel-head");
  growingHead.append(create("h2", "", "伸長検知"));
  growingHead.append(create("span", "section-count", `${growing.length}件`));
  const growingList = create("div", "compact-dashboard-list");
  if (growing.length) growingList.replaceChildren(...growing.slice(0, 6).map(simpleTrendRow));
  else renderEmpty(growingList, "明確な伸長ワードはまだありません。");
  growingPanel.append(growingHead, growingList);

  const linksPanel = create("section", "dashboard-panel");
  const linksHead = create("div", "panel-head");
  linksHead.append(create("h2", "", "観測リンク"));
  const linkList = create("div", "home-link-list");
  linkList.replaceChildren(
    ...links.filter((link) => link.active).sort((a, b) => b.priority - a.priority).slice(0, 5).map((link) => {
      const anchor = safeExternalAttrs(create("a", "home-link"));
      anchor.href = link.url;
      anchor.append(create("span", "", link.label));
      anchor.append(create("strong", "", link.title));
      return anchor;
    })
  );
  linksPanel.append(linksHead, linkList);

  const localPanel = localObservationShelf(localObservations, { home: true });
  dashboardTarget.replaceChildren(leadPanel, categoryPanel, evergreenPanel, growingPanel, linksPanel, localPanel);
  document.querySelector("[data-note]").textContent = site.dataRefreshNote || "観測スコアは独自指標です。";
};

const renderCompact = ({ site, links, latest }) => {
  document.title = formatDateTitle();
  document.querySelector("[data-title]").textContent = formatDateTitle();
  document.querySelector("[data-updated]").textContent = `最終更新 ${formatUpdated(latest.updatedAt)}`;

  const itemsTarget = document.querySelector("[data-compact-items]");
  const rankedItems = sortBy(latest.items || [], (item) => {
    if (isActualTrend(item)) return 4000 + (100 - (item.rank || 99));
    if (isActualTopic(item)) return 3800 + (item.topicSourceCount || 1) * 50 + (item.score || 0);
    if (isMajorTopic(item)) return 3500 + (item.score || 0);
    if (isGrowingObservation(item)) return 3000 + (item.score || 0);
    if (isEvergreen(item)) return 2000 + (item.appearCount || 0) * 20 + (item.evidenceCount || 0);
    return trendWeight(item);
  });
  const items = balancedTake(rankedItems, site.maxCompactItems || 4, { sports: 1, technology: 1, entertainment: 2, seasonal: 1, business: 1, general: 2 });
  if (!items.length) {
    renderEmpty(itemsTarget, "まだ表示できるトレンドがありません。GitHub Actionsの初回取得後に反映されます。");
  } else {
    itemsTarget.replaceChildren(
      ...items.map((item) => {
        const row = create("a", "compact-item");
        safeExternalAttrs(row);
        row.href = readableTrendUrl(item);
        row.append(create("div", "compact-word", `#${item.keyword}`));
        row.append(create("div", "compact-metrics", compactMetricText(item)));
        return row;
      })
    );
  }

  itemsTarget.before(compactContextStrip(latest.context || {}));

  const linksTarget = document.querySelector("[data-compact-links]");
  const activeLinks = links.filter((link) => link.active).sort((a, b) => b.priority - a.priority).slice(0, site.maxCompactLinks || 5);
  linksTarget.replaceChildren(
    ...activeLinks.map((link) => {
      const anchor = safeExternalAttrs(create("a", "open-link", `${link.label}で確認 ↗`));
      anchor.href = link.url;
      return anchor;
    })
  );

  const more = document.querySelector("[data-more]");
  more.href = site.sharePointListUrl || "../";
};

const section = (title, items, options = {}) => {
  const wrap = create("section", "section");
  if (options.featured) wrap.classList.add("featured-section");
  if (options.compact) wrap.classList.add("compact-section");
  if (options.className) wrap.classList.add(options.className);
  const head = create("div", "section-head");
  head.append(create("h2", "", title));
  if (items.length && options.totalLabel) {
    head.append(create("span", "section-count", options.totalLabel));
  }
  const grid = create("div", "grid");
  if (options.compact) grid.classList.add("compact-grid");
  if (!items.length) renderEmpty(grid, "該当する観測ワードはまだありません。");
  else grid.replaceChildren(...items.slice(0, options.limit || 6).map(trendCard));
  wrap.append(head, grid);
  if (options.expandable && items.length > (options.limit || 6)) {
    const visibleCount = options.limit || 6;
    const extraItems = items.slice(visibleCount, options.maxItems || items.length);
    const details = create("details", "accordion");
    const summary = create("summary", "", `さらに${extraItems.length}件を簡易表示`);
    const list = create("div", "simple-trend-list");
    list.replaceChildren(...extraItems.map(simpleTrendRow));
    details.append(summary, list);
    wrap.append(details);
  }
  return wrap;
};

const appendIfAny = (target, title, items, options = {}) => {
  if (items.length) target.append(section(title, items, options));
};

const renderList = ({ site, links, latest }) => {
  document.querySelector("[data-updated]").textContent = `最終更新 ${formatUpdated(latest.updatedAt)}`;
  const main = document.querySelector("[data-dashboard]");
  main.classList.add("list-dashboard");
  const items = latest.items || [];
  const localObservations = latest.localObservations || [];

  const mainTrends = rankedTrendItems(items);
  const evergreen = evergreenItems(items);
  const growing = sortBy(items.filter(isGrowingObservation), (item) => item.evidenceChange || 0).slice(0, 20);

  main.append(listOverview({ items, mainTrends, evergreen, growing, localObservations, context: latest.context || {} }));
  main.append(section("主役: いま実際に話題のワード", mainTrends, { featured: true, className: "list-main-section", limit: 5, maxItems: 20, expandable: true, totalLabel: `${mainTrends.length}件観測` }));
  main.append(section("準メイン: 定番・継続して使えるワード", evergreen, { featured: true, className: "list-evergreen-section", limit: 6, maxItems: 20, expandable: true, totalLabel: `${evergreen.length}件保持` }));

  appendIfAny(
    main,
    "伸びている観測ワード",
    growing,
    { compact: true, limit: 4, maxItems: 20, expandable: true, totalLabel: "最大20件" }
  );

  const categoryPool = items.filter((item) => isActualTopic(item) || isMajorTopic(item));
  const categoryDefs = [
    ["エンタメ・カルチャー", "entertainment"],
    ["スポーツ", "sports"],
    ["テクノロジー", "technology"],
    ["季節・大型イベント", "seasonal"],
    ["地域・レジャー", "local"]
  ];
  for (const [title, key] of categoryDefs) {
    const categoryItems = sortBy(categoryPool.filter((item) => categoryKey(item) === key), (item) => item.score || 0).slice(0, 20);
    appendIfAny(main, title, categoryItems, { compact: true, limit: 4, maxItems: 20, expandable: true, totalLabel: `${categoryItems.length}件` });
  }

  if (localObservations.length) {
    main.append(localObservationShelf(localObservations));
    main.append(localObservationSections(localObservations));
  }

  const linkSection = create("section", "section link-section");
  const head = create("div", "section-head");
  head.append(create("h2", "", "SNS別観測リンク"));
  const grid = create("div", "grid link-grid");
  grid.replaceChildren(...links.filter((link) => link.active).sort((a, b) => b.priority - a.priority).map(linkCard));
  linkSection.append(head, grid);
  main.append(linkSection);

  document.querySelector("[data-note]").textContent = site.dataRefreshNote || "観測スコアは独自指標です。";
};

const main = async () => {
  const [site, links, latest] = await Promise.all([
    loadJson(paths.site, {}),
    loadJson(paths.links, []),
    loadJson(paths.latest, { items: [] })
  ]);
  if (pageKind === "home") renderHome({ site, links, latest });
  else if (pageKind === "compact") renderCompact({ site, links, latest });
  else renderList({ site, links, latest });
};

main();
