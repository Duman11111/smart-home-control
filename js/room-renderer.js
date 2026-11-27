import { livingRoom, entryRoom } from './state.js';

export const roomPhotos = [
  { asset:'--room', file:'assets/room-living.jpg', mask:'assets/window-mask-0.png', description:'Жылы жарық түскен қонақ бөлме', position:'53%' },
  { asset:'--room-bed', file:'assets/room-bed.jpg', mask:'assets/window-mask-1.png', description:'Жұмсақ жарықтанған жатын бөлме', position:'53%' },
  { asset:'--room-kitchen', file:'assets/room-kitchen.jpg', mask:'assets/window-mask-2.png', description:'Жарық жолақтары бар қара түсті ас үй', position:'52%' },
  { asset:'--room-entry', file:'assets/room-entry.jpg', mask:'assets/window-mask-3.png', description:'Ағаш есігі бар жылы реңкті кіреберіс бөлме', position:'52%' }
];

// Exact 960x640 window bay horizontal & vertical spans matching window-mask-{0..3}.png!
const windowBays960 = [
  { left: 170, right: 754, top: 152, bottom: 371, folds: 7, coveStrength: 0.28 }, // Living Room
  { left: 553, right: 895, top: 88,  bottom: 363, folds: 5, coveStrength: 0.14 }, // Bedroom
  { left: 423, right: 824, top: 123, bottom: 398, folds: 6, coveStrength: 0.18 }, // Kitchen
  { left: 286, right: 428, top: 95,  bottom: 444, folds: 3, coveStrength: 0.22 }  // Entryway
];

const roomLampSpots = [
  [{ x: 45, y: 208, r: 105 }, { x: 235, y: 38, r: 185 }],
  [{ x: 56, y: 146, r: 90 }, { x: 207, y: 146, r: 75 }],
  [{ x: 159, y: 86, r: 125 }, { x: 221, y: 100, r: 105 }],
  [{ x: 111, y: 156, r: 85 }, { x: 37, y: 86, r: 72 }]
];

const LIVING_TV_QUAD_960 = {
  xL: 798,
  xR: 929,
  yTL: 209,
  yBL: 317,
  yTR: 172,
  yBR: 323
};

const roomBitmaps = new Map();
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');

// Offscreen compositing layer for pixel-exact foreground occlusion of curtains!
const curtainLayer = document.createElement('canvas');
curtainLayer.width = 960;
curtainLayer.height = 640;
const curtainLayerCtx = curtainLayer.getContext('2d');

let fabricTexturePromise = null;
function loadFabricTexture() {
  if (fabricTexturePromise) return fabricTexturePromise;
  fabricTexturePromise = (async () => {
    const img = new Image();
    img.src = 'assets/curtain-fabric.jpg';
    await img.decode();
    return img;
  })().catch(() => null);
  return fabricTexturePromise;
}

let tvVideoEl = null;
let tvVideoReady = false;
function ensureTvVideo() {
  if (tvVideoEl) return tvVideoEl;
  tvVideoEl = document.createElement('video');
  tvVideoEl.src = 'assets/house-film.mp4';
  tvVideoEl.muted = true;
  tvVideoEl.loop = true;
  tvVideoEl.playsInline = true;
  tvVideoEl.preload = 'auto';
  tvVideoEl.addEventListener('canplay', () => { tvVideoReady = true; });
  return tvVideoEl;
}

const tvBuffer = document.createElement('canvas');
tvBuffer.width = 320;
tvBuffer.height = 180;
const tvBufCtx = tvBuffer.getContext('2d');

const lightingScene = {
  index: -1,
  images: null,
  shadeTop: 0,
  shadeBottom: 0,
  bottomVel: 0,
  topVel: 0,
  rippleEnergy: 0,
  lamp: 1,
  door: 0,
  tvPower: 0,
  acFlow: 0,
  heatFlow: 0,
  targetShade: 0,
  targetLamp: 1,
  targetDoor: 0,
  targetTv: 0,
  targetAc: 0,
  targetHeat: 0,
  tvChannel: 0,
  clock: 0,
  frame: 0,
  lastTime: 0
};

function createSceneSurface() {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 640;
  return canvas;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.decode().then(() => resolve(img)).catch(reject);
  });
}

function loadRoomBitmaps(index) {
  if (roomBitmaps.has(index)) return roomBitmaps.get(index);
  const pending = (async () => {
    const [image, windowMask, fabric] = await Promise.all([
      loadImage(roomPhotos[index].file),
      loadImage(roomPhotos[index].mask),
      loadFabricTexture()
    ]);

    const night = createSceneSurface();
    const ctx = night.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, 960, 640);
    const pixels = ctx.getImageData(0, 0, 960, 640);

    // Read windowMask alpha so night-sky tone preservation matches exact window mask!
    const maskSurface = createSceneSurface();
    const maskCtx = maskSurface.getContext('2d', { willReadFrequently: true });
    maskCtx.drawImage(windowMask, 0, 0, 960, 640);
    const coverage = maskCtx.getImageData(0, 0, 960, 640).data;

    for (let i = 0; i < pixels.data.length; i += 4) {
      const data = pixels.data;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const warmth = Math.max(0, Math.min(1, (r - b) / 85));
      const indoors = .18 - .13 * warmth;
      const sky = coverage[i + 3] / 255;
      const factor = indoors + (.88 - indoors) * sky;
      data[i] = r * factor * (.74 + .26 * sky);
      data[i + 1] = g * factor * .96;
      data[i + 2] = Math.min(255, b * factor * (1.42 - .42 * sky) + 6 * (1 - sky));
    }
    ctx.putImageData(pixels, 0, 0);
    return { image, night, windowMask, fabric };
  })();
  roomBitmaps.set(index, pending);
  return pending;
}

/**
 * Photorealistic Architectural Curtain Compositor:
 * 1. Renders warm 2700K walnut-linen drapery + sheer chiffon with real 3D tubular S-wave folds,
 *    ceiling cove illumination, recessed wall-corner vignette, and furniture contact shadows onto `curtainLayer`.
 * 2. Applies `destination-in` with `windowMask` (`assets/window-mask-{0..3}.png`) so:
 *    - ZERO pixels ever cross outside the window frame onto ceiling, walls, or floor!
 *    - EVERY foreground object (sofa pillows, branches & vases, bed, armchair & ottoman, hanging pendant lamp,
 *      marble kitchen island, barstools, dining chairs & candles, entryway console) sits CLEANLY IN FRONT OF THE CURTAIN!
 */
function paintCompositedCurtains(targetCtx, index, s) {
  const { windowMask, fabric } = s.images;
  if (!windowMask) return;

  const bay = windowBays960[index] || windowBays960[0];
  const { left, right, top, bottom, folds, coveStrength } = bay;
  const width = right - left;
  const height = bottom - top;
  const t = s.clock;

  const ctx = curtainLayerCtx;
  ctx.clearRect(0, 0, 960, 640);

  // Side stack width when 100% open (in bedroom, photo already has side curtains, so stack tucks neatly into them!)
  const minStack = index === 1 ? 6 : Math.max(18, width * 0.072);
  const halfSpan = width * 0.5 + 1.5;

  const topTravel = Math.max(0, Math.min(1.02, s.shadeTop));
  const botTravel = Math.max(-0.02, Math.min(1.04, s.shadeBottom));

  const topSpan = minStack + (halfSpan - minStack) * topTravel;
  const botSpan = Math.max(minStack * 0.75, minStack + (halfSpan - minStack) * botTravel);
  const airBelly = (topSpan - botSpan) * 0.55 + Math.sin(t * 0.009) * 7.5 * s.rippleEnergy;
  const midSpan = (topSpan + botSpan) * 0.5 - airBelly;

  const breeze = (s.acFlow > 0.1 ? 2.6 : 0.8) * (1 - topTravel * 0.7);
  const breezeShift = Math.sin(t * 0.0024) * breeze;

  // 1. Delicate Translucent Warm Voile Sheer Layer (glides slightly ahead of heavy drapes)
  const sheerTopT = Math.min(1, topTravel * 1.15);
  const sheerBotT = Math.min(1.02, Math.max(0, botTravel * 1.15));
  if (sheerTopT > 0.02 && topTravel < 0.995) {
    const sTopW = minStack * 0.5 + (halfSpan - minStack * 0.5) * sheerTopT;
    const sBotW = minStack * 0.5 + (halfSpan - minStack * 0.5) * sheerBotT + breezeShift * 1.2;
    const sMidW = (sTopW + sBotW) * 0.5 + Math.sin(t * 0.008 + 1.1) * 8 * s.rippleEnergy;

    for (const dir of [1, -1]) {
      const ax = dir === 1 ? left : right;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(ax, top);
      ctx.lineTo(ax + dir * sTopW, top);
      ctx.quadraticCurveTo(ax + dir * sMidW, top + height * 0.52, ax + dir * sBotW, bottom);
      ctx.lineTo(ax, bottom);
      ctx.closePath();
      ctx.clip();

      const sheerAlpha = (0.14 + 0.12 * s.lamp) * (1 - 0.25 * sheerTopT);
      const sheerGrad = ctx.createLinearGradient(ax, top, ax + dir * sTopW, top);
      sheerGrad.addColorStop(0, `rgba(218, 198, 174, ${(sheerAlpha * 0.7).toFixed(3)})`);
      sheerGrad.addColorStop(0.6, `rgba(235, 220, 202, ${sheerAlpha.toFixed(3)})`);
      sheerGrad.addColorStop(1, `rgba(248, 236, 220, ${(sheerAlpha * 1.3).toFixed(3)})`);
      ctx.fillStyle = sheerGrad;
      ctx.fillRect(Math.min(ax, ax + dir * (sTopW + 25)), top, sTopW + 30, height);
      ctx.restore();
    }
  }

  // 2. Main 2700K Warm Walnut-Linen Drapery Panels (Left & Right)
  for (const dir of [1, -1]) {
    const ax = dir === 1 ? left : right;
    const curBotSpan = botSpan + dir * breezeShift;
    const curMidSpan = midSpan + dir * breezeShift * 0.6;
    const maxReach = Math.max(topSpan, curMidSpan, curBotSpan) + 16;

    if (maxReach <= 2) continue;

    // 2a. Soft cast shadow onto glass just ahead of the moving curtain edge
    ctx.save();
    const leadX = ax + dir * curMidSpan;
    const dropShadow = ctx.createLinearGradient(leadX - dir * 3, top, leadX + dir * 24, top);
    dropShadow.addColorStop(0, 'rgba(5, 7, 12, 0.52)');
    dropShadow.addColorStop(0.5, 'rgba(5, 7, 12, 0.18)');
    dropShadow.addColorStop(1, 'rgba(5, 7, 12, 0)');
    ctx.fillStyle = dropShadow;
    ctx.beginPath();
    ctx.moveTo(ax + dir * topSpan, top);
    ctx.quadraticCurveTo(ax + dir * curMidSpan, top + height * 0.5, ax + dir * curBotSpan, bottom);
    ctx.lineTo(ax + dir * (curBotSpan + 24), bottom);
    ctx.quadraticCurveTo(ax + dir * (curMidSpan + 24), top + height * 0.5, ax + dir * (topSpan + 24), top);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 2b. Flowing C-Billow Curtain Panel Clip
    ctx.save();
    const ripple1 = Math.sin(t * 0.012) * 5.5 * s.rippleEnergy;
    const ripple2 = Math.cos(t * 0.010 + 1.4) * 4.8 * s.rippleEnergy;

    ctx.beginPath();
    ctx.moveTo(ax, top);
    ctx.lineTo(ax + dir * topSpan, top);
    ctx.bezierCurveTo(
      ax + dir * (curMidSpan + ripple1), top + height * 0.35,
      ax + dir * (curMidSpan - ripple2), top + height * 0.70,
      ax + dir * curBotSpan, bottom
    );
    ctx.lineTo(ax, bottom);
    ctx.closePath();
    ctx.clip();

    const bboxLeft = dir === 1 ? ax : ax - maxReach;

    // 2c. Woven Linen Texture + Smooth Continuous Tubular S-Wave Drapery Shading!
    // Compression makes folds deeper & tighter when gathered open, and broader & softer when closed!
    const compression = 1 - 0.42 * topTravel;
    const subBands = folds * 6;

    if (fabric) {
      for (let bIdx = 0; bIdx < subBands; bIdx++) {
        const u0 = bIdx / subBands;
        const u1 = (bIdx + 1) / subBands;
        const uMid = (u0 + u1) * 0.5;

        const x0 = ax + dir * (u0 * maxReach);
        const x1 = ax + dir * (u1 * maxReach + 0.9);
        const drawLeft = Math.min(x0, x1);
        const drawW = Math.abs(x1 - x0);

        const srcU = dir === 1 ? u0 : (1 - u1);
        const srcX = Math.max(0, Math.min(fabric.width - 12, Math.floor(srcU * (fabric.width - 12))));
        const srcW = Math.max(6, Math.floor((fabric.width - 12) / subBands));

        ctx.drawImage(fabric, srcX, 0, srcW, fabric.height, drawLeft, top, drawW, height);

        // Smooth rounded tubular wave-fold lighting (matches the real photographed curtain in Bedroom!)
        const phase = uMid * folds * Math.PI * 2 + s.rippleEnergy * Math.sin(t * 0.011) * 1.1;
        const waveCrest = Math.cos(phase); // +1 warm lit crest, -1 deep recessed fold valley
        const foldStrength = 0.24 + 0.16 * compression;

        if (waveCrest < 0) {
          const shadowAlpha = (-waveCrest) * foldStrength * 1.15;
          ctx.fillStyle = `rgba(12, 7, 4, ${shadowAlpha.toFixed(3)})`;
          ctx.fillRect(drawLeft, top, drawW, height);
        } else {
          const highlightAlpha = waveCrest * foldStrength * 0.52 * (0.25 + 0.75 * s.lamp);
          ctx.fillStyle = `rgba(238, 192, 140, ${highlightAlpha.toFixed(3)})`;
          ctx.fillRect(drawLeft, top, drawW, height);
        }
      }
    } else {
      ctx.fillStyle = '#5c422e';
      ctx.fillRect(bboxLeft, top, maxReach, height);
    }

    // 2d. Room Lighting Integration:
    // - Warm golden ceiling LED cove glow at top
    // - Ambient occlusion shadow toward floor & behind furniture
    const vertGrad = ctx.createLinearGradient(0, top, 0, bottom);
    vertGrad.addColorStop(0, `rgba(255, 194, 118, ${(coveStrength * s.lamp).toFixed(3)})`);
    vertGrad.addColorStop(0.16, 'rgba(0, 0, 0, 0)');
    vertGrad.addColorStop(0.68, 'rgba(10, 7, 5, 0.12)');
    vertGrad.addColorStop(0.90, 'rgba(8, 5, 3, 0.34)');
    vertGrad.addColorStop(1, 'rgba(5, 3, 2, 0.52)');
    ctx.fillStyle = vertGrad;
    ctx.fillRect(bboxLeft, top, maxReach, height);

    // Wall-corner architectural vignette so curtain sits deep inside the window recess
    const wallVig = ctx.createLinearGradient(ax, top, ax + dir * Math.min(85, maxReach), top);
    wallVig.addColorStop(0, 'rgba(8, 5, 3, 0.38)');
    wallVig.addColorStop(1, 'rgba(8, 5, 3, 0)');
    ctx.fillStyle = wallVig;
    ctx.fillRect(bboxLeft, top, maxReach, height);

    // Nighttime darkening when room lights (`s.lamp`) are dimmed or turned off!
    const nightDarkness = (1 - s.lamp) * 0.74;
    if (nightDarkness > 0.01) {
      ctx.fillStyle = `rgba(7, 9, 16, ${nightDarkness.toFixed(3)})`;
      ctx.fillRect(bboxLeft, top, maxReach, height);
    }

    // Subtle tailored hem highlight along the moving inner fold
    ctx.strokeStyle = `rgba(224, 182, 136, ${(0.08 + 0.16 * s.lamp).toFixed(3)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(ax + dir * topSpan, top);
    ctx.bezierCurveTo(
      ax + dir * (curMidSpan + ripple1), top + height * 0.35,
      ax + dir * (curMidSpan - ripple2), top + height * 0.70,
      ax + dir * curBotSpan, bottom
    );
    ctx.stroke();

    ctx.restore();
  }

  // Center meeting shadow seam when curtains are fully closed
  if (topTravel > 0.97 && botTravel > 0.96) {
    const midX = left + width * 0.5;
    ctx.strokeStyle = 'rgba(10, 6, 4, 0.62)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(midX, top);
    ctx.lineTo(midX + breezeShift, bottom);
    ctx.stroke();
  }

  // 3. CRITICAL STEP: Multiply curtainLayer by pixel-accurate `windowMask`!
  // This clips strictly inside the window frame AND carves out every foreground sofa, bed, armchair,
  // pendant lamp, kitchen island, branch, vase, candle, and chair so they remain IN FRONT OF the curtain!
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(windowMask, 0, 0, 960, 640);
  ctx.globalCompositeOperation = 'source-over';

  // Composite finished depth-occluded curtain onto main room canvas
  targetCtx.drawImage(curtainLayer, 0, 0);
}

function renderTvScreenContent(channelIdx, t) {
  const w = 320, h = 180;
  const c = tvBufCtx;
  c.clearRect(0, 0, w, h);

  let avgR = 70, avgG = 145, avgB = 220;

  if (channelIdx === 0) {
    const vid = ensureTvVideo();
    if (vid.paused) vid.play().catch(() => {});
    if (tvVideoReady && vid.readyState >= 2) {
      c.drawImage(vid, 0, 0, w, h);
      const vig = c.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, 185);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.28)');
      c.fillStyle = vig;
      c.fillRect(0, 0, w, h);
      avgR = 235; avgG = 178; avgB = 115;
    } else {
      const sky = c.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#0f2847');
      sky.addColorStop(0.5, '#2b6cb0');
      sky.addColorStop(0.75, '#ed8936');
      sky.addColorStop(1, '#1a365d');
      c.fillStyle = sky;
      c.fillRect(0, 0, w, h);
      avgR = 90; avgG = 155; avgB = 225;
    }
    c.fillStyle = 'rgba(0, 0, 0, 0.42)';
    c.fillRect(14, 12, 78, 18);
    c.fillStyle = '#e2f4ff';
    c.font = '700 10px Inter, system-ui, sans-serif';
    c.fillText('NAT GEO 4K', 20, 24);
  } else if (channelIdx === 1) {
    c.fillStyle = '#050608';
    c.fillRect(0, 0, w, h);
    const bar = 22;
    c.save();
    c.beginPath();
    c.rect(0, bar, w, h - bar * 2);
    c.clip();

    const pan = Math.sin(t * 0.0007) * 28;
    const sky = c.createLinearGradient(0, bar, 0, h - bar);
    sky.addColorStop(0, '#120d2b');
    sky.addColorStop(0.48, '#5a2653');
    sky.addColorStop(0.78, '#e86f3a');
    sky.addColorStop(1, '#ffc36b');
    c.fillStyle = sky;
    c.fillRect(0, bar, w, h - bar * 2);

    const sunX = 185 + pan * 0.6;
    const sunY = 98 + Math.sin(t * 0.001) * 6;
    const sunG = c.createRadialGradient(sunX, sunY, 4, sunX, sunY, 58);
    sunG.addColorStop(0, '#fff7dc');
    sunG.addColorStop(0.3, '#ffae52');
    sunG.addColorStop(1, 'rgba(255,110,50,0)');
    c.fillStyle = sunG;
    c.beginPath();
    c.arc(sunX, sunY, 58, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = '#24132c';
    c.beginPath();
    c.moveTo(-20, h - bar);
    for (let x = -20; x <= w + 20; x += 28) {
      const peak = 112 + Math.sin((x + pan) * 0.035) * 18 + Math.cos((x + pan) * 0.08) * 8;
      c.lineTo(x, peak);
    }
    c.lineTo(w + 20, h - bar);
    c.closePath();
    c.fill();

    c.fillStyle = '#0d0814';
    c.beginPath();
    c.moveTo(-20, h - bar);
    for (let x = -20; x <= w + 20; x += 22) {
      const peak = 128 + Math.cos((x + pan * 1.7) * 0.045) * 12;
      c.lineTo(x, peak);
    }
    c.lineTo(w + 20, h - bar);
    c.closePath();
    c.fill();

    c.restore();
    c.fillStyle = 'rgba(255,255,255,0.65)';
    c.font = '600 9px Inter, system-ui, sans-serif';
    c.fillText('CINEMA HD · DOLBY VISION', 14, 15);
    avgR = 235; avgG = 118; avgB = 72;
  } else if (channelIdx === 2) {
    const bg = c.createRadialGradient(w / 2, h * 0.85, 10, w / 2, h * 0.7, 170);
    bg.addColorStop(0, '#591c08');
    bg.addColorStop(0.55, '#240903');
    bg.addColorStop(1, '#080403');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);

    c.fillStyle = '#1c0d08';
    c.fillRect(68, 142, 184, 20);
    const emberGlow = c.createLinearGradient(70, 140, 250, 160);
    emberGlow.addColorStop(0, '#ff4500');
    emberGlow.addColorStop(0.5, '#ffb703');
    emberGlow.addColorStop(1, '#d93800');
    c.fillStyle = emberGlow;
    c.globalAlpha = 0.65 + 0.2 * Math.sin(t * 0.012);
    c.fillRect(82, 148, 156, 8);
    c.globalAlpha = 1;

    c.save();
    c.globalCompositeOperation = 'screen';
    for (let i = 0; i < 16; i++) {
      const fx = 86 + (i / 15) * 148 + Math.sin(t * 0.008 + i * 1.7) * 7;
      const fh = 42 + 36 * Math.abs(Math.sin(t * 0.006 + i * 0.9)) * (1 - Math.abs(i - 7.5) / 10);
      const fg = c.createRadialGradient(fx, 146 - fh * 0.35, 3, fx, 146 - fh * 0.4, fh * 0.75);
      fg.addColorStop(0, 'rgba(255, 248, 195, 0.85)');
      fg.addColorStop(0.4, 'rgba(255, 145, 25, 0.65)');
      fg.addColorStop(1, 'rgba(220, 40, 0, 0)');
      c.fillStyle = fg;
      c.beginPath();
      c.ellipse(fx, 146 - fh * 0.38, 16, fh * 0.68, Math.sin(t * 0.007 + i) * 0.14, 0, Math.PI * 2);
      c.fill();
    }
    for (let s = 0; s < 12; s++) {
      const prog = ((t * 0.05 + s * 27) % 130) / 130;
      const sx = 95 + ((s * 37) % 130) + Math.sin(prog * 8 + s) * 10;
      const sy = 145 - prog * 125;
      c.fillStyle = `rgba(255, 200, 90, ${(1 - prog) * 0.9})`;
      c.beginPath();
      c.arc(sx, sy, 1.6, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    avgR = 255; avgG = 122; avgB = 36;
  } else {
    const bg = c.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#0a192f');
    bg.addColorStop(0.6, '#112d4e');
    bg.addColorStop(1, '#091326');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);

    c.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    c.lineWidth = 1.2;
    for (let r = 24; r <= 88; r += 20) {
      c.beginPath();
      c.arc(235, 78, r, (t * 0.0015) % (Math.PI * 2), ((t * 0.0015) + 4.2) % (Math.PI * 2));
      c.stroke();
    }

    c.fillStyle = 'rgba(15, 23, 42, 0.78)';
    c.fillRect(16, 36, 175, 76);
    c.fillStyle = '#ef4444';
    c.fillRect(16, 16, 56, 16);
    c.fillStyle = '#ffffff';
    c.font = '700 9px Inter, system-ui, sans-serif';
    c.fillText('LIVE 24', 24, 27);
    c.fillStyle = '#38bdf8';
    c.font = '700 12px Inter, system-ui, sans-serif';
    c.fillText('SMART HOME IOT', 26, 58);
    c.fillStyle = '#e2e8f0';
    c.font = '500 10px Inter, system-ui, sans-serif';
    c.fillText('Ақылды үй технологиялары', 26, 76);
    c.fillText('энергияны 32% үнемдейді', 26, 92);

    c.fillStyle = '#0284c7';
    c.fillRect(0, 136, w, 22);
    c.fillStyle = '#ffffff';
    c.font = '700 11px Inter, system-ui, sans-serif';
    c.fillText('БАСТЫ ЖАҢАЛЫҚТАР · АСТАНА 21 °C', 14, 151);

    c.fillStyle = '#0f172a';
    c.fillRect(0, 158, w, 22);
    const tickerText = 'Қазақстанда IoT және Smart Home экожүйесі қарқынды дамуда   •   Күн панельдері мен климат-бақылау тиімділігі артты   •   ';
    c.fillStyle = '#bae6fd';
    c.font = '500 9.5px Inter, system-ui, sans-serif';
    const offset = -((t * 0.045) % 520);
    c.fillText(tickerText + tickerText, offset, 172);
    avgR = 56; avgG = 165; avgB = 250;
  }

  return [avgR, avgG, avgB];
}

function paintLivingRoomTv(ctx, tvPower, channelIdx, t) {
  const q = LIVING_TV_QUAD_960;
  const cx = (q.xL + q.xR) * 0.5;
  const cy = (q.yTL + q.yBL + q.yTR + q.yBR) * 0.25;

  if (tvPower <= 0.015) {
    if (tvVideoEl && !tvVideoEl.paused) tvVideoEl.pause();
    ctx.save();
    const ledY = (q.yBL + q.yBR) * 0.5 + 2.5;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
    ctx.shadowColor = 'rgba(239, 68, 68, 0.8)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(cx, ledY, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (channelIdx !== 0 && tvVideoEl && !tvVideoEl.paused) {
    tvVideoEl.pause();
  }

  const [ar, ag, ab] = renderTvScreenContent(channelIdx % 4, t);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const flicker = 0.92 + 0.08 * Math.sin(t * 0.009);
  const ambAlpha = 0.34 * tvPower * flicker;
  const wallGlow = ctx.createRadialGradient(cx, cy, 25, cx - 10, cy + 8, 195);
  wallGlow.addColorStop(0, `rgba(${ar}, ${ag}, ${ab}, ${ambAlpha.toFixed(3)})`);
  wallGlow.addColorStop(0.55, `rgba(${ar}, ${ag}, ${ab}, ${(ambAlpha * 0.42).toFixed(3)})`);
  wallGlow.addColorStop(1, `rgba(${ar}, ${ag}, ${ab}, 0)`);
  ctx.fillStyle = wallGlow;
  ctx.fillRect(640, 60, 320, 390);
  ctx.restore();

  const vOpen = Math.min(1, Math.max(0.025, (tvPower - 0.08) / 0.82));
  const hOpen = Math.min(1, tvPower / 0.25);

  const spanX = q.xR - q.xL;
  const activeStart = Math.round(spanX * (1 - hOpen) * 0.5);
  const activeEnd = Math.round(spanX * (1 - (1 - hOpen) * 0.5));

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(q.xL, q.yTL);
  ctx.lineTo(q.xR, q.yTR);
  ctx.lineTo(q.xR, q.yBR);
  ctx.lineTo(q.xL, q.yBL);
  ctx.closePath();
  ctx.clip();

  const stepPx = 2;
  for (let dx = activeStart; dx < activeEnd; dx += stepPx) {
    const u = dx / spanX;
    const uPersp = u / (0.82 + 0.18 * u);
    const srcX = Math.min(318, Math.floor(uPersp * 320));
    const srcW = Math.max(1, Math.ceil((stepPx / spanX) * 320));

    const colTopFull = q.yTL + (q.yTR - q.yTL) * u;
    const colBotFull = q.yBL + (q.yBR - q.yBL) * u;
    const colMid = (colTopFull + colBotFull) * 0.5;
    const halfH = (colBotFull - colTopFull) * 0.5 * vOpen;

    ctx.drawImage(
      tvBuffer,
      srcX, 0, srcW, 180,
      q.xL + dx, colMid - halfH, stepPx + 0.4, halfH * 2
    );
  }

  const glassSheen = ctx.createLinearGradient(q.xL, q.yTL, q.xR, q.yBR);
  glassSheen.addColorStop(0, 'rgba(255, 255, 255, 0.09)');
  glassSheen.addColorStop(0.42, 'rgba(255, 255, 255, 0.02)');
  glassSheen.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  glassSheen.addColorStop(1, 'rgba(0, 0, 0, 0.14)');
  ctx.fillStyle = glassSheen;
  ctx.fillRect(q.xL, q.yTR, spanX, q.yBR - q.yTR);

  if (tvPower < 0.48) {
    const flashAlpha = (1 - tvPower / 0.48) * 0.92;
    ctx.fillStyle = `rgba(235, 248, 255, ${flashAlpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(q.xL + activeStart, (q.yTL + q.yBL) * 0.5 - 2);
    ctx.lineTo(q.xL + activeEnd, (q.yTR + q.yBR) * 0.5 - 2);
    ctx.lineTo(q.xL + activeEnd, (q.yTR + q.yBR) * 0.5 + 2);
    ctx.lineTo(q.xL + activeStart, (q.yTL + q.yBL) * 0.5 + 2);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function paintLampGlow(ctx, index, lampLevel) {
  if (lampLevel <= 0.02) return;
  const spots = roomLampSpots[index] || [];
  ctx.save();
  ctx.scale(2, 2);
  ctx.globalCompositeOperation = 'screen';
  for (const spot of spots) {
    const radius = spot.r * (0.68 + 0.32 * lampLevel);
    const grad = ctx.createRadialGradient(spot.x, spot.y, 2, spot.x, spot.y, radius);
    grad.addColorStop(0, `rgba(255, 230, 178, ${(0.38 * lampLevel).toFixed(3)})`);
    grad.addColorStop(0.45, `rgba(255, 190, 110, ${(0.16 * lampLevel).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255, 170, 80, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paintClimateWaves(ctx, acFlow, heatFlow, t) {
  ctx.save();
  ctx.scale(2, 2);
  if (acFlow > 0.02) {
    ctx.strokeStyle = `rgba(145, 224, 255, ${(0.26 * acFlow).toFixed(3)})`;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      const baseX = 160 + i * 44;
      const offset = (t * 0.04 + i * 15) % 44;
      ctx.beginPath();
      ctx.moveTo(baseX, 10 + offset * 0.55);
      ctx.quadraticCurveTo(baseX - 9, 24 + offset * 0.65, baseX + 5, 38 + offset * 0.75);
      ctx.stroke();
    }
  }
  if (heatFlow > 0.02) {
    ctx.strokeStyle = `rgba(255, 152, 78, ${(0.30 * heatFlow).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const baseX = 135 + i * 46;
      const rise = (t * 0.038 + i * 12) % 40;
      ctx.beginPath();
      ctx.moveTo(baseX, 306 - rise * 0.7);
      ctx.quadraticCurveTo(baseX + Math.sin(t * 0.005 + i) * 7, 290 - rise * 0.75, baseX - 2, 272 - rise * 0.8);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const entryDoor = { x: 218, y: 47, width: 102, height: 175 };
const entryOutside = { x: 158, width: 54 };

function paintEntryDoor(ctx, scene) {
  const { x, y, width, height } = entryDoor;
  const { image, night } = scene.images;
  const progress = scene.door;
  const easing = progress * progress * (3 - 2 * progress);
  const angle = easing * 1.40;
  const shrink = Math.cos(angle);
  const depth = Math.sin(angle);
  const draw = (asset, sx, sy, sw, sh, dx, dy, dw, dh) => {
    ctx.drawImage(asset, sx * asset.width / 480, sy * asset.height / 320,
      sw * asset.width / 480, sh * asset.height / 320, dx, dy, dw, dh);
  };

  ctx.save();
  ctx.scale(2, 2);
  ctx.save();
  ctx.translate(x + width, 0);
  ctx.scale(-1, 1);
  draw(image, entryOutside.x, y, entryOutside.width, height, 0, y, width, height);
  const recess = ctx.createLinearGradient(0, y, 0, y + height);
  recess.addColorStop(0, 'rgba(5, 10, 18, .31)');
  recess.addColorStop(.72, 'rgba(5, 10, 18, .16)');
  recess.addColorStop(1, 'rgba(5, 10, 18, .38)');
  ctx.fillStyle = recess;
  ctx.fillRect(0, y, width, height);
  ctx.restore();

  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  const project = u => x + width * u * shrink / (1 + .17 * u * depth);
  const leaf = (asset, alpha) => {
    ctx.globalAlpha = alpha;
    for (let col = 0; col < width; col += 2) {
      const u = col / width;
      const left = project(u);
      const strip = project((col + 2) / width) - left;
      const retreat = 16 * u * depth;
      draw(asset, x + col, y, 2, height, left, y + retreat, strip + .4, height - retreat * 2);
    }
    ctx.globalAlpha = 1;
  };
  leaf(night, 1);
  if (scene.lamp) leaf(image, scene.lamp * (1 - .26 * depth));

  const handleEdge = project(1);
  const retreat = 16 * depth;
  ctx.fillStyle = '#2d1c12';
  ctx.fillRect(handleEdge, y + retreat, 3.3 * depth, height - retreat * 2);
  ctx.restore();
}

export function createRoomRenderer(roomStage, roomPhoto, sceneCanvas, onStatusOverlay) {
  const sceneContext = sceneCanvas.getContext('2d');

  function showRoomPhoto(index) {
    if (roomPhoto.dataset.room === String(index)) return;
    const photo = roomPhotos[index];
    roomPhoto.style.backgroundImage = 'var(' + photo.asset + ')';
    roomPhoto.style.setProperty('--room-position', photo.position);
    roomPhoto.setAttribute('aria-label', photo.description);
    roomPhoto.dataset.room = index;
    roomPhoto.classList.remove('entering');
    requestAnimationFrame(() => roomPhoto.classList.add('entering'));
  }

  function paintRoom() {
    const s = lightingScene, c = sceneContext;
    if (!s.images || !c) return;
    c.globalAlpha = 1;
    c.drawImage(s.images.night, 0, 0);
    if (s.lamp > 0) {
      c.globalAlpha = s.lamp;
      c.drawImage(s.images.image, 0, 0, 960, 640);
    }
    c.globalAlpha = 1;
    if (s.door > 0 && s.index === entryRoom) paintEntryDoor(c, s);

    // Depth-occluded curtains strictly inside window & behind all furniture/plants!
    paintCompositedCurtains(c, s.index, s);

    // Subtle room ambient dimming when curtains block outdoor daylight/twilight
    if (s.shadeTop > 0.01) {
      c.fillStyle = 'rgba(6,8,15,' + (Math.min(1, s.shadeTop) * (.18 + .12 * (1 - s.lamp))) + ')';
      c.fillRect(0, 0, 960, 640);
    }

    paintLampGlow(c, s.index, s.lamp);

    if (s.index === livingRoom) {
      paintLivingRoomTv(c, s.tvPower, s.tvChannel, s.clock);
    } else if (tvVideoEl && !tvVideoEl.paused) {
      tvVideoEl.pause();
    }

    paintClimateWaves(c, s.acFlow, s.heatFlow, s.clock);

    onStatusOverlay?.({
      curtainOpenPct: Math.round((1 - Math.max(0, Math.min(1, s.shadeTop))) * 100),
      curtainMoving: s.rippleEnergy > 0.04,
      lampPct: Math.round(s.lamp * 100),
      tvPower: s.index === livingRoom ? s.tvPower : 0
    });
  }

  function needsContinuousLoop() {
    const s = lightingScene;
    if (motionPreference.matches) return false;
    const demoVisible = !document.querySelector('#demo')?.hidden;
    if (!demoVisible) return false;
    const tvAnimating = s.index === livingRoom && s.tvPower > 0.02;
    const breezeActive = s.shadeTop < 0.95;
    return tvAnimating || s.acFlow > 0.02 || s.heatFlow > 0.02 || breezeActive;
  }

  function animateRoom(time) {
    const s = lightingScene;
    const dt = Math.min(48, s.lastTime ? time - s.lastTime : 16);
    s.lastTime = time;
    s.clock = time;

    const move = (current, target, step) => current + Math.sign(target - current) * Math.min(Math.abs(target - current), step);

    const topDiff = s.targetShade - s.shadeTop;
    if (Math.abs(topDiff) < 0.0015 && Math.abs(s.topVel) < 0.00008) {
      s.shadeTop = s.targetShade;
      s.topVel = 0;
    } else {
      const desiredVel = Math.sign(topDiff) * Math.min(0.00078, Math.abs(topDiff) * 0.0038 + 0.00012);
      s.topVel += (desiredVel - s.topVel) * Math.min(1, dt * 0.012);
      s.shadeTop += s.topVel * dt;
      if ((topDiff > 0 && s.shadeTop > s.targetShade) || (topDiff < 0 && s.shadeTop < s.targetShade)) {
        s.shadeTop = s.targetShade;
        s.topVel = 0;
      }
    }

    const springK = 0.000038;
    const damping = 0.0072;
    const hemForce = (s.shadeTop - s.shadeBottom) * springK - s.bottomVel * damping;
    s.bottomVel += hemForce * dt;
    s.shadeBottom += s.bottomVel * dt;
    if (Math.abs(s.shadeTop - s.targetShade) < 0.001 && Math.abs(s.shadeTop - s.shadeBottom) < 0.0015 && Math.abs(s.bottomVel) < 0.00004) {
      s.shadeBottom = s.targetShade;
      s.bottomVel = 0;
    }

    const instantSpeed = Math.min(1, (Math.abs(s.topVel) + Math.abs(s.bottomVel)) * 950);
    s.rippleEnergy = instantSpeed > s.rippleEnergy
      ? s.rippleEnergy + (instantSpeed - s.rippleEnergy) * Math.min(1, dt * 0.018)
      : Math.max(0, s.rippleEnergy - dt * 0.0018);

    const curtainActive =
      s.shadeTop !== s.targetShade ||
      s.shadeBottom !== s.targetShade ||
      s.rippleEnergy > 0.01;

    s.lamp = move(s.lamp, s.targetLamp, dt / 340);
    s.door = move(s.door, s.targetDoor, dt / 680);
    s.tvPower = move(s.tvPower, s.targetTv, dt / 360);
    s.acFlow = move(s.acFlow, s.targetAc, dt / 480);
    s.heatFlow = move(s.heatFlow, s.targetHeat, dt / 480);

    paintRoom();

    const transitioning =
      curtainActive ||
      s.lamp !== s.targetLamp ||
      s.door !== s.targetDoor ||
      s.tvPower !== s.targetTv ||
      s.acFlow !== s.targetAc ||
      s.heatFlow !== s.targetHeat;

    s.frame = (transitioning || needsContinuousLoop()) ? requestAnimationFrame(animateRoom) : 0;
  }

  function resolveShadeTarget(room) {
    let openPct = typeof room.curtainLevel === 'number' ? room.curtainLevel : (room.curtain ? 100 : 0);
    if (!room.curtain && openPct === 100) openPct = 0;
    if (room.curtain && openPct === 0) openPct = 100;
    return 1 - Math.max(0, Math.min(100, openPct)) / 100;
  }

  function updateRoomLighting(index, room) {
    const s = lightingScene;
    const changed = index !== s.index;
    const nextShade = resolveShadeTarget(room);
    const nextLamp = room.light ? 0.12 + 0.88 * room.brightness / 100 : 0;
    const nextDoor = index === entryRoom && room.door && !room.lock ? 1 : 0;
    const nextTv = index === livingRoom && room.tv ? 1 : 0;
    const nextAc = room.ac ? 1 : 0;
    const nextHeat = room.heater ? 1 : 0;
    s.tvChannel = room.tvChannel || 0;

    roomStage.dataset.lightOn = String(room.light);
    roomStage.dataset.tvOn = String(Boolean(index === livingRoom && room.tv));
    roomStage.dataset.acOn = String(Boolean(room.ac));
    roomStage.dataset.heaterOn = String(Boolean(room.heater));

    s.targetLamp = nextLamp;
    s.targetShade = nextShade;
    s.targetDoor = nextDoor;
    s.targetTv = nextTv;
    s.targetAc = nextAc;
    s.targetHeat = nextHeat;

    if (changed) {
      cancelAnimationFrame(s.frame);
      s.frame = 0;
      s.index = index;
      s.images = null;
      s.topVel = 0;
      s.bottomVel = 0;
      s.rippleEnergy = 0;
      roomPhoto.classList.remove('rendered');
      if (!sceneContext) return;
      loadRoomBitmaps(index).then(images => {
        if (s.index !== index) return;
        s.images = images;
        s.lamp = s.targetLamp;
        s.shadeTop = s.targetShade;
        s.shadeBottom = s.targetShade;
        s.door = s.targetDoor;
        s.tvPower = s.targetTv;
        s.acFlow = s.targetAc;
        s.heatFlow = s.targetHeat;
        s.clock = performance.now();
        paintRoom();
        roomPhoto.classList.add('rendered');
        if (needsContinuousLoop() && !s.frame) {
          s.lastTime = 0;
          s.frame = requestAnimationFrame(animateRoom);
        }
      }).catch(() => { roomBitmaps.delete(index); });
    } else if (s.images) {
      if (motionPreference.matches) {
        cancelAnimationFrame(s.frame);
        s.frame = 0;
        s.shadeTop = nextShade;
        s.shadeBottom = nextShade;
        s.topVel = 0;
        s.bottomVel = 0;
        s.rippleEnergy = 0;
        s.lamp = nextLamp;
        s.door = nextDoor;
        s.tvPower = nextTv;
        s.acFlow = nextAc;
        s.heatFlow = nextHeat;
        paintRoom();
      } else {
        paintRoom();
        if (!s.frame) {
          s.lastTime = 0;
          s.frame = requestAnimationFrame(animateRoom);
        }
      }
    }
  }

  return { showRoomPhoto, updateRoomLighting };
}
