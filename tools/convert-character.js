/* Convert a Mixamo FBX into a much smaller glTF file.
 *
 * A Mixamo download is about fifty megabytes, almost all of it pictures at
 * four thousand by four thousand. This takes the model, the rig, the clothes
 * and the hair out of the FBX and writes them again as a glTF with the
 * pictures made a sensible size, which the browser can fetch in a moment
 * instead of a coffee break.
 *
 * The conversion is done in a real browser, because that is where the
 * pictures are decoded and where Three's own exporter lives. This script
 * drives a headless browser, takes the result and writes it to disk.
 *
 *   node tools/convert-character.js "C:/path/character.fbx" \
 *        assets/mixamo/characters/ash.glb 1024
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const temp = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Temp', 'opencode');

/** Where the page that does the work is served from. */
const PORT = Number(process.env.PHOENIX_CONVERT_PORT || 4321);

async function main() {
  const source = process.argv[2];
  const target = process.argv[3];
  const limit = Number(process.argv[4] || 1024);
  if (!source || !target) {
    console.error('usage: node tools/convert-character.js <in.fbx> <out.glb> [max texture size]');
    process.exit(1);
  }
  if (!fs.existsSync(source)) {
    console.error('There is no file at ' + source);
    process.exit(1);
  }

  // The file is served from the project so the page can fetch it. It is put
  // in a folder of its own and taken away again afterwards.
  const servedDir = path.join(ROOT, '.convert');
  fs.mkdirSync(servedDir, { recursive: true });
  const served = path.join(servedDir, path.basename(source));
  fs.copyFileSync(source, served);
  const name = path.basename(source);

  const profile = fs.mkdtempSync(path.join(temp, 'phoenix-convert-'));
  const edge = spawn(process.env.BROWSER_EXE ||
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', '--window-size=1280,860',
      '--user-data-dir=' + profile, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });

  let socket;
  let session;
  let serial = 0;
  const pending = new Map();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const call = (method, params, target) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error('CDP timeout ' + method));
    }, 300000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({
      id, method, params,
      ...(target === undefined ? { sessionId: session } : (target ? { sessionId: target } : {}))
    }));
  });

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };

  try {
    const endpoint = await new Promise((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(Error('Edge startup timeout')), 30000);
      edge.once('error', reject);
      edge.stderr.on('data', (data) => {
        text += data;
        const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.on('message', (raw) => {
      const message = JSON.parse(raw);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      message.error ? entry.reject(Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    });

    const pageTarget = await call('Target.createTarget', { url: 'about:blank' }, null);
    session = (await call('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true }, null)).sessionId;
    await call('Runtime.enable');
    await call('Page.enable');

    await call('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/tools/convert-character.html' });
    await evaluate(`new Promise(function (resolve, reject) {
      let n = 0;
      const timer = setInterval(function () {
        if (window.__convert) { clearInterval(timer); resolve(true); }
        else if (n++ > 200) { clearInterval(timer); reject(new Error('the page never loaded')); }
      }, 100);
    })`);

    console.log('Converting ' + name + ' (pictures at most ' + limit + ' across)…');
    const result = await evaluate(
      'window.__convert("/.convert/' + name + '", ' + limit + ')');
    const pageLog = await evaluate("document.getElementById('log').textContent");
    if (pageLog) console.log(pageLog.split('\n').map((l) => '    ' + l).join('\n'));
    if (!result || result.error) {
      throw Error('The conversion failed: ' + (result && result.error ? result.error : 'unknown'));
    }

    const bytes = Buffer.from(result.base64, 'base64');
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    fs.writeFileSync(target, bytes);
    console.log('Wrote ' + target + ' (' + Math.round(bytes.length / 1024) + ' KB, was ' +
      Math.round(fs.statSync(source).size / 1024 / 1024) + ' MB)');
  } finally {
    try { socket && socket.close(); } catch (error) { /* closing anyway */ }
    try { edge.kill(); } catch (error) { /* closing anyway */ }
    try { fs.unlinkSync(served); fs.rmdirSync(servedDir); } catch (error) { /* best effort */ }
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
