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
import { createScreenMap } from './screen-map.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The official YouTube IFrame Player API.
 *
 * The API announces itself by calling a global. Any other name and the
 * player is never created: the script loads, and nothing happens. So the
 * global is set, the script is added, and the callback is called when the
 * API says it is ready.
 */
let youtubeApi = null;
function withYouTube(callback) {
  if (window.YT && window.YT.Player) { callback(); return; }
  if (youtubeApi) { youtubeApi.push(callback); return; }
  youtubeApi = [callback];
  const previous = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = function () {
    window.onYouTubeIframeAPIReady = previous || null;
    const waiting = youtubeApi || [];
    youtubeApi = null;
    waiting.forEach(function (fn) {
      try { fn(); } catch (error) { /* the caller carries on without it */ }
    });
  };
  if (!document.getElementById('phoenix-youtube-api')) {
    const tag = document.createElement('script');
    tag.id = 'phoenix-youtube-api';
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  }
}

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

  let screenMap = null;
  let mimicPlayer = null;

  const director = {
    context: {
      characters: settings.characters,
      laptops: settings.laptops,
      seats: settings.seats,
      // The places the room says the seats are. A getter, because the room
      // arrives after the director is made.
      seatAt: settings.seatAt || function () { return null; },
      // The sights a card can have: sparks, rings, beams, numbers flying.
      effects: settings.effects || null,
      // Whether the player has asked for less movement.
      reducedMotion: !!settings.reducedMotion,
      tableRadius: settings.tableRadius,
      tableHeight: settings.tableHeight,
      scene: settings.scene,
      cameraState: settings.cameraState,
      cameraPosition: settings.cameraPosition,
      headYaw: settings.headYaw,
      // Where the cell is. The room says, so the Judge card takes its prisoner
      // to the cell this room actually has.
      cellPoint: settings.cellPoint || new THREE.Vector3(2.2, 0, -4.7),
      announce: function (text, ms) { return director.announce(text, ms); },
      dim: function (level, ms) { return director.dim(level, ms); },
      showObjective: function (text, ms) { return director.showObjective(text, ms); },
      laptopAt: function (seat) { return director.laptopAt(seat); },
      playMimicVideo: function (seat, point) { return director.playMimicVideo(seat, point); }
    },

    /** The caption at the top of the screen. */
    announce: function (text, ms) {
      const node = settings.caption;
      // With the motion turned down, the words do not linger.
      const time = settings.reducedMotion ? Math.min(ms || 1200, 900) : (ms || 1600);
      if (!node) return wait(time);
      node.textContent = text || '';
      node.classList.add('is-on');
      return wait(time).then(function () {
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
     * The player who was pranked gets the real thing, and it is really on
     * the laptop: the player is put over the screen in the room, at the
     * right angle and the right shape, so it tilts with the lid and is the
     * right size from every seat. Everybody else sees the screen light up
     * with the picture on it.
     *
     * The sound is quieter the further away the player is sitting, and the
     * browser's rules about starting a video with sound are respected: if
     * it will not start, the screen says so and the game carries on.
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

      // The frame the video lives in, and the mapping that puts it on the
      // laptop's screen.
      const frame = document.createElement('div');
      frame.className = 'immersive-screen-map';
      frame.innerHTML =
        '<div class="immersive-screen-map-frame" id="immersive-mimic-frame"></div>' +
        '<p class="immersive-screen-map-note">The card was a Mimic.</p>';
      document.body.appendChild(frame);

      const holder = frame.querySelector('#immersive-mimic-frame');
      const map = createScreenMap({
        camera: settings.camera,
        mesh: laptop ? laptop.screen : null,
        element: frame,
        width: 640,
        height: 360
      });
      screenMap = map;

      // The player is put on the laptop's screen, and the sound is turned
      // down with the distance to it.
      withYouTube(function () {
        if (!frame.parentNode) return;
        try {
          const player = new window.YT.Player('immersive-mimic-frame', {
            videoId: settings.youtubeId,
            width: 640,
            height: 360,
            playerVars: {
              autoplay: 1,
              controls: 0,
              disablekb: 1,
              fs: 0,
              rel: 0,
              modestbranding: 1,
              playsinline: 1
            },
            events: {
              onReady: function (event) {
                try { event.target.playVideo(); } catch (error) { /* the state is reported instead */ }
              }
            }
          });
          mimicPlayer = player;
        } catch (error) {
          /* no player: the screen keeps the picture and the game carries on */
        }
      });

      // Six seconds of video, and then the screen goes back to being a bank.
      return wait(6000).then(function () {
        if (mimicPlayer && typeof mimicPlayer.destroy === 'function') {
          try { mimicPlayer.destroy(); } catch (error) { /* already gone */ }
        }
        mimicPlayer = null;
        screenMap = null;
        if (frame.parentNode) frame.parentNode.removeChild(frame);
        if (laptop) laptop.bank.clearPlaying();
      });
    },

    /**
     * The video's sound, quieter the further away it is.
     *
     * The player is a page, so its sound is not in the room - but the
     * volume can still follow the distance to the laptop it is on.
     */
    update: function () {
      if (screenMap) screenMap.update();
      if (mimicPlayer && mimicPlayer.setVolume && settings.camera) {
        const laptop = director.laptopAt(settings.localSeat);
        const here = settings.camera.getWorldPosition(new THREE.Vector3());
        const there = laptop ? laptop.screenWorldPosition() : here;
        const distance = here.distanceTo(there);
        const volume = Math.max(0, Math.min(100, Math.round(100 - distance * 18)));
        try { mimicPlayer.setVolume(volume); } catch (error) { /* the player is not ready */ }
      }
    }
  };

  return director;
}
