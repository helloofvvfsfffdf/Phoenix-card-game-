/* One-shot: what is inside the Mixamo FBX, and how big are the pictures? */
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'assets', 'mixamo', 'character.fbx');
const buf = fs.readFileSync(file);

// The PNG signature, and the JPEG one.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let offset = 0;
let count = 0;
let total = 0;
while (offset < buf.length - 8) {
  const at = buf.indexOf(PNG, offset);
  if (at === -1) break;
  // The IHDR chunk: the width and the height are big-endian, four bytes each.
  const width = buf.readUInt32BE(at + 16);
  const height = buf.readUInt32BE(at + 20);
  // The picture runs to the IEND chunk.
  const end = buf.indexOf(Buffer.from('IEND'), at);
  const size = end === -1 ? 0 : end - at + 8;
  count++;
  total += size;
  console.log('  ' + width + 'x' + height + '  ' + Math.round(size / 1024) + ' KB');
  offset = at + 8;
}
console.log(file + ': ' + count + ' pictures, ' + Math.round(total / 1024 / 1024) + ' MB of ' +
  Math.round(buf.length / 1024 / 1024) + ' MB');
