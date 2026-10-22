/* PHOENIX — server-side achievement tracking for secret badges.
 *
 * Tracks game events during real multiplayer matches and grants badges
 * automatically when conditions are met. All checks run on the server using
 * verified game events, never untrusted client claims.
 *
 * Single-match badges are granted immediately when the condition is met.
 * Multi-match badges persist progress across sessions via Supabase.
 */
'use strict';

const Auth = require('./auth');
const Badges = require('./badges');
const Rules = require('./rules');
const CARD_ACHIEVEMENTS = require('./achievement-catalog');

const SECRET_BADGE_KEYS = [
  'lucky-six', 'mind-reader', 'backstabber', 'lightning-reflexes',
  'jackpot', 'partners-in-crime', 'master-of-disguise', 'identity-crisis'
].concat(CARD_ACHIEVEMENTS.map(a => a.key));

const CARD_ACHIEVEMENT_CATALOG = CARD_ACHIEVEMENTS;

// Progress targets for multi-match achievements
const PROGRESS_TARGETS = {
  'mind-reader': 3,        // 3 RPS wins
  'backstabber': 20000,    // 20,000 points stolen
  'partners-in-crime': 10000, // 10,000 bonus points received
  'identity-crisis': 3     // 3 ally swaps
};

function logError(op, error) {
  Auth.describeError && console.error('[PHOENIX achievements] ' + op + ' -> ' + Auth.describeError(error));
}

function isAvailable() {
  return Auth.isConfigured();
}

// ---- Achievement progress persistence ----

async function getProgress(accountId, achievementKey) {
  if (!isAvailable() || !accountId) return 0;
  try {
    const { data, error } = await Auth.client()
      .from('account_achievement_progress')
      .select('progress, completed')
      .eq('account_id', accountId)
      .eq('achievement_key', achievementKey)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return 0; // no row yet
      logError('getProgress failed', error);
      return 0;
    }
    if (data && data.completed) return PROGRESS_TARGETS[achievementKey] || 1;
    return (data && data.progress) || 0;
  } catch (err) {
    logError('getProgress error', err);
    return 0;
  }
}

async function updateProgress(accountId, achievementKey, increment) {
  if (!isAvailable() || !accountId) return { completed: false, progress: 0 };
  const target = PROGRESS_TARGETS[achievementKey];
  if (!target) return { completed: false, progress: 0 };

  try {
    // Get current progress
    const current = await getProgress(accountId, achievementKey);
    if (current >= target) return { completed: true, progress: target };

    const newProgress = Math.min(current + increment, target);
    const completed = newProgress >= target;

    // Upsert progress
    const { error } = await Auth.client()
      .from('account_achievement_progress')
      .upsert({
        account_id: accountId,
        achievement_key: achievementKey,
        progress: newProgress,
        target: target,
        completed: completed,
        updated_at: new Date().toISOString()
      }, { onConflict: 'account_id,achievement_key' });

    if (error) {
      logError('updateProgress failed', error);
      return { completed: false, progress: current };
    }

    return { completed, progress: newProgress };
  } catch (err) {
    logError('updateProgress error', err);
    return { completed: false, progress: 0 };
  }
}

// ---- Badge granting with notification ----

async function grantBadge(account, badgeKey, notifyWs) {
  if (!isAvailable() || !account || !account.id) return false;
  if (SECRET_BADGE_KEYS.indexOf(badgeKey) === -1 && badgeKey !== 'champion') return false;

  try {
    const result = await Badges.grant(account, badgeKey);
    if (result && result.ok && !result.alreadyHeld) {
      // Send notification to the player's socket
      if (notifyWs && notifyWs.readyState === 1) {
        // Get badge details from catalogue
        const catalogue = await Badges.listCatalogue(account.id);
        const badge = catalogue.find(b => b.key === badgeKey);
        if (badge) {
          notifyWs.send(JSON.stringify({
            type: 'badgeUnlocked',
            badge: {
              key: badge.key,
              name: badge.name,
              rarity: badge.rarity,
              description: badge.description,
              icon: badge.icon
            }
          }));
        }
      }
      return true;
    }
    return false;
  } catch (err) {
    logError('grantBadge failed', err);
    return false;
  }
}

// ---- Achievement check functions ----
// Each returns an array of badge keys that should be granted.

/**
 * Check single-match achievements after an interaction resolves.
 * Called with the room, the interaction type, and the result.
 */
function checkInteractionAchievements(room, pi, result) {
  const grants = [];
  const s = room.state;
  if (!s || !pi) return grants;

  // Lucky Six: Win a Dice Challenge by rolling a 6
  if (pi.type === 'dice' && result && result.events) {
    const rolls = pi.roundData && pi.roundData.rolls;
    if (rolls) {
      const actorId = pi.actorId;
      const targetId = pi.targetId;
      const actorRoll = rolls[actorId];
      const targetRoll = rolls[targetId];
      if (actorRoll === 6 && actorRoll > targetRoll) {
        grants.push({ badgeKey: 'lucky-six', accountId: null, account: null });
      }
    }
  }

  // Lightning Reflexes: Win Speed with reaction < 400ms
  if (pi.type === 'speed' && result && result.events) {
    const reactions = pi.roundData && pi.roundData.reactions;
    if (reactions) {
      const actorId = pi.actorId;
      const targetId = pi.targetId;
      const actorReaction = reactions[actorId];
      const targetReaction = reactions[targetId];
      if (actorReaction && actorReaction < 400 && (!targetReaction || actorReaction < targetReaction)) {
        grants.push({ badgeKey: 'lightning-reflexes', accountId: null, account: null });
      }
    }
  }

  // Jackpot!: Land on +10,000 in Wheel
  if (pi.type === 'wheel' && result && result.events) {
    const outcome = pi.roundData && pi.roundData.outcome;
    if (outcome === '+10000' || outcome === 'jackpot') {
      grants.push({ badgeKey: 'jackpot', accountId: null, account: null });
    }
  }

  // Master of Disguise: Win as Impostor without being caught
  if (pi.type === 'impostor' && result && result.events) {
    const impostorId = pi.roundData && pi.roundData.impostorId;
    const caught = pi.roundData && pi.roundData.caught;
    if (impostorId && !caught) {
      grants.push({ badgeKey: 'master-of-disguise', accountId: null, account: null });
    }
  }

  return grants;
}

/**
 * Check achievements that need multi-match progress tracking.
 * Returns array of { badgeKey, accountId, account, increment }.
 */
function checkProgressAchievements(room, pi, result) {
  const updates = [];
  const s = room.state;
  if (!s || !pi) return updates;

  // Mind Reader: Win 3 RPS challenges
  if (pi.type === 'rps' && result && result.events) {
    const winnerId = pi.roundData && pi.roundData.winnerId;
    if (winnerId) {
      const member = room.members.find(m => Rules.SEATS[m.seat].id === winnerId);
      if (member && member.account) {
        updates.push({
          badgeKey: 'mind-reader',
          account: member.account,
          increment: 1
        });
      }
    }
  }

  // Backstabber: Steal 20,000 in Betrayal
  if (pi.type === 'betrayal' && result && result.events) {
    const stealAmount = pi.roundData && pi.roundData.stealAmount;
    if (stealAmount && stealAmount > 0) {
      const stealerId = pi.roundData && pi.roundData.stealerId;
      const member = room.members.find(m => Rules.SEATS[m.seat].id === stealerId);
      if (member && member.account) {
        updates.push({
          badgeKey: 'backstabber',
          account: member.account,
          increment: stealAmount
        });
      }
    }
  }

  // Partners in Crime: Receive >= 10,000 bonus from Linked Fate
  if (pi.type === 'linkedfate' && result && result.events) {
    const bonusReceived = pi.roundData && pi.roundData.bonusReceived;
    if (bonusReceived && bonusReceived >= 10000) {
      const receiverId = pi.roundData && pi.roundData.receiverId;
      const member = room.members.find(m => Rules.SEATS[m.seat].id === receiverId);
      if (member && member.account) {
        updates.push({
          badgeKey: 'partners-in-crime',
          account: member.account,
          increment: bonusReceived
        });
      }
    }
  }

  // Identity Crisis: Swap allies 3 times across matches
  if (pi.type === 'swapper' && result && result.events) {
    const actorId = pi.actorId;
    const member = room.members.find(m => Rules.SEATS[m.seat].id === actorId);
    if (member && member.account) {
      updates.push({
        badgeKey: 'identity-crisis',
        account: member.account,
        increment: 1
      });
    }
  }

  return updates;
}

/* Evaluate card achievements only from completed server actions. */
function checkCardAchievements(room, pi, result, facts) {
  const out = [];
  const s = room && room.state;
  facts = facts || {};
  if (result && result.achievementFacts) Object.assign(facts, result.achievementFacts);
  const card = facts.cardId || (pi && pi.type) || '';
  const text = ((result && result.events) || []).map(e => e.text || '').join(' ').toLowerCase();
  const actorId = facts.actorId || (pi && pi.actorId);
  const rd = (pi && pi.roundData) || {};
  const add = (key, playerId) => out.push({ badgeKey: key, playerId: playerId || actorId });
  const successful = result && result.events && result.events.length && !/nobody|incomplete|failed/i.test(text);

  if (!successful && !facts.successful) return out;
  if (card === 'bonus' && Number(facts.gain) >= 10000) add('pocket-money');
  if (card === 'steal' && (facts.amount || 0) >= 50000) add('highway-robbery');
  if (card === 'bankrobbery' && (facts.amount || 0) >= 25000) add('master-thief');
  if (card === 'pointswap' && (facts.scoreGap || 0) >= 50000) add('tables-turned');
  if ((facts.bonus || 0) >= 20000) add('partners-in-crime-card', facts.receiverId);
  if (card === 'knife' && facts.eliminated) add('sharp-decision');
  if (card === 'zombie' && facts.eliminated) add('undead-nightmare');
  if (card === 'zombie' && facts.reflected && facts.hunterId) add('hunter-hunted', facts.hunterId);
  if (card === 'reverseofdoom' && facts.reflected && ['knife', 'zombie'].includes(facts.reflectedCard)) add('hunter-hunted', facts.targetId);
  if (card === 'ghost' && facts.blocked) add('untouchable', facts.targetId);
  if (card === 'judge' && facts.leadingEvilEliminated) add('guilty-as-charged');
  if (card === 'reverseofdoom' && facts.reflectedCard === 'phoenix') add('not-today', facts.targetId);
  if (card === 'russianroulette' && facts.survived) add('lucky-escape', facts.survivorId);
  if (card === 'skipall' && facts.skippedEveryone) add('my-turn-again');
  if (card === 'stealturn' && facts.forcedCard) add('puppet-master');
  if (facts.disguisedBlame) add('master-of-disguise-card', facts.playerId);
  if (facts.curseTriggered) add('cursed-fortune');
  if (card === 'alvin' && facts.destroyedOpponentCard) add('card-destroyer');
  if (card === 'reveal' && facts.revealedOpponentHand) add('no-more-secrets');
  if (card === 'swapper' && facts.swappedAllies) add('identity-crisis-card');
  if (card === 'dice' && facts.winnerId) add('high-roller', facts.winnerId);
  if (card === 'rps' && facts.winnerId) add('mind-reader-card', facts.winnerId);
  if (card === 'betrayal' && facts.choices && facts.choices[actorId] === 'steal' &&
      facts.choices[facts.targetId || (pi && pi.participants && pi.participants[1])] === 'share') add('trust-issues');
  if (card === 'speed' && facts.winnerId && !facts.falseStart) add('lightning-reflexes-card', facts.winnerId);
  if (card === 'impostor' && facts.impostorId === facts.winnerId) add('among-us', facts.impostorId);
  if (card === 'musicalchairs' && facts.winnerId) add('take-a-seat', facts.winnerId);
  if (card === 'musicalchairs' && Array.isArray(facts.winnerIds)) facts.winnerIds.forEach(id => add('take-a-seat', id));
  if (card === 'memorymayhem' && facts.perfectPlayerId) add('photographic-memory', facts.perfectPlayerId);
  if (card === 'joshuasurvey' && facts.winnerId) add('peoples-choice', facts.winnerId);
  if (card === 'wheel' && ['gain_10k', 'others_gain_20k', 'victory'].includes(facts.outcome)) add('fortune-favours-me');
  if (card === 'wheelofmisfortune' && facts.negative && facts.survived) add('disaster-magnet');
  if (card === 'phoenix' && successful) add('rise-of-the-phoenix');
  if (card === 'president' && facts.completedRounds >= 5) add('mr-president');
  if (card === 'hostage' && facts.rescued && facts.policeId) add('negotiator', facts.policeId);
  if (card === 'mimic' && facts.disguisedCardPlayed) add('youve-been-mimicked', facts.targetId);
  if (card === 'trailer' && successful) add('free-advertising');
  if (card === 'enjoyingthetrailer' && successful) add('biggest-fan');
  if (card === 'dehydrated' && successful) add('stay-hydrated');
  if (card === 'support' && facts.rejected) add('complaint-rejected');
  if (card === 'nothing' && successful) add('absolutely-nothing');
  return out;
}

module.exports = {
  SECRET_BADGE_KEYS,
  PROGRESS_TARGETS,
  isAvailable,
  getProgress,
  updateProgress,
  grantBadge,
  checkInteractionAchievements,
  checkProgressAchievements,
  checkCardAchievements,
  CARD_ACHIEVEMENT_CATALOG
};
