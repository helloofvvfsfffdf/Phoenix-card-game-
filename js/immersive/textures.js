/* PHOENIX - the textures, drawn on canvases.
 *
 * Every surface in the room is painted here, at run time, with a 2D canvas:
 * the floorboards, the wallpaper, the wood, the leather, the rug, the poster
 * and the notepad. Nothing is downloaded, so there is no licence to chase,
 * no file to go missing and nothing to cache.
 *
 * The drawings are deliberately stylised: strong shapes, warm colours and
 * visible brush-like grain, rather than photographs of wood.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';

/** A small deterministic random, so the room looks the same every time. */
export function rng(seed) {
  let state = (seed === undefined ? 20260101 : seed) >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function finish(canvas, repeatX, repeatY, aniso) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX || 1, repeatY || 1);
  texture.anisotropy = aniso || 8;
  return texture;
}

/* ------------------------------------------------------------------ */
/* The floor: oak boards                                               */
/* ------------------------------------------------------------------ */

/**
 * Oak floorboards.
 *
 * The boards run in one direction, each a slightly different colour, with a
 * grain drawn along them and a dark seam between them.
 */
export function floorboardTexture(size) {
  const s = size || 1024;
  const canvas = makeCanvas(s, s);
  const ctx = canvas.getContext('2d');
  const random = rng(4242);

  ctx.fillStyle = '#5a3d26';
  ctx.fillRect(0, 0, s, s);

  const boards = 6;
  const height = s / boards;
  for (let b = 0; b < boards; b++) {
    const y = b * height;
    const warmth = 0.82 + random() * 0.3;
    const base = [94 * warmth, 62 * warmth, 38 * warmth];
    ctx.fillStyle = 'rgb(' + base.map(Math.round).join(',') + ')';
    ctx.fillRect(0, y, s, height);

    // The grain: long, slightly wavy strokes down the board.
    for (let g = 0; g < 26; g++) {
      const gy = y + 3 + random() * (height - 6);
      const dark = random() > 0.45;
      ctx.strokeStyle = dark
        ? 'rgba(48, 30, 17, ' + (0.12 + random() * 0.2) + ')'
        : 'rgba(150, 108, 66, ' + (0.06 + random() * 0.12) + ')';
      ctx.lineWidth = 1 + random() * 2.2;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      const wave = 3 + random() * 7;
      for (let x = 0; x <= s; x += 32) {
        ctx.lineTo(x, gy + Math.sin((x / s) * Math.PI * 2 + b) * wave);
      }
      ctx.stroke();
    }

    // A knot, now and then.
    if (random() > 0.55) {
      const kx = random() * s;
      const ky = y + height * (0.3 + random() * 0.4);
      const kr = 5 + random() * 9;
      const knot = ctx.createRadialGradient(kx, ky, 1, kx, ky, kr);
      knot.addColorStop(0, 'rgba(40, 24, 12, 0.85)');
      knot.addColorStop(1, 'rgba(40, 24, 12, 0)');
      ctx.fillStyle = knot;
      ctx.beginPath();
      ctx.arc(kx, ky, kr, 0, Math.PI * 2);
      ctx.fill();
    }

    // The seam between the boards.
    ctx.fillStyle = 'rgba(24, 14, 8, 0.75)';
    ctx.fillRect(0, y, s, 2);
    // The ends of the boards, staggered.
    const cut = Math.floor(random() * s);
    ctx.fillRect(cut, y, 2, height);
  }
  return finish(canvas, 4, 4, 8);
}

/* ------------------------------------------------------------------ */
/* The walls: a deep damask wallpaper                                   */
/* ------------------------------------------------------------------ */

/**
 * The wallpaper.
 *
 * A deep blue-green with a repeating damask shape, painted in a slightly
 * lighter tone so it catches the lamplight without shouting.
 */
export function wallpaperTexture(size) {
  const s = size || 512;
  const canvas = makeCanvas(s, s);
  const ctx = canvas.getContext('2d');

  const ground = ctx.createLinearGradient(0, 0, 0, s);
  ground.addColorStop(0, '#1c2b34');
  ground.addColorStop(1, '#16222b');
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, s, s);

  // The damask: a lozenge with a little leaf on each side.
  const draw = function (cx, cy, scale, alpha) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(196, 156, 96, ' + alpha + ')';
    ctx.beginPath();
    ctx.moveTo(0, -46);
    ctx.quadraticCurveTo(26, -20, 0, 0);
    ctx.quadraticCurveTo(-26, -20, 0, -46);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 46);
    ctx.quadraticCurveTo(26, 20, 0, 0);
    ctx.quadraticCurveTo(-26, 20, 0, 46);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-30, -6, 13, 6, -0.5, 0, Math.PI * 2);
    ctx.ellipse(30, -6, 13, 6, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const spacing = s / 2;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const cx = col * spacing + (row % 2 ? spacing / 2 : 0) + spacing / 2;
      const cy = row * spacing + spacing / 2;
      draw(cx, cy, 0.85, 0.16);
      draw(cx + spacing / 2, cy + spacing / 2, 0.45, 0.1);
    }
  }
  return finish(canvas, 3, 2, 8);
}

/* ------------------------------------------------------------------ */
/* Wood, leather, plaster, rug                                          */
/* ------------------------------------------------------------------ */

/** A flat wood colour with a grain, for furniture that is not the floor. */
export function woodTexture(light, dark, size) {
  const s = size || 512;
  const canvas = makeCanvas(s, s);
  const ctx = canvas.getContext('2d');
  const random = rng(9137);

  ctx.fillStyle = light;
  ctx.fillRect(0, 0, s, s);
  for (let g = 0; g < 60; g++) {
    const y = random() * s;
    ctx.strokeStyle = dark.replace('ALPHA', (0.05 + random() * 0.16).toFixed(3));
    ctx.lineWidth = 1 + random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= s; x += 40) {
      ctx.lineTo(x, y + Math.sin((x / s) * Math.PI * 3 + g) * (2 + random() * 5));
    }
    ctx.stroke();
  }
  return finish(canvas, 1, 1, 8);
}

/** The leather inlay in the middle of the card table. */
export function leatherTexture(size) {
  const s = size || 512;
  const canvas = makeCanvas(s, s);
  const ctx = canvas.getContext('2d');
  const random = rng(551);

  ctx.fillStyle = '#5c1f22';
  ctx.fillRect(0, 0, s, s);
  // The grain of the leather: thousands of tiny marks.
  for (let i = 0; i < 9000; i++) {
    const x = random() * s;
    const y = random() * s;
    const r = 0.6 + random() * 1.8;
    ctx.fillStyle = random() > 0.5
      ? 'rgba(120, 44, 46, ' + (0.1 + random() * 0.25) + ')'
      : 'rgba(48, 14, 16, ' + (0.1 + random() * 0.3) + ')';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // A worn ring, where the cards and the glasses have been for years.
  const ring = ctx.createRadialGradient(s / 2, s / 2, s * 0.12, s / 2, s / 2, s * 0.5);
  ring.addColorStop(0, 'rgba(140, 60, 58, 0.12)');
  ring.addColorStop(1, 'rgba(30, 8, 10, 0.35)');
  ctx.fillStyle = ring;
  ctx.fillRect(0, 0, s, s);
  return finish(canvas, 1, 1, 8);
}

/** The ceiling: old plaster, with a stain or two. */
export function plasterTexture(size) {
  const s = size || 512;
  const canvas = makeCanvas(s, s);
  const ctx = canvas.getContext('2d');
  const random = rng(77);

  ctx.fillStyle = '#2a2a2c';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 2600; i++) {
    const x = random() * s;
    const y = random() * s;
    const r = 4 + random() * 26;
    ctx.fillStyle = 'rgba(' + (40 + random() * 24) + ',' + (38 + random() * 22) + ',' + (34 + random() * 20) + ', 0.12)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(canvas, 4, 4, 4);
}

/** The rug under the table: a deep red with a patterned border. */
export function rugTexture(size) {
  const s = size || 1024;
  const canvas = makeCanvas(s, s);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#3a1c22';
  ctx.fillRect(0, 0, s, s);

  // The border bands.
  const bands = [
    [0.06, '#7d2f2a'], [0.09, '#c9963f'], [0.115, '#3a1c22'], [0.145, '#c9963f']
  ];
  bands.forEach(function (band) {
    const inset = band[0] * s;
    ctx.strokeStyle = band[1];
    ctx.lineWidth = s * 0.018;
    ctx.strokeRect(inset, inset, s - inset * 2, s - inset * 2);
  });

  // A repeating diamond in the middle.
  ctx.strokeStyle = 'rgba(201, 150, 63, 0.5)';
  ctx.lineWidth = 3;
  const step = s / 8;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const cx = x * step + step / 2;
      const cy = y * step + step / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - step * 0.3);
      ctx.lineTo(cx + step * 0.3, cy);
      ctx.lineTo(cx, cy + step * 0.3);
      ctx.lineTo(cx - step * 0.3, cy);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // The pile: a soft noise over everything.
  const random = rng(1234);
  for (let i = 0; i < 6000; i++) {
    const x = random() * s;
    const y = random() * s;
    ctx.fillStyle = 'rgba(0,0,0,' + (random() * 0.08) + ')';
    ctx.fillRect(x, y, 2, 2);
  }
  return finish(canvas, 1, 1, 8);
}

/* ------------------------------------------------------------------ */
/* The pictures                                                        */
/* ------------------------------------------------------------------ */

/** A framed picture: a moody painted scene, in a heavy gilt frame. */
export function pictureTexture(kind) {
  const s = 512;
  const canvas = makeCanvas(s, s);
  const ctx = canvas.getContext('2d');
  const random = rng(kind === 'phoenix' ? 31 : kind === 'table' ? 47 : 59);

  if (kind === 'phoenix') {
    // A firebird over a dark hill.
    const sky = ctx.createLinearGradient(0, 0, 0, s);
    sky.addColorStop(0, '#2a1608');
    sky.addColorStop(0.6, '#6b2d10');
    sky.addColorStop(1, '#1b0d06');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#0d0805';
    ctx.beginPath();
    ctx.moveTo(0, s);
    ctx.quadraticCurveTo(s * 0.3, s * 0.62, s * 0.62, s * 0.78);
    ctx.quadraticCurveTo(s * 0.85, s * 0.9, s, s * 0.72);
    ctx.lineTo(s, s);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 176, 64, 0.9)';
    for (let i = 0; i < 40; i++) {
      const x = s * (0.32 + random() * 0.36);
      const y = s * (0.2 + random() * 0.4);
      ctx.beginPath();
      ctx.arc(x, y, 2 + random() * 7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'table') {
    // A card table in an empty room.
    ctx.fillStyle = '#1a1a20';
    ctx.fillRect(0, 0, s, s);
    const glow = ctx.createRadialGradient(s / 2, s * 0.42, 10, s / 2, s * 0.42, s * 0.6);
    glow.addColorStop(0, 'rgba(255, 198, 110, 0.5)');
    glow.addColorStop(1, 'rgba(255, 198, 110, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#2f5c4c';
    ctx.beginPath();
    ctx.ellipse(s / 2, s * 0.62, s * 0.3, s * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d8c9a8';
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(s * (0.38 + i * 0.02), s * (0.52 - i * 0.01), s * 0.035, s * 0.05);
    }
  } else {
    // A curtain: folds of red velvet.
    ctx.fillStyle = '#3a1220';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 14; i++) {
      const x = (i / 14) * s;
      const fold = ctx.createLinearGradient(x, 0, x + s / 14, 0);
      fold.addColorStop(0, 'rgba(0,0,0,0.45)');
      fold.addColorStop(0.5, 'rgba(150, 40, 60, 0.45)');
      fold.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = fold;
      ctx.fillRect(x, 0, s / 14, s);
    }
  }

  // The glass over the picture, and the dust on it.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fillRect(0, 0, s, s);
  return finish(canvas, 1, 1, 4);
}

/** The night sky seen through the window. */
export function nightSkyTexture(size) {
  const s = size || 512;
  const canvas = makeCanvas(s, s);
  const ctx = canvas.getContext('2d');
  const random = rng(909);

  const sky = ctx.createLinearGradient(0, 0, 0, s);
  sky.addColorStop(0, '#0a1424');
  sky.addColorStop(0.65, '#16283f');
  sky.addColorStop(1, '#243b52');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, s, s);

  // The moon.
  const moon = ctx.createRadialGradient(s * 0.68, s * 0.24, 4, s * 0.68, s * 0.24, s * 0.16);
  moon.addColorStop(0, 'rgba(226, 236, 255, 0.95)');
  moon.addColorStop(0.25, 'rgba(190, 210, 245, 0.35)');
  moon.addColorStop(1, 'rgba(190, 210, 245, 0)');
  ctx.fillStyle = moon;
  ctx.fillRect(0, 0, s, s);

  // The stars.
  for (let i = 0; i < 220; i++) {
    const x = random() * s;
    const y = random() * s * 0.75;
    const a = 0.2 + random() * 0.7;
    ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')';
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  // The rooftops.
  ctx.fillStyle = '#0a0f18';
  let x = 0;
  while (x < s) {
    const w = 30 + random() * 60;
    const h = 40 + random() * 90;
    ctx.fillRect(x, s - h, w, h);
    x += w + 4;
  }
  return finish(canvas, 1, 1, 4);
}

/* ------------------------------------------------------------------ */
/* The MIMIC warning poster                                            */
/* ------------------------------------------------------------------ */

/**
 * The warning poster.
 *
 * "WATCH OUT FOR THE MIMIC" over "NOT EVERY CARD IS WHAT IT SEEMS.", with
 * the card's own artwork - the mask - painted in the middle.
 */
export function mimicPosterTexture(cardGlyph) {
  const w = 512;
  const h = 720;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const random = rng(1717);

  // The paper, aged.
  const paper = ctx.createLinearGradient(0, 0, 0, h);
  paper.addColorStop(0, '#e7d9b8');
  paper.addColorStop(1, '#cdb98d');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = 'rgba(120, 90, 40, ' + (random() * 0.07) + ')';
    ctx.beginPath();
    ctx.arc(random() * w, random() * h, random() * 22, 0, Math.PI * 2);
    ctx.fill();
  }

  // The border.
  ctx.strokeStyle = '#8d2f2a';
  ctx.lineWidth = 10;
  ctx.strokeRect(22, 22, w - 44, h - 44);
  ctx.lineWidth = 3;
  ctx.strokeRect(38, 38, w - 76, h - 76);

  // The artwork: the mask, in the middle.
  const cx = w / 2;
  const cy = h * 0.42;
  const r = w * 0.28;
  ctx.save();
  ctx.translate(cx, cy);
  const face = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  face.addColorStop(0, '#f3e6cd');
  face.addColorStop(1, '#b9a480');
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.78, r, 0, 0, Math.PI * 2);
  ctx.fill();
  // The eyes.
  ctx.fillStyle = '#20161a';
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.15, r * 0.14, r * 0.2, 0.2, 0, Math.PI * 2);
  ctx.ellipse(r * 0.3, -r * 0.15, r * 0.14, r * 0.2, -0.2, 0, Math.PI * 2);
  ctx.fill();
  // The grin.
  ctx.strokeStyle = '#20161a';
  ctx.lineWidth = r * 0.09;
  ctx.beginPath();
  ctx.arc(0, r * 0.18, r * 0.42, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
  // The little horns.
  ctx.fillStyle = '#8d2f2a';
  ctx.beginPath();
  ctx.moveTo(-r * 0.5, -r * 0.75); ctx.lineTo(-r * 0.72, -r * 1.2); ctx.lineTo(-r * 0.2, -r * 0.92);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(r * 0.5, -r * 0.75); ctx.lineTo(r * 0.72, -r * 1.2); ctx.lineTo(r * 0.2, -r * 0.92);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // The headline.
  ctx.fillStyle = '#8d2f2a';
  ctx.textAlign = 'center';
  ctx.font = 'bold 54px system-ui, sans-serif';
  ctx.fillText('WATCH OUT FOR', w / 2, h * 0.76);
  ctx.fillText('THE MIMIC', w / 2, h * 0.84);
  ctx.fillStyle = '#3a2a16';
  ctx.font = 'bold 25px system-ui, sans-serif';
  ctx.fillText('NOT EVERY CARD IS WHAT IT SEEMS.', w / 2, h * 0.92);
  ctx.font = '19px system-ui, sans-serif';
  ctx.fillStyle = '#5a4a30';
  ctx.fillText('PHOENIX ENTERTAINMENT', w / 2, h * 0.055);

  return finish(canvas, 1, 1, 8);
}

/* ------------------------------------------------------------------ */
/* The developer's notepad                                              */
/* ------------------------------------------------------------------ */

/**
 * The notepad on the sideboard.
 *
 * The joke is the joke: it is a prop in a game, and it introduces no
 * payments and no advertisements anywhere.
 */
export function notepadTexture() {
  const w = 512;
  const h = 640;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const random = rng(2929);

  ctx.fillStyle = '#f2ecd8';
  ctx.fillRect(0, 0, w, h);
  // The ruled lines.
  ctx.strokeStyle = 'rgba(120, 140, 170, 0.5)';
  ctx.lineWidth = 1.6;
  for (let y = 120; y < h - 40; y += 40) {
    ctx.beginPath();
    ctx.moveTo(34, y);
    ctx.lineTo(w - 34, y);
    ctx.stroke();
  }
  // The red margin.
  ctx.strokeStyle = 'rgba(190, 60, 60, 0.5)';
  ctx.beginPath();
  ctx.moveTo(78, 0);
  ctx.lineTo(78, h);
  ctx.stroke();

  ctx.fillStyle = '#1d2733';
  ctx.textAlign = 'left';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillText('PHOENIX ENTERTAINMENT', 40, 70);
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText('DEVELOPER TO-DO LIST', 40, 104);

  const items = [
    'Make the game £20 to play.',
    'Add adverts every 5 minutes.',
    'Reject all player complaints.',
    'Give employees a £0 pay rise.'
  ];
  ctx.font = '25px system-ui, sans-serif';
  items.forEach(function (line, index) {
    const y = 170 + index * 42;
    // A ticked box, because of course they are all ticked.
    ctx.strokeStyle = '#1d2733';
    ctx.lineWidth = 2.4;
    ctx.strokeRect(40, y - 22, 20, 20);
    ctx.beginPath();
    ctx.moveTo(43, y - 12);
    ctx.lineTo(49, y - 5);
    ctx.lineTo(59, y - 22);
    ctx.stroke();
    ctx.fillStyle = '#1d2733';
    ctx.fillText(line, 78, y);
  });

  // A coffee ring, and a scribble in the margin.
  ctx.strokeStyle = 'rgba(120, 80, 40, 0.35)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(w - 110, h - 110, 44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(40, 50, 70, 0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const x = 30 + i * 9;
    const y = 560 + Math.sin(i) * 12;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = 'rgba(180, 160, 110, ' + (random() * 0.05) + ')';
    ctx.fillRect(random() * w, random() * h, 2, 2);
  }
  return finish(canvas, 1, 1, 8);
}

/* ------------------------------------------------------------------ */
/* The phone screen                                                    */
/* ------------------------------------------------------------------ */

/**
 * The PHOENIX Bank screen.
 *
 * A fictional game balance. It is drawn on a canvas and re-drawn whenever
 * the balance changes, so it can be a live screen rather than a picture.
 */
export function createBankScreen() {
  const w = 512;
  const h = 288;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  let balance = 0;
  let notice = null;
  let noticeUntil = 0;
  let last = 0;
  // What the game wants the player to know, and the video that is playing.
  let objective = null;
  let playing = null;
  // Who this screen belongs to: the room, the seat, the round, the name.
  let context = { room: '', seat: 0, round: 0, rounds: 0, name: '' };
  // The result of the match, once there is one.
  let result = null;

  /** The masthead: the same words the menu has in its top left corner. */
  function drawMasthead() {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(240, 196, 106, 0.92)';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText('THE CARD GAME', 22, 26);
    ctx.fillStyle = '#f6f0dc';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.fillText('PHOENIX', 22, 60);
    ctx.fillStyle = 'rgba(215, 240, 228, 0.55)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('RISE · PLAY · SURVIVE', 24, 78);
    if (context.room) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f0c46a';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText('ROOM ' + context.room, w - 22, 26);
    }
    if (context.name) {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(215, 240, 228, 0.75)';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(context.name, w - 22, 48);
    }
    if (context.round) {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(215, 240, 228, 0.55)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('ROUND ' + context.round + (context.rounds ? ' / ' + context.rounds : ''), w - 22, 66);
    }
  }

  /** The result of the match: who won, and the table as it ended. */
  function drawResult() {
    ctx.textAlign = 'center';
    const won = result.won;
    ctx.fillStyle = won ? '#ffd16b' : '#9fb0c9';
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.fillText(won ? 'VICTORY' : 'DEFEAT', w / 2, 148);
    ctx.fillStyle = 'rgba(240, 236, 220, 0.85)';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText(result.winner ? result.winner + ' wins' : 'The match is over', w / 2, 176);

    // The table as it ended.
    ctx.textAlign = 'left';
    let y = 208;
    (result.standings || []).slice(0, 4).forEach(function (row) {
      ctx.fillStyle = row.me ? '#ffd16b' : 'rgba(240, 236, 220, 0.8)';
      ctx.font = (row.me ? 'bold ' : '') + '15px system-ui, sans-serif';
      ctx.fillText(row.name + (row.me ? '  (you)' : ''), 30, y);
      ctx.textAlign = 'right';
      ctx.fillText(String(row.points), w - 30, y);
      ctx.textAlign = 'left';
      y += 19;
    });
  }

  function draw(now) {
    if (now < noticeUntil && notice && !result) {
      // The notification band.
      const up = notice.delta >= 0;
      const band = ctx.createLinearGradient(0, 0, 0, 74);
      band.addColorStop(0, up ? 'rgba(30, 120, 80, 0.95)' : 'rgba(150, 40, 40, 0.95)');
      band.addColorStop(1, 'rgba(12, 26, 24, 0.95)');
      ctx.fillStyle = band;
      ctx.fillRect(0, 0, w, 74);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.fillText((up ? '+' : '') + notice.delta.toLocaleString('en-GB'), 26, 48);
      ctx.font = '19px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(notice.label, 26, 70);
    }

    // The background: a lit screen, so it reads as a screen from across
    // the table and not as a black slab.
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#3d8874');
    bg.addColorStop(1, '#1d5548');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (result) {
      drawMasthead();
      ctx.fillStyle = 'rgba(8, 22, 20, 0.55)';
      ctx.fillRect(0, 80, w, h - 80);
      drawResult();
      texture.needsUpdate = true;
      return;
    }

    drawMasthead();

    // The balance.
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f6f0dc';
    ctx.font = 'bold 58px system-ui, sans-serif';
    ctx.fillText(balance.toLocaleString('en-GB'), w - 26, 142);
    ctx.fillStyle = 'rgba(215, 240, 228, 0.75)';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('PHOENIX POINTS', w - 26, 162);

    // The objective, when the game has set one.
    if (objective) {
      ctx.fillStyle = 'rgba(201, 150, 63, 0.92)';
      ctx.fillRect(0, 84, w, 34);
      ctx.fillStyle = '#1a1206';
      ctx.font = 'bold 19px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(objective.slice(0, 42), 16, 107);
    }

    // The video that is playing, if there is one.
    if (playing) {
      ctx.fillStyle = 'rgba(6, 12, 16, 0.96)';
      ctx.fillRect(0, 84, w, 92);
      // The picture of the video, which is YouTube's own thumbnail.
      if (playing.thumbnail) {
        try { ctx.drawImage(playing.thumbnail, 10, 90, 120, 68); } catch (error) { /* not ready */ }
      }
      ctx.fillStyle = '#f6f0dc';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('NOW PLAYING', 140, 122);
      ctx.fillStyle = 'rgba(240, 234, 220, 0.75)';
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('on this laptop', 140, 146);
    }

    // The LEAVE MATCH button, always on the screen.
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(190, 60, 50, 0.92)';
    ctx.beginPath();
    ctx.roundRect(26, 196, 210, 62, 12);
    ctx.fill();
    ctx.fillStyle = '#fff4ef';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText('LEAVE MATCH', 56, 236);

    // A little bar chart of the round's swings, so the screen is alive.
    ctx.strokeStyle = 'rgba(201, 150, 63, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const x = 250 + i * 24;
      const y = 240 - Math.abs(Math.sin(i * 1.7 + balance * 0.001)) * 46;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    texture.needsUpdate = true;
  }

  // The screen is painted straight away, so a phone is never a blank slab
  // before the first balance arrives.
  draw(performance.now());

  return {
    texture: texture,
    canvas: canvas,
    /** Set the balance, and say what changed. */
    set: function (value, label) {
      const delta = Math.round(value - balance);
      balance = Math.round(value);
      if (delta !== 0 && label) {
        notice = { delta: delta, label: label };
        noticeUntil = performance.now() + 2600;
      }
      draw(performance.now());
      return delta;
    },
    /** Called every frame, so the notification fades on its own. */
    tick: function () {
      const now = performance.now();
      if (notice && now >= noticeUntil) notice = null;
      if (now - last > 100) {
        last = now;
        draw(now);
      }
    },
    /** Put a line of the game's own across the screen. */
    setObjective: function (text) {
      objective = text || null;
      draw(performance.now());
    },
    clearObjective: function () {
      objective = null;
      draw(performance.now());
    },
    /** Show that a video is playing on this screen. */
    setPlaying: function (videoId) {
      playing = { id: videoId, thumbnail: null };
      // The picture of the video, which is YouTube's own.
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = function () {
        playing.thumbnail = image;
        draw(performance.now());
      };
      image.src = 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
      draw(performance.now());
    },
    clearPlaying: function () {
      playing = null;
      draw(performance.now());
    },
    /**
     * Who this screen belongs to.
     *
     * The room, the seat, the round and the name of the person sitting in
     * front of it - so the screen says whose it is.
     */
    setContext: function (next) {
      context = Object.assign({ room: '', seat: 0, round: 0, rounds: 0, name: '' }, context, next || {});
      draw(performance.now());
    },
    /** The match is over: show the result instead of the balance. */
    setResult: function (next) {
      result = next || null;
      draw(performance.now());
    },
    clearResult: function () {
      result = null;
      draw(performance.now());
    },
    get balance() { return balance; },
    get result() { return result; }
  };
}
