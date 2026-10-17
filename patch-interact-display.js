const fs = require('fs');
const code = fs.readFileSync('js/online-client.js', 'utf8');
const marker = "if (window.PhoenixMatchShowcase) window.PhoenixMatchShowcase.observe(previous, message);";
const insert = "\n        if (message.pendingInteraction && message.pendingInteraction.type === 'rps' && window.PhoenixRpsInteractive) { window.PhoenixRpsInteractive.build(); } else if (message.pendingInteraction && message.pendingInteraction.type === 'betrayal' && window.PhoenixBetrayalInteractive) { window.PhoenixBetrayalInteractive.build(); } else if (message.pendingInteraction && message.pendingInteraction.type === 'speed' && window.PhoenixSpeedInteractive) { window.PhoenixSpeedInteractive.build(); } else if (message.pendingInteraction && message.pendingInteraction.type === 'wheel' && window.PhoenixWheelInteractive) { window.PhoenixWheelInteractive.build(); }";
if (code.indexOf(marker) !== -1) {
  fs.writeFileSync('js/online-client.js', code.replace(marker, marker + insert));
  console.log('Wired interaction display in state handler');
} else {
  console.log('Marker not found in online-client.js');
}
