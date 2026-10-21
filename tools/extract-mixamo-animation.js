/* Pull the animation clips out of a Mixamo FBX and write them as a small JSON
 * file.
 *
 * A Mixamo download is about fifty megabytes, almost all of it the model and
 * its textures, which the game already has. The animation is the small part
 * of it, and this script keeps only that: the keyframes, as plain numbers,
 * in a file of a few hundred kilobytes.
 *
 * Run it from the project root:
 *
 *   node tools/extract-mixamo-animation.js "C:/path/Sitting Idle.fbx" \
 *        assets/mixamo/animations/sitting-idle.json
 *
 * The FBX is read from wherever it is; the original is never touched.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * The smallest thing the texture loader can get away with.
 *
 * The animation is parsed before any texture is looked at, and the textures
 * are of no use here, so the loader is given a canvas it can never really
 * draw on. Nothing is downloaded: the embedded images are ignored.
 */
function stubDom() {
  if (globalThis.document) return;
  const image = function () {
    return {
      addEventListener: function () {},
      removeEventListener: function () {},
      set src(value) { this._src = value; },
      get src() { return this._src; }
    };
  };
  globalThis.document = {
    createElementNS: function () { return image(); },
    createElement: function () { return image(); },
    addEventListener: function () {},
    removeEventListener: function () {}
  };
  if (!globalThis.URL.createObjectURL) {
    globalThis.URL.createObjectURL = function () { return 'blob:stub'; };
    globalThis.URL.revokeObjectURL = function () {};
  }
}

/** Turn one AnimationClip into plain numbers. */
function clipToJson(clip) {
  return {
    name: clip.name,
    duration: clip.duration,
    tracks: clip.tracks.map(function (track) {
      return {
        name: track.name,
        type: track.getValueType ? track.getValueType() : 'vector',
        times: Array.from(track.times),
        values: Array.from(track.values)
      };
    })
  };
}

async function main() {
  const source = process.argv[2];
  const target = process.argv[3];
  if (!source || !target) {
    console.error('usage: node tools/extract-mixamo-animation.js <in.fbx> <out.json>');
    process.exit(1);
  }
  if (!fs.existsSync(source)) {
    console.error('There is no file at ' + source);
    process.exit(1);
  }

  stubDom();

  const three = await import(pathToFileURL(path.join(__dirname, '..', 'vendor', 'three', 'three.module.js')).href);
  const { FBXLoader } = await import(pathToFileURL(path.join(__dirname, '..', 'vendor', 'three', 'loaders', 'FBXLoader.js')).href);

  // The file is read into memory and handed to the loader's own parser, so
  // nothing has to be fetched: Node has no file:// fetcher.
  const file = fs.readFileSync(source);
  // The loader wants a plain ArrayBuffer: a Node Buffer reads as an unknown format.
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const url = pathToFileURL(path.resolve(source)).href;

  const group = await new Promise(function (resolve, reject) {
    const loader = new FBXLoader();
    try {
      resolve(loader.parse(buffer, url));
    } catch (error) {
      reject(new Error('The file could not be read: ' +
        (error && error.message ? error.message : 'unknown')));
    }
  });

  const clips = (group.animations || []).filter(function (clip) {
    return clip.tracks && clip.tracks.length > 0;
  });
  if (!clips.length) {
    console.error('That file has no animation in it.');
    process.exit(1);
  }

  const out = {
    source: path.basename(source),
    characters: group.children ? group.children.length : 0,
    clips: clips.map(function (clip) {
      const json = clipToJson(clip);
      // Mixamo calls every download "Take 001"; the file's own name says
      // what the animation actually is.
      json.name = path.basename(source, path.extname(source));
      return json;
    })
  };
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(out));

  const size = fs.statSync(target).size;
  console.log('Wrote ' + target + ' (' + Math.round(size / 1024) + ' KB)');
  clips.forEach(function (clip) {
    console.log('  ' + clip.name + ' - ' + clip.duration.toFixed(2) + 's, ' +
      clip.tracks.length + ' tracks');
  });
}

main().catch(function (error) {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
