'use strict';

const crypto = require('crypto');

const VIDEOS = [
  { id:'ad-rocket-toaster', title:'The Rocket-Powered Toaster Review', creator:'PHOENIX Tech Desk', description:'We test a toaster that insists it is ready for launch.', views:'2.4M', likes:'98K' },
  { id:'cooking-soup', title:'Ridiculous Cooking: Soup for a Computer', creator:'Chef Buffering', description:'A completely serious tutorial for feeding an imaginary laptop.', views:'884K', likes:'41K' },
  { id:'animal-news', title:'Animal News at Nine: The Duck Has Questions', creator:'Feathered Broadcast', description:'Breaking news from a studio where nobody can find the teleprompter.', views:'5.1M', likes:'212K' },
  { id:'gaming-onion', title:'Gaming Onion Pro Max — First Look', creator:'Loading Screen Larry', description:'Is this an onion, a console, or both? Our reviewer investigates.', views:'731K', likes:'36K' },
  { id:'phoenix-weather', title:'Tomorrow’s Weather Is Mostly Geckos', creator:'PHOENIX Entertainment', description:'A forecast presented with unnecessary confidence and excellent graphics.', views:'1.8M', likes:'77K' },
  { id:'bread-maths', title:'Bread Mathematics Explained', creator:'Professor Crumb', description:'Pythagoras meets the bakery aisle in this educational special.', views:'642K', likes:'29K' }
];

function token() { return crypto.randomBytes(24).toString('hex'); }
function shuffled() { return [...VIDEOS].sort(() => crypto.randomInt(3) - 1).slice(0, 4); }

function create() {
  const videos = shuffled().map(video => ({
    ...video,
    duration: 120,
    // The server keeps these private. The preview only receives the public
    // metadata, never the answer or its timestamp.
    digit: crypto.randomInt(10),
    revealAt: crypto.randomInt(15, 106),
    source: '/assets/phoenixtube/clip-' + (VIDEOS.findIndex(item => item.id === video.id) + 1) + '.mp4'
  }));
  return {
    token: token(), videos, code: videos.map(video => String(video.digit)).join(''),
    expiresAt: Date.now() + 10 * 60 * 1000, status:'open'
  };
}

function publicState(challenge) {
  return {
    ok:true,
    videos: challenge.videos.map(video => ({
      id:video.id, title:video.title, creator:video.creator,
      description:video.description, views:video.views, likes:video.likes,
      duration:120, source:video.source
    })),
    expiresAt:challenge.expiresAt,
    status:challenge.status
  };
}

function expired(challenge) { return !challenge || challenge.status !== 'open' || Date.now() >= challenge.expiresAt; }
function submit(challenge, answer) {
  if (expired(challenge)) return { ok:false, message:'This PHOENIXTube challenge has expired.' };
  const code = String(answer == null ? '' : answer).trim();
  if (!/^\d{4}$/.test(code)) return { ok:false, message:'Enter exactly four digits.' };
  if (code !== challenge.code) return { ok:false, message:'Incorrect code. Rewatch the videos and try again.' };
  challenge.status = 'complete';
  return { ok:true };
}

module.exports = { VIDEOS, create, publicState, submit, expired };
