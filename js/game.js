// game.js — Hydration pet state machine: localStorage persistence, gauge drain,
// watering + cooldown, and daily streaks.

(function (global) {
  "use strict";

  // --- Tunables (all per heat stage where relevant) -------------------------
  const CONFIG = {
    gaugeMax: 100,
    gaugeInit: 55,
    dailyGoal: 8, // cups per day (each watering = one cup you actually drank)
    // Gauge points drained per hour — hotter = thirstier.
    drainPerHour: { comfortable: 4, warm: 6, midsummer: 10, heatwave: 15 },
    // Short soft cooldown between cups (minutes) — spreads intake, hotter = shorter.
    // TEMP: set to 0 for testing/verification (was 20/15/12/10).
    cooldownMin: { comfortable: 0, warm: 0, midsummer: 0, heatwave: 0 },
    // Gauge recovered per cup — hotter = bigger reward.
    reward: { comfortable: 20, warm: 25, midsummer: 32, heatwave: 40 },
  };

  const KEY = "sapporo_pet_v1";

  const S = {
    gauge: CONFIG.gaugeInit,
    waterCount: 0, // lifetime cups
    cupsToday: 0, // cups on cupsDate
    cupsDate: null, // YYYY-MM-DD the cupsToday counter belongs to
    streak: 0,
    maxStreak: 0,
    lastWateredAt: null, // ms epoch
    lastWateredDate: null, // YYYY-MM-DD
    lastActiveAt: null, // ms epoch (for offline drain)
  };

  // --- Date helpers ---------------------------------------------------------
  function isoOf(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function todayISO() {
    return isoOf(new Date());
  }
  function shiftISO(iso, days) {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + days);
    return isoOf(d);
  }

  // --- Persistence ----------------------------------------------------------
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(S));
    } catch (e) {
      console.warn("localStorage save failed", e);
    }
  }
  function loadRaw() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(S, JSON.parse(raw));
    } catch (e) {
      console.warn("localStorage load failed", e);
    }
  }

  // --- Core mechanics -------------------------------------------------------
  function drainRate(snapshot) {
    return CONFIG.drainPerHour[snapshot.stage.key] || 6;
  }

  function applyDrain(snapshot, nowMs) {
    if (S.lastActiveAt) {
      const hours = (nowMs - S.lastActiveAt) / 3600000;
      if (hours > 0) {
        S.gauge = Math.max(0, S.gauge - drainRate(snapshot) * hours);
      }
    }
    S.lastActiveAt = nowMs;
  }

  // Reset streak if a full day was skipped; reset the daily cup counter on a new day.
  function reconcileDaily() {
    const today = todayISO();
    if (S.lastWateredDate && S.lastWateredDate < shiftISO(today, -1)) {
      S.streak = 0; // missed at least one full day
    }
    if (S.cupsDate !== today) {
      S.cupsToday = 0;
      S.cupsDate = today;
    }
  }

  // --- Public API -----------------------------------------------------------
  function init(snapshot) {
    loadRaw();
    reconcileDaily();
    applyDrain(snapshot, Date.now());
    save();
  }

  function tick(snapshot) {
    applyDrain(snapshot, Date.now());
    save();
    return S.gauge;
  }

  function cooldownInfo(snapshot) {
    const min = CONFIG.cooldownMin[snapshot.stage.key];
    const cdMs = (min == null ? 90 : min) * 60000;
    if (!S.lastWateredAt) return { canWater: true, remainingMs: 0, cooldownMs: cdMs };
    const remaining = cdMs - (Date.now() - S.lastWateredAt);
    return { canWater: remaining <= 0, remainingMs: Math.max(0, remaining), cooldownMs: cdMs };
  }

  function water(snapshot) {
    const cd = cooldownInfo(snapshot);
    if (!cd.canWater) return { ok: false, reason: "cooldown" };

    const now = Date.now();
    applyDrain(snapshot, now);

    const reward = CONFIG.reward[snapshot.stage.key] || 25;
    S.gauge = Math.min(CONFIG.gaugeMax, S.gauge + reward);
    S.waterCount += 1;

    // Daily cup counter (resets on a new day).
    const today = todayISO();
    if (S.cupsDate !== today) { S.cupsToday = 0; S.cupsDate = today; }
    const goalWas = S.cupsToday >= CONFIG.dailyGoal;
    S.cupsToday += 1;
    const goalReached = !goalWas && S.cupsToday >= CONFIG.dailyGoal;

    // Streak update (first cup of a day; consecutive days extend it).
    if (S.lastWateredDate === today) {
      // same-day: streak unchanged
    } else if (S.lastWateredDate === shiftISO(today, -1)) {
      S.streak += 1;
    } else {
      S.streak = 1;
    }
    S.lastWateredDate = today;
    S.maxStreak = Math.max(S.maxStreak, S.streak);
    S.lastWateredAt = now;

    save();
    return { ok: true, reward, gauge: S.gauge, cupsToday: S.cupsToday, goal: CONFIG.dailyGoal, goalReached };
  }

  function petState(snapshot) {
    if (snapshot.stage.key === "heatwave" && S.gauge < 55) return "heat";
    if (S.gauge < 35) return "thirsty";
    return "calm";
  }

  function snapshotState() {
    return {
      gauge: S.gauge,
      waterCount: S.waterCount,
      cupsToday: S.cupsDate === todayISO() ? S.cupsToday : 0,
      goal: CONFIG.dailyGoal,
      streak: S.streak,
      maxStreak: S.maxStreak,
    };
  }

  function reset() {
    Object.assign(S, {
      gauge: CONFIG.gaugeInit,
      waterCount: 0,
      cupsToday: 0,
      cupsDate: todayISO(),
      streak: 0,
      maxStreak: 0,
      lastWateredAt: null,
      lastWateredDate: null,
      lastActiveAt: Date.now(),
    });
    save();
  }

  global.Game = {
    CONFIG,
    init,
    tick,
    water,
    cooldownInfo,
    petState,
    snapshotState,
    reset,
  };
})(window);
