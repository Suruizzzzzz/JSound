const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Standard CRC32 table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function encodePNG(w, h, rgbaBuffer) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const scanlines = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    const rowOffset = y * (w * 4 + 1);
    scanlines[rowOffset] = 0; // filter 0 (None)
    rgbaBuffer.copy(scanlines, rowOffset + 1, y * w * 4, (y + 1) * w * 4);
  }

  const idatData = zlib.deflateSync(scanlines, { level: 9 });
  return Buffer.concat([
    sig,
    writeChunk('IHDR', ihdr),
    writeChunk('IDAT', idatData),
    writeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function decodePNG(filePath) {
  const buf = fs.readFileSync(filePath);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  let pos = 8;
  const idats = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') {
      idats.push(buf.subarray(pos + 8, pos + 8 + len));
    }
    pos += 12 + len;
  }
  const decompressed = zlib.inflateSync(Buffer.concat(idats));
  return { w, h, decompressed };
}

function getAlphaMask(filePath) {
  const { w, h, decompressed } = decodePNG(filePath);
  const alphaMask = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const rowOffset = y * (w * 4 + 1) + 1;
    for (let x = 0; x < w; x++) {
      const idx = rowOffset + x * 4;
      alphaMask[y * w + x] = decompressed[idx + 3] / 255.0;
    }
  }
  return { w, h, alphaMask };
}

function generateMonochromeImage({
  w = 1024,
  h = 1024,
  alphaMask,
  srcW,
  srcH,
  scale = 1.0,
  bg = [247, 247, 245, 255], // #F7F7F5
  fg = [20, 20, 19],          // #141413 obsidian
  transparentBg = false,
}) {
  const out = Buffer.alloc(w * h * 4);
  const centerX = w / 2;
  const centerY = h / 2;
  const srcCenterX = srcW / 2;
  const srcCenterY = srcH / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Map to source coordinate with scaling
      const srcX = (x - centerX) / scale + srcCenterX;
      const srcY = (y - centerY) / scale + srcCenterY;

      let a = 0;
      if (srcX >= 0 && srcX < srcW - 1 && srcY >= 0 && srcY < srcH - 1) {
        // Bilinear interpolation for crisp smooth edges
        const x0 = Math.floor(srcX);
        const y0 = Math.floor(srcY);
        const x1 = x0 + 1;
        const y1 = y0 + 1;
        const wx1 = srcX - x0;
        const wx0 = 1 - wx1;
        const wy1 = srcY - y0;
        const wy0 = 1 - wy1;

        const a00 = alphaMask[y0 * srcW + x0];
        const a10 = alphaMask[y0 * srcW + x1];
        const a01 = alphaMask[y1 * srcW + x0];
        const a11 = alphaMask[y1 * srcW + x1];

        a = wx0 * (wy0 * a00 + wy1 * a01) + wx1 * (wy0 * a10 + wy1 * a11);
      }

      const outIdx = (y * w + x) * 4;
      if (transparentBg) {
        out[outIdx] = fg[0];
        out[outIdx + 1] = fg[1];
        out[outIdx + 2] = fg[2];
        out[outIdx + 3] = Math.round(a * 255);
      } else {
        const bgA = bg[3] / 255;
        const r = Math.round(bg[0] * (1 - a) + fg[0] * a);
        const g = Math.round(bg[1] * (1 - a) + fg[1] * a);
        const b = Math.round(bg[2] * (1 - a) + fg[2] * a);
        out[outIdx] = r;
        out[outIdx + 1] = g;
        out[outIdx + 2] = b;
        out[outIdx + 3] = Math.round(bgA * 255);
      }
    }
  }
  return encodePNG(w, h, out);
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const srcLogo = path.join(root, 'assets', 'images', 'logo-light.png');
  console.log('Reading source monogram from:', srcLogo);
  const { w: srcW, h: srcH, alphaMask } = getAlphaMask(srcLogo);

  const imagesDir = path.join(root, 'assets', 'images');

  // 1. icon.png (1024x1024): Warm paper background #F7F7F5 with centered obsidian #141413 monogram
  console.log('Generating icon.png...');
  const iconPng = generateMonochromeImage({
    w: 1024,
    h: 1024,
    alphaMask,
    srcW,
    srcH,
    scale: 1.15, // slightly bolder presence while keeping ample breathing room
    bg: [247, 247, 245, 255],
    fg: [20, 20, 19],
    transparentBg: false,
  });
  const iconPath = path.join(imagesDir, 'icon.png');
  fs.writeFileSync(iconPath, iconPng);
  console.log('Saved:', iconPath, `${iconPng.length} bytes`);

  // 2. adaptive-icon.png (1024x1024): Safe zone compliant (inner 66%) on #F7F7F5 background
  console.log('Generating adaptive-icon.png...');
  const adaptivePng = generateMonochromeImage({
    w: 1024,
    h: 1024,
    alphaMask,
    srcW,
    srcH,
    scale: 1.0, // perfect 1.0 scale leaves generous padding for Android squircle/circle masks
    bg: [247, 247, 245, 255],
    fg: [20, 20, 19],
    transparentBg: false,
  });
  const adaptivePath = path.join(imagesDir, 'adaptive-icon.png');
  fs.writeFileSync(adaptivePath, adaptivePng);
  console.log('Saved:', adaptivePath, `${adaptivePng.length} bytes`);

  // 3. splash-icon.png (1024x1024): Minimalist JS monogram for native splash screen
  console.log('Generating splash-icon.png...');
  const splashPng = generateMonochromeImage({
    w: 1024,
    h: 1024,
    alphaMask,
    srcW,
    srcH,
    scale: 1.0,
    bg: [247, 247, 245, 255],
    fg: [20, 20, 19],
    transparentBg: false,
  });
  const splashPath = path.join(imagesDir, 'splash-icon.png');
  fs.writeFileSync(splashPath, splashPng);
  console.log('Saved:', splashPath, `${splashPng.length} bytes`);

  console.log('All icons generated successfully!');
}

main().catch((err) => {
  console.error('Generation failed:', err);
  process.exit(1);
});
