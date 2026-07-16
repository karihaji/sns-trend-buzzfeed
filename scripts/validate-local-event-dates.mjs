import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const dateOnly = (value) => String(value?.date || value || "").slice(0, 10);

const previousIsoDate = (value) => {
  const date = dateOnly(value);
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
};

const payload = await readJson(path.join(ROOT, "data", "local-events.json"));
const latest = await readJson(path.join(ROOT, "data", "latest-trends.json"));
const expectedEndById = new Map(
  payload
    .filter((event) => event?.start?.date && event?.end?.date)
    .map((event) => [event.extendedProperties?.private?.event_hash, previousIsoDate(event.end.date)])
    .filter(([id]) => id)
);
const mismatches = (latest.context?.localEvents || []).flatMap((event) => {
  const expectedEnd = expectedEndById.get(event.id);
  return expectedEnd && event.endDate !== expectedEnd
    ? [`${event.title}: expected ${expectedEnd}, received ${event.endDate}`]
    : [];
});

if (mismatches.length) {
  throw new Error(`Calendar all-day end-date validation failed:\n${mismatches.join("\n")}`);
}

console.log(`Validated ${expectedEndById.size} all-day calendar events against latest context.`);
