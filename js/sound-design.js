/* Original procedural Foley. No recordings, speech, game state or network data. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhoenixSoundDesign = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Each layer: material, onset, length, strength, pitch/colour, ending colour.
  // Fixed timings deliberately follow the existing short cinematic envelopes.
  function layer(kind, at, length, gain, colour, end) {
    return { kind: kind, at: at, length: length, gain: gain, colour: colour, end: end || colour };
  }
  var L = layer;
  var DESIGNS = {
    bonus: ['A handful of coins lands, bounces and settles', [L('metal',0,.23,.6,1750),L('metal',.09,.32,.5,2370),L('metal',.21,.35,.35,3120),L('paper',.02,.2,.2,1800)]],
    knife: ['Blade swish, steel scrape, sharp dry strike', [L('air',0,.12,.7,2200,4800),L('scrape',.045,.13,.5,3300),L('wood',.14,.16,.8,210),L('metal',.14,.24,.35,2900)]],
    hunter: ['Bowstring drawn and released; a taut protective ward', [L('creak',0,.24,.5,180,340),L('string',.19,.45,.65,165),L('air',.21,.2,.3,1500,400)]],
    zombie: ['Ragged low throat groan with a breathy rasp', [L('groan',0,.85,.8,83,57),L('breath',.09,.7,.4,700,430)]],
    steal: ['Score stash swept away: coins scrape, scatter, then pocket', [L('scrape',0,.17,.5,1800,2900),L('metal',.1,.22,.35,1450),L('metal',.16,.25,.3,2190),L('cloth',.22,.2,.6,700)]],
    judge: ['Two firm wooden gavel knocks, second with a heavy verdict', [L('wood',0,.2,.6,340),L('wood',.26,.3,.85,240),L('rumble',.27,.4,.35,90)]],
    reveal: ['A concealed hand fans open: crisp layered card flicks', [L('paper',0,.13,.55,2100),L('paper',.07,.14,.5,2900),L('paper',.15,.18,.4,3600),L('cloth',.02,.34,.25,650)]],
    skipall: ['Clockwork races through three ticks and brakes sharply', [L('wood',0,.09,.45,850),L('wood',.12,.08,.45,1100),L('wood',.2,.07,.45,1400),L('scrape',.24,.21,.5,2600,500),L('metal',.39,.15,.25,1900)]],
    phoenix: ['Flame intake erupts into a broad roaring fire and ember finish', [L('air',0,.23,.55,500,2400),L('fire',.14,1,1.1,850,260),L('rumble',.2,.75,.55,68),L('crackle',.42,.72,.32,2700)]],
    trick: ['Cloth mask slips over the face, reverse suction and a sly snap', [L('cloth',0,.32,.65,950),L('reverse',.09,.34,.5,400,1900),L('paper',.34,.17,.65,2300)]],
    stealturn: ['Puppet cord tightens, a ratchet catches and control locks', [L('creak',0,.22,.55,270,140),L('wood',.19,.1,.5,700),L('wood',.28,.1,.45,540),L('string',.31,.28,.4,120)]],
    curse: ['Dry ritual scratching, a resonant seal and murmuring breath', [L('scrape',0,.28,.45,1100,550),L('bell',.18,.63,.5,173),L('breath',.23,.56,.45,450,800)]],
    ghost: ['Long unvoiced whisper dissolves into air; no intelligible words', [L('breath',0,.86,.8,1450,550),L('reverse',0,.26,.22,600,1600),L('air',.32,.55,.3,2100,500)]],
    alvin: ['Cards part, a small ignition catches and starts to crackle', [L('paper',0,.15,.5,2300),L('wood',.11,.06,.4,950),L('fire',.16,.34,.5,1200),L('crackle',.19,.32,.5,2800)]],
    dice: ['Two dice clatter and settle on the table', [L('wood',0,.1,.5,800),L('wood',.08,.12,.6,1200),L('metal',.2,.15,.4,2400),L('wood',.3,.08,.3,600)]],
    rps: ['Three sharp strikes: rock, paper, scissors', [L('wood',0,.1,.6,400),L('paper',.12,.1,.5,2000),L('metal',.24,.1,.5,3000),L('wood',.36,.1,.4,500)]],
    betrayal: ['Two masks shift and whisper across the divide', [L('cloth',0,.3,.6,800),L('cloth',.15,.25,.5,1200),L('breath',.3,.4,.4,600),L('paper',.4,.15,.3,2000)]],
    speed: ['A sharp GO signal fires and a quick reaction lands', [L('air',0,.08,.8,3000,6000),L('wood',.12,.1,.6,800),L('metal',.15,.08,.4,2400)]],
    wheel: ['A heavy wheel spins and clicks to a stop', [L('wood',0,.3,.5,200),L('metal',.1,.08,.4,1200),L('metal',.3,.08,.4,1400),L('metal',.5,.08,.4,1600),L('wood',.7,.2,.6,300)]],
    linkedfate: ['A chain links two players with a resonant hum', [L('string',0,.4,.6,220),L('bell',.1,.5,.5,440),L('air',.3,.4,.3,1200,600)]],
    impostor: ['A shadow moves among the players, then a dramatic reveal', [L('breath',0,.4,.5,800,400),L('cloth',.2,.2,.4,1200),L('bell',.5,.6,.6,330),L('rumble',.6,.5,.4,80)]],
    swapper: ['Two ally portraits swap in a burst of light', [L('air',0,.15,.5,1500,3000),L('paper',.1,.12,.6,2200),L('cloth',.2,.15,.4,800),L('bell',.3,.3,.5,660)]],
    'wheelofmisfortune': ['Evil wheel spins with a menacing laugh', [L('groan',0,.8,.9,80,50),L('breath',.1,.6,.5,400,200),L('groan',.3,.4,.7,90,60),L('breath',.5,.5,.4,350,180),L('rumble',.7,.6,.5,60),L('groan',.9,.3,.6,70,45)]],
    musicalchairs: ['A chair-scrape, a stop, and a stampede of feet', [L('wood',0,.2,.6,520),L('creak',.05,.3,.5,180,320),L('wood',.3,.12,.7,760),L('paper',.42,.2,.4,1800),L('wood',.62,.14,.5,640)]],
    russianroulette: ['A cylinder turns, a click, and the hammer falls', [L('metal',0,.22,.55,2400),L('metal',.16,.2,.6,2800),L('wood',.4,.16,.8,300),L('metal',.55,.3,.4,1800)]],
    memorymayhem: ['Three rising chimes, each one higher than the last', [L('bell',0,.35,.5,523),L('bell',.14,.35,.5,659),L('bell',.28,.45,.55,784)]],
    bankrobbery: ['A vault door, a sack, and a very loud alarm', [L('metal',0,.3,.7,180),L('cloth',.22,.3,.6,700),L('metal',.4,.16,.5,900),L('bell',.56,.7,.5,1100)]],
    pointswap: ['Two scores slide past each other and swap', [L('air',0,.16,.5,1200,3000),L('air',.14,.16,.5,3000,1200),L('bell',.3,.4,.5,660)]],
    hostage: ['A door slams, and a radio hisses', [L('wood',0,.22,.85,220),L('cloth',.1,.26,.5,800),L('breath',.22,.7,.45,900,500),L('rumble',.5,.5,.5,70)]],
    president: ['A crowd cheers, and a seal thumps down', [L('paper',0,.2,.5,1500),L('bell',.16,.55,.65,330),L('wood',.34,.2,.8,260),L('bell',.5,.4,.5,440)]],
    mimic: ['A card slides, a creak, and a very wrong cackle', [L('paper',0,.18,.6,2600),L('creak',.1,.3,.55,200,420),L('groan',.32,.42,.7,95,60),L('bell',.6,.3,.4,520)]],
    dehydrated: ['A gulp, a spin, and a gurgle', [L('breath',0,.4,.6,700,400),L('reverse',.1,.45,.5,500,1500),L('rumble',.4,.4,.4,80)]],
    nothing: ['A very small, very anticlimactic nothing', [L('paper',0,.12,.35,2000),L('air',.1,.2,.25,900)]],
    reverseofdoom: ['A shield rings, then the harm comes back around', [L('bell',0,.4,.7,523),L('air',.1,.3,.5,3000,800),L('bell',.34,.5,.7,784),L('rumble',.5,.5,.5,70)]],
    support: ['A hold line rings, then a stamp thuds down', [L('bell',0,.3,.4,480),L('bell',.3,.3,.4,480),L('bell',.6,.3,.4,480),L('wood',.9,.2,.8,300)]],
    'joshuasurvey': ['A pencil scratches, a bell rings, a stamp thuds', [L('paper',0,.24,.5,2600),L('bell',.26,.4,.5,660),L('wood',.5,.2,.8,280)]],
    'trailer': ['A projector whirs up and a big score lands', [L('air',0,.3,.45,600,2200),L('rumble',.2,.6,.6,90),L('bell',.5,.7,.7,330)]],
    'alvin-burn': ['Close, brittle paper combustion: crackle, flame and ash', [L('crackle',0,.78,.4,3400),L('fire',.04,.77,.95,900,330),L('paper',.55,.26,.3,1900)]],
    'curse-trigger': ['Ritual seal cracks, followed by a guttural exhalation', [L('wood',0,.13,.6,150),L('bell',0,.5,.4,137),L('groan',.06,.51,.65,65,42)]],
    'hunter-block': ['Deflected attack: taut string recoil and arrow-like return', [L('string',0,.28,.65,225),L('air',.05,.26,.6,3800,700),L('wood',.29,.16,.45,390)]],
    'ally-phoenix': ['One card whisked from the hand and tucked away', [L('paper',0,.12,.7,3300),L('air',.05,.2,.45,2600,900),L('cloth',.17,.2,.65,550)]],
    'ally-ted': ['Wet slobber lands with a thick splat and drippy bubbles', [L('splat',0,.35,.9,360),L('bubble',.16,.14,.5,420,150),L('bubble',.29,.19,.45,290,90),L('cloth',.06,.29,.25,500)]],
    'ally-maple': ['Sweet Tooth: wrapper crinkles, two sugary crunches', [L('paper',0,.24,.6,4200),L('crunch',.22,.14,.65,1700),L('crunch',.4,.16,.5,2200)]],
    'block-tilly': ['Protective Paws: two padded paw thumps and a low warning', [L('wood',0,.11,.55,150),L('wood',.14,.12,.5,185),L('groan',.17,.35,.35,140,115)]],
    'block-ted': ['Protective Howl: a chesty bark rises into a short howl', [L('bark',0,.22,.5,150,95),L('howl',.17,.66,.42,240,320)]],
    'block-louie': ['Quick Reflexes: fast air dodge and a card slapped back', [L('air',0,.15,.6,1000,3800),L('paper',.12,.14,.7,2600),L('wood',.15,.13,.35,430)]],
    'block-simba': ['Sharp Claws: three close claw rakes with a raspy warning', [L('scrape',0,.12,.7,3200),L('scrape',.09,.12,.6,3800),L('scrape',.18,.14,.5,2600),L('breath',.2,.22,.4,2100)]],
    'block-elsie': ['Untouchable: soft repel gust meets a glass-hard barrier', [L('air',0,.3,.45,900,2300),L('glass',.13,.53,.6,1560),L('glass',.19,.4,.25,2340)]],
    'maple-restriction': ['A gentle wrapper squeeze and a small closed-lid tap', [L('paper',0,.18,.4,3300),L('wood',.16,.13,.35,590)]]
  };
  // Catalogue-only, dormant previews keep an identity without creating triggers.
  DESIGNS['ally-tilly'] = DESIGNS['block-tilly'];
  DESIGNS['ally-louie'] = DESIGNS.stealturn;
  DESIGNS['ally-simba'] = DESIGNS['block-simba'];
  DESIGNS['ally-elsie'] = DESIGNS['block-elsie'];
  // Fantasy accents sit underneath recognisable material gestures. Different
  // combinations/timings, not a shared loud stinger pasted onto every action.
  var MAGIC = {
    bonus: [L('metal',.29,.38,.25,2780),L('metal',.4,.37,.2,3450),L('shimmer',.18,.63,.12,1700)],
    knife: [L('impact',.14,.48,.2,85),L('shimmer',.12,.4,.14,3600)],
    hunter: [L('halo',.18,.9,.17,246),L('reverse',0,.25,.15,450,1300)],
    zombie: [L('growl',.08,1.12,.28,49,38),L('rumble',.28,.85,.2,70)],
    steal: [L('reverse',0,.43,.19,650,1700),L('shimmer',.28,.55,.14,2100)],
    judge: [L('impact',.26,.65,.23,65),L('halo',.29,.8,.16,130)],
    reveal: [L('shimmer',.12,.83,.22,2400),L('breath',.2,.53,.15,1800,900)],
    skipall: [L('reverse',.02,.32,.2,650,2200),L('impact',.39,.43,.15,100)],
    phoenix: [L('growl',.14,1.2,.25,54,77),L('halo',.34,1.12,.23,196),L('impact',.23,.75,.23,58)],
    trick: [L('halo',.19,.77,.17,277),L('breath',.07,.63,.16,1900,800)],
    stealturn: [L('halo',.28,.83,.17,185),L('reverse',.06,.31,.2,450,1900)],
    curse: [L('growl',.19,.83,.2,61,43),L('halo',.25,.9,.17,116)],
    ghost: [L('halo',.22,.97,.16,311),L('shimmer',.49,.65,.14,1950)],
    alvin: [L('halo',.18,.7,.13,220),L('reverse',.08,.27,.14,500,2100)],
    'alvin-burn': [L('growl',.13,.94,.2,79,45),L('halo',.23,.95,.2,147),L('impact',.09,.43,.16,80)],
    'curse-trigger': [L('impact',0,.53,.22,54),L('halo',.06,.77,.19,97)],
    'hunter-block': [L('shimmer',.19,.61,.2,2900),L('impact',.29,.4,.17,110)],
    'ally-phoenix': [L('shimmer',.16,.56,.18,3300),L('reverse',0,.21,.15,900,2200)],
    'ally-ted': [L('impact',.02,.4,.16,97),L('bubble',.35,.37,.18,540,130)],
    'ally-maple': [L('shimmer',.33,.68,.17,3100),L('halo',.27,.63,.12,349)],
    'block-tilly': [L('halo',.14,.73,.2,233),L('impact',.04,.38,.12,130)],
    'block-ted': [L('growl',0,.31,.18,68,56),L('halo',.22,.81,.18,174)],
    'block-louie': [L('shimmer',.13,.59,.22,3900),L('reverse',0,.18,.17,750,2200)],
    'block-simba': [L('impact',.18,.48,.18,95),L('shimmer',.19,.57,.16,3100)],
    'block-elsie': [L('halo',.13,.97,.21,392),L('shimmer',.25,.73,.18,4100)],
    'maple-restriction': [L('shimmer',.16,.36,.07,2750)]
  };
  DESIGNS.victory = ['Phoenix ascension: ceremonial impacts, warm brass/choir, fire and starlight finale', [
    L('impact',0,1.1,.32,55),L('fire',.08,1.15,.4,900,450),
    L('brass',.3,.95,.19,196),L('brass',.3,.95,.17,293.66),L('brass',.3,.95,.14,392),
    L('brass',1.18,.95,.17,220),L('brass',1.18,.95,.16,330),L('brass',1.18,.95,.14,440),
    L('impact',2.02,.8,.23,70),L('brass',2.03,2.35,.18,261.63),L('brass',2.03,2.35,.16,392),L('brass',2.03,2.35,.14,523.25),
    L('choir',1.65,2.9,.14,130.81),L('choir',1.65,2.9,.12,196),
    L('shimmer',2.42,2.16,.17,2900),L('crackle',3.15,.95,.17,2800),L('air',3.32,1.3,.15,1700,450)
  ]];
  DESIGNS.defeat = ['Quiet fallen-banner coda: low breath, soft body and fading resonance', [L('cloth',0,.45,.3,500),L('halo',.12,1.28,.17,146.83),L('breath',.17,1.15,.2,650,280)]];
  DESIGNS.draw = ['Balanced unresolved coda: two gentle resonances and settling air', [L('halo',0,1.17,.16,196),L('halo',.09,1.19,.14,293.66),L('air',.22,.83,.15,900,400)]];
  // Phoenix-only fallback if the recorded local mix cannot be decoded. The
  // production player prefers assets/phoenix/fire-roar.mp3. No other recipe changes.
  DESIGNS.phoenix = ['Full-screen Phoenix: rising fire intake, pressure release and sustained roaring embers', [
    L('air',0,1.2,.4,450,2300),L('fire',.15,3.85,.9,900,350),
    L('rumble',.4,3.4,.6,78),L('impact',1.15,1.1,.3,68),L('crackle',.6,3.4,.3,2900)
  ]];
  MAGIC.phoenix = [];
  function recipe(key, inert) {
    if (!Object.prototype.hasOwnProperty.call(DESIGNS, key)) return null;
    var layers = inert ? [L('wood',0,.13,.22,330),L('cloth',.06,.19,.18,800)] : DESIGNS[key][1].concat(MAGIC[key] || []);
    return { concept: inert ? 'Quiet unresolved knock and cloth fall; no verdict' : DESIGNS[key][0],
      tail: inert ? .08 : .28,
      duration: inert ? .25 : Math.max.apply(null, layers.map(function (l) { return l.at + l.length; })),
      layers: layers.map(function (l) { return Object.assign({}, l); }) };
  }
  // Render a mono PCM buffer once, then reuse it. Material envelopes, resonant
  // bodies and breath/formant filtering replace the old pitched note sequences.
  function render(design, sampleRate, seed) {
    if (!design || !isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Invalid sound render');
    var out = new Float32Array(Math.ceil((design.duration + (design.tail || .08)) * sampleRate));
    var state = seed >>> 0 || 173;
    function random() { state = (Math.imul(state,1664525) + 1013904223) >>> 0; return state / 2147483648 - 1; }
    design.layers.forEach(function (l) {
      var start = Math.round(l.at * sampleRate), count = Math.floor(l.length * sampleRate);
      var low = 0, slower = 0, phase = 0, pulse = 0;
      var f1 = [0,0], f2 = [0,0];
      var k=l.kind;
      var ratios=k==='wood'?[1,1.57,2.31]:k==='string'?[1,2,3.01,4.02]:[1,2.756,5.404,8.933];
      var decay=k==='wood'?32:k==='metal'?16:k==='string'?12:7;
      // Damped formant resonators are excited by a rough glottal pulse, not
      // musical notes. Unvoiced whispers use noise as the same excitation.
      function resonator(input, frequency, memory) {
        var radius = Math.exp(-Math.PI * 100 / sampleRate);
        var value = input * (1-radius) + 2*radius*Math.cos(2*Math.PI*Math.min(frequency,sampleRate*.42)/sampleRate)*memory[0] - radius*radius*memory[1];
        memory[1] = memory[0]; memory[0] = value; return value;
      }
      for (var i=0; i<count; i++) {
        var t=i/sampleRate, p=i/count, n=random(), colour=l.colour+(l.end-l.colour)*p;
        var alpha=1-Math.exp(-2*Math.PI*Math.min(colour,sampleRate*.38)/sampleRate);
        low += alpha*(n-low); slower += .025*(n-slower);
        var attack=Math.min(1,t/.008), tail=Math.min(1,(l.length-t)/.035);
        var env=attack*tail, value=0;
        if (['metal','glass','bell','wood','string'].indexOf(k)>=0) {
          for(var m=0;m<ratios.length;m++) {
            var hz=colour*ratios[m];
            if(hz<sampleRate*.44) value += Math.sin(2*Math.PI*hz*t)*Math.exp(-t*decay*(1+m*.45))/(1+m*1.7);
          }
          value=value*.55+(n-low)*Math.exp(-t*90)*.3;
        } else if (['groan','bark','howl','breath'].indexOf(k)>=0) {
          var voiced=k!=='breath';
          phase += (colour*(1+.03*Math.sin(t*43)+.017*n))/sampleRate;
          pulse = voiced ? Math.max(0,1-(phase%1)/.16)*2-.16 : n;
          var formant=k==='howl'?750:k==='bark'?510:k==='groan'?420:colour;
          value=resonator(pulse,formant,f1)*1.4+resonator(pulse,formant*2.7,f2)*.7+(n-low)*(voiced?.09:.2);
          env *= Math.pow(Math.sin(Math.PI*p),.65)*(k==='bark'?Math.exp(-p*3):1);
        } else if (k==='impact') {
          phase += (colour*(1-.65*p))/sampleRate;
          value=Math.sin(phase*2*Math.PI)*Math.exp(-p*7)+low*.6*Math.exp(-p*16);
        } else if (k==='halo' || k==='choir' || k==='brass' || k==='growl') {
          phase += colour*(1+.006*Math.sin(t*29))/sampleRate;
          var harmonics=k==='brass'?7:k==='growl'?9:4;
          for(var h=1;h<=harmonics;h++) {
            if(colour*h<sampleRate*.43) value+=Math.sin(phase*2*Math.PI*h+(k==='halo'?Math.sin(t*5)*h*.17:0))/(h*h*.7+.3);
          }
          value=value*.35+(k==='growl'?low*.3:0);
          env *= Math.pow(Math.sin(Math.PI*p),k==='brass'?.65:1.2);
        } else if (k==='shimmer') {
          value=resonator(n,colour,f1)*.8+resonator(n,colour*1.414,f2)*.5;
          env *= Math.pow(Math.sin(Math.PI*p),.8);
        } else if (k==='bubble') {
          phase += colour/sampleRate;
          value=Math.sin(phase*2*Math.PI)*Math.exp(-p*5)+low*.15;
        } else if (k==='fire' || k==='rumble') {
          value=k==='fire'?low*(.65+.35*Math.sin(t*31)*Math.sin(t*17))+slower*1.8:slower*2.3;
          env *= Math.pow(Math.sin(Math.PI*p),.7);
        } else if (k==='crackle' || k==='crunch') {
          if(random()>.975) pulse=.4+Math.abs(n); else pulse*=.84;
          value=(n-low)*pulse*2+low*.16;
          env *= k==='crunch'?Math.exp(-p*4):Math.pow(Math.sin(Math.PI*p),.55);
        } else if (k==='splat') {
          phase += colour/sampleRate;
          value=low*1.8*Math.exp(-p*7)+Math.sin(phase*2*Math.PI)*.45*Math.exp(-p*12);
          env *= Math.exp(-p*2);
        } else if (k==='creak') {
          phase += colour/sampleRate;
          value=resonator(Math.sin(phase*2*Math.PI)*(1+.5*n),1200,f1)*2+low*.2;
          env *= Math.pow(Math.sin(Math.PI*p),.7);
        } else {
          value=k==='cloth'?low*1.5:k==='scrape'?(n-low)*(.4+.6*Math.abs(Math.sin(t*170))):n-low;
          if(k==='paper') value=(n-low)*(.2+.8*Math.pow(Math.abs(Math.sin(t*95)),5));
          env *= k==='reverse'?p*p:k==='paper'?Math.exp(-p*2):Math.pow(Math.sin(Math.PI*p),1.2);
        }
        out[start+i] += value*env*l.gain;
      }
    });
    // Very short room reflections give material depth without a long wash or
    // unbounded Web Audio graph. Bounded peaks preserve differences in dynamics.
    var dry=out.slice(), peak=0, energy=0;
    var reflections=design.tail>.08?[[.037,.13],[.083,.09],[.139,.06],[.211,.035]]:[[.023,.13],[.047,.07]];
    for(var i=0;i<out.length;i++) {
      reflections.forEach(function (r) { out[i] += (dry[i-Math.round(sampleRate*r[0])]||0)*r[1]; });
      peak=Math.max(peak,Math.abs(out[i]));
      energy += out[i]*out[i];
    }
    var rms=Math.sqrt(energy/out.length);
    var gain=Math.min(1,peak>.78?.78/peak:1,rms>.14?.14/rms:1);
    for(var j=0;j<out.length;j++) out[j]*=gain;
    return out;
  }
  return { DESIGNS: DESIGNS, recipe: recipe, render: render };
}));
