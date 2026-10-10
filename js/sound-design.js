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
  function recipe(key, inert) {
    if (!Object.prototype.hasOwnProperty.call(DESIGNS, key)) return null;
    var layers = inert ? [L('wood',0,.13,.22,330),L('cloth',.06,.19,.18,800)] : DESIGNS[key][1];
    return { concept: inert ? 'Quiet unresolved knock and cloth fall; no verdict' : DESIGNS[key][0],
      duration: inert ? .25 : Math.max.apply(null, layers.map(function (l) { return l.at + l.length; })),
      layers: layers.map(function (l) { return Object.assign({}, l); }) };
  }
  // Render a mono PCM buffer once, then reuse it. Material envelopes, resonant
  // bodies and breath/formant filtering replace the old pitched note sequences.
  function render(design, sampleRate, seed) {
    if (!design || !isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Invalid sound render');
    var out = new Float32Array(Math.ceil((design.duration + .08) * sampleRate));
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
    for(var i=0;i<out.length;i++) {
      out[i] += (dry[i-Math.round(sampleRate*.023)]||0)*.13 + (dry[i-Math.round(sampleRate*.047)]||0)*.07;
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
