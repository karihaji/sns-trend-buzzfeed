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
  const labels = { up: "↗", flat: "→", down: "↘", new: "NEW" };
  return labels[direction] || "観測";
};

const displayDirection = (item) => {
  if (["rising", "warming"].includes(item?.trendStatus)) return "up";
  return item?.direction || "flat";
};

const signalLabel = (signalType) => {
  const labels = {
    discovered_phrase: "発見フレーズ",
    configured_rss: "重点観測",
    daily_trend: "検索トレンド",
    yahoo_realtime: "Xリアルタイム",
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
    rising: "話題",
    warming: "話題",
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
  top.append(create("span", `badge ${displayDirection(item)}`, directionLabel(displayDirection(item))));

  const metrics = create("div", "metrics");
  metrics.append(metric("観測スコア", item.score ?? "-", ""));
  metrics.append(metric("前回比", signed(item.scoreChange), classForValue(item.scoreChange)));
  metrics.append(metric("前日比", signed(item.yesterdayChange), classForValue(item.yesterdayChange)));
  metrics.append(metric("順位変動", signed(item.rankChange), classForValue(item.rankChange)));
  metrics.append(metric("観測件数", item.evidenceCount ? `${item.evidenceCount}件` : "-", ""));
  metrics.append(metric("観測の前回比", signed(item.evidenceChange), classForValue(item.evidenceChange)));
  metrics.append(metric("継続", `${item.appearCount || 1}回`, ""));

  const link = safeExternalAttrs(create("a", "open-link", "詳しく見る ↗"));
  link.href = readableTrendUrl(item);

  card.append(top, metrics, sparkline(item.series), link);
  return card;
};

const shortSignalText = (item) => {
  const parts = [statusLabel(item.trendStatus), signalLabel(item.signalType)];
  if (item.evidenceCount) parts.push(`観測 ${item.evidenceCount}件`);
  if (item.evidenceChange !== null && item.evidenceChange !== undefined) parts.push(`前回比 ${signed(item.evidenceChange)}`);
  if (item.topicSourceCount) parts.push(`観測面 ${item.topicSourceCount}`);
  return parts.join(" / ");
};

const simpleTrendRow = (item) => {
  const row = safeExternalAttrs(create("a", "simple-trend-row"));
  row.href = readableTrendUrl(item);
  row.append(create("span", "simple-keyword", `#${item.keyword}`));
  row.append(create("span", "simple-meta", shortSignalText(item)));
  row.append(create("span", `simple-badge ${displayDirection(item)}`, directionLabel(displayDirection(item))));
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

const xIframeConverterState = {
  iframeCode: "",
  iframeSrc: ""
};

const xIframeConverterClamp = (value, min, max, fallback) => {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

const xIframeConverterRootUrl = () => {
  return new URL("../", import.meta.url);
};

const xIframeConverterExtractTweetId = (value = "") => {
  const source = String(value || "");
  const match = source.match(/https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^\/\s"'<>]+\/status(?:es)?\/(\d+)(?=[^\d]|$)/iu);
  return match?.[1] || "";
};

const xIframeConverterBuildCode = ({ id, theme, cards, conversation, lang, dnt, width, height }) => {
  const embedUrl = new URL("x-post-embed.html", xIframeConverterRootUrl());
  embedUrl.searchParams.set("id", id);
  embedUrl.searchParams.set("theme", theme);
  embedUrl.searchParams.set("cards", cards);
  embedUrl.searchParams.set("conversation", conversation);
  embedUrl.searchParams.set("lang", lang);
  embedUrl.searchParams.set("dnt", String(dnt));
  embedUrl.searchParams.set("width", String(width));
  const iframeCode = `<iframe
  src="${embedUrl.toString()}"
  width="100%"
  height="${height}"
  style="width:100%;max-width:${width}px;border:0;overflow:hidden;"
  loading="lazy"
  scrolling="no"
  title="X投稿">
</iframe>`;
  return { iframeCode, iframeSrc: embedUrl.toString() };
};

const xIframeConverterCleanInstagramUrl = (value = "") => {
  const source = String(value || "").trim();
  if (!source) return "";
  const match = source.match(/https?:\/\/(?:www\.|m\.)?instagram\.com\/[^\s"'<>]+/iu);
  const candidate = match?.[0] || source;
  try {
    const url = new URL(candidate);
    const host = url.hostname.replace(/^www\./iu, "").replace(/^m\./iu, "");
    if (host !== "instagram.com") return "";
    const allowed = /^\/(?:p|reel|reels|tv|stories)\/[^/?#]+\/?/iu.test(url.pathname);
    if (!allowed) return "";
    const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return `https://www.instagram.com${path}`;
  } catch {
    return "";
  }
};

const xIframeConverterCopyText = async (text) => {
  if (!text) return false;
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to textarea copy.
    }
  }
  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.inset = "auto auto 0 0";
  helper.style.opacity = "0";
  document.body.append(helper);
  helper.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  helper.remove();
  return ok;
};

const xIframeConverterToolSection = () => {
  const sectionEl = create("section", "section x-iframe-converter-section");
  const head = create("div", "section-head");
  head.append(create("h2", "", "SNS担当者向けツール"));
  head.append(create("span", "section-count", "変換"));

  const grid = create("div", "x-iframe-converter-grid");
  const xCard = create("article", "x-iframe-converter-card x-iframe-converter-card-x");
  const xIntro = create("div", "x-iframe-converter-intro");
  xIntro.append(create("h3", "", "X投稿をiframeコードへ変換"));
  xIntro.append(create("p", "x-iframe-converter-lead", "X投稿のURLまたは公式埋め込みコードを入力すると、iframe形式の埋め込みコードを生成します。"));
  const input = create("textarea", "x-iframe-converter-textarea");
  input.placeholder = "X投稿のURL、または埋め込みコードを貼り付けてください";
  input.rows = 6;
  const error = create("p", "x-iframe-converter-message", "");

  const settings = create("div", "x-iframe-converter-settings");
  const field = (label, control) => {
    const wrap = create("label", "x-iframe-converter-field");
    wrap.append(create("span", "", label), control);
    return wrap;
  };
  const select = (options) => {
    const element = document.createElement("select");
    options.forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      element.append(option);
    });
    return element;
  };
  const theme = select([["light", "ライト"], ["dark", "ダーク"]]);
  const cards = select([["visible", "表示する"], ["hidden", "非表示"]]);
  const conversation = select([["none", "非表示"], ["all", "表示する"]]);
  const lang = select([["ja", "日本語"], ["en", "英語"]]);
  const dnt = select([["true", "有効"], ["false", "無効"]]);
  const height = document.createElement("input");
  height.type = "number";
  height.min = "300";
  height.max = "1500";
  height.value = "720";
  const width = document.createElement("input");
  width.type = "number";
  width.min = "250";
  width.max = "550";
  width.value = "550";
  settings.append(
    field("テーマ", theme),
    field("画像・動画・カード", cards),
    field("返信元の投稿", conversation),
    field("表示言語", lang),
    field("iframeの高さ(px)", height),
    field("最大横幅(px)", width),
    field("パーソナライズ抑制", dnt)
  );

  const actions = create("div", "x-iframe-converter-actions");
  const convert = create("button", "x-iframe-converter-button x-iframe-converter-button-primary", "変換する");
  const clear = create("button", "x-iframe-converter-button", "入力をクリア");
  const copy = create("button", "x-iframe-converter-button", "生成コードをコピー");
  convert.type = "button";
  clear.type = "button";
  copy.type = "button";
  copy.disabled = true;
  actions.append(convert, clear, copy);

  const output = create("textarea", "x-iframe-converter-output");
  output.readOnly = true;
  output.rows = 8;
  const preview = create("div", "x-iframe-converter-preview");
  preview.append(create("p", "", "変換すると、ここに表示イメージが表示されます。"));

  convert.addEventListener("click", () => {
    const id = xIframeConverterExtractTweetId(input.value);
    if (!id || !/^\d+$/u.test(id)) {
      error.textContent = "X投稿のURLまたは埋め込みコードを確認してください。";
      output.value = "";
      xIframeConverterState.iframeCode = "";
      xIframeConverterState.iframeSrc = "";
      copy.disabled = true;
      preview.replaceChildren(create("p", "", "変換すると、ここに表示イメージが表示されます。"));
      return;
    }
    const result = xIframeConverterBuildCode({
      id,
      theme: theme.value === "dark" ? "dark" : "light",
      cards: cards.value === "hidden" ? "hidden" : "visible",
      conversation: conversation.value === "all" ? "all" : "none",
      lang: lang.value === "en" ? "en" : "ja",
      dnt: dnt.value !== "false",
      height: xIframeConverterClamp(height.value, 300, 1500, 720),
      width: xIframeConverterClamp(width.value, 250, 550, 550)
    });
    error.textContent = "";
    output.value = result.iframeCode;
    xIframeConverterState.iframeCode = result.iframeCode;
    xIframeConverterState.iframeSrc = result.iframeSrc;
    copy.disabled = false;
    const frame = document.createElement("iframe");
    frame.src = result.iframeSrc;
    frame.width = "100%";
    frame.height = String(xIframeConverterClamp(height.value, 300, 1500, 720));
    frame.loading = "lazy";
    frame.scrolling = "no";
    frame.title = "X投稿プレビュー";
    frame.className = "x-iframe-converter-preview-frame";
    frame.addEventListener("error", () => {
      preview.replaceChildren(create("p", "x-iframe-converter-message", "プレビューを読み込めませんでした。"));
    });
    preview.replaceChildren(frame);
  });

  clear.addEventListener("click", () => {
    input.value = "";
    output.value = "";
    error.textContent = "";
    xIframeConverterState.iframeCode = "";
    xIframeConverterState.iframeSrc = "";
    copy.disabled = true;
    preview.replaceChildren(create("p", "", "変換すると、ここに表示イメージが表示されます。"));
  });

  copy.addEventListener("click", async () => {
    const ok = await xIframeConverterCopyText(xIframeConverterState.iframeCode);
    error.textContent = ok ? "iframeコードをコピーしました。" : "コピーできませんでした。コードを選択してコピーしてください。";
  });

  const xLane = create("div", "x-iframe-converter-lane x-iframe-converter-lane-x");
  const xInputPanel = create("div", "x-iframe-converter-pane x-iframe-converter-pane-input");
  xInputPanel.append(input, error);
  const xControlPanel = create("div", "x-iframe-converter-pane x-iframe-converter-pane-control");
  xControlPanel.append(settings, actions);
  const xResultPanel = create("div", "x-iframe-converter-pane x-iframe-converter-pane-result");
  xResultPanel.append(output, preview);
  xLane.append(xInputPanel, xControlPanel, xResultPanel);
  xCard.append(xIntro, xLane);

  const instagramCard = create("article", "x-iframe-converter-card x-iframe-converter-card-instagram");
  const igIntro = create("div", "x-iframe-converter-intro");
  igIntro.append(create("h3", "", "InstagramシェアURLを整理"));
  igIntro.append(create("p", "x-iframe-converter-lead", "共有URLに含まれる個人ID・トラッキング要素を外し、投稿へ直接飛ぶURLへ変換します。"));
  const igInput = create("textarea", "x-iframe-converter-textarea");
  igInput.placeholder = "Instagramの共有URLを貼り付けてください";
  igInput.rows = 4;
  const igMessage = create("p", "x-iframe-converter-message", "");
  const igActions = create("div", "x-iframe-converter-actions");
  const igConvert = create("button", "x-iframe-converter-button x-iframe-converter-button-primary", "変換する");
  const igClear = create("button", "x-iframe-converter-button", "入力をクリア");
  const igCopy = create("button", "x-iframe-converter-button", "生成URLをコピー");
  igConvert.type = "button";
  igClear.type = "button";
  igCopy.type = "button";
  igCopy.disabled = true;
  igActions.append(igConvert, igClear, igCopy);
  const igOutput = create("textarea", "x-iframe-converter-output x-iframe-converter-output-small");
  igOutput.readOnly = true;
  igOutput.rows = 3;

  igConvert.addEventListener("click", () => {
    const cleaned = xIframeConverterCleanInstagramUrl(igInput.value);
    if (!cleaned) {
      igOutput.value = "";
      igCopy.disabled = true;
      igMessage.textContent = "Instagramの投稿URLを確認してください。";
      return;
    }
    igOutput.value = cleaned;
    igCopy.disabled = false;
    igMessage.textContent = "";
  });
  igClear.addEventListener("click", () => {
    igInput.value = "";
    igOutput.value = "";
    igCopy.disabled = true;
    igMessage.textContent = "";
  });
  igCopy.addEventListener("click", async () => {
    const ok = await xIframeConverterCopyText(igOutput.value);
    igMessage.textContent = ok ? "URLをコピーしました。" : "コピーできませんでした。URLを選択してコピーしてください。";
  });
  const igLane = create("div", "x-iframe-converter-lane x-iframe-converter-lane-instagram");
  const igInputPanel = create("div", "x-iframe-converter-pane x-iframe-converter-pane-input");
  igInputPanel.append(igInput, igMessage);
  const igControlPanel = create("div", "x-iframe-converter-pane x-iframe-converter-pane-control");
  igControlPanel.append(igActions);
  const igResultPanel = create("div", "x-iframe-converter-pane x-iframe-converter-pane-result");
  igResultPanel.append(igOutput);
  igLane.append(igInputPanel, igControlPanel, igResultPanel);
  instagramCard.append(igIntro, igLane);
  grid.append(xCard, instagramCard);
  sectionEl.append(head, grid);
  return sectionEl;
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
const keywordText = (item) => String(item?.keyword || "").trim();
const isSentenceLikeKeyword = (item) => {
  const keyword = keywordText(item);
  if (keyword.length > 22) return true;
  if (/[、。！？]|から|まで|について|として|より|など|発表|会見|翌日|第\d+話|画像\d|＜|＞|販売|投資|疑い|方針|見通し/.test(keyword)) return true;
  if (/^\d+月\d+日$|^[A-Za-z\s]+warning$/i.test(keyword)) return true;
  return false;
};
const isCleanPublicTopic = (item) => {
  const keyword = keywordText(item);
  if (!keyword || isSentenceLikeKeyword(item)) return false;
  if (/ニュース|速報|記事|写真|動画|会見|警報|氾濫|被害|容疑|逮捕|死去|訃報/.test(keyword)) return false;
  return keyword.length <= 18 || (item.topicSourceCount || 0) >= 2 || (item.evidenceCount || 0) >= 3;
};
const isMainTrendItem = (item) => {
  if (item.signalType === "daily_trend" || item.signalType === "yahoo_realtime") return !isSentenceLikeKeyword(item);
  if (isActualTopic(item)) {
    if (!isCleanPublicTopic(item)) return false;
    return (
      (item.topicSourceCount || 0) >= 2 ||
      (item.evidenceCount || 0) >= 2 ||
      (item.score || 0) >= 88 ||
      (item.rank || 99) <= 10
    );
  }
  return false;
};
const isPostIdea = (item) => {
  const keyword = keywordText(item);
  if (isActualTrend(item) || isActualTopic(item) || isMajorTopic(item)) return false;
  if (item.signalType !== "discovered_phrase") return false;
  if (isSentenceLikeKeyword(item)) return false;
  if (!/構文|あるある|チャレンジ|ダンス|音源|ミーム|選手権|してみた|作ってみた|検証|ルーティン|テンプレ|ネタ|ハック|診断|ポーズ|加工|コーデ|メイク|レシピ|グッズ/.test(keyword)) return false;
  if (item.trendStatus === "cooling") return false;
  if ((item.appearCount || 0) > 8 && (item.evidenceChange || 0) <= 0) return false;
  return (item.evidenceCount || 0) >= 2 || (item.evidenceChange || 0) > 0 || ["rising", "warming", "candidate"].includes(item.trendStatus);
};
const isEvergreen = isPostIdea;
const isMovingTopic = (item) => {
  if (isMajorTopic(item)) return false;
  if (isSentenceLikeKeyword(item)) return false;
  if (item.trendStatus === "cooling") return false;
  if (isGrowingObservation(item)) return true;
  if (isActualTrend(item)) return (item.scoreChange || 0) > 0 || (item.rankChange || 0) > 0;
  if (isActualTopic(item)) {
    if (!isCleanPublicTopic(item)) return false;
    const hasPrevious = item.previousScore !== null && item.previousScore !== undefined;
    const positiveMovement = hasPrevious && ((item.scoreChange || 0) >= 4 || (item.evidenceChange || 0) > 0 || ((item.rankChange || 0) >= 2 && (item.scoreChange || 0) >= 0));
    return positiveMovement || (item.topicSourceCount || 0) >= 2;
  }
  return false;
};
const movingTopicScore = (item) =>
  (item.scoreChange || 0) * 80 +
  (item.evidenceChange || 0) * 120 +
  (item.rankChange || 0) * 36 +
  (item.topicSourceCount || 0) * 28 +
  (item.score || 0);

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
  if (isMovingTopic(item)) return `反応あり　前回比 ${signed(item.scoreChange)}`;
  if (isEvergreen(item)) return `アイデア種　観測 ${item.evidenceCount ? `${item.evidenceCount}件` : "-"}`;
  return `${statusLabel(item.trendStatus)}　前回比 ${signed(item.evidenceChange)}`;
};

const rankedTrendItems = (items) =>
  balancedTake(
    dedupeTrendTopics(sortBy(items.filter(isMainTrendItem), publicHeatScore)),
    20,
    { sports: 4, technology: 4, entertainment: 7, seasonal: 4, local: 3, business: 2, general: 7 },
    { maxConsecutive: 2 }
  );

const homeLeadTrendItems = (items, limit = 10) => {
  const primary = rankedTrendItems(items);
  if (primary.length >= limit) return primary;
  const seen = new Set(primary.map(trendClusterKey));
  const fallback = sortBy(
    items.filter((item) => {
      if (!isMovingTopic(item) && !isCleanPublicTopic(item)) return false;
      if (isPostIdea(item) || isSentenceLikeKeyword(item)) return false;
      return !seen.has(trendClusterKey(item));
    }),
    publicHeatScore
  );
  return balancedTake(
    [...primary, ...fallback],
    20,
    { sports: 4, technology: 4, entertainment: 7, seasonal: 4, local: 3, business: 3, general: 8 },
    { maxConsecutive: 2 }
  );
};

const evergreenItems = (items) =>
  balancedTake(
    sortBy(items.filter(isEvergreen), (item) => (item.evidenceChange || 0) * 120 + (item.evidenceCount || 0) * 34 + (item.score || 0) + ((item.appearCount || 0) <= 4 ? 35 : 0) - Math.max(0, (item.appearCount || 0) - 6) * 8),
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
  if (daysUntil < 0) return "開催中";
  if (daysUntil === 0) return "今日";
  if (daysUntil === 1) return "明日";
  return `${daysUntil}日後`;
};

const contextEventRow = (item) => {
  const row = create("div", "context-event-row");
  row.append(create("span", "context-date", contextDateLabel(item.daysUntil)));
  const copy = create("div");
  copy.append(create("strong", "", item.title || "記念日"));
  copy.append(create("small", "", `${item.category || "記念日"}${item.source ? ` / ${item.source}` : ""} / ${item.hint || "投稿文脈を確認"}`));
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

const localEvents = (context = {}, limit = 6) =>
  [...(context.localEvents || [])]
    .filter((item) => item.daysUntil !== null && item.daysUntil !== undefined)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (a.daysUntil || 0) - (b.daysUntil || 0))
    .slice(0, limit);

const daysFromToday = (dateValue) => {
  const iso = String(dateValue || "").slice(0, 10);
  const target = Date.parse(`${iso}T00:00:00+09:00`);
  const now = new Date();
  const today = Date.parse(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T00:00:00+09:00`);
  if (Number.isNaN(target) || Number.isNaN(today)) return null;
  return Math.round((target - today) / (24 * 60 * 60 * 1000));
};

const isVisibleLocalEvent = (item) => {
  if (item.daysUntil === null || item.daysUntil === undefined) return false;
  const endDistance = daysFromToday(item.endDate || item.startDate);
  return item.daysUntil >= -1 || (item.daysUntil <= 0 && endDistance !== null && endDistance >= -1);
};

const calendarLocalEvents = (context = {}, limit = 96) =>
  [...(context.localEvents || [])]
    .filter(isVisibleLocalEvent)
    .sort((a, b) => (a.startDate || "").localeCompare(b.startDate || "") || (b.priority || 0) - (a.priority || 0))
    .slice(0, limit);

const nearbyLocalEvents = (context = {}, limit = 6) =>
  [...(context.localEvents || [])]
    .filter(isVisibleLocalEvent)
    .sort((a, b) => (a.daysUntil || 0) - (b.daysUntil || 0) || (b.priority || 0) - (a.priority || 0))
    .slice(0, limit);

const contextEvents = (context = {}, limit = 4) =>
  [...(context.holidays || []), ...(context.anniversaries || [])]
    .sort((a, b) => (a.daysUntil ?? 99) - (b.daysUntil ?? 99))
    .slice(0, limit);

const weatherItems = (context = {}, limit = 4) =>
  [...(context.weather || [])]
    .sort((a, b) => compactWeatherOrder(a) - compactWeatherOrder(b))
    .slice(0, limit);

const contextIdeaChip = (item) => {
  const chip = create("span", "context-idea-chip");
  chip.append(create("b", "", contextDateLabel(item.daysUntil)));
  chip.append(create("span", "", item.title || "記念日"));
  return chip;
};

const localEventChip = (item) => {
  const chip = safeExternalAttrs(create("a", `local-event-chip rank-${(item.rank || "b").toLowerCase()}`));
  chip.href = item.sourceUrl || newsSearchUrl(item.title);
  chip.append(create("b", "", contextDateLabel(item.daysUntil)));
  const copy = create("span", "");
  copy.append(create("strong", "", item.title || "地域イベント"));
  copy.append(create("small", "", `${item.rank || "B"} / ${item.category || "イベント"} / ${item.venue || "鹿児島"}`));
  chip.append(copy);
  return chip;
};

const localEventRows = (events = [], limit = 3) => {
  const wrap = create("div", "local-event-rows");
  if (events.length) {
    wrap.replaceChildren(...events.slice(0, limit).map(localEventChip));
  } else {
    wrap.append(create("small", "compact-tray-empty", "近日イベントを観測中"));
  }
  return wrap;
};

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const jstTodayDate = () => {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Number(values.year), Number(values.month) - 1, Number(values.day));
};

const eventDateKeysInMonth = (event, first, last) => {
  const start = new Date(`${event.startDate}T00:00:00+09:00`);
  const end = new Date(`${event.endDate || event.startDate}T00:00:00+09:00`);
  if (Number.isNaN(start.getTime())) return [];
  const cursor = new Date(Math.max(start.getTime(), first.getTime()));
  const final = new Date(Math.min(Number.isNaN(end.getTime()) ? start.getTime() : end.getTime(), last.getTime()));
  const keys = [];
  while (cursor <= final) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
};

const localEventDuration = (event) => {
  const start = Date.parse(`${event.startDate}T00:00:00+09:00`);
  const end = Date.parse(`${event.endDate || event.startDate}T00:00:00+09:00`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 1;
  return Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1);
};

const isLongLocalEvent = (event) => localEventDuration(event) >= 3;

const localEventDateRangeLabel = (event) => {
  const start = String(event.startDate || "").slice(5).replace("-", "/");
  const end = String(event.endDate || event.startDate || "").slice(5).replace("-", "/");
  return start && end && start !== end ? `${start}-${end}` : start;
};

const localEventTone = (event) => {
  const text = `${event.category || ""} ${event.title || ""}`;
  if (/祭り|地域行事|六月灯|花火|ナイトクルーズ/u.test(text)) return "festival";
  if (/商業|百貨店|催事|バーゲン|BARGAIN|POP|ポップアップ|SHOP|STORE|マルシェ/u.test(text)) return "commerce";
  if (/公演|コンサート|ライブ|舞台|演劇|音楽|朗読|寄席/u.test(text)) return "stage";
  if (/展示|展覧|妖怪|フェスタ/u.test(text)) return "exhibit";
  if (/観光|温泉|旅行/u.test(text)) return "tourism";
  if (/スポーツ|アリーナ|大会/u.test(text)) return "sports";
  return "default";
};

const localEventDialogDateLabel = (date) => {
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${date.getMonth() + 1}月${date.getDate()}日（${weekdays[date.getDay()]}）`;
};

const localEventDetailRow = (event) => {
  const item = safeExternalAttrs(create("a", `event-dialog-item event-tone-${localEventTone(event)}`));
  item.href = event.sourceUrl || newsSearchUrl(event.title);
  const meta = create("div", "event-dialog-meta");
  meta.append(create("span", "event-dialog-category", event.category || "イベント"));
  meta.append(create("span", "event-dialog-range", localEventDateRangeLabel(event)));
  item.append(meta, create("strong", "", event.title || "地域イベント"));
  item.append(create("small", "", event.venue || "会場情報を確認"));
  return item;
};

const localEventCalendar = (events = []) => {
  const section = create("section", "section event-calendar-section");
  const head = create("div", "section-head");
  head.append(create("h2", "", "鹿児島イベントカレンダー"));
  head.append(create("span", "section-count", `${events.length}件`));

  if (!events.length) {
    const empty = create("div", "event-calendar empty", "イベント候補は次回取得後に表示されます。");
    section.append(head, empty);
    return section;
  }

  const current = jstTodayDate();
  const year = current.getFullYear();
  const month = current.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startOffset = first.getDay();
  const days = [];
  for (let i = 0; i < startOffset; i += 1) days.push(null);
  for (let day = 1; day <= last.getDate(); day += 1) days.push(new Date(year, month, day));

  const byDate = new Map();
  for (const event of events) {
    for (const key of eventDateKeysInMonth(event, first, last)) {
      if (!key || !key.startsWith(monthKey(first))) continue;
      const list = byDate.get(key) || [];
      list.push(event);
      byDate.set(key, list);
    }
  }

  const calendar = create("div", "event-calendar");
  const monthLabel = create("div", "event-calendar-month", `${year}年${month + 1}月`);
  const eventDialog = create("dialog", "event-calendar-dialog");
  const dialogHeader = create("div", "event-calendar-dialog-head");
  const dialogTitle = create("h3", "", "イベント");
  const dialogCount = create("span", "event-calendar-dialog-count", "");
  const dialogClose = create("button", "event-calendar-dialog-close", "×");
  dialogClose.type = "button";
  dialogClose.setAttribute("aria-label", "イベント一覧を閉じる");
  dialogHeader.append(create("div", "event-calendar-dialog-title"), dialogClose);
  dialogHeader.firstElementChild.append(dialogTitle, dialogCount);
  const dialogBody = create("div", "event-calendar-dialog-body");
  eventDialog.append(dialogHeader, dialogBody);

  const showEventDialog = (date, dayEvents) => {
    const sorted = [...dayEvents].sort(
      (a, b) => Number(isLongLocalEvent(b)) - Number(isLongLocalEvent(a)) || (b.priority || 0) - (a.priority || 0)
    );
    dialogTitle.textContent = localEventDialogDateLabel(date);
    dialogCount.textContent = `${sorted.length}件`;
    dialogBody.replaceChildren(...sorted.map(localEventDetailRow));
    if (!eventDialog.open) eventDialog.showModal();
  };

  dialogClose.addEventListener("click", () => eventDialog.close());
  eventDialog.addEventListener("click", (event) => {
    if (event.target === eventDialog) eventDialog.close();
  });

  const ongoing = [...events]
    .filter((event) => isVisibleLocalEvent(event) && isLongLocalEvent(event) && eventDateKeysInMonth(event, first, last).length)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || localEventDuration(b) - localEventDuration(a))
    .slice(0, 6);
  if (ongoing.length) {
    const rail = create("div", "event-calendar-rail");
    ongoing.forEach((event) => {
      const item = safeExternalAttrs(create("a", `event-rail-item event-tone-${localEventTone(event)} rank-${(event.rank || "b").toLowerCase()}`));
      item.href = event.sourceUrl || newsSearchUrl(event.title);
      item.append(create("span", "", localEventDateRangeLabel(event)));
      item.append(create("strong", "", event.title));
      rail.append(item);
    });
    calendar.append(monthLabel, rail);
  } else {
    calendar.append(monthLabel);
  }
  const weekdays = create("div", "event-calendar-weekdays");
  ["日", "月", "火", "水", "木", "金", "土"].forEach((label) => weekdays.append(create("span", "", label)));
  const grid = create("div", "event-calendar-grid");
  days.forEach((date) => {
    const cell = create("div", date ? "event-day" : "event-day event-day-empty");
    if (!date) {
      grid.append(cell);
      return;
    }
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const dayEvents = [...(byDate.get(iso) || [])].sort((a, b) => Number(isLongLocalEvent(b)) - Number(isLongLocalEvent(a)) || (b.priority || 0) - (a.priority || 0));
    const dayButton = create("button", dayEvents.length ? "event-day-button event-day-button-active" : "event-day-button");
    dayButton.type = "button";
    dayButton.append(create("span", "event-day-number", String(date.getDate())));
    if (dayEvents.length) {
      const summaries = new Map();
      dayEvents.forEach((event) => {
        const tone = localEventTone(event);
        summaries.set(tone, (summaries.get(tone) || 0) + 1);
      });
      const markers = create("span", "event-day-markers");
      [...summaries.entries()].slice(0, 4).forEach(([tone, count]) => {
        const marker = create("span", `event-day-marker event-tone-${tone}`);
        marker.title = `${tone === "exhibit" ? "展示" : tone === "stage" ? "公演" : tone === "commerce" ? "催事" : tone === "festival" ? "地域行事" : tone === "tourism" ? "観光" : tone === "sports" ? "スポーツ" : "イベント"} ${count}件`;
        markers.append(marker);
      });
      dayButton.append(markers, create("strong", "event-day-count", `${dayEvents.length}件`));
      dayButton.setAttribute("aria-label", `${localEventDialogDateLabel(date)}のイベント ${dayEvents.length}件を表示`);
      dayButton.addEventListener("click", () => showEventDialog(date, dayEvents));
    } else {
      dayButton.setAttribute("aria-label", `${localEventDialogDateLabel(date)}はイベントなし`);
    }
    cell.append(dayButton);
    grid.append(cell);
  });
  calendar.append(weekdays, grid);
  section.append(head, calendar, eventDialog);
  return section;
};

const weatherRibbon = (context = {}) => {
  const ribbon = create("div", "weather-ribbon");
  const weather = weatherItems(context, 4);
  if (weather.length) {
    ribbon.replaceChildren(
      ...weather.map((item) => {
        const node = create("div", "weather-ribbon-item");
        node.append(create("span", "", item.label || "地域"));
        node.append(create("strong", "", item.summary || "観測中"));
        node.append(create("small", "", `${item.temperature ?? "-"}℃ / ${item.precipitation ?? "-"}%`));
        return node;
      })
    );
  } else {
    ribbon.append(create("div", "empty mini-empty", "天気は次回取得時に反映されます。"));
  }
  return ribbon;
};

const homeContextPanel = (context = {}, localObservations = []) => {
  const panel = create("section", "dashboard-panel home-context-panel");
  const head = create("div", "panel-head");
  head.append(create("h2", "", "今日使える文脈"));
  head.append(create("span", "section-count", "記念日・天気・地域"));

  const events = contextEvents(context, 3);
  const ideaWrap = create("div", "context-idea-row");
  if (events.length) {
    ideaWrap.replaceChildren(...events.map(contextIdeaChip));
  } else {
    ideaWrap.append(create("small", "compact-tray-empty", "記念日情報を取得中"));
  }

  const localRows = create("div", "context-local-snippets");
  const localItems = localObservations.slice(0, 2);
  if (localItems.length) {
    localRows.replaceChildren(
      ...localItems.map((item) => {
        const anchor = safeExternalAttrs(create("a", "context-local-snippet"));
        anchor.href = item.observeUrl || item.sourceUrl || "https://news.google.com/";
        anchor.append(create("span", "", item.sourceLabel || "ローカル"));
        anchor.append(create("strong", "", item.keyword || item.title || "地域話題"));
        return anchor;
      })
    );
  } else {
    localRows.append(create("small", "compact-tray-empty", "地域話題を観測中"));
  }

  const eventItems = nearbyLocalEvents(context, 3);
  const eventHead = create("div", "context-subhead");
  eventHead.append(create("span", "", "近日イベント"));
  eventHead.append(create("small", "", eventItems.length ? "投稿文脈に使える地域予定" : "取得待ち"));

  panel.append(head, ideaWrap, weatherRibbon(context), eventHead, localEventRows(eventItems, 3), localRows);
  return panel;
};

const listContextPanel = (context = {}) => {
  const panel = create("div", "list-context-panel");
  const head = create("div", "list-panel-head");
  head.append(create("h2", "", "今日の文脈・地域状況"));
  head.append(create("span", "section-count", "深掘り"));

  const events = contextEvents(context, 5);
  const eventList = create("div", "context-event-list");
  if (events.length) {
    eventList.replaceChildren(...events.map(contextEventRow));
  } else {
    eventList.append(create("div", "empty mini-empty", "近い記念日・祝日は設定待ちです。"));
  }

  const weatherGrid = create("div", "weather-grid");
  const weather = weatherItems(context, 4);
  if (weather.length) {
    weatherGrid.replaceChildren(...weather.map(weatherTile));
  } else {
    weatherGrid.append(create("div", "empty mini-empty", "天気は次回取得時に反映されます。"));
  }

  panel.append(head, eventList, weatherGrid);
  const eventItems = nearbyLocalEvents(context, 5);
  const eventBlock = create("div", "list-event-block");
  const eventHead = create("div", "context-subhead list-event-subhead");
  eventHead.append(create("span", "", "地域イベントピック"));
  eventHead.append(create("small", "", `${eventItems.length}件`));
  eventBlock.append(eventHead, localEventRows(eventItems, 5));
  panel.append(eventBlock);
  return panel;
};

const compactWeatherOrder = (item) => {
  const label = item?.label || "";
  const order = ["鹿児島", "種子島", "屋久島", "奄美"];
  const index = order.findIndex((name) => label.includes(name));
  return index === -1 ? 99 : index;
};

const compactHeaderContext = (context = {}, links = []) => {
  const wrap = create("div", "compact-meta-strip");
  const events = [...(context.holidays || []), ...(context.anniversaries || [])]
    .sort((a, b) => (a.daysUntil ?? 99) - (b.daysUntil ?? 99))
    .slice(0, 2);
  const event = nearbyLocalEvents(context, 1)[0];
  const weather = [...(context.weather || [])].sort((a, b) => compactWeatherOrder(a) - compactWeatherOrder(b)).slice(0, 4);

  const eventChip = create("span", "compact-meta-chip compact-meta-event");
  if (events.length) {
    eventChip.append(create("b", "", contextDateLabel(events[0].daysUntil)));
    eventChip.append(create("span", "", events.map((event) => event.title || "記念日").join(" / ")));
  } else {
    eventChip.append(create("b", "", "今日"));
    eventChip.append(create("span", "", "記念日取得待ち"));
  }

  const localEventChip = create("span", "compact-meta-chip compact-meta-local-event");
  if (event) {
    localEventChip.append(create("b", "", contextDateLabel(event.daysUntil)));
    localEventChip.append(create("span", "", event.title || "地域イベント"));
  } else {
    localEventChip.append(create("b", "", "近日"));
    localEventChip.append(create("span", "", "イベント取得待ち"));
  }

  const weatherChip = create("div", "compact-weather-card");
  weatherChip.append(create("b", "", "地域天気"));
  const weatherList = create("div", "compact-weather-list");
  if (weather.length) {
    weatherList.replaceChildren(
      ...weather.map((item) => {
        const cell = create("span", "compact-weather-dot");
        cell.append(create("b", "", item.label || "地域"));
        cell.append(create("small", "", `${item.summary || "観測中"} ${item.temperature ?? "-"}℃`));
        return cell;
      })
    );
  } else {
    weatherList.append(create("span", "compact-tray-empty", "天気取得待ち"));
  }
  weatherChip.append(weatherList);

  const observeMenu = create("details", "compact-observe-menu");
  observeMenu.append(create("summary", "", "観測"));
  const observeLinks = create("div", "compact-observe-links");
  if (links.length) observeLinks.replaceChildren(...links.slice(0, 5).map(compactSourceLink));
  else observeLinks.append(create("small", "compact-tray-empty", "リンク設定待ち"));
  observeMenu.append(observeLinks);

  wrap.append(eventChip, localEventChip, weatherChip, observeMenu);
  return wrap;
};

const compactSpotlight = (item) => {
  const link = safeExternalAttrs(create("a", `compact-spotlight compact-hero-link ${item ? `category-${categoryKey(item)}` : ""}`.trim()));
  link.href = readableTrendUrl(item);
  const head = create("div", "compact-hero-head");
  head.append(create("span", "tag", item ? compactMetricText(item) : "観測待ち"));
  head.append(create("span", "compact-hero-status", item ? directionLabel(displayDirection(item)) : "NEW"));
  link.append(head);
  link.append(create("strong", "", item ? `#${item.keyword}` : "トレンド取得待ち"));
  link.append(create("small", "", item ? shortSignalText(item) : "最新の実トレンドを取得中です。"));
  return link;
};

const compactTrendChip = (item) => {
  const chip = safeExternalAttrs(create("a", `compact-trend-chip category-${categoryKey(item)}`));
  chip.href = readableTrendUrl(item);
  chip.append(create("span", "", `#${item.keyword}`));
  chip.append(create("em", "", compactMetricText(item)));
  chip.append(create("small", "", directionLabel(displayDirection(item))));
  return chip;
};

const compactMiniWord = (item) => {
  const row = safeExternalAttrs(create("a", "compact-mini-word"));
  row.href = readableTrendUrl(item);
  row.append(create("span", "", `#${item.keyword}`));
  row.append(create("small", "", compactMetricText(item)));
  return row;
};

const compactSourceLink = (link) => {
  const anchor = safeExternalAttrs(create("a", "compact-source-link", link.label));
  anchor.href = link.url;
  return anchor;
};

const compactInfoTray = ({ evergreen, growing }) => {
  const tray = create("div", "compact-info-tray");

  const evergreenBox = create("div", "compact-tray-box");
  evergreenBox.append(create("span", "compact-tray-label", "アイデア種"));
  const evergreenRows = create("div", "compact-tray-rows");
  if (evergreen.length) evergreenRows.replaceChildren(...evergreen.slice(0, 2).map(compactMiniWord));
  else evergreenRows.append(create("small", "compact-tray-empty", "新しい型を観測中"));
  evergreenBox.append(evergreenRows);

  const growingBox = create("div", "compact-tray-box");
  growingBox.append(create("span", "compact-tray-label", "反応あり"));
  const growingRows = create("div", "compact-tray-rows");
  if (growing.length) growingRows.replaceChildren(...growing.slice(0, 2).map(compactMiniWord));
  else growingRows.append(create("small", "compact-tray-empty", "反応待ち"));
  growingBox.append(growingRows);

  tray.append(evergreenBox, growingBox);
  return tray;
};

const listOverview = ({ items, mainTrends, evergreen, growing, localObservations, context }) => {
  const eventItems = localEvents(context, 20);
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
    listSummaryTile("注目ワード", `${mainTrends.length}`, "実反応を優先"),
    listSummaryTile("アイデア種", `${evergreen.length}`, "直近の投稿型"),
    listSummaryTile("反応あり", `${growing.length}`, "前回比・複数面"),
    listSummaryTile("地域予定", `${eventItems.length}`, "近日イベント")
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
  const source = item.sourceLabel ? ` / ${item.sourceLabel}` : "";
  return `${tier} / ${statusLabel(item.trendStatus)} / ${evidence}${source}`;
};

const localObservationCard = (item) => {
  const card = safeExternalAttrs(create("a", "local-card"));
  card.href = item.observeUrl || "https://news.google.com/";
  const top = create("div", "local-card-top");
  top.append(create("span", "local-tier", item.localTier || "B"));
  top.append(create("span", "local-section-label", item.localSectionTitle || "ローカル観測"));
  card.append(top);
  card.append(create("strong", "", `#${item.keyword}`));
  if (item.sourceHeadline && item.sourceHeadline !== item.keyword) {
    card.append(create("p", "local-headline", item.sourceHeadline));
  }
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
  row.append(create("span", "local-row-meta", item.sourceLabel || localObservationLabel(item)));
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
  const mainTrends = homeLeadTrendItems(items, 10);
  const growing = sortBy(items.filter(isMovingTopic), movingTopicScore).slice(0, 8);
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
  heroStats.append(statTile("注目ワード", `${mainTrends.length}`, "実反応を優先"));
  heroStats.append(statTile("反応あり", `${growing.length}`, "前回比・複数面"));
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
  leadHead.append(create("h2", "", "いまの注目ワード"));
  leadHead.append(create("span", "section-count", `${mainTrends.length}件`));
  const leadList = create("div", "pill-list");
  leadList.replaceChildren(...mainTrends.slice(0, 10).map(trendPill));
  leadPanel.append(leadHead, leadList);

  const categoryPanel = create("section", "dashboard-panel category-panel");
  const categoryHead = create("div", "panel-head");
  categoryHead.append(create("h2", "", "カテゴリ構成"));
  categoryHead.append(create("span", "section-count", `${items.length}件`));
  const bars = create("div", "category-bars");
  bars.replaceChildren(...categoryEntries.map(([key, count]) => categoryBar(key, count, maxCategory)));
  categoryPanel.append(categoryHead, bars);

  const growingPanel = create("section", "dashboard-panel growing-panel");
  const growingHead = create("div", "panel-head");
  growingHead.append(create("h2", "", "反応が見える話題"));
  growingHead.append(create("span", "section-count", `${growing.length}件`));
  const growingList = create("div", "compact-dashboard-list");
  if (growing.length) growingList.replaceChildren(...growing.slice(0, 4).map(simpleTrendRow));
  else renderEmpty(growingList, "前回より反応が見える話題はまだありません。");
  growingPanel.append(growingHead, growingList);

  const linksPanel = create("section", "dashboard-panel links-panel");
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

  const contextPanel = homeContextPanel(latest.context || {}, localObservations);
  const localPanel = localObservationShelf(localObservations, { home: true });
  dashboardTarget.replaceChildren(leadPanel, contextPanel, categoryPanel, growingPanel, linksPanel, localPanel, xIframeConverterToolSection());
  document.querySelector("[data-note]").textContent = site.dataRefreshNote || "観測スコアは独自指標です。";
};

const renderCompact = ({ site, links, latest }) => {
  document.title = formatDateTitle();
  document.querySelector("[data-title]").textContent = "最新SNSトレンド";
  document.querySelector("[data-updated]").textContent = `最終更新 ${formatUpdated(latest.updatedAt)}`;
  document.querySelector("[data-more]").textContent = "詳しく見る";

  const itemsTarget = document.querySelector("[data-compact-items]");
  const dashboardTarget = document.querySelector("[data-compact-dashboard]");
  const contextTarget = document.querySelector("[data-compact-context]");
  const allItems = latest.items || [];
  const compactLimit = Math.min(Math.max(site.maxCompactItems || 6, 6), 8);
  const items = rankedTrendItems(allItems).slice(0, compactLimit);
  const evergreen = evergreenItems(allItems);
  const growing = sortBy(allItems.filter(isMovingTopic), movingTopicScore);
  const activeLinks = links.filter((link) => link.active).sort((a, b) => b.priority - a.priority);
  const context = latest.context || {};
  contextTarget.replaceChildren(compactHeaderContext(context, activeLinks));
  dashboardTarget.replaceChildren(compactSpotlight(items[0]));
  if (!items.length) {
    renderEmpty(itemsTarget, "まだ表示できるトレンドがありません。GitHub Actionsの初回取得後に反映されます。");
  } else {
    itemsTarget.replaceChildren(...items.slice(1, 5).map(compactTrendChip));
  }

  const linksTarget = document.querySelector("[data-compact-links]");
  linksTarget.replaceChildren(compactInfoTray({ evergreen, growing }));
  const shell = document.querySelector(".compact-shell");
  if (shell && !shell.querySelector(".x-iframe-converter-section")) shell.append(xIframeConverterToolSection());

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

const accordionSection = (title, items, options = {}) => {
  const wrap = create("section", "section accordion-section");
  if (options.className) wrap.classList.add(options.className);
  const head = create("div", "section-head");
  head.append(create("h2", "", title));
  head.append(create("span", "section-count", options.totalLabel || `${items.length}件`));
  const details = create("details", "accordion");
  const summary = create("summary", "", items.length ? `${items.length}件を簡易表示` : "該当する観測ワードはまだありません");
  const list = create("div", "simple-trend-list");
  if (items.length) list.replaceChildren(...items.slice(0, options.maxItems || items.length).map(simpleTrendRow));
  else renderEmpty(list, "該当する観測ワードはまだありません。");
  details.append(summary, list);
  wrap.append(head, details);
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
  const growing = sortBy(items.filter(isMovingTopic), movingTopicScore).slice(0, 20);
  const eventItems = calendarLocalEvents(latest.context || {}, 96);

  main.append(listOverview({ items, mainTrends, evergreen, growing, localObservations, context: latest.context || {} }));
  main.append(section("いまの注目ワード", mainTrends, { featured: true, className: "list-main-section", limit: 4, maxItems: 20, expandable: true, totalLabel: `${mainTrends.length}件観測` }));
  main.append(accordionSection("投稿アイデアの種", evergreen, { className: "list-evergreen-section", maxItems: 20, totalLabel: `${evergreen.length}件観測` }));
  if (eventItems.length) {
    main.append(localEventCalendar(eventItems));
  }

  appendIfAny(
    main,
    "反応が見える話題",
    growing,
    { compact: true, limit: 4, maxItems: 20, expandable: true, totalLabel: "最大20件" }
  );

  const categoryPool = items.filter((item) => (isActualTopic(item) || isMajorTopic(item)) && !isSentenceLikeKeyword(item));
  const categoryDefs = [
    ["エンタメ・カルチャー", "entertainment"],
    ["スポーツ", "sports"],
    ["テクノロジー", "technology"],
    ["季節・イベント", "seasonal"],
    ["ビジネス・生活", "business"],
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
  main.append(xIframeConverterToolSection());

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
