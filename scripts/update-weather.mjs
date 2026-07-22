#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runwayPath = resolve(root, "data/runways.json");
const weatherPath = resolve(root, "data/weather.json");
const API_BASE = "https://aviationweather.gov/api/data";
const FETCH_TIMEOUT_MS = 20_000;

export function stationIdsFromRunways(runways) {
  return [...new Set(runways.map(runway =>
    String(runway.metarStation || runway.icao || runway.id?.split("_")[0] || "")
      .trim()
      .toUpperCase()
  ).filter(station => /^[A-Z0-9]{4}$/.test(station)))].sort();
}

function stationId(report) {
  return String(report?.icaoId || report?.stationId || report?.station_id || report?.station || "")
    .trim()
    .toUpperCase();
}

function rawReport(report, product) {
  const keys = product === "taf"
    ? ["rawTAF", "rawTaf", "raw_text", "rawText", "raw"]
    : ["rawOb", "rawMETAR", "rawMetar", "raw_text", "rawText", "raw"];
  for (const key of keys) {
    if (typeof report?.[key] === "string" && report[key].trim()) return report[key].trim();
  }
  return "";
}

export function reportsByStation(reports, product, fetchedAt) {
  const result = {};
  const reportTimes = {};
  for (const report of Array.isArray(reports) ? reports : []) {
    const station = stationId(report);
    const raw = rawReport(report, product);
    if (!station || !raw) continue;
    const match = raw.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
    const reference = new Date(fetchedAt);
    const reportTime = match
      ? [-1, 0, 1]
        .map(monthOffset => Date.UTC(
          reference.getUTCFullYear(),
          reference.getUTCMonth() + monthOffset,
          Number(match[1]),
          Number(match[2]),
          Number(match[3])
        ))
        .reduce((nearest, candidate) =>
          Math.abs(candidate - reference.getTime()) < Math.abs(nearest - reference.getTime()) ? candidate : nearest
        )
      : 0;
    if (!(station in result) || reportTime >= reportTimes[station]) {
      result[station] = { raw, fetchedAt };
      reportTimes[station] = reportTime;
    }
  }
  return result;
}

export function productUrl(product, stations) {
  const params = new URLSearchParams({ ids: stations.join(","), format: "json" });
  if (product === "metar") params.set("hours", "0");
  return `${API_BASE}/${product}?${params}`;
}

async function fetchProduct(product, stations) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(productUrl(product, stations), {
      headers: {
        Accept: "application/json",
        "User-Agent": "LXR-Perf-Tool GitHub Actions weather cache",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${product.toUpperCase()} API returned ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function readPreviousWeather() {
  try {
    return JSON.parse(await readFile(weatherPath, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return { generatedAt: null, stations: {} };
    throw err;
  }
}

export function mergeWeather(previous, updates) {
  const stations = structuredClone(previous?.stations || {});
  for (const [product, reports] of Object.entries(updates)) {
    for (const [station, report] of Object.entries(reports)) {
      stations[station] = { ...(stations[station] || {}), [product]: report };
    }
  }
  return { generatedAt: new Date().toISOString(), stations };
}

async function main() {
  const runways = JSON.parse(await readFile(runwayPath, "utf8"));
  const stations = stationIdsFromRunways(runways);
  const previous = await readPreviousWeather();
  const fetchedAt = new Date().toISOString();
  const updates = {};

  const results = await Promise.allSettled([
    fetchProduct("metar", stations),
    fetchProduct("taf", stations),
  ]);
  for (const [index, result] of results.entries()) {
    const product = index === 0 ? "metar" : "taf";
    if (result.status === "fulfilled") {
      updates[product] = reportsByStation(result.value, product, fetchedAt);
      console.info(`${product.toUpperCase()}: received ${Object.keys(updates[product]).length}/${stations.length} stations`);
    } else {
      console.warn(`${product.toUpperCase()}: ${result.reason?.message || result.reason}`);
    }
  }

  const received = Object.values(updates).reduce((count, reports) => count + Object.keys(reports).length, 0);
  if (received === 0) throw new Error("No weather reports were received; preserving the existing snapshot");
  await writeFile(weatherPath, `${JSON.stringify(mergeWeather(previous, updates), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
