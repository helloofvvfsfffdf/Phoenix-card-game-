'use strict';

const PUZZLES = [
  ['nvidia','Definitely Not NVIDIA — Build the GPU'],['news','PHOENIX News — The Missing Headline'],['microsoft','Definitely Not Microsoft — Fix Windows 13'],['weather','Foogle Weather — Forecast Decoder'],['wikipedia','Definitely Not Wikipedia — The Lost Article'],['reddit','Definitely Not Reddit — Find the Impostor'],['apple','Definitely Not Apple — The Impossible Order'],['technologies','PHOENIX Technologies — Restore the Blueprint'],['steam','Definitely Not Steam — Find the Hidden Game']
];
function difficulty(rounds, players) { const r=Number(rounds)||10, p=Number(players)||2; const level=r<=10?'very-easy':r<=25?'easy':r<=50?'normal':r<=75?'hard':'expert'; return { level, stages:Math.max(1,Math.min(7,Math.ceil(r/20)+Math.max(0,p-3))) }; }
function create(rounds, players) { const d=difficulty(rounds,players); return { difficulty:d, completed:{}, assignments:{}, progress:{}, placements:{}, visit:null, victory:false, failed:false }; }
function publicState(challenge) { return { difficulty:challenge.difficulty, completed:challenge.completed, assignments:challenge.assignments, progress:challenge.progress, placements:challenge.placements, visit:challenge.visit, victory:challenge.victory, failed:challenge.failed, puzzles:PUZZLES.map(p=>({id:p[0],name:p[1],status:challenge.completed[p[0]]?'completed':Object.values(challenge.assignments).includes(p[0])?'reserved':'available'}))}; }
module.exports = { PUZZLES, difficulty, create, publicState };
