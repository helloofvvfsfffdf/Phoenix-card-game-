/* These older feature suites model the pre-email database schema. A real
 * PostgREST server rejects missing columns; accepting them would incorrectly
 * advertise the email migration and invalidate every registration fixture. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function rejectMissingEmailColumns(req, url, res) {
  if (req.method !== 'GET' || url.pathname !== '/rest/v1/accounts' ||
      !/\bemail(?:_verified_at)?\b/.test(url.searchParams.get('select') || '')) return false;
  const body = JSON.stringify({ code: '42703', message: 'column accounts.email does not exist', details: null, hint: null });
  res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
  return true;
}

function openState(prefix) {
  const root = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir();
  const directory = fs.mkdtempSync(path.join(root, prefix));
  const file = path.join(directory, 'state.json');
  fs.writeFileSync(file, JSON.stringify({ multiplayerOpen: true, creationLocked: false }));
  return file;
}
module.exports = { rejectMissingEmailColumns, openState };
