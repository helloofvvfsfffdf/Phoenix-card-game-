const fs = require('fs');
const code = fs.readFileSync('js/online-client.js', 'utf8');
const marker = "        render();\n        if (window.PhoenixMatchShowcase)";
const neu = "        render();\n        if (message.pendingInteraction) {\n          const pi = message.pendingInteraction;\n          if (pi.type === 'rps' && window.PhoenixRpsInteractive) window.PhoenixRpsInteractive.build();\n          else if (pi.type === 'betrayal' && window.PhoenixBetrayalInteractive) window.PhoenixBetrayalInteractive.build();\n          else if (pi.type === 'speed' && window.PhoenixSpeedInteractive) window.PhoenixSpeedInteractive.build();\n          else if (pi.type === 'wheel' && window.PhoenixWheelInteractive) window.PhoenixWheelInteractive.build();\n        }\n        if (window.PhoenixMatchShowcase)";
if (code.includes(marker)) {
  fs.writeFileSync('js/online-client.js', code.replace(marker, neu));
  console.log('Wired interactive display on state message');
} else {
  console.log('Marker not found in online-client');
}
