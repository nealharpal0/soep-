/* Kippensoep — interactieve Canvas 2D-animatie.
 *
 * Coördinaten
 *  - "bowl-ruimte": eenheden van de kom-straal R, oorsprong = midden van de rand.
 *  - "soep-ruimte": eenheidscirkel (x naar rechts, y van de kijker af) die op het
 *    soepoppervlak wordt geprojecteerd: scherm = (x, -y·k) met k = sin(kijkhoek).
 *  - Stroming: stroomfunctie ψ = −x(1 − x² − y²)  →  u = 2xy, v = 1 − 3x² − y².
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- DOM
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const btnNear = document.getElementById('btn-near');
  const btnBlow = document.getElementById('btn-blow');
  const chkFlow = document.getElementById('toggle-flow');
  const panel = document.getElementById('panel');
  const hint = document.getElementById('hint');
  const legend = document.getElementById('legend');

  // ---------------------------------------------------------------- helpers
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let seed = 20240611;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const rr = (a, b) => a + (b - a) * rnd();

  // ---------------------------------------------------------------- geometrie
  const BODY_H = 1.0;      // hoogte van de kom (in R)
  const RB = 0.5;          // straal van de voet
  const RIM_IN = 0.87;     // binnenstraal van de rand
  const RS = 0.82;         // straal van het soepoppervlak
  const DEPTH = 0.22;      // hoeveel de soep onder de rand staat
  const PHI0 = 36 * Math.PI / 180;   // kijkhoek bij start (schuin van voren)
  const PHI1 = 71 * Math.PI / 180;   // kijkhoek dichtbij (bijna van bovenaf)
  const BLOW = { x: 0, y: -0.3 };    // blaasplek in soep-ruimte

  // ---------------------------------------------------------------- stroming
  const V0 = 0.8; // eenheden per seconde bij volle kracht
  const field = (x, y) => [2 * x * y, 1 - 3 * x * x - y * y];

  // ---------------------------------------------------------------- toestand
  let W = 0, H = 0, dpr = 1, panelH = 120;
  let L = null;                       // layout
  let prog = 0, want = 0, E = 0;      // voortgang naar dichtbij
  let clock = 0;                      // gesimuleerde tijd in seconden
  let holding = false, blowUntil = 0, blowing = false;
  let flowStrength = 0, breathStrength = 0;
  let showFlow = false;
  let rippleTimer = 0, steamTimer = 0, breathTimer = 0;
  const ripples = [];
  const steam = [];
  const breath = [];

  // ---------------------------------------------------------------- ingrediënten
  const foam = [], eyes = [], noodles = [], carrots = [], chicken = [], leeks = [], celery = [], parsley = [];
  const big = []; // alle grote stukken, voor onderlinge afstoting

  function randomInDisc(rmax) {
    let x, y;
    do { x = rr(-1, 1); y = rr(-1, 1); } while (x * x + y * y > rmax * rmax);
    return { x, y };
  }

  function blobShape(r) {
    const n = 9, pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const rad = r * (0.72 + rnd() * 0.5);
      pts.push([Math.cos(a) * rad * 1.15, Math.sin(a) * rad * 0.9]);
    }
    return pts;
  }

  function buildSoup() {
    const mk = (arr, n, rmax, props) => {
      for (let i = 0; i < n; i++) {
        const p = randomInDisc(rmax);
        arr.push(Object.assign({ x: p.x, y: p.y, th: rr(0, TAU), ph: rr(0, TAU) }, props(i)));
      }
    };
    mk(noodles, 120, 0.9, () => ({ len: rr(0.2, 0.42), drag: 0.95, bend: rr(0.6, 1.4), c: rnd() }));
    mk(carrots, 12, 0.78, () => ({ r: rr(0.075, 0.095), drag: 0.8 }));
    mk(chicken, 6, 0.7, () => { const r = rr(0.12, 0.16); return { r, drag: 0.65, shape: blobShape(r), tone: rnd() }; });
    mk(leeks, 12, 0.8, () => ({ r: rr(0.055, 0.075), drag: 0.85 }));
    mk(celery, 7, 0.8, () => ({ r: rr(0.1, 0.13), drag: 0.8 }));
    mk(parsley, 38, 0.9, () => ({ r: rr(0.018, 0.03), drag: 1.05, tone: rnd() }));
    mk(foam, 220, 0.95, () => ({ drag: 1.1, trail: [] }));
    mk(eyes, 320, 0.97, () => ({ r: rnd() < 0.06 ? rr(0.024, 0.04) : rr(0.007, 0.02), drag: 1.05 }));
    big.push(...carrots, ...chicken, ...leeks, ...celery);
    for (let i = 0; i < 80; i++) separate(1);
  }

  function separate(strength) {
    for (let i = 0; i < big.length; i++) {
      for (let j = i + 1; j < big.length; j++) {
        const a = big[i], b = big[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = (a.r + b.r) * 0.95;
        const d2 = dx * dx + dy * dy;
        if (d2 < min * min && d2 > 1e-8) {
          const d = Math.sqrt(d2), push = (min - d) * 0.5 * strength;
          const nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }
      }
    }
  }

  // ---------------------------------------------------------------- textures
  let bgCanvas = null;
  let craquele = null, textTex = null, steamSprite = null, breathSprite = null;

  function makeCraquele() {
    const c = document.createElement('canvas');
    c.width = c.height = 192;
    const g = c.getContext('2d');
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(70,72,78,${rr(0.06, 0.26)})`;
      g.beginPath(); g.arc(rr(0, 192), rr(0, 192), rr(0.5, 1.5), 0, TAU); g.fill();
    }
    for (let i = 0; i < 280; i++) {
      g.fillStyle = `rgba(255,255,255,${rr(0.15, 0.4)})`;
      g.beginPath(); g.arc(rr(0, 192), rr(0, 192), rr(0.5, 1.4), 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(80,80,88,0.17)'; g.lineWidth = 0.7;
    for (let i = 0; i < 42; i++) {
      let x = rr(0, 192), y = rr(0, 192), a = rr(0, TAU);
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        a += rr(-0.7, 0.7); x += Math.cos(a) * rr(6, 14); y += Math.sin(a) * rr(6, 14);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    return c;
  }

  function makeTextTexture() {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 280;
    const g = c.getContext('2d');
    g.fillStyle = '#0e0c0b';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.font = 'italic 700 250px "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif';
    g.save();
    g.translate(320, 150); g.rotate(-0.07);
    g.fillText('Soep', 0, 0);
    g.restore();
    g.font = 'italic 700 74px "Palatino Linotype", Palatino, Georgia, serif';
    g.save(); g.translate(86, 238); g.rotate(-0.12); g.fillText('kip', 0, 0); g.restore();
    return c;
  }

  function makeSprite(size, stops) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return c;
  }

  function makeBackground() {
    const w = Math.ceil(W / 2) + 16, h = Math.ceil(H / 2) + 16;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#f8ecd6');
    sky.addColorStop(0.55, '#f1dbba');
    sky.addColorStop(1, '#e0bb8a');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    // raam-licht rechtsboven
    let gr = g.createRadialGradient(w * 0.8, h * 0.08, 0, w * 0.8, h * 0.08, w * 0.7);
    gr.addColorStop(0, 'rgba(255,252,236,0.95)');
    gr.addColorStop(1, 'rgba(255,252,236,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // tafelblad (vaag)
    const ty = h * 0.62;
    const tb = g.createLinearGradient(0, ty, 0, h);
    tb.addColorStop(0, 'rgba(190,140,92,0)');
    tb.addColorStop(0.18, 'rgba(184,132,84,0.75)');
    tb.addColorStop(1, 'rgba(150,102,62,0.95)');
    g.fillStyle = tb; g.fillRect(0, ty, w, h - ty);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = `rgba(120,76,40,${rr(0.04, 0.1)})`;
      g.fillRect(0, ty + rr(0.1, 1) * (h - ty), w, rr(1, 4));
    }
    // bokeh
    const cols = ['255,226,160', '255,196,130', '255,240,200', '190,215,150', '255,170,110', '255,250,225'];
    for (let i = 0; i < 18; i++) {
      const x = rr(0, w), y = rr(0, h * 0.7), r = rr(0.04, 0.11) * Math.max(w, h) * 0.6;
      const col = cols[(rnd() * cols.length) | 0], a = rr(0.12, 0.34);
      gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${col},${a})`);
      gr.addColorStop(0.75, `rgba(${col},${a * 0.8})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    // vignet
    gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.8);
    gr.addColorStop(0, 'rgba(90,50,20,0)');
    gr.addColorStop(1, 'rgba(90,50,20,0.22)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    return c;
  }

  // ---------------------------------------------------------------- layout
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    panelH = panel.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--panel-h', panelH + 'px');
    const top = 58;
    const aH = Math.max(200, H - panelH - top);
    const R1 = Math.min(W * 0.455, aH * 0.43);
    L = {
      R0: R1 * (W < 600 ? 0.84 : 0.7), R1,
      cx: W / 2,
      cy0: top + aH * (W < 600 ? 0.5 : 0.56), cy1: top + aH * 0.47,
    };
    bgCanvas = makeBackground();
  }

  // ---------------------------------------------------------------- update
  function advect(p, dt, s, noiseAmt) {
    const k = V0 * s * p.drag;
    const f1 = field(p.x, p.y);
    const f2 = field(p.x + f1[0] * k * dt * 0.5, p.y + f1[1] * k * dt * 0.5);
    p.x += f2[0] * k * dt;
    p.y += f2[1] * k * dt;
    // extra kracht van de adem: een duidelijke straal recht door het midden
    p.y += 0.9 * k * dt * Math.exp(-p.x * p.x / 0.03) * Math.exp(-Math.pow(p.y + 0.1, 2) / 0.7);
    // ruis, zodat niets blijft hangen bij de stilstandspunten voor en achter
    const n = noiseAmt * (0.12 + s);
    p.x += n * dt * (Math.sin(3.7 * p.y + 1.3 * clock + p.ph) + 0.6 * Math.sin(7.1 * p.x - 0.9 * clock + p.ph * 2.3));
    p.y += n * dt * (Math.cos(3.3 * p.x + 1.1 * clock + p.ph * 1.7) + 0.6 * Math.cos(6.3 * p.y + 1.2 * clock + p.ph));
    return f2;
  }

  function keepInside(p, rmax) {
    const r = Math.hypot(p.x, p.y);
    if (r > rmax) { p.x *= rmax / r; p.y *= rmax / r; }
  }

  function spinAndAlign(p, f, dt, s, spinGain) {
    // meedraaien met de wervelsterkte ω/2 = −4x en uitlijnen met de stroomrichting
    p.th += -4 * p.x * V0 * s * p.drag * spinGain * dt;
    const fl = Math.hypot(f[0], f[1]);
    if (fl > 0.05 && s > 0.01) {
      const target = Math.atan2(f[1], f[0]);
      let d = ((target - p.th + Math.PI * 1.5) % Math.PI + Math.PI) % Math.PI - Math.PI / 2;
      p.th += d * (1 - Math.exp(-dt * 0.9 * s));
    }
  }

  function geometry() {
    const e = E;
    const R = lerp(L.R0, L.R1, e);
    const phi = lerp(PHI0, PHI1, e);
    const k = Math.sin(phi), c = Math.cos(phi);
    const sway = Math.sin(clock * 0.9) * 0.006 * R;
    return {
      R, k, c,
      bx: L.cx + sway,
      by: lerp(L.cy0, L.cy1, e) + Math.sin(clock * 1.3) * 0.008 * R,
      Hp: BODY_H * c,
      dy: DEPTH * c,
      roll: Math.sin(clock * 0.7) * 0.004,
    };
  }

  function blowScreen(g) {
    return { x: g.bx + g.R * RS * BLOW.x, y: g.by + g.R * (g.dy + RS * g.k * -BLOW.y) };
  }

  function update(dt) {
    clock += dt;
    const dir = want ? 1 : -1;
    prog = clamp(prog + dir * dt / 1.05, 0, 1);
    E = ease(prog);

    const canBlow = want === 1 && prog > 0.95;
    if (!canBlow) { holding = false; blowUntil = 0; }
    blowing = holding || clock < blowUntil;

    // stroomkracht: snel op, in een paar seconden uit
    if (blowing) flowStrength += (1 - flowStrength) * (1 - Math.exp(-dt / 0.35));
    else flowStrength *= Math.exp(-dt / 1.6);
    if (flowStrength < 0.002) flowStrength = 0;
    breathStrength += ((blowing ? 1 : 0) - breathStrength) * (1 - Math.exp(-dt / (blowing ? 0.12 : 0.25)));

    const g = geometry();
    const s = flowStrength;

    for (const p of eyes) { advect(p, dt, s, 0.07); keepInside(p, 0.965); }
    for (const p of foam) {
      advect(p, dt, s, 0.05); keepInside(p, 0.96);
      if (s > 0.03) { p.trail.push(p.x, p.y); if (p.trail.length > 36) p.trail.splice(0, 2); }
      else if (p.trail.length) p.trail.splice(0, 2);
    }
    for (const p of noodles) {
      const f = advect(p, dt, s, 0.08); keepInside(p, 0.94);
      spinAndAlign(p, f, dt, s, 0.9);
    }
    for (const arr of [carrots, chicken, leeks, celery]) {
      for (const p of arr) {
        const f = advect(p, dt, s, 0.05); keepInside(p, 0.95 - p.r * 0.7);
        spinAndAlign(p, f, dt, s, 0.5);
      }
    }
    for (const p of parsley) {
      const f = advect(p, dt, s, 0.07); keepInside(p, 0.93);
      spinAndAlign(p, f, dt, s, 0.8);
    }
    separate(0.5);

    // rimpelingen bij de blaasplek
    if (breathStrength > 0.35) {
      rippleTimer -= dt;
      if (rippleTimer <= 0) {
        rippleTimer = 0.07;
        ripples.push({ x: BLOW.x + rr(-0.06, 0.06), y: BLOW.y + rr(-0.06, 0.06), age: 0, life: rr(1.1, 1.7), amp: rr(0.6, 1) });
      }
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age += dt;
      if (ripples[i].age > ripples[i].life) ripples.splice(i, 1);
    }

    // stoom
    steamTimer -= dt;
    while (steamTimer <= 0) {
      steamTimer += 1 / 18;
      if (steam.length < 70) {
        const q = randomInDisc(0.78);
        steam.push({
          x: g.bx + g.R * RS * q.x,
          y: g.by + g.R * (g.dy + RS * g.k * -q.y),
          vx: 0, vy: 0, age: 0, life: rr(3.2, 5.2), size: rr(0.1, 0.16), grow: rr(0.12, 0.2), ph: rr(0, TAU),
        });
      }
    }
    const B = blowScreen(g);
    for (let i = steam.length - 1; i >= 0; i--) {
      const p = steam[i];
      p.age += dt;
      if (p.age > p.life) { steam.splice(i, 1); continue; }
      const rise = g.R * (0.17 - 0.1 * E);
      p.vy += (-rise - p.vy) * Math.min(1, dt * 1.5);
      p.vx += (Math.sin(clock * 0.8 + p.ph) * g.R * 0.04 - p.vx) * Math.min(1, dt * 1.2);
      if (breathStrength > 0.02) {
        const dx = p.x - B.x, dy = p.y - B.y, d = Math.hypot(dx, dy) + 1e-3;
        const reach = g.R * 1.15;
        if (d < reach) {
          const f = (1 - d / reach) * breathStrength * g.R * 2.6;
          p.vx += (dx / d) * f * dt * 3;
          p.vy += ((dy / d) * 0.6 - 0.9) * f * dt * 3;
        }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }

    // ademwolk vanaf de onderkant van het scherm naar de blaasplek
    if (breathStrength > 0.3) {
      breathTimer -= dt;
      while (breathTimer <= 0) {
        breathTimer += 1 / 55;
        breath.push({
          t: 0, life: rr(0.95, 1.4),
          sx: g.bx + rr(-0.28, 0.28) * g.R, sy: H + 30,
          jx: rr(-0.1, 0.1) * g.R, jy: rr(-0.08, 0.08) * g.R,
          ax: rr(-1, 1), ay: -rr(0.4, 1), sz: rr(0.8, 1.2),
        });
      }
    }
    for (let i = breath.length - 1; i >= 0; i--) {
      const p = breath[i];
      p.t += dt / p.life;
      if (p.t >= 1) breath.splice(i, 1);
    }

    // knoppen
    const nearDone = want === 1 && prog > 0.95;
    if (btnBlow.disabled === nearDone) btnBlow.disabled = !nearDone;
    btnBlow.classList.toggle('pressed', blowing && nearDone);
  }

  // ---------------------------------------------------------------- tekenen: kom
  function bodyPath(g) {
    const { k, Hp } = g;
    ctx.beginPath();
    ctx.moveTo(-1, 0);
    ctx.bezierCurveTo(-1.0, Hp * 0.62, -RB * 1.35, Hp * 0.97, -RB, Hp);
    ctx.ellipse(0, Hp, RB, RB * k, 0, Math.PI, 0, true);
    ctx.bezierCurveTo(RB * 1.35, Hp * 0.97, 1.0, Hp * 0.62, 1, 0);
    ctx.ellipse(0, 0, 1, k, 0, 0, Math.PI, true);
    ctx.closePath();
  }

  function drawHandBehind(g) {
    // handpalm onder de kom en de onderarm met mouw (vingers wikkelen erachter)
    const { k, Hp } = g;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const A = { x: 0.45, y: Hp + 0.55 }, B = { x: 1.7, y: Hp + 6.5 };
    const armG = ctx.createLinearGradient(-0.2, 0, 2.0, 0);
    armG.addColorStop(0, '#f1bd99'); armG.addColorStop(0.6, '#e2a07a'); armG.addColorStop(1, '#c98462');
    ctx.strokeStyle = armG; ctx.lineWidth = 1.05;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    // palm
    const pg = ctx.createRadialGradient(0.05, Hp + 0.3, 0.05, 0.2, Hp + 0.45, 0.95);
    pg.addColorStop(0, '#f6c8a5'); pg.addColorStop(0.7, '#e8aa84'); pg.addColorStop(1, '#cf8b68');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.ellipse(0.2, Hp + 0.28, 0.82, 0.42, 0.12, 0, TAU); ctx.fill();
    // mouw
    const t0 = 0.34;
    const sl = { x: lerp(A.x, B.x, t0), y: lerp(A.y, B.y, t0) };
    const sg2 = ctx.createLinearGradient(0.2, 0, 2.3, 0);
    sg2.addColorStop(0, '#7aa6a8'); sg2.addColorStop(0.55, '#5f8a8c'); sg2.addColorStop(1, '#46696c');
    ctx.strokeStyle = sg2; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(sl.x, sl.y); ctx.lineTo(B.x + 0.4, B.y + 0.6); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1.36;
    ctx.beginPath(); ctx.moveTo(sl.x - 0.03, sl.y + 0.02); ctx.lineTo(B.x + 0.37, B.y + 0.62); ctx.stroke();
    ctx.restore();
  }

  function drawBody(g) {
    const { k, Hp } = g;
    // zachte schaduw op de achtergrond
    ctx.save();
    ctx.translate(0.1, Hp + 0.28);
    ctx.scale(1.5, 0.5 + 0.2 * k);
    const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    sh.addColorStop(0, 'rgba(70,35,10,0.28)');
    sh.addColorStop(1, 'rgba(70,35,10,0)');
    ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
    ctx.restore();

    drawHandBehind(g);

    ctx.save();
    bodyPath(g);
    const bg = ctx.createLinearGradient(-1, 0, 1, 0);
    bg.addColorStop(0, '#d9d0c0');
    bg.addColorStop(0.1, '#f2ede2');
    bg.addColorStop(0.32, '#fffefa');
    bg.addColorStop(0.7, '#f0eadf');
    bg.addColorStop(1, '#bdb2a0');
    ctx.fillStyle = bg; ctx.fill();
    ctx.clip();

    // cursieve letters, om de kom gebogen
    const N = 110, A = 1.12, vt = 0.14, vb = 0.9;
    const tw = textTex.width, th = textTex.height;
    const rAt = v => 1 - (1 - RB) * Math.pow(v, 1.7);
    const vm = (vt + vb) / 2;
    for (let i = 0; i < N; i++) {
      const a0 = lerp(-A, A, i / N), a1 = lerp(-A, A, (i + 1) / N), am = (a0 + a1) / 2;
      const x0 = rAt(vm) * Math.sin(a0), x1 = rAt(vm) * Math.sin(a1);
      const y0 = vt * Hp + k * rAt(vt) * Math.cos(am);
      const y1 = vb * Hp + k * rAt(vb) * Math.cos(am);
      const sx = (i / N) * tw, sw = tw / N;
      ctx.globalAlpha = 0.93;
      ctx.drawImage(textTex, sx, 0, sw + 0.5, th, x0, y0, x1 - x0 + 0.004, y1 - y0);
    }
    ctx.globalAlpha = 1;

    // glazuur: randschaduw, hoogte-schaduw en een glanslijn
    const edge = ctx.createLinearGradient(-1, 0, 1, 0);
    edge.addColorStop(0, 'rgba(90,70,45,0.34)');
    edge.addColorStop(0.16, 'rgba(90,70,45,0)');
    edge.addColorStop(0.72, 'rgba(90,70,45,0)');
    edge.addColorStop(1, 'rgba(70,50,30,0.42)');
    ctx.fillStyle = edge; ctx.fillRect(-1.2, -0.2, 2.4, Hp + 0.6);
    const vs = ctx.createLinearGradient(0, 0, 0, Hp + RB * k);
    vs.addColorStop(0, 'rgba(70,50,30,0)');
    vs.addColorStop(0.55, 'rgba(70,50,30,0.04)');
    vs.addColorStop(1, 'rgba(60,40,25,0.4)');
    ctx.fillStyle = vs; ctx.fillRect(-1.2, -0.2, 2.4, Hp + 0.6);
    ctx.save();
    ctx.translate(-0.52, Hp * 0.46 + 0.1);
    ctx.scale(0.1, Hp * 0.46 + 0.06);
    const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gl.addColorStop(0, 'rgba(255,255,255,0.7)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.restore();

    // voetring
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, Hp, RB, RB * k, 0, 0, Math.PI);
    ctx.strokeStyle = 'rgba(90,70,45,0.3)'; ctx.lineWidth = 0.012; ctx.stroke();
    ctx.restore();
  }

  function drawInterior(g) {
    const { k, dy } = g;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, 0, RIM_IN, RIM_IN * k, 0, 0, TAU); ctx.clip();

    // binnenwand, lichtgrijs met craquelé
    ctx.save();
    ctx.scale(1, k);
    const wg = ctx.createRadialGradient(-0.18, -0.2, 0.05, 0, 0, 1.0);
    wg.addColorStop(0, '#dcdddf');
    wg.addColorStop(0.65, '#cbcdcf');
    wg.addColorStop(1, '#a6a8ab');
    ctx.fillStyle = wg; ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
    ctx.restore();
    ctx.save();
    const pat = ctx.createPattern(craquele, 'repeat');
    pat.setTransform(new DOMMatrix([0.0023, 0, 0, 0.0023, 0, 0]));
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = pat; ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
    ctx.restore();
    // schaduw van de rand op de verre wand
    ctx.save();
    ctx.scale(1, k);
    const sg = ctx.createRadialGradient(0, 0.25, 0.45, 0, 0, 0.95);
    sg.addColorStop(0, 'rgba(60,60,64,0)');
    sg.addColorStop(1, 'rgba(60,60,64,0.3)');
    ctx.fillStyle = sg; ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
    ctx.restore();

    // soep
    ctx.save();
    ctx.translate(0, dy);
    ctx.scale(RS, RS);
    ctx.beginPath(); ctx.ellipse(0, 0, 1, k, 0, 0, TAU); ctx.clip();
    drawSoup(g);
    ctx.restore();

    // natte rand van de soep tegen de wand
    ctx.save();
    ctx.translate(0, dy);
    ctx.beginPath(); ctx.ellipse(0, 0, RS, RS * k, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(110,62,10,0.55)'; ctx.lineWidth = 0.022; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, RS * 1.012, RS * 1.012 * k, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.strokeStyle = 'rgba(255,240,190,0.5)'; ctx.lineWidth = 0.01; ctx.stroke();
    ctx.restore();
    ctx.restore();

    // rand zelf
    ctx.save();
    ctx.scale(1, k);
    const rg = ctx.createRadialGradient(0, 0, RIM_IN - 0.03, 0, 0, 1.0);
    rg.addColorStop(0, '#d8d4cb');
    rg.addColorStop(0.28, '#f7f4ee');
    rg.addColorStop(0.62, '#ffffff');
    rg.addColorStop(1, '#d7d1c5');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, 1.0, 0, TAU);
    ctx.arc(0, 0, RIM_IN, 0, TAU, true);
    ctx.fill('evenodd');
    ctx.restore();
    ctx.save();
    ctx.lineWidth = 0.008;
    ctx.strokeStyle = 'rgba(110,95,75,0.4)';
    ctx.beginPath(); ctx.ellipse(0, 0, 1, k, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(110,95,75,0.3)';
    ctx.beginPath(); ctx.ellipse(0, 0, RIM_IN, RIM_IN * k, 0, 0, TAU); ctx.stroke();
    // glans op de rand (linksboven)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 0.02; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.ellipse(0, 0, 0.935, 0.935 * k, 0, Math.PI * 1.05, Math.PI * 1.45); ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- tekenen: soep
  function drawSoup(g) {
    const { k } = g;
    // bouillon
    ctx.save();
    ctx.scale(1, k);
    const sg = ctx.createRadialGradient(-0.1, -0.2, 0, 0, 0, 1.08);
    sg.addColorStop(0, '#f6c85a');
    sg.addColorStop(0.5, '#eeb03e');
    sg.addColorStop(0.85, '#dc9328');
    sg.addColorStop(1, '#b97119');
    ctx.fillStyle = sg; ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
    ctx.restore();

    // delfje door de adem
    if (breathStrength > 0.01) {
      ctx.save();
      ctx.translate(BLOW.x, -BLOW.y * k);
      ctx.scale(1, k);
      const dg = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.3);
      dg.addColorStop(0, `rgba(120,60,5,${0.28 * breathStrength})`);
      dg.addColorStop(1, 'rgba(120,60,5,0)');
      ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(0, 0, 0.3, 0, TAU); ctx.fill();
      ctx.restore();
    }

    const bob = Math.sin(clock * 1.7) * 0.004;

    // vermicelli
    const strokeNoodles = (width, style, off) => {
      ctx.beginPath();
      for (const n of noodles) {
        const cs = Math.cos(n.th), sn = Math.sin(n.th);
        const steps = 7;
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1) - 0.5;
          const s = t * n.len;
          const w = Math.sin(t * 5.2 * n.bend + n.ph + clock * (0.6 + 1.2 * flowStrength)) * n.len * 0.14;
          const px = n.x + cs * s - sn * w, py = n.y + sn * s + cs * w;
          const X = px, Y = -py * k + off + bob;
          if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
      }
      ctx.lineWidth = width; ctx.strokeStyle = style; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.stroke();
    };
    strokeNoodles(0.02, 'rgba(150,88,14,0.5)', 0.012);
    strokeNoodles(0.013, '#f6df92', 0);
    strokeNoodles(0.005, 'rgba(255,248,215,0.75)', -0.003);

    // wortelplakjes
    for (const c of carrots) {
      const X = c.x, Y = -c.y * k + bob;
      ctx.fillStyle = '#b8601a';
      ctx.beginPath(); ctx.ellipse(X, Y + 0.025, c.r, c.r * k, 0, 0, TAU); ctx.fill();
      ctx.save();
      ctx.translate(X, Y); ctx.scale(1, -k); ctx.rotate(c.th);
      const cg = ctx.createRadialGradient(-c.r * 0.2, -c.r * 0.2, c.r * 0.1, 0, 0, c.r);
      cg.addColorStop(0, '#fbbf6c'); cg.addColorStop(0.6, '#f19a38'); cg.addColorStop(0.92, '#e2801f'); cg.addColorStop(1, '#c46510');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(0, 0, c.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,225,160,0.55)'; ctx.lineWidth = c.r * 0.07;
      ctx.beginPath(); ctx.arc(0, 0, c.r * 0.55, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, c.r * 0.2, 0, TAU); ctx.fillStyle = 'rgba(255,230,170,0.6)'; ctx.fill();
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 + 0.3;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * c.r * 0.2, Math.sin(a) * c.r * 0.2);
        ctx.lineTo(Math.cos(a) * c.r * 0.55, Math.sin(a) * c.r * 0.55);
        ctx.strokeStyle = 'rgba(255,225,160,0.4)'; ctx.lineWidth = c.r * 0.04; ctx.stroke();
      }
      ctx.restore();
    }

    // prei
    for (const l of leeks) {
      const X = l.x, Y = -l.y * k + bob;
      ctx.save();
      ctx.translate(X, Y); ctx.scale(1, -k); ctx.rotate(l.th);
      ctx.fillStyle = '#e4edb0';
      ctx.beginPath(); ctx.arc(0, 0, l.r, 0, TAU); ctx.fill();
      ctx.lineWidth = l.r * 0.22; ctx.strokeStyle = '#8ebb48';
      ctx.beginPath(); ctx.arc(0, 0, l.r * 0.88, 0, TAU); ctx.stroke();
      ctx.lineWidth = l.r * 0.12; ctx.strokeStyle = '#b6d26b';
      ctx.beginPath(); ctx.arc(0, 0, l.r * 0.55, 0, TAU); ctx.stroke();
      ctx.lineWidth = l.r * 0.08; ctx.strokeStyle = '#d3e48d';
      ctx.beginPath(); ctx.arc(0, 0, l.r * 0.3, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    // selderij
    for (const c of celery) {
      ctx.save();
      ctx.translate(c.x, -c.y * k + bob); ctx.scale(1, -k); ctx.rotate(c.th);
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#86ad4e'; ctx.lineWidth = c.r * 0.55;
      ctx.beginPath(); ctx.arc(0, c.r * 0.9, c.r, -Math.PI * 0.85, -Math.PI * 0.15); ctx.stroke();
      ctx.strokeStyle = '#b4d27b'; ctx.lineWidth = c.r * 0.22;
      ctx.beginPath(); ctx.arc(0, c.r * 0.9, c.r, -Math.PI * 0.8, -Math.PI * 0.2); ctx.stroke();
      ctx.restore();
    }

    // kip
    for (const c of chicken) {
      const X = c.x, Y = -c.y * k + bob;
      const path = () => {
        const P = c.shape, n = P.length;
        ctx.beginPath();
        let mx = (P[n - 1][0] + P[0][0]) / 2, my = (P[n - 1][1] + P[0][1]) / 2;
        ctx.moveTo(mx, my);
        for (let i = 0; i < n; i++) {
          const a = P[i], b = P[(i + 1) % n];
          ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        }
        ctx.closePath();
      };
      ctx.save();
      ctx.translate(X, Y + 0.03); ctx.scale(1, -k); ctx.rotate(c.th);
      ctx.fillStyle = '#a97c45'; path(); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(X, Y); ctx.scale(1, -k); ctx.rotate(c.th);
      const cg = ctx.createLinearGradient(-c.r, c.r, c.r, -c.r);
      cg.addColorStop(0, c.tone > 0.5 ? '#e6c999' : '#e9d0a4');
      cg.addColorStop(0.5, '#f4e2c0');
      cg.addColorStop(1, '#ecd3a6');
      ctx.fillStyle = cg; path(); ctx.fill();
      ctx.strokeStyle = 'rgba(160,115,60,0.7)'; ctx.lineWidth = 0.012; ctx.stroke();
      ctx.clip();
      ctx.strokeStyle = 'rgba(170,125,70,0.4)'; ctx.lineWidth = 0.008;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath(); ctx.moveTo(-c.r * 1.2, i * c.r * 0.28 - c.r * 0.15); ctx.quadraticCurveTo(0, i * c.r * 0.28 + c.r * 0.1, c.r * 1.2, i * c.r * 0.28 - c.r * 0.05); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,248,230,0.55)';
      ctx.beginPath(); ctx.ellipse(-c.r * 0.25, -c.r * 0.25, c.r * 0.4, c.r * 0.2, -0.5, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // peterselie
    for (const p of parsley) {
      ctx.save();
      ctx.translate(p.x, -p.y * k + bob); ctx.scale(1, -k); ctx.rotate(p.th);
      ctx.fillStyle = p.tone > 0.5 ? '#4f9a35' : '#3f8a2c';
      for (let i = 0; i < 3; i++) {
        const a = i * TAU / 3;
        ctx.beginPath(); ctx.ellipse(Math.cos(a) * p.r * 0.8, Math.sin(a) * p.r * 0.8, p.r, p.r * 0.55, a, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#76b94f';
      ctx.beginPath(); ctx.arc(0, 0, p.r * 0.45, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // schuimstrepen: laten de rondgaande stroming goed zien
    if (flowStrength > 0.03) {
      ctx.globalAlpha = Math.min(1, flowStrength * 1.1) * 0.75;
      ctx.strokeStyle = 'rgba(255,251,230,1)'; ctx.lineWidth = 0.008; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const p of foam) {
        const t = p.trail;
        if (t.length < 6) continue;
        ctx.moveTo(t[0], -t[1] * k + bob);
        for (let i = 2; i < t.length; i += 2) ctx.lineTo(t[i], -t[i + 1] * k + bob);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // vetoogjes
    ctx.lineWidth = 0.0045;
    for (const e of eyes) {
      const X = e.x, Y = -e.y * k + bob;
      ctx.fillStyle = 'rgba(255,236,160,0.2)';
      ctx.strokeStyle = 'rgba(255,248,215,0.6)';
      ctx.beginPath(); ctx.ellipse(X, Y, e.r, e.r * k, 0, 0, TAU); ctx.fill(); ctx.stroke();
      if (e.r > 0.014) {
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.beginPath(); ctx.ellipse(X - e.r * 0.3, Y - e.r * k * 0.3, e.r * 0.25, e.r * k * 0.18, 0, 0, TAU); ctx.fill();
      }
    }

    // rimpelingen
    for (const r of ripples) {
      const t = r.age / r.life, rad = 0.03 + t * 0.34;
      const a = (1 - t) * 0.55 * r.amp;
      ctx.beginPath(); ctx.ellipse(r.x, -r.y * k, rad, rad * k, 0, 0, TAU);
      ctx.strokeStyle = `rgba(255,248,215,${a})`; ctx.lineWidth = 0.011; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(r.x, -r.y * k + 0.008, rad * 1.04, rad * 1.04 * k, 0, 0, TAU);
      ctx.strokeStyle = `rgba(120,60,5,${a * 0.5})`; ctx.lineWidth = 0.008; ctx.stroke();
    }

    // glans (spiegeling van het raam) + zachte lichtvlek
    const sway = Math.sin(clock * 0.8) * 0.015;
    ctx.save();
    ctx.translate(-0.4 + sway, -0.42 * k);
    ctx.rotate(-0.4); ctx.scale(1, 0.26 + 0.1 * k);
    let hg = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.5);
    hg.addColorStop(0, 'rgba(255,252,235,0.5)');
    hg.addColorStop(0.6, 'rgba(255,252,235,0.16)');
    hg.addColorStop(1, 'rgba(255,252,235,0)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, 0, 0.5, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(0.45 - sway, 0.5 * k);
    ctx.rotate(-0.3); ctx.scale(1, 0.3);
    hg = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.35);
    hg.addColorStop(0, 'rgba(255,245,200,0.22)');
    hg.addColorStop(1, 'rgba(255,245,200,0)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, 0, 0.35, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- tekenen: hand
  function drawHand(g) {
    const { k, Hp } = g;
    const tip = { x: 0.3, y: k * 0.8 };
    const joint = { x: 0.56, y: k + 0.1 };
    const base = { x: 0.9, y: k + 0.62 };

    // schaduw van de duim op rand en soep
    ctx.save();
    ctx.translate(tip.x + 0.06, tip.y + 0.05);
    ctx.scale(0.3, 0.14);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    sg.addColorStop(0, 'rgba(60,25,5,0.32)'); sg.addColorStop(1, 'rgba(60,25,5,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    const seg = (a, b, w, style, dx = 0, dy = 0) => {
      ctx.strokeStyle = style; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(a.x + dx, a.y + dy); ctx.lineTo(b.x + dx, b.y + dy); ctx.stroke();
    };
    // duim: twee kootjes, taps toelopend
    seg(base, joint, 0.36, 'rgba(150,90,60,0.5)', 0.02, 0.03);
    seg(joint, tip, 0.31, 'rgba(150,90,60,0.5)', 0.02, 0.03);
    seg(base, joint, 0.33, '#ebb08a');
    seg(joint, tip, 0.28, '#ecb28c');
    seg(base, joint, 0.22, '#f3c4a2', -0.03, -0.03);
    seg(joint, tip, 0.18, '#f4c8a8', -0.025, -0.03);
    seg(base, joint, 0.07, 'rgba(255,232,214,0.7)', -0.06, -0.06);
    seg(joint, tip, 0.06, 'rgba(255,232,214,0.7)', -0.05, -0.05);

    // knokkel-plooien
    ctx.strokeStyle = 'rgba(160,100,70,0.45)'; ctx.lineWidth = 0.012;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.arc(joint.x + 0.02 + i * 0.035, joint.y + i * 0.02, 0.13, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
    }
    // nagel
    const ang = Math.atan2(tip.y - joint.y, tip.x - joint.x);
    ctx.save();
    ctx.translate(tip.x - Math.cos(ang) * 0.02, tip.y - Math.sin(ang) * 0.02);
    ctx.rotate(ang);
    ctx.fillStyle = '#f9dccb'; ctx.strokeStyle = 'rgba(190,130,100,0.8)'; ctx.lineWidth = 0.01;
    ctx.beginPath(); ctx.ellipse(-0.05, 0, 0.1, 0.08, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.ellipse(-0.07, -0.025, 0.04, 0.02, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  // ---------------------------------------------------------------- stroming tonen
  let streams = null;
  function buildStreams() {
    streams = [];
    const rootFor = c => { // x(1−x²)=c met x in (0, 0.577)
      let lo = 0, hi = 0.5774;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (m * (1 - m * m) < c) lo = m; else hi = m; }
      return (lo + hi) / 2;
    };
    const trace = (x0, y0, maxSteps, closed) => {
      const ds = 0.012, pts = [[x0, y0]];
      let x = x0, y = y0;
      const dirAt = (px, py) => { const f = field(px, py), m = Math.hypot(f[0], f[1]) || 1; return [f[0] / m, f[1] / m]; };
      for (let i = 0; i < maxSteps; i++) {
        const a = dirAt(x, y), b = dirAt(x + a[0] * ds / 2, y + a[1] * ds / 2);
        const c = dirAt(x + b[0] * ds / 2, y + b[1] * ds / 2), d = dirAt(x + c[0] * ds, y + c[1] * ds);
        x += ds * (a[0] + 2 * b[0] + 2 * c[0] + d[0]) / 6;
        y += ds * (a[1] + 2 * b[1] + 2 * c[1] + d[1]) / 6;
        if (x * x + y * y > 0.99) break;
        pts.push([x, y]);
        if (closed && i > 30 && Math.hypot(x - x0, y - y0) < ds * 1.2) { pts.push([x0, y0]); break; }
      }
      return pts;
    };
    for (const c of [0.1, 0.22, 0.32, 0.37]) {
      const xi = rootFor(c);
      streams.push(trace(xi, 0, 1500, true));
      streams.push(trace(-xi, 0, 1500, true));
    }
    streams.push(trace(0, -0.95, 400, false)); // rechte lijn door het midden
  }

  function drawFlowOverlay(g) {
    if (!streams) buildStreams();
    const { k } = g;
    ctx.save();
    ctx.translate(0, g.dy);
    ctx.scale(RS, RS);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const col = '#e32b2b';
    const pxPerUnit = g.R * RS; // om lijndiktes in schermpixels te houden
    const lw = 2.6 / pxPerUnit;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw;
    ctx.globalAlpha = 0.95;
    for (const s of streams) {
      ctx.beginPath();
      for (let i = 0; i < s.length; i++) {
        const X = s[i][0], Y = -s[i][1] * k;
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.stroke();
      // pijlpunten
      const total = s.length, nArrows = total > 200 ? 3 : 2;
      for (let j = 0; j < nArrows; j++) {
        const idx = Math.floor(((j + 0.55) / nArrows) * (total - 2)) + 1;
        const a = s[Math.max(0, idx - 2)], b = s[Math.min(total - 1, idx + 2)];
        const ax = a[0], ay = -a[1] * k, bx = b[0], by = -b[1] * k;
        const ang = Math.atan2(by - ay, bx - ax), sz = 11 / pxPerUnit;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        ctx.beginPath();
        ctx.moveTo(mx + Math.cos(ang) * sz, my + Math.sin(ang) * sz);
        ctx.lineTo(mx + Math.cos(ang + 2.5) * sz, my + Math.sin(ang + 2.5) * sz);
        ctx.lineTo(mx + Math.cos(ang - 2.5) * sz, my + Math.sin(ang - 2.5) * sz);
        ctx.closePath(); ctx.fill();
      }
    }
    // blaasplek
    ctx.globalAlpha = 1;
    const bxp = BLOW.x, byp = -BLOW.y * k;
    ctx.beginPath(); ctx.ellipse(bxp, byp, 11 / pxPerUnit, 11 / pxPerUnit * 0.8, 0, 0, TAU);
    ctx.fillStyle = '#2160e8'; ctx.fill();
    ctx.lineWidth = 2.5 / pxPerUnit; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- tekenen: sprites in schermruimte
  function drawSteam(g) {
    for (const p of steam) {
      const t = p.age / p.life;
      const a = Math.sin(Math.PI * Math.pow(t, 0.8)) * lerp(0.2, 0.085, E);
      const size = g.R * (p.size + p.grow * t * (0.8 + 0.9 * E)) * 2.4;
      ctx.globalAlpha = a;
      ctx.drawImage(steamSprite, p.x - size / 2, p.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  function drawBreath(g) {
    const B = blowScreen(g);
    for (const p of breath) {
      const t = p.t;
      let x, y;
      const travel = 0.62;
      if (t < travel) {
        const u = ease(t / travel);
        const cx = lerp(p.sx, B.x, 0.5) + p.jx * 2.2, cy = lerp(p.sy, B.y, 0.55);
        const tx = B.x + p.jx * 0.3, ty = B.y + p.jy * 0.3;
        x = (1 - u) * (1 - u) * p.sx + 2 * (1 - u) * u * cx + u * u * tx;
        y = (1 - u) * (1 - u) * p.sy + 2 * (1 - u) * u * cy + u * u * ty;
      } else {
        const u = (t - travel) / (1 - travel);
        x = B.x + p.jx * 0.3 + p.ax * g.R * 0.5 * u;
        y = B.y + p.jy * 0.3 + p.ay * g.R * 0.55 * u;
      }
      const env = Math.min(t / 0.12, 1) * (t < travel ? 1 : 1 - (t - travel) / (1 - travel));
      const size = g.R * (0.22 + 0.5 * Math.min(t / travel, 1)) * p.sz * (t > travel ? 1 + (t - travel) * 1.4 : 1);
      ctx.globalAlpha = clamp(env * 0.2 * breathStrength, 0, 1);
      ctx.drawImage(breathSprite, x - size / 2, y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- render
  function render() {
    const g = geometry();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bgCanvas, -8 - E * 10, -8 - E * 6, W + 16 + 20, H + 16 + 12);

    // bowl-ruimte
    ctx.save();
    ctx.setTransform(dpr * g.R, 0, 0, dpr * g.R, dpr * g.bx, dpr * g.by);
    ctx.rotate(g.roll);
    drawBody(g);
    drawInterior(g);
    ctx.restore();

    // stoom (schermruimte)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSteam(g);

    // duim over de rand
    ctx.save();
    ctx.setTransform(dpr * g.R, 0, 0, dpr * g.R, dpr * g.bx, dpr * g.by);
    ctx.rotate(g.roll);
    drawHand(g);
    ctx.restore();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBreath(g);

    if (showFlow) {
      ctx.save();
      ctx.setTransform(dpr * g.R, 0, 0, dpr * g.R, dpr * g.bx, dpr * g.by);
      ctx.rotate(g.roll);
      drawFlowOverlay(g);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- invoer
  function setNear(v) {
    want = v ? 1 : 0;
    btnNear.textContent = want ? 'Terug' : 'Dichterbij houden';
    btnNear.setAttribute('aria-pressed', String(!!want));
    hint.textContent = want
      ? 'Tik op Blazen voor een zucht, houd ingedrukt om te blijven blazen.'
      : 'Haal de kom dichterbij om erin te kunnen blazen.';
    if (!want) { holding = false; blowUntil = 0; }
  }
  btnNear.addEventListener('click', () => setNear(!want));

  function startBlow() {
    if (btnBlow.disabled) return;
    holding = true;
    blowUntil = Math.max(blowUntil, clock + 2.6);
  }
  function stopBlow() { holding = false; }
  btnBlow.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { btnBlow.setPointerCapture(e.pointerId); } catch (_) { /* niet erg */ }
    startBlow();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => btnBlow.addEventListener(t, stopBlow));
  btnBlow.addEventListener('keydown', e => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startBlow(); }
  });
  btnBlow.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') stopBlow(); });
  btnBlow.addEventListener('contextmenu', e => e.preventDefault());
  btnBlow.addEventListener('blur', stopBlow);

  chkFlow.addEventListener('change', () => {
    showFlow = chkFlow.checked;
    legend.hidden = !showFlow;
  });

  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 120));

  // ---------------------------------------------------------------- start
  craquele = makeCraquele();
  textTex = makeTextTexture();
  steamSprite = makeSprite(128, [[0, 'rgba(255,252,246,0.95)'], [0.45, 'rgba(255,250,242,0.45)'], [1, 'rgba(255,250,242,0)']]);
  breathSprite = makeSprite(128, [[0, 'rgba(235,244,255,1)'], [0.5, 'rgba(225,238,255,0.5)'], [1, 'rgba(225,238,255,0)']]);
  buildSoup();
  layout();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Hulp voor tests (geen invloed op gebruik)
  window.__soep = {
    get state() { return { prog, want, flowStrength, breathStrength, blowing, clock }; },
    eyes, noodles, carrots, chicken, leeks, celery, parsley,
    field,
    simulate(sec, step = 1 / 60) { for (let t = 0; t < sec; t += step) update(step); render(); },
    blowFor(sec) { if (!btnBlow.disabled) { holding = false; blowUntil = clock + sec; } },
    setNear,
  };
})();
