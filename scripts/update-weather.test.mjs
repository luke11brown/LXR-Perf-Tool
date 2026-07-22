import assert from "node:assert/strict";
import test from "node:test";

import { mergeWeather, reportsByStation, stationIdsFromRunways } from "./update-weather.mjs";

test("stationIdsFromRunways resolves proxies and removes duplicates", () => {
  assert.deepEqual(stationIdsFromRunways([
    { id: "LGKM_13", metarStation: "LGKV" },
    { id: "LGKV_05" },
    { id: "LGAL_07" },
  ]), ["LGAL", "LGKV"]);
});

test("reportsByStation extracts AviationWeather raw products", () => {
  assert.deepEqual(reportsByStation([
    { icaoId: "LGKV", rawOb: "LGKV 221020Z 00000KT CAVOK 28/14 Q1013" },
  ], "metar", "2026-07-22T10:30:00.000Z"), {
    LGKV: {
      raw: "LGKV 221020Z 00000KT CAVOK 28/14 Q1013",
      fetchedAt: "2026-07-22T10:30:00.000Z",
    },
  });
});

test("mergeWeather preserves an available report when another product times out", () => {
  const previous = {
    stations: {
      LGKV: { taf: { raw: "TAF LGKV 220500Z 2206/2306 CAVOK=", fetchedAt: "old" } },
    },
  };
  const merged = mergeWeather(previous, {
    metar: { LGKV: { raw: "LGKV 221020Z 00000KT CAVOK 28/14 Q1013", fetchedAt: "new" } },
  });
  assert.equal(merged.stations.LGKV.taf.fetchedAt, "old");
  assert.equal(merged.stations.LGKV.metar.fetchedAt, "new");
});
