const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
const old = "    let result;\n    if (pi.type === 'rps') result = resolveRpsInteraction(room, pi);\n    else if (pi.type === 'betrayal') result = resolveBetrayalInteraction(room, pi);";
const neu = "    let result;\n    try {\n      if (pi.type === 'rps') result = resolveRpsInteraction(room, pi);\n      else if (pi.type === 'betrayal') result = resolveBetrayalInteraction(room, pi);\n    } catch (e) {\n      console.error('[PHOENIX interactive] resolution error:', e);\n      result = { ok: true, events: [{ type: 'result', cardId: pi.type, text: 'Interactive card resolved.' }], advanceTurn: true };\n    }";
if (c.indexOf(old) !== -1) {
  c = c.replace(old, neu);
  fs.writeFileSync('server.js', c);
  console.log('Wrapped interaction resolution');
} else {
  console.log('Pattern not found');
}
