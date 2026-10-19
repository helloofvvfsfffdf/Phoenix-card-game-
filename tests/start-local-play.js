/* Separate practice launcher. Never use this as a deployment start command. */
'use strict';
// Do not inherit deterministic regression scenarios into the manual playground.
for (const key of ['PHOENIX_REPRO_RANDOM', 'PHOENIX_REPRO_POINTS', 'PHOENIX_REPRO_CURSED_CARD', 'PHOENIX_REPRO_FINAL_LINK', 'PHOENIX_REPRO_NATURAL_DEAL']) delete process.env[key];
process.argv = [process.execPath, __filename, 'all', '4318'];
process.env.PHOENIX_BIND_HOST = '127.0.0.1';
console.log('Open http://127.0.0.1:4318/tests/local-play.html');
console.log('Practice only. Stop the server with Ctrl+C; close the page to stop its music.');
require('./interactive-local-server');
