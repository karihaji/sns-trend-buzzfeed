import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const DATA_DIR = path.join(ROOT, "data");
const DEFAULT_SOURCE = "D:\\kagoshima-event-collector\\output\\sheets_rows.preview.json";
const DEFAULT_OUTPUT = path.join(DATA_DIR, "local-event-rows.json");

const CONTEXT_CATEGORIES = new Set([
  "商業施設催事",
  "百貨店催事",
  "展示",
  "展示・展覧会",
  "展覧会",
  "コンサート",
  "ライブ",
  "公演",
  "舞台",
  "演劇",
  "ホテル催事",
  "祭り",
  "祭り・地域行事",
  "鹿児島市イベント",
  "観光",
  "スポーツ"
]);

const BLOCK_CATEGORIES = new Set(["学会", "学会・会議", "会議"]);
const CONTEXT_CATEGORY_PATTERN = /商業|百貨店|催事|展示|展覧|コンサート|ライブ|公演|舞台|演劇|祭り|フェス|マルシェ|ホテル|観光|スポーツ/u;
const BLOCK_CATEGORY_PATTERN = /学会|会議|セミナー|研究会/u;
const BLOCK_TITLE_PATTERN = /学会|会議|セミナー|研究会|研修|説明会|相談|講座/u;

const idFor = (value) => crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
const dateOnly = (value) => String(value || "").slice(0, 10);
const isPublicUrl = (value) => /^https?:\/\//i.test(value || "") && !/example\.local/i.test(value || "");
const normalize = (value) => String(value || "").normalize("NFKC").trim();

const jstToday = () => {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const daysUntil = (date, today) => {
  const target = Date.parse(`${date}T00:00:00+09:00`);
  const base = Date.parse(`${today}T00:00:00+09:00`);
  if (Number.isNaN(target) || Number.isNaN(base)) return null;
  return Math.round((target - base) / (24 * 60 * 60 * 1000));
};

const compactKey = (event) =>
  `${event.startDate}:${normalize(event.title)
    .toLowerCase()
    .replace(/dr[:：].*$/iu, "")
    .replace(/^【\d{4}年最新版】/u, "")
    .replace(/第\d+回/u, "")
    .replace(/[：:｜\s]+/g, "")
    .replace(/^(.{2,10})\1/u, "$1")
    .slice(0, 28)}`;

const cleanTitle = (title = "") =>
  normalize(title)
    .replace(/^【\d{4}年最新版】/u, "")
    .replace(/^(.{2,16})\s+\1/u, "$1")
    .replace(/^(.{2,16})\1/u, "$1")
    .replace(/(.{4,32})\s+\1[:：]?$/u, "$1")
    .replace(/\s+/g, " ")
    .trim();

const isContextCategory = (category = "") =>
  !BLOCK_CATEGORIES.has(category) &&
  !BLOCK_CATEGORY_PATTERN.test(category) &&
  (CONTEXT_CATEGORIES.has(category) || CONTEXT_CATEGORY_PATTERN.test(category));

const keepRow = (row, today) => {
  const category = row.category;
  const rank = row.rank || row.crowd_rank;
  const sourceName = row.sourceName || row.source_name;
  const sourceUrl = row.sourceUrl || row.source_url;
  const startDate = row.startDate || row.start_date;
  if (!row || row.status === "excluded" || rank === "excluded") return false;
  if (sourceName === "manual-poc") return false;
  if (!row.title || !startDate) return false;
  if (!isPublicUrl(sourceUrl)) return false;
  if (BLOCK_TITLE_PATTERN.test(row.title)) return false;
  const distance = daysUntil(dateOnly(startDate), today);
  if (distance == null || distance < -1 || distance > 120) return false;
  return isContextCategory(category);
};

const sanitizeRow = (row) => {
  const startDate = dateOnly(row.startDate || row.start_date);
  const venue = normalize(row.venue || row.venue_name || row.normalized_venue);
  const sourceUrl = row.sourceUrl || row.source_url;
  return {
    id: idFor(`${row.title}|${startDate}|${venue}|${sourceUrl}`),
    title: cleanTitle(row.title),
    category: normalize(row.category || "イベント"),
    rank: normalize(row.rank || row.crowd_rank || "C"),
    venue,
    startDate,
    endDate: dateOnly(row.endDate || row.end_date) || startDate,
    sourceUrl,
    sourceName: normalize(row.sourceName || row.source_name)
  };
};

const main = async () => {
  const source = process.env.KAGOSHIMA_EVENT_ROWS || DEFAULT_SOURCE;
  const output = process.env.SNS_LOCAL_EVENT_ROWS_OUTPUT || DEFAULT_OUTPUT;
  const rows = JSON.parse(await readFile(source, "utf8"));
  const seen = new Map();
  const today = process.env.SNS_LOCAL_EVENT_TODAY || jstToday();

  for (const row of rows) {
    if (!keepRow(row, today)) continue;
    const event = sanitizeRow(row);
    if (!event.title || !event.startDate) continue;
    const key = compactKey(event);
    if (!seen.has(key)) seen.set(key, event);
  }

  const events = [...seen.values()].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, "ja"));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(events, null, 2)}\n`, "utf8");
  console.log(`Saved ${events.length} sanitized local events to ${output}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
