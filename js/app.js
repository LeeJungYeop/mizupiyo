// app.js — UI controller: screens (home / info), live drain loop, watering.
// Depends on Data, Game, Sprites.

(function (global) {
  "use strict";
  const { Data, Game, Sprites } = global;

  const App = {
    tab: "home",
    snapshot: null,
    happyUntil: 0,
    drinkUntil: 0,
    cheerUntil: 0,
    els: {},
  };

  // --- Small helpers --------------------------------------------------------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function gaugeColor(g) {
    if (g >= 60) return "ok";
    if (g >= 30) return "mid";
    return "low";
  }

  function fmtCooldown(ms) {
    const s = Math.ceil(ms / 1000);
    if (s >= 3600) {
      const totalMin = Math.floor(s / 60);
      return `${Math.floor(totalMin / 60)}시간 ${totalMin % 60}분`;
    }
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, "0");
    return `${m}:${ss}`;
  }

  function setTone(tone) {
    document.body.className = "tone-" + tone;
  }

  // --- Screen: Home ---------------------------------------------------------
  // One-line nudge driven by 10 years of Hokkaido heatstroke transport data
  // (Hokkaido_heatstroke_daily_10Y.csv): historical daily average for today's
  // heat stage. Phrasing rotates by day-of-year (same day = same line).
  const NUDGE = {
    comfortable: [
      (n, l) => `지난 10년, 이런 선선한 날에도 홋카이도에선 하루 평균 <b>${n}명</b>이 열사병으로 이송됐어요. 미리 한 모금 💧`,
      (n, l) => `선선해 보여도 방심은 금물 — 최근 10년 이런 날 하루 평균 <b>${n}명</b>이 병원으로. 물 챙기기 💧`,
      (n, l) => `지난 10년 통계상 오늘 같은 날씨에도 하루 평균 <b>${n}명</b>이 온열질환으로 이송됐대요. 한 잔 어때요? 💧`,
    ],
    warm: [
      (n, l) => `지난 10년, ${l}엔 홋카이도에서 하루 평균 <b>${n}명</b>이 열사병으로 이송됐어요. 물 한 잔 어때요? 💧`,
      (n, l) => `${l} 기록 — 최근 10년 하루 평균 <b>${n}명</b>이 온열질환으로 병원에. 지금 한 모금 💧`,
      (n, l) => `오늘 같은 ${l}, 예년엔 하루 평균 <b>${n}명</b>이 쓰러졌어요. 미리미리 수분 보충 💧`,
    ],
    midsummer: [
      (n, l) => `지난 10년, ${l}엔 홋카이도에서 하루 평균 <b>${n}명</b>이 열사병으로 이송됐어요. 물 한 잔 어때요? 💧`,
      (n, l) => `${l} 기록 — 최근 10년 하루 평균 <b>${n}명</b>이 온열질환으로 병원에. 지금 한 모금 💧`,
      (n, l) => `오늘 같은 ${l}, 예년엔 하루 평균 <b>${n}명</b>이 쓰러졌어요. 미리미리 수분 보충 💧`,
    ],
    heatwave: [
      (n, l) => `지난 10년, ${l}엔 하루 평균 <b>${n}명</b>이 열사병으로 이송됐어요. 지금 꼭 물 드세요! 💧`,
      (n, l) => `${l} 경보 — 예년 이런 날 하루 평균 <b>${n}명</b>이 병원행. 당장 한 잔! 💧`,
      (n, l) => `오늘 같은 ${l}, 최근 10년 하루 평균 <b>${n}명</b> 이송. 미루지 말고 지금 💧`,
    ],
  };

  function dayOfYear() {
    const d = new Date();
    return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  }

  function heatstrokeLine(snap) {
    if (snap.heatAvg == null) return "";
    const n = Math.round(snap.heatAvg);
    const variants = NUDGE[snap.stage.key] || NUDGE.warm;
    return variants[dayOfYear() % variants.length](n, snap.stage.label);
  }

  function renderHome() {
    const snap = App.snapshot;
    const st = Game.snapshotState();
    const line = heatstrokeLine(snap);
    const showTemp = (snap.tempNow != null ? snap.tempNow : snap.tempMax).toFixed(1);

    $("#screen").innerHTML = `
      <div class="brand"><b>みずぴよ</b> <span>미즈삐요</span></div>
      <header class="topbar">
        <div class="date">${snap.date} · ${snap.place}</div>
        <div class="badges">
          <span class="badge temp">🌡️ ${showTemp}℃${
            snap.source === "live" ? ` <small>최고 ${snap.tempMax.toFixed(0)}℃</small>` : ""
          }</span>
          <span class="badge stage tone-${snap.stage.tone}">${snap.stage.label}</span>
        </div>
      </header>

      <section class="pet-stage" id="petStage">
        <div class="pet-wrap" id="petWrap" title="쓰다듬기"></div>
        <div class="gauge">
          <div class="gauge-track">
            <div class="gauge-fill" id="gaugeFill"></div>
          </div>
          <div class="gauge-label"><span id="gaugeNum">0</span>/100 수분</div>
        </div>
        <button class="water-btn" id="waterBtn">💧 물 마시기</button>
        ${line ? `<p class="heat-line">${line}</p>` : ""}
      </section>

      <section class="stats">
        <div class="stat"><span class="k">🥤 오늘</span><span class="v">${st.cupsToday}/${st.goal}잔</span></div>
        <div class="stat"><span class="k">🔥 연속</span><span class="v">${st.streak}일째</span></div>
        <div class="stat"><span class="k">💧 누적</span><span class="v">${st.waterCount}잔</span></div>
      </section>
    `;
    App.els.petWrap = $("#petWrap");
    App.els.gaugeFill = $("#gaugeFill");
    App.els.gaugeNum = $("#gaugeNum");
    App.els.waterBtn = $("#waterBtn");
    App.els.waterBtn.addEventListener("click", onWater);
    App.els.petWrap.addEventListener("click", onPetTap);
    updateHomeDynamic();
  }

  // Petting: tap the bird for a happy reaction (separate from watering).
  const PET_LINES = ["삐약! 🎵", "기분 좋아~", "쓰담쓰담 ♪", "고마워!", "히힛"];
  let petIdx = 0;
  function onPetTap() {
    if (Date.now() < App.happyUntil) return; // already reacting
    App.happyUntil = Date.now() + 1100;
    lastState = null; // force happy render
    updateHomeDynamic();
    setTimeout(updateHomeDynamic, 1150); // return to base pose even if the loop is throttled
    spawnEmojis(["💕", "🎵", "✨"]);
    toast(PET_LINES[petIdx++ % PET_LINES.length]);
  }

  // Refresh the parts that change over time / on watering.
  function updateHomeDynamic() {
    if (App.tab !== "home" || !App.els.gaugeFill) return;
    const snap = App.snapshot;
    const g = Game.tick(snap);
    App.els.gaugeFill.style.width = clamp(g, 0, 100) + "%";
    App.els.gaugeFill.className = "gauge-fill " + gaugeColor(g);
    App.els.gaugeNum.textContent = Math.round(g);

    // Pet emotion. Petting -> happy; watering -> gulp (drink) then cheer.
    let state = Game.petState(snap);
    const now = Date.now();
    if (now < App.happyUntil) state = "happy";
    if (now < App.cheerUntil) state = "cheer";
    if (now < App.drinkUntil) state = "drink";
    setPetSprite(state);

    // Cooldown button label.
    const cd = Game.cooldownInfo(snap);
    const btn = App.els.waterBtn;
    if (cd.canWater) {
      btn.disabled = false;
      btn.textContent = "💧 물 마시기";
    } else {
      btn.disabled = true;
      btn.textContent = "다음 잔까지 " + fmtCooldown(cd.remainingMs);
    }
  }

  // Crossfade between sprite states so pose changes feel continuous.
  let lastState = null;
  function setPetSprite(state) {
    if (state === lastState) return;
    lastState = state;
    const wrap = App.els.petWrap;
    wrap.dataset.state = state;
    const tmp = document.createElement("div");
    tmp.innerHTML = Sprites.petSVG(state);
    const img = tmp.firstElementChild;
    if (!img) return;
    img.classList.add("enter");
    wrap.appendChild(img);
    // fade out any previous sprites
    const imgs = wrap.querySelectorAll("img.sprite");
    for (let i = 0; i < imgs.length - 1; i++) {
      const old = imgs[i];
      old.classList.add("leave");
      setTimeout(() => old.remove(), 450);
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => img.classList.remove("enter"))
    );
  }

  function onWater() {
    const res = Game.water(App.snapshot);
    if (!res.ok) {
      toast("방금 한 잔 마셨어요! 잠시 후 또 💧");
      return;
    }
    // Sequence: gulp (drink) -> happy after drinking (cheer) -> base pose.
    const now = Date.now();
    App.drinkUntil = now + 1300;
    App.cheerUntil = now + 2700;
    lastState = null; // force re-render
    spawnEmojis(res.goalReached ? ["🎉", "💧", "✨"] : ["💧", "✨", "💧"]);
    updateHomeDynamic();
    setTimeout(updateHomeDynamic, 1350); // advance to cheer
    setTimeout(updateHomeDynamic, 2750); // return to base pose
    toast(
      res.goalReached
        ? `🎉 오늘 목표 ${res.goal}잔 달성! 잘했어요!`
        : `꿀꺽! +${res.reward} · 오늘 ${res.cupsToday}/${res.goal}잔 💧`
    );
  }

  function spawnEmojis(set) {
    const wrap = App.els.petWrap;
    if (!wrap) return;
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("span");
      s.className = "sparkle";
      s.textContent = set[i % set.length];
      s.style.left = 20 + (i / 6) * 60 + "%";
      s.style.animationDelay = (i % 3) * 0.08 + "s";
      wrap.appendChild(s);
      setTimeout(() => s.remove(), 1100);
    }
  }

  // --- Screen: Info ---------------------------------------------------------
  function renderInfo() {
    const c = Game.CONFIG;
    $("#screen").innerHTML = `
      <header class="topbar"><div class="date">정보 · 크레딧</div></header>
      <section class="info">
        <h3>🐦💧 みずぴよ (미즈삐요)</h3>
        <p><b>실제 기온 데이터</b>에 반응해 목말라하는 오목눈이(시마에나가)에게
        물을 주며 <b>키우는(육성)</b> 수분 섭취 넛지예요. 경고·알림이 아니라
        <b>"돌보고 싶은 재미"</b>로 사람이 자주 물을 마시게 합니다.</p>

        <h3>📊 데이터가 게임을 움직여요</h3>
        <table class="info-table">
          <tr><th>더위 단계</th><th>목마름 속도</th><th>다음 잔까지</th><th>회복</th></tr>
          <tr><td>쾌적 (&lt;25℃)</td><td>${c.drainPerHour.comfortable}/h</td><td>${c.cooldownMin.comfortable}분</td><td>+${c.reward.comfortable}</td></tr>
          <tr><td>더움 (25~29℃)</td><td>${c.drainPerHour.warm}/h</td><td>${c.cooldownMin.warm}분</td><td>+${c.reward.warm}</td></tr>
          <tr><td>真夏日 (30~34℃)</td><td>${c.drainPerHour.midsummer}/h</td><td>${c.cooldownMin.midsummer}분</td><td>+${c.reward.midsummer}</td></tr>
          <tr><td>猛暑日 (≥35℃)</td><td>${c.drainPerHour.heatwave}/h</td><td>${c.cooldownMin.heatwave}분</td><td>+${c.reward.heatwave}</td></tr>
        </table>
        <p class="muted">하루 목표는 <b>${c.dailyGoal}잔</b>. 물주기 = 실제로 한 잔 마신 만큼. 더운 날일수록 빨리 목마르고, 더 자주 마시고, 회복도 큽니다.</p>

        <h3>🗂️ 데이터 출처</h3>
        <ul>
          <li>실시간 기온: Open-Meteo (위치 허용 시 내 위치, 아니면 삿포로)</li>
          <li>과거 기상: 기상청(JMA) 삿포로 관측소 47412 · 2015.6~2026.5</li>
          <li>열사병: 총무성 소방청(FDMA) 홋카이도 일별 이송</li>
        </ul>

        <button class="reset-btn" id="resetBtn">진행 상황 초기화</button>
      </section>
    `;
    $("#resetBtn").addEventListener("click", () => {
      if (confirm("정말 초기화할까요? 연속 기록이 모두 사라져요.")) {
        Game.reset();
        toast("초기화했어요.");
        renderTab("home");
      }
    });
  }

  // --- Tabs + loop ----------------------------------------------------------
  const RENDER = { home: renderHome, info: renderInfo };

  function renderTab(tab) {
    App.tab = tab;
    lastState = null;
    RENDER[tab]();
    document.querySelectorAll("#tabbar button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
  }

  function toast(msg) {
    const t = $("#toast");
    t.innerHTML = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  function startLoops() {
    setInterval(() => {
      if (App.tab === "home") updateHomeDynamic();
    }, 1000);
  }

  async function main() {
    try {
      await Promise.all([Data.load(), Sprites.load()]);
    } catch (e) {
      $("#screen").innerHTML =
        `<div class="error">데이터를 불러오지 못했어요.<br><small>${e.message}</small><br>` +
        `<small>로컬에서 열 땐 <code>python -m http.server</code> 등으로 서버를 띄워 주세요.</small></div>`;
      console.error(e);
      return;
    }
    App.snapshot = Data.todaySnapshot();
    Game.init(App.snapshot);
    setTone(App.snapshot.stage.tone);

    document.querySelectorAll("#tabbar button").forEach((b) => {
      b.addEventListener("click", () => renderTab(b.dataset.tab));
    });
    renderTab("home");
    startLoops();
  }

  document.addEventListener("DOMContentLoaded", main);
  global.App = App;
})(window);
