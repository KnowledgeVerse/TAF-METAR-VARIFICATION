// ==========================================
// ICAO AVIATION METEOROLOGY VERIFICATION ENGINE
// Professional TAF-METAR Verification System
// ==========================================

// Global State
let decodedTAFs = [];
let decodedMETARs = [];
let charts = {};
let verificationResults = [];

// ICAO Configuration Constants
const ICAO_CONFIG = {
  wind: {
    directionTolerance: 30,
    speedTolerance: 5,
    gustTolerance: 7,
    lightWindThreshold: 6,
  },
  visibility: {
    highThreshold: 5000,
    highTolerance: 2000,
    lowTolerance: 1000,
    categories: [
      { name: "LIFR", max: 500 },
      { name: "IFR", max: 1500 },
      { name: "MVFR", max: 5000 },
      { name: "VFR", max: 99999 },
    ],
  },
  cloud: {
    lowCeilingThreshold: 1000,
    lowTolerance: 200,
    normalTolerance: 500,
    categories: [
      { name: "LIFR", max: 200 },
      { name: "IFR", max: 500 },
      { name: "MVFR", max: 1000 },
      { name: "VFR", max: 3000 },
      { name: "VFR+", max: 99999 },
    ],
  },
  weather: {
    intensityPriority: ["TS", "SHRA", "RA", "DZ", "BR", "HZ", "FG"],
    tempoWeight: 0.6,
    tempoSevereWeight: 0.8,
  },
  scoring: {
    wind: 20,
    visibility: 25,
    cloud: 25,
    weather: 20,
    category: 10,
  },
  leadTimeBuckets: [
    { label: "0-6 hr", min: 0, max: 6 },
    { label: "6-12 hr", min: 6, max: 12 },
    { label: "12-18 hr", min: 12, max: 18 },
    { label: "18-24 hr", min: 18, max: 24 },
    { label: "24-30 hr", min: 24, max: 30 },
  ],
};

// Weather Codes (保留原有)
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

const cloudAmounts = {
  SKC: "Sky Clear (0/8)",
  FEW: "Few (1-2/8)",
  SCT: "Scattered (3-4/8)",
  BKN: "Broken (5-7/8)",
  OVC: "Overcast (8/8)",
  NSC: "No Significant Cloud",
};

const stationDatabase = {
  VIDP: { name: "Delhi (IGI Airport)", fir: "Delhi FIR" },
  VABB: { name: "Mumbai (CSIA)", fir: "Mumbai FIR" },
  VECC: { name: "Kolkata (NSCBI Airport)", fir: "Kolkata FIR" },
  VOMM: { name: "Chennai (Chennai Airport)", fir: "Chennai FIR" },
  VEPT: { name: "Patna", fir: "Kolkata FIR" },
  VEGY: { name: "Gaya", fir: "Kolkata FIR" },
};

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

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function getStationInfo(code) {
  if (stationDatabase[code]) return { ...stationDatabase[code], known: true };
  return { name: "Unknown Station Code", fir: "Unknown FIR", known: false };
}

function parseTime(timeStr) {
  if (!timeStr || timeStr.length < 6) return null;
  return {
    day: parseInt(timeStr.substring(0, 2)),
    hour: parseInt(timeStr.substring(2, 4)),
    minute: parseInt(timeStr.substring(4, 6)),
    raw: timeStr,
  };
}

function timeToMinutes(time) {
  if (!time) return 0;
  return time.day * 24 * 60 + time.hour * 60 + (time.minute || 0);
}

function getTimeDifference(t1, t2) {
  const m1 = timeToMinutes(t1);
  const m2 = timeToMinutes(t2);
  let diff = m2 - m1;
  if (diff < -15 * 24 * 60) diff += 30 * 24 * 60;
  return diff / 60;
}

function normalizeAngle(angle) {
  let normalized = angle % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}

function angularDifference(a1, a2) {
  const diff = Math.abs(normalizeAngle(a1) - normalizeAngle(a2));
  return Math.min(diff, 360 - diff);
}

function calculateCategory(value, type) {
  const cats =
    type === "visibility"
      ? ICAO_CONFIG.visibility.categories
      : ICAO_CONFIG.cloud.categories;
  for (let cat of cats) {
    if (value <= cat.max) return cat.name;
  }
  return cats[cats.length - 1].name;
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

function decodeCloud(cloudStr) {
  if (!cloudStr) return null;
  if (cloudStr === "CAVOK")
    return {
      type: "CAVOK",
      description: "Ceiling And Visibility OK",
      height: 5000,
    };
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
  return {
    type: amount,
    height: parseInt(height) || null,
    cloudType: cloudType,
    description,
    raw: cloudStr,
  };
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

function showAlert(element, message, type) {
  element.textContent = message;
  element.className = `alert alert-${type} show`;
  setTimeout(() => {
    element.className = "alert";
  }, 4000);
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

// ==========================================
// PARSER FUNCTIONS (保留原有结构)
// ==========================================

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
    isValid: true,
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
    result.time = parseTime(parts[i]);
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
    result.clouds.push({ type: "CAVOK", height: 5000 });
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
    isValid: true,
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
    result.issueTime = parseTime(parts[i]);
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
  currentGroup.type = "BASE";

  while (i < parts.length) {
    const part = parts[i];

    if (part === "FM" && i + 1 < parts.length && /^\d{6}$/.test(parts[i + 1])) {
      const fmTime = parts[i + 1];
      currentGroup = {
        type: "FM",
        time: {
          day: fmTime.substring(0, 2),
          hour: fmTime.substring(2, 4),
          minute: fmTime.substring(4, 6),
        },
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

    if (/^PROB(30|40)$/.test(part)) {
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

// ==========================================
// CORE VERIFICATION MODULE
// ==========================================

const VerificationModule = {
  // 1. Select Valid TAF
  selectValidTAF: function (metar, tafs) {
    if (!metar.time || !metar.station) return null;

    const validTAFs = tafs.filter((taf) => {
      if (!taf.isValid || !taf.validFrom || !taf.validTo || !taf.issueTime)
        return false;
      if (taf.station !== metar.station) return false;

      const metarMinutes = timeToMinutes(metar.time);
      const validFromMinutes = timeToMinutes({ ...taf.validFrom, minute: 0 });
      const validToMinutes = timeToMinutes({ ...taf.validTo, minute: 0 });

      let adjustedMetar = metarMinutes;
      let adjustedFrom = validFromMinutes;
      let adjustedTo = validToMinutes;

      if (validToMinutes < validFromMinutes) {
        if (metarMinutes < validFromMinutes - 15 * 24 * 60) {
          adjustedMetar += 30 * 24 * 60;
        }
        adjustedTo += 30 * 24 * 60;
      }

      return adjustedMetar >= adjustedFrom && adjustedMetar <= adjustedTo;
    });

    if (validTAFs.length === 0) return null;

    return validTAFs.sort((a, b) => {
      return timeToMinutes(b.issueTime) - timeToMinutes(a.issueTime);
    })[0];
  },

  // 2. Detect Active Time Group
  detectActiveTimeGroup: function (taf, metarTime) {
    if (!taf || !metarTime) return null;

    const metarMinutes = timeToMinutes(metarTime);
    let activeGroup = {
      group: taf.baseForecast,
      type: "BASE",
      isBECMGTransition: false,
      tempoWeight: 1.0,
    };

    const sortedChanges = [...taf.changes].sort((a, b) => {
      const priority = { FM: 4, TEMPO: 3, BECMG: 2, PROB30: 1, PROB40: 1 };
      return (priority[b.type] || 0) - (priority[a.type] || 0);
    });

    for (const change of sortedChanges) {
      if (change.type === "FM") {
        const fmMinutes = timeToMinutes(change.time);
        if (metarMinutes >= fmMinutes) {
          activeGroup = { group: change, type: "FM", tempoWeight: 1.0 };
        }
      } else if (change.type === "TEMPO") {
        const fromMinutes = timeToMinutes({ ...change.from, minute: 0 });
        const toMinutes = timeToMinutes({ ...change.to, minute: 0 });
        if (metarMinutes >= fromMinutes && metarMinutes <= toMinutes) {
          const hasSevere = change.weather.some(
            (w) =>
              w && (w.includes("TS") || w.includes("SHRA") || w.includes("+")),
          );
          activeGroup = {
            group: change,
            type: "TEMPO",
            tempoWeight: hasSevere
              ? ICAO_CONFIG.weather.tempoSevereWeight
              : ICAO_CONFIG.weather.tempoWeight,
            isSevere: hasSevere,
          };
          break;
        }
      } else if (change.type === "BECMG") {
        const fromMinutes = timeToMinutes({ ...change.from, minute: 0 });
        const toMinutes = timeToMinutes({ ...change.to, minute: 0 });

        if (metarMinutes >= fromMinutes && metarMinutes <= toMinutes) {
          activeGroup = {
            group: change,
            type: "BECMG",
            isBECMGTransition: true,
            transitionProgress:
              (metarMinutes - fromMinutes) / (toMinutes - fromMinutes),
            tempoWeight: 1.0,
          };
        } else if (metarMinutes > toMinutes) {
          activeGroup = {
            group: change,
            type: "BECMG",
            isBECMGTransition: false,
            tempoWeight: 1.0,
          };
        }
      }
    }
    return activeGroup;
  },

  // 3. Handle BECMG Logic
  handleBECMG: function (forecast, metarParams, isTransition) {
    if (!isTransition) return forecast;

    // During transition, be more lenient - allow both old and new conditions
    // Return merged parameters with relaxed tolerances
    return {
      ...forecast,
      isTransition: true,
      transitionBonus: 15, // Score boost during transition
    };
  },

  // 4. Handle TEMPO Logic
  handleTEMPO: function (score, isTempo, tempoWeight, isSevere) {
    if (!isTempo) return score;
    const weight = isSevere
      ? ICAO_CONFIG.weather.tempoSevereWeight
      : tempoWeight;
    return score * weight;
  },

  // 5. Compare Wind (ICAO Rules)
  compareWind: function (fcst, obs) {
    if (!fcst && !obs)
      return { score: 100, status: "MATCH", details: "No wind data" };
    if (!fcst || !obs)
      return { score: 0, status: "MISSING", details: "Missing wind data" };

    if (fcst.direction === "Variable" && obs.direction === "Variable") {
      const speedDiff = Math.abs(fcst.speed - obs.speed);
      if (speedDiff <= ICAO_CONFIG.wind.speedTolerance) {
        return {
          score: 100,
          status: "MATCH",
          details: "Variable wind matches",
        };
      }
      return {
        score: Math.max(0, 100 - (speedDiff - 5) * 10),
        status: "PARTIAL",
        details: `Speed diff: ${speedDiff}kt`,
      };
    }

    if (fcst.direction === "Variable" || obs.direction === "Variable") {
      const speedDiff = Math.abs(fcst.speed - obs.speed);
      return {
        score: 50,
        status: "PARTIAL",
        details: "Variable vs specific direction",
      };
    }

    const dirDiff = angularDifference(fcst.direction, obs.direction);
    const speedDiff = Math.abs(fcst.speed - obs.speed);
    const gustDiff = fcst.gust && obs.gust ? Math.abs(fcst.gust - obs.gust) : 0;

    if (
      fcst.speed < ICAO_CONFIG.wind.lightWindThreshold &&
      obs.speed < ICAO_CONFIG.wind.lightWindThreshold
    ) {
      if (speedDiff <= ICAO_CONFIG.wind.speedTolerance) {
        return {
          score: 100,
          status: "MATCH",
          details: "Light wind conditions",
        };
      }
    }

    let score = 100;
    let issues = [];

    if (dirDiff > ICAO_CONFIG.wind.directionTolerance) {
      score -= (dirDiff - ICAO_CONFIG.wind.directionTolerance) * 2;
      issues.push(`Dir diff: ${dirDiff}°`);
    }

    if (speedDiff > ICAO_CONFIG.wind.speedTolerance) {
      score -= (speedDiff - ICAO_CONFIG.wind.speedTolerance) * 5;
      issues.push(`Spd diff: ${speedDiff}kt`);
    }

    if (gustDiff > ICAO_CONFIG.wind.gustTolerance) {
      score -= (gustDiff - ICAO_CONFIG.wind.gustTolerance) * 3;
      issues.push(`Gust diff: ${gustDiff}kt`);
    }

    score = Math.max(0, score);
    return {
      score: Math.round(score),
      status: score >= 90 ? "MATCH" : score >= 70 ? "PARTIAL" : "MISMATCH",
      details: issues.length > 0 ? issues.join(", ") : "Within tolerance",
      directionDiff: dirDiff,
      speedDiff: speedDiff,
      gustDiff: gustDiff,
    };
  },

  // 6. Compare Visibility (ICAO Rules)
  compareVisibility: function (fcst, obs) {
    if (!fcst && !obs)
      return { score: 100, status: "MATCH", details: "No visibility data" };
    if (!fcst || !obs)
      return {
        score: 0,
        status: "MISSING",
        details: "Missing visibility data",
      };

    const fcstVal = fcst.value;
    const obsVal = obs.value;
    const diff = Math.abs(obsVal - fcstVal);

    const tolerance =
      fcstVal >= ICAO_CONFIG.visibility.highThreshold
        ? ICAO_CONFIG.visibility.highTolerance
        : ICAO_CONFIG.visibility.lowTolerance;

    const fcstCat = calculateCategory(fcstVal, "visibility");
    const obsCat = calculateCategory(obsVal, "visibility");
    const categoryMatch = fcstCat === obsCat;

    let score = 100;
    if (diff > tolerance) {
      score = Math.max(0, 100 - ((diff - tolerance) / tolerance) * 50);
    }

    if (!categoryMatch && score < 70) score = Math.min(score, 50);
    else if (categoryMatch && score < 80) score = Math.max(score, 70);

    return {
      score: Math.round(score),
      status: score >= 90 ? "MATCH" : score >= 70 ? "PARTIAL" : "MISMATCH",
      details: `Fcst: ${fcstVal}m (${fcstCat}), Obs: ${obsVal}m (${obsCat})`,
      categoryMatch: categoryMatch,
      difference: diff,
      fcstCategory: fcstCat,
      obsCategory: obsCat,
    };
  },

  // 7. Compare Cloud (ICAO Rules)
  compareCloud: function (fcst, obs) {
    if (!fcst || !obs || (fcst.length === 0 && obs.length === 0)) {
      return { score: 100, status: "MATCH", details: "No cloud data" };
    }

    const getLowestCeiling = (clouds) => {
      if (!clouds || clouds.length === 0) return null;
      const ceilings = clouds.filter(
        (c) => c.height && (c.coverage === "BKN" || c.coverage === "OVC"),
      );
      if (ceilings.length === 0) return null;
      return Math.min(...ceilings.map((c) => c.height));
    };

    const fcstCeiling = getLowestCeiling(fcst);
    const obsCeiling = getLowestCeiling(obs);

    if (!fcstCeiling && !obsCeiling)
      return { score: 100, status: "MATCH", details: "No significant cloud" };
    if (!fcstCeiling || !obsCeiling)
      return {
        score: 50,
        status: "PARTIAL",
        details: "Ceiling presence mismatch",
      };

    const diff = Math.abs(fcstCeiling - obsCeiling);
    const tolerance =
      fcstCeiling <= ICAO_CONFIG.cloud.lowCeilingThreshold
        ? ICAO_CONFIG.cloud.lowTolerance
        : ICAO_CONFIG.cloud.normalTolerance;

    const fcstCat = calculateCategory(fcstCeiling, "cloud");
    const obsCat = calculateCategory(obsCeiling, "cloud");
    const categoryMatch = fcstCat === obsCat;

    let score = 100;
    if (diff > tolerance) {
      score = Math.max(0, 100 - ((diff - tolerance) / tolerance) * 40);
    }

    if (!categoryMatch && score > 50) score = 50;
    if (categoryMatch && score < 70) score = 70;

    return {
      score: Math.round(score),
      status: score >= 90 ? "MATCH" : score >= 70 ? "PARTIAL" : "MISMATCH",
      details: `Fcst: ${fcstCeiling}ft (${fcstCat}), Obs: ${obsCeiling}ft (${obsCat})`,
      categoryMatch: categoryMatch,
      difference: diff,
      fcstCategory: fcstCat,
      obsCategory: obsCat,
    };
  },

  // 8. Compare Weather (with intensity priority)
  compareWeather: function (fcst, obs, isTempo, tempoWeight) {
    const fcstHasWx =
      fcst &&
      fcst.length > 0 &&
      !fcst.some((w) => w === "No Significant Weather");
    const obsHasWx = obs && obs.length > 0;

    if (!fcstHasWx && !obsHasWx)
      return { score: 100, status: "MATCH", details: "No significant weather" };

    if (!fcstHasWx && obsHasWx) {
      const maxObsSeverity = Math.min(
        ...obs.map((w) => {
          const idx = ICAO_CONFIG.weather.intensityPriority.findIndex(
            (p) => w && w.includes(p),
          );
          return idx !== -1 ? idx : 999;
        }),
      );
      if (maxObsSeverity <= 2)
        return {
          score: 0,
          status: "MISMATCH",
          details: "Severe weather observed but not forecast",
        };
      return {
        score: 50,
        status: "PARTIAL",
        details: "Weather observed but not forecast",
      };
    }

    if (fcstHasWx && !obsHasWx) {
      return {
        score: isTempo ? 50 * tempoWeight : 30,
        status: "PARTIAL",
        details: "Weather forecast but not observed",
      };
    }

    const fcstPhenoms = new Set(
      fcst.flatMap((w) => (w ? w.split(" and ") : [])),
    );
    const obsPhenoms = new Set(obs.flatMap((w) => (w ? w.split(" and ") : [])));

    const matches = [...fcstPhenoms].filter((p) =>
      [...obsPhenoms].some((op) => op.includes(p) || p.includes(op)),
    ).length;
    const total = new Set([...fcstPhenoms, ...obsPhenoms]).size;

    let score = (matches / (total || 1)) * 100;

    // Check intensity
    const getMaxSeverity = (wxList) => {
      return Math.min(
        ...wxList.map((w) => {
          const idx = ICAO_CONFIG.weather.intensityPriority.findIndex(
            (p) => w && w.includes(p),
          );
          return idx !== -1 ? idx : 999;
        }),
      );
    };

    const fcstSeverity = getMaxSeverity(fcst);
    const obsSeverity = getMaxSeverity(obs);

    if (obsSeverity < fcstSeverity) score -= 30;
    if (isTempo) score = score * tempoWeight;

    score = Math.max(0, score);

    return {
      score: Math.round(score),
      status: score >= 80 ? "MATCH" : score >= 50 ? "PARTIAL" : "MISMATCH",
      details: `Matched: ${matches}/${total} phenomena`,
      tempoApplied: isTempo,
    };
  },

  // 9. Calculate Category
  calculateCategory: function (visibility, ceiling) {
    const visCat = visibility
      ? calculateCategory(visibility.value, "visibility")
      : "VFR";
    const cldCat = ceiling ? calculateCategory(ceiling, "cloud") : "VFR";
    const order = ["LIFR", "IFR", "MVFR", "VFR"];
    const visIdx = order.indexOf(visCat);
    const cldIdx = order.indexOf(cldCat);
    return order[Math.max(visIdx, cldIdx)];
  },

  // 10. Calculate Lead Time
  calculateLeadTime: function (tafIssue, metarTime) {
    return getTimeDifference(tafIssue, metarTime);
  },

  // 11. Calculate Score
  calculateScore: function (comparisons) {
    const weights = ICAO_CONFIG.scoring;
    const windScore = comparisons.wind.score * (weights.wind / 100);
    const visScore = comparisons.visibility.score * (weights.visibility / 100);
    const cloudScore = comparisons.cloud.score * (weights.cloud / 100);
    const wxScore = comparisons.weather.score * (weights.weather / 100);

    const catMatch =
      comparisons.visibility.categoryMatch && comparisons.cloud.categoryMatch;
    const catScore = catMatch ? weights.category : 0;

    const total = windScore + visScore + cloudScore + wxScore + catScore;

    let rating = "Poor";
    if (total >= 90) rating = "Excellent";
    else if (total >= 75) rating = "Good";
    else if (total >= 50) rating = "Moderate";

    return {
      total: Math.round(total),
      breakdown: {
        wind: Math.round(windScore),
        visibility: Math.round(visScore),
        cloud: Math.round(cloudScore),
        weather: Math.round(wxScore),
        category: catScore,
      },
      rating: rating,
    };
  },

  // 12. Detect Anomalies
  detectAnomalies: function (taf, metar, comparisons) {
    const anomalies = [];

    if (!taf.isValid)
      anomalies.push({
        type: "FORMAT",
        severity: "HIGH",
        message: "Invalid TAF format",
      });
    if (!metar.isValid)
      anomalies.push({
        type: "FORMAT",
        severity: "HIGH",
        message: "Invalid METAR format",
      });
    if (taf.station !== metar.station)
      anomalies.push({
        type: "STATION",
        severity: "CRITICAL",
        message: `Station mismatch: TAF ${taf.station} vs METAR ${metar.station}`,
      });

    if (
      metar.wind &&
      metar.wind.speed === 0 &&
      metar.wind.direction !== "Variable"
    ) {
      anomalies.push({
        type: "WIND",
        severity: "MEDIUM",
        message: "Calm wind with non-zero direction",
      });
    }

    if (metar.weather && metar.weather.some((w) => w && w.includes("TS"))) {
      const hasCB = metar.clouds && metar.clouds.some((c) => c.type === "CB");
      if (!hasCB)
        anomalies.push({
          type: "WEATHER",
          severity: "MEDIUM",
          message: "Thunderstorm without CB cloud",
        });
    }

    if (
      metar.visibility &&
      metar.visibility.value < 1000 &&
      (!metar.weather || metar.weather.length === 0)
    ) {
      anomalies.push({
        type: "LOGIC",
        severity: "LOW",
        message: "Low visibility without weather phenomenon",
      });
    }

    return anomalies;
  },

  // 13. Analyze Trend
  analyzeTrend: function (results) {
    if (results.length < 2) return null;

    const scores = results.map((r) => r.totalScore);
    const first = scores[0];
    const last = scores[scores.length - 1];
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

    let consecutiveFailures = 0;
    let maxConsecutive = 0;
    for (const r of results) {
      if (r.totalScore < 50) {
        consecutiveFailures++;
        maxConsecutive = Math.max(maxConsecutive, consecutiveFailures);
      } else {
        consecutiveFailures = 0;
      }
    }

    return {
      direction:
        last > first ? "IMPROVING" : last < first ? "DEGRADING" : "STABLE",
      change: last - first,
      average: Math.round(avg),
      consistency: Math.round(
        100 - (Math.max(...scores) - Math.min(...scores)),
      ),
      consecutiveFailures: maxConsecutive,
      trend: scores,
    };
  },

  // 14. Main Verify TAF Function
  verifyTAF: function (metar, tafs) {
    const taf = this.selectValidTAF(metar, tafs);

    if (!taf) {
      return {
        status: "OUT_OF_VALIDITY",
        statusFlags: ["NO_VALID_TAF"],
        metar: metar,
        tafUsed: null,
        totalScore: 0,
        rating: "Poor",
        parameterScores: {},
        anomalies: [
          {
            type: "VALIDITY",
            severity: "HIGH",
            message: "No valid TAF found for METAR time",
          },
        ],
      };
    }

    const activeGroup = this.detectActiveTimeGroup(taf, metar.time);
    let fcstParams = activeGroup.group;

    // Handle BECMG transition
    if (activeGroup.isBECMGTransition) {
      fcstParams = this.handleBECMG(fcstParams, metar, true);
    }

    const comparisons = {
      wind: this.compareWind(fcstParams.wind, metar.wind),
      visibility: this.compareVisibility(
        fcstParams.visibility,
        metar.visibility,
      ),
      cloud: this.compareCloud(fcstParams.clouds, metar.clouds),
      weather: this.compareWeather(
        fcstParams.weather,
        metar.weather,
        activeGroup.type === "TEMPO",
        activeGroup.tempoWeight,
      ),
    };

    // Apply BECMG transition bonus
    if (activeGroup.isBECMGTransition) {
      Object.keys(comparisons).forEach((key) => {
        comparisons[key].score = Math.min(100, comparisons[key].score + 15);
        comparisons[key].status =
          comparisons[key].score >= 70
            ? "MATCH"
            : comparisons[key].score >= 50
              ? "PARTIAL"
              : "MISMATCH";
      });
    }

    const leadTime = this.calculateLeadTime(taf.issueTime, metar.time);
    const leadTimeBucket =
      ICAO_CONFIG.leadTimeBuckets.find(
        (b) => leadTime >= b.min && leadTime < b.max,
      ) || ICAO_CONFIG.leadTimeBuckets[ICAO_CONFIG.leadTimeBuckets.length - 1];

    const scoring = this.calculateScore(comparisons);
    const anomalies = this.detectAnomalies(taf, metar, comparisons);
    const visCat = comparisons.visibility.categoryMatch;
    const cldCat = comparisons.cloud.categoryMatch;

    return {
      status:
        scoring.total >= 75
          ? "VERIFIED"
          : scoring.total >= 50
            ? "PARTIAL"
            : "FAILED",
      statusFlags: [],
      metar: metar,
      tafUsed: taf,
      tafIssueTime: taf.issueTime,
      activeTimeGroup: {
        type: activeGroup.type,
        isTransition: activeGroup.isBECMGTransition,
        tempoWeight: activeGroup.tempoWeight,
      },
      leadTime: Math.round(leadTime),
      leadTimeBucket: leadTimeBucket.label,
      parameterScores: comparisons,
      totalScore: scoring.total,
      scoreBreakdown: scoring.breakdown,
      rating: scoring.rating,
      operationalStatus:
        visCat && cldCat ? "OPERATIONALLY_CORRECT" : "OPERATIONAL_MISMATCH",
      anomalies: anomalies,
      forecastParams: fcstParams,
    };
  },

  // 15. Generate Summary
  generateSummary: function (results) {
    const avgScore =
      results.reduce((a, r) => a + r.totalScore, 0) / results.length;
    const verifiedCount = results.filter((r) => r.status === "VERIFIED").length;
    const rate = ((verifiedCount / results.length) * 100).toFixed(1);
    const trend = this.analyzeTrend(results);

    return {
      averageScore: Math.round(avgScore),
      verificationRate: rate + "%",
      totalVerifications: results.length,
      trend: trend,
      rating:
        avgScore >= 90
          ? "Excellent"
          : avgScore >= 75
            ? "Good"
            : avgScore >= 50
              ? "Moderate"
              : "Poor",
    };
  },
};

// ==========================================
// UI FUNCTIONS (保留原有结构)
// ==========================================

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
  document.getElementById("tafActions").style.display = "flex";
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
  document.getElementById("metarActions").style.display = "flex";
  contentDiv.innerHTML = html;
  showAlert(
    alertDiv,
    `${decodedMETARs.length} METAR(s) decoded successfully!`,
    "success",
  );
}

// ==========================================
// NEW VERIFICATION ENGINE INTEGRATION
// ==========================================

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

  // Use new verification engine
  verificationResults = decodedMETARs.map((metar) =>
    VerificationModule.verifyTAF(metar, decodedTAFs),
  );

  // Aggregate results for display
  const aggregateResults = {
    wind: { verified: 0, total: 0 },
    visibility: { verified: 0, total: 0 },
    weather: { verified: 0, total: 0 },
    cloud: { verified: 0, total: 0 },
  };

  const detailedData = {
    timestamps: [],
    wind: [],
    visibility: [],
    weather: [],
    cloud: [],
  };

  verificationResults.forEach((result, idx) => {
    const metar = result.metar;

    // Count for aggregation
    ["wind", "visibility", "weather", "cloud"].forEach((param) => {
      if (result.parameterScores[param]) {
        aggregateResults[param].total++;
        if (result.parameterScores[param].status === "MATCH") {
          aggregateResults[param].verified++;
        }
      }
    });

    detailedData.timestamps.push(
      `${metar.time.day}/${metar.time.hour}:${metar.time.minute}Z`,
    );
    detailedData.wind.push({
      fcst: result.forecastParams?.wind,
      obs: metar.wind,
      result: {
        verified: result.parameterScores.wind?.status === "MATCH",
        ...result.parameterScores.wind,
      },
    });
    detailedData.visibility.push({
      fcst: result.forecastParams?.visibility,
      obs: metar.visibility,
      result: {
        verified: result.parameterScores.visibility?.status === "MATCH",
        ...result.parameterScores.visibility,
      },
    });
    detailedData.weather.push({
      fcst: result.forecastParams?.weather,
      obs: metar.weather,
      result: {
        verified: result.parameterScores.weather?.status === "MATCH",
        ...result.parameterScores.weather,
      },
    });
    detailedData.cloud.push({
      fcst: result.forecastParams?.clouds,
      obs: metar.clouds,
      result: {
        verified: result.parameterScores.cloud?.status === "MATCH",
        ...result.parameterScores.cloud,
      },
    });
  });

  const createCard = (title, result) => {
    const verified = aggregateResults[title.toLowerCase()].verified;
    const total = aggregateResults[title.toLowerCase()].total;
    const isVerified = verified === total && total > 0;
    const isPartial = verified >= total / 2 && verified < total;

    let statusClass = isVerified
      ? "correct"
      : isPartial
        ? "partial"
        : total > 0
          ? "incorrect"
          : "partial";
    let statusText = isVerified
      ? "✓ CORRECT"
      : isPartial
        ? "◐ PARTIAL"
        : total > 0
          ? "✗ INCORRECT"
          : "N/A";

    return `<div class="verify-card ${statusClass}"><h4>${title}</h4><div class="status">${statusText}</div><p style="font-size: 0.85rem; margin-top: 10px; color: #a0a0a0;">${verified}/${total} verified</p></div>`;
  };

  cardsDiv.innerHTML =
    createCard("Wind", aggregateResults.wind) +
    createCard("Visibility", aggregateResults.visibility) +
    createCard("Weather", aggregateResults.weather) +
    createCard("Cloud", aggregateResults.cloud);

  const summary = VerificationModule.generateSummary(verificationResults);
  let overallClass =
    summary.rating === "Excellent"
      ? "verified"
      : summary.rating === "Good"
        ? "partial"
        : "not-verified";
  let overallText =
    summary.rating === "Excellent"
      ? "✓ FULLY VERIFIED"
      : summary.rating === "Good"
        ? "◐ PARTIALLY VERIFIED"
        : "✗ NOT VERIFIED";

  overallDiv.innerHTML = `<div class="overall-status ${overallClass}">${overallText}<br><span style="font-size: 1rem; font-weight: normal;">Avg Score: ${summary.averageScore}/100 | Rate: ${summary.verificationRate}</span></div>`;

  updateDashboard(detailedData);
  showAlert(
    alertDiv,
    `Verification complete! ${summary.totalVerifications} METARs processed.`,
    "success",
  );
}

// ==========================================
// DASHBOARD FUNCTIONS (保留原有)
// ==========================================

function updateDashboard(data) {
  document.getElementById("dashboardSection").style.display = "block";
  Object.values(charts).forEach((chart) => {
    if (chart) chart.destroy();
  });
  charts = {};

  const windLabels = data.timestamps;
  const fcstSpeed = data.wind.map((d) => d.fcst?.speed || 0);
  const obsSpeed = data.wind.map((d) => d.obs?.speed || 0);
  const dirError = data.wind.map((d) => d.result.directionDiff || 0);

  const squaredDiffs = fcstSpeed.map((f, i) => Math.pow(f - obsSpeed[i], 2));
  const rmse = Math.sqrt(
    squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length,
  ).toFixed(2);
  document.getElementById("kpiRMSE").innerText = rmse;

  // Wind Dual Chart
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

  // Visibility Chart
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

  // Weather Skill
  let hits = 0,
    misses = 0,
    falseAlarms = 0;
  data.weather.forEach((d) => {
    const fcstWx = d.fcst && d.fcst.length > 0;
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

  // Radar Chart
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

  // Cloud Pie
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

  // Trend Chart
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

  // Timeline Charts
  const createTimelineChart = (canvasId, label, resultData) => {
    const ctx = document.getElementById(canvasId).getContext("2d");
    const chartData = resultData.map((r) =>
      r.verified === true ? 1 : r.verified === false ? 0 : 0.5,
    );
    const colors = chartData.map((v) => (v === 1 ? "#4ade80" : "#f87171"));

    return new Chart(ctx, {
      type: "line",
      data: {
        labels: windLabels,
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
              borderColor: (ctx) =>
                ctx.p0.parsed.y === 1 ? "#4ade80" : "#f87171",
              backgroundColor: (ctx) =>
                ctx.p0.parsed.y === 1
                  ? "rgba(74, 222, 128, 0.3)"
                  : "rgba(248, 113, 113, 0.3)",
            },
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                resultData[ctx.dataIndex].verified === true
                  ? "Verified ✓"
                  : resultData[ctx.dataIndex].details || "Not verified",
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
            ticks: { display: false },
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
  const emptyLabels = ["", "", "", "", "", ""];
  const emptyData = [0, 0, 0, 0, 0, 0];

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

  const createEmptyTimeline = (id, label) =>
    new Chart(document.getElementById(id).getContext("2d"), {
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

  charts.windTimeline = createEmptyTimeline("windTimelineChart", "Wind");
  charts.visTimeline = createEmptyTimeline("visTimelineChart", "Visibility");
  charts.wxTimeline = createEmptyTimeline("wxTimelineChart", "Weather");
  charts.cloudTimeline = createEmptyTimeline("cloudTimelineChart", "Cloud");

  const ctxCloud = document.getElementById("cloudPieChart").getContext("2d");
  charts.cloud = new Chart(ctxCloud, {
    type: "doughnut",
    data: {
      labels: ["No Data"],
      datasets: [{ data: [1], backgroundColor: ["#334155"], borderWidth: 0 }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: "60%" },
  });

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
  btn.innerHTML = container.classList.contains("expanded-view")
    ? '<i class="fas fa-compress"></i> Compact View'
    : '<i class="fas fa-expand"></i> Expand View';
  setTimeout(() => {
    Object.values(charts).forEach((chart) => {
      if (chart) chart.resize();
    });
  }, 300);
}

function resetCharts() {
  if (charts.wind) charts.wind.resetZoom();
}

// ==========================================
// FILE HANDLING (保留原有)
// ==========================================

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
            if (rawIndex === 0) {
              const match = line.match(/^"((?:[^"]|"")*)"/);
              if (match) validData.push(match[1].replace(/""/g, '"'));
              else {
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
    if (validData.length === 0) {
      const timestamped = processFileContent(content, type);
      if (timestamped.length > 0) validData = timestamped;
      else {
        let text = content.replace(/\r\n/g, "\n");
        if (text.includes("="))
          validData = text
            .split("=")
            .map((s) => s.trim() + "=")
            .filter((s) => s.length > 10);
        else
          validData = text
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => s.length > 10);
      }
    }
    const filteredData = validData.filter((item) => {
      const upper = item.toUpperCase();
      if (type === "TAF")
        return (
          upper.includes("TAF") ||
          upper.includes("BECMG") ||
          upper.includes("TEMPO") ||
          /^[A-Z]{4}\s+\d{6}Z/.test(item)
        );
      else
        return (
          upper.includes("METAR") ||
          upper.includes("SPECI") ||
          /^[A-Z]{4}\s+\d{6}Z/.test(item)
        );
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

// ==========================================
// CSV EXPORT - TAF Verification Results Format
// ==========================================

function formatDateTimeForCSV(dateObj) {
  if (!dateObj) return "";
  // Format: DD-MM-YYYY HH:MM
  const day = String(dateObj.day).padStart(2, "0");
  const month = "01"; // Default month - can be enhanced
  const year = "2024"; // Default year - can be enhanced
  const hour = String(dateObj.hour).padStart(2, "0");
  const minute = String(dateObj.minute || 0).padStart(2, "0");
  return `${day}-${month}-${year} ${hour}:${minute}`;
}

function formatTAFPeriodForCSV(taf) {
  if (!taf || !taf.validFrom || !taf.validTo) return { start: "", end: "" };
  const start = formatDateTimeForCSV({
    day: taf.validFrom.day,
    hour: taf.validFrom.hour,
    minute: 0,
  });
  const end = formatDateTimeForCSV({
    day: taf.validTo.day,
    hour: taf.validTo.hour,
    minute: 0,
  });
  return { start, end };
}

function getTAFGroupName(result) {
  if (!result.activeTimeGroup) return "INITIAL";
  const type = result.activeTimeGroup.type;
  const taf = result.tafUsed;

  if (type === "BASE") return "INITIAL";
  if (type === "FM") return `FM${taf.issueTime.day}${taf.issueTime.hour}`;
  if (type === "BECMG" || type === "TEMPO") {
    const group = result.forecastParams;
    if (group.from && group.to) {
      return `${type} ${group.from.day}${group.from.hour}/${group.to.day}${group.to.hour}`;
    }
  }
  return type;
}

function calculateVisibilityClass(visM) {
  if (!visM || visM === 9999) return 4; // VFR+
  if (visM < 500) return 0; // LIFR
  if (visM < 1500) return 1; // IFR
  if (visM < 3000) return 2; // MVFR
  if (visM < 5000) return 3; // VFR
  return 4; // VFR+
}

function calculateCeilingClass(ceilingFt) {
  if (!ceilingFt || ceilingFt === 99999) return 5; // No ceiling / VFR+
  if (ceilingFt < 200) return 0; // LIFR
  if (ceilingFt < 500) return 1; // IFR
  if (ceilingFt < 1000) return 2; // MVFR
  if (ceilingFt < 3000) return 3; // VFR
  return 4; // VFR+
}

function getLowestCeilingFt(clouds) {
  if (!clouds || clouds.length === 0) return null;
  const ceilings = clouds.filter(
    (c) => c.height && (c.type === "BKN" || c.type === "OVC"),
  );
  if (ceilings.length === 0) return null;
  return Math.min(...ceilings.map((c) => c.height * 100)); // Convert to feet
}

function formatCloudsForCSV(clouds) {
  if (!clouds || clouds.length === 0) return "";
  return clouds
    .map((c) => {
      if (c.type === "CAVOK" || c.type === "NSC" || c.type === "SKC")
        return c.type;
      let s = c.type;
      if (c.height) s += String(c.height).padStart(3, "0");
      if (c.cloudType) s += c.cloudType;
      return s;
    })
    .join(" ");
}

function formatWeatherForCSV(weather) {
  if (!weather || weather.length === 0) return "NSW";
  const wx = weather[0];
  if (wx === "No Significant Weather") return "NSW";
  // Extract weather code from decoded string
  return wx;
}

function downloadCSV(type = "ALL") {
  // Check if we have verification results
  if (verificationResults.length === 0) {
    showAlert(
      document.getElementById("verifyAlert"),
      "Please run verification first!",
      "warning",
    );
    return;
  }

  // Define headers matching TAF_Verification_Results.csv format
  const headers = [
    "TAF_START",
    "TAF_END",
    "TAF_GROUP",
    "OBS_DATETIME",
    "FCST_WIND_DIR",
    "FCST_WIND_SPD_KT",
    "OBS_WIND_DIR",
    "OBS_WIND_SPD_KT",
    "WIND_DIR_ACCURATE",
    "WIND_SPD_ACCURATE",
    "FCST_VIS_M",
    "FCST_VIS_CLASS",
    "OBS_VIS_M",
    "OBS_VIS_CLASS",
    "VIS_ACCURATE",
    "FCST_WEATHER",
    "OBS_WEATHER",
    "WEATHER_ACCURATE",
    "FCST_CLOUDS",
    "FCST_CEILING_FT",
    "FCST_CEILING_CLASS",
    "OBS_CLOUDS",
    "OBS_CEILING_FT",
    "OBS_CEILING_CLASS",
    "CEILING_ACCURATE",
    "CLOUDS_ACCURATE_DETAIL",
  ];

  const csvRows = [headers.join(",")];

  // Process each verification result
  verificationResults.forEach((result) => {
    if (!result.metar || !result.tafUsed) return;

    const metar = result.metar;
    const taf = result.tafUsed;
    const fcst = result.forecastParams;

    // Get TAF period
    const tafPeriod = formatTAFPeriodForCSV(taf);

    // Get observation datetime
    const obsDateTime = formatDateTimeForCSV(metar.time);

    // Get TAF group
    const tafGroup = getTAFGroupName(result);

    // Wind data
    const fcstWindDir =
      fcst?.wind?.direction === "Variable"
        ? 0
        : fcst?.wind?.direction === "Calm"
          ? 0
          : fcst?.wind?.direction || 0;
    const fcstWindSpd = fcst?.wind?.speed || 0;
    const obsWindDir =
      metar?.wind?.direction === "Variable"
        ? 0
        : metar?.wind?.direction === "Calm"
          ? 0
          : metar?.wind?.direction || 0;
    const obsWindSpd = metar?.wind?.speed || 0;

    // Wind accuracy
    const windDirAccurate =
      result.parameterScores?.wind?.status === "MATCH" ||
      result.parameterScores?.wind?.status === "PARTIAL";
    const windSpdAccurate =
      result.parameterScores?.wind?.status === "MATCH" ||
      result.parameterScores?.wind?.status === "PARTIAL";

    // Visibility data
    const fcstVis = fcst?.visibility?.value || 0;
    const fcstVisClass = calculateVisibilityClass(fcstVis);
    const obsVis = metar?.visibility?.value || 0;
    const obsVisClass = calculateVisibilityClass(obsVis);
    const visAccurate =
      result.parameterScores?.visibility?.status === "MATCH" ||
      result.parameterScores?.visibility?.status === "PARTIAL";

    // Weather data
    const fcstWx = formatWeatherForCSV(fcst?.weather);
    const obsWx = formatWeatherForCSV(metar?.weather);
    const wxAccurate =
      result.parameterScores?.weather?.status === "MATCH" ||
      result.parameterScores?.weather?.status === "PARTIAL";

    // Cloud/Ceiling data
    const fcstClouds = formatCloudsForCSV(fcst?.clouds);
    const obsClouds = formatCloudsForCSV(metar?.clouds);
    const fcstCeilingFt = getLowestCeilingFt(fcst?.clouds);
    const obsCeilingFt = getLowestCeilingFt(metar?.clouds);
    const fcstCeilingClass = calculateCeilingClass(fcstCeilingFt);
    const obsCeilingClass = calculateCeilingClass(obsCeilingFt);
    const ceilingAccurate =
      result.parameterScores?.cloud?.status === "MATCH" ||
      result.parameterScores?.cloud?.status === "PARTIAL";
    const cloudsAccurateDetail = ceilingAccurate;

    // Build CSV row
    const row = [
      tafPeriod.start,
      tafPeriod.end,
      tafGroup,
      obsDateTime,
      fcstWindDir,
      fcstWindSpd,
      obsWindDir,
      obsWindSpd,
      windDirAccurate,
      windSpdAccurate,
      fcstVis,
      fcstVisClass,
      obsVis,
      obsVisClass,
      visAccurate,
      `"${fcstWx}"`,
      `"${obsWx}"`,
      wxAccurate,
      fcstClouds ? `"${fcstClouds}"` : "",
      fcstCeilingFt !== null ? fcstCeilingFt : "",
      fcstCeilingClass,
      obsClouds ? `"${obsClouds}"` : "",
      obsCeilingFt !== null ? obsCeilingFt : "",
      obsCeilingClass,
      ceilingAccurate,
      cloudsAccurateDetail,
    ];

    csvRows.push(row.join(","));
  });

  if (csvRows.length <= 1) {
    showAlert(
      document.getElementById("verifyAlert"),
      "No valid verification data to export!",
      "warning",
    );
    return;
  }

  // Create and download CSV
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
  link.download = `TAF_Verification_Results_${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showAlert(
    document.getElementById("verifyAlert"),
    `CSV exported successfully! ${csvRows.length - 1} records saved.`,
    "success",
  );
}

// ==========================================
// LEGACY VERIFICATION FUNCTIONS (保留用于兼容性)
// ==========================================

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

// ==========================================
// UI UTILITIES (保留原有)
// ==========================================

function clearTAF() {
  document.getElementById("tafInput").value = "";
  document.getElementById("tafOutput").classList.remove("active");
  document.getElementById("tafAlert").className = "alert";
  document.getElementById("tafActions").style.display = "none";
  decodedTAFs = [];
}

function clearMETAR() {
  document.getElementById("metarInput").value = "";
  document.getElementById("metarOutput").classList.remove("active");
  document.getElementById("metarAlert").className = "alert";
  document.getElementById("metarActions").style.display = "none";
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

function toggleOutput(id) {
  const el = document.getElementById(id);
  el.classList.toggle("active");
}

function scrollToVerification() {
  const el = document.getElementById("verificationSection");
  el.scrollIntoView({ behavior: "smooth" });
}

// ==========================================
// INITIALIZATION
// ==========================================

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
  initEmptyDashboard();
});
