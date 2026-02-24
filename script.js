// ========== INDIAN AVIATION STATION DATABASE ==========
const stationDatabase = {
  VIDP: { name: "Delhi (IGI Airport)", fir: "Delhi FIR" },
  VABB: { name: "Mumbai (CSIA)", fir: "Mumbai FIR" },
  VECC: { name: "Kolkata (NSCBI Airport)", fir: "Kolkata FIR" },
  VOMM: { name: "Chennai (Chennai Airport)", fir: "Chennai FIR" },
  VEPT: { name: "Patna", fir: "Kolkata FIR" },
  VEGY: { name: "Gaya", fir: "Kolkata FIR" },
  // ... (Add other stations as needed)
};

// Weather phenomenon decoder
const weatherCodes = {
  RA: "Rain",
  DZ: "Drizzle",
  SN: "Snow",
  SG: "Snow Grains",
  IC: "Ice Crystals",
  PL: "Ice Pellets",
  GR: "Hail",
  GS: "Small Hail",
  BR: "Mist",
  FG: "Fog",
  FU: "Smoke",
  VA: "Volcanic Ash",
  DU: "Dust",
  SA: "Sand",
  HZ: "Haze",
  PO: "Dust/Sand Whirls",
  SQ: "Squalls",
  FC: "Funnel Cloud",
  SS: "Sandstorm",
  DS: "Duststorm",
  TS: "Thunderstorm",
  SH: "Showers",
  FZ: "Freezing",
  MI: "Shallow",
  BC: "Patches",
  PR: "Partial",
  DR: "Low Drifting",
  BL: "Blowing",
  VC: "Vicinity",
};

// Cloud amount decoder
const cloudAmounts = {
  SKC: "Sky Clear (0/8)",
  FEW: "Few (1-2/8)",
  SCT: "Scattered (3-4/8)",
  BKN: "Broken (5-7/8)",
  OVC: "Overcast (8/8)",
  NSC: "No Significant Cloud",
};

// Global variables
let decodedTAFs = [];
let decodedMETARs = [];
let charts = {};

// ========== EXAMPLE DATA ==========
const examples = {
  taf: "TAF VECC 110500Z 1106/1212 19008KT 3500 HZ SCT018 BKN100 TEMPO 1108/1112 2000 TSRA SCT015 FEW025CB OVC090=",
  metar: `METAR VECC 110800Z 20010KT 3000 HZ SCT015 BKN080 28/22 Q1008=
METAR VECC 111000Z 19012KT 2000 +TSRA SCT012 FEW025CB OVC080 26/21 Q1006=
METAR VECC 111200Z 20012KT 4000 HZ SCT020 BKN080 28/22 Q1008=`,
  cavok: {
    taf: "TAF VABB 120500Z 1206/1306 27008KT CAVOK=",
    metar: "METAR VABB 121200Z 27010KT CAVOK 30/24 Q1010=",
  },
};

// ========== FILE LOADING LOGIC ==========
async function fetchFile(filename) {
  try {
    const response = await fetch(filename);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.text();
  } catch (e) {
    console.error("Fetch error:", e);
    return null;
  }
}

function processFileContent(text, type) {
  if (!text) return [];
  const lines = text.split("\n");
  let startIndex = -1;
  const regex = type === "TAF" ? /^\d{12}\sTAF/ : /^\d{12}\sMETAR/;
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i].trim())) {
      startIndex = i;
      break;
    }
  }
  if (startIndex === -1) return [];
  const content = lines.slice(startIndex).join("\n");
  return content
    .split("=")
    .map((s) => s.trim() + "=")
    .filter((s) => s.length > 10);
}

async function loadFileExample(mode) {
  const tafAlert = document.getElementById("tafAlert");
  showAlert(tafAlert, "Loading files...", "warning");
  let tafFile = "TAF.txt";
  if (mode === "short") tafFile = "Short_TAF.txt";
  const [tafText, metarText] = await Promise.all([
    fetchFile(tafFile),
    fetchFile("METAR.txt"),
  ]);
  if (!tafText || !metarText) {
    showAlert(
      tafAlert,
      "Error loading files. Ensure they exist in root.",
      "error",
    );
    return;
  }
  const rawTafs = processFileContent(tafText, "TAF");
  const rawMetars = processFileContent(metarText, "METAR");
  let selectedTafs = [];
  let selectedMetars = [];
  if (mode === "long") {
    selectedTafs = rawTafs;
    selectedMetars = rawMetars;
  } else {
    selectedTafs = rawTafs.slice(0, 2);
    const parsedTafs = selectedTafs.map((t) => parseTAF(t)).filter((t) => t);
    selectedMetars = rawMetars.filter((m) => {
      const parsedM = parseMETAR(m);
      if (!parsedM || !parsedM.time) return false;
      return parsedTafs.some((t) => {
        if (t.station !== parsedM.station) return false;
        if (!t.validFrom || !t.validTo) return false;
        return (
          parsedM.time.day === t.validFrom.day ||
          parsedM.time.day === t.validTo.day
        );
      });
    });
  }
  document.getElementById("tafInput").value = selectedTafs.join("\n\n");
  document.getElementById("metarInput").value = selectedMetars.join("\n");
  showAlert(
    tafAlert,
    `Loaded ${selectedTafs.length} TAFs and ${selectedMetars.length} METARs`,
    "success",
  );
}

function getValidityDuration(from, to) {
  if (!from || !to) return 0;
  let start = parseInt(from.day) * 24 + parseInt(from.hour);
  let end = parseInt(to.day) * 24 + parseInt(to.hour);
  let diff = end - start;
  if (diff < 0) {
    diff += 24 * 30;
    if (Math.abs(diff - 30) < 5) return 30;
    if (Math.abs(diff - 9) < 5) return 9;
  }
  return diff;
}

// ========== UTILITY FUNCTIONS ==========
function getStationInfo(code) {
  if (stationDatabase[code]) return { ...stationDatabase[code], known: true };
  return { name: "Unknown Station Code", fir: "Unknown FIR", known: false };
}

function loadExample(type) {
  if (type === "taf") document.getElementById("tafInput").value = examples.taf;
  else if (type === "metar")
    document.getElementById("metarInput").value = examples.metar;
  else if (type === "cavok") {
    document.getElementById("tafInput").value = examples.cavok.taf;
    document.getElementById("metarInput").value = examples.cavok.metar;
  }
  showAlert(
    document.getElementById("tafAlert"),
    "Example loaded! Click Decode to view.",
    "success",
  );
}

function showAlert(element, message, type) {
  element.textContent = message;
  element.className = `alert alert-${type} show`;
  setTimeout(() => {
    element.className = "alert";
  }, 4000);
}

function clearTAF() {
  document.getElementById("tafInput").value = "";
  document.getElementById("tafOutput").classList.remove("active");
  document.getElementById("tafAlert").className = "alert";
  decodedTAFs = [];
}

function clearMETAR() {
  document.getElementById("metarInput").value = "";
  document.getElementById("metarOutput").classList.remove("active");
  document.getElementById("metarAlert").className = "alert";
  decodedMETARs = [];
}

function clearAll() {
  clearTAF();
  clearMETAR();
  document.getElementById("verificationOutput").classList.remove("active");
  document.getElementById("verifyAlert").className = "alert";
  Object.values(charts).forEach((chart) => {
    if (chart) chart.destroy();
  });
  charts = {};
  document.getElementById("dashboardSection").style.display = "none";
}

// ========== DECODERS ==========
function decodeWind(windStr) {
  if (!windStr || windStr === "00000KT" || windStr === "CALM")
    return {
      direction: "Calm",
      speed: 0,
      gust: null,
      variable: false,
      raw: windStr,
    };
  if (windStr.startsWith("VRB")) {
    const speed = parseInt(windStr.substring(3, 5)) || 0;
    const gustMatch = windStr.match(/G(\d+)/);
    return {
      direction: "Variable",
      speed: speed,
      gust: gustMatch ? parseInt(gustMatch[1]) : null,
      variable: true,
      raw: windStr,
    };
  }
  const direction = parseInt(windStr.substring(0, 3));
  const speed = parseInt(windStr.substring(3, 5)) || 0;
  const gustMatch = windStr.match(/G(\d+)/);
  return {
    direction: isNaN(direction) ? null : direction,
    speed: speed,
    gust: gustMatch ? parseInt(gustMatch[1]) : null,
    variable: false,
    raw: windStr,
  };
}

function formatWind(wind) {
  if (!wind) return "Not reported";
  if (wind.direction === "Calm") return "Calm";
  if (wind.direction === "Variable")
    return (
      `Variable at ${wind.speed} KT` +
      (wind.gust ? `, Gusts to ${wind.gust} KT` : "")
    );
  if (wind.direction === null) return wind.raw || "Unknown";
  return (
    `${wind.direction}° at ${wind.speed} KT` +
    (wind.gust ? `, Gusts to ${wind.gust} KT` : "")
  );
}

function decodeWeather(wwStr) {
  if (!wwStr) return null;
  let intensity = "",
    descriptor = "",
    phenomena = [];
  if (wwStr.startsWith("+")) {
    intensity = "Heavy ";
    wwStr = wwStr.substring(1);
  } else if (wwStr.startsWith("-")) {
    intensity = "Light ";
    wwStr = wwStr.substring(1);
  }
  for (let i = 0; i < wwStr.length; i += 2) {
    const code = wwStr.substring(i, i + 2);
    if (weatherCodes[code]) {
      if (["MI", "BC", "PR", "DR", "BL", "SH", "TS", "FZ"].includes(code))
        descriptor += weatherCodes[code] + " ";
      else phenomena.push(weatherCodes[code]);
    }
  }
  if (phenomena.length === 0 && descriptor)
    return intensity + descriptor.trim();
  if (phenomena.length === 0) return null;
  return intensity + descriptor + phenomena.join(" and ");
}

function decodeCloud(cloudStr) {
  if (!cloudStr) return null;
  if (cloudStr === "CAVOK")
    return { type: "CAVOK", description: "Ceiling And Visibility OK" };
  if (cloudStr === "NSC")
    return { type: "NSC", description: "No Significant Cloud" };
  if (cloudStr === "SKC") return { type: "SKC", description: "Sky Clear" };
  if (cloudStr.startsWith("VV")) {
    const height = cloudStr.substring(2);
    return {
      type: "VV",
      description:
        height === "///"
          ? "Vertical Visibility: Unknown"
          : `Vertical Visibility: ${parseInt(height) * 100} ft`,
    };
  }
  const amount = cloudStr.substring(0, 3);
  const height = cloudStr.substring(3, 6);
  const cloudType = cloudStr.substring(6);
  let description = cloudAmounts[amount] || amount;
  if (height && height !== "///" && !isNaN(parseInt(height)))
    description += ` at ${parseInt(height) * 100} ft`;
  if (cloudType === "CB") description += " (Cumulonimbus)";
  else if (cloudType === "TCU") description += " (Towering Cumulus)";
  return { type: amount, height: height, cloudType: cloudType, description };
}

// ========== PARSERS ==========
function parseMETAR(metarStr) {
  metarStr = metarStr.trim().replace(/=$/, "");
  if (!metarStr) return null;
  const parts = metarStr.split(/\s+/);
  const result = {
    raw: metarStr,
    type: "METAR",
    station: null,
    stationInfo: null,
    time: null,
    wind: null,
    visibility: null,
    rvr: [],
    weather: [],
    clouds: [],
    temperature: null,
    dewpoint: null,
    qnh: null,
    supplementary: [],
  };
  let i = 0;
  if (parts[i] && /^\d{12}$/.test(parts[i])) i++;
  if (parts[i] === "METAR" || parts[i] === "SPECI") {
    result.type = parts[i];
    i++;
  }
  if (parts[i] === "COR") {
    result.correction = true;
    i++;
  }
  if (parts[i] === "NIL") {
    result.nil = true;
    return result;
  }
  if (parts[i] === "AUTO") {
    result.automated = true;
    i++;
  }
  if (
    i < parts.length &&
    parts[i].length === 4 &&
    /^[A-Z]{4}$/.test(parts[i])
  ) {
    result.station = parts[i];
    result.stationInfo = getStationInfo(parts[i]);
    i++;
  }
  if (i < parts.length && /^\d{6}Z$/.test(parts[i])) {
    result.time = {
      raw: parts[i],
      day: parts[i].substring(0, 2),
      hour: parts[i].substring(2, 4),
      minute: parts[i].substring(4, 6),
    };
    i++;
  }
  if (
    i < parts.length &&
    (/^\d{5}KT$/.test(parts[i]) ||
      /^VRB\d+KT$/.test(parts[i]) ||
      /^\d{5}G\d+KT$/.test(parts[i]))
  ) {
    result.wind = decodeWind(parts[i]);
    i++;
  }
  if (i < parts.length && parts[i] === "CAVOK") {
    result.cavok = true;
    result.visibility = {
      value: 10000,
      unit: "m",
      description: "10 km or more",
    };
    result.clouds.push({
      type: "CAVOK",
      description: "No clouds below 5000 ft",
    });
    i++;
  } else {
    if (i < parts.length && /^\d{4}$/.test(parts[i])) {
      const vis = parseInt(parts[i]);
      result.visibility = {
        value: vis,
        unit: "m",
        description: vis >= 10000 ? "10 km or more" : `${vis} m`,
      };
      i++;
    }
    while (
      i < parts.length &&
      parts[i].startsWith("R") &&
      parts[i].includes("/")
    ) {
      result.rvr.push(parts[i]);
      i++;
    }
    while (i < parts.length && isWeatherCode(parts[i])) {
      const wx = decodeWeather(parts[i]);
      if (wx) result.weather.push(wx);
      i++;
    }
    while (i < parts.length && isCloudCode(parts[i])) {
      result.clouds.push(decodeCloud(parts[i]));
      i++;
    }
  }
  if (i < parts.length && /^M?\d{2}\/M?\d{2}$/.test(parts[i])) {
    const [temp, dew] = parts[i].split("/");
    result.temperature = temp.startsWith("M")
      ? -parseInt(temp.substring(1))
      : parseInt(temp);
    result.dewpoint = dew.startsWith("M")
      ? -parseInt(dew.substring(1))
      : parseInt(dew);
    i++;
  }
  if (i < parts.length && /^Q\d{4}$/.test(parts[i])) {
    result.qnh = parseInt(parts[i].substring(1));
    i++;
  }
  if (i < parts.length) result.supplementary = parts.slice(i);
  return result;
}

function isWeatherCode(str) {
  if (str === "NSW") return true;
  return /^[+-]?(MI|BC|PR|DR|BL|SH|TS|FZ|VC)?(DZ|RA|SN|SG|IC|PL|GR|GS|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+$/.test(
    str,
  );
}

function isCloudCode(str) {
  return (
    /^(FEW|SCT|BKN|OVC)\d{3}(CB|TCU)?$/.test(str) ||
    /^VV\d{3}$/.test(str) ||
    str === "NSC" ||
    str === "SKC" ||
    str === "CAVOK"
  );
}

function parseTAF(tafStr) {
  tafStr = tafStr.trim().replace(/=$/, "");
  if (!tafStr) return null;
  const parts = tafStr.split(/\s+/);
  const result = {
    raw: tafStr,
    type: "TAF",
    amendment: false,
    correction: false,
    station: null,
    stationInfo: null,
    issueTime: null,
    validFrom: null,
    validTo: null,
    baseForecast: { wind: null, visibility: null, weather: [], clouds: [] },
    changes: [],
  };
  let i = 0;
  if (parts[i] && /^\d{12}$/.test(parts[i])) i++;
  if (parts[i] === "TAF") i++;
  if (parts[i] === "AMD") {
    result.amendment = true;
    i++;
  }
  if (parts[i] === "COR") {
    result.correction = true;
    i++;
  }
  if (
    i < parts.length &&
    parts[i].length === 4 &&
    /^[A-Z]{4}$/.test(parts[i])
  ) {
    result.station = parts[i];
    result.stationInfo = getStationInfo(parts[i]);
    i++;
  }
  if (i < parts.length && /^\d{6}Z$/.test(parts[i])) {
    result.issueTime = {
      raw: parts[i],
      day: parts[i].substring(0, 2),
      hour: parts[i].substring(2, 4),
      minute: parts[i].substring(4, 6),
    };
    i++;
  }
  if (i < parts.length && /^\d{4}\/\d{4}$/.test(parts[i])) {
    const [from, to] = parts[i].split("/");
    result.validFrom = {
      day: from.substring(0, 2),
      hour: from.substring(2, 4),
    };
    result.validTo = { day: to.substring(0, 2), hour: to.substring(2, 4) };
    i++;
  }
  let currentGroup = result.baseForecast;
  while (i < parts.length) {
    const part = parts[i];
    if (part === "FM" && i + 1 < parts.length && /^\d{4}$/.test(parts[i + 1])) {
      const time = parts[i + 1];
      currentGroup = {
        type: "FM",
        time: { day: time.substring(0, 2), hour: time.substring(2, 4) },
        wind: null,
        visibility: null,
        weather: [],
        clouds: [],
      };
      result.changes.push(currentGroup);
      i += 2;
      continue;
    }
    if (
      (part === "BECMG" || part === "TEMPO") &&
      i + 1 < parts.length &&
      /^\d{4}\/\d{4}$/.test(parts[i + 1])
    ) {
      const [from, to] = parts[i + 1].split("/");
      currentGroup = {
        type: part,
        from: { day: from.substring(0, 2), hour: from.substring(2, 4) },
        to: { day: to.substring(0, 2), hour: to.substring(2, 4) },
        wind: null,
        visibility: null,
        weather: [],
        clouds: [],
      };
      result.changes.push(currentGroup);
      i += 2;
      continue;
    }
    if (/^PROB\d{2}$/.test(part)) {
      currentGroup = {
        type: part,
        probability: parseInt(part.substring(4)),
        wind: null,
        visibility: null,
        weather: [],
        clouds: [],
      };
      result.changes.push(currentGroup);
      i++;
      continue;
    }
    if (part === "NOSIG") {
      result.nosig = true;
      i++;
      continue;
    }
    if (
      /^\d{5}KT$/.test(part) ||
      /^VRB\d+KT$/.test(part) ||
      /^\d{5}G\d+KT$/.test(part)
    ) {
      currentGroup.wind = decodeWind(part);
      i++;
    } else if (/^\d{4}$/.test(part)) {
      currentGroup.visibility = { value: parseInt(part), unit: "m" };
      i++;
    } else if (isWeatherCode(part)) {
      currentGroup.weather.push(
        part === "NSW" ? "No Significant Weather" : decodeWeather(part),
      );
      i++;
    } else if (isCloudCode(part)) {
      currentGroup.clouds.push(decodeCloud(part));
      i++;
    } else i++;
  }
  return result;
}

// ========== DECODE HANDLERS ==========
function renderItem(label, value) {
  return `<div class="decoded-item"><span class="decoded-label">${label}</span><span class="decoded-value">${value}</span></div>`;
}

function decodeTAF() {
  let input = document
    .getElementById("tafInput")
    .value.trim()
    .replace(/\s+/g, " ");
  const rawTafs = input
    .split("=")
    .map((t) => t.trim())
    .filter((t) => t.length > 5);
  const alertDiv = document.getElementById("tafAlert");
  const outputDiv = document.getElementById("tafOutput");
  const contentDiv = document.getElementById("tafDecodedContent");
  const borderColors = [
    "border-c1",
    "border-c2",
    "border-c3",
    "border-c4",
    "border-c5",
    "border-c6",
  ];

  if (rawTafs.length === 0) {
    showAlert(alertDiv, "Please enter a TAF message", "warning");
    return;
  }
  decodedTAFs = [];
  let html = "";
  let successCount = 0;

  rawTafs.forEach((tafStr, idx) => {
    const decodedTAF = parseTAF(tafStr);
    if (decodedTAF && decodedTAF.station) {
      decodedTAFs.push(decodedTAF);
      successCount++;
      const duration = getValidityDuration(
        decodedTAF.validFrom,
        decodedTAF.validTo,
      );
      let badgeHtml =
        duration === 9
          ? '<span class="badge-validity badge-short">🟢 SHORT TAF (9 HR)</span>'
          : duration === 30
            ? '<span class="badge-validity badge-long">🔵 LONG TAF (30 HR)</span>'
            : "";
      const colorClass = borderColors[idx % borderColors.length];
      html += `<div class="report-wrapper ${colorClass}"><div class="report-header"><h3>${decodedTAF.station} <span style="font-size:0.9rem; color:var(--text-color); opacity:0.8;">${decodedTAF.stationInfo.name}</span>${badgeHtml}</h3><div class="report-meta">`;
      let typeStr =
        decodedTAF.type +
        (decodedTAF.amendment ? " (AMD)" : "") +
        (decodedTAF.correction ? " (COR)" : "");
      html += `<span><i class="fas fa-tag"></i> ${typeStr}</span>`;
      if (decodedTAF.issueTime)
        html += `<span><i class="far fa-clock"></i> Issued: ${decodedTAF.issueTime.day}/${decodedTAF.issueTime.hour}:${decodedTAF.issueTime.minute}Z</span>`;
      if (decodedTAF.validFrom && decodedTAF.validTo)
        html += `<span><i class="far fa-calendar-alt"></i> Valid: ${decodedTAF.validFrom.day}/${decodedTAF.validFrom.hour}Z - ${decodedTAF.validTo.day}/${decodedTAF.validTo.hour}Z</span>`;
      html += `</div></div><div class="taf-block" style="border-left-color: inherit; opacity: 0.9;"><div class="taf-block-title">Base Forecast</div>`;
      if (decodedTAF.baseForecast.wind)
        html += renderItem("Wind", formatWind(decodedTAF.baseForecast.wind));
      if (decodedTAF.baseForecast.visibility)
        html += renderItem(
          "Visibility",
          decodedTAF.baseForecast.visibility.value + " m",
        );
      if (decodedTAF.baseForecast.weather.length > 0)
        html += renderItem(
          "Weather",
          decodedTAF.baseForecast.weather.join(", "),
        );
      if (decodedTAF.baseForecast.clouds.length > 0)
        html += renderItem(
          "Clouds",
          decodedTAF.baseForecast.clouds
            .map((c) => c.description || c)
            .join("; "),
        );
      html += `</div>`;
      decodedTAF.changes.forEach((change) => {
        let changeTitle = "",
          changeClass = "";
        if (change.type === "FM") {
          changeTitle = `FROM Day ${change.time.day} ${change.time.hour}:00Z`;
          changeClass = "change-fm";
        } else if (change.type === "BECMG") {
          changeTitle = `BECOMING ${change.from.day}/${change.from.hour}Z - ${change.to.day}/${change.to.hour}Z`;
          changeClass = "change-becmg";
        } else if (change.type === "TEMPO") {
          changeTitle = `TEMPO ${change.from.day}/${change.from.hour}Z - ${change.to.day}/${change.to.hour}Z`;
          changeClass = "change-tempo";
        } else if (change.type && change.type.startsWith("PROB")) {
          changeTitle = `PROBABILITY ${change.probability}%`;
          changeClass = "change-prob";
        }
        html += `<div class="taf-block" style="border-left: 3px solid rgba(255,255,255,0.2);"><div class="taf-block-title"><span class="change-indicator ${changeClass}">${change.type}</span>${changeTitle}</div>`;
        if (change.wind) html += renderItem("Wind", formatWind(change.wind));
        if (change.visibility)
          html += renderItem("Visibility", change.visibility.value + " m");
        if (change.weather.length > 0)
          html += renderItem("Weather", change.weather.join(", "));
        if (change.clouds.length > 0)
          html += renderItem(
            "Clouds",
            change.clouds.map((c) => c.description || c).join("; "),
          );
        html += `</div>`;
      });
      if (decodedTAF.nosig)
        html +=
          '<div class="taf-block"><div class="taf-block-title">No Significant Changes Expected</div></div>';
      html += `</div>`;
    }
  });
  if (successCount === 0) {
    showAlert(
      alertDiv,
      "Unable to parse TAF. Please check the format.",
      "error",
    );
    return;
  }
  alertDiv.className = "alert";
  outputDiv.classList.add("active");
  contentDiv.innerHTML = html;
  showAlert(
    alertDiv,
    `${successCount} TAF(s) decoded successfully!`,
    "success",
  );
}

function decodeMETAR() {
  const input = document.getElementById("metarInput").value.trim();
  const alertDiv = document.getElementById("metarAlert");
  const outputDiv = document.getElementById("metarOutput");
  const contentDiv = document.getElementById("metarDecodedContent");
  const borderColors = [
    "border-c1",
    "border-c2",
    "border-c3",
    "border-c4",
    "border-c5",
    "border-c6",
  ];

  if (!input) {
    showAlert(alertDiv, "Please enter a METAR message", "warning");
    return;
  }
  let metarLines = input.includes("=")
    ? input
        .replace(/\s+/g, " ")
        .split("=")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : input
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
  if (metarLines.length === 0) {
    showAlert(alertDiv, "Please enter a valid METAR message", "warning");
    return;
  }
  decodedMETARs = [];
  let html = "";
  metarLines.forEach((line, idx) => {
    const metar = parseMETAR(line);
    if (metar) {
      decodedMETARs.push(metar);
      const colorClass = borderColors[idx % borderColors.length];
      html += `<div class="metar-block ${colorClass}"><div class="decoded-item"><span class="decoded-label">Station</span><span class="decoded-value ${metar.stationInfo.known ? "station-known" : "station-unknown"}">${metar.station} - ${metar.stationInfo.name}</span></div>`;
      let typeStr =
        metar.type +
        (metar.correction ? " (Corrected)" : "") +
        (metar.automated ? " (Automated)" : "");
      html += `<div class="decoded-item"><span class="decoded-label">Report Type</span><span class="decoded-value">${typeStr}</span></div>`;
      if (metar.time)
        html += `<div class="decoded-item"><span class="decoded-label">Observation Time</span><span class="decoded-value">Day ${metar.time.day}, ${metar.time.hour}:${metar.time.minute} UTC</span></div>`;
      if (metar.wind)
        html += `<div class="decoded-item"><span class="decoded-label">Wind</span><span class="decoded-value">${formatWind(metar.wind)}</span></div>`;
      if (metar.visibility)
        html += `<div class="decoded-item"><span class="decoded-label">Visibility</span><span class="decoded-value">${metar.visibility.description}</span></div>`;
      if (metar.rvr.length > 0)
        html += `<div class="decoded-item"><span class="decoded-label">RVR</span><span class="decoded-value">${metar.rvr.join(", ")}</span></div>`;
      if (metar.weather.length > 0)
        html += `<div class="decoded-item"><span class="decoded-label">Present Weather</span><span class="decoded-value">${metar.weather.join(", ")}</span></div>`;
      if (metar.clouds.length > 0)
        html += `<div class="decoded-item"><span class="decoded-label">Clouds</span><span class="decoded-value">${metar.clouds.map((c) => c.description || c).join("; ")}</span></div>`;
      if (metar.temperature !== null)
        html += `<div class="decoded-item"><span class="decoded-label">Temperature</span><span class="decoded-value">${metar.temperature}°C</span></div>`;
      if (metar.dewpoint !== null)
        html += `<div class="decoded-item"><span class="decoded-label">Dewpoint</span><span class="decoded-value">${metar.dewpoint}°C</span></div>`;
      if (metar.qnh)
        html += `<div class="decoded-item"><span class="decoded-label">QNH</span><span class="decoded-value">${metar.qnh} hPa</span></div>`;
      if (metar.supplementary.length > 0)
        html += `<div class="decoded-item"><span class="decoded-label">Supplementary</span><span class="decoded-value">${metar.supplementary.join(" ")}</span></div>`;
      html += `</div>`;
    }
  });
  if (decodedMETARs.length === 0) {
    showAlert(
      alertDiv,
      "Unable to parse any METAR. Please check the format.",
      "error",
    );
    return;
  }
  alertDiv.className = "alert";
  outputDiv.classList.add("active");
  contentDiv.innerHTML = html;
  showAlert(
    alertDiv,
    `${decodedMETARs.length} METAR(s) decoded successfully!`,
    "success",
  );
}

// ========== VERIFICATION LOGIC ==========
function verifyWind(tafWind, metarWind) {
  if (!tafWind || !metarWind) return { verified: null, reason: "Missing data" };
  const fcstStr = formatWind(tafWind);
  const obsStr = formatWind(metarWind);
  const diffHtml = `<span class="diff-highlight">Fcst: ${fcstStr}<br>Obs: ${obsStr}</span>`;
  if (tafWind.direction === "Calm" && metarWind.direction === "Calm")
    return { verified: true, deviation: 0 };
  if (tafWind.direction === "Variable" || metarWind.direction === "Variable") {
    const speedDiff = Math.abs(tafWind.speed - metarWind.speed);
    return {
      verified: speedDiff <= 5,
      deviation: speedDiff,
      type: "speed",
      reason:
        speedDiff > 5
          ? `Speed diff: ${speedDiff} kt (allowed: ±5 kt)${diffHtml}`
          : null,
    };
  }
  const dirDiff = Math.abs(tafWind.direction - metarWind.direction);
  const normalizedDiff = dirDiff > 180 ? 360 - dirDiff : dirDiff;
  const speedDiff = Math.abs(tafWind.speed - metarWind.speed);
  const dirVerified = normalizedDiff <= 20;
  const speedVerified = speedDiff <= 5;
  if (dirVerified && speedVerified)
    return { verified: true, deviation: normalizedDiff, type: "direction" };
  else if (!dirVerified)
    return {
      verified: false,
      deviation: normalizedDiff,
      type: "direction",
      reason: `Direction diff: ${normalizedDiff}° (allowed: ±20°)${diffHtml}`,
    };
  else
    return {
      verified: false,
      deviation: speedDiff,
      type: "speed",
      reason: `Speed diff: ${speedDiff} kt (allowed: ±5 kt)${diffHtml}`,
    };
}

function verifyVisibility(tafVis, metarVis) {
  if (!tafVis || !metarVis) return { verified: null, reason: "Missing data" };
  const tafValue = tafVis.value;
  const metarValue = metarVis.value;
  const diffHtml = `<span class="diff-highlight">Fcst: ${tafValue}m<br>Obs: ${metarValue}m</span>`;
  let allowedDiff;
  if (tafValue <= 800) allowedDiff = 200;
  else if (tafValue <= 10000) allowedDiff = tafValue * 0.3;
  else {
    const verified = metarValue >= 10000;
    return {
      verified: verified,
      deviation: Math.abs(metarValue - tafValue),
      reason: verified ? null : `Forecast ≥10km but Observed <10km${diffHtml}`,
    };
  }
  const diff = Math.abs(metarValue - tafValue);
  return {
    verified: diff <= allowedDiff,
    deviation: diff,
    reason:
      diff > allowedDiff
        ? `Diff: ${diff}m (allowed: ${Math.round(allowedDiff)}m)${diffHtml}`
        : null,
  };
}

function verifyWeather(tafWx, metarWx) {
  const tafHasWx =
    tafWx && tafWx.length > 0 && !tafWx.includes("No Significant Weather");
  const metarHasWx = metarWx && metarWx.length > 0;
  const fcstStr = tafHasWx ? tafWx.join(", ") : "NSW";
  const obsStr = metarHasWx ? metarWx.join(", ") : "NSW";
  const diffHtml = `<span class="diff-highlight">Fcst: ${fcstStr}<br>Obs: ${obsStr}</span>`;
  if (!tafHasWx && !metarHasWx) return { verified: true };
  if (tafHasWx && metarHasWx)
    return { verified: true, note: "Both have weather" };
  return {
    verified: false,
    reason:
      (tafHasWx
        ? "Weather forecast but not observed"
        : "Weather observed but not forecast") + diffHtml,
  };
}

function verifyCloud(tafClouds, metarClouds) {
  if (!tafClouds || !metarClouds)
    return { verified: null, reason: "Missing data" };
  const getLowestCloud = (clouds) => {
    let lowest = null;
    clouds.forEach((c) => {
      if (c.height && c.height !== "///" && !isNaN(parseInt(c.height))) {
        const h = parseInt(c.height);
        if (!lowest || h < lowest) lowest = h;
      }
    });
    return lowest;
  };
  const tafLowest = getLowestCloud(tafClouds);
  const metarLowest = getLowestCloud(metarClouds);
  const formatCloud = (h) => (h ? `${h * 100}ft` : "None/NSC");
  const diffHtml = `<span class="diff-highlight">Fcst Lowest: ${formatCloud(tafLowest)}<br>Obs Lowest: ${formatCloud(metarLowest)}</span>`;
  if (!tafLowest && !metarLowest) return { verified: true };
  if (!tafLowest || !metarLowest)
    return { verified: false, reason: `Cloud coverage mismatch${diffHtml}` };
  const heightFt = tafLowest * 100;
  let allowedDiff = heightFt <= 1000 ? 1 : heightFt * 0.3;
  const actualDiff = Math.abs(tafLowest - metarLowest) * 100;
  return {
    verified: actualDiff <= allowedDiff,
    deviation: actualDiff,
    reason:
      actualDiff > allowedDiff
        ? `Height diff: ${actualDiff}ft (allowed: ${Math.round(allowedDiff)}ft)${diffHtml}`
        : null,
  };
}

function getForecastForTime(taf, metarTime) {
  if (!taf || !metarTime) return taf ? taf.baseForecast : null;
  const metarHour = parseInt(metarTime.hour);
  const metarDay = parseInt(metarTime.day);
  const metarTimeVal = metarDay * 24 + metarHour;
  for (let i = taf.changes.length - 1; i >= 0; i--) {
    const change = taf.changes[i];
    if (change.type === "FM") {
      const changeHour = parseInt(change.time.hour);
      const changeDay = parseInt(change.time.day);
      const changeTimeVal = changeDay * 24 + changeHour;
      if (metarTimeVal >= changeTimeVal) return { ...change, isChange: true };
    } else if (change.type === "BECMG" || change.type === "TEMPO") {
      const fromHour = parseInt(change.from.hour);
      const fromDay = parseInt(change.from.day);
      const toHour = parseInt(change.to.hour);
      const toDay = parseInt(change.to.day);
      const fromTimeVal = fromDay * 24 + fromHour;
      const toTimeVal = toDay * 24 + toHour;
      if (metarTimeVal >= fromTimeVal && metarTimeVal <= toTimeVal)
        return { ...change, isChange: true };
    }
  }
  return taf.baseForecast;
}

function verifyForecast() {
  const alertDiv = document.getElementById("verifyAlert");
  const outputDiv = document.getElementById("verificationOutput");
  const cardsDiv = document.getElementById("verificationCards");
  const overallDiv = document.getElementById("overallStatus");

  if (decodedTAFs.length === 0) {
    showAlert(alertDiv, "Please decode a TAF first", "warning");
    return;
  }
  if (decodedMETARs.length === 0) {
    showAlert(alertDiv, "Please decode METARs first", "warning");
    return;
  }

  alertDiv.className = "alert";
  outputDiv.classList.add("active");

  let allResults = { wind: [], visibility: [], weather: [], cloud: [] };
  const detailedData = {
    timestamps: [],
    wind: [],
    visibility: [],
    weather: [],
    cloud: [],
  };

  decodedMETARs.forEach((metar) => {
    const matchingTAF = decodedTAFs.find((t) => t.station === metar.station);
    if (!matchingTAF) return;
    const forecast = getForecastForTime(matchingTAF, metar.time);
    const vWind = verifyWind(forecast.wind, metar.wind);
    const vVis = verifyVisibility(forecast.visibility, metar.visibility);
    const vWx = verifyWeather(forecast.weather, metar.weather);
    const vCloud = verifyCloud(forecast.clouds, metar.clouds);

    allResults.wind.push(vWind);
    allResults.visibility.push(vVis);
    allResults.weather.push(vWx);
    allResults.cloud.push(vCloud);

    detailedData.timestamps.push(
      `${metar.time.day}/${metar.time.hour}:${metar.time.minute}Z`,
    );
    detailedData.wind.push({
      fcst: forecast.wind,
      obs: metar.wind,
      result: vWind,
    });
    detailedData.visibility.push({
      fcst: forecast.visibility,
      obs: metar.visibility,
      result: vVis,
    });
    detailedData.weather.push({
      fcst: forecast.weather,
      obs: metar.weather,
      result: vWx,
    });
    detailedData.cloud.push({
      fcst: forecast.clouds,
      obs: metar.clouds,
      result: vCloud,
    });
  });

  const aggregateVerification = (results) => {
    const validResults = results.filter((r) => r.verified !== null);
    if (validResults.length === 0)
      return { verified: null, reason: "No data available" };
    const correctCount = validResults.filter((r) => r.verified === true).length;
    const incorrect = validResults.find((r) => r.verified === false);
    if (correctCount === validResults.length) return { verified: true };
    return {
      verified: false,
      reason: incorrect ? incorrect.reason : "Some parameters out of range",
    };
  };

  const aggregateResults = {
    wind: aggregateVerification(allResults.wind),
    visibility: aggregateVerification(allResults.visibility),
    weather: aggregateVerification(allResults.weather),
    cloud: aggregateVerification(allResults.cloud),
  };

  const createCard = (title, result) => {
    let statusClass =
      result.verified === true
        ? "correct"
        : result.verified === false
          ? "incorrect"
          : "partial";
    let statusText =
      result.verified === true
        ? "✓ CORRECT"
        : result.verified === false
          ? "✗ INCORRECT"
          : "N/A";
    return `<div class="verify-card ${statusClass}"><h4>${title}</h4><div class="status">${statusText}</div>${result.reason ? `<p style="font-size: 0.85rem; margin-top: 10px; color: #a0a0a0;">${result.reason}</p>` : ""}</div>`;
  };

  cardsDiv.innerHTML =
    createCard("Wind", aggregateResults.wind) +
    createCard("Visibility", aggregateResults.visibility) +
    createCard("Weather", aggregateResults.weather) +
    createCard("Cloud", aggregateResults.cloud);

  const verified = Object.values(aggregateResults).filter(
    (r) => r.verified === true,
  ).length;
  const total = Object.values(aggregateResults).filter(
    (r) => r.verified !== null,
  ).length;
  let overallClass =
    verified === total && total > 0
      ? "verified"
      : verified >= total / 2
        ? "partial"
        : "not-verified";
  let overallText =
    verified === total && total > 0
      ? "✓ FULLY VERIFIED"
      : verified >= total / 2
        ? "◐ PARTIALLY VERIFIED"
        : "✗ NOT VERIFIED";

  overallDiv.innerHTML = `<div class="overall-status ${overallClass}">${overallText}<br><span style="font-size: 1rem; font-weight: normal;">${verified}/${total} parameters verified</span></div>`;

  updateDashboard(detailedData);
  showAlert(alertDiv, "Verification complete! Check results below.", "success");
}

// ========== DASHBOARD CHARTS ==========
function updateDashboard(data) {
  document.getElementById("dashboardSection").style.display = "block";
  Object.values(charts).forEach((chart) => {
    if (chart) chart.destroy();
  });
  charts = {};

  // 1. Wind Dual Line Chart
  const windLabels = data.timestamps;
  const fcstSpeed = data.wind.map((d) => d.fcst?.speed || 0);
  const obsSpeed = data.wind.map((d) => d.obs?.speed || 0);
  const dirError = data.wind.map((d) =>
    d.result.type === "direction" ? d.result.deviation : 0,
  );

  const squaredDiffs = fcstSpeed.map((f, i) => Math.pow(f - obsSpeed[i], 2));
  const rmse = Math.sqrt(
    squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length,
  ).toFixed(2);
  document.getElementById("kpiRMSE").innerText = rmse;

  const ctxWind = document.getElementById("windDualChart").getContext("2d");
  charts.wind = new Chart(ctxWind, {
    type: "line",
    data: {
      labels: windLabels,
      datasets: [
        {
          label: "Forecast Speed (kt)",
          data: fcstSpeed,
          borderColor: "#06b6d4",
          backgroundColor: "rgba(6, 182, 212, 0.1)",
          borderWidth: 2,
          tension: 0.4,
          yAxisID: "y",
        },
        {
          label: "Actual Speed (kt)",
          data: obsSpeed,
          borderColor: "#ec4899",
          backgroundColor: "rgba(236, 72, 153, 0.1)",
          borderWidth: 2,
          tension: 0.4,
          yAxisID: "y",
        },
        {
          label: "Dir Error (°)",
          data: dirError,
          type: "bar",
          backgroundColor: "rgba(248, 113, 113, 0.5)",
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          title: { display: true, text: "Speed (kt)" },
          grid: { color: "rgba(255,255,255,0.1)" },
        },
        y1: {
          position: "right",
          title: { display: true, text: "Dir Error (°)" },
          grid: { drawOnChartArea: false },
        },
        x: { grid: { color: "rgba(255,255,255,0.1)" } },
      },
      plugins: {
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x",
          },
          pan: { enabled: true, mode: "x" },
        },
      },
    },
  });

  // 2. Visibility Stacked Bar
  const getCat = (vis) => {
    if (!vis) return "Unknown";
    const v = vis.value;
    if (v < 1000) return "LIFR";
    if (v < 3000) return "IFR";
    if (v < 5000) return "MVFR";
    return "VFR";
  };
  const categories = {
    VFR: { hit: 0, miss: 0 },
    MVFR: { hit: 0, miss: 0 },
    IFR: { hit: 0, miss: 0 },
    LIFR: { hit: 0, miss: 0 },
  };
  let totalVis = 0,
    hitVis = 0;
  data.visibility.forEach((d) => {
    const cat = getCat(d.obs);
    if (categories[cat]) {
      if (d.result.verified) {
        categories[cat].hit++;
        hitVis++;
      } else categories[cat].miss++;
      totalVis++;
    }
  });
  document.getElementById("kpiVisHit").innerText = totalVis
    ? Math.round((hitVis / totalVis) * 100) + "%"
    : "--";
  const ctxVis = document.getElementById("visBarChart").getContext("2d");
  charts.vis = new Chart(ctxVis, {
    type: "bar",
    data: {
      labels: Object.keys(categories),
      datasets: [
        {
          label: "Hit",
          data: Object.values(categories).map((c) => c.hit),
          backgroundColor: "#10b981",
        },
        {
          label: "Miss",
          data: Object.values(categories).map((c) => c.miss),
          backgroundColor: "#f87171",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { color: "rgba(255,255,255,0.1)" } },
        y: { stacked: true, grid: { color: "rgba(255,255,255,0.1)" } },
      },
    },
  });

  // 3. Weather Skill Scores
  let hits = 0,
    misses = 0,
    falseAlarms = 0;
  data.weather.forEach((d) => {
    const fcstWx =
      d.fcst && d.fcst.length > 0 && !d.fcst.includes("No Significant Weather");
    const obsWx = d.obs && d.obs.length > 0;
    if (fcstWx && obsWx) hits++;
    else if (fcstWx && !obsWx) falseAlarms++;
    else if (!fcstWx && obsWx) misses++;
  });
  const pod = hits + misses > 0 ? (hits / (hits + misses)).toFixed(2) : 0;
  const csi =
    hits + misses + falseAlarms > 0
      ? (hits / (hits + misses + falseAlarms)).toFixed(2)
      : 0;
  document.getElementById("kpiCSI").innerText = csi;
  document.getElementById("kpiPOD").innerText = pod;

  // 4. Radar Chart
  const windScore =
    (data.wind.filter((d) => d.result.verified).length / data.wind.length) *
      100 || 0;
  const visScore = (hitVis / totalVis) * 100 || 0;
  const wxScore = parseFloat(csi) * 100;
  const cloudScore =
    (data.cloud.filter((d) => d.result.verified).length / data.cloud.length) *
      100 || 0;
  const ctxRadar = document.getElementById("skillRadarChart").getContext("2d");
  charts.radar = new Chart(ctxRadar, {
    type: "radar",
    data: {
      labels: ["Wind", "Visibility", "Weather", "Cloud", "Timing"],
      datasets: [
        {
          label: "Skill Score",
          data: [windScore, visScore, wxScore, cloudScore, 85],
          backgroundColor: "rgba(59, 130, 246, 0.2)",
          borderColor: "#3b82f6",
          pointBackgroundColor: "#fff",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          angleLines: { color: "rgba(255,255,255,0.1)" },
          grid: { color: "rgba(255,255,255,0.1)" },
          pointLabels: { color: "#a0a0a0" },
          suggestedMin: 0,
          suggestedMax: 100,
        },
      },
    },
  });

  // 5. Cloud Pie Chart
  const cloudMatch = data.cloud.filter((d) => d.result.verified).length;
  const cloudMismatch = data.cloud.length - cloudMatch;
  const ctxCloud = document.getElementById("cloudPieChart").getContext("2d");
  charts.cloud = new Chart(ctxCloud, {
    type: "doughnut",
    data: {
      labels: ["Match", "Mismatch"],
      datasets: [
        {
          data: [cloudMatch, cloudMismatch],
          backgroundColor: ["#10b981", "#f87171"],
          borderWidth: 0,
        },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: "60%" },
  });

  // 6. Trend Chart
  const ctxTrend = document.getElementById("trendChart").getContext("2d");
  charts.trend = new Chart(ctxTrend, {
    type: "line",
    data: {
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
      datasets: [
        {
          label: "Monthly CSI",
          data: [0.65, 0.72, 0.68, 0.75, 0.8, parseFloat(csi)],
          borderColor: "#f59e0b",
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          max: 1,
          grid: { color: "rgba(255,255,255,0.1)" },
        },
        x: { grid: { color: "rgba(255,255,255,0.1)" } },
      },
    },
  });

  // --- TIMELINE CHARTS (From Old Index) ---
  const createTimelineChart = (canvasId, label, resultData) => {
    const ctx = document.getElementById(canvasId).getContext("2d");
    // Map results: true -> 1, false -> 0, null/other -> 0.5
    const chartData = resultData.map((r) =>
      r.verified === true ? 1 : r.verified === false ? 0 : 0.5,
    );
    const colors = chartData.map((v) => (v === 1 ? "#4ade80" : "#f87171"));

    return new Chart(ctx, {
      type: "line",
      data: {
        labels: windLabels, // Reusing timestamps from wind chart
        datasets: [
          {
            label: label,
            data: chartData,
            borderColor: colors,
            backgroundColor: colors.map((c) =>
              c === "#4ade80"
                ? "rgba(74, 222, 128, 0.3)"
                : "rgba(248, 113, 113, 0.3)",
            ),
            borderWidth: 2,
            fill: true,
            stepped: true,
            pointRadius: 4,
            pointBackgroundColor: colors,
            pointBorderColor: "#fff",
            pointBorderWidth: 1,
            segment: {
              borderColor: (ctx) => {
                const val = ctx.p0.parsed.y;
                return val === 1 ? "#4ade80" : "#f87171";
              },
              backgroundColor: (ctx) => {
                const val = ctx.p0.parsed.y;
                return val === 1
                  ? "rgba(74, 222, 128, 0.3)"
                  : "rgba(248, 113, 113, 0.3)";
              },
            },
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (context) {
                const result = resultData[context.dataIndex];
                if (result.verified === true) return "Verified ✓";
                if (result.reason) return result.reason;
                return "Not verified";
              },
            },
          },
          zoom: {
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: "x",
            },
            pan: { enabled: true, mode: "x" },
          },
        },
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: -0.2,
            max: 1.2,
            ticks: { display: false }, // Hide 0/1 ticks
            grid: { color: "rgba(255,255,255,0.1)" },
          },
          x: {
            ticks: {
              display: true,
              color: "#a0a0a0",
              maxRotation: 45,
              minRotation: 45,
            },
            grid: { display: false, color: "rgba(255,255,255,0.1)" },
          },
        },
      },
    });
  };

  charts.windTimeline = createTimelineChart(
    "windTimelineChart",
    "Wind",
    data.wind.map((d) => d.result),
  );
  charts.visTimeline = createTimelineChart(
    "visTimelineChart",
    "Visibility",
    data.visibility.map((d) => d.result),
  );
  charts.wxTimeline = createTimelineChart(
    "wxTimelineChart",
    "Weather",
    data.weather.map((d) => d.result),
  );
  charts.cloudTimeline = createTimelineChart(
    "cloudTimelineChart",
    "Cloud",
    data.cloud.map((d) => d.result),
  );
}

function initEmptyDashboard() {
  // Initialize empty charts so the dashboard isn't blank on load
  const emptyLabels = ["", "", "", "", "", ""];
  const emptyData = [0, 0, 0, 0, 0, 0];

  // 1. Wind
  const ctxWind = document.getElementById("windDualChart").getContext("2d");
  charts.wind = new Chart(ctxWind, {
    type: "line",
    data: {
      labels: emptyLabels,
      datasets: [
        {
          label: "Waiting for data...",
          data: emptyData,
          borderColor: "#3b82f6",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true } },
    },
  });

  // 2. Visibility
  const ctxVis = document.getElementById("visBarChart").getContext("2d");
  charts.vis = new Chart(ctxVis, {
    type: "bar",
    data: {
      labels: ["VFR", "MVFR", "IFR", "LIFR"],
      datasets: [
        { label: "No Data", data: [0, 0, 0, 0], backgroundColor: "#334155" },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  // 3. Radar
  const ctxRadar = document.getElementById("skillRadarChart").getContext("2d");
  charts.radar = new Chart(ctxRadar, {
    type: "radar",
    data: {
      labels: ["Wind", "Visibility", "Weather", "Cloud", "Timing"],
      datasets: [
        {
          label: "Skill Score",
          data: [0, 0, 0, 0, 0],
          backgroundColor: "rgba(59, 130, 246, 0.2)",
          borderColor: "#3b82f6",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { r: { suggestedMin: 0, suggestedMax: 100 } },
    },
  });

  // 4. Timelines (Wind, Vis, Wx, Cloud)
  const createEmptyTimeline = (id, label) => {
    return new Chart(document.getElementById(id).getContext("2d"), {
      type: "line",
      data: {
        labels: emptyLabels,
        datasets: [
          {
            label: label,
            data: emptyData,
            borderColor: "#334155",
            borderDash: [5, 5],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { display: false },
          x: { display: true, grid: { display: false } },
        },
      },
    });
  };
  charts.windTimeline = createEmptyTimeline("windTimelineChart", "Wind");
  charts.visTimeline = createEmptyTimeline("visTimelineChart", "Visibility");
  charts.wxTimeline = createEmptyTimeline("wxTimelineChart", "Weather");
  charts.cloudTimeline = createEmptyTimeline("cloudTimelineChart", "Cloud");

  // 5. Cloud Pie
  const ctxCloud = document.getElementById("cloudPieChart").getContext("2d");
  charts.cloud = new Chart(ctxCloud, {
    type: "doughnut",
    data: {
      labels: ["No Data"],
      datasets: [{ data: [1], backgroundColor: ["#334155"], borderWidth: 0 }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: "60%" },
  });

  // 6. Trend
  const ctxTrend = document.getElementById("trendChart").getContext("2d");
  charts.trend = new Chart(ctxTrend, {
    type: "line",
    data: {
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
      datasets: [
        {
          label: "Monthly CSI",
          data: [0, 0, 0, 0, 0, 0],
          borderColor: "#334155",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, max: 1 } },
    },
  });
}

function toggleDashboardExpand() {
  const container = document.getElementById("dashboardSection");
  const btn = document.getElementById("expandBtn");
  container.classList.toggle("expanded-view");

  if (container.classList.contains("expanded-view")) {
    btn.innerHTML = '<i class="fas fa-compress"></i> Compact View';
  } else {
    btn.innerHTML = '<i class="fas fa-expand"></i> Expand View';
  }

  // Trigger resize for all charts to fit new container size
  setTimeout(() => {
    Object.values(charts).forEach((chart) => {
      if (chart) chart.resize();
    });
  }, 300); // Small delay for CSS transition
}

function resetCharts() {
  if (charts.wind) charts.wind.resetZoom();
}

function handleCSVUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    alert("CSV Loaded! (Parsing logic would go here to populate dashboard)");
    verifyForecast();
  };
  reader.readAsText(file);
}

function handleFileUpload(input, targetId, type) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const content = e.target.result;
    let validData = [];

    // 1. Try parsing as CSV (looking for RAW_DATA column)
    if (file.name.toLowerCase().endsWith(".csv")) {
      const lines = content.split("\n");
      if (lines.length > 0) {
        const header = lines[0].split(",");
        const rawIndex = header.findIndex(
          (h) => h.trim().replace(/^"|"$/g, "") === "RAW_DATA",
        );

        if (rawIndex !== -1) {
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            // Simple extraction of first column if RAW_DATA is first (standard in this tool)
            if (rawIndex === 0) {
              const match = line.match(/^"((?:[^"]|"")*)"/);
              if (match) {
                validData.push(match[1].replace(/""/g, '"'));
              } else {
                const parts = line.split(",");
                if (parts[0]) validData.push(parts[0].replace(/^"|"$/g, ""));
              }
            } else {
              const parts = line.split(",");
              if (parts[rawIndex])
                validData.push(
                  parts[rawIndex].replace(/^"|"$/g, "").replace(/""/g, '"'),
                );
            }
          }
        }
      }
    }

    // 2. If no valid data from CSV, try Text parsing
    if (validData.length === 0) {
      const timestamped = processFileContent(content, type);
      if (timestamped.length > 0) {
        validData = timestamped;
      } else {
        let text = content.replace(/\r\n/g, "\n");
        if (text.includes("=")) {
          validData = text
            .split("=")
            .map((s) => s.trim() + "=")
            .filter((s) => s.length > 10);
        } else {
          validData = text
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => s.length > 10);
        }
      }
    }

    // 3. Validate Content (Reject if format doesn't match)
    const filteredData = validData.filter((item) => {
      const upper = item.toUpperCase();
      if (type === "TAF") {
        return (
          upper.includes("TAF") ||
          upper.includes("BECMG") ||
          upper.includes("TEMPO") ||
          /^[A-Z]{4}\s+\d{6}Z/.test(item)
        );
      } else {
        return (
          upper.includes("METAR") ||
          upper.includes("SPECI") ||
          /^[A-Z]{4}\s+\d{6}Z/.test(item)
        );
      }
    });

    if (filteredData.length === 0) {
      const alertId = type === "TAF" ? "tafAlert" : "metarAlert";
      showAlert(
        document.getElementById(alertId),
        `Invalid file! No valid ${type} data found.`,
        "error",
      );
      input.value = "";
      return;
    }

    document.getElementById(targetId).value = filteredData.join("\n\n");
    const alertId = type === "TAF" ? "tafAlert" : "metarAlert";
    showAlert(
      document.getElementById(alertId),
      `Uploaded ${filteredData.length} valid ${type} reports.`,
      "success",
    );
    input.value = "";
  };
  reader.readAsText(file);
}

// ========== CSV HELPERS ==========
function formatDateTimeCSV(timeObj) {
  if (!timeObj) return "";
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${timeObj.day}-${month}-${year} ${timeObj.hour}:${timeObj.minute}`;
}

function parseWeatherParts(wxString) {
  if (!wxString || wxString === "NSW")
    return { int: "", desc: "", phen: wxString || "" };
  let int = "",
    desc = "",
    phen = "";
  if (wxString.startsWith("+")) {
    int = "+";
    wxString = wxString.substring(1);
  } else if (wxString.startsWith("-")) {
    int = "-";
    wxString = wxString.substring(1);
  }
  const descriptors = ["MI", "BC", "PR", "DR", "BL", "SH", "TS", "FZ", "VC"];
  for (let d of descriptors) {
    if (wxString.startsWith(d)) {
      desc = d;
      wxString = wxString.substring(2);
      break;
    }
  }
  phen = wxString;
  return { int, desc, phen };
}

// ========== CSV EXPORT ==========
function downloadCSV(type = "ALL") {
  const dataToExport = [];

  // Filter data based on type
  if (type === "ALL" || type === "TAF")
    decodedTAFs.forEach((taf) =>
      dataToExport.push({ ...taf, reportType: "TAF" }),
    );
  if (type === "ALL" || type === "METAR")
    decodedMETARs.forEach((metar) =>
      dataToExport.push({ ...metar, reportType: "METAR" }),
    );

  if (dataToExport.length === 0) {
    showAlert(
      document.getElementById(
        type === "TAF"
          ? "tafAlert"
          : type === "METAR"
            ? "metarAlert"
            : "verifyAlert",
      ),
      "No data to export!",
      "warning",
    );
    return;
  }

  const headers = [
    "RAW_DATA",
    "STATION",
    "DATETIME",
    "WIND_DIR",
    "WIND_SPEED",
    "WIND_GUST",
    "VISIBILITY",
    "CLOUDS",
    "TEMPERATURE",
    "DEWPOINT",
    "PRESSURE_QNH",
    "WX1_INT",
    "WX1_DESC",
    "WX1_PHEN",
    "WX2_INT",
    "WX2_DESC",
    "WX2_PHEN",
    "WX3_INT",
    "WX3_DESC",
    "WX3_PHEN",
    "REPORT_TYPE",
    "VALIDITY",
    "VERIFICATION",
    "REMARKS",
  ];

  const csvRows = [headers.join(",")];

  dataToExport.forEach((item) => {
    const raw = `"${(item.raw || "").replace(/"/g, '""')}"`;
    const station = item.station || "";

    // DateTime
    let dateTime = "";
    if (item.reportType === "METAR" && item.time)
      dateTime = formatDateTimeCSV(item.time);
    else if (item.reportType === "TAF" && item.issueTime)
      dateTime = formatDateTimeCSV(item.issueTime);

    // Wind
    let windDir = "",
      windSpd = "",
      windGust = "";
    const windObj =
      item.reportType === "TAF" ? item.baseForecast?.wind : item.wind;
    if (windObj) {
      windDir =
        windObj.direction === "Calm"
          ? "000"
          : windObj.direction === "Variable"
            ? "VRB"
            : String(windObj.direction).padStart(3, "0");
      windSpd = String(windObj.speed).padStart(2, "0");
      windGust = windObj.gust ? String(windObj.gust) : "";
    }

    // Visibility
    let visibility = "";
    const visObj =
      item.reportType === "TAF"
        ? item.baseForecast?.visibility
        : item.visibility;
    if (visObj) visibility = `${visObj.value} m`;

    // Clouds
    let clouds = "";
    const cloudArr =
      item.reportType === "TAF" ? item.baseForecast?.clouds : item.clouds;
    if (cloudArr && cloudArr.length > 0) {
      clouds = `"${cloudArr
        .map((c) => {
          if (c.type === "CAVOK") return "CAVOK";
          if (c.type === "NSC") return "NSC";
          let s = c.type;
          if (c.height) s += String(c.height).padStart(3, "0");
          if (c.cloudType) s += c.cloudType;
          return s;
        })
        .join(", ")}"`;
    }

    // Temp/Dew/QNH
    const temp =
      item.temperature !== null && item.temperature !== undefined
        ? item.temperature
        : "";
    const dew =
      item.dewpoint !== null && item.dewpoint !== undefined
        ? item.dewpoint
        : "";
    const qnh = item.qnh || "";

    // Weather
    const wxArr =
      item.reportType === "TAF" ? item.baseForecast?.weather : item.weather;
    let wx1 = { int: "", desc: "", phen: "" },
      wx2 = { int: "", desc: "", phen: "" },
      wx3 = { int: "", desc: "", phen: "" };
    if (wxArr && wxArr.length > 0) {
      if (wxArr[0]) wx1 = parseWeatherParts(wxArr[0]);
      if (wxArr[1]) wx2 = parseWeatherParts(wxArr[1]);
      if (wxArr[2]) wx3 = parseWeatherParts(wxArr[2]);
    }

    // TAF Specifics & Verification
    let validity = "",
      verification = "",
      remarks = "",
      reportType = item.reportType;
    if (item.reportType === "TAF" && item.validFrom && item.validTo) {
      validity = `${item.validFrom.day}${item.validFrom.hour}/${item.validTo.day}${item.validTo.hour}`;
      const duration = getValidityDuration(item.validFrom, item.validTo);
      if (duration === 9) reportType = "SHORT TAF";
      else if (duration === 30) reportType = "LONG TAF";
    }

    if (item.reportType === "METAR") {
      const taf = decodedTAFs.find((t) => t.station === item.station);
      if (taf) {
        const forecast = getForecastForTime(taf, item.time);
        const vWind = verifyWind(forecast.wind, item.wind);
        const vVis = verifyVisibility(forecast.visibility, item.visibility);
        const vWx = verifyWeather(forecast.weather, item.weather);
        const vCld = verifyCloud(forecast.clouds, item.clouds);
        if (vWind.verified && vVis.verified && vWx.verified && vCld.verified) {
          verification = "MATCH";
        } else {
          verification = "MISMATCH";
          let reasons = [];
          if (!vWind.verified) reasons.push("Wind");
          if (!vVis.verified) reasons.push("Vis");
          if (!vWx.verified) reasons.push("Wx");
          if (!vCld.verified) reasons.push("Cloud");
          remarks = reasons.join(", ");
        }
      }
    }

    csvRows.push(
      [
        raw,
        station,
        dateTime,
        windDir,
        windSpd,
        windGust,
        visibility,
        clouds,
        temp,
        dew,
        qnh,
        wx1.int,
        wx1.desc,
        wx1.phen,
        wx2.int,
        wx2.desc,
        wx2.phen,
        wx3.int,
        wx3.desc,
        wx3.phen,
        reportType,
        validity,
        verification,
        `"${remarks}"`,
      ].join(","),
    );
  });

  const blob = new Blob([csvRows.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date();
  const timestamp =
    date.toISOString().slice(0, 10).replace(/-/g, "") +
    "_" +
    date.toTimeString().slice(0, 5).replace(/:/g, "");
  link.href = url;
  link.download = `Aviation_Data_${type}_${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ========== THEME & UTILS ==========
function toggleTheme() {
  document.body.classList.toggle("light-mode");
  const isLight = document.body.classList.contains("light-mode");
  localStorage.setItem("theme", isLight ? "light" : "dark");
  updateThemeIcon(isLight);
}

function updateThemeIcon(isLight) {
  document.getElementById("themeToggle").innerHTML = isLight
    ? '<i class="fas fa-moon"></i>'
    : '<i class="fas fa-sun"></i>';
}

function toggleDropdown(event) {
  if (event) event.stopPropagation();
  document.getElementById("navDropdown").classList.toggle("show");
}

function openModal(modalId) {
  document.getElementById(modalId).classList.add("active");
  document.getElementById("navDropdown").classList.remove("show");
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove("active");
}

function toggleInfoSection() {
  const grid = document.getElementById("infoGrid");
  const icon = document.getElementById("infoToggleIcon");
  grid.classList.toggle("show");
  icon.style.transform = grid.classList.contains("show")
    ? "rotate(180deg)"
    : "rotate(0deg)";
}

document.addEventListener("DOMContentLoaded", () => {
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "light") {
    document.body.classList.add("light-mode");
    updateThemeIcon(true);
  }
  let count = parseInt(localStorage.getItem("page_views") || "1116");
  count++;
  localStorage.setItem("page_views", count.toString());
  const el = document.getElementById("visitorCount");
  if (el) el.innerText = count;
  document.addEventListener("click", function (event) {
    const dropdown = document.getElementById("navDropdown");
    const logo = document.querySelector(".logo-img");
    if (!logo.contains(event.target) && !dropdown.contains(event.target))
      dropdown.classList.remove("show");
  });

  // Initialize empty dashboard on load
  initEmptyDashboard();
});
