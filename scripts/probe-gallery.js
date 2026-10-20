/* Probe: what the gallery page says when it is not ready. */
'use strict';
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'js', 'card-effects-gallery.js'), 'utf8');
const i = s.indexOf("Play all '+cards.length");
console.log(JSON.stringify(s.slice(Math.max(0, i - 200), i + 200)));
const j = s.indexOf("/' +cards.length");
console.log(JSON.stringify(s.slice(Math.max(0, j - 200), j + 200)));
