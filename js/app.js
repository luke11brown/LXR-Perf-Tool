    let REG_DATA = {};
    let ALT_GRID_TOLD = [];
    let TEMP_DEV_GRID = [];
    let TO_TABLE = {};
    let LDG_TABLE = {};
    let GRASS_FACTORS = {};
    let ALT_GRID_ROC = [];
    let ROC_TABLE = {};
    let WIND_FACTORS = {};
    let CG_POLY = [];
    let MAX_XWIND = 0;
    let MAX_WIND = 0;
    let MAX_RECOMMENDED_TAILWIND = 0;
    let WIND_FACTOR_LIMIT_HEAD = 0;
    let WIND_FACTOR_LIMIT_TAIL = 0;
    let CG_MIN_MASS = 0;
    let MAX_MASS = 0;
    let MAX_FUEL_KG = 0;
    let MAX_FUEL_L = 0;
    let MAX_BAG_KG = 0;
    let CG_MIN = 0;
    let CG_MAX = 0;

    async function loadJson(path, label) {
      const jsonUrl = new URL(path, window.location.href).href;
      console.info(`Loading ${label} from`, jsonUrl);
      const response = await fetch(jsonUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`${label} fetch failed: ${response.status}`);
      return response.json();
    }

    async function loadAircraftData() {
      REG_DATA = await loadJson("./data/aircraft.json", "aircraft data");
    }

    async function loadPerformanceData() {
      const data = await loadJson("./data/performance.json", "performance data");
      const limits = data.limits || {};
      const windFactorLimits = data.windFactorLimits || {};

      ALT_GRID_TOLD = data.altGridTold || [];
      TEMP_DEV_GRID = data.tempDevGrid || [];
      TO_TABLE = data.takeoffTable || {};
      LDG_TABLE = data.landingTable || {};
      GRASS_FACTORS = data.surfaceFactors || {};
      ALT_GRID_ROC = data.altGridRoc || [];
      ROC_TABLE = data.rocTable || {};
      WIND_FACTORS = data.windFactors || {};
      CG_POLY = data.cgEnvelope || [];
      WIND_FACTOR_LIMIT_HEAD = windFactorLimits.head || 0;
      WIND_FACTOR_LIMIT_TAIL = windFactorLimits.tail || 0;
      MAX_XWIND = limits.maxCrosswind || 0;
      MAX_WIND = limits.maxWind || 0;
      MAX_RECOMMENDED_TAILWIND = limits.maxRecommendedTailwind || 0;
      CG_MIN_MASS = limits.cgMinMass || 0;
      MAX_MASS = limits.maxMass || 0;
      MAX_FUEL_KG = limits.maxFuelKg || 0;
      MAX_FUEL_L = limits.maxFuelL || 0;
      MAX_BAG_KG = limits.maxBagKg || 0;
      CG_MIN = limits.cgMin || 0;
      CG_MAX = limits.cgMax || 0;
    }

    let PRESET_RUNWAYS = {};

    let activeRunwayLabel = null;
    let activeArrivalRunwayLabel = null;
    let arrivalUsesDepartureRunway = true;
    let depSurfaceBase = "hard";
    let arrSurfaceBase = "hard";
    let departureMetar = null;
    let arrivalMetar = null;
    const METAR_STALE_MINUTES = 90;
    const METAR_FETCH_TIMEOUT_MS = 12000;

    async function loadRunwayPresets() {
      try {
        const jsonUrl = new URL("./data/runways.json", window.location.href).href;
        console.info("Loading runway presets from", jsonUrl);
        const response = await fetch(jsonUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
        const presets = await response.json();
        PRESET_RUNWAYS = {};
        presets.forEach((item) => {
          if (item.id) PRESET_RUNWAYS[item.id] = item;
        });
      } catch (err) {
        PRESET_RUNWAYS = {};
        console.warn("Could not load runway presets:", err);
      }
    }

    function populateRunwaySelect(selectId, noneLabel = "None", extraOptions = []) {
      const select = document.getElementById(selectId);
      if (!select) return;
      const previousValue = select.value;
      select.innerHTML = `<option value="none">${noneLabel}</option>`;
      extraOptions.forEach(({ value, label }) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        select.appendChild(opt);
      });

      const presetIds = Object.keys(PRESET_RUNWAYS);
      if (presetIds.length > 0) {
        const presetGroup = document.createElement("optgroup");
        presetGroup.label = "Presets";
        presetIds.forEach((id) => {
          const item = PRESET_RUNWAYS[id];
          const opt = document.createElement("option");
          opt.value = id;
          opt.textContent = item.label || id;
          presetGroup.appendChild(opt);
        });
        select.appendChild(presetGroup);
      }

      if ([...select.options].some(opt => opt.value === previousValue)) select.value = previousValue;
    }

    function populatePresetRunwayOptions() {
      populateRunwaySelect("savedRunwaySelect", "Manual entry");
      populateRunwaySelect("arrivalRunwaySelect", "Use departure runway", [
        { value: "manual", label: "Manual entry" },
      ]);
    }

    function setFieldGroupDisabled(ids, disabled) {
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
      });
    }

    function splitSurfaceKey(surfaceKey) {
      const [base = "hard", condition = "dry"] = String(surfaceKey || "hard_dry").split("_");
      return { base, condition: condition === "wet" ? "wet" : "dry" };
    }

    function surfaceKeyFrom(base, condition) {
      const cleanBase = base === "grass" ? "grass" : "hard";
      const cleanCondition = condition === "wet" ? "wet" : "dry";
      return `${cleanBase}_${cleanCondition}`;
    }

    function applySurfacePreset(selectId, surfaceKey, isArrival = false) {
      const parsed = splitSurfaceKey(surfaceKey);
      if (isArrival) arrSurfaceBase = parsed.base;
      else depSurfaceBase = parsed.base;
      const select = document.getElementById(selectId);
      if (select) select.value = parsed.condition;
    }

    function currentSurfaceKey(selectId, isArrival = false) {
      return surfaceKeyFrom(isArrival ? arrSurfaceBase : depSurfaceBase, document.getElementById(selectId)?.value);
    }

    function updateRunwayEditState() {
      const depPresetSelected = document.getElementById("savedRunwaySelect")?.value !== "none";
      const arrivalRunwayValue = document.getElementById("arrivalRunwaySelect")?.value;
      const arrPresetSelected = arrivalRunwayValue !== "none" && arrivalRunwayValue !== "manual";

      setFieldGroupDisabled(["fieldElev", "runwayTora", "runwayToda", "runwayAsda", "runwayLda", "rwHeading"], depPresetSelected);
      setFieldGroupDisabled(["arrFieldElev", "arrLda", "arrHeading"], arrivalUsesDepartureRunway || arrPresetSelected);
    }

    function setRunwayFields(data, label) {
      if (!data) return;
      document.getElementById("fieldElev").value = data.elev ?? document.getElementById("fieldElev").value;
      document.getElementById("runwayTora").value = data.tora ?? document.getElementById("runwayTora").value;
      document.getElementById("runwayToda").value = data.toda ?? document.getElementById("runwayToda").value;
      document.getElementById("runwayAsda").value = data.asda ?? document.getElementById("runwayAsda").value;
      document.getElementById("runwayLda").value = data.lda ?? document.getElementById("runwayLda").value;
      document.getElementById("rwHeading").value = data.heading ?? document.getElementById("rwHeading").value;
      applySurfacePreset("surface", data.surface, false);
      activeRunwayLabel = label || data.label || "Custom runway";
      if (arrivalUsesDepartureRunway) copyDepartureToArrival();
      updateArrivalWeatherControls();
    }

    function copyDepartureToArrival() {
      if (!document.getElementById("arrFieldElev")) return;
      document.getElementById("arrFieldElev").value = document.getElementById("fieldElev").value;
      document.getElementById("arrLda").value = document.getElementById("runwayLda").value;
      document.getElementById("arrHeading").value = document.getElementById("rwHeading").value;
      arrSurfaceBase = depSurfaceBase;
      document.getElementById("arrSurface").value = document.getElementById("surface").value;
      activeArrivalRunwayLabel = activeRunwayLabel;
    }

    function copyDepartureWeatherToArrival() {
      if (!document.getElementById("arrQnh")) return;
      document.getElementById("arrQnh").value = document.getElementById("qnh").value;
      document.getElementById("arrOat").value = document.getElementById("oat").value;
      document.getElementById("arrWindDir").value = document.getElementById("windDir").value;
      document.getElementById("arrWindSpd").value = document.getElementById("windSpd").value;
    }

    function updateArrivalWeatherControls() {
      const disabled = arrivalUsesDepartureRunway;
      ["arrQnh", "arrOat", "arrWindDir", "arrWindSpd"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = disabled;
        const field = el.closest(".field");
        if (field) field.classList.toggle("field-disabled", disabled);
      });
      if (disabled) copyDepartureWeatherToArrival();
    }

    function setArrivalRunwayFields(data, label) {
      if (!data) return;
      document.getElementById("arrFieldElev").value = data.elev ?? document.getElementById("arrFieldElev").value;
      document.getElementById("arrLda").value = data.lda ?? data.tora ?? document.getElementById("arrLda").value;
      document.getElementById("arrHeading").value = data.heading ?? document.getElementById("arrHeading").value;
      applySurfacePreset("arrSurface", data.surface, true);
      activeArrivalRunwayLabel = label || data.label || "Custom arrival runway";
      arrivalUsesDepartureRunway = false;
      updateArrivalWeatherControls();
    }

    function formatRunwayLabel() {
      return activeRunwayLabel || "Custom departure runway";
    }

    function formatArrivalRunwayLabel() {
      return activeArrivalRunwayLabel || (arrivalUsesDepartureRunway ? formatRunwayLabel() : "Custom arrival runway");
    }

    function getSelectedRunway(selectId) {
      const select = document.getElementById(selectId);
      if (!select || select.value === "none" || select.value === "manual") return null;

      const preset = PRESET_RUNWAYS[select.value];
      if (preset) return preset;
      return null;
    }

    function getMetarStationFromRunway(runway) {
      const source = runway?.metarStation || runway?.icao || runway?.id || runway?.label || "";
      const match = String(source).toUpperCase().match(/\b[A-Z]{4}\b|^[A-Z]{4}/);
      return match ? match[0] : "";
    }

    function getRunwayIcao(runway) {
      const source = runway?.icao || runway?.id || runway?.label || "";
      const match = String(source).toUpperCase().match(/\b[A-Z]{4}\b|^[A-Z]{4}/);
      return match ? match[0] : "";
    }

    function decodeMetarTemperature(value) {
      if (!value || value === "//") return null;
      return Number(value.startsWith("M") ? `-${value.slice(1)}` : value);
    }

    function parseMetarTimestamp(line) {
      const match = String(line || "").match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
      if (!match) return null;
      const [, year, month, day, hour, minute] = match;
      return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
    }

    function getMetarAgeMinutes(observedAt) {
      if (!(observedAt instanceof Date) || Number.isNaN(observedAt.getTime())) return null;
      return Math.max(0, Math.round((Date.now() - observedAt.getTime()) / 60000));
    }

    function formatMetarAge(ageMinutes) {
      if (ageMinutes === null) return "age unknown";
      if (ageMinutes < 60) return `${ageMinutes} min old`;
      const hours = Math.floor(ageMinutes / 60);
      const minutes = ageMinutes % 60;
      return `${hours}h ${minutes}m old`;
    }

    function parseMetar(rawMetar, observedLine = "") {
      const metar = String(rawMetar || "").trim().replace(/\s+/g, " ");
      const wind = metar.match(/\b(VRB|\d{3})(\d{2,3})(?:G\d{2,3})?(KT|MPS)\b/);
      const temp = metar.match(/\b(M?\d{2})\/(?:M?\d{2}|\/\/)\b/);
      const qnh = metar.match(/\bQ(\d{4})\b/);
      const altimeter = metar.match(/\bA(\d{4})\b/);
      const cavok = /\bCAVOK\b/.test(metar);
      const vis = cavok
        ? 10000
        : (() => {
          const metricVis = metar.match(/\b(\d{4})(?:[NSEW]{1,2})?\b/);
          const statuteVis = metar.match(/\b(\d+(?:\/\d+)?|\d+\s+\d\/\d)SM\b/);
          if (metricVis) return Number(metricVis[1]);
          if (!statuteVis) return null;
          const raw = statuteVis[1].replace(/\s+/g, " ");
          const parts = raw.split(" ");
          const miles = parts.reduce((sum, part) => {
            if (part.includes("/")) {
              const [num, den] = part.split("/").map(Number);
              return sum + (den ? num / den : 0);
            }
            return sum + Number(part);
          }, 0);
          return Math.round(miles * 1609.344);
        })();
      const cloudLayers = [];
      const cloudRegex = /\b(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/)(?:CB|TCU)?\b/g;
      for (let match; (match = cloudRegex.exec(metar));) {
        const amount = match[1];
        const heightFt = match[2] === "//" ? null : Number(match[2]) * 100;
        cloudLayers.push({ amount, heightFt });
      }
      const ceilingLayer = cloudLayers.find(layer => ["BKN", "OVC", "VV"].includes(layer.amount) && layer.heightFt !== null);
      const cloudCeilingFt = cavok ? 5000 : (ceilingLayer?.heightFt ?? null);

      const speedUnit = wind?.[3];
      const rawSpeed = wind ? Number(wind[2]) : null;
      const windSpeed = rawSpeed === null ? null : speedUnit === "MPS" ? Math.round(rawSpeed * 1.94384) : rawSpeed;
      const qnhValue = qnh
        ? Number(qnh[1])
        : altimeter
          ? Math.round((Number(altimeter[1]) / 100) * 33.8639)
          : null;

      return {
        raw: metar,
        observedAt: parseMetarTimestamp(observedLine),
        windDir: wind ? wind[1] : null,
        windSpeed,
        visibilityM: vis,
        cloudCeilingFt,
        cloudLayers,
        cavok,
        oat: temp ? decodeMetarTemperature(temp[1]) : null,
        qnh: qnhValue,
      };
    }

    async function fetchWithTimeout(url) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), METAR_FETCH_TIMEOUT_MS);
      try {
        return await fetch(url, { cache: "no-store", signal: controller.signal });
      } finally {
        window.clearTimeout(timeout);
      }
    }

    async function fetchMetarForStation(station) {
      const noaaUrl = `https://tgftp.nws.noaa.gov/data/observations/metar/stations/${encodeURIComponent(station)}.TXT`;
      const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(noaaUrl)}`;
      let response;
      try {
        response = await fetchWithTimeout(proxyUrl);
      } catch (err) {
        response = await fetchWithTimeout(noaaUrl);
      }
      if (!response.ok) throw new Error(`NOAA returned ${response.status}`);

      const text = await response.text();
      const lines = text.trim().split(/\r?\n/).filter(Boolean);
      const rawMetar = lines[lines.length - 1] || "";
      if (!rawMetar.includes(station)) throw new Error("No recent METAR found for station");
      return parseMetar(rawMetar, lines[0]);
    }

    function applyMetarToFields(metar, target) {
      const ids = target === "arrival"
        ? { qnh: "arrQnh", oat: "arrOat", windDir: "arrWindDir", windSpd: "arrWindSpd" }
        : { qnh: "qnh", oat: "oat", windDir: "windDir", windSpd: "windSpd" };

      if (metar.qnh !== null) document.getElementById(ids.qnh).value = metar.qnh;
      if (metar.oat !== null) document.getElementById(ids.oat).value = metar.oat;
      if (metar.windDir) document.getElementById(ids.windDir).value = metar.windDir;
      if (metar.windSpeed !== null) document.getElementById(ids.windSpd).value = metar.windSpeed;
    }

    async function fetchAndApplyMetar(target) {
      const isArrival = target === "arrival";
      const status = document.getElementById(isArrival ? "arrivalMetarStatus" : "metarStatus");
      const button = document.getElementById(isArrival ? "fetchArrivalMetarBtn" : "fetchMetarBtn");
      const runway = isArrival ? getSelectedRunway("arrivalRunwaySelect") : getSelectedRunway("savedRunwaySelect");
      const station = getMetarStationFromRunway(runway);
      const runwayIcao = getRunwayIcao(runway);
      const stationLabel = runwayIcao && runwayIcao !== station ? `${station} for ${runwayIcao}` : station;

      if (!station) {
        status.textContent = isArrival
          ? "Select an arrival runway preset with an ICAO station first."
          : "Select a runway preset with an ICAO station first.";
        return;
      }

      if (isArrival) {
        arrivalUsesDepartureRunway = false;
        updateArrivalWeatherControls();
      }

      button.disabled = true;
      status.textContent = `Fetching ${stationLabel} METAR from NOAA...`;
      try {
      const metar = await fetchMetarForStation(station);
        if (isArrival) arrivalMetar = metar;
        else departureMetar = metar;
        applyMetarToFields(metar, target);
        if (!isArrival && arrivalUsesDepartureRunway) copyDepartureWeatherToArrival();
        calculateAll();
        const ageMinutes = getMetarAgeMinutes(metar.observedAt);
        const staleText = ageMinutes !== null && ageMinutes > METAR_STALE_MINUTES ? " STALE - verify before use." : "";
        status.textContent = `${stationLabel} METAR applied (${formatMetarAge(ageMinutes)}).${staleText} ${metar.raw}`;
      } catch (err) {
        status.textContent = `Could not fetch ${stationLabel} METAR: ${err.message}`;
      } finally {
        button.disabled = false;
      }
    }

    function clamp(x, min, max) { return Math.max(min, Math.min(max, x)); }

    function lerp(x, x0, x1, y0, y1) {
      if (x1 === x0) return y0;
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }

    function interpPoints(x, points) {
      if (!points || points.length === 0) return 1;
      if (x <= points[0][0]) return points[0][1];
      for (let i = 0; i < points.length - 1; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[i + 1];
        if (x >= x0 && x <= x1) return lerp(x, x0, x1, y0, y1);
      }
      return points[points.length - 1][1];
    }

    function windCorrectionFactor(metric, headwindComponent) {
      const cfg = WIND_FACTORS[metric];
      if (!cfg) return 1;
      if (headwindComponent >= 0) {
        return interpPoints(clamp(headwindComponent, 0, WIND_FACTOR_LIMIT_HEAD), cfg.head);
      }
      return interpPoints(clamp(-headwindComponent, 0, WIND_FACTOR_LIMIT_TAIL), cfg.tail);
    }

    function accountableWindComponent(headwindComponent) {
      return headwindComponent >= 0 ? headwindComponent * 0.5 : headwindComponent * 1.5;
    }

    function formatAccountableWind(headwindComponent) {
      const absComponent = Math.abs(headwindComponent);
      return headwindComponent >= 0
        ? `accountable HWC ${round(absComponent, 1)} kt (50% reported HWC)`
        : `accountable TWC ${round(absComponent, 1)} kt (150% reported TWC)`;
    }

    function formatVisibilityKm(visibilityM) {
      if (visibilityM === null || visibilityM === undefined) return "unknown";
      return visibilityM >= 9999 ? "10 km or more" : `${round(visibilityM / 1000, 1)} km`;
    }

    function assessWeatherMinima({ metar, windSpd, crosswind }) {
      const flightRules = document.getElementById("flightRules")?.value || "vfr";
      const pilotQualification = document.getElementById("pilotQualification")?.value || "student";
      const vfrPhase = document.getElementById("vfrPhase")?.value || "circuit";
      const ifrAircraftClass = document.getElementById("ifrAircraftClass")?.value || "sep";
      const statusEl = document.getElementById("weatherMinimaStatus");
      const detailEl = document.getElementById("weatherMinimaDetail");

      if (!statusEl || !detailEl) return { ok: true, text: "Weather minima not displayed." };
      if (!metar) {
        const text = "Weather minima not assessed - fetch a departure METAR first.";
        statusEl.textContent = text;
        statusEl.className = "res-main summary-line-bad";
        detailEl.textContent = "Visibility and cloud ceiling are parsed from the fetched METAR. Manual weather-minima entry is not currently available.";
        return { ok: false, assessed: false, text };
      }

      const visibilityKm = metar.visibilityM === null || metar.visibilityM === undefined ? null : metar.visibilityM / 1000;
      const ceilingFt = metar.cloudCeilingFt;
      const xwindKt = Math.abs(crosswind);
      const checks = [];
      let ok = true;

      function addCheck(label, actual, required, pass) {
        checks.push(`${label}: ${actual} ${pass ? "meets" : "below"} ${required}`);
        if (!pass) ok = false;
      }

      if (flightRules === "vfr") {
        const vfrMinima = {
          student: {
            circuit: { ceilingFt: 1500, visibilityKm: 5, xwindKt: 10, maxWindKt: 20 },
            solo_nav: { ceilingFt: 5000, visibilityKm: 8, xwindKt: 10, maxWindKt: 20, maxLowCloudAmount: "FEW" },
          },
          ppl_lt100: {
            circuit: { ceilingFt: 1500, visibilityKm: 5, xwindKt: 15, maxWindKt: 25 },
            solo_nav: { ceilingFt: 3000, visibilityKm: 8, xwindKt: 15, maxWindKt: 25 },
          },
          ppl_gt100_no_ir: {
            circuit: { ceilingFt: 1500, visibilityKm: 5, xwindKt: MAX_XWIND, maxWindKt: 30 },
            solo_nav: { ceilingFt: 2500, visibilityKm: 5, xwindKt: MAX_XWIND, maxWindKt: 30 },
          },
        };
        const vfrQualification = vfrMinima[pilotQualification]
          ? pilotQualification
          : (pilotQualification.startsWith("ir_") ? "ppl_gt100_no_ir" : "student");
        const mins = vfrMinima[vfrQualification][vfrPhase];
        const ceilingPass = ceilingFt !== null && ceilingFt >= mins.ceilingFt;
        const visPass = visibilityKm !== null && visibilityKm >= mins.visibilityKm;
        const xwindPass = xwindKt <= mins.xwindKt;
        const windPass = windSpd <= mins.maxWindKt;
        addCheck("Ceiling", ceilingFt === null ? "unknown" : `${round(ceilingFt, 0)} ft`, `${mins.ceilingFt} ft`, ceilingPass);
        addCheck("Visibility", formatVisibilityKm(metar.visibilityM), `${mins.visibilityKm} km`, visPass);
        addCheck("XWC", `${round(xwindKt, 1)} kt`, `${mins.xwindKt} kt`, xwindPass);
        addCheck("Surface wind", `${round(windSpd, 1)} kt`, `${mins.maxWindKt} kt`, windPass);
        if (mins.maxLowCloudAmount) {
          const excessiveLowLayer = (metar.cloudLayers || []).some(layer =>
            layer.heightFt !== null && layer.heightFt < mins.ceilingFt && ["SCT", "BKN", "OVC", "VV"].includes(layer.amount)
          );
          checks.push(excessiveLowLayer
            ? `Cloud layer: more than FEW below ${mins.ceilingFt} ft`
            : `Cloud layer: no more than FEW below ${mins.ceilingFt} ft`);
          if (excessiveLowLayer) ok = false;
        }
        const phaseLabel = vfrPhase === "circuit" ? "circuit" : "solo navigation";
        statusEl.textContent = `${ok ? "OK" : "CHECK"} - VFR ${phaseLabel} minima for selected pilot category.`;
      } else {
        const highIr = pilotQualification === "ir_high";
        const sep = ifrAircraftClass === "sep";
        const ceilingMin = highIr && sep ? 1000 : (!highIr ? 1500 : null);
        const visibilityMin = highIr && sep ? 3 : (!highIr ? 5 : null);
        if (ceilingMin !== null) {
          addCheck("Take-off ceiling", ceilingFt === null ? "unknown" : `${round(ceilingFt, 0)} ft`, `${ceilingMin} ft`, ceilingFt !== null && ceilingFt >= ceilingMin);
        } else {
          checks.push("Take-off ceiling: check published minima for MEP.");
        }
        if (visibilityMin !== null) {
          addCheck("Take-off visibility", formatVisibilityKm(metar.visibilityM), `${visibilityMin} km`, visibilityKm !== null && visibilityKm >= visibilityMin);
        } else {
          checks.push("Take-off visibility: check published minima for MEP.");
        }
        checks.push(highIr
          ? "Approach: verify published approach minima/RVR."
          : "Approach: verify published approach minima + 200 ft and published RVR + 500 m.");
        statusEl.textContent = `${ok ? "OK" : "CHECK"} - IFR take-off minima where assessable from METAR.`;
      }

      statusEl.className = ok ? "res-main summary-line-ok" : "res-main summary-line-bad";
      detailEl.textContent = checks.join(" | ");
      return { ok, assessed: true, text: `${statusEl.textContent} ${detailEl.textContent}` };
    }

    function round(x, decimals = 0) {
      const f = Math.pow(10, decimals);
      return Math.round(x * f) / f;
    }

    function pointInPoly(px, py, poly) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const intersect =
          yi > py !== yj > py &&
          px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-9) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    }

    function interpTOLD(pa, isaDev, table) {
      const paClamped = clamp(pa, ALT_GRID_TOLD[0], ALT_GRID_TOLD[ALT_GRID_TOLD.length - 1]);
      const devClamped = clamp(isaDev, TEMP_DEV_GRID[0], TEMP_DEV_GRID[TEMP_DEV_GRID.length - 1]);

      let tIdx0 = 0;
      for (let i = 0; i < TEMP_DEV_GRID.length - 1; i++) {
        if (devClamped >= TEMP_DEV_GRID[i] && devClamped <= TEMP_DEV_GRID[i + 1]) {
          tIdx0 = i;
          break;
        }
      }
      const tIdx1 = tIdx0 + 1;
      const t0 = TEMP_DEV_GRID[tIdx0];
      const t1 = TEMP_DEV_GRID[tIdx1];

      let aIdx0 = 0;
      for (let i = 0; i < ALT_GRID_TOLD.length - 1; i++) {
        if (paClamped >= ALT_GRID_TOLD[i] && paClamped <= ALT_GRID_TOLD[i + 1]) {
          aIdx0 = i;
          break;
        }
      }
      const aIdx1 = aIdx0 + 1;
      const a0 = ALT_GRID_TOLD[aIdx0];
      const a1 = ALT_GRID_TOLD[aIdx1];

      function valAt(alt, tempIdx) {
        const row = table[alt];
        const run = row[tempIdx * 2];
        const dist = row[tempIdx * 2 + 1];
        return { run, dist };
      }

      const v_a0_t0 = valAt(a0, tIdx0);
      const v_a0_t1 = valAt(a0, tIdx1);
      const v_a1_t0 = valAt(a1, tIdx0);
      const v_a1_t1 = valAt(a1, tIdx1);

      const run_a0 = lerp(devClamped, t0, t1, v_a0_t0.run, v_a0_t1.run);
      const dist_a0 = lerp(devClamped, t0, t1, v_a0_t0.dist, v_a0_t1.dist);
      const run_a1 = lerp(devClamped, t0, t1, v_a1_t0.run, v_a1_t1.run);
      const dist_a1 = lerp(devClamped, t0, t1, v_a1_t0.dist, v_a1_t1.dist);

      const run = lerp(paClamped, a0, a1, run_a0, run_a1);
      const dist = lerp(paClamped, a0, a1, dist_a0, dist_a1);
      return { run, dist };
    }

    function interpRoc(pa, isaDev) {
      const paClamped = clamp(pa, ALT_GRID_ROC[0], ALT_GRID_ROC[ALT_GRID_ROC.length - 1]);
      const devClamped = clamp(isaDev, TEMP_DEV_GRID[0], TEMP_DEV_GRID[TEMP_DEV_GRID.length - 1]);

      let tIdx0 = 0;
      for (let i = 0; i < TEMP_DEV_GRID.length - 1; i++) {
        if (devClamped >= TEMP_DEV_GRID[i] && devClamped <= TEMP_DEV_GRID[i + 1]) {
          tIdx0 = i;
          break;
        }
      }
      const tIdx1 = tIdx0 + 1;
      const t0 = TEMP_DEV_GRID[tIdx0];
      const t1 = TEMP_DEV_GRID[tIdx1];

      let aIdx0 = 0;
      for (let i = 0; i < ALT_GRID_ROC.length - 1; i++) {
        if (paClamped >= ALT_GRID_ROC[i] && paClamped <= ALT_GRID_ROC[i + 1]) {
          aIdx0 = i;
          break;
        }
      }
      const aIdx1 = aIdx0 + 1;
      const a0 = ALT_GRID_ROC[aIdx0];
      const a1 = ALT_GRID_ROC[aIdx1];

      function rocAt(alt, tempIdx) {
        const row = ROC_TABLE[alt];
        return row[tempIdx];
      }

      const v_a0_t0 = rocAt(a0, tIdx0);
      const v_a0_t1 = rocAt(a0, tIdx1);
      const v_a1_t0 = rocAt(a1, tIdx0);
      const v_a1_t1 = rocAt(a1, tIdx1);

      const roc_a0 = lerp(devClamped, t0, t1, v_a0_t0, v_a0_t1);
      const roc_a1 = lerp(devClamped, t0, t1, v_a1_t0, v_a1_t1);

      return lerp(paClamped, a0, a1, roc_a0, roc_a1);
    }

    let cgChart;
    let cgDepDataset, cgArrDataset, cgFuelLineDataset;

    function buildCGChart() {
      const ctx = document.getElementById("cgChart").getContext("2d");
      const polyPoints = [...CG_POLY, CG_POLY[0]].map(p => ({ x: p.x, y: p.y }));

      cgDepDataset = {
        type: "scatter",
        label: "Departure",
        data: [],
        pointRadius: 5,
        pointHoverRadius: 6,
      };

      cgArrDataset = {
        type: "scatter",
        label: "Arrival",
        data: [],
        pointRadius: 5,
        pointHoverRadius: 6,
      };

      cgFuelLineDataset = {
        type: "line",
        label: "Fuel burn",
        data: [],
        borderColor: "#facc15",
        borderDash: [6, 5],
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        tension: 0,
      };

      cgChart = new Chart(ctx, {
        type: "line",
        data: {
          datasets: [
            {
              label: "AFM envelope",
              data: polyPoints,
              tension: 0,
              borderColor: "#2563eb",
              backgroundColor: "rgba(37, 99, 235, 0.14)",
              borderWidth: 2,
              pointRadius: 0,
              fill: true,
            },
            cgFuelLineDataset,
            cgDepDataset,
            cgArrDataset,
          ],
        },
        options: {
          responsive: true,
          scales: {
            x: {
              type: "linear",
              title: { display: true, text: "CG position (mm from firewall)" },
              min: 710,
              max: 870,
            },
            y: {
              title: { display: true, text: "Mass (kg)" },
              min: 420,
              max: 650,
            },
          },
          plugins: { legend: { labels: { boxWidth: 10 } } },
          animation: false,
        },
      });
    }

    function setSummaryLine(id, text, ok) {
      const el = document.getElementById(id);
      el.textContent = text;
      el.classList.toggle("summary-line-ok", ok);
      el.classList.toggle("summary-line-bad", !ok);
    }

    function computeWindComponentsForHeading(windDirRaw, windSpd, runwayHeading) {
      const raw = String(windDirRaw || "").trim().toUpperCase();
      const windIsVRB = raw === "VRB";
      const parsedWindDir = parseFloat(raw);
      if (windIsVRB) {
        return { headwind: -windSpd, crosswind: 0, windIsVRB, parsedWindDir: NaN };
      }
      if (!Number.isFinite(parsedWindDir)) {
        return { headwind: 0, crosswind: 0, windIsVRB: false, parsedWindDir: NaN };
      }
      const angleRad = ((parsedWindDir - runwayHeading) * Math.PI) / 180;
      return {
        headwind: windSpd * Math.cos(angleRad),
        crosswind: windSpd * Math.sin(angleRad),
        windIsVRB: false,
        parsedWindDir,
      };
    }

    function calculateAll() {
      const emptyWeight = parseFloat(document.getElementById("emptyWeight").value) || 0;
      const emptyArm = parseFloat(document.getElementById("emptyArm").value) || 0;
      const upholsteryWt = parseFloat(document.getElementById("upholsteryWt").value) || 0;
      const upholsteryArm = parseFloat(document.getElementById("upholsteryArm").value) || emptyArm;
      const pilotWt = parseFloat(document.getElementById("pilotWt").value) || 0;
      const pilotArm = parseFloat(document.getElementById("pilotArm").value) || 0;
      const paxWt = parseFloat(document.getElementById("paxWt").value) || 0;
      const paxArm = parseFloat(document.getElementById("paxArm").value) || 0;
      const bagWt = parseFloat(document.getElementById("bagWt").value) || 0;
      const bagArm = 1580;
      const fuelL = parseFloat(document.getElementById("fuelL").value) || 0;
      const fuelDensity = parseFloat(document.getElementById("fuelType").value);

      const fuelKg = fuelL * fuelDensity;
      document.getElementById("fuelKg").value = round(fuelKg, 1);

      const fuelWarn = document.getElementById("fuelWarn");
      if (fuelKg > MAX_FUEL_KG || fuelL > MAX_FUEL_L) {
        fuelWarn.style.display = "block";
        fuelWarn.textContent = `Fuel exceeds AFM limit (${MAX_FUEL_KG} kg / ${MAX_FUEL_L} L) for selected fuel type.`;
      } else fuelWarn.style.display = "none";

      const bagWarn = document.getElementById("bagWarn");
      if (bagWt > MAX_BAG_KG) {
        bagWarn.style.display = "block";
        bagWarn.textContent = `Baggage exceeds AFM limit (${MAX_BAG_KG} kg).`;
      } else bagWarn.style.display = "none";

      function moment(mass, arm) { return mass * arm; }

      const mEmpty = emptyWeight;
      const mUpholstery = upholsteryWt;
      const mPilot = pilotWt;
      const mPax = paxWt;
      const mBag = bagWt;
      const mFuel = fuelKg;

      const momEmpty = moment(mEmpty, emptyArm);
      const momUpholstery = moment(mUpholstery, upholsteryArm);
      const momPilot = moment(mPilot, pilotArm);
      const momPax = moment(mPax, paxArm);
      const momBag = moment(mBag, bagArm);
      const momFuel = moment(mFuel, 774);

      const massTO = mEmpty + mUpholstery + mPilot + mPax + mBag + mFuel;
      const momTO = momEmpty + momUpholstery + momPilot + momPax + momBag + momFuel;
      const cgTO = momTO / (massTO || 1);

      const massLW = mEmpty + mUpholstery + mPilot + mPax + mBag;
      const momLW = momEmpty + momUpholstery + momPilot + momPax + momBag;
      const cgLW = momLW / (massLW || 1);

      document.getElementById("tow").textContent = round(massTO, 1);
      document.getElementById("cg").textContent = isFinite(cgTO) ? round(cgTO, 0) : "–";
      document.getElementById("lw").textContent = round(massLW, 1);
      document.getElementById("cgArr").textContent = isFinite(cgLW) ? round(cgLW, 0) : "–";

      const wbStatusPill = document.getElementById("wbStatusPill");

      const massOkTO = massTO <= MAX_MASS && massTO >= CG_MIN_MASS;
      const massOkLW = massLW <= MAX_MASS && massLW >= CG_MIN_MASS;
      const cgBasicTO = cgTO >= CG_MIN && cgTO <= CG_MAX;
      const cgBasicLW = cgLW >= CG_MIN && cgLW <= CG_MAX;

      const insidePolyTO = pointInPoly(cgTO, massTO, CG_POLY);
      const insidePolyLW = pointInPoly(cgLW, massLW, CG_POLY);

      const fuelOk = fuelKg <= MAX_FUEL_KG && fuelL <= MAX_FUEL_L;
      const bagOk = mBag <= MAX_BAG_KG;

      const wbOk =
        massOkTO && massOkLW &&
        cgBasicTO && cgBasicLW &&
        insidePolyTO && insidePolyLW &&
        fuelOk && bagOk;

      ["tow", "cg"].forEach(id => document.getElementById(id).classList.toggle("bad-value", !massOkTO || !cgBasicTO || !insidePolyTO));
      ["lw", "cgArr"].forEach(id => document.getElementById(id).classList.toggle("bad-value", !massOkLW || !cgBasicLW || !insidePolyLW));

      if (wbOk) {
        wbStatusPill.textContent = "All points inside AFM envelope and limits";
        wbStatusPill.classList.remove("bad");
        wbStatusPill.classList.add("ok");
      } else {
        wbStatusPill.textContent = "Check W&B – outside AFM limits";
        wbStatusPill.classList.remove("ok");
        wbStatusPill.classList.add("bad");
      }

      if (cgDepDataset && cgArrDataset && cgFuelLineDataset) {
        cgDepDataset.data = (isFinite(cgTO) && isFinite(massTO)) ? [{ x: cgTO, y: massTO }] : [];
        cgArrDataset.data = (isFinite(cgLW) && isFinite(massLW)) ? [{ x: cgLW, y: massLW }] : [];
        cgDepDataset.backgroundColor = (massOkTO && cgBasicTO && insidePolyTO) ? "#f97316" : "#ef4444";
        cgDepDataset.borderColor = "#ffffff";
        cgDepDataset.borderWidth = 2;
        cgArrDataset.backgroundColor = (massOkLW && cgBasicLW && insidePolyLW) ? "#a855f7" : "#ef4444";
        cgArrDataset.borderColor = "#ffffff";
        cgArrDataset.borderWidth = 2;
        cgFuelLineDataset.data =
          (isFinite(cgTO) && isFinite(massTO) && isFinite(cgLW) && isFinite(massLW))
            ? [{ x: cgTO, y: massTO }, { x: cgLW, y: massLW }]
            : [];
        cgChart.update();
      }

      const fieldElev = parseFloat(document.getElementById("fieldElev").value) || 0;
      const qnh = parseFloat(document.getElementById("qnh").value) || 1013.25;
      const oat = parseFloat(document.getElementById("oat").value) || 0;
      if (arrivalUsesDepartureRunway) copyDepartureToArrival();
      updateArrivalWeatherControls();
      if (arrivalUsesDepartureRunway) copyDepartureWeatherToArrival();
      const surface = currentSurfaceKey("surface", false);
      const surfaceCfg = GRASS_FACTORS[surface] || GRASS_FACTORS.hard_dry;
      const arrSurface = currentSurfaceKey("arrSurface", true);
      const arrSurfaceCfg = GRASS_FACTORS[arrSurface] || GRASS_FACTORS.hard_dry;
      const usingWet = !!arrSurfaceCfg.wetLanding;
      const runwayTora = parseFloat(document.getElementById("runwayTora").value) || 1;
      const runwayToda = parseFloat(document.getElementById("runwayToda").value) || 1;
      const runwayAsda = parseFloat(document.getElementById("runwayAsda").value) || 1;
      const runwayLda = parseFloat(document.getElementById("arrLda").value) || 1;
      const pa = fieldElev + (1013.25 - qnh) * 30;
      const isaTemp = 15 - 2 * (pa / 1000);
      const isaDev = oat - isaTemp;

      document.getElementById("pa").value = round(pa, 0);
      document.getElementById("isaDev").value = round(isaDev, 1);

      const arrFieldElev = parseFloat(document.getElementById("arrFieldElev").value) || fieldElev;
      const arrQnh = parseFloat(document.getElementById("arrQnh").value) || qnh;
      const arrOat = parseFloat(document.getElementById("arrOat").value) || oat;
      const arrPa = arrFieldElev + (1013.25 - arrQnh) * 30;
      const arrIsaTemp = 15 - 2 * (arrPa / 1000);
      const arrIsaDev = arrOat - arrIsaTemp;
      document.getElementById("arrPa").value = round(arrPa, 0);
      document.getElementById("arrIsaDev").value = round(arrIsaDev, 1);

      const rwHeading = parseFloat(document.getElementById("rwHeading").value) || 0;
      const arrHeading = parseFloat(document.getElementById("arrHeading").value) || rwHeading;
      const windDirRaw = String(document.getElementById("windDir").value || "").trim().toUpperCase();
      const parsedWindDir = parseFloat(windDirRaw);
      const windSpd = parseFloat(document.getElementById("windSpd").value) || 0;
      const depWind = computeWindComponentsForHeading(windDirRaw, windSpd, rwHeading);
      const windIsVRB = depWind.windIsVRB;
      const headwind = depWind.headwind;
      const crosswind = depWind.crosswind;
      const tailwind = headwind < 0 ? -headwind : 0;
      const performanceHeadwind = accountableWindComponent(headwind);
      const performanceTailwind = performanceHeadwind < 0 ? -performanceHeadwind : 0;

      const arrWindDirRaw = String(document.getElementById("arrWindDir").value || "").trim().toUpperCase();
      const arrWindSpd = parseFloat(document.getElementById("arrWindSpd").value) || 0;
      const arrWind = computeWindComponentsForHeading(arrWindDirRaw, arrWindSpd, arrHeading);
      const arrWindIsVRB = arrWind.windIsVRB;
      const arrHeadwind = arrWind.headwind;
      const arrCrosswind = arrWind.crosswind;
      const arrTailwind = arrHeadwind < 0 ? -arrHeadwind : 0;
      const arrPerformanceHeadwind = accountableWindComponent(arrHeadwind);
      const arrPerformanceTailwind = arrPerformanceHeadwind < 0 ? -arrPerformanceHeadwind : 0;

      const depWindComponentsEl = document.getElementById("depWindComponents");
      const arrWindComponentsEl = document.getElementById("arrWindComponents");
      const depWindLimitWarn = document.getElementById("depWindLimitWarn");
      const arrWindLimitWarn = document.getElementById("arrWindLimitWarn");

      const headStr =
        headwind >= 0
          ? `Headwind ${round(headwind, 1)} kt`
          : `Tailwind ${round(tailwind, 1)} kt`;
      const xwStr = windIsVRB
        ? "Crosswind not assessed (VRB)"
        : `Crosswind ${round(Math.abs(crosswind), 1)} kt`;

      const arrHeadStr = arrHeadwind >= 0 ? `Headwind ${round(arrHeadwind, 1)} kt` : `Tailwind ${round(arrTailwind, 1)} kt`;
      const arrXwStr = arrWindIsVRB ? "Crosswind not assessed (VRB)" : `Crosswind ${round(Math.abs(arrCrosswind), 1)} kt`;
      const depXwNote = windIsVRB
        ? "VRB treated as full tailwind for performance"
        : (Math.abs(crosswind) > MAX_XWIND ? "ABOVE max demonstrated 18 kt" : "within demonstrated limit");
      const arrXwNote = arrWindIsVRB
        ? "VRB treated as full tailwind for performance"
        : (Math.abs(arrCrosswind) > MAX_XWIND ? "ABOVE max demonstrated 18 kt" : "within demonstrated limit");
      if (depWindComponentsEl) {
        depWindComponentsEl.innerHTML = `
          <div>${headStr}, ${xwStr}</div>
          <div>${formatAccountableWind(performanceHeadwind)} used for AFM correction per OM-C</div>
          <div>${depXwNote}</div>
        `;
      }
      if (arrWindComponentsEl) {
        arrWindComponentsEl.innerHTML = `
          <div>${arrHeadStr}, ${arrXwStr}</div>
          <div>${formatAccountableWind(arrPerformanceHeadwind)} used for AFM correction per OM-C</div>
          <div>${arrXwNote}</div>
        `;
      }

      const tailwindOk = tailwind <= MAX_RECOMMENDED_TAILWIND && arrTailwind <= MAX_RECOMMENDED_TAILWIND;
      const depCrosswindOk = windIsVRB || Math.abs(crosswind) <= MAX_XWIND;
      const arrCrosswindOk = arrWindIsVRB || Math.abs(arrCrosswind) <= MAX_XWIND;
      const crosswindOk = depCrosswindOk && arrCrosswindOk;
      const windOk = windSpd <= MAX_WIND && arrWindSpd <= MAX_WIND && crosswindOk && tailwindOk;

      const depWindWarnings = [];
      const arrWindWarnings = [];
      if (windIsVRB && windSpd > 0) depWindWarnings.push(`VRB wind treated as full ${round(windSpd, 1)} kt tailwind for performance. Crosswind is not assessed.`);
      if (arrWindIsVRB && arrWindSpd > 0) arrWindWarnings.push(`VRB wind treated as full ${round(arrWindSpd, 1)} kt tailwind for performance. Crosswind is not assessed.`);
      if (!windIsVRB && windSpd > 0 && !Number.isFinite(parsedWindDir)) depWindWarnings.push("Wind direction should be degrees true or VRB.");
      if (!arrWindIsVRB && arrWindSpd > 0 && !Number.isFinite(arrWind.parsedWindDir)) arrWindWarnings.push("Wind direction should be degrees true or VRB.");
      if (!depCrosswindOk) depWindWarnings.push(`Crosswind ${round(Math.abs(crosswind), 1)} kt exceeds demonstrated ${MAX_XWIND} kt.`);
      if (!arrCrosswindOk) arrWindWarnings.push(`Crosswind ${round(Math.abs(arrCrosswind), 1)} kt exceeds demonstrated ${MAX_XWIND} kt.`);
      if (windSpd > MAX_WIND) depWindWarnings.push(`Not permitted - wind speed ${round(windSpd, 1)} kt exceeds 40 kt limit.`);
      if (arrWindSpd > MAX_WIND) arrWindWarnings.push(`Wind speed ${round(arrWindSpd, 1)} kt exceeds 40 kt limit.`);
      if (tailwind > MAX_RECOMMENDED_TAILWIND) depWindWarnings.push(`Tailwind ${round(tailwind, 1)} kt exceeds AFM recommended maximum ${MAX_RECOMMENDED_TAILWIND} kt.`);
      if (arrTailwind > MAX_RECOMMENDED_TAILWIND) arrWindWarnings.push(`Tailwind ${round(arrTailwind, 1)} kt exceeds AFM recommended maximum ${MAX_RECOMMENDED_TAILWIND} kt.`);
      if (performanceTailwind > WIND_FACTOR_LIMIT_TAIL) depWindWarnings.push(`Accountable tailwind correction is capped at ${WIND_FACTOR_LIMIT_TAIL} kt for chart validity.`);
      if (arrPerformanceTailwind > WIND_FACTOR_LIMIT_TAIL) arrWindWarnings.push(`Accountable tailwind correction is capped at ${WIND_FACTOR_LIMIT_TAIL} kt for chart validity.`);
      if (performanceHeadwind > WIND_FACTOR_LIMIT_HEAD) depWindWarnings.push(`Accountable headwind correction is capped at ${WIND_FACTOR_LIMIT_HEAD} kt for chart validity.`);
      if (arrPerformanceHeadwind > WIND_FACTOR_LIMIT_HEAD) arrWindWarnings.push(`Accountable headwind correction is capped at ${WIND_FACTOR_LIMIT_HEAD} kt for chart validity.`);

      function setPhaseWindWarning(el, warnings) {
        if (!el) return;
        if (warnings.length > 0) {
          el.style.display = "block";
          el.textContent = warnings.join(" ");
        } else {
          el.style.display = "none";
          el.textContent = "";
        }
      }
      setPhaseWindWarning(depWindLimitWarn, depWindWarnings);
      setPhaseWindWarning(arrWindLimitWarn, arrWindWarnings);
      const weatherMinima = assessWeatherMinima({ metar: departureMetar, windSpd, crosswind });

      const baseTO = interpTOLD(pa, isaDev, TO_TABLE);
      const baseLDG = interpTOLD(arrPa, arrIsaDev, LDG_TABLE);
      const grass = surfaceCfg;
      const landingSurfaceDry = GRASS_FACTORS[surfaceKeyFrom(arrSurfaceBase, "dry")] || arrSurfaceCfg;
      const landingSurfaceWet = GRASS_FACTORS[surfaceKeyFrom(arrSurfaceBase, "wet")] || arrSurfaceCfg;

      const toAirborneNoWind = Math.max(0, baseTO.dist - baseTO.run);
      const toRunNoWind = baseTO.run * grass.to;
      const toDistNoWind = toRunNoWind + toAirborneNoWind;

      const ldgAirborneNoWind = Math.max(0, baseLDG.dist - baseLDG.run);
      const ldgRunDryNoWind = baseLDG.run * landingSurfaceDry.ldg;
      const ldgRunWetNoWind = baseLDG.run * landingSurfaceWet.ldg;
      const ldgDistDryNoWind = ldgRunDryNoWind + ldgAirborneNoWind;
      const ldgDistWetNoWind = ldgRunWetNoWind + ldgAirborneNoWind;

      const toRun = toRunNoWind * windCorrectionFactor("takeoff_run", performanceHeadwind);
      const toDist = toDistNoWind * windCorrectionFactor("takeoff_distance", performanceHeadwind);
      const ldgRunDry = ldgRunDryNoWind * windCorrectionFactor("landing_run", arrPerformanceHeadwind);
      const ldgRunWet = ldgRunWetNoWind * windCorrectionFactor("landing_run", arrPerformanceHeadwind);
      const ldgDistDry = ldgDistDryNoWind * windCorrectionFactor("landing_distance", arrPerformanceHeadwind);
      const ldgDistWet = ldgDistWetNoWind * windCorrectionFactor("landing_distance", arrPerformanceHeadwind);
      const activeLdgDist = usingWet ? ldgDistWet : ldgDistDry;

      document.getElementById("toRun").textContent = round(toRun, 0);
      document.getElementById("toDist").textContent = round(toDist, 0);
      const ldgRunEl = document.getElementById("ldgRun");
      if (ldgRunEl) ldgRunEl.textContent = round(usingWet ? ldgRunWet : ldgRunDry, 0);
      const ldgDistEl = document.getElementById("ldgDist");
      if (ldgDistEl) ldgDistEl.textContent = round(activeLdgDist, 0);
      document.getElementById("ldgDistDry").textContent = round(ldgDistDry, 0);
      document.getElementById("ldgDistWet").textContent = round(ldgDistWet, 0);

      const roc = interpRoc(pa, isaDev);
      document.getElementById("roc").textContent = round(roc, 0);

      // OM-C factored runway requirements.
      const reqTora125 = toDist * 1.25;       // OM-C factor / balanced-field check
      const reqToraRun = toRun;               // with stopway: TORA >= AFM run
      const reqToda115 = toDist * 1.15;       // TODA >= 1.15 * TODR
      const reqAsda130 = toRun * 1.3;         // ASDA >= 1.3 * AFM run

      const reqLdaDry = ldgDistDry / 0.7;        // LDR dry (OM-C): AFM LDR dry must fit in 70% LDA
      const reqLdaWet = ldgDistWet * 1.15 / 0.7; // LDR wet (OM-C): wet factor before 70% LDA check

      document.getElementById("reqTora125").textContent = round(reqTora125, 0);
      document.getElementById("reqToraRun").textContent = round(reqToraRun, 0);
      document.getElementById("reqToda115").textContent = round(reqToda115, 0);
      document.getElementById("reqAsda130").textContent = round(reqAsda130, 0);

      document.getElementById("reqLdaDry").textContent = round(reqLdaDry, 0);
      document.getElementById("reqLdaWet").textContent = round(reqLdaWet, 0);

      function statusSpan(elId, ok) {
        const el = document.getElementById(elId);
        el.textContent = ok ? "OK" : "NOT OK";
        el.className = ok ? "fact-status-ok" : "fact-status-bad";
      }

      const tora125Ok = reqTora125 <= runwayTora;
      const toraRunOk = reqToraRun <= runwayTora;
      const toda115Ok = reqToda115 <= runwayToda;
      const asda130Ok = reqAsda130 <= runwayAsda;
      const declaredStopwayOrClearway = runwayToda > runwayTora || runwayAsda > runwayTora;
      const stopwayOk = toraRunOk && toda115Ok && asda130Ok;
      const activeTakeoffOk = declaredStopwayOrClearway ? stopwayOk : tora125Ok;
      const activeReqToraVal = declaredStopwayOrClearway ? reqToraRun : reqTora125;

      const noStopwayBlock = document.getElementById("takeoffNoStopwayBlock");
      const stopwayBlock = document.getElementById("takeoffStopwayBlock");
      if (noStopwayBlock && stopwayBlock) {
        noStopwayBlock.style.display = declaredStopwayOrClearway ? "none" : "block";
        stopwayBlock.style.display = declaredStopwayOrClearway ? "block" : "none";
      }

      const ldaDryOk = reqLdaDry <= runwayLda;
      const ldaWetOk = reqLdaWet <= runwayLda;

      statusSpan("reqTora125Status", tora125Ok);
      statusSpan("reqStopwayStatus", stopwayOk);
      statusSpan("reqLdaDryStatus", ldaDryOk);
      statusSpan("reqLdaWetStatus", ldaWetOk);

      function setMarker(id, dist, limitLength, scaleLength, barWidth) {
        const el = document.getElementById(id);
        const ratio = dist / scaleLength;
        const widthPx = Math.min(barWidth, Math.max(0, ratio * barWidth));
        el.style.width = widthPx + "px";

        if (dist > limitLength) el.classList.add("overrun");
        else el.classList.remove("overrun");
      }

      function setTick(id, dist, scaleLength, barWidth) {
        const el = document.getElementById(id);
        if (!el) return;
        const ratio = dist / scaleLength;
        const xPx = Math.min(barWidth - 2, Math.max(2, clamp(ratio, 0, 1) * barWidth));
        el.style.left = xPx + "px";
      }

      function setVisible(id, visible, display = "block") {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? display : "none";
      }

      function setLegendText(el, text) {
        if (el?.lastChild) el.lastChild.textContent = text;
      }

      function setTickLabel(id, text) {
        const label = document.querySelector(`#${id} .tick-label`);
        if (label) label.textContent = text;
      }

      const takeoffBar = document.getElementById("takeoffRunwayBar");
      const landingBar = document.getElementById("landingRunwayBar");
      const takeoffBarWidth = takeoffBar?.clientWidth || 1;
      const landingBarWidth = landingBar?.clientWidth || 1;
      const todrBarVal = declaredStopwayOrClearway ? reqToda115 : toDist;
      const asdrBarVal = declaredStopwayOrClearway ? reqAsda130 : 0;
      const takeoffScaleLength = Math.max(runwayTora, runwayToda, runwayAsda, toRun, todrBarVal, asdrBarVal, activeReqToraVal, 1);
      const landingScaleLength = Math.max(runwayLda, ldgDistDry, ldgDistWet, reqLdaDry, reqLdaWet, 1);

      setMarker("barToRun", toRun, runwayTora, takeoffScaleLength, takeoffBarWidth);
      setMarker("barToDist", todrBarVal, declaredStopwayOrClearway ? runwayToda : runwayTora, takeoffScaleLength, takeoffBarWidth);
      setMarker("barAsdr", asdrBarVal, runwayAsda, takeoffScaleLength, takeoffBarWidth);
      setTick("tickTakeoffEnd", runwayTora, takeoffScaleLength, takeoffBarWidth);
      setTick("tickTodaEnd", runwayToda, takeoffScaleLength, takeoffBarWidth);
      setTick("tickAsdaEnd", runwayAsda, takeoffScaleLength, takeoffBarWidth);
      setTick("tickReqTora125", activeReqToraVal, takeoffScaleLength, takeoffBarWidth);

      const todaDiffersFromTora = Math.abs(runwayToda - runwayTora) > 0.5;
      const asdaDiffersFromTora = Math.abs(runwayAsda - runwayTora) > 0.5;
      const asdaDiffersFromToda = Math.abs(runwayAsda - runwayToda) > 0.5;
      const showTodaTick = todaDiffersFromTora;
      const showAsdaTick = asdaDiffersFromTora && asdaDiffersFromToda;
      const todaTick = document.getElementById("tickTodaEnd");
      const asdaTick = document.getElementById("tickAsdaEnd");
      const legendTora = document.getElementById("legendTora");
      const legendToda = document.getElementById("legendToda");
      const legendAsda = document.getElementById("legendAsda");
      const legendAsdr = document.getElementById("legendAsdr");
      const legendToraReq = document.getElementById("legendToraReq");
      const toraTickLabel = !todaDiffersFromTora && !asdaDiffersFromTora
        ? "TORA/TODA/ASDA"
        : (!asdaDiffersFromTora ? "TORA/ASDA" : "TORA");
      const todaTickLabel = !asdaDiffersFromToda ? "TODA/ASDA" : "TODA";

      setTickLabel("tickTakeoffEnd", toraTickLabel);
      setTickLabel("tickTodaEnd", todaTickLabel);
      if (todaTick) todaTick.style.display = showTodaTick ? "block" : "none";
      if (asdaTick) asdaTick.style.display = showAsdaTick ? "block" : "none";
      if (legendTora) legendTora.title = "TORA - take-off run available";
      setLegendText(legendTora, toraTickLabel);
      setLegendText(legendToda, todaTickLabel);
      if (legendToda) legendToda.style.display = showTodaTick ? "inline-flex" : "none";
      if (legendAsda) legendAsda.style.display = showAsdaTick ? "inline-flex" : "none";
      setVisible("barAsdr", declaredStopwayOrClearway);
      setVisible("tickReqTora125", !declaredStopwayOrClearway);
      if (legendAsdr) legendAsdr.style.display = declaredStopwayOrClearway ? "inline-flex" : "none";
      if (legendToraReq) legendToraReq.style.display = declaredStopwayOrClearway ? "none" : "inline-flex";

      setMarker("barLdrAfm", activeLdgDist, runwayLda, landingScaleLength, landingBarWidth);
      const barLdrAfm = document.getElementById("barLdrAfm");
      const legendLdrAfm = document.getElementById("legendLdrAfm");
      const activeLdrColor = usingWet ? "#38bdf8" : "#22c55e";
      const activeLdrLabel = usingWet ? "LDR WET (AFM)" : "LDR DRY (AFM)";
      if (barLdrAfm) {
        barLdrAfm.style.background = activeLdrColor;
        barLdrAfm.title = `${activeLdrLabel} - landing distance required by AFM`;
      }
      if (legendLdrAfm) {
        const swatch = legendLdrAfm.querySelector(".leg-swatch");
        if (swatch) swatch.style.background = activeLdrColor;
        legendLdrAfm.title = `${activeLdrLabel} - landing distance required by AFM`;
        setLegendText(legendLdrAfm, activeLdrLabel);
      }
      setTick("tickLandingEnd", runwayLda, landingScaleLength, landingBarWidth);
      setTick("tickLdrDryOmc", reqLdaDry, landingScaleLength, landingBarWidth);
      setTick("tickLdrWetOmc", reqLdaWet, landingScaleLength, landingBarWidth);

      document.getElementById("declRwy").textContent = formatRunwayLabel();
      document.getElementById("declArrRwy").textContent = formatArrivalRunwayLabel();
      document.getElementById("declTora").textContent = `${round(runwayTora, 0)} m`;
      document.getElementById("declToda").textContent = `${round(runwayToda, 0)} m`;
      document.getElementById("declAsda").textContent = `${round(runwayAsda, 0)} m`;
      document.getElementById("declLda").textContent = `${round(runwayLda, 0)} m`;

      const surfaceLabel = surfaceCfg.label || "CUSTOM";
      const arrSurfaceLabel = arrSurfaceCfg.label || "CUSTOM";
      document.getElementById("declDepSurface").textContent = surfaceLabel;
      document.getElementById("declArrSurface").textContent = arrSurfaceLabel;

      const takeoffLimiterStrip = document.getElementById("takeoffLimiterStrip");
      const takeoffLimiterText = document.getElementById("takeoffLimiterText");
      const landingLimiterStrip = document.getElementById("landingLimiterStrip");
      const landingLimiterText = document.getElementById("landingLimiterText");

      const activeReqLdaVal = usingWet ? reqLdaWet : reqLdaDry;
      const activeLdaOk = usingWet ? ldaWetOk : ldaDryOk;

      let takeoffLimiting = [];
      if (!activeTakeoffOk) {
        if (declaredStopwayOrClearway) {
          if (!toraRunOk) takeoffLimiting.push(`TORA ${round(runwayTora, 0)} m < TORR ${round(reqToraRun, 0)} m`);
          if (!toda115Ok) takeoffLimiting.push(`TODA ${round(runwayToda, 0)} m < TODR ${round(reqToda115, 0)} m`);
          if (!asda130Ok) takeoffLimiting.push(`ASDA ${round(runwayAsda, 0)} m < ASDR ${round(reqAsda130, 0)} m`);
        } else {
          takeoffLimiting.push(`TORA required ${round(reqTora125, 0)} m > TORA ${round(runwayTora, 0)} m`);
        }
      }

      if (takeoffLimiting.length === 0) {
        takeoffLimiterText.textContent = `OK — take-off requirements within available runway.`;
        takeoffLimiterStrip.classList.add("ok");
        takeoffLimiterStrip.classList.remove("bad");
      } else {
        takeoffLimiterText.textContent = `LIMITED — ` + takeoffLimiting.join(" | ");
        takeoffLimiterStrip.classList.add("bad");
        takeoffLimiterStrip.classList.remove("ok");
      }

      if (activeLdaOk) {
        landingLimiterText.textContent = `OK — active LDR (OM-C) within LDA.`;
        landingLimiterStrip.classList.add("ok");
        landingLimiterStrip.classList.remove("bad");
      } else {
        landingLimiterText.textContent = `LIMITED — active LDR (OM-C) ${round(activeReqLdaVal, 0)} m > LDA ${round(runwayLda, 0)} m`;
        landingLimiterStrip.classList.add("bad");
        landingLimiterStrip.classList.remove("ok");
      }

      const sumWbText = wbOk
        ? `OK – TOW ${round(massTO, 1)} kg at ${round(cgTO, 0)} mm; landing weight ${round(massLW, 1)} kg at ${round(cgLW, 0)} mm. Fuel and baggage within AFM limits.`
        : `NOT OK – check masses, CG envelope, fuel (≤ ${MAX_FUEL_KG} kg / ${MAX_FUEL_L} L) and baggage (≤ ${MAX_BAG_KG} kg).`;
      setSummaryLine("sumWb", sumWbText, wbOk);

      const toOk = activeTakeoffOk;
      const sumPerfToText = declaredStopwayOrClearway
        ? (toOk
          ? `OK – non-balanced field declared-distance checks pass: TORA ≥ TORR ${round(reqToraRun, 0)} m, TODA ≥ TODR ${round(reqToda115, 0)} m, ASDA ≥ ASDR ${round(reqAsda130, 0)} m.`
          : `NOT OK – one or more non-balanced field declared-distance checks fail: TORA ≥ TORR ${round(reqToraRun, 0)} m, TODA ≥ TODR ${round(reqToda115, 0)} m, ASDA ≥ ASDR ${round(reqAsda130, 0)} m required.`)
        : (toOk
          ? `OK – balanced field: TORA required (1.25 × AFM TODR = ${round(reqTora125, 0)} m) ≤ TORA ${round(runwayTora, 0)} m.`
          : `NOT OK – balanced field: TORA required (1.25 × AFM TODR = ${round(reqTora125, 0)} m) exceeds TORA ${round(runwayTora, 0)} m.`);
      setSummaryLine("sumPerfTo", sumPerfToText, toOk);

      const ldgCriterionOk = usingWet ? ldaWetOk : ldaDryOk;
      const sumPerfLdgText = usingWet
        ? (ldgCriterionOk
          ? `OK – LDR wet (AFM) ${round(ldgDistWet, 0)} m; LDR wet (OM-C) ${round(reqLdaWet, 0)} m ≤ LDA ${round(runwayLda, 0)} m.`
          : `NOT OK – LDR wet (OM-C) ${round(reqLdaWet, 0)} m exceeds LDA ${round(runwayLda, 0)} m.`)
        : (ldgCriterionOk
          ? `OK – LDR dry (AFM) ${round(ldgDistDry, 0)} m; LDR dry (OM-C) ${round(reqLdaDry, 0)} m ≤ LDA ${round(runwayLda, 0)} m.`
          : `NOT OK – LDR dry (OM-C) ${round(reqLdaDry, 0)} m exceeds LDA ${round(runwayLda, 0)} m.`);
      setSummaryLine("sumPerfLdg", sumPerfLdgText, ldgCriterionOk);

      const sumWindText = windOk
        ? `OK – departure ${headStr.toLowerCase()}, ${formatAccountableWind(performanceHeadwind)}; arrival ${arrHeadStr.toLowerCase()}, ${formatAccountableWind(arrPerformanceHeadwind)}. Wind speeds ≤ 40 kt, crosswind within 18 kt demonstrated where assessed, tailwind within ${MAX_RECOMMENDED_TAILWIND} kt recommendation.`
        : `NOT OK – wind limits/recommendations exceeded (departure wind ${round(windSpd, 1)} kt, tailwind ${round(tailwind, 1)} kt; arrival wind ${round(arrWindSpd, 1)} kt, tailwind ${round(arrTailwind, 1)} kt).`;
      setSummaryLine("sumWind", sumWindText, windOk);

      const runwayOk = toOk && ldgCriterionOk;
      const runwayLabelForSummary = formatRunwayLabel();
      const arrivalLabelForSummary = formatArrivalRunwayLabel();
      const sumRunwayText = runwayOk
        ? `Departure ${runwayLabelForSummary} TORA ${round(runwayTora, 0)} m, TODA ${round(runwayToda, 0)} m, ASDA ${round(runwayAsda, 0)} m and arrival ${arrivalLabelForSummary} LDA ${round(runwayLda, 0)} m are sufficient for current requirements.`
        : `Departure ${runwayLabelForSummary} declared distances (TORA ${round(runwayTora, 0)} m, TODA ${round(runwayToda, 0)} m, ASDA ${round(runwayAsda, 0)} m) or arrival ${arrivalLabelForSummary} LDA ${round(runwayLda, 0)} m are insufficient for current requirements.`;
      setSummaryLine("sumRunway", sumRunwayText, runwayOk);

      const nonCompliance = [];
      if (!wbOk) nonCompliance.push("W&B outside AFM limits");
      if (!toOk) nonCompliance.push("take-off requirement not met");
      if (!ldgCriterionOk) nonCompliance.push("landing requirement not met");
      if (!windOk) nonCompliance.push("wind limits or recommendations exceeded");
      if (weatherMinima.assessed && !weatherMinima.ok) nonCompliance.push("weather minima warning active");
      const complianceAlertRow = document.getElementById("complianceAlertRow");
      const complianceAlert = document.getElementById("complianceAlert");
      if (nonCompliance.length > 0) {
        complianceAlert.textContent = `Not compliant for dispatch: ${nonCompliance.join("; ")}.`;
        complianceAlertRow.style.display = "flex";
      } else {
        complianceAlert.textContent = "";
        complianceAlertRow.style.display = "none";
      }

      const rows = [
        ["Empty aircraft", mEmpty, emptyArm, momEmpty],
        ["Upholstery", mUpholstery, upholsteryArm, momUpholstery],
        ["Pilot", mPilot, pilotArm, momPilot],
        ["Passenger", mPax, paxArm, momPax],
        ["Baggage", mBag, bagArm, momBag],
        ["Fuel", mFuel, 774, momFuel],
      ];

      const tbody = document.getElementById("momentTable");
      if (tbody) {
        tbody.innerHTML = "";
        rows.forEach(([label, mass, arm, moment]) => {
          if (!mass || mass <= 0) return;
          const tr = document.createElement("tr");
          const rowBad = (label === "Baggage" && !bagOk) || (label === "Fuel" && !fuelOk);
          tr.classList.toggle("bad-value", rowBad);
          tr.innerHTML = `
      <td>${label}</td>
      <td class="num">${round(mass, 1)}</td>
      <td class="num">${round(arm, 0)}</td>
      <td class="num">${Math.round(moment).toLocaleString()}</td>
    `;
          tbody.appendChild(tr);
        });

        document.getElementById("mtMassTO").textContent = round(massTO, 1);
        document.getElementById("mtMomTO").textContent = Math.round(momTO).toLocaleString();
        document.getElementById("mtMassLW").textContent = round(massLW, 1);
        document.getElementById("mtMomLW").textContent = Math.round(momLW).toLocaleString();
        document.getElementById("mtArmTO").textContent = isFinite(cgTO) ? round(cgTO, 0) : "–";
        document.getElementById("mtArmLW").textContent = isFinite(cgLW) ? round(cgLW, 0) : "–";
        document.getElementById("mtMassTO").closest("tr")?.classList.toggle("bad-value", !massOkTO || !cgBasicTO || !insidePolyTO);
        document.getElementById("mtMassLW").closest("tr")?.classList.toggle("bad-value", !massOkLW || !cgBasicLW || !insidePolyLW);

      }
    }


    function getText(id) {
      const el = document.getElementById(id);
      return el ? (el.textContent || "").trim() : "";
    }

    function getValue(id) {
      const el = document.getElementById(id);
      return el ? el.value : "";
    }

    function getSelectedText(id) {
      const el = document.getElementById(id);
      if (!el || el.selectedIndex < 0) return "";
      return el.options[el.selectedIndex].textContent.trim();
    }

    function collectMomentRowsForExport() {
      return Array.from(document.querySelectorAll("#momentTable tr")).map((tr) =>
        Array.from(tr.children).map((td) => td.textContent.trim())
      );
    }

    function formatWindComponentsForExport(windDirId, windSpdId, headingId) {
      const windDirRaw = String(getValue(windDirId) || "").trim().toUpperCase();
      const windSpd = parseFloat(getValue(windSpdId)) || 0;
      const heading = parseFloat(getValue(headingId)) || 0;
      const wind = computeWindComponentsForHeading(windDirRaw, windSpd, heading);
      const tailwind = wind.headwind < 0 ? -wind.headwind : 0;
      const along = wind.headwind >= 0 ? `HWC ${round(wind.headwind, 1)} kt` : `TWC ${round(tailwind, 1)} kt`;
      const cross = wind.windIsVRB ? "XWC not assessed (VRB)" : `XWC ${round(Math.abs(wind.crosswind), 1)} kt`;
      const credited = accountableWindComponent(wind.headwind);
      const creditedAbs = round(Math.abs(credited), 1);
      const creditedText = credited >= 0
        ? `credited HWC ${creditedAbs} kt (50% of reported HWC)`
        : `penalised TWC ${creditedAbs} kt (150% of reported TWC)`;
      return `Reported: ${along}, ${cross}. OM-C performance wind: ${creditedText}`;
    }

    function escHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
      }[ch]));
    }

    function exportReportToPdf() {
      calculateAll();

      const momentRows = collectMomentRowsForExport();
      const now = new Date();
      const reportTitle = "Elixir W&B + Performance Report";

      const rowsHtml = momentRows.map((row) => `
        <tr><td>${escHtml(row[0])}</td><td class="num">${escHtml(row[1])}</td><td class="num">${escHtml(row[2])}</td><td class="num">${escHtml(row[3])}</td></tr>
      `).join("");
      const depSurfaceText = GRASS_FACTORS[currentSurfaceKey("surface", false)]?.label || "CUSTOM";
      const arrSurfaceText = GRASS_FACTORS[currentSurfaceKey("arrSurface", true)]?.label || "CUSTOM";
      const cgChartImg = document.getElementById("cgChart")?.toDataURL("image/png") || "";
      const depWindComponentsText = formatWindComponentsForExport("windDir", "windSpd", "rwHeading");
      const arrWindComponentsText = formatWindComponentsForExport("arrWindDir", "arrWindSpd", "arrHeading");
      const weatherMinimaText = `${getText("weatherMinimaStatus")} ${getText("weatherMinimaDetail")}`.trim();
      const complianceText = getText("complianceAlert");
      const classIfBad = (bad) => bad ? " bad-value" : "";
      const startsNotOk = (id) => /^NOT OK/i.test(getText(id));
      const hasLimitWarning = (id) => /exceeds|not permitted|capped/i.test(getText(id));
      const numValue = (id) => parseFloat(getValue(id));
      const textNum = (id) => parseFloat(getText(id));
      const tow = textNum("tow");
      const lw = textNum("lw");
      const cgTo = textNum("cg");
      const cgLw = textNum("cgArr");
      const fuelKgReport = numValue("fuelKg");
      const fuelLReport = numValue("fuelL");
      const bagKgReport = numValue("bagWt");
      const towBad = !(tow >= CG_MIN_MASS && tow <= MAX_MASS && cgTo >= CG_MIN && cgTo <= CG_MAX && pointInPoly(cgTo, tow, CG_POLY));
      const lwBad = !(lw >= CG_MIN_MASS && lw <= MAX_MASS && cgLw >= CG_MIN && cgLw <= CG_MAX && pointInPoly(cgLw, lw, CG_POLY));
      const fuelBad = fuelKgReport > MAX_FUEL_KG || fuelLReport > MAX_FUEL_L;
      const bagBad = bagKgReport > MAX_BAG_KG;
      const wbBad = /check|outside/i.test(getText("wbStatusPill"));
      const depWindBad = hasLimitWarning("depWindLimitWarn");
      const arrWindBad = hasLimitWarning("arrWindLimitWarn");
      const declaredStopwayOrClearwayReport = numValue("runwayToda") > numValue("runwayTora") || numValue("runwayAsda") > numValue("runwayTora");
      const reqToraBad = declaredStopwayOrClearwayReport ? startsNotOk("reqStopwayStatus") : startsNotOk("reqTora125Status");
      const todaAsdaBad = declaredStopwayOrClearwayReport && startsNotOk("reqStopwayStatus");
      const ldaDryBad = startsNotOk("reqLdaDryStatus");
      const ldaWetBad = startsNotOk("reqLdaWetStatus");
      const requiredToraReport = declaredStopwayOrClearwayReport ? getText("reqToraRun") : getText("reqTora125");

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${reportTitle}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Roboto, Inter, "Segoe UI", Arial, sans-serif; color: #111827; margin: 0; font-size: 10.5px; }
    h1 { color: #075985; font-size: 17px; margin: 0; letter-spacing: 0.04em; text-transform: uppercase; }
    h2 { background: #e0f2fe; border-left: 4px solid #0284c7; color: #075985; font-size: 11px; margin: 10px 0 5px; letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 7px; }
    .report-header { align-items: start; border-bottom: 2px solid #bae6fd; display: grid; grid-template-columns: 1fr auto; gap: 12px; margin-bottom: 6px; padding-bottom: 5px; }
    .report-meta { color: #475569; font-size: 8.5px; line-height: 1.3; text-align: right; }
    .report-actions { display: flex; justify-content: flex-end; margin-top: 5px; }
    .report-button { background: #0284c7; border: 0; border-radius: 5px; color: #fff; cursor: pointer; font: inherit; font-size: 9px; padding: 4px 9px; text-decoration: none; text-transform: uppercase; }
    .muted { color: #475569; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; }
    .box { background: #ffffff; border: 1px solid #bfdbfe; border-top: 3px solid #38bdf8; border-radius: 6px; padding: 7px; break-inside: avoid; }
    .box.wb { border-top-color: #22c55e; }
    .box.perf { border-top-color: #8b5cf6; }
    .box.warn { border-top-color: #f59e0b; background: #fffbeb; }
    .compliance-alert { border: 1px solid #dc2626; border-radius: 6px; background: #fee2e2; color: #991b1b; font-weight: 700; margin-bottom: 8px; padding: 7px 8px; }
    .kv { display: grid; grid-template-columns: 44% 56%; gap: 3px 8px; }
    .k { color: #475569; }
    .v { font-weight: 700; }
    .stack { display: grid; gap: 6px; }
    .chart-frame { align-items: center; display: flex; justify-content: center; min-height: 255px; }
    .chart-img { display: block; max-height: 255px; max-width: 100%; object-fit: contain; width: auto; height: auto; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; table-layout: fixed; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 3px 5px; text-align: left; vertical-align: top; }
    th { background: #eff6ff; color: #075985; text-transform: uppercase; font-size: 9px; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .moment-table col.item { width: 34%; }
    .moment-table col.mass { width: 16%; }
    .moment-table col.arm { width: 16%; }
    .moment-table col.moment { width: 34%; }
    .moment-table tfoot td { background: #ecfdf5; color: #166534; font-weight: 700; }
    .moment-table tfoot tr.bad-value td { background: #fee2e2; color: #b91c1c; font-weight: 800; }
    .ok { color: #047857; font-weight: 700; }
    .bad { color: #b91c1c; font-weight: 700; }
    .bad-value { color: #b91c1c; font-weight: 800; }
    .footer { margin-top: 14px; font-size: 9px; color: #475569; border-top: 2px solid #bae6fd; padding-top: 6px; }
    @media print { .report-actions { display:none; } }
  </style>
</head>
<body>
  <div class="report-header">
    <h1>${reportTitle}</h1>
    <div class="report-meta">
      <div>Generated ${escHtml(now.toLocaleString())}</div>
      <div>Unofficial helper. AFM and OM-C remain authoritative.</div>
      <div class="report-actions">
        <button class="report-button" onclick="window.print()">Print / save PDF</button>
      </div>
    </div>
  </div>

  <h2>Aircraft and loading</h2>
  <div class="grid">
    <div class="stack">
      <div class="box wb kv">
      <div class="k">Registration</div><div class="v">${escHtml(getSelectedText("regSelect"))}</div>
      <div class="k">Empty aircraft</div><div class="v">${escHtml(getValue("emptyWeight"))} kg @ ${escHtml(getValue("emptyArm"))} mm</div>
      <div class="k">Upholstery</div><div class="v">${escHtml(getValue("upholsteryWt"))} kg @ ${escHtml(getValue("upholsteryArm"))} mm</div>
      <div class="k">Pilot</div><div class="v">${escHtml(getValue("pilotWt"))} kg @ ${escHtml(getValue("pilotArm"))} mm</div>
      <div class="k">Passenger</div><div class="v">${escHtml(getValue("paxWt"))} kg @ ${escHtml(getValue("paxArm"))} mm</div>
      <div class="k">Baggage</div><div class="v${classIfBad(bagBad)}">${escHtml(getValue("bagWt"))} kg @ 1580 mm</div>
      <div class="k">Fuel</div><div class="v${classIfBad(fuelBad)}">${escHtml(getValue("fuelL"))} L / ${escHtml(getText("fuelKg")) || escHtml(getValue("fuelKg"))} kg (${escHtml(getSelectedText("fuelType"))})</div>
      </div>
      <div class="box wb">
      <table class="moment-table">
        <colgroup>
          <col class="item"><col class="mass"><col class="arm"><col class="moment">
        </colgroup>
        <thead><tr><th>Item</th><th class="num">Mass kg</th><th class="num">Arm mm</th><th class="num">Moment</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr class="${towBad ? "bad-value" : ""}"><td><strong>Total with fuel</strong></td><td class="num">${escHtml(getText("mtMassTO"))}</td><td class="num">${escHtml(getText("mtArmTO"))}</td><td class="num">${escHtml(getText("mtMomTO"))}</td></tr>
          <tr class="${lwBad ? "bad-value" : ""}"><td><strong>Total no fuel</strong></td><td class="num">${escHtml(getText("mtMassLW"))}</td><td class="num">${escHtml(getText("mtArmLW"))}</td><td class="num">${escHtml(getText("mtMomLW"))}</td></tr>
        </tfoot>
      </table>
      <p class="${wbBad ? "bad-value" : "ok"}"><strong>W&amp;B status:</strong> ${escHtml(getText("wbStatusPill"))}</p>
      </div>
    </div>
    <div class="box wb chart-frame">
      ${cgChartImg ? `<img class="chart-img" src="${cgChartImg}" alt="Weight and balance envelope">` : `<div class="muted">W&amp;B chart unavailable.</div>`}
    </div>
  </div>

  <h2>Conditions, runway and performance</h2>
  <div class="grid">
    <div class="box perf kv">
      <div class="k">Departure runway</div><div class="v">${escHtml(formatRunwayLabel())}</div>
      <div class="k">Surface</div><div class="v">${escHtml(depSurfaceText)}</div>
      <div class="k">Elevation</div><div class="v">${escHtml(getValue("fieldElev"))} ft</div>
      <div class="k">QNH</div><div class="v">${escHtml(getValue("qnh"))} hPa</div>
      <div class="k">Pressure altitude</div><div class="v">${escHtml(getValue("pa"))} ft</div>
      <div class="k">OAT / ISA dev</div><div class="v">${escHtml(getValue("oat"))} °C / ${escHtml(getValue("isaDev"))} °C</div>
      <div class="k">Wind</div><div class="v${classIfBad(depWindBad)}">${escHtml((String(getValue("windDir")).trim().toUpperCase() === "VRB") ? "VRB" : `${getValue("windDir")}°T`)} / ${escHtml(getValue("windSpd"))} kt</div>
      <div class="k">Wind credit</div><div class="v${classIfBad(depWindBad)}">${escHtml(depWindComponentsText)}</div>
      <div class="k">TORA / TODA</div><div class="v">${escHtml(getText("declTora"))} / ${escHtml(getText("declToda"))}</div>
      <div class="k">ASDA</div><div class="v">${escHtml(getText("declAsda"))}</div>
    </div>
    <div class="box perf kv">
      <div class="k">Arrival runway</div><div class="v">${escHtml(formatArrivalRunwayLabel())}</div>
      <div class="k">Surface</div><div class="v">${escHtml(arrSurfaceText)}</div>
      <div class="k">Elevation</div><div class="v">${escHtml(getValue("arrFieldElev"))} ft</div>
      <div class="k">QNH</div><div class="v">${escHtml(getValue("arrQnh"))} hPa</div>
      <div class="k">Pressure altitude</div><div class="v">${escHtml(getValue("arrPa"))} ft</div>
      <div class="k">OAT / ISA dev</div><div class="v">${escHtml(getValue("arrOat"))} °C / ${escHtml(getValue("arrIsaDev"))} °C</div>
      <div class="k">Wind</div><div class="v${classIfBad(arrWindBad)}">${escHtml((String(getValue("arrWindDir")).trim().toUpperCase() === "VRB") ? "VRB" : `${getValue("arrWindDir")}°T`)} / ${escHtml(getValue("arrWindSpd"))} kt</div>
      <div class="k">Wind credit</div><div class="v${classIfBad(arrWindBad)}">${escHtml(arrWindComponentsText)}</div>
      <div class="k">LDA</div><div class="v">${escHtml(getText("declLda"))}</div>
    </div>
  </div>

  <div class="grid">
    <div class="box perf kv">
      <div class="k">TORR (AFM)</div><div class="v">${escHtml(getText("toRun"))} m</div>
      <div class="k">TODR (AFM)</div><div class="v">${escHtml(getText("toDist"))} m</div>
      <div class="k">${declaredStopwayOrClearwayReport ? "TORR (OM-C)" : "TORA required (OM-C)"}</div><div class="v${classIfBad(reqToraBad)}">${escHtml(requiredToraReport)} m</div>
      <div class="k">TODR / ASDR (OM-C)</div><div class="v${classIfBad(todaAsdaBad)}">${escHtml(getText("reqToda115"))} m / ${escHtml(getText("reqAsda130"))} m</div>
    </div>
    <div class="box perf kv">
      <div class="k">LDR dry (AFM)</div><div class="v">${escHtml(getText("ldgDistDry"))} m</div>
      <div class="k">LDR wet (AFM)</div><div class="v">${escHtml(getText("ldgDistWet"))} m</div>
      <div class="k">LDR dry (OM-C)</div><div class="v${classIfBad(ldaDryBad)}">${escHtml(getText("reqLdaDry"))} m</div>
      <div class="k">LDR wet (OM-C)</div><div class="v${classIfBad(ldaWetBad)}">${escHtml(getText("reqLdaWet"))} m</div>
      <div class="k">Rate of climb</div><div class="v">${escHtml(getText("roc"))} ft/min</div>
    </div>
  </div>

  <h2>Operational summary</h2>
  <div class="box warn">
    ${complianceText ? `<div class="compliance-alert">${escHtml(complianceText)}</div>` : ""}
    <p><strong>W&B:</strong> ${escHtml(getText("sumWb"))}</p>
    <p><strong>Take-off:</strong> ${escHtml(getText("sumPerfTo"))}</p>
    <p><strong>Landing:</strong> ${escHtml(getText("sumPerfLdg"))}</p>
    <p><strong>Wind:</strong> ${escHtml(getText("sumWind"))}</p>
    <p><strong>Weather minima:</strong> ${escHtml(weatherMinimaText || "Not assessed")}</p>
    <p><strong>Runway:</strong> ${escHtml(getText("sumRunway"))}</p>
  </div>

  <div class="footer">This PDF is a snapshot of the app data. It is not an AFM replacement.</div>
</body>
</html>`;

      const reportUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const win = window.open(reportUrl, "_blank", "noopener");
      if (!win) {
        window.setTimeout(() => URL.revokeObjectURL(reportUrl), 60000);
        return;
      }
      window.setTimeout(() => URL.revokeObjectURL(reportUrl), 60000);
    }

    window.addEventListener("DOMContentLoaded", async () => {
      try {
        await Promise.all([
          loadAircraftData(),
          loadPerformanceData(),
          loadRunwayPresets(),
        ]);
      } catch (err) {
        console.error("Could not load required app data:", err);
        alert("Could not load app data. Check that the data JSON files are available, then reload the page.");
        return;
      }

      buildCGChart();

      document.getElementById("calcBtn").addEventListener("click", calculateAll);
      document.getElementById("exportPdfBtn").addEventListener("click", exportReportToPdf);
      document.getElementById("fetchMetarBtn").addEventListener("click", () => fetchAndApplyMetar("departure"));
      document.getElementById("fetchArrivalMetarBtn").addEventListener("click", () => fetchAndApplyMetar("arrival"));

      const regSelect = document.getElementById("regSelect");
      const regInfo = document.getElementById("regInfo");

      regSelect.addEventListener("change", () => {
        const reg = regSelect.value;
        const data = REG_DATA[reg];
        if (data) {
          const upholsteryWeight = data.upholsteryWeight !== undefined ? data.upholsteryWeight : 3.7;
          const upholsteryArm = data.upholsteryArm !== undefined ? data.upholsteryArm : 1076;
          document.getElementById("emptyWeight").value = data.weight;
          document.getElementById("emptyArm").value = data.cg;
          document.getElementById("upholsteryWt").value = upholsteryWeight;
          document.getElementById("upholsteryArm").value = upholsteryArm;
          regInfo.textContent = `${reg}: empty mass ${data.weight} kg, empty CG ${data.cg} mm; upholstery ${upholsteryWeight} kg @ ${upholsteryArm} mm.`;
        } else {
          regInfo.textContent = "Custom/manual – enter empty mass, CG and upholstery details from the aircraft documents.";
        }
        calculateAll();
      });

      populatePresetRunwayOptions();

      const savedRunwaySelect = document.getElementById("savedRunwaySelect");

      savedRunwaySelect.addEventListener("change", () => {
        const selectedId = savedRunwaySelect.value;
        if (selectedId === "none") {
          activeRunwayLabel = null;
          depSurfaceBase = "hard";
          if (arrivalUsesDepartureRunway) copyDepartureToArrival();
          updateRunwayEditState();
          calculateAll();
          return;
        }

        const preset = PRESET_RUNWAYS[selectedId];
        if (preset) {
          setRunwayFields(preset, preset.label);
          updateRunwayEditState();
          calculateAll();
          return;
        }
      });

      const arrivalRunwaySelect = document.getElementById("arrivalRunwaySelect");

      arrivalRunwaySelect.addEventListener("change", () => {
        const selectedId = arrivalRunwaySelect.value;
        if (selectedId === "none") {
          arrivalUsesDepartureRunway = true;
          activeArrivalRunwayLabel = activeRunwayLabel;
          copyDepartureToArrival();
          updateArrivalWeatherControls();
          updateRunwayEditState();
          calculateAll();
          return;
        }

        if (selectedId === "manual") {
          arrivalUsesDepartureRunway = false;
          activeArrivalRunwayLabel = null;
          arrSurfaceBase = "hard";
          updateArrivalWeatherControls();
          updateRunwayEditState();
          calculateAll();
          return;
        }

        const preset = PRESET_RUNWAYS[selectedId];
        if (preset) {
          setArrivalRunwayFields(preset, preset.label);
          updateRunwayEditState();
          calculateAll();
          return;
        }
      });

      ["qnh", "oat", "windDir", "windSpd"].forEach(id => {
        document.getElementById(id).addEventListener("input", () => {
          if (arrivalUsesDepartureRunway) copyDepartureWeatherToArrival();
        });
      });

      ["flightRules", "pilotQualification", "vfrPhase", "ifrAircraftClass"].forEach(id => {
        document.getElementById(id)?.addEventListener("change", calculateAll);
      });

      updateArrivalWeatherControls();
      updateRunwayEditState();
      calculateAll();
      window.addEventListener("resize", calculateAll);
    });
