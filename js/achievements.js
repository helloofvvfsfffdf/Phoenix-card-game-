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

const SECRET_BADGE_KEYS = [
  'lucky-six', 'mind-reader', 'backstabber', 'lightning-reflexes',
  'jackpot', 'partners-in-crime', 'master-of-disguise', 'identity-crisis'
];

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

module.exports = {
  SECRET_BADGE_KEYS,
  PROGRESS_TARGETS,
  isAvailable,
  getProgress,
  updateProgress,
  grantBadge,
  checkInteractionAchievements,
  checkProgressAchievements
};
