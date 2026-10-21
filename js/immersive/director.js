/* PHOENIX - the director.
 *
 * The thing that knows what is on stage: the people, their laptops, the
 * lights and the caption at the top of the screen. It hands the cinematics a
 * plain set of instructions - stand up, walk over, turn the lights down, say
 * something - and keeps the details of how each of those is done in one
 * place.
 */
'use strict';

import * as THREE from '../../vendor/three/three.module.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createDirector(options) {
  const settings = Object.assign({
    scene: null,
    camera: null,
    cameraState: null,
    cameraPosition: null,
    headYaw: 0,
    characters: [],
    laptops: [],
    seats: 6,
    tableRadius: 1.55,
    tableHeight: 0.78,
    lights: null,
    caption: null,
    youtubeId: 'dQw4w9WgXcQ',
    onVideo: null
  }, options || {});

  const director = {
    context: {
      characters: settings.characters,
      laptops: settings.laptops,
      seats: settings.seats,
      tableRadius: settings.tableRadius,
      tableHeight: settings.tableHeight,
      scene: settings.scene,
      cameraState: settings.cameraState,
      cameraPosition: settings.cameraPosition,
      headYaw: settings.headYaw,
      cellPoint: new THREE.Vector3(2.2, 0, -4.7),
      announce: function (text, ms) { return director.announce(text, ms); },
      dim: function (level, ms) { return director.dim(level, ms); },
      showObjective: function (text, ms) { return director.showObjective(text, ms); },
      laptopAt: function (seat) { return director.laptopAt(seat); },
      playMimicVideo: function (seat, point) { return director.playMimicVideo(seat, point); }
    },

    /** The caption at the top of the screen. */
    announce: function (text, ms) {
      const node = settings.caption;
      if (!node) return wait(ms || 1200);
      node.textContent = text || '';
      node.classList.add('is-on');
      return wait(ms || 1600).then(function () {
        node.classList.remove('is-on');
      });
    },

    /**
     * The lights down and up again.
     *
     * The room's own lamps are the ones that dim, so the table goes dark with
     * everything else rather than with a separate switch.
     */
    dim: function (level, ms) {
      const lights = settings.lights;
      if (!lights) return wait(ms || 500);
      const from = lights.lamp.intensity;
      const started = performance.now();
      const duration = Math.max(120, ms || 500);
      return new Promise(function (resolve) {
        const step = function () {
          const t = Math.min(1, (performance.now() - started) / duration);
          lights.lamp.intensity = from * (1 - t) + from * level * t;
          lights.hemi.intensity = lights.hemiBase * (1 - t * 0.4) + lights.hemiBase * level * 0.4 * t;
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        step();
      });
    },

    /**
     * The objective, on every laptop at once.
     *
     * The bank is where the game talks to a player, so that is where the
     * objective goes.
     */
    showObjective: function (text, ms) {
      const screens = settings.laptops.map(function (entry) { return entry.laptop; });
      screens.forEach(function (laptop) { laptop.bank.setObjective(text); });
      return wait(ms || 4000).then(function () {
        screens.forEach(function (laptop) { laptop.bank.clearObjective(); });
      });
    },

    /** The laptop belonging to a seat, if there is one. */
    laptopAt: function (seat) {
      for (let i = 0; i < settings.laptops.length; i++) {
        if (settings.laptops[i].seat === seat) return settings.laptops[i].laptop;
      }
      return null;
    },

    /**
     * The video on the laptop screen.
     *
     * The player who was pranked gets the real thing, in the official embed,
     * put where their laptop is; everybody else sees the screen light up with
     * the picture on it. The sound is the embed's own, and the browser's rules
     * about starting a video with sound are respected: if it will not start,
     * it says so and waits to be pressed.
     */
    playMimicVideo: function (seat, point) {
      const laptop = director.laptopAt(seat);
      if (laptop) laptop.bank.setPlaying(settings.youtubeId);

      const isLocal = settings.localSeat !== undefined && settings.localSeat === seat;
      if (!isLocal) {
        // The others see the screen lit up and hear nothing they can place.
        return wait(4000).then(function () {
          if (laptop) laptop.bank.clearPlaying();
        });
      }

      // The real embed, in a frame the size of the laptop's screen.
      const frame = document.createElement('div');
      frame.className = 'immersive-embed';
      frame.innerHTML =
        '<iframe src="https://www.youtube.com/embed/' + settings.youtubeId +
        '?autoplay=1&controls=0&modestbranding=1&rel=0&playsinline=1" ' +
        'title="The video on the laptop" allow="autoplay; encrypted-media; picture-in-picture" ' +
        'allowfullscreen></iframe>' +
        '<p class="immersive-embed-note">The card was a Mimic.</p>';
      document.body.appendChild(frame);

      // Put it where the laptop is, if the laptop is on the screen.
      if (point && settings.camera) {
        const projected = point.clone().project(settings.camera);
        if (projected.z < 1) {
          frame.style.left = ((projected.x * 0.5 + 0.5) * 100) + '%';
          frame.style.top = ((-projected.y * 0.5 + 0.5) * 100) + '%';
        }
      }

      return wait(6000).then(function () {
        if (frame.parentNode) frame.parentNode.removeChild(frame);
        if (laptop) laptop.bank.clearPlaying();
      });
    }
  };

  return director;
}
