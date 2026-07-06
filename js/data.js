// data.js — Load Sapporo weather + Hokkaido heatstroke CSVs, map today's temp_max
// to a heat stage, and precompute heatstroke stats per stage.

(function (global) {
  "use strict";

  const WEATHER_CSV = "./data/Sapporo_weather_daily_10Y.csv";
  const HEAT_CSV = "./data/Hokkaido_heatstroke_daily_10Y.csv";

  // Live weather — Open-Meteo (free, no API key, CORS-enabled). Sapporo (JMA 47412).
  const SAPPORO = { lat: 43.0618, lon: 141.3545, place: "삿포로", geolocated: false };
  const LIVE_TIMEOUT_MS = 4500;
  const GEO_TIMEOUT_MS = 6000;

  function liveUrl(lat, lon) {
    return (
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m&daily=temperature_2m_max&timezone=auto&forecast_days=1`
    );
  }

  // Reverse geocode coords -> Korean place name (BigDataCloud: free, no key, CORS).
  async function reverseGeocode(lat, lon) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const url =
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}` +
        `&longitude=${lon}&localityLanguage=ko`;
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) return null;
      const j = await r.json();
      const parts = [];
      if (j.principalSubdivision) parts.push(j.principalSubdivision);
      const local = j.locality || j.city;
      if (local && local !== j.principalSubdivision) parts.push(local);
      return parts.join(" ") || j.city || j.countryName || null;
    } catch (e) {
      return null;
    }
  }

  // Ask the browser for the user's location; always resolves (Sapporo fallback).
  function getCoords() {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) return resolve(SAPPORO);
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const timer = setTimeout(() => finish(SAPPORO), GEO_TIMEOUT_MS);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          clearTimeout(timer);
          const lat = pos.coords.latitude, lon = pos.coords.longitude;
          const name = await reverseGeocode(lat, lon);
          finish({ lat, lon, place: "📍 " + (name || "내 위치"), geolocated: true });
        },
        () => { clearTimeout(timer); finish(SAPPORO); },
        { timeout: GEO_TIMEOUT_MS, maximumAge: 600000 }
      );
    });
  }

  // Heat stages by temp_max (℃). Drain/reward tuning lives in game.js.
  const STAGES = [
    { key: "comfortable", label: "쾌적", jp: "", max: 25, tone: "cool" },
    { key: "warm", label: "더움", jp: "", max: 30, tone: "warm" },
    { key: "midsummer", label: "真夏日", jp: "마나쓰비", max: 35, tone: "hot" },
    { key: "heatwave", label: "猛暑日", jp: "모-쇼비", max: Infinity, tone: "blaze" },
  ];

  function stageForTemp(tempMax) {
    for (const s of STAGES) if (tempMax < s.max) return s;
    return STAGES[STAGES.length - 1];
  }

  // --- CSV parsing ----------------------------------------------------------
  function parseCSV(text) {
    text = text.replace(/^﻿/, ""); // strip BOM
    const lines = text.trim().split(/\r?\n/);
    const header = lines[0].split(",");
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",");
      const obj = {};
      for (let j = 0; j < header.length; j++) obj[header[j]] = cells[j];
      rows.push(obj);
    }
    return rows;
  }

  function num(v) {
    if (v === undefined || v === "") return null;
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }

  // --- Store ----------------------------------------------------------------
  const state = {
    weather: new Map(), // "YYYY-MM-DD" -> { tempMax, tempMean }
    heatByStage: {}, // stageKey -> { avg, n }
    live: null, // { tempNow, tempMax, place, geolocated } or null on failure
    loaded: false,
  };

  // Fetch live weather for coords; resolves to null on any failure/timeout.
  async function fetchLive(coords) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), LIVE_TIMEOUT_MS);
      const r = await fetch(liveUrl(coords.lat, coords.lon), { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) return null;
      const j = await r.json();
      const tempNow = j.current && j.current.temperature_2m;
      const tempMax = j.daily && j.daily.temperature_2m_max && j.daily.temperature_2m_max[0];
      if (typeof tempNow !== "number" && typeof tempMax !== "number") return null;
      return {
        tempNow: typeof tempNow === "number" ? tempNow : null,
        tempMax: typeof tempMax === "number" ? tempMax : tempNow,
        place: coords.place,
        geolocated: coords.geolocated,
      };
    } catch (e) {
      console.warn("live weather fetch failed, using CSV fallback", e);
      return null;
    }
  }

  function todayISO() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /**
   * Resolve a date's temp_max, falling back when out of dataset range.
   * @returns {{tempMax:number, source:"exact"|"sameday"|"average", usedDate:string|null}}
   */
  function resolveTempMax(dateStr) {
    const w = state.weather;
    if (w.has(dateStr)) {
      return { tempMax: w.get(dateStr).tempMax, source: "exact", usedDate: dateStr };
    }
    const mmdd = dateStr.slice(5); // MM-DD
    let best = null;
    for (const [d, row] of w) {
      if (d.slice(5) === mmdd && row.tempMax != null) {
        if (!best || d > best.date) best = { date: d, tempMax: row.tempMax };
      }
    }
    if (best) return { tempMax: best.tempMax, source: "sameday", usedDate: best.date };

    // Ultimate fallback: average temp_max across the same month.
    const mm = dateStr.slice(5, 7);
    let sum = 0,
      n = 0;
    for (const [d, row] of w) {
      if (d.slice(5, 7) === mm && row.tempMax != null) {
        sum += row.tempMax;
        n++;
      }
    }
    const avg = n ? sum / n : 24;
    return { tempMax: Math.round(avg * 10) / 10, source: "average", usedDate: null };
  }

  // Precompute average daily heatstroke transports per heat stage.
  function computeHeatStats(heatRows) {
    const buckets = {};
    STAGES.forEach((s) => (buckets[s.key] = { sum: 0, n: 0 }));
    for (const row of heatRows) {
      const date = row.date;
      const t = num(row.transported_total);
      const wRow = state.weather.get(date);
      if (t == null || !wRow || wRow.tempMax == null) continue;
      const s = stageForTemp(wRow.tempMax);
      buckets[s.key].sum += t;
      buckets[s.key].n += 1;
    }
    const out = {};
    for (const key in buckets) {
      const b = buckets[key];
      out[key] = { avg: b.n ? b.sum / b.n : null, n: b.n };
    }
    return out;
  }

  async function load() {
    // CSVs are required; live weather (geolocated) is a best-effort enhancement.
    const [wText, hText, coords] = await Promise.all([
      fetch(WEATHER_CSV).then((r) => {
        if (!r.ok) throw new Error(`weather CSV ${r.status}`);
        return r.text();
      }),
      fetch(HEAT_CSV).then((r) => (r.ok ? r.text() : "")),
      getCoords(),
    ]);

    for (const row of parseCSV(wText)) {
      state.weather.set(row.date, {
        tempMax: num(row.temp_max),
        tempMean: num(row.temp_mean),
      });
    }
    if (hText) state.heatByStage = computeHeatStats(parseCSV(hText));
    state.live = await fetchLive(coords);
    state.loaded = true;
  }

  // Assemble today's snapshot for the UI/game.
  // Prefers live Open-Meteo data; falls back to the bundled CSV otherwise.
  function todaySnapshot() {
    const date = todayISO();
    let tempMax, tempNow = null, source, usedDate;

    let place = "삿포로", geolocated = false;
    if (state.live && state.live.tempMax != null) {
      tempMax = state.live.tempMax;
      tempNow = state.live.tempNow;
      place = state.live.place;
      geolocated = state.live.geolocated;
      source = "live";
      usedDate = null;
    } else {
      const res = resolveTempMax(date);
      tempMax = res.tempMax;
      source = res.source; // exact | sameday | average
      usedDate = res.usedDate;
    }

    const stage = stageForTemp(tempMax);
    const heat = state.heatByStage[stage.key] || null;
    return {
      date,
      tempMax,
      tempNow, // live current temperature, or null
      place, // "삿포로" | "📍 내 위치"
      geolocated,
      source, // live | exact | sameday | average
      usedDate,
      stage, // {key,label,jp,tone,...}
      heatAvg: heat && heat.avg != null ? heat.avg : null,
      heatN: heat ? heat.n : 0,
    };
  }

  global.Data = {
    load,
    todaySnapshot,
    stageForTemp,
    STAGES,
    get loaded() {
      return state.loaded;
    },
  };
})(window);
