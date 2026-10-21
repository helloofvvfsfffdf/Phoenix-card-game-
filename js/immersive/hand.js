/* PHOENIX - the first-person hand.
 *
 * The player's own arms and hands, held up in front of them, and the fan of
 * cards they are holding. The fan holds up to SEVEN cards, which is the
 * game's own hand limit, and every card face is drawn on a canvas so the
 * player can actually read what they are holding.
 *
 * A card is picked with a click or a tap, it lifts a little, and a second
 * click plays it: it lifts off the fan, travels to the middle of the table
 * and lands there. Opponents never see a face - their hands hold backs.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';
import { roundedBox, turned } from './geometry.js';

export const MAX_HAND = 7;

/** The accent colour of each card tone, matching the 2D cards. */
const TONES = {
  gold: '#f7c948', steel: '#8fb8ff', green: '#3ddc97', toxic: '#a8e05f',
  violet: '#c08bff', judge: '#f7c948', reveal: '#8fb8ff', skip: '#ff7a2f',
  phoenix: '#ffd76b', trick: '#c08bff', stealturn: '#8fb8ff', curse: '#c08bff',
  ghost: '#d5f1ff', alvin: '#ffac70', dice: '#f7c948', rps: '#ff6b6b',
  betrayal: '#c08bff', speed: '#00d4ff', wheel: '#ff9500', linkedfate: '#3ddc97',
  impostor: '#c08bff', swapper: '#ff4081', misfortune: '#ff4081',
  musical: '#7ec8e3', roulette: '#e74c3c', memory: '#c08bff', bank: '#f7c948',
  pointswap: '#66d9e8', hostage: '#e74c3c', president: '#f7c948', survey: '#f7c948',
  trailer: '#ff4081', mimic: '#c08bff', dehydrated: '#5dade2', nothing: '#95a5a6',
  doom: '#c08bff', support: '#f5b041'
};

// The size of a card on screen. A real card is about six by nine centimetres;
// this one is drawn a little larger than life, so its text is readable from
// a normal seat without the hand filling the whole screen.
const CARD_WIDTH = 0.17;
const CARD_HEIGHT = 0.24;

/**
 * A card face, drawn on a canvas.
 *
 * The face is the card's own name, its glyph and its line of text, in the
 * same colours as the 2D card, so a player who knows the game reads it the
 * same way in 3D.
 */
export function cardFaceTexture(card) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 544;
  const ctx = canvas.getContext('2d');
  const accent = TONES[card.tone] || '#f7c948';

  // The paper.
  const paper = ctx.createLinearGradient(0, 0, 0, canvas.height);
  paper.addColorStop(0, '#fdf6e6');
  paper.addColorStop(1, '#eadfc6');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // The border and the wash.
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = accent;
  ctx.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.globalAlpha = 1;

  // The glyph, big and quiet, behind the text.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = accent;
  ctx.font = 'bold 190px system-ui, sans-serif';
  ctx.fillText(card.glyph || '?', canvas.width / 2, canvas.height * 0.36);
  ctx.globalAlpha = 1;

  // The name, wrapped.
  ctx.fillStyle = '#1d1a15';
  ctx.font = 'bold 40px system-ui, sans-serif';
  const words = String(card.name || '').split(' ');
  const lines = [];
  let line = '';
  words.forEach(function (word) {
    const next = line ? line + ' ' + word : word;
    if (ctx.measureText(next).width > canvas.width - 74 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  const startY = canvas.height * 0.63 - (lines.length - 1) * 24;
  lines.slice(0, 3).forEach(function (text, index) {
    ctx.fillText(text, canvas.width / 2, startY + index * 48);
  });

  // The rule, in the accent, along the bottom.
  ctx.fillStyle = '#3b352b';
  ctx.font = '22px system-ui, sans-serif';
  const rule = String(card.rule || card.blurb || '');
  const ruleWords = rule.split(' ');
  const ruleLines = [];
  let ruleLine = '';
  ruleWords.forEach(function (word) {
    const next = ruleLine ? ruleLine + ' ' + word : word;
    if (ctx.measureText(next).width > canvas.width - 70 && ruleLine) {
      ruleLines.push(ruleLine);
      ruleLine = word;
    } else {
      ruleLine = next;
    }
  });
  if (ruleLine) ruleLines.push(ruleLine);
  ctx.fillStyle = '#4a4335';
  ctx.font = '20px system-ui, sans-serif';
  ruleLines.slice(0, 3).forEach(function (text, index) {
    ctx.fillText(text, canvas.width / 2, canvas.height - 92 + index * 24);
  });

  // The needs-a-target tag, exactly as the 2D card has it.
  if (card.needsTarget) {
    ctx.fillStyle = '#6a6152';
    ctx.font = 'bold 17px system-ui, sans-serif';
    ctx.fillText('NEEDS A TARGET', canvas.width / 2, canvas.height - 26);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** The back of a card: the pattern the opponents see. */
export function cardBackTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 358;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#22355c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#d6b45a';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#4a6ba8';
  ctx.lineWidth = 2;
  for (let i = -6; i < 14; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 24, 0);
    ctx.lineTo(i * 24 + 358, 358);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d6b45a';
  ctx.font = 'bold 92px system-ui, sans-serif';
  ctx.fillText('P', canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The player's own hands: two arms coming up into the frame from below, with
 * the cards held in them.
 */
export function createHand(camera, options) {
  const settings = Object.assign({ skin: 0xd9a173, sleeve: 0x35506e }, options || {});
  const skin = new THREE.MeshStandardMaterial({ color: settings.skin, roughness: 0.74 });
  const sleeve = new THREE.MeshStandardMaterial({ color: settings.sleeve, roughness: 0.92 });

  const group = new THREE.Group();
  // The hands live in the camera's space, so they follow the view exactly.
  camera.add(group);

  // An arm: a sleeve to the elbow, a bare forearm, and a hand with fingers.
  const arm = function (side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.33, -0.42, -0.5);
    pivot.rotation.set(-0.52, side * 0.2, side * 0.14);
    group.add(pivot);

    const upper = new THREE.Mesh(
      turned([[0, 0], [0.075, 0], [0.08, 0.06], [0.07, 0.2], [0.058, 0.28], [0, 0.29]], 10),
      sleeve
    );
    upper.rotation.x = Math.PI;
    upper.position.set(0, 0, 0.06);
    pivot.add(upper);

    const fore = new THREE.Mesh(
      turned([[0, 0], [0.055, 0], [0.058, 0.05], [0.045, 0.18], [0.038, 0.24], [0, 0.25]], 10),
      skin
    );
    fore.rotation.x = Math.PI;
    fore.position.set(0, -0.28, 0.14);
    pivot.add(fore);

    // The hand: a palm and five fingers, curled round the cards.
    const hand = new THREE.Group();
    hand.position.set(0, -0.52, 0.2);
    hand.rotation.set(0.2, 0, side * 0.16);
    pivot.add(hand);
    const palm = new THREE.Mesh(roundedBox(0.075, 0.026, 0.085, 0.02, 0.006), skin);
    hand.add(palm);
    for (let f = 0; f < 4; f++) {
      const finger = new THREE.Mesh(
        turned([[0, 0], [0.009, 0], [0.009, 0.035], [0.007, 0.055], [0, 0.06]], 8),
        skin
      );
      finger.position.set(-0.026 + f * 0.017, -0.004, 0.036);
      finger.rotation.x = 1.15;
      hand.add(finger);
    }
    const thumb = new THREE.Mesh(
      turned([[0, 0], [0.011, 0], [0.01, 0.03], [0, 0.04]], 8),
      skin
    );
    thumb.position.set(-side * 0.036, 0, 0.006);
    thumb.rotation.set(0.4, 0, side * 0.7);
    hand.add(thumb);

    return { pivot: pivot, hand: hand, fingers: hand.children };
  };

  const left = arm(-1);
  const right = arm(1);

  return { group: group, left: left, right: right };
}

/**
 * The fan of cards in front of the player.
 *
 * The cards are laid out in an arc, the way a hand is actually held, and the
 * selected one lifts out of the fan and turns to face the player.
 */
export function createFan(camera, options) {
  const settings = Object.assign({ skin: 0xd9a173 }, options || {});
  const group = new THREE.Group();
  camera.add(group);

  const fan = {
    group: group,
    cards: [],
    selected: -1,
    faceTextures: {},
    backTexture: cardBackTexture(),
    cardWidth: CARD_WIDTH,
    cardHeight: CARD_HEIGHT
  };

  const materialFor = function (card, face) {
    const texture = face ? cardFaceTexture(card) : fan.backTexture;
    return new THREE.MeshStandardMaterial({
      map: texture,
      // A little of the face is lit by the face itself, so the name and the
      // rule can be read even in a dim room. The card is still shaded - it
      // catches the lamp - but it is never lost in the dark.
      emissive: 0xffffff,
      emissiveMap: texture,
      emissiveIntensity: face ? 0.32 : 0.12,
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.DoubleSide
    });
  };

  /**
   * Set the hand. `cards` is a list of card records from the registry.
   */
  fan.set = function (cards) {
    // Remove the cards that are no longer held.
    while (fan.cards.length > cards.length) {
      const gone = fan.cards.pop();
      group.remove(gone.mesh);
      gone.mesh.geometry.dispose();
      if (gone.faceMaterial && gone.faceMaterial.map && gone.faceMaterial.map !== fan.backTexture) {
        gone.faceMaterial.map.dispose();
        gone.faceMaterial.dispose();
      } else if (gone.faceMaterial) {
        gone.faceMaterial.dispose();
      }
    }
    // Add or update the rest.
    cards.forEach(function (card, index) {
      let entry = fan.cards[index];
      if (!entry) {
        const geometry = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT);
        const faceMaterial = materialFor(card, true);
        const mesh = new THREE.Mesh(geometry, faceMaterial);
        mesh.castShadow = false;
        const holder = new THREE.Group();
        holder.add(mesh);
        group.add(holder);
        entry = { mesh: mesh, holder: holder, faceMaterial: faceMaterial, card: card };
        fan.cards[index] = entry;
      } else if (entry.card.id !== card.id) {
        // A different card in this slot: the face is redrawn.
        if (entry.faceMaterial.map) entry.faceMaterial.map.dispose();
        entry.faceMaterial.map = cardFaceTexture(card);
        entry.faceMaterial.needsUpdate = true;
        entry.card = card;
      }
    });
    fan.layout(0);
  };

  /**
   * Where every card sits. The fan is an arc, and the selected card comes
   * forward and up.
   */
  fan.layout = function (time) {
    const count = fan.cards.length;
    fan.cards.forEach(function (entry, index) {
      const spread = Math.min(0.045, 0.30 / Math.max(1, count));
      const centre = (count - 1) / 2;
      const offset = index - centre;
      const selected = index === fan.selected;
      const lift = selected ? 0.07 : 0;
      const sway = time ? Math.sin(time * 1.2 + index * 0.4) * 0.004 : 0;

      entry.holder.position.set(
        offset * spread * 1.35,
        -0.21 + Math.abs(offset) * 0.006 + lift + sway,
        -0.62 - Math.abs(offset) * 0.008 + (selected ? 0.05 : 0)
      );
      entry.holder.rotation.set(
        -0.58 - Math.abs(offset) * 0.012 + (selected ? 0.08 : 0),
        offset * -0.08 + (selected ? 0.04 : 0),
        offset * 0.05 + (selected ? 0.015 : 0)
      );
    });
  };

  /** The card at a screen position, for picking with the mouse or a finger. */
  fan.pick = function (pointer) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const meshes = fan.cards.map(function (entry) { return entry.mesh; });
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return -1;
    return fan.cards.findIndex(function (entry) { return entry.mesh === hits[0].object; });
  };

  /** Select a card, or deselect it when it is picked again. */
  fan.toggle = function (index) {
    fan.selected = fan.selected === index ? -1 : index;
    return fan.selected;
  };

  /**
   * The card that flies to the table.
   *
   * The card is taken out of the fan and handed to the caller, which animates
   * it across the table and then puts it down.
   */
  fan.take = function (index) {
    const entry = fan.cards[index];
    if (!entry) return null;
    fan.cards.splice(index, 1);
    fan.selected = -1;
    group.remove(entry.holder);
    return entry;
  };

  /** Put a card back into the fan (used when a play is refused). */
  fan.giveBack = function (entry, index) {
    fan.cards.splice(Math.min(index, fan.cards.length), 0, entry);
    group.add(entry.holder);
  };

  fan.dispose = function () {
    fan.cards.forEach(function (entry) {
      if (entry.faceMaterial.map && entry.faceMaterial.map !== fan.backTexture) {
        entry.faceMaterial.map.dispose();
      }
      entry.mesh.geometry.dispose();
      entry.faceMaterial.dispose();
    });
    fan.backTexture.dispose();
  };

  return fan;
}
