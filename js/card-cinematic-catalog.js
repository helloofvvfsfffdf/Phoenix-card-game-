/* Preview-only art direction. Card names/rules remain sourced from cards.js. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.PhoenixCardCinematicCatalog=api;}(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  return {
    bonus:{color:'#ffd475',title:'A fortune ignites',motif:'Golden coins ascend through a radiant mint seal.',duration:3.8,variants:['Gain'],caption:'YOU +10,000 · NO TARGET'},
    knife:{color:'#b9eaff',title:'One clean cut',motif:'A cold diagonal blade, fractured steel and a sharp afterimage.',duration:3.5,variants:['Eliminate'],caption:'TARGET OUT FOR 1 ROUND · POINTS UNTOUCHED'},
    hunter:{color:'#8be2aa',title:'The watch is set',motif:'An emerald bow-shaped ward closes around the holder.',duration:3.8,variants:['Gain','Already held'],caption:'HUNTER HELD · REFLECTS ZOMBIE ONLY'},
    zombie:{color:'#a1ef63',title:'Everything decays',motif:'Necrotic vapour rises into a toxic skull-shaped seal.',duration:4.2,variants:['Hit','Reflected'],caption:'TARGET OUT FOR 1 ROUND · TARGET POINTS → 0'},
    steal:{color:'#bd9cff',title:'A violet heist',motif:'Three flowing particle streams draw a fortune back to the actor.',duration:4,variants:['Transfer','Zero points'],caption:'ALL TARGET POINTS → YOU · NO ELIMINATION'},
    judge:{color:'#ffe6a0',title:'The verdict falls',motif:'A celestial seal resolves into a single descending column of light.',duration:4.4,variants:['Banish','Failed','No evil cards'],caption:'50% ACTIVATION · MOST EVIL PLAYER OUT FOR 3 ROUNDS'},
    reveal:{color:'#75dcff',title:'Behind the veil',motif:'An electric iris opens; a scan passes over a private fan of cards.',duration:3.8,variants:['Private reveal'],caption:'ONLY THE ACTOR SEES THE HAND · NOTHING CHANGES'},
    skipall:{color:'#ffb579',title:'The table stands still',motif:'An amber turn wheel sweeps past the other seats and returns.',duration:3.8,variants:['Extra turn'],caption:'OTHERS SKIP · YOU PLAY AGAIN · NOBODY ELIMINATED'},
    phoenix:{color:'#ff873d',title:'The legendary reckoning',motif:'Six arcs of burning feathers unfold into a monumental winged sigil.',duration:5.4,variants:['Unleash'],caption:'ALL OPPONENT POINTS → YOU · ALL OPPONENTS ELIMINATED'},
    trick:{color:'#ff9ad9',title:'A borrowed identity',motif:'Twin mirrored masks cross through a rose-violet veil.',duration:4,variants:['Disguise'],caption:'DISGUISE UNTIL ROUND END · SCORE & EFFECTS UNCHANGED'},
    stealturn:{color:'#7fa8ff',title:'Pull the hands of time',motif:'A counter-rotating clock binds a choice to the target’s next turn.',duration:4,variants:['Bind next turn','Choose legal card'],caption:'THEIR NEXT TURN · YOUR LEGAL CARD CHOICE'},
    curse:{color:'#c08cff',title:'A secret takes root',motif:'Violet runes wrap the entire hand without marking a particular card.',duration:4.2,variants:['Plant hidden curse','Trigger after play','Empty hand'],caption:'ONE RANDOM CARD CURSED · ITS IDENTITY STAYS SECRET'},
    ghost:{color:'#b1f2f1',title:'Beyond their reach',motif:'Pale feathers and a spectral boundary dissolve the holder’s outline.',duration:4,variants:['Untargetable'],caption:'UNTARGETABLE UNTIL ROUND END · EXISTING EFFECTS REMAIN'},
    alvin:{color:'#ffba7c',title:'The ginger executioner',motif:'A warm paw constellation, three claw strokes and one card’s final embers.',duration:4.4,variants:['Reveal & choose','Destroy chosen card','Empty hand'],caption:'ACTOR SEES HAND · CHOOSES ONE CARD TO DESTROY FOREVER'},
    dice:{color:'#ffd700',title:'The dice decide',motif:'Two golden dice tumble and settle on matching faces.',duration:3.6,variants:['Roll','Tie reroll'],caption:'HIGHER ROLL WINS 20,000 · TIES REROLL'},
    rps:{color:'#ff6b6b',title:'Rock, paper, scissors',motif:'Three elemental symbols clash and resolve.',duration:3.8,variants:['Secret pick','Reveal','Elimination'],caption:'LOSER ELIMINATED FOR 1 ROUND · TIES REPEAT'},
    betrayal:{color:'#9b59b6',title:'The prisoner\'s dilemma',motif:'Two masks face each other across a divide of light and shadow.',duration:4.2,variants:['Share','Steal'],caption:'SHARE/SHARE: BOTH +10,000 · STEAL/SHARE: STEALER +20,000 · STEAL/STEAL: NOTHING'},
    speed:{color:'#00d4ff',title:'Lightning reflexes',motif:'A blazing GO signal splits the screen in two.',duration:3.4,variants:['Ready','GO','React'],caption:'FASTEST REACTION WINS 15,000 · FALSE STARTS PENALISED'},
    wheel:{color:'#ff9500',title:'The wheel turns',motif:'A nine-segment wheel spins and lands on destiny.',duration:4.8,variants:['Spin','Nine outcomes'],caption:'NINE OUTCOMES · SERVER-AUTHORITATIVE RANDOMNESS'},
    linkedfate:{color:'#00ff88',title:'Bound together',motif:'A glowing chain connects two players across the table.',duration:4.0,variants:['Link','Shared gains'],caption:'LINKED FOR 2 ROUNDS · 50% GAIN SHARED · NO LOSSES'},
    impostor:{color:'#8e44ad',title:'Who is the impostor?',motif:'A single shadow among five players, hidden until the vote.',duration:5.0,variants:['Secret word','Clues','Vote','Reveal'],caption:'MIN 4 PLAYERS · CATCH: NON-IMPOSTORS +10,000 · ESCAPE: IMPOSTOR +30,000'},
    swapper:{color:'#ff4081',title:'Switching sides',motif:'Two ally portraits swap places in a burst of light.',duration:3.8,variants:['Swap'],caption:'ALLIES SWAP · POINTS UNCHANGED'},
    wheelofmisfortune:{color:'#8b0000',title:'The wheel of misfortune',motif:'A dark eight-segment wheel spins with an evil laugh.',duration:4.8,variants:['Spin','Eight outcomes'],caption:'EIGHT TERRIBLE OUTCOMES · SERVER-AUTHORITATIVE RANDOMNESS'}
  };
}));
