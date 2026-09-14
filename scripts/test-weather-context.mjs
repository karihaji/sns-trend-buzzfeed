import assert from "node:assert/strict";
import { fetchWeatherContext, validateWeatherCompleteness } from "./fetch-trends.mjs";

const locations = [
  { id: "kagoshima", label: "鹿児島", latitude: 31.5966, longitude: 130.5571 },
  { id: "yakushima", label: "屋久島", latitude: 30.3711, longitude: 130.666 },
  { id: "amami", label: "奄美", latitude: 28.3772, longitude: 129.4937 },
  { id: "tanegashima", label: "種子島", latitude: 30.7324, longitude: 130.997 }
];

const weatherResponse = () => ({
  ok: true,
  status: 200,
  statusText: "OK",
  json: async () => ({
    current: { temperature_2m: 28, weather_code: 1, wind_speed_10m: 7 },
    daily: {
      weather_code: [1],
      temperature_2m_max: [30],
      temperature_2m_min: [25],
      precipitation_probability_max: [40]
    }
  })
});

const isTanegashima = (url) => new URL(url).searchParams.get("latitude") === "30.7324";

const fresh = await fetchWeatherContext(locations, [], { fetchImpl: async () => weatherResponse(), retryDelayMs: 0 });
assert.deepEqual(fresh.map((item) => item.id), locations.map((item) => item.id));
assert.ok(fresh.every((item) => item.status === "fresh"));

let retryCount = 0;
const retried = await fetchWeatherContext(locations, [], {
  fetchImpl: async (url) => {
    if (isTanegashima(url) && ++retryCount < 3) throw new Error("temporary failure");
    return weatherResponse();
  },
  retryDelayMs: 0
});
assert.equal(retryCount, 3);
assert.equal(retried.find((item) => item.id === "tanegashima")?.status, "fresh");

const previousTanegashima = {
  id: "tanegashima",
  label: "種子島",
  temperature: 27,
  high: 29,
  low: 24,
  precipitation: 80,
  wind: 8,
  weatherCode: 61,
  summary: "雨",
  status: "fresh"
};
const stale = await fetchWeatherContext(locations, [previousTanegashima], {
  fetchImpl: async (url) => {
    if (isTanegashima(url)) throw new Error("HTTP 503 Service Unavailable");
    return weatherResponse();
  },
  retryDelayMs: 0
});
assert.equal(stale.length, 4);
assert.deepEqual(stale.find((item) => item.id === "tanegashima"), { ...previousTanegashima, status: "stale" });
assert.ok(stale.filter((item) => item.id !== "tanegashima").every((item) => item.status === "fresh"));

const missing = await fetchWeatherContext(locations, [], {
  fetchImpl: async (url) => {
    if (isTanegashima(url)) throw new Error("timeout");
    return weatherResponse();
  },
  retryDelayMs: 0
});
const missingTanegashima = missing.find((item) => item.id === "tanegashima");
assert.equal(missing.length, 4);
assert.equal(missingTanegashima?.status, "missing");
assert.equal(missingTanegashima?.temperature, null);
assert.ok(missing.filter((item) => item.id !== "tanegashima").every((item) => item.status === "fresh"));

assert.throws(
  () => validateWeatherCompleteness(locations, missing.filter((item) => item.id !== "tanegashima")),
  /Weather locations are incomplete/
);

console.log("Weather context tests passed.");
