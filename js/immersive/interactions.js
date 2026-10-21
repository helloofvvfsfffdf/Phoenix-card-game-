/* PHOENIX - the cards that ask the players a question.
 *
 * Some cards do not simply happen: they ask the people at the table
 * something, and the server waits for the answers before it decides
 * anything. Rock Paper Scissors, the wheel, the memory game, the Mimic's
 * disguise - all of them.
 *
 * The overlays for those questions already exist, and they are the same
 * ones the 2D game uses: they are tested, they are readable, and a player
 * answers a challenge the same way whichever table they are sitting at.
 * This module is the bridge: it watches the server's snapshot, opens the
 * right overlay, locks the buttons that must not be pressed twice, and
 * closes it when the server has finished.
 */
'use strict';

/** The overlay that belongs to each card that asks a question. */
const MODULES = {
  rps: 'PhoenixRpsInteractive',
  betrayal: 'PhoenixBetrayalInteractive',
  speed: 'PhoenixSpeedInteractive',
  dice: 'PhoenixDiceInteractive',
  wheel: 'PhoenixWheelInteractive',
  wheelofmisfortune: 'PhoenixWheelInteractive',
  linkedfate: 'PhoenixLinkedFateInteractive',
  impostor: 'PhoenixImpostorInteractive',
  swapper: 'PhoenixSwapperInteractive',
  musicalchairs: 'PhoenixMusicalChairsInteractive',
  russianroulette: 'PhoenixRussianRouletteInteractive',
  memorymayhem: 'PhoenixMemoryMayhemInteractive',
  mimic: 'PhoenixMimicInteractive',
  support: 'PhoenixSupportInteractive',
  joshuasurvey: 'PhoenixJoshuaSurveyInteractive',
  trailer: 'PhoenixTrailerInteractive',
  enjoyingthetrailer: 'PhoenixTrailerInteractive'
};

/** The cards where a player may answer more than once. */
const REPEATED = ['musicalchairs', 'russianroulette', 'memorymayhem', 'joshuasurvey'];

/**
 * The bridge.
 *
 * `options`:
 *   root      the document or element to look in
 *   onNotice  (message) - something worth saying out loud
 */
export function createInteractionBridge(options) {
  const settings = Object.assign({ root: document, onNotice: null }, options || {});

  let open = null;
  let openType = null;
  let lastResult = null;

  function notice(message) {
    if (settings.onNotice) settings.onNotice(message);
  }

  function moduleFor(type) {
    const name = MODULES[type];
    if (!name) return null;
    return window[name] || null;
  }

  /** Close whatever is open. */
  function close() {
    if (open && typeof open.close === 'function') {
      try { open.close(); } catch (error) { /* closing anyway */ }
    }
    open = null;
    openType = null;
    settings.root.querySelectorAll('.interactive-overlay button, .interactive-overlay input')
      .forEach(function (element) {
        element.disabled = false;
        element.hidden = false;
      });
  }

  /**
   * A new snapshot.
   *
   * The server's pending interaction is the only thing that decides whether
   * an overlay is open: if the server is waiting for an answer, it is
   * waiting for an answer, and if it is not, nothing is open.
   */
  function onState(state) {
    const pending = state && state.pendingInteraction;

    if (!pending) {
      // The interaction is over. The result is shown once, then the overlay
      // is put away.
      if (open) {
        const result = state.lastInteractionResult;
        if (result && result.createdAt !== lastResult) {
          lastResult = result.createdAt;
          notice('The challenge is over.');
        }
        close();
      }
      return;
    }

    if (pending.type !== openType) {
      close();
      const module = moduleFor(pending.type);
      if (!module) return;
      open = module;
      openType = pending.type;
      if (typeof open.build === 'function') open.build(pending.type);
    }

    if (open && typeof open.onState === 'function') {
      try { open.onState(state); } catch (error) { /* the overlay keeps its own state */ }
    }

    // Who may answer, and who has already answered.
    const me = state.players && state.players[state.seat] ? state.players[state.seat].id : null;
    const casterOnly = pending.type === 'wheel' || pending.type === 'wheelofmisfortune';
    const eligible = (pending.participants || []).includes(me) &&
      (!casterOnly || pending.actorId === me);
    const answered = REPEATED.includes(pending.type) ? false : (pending.submitted || []).includes(me);

    settings.root.querySelectorAll('.interactive-overlay button, .interactive-overlay input')
      .forEach(function (element) {
        element.disabled = !eligible || answered;
        if (!eligible) element.hidden = true;
      });
  }

  return {
    onState: onState,
    close: close,
    /** The card that is asking a question right now, if any. */
    pendingType: function () { return openType; }
  };
}
