// sprites.js — Load bundled 128x128, 64-color pixel-matrix sprites, strip the
// blue background to transparent, and rasterize each to a crisp PNG data-URI.
// States: idle/flying/tired/thirsty (from all.json) + drink (separate file).

(function (global) {
  "use strict";

  const SHEET = "./assets/sprites/all.json"; // {sprites:{idle,flying,tired,thirsty}}
  const DRINK = "./assets/sprites/drink.json"; // {rows:[...]} — gulping
  const CHEER = "./assets/sprites/cheer.json"; // {rows:[...]} — happy after drinking

  // App pet-state -> sheet sprite key.
  const STATE_KEY = { calm: "idle", happy: "flying", thirsty: "thirsty", heat: "tired" };

  const cache = {}; // state -> <img> HTML
  let loaded = false;

  function hb(hex, i) { return parseInt(hex.slice(i, i + 2), 16); }

  // A pixel is background if it is distinctly blue (blue channel well above the
  // red/green). Robust across the per-sprite palettes; keeps white body + eyes.
  function isBlue(r, g, b) {
    return b > 140 && b > r + 18 && b > g + 12;
  }

  function build(rows, W, H, palette, lut) {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const im = ctx.createImageData(W, H);
    const opaque = new Uint8Array(W * H);

    for (let y = 0; y < H; y++) {
      const row = rows[y];
      for (let x = 0; x < W; x++) {
        const hex = palette[lut ? (lut[row[x]] || 0) : parseInt(row[x], 16)] || "#000000";
        const r = hb(hex, 1), g = hb(hex, 3), b = hb(hex, 5);
        const o = y * W + x;
        im.data[o * 4] = r; im.data[o * 4 + 1] = g; im.data[o * 4 + 2] = b;
        const bg = isBlue(r, g, b);
        im.data[o * 4 + 3] = bg ? 0 : 255;
        opaque[o] = bg ? 0 : 1;
      }
    }

    // Remove the rounded frame ring: flood from the border through opaque pixels.
    // The bird is isolated by the transparent blue moat, so it survives.
    const q = [];
    const clear = (x, y) => {
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      const o = y * W + x;
      if (opaque[o]) { opaque[o] = 0; im.data[o * 4 + 3] = 0; q.push(o); }
    };
    for (let x = 0; x < W; x++) { clear(x, 0); clear(x, H - 1); }
    for (let y = 0; y < H; y++) { clear(0, y); clear(W - 1, y); }
    while (q.length) {
      const o = q.pop(), x = o % W, y = (o - x) / W;
      clear(x + 1, y); clear(x - 1, y); clear(x, y + 1); clear(x, y - 1);
    }

    // Edge cleanup for a crisper silhouette: drop isolated specks and shave the
    // pale-blue anti-alias halo. Saturated blues (e.g. sweat drops) are kept.
    const A = (x, y) => (x >= 0 && x < W && y >= 0 && y < H ? im.data[(y * W + x) * 4 + 3] : 0);
    const drop = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = y * W + x;
        if (!im.data[o * 4 + 3]) continue;
        let n = 0;
        if (A(x - 1, y)) n++; if (A(x + 1, y)) n++; if (A(x, y - 1)) n++; if (A(x, y + 1)) n++;
        if (n <= 1) { drop.push(o); continue; } // isolated speck
        if (n < 4) { // edge pixel — remove only a light bluish halo
          const r = im.data[o * 4], g = im.data[o * 4 + 1], b = im.data[o * 4 + 2];
          if (b > r + 10 && b > g + 6 && Math.min(r, g) > 180) drop.push(o);
        }
      }
    }
    drop.forEach((o) => (im.data[o * 4 + 3] = 0));

    ctx.putImageData(im, 0, 0);
    return cv.toDataURL("image/png");
  }

  function lutOf(indexChars) {
    if (!indexChars) return null;
    const lut = {};
    for (let i = 0; i < indexChars.length; i++) lut[indexChars[i]] = i;
    return lut;
  }
  const imgTag = (uri) => `<img class="sprite pet-sprite" src="${uri}" alt="">`;

  const buildSingle = (s) =>
    s && s.rows ? imgTag(build(s.rows, s.width, s.height, s.palette, lutOf(s.indexChars))) : null;

  async function load() {
    const [sheet, drink, cheer] = await Promise.all([
      fetch(SHEET).then((r) => { if (!r.ok) throw new Error(`sheet ${r.status}`); return r.json(); }),
      fetch(DRINK).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(CHEER).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);

    const lut = lutOf(sheet.indexChars);
    for (const [state, key] of Object.entries(STATE_KEY)) {
      cache[state] = imgTag(build(sheet.sprites[key], sheet.width, sheet.height, sheet.palette, lut));
    }
    if (buildSingle(drink)) cache.drink = buildSingle(drink);
    if (buildSingle(cheer)) cache.cheer = buildSingle(cheer);
    loaded = true;
  }

  function petSVG(state) {
    return cache[state] || cache.calm || "";
  }

  global.Sprites = { load, petSVG, get loaded() { return loaded; } };
})(window);
