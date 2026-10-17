const fs = require('fs');
let c = fs.readFileSync('js/online-client.js', 'utf8');
const old = "      if (message.pendingInteraction && message.pendingInteraction.type === 'rps' && window.PhoenixRpsInteractive) { window.PhoenixRpsInteractive.build(); } else if (message.pendingInteraction && message.pendingInteraction.type === 'betrayal' && window.PhoenixBetrayalInteractive) { window.PhoenixBetrayalInteractive.build(); } else if (message.pendingInteraction && message.pendingInteraction.type === 'speed' && window.PhoenixSpeedInteractive) { window.PhoenixSpeedInteractive.build(); } else if (message.pendingInteraction && message.pendingInteraction.type === 'wheel' && window.PhoenixWheelInteractive) { window.PhoenixWheelInteractive.build(); }";
const neu = "      if (message.pendingInteraction) {\n        var pi = message.pendingInteraction;\n        if (pi.type === 'rps' && window.PhoenixRpsInteractive) window.PhoenixRpsInteractive.build();\n        else if (pi.type === 'betrayal' && window.PhoenixBetrayalInteractive) window.PhoenixBetrayalInteractive.build();\n        else if (pi.type === 'speed' && window.PhoenixSpeedInteractive) window.PhoenixSpeedInteractive.build();\n        else if (pi.type === 'wheel' && window.PhoenixWheelInteractive) window.PhoenixWheelInteractive.build();\n      }";
if (c.indexOf(old) !== -1) {
  c = c.replace(old, neu);
  fs.writeFileSync('js/online-client.js', c);
  console.log('Fixed client interactive trigger');
} else console.log('Pattern not found');
