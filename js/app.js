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

    function populateRunwaySelect(selectId, noneLabel = "None") {
      const select = document.getElementById(selectId);
      if (!select) return;
      const previousValue = select.value;
      select.innerHTML = `<option value="none">${noneLabel}</option>`;

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
      populateRunwaySelect("arrivalRunwaySelect", "Use departure runway");
    }

    function setFieldGroupDisabled(ids, disabled) {
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
      });
    }

    function updateRunwayEditState() {
      const depPresetSelected = document.getElementById("savedRunwaySelect")?.value !== "none";
      const arrPresetSelected = document.getElementById("arrivalRunwaySelect")?.value !== "none";

      setFieldGroupDisabled(["fieldElev", "runwayTora", "runwayToda", "runwayAsda", "runwayLda", "surface", "rwHeading"], depPresetSelected);
      setFieldGroupDisabled(["arrFieldElev", "arrLda", "arrSurface", "arrHeading"], arrivalUsesDepartureRunway || arrPresetSelected);
    }

    function setRunwayFields(data, label) {
      if (!data) return;
      document.getElementById("fieldElev").value = data.elev ?? document.getElementById("fieldElev").value;
      document.getElementById("runwayTora").value = data.tora ?? document.getElementById("runwayTora").value;
      document.getElementById("runwayToda").value = data.toda ?? document.getElementById("runwayToda").value;
      document.getElementById("runwayAsda").value = data.asda ?? document.getElementById("runwayAsda").value;
      document.getElementById("runwayLda").value = data.lda ?? document.getElementById("runwayLda").value;
      document.getElementById("rwHeading").value = data.heading ?? document.getElementById("rwHeading").value;
      document.getElementById("surface").value = data.surface ?? document.getElementById("surface").value;
      activeRunwayLabel = label || data.label || "Custom runway";
      if (arrivalUsesDepartureRunway) copyDepartureToArrival();
      updateArrivalWeatherControls();
    }

    function copyDepartureToArrival() {
      if (!document.getElementById("arrFieldElev")) return;
      document.getElementById("arrFieldElev").value = document.getElementById("fieldElev").value;
      document.getElementById("arrLda").value = document.getElementById("runwayLda").value;
      document.getElementById("arrHeading").value = document.getElementById("rwHeading").value;
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
      const useDep = document.getElementById("arrUseDepWeather");
      if (!useDep) return;
      if (arrivalUsesDepartureRunway) {
        useDep.checked = true;
        useDep.disabled = true;
      } else {
        useDep.disabled = false;
      }
      const disabled = useDep.checked;
      ["arrQnh", "arrOat", "arrWindDir", "arrWindSpd"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
      });
      const fields = document.getElementById("arrivalWeatherFields");
      const speedField = document.getElementById("arrivalWindSpeedField");
      if (fields) fields.classList.toggle("field-disabled", disabled);
      if (speedField) speedField.classList.toggle("field-disabled", disabled);
      if (disabled) copyDepartureWeatherToArrival();
    }

    function setArrivalRunwayFields(data, label) {
      if (!data) return;
      document.getElementById("arrFieldElev").value = data.elev ?? document.getElementById("arrFieldElev").value;
      document.getElementById("arrLda").value = data.lda ?? data.tora ?? document.getElementById("arrLda").value;
      document.getElementById("arrHeading").value = data.heading ?? document.getElementById("arrHeading").value;
      document.getElementById("arrSurface").value = data.surface ?? document.getElementById("arrSurface").value;
      activeArrivalRunwayLabel = label || data.label || "Custom arrival runway";
      arrivalUsesDepartureRunway = false;
      const useDepWeather = document.getElementById("arrUseDepWeather");
      if (useDepWeather) useDepWeather.checked = false;
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
      if (!select || select.value === "none") return null;

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
        const useDepWeather = document.getElementById("arrUseDepWeather");
        if (useDepWeather) useDepWeather.checked = false;
        updateArrivalWeatherControls();
      }

      button.disabled = true;
      status.textContent = `Fetching ${stationLabel} METAR from NOAA...`;
      try {
        const metar = await fetchMetarForStation(station);
        applyMetarToFields(metar, target);
        if (!isArrival && document.getElementById("arrUseDepWeather")?.checked) copyDepartureWeatherToArrival();
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

    let cgChart, toChart, ldgChart, rocChart;
    let cgDepDataset, cgArrDataset, toPointDataset, ldgPointDataset, rocPointDataset;

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

      cgChart = new Chart(ctx, {
        type: "line",
        data: {
          datasets: [
            {
              label: "AFM envelope",
              data: polyPoints,
              tension: 0,
              fill: true,
            },
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
        },
      });
    }

    function buildPerfCharts() {
      const ctxTo = document.getElementById("toChart").getContext("2d");
      const ctxLdg = document.getElementById("ldgChart").getContext("2d");
      const ctxRoc = document.getElementById("rocChart").getContext("2d");

      const toISA_run = [], toISA_dist = [];
      const toISA10_run = [], toISA10_dist = [];
      const toISA20_run = [], toISA20_dist = [];

      ALT_GRID_TOLD.forEach(alt => {
        const row = TO_TABLE[alt];
        toISA_run.push({ x: alt, y: row[0] });
        toISA_dist.push({ x: alt, y: row[1] });
        toISA10_run.push({ x: alt, y: row[2] });
        toISA10_dist.push({ x: alt, y: row[3] });
        toISA20_run.push({ x: alt, y: row[4] });
        toISA20_dist.push({ x: alt, y: row[5] });
      });

      const ldgISA_run = [], ldgISA_dist = [];
      const ldgISA10_run = [], ldgISA10_dist = [];
      const ldgISA20_run = [], ldgISA20_dist = [];

      ALT_GRID_TOLD.forEach(alt => {
        const row = LDG_TABLE[alt];
        ldgISA_run.push({ x: alt, y: row[0] });
        ldgISA_dist.push({ x: alt, y: row[1] });
        ldgISA10_run.push({ x: alt, y: row[2] });
        ldgISA10_dist.push({ x: alt, y: row[3] });
        ldgISA20_run.push({ x: alt, y: row[4] });
        ldgISA20_dist.push({ x: alt, y: row[5] });
      });

      const rocISA = [], rocISA10 = [], rocISA20 = [];
      ALT_GRID_ROC.forEach(alt => {
        const row = ROC_TABLE[alt];
        rocISA.push({ x: alt, y: row[0] });
        rocISA10.push({ x: alt, y: row[1] });
        rocISA20.push({ x: alt, y: row[2] });
      });

      toPointDataset = {
        type: "scatter",
        label: "Current condition",
        data: [],
        yAxisID: "y1",
        pointRadius: 5,
        pointHoverRadius: 6,
      };

      toChart = new Chart(ctxTo, {
        type: "line",
        data: {
          datasets: [
            { label: "Run ISA", data: toISA_run, tension: 0.2, yAxisID: "y1" },
            { label: "Run ISA+10", data: toISA10_run, tension: 0.2, yAxisID: "y1" },
            { label: "Run ISA+20", data: toISA20_run, tension: 0.2, yAxisID: "y1" },
            {
              label: "50 ft dist ISA",
              data: toISA_dist,
              borderDash: [4, 3],
              tension: 0.2,
              yAxisID: "y2",
            },
            {
              label: "50 ft dist ISA+10",
              data: toISA10_dist,
              borderDash: [4, 3],
              tension: 0.2,
              yAxisID: "y2",
            },
            {
              label: "50 ft dist ISA+20",
              data: toISA20_dist,
              borderDash: [4, 3],
              tension: 0.2,
              yAxisID: "y2",
            },
            toPointDataset,
          ],
        },
        options: {
          responsive: true,
          scales: {
            x: { type: "linear", title: { display: true, text: "Pressure altitude (ft)" } },
            y1: { position: "left", title: { display: true, text: "T/O run (m)" } },
            y2: {
              position: "right",
              title: { display: true, text: "T/O distance to 50 ft (m)" },
              grid: { drawOnChartArea: false },
            },
          },
          plugins: { legend: { labels: { boxWidth: 10 } } },
        },
      });

      ldgPointDataset = {
        type: "scatter",
        label: "Current condition",
        data: [],
        yAxisID: "y1",
        pointRadius: 5,
        pointHoverRadius: 6,
      };

      ldgChart = new Chart(ctxLdg, {
        type: "line",
        data: {
          datasets: [
            { label: "Run ISA", data: ldgISA_run, tension: 0.2, yAxisID: "y1" },
            { label: "Run ISA+10", data: ldgISA10_run, tension: 0.2, yAxisID: "y1" },
            { label: "Run ISA+20", data: ldgISA20_run, tension: 0.2, yAxisID: "y1" },
            {
              label: "50 ft dist ISA",
              data: ldgISA_dist,
              borderDash: [4, 3],
              tension: 0.2,
              yAxisID: "y2",
            },
            {
              label: "50 ft dist ISA+10",
              data: ldgISA10_dist,
              borderDash: [4, 3],
              tension: 0.2,
              yAxisID: "y2",
            },
            {
              label: "50 ft dist ISA+20",
              data: ldgISA20_dist,
              borderDash: [4, 3],
              tension: 0.2,
              yAxisID: "y2",
            },
            ldgPointDataset,
          ],
        },
        options: {
          responsive: true,
          scales: {
            x: { type: "linear", title: { display: true, text: "Pressure altitude (ft)" } },
            y1: { position: "left", title: { display: true, text: "Landing run (m)" } },
            y2: {
              position: "right",
              title: { display: true, text: "Landing distance 50 ft (m)" },
              grid: { drawOnChartArea: false },
            },
          },
          plugins: { legend: { labels: { boxWidth: 10 } } },
        },
      });

      rocPointDataset = {
        type: "scatter",
        label: "Current condition",
        data: [],
        pointRadius: 5,
        pointHoverRadius: 6,
      };

      rocChart = new Chart(ctxRoc, {
        type: "line",
        data: {
          datasets: [
            { label: "Vz ISA", data: rocISA, tension: 0.2 },
            { label: "Vz ISA+10", data: rocISA10, tension: 0.2 },
            { label: "Vz ISA+20", data: rocISA20, tension: 0.2 },
            rocPointDataset,
          ],
        },
        options: {
          responsive: true,
          scales: {
            x: { type: "linear", title: { display: true, text: "Pressure altitude (ft)" } },
            y: { title: { display: true, text: "Rate of climb (ft/min)" } },
          },
          plugins: { legend: { labels: { boxWidth: 10 } } },
        },
      });
      const graphsBlock = document.getElementById("graphsBlock");
      if (graphsBlock) {
        graphsBlock.addEventListener("toggle", () => {
          if (graphsBlock.open) {
            // The details element needs a frame to finish opening before Chart.js can measure it.
            requestAnimationFrame(() => {
              try { toChart && toChart.resize(); } catch (e) { }
              try { ldgChart && ldgChart.resize(); } catch (e) { }
              try { rocChart && rocChart.resize(); } catch (e) { }
            });
          }
        });
      }
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

      if (wbOk) {
        wbStatusPill.textContent = "All points inside AFM envelope and limits";
        wbStatusPill.classList.remove("bad");
        wbStatusPill.classList.add("ok");
      } else {
        wbStatusPill.textContent = "Check W&B – outside AFM limits";
        wbStatusPill.classList.remove("ok");
        wbStatusPill.classList.add("bad");
      }

      if (cgDepDataset && cgArrDataset) {
        cgDepDataset.data = (isFinite(cgTO) && isFinite(massTO)) ? [{ x: cgTO, y: massTO }] : [];
        cgArrDataset.data = (isFinite(cgLW) && isFinite(massLW)) ? [{ x: cgLW, y: massLW }] : [];
        cgChart.update();
      }

      const fieldElev = parseFloat(document.getElementById("fieldElev").value) || 0;
      const qnh = parseFloat(document.getElementById("qnh").value) || 1013.25;
      const oat = parseFloat(document.getElementById("oat").value) || 0;
      if (arrivalUsesDepartureRunway) copyDepartureToArrival();
      updateArrivalWeatherControls();
      const arrivalWeatherUsesDeparture = arrivalUsesDepartureRunway || !!document.getElementById("arrUseDepWeather")?.checked;
      if (arrivalWeatherUsesDeparture) copyDepartureWeatherToArrival();
      const surface = document.getElementById("surface").value;
      const surfaceCfg = GRASS_FACTORS[surface] || GRASS_FACTORS.hard_dry;
      const arrSurface = document.getElementById("arrSurface").value;
      const arrSurfaceCfg = GRASS_FACTORS[arrSurface] || GRASS_FACTORS.hard_dry;
      const usingWet = !!arrSurfaceCfg.wetLanding;
      const runwayTora = parseFloat(document.getElementById("runwayTora").value) || 1;
      const runwayToda = parseFloat(document.getElementById("runwayToda").value) || 1;
      const runwayAsda = parseFloat(document.getElementById("runwayAsda").value) || 1;
      const runwayLda = parseFloat(document.getElementById("arrLda").value) || 1;
      const declaredRunwayLength = Math.max(runwayTora, runwayToda, runwayAsda, runwayLda, 1);

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

      const arrWindDirRaw = String(document.getElementById("arrWindDir").value || "").trim().toUpperCase();
      const arrWindSpd = parseFloat(document.getElementById("arrWindSpd").value) || 0;
      const arrWind = computeWindComponentsForHeading(arrWindDirRaw, arrWindSpd, arrHeading);
      const arrWindIsVRB = arrWind.windIsVRB;
      const arrHeadwind = arrWind.headwind;
      const arrCrosswind = arrWind.crosswind;
      const arrTailwind = arrHeadwind < 0 ? -arrHeadwind : 0;

      const windComponentsEl = document.getElementById("windComponents");
      const windLimitWarn = document.getElementById("windLimitWarn");

      const headStr =
        headwind >= 0
          ? `Headwind ${round(headwind, 1)} kt`
          : `Tailwind ${round(tailwind, 1)} kt`;
      const xwStr = windIsVRB
        ? "Crosswind not assessed (VRB)"
        : `Crosswind ${round(Math.abs(crosswind), 1)} kt`;

      let xwWarn = "";
      if (windIsVRB || arrWindIsVRB) {
        xwWarn = " – VRB treated as full tailwind for performance where entered";
      } else if (Math.max(Math.abs(crosswind), Math.abs(arrCrosswind)) > MAX_XWIND) {
        xwWarn = " – ABOVE max demonstrated 18 kt";
      } else {
        xwWarn = " – within demonstrated limit";
      }

      const arrHeadStr = arrHeadwind >= 0 ? `Headwind ${round(arrHeadwind, 1)} kt` : `Tailwind ${round(arrTailwind, 1)} kt`;
      const arrXwStr = arrWindIsVRB ? "Crosswind not assessed (VRB)" : `Crosswind ${round(Math.abs(arrCrosswind), 1)} kt`;
      const arrWeatherNote = arrivalWeatherUsesDeparture ? "same weather" : "separate arrival weather";
      windComponentsEl.innerHTML = `
        <div><strong>DEP</strong> ${headStr}, ${xwStr}</div>
        <div><strong>ARR</strong> ${arrHeadStr}, ${arrXwStr} (${arrWeatherNote})</div>
        <div>${xwWarn.replace(/^ – /, "")}</div>
      `;

      const tailwindOk = tailwind <= MAX_RECOMMENDED_TAILWIND && arrTailwind <= MAX_RECOMMENDED_TAILWIND;
      const crosswindOk = (windIsVRB || arrWindIsVRB) ? true : Math.max(Math.abs(crosswind), Math.abs(arrCrosswind)) <= MAX_XWIND;
      const windOk = windSpd <= MAX_WIND && arrWindSpd <= MAX_WIND && crosswindOk && tailwindOk;

      const windWarnings = [];
      if (windIsVRB && windSpd > 0) windWarnings.push(`Departure VRB wind treated as full ${round(windSpd, 1)} kt tailwind for performance. Crosswind is not assessed.`);
      if (arrWindIsVRB && arrWindSpd > 0) windWarnings.push(`Arrival VRB wind treated as full ${round(arrWindSpd, 1)} kt tailwind for performance. Crosswind is not assessed.`);
      if (!windIsVRB && windSpd > 0 && !Number.isFinite(parsedWindDir)) windWarnings.push("Departure wind direction should be degrees true or VRB.");
      if (!arrWindIsVRB && arrWindSpd > 0 && !Number.isFinite(arrWind.parsedWindDir)) windWarnings.push("Arrival wind direction should be degrees true or VRB.");
      if (windSpd > MAX_WIND) windWarnings.push(`Departure not permitted – departure wind speed ${round(windSpd, 1)} kt exceeds 40 kt limit.`);
      if (arrWindSpd > MAX_WIND) windWarnings.push(`Arrival wind speed ${round(arrWindSpd, 1)} kt exceeds 40 kt limit.`);
      if (tailwind > MAX_RECOMMENDED_TAILWIND) windWarnings.push(`Departure tailwind ${round(tailwind, 1)} kt exceeds AFM recommended maximum ${MAX_RECOMMENDED_TAILWIND} kt.`);
      if (arrTailwind > MAX_RECOMMENDED_TAILWIND) windWarnings.push(`Arrival tailwind ${round(arrTailwind, 1)} kt exceeds AFM recommended maximum ${MAX_RECOMMENDED_TAILWIND} kt.`);
      if (tailwind > WIND_FACTOR_LIMIT_TAIL || arrTailwind > WIND_FACTOR_LIMIT_TAIL) windWarnings.push(`Tailwind correction is capped at ${WIND_FACTOR_LIMIT_TAIL} kt for chart validity.`);
      if (headwind > WIND_FACTOR_LIMIT_HEAD || arrHeadwind > WIND_FACTOR_LIMIT_HEAD) windWarnings.push(`Headwind correction is capped at ${WIND_FACTOR_LIMIT_HEAD} kt for chart validity.`);

      if (windWarnings.length > 0) {
        windLimitWarn.style.display = "block";
        windLimitWarn.textContent = windWarnings.join(" ");
      } else {
        windLimitWarn.style.display = "none";
      }

      const baseTO = interpTOLD(pa, isaDev, TO_TABLE);
      const baseLDG = interpTOLD(arrPa, arrIsaDev, LDG_TABLE);
      const grass = surfaceCfg;
      const landingSurface = arrSurfaceCfg;

      const toAirborneNoWind = Math.max(0, baseTO.dist - baseTO.run);
      const toRunNoWind = baseTO.run * grass.to;
      const toDistNoWind = toRunNoWind + toAirborneNoWind;

      const ldgAirborneNoWind = Math.max(0, baseLDG.dist - baseLDG.run);
      const ldgRunNoWind = baseLDG.run * landingSurface.ldg;
      const ldgDistNoWind = ldgRunNoWind + ldgAirborneNoWind;

      const toRun = toRunNoWind * windCorrectionFactor("takeoff_run", headwind);
      const toDist = toDistNoWind * windCorrectionFactor("takeoff_distance", headwind);
      const ldgRun = ldgRunNoWind * windCorrectionFactor("landing_run", arrHeadwind);
      const ldgDist = ldgDistNoWind * windCorrectionFactor("landing_distance", arrHeadwind);

      document.getElementById("toRun").textContent = round(toRun, 0);
      document.getElementById("toDist").textContent = round(toDist, 0);
      document.getElementById("ldgRun").textContent = round(ldgRun, 0);
      document.getElementById("ldgDist").textContent = round(ldgDist, 0);

      const roc = interpRoc(pa, isaDev);
      document.getElementById("roc").textContent = round(roc, 0);

      // Ops Manual factored runway requirements.
      const reqTora125 = toDist * 1.25;       // Ops Manual factor / no stopway-style check
      const reqToraRun = toRun;               // with stopway: TORA >= AFM run
      const reqToda115 = toDist * 1.15;       // TODA >= 1.15 * AFM distance
      const reqAsda130 = toRun * 1.3;         // ASDA >= 1.3 * AFM run

      const reqLdaDry = ldgDist / 0.7;        // Ops Manual: AFM landing distance must fit in 70% LDA
      const reqLdaWet = ldgDist * 1.15 / 0.7; // Ops Manual: wet factor before 70% LDA check

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

      if (toPointDataset && ldgPointDataset && rocPointDataset) {
        toPointDataset.data = [{ x: pa, y: toRun }];
        ldgPointDataset.data = [{ x: arrPa, y: ldgRun }];
        rocPointDataset.data = [{ x: pa, y: roc }];
        toChart.update();
        ldgChart.update();
        rocChart.update();
      }

      const bar = document.getElementById("runwayBar");
      const barWidth = bar.clientWidth || 1;

      function setMarker(id, dist) {
        const el = document.getElementById(id);
        const ratio = dist / declaredRunwayLength;
        const widthPx = Math.min(barWidth, Math.max(0, ratio * barWidth));
        el.style.width = widthPx + "px";

        if (dist > declaredRunwayLength) el.classList.add("overrun");
        else el.classList.remove("overrun");
      }

      setMarker("barToRun", toRun);
      setMarker("barToDist", toDist);
      setMarker("barLdgRun", ldgRun);
      setMarker("barLdgDist", ldgDist);

      function setTick(id, dist) {
        const el = document.getElementById(id);
        if (!el) return;
        const ratio = dist / declaredRunwayLength;
        const xPx = clamp(ratio, 0, 1) * barWidth;
        el.style.left = xPx + "px";
      }

      setTick("tickRunwayEnd", runwayTora);
      setTick("tickReqTora125", activeReqToraVal);

      const activeReqLda = usingWet ? reqLdaWet : reqLdaDry;
      setTick("tickReqLda", activeReqLda);

      document.getElementById("declRwy").textContent = `${formatRunwayLabel()} (${round(rwHeading, 0)}°T)`;
      document.getElementById("declArrRwy").textContent = `${formatArrivalRunwayLabel()} (${round(arrHeading, 0)}°T)`;
      document.getElementById("declTora").textContent = `${round(runwayTora, 0)} m`;
      document.getElementById("declToda").textContent = `${round(runwayToda, 0)} m`;
      document.getElementById("declAsda").textContent = `${round(runwayAsda, 0)} m`;
      document.getElementById("declLda").textContent = `${round(runwayLda, 0)} m`;

      const surfaceLabel = surfaceCfg.label || "CUSTOM";
      const arrSurfaceLabel = arrSurfaceCfg.label || "CUSTOM";
      document.getElementById("declSurface").textContent = `DEP: ${surfaceLabel} / ARR: ${arrSurfaceLabel}`;

      const limiterStrip = document.getElementById("limiterStrip");
      const limiterText = document.getElementById("limiterText");

      const activeReqLdaVal = usingWet ? reqLdaWet : reqLdaDry;
      const activeLdaOk = usingWet ? ldaWetOk : ldaDryOk;

      let limiting = [];
      if (!activeTakeoffOk) {
        if (declaredStopwayOrClearway) {
          if (!toraRunOk) limiting.push(`Take-off: TORA ${round(runwayTora, 0)} m < AFM run ${round(reqToraRun, 0)} m`);
          if (!toda115Ok) limiting.push(`Take-off: TODA ${round(runwayToda, 0)} m < 1.15 × AFM distance ${round(reqToda115, 0)} m`);
          if (!asda130Ok) limiting.push(`Take-off: ASDA ${round(runwayAsda, 0)} m < 1.3 × AFM run ${round(reqAsda130, 0)} m`);
        } else {
          limiting.push(`Take-off: required TORA ${round(reqTora125, 0)} m > available ${round(runwayTora, 0)} m`);
        }
      }
      if (!activeLdaOk) limiting.push(`Landing: REQ LDA ${round(activeReqLdaVal, 0)} > AVAIL ${round(runwayLda, 0)} m`);

      if (limiting.length === 0) {
        limiterText.textContent = `OK — required distances within available runway.`;
        limiterStrip.classList.add("ok");
        limiterStrip.classList.remove("bad");
      } else {
        limiterText.textContent = `LIMITED — ` + limiting.join(" | ");
        limiterStrip.classList.add("bad");
        limiterStrip.classList.remove("ok");
      }



      const sumWbText = wbOk
        ? `OK – TOW ${round(massTO, 1)} kg at ${round(cgTO, 0)} mm; landing weight ${round(massLW, 1)} kg at ${round(cgLW, 0)} mm. Fuel and baggage within AFM limits.`
        : `NOT OK – check masses, CG envelope, fuel (≤ ${MAX_FUEL_KG} kg / ${MAX_FUEL_L} L) and baggage (≤ ${MAX_BAG_KG} kg).`;
      setSummaryLine("sumWb", sumWbText, wbOk);

      const toOk = activeTakeoffOk;
      const sumPerfToText = declaredStopwayOrClearway
        ? (toOk
          ? `OK – stopway/clearway declared-distance checks pass: TORA ≥ ${round(reqToraRun, 0)} m, TODA ≥ ${round(reqToda115, 0)} m, ASDA ≥ ${round(reqAsda130, 0)} m.`
          : `NOT OK – one or more stopway/clearway declared-distance checks fail: TORA ≥ ${round(reqToraRun, 0)} m, TODA ≥ ${round(reqToda115, 0)} m, ASDA ≥ ${round(reqAsda130, 0)} m required.`)
        : (toOk
          ? `OK – no stopway/clearway used: Ops Manual TORA check (1.25 × AFM 50 ft = ${round(reqTora125, 0)} m) ≤ available TORA ${round(runwayTora, 0)} m.`
          : `NOT OK – no stopway/clearway used: Ops Manual TORA check (1.25 × AFM 50 ft = ${round(reqTora125, 0)} m) exceeds available TORA ${round(runwayTora, 0)} m.`);
      setSummaryLine("sumPerfTo", sumPerfToText, toOk);

      const ldgCriterionOk = usingWet ? ldaWetOk : ldaDryOk;
      const sumPerfLdgText = usingWet
        ? (ldgCriterionOk
          ? `OK – AFM landing distance = ${round(ldgDist, 0)} m; Ops Manual wet LDA check (×1.15 ÷0.7) = ${round(reqLdaWet, 0)} m ≤ available ${round(runwayLda, 0)} m.`
          : `NOT OK – Ops Manual wet LDA check (AFM ×1.15 ÷0.7 = ${round(reqLdaWet, 0)} m) exceeds available ${round(runwayLda, 0)} m.`)
        : (ldgCriterionOk
          ? `OK – AFM landing distance = ${round(ldgDist, 0)} m; Ops Manual dry LDA check (÷0.7) = ${round(reqLdaDry, 0)} m ≤ available ${round(runwayLda, 0)} m.`
          : `NOT OK – Ops Manual dry LDA check (AFM ÷0.7 = ${round(reqLdaDry, 0)} m) exceeds available ${round(runwayLda, 0)} m.`);
      setSummaryLine("sumPerfLdg", sumPerfLdgText, ldgCriterionOk);

      const sumWindText = windOk
        ? `${arrivalWeatherUsesDeparture ? "OK" : "OK – separate arrival weather used"} – departure ${headStr.toLowerCase()}, ${xwStr.toLowerCase()}; arrival ${arrHeadStr.toLowerCase()}, ${arrXwStr.toLowerCase()}. Wind speeds ≤ 40 kt, crosswind within 18 kt demonstrated where assessed, tailwind within ${MAX_RECOMMENDED_TAILWIND} kt recommendation.`
        : `NOT OK – wind limits/recommendations exceeded (departure wind ${round(windSpd, 1)} kt, tailwind ${round(tailwind, 1)} kt; arrival wind ${round(arrWindSpd, 1)} kt, tailwind ${round(arrTailwind, 1)} kt).`;
      setSummaryLine("sumWind", sumWindText, windOk);

      const runwayOk = toOk && ldgCriterionOk;
      const runwayLabelForSummary = formatRunwayLabel();
      const arrivalLabelForSummary = formatArrivalRunwayLabel();
      const sumRunwayText = runwayOk
        ? `Departure ${runwayLabelForSummary} TORA ${round(runwayTora, 0)} m, TODA ${round(runwayToda, 0)} m, ASDA ${round(runwayAsda, 0)} m and arrival ${arrivalLabelForSummary} LDA ${round(runwayLda, 0)} m are sufficient for current requirements.`
        : `Departure ${runwayLabelForSummary} declared distances (TORA ${round(runwayTora, 0)} m, TODA ${round(runwayToda, 0)} m, ASDA ${round(runwayAsda, 0)} m) or arrival ${arrivalLabelForSummary} LDA ${round(runwayLda, 0)} m are insufficient for current requirements.`;
      setSummaryLine("sumRunway", sumRunwayText, runwayOk);

      const go = wbOk && windOk && runwayOk;
      const reasons = [];
      if (!wbOk) reasons.push("W&B outside AFM limits");
      if (!toOk) reasons.push("take-off distance requirement not met");
      if (!ldgCriterionOk) reasons.push("landing distance requirement not met");
      if (!windOk) reasons.push("wind limits exceeded");

      const pill = document.getElementById("sumPill");
      if (go) {
        pill.textContent = "Decision: GO – all checks satisfied (still apply judgement & margins).";
        pill.classList.remove("bad");
        pill.classList.add("ok");
      } else {
        pill.textContent = "Decision: NO-GO – " + reasons.join("; ");
        pill.classList.remove("ok");
        pill.classList.add("bad");
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
      const depSurfaceText = GRASS_FACTORS[getValue("surface")]?.label || getSelectedText("surface") || "CUSTOM";
      const arrSurfaceText = GRASS_FACTORS[getValue("arrSurface")]?.label || getSelectedText("arrSurface") || "CUSTOM";
      const decisionText = getText("sumPill");
      const decisionClass = decisionText.includes("NO-GO") ? "decision bad-bg" : decisionText.includes("GO") ? "decision ok-bg" : "decision";

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${reportTitle}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; font-size: 11px; }
    h1 { font-size: 18px; margin: 0 0 4px; letter-spacing: 0.04em; text-transform: uppercase; }
    h2 { font-size: 12px; margin: 14px 0 6px; letter-spacing: 0.06em; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
    .muted { color: #475569; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; }
    .box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; break-inside: avoid; }
    .kv { display: grid; grid-template-columns: 42% 58%; gap: 3px 8px; }
    .k { color: #475569; }
    .v { font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; table-layout: fixed; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 4px 5px; text-align: left; vertical-align: top; }
    th { color: #475569; text-transform: uppercase; font-size: 9px; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .moment-table col.item { width: 34%; }
    .moment-table col.mass { width: 16%; }
    .moment-table col.arm { width: 16%; }
    .moment-table col.moment { width: 34%; }
    .moment-table tfoot td { font-weight: 700; }
    .ok { color: #047857; font-weight: 700; }
    .bad { color: #b91c1c; font-weight: 700; }
    .ok-bg { border-color: #16a34a; background: #dcfce7; color: #166534; }
    .bad-bg { border-color: #dc2626; background: #fee2e2; color: #991b1b; }
    .decision { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; font-weight: 700; }
    .footer { margin-top: 14px; font-size: 9px; color: #475569; border-top: 1px solid #cbd5e1; padding-top: 6px; }
    @media print { button { display:none; } }
  </style>
</head>
<body>
  <h1>${reportTitle}</h1>
  <div class="muted">Generated ${escHtml(now.toLocaleString())}. Unofficial helper - AFM and Ops Manual remain authoritative.</div>

  <h2>Aircraft and loading</h2>
  <div class="grid">
    <div class="box kv">
      <div class="k">Registration</div><div class="v">${escHtml(getSelectedText("regSelect"))}</div>
      <div class="k">Empty aircraft</div><div class="v">${escHtml(getValue("emptyWeight"))} kg @ ${escHtml(getValue("emptyArm"))} mm</div>
      <div class="k">Upholstery</div><div class="v">${escHtml(getValue("upholsteryWt"))} kg @ ${escHtml(getValue("upholsteryArm"))} mm</div>
      <div class="k">Pilot</div><div class="v">${escHtml(getValue("pilotWt"))} kg @ ${escHtml(getValue("pilotArm"))} mm</div>
      <div class="k">Passenger</div><div class="v">${escHtml(getValue("paxWt"))} kg @ ${escHtml(getValue("paxArm"))} mm</div>
      <div class="k">Baggage</div><div class="v">${escHtml(getValue("bagWt"))} kg @ 1580 mm</div>
      <div class="k">Fuel</div><div class="v">${escHtml(getValue("fuelL"))} L / ${escHtml(getText("fuelKg")) || escHtml(getValue("fuelKg"))} kg (${escHtml(getSelectedText("fuelType"))})</div>
    </div>
    <div class="box kv">
      <div class="k">Departure</div><div class="v">${escHtml(getText("tow"))} kg @ ${escHtml(getText("cg"))} mm</div>
      <div class="k">Arrival</div><div class="v">${escHtml(getText("lw"))} kg @ ${escHtml(getText("cgArr"))} mm</div>
      <div class="k">W&B status</div><div class="v">${escHtml(getText("wbStatusPill"))}</div>
    </div>
  </div>

  <h2>Moment breakdown</h2>
  <table class="moment-table">
    <colgroup>
      <col class="item"><col class="mass"><col class="arm"><col class="moment">
    </colgroup>
    <thead><tr><th>Item</th><th class="num">Mass kg</th><th class="num">Arm mm</th><th class="num">Moment</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr><td><strong>Total with fuel</strong></td><td class="num">${escHtml(getText("mtMassTO"))}</td><td class="num">${escHtml(getText("mtArmTO"))}</td><td class="num">${escHtml(getText("mtMomTO"))}</td></tr>
      <tr><td><strong>Total no fuel</strong></td><td class="num">${escHtml(getText("mtMassLW"))}</td><td class="num">${escHtml(getText("mtArmLW"))}</td><td class="num">${escHtml(getText("mtMomLW"))}</td></tr>
    </tfoot>
  </table>

  <h2>Conditions and runway</h2>
  <div class="grid">
    <div class="box kv">
      <div class="k">Departure runway</div><div class="v">${escHtml(getText("declRwy"))}</div>
      <div class="k">Arrival runway</div><div class="v">${escHtml(getText("declArrRwy"))}</div>
      <div class="k">Departure surface</div><div class="v">${escHtml(depSurfaceText)}</div>
      <div class="k">Arrival surface</div><div class="v">${escHtml(arrSurfaceText)}</div>
      <div class="k">TORA / TODA</div><div class="v">${escHtml(getText("declTora"))} / ${escHtml(getText("declToda"))}</div>
      <div class="k">ASDA / arrival LDA</div><div class="v">${escHtml(getText("declAsda"))} / ${escHtml(getText("declLda"))}</div>
    </div>
    <div class="box kv">
      <div class="k">Field elevation</div><div class="v">${escHtml(getValue("fieldElev"))} ft</div>
      <div class="k">QNH</div><div class="v">${escHtml(getValue("qnh"))} hPa</div>
      <div class="k">Pressure altitude</div><div class="v">${escHtml(getValue("pa"))} ft</div>
      <div class="k">OAT / ISA dev</div><div class="v">${escHtml(getValue("oat"))} °C / ${escHtml(getValue("isaDev"))} °C</div>
      <div class="k">Departure wind</div><div class="v">${escHtml((String(getValue("windDir")).trim().toUpperCase() === "VRB") ? "VRB" : `${getValue("windDir")}°T`)} / ${escHtml(getValue("windSpd"))} kt</div>
      <div class="k">Arrival wind</div><div class="v">${escHtml((String(getValue("arrWindDir")).trim().toUpperCase() === "VRB") ? "VRB" : `${getValue("arrWindDir")}°T`)} / ${escHtml(getValue("arrWindSpd"))} kt</div>
      <div class="k">Wind components</div><div class="v">${escHtml(getText("windComponents"))}</div>
    </div>
  </div>

  <h2>Performance</h2>
  <div class="grid">
    <div class="box kv">
      <div class="k">T/O run</div><div class="v">${escHtml(getText("toRun"))} m</div>
      <div class="k">T/O distance to 50 ft</div><div class="v">${escHtml(getText("toDist"))} m</div>
      <div class="k">Required TORA</div><div class="v">${escHtml(getText("reqTora125"))} m</div>
      <div class="k">TODA / ASDA checks</div><div class="v">${escHtml(getText("reqToda115"))} m / ${escHtml(getText("reqAsda130"))} m</div>
    </div>
    <div class="box kv">
      <div class="k">Landing run</div><div class="v">${escHtml(getText("ldgRun"))} m</div>
      <div class="k">Landing distance from 50 ft</div><div class="v">${escHtml(getText("ldgDist"))} m</div>
      <div class="k">Required LDA dry</div><div class="v">${escHtml(getText("reqLdaDry"))} m</div>
      <div class="k">Required LDA wet</div><div class="v">${escHtml(getText("reqLdaWet"))} m</div>
      <div class="k">Rate of climb</div><div class="v">${escHtml(getText("roc"))} ft/min</div>
    </div>
  </div>

  <h2>Operational summary</h2>
  <div class="box">
    <p><strong>W&B:</strong> ${escHtml(getText("sumWb"))}</p>
    <p><strong>Take-off:</strong> ${escHtml(getText("sumPerfTo"))}</p>
    <p><strong>Landing:</strong> ${escHtml(getText("sumPerfLdg"))}</p>
    <p><strong>Wind:</strong> ${escHtml(getText("sumWind"))}</p>
    <p><strong>Runway:</strong> ${escHtml(getText("sumRunway"))}</p>
    <div class="${decisionClass}">${escHtml(decisionText)}</div>
  </div>

  <div class="footer">This PDF is a snapshot of the app data. It is not an AFM replacement.</div>
  <script>window.onload = () => { window.print(); };<\/script>
</body>
</html>`;

      const win = window.open("", "_blank");
      if (!win) {
        alert("Popup blocked. Please allow popups for this page, then try Export PDF again.");
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
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
      buildPerfCharts();

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
          const useDepWeather = document.getElementById("arrUseDepWeather");
          if (useDepWeather) useDepWeather.checked = true;
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

      document.getElementById("arrUseDepWeather").addEventListener("change", () => {
        updateArrivalWeatherControls();
        updateRunwayEditState();
        calculateAll();
      });

      ["qnh", "oat", "windDir", "windSpd"].forEach(id => {
        document.getElementById(id).addEventListener("input", () => {
          if (document.getElementById("arrUseDepWeather")?.checked) copyDepartureWeatherToArrival();
        });
      });

      updateArrivalWeatherControls();
      updateRunwayEditState();
      calculateAll();
      window.addEventListener("resize", calculateAll);
    });
