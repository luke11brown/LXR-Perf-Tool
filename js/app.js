    let REG_DATA = {};
    let FUEL_TYPES = [];
    let LOADING_CONFIG = {};
    let WEATHER_MINIMA = {};
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

    async function loadFuelTypes() {
      FUEL_TYPES = await loadJson("./data/fuel-types.json", "fuel type data");
    }

    async function loadLoadingConfig() {
      LOADING_CONFIG = await loadJson("./data/loading.json", "loading data");
    }

    async function loadWeatherMinima() {
      WEATHER_MINIMA = await loadJson("./data/weather-minima.json", "weather minima data");
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
    let departureTaf = null;
    let arrivalTaf = null;
    const METAR_STALE_MINUTES = 90;
    const METAR_FETCH_TIMEOUT_MS = 12000;
    const TAF_ADVISORY_HOURS = 6;
    const EMY_AVIATION_URL = "https://emy.gr/en/aviation";
    const EMY_PROXY_URL = "https://api.codetabs.com/v1/proxy?quest=";
    let emyCharts = { wind: [], sigwx: [], updatedAt: null, error: null };

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
      updateIntersectionControls();
    }

    function populateAircraftSelect() {
      const select = document.getElementById("regSelect");
      if (!select) return;
      const previousValue = select.value || "custom";
      select.innerHTML = `<option value="custom">Custom / manual</option>`;

      Object.keys(REG_DATA).forEach((reg) => {
        const opt = document.createElement("option");
        opt.value = reg;
        opt.textContent = reg;
        select.appendChild(opt);
      });

      select.value = REG_DATA[previousValue] ? previousValue : "custom";
    }

    function populateFuelTypeSelect() {
      const select = document.getElementById("fuelType");
      if (!select) return;
      const previousValue = select.value;
      select.innerHTML = "";

      FUEL_TYPES.forEach((fuel) => {
        const density = Number(fuel.densityKgPerL);
        if (!fuel.id || !Number.isFinite(density)) return;
        const opt = document.createElement("option");
        opt.value = String(density);
        opt.textContent = `${fuel.label || fuel.id} (${density} kg/L)`;
        opt.dataset.fuelId = fuel.id;
        if (fuel.default) opt.selected = true;
        select.appendChild(opt);
      });

      if ([...select.options].some((opt) => opt.value === previousValue)) {
        select.value = previousValue;
      }
    }

    function setInputValue(id, value) {
      const el = document.getElementById(id);
      if (!el || value === undefined || value === null) return;
      el.value = value;
    }

    function formatDurationHhmm(hours) {
      const finiteHours = Math.max(0, Number(hours) || 0);
      const totalMinutes = Math.round(finiteHours * 60);
      const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
      const mm = String(totalMinutes % 60).padStart(2, "0");
      return `${hh}${mm}`;
    }

    function parseDurationHhmm(value) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const colonMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
      if (colonMatch) {
        const hours = Number(colonMatch[1]);
        const minutes = Number(colonMatch[2]);
        return Number.isFinite(hours) && Number.isFinite(minutes) ? Math.max(0, hours + Math.min(minutes, 59) / 60) : 0;
      }
      const digits = raw.replace(/\D/g, "");
      if (digits.length >= 3) {
        const padded = digits.padStart(4, "0").slice(-4);
        const hours = Number(padded.slice(0, 2));
        const minutes = Number(padded.slice(2, 4));
        return Number.isFinite(hours) && Number.isFinite(minutes) ? Math.max(0, hours + Math.min(minutes, 59) / 60) : 0;
      }
      const decimalHours = Number(raw);
      return Number.isFinite(decimalHours) ? Math.max(0, decimalHours) : 0;
    }

    function normalizeDurationField(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = formatDurationHhmm(parseDurationHhmm(el.value));
    }

    function populateSeatArmSelect(selectId) {
      const select = document.getElementById(selectId);
      if (!select) return;
      const previousValue = select.value;
      select.innerHTML = "";

      (LOADING_CONFIG.seatArms || []).forEach((seatArm) => {
        const arm = Number(seatArm.armMm);
        if (!Number.isFinite(arm)) return;
        const opt = document.createElement("option");
        opt.value = String(arm);
        opt.textContent = `${seatArm.label || arm} (${arm})`;
        if (seatArm.default) opt.selected = true;
        select.appendChild(opt);
      });

      if ([...select.options].some((opt) => opt.value === previousValue)) {
        select.value = previousValue;
      }
    }

    function applyLoadingDefaults() {
      const defaults = LOADING_CONFIG.defaults || {};
      const stations = LOADING_CONFIG.stations || {};
      setInputValue("emptyWeight", defaults.emptyWeightKg);
      setInputValue("emptyArm", defaults.emptyArmMm);
      setInputValue("upholsteryWt", defaults.upholsteryWeightKg);
      setInputValue("upholsteryArm", defaults.upholsteryArmMm);
      setInputValue("pilotWt", defaults.pilotWeightKg);
      setInputValue("paxWt", defaults.passengerWeightKg);
      setInputValue("fuelL", defaults.fuelLiters);
      setInputValue("flightDurationH", typeof defaults.flightDurationHours === "number" ? formatDurationHhmm(defaults.flightDurationHours) : defaults.flightDurationHours);
      setInputValue("fuelBurnLph", defaults.fuelConsumptionLph);
      setInputValue("bagArm", stations.baggageArmMm);
      populateSeatArmSelect("pilotArm");
      populateSeatArmSelect("paxArm");
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

    function runwayDesignatorParts(runway) {
      const source = runway?.id || runway?.label || "";
      const match = String(source).toUpperCase().match(/^([A-Z]{4})[_\s-]?(\d{2})([LRC])?$/);
      if (!match) return null;
      return { icao: match[1], number: Number(match[2]), suffix: match[3] || "" };
    }

    function reciprocalRunwayDesignator(parts) {
      if (!parts) return "";
      const reciprocalNumber = ((parts.number + 17) % 36) + 1;
      const suffixMap = { L: "R", R: "L", C: "C" };
      return `${parts.icao}_${String(reciprocalNumber).padStart(2, "0")}${suffixMap[parts.suffix] || ""}`;
    }

    function getReciprocalRunway(runway) {
      const reciprocalId = reciprocalRunwayDesignator(runwayDesignatorParts(runway));
      return reciprocalId ? PRESET_RUNWAYS[reciprocalId] || null : null;
    }

    function runwayIntersections(runway) {
      return Array.isArray(runway?.intersections) ? runway.intersections : [];
    }

    function runwayReferenceLength(runway, fallbackLda = 0) {
      return Math.max(Number(runway?.tora) || 0, Number(runway?.lda) || 0, Number(fallbackLda) || 0);
    }

    function thresholdOffsetForRunway(runway, fallbackLda = 0) {
      const referenceLength = runwayReferenceLength(runway, fallbackLda);
      const lda = Number(runway?.lda) || Number(fallbackLda) || referenceLength;
      return Math.max(0, referenceLength - lda);
    }

    function arrivalVacateDistanceFromThreshold(runway, source, intersection, fallbackLda = 0) {
      if (!runway || !intersection) return null;
      const referenceLength = runwayReferenceLength(runway, fallbackLda);
      const thresholdOffset = thresholdOffsetForRunway(runway, fallbackLda);
      const intersectionTora = Number(intersection.tora);
      if (!Number.isFinite(intersectionTora)) return null;
      const distanceFromRunwayStart = source === "recip"
        ? intersectionTora
        : Math.max(0, referenceLength - intersectionTora);
      return Math.max(0, distanceFromRunwayStart - thresholdOffset);
    }

    function updateSelectOptions(selectId, options, emptyLabel, emptyValue = "none") {
      const select = document.getElementById(selectId);
      if (!select) return;
      const previousValue = select.value;
      select.innerHTML = "";
      const emptyOption = document.createElement("option");
      emptyOption.value = emptyValue;
      emptyOption.textContent = emptyLabel;
      select.appendChild(emptyOption);
      options.forEach((option) => {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label;
        opt.dataset.source = option.source || "";
        opt.dataset.index = option.index ?? "";
        select.appendChild(opt);
      });
      select.value = [...select.options].some(opt => opt.value === previousValue) ? previousValue : emptyValue;
      select.disabled = options.length === 0;
    }

    function setControlVisible(id, visible) {
      const el = document.getElementById(id);
      if (el) el.style.display = visible ? "" : "none";
    }

    function getArrivalRunwayForVisuals() {
      return arrivalUsesDepartureRunway ? getSelectedRunway("savedRunwaySelect") : getSelectedRunway("arrivalRunwaySelect");
    }

    function updateIntersectionControls() {
      const depRunway = getSelectedRunway("savedRunwaySelect");
      const depOptions = runwayIntersections(depRunway).map((intersection, index) => ({
        value: `dep:${index}`,
        source: "dep",
        index,
        label: `${intersection.label || intersection.id || `Intersection ${index + 1}`} (${intersection.tora ?? "?"} m TORA)`,
      }));
      updateSelectOptions("depIntersectionSelect", depOptions, "Full length", "full");
      setControlVisible("depIntersectionControl", depOptions.length > 0);

      const arrRunway = getArrivalRunwayForVisuals();
      const reciprocalRunway = getReciprocalRunway(arrRunway);
      const arrOptions = [
        ...runwayIntersections(arrRunway).map((intersection, index) => ({
          value: `arr:${index}`,
          source: "arr",
          index,
          label: `${intersection.label || intersection.id || `Intersection ${index + 1}`} (${formatVacateDistanceForOption(arrRunway, "arr", intersection)})`,
        })),
        ...runwayIntersections(reciprocalRunway).map((intersection, index) => ({
          value: `recip:${index}`,
          source: "recip",
          index,
          label: `${intersection.label || intersection.id || `Intersection ${index + 1}`} (${formatVacateDistanceForOption(arrRunway, "recip", intersection)})`,
        })),
      ];
      updateSelectOptions("arrVacateSelect", arrOptions, "None", "none");
      setControlVisible("arrVacateControl", arrOptions.length > 0);
    }

    function formatVacateDistanceForOption(runway, source, intersection) {
      const distance = arrivalVacateDistanceFromThreshold(runway, source, intersection, Number(runway?.lda) || 0);
      return distance === null ? "distance unknown" : `${round(distance, 0)} m from threshold`;
    }

    function updateWeatherMinimaControls() {
      const flightRules = document.getElementById("flightRules")?.value || "vfr";
      setControlVisible("vfrPhaseField", flightRules === "vfr");
      setControlVisible("ifrAircraftClassField", flightRules === "ifr");
    }

    function getSelectedDepartureIntersection() {
      const select = document.getElementById("depIntersectionSelect");
      const runway = getSelectedRunway("savedRunwaySelect");
      if (!select || !runway || select.value === "full") return null;
      const selected = select.selectedOptions[0];
      const index = Number(selected?.dataset.index);
      return runwayIntersections(runway)[index] || null;
    }

    function getSelectedArrivalVacate() {
      const select = document.getElementById("arrVacateSelect");
      const runway = getArrivalRunwayForVisuals();
      if (!select || !runway || select.value === "none") return null;
      const selected = select.selectedOptions[0];
      const source = selected?.dataset.source;
      const index = Number(selected?.dataset.index);
      const reciprocalRunway = getReciprocalRunway(runway);
      const intersection = source === "recip"
        ? runwayIntersections(reciprocalRunway)[index]
        : runwayIntersections(runway)[index];
      if (!intersection) return null;
      const distanceFromThreshold = arrivalVacateDistanceFromThreshold(runway, source, intersection, Number(runway.lda) || 0);
      if (distanceFromThreshold === null) return null;
      return {
        ...intersection,
        distanceFromThreshold,
        label: intersection.label || intersection.id || "Intersection",
      };
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

    function initTabs() {
      const buttons = [...document.querySelectorAll(".tab-button[data-tab-target]")];
      const panels = [...document.querySelectorAll(".tab-panel")];
      buttons.forEach((button) => {
        button.addEventListener("click", () => {
          const targetId = button.dataset.tabTarget;
          buttons.forEach(btn => btn.classList.toggle("active", btn === button));
          panels.forEach(panel => panel.classList.toggle("active", panel.id === targetId));
        });
      });
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

    function formatUtcHm(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
      return `${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}`;
    }

    function formatUtcDayHm(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
      return `${String(date.getUTCDate()).padStart(2, "0")}${formatUtcHm(date)}`;
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

    function tafDateForDay(day, hour, minute = 0, reference = new Date()) {
      const ref = new Date(reference);
      const year = ref.getUTCFullYear();
      const month = ref.getUTCMonth();
      const candidates = [-1, 0, 1].map(offset => new Date(Date.UTC(year, month + offset, Number(day), Number(hour), Number(minute))));
      return candidates.reduce((best, candidate) =>
        Math.abs(candidate - ref) < Math.abs(best - ref) ? candidate : best
      );
    }

    function parseTafWindow(rawWindow, reference = new Date()) {
      const match = String(rawWindow || "").match(/(\d{2})(\d{2})\/(\d{2})(\d{2})/);
      if (!match) return null;
      let start = tafDateForDay(match[1], match[2], 0, reference);
      let end = tafDateForDay(match[3], match[4], 0, start);
      if (end <= start) end = new Date(end.getTime() + 31 * 24 * 60 * 60 * 1000);
      return { start, end };
    }

    function parseNoaaTimestamp(rawText) {
      const match = String(rawText || "").match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
      if (!match) return null;
      return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])));
    }

    function parseTaf(rawTaf) {
      const taf = String(rawTaf || "").trim().replace(/\s+/g, " ");
      const issuedAt = parseNoaaTimestamp(taf);
      const reference = issuedAt || new Date();
      const validWindow = taf.match(/\b(\d{4}\/\d{4})\b/)?.[1] || "";
      const baseWindow = parseTafWindow(validWindow, reference) || { start: reference, end: new Date(reference.getTime() + TAF_ADVISORY_HOURS * 3600000) };
      const tokens = taf.split(" ");
      const groups = [];
      let current = { type: "BASE", start: baseWindow.start, end: baseWindow.end, tokens: [] };

      tokens.forEach((token) => {
        const fm = token.match(/^FM(\d{2})(\d{2})(\d{2})$/);
        const tempo = token === "TEMPO";
        const prob = token.match(/^PROB\d{2}$/);
        if (fm) {
          groups.push(current);
          current = {
            type: "FM",
            start: tafDateForDay(fm[1], fm[2], fm[3], baseWindow.start),
            end: baseWindow.end,
            tokens: [],
          };
          return;
        }
        if (tempo || prob) {
          groups.push(current);
          current = { type: token, start: baseWindow.start, end: baseWindow.end, tokens: [] };
          return;
        }
        const groupWindow = token.match(/^(\d{4}\/\d{4})$/);
        if (groupWindow && current.type !== "BASE") {
          const parsedWindow = parseTafWindow(groupWindow[1], baseWindow.start);
          if (parsedWindow) {
            current.start = parsedWindow.start;
            current.end = parsedWindow.end;
            return;
          }
        }
        if (/^(TAF|AMD|COR)$/.test(token) || /^[A-Z]{4}$/.test(token) || /^\d{6}Z$/.test(token) || /^\d{4}\/\d{4}$/.test(token) || /^\d{4}\/\d{2}\/\d{2}$/.test(token) || /^\d{2}:\d{2}$/.test(token)) {
          return;
        }
        current.tokens.push(token);
      });
      groups.push(current);

      groups.forEach((group, index) => {
        if (group.type === "FM") {
          const nextFm = groups.slice(index + 1).find(candidate => candidate.type === "FM");
          if (nextFm) group.end = nextFm.start;
        }
      });

      return { raw: taf, groups, issuedAt, validFrom: baseWindow.start, validTo: baseWindow.end };
    }

    async function fetchTafForStation(station) {
      const noaaUrl = `https://tgftp.nws.noaa.gov/data/forecasts/taf/stations/${encodeURIComponent(station)}.TXT`;
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
      const rawTaf = lines.slice(1).join(" ") || lines[0] || "";
      if (!rawTaf.includes(station)) throw new Error("No TAF found for station");
      return parseTaf(rawTaf);
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

    async function fetchAndAssessTaf(target) {
      const isArrival = target === "arrival";
      const status = document.getElementById(isArrival ? "arrivalTafStatus" : "tafStatus");
      const button = document.getElementById(isArrival ? "fetchArrivalTafBtn" : "fetchTafBtn");
      const runway = isArrival
        ? getArrivalRunwayForVisuals() || getSelectedRunway("arrivalRunwaySelect") || getSelectedRunway("savedRunwaySelect")
        : getSelectedRunway("savedRunwaySelect");
      const station = getMetarStationFromRunway(runway);
      const runwayIcao = getRunwayIcao(runway);
      const stationLabel = runwayIcao && runwayIcao !== station ? `${station} for ${runwayIcao}` : station;

      if (!station) {
        status.textContent = isArrival
          ? "Select an arrival runway preset with an ICAO station first."
          : "Select a runway preset with an ICAO station first.";
        return;
      }

      button.disabled = true;
      status.textContent = `Fetching ${stationLabel} TAF from NOAA...`;
      try {
        const taf = await fetchTafForStation(station);
        if (isArrival) arrivalTaf = taf;
        else departureTaf = taf;
        calculateAll();
        const expired = taf.validTo instanceof Date && taf.validTo <= new Date();
        const validityText = taf.validFrom && taf.validTo
          ? `valid ${formatUtcDayHm(taf.validFrom)}/${formatUtcDayHm(taf.validTo)}`
          : "validity unknown";
        const issuedText = taf.issuedAt ? `issued ${formatUtcHm(taf.issuedAt)}, ` : "";
        const cautionText = expired ? " EXPIRED - do not use for current planning." : "";
        status.textContent = `${stationLabel} TAF applied (${issuedText}${validityText}).${cautionText} ${taf.raw}`;
      } catch (err) {
        if (isArrival) arrivalTaf = null;
        else departureTaf = null;
        calculateAll();
        status.textContent = `Could not fetch ${stationLabel} TAF: ${err.message}`;
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
        ? `OM-C HWC ${round(absComponent, 1)} kt (50% reported HWC)`
        : `OM-C TWC ${round(absComponent, 1)} kt (150% reported TWC)`;
    }

    function formatVisibilityKm(visibilityM) {
      if (visibilityM === null || visibilityM === undefined) return "unknown";
      return visibilityM >= 9999 ? "10 km or more" : `${round(visibilityM / 1000, 1)} km`;
    }

    function resolveWeatherLimit(value) {
      return value === "maxCrosswind" ? MAX_XWIND : value;
    }

    function selectedVfrMinima() {
      const pilotQualification = document.getElementById("pilotQualification")?.value || "student";
      const vfrPhase = document.getElementById("vfrPhase")?.value || "circuit";
      const vfrMinima = WEATHER_MINIMA.vfr || {};
      const vfrQualification = vfrMinima[pilotQualification]
        ? pilotQualification
        : (pilotQualification.startsWith("ir_") ? "ppl_gt100_no_ir" : "student");
      const mins = vfrMinima[vfrQualification]?.[vfrPhase];
      if (!mins) return null;
      return {
        ...mins,
        xwindKt: resolveWeatherLimit(mins.xwindKt),
      };
    }

    function selectedIfrMinima() {
      const pilotQualification = document.getElementById("pilotQualification")?.value || "student";
      const ifrAircraftClass = document.getElementById("ifrAircraftClass")?.value || "sep";
      const ifrMinima = WEATHER_MINIMA.ifr || {};
      if (pilotQualification === "ir_high" && ifrAircraftClass === "sep") return ifrMinima.high_ir_sep || {};
      if (pilotQualification === "ir_high") return ifrMinima.high_ir_mep || {};
      return ifrMinima.low_ir || {};
    }

    function weatherFactorText(factor) {
      if (factor.required) return `${factor.label}: ${factor.actual} ${factor.symbol} ${factor.required}`;
      return `${factor.label}: ${factor.actual}`;
    }

    function renderWeatherFactors(factors) {
      return factors.map((factor) => {
        const className = factor.pass === true ? "ok" : (factor.pass === false ? "warn" : "info");
        return `<span class="weather-factor ${className}">${escHtml(weatherFactorText(factor))}</span>`;
      }).join(" ");
    }

    function renderWeatherDetail(factors, limitsText) {
      return `${renderWeatherFactors(factors)} <span class="weather-limits">Limits: ${escHtml(limitsText)}.</span>`;
    }

    function renderTafGroups(groups, limitsText) {
      const groupsHtml = groups.map((group) => `
        <span class="weather-group">
          <span class="weather-group-label">${escHtml(group.label)}</span>
          ${renderWeatherFactors(group.factors)}
        </span>
      `).join(" ");
      return `${groupsHtml} <span class="weather-limits">Limits: ${escHtml(limitsText)}.</span>`;
    }

    function assessWeatherMinima({ phase, metar, windSpd, crosswind }) {
      const flightRules = document.getElementById("flightRules")?.value || "vfr";
      const vfrPhase = document.getElementById("vfrPhase")?.value || "circuit";
      const isArrivalPhase = phase === "arrival";
      const statusEl = document.getElementById(isArrivalPhase ? "arrWeatherMinimaStatus" : "depWeatherMinimaStatus");
      const detailEl = document.getElementById(isArrivalPhase ? "arrWeatherMinimaDetail" : "depWeatherMinimaDetail");
      const phaseLabel = isArrivalPhase ? "arrival" : "departure";

      if (!statusEl || !detailEl) return { ok: true, text: "OM-C weather minima not displayed." };
      if (!metar) {
        const text = `OM-C weather minima not assessed - fetch a ${phaseLabel} METAR first.`;
        statusEl.textContent = text;
        statusEl.className = "res-main summary-line-warn";
        detailEl.textContent = `Visibility/cloud ceiling are parsed from the fetched METAR; wind checks use the editable wind fields. Limits: ${selectedOmCWeatherLimitsText()}.`;
        return { ok: false, assessed: false, text };
      }

      const visibilityKm = metar.visibilityM === null || metar.visibilityM === undefined ? null : metar.visibilityM / 1000;
      const ceilingFt = metar.cloudCeilingFt;
      const noCeilingReported = ceilingFt === null && (metar.cloudLayers || []).length > 0;
      const xwindKt = Math.abs(crosswind);
      const factors = [];
      let ok = true;

      function addCheck(label, actual, required, pass, comparator = "min") {
        const passSymbol = comparator === "max" ? "≤" : "≥";
        const failSymbol = comparator === "max" ? ">" : "<";
        const symbol = pass ? passSymbol : failSymbol;
        const prefix = comparator === "max" ? "max " : "min ";
        if (/unknown|no ceiling reported/i.test(String(actual))) {
          factors.push({ label, actual: `${actual} (${prefix}${required})`, pass: /no ceiling reported/i.test(String(actual)) ? pass : null });
        } else {
          factors.push({ label, actual, symbol, required, pass });
        }
        if (!pass) ok = false;
      }

      if (flightRules === "vfr") {
        const mins = selectedVfrMinima();
        if (!mins) {
          statusEl.textContent = `CHECK - ${phaseLabel} VFR minima unavailable for selected pilot category.`;
          statusEl.className = "res-main summary-line-warn";
          detailEl.textContent = "Check data/weather-minima.json.";
          return { ok: false, assessed: false, text: `${statusEl.textContent} ${detailEl.textContent}` };
        }
        const ceilingPass = noCeilingReported || (ceilingFt !== null && ceilingFt >= mins.ceilingFt);
        const visPass = visibilityKm !== null && visibilityKm >= mins.visibilityKm;
        const xwindPass = xwindKt <= mins.xwindKt;
        const windPass = windSpd <= mins.maxWindKt;
        addCheck("Ceiling", noCeilingReported ? "no ceiling reported" : (ceilingFt === null ? "unknown" : `${round(ceilingFt, 0)} ft`), `${mins.ceilingFt} ft`, ceilingPass);
        addCheck("Visibility", formatVisibilityKm(metar.visibilityM), `${mins.visibilityKm} km`, visPass);
        addCheck("XWC", `${round(xwindKt, 1)} kt`, `${mins.xwindKt} kt`, xwindPass, "max");
        addCheck("Surface wind", `${round(windSpd, 1)} kt`, `${mins.maxWindKt} kt`, windPass, "max");
        if (mins.maxLowCloudAmount) {
          const excessiveLowLayer = (metar.cloudLayers || []).some(layer =>
            layer.heightFt !== null && layer.heightFt < mins.ceilingFt && ["SCT", "BKN", "OVC", "VV"].includes(layer.amount)
          );
          factors.push({
            label: "Cloud layer",
            actual: excessiveLowLayer ? `more than FEW below ${mins.ceilingFt} ft` : `no more than FEW below ${mins.ceilingFt} ft`,
            pass: !excessiveLowLayer,
          });
          if (excessiveLowLayer) ok = false;
        }
        const vfrPhaseLabel = vfrPhase === "circuit" ? "circuit" : "solo navigation";
        statusEl.textContent = `${ok ? "OK" : "CHECK"} - ${phaseLabel} VFR ${vfrPhaseLabel} minima for selected pilot category.`;
      } else {
        const mins = selectedIfrMinima();
        const ceilingMin = mins.takeoffCeilingFt;
        const visibilityMin = mins.takeoffVisibilityKm;
        if (isArrivalPhase) {
          factors.push({ label: "Approach", actual: mins.arrivalNote || "verify published approach minima/RVR", pass: null });
        } else {
          if (ceilingMin !== null) {
            addCheck("Take-off ceiling", noCeilingReported ? "no ceiling reported" : (ceilingFt === null ? "unknown" : `${round(ceilingFt, 0)} ft`), `${ceilingMin} ft`, noCeilingReported || (ceilingFt !== null && ceilingFt >= ceilingMin));
          } else {
            factors.push({ label: "Take-off ceiling", actual: "check published minima for MEP", pass: null });
          }
          if (visibilityMin !== null) {
            addCheck("Take-off visibility", formatVisibilityKm(metar.visibilityM), `${visibilityMin} km`, visibilityKm !== null && visibilityKm >= visibilityMin);
          } else {
            factors.push({ label: "Take-off visibility", actual: "check published minima for MEP", pass: null });
          }
        }
        statusEl.textContent = `${ok ? "OK" : "CHECK"} - ${phaseLabel} IFR ${isArrivalPhase ? "OM-C weather minima where assessable from METAR" : "OM-C take-off minima where assessable from METAR"}.`;
      }

      statusEl.className = ok ? "res-main summary-line-ok" : "res-main summary-line-warn";
      detailEl.innerHTML = renderWeatherDetail(factors, selectedOmCWeatherLimitsText());
      return { ok, assessed: true, text: `${statusEl.textContent} ${detailEl.textContent}` };
    }

    function selectedOmCWeatherLimitsText() {
      const flightRules = document.getElementById("flightRules")?.value || "vfr";
      const vfrPhase = document.getElementById("vfrPhase")?.value || "circuit";
      if (flightRules === "vfr") {
        const mins = selectedVfrMinima();
        return mins
          ? `VFR ${vfrPhase === "circuit" ? "circuit" : "solo"}: Ceiling ≥ ${mins.ceilingFt} ft, visibility ≥ ${mins.visibilityKm} km, XWC ≤ ${mins.xwindKt} kt, surface wind ≤ ${mins.maxWindKt} kt`
          : "VFR limits unavailable.";
      }
      return selectedIfrMinima().limitsText || "IFR limits unavailable.";
    }

    function assessTafAdvisory({ phase, taf, runwayHeading }) {
      const isArrival = phase === "arrival";
      const statusEl = document.getElementById(isArrival ? "arrTafMinimaStatus" : "depTafMinimaStatus");
      const detailEl = document.getElementById(isArrival ? "arrTafMinimaDetail" : "depTafMinimaDetail");
      if (!statusEl || !detailEl) return { ok: true, assessed: false, text: "" };
      if (!taf) {
        const text = "TAF not assessed.";
        statusEl.textContent = text;
        statusEl.className = "res-main summary-line-warn";
        detailEl.textContent = `Fetch a ${phase} TAF to review forecast OM-C minima concerns over the next ${TAF_ADVISORY_HOURS} hours. Limits: ${selectedOmCWeatherLimitsText()}.`;
        return { ok: true, assessed: false, text };
      }

      const now = new Date();
      const horizon = new Date(now.getTime() + TAF_ADVISORY_HOURS * 3600000);
      const relevantGroups = taf.groups.filter(group => group.end > now && group.start < horizon);
      const groupsForReview = relevantGroups.length > 0 ? relevantGroups : taf.groups;
      const concerns = [];
      const tafGroups = [];
      const flightRules = document.getElementById("flightRules")?.value || "vfr";
      const mins = selectedVfrMinima();
      const ifrMins = selectedIfrMinima();

      groupsForReview.forEach((group) => {
        const text = group.tokens.join(" ");
        if (!text.trim()) return;
        const parsed = parseMetar(text);
        const label = group.type === "BASE" ? "Prevailing" : group.type;
        const groupConcerns = [];
        const groupFactors = [];
        const hasWind = /\b(VRB|\d{3})\d{2,3}(?:G\d{2,3})?(KT|MPS)\b/.test(text);
        if (hasWind && parsed.windSpeed !== null) {
          const wind = computeWindComponentsForHeading(parsed.windDir, parsed.windSpeed, runwayHeading);
          const xwindKt = Math.abs(wind.crosswind);
          if (flightRules === "vfr" && mins) {
            const xwindPass = xwindKt <= mins.xwindKt;
            const windPass = parsed.windSpeed <= mins.maxWindKt;
            groupFactors.push({ label: "XWC", actual: `${round(xwindKt, 1)} kt`, symbol: xwindPass ? "≤" : ">", required: `${mins.xwindKt} kt`, pass: xwindPass });
            groupFactors.push({ label: "Surface wind", actual: `${round(parsed.windSpeed, 1)} kt`, symbol: windPass ? "≤" : ">", required: `${mins.maxWindKt} kt`, pass: windPass });
            if (!xwindPass) groupConcerns.push(`XWC ${round(xwindKt, 1)} kt > ${mins.xwindKt} kt`);
            if (!windPass) groupConcerns.push(`surface wind ${round(parsed.windSpeed, 1)} kt > ${mins.maxWindKt} kt`);
          }
        }
        if (flightRules === "vfr" && mins) {
          if (parsed.visibilityM !== null) {
            const visPass = parsed.visibilityM / 1000 >= mins.visibilityKm;
            groupFactors.push({ label: "Visibility", actual: formatVisibilityKm(parsed.visibilityM), symbol: visPass ? "≥" : "<", required: `${mins.visibilityKm} km`, pass: visPass });
            if (!visPass) groupConcerns.push(`visibility ${formatVisibilityKm(parsed.visibilityM)} < ${mins.visibilityKm} km`);
          }
          if (parsed.cloudCeilingFt !== null) {
            const ceilingPass = parsed.cloudCeilingFt >= mins.ceilingFt;
            groupFactors.push({ label: "Ceiling", actual: `${round(parsed.cloudCeilingFt, 0)} ft`, symbol: ceilingPass ? "≥" : "<", required: `${mins.ceilingFt} ft`, pass: ceilingPass });
            if (!ceilingPass) groupConcerns.push(`ceiling ${round(parsed.cloudCeilingFt, 0)} ft < ${mins.ceilingFt} ft`);
          }
        } else if (flightRules === "ifr" && !isArrival) {
          const ceilingMin = ifrMins.takeoffCeilingFt;
          const visibilityMin = ifrMins.takeoffVisibilityKm;
          if (visibilityMin !== null && parsed.visibilityM !== null) {
            const visPass = parsed.visibilityM / 1000 >= visibilityMin;
            groupFactors.push({ label: "Visibility", actual: formatVisibilityKm(parsed.visibilityM), symbol: visPass ? "≥" : "<", required: `${visibilityMin} km`, pass: visPass });
            if (!visPass) groupConcerns.push(`visibility ${formatVisibilityKm(parsed.visibilityM)} < ${visibilityMin} km`);
          }
          if (ceilingMin !== null && parsed.cloudCeilingFt !== null) {
            const ceilingPass = parsed.cloudCeilingFt >= ceilingMin;
            groupFactors.push({ label: "Ceiling", actual: `${round(parsed.cloudCeilingFt, 0)} ft`, symbol: ceilingPass ? "≥" : "<", required: `${ceilingMin} ft`, pass: ceilingPass });
            if (!ceilingPass) groupConcerns.push(`ceiling ${round(parsed.cloudCeilingFt, 0)} ft < ${ceilingMin} ft`);
          }
        }
        if (groupFactors.length > 0) {
          tafGroups.push({ label, factors: groupFactors });
        }
        if (groupConcerns.length > 0) {
          concerns.push(`${label}: ${groupConcerns.join(", ")}`);
        }
      });

      if (concerns.length > 0) {
        const text = relevantGroups.length > 0
          ? `CHECK - ${phase} TAF indicates possible OM-C minima concern within ${TAF_ADVISORY_HOURS} hours.`
          : `CHECK - ${phase} TAF has parsed OM-C minima concerns outside the next ${TAF_ADVISORY_HOURS} hours.`;
        statusEl.textContent = text;
        statusEl.className = "res-main summary-line-warn";
        detailEl.innerHTML = tafGroups.length > 0
          ? renderTafGroups(tafGroups, selectedOmCWeatherLimitsText())
          : `${escHtml(concerns.join(" | "))} <span class="weather-limits">Limits: ${escHtml(selectedOmCWeatherLimitsText())}.</span>`;
        return { ok: false, assessed: true, text: `${text} ${detailEl.textContent}` };
      }

      const text = relevantGroups.length > 0
        ? `OK - ${phase} TAF has no parsed OM-C minima concern within ${TAF_ADVISORY_HOURS} hours.`
        : `INFO - ${phase} TAF validity does not overlap the next ${TAF_ADVISORY_HOURS} hours.`;
      statusEl.textContent = text;
      statusEl.className = relevantGroups.length > 0 ? "res-main summary-line-ok" : "res-main summary-line-warn";
      detailEl.innerHTML = tafGroups.length > 0
        ? `${renderTafGroups(tafGroups, selectedOmCWeatherLimitsText())} <span class="weather-note">${relevantGroups.length > 0 ? "TEMPO/PROB groups remain advisory." : `TAF validity does not overlap the next ${TAF_ADVISORY_HOURS} hours; showing parsed TAF groups for context.`}</span>`
        : `${groupsForReview.length > 0 ? `${groupsForReview.length} TAF group(s) reviewed; no parsed minima factors found.` : "TAF contains no parseable forecast groups."} <span class="weather-limits">Limits: ${escHtml(selectedOmCWeatherLimitsText())}.</span>`;
      return { ok: true, assessed: true, text: `${text} ${detailEl.textContent}` };
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


    function formatFuelVolumeAndMass(liters, density) {
      const safeLiters = Math.max(0, Number(liters) || 0);
      const safeDensity = Math.max(0, Number(density) || 0);
      return `${round(safeLiters, 1)} L / ${round(safeLiters * safeDensity, 1)} kg`;
    }

    function wbPointOk(mass, cg) {
      const massOk = mass <= MAX_MASS && mass >= CG_MIN_MASS;
      const cgOk = cg >= CG_MIN && cg <= CG_MAX;
      const polyOk = pointInPoly(cg, mass, CG_POLY);
      return { massOk, cgOk, polyOk, ok: massOk && cgOk && polyOk };
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
    let cgDepDataset, cgArrDataset, cgZeroFuelDataset, cgFuelLineDataset;

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
        label: "Landing",
        data: [],
        pointRadius: 5,
        pointHoverRadius: 6,
      };

      cgZeroFuelDataset = {
        type: "scatter",
        label: "Zero fuel",
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
            cgZeroFuelDataset,
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
      const bagArm = Number(LOADING_CONFIG.stations?.baggageArmMm) || 0;
      const fuelArm = Number(LOADING_CONFIG.stations?.fuelArmMm) || 0;
      const fuelL = parseFloat(document.getElementById("fuelL").value) || 0;
      const fuelDensity = parseFloat(document.getElementById("fuelType").value) || 0;
      const flightDurationH = parseDurationHhmm(document.getElementById("flightDurationH")?.value);
      const fuelBurnLph = Math.max(0, parseFloat(document.getElementById("fuelBurnLph")?.value) || 0);
      const plannedFuelBurnRawL = flightDurationH * fuelBurnLph;
      const plannedFuelBurnL = Math.min(fuelL, plannedFuelBurnRawL);
      const landingFuelL = Math.max(0, fuelL - plannedFuelBurnL);

      const fuelKg = fuelL * fuelDensity;
      const landingFuelKg = landingFuelL * fuelDensity;
      document.getElementById("fuelKg").value = round(fuelKg, 1);
      document.getElementById("landingFuel").value = formatFuelVolumeAndMass(landingFuelL, fuelDensity);

      const fuelWarn = document.getElementById("fuelWarn");
      const fuelWarnings = [];
      if (fuelL > MAX_FUEL_L) fuelWarnings.push(`Fuel exceeds AFM usable fuel limit (${MAX_FUEL_L} L).`);
      if (fuelDensity <= 0 && fuelL > 0) fuelWarnings.push("Select a fuel type to calculate fuel mass.");
      if (fuelWarnings.length > 0) {
        fuelWarn.style.display = "block";
        fuelWarn.textContent = fuelWarnings.join(" ");
      } else fuelWarn.style.display = "none";

      const landingFuelWarn = document.getElementById("landingFuelWarn");
      if (plannedFuelBurnRawL > fuelL) {
        landingFuelWarn.style.display = "block";
        landingFuelWarn.textContent = `Planned burn ${round(plannedFuelBurnRawL, 1)} L exceeds take-off fuel; landing fuel clamped to 0 L.`;
      } else {
        landingFuelWarn.style.display = "none";
        landingFuelWarn.textContent = "";
      }

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
      const mLandingFuel = landingFuelKg;

      const momEmpty = moment(mEmpty, emptyArm);
      const momUpholstery = moment(mUpholstery, upholsteryArm);
      const momPilot = moment(mPilot, pilotArm);
      const momPax = moment(mPax, paxArm);
      const momBag = moment(mBag, bagArm);
      const momFuel = moment(mFuel, fuelArm);
      const momLandingFuel = moment(mLandingFuel, fuelArm);

      const massZF = mEmpty + mUpholstery + mPilot + mPax + mBag;
      const momZF = momEmpty + momUpholstery + momPilot + momPax + momBag;
      const cgZF = momZF / (massZF || 1);

      const massTO = massZF + mFuel;
      const momTO = momZF + momFuel;
      const cgTO = momTO / (massTO || 1);

      const massLW = massZF + mLandingFuel;
      const momLW = momZF + momLandingFuel;
      const cgLW = momLW / (massLW || 1);

      const maxFuelByWeightL = fuelDensity > 0 ? Math.min(MAX_FUEL_L, Math.max(0, (MAX_MASS - massZF) / fuelDensity)) : 0;
      const maxFuelByWeightText = fuelDensity > 0
        ? `${round(maxFuelByWeightL, 1)} L / ${round(maxFuelByWeightL * fuelDensity, 1)} kg`
        : "Select fuel type";
      document.getElementById("maxFuelByWeight").value = maxFuelByWeightText;

      document.getElementById("tow").textContent = round(massTO, 1);
      document.getElementById("cg").textContent = isFinite(cgTO) ? round(cgTO, 0) : "–";
      document.getElementById("lw").textContent = round(massLW, 1);
      document.getElementById("cgArr").textContent = isFinite(cgLW) ? round(cgLW, 0) : "–";
      document.getElementById("zfw").textContent = round(massZF, 1);
      document.getElementById("cgZf").textContent = isFinite(cgZF) ? round(cgZF, 0) : "–";

      const wbStatusPill = document.getElementById("wbStatusPill");

      const toPoint = wbPointOk(massTO, cgTO);
      const landingPoint = wbPointOk(massLW, cgLW);
      const zeroFuelPoint = wbPointOk(massZF, cgZF);
      const fuelOk = fuelL <= MAX_FUEL_L;
      const bagOk = mBag <= MAX_BAG_KG;

      const wbOk = toPoint.ok && landingPoint.ok && zeroFuelPoint.ok && fuelOk && bagOk;

      ["tow", "cg"].forEach(id => document.getElementById(id).classList.toggle("bad-value", !toPoint.ok));
      ["lw", "cgArr"].forEach(id => document.getElementById(id).classList.toggle("bad-value", !landingPoint.ok));
      ["zfw", "cgZf"].forEach(id => document.getElementById(id).classList.toggle("bad-value", !zeroFuelPoint.ok));

      if (wbOk) {
        wbStatusPill.textContent = "Take-off, landing and zero-fuel points inside AFM envelope and limits";
        wbStatusPill.classList.remove("bad");
        wbStatusPill.classList.add("ok");
      } else {
        wbStatusPill.textContent = "Check W&B – one or more points outside AFM limits";
        wbStatusPill.classList.remove("ok");
        wbStatusPill.classList.add("bad");
      }

      if (cgDepDataset && cgArrDataset && cgZeroFuelDataset && cgFuelLineDataset) {
        cgDepDataset.data = (isFinite(cgTO) && isFinite(massTO)) ? [{ x: cgTO, y: massTO }] : [];
        cgArrDataset.data = (isFinite(cgLW) && isFinite(massLW)) ? [{ x: cgLW, y: massLW }] : [];
        cgZeroFuelDataset.data = (isFinite(cgZF) && isFinite(massZF)) ? [{ x: cgZF, y: massZF }] : [];
        cgDepDataset.backgroundColor = toPoint.ok ? "#f97316" : "#ef4444";
        cgDepDataset.borderColor = "#ffffff";
        cgDepDataset.borderWidth = 2;
        cgArrDataset.backgroundColor = landingPoint.ok ? "#a855f7" : "#ef4444";
        cgArrDataset.borderColor = "#ffffff";
        cgArrDataset.borderWidth = 2;
        cgZeroFuelDataset.backgroundColor = zeroFuelPoint.ok ? "#22c55e" : "#ef4444";
        cgZeroFuelDataset.borderColor = "#ffffff";
        cgZeroFuelDataset.borderWidth = 2;
        cgFuelLineDataset.data = [
          ...(isFinite(cgTO) && isFinite(massTO) ? [{ x: cgTO, y: massTO }] : []),
          ...(isFinite(cgLW) && isFinite(massLW) ? [{ x: cgLW, y: massLW }] : []),
          ...(isFinite(cgZF) && isFinite(massZF) ? [{ x: cgZF, y: massZF }] : []),
        ];
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
      const depRunwayLda = parseFloat(document.getElementById("runwayLda").value) || runwayTora;
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
      const depWeatherMinima = assessWeatherMinima({
        phase: "departure",
        metar: departureMetar,
        windSpd,
        crosswind,
      });
      const arrWeatherMinima = assessWeatherMinima({
        phase: "arrival",
        metar: arrivalMetar || (arrivalUsesDepartureRunway ? departureMetar : null),
        windSpd: arrWindSpd,
        crosswind: arrCrosswind,
      });
      const effectiveArrivalTaf = arrivalTaf || (arrivalUsesDepartureRunway ? departureTaf : null);
      const depTafAssessment = assessTafAdvisory({ phase: "departure", taf: departureTaf, runwayHeading: rwHeading });
      const arrTafAssessment = assessTafAdvisory({ phase: "arrival", taf: effectiveArrivalTaf, runwayHeading: arrHeading });

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

      function setMarker(id, dist, limitLength, scaleLength, barWidth, startDist = 0) {
        const el = document.getElementById(id);
        const ratio = dist / scaleLength;
        const startRatio = startDist / scaleLength;
        const widthPx = Math.min(barWidth, Math.max(0, ratio * barWidth));
        const leftPx = Math.min(barWidth, Math.max(0, startRatio * barWidth));
        el.style.left = leftPx + "px";
        el.style.width = widthPx + "px";

        if (startDist + dist > limitLength) el.classList.add("overrun");
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

      function setDisplacedThreshold(id, legendId, offset, scaleLength, barWidth) {
        const el = document.getElementById(id);
        const show = offset > 0.5 && scaleLength > 0;
        setVisible(id, show, "flex");
        setVisible(legendId, show, "inline-flex");
        if (!el || !show) return;
        const widthPx = Math.min(barWidth, Math.max(0, (offset / scaleLength) * barWidth));
        el.style.left = "0px";
        el.style.width = widthPx + "px";
        el.title = `Displaced landing threshold: ${round(offset, 0)} m`;
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
      const depIntersection = getSelectedDepartureIntersection();
      const depIntersectionLabel = depIntersection?.label || depIntersection?.id || "Intersection";
      const depIntersectionStart = depIntersection
        ? Math.max(0, runwayTora - (Number(depIntersection.tora) || runwayTora))
        : 0;
      const depVisualTora = depIntersection ? Number(depIntersection.tora) || runwayTora : runwayTora;
      const depVisualToda = depIntersection ? Number(depIntersection.toda) || depVisualTora : runwayToda;
      const depVisualAsda = depIntersection ? Number(depIntersection.asda) || depVisualTora : runwayAsda;
      const depVisualToraEnd = depIntersectionStart + depVisualTora;
      const depVisualTodaEnd = depIntersectionStart + depVisualToda;
      const depVisualAsdaEnd = depIntersectionStart + depVisualAsda;
      const arrivalRunwayPreset = getSelectedRunway("arrivalRunwaySelect");
      const arrivalReferenceLength = arrivalUsesDepartureRunway
        ? Math.max(runwayTora, depRunwayLda, runwayLda)
        : runwayReferenceLength(arrivalRunwayPreset, runwayLda);
      const depThresholdOffset = Math.max(0, runwayTora - depRunwayLda);
      const arrThresholdOffset = Math.max(0, arrivalReferenceLength - runwayLda);
      const vacateIntersection = getSelectedArrivalVacate();
      const vacateDistance = vacateIntersection ? arrThresholdOffset + vacateIntersection.distanceFromThreshold : 0;
      const takeoffScaleLength = Math.max(runwayTora, runwayToda, runwayAsda, depVisualToraEnd, depVisualTodaEnd, depVisualAsdaEnd, depIntersectionStart + toRun, depIntersectionStart + todrBarVal, depIntersectionStart + asdrBarVal, depIntersectionStart + activeReqToraVal, 1);
      const landingScaleLength = Math.max(arrivalReferenceLength, vacateDistance, arrThresholdOffset + ldgDistDry, arrThresholdOffset + ldgDistWet, arrThresholdOffset + reqLdaDry, arrThresholdOffset + reqLdaWet, 1);

      setMarker("barToRun", toRun, depVisualToraEnd, takeoffScaleLength, takeoffBarWidth, depIntersectionStart);
      setMarker("barToDist", todrBarVal, declaredStopwayOrClearway ? depVisualTodaEnd : depVisualToraEnd, takeoffScaleLength, takeoffBarWidth, depIntersectionStart);
      setMarker("barAsdr", asdrBarVal, depVisualAsdaEnd, takeoffScaleLength, takeoffBarWidth, depIntersectionStart);
      setDisplacedThreshold("depDisplacedThreshold", "legendDepDisplacedThreshold", depThresholdOffset, takeoffScaleLength, takeoffBarWidth);
      setTick("tickDepIntersection", depIntersectionStart, takeoffScaleLength, takeoffBarWidth);
      setVisible("tickDepIntersection", !!depIntersection);
      setVisible("legendDepIntersection", !!depIntersection, "inline-flex");
      setTickLabel("tickDepIntersection", depIntersectionLabel);
      setTick("tickTakeoffEnd", runwayTora, takeoffScaleLength, takeoffBarWidth);
      setTick("tickTodaEnd", runwayToda, takeoffScaleLength, takeoffBarWidth);
      setTick("tickAsdaEnd", runwayAsda, takeoffScaleLength, takeoffBarWidth);
      setTick("tickReqTora125", depIntersectionStart + activeReqToraVal, takeoffScaleLength, takeoffBarWidth);

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
      const toraLegendLabel = "TORA/TODA/ASDA";

      setTickLabel("tickTakeoffEnd", toraTickLabel);
      setTickLabel("tickTodaEnd", todaTickLabel);
      setTickLabel("tickReqTora125", "TORR (OM-C)");
      if (todaTick) todaTick.style.display = showTodaTick ? "block" : "none";
      if (asdaTick) asdaTick.style.display = showAsdaTick ? "block" : "none";
      if (legendTora) legendTora.title = "TORA - take-off run available";
      setLegendText(legendTora, toraLegendLabel);
      setLegendText(legendToda, todaTickLabel);
      if (legendToda) legendToda.style.display = showTodaTick ? "inline-flex" : "none";
      if (legendAsda) legendAsda.style.display = showAsdaTick ? "inline-flex" : "none";
      setVisible("barAsdr", declaredStopwayOrClearway);
      setVisible("tickReqTora125", !declaredStopwayOrClearway);
      if (legendAsdr) legendAsdr.style.display = declaredStopwayOrClearway ? "inline-flex" : "none";
      if (legendToraReq) legendToraReq.style.display = declaredStopwayOrClearway ? "none" : "inline-flex";

      setDisplacedThreshold("arrDisplacedThreshold", "legendArrDisplacedThreshold", arrThresholdOffset, landingScaleLength, landingBarWidth);
      setMarker("barLdrAfm", activeLdgDist, arrThresholdOffset + runwayLda, landingScaleLength, landingBarWidth, arrThresholdOffset);
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
      setTick("tickLandingEnd", arrThresholdOffset + runwayLda, landingScaleLength, landingBarWidth);
      setTick("tickLdrDryOmc", arrThresholdOffset + reqLdaDry, landingScaleLength, landingBarWidth);
      setTick("tickLdrWetOmc", arrThresholdOffset + reqLdaWet, landingScaleLength, landingBarWidth);
      setTick("tickVacateIntersection", vacateDistance, landingScaleLength, landingBarWidth);
      setVisible("tickVacateIntersection", !!vacateIntersection);
      setVisible("legendVacateIntersection", !!vacateIntersection, "inline-flex");
      setTickLabel("tickVacateIntersection", vacateIntersection?.label || "VACATE");

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
        ? `OK – TOW ${round(massTO, 1)} kg at ${round(cgTO, 0)} mm; landing ${round(massLW, 1)} kg at ${round(cgLW, 0)} mm after ${round(plannedFuelBurnL, 1)} L burn; zero fuel ${round(massZF, 1)} kg at ${round(cgZF, 0)} mm. Max fuel by 630 kg limit ${round(maxFuelByWeightL, 1)} L.`
        : `NOT OK – check take-off, landing and zero-fuel CG envelope, fuel (≤ ${MAX_FUEL_L} L usable) and baggage (≤ ${MAX_BAG_KG} kg).`;
      setSummaryLine("sumWb", sumWbText, wbOk);

      const toOk = activeTakeoffOk;
      const sumPerfToText = declaredStopwayOrClearway
        ? (toOk
          ? `OK – non-balanced field declared-distance checks pass: TORA ≥ TORR ${round(reqToraRun, 0)} m, TODA ≥ TODR ${round(reqToda115, 0)} m, ASDA ≥ ASDR ${round(reqAsda130, 0)} m.`
          : `NOT OK – one or more non-balanced field declared-distance checks fail: TORA ≥ TORR ${round(reqToraRun, 0)} m, TODA ≥ TODR ${round(reqToda115, 0)} m, ASDA ≥ ASDR ${round(reqAsda130, 0)} m required.`)
        : (toOk
          ? `OK – balanced field: TORR (OM-C, 1.25 × AFM TODR = ${round(reqTora125, 0)} m) ≤ TORA ${round(runwayTora, 0)} m.`
          : `NOT OK – balanced field: TORR (OM-C, 1.25 × AFM TODR = ${round(reqTora125, 0)} m) exceeds TORA ${round(runwayTora, 0)} m.`);
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
        ? `OK – departure ${headStr.toLowerCase()}, ${formatAccountableWind(performanceHeadwind)}.\nArrival ${arrHeadStr.toLowerCase()}, ${formatAccountableWind(arrPerformanceHeadwind)}.\nWind speeds ≤ 40 kt, crosswind within 18 kt demonstrated where assessed, tailwind within ${MAX_RECOMMENDED_TAILWIND} kt recommendation.`
        : `NOT OK – wind limits/recommendations exceeded.\nDeparture wind ${round(windSpd, 1)} kt, tailwind ${round(tailwind, 1)} kt.\nArrival wind ${round(arrWindSpd, 1)} kt, tailwind ${round(arrTailwind, 1)} kt.`;
      setSummaryLine("sumWind", sumWindText, windOk);

      const runwayOk = toOk && ldgCriterionOk;
      const runwayLabelForSummary = formatRunwayLabel();
      const arrivalLabelForSummary = formatArrivalRunwayLabel();
      const sumRunwayText = runwayOk
        ? `Departure ${runwayLabelForSummary}: TORA ${round(runwayTora, 0)} m, TODA ${round(runwayToda, 0)} m, ASDA ${round(runwayAsda, 0)} m sufficient.\nArrival ${arrivalLabelForSummary}: LDA ${round(runwayLda, 0)} m sufficient.`
        : `Departure ${runwayLabelForSummary}: declared distances TORA ${round(runwayTora, 0)} m, TODA ${round(runwayToda, 0)} m, ASDA ${round(runwayAsda, 0)} m may be insufficient.\nArrival ${arrivalLabelForSummary}: LDA ${round(runwayLda, 0)} m may be insufficient.`;
      setSummaryLine("sumRunway", sumRunwayText, runwayOk);

      const nonCompliance = [];
      if (!wbOk) nonCompliance.push("W&B outside AFM limits");
      if (!toOk) nonCompliance.push("take-off requirement not met");
      if (!ldgCriterionOk) nonCompliance.push("landing requirement not met");
      if (!windOk) nonCompliance.push("wind limits or recommendations exceeded");
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
        ["Take-off fuel", mFuel, fuelArm, momFuel],
        ["Landing fuel", mLandingFuel, fuelArm, momLandingFuel],
      ];

      const tbody = document.getElementById("momentTable");
      if (tbody) {
        tbody.innerHTML = "";
        rows.forEach(([label, mass, arm, moment]) => {
          if (!mass || mass <= 0) return;
          const tr = document.createElement("tr");
          const rowBad = (label === "Baggage" && !bagOk) || (label === "Take-off fuel" && !fuelOk);
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
        document.getElementById("mtMassZF").textContent = round(massZF, 1);
        document.getElementById("mtMomZF").textContent = Math.round(momZF).toLocaleString();
        document.getElementById("mtArmTO").textContent = isFinite(cgTO) ? round(cgTO, 0) : "–";
        document.getElementById("mtArmLW").textContent = isFinite(cgLW) ? round(cgLW, 0) : "–";
        document.getElementById("mtArmZF").textContent = isFinite(cgZF) ? round(cgZF, 0) : "–";
        document.getElementById("mtMassTO").closest("tr")?.classList.toggle("bad-value", !toPoint.ok);
        document.getElementById("mtMassLW").closest("tr")?.classList.toggle("bad-value", !landingPoint.ok);
        document.getElementById("mtMassZF").closest("tr")?.classList.toggle("bad-value", !zeroFuelPoint.ok);

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
        ? `HWC ${creditedAbs} kt (50% of reported HWC)`
        : `TWC ${creditedAbs} kt (150% of reported TWC)`;
      return `Reported: ${along}, ${cross}\nOM-C: ${creditedText}`;
    }

    function escHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
      }[ch]));
    }

    function emyTabUrl(tab) {
      return `${EMY_AVIATION_URL}?tab=${encodeURIComponent(tab)}`;
    }

    function emyProxyUrl(url) {
      return `${EMY_PROXY_URL}${encodeURIComponent(url)}`;
    }

    function absoluteUrl(url, base = EMY_AVIATION_URL) {
      try {
        return new URL(url, base).href;
      } catch (err) {
        return "";
      }
    }

    function extractEmyChartLinks(html, kind) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const wanted = kind === "sigwx" ? /sig|significant|sigwx|weather/i : /wind|height|level|upper|fl\s?\d{2,3}/i;
      const unwanted = kind === "sigwx" ? /wind|height|upper|fl\s?\d{2,3}/i : /sig|significant|sigwx/i;
      const candidates = [];

      function addCandidate(url, label, sourceText = "") {
        const href = absoluteUrl(url);
        if (!href || !/\.(?:png|jpe?g|gif|webp|pdf)(?:[?#].*)?$/i.test(href)) return;
        const haystack = `${label || ""} ${sourceText || ""} ${href}`;
        const score = (wanted.test(haystack) ? 2 : 0) - (unwanted.test(haystack) ? 1 : 0) + (/\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$/i.test(href) ? 1 : 0);
        if (score <= 0) return;
        if (candidates.some((item) => item.url === href)) return;
        candidates.push({
          url: href,
          label: (label || sourceText || href.split("/").pop() || "EMY chart").replace(/\s+/g, " ").trim(),
          type: /\.pdf(?:[?#].*)?$/i.test(href) ? "pdf" : "image",
          score,
        });
      }

      doc.querySelectorAll("img").forEach((img) => {
        const src = img.currentSrc || img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-original");
        const parentText = img.closest("a, figure, li, div, section")?.textContent || "";
        addCandidate(src, img.getAttribute("alt") || img.getAttribute("title") || parentText, parentText);
      });

      doc.querySelectorAll("a[href]").forEach((link) => {
        const href = link.getAttribute("href");
        const text = link.textContent || link.getAttribute("title") || href;
        const parentText = link.closest("li, div, section")?.textContent || "";
        addCandidate(href, text, parentText);
      });

      return candidates
        .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
        .slice(0, kind === "sigwx" ? 4 : 8);
    }

    function renderEmyChartList(kind) {
      const container = document.getElementById(kind === "sigwx" ? "emySigwxCharts" : "emyWindCharts");
      if (!container) return;
      const charts = emyCharts[kind] || [];
      if (!charts.length) {
        container.classList.add("empty");
        container.textContent = kind === "sigwx"
          ? "No SIGWX chart images/PDFs could be extracted automatically. Open the EMY SIGWX link above."
          : "No winds-aloft chart images/PDFs could be extracted automatically. Open the EMY winds link above.";
        return;
      }
      container.classList.remove("empty");
      container.innerHTML = charts.map((chart, index) => {
        const title = escHtml(chart.label || `${kind.toUpperCase()} chart ${index + 1}`);
        const url = escHtml(chart.url);
        const media = chart.type === "pdf"
          ? `<a class="emy-chart-pdf" href="${url}" target="_blank" rel="noopener">Open PDF chart</a>`
          : `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${title}" loading="lazy"></a>`;
        return `<article class="emy-chart-card"><div class="emy-chart-title"><strong>${title}</strong><span>${url}</span></div>${media}</article>`;
      }).join("");
    }

    function updateEmyChartStatus(text, isWarning = false) {
      const status = document.getElementById("emyChartStatus");
      if (!status) return;
      status.textContent = text;
      status.classList.toggle("inline-warning", isWarning);
    }

    async function fetchEmyAviationHtml(tab) {
      const directUrl = emyTabUrl(tab);
      let lastError = null;
      for (const url of [emyProxyUrl(directUrl), directUrl]) {
        try {
          const response = await fetchWithTimeout(url);
          if (!response.ok) throw new Error(`EMY returned ${response.status}`);
          return await response.text();
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error("EMY page unavailable");
    }

    async function refreshEmyCharts() {
      updateEmyChartStatus("Fetching EMY aviation page and extracting chart links...");
      try {
        const [windHtml, sigwxHtml] = await Promise.all([
          fetchEmyAviationHtml("heightLevelAviationTab"),
          fetchEmyAviationHtml("sigWeatherAviationTab"),
        ]);
        emyCharts = {
          wind: extractEmyChartLinks(windHtml, "wind"),
          sigwx: extractEmyChartLinks(sigwxHtml, "sigwx"),
          updatedAt: new Date(),
          error: null,
        };
        renderEmyChartList("wind");
        renderEmyChartList("sigwx");
        const total = emyCharts.wind.length + emyCharts.sigwx.length;
        updateEmyChartStatus(total
          ? `Extracted ${total} EMY chart link(s) at ${emyCharts.updatedAt.toLocaleTimeString()}.`
          : "EMY page loaded, but no chart image/PDF links matched the winds/SIGWX filters. Use the source links above.", !total);
      } catch (err) {
        emyCharts = { wind: [], sigwx: [], updatedAt: null, error: err.message };
        renderEmyChartList("wind");
        renderEmyChartList("sigwx");
        updateEmyChartStatus(`Could not extract EMY charts automatically: ${err.message}. Use the source links above.`, true);
      }
    }

    function renderEmyChartsForExport(kind) {
      const charts = (emyCharts[kind] || []).filter((chart) => chart.type === "image").slice(0, kind === "sigwx" ? 2 : 4);
      if (!charts.length) {
        const sourceUrl = kind === "sigwx" ? emyTabUrl("sigWeatherAviationTab") : emyTabUrl("heightLevelAviationTab");
        return `<p class="weather-panel-note">No extracted ${kind === "sigwx" ? "SIGWX" : "winds aloft"} image was available in the app at export time. Open and print the EMY source chart directly:</p><p><a class="chart-link" href="${sourceUrl}">${sourceUrl}</a></p>`;
      }
      return charts.map((chart) => `
        <figure class="weather-export-chart">
          <figcaption>${escHtml(chart.label)}</figcaption>
          <img src="${escHtml(chart.url)}" alt="${escHtml(chart.label)}">
        </figure>
      `).join("");
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
      const complianceText = getText("complianceAlert");
      const classIfBad = (bad) => bad ? " bad-value" : "";
      const statusToken = (text) => {
        const match = String(text || "").match(/\b(NOT OK|CHECK|OK|INFO)\b/i);
        return match ? match[1].toUpperCase() : "";
      };
      const statusClass = (token) => token === "NOT OK"
        ? "bad-value"
          : token === "CHECK" || token === "INFO"
          ? "warn-value"
          : token === "OK"
            ? "ok"
            : "";
      const stripStatusPrefix = (text) => String(text || "")
        .replace(/^\s*(NOT OK|CHECK|OK|INFO)\s*[-–—]\s*/i, "")
        .trim();
      const renderStatusLine = (label, text) => {
        const token = statusToken(text);
        const body = stripStatusPrefix(text);
        const badge = token ? `<span class="${statusClass(token)}">${escHtml(token)}</span>` : "";
        return `<p class="status-text"><strong>${escHtml(label)}:</strong> ${badge}${body ? ` ${escHtml(body)}` : ""}</p>`;
      };
      const compactSummaryText = (text, maxLength = 130) => stripStatusPrefix(text)
        .replace(/\s+/g, " ")
        .replace(/Wind speeds ≤ 40 kt, crosswind within 18 kt demonstrated where assessed, tailwind within \d+(?:\.\d+)? kt recommendation\./, "Wind limits ok.")
        .replace(/Fuel volume and baggage within AFM limits\./, "Fuel/baggage ok.")
        .slice(0, maxLength);
      const renderCompactStatusLine = (label, text, maxLength) => {
        const token = statusToken(text);
        const body = compactSummaryText(text, maxLength);
        const badge = token ? `<span class="${statusClass(token)}">${escHtml(token)}</span>` : "";
        return `<p class="status-text"><strong>${escHtml(label)}:</strong> ${badge}${body ? ` ${escHtml(body)}` : ""}</p>`;
      };
      const weatherDetailHtmlForExport = (detailId) => {
        const detailEl = document.getElementById(detailId);
        const html = detailEl?.innerHTML?.trim();
        if (html) {
          const wrapper = document.createElement("div");
          wrapper.innerHTML = html;
          wrapper.querySelectorAll(".weather-limits").forEach(el => el.remove());
          return wrapper.innerHTML.replace(/\s*Limits:.*$/i, "").trim();
        }
        return escHtml((getText(detailId) || "Not assessed.").replace(/\s*Limits:.*$/i, "").trim());
      };
      const rawWeatherText = (item) => item?.raw || "Not fetched.";
      const effectiveArrivalMetarReport = arrivalMetar || (arrivalUsesDepartureRunway ? departureMetar : null);
      const effectiveArrivalTafReport = arrivalTaf || (arrivalUsesDepartureRunway ? departureTaf : null);
      const renderWeatherCell = (label, statusId, detailId) => {
        const status = getText(statusId);
        const token = statusToken(status);
        return `<div class="wx-cell"><div class="wx-label">${escHtml(label)}</div><div><span class="${statusClass(token)}">${escHtml(token || "INFO")}</span></div><div>${weatherDetailHtmlForExport(detailId)}</div></div>`;
      };
      const startsNotOk = (id) => /^NOT OK/i.test(getText(id));
      const hasLimitWarning = (id) => /exceeds|not permitted|capped/i.test(getText(id));
      const numValue = (id) => parseFloat(getValue(id));
      const textNum = (id) => parseFloat(getText(id));
      const tow = textNum("tow");
      const lw = textNum("lw");
      const cgTo = textNum("cg");
      const cgLw = textNum("cgArr");
      const zfw = textNum("zfw");
      const cgZf = textNum("cgZf");
      const fuelKgReport = numValue("fuelKg");
      const fuelLReport = numValue("fuelL");
      const bagKgReport = numValue("bagWt");
      const towBad = !(tow >= CG_MIN_MASS && tow <= MAX_MASS && cgTo >= CG_MIN && cgTo <= CG_MAX && pointInPoly(cgTo, tow, CG_POLY));
      const lwBad = !(lw >= CG_MIN_MASS && lw <= MAX_MASS && cgLw >= CG_MIN && cgLw <= CG_MAX && pointInPoly(cgLw, lw, CG_POLY));
      const zfwBad = !(zfw >= CG_MIN_MASS && zfw <= MAX_MASS && cgZf >= CG_MIN && cgZf <= CG_MAX && pointInPoly(cgZf, zfw, CG_POLY));
      const fuelBad = fuelLReport > MAX_FUEL_L;
      const bagBad = bagKgReport > MAX_BAG_KG;
      const wbBad = /check|outside/i.test(getText("wbStatusPill"));
      const depWindBad = hasLimitWarning("depWindLimitWarn");
      const arrWindBad = hasLimitWarning("arrWindLimitWarn");
      const declaredStopwayOrClearwayReport = numValue("runwayToda") > numValue("runwayTora") || numValue("runwayAsda") > numValue("runwayTora");
      const reqToraBad = declaredStopwayOrClearwayReport ? startsNotOk("reqStopwayStatus") : startsNotOk("reqTora125Status");
      const todaAsdaBad = declaredStopwayOrClearwayReport && startsNotOk("reqStopwayStatus");
      const ldaDryBad = startsNotOk("reqLdaDryStatus");
      const ldaWetBad = startsNotOk("reqLdaWetStatus");
      const requiredTorrReport = declaredStopwayOrClearwayReport ? getText("reqToraRun") : getText("reqTora125");

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${reportTitle}</title>
  <style>
    @page { size: A4 landscape; margin: 6mm; }
    * { box-sizing: border-box; }
    body { font-family: Roboto, Inter, "Segoe UI", Arial, sans-serif; color: #111827; margin: 0; font-size: 8.2px; }
    h1 { color: #075985; font-size: 12px; margin: 0; letter-spacing: 0.04em; text-transform: uppercase; }
    h2 { background: #e0f2fe; border-left: 4px solid #0284c7; color: #075985; font-size: 8.7px; margin: 5px 0 3px; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 5px; }
    .a5-spread { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; min-height: calc(210mm - 12mm); position: relative; }
    .a5-spread::before { background: #cbd5e1; bottom: 0; content: ""; left: 50%; position: absolute; top: 0; transform: translateX(-50%); width: 0.3mm; }
    .a5-panel { display: flex; flex-direction: column; min-width: 0; padding: 0 1.5mm; }
    .panel-header { align-items: start; border-bottom: 2px solid #bae6fd; display: grid; grid-template-columns: 1fr auto; gap: 6px; margin-bottom: 3px; padding-bottom: 3px; }
    .report-meta { color: #475569; font-size: 7px; line-height: 1.2; text-align: right; }
    .report-actions { display: flex; justify-content: flex-end; margin-top: 5px; }
    .report-button { background: #0284c7; border: 0; border-radius: 5px; color: #fff; cursor: pointer; font: inherit; font-size: 9px; padding: 4px 9px; text-decoration: none; text-transform: uppercase; }
    .muted { color: #475569; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 4px; }
    .box { background: #ffffff; border: 1px solid #bfdbfe; border-top: 3px solid #38bdf8; border-radius: 5px; padding: 4px; break-inside: avoid; }
    .box.wb { border-top-color: #22c55e; }
    .box.perf { border-top-color: #8b5cf6; }
    .box.warn { border-top-color: #f59e0b; background: #fffbeb; }
    .compliance-alert { border: 1px solid #dc2626; border-radius: 5px; background: #fee2e2; color: #991b1b; font-weight: 700; margin-bottom: 5px; padding: 5px 6px; }
    .kv { display: grid; grid-template-columns: 42% 58%; gap: 1px 5px; }
    .k { color: #475569; }
    .v { font-weight: 700; white-space: pre-line; }
    .stack { display: grid; gap: 4px; }
    .chart-frame { align-items: center; display: flex; justify-content: center; min-height: 160px; overflow: hidden; padding-left: 1px; padding-right: 1px; }
    .chart-img { display: block; height: 200px; max-width: 98%; object-fit: contain; transform: scaleX(1.10); transform-origin: center; width: 98%; }
    table { width: 100%; border-collapse: collapse; margin-top: 3px; table-layout: fixed; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 1px 3px; text-align: left; vertical-align: top; }
    th { background: #eff6ff; color: #075985; text-transform: uppercase; font-size: 7px; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .moment-table col.item { width: 34%; }
    .moment-table col.mass { width: 16%; }
    .moment-table col.arm { width: 16%; }
    .moment-table col.moment { width: 34%; }
    .moment-table tfoot td { background: #ecfdf5; color: #166534; font-weight: 700; }
    .moment-table tfoot tr.bad-value td { background: #fee2e2; color: #b91c1c; font-weight: 800; }
    .ok { color: #047857; font-weight: 700; }
    .bad { color: #b91c1c; font-weight: 700; }
    .warn-value { color: #b45309; font-weight: 800; }
    .bad-value { color: #b91c1c; font-weight: 800; }
    .status-text { line-height: 1.25; white-space: pre-line; }
    .status-text span { font-weight: 800; }
    .box.warn p { margin: 3px 0; }
    .wx-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3px; margin: 2px 0 3px; }
    .wx-cell { background: #fff; border: 1px solid #fde68a; border-radius: 5px; padding: 3px; line-height: 1.2; min-height: 34px; }
    .wx-label { color: #92400e; font-size: 6.8px; font-weight: 800; letter-spacing: 0.03em; text-transform: uppercase; }
    .wx-limits { color: #475569; font-size: 8px; margin-top: 2px; }
    .weather-factor { border: 1px solid #cbd5e1; border-radius: 3px; display: inline-block; line-height: 1.15; margin: 1px 1px 1px 0; padding: 1px 2px; }
    .weather-factor.ok { background: #ecfdf5; border-color: #86efac; color: #047857; }
    .weather-factor.warn { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
    .weather-factor.info { background: #f8fafc; color: #475569; }
    .weather-group { display: block; margin-top: 1px; }
    .weather-group-label { color: #475569; font-weight: 800; margin-right: 2px; }
    .weather-limits { color: #475569; display: inline-block; margin-top: 1px; }
    .weather-note { color: #475569; display: inline-block; margin-top: 1px; }
    .wx-raw p { line-height: 1.2; overflow-wrap: anywhere; }
    .footer { margin-top: auto; font-size: 7px; color: #475569; border-top: 2px solid #bae6fd; padding-top: 3px; }
    p { margin: 3px 0; }
    .chart-link { color: #075985; font-weight: 800; overflow-wrap: anywhere; }
    .weather-chart-frame { border: 0; flex: 1 1 auto; min-height: 160mm; width: 100%; }
    .weather-panel-note { color: #475569; font-size: 7.2px; line-height: 1.25; }
    .weather-export-chart { border: 1px solid #bfdbfe; border-radius: 5px; margin: 4px 0; overflow: hidden; page-break-inside: avoid; }
    .weather-export-chart figcaption { background: #e0f2fe; color: #075985; font-size: 7px; font-weight: 800; padding: 2px 4px; }
    .weather-export-chart img { background: #fff; display: block; max-height: 72mm; object-fit: contain; width: 100%; }
    .a5-spread + .a5-spread { page-break-before: always; margin-top: 8mm; }
    @media print { .report-actions { display:none; } .a5-spread + .a5-spread { margin-top: 0; } }
  </style>
</head>
<body>
  <div class="a5-spread">
    <section class="a5-panel">
      <div class="panel-header">
        <h1>${reportTitle}</h1>
        <div class="report-meta">
          <div>Generated ${escHtml(now.toLocaleString())}</div>
          <div>Panel 1/2</div>
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
          <div class="k">Baggage</div><div class="v${classIfBad(bagBad)}">${escHtml(getValue("bagWt"))} kg @ ${escHtml(getValue("bagArm"))} mm</div>
          <div class="k">T/O fuel</div><div class="v${classIfBad(fuelBad)}">${escHtml(getValue("fuelL"))} L / ${escHtml(getText("fuelKg")) || escHtml(getValue("fuelKg"))} kg (${escHtml(getSelectedText("fuelType"))})</div>
          <div class="k">Flight fuel burn</div><div class="v">${escHtml(getValue("flightDurationH"))} h × ${escHtml(getValue("fuelBurnLph"))} L/h</div>
          <div class="k">Landing fuel</div><div class="v">${escHtml(getValue("landingFuel"))}</div>
          <div class="k">Max fuel @ 630 kg</div><div class="v">${escHtml(getValue("maxFuelByWeight"))}</div>
          </div>
          <div class="box wb">
          <table class="moment-table">
            <colgroup>
              <col class="item"><col class="mass"><col class="arm"><col class="moment">
            </colgroup>
            <thead><tr><th>Item</th><th class="num">Mass kg</th><th class="num">Arm mm</th><th class="num">Moment</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot>
              <tr class="${towBad ? "bad-value" : ""}"><td><strong>Total with T/O fuel</strong></td><td class="num">${escHtml(getText("mtMassTO"))}</td><td class="num">${escHtml(getText("mtArmTO"))}</td><td class="num">${escHtml(getText("mtMomTO"))}</td></tr>
              <tr class="${lwBad ? "bad-value" : ""}"><td><strong>Total landing fuel</strong></td><td class="num">${escHtml(getText("mtMassLW"))}</td><td class="num">${escHtml(getText("mtArmLW"))}</td><td class="num">${escHtml(getText("mtMomLW"))}</td></tr>
              <tr class="${zfwBad ? "bad-value" : ""}"><td><strong>Total zero fuel</strong></td><td class="num">${escHtml(getText("mtMassZF"))}</td><td class="num">${escHtml(getText("mtArmZF"))}</td><td class="num">${escHtml(getText("mtMomZF"))}</td></tr>
            </tfoot>
          </table>
          <p class="${wbBad ? "bad-value" : "ok"}"><strong>W&amp;B status:</strong> ${escHtml(getText("wbStatusPill"))}</p>
          </div>
        </div>
        <div class="box wb chart-frame">
          ${cgChartImg ? `<img class="chart-img" src="${cgChartImg}" alt="Weight and balance envelope">` : `<div class="muted">W&amp;B chart unavailable.</div>`}
        </div>
      </div>

      <h2>Departure performance</h2>
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
          <div class="k">TORA / TODA / ASDA</div><div class="v">${escHtml(getText("declTora"))} / ${escHtml(getText("declToda"))} / ${escHtml(getText("declAsda"))}</div>
        </div>
        <div class="box perf kv">
          <div class="k">TORR (AFM)</div><div class="v">${escHtml(getText("toRun"))} m</div>
          <div class="k">TODR (AFM)</div><div class="v">${escHtml(getText("toDist"))} m</div>
          <div class="k">TORR (OM-C)</div><div class="v${classIfBad(reqToraBad)}">${escHtml(requiredTorrReport)} m</div>
          <div class="k">TODR / ASDR (OM-C)</div><div class="v${classIfBad(todaAsdaBad)}">${escHtml(getText("reqToda115"))} m / ${escHtml(getText("reqAsda130"))} m</div>
          <div class="k">Rate of climb</div><div class="v">${escHtml(getText("roc"))} ft/min</div>
        </div>
      </div>

      <div class="footer">This PDF is a snapshot of the app data. It is not an AFM replacement.</div>
    </section>

    <section class="a5-panel">
      <div class="panel-header">
        <h1>${reportTitle}</h1>
        <div class="report-meta">
          <div>Generated ${escHtml(now.toLocaleString())}</div>
          <div>Panel 2/2</div>
        </div>
      </div>

      <h2>Arrival performance</h2>
      <div class="grid">
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
        <div class="box perf kv">
          <div class="k">LDR dry (AFM)</div><div class="v">${escHtml(getText("ldgDistDry"))} m</div>
          <div class="k">LDR wet (AFM)</div><div class="v">${escHtml(getText("ldgDistWet"))} m</div>
          <div class="k">LDR dry (OM-C)</div><div class="v${classIfBad(ldaDryBad)}">${escHtml(getText("reqLdaDry"))} m</div>
          <div class="k">LDR wet (OM-C)</div><div class="v${classIfBad(ldaWetBad)}">${escHtml(getText("reqLdaWet"))} m</div>
        </div>
      </div>

      <h2>Operational summary</h2>
      <div class="box warn">
        ${complianceText ? `<div class="compliance-alert">${escHtml(complianceText)}</div>` : ""}
        ${renderCompactStatusLine("W&B", getText("sumWb"), 105)}
        ${renderCompactStatusLine("Take-off", getText("sumPerfTo"), 115)}
        ${renderCompactStatusLine("Landing", getText("sumPerfLdg"), 110)}
        ${renderCompactStatusLine("Wind", getText("sumWind"), 115)}
        <p><strong>OM-C weather minima:</strong> <span class="wx-limits">${escHtml(selectedOmCWeatherLimitsText())}</span></p>
        <div class="wx-grid">
          ${renderWeatherCell("Dep actual", "depWeatherMinimaStatus", "depWeatherMinimaDetail")}
          ${renderWeatherCell("Dep forecast", "depTafMinimaStatus", "depTafMinimaDetail", true)}
          ${renderWeatherCell("Arr actual", "arrWeatherMinimaStatus", "arrWeatherMinimaDetail")}
          ${renderWeatherCell("Arr forecast", "arrTafMinimaStatus", "arrTafMinimaDetail", true)}
        </div>
      </div>

      <h2>Weather used</h2>
      <div class="box warn wx-raw">
        <p><strong>Departure METAR:</strong> ${escHtml(rawWeatherText(departureMetar))}</p>
        <p><strong>Departure TAF:</strong> ${escHtml(rawWeatherText(departureTaf))}</p>
        <p><strong>Arrival METAR:</strong> ${escHtml(rawWeatherText(effectiveArrivalMetarReport))}</p>
        <p><strong>Arrival TAF:</strong> ${escHtml(rawWeatherText(effectiveArrivalTafReport))}</p>
      </div>

      <div class="footer">This PDF is a snapshot of the app data. It is not an AFM replacement.</div>
    </section>
  </div>

  <div class="a5-spread">
    <section class="a5-panel">
      <div class="panel-header">
        <h1>EMY Winds Aloft</h1>
        <div class="report-meta">
          <div>Generated ${escHtml(now.toLocaleString())}</div>
          <div>Weather panel 1/2</div>
        </div>
      </div>
      <p class="weather-panel-note">Extracted from the EMY/HNMS aviation page where browser/network policy allows. Verify chart issue and validity times against the official EMY source before flight.</p>
      ${renderEmyChartsForExport("wind")}
      <div class="footer">Source: EMY/HNMS upper-atmosphere wind maps.</div>
    </section>

    <section class="a5-panel">
      <div class="panel-header">
        <h1>EMY SIGWX</h1>
        <div class="report-meta">
          <div>Generated ${escHtml(now.toLocaleString())}</div>
          <div>Weather panel 2/2</div>
        </div>
      </div>
      <p class="weather-panel-note">Extracted from the EMY/HNMS aviation page where browser/network policy allows. Verify chart issue and validity times against the official EMY source before flight.</p>
      ${renderEmyChartsForExport("sigwx")}
      <div class="footer">Source: EMY/HNMS significant-weather maps.</div>
    </section>
  </div>
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
          loadFuelTypes(),
          loadLoadingConfig(),
          loadWeatherMinima(),
          loadPerformanceData(),
          loadRunwayPresets(),
        ]);
      } catch (err) {
        console.error("Could not load required app data:", err);
        alert("Could not load app data. Check that the data JSON files are available, then reload the page.");
        return;
      }

      buildCGChart();
      initTabs();
      populateAircraftSelect();
      populateFuelTypeSelect();
      applyLoadingDefaults();

      document.getElementById("calcBtn").addEventListener("click", calculateAll);
      document.getElementById("exportPdfBtn").addEventListener("click", exportReportToPdf);
      document.getElementById("fetchMetarBtn").addEventListener("click", () => fetchAndApplyMetar("departure"));
      document.getElementById("fetchTafBtn").addEventListener("click", () => fetchAndAssessTaf("departure"));
      document.getElementById("fetchArrivalMetarBtn").addEventListener("click", () => fetchAndApplyMetar("arrival"));
      document.getElementById("fetchArrivalTafBtn").addEventListener("click", () => fetchAndAssessTaf("arrival"));
      document.getElementById("refreshEmyChartsBtn")?.addEventListener("click", refreshEmyCharts);
      document.getElementById("flightDurationH")?.addEventListener("blur", () => {
        normalizeDurationField("flightDurationH");
        calculateAll();
      });

      const regSelect = document.getElementById("regSelect");
      const regInfo = document.getElementById("regInfo");

      regSelect.addEventListener("change", () => {
        const reg = regSelect.value;
        const data = REG_DATA[reg];
        if (data) {
          const defaults = LOADING_CONFIG.defaults || {};
          const upholsteryWeight = data.upholsteryWeight !== undefined ? data.upholsteryWeight : defaults.upholsteryWeightKg;
          const upholsteryArm = data.upholsteryArm !== undefined ? data.upholsteryArm : defaults.upholsteryArmMm;
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
          departureTaf = null;
          if (arrivalUsesDepartureRunway) {
            copyDepartureToArrival();
          }
          updateIntersectionControls();
          updateRunwayEditState();
          calculateAll();
          return;
        }

        const preset = PRESET_RUNWAYS[selectedId];
        if (preset) {
          setRunwayFields(preset, preset.label);
          departureTaf = null;
          updateIntersectionControls();
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
          updateIntersectionControls();
          updateRunwayEditState();
          calculateAll();
          return;
        }

        if (selectedId === "manual") {
          arrivalUsesDepartureRunway = false;
          activeArrivalRunwayLabel = null;
          arrivalTaf = null;
          arrSurfaceBase = "hard";
          updateArrivalWeatherControls();
          updateIntersectionControls();
          updateRunwayEditState();
          calculateAll();
          return;
        }

        const preset = PRESET_RUNWAYS[selectedId];
        if (preset) {
          setArrivalRunwayFields(preset, preset.label);
          arrivalTaf = null;
          updateIntersectionControls();
          updateRunwayEditState();
          calculateAll();
          return;
        }
      });

      ["depIntersectionSelect", "arrVacateSelect"].forEach(id => {
        document.getElementById(id)?.addEventListener("change", calculateAll);
      });

      ["qnh", "oat", "windDir", "windSpd"].forEach(id => {
        document.getElementById(id).addEventListener("input", () => {
          if (arrivalUsesDepartureRunway) copyDepartureWeatherToArrival();
        });
      });

      document.getElementById("flightRules")?.addEventListener("change", () => {
        updateWeatherMinimaControls();
        calculateAll();
      });
      ["pilotQualification", "vfrPhase", "ifrAircraftClass"].forEach(id => {
        document.getElementById(id)?.addEventListener("change", calculateAll);
      });

      updateArrivalWeatherControls();
      updateIntersectionControls();
      updateWeatherMinimaControls();
      updateRunwayEditState();
      calculateAll();
      refreshEmyCharts();
      window.addEventListener("resize", calculateAll);
    });
