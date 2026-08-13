'use strict';

/**
 * Build the app icon from the DSH web frontend favicon (the DeepSeek whale).
 * Rasterizes the vector to PNG with a solid black fill and wraps a 256px PNG
 * in a single-image ICO container (Windows scales it down as needed).
 *
 * Run: node scripts/build-icon.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

/** Wrap one 256x256 PNG buffer in a valid ICO container. */
function pngToIco(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0); // width: 0 means 256
  entry.writeUInt8(0, 1); // height: 0 means 256
  entry.writeUInt8(0, 2); // palette count
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // image size
  entry.writeUInt32LE(header.length + entry.length, 12); // image offset

  return Buffer.concat([header, entry, pngBuffer]);
}

(async () => {
  const src = path.join(
    __dirname,
    '..',
    'node_modules',
    '@deepseek-ai',
    'dsh-web-frontend',
    'dist',
    'favicon.svg'
  );
  let svg = fs.readFileSync(src, 'utf8');

  // The favicon is transparent-by-default with a dark-mode white override.
  // Force a solid black whale: drop the media-query style and turn the root's
  // inherited `fill="none"` into black, leaving the path data untouched.
  svg = svg.replace(/<style>[\s\S]*?<\/style>/, '');
  svg = svg.replace('fill="none"', 'fill="#000000"');

  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'whale.svg'), svg);

  // Rasterize once at high resolution, then downscale for each target size.
  const rendered = await sharp(Buffer.from(svg), { density: 1440 }).png().toBuffer();

  const png512 = await sharp(rendered).resize(512, 512).png().toBuffer();
  fs.writeFileSync(path.join(outDir, 'icon.png'), png512);

  const png256 = await sharp(rendered).resize(256, 256).png().toBuffer();
  fs.writeFileSync(path.join(outDir, 'icon.ico'), pngToIco(png256));

  console.log(`wrote ${path.join(outDir, 'icon.png')}`);
  console.log(`wrote ${path.join(outDir, 'icon.ico')}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
