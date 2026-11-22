const fs = require('fs');
const { PNG } = require('pngjs');

const data = fs.readFileSync('promo-shots/screen_current.png');
const png = PNG.sync.read(data);
console.log('Dimensions:', png.width, 'x', png.height);

for (let y = 2000; y < 2300; y += 10) {
  const idx = (png.width * y + 300) << 2;
  const r = png.data[idx];
  const g = png.data[idx + 1];
  const b = png.data[idx + 2];
  console.log(`y=${y}: rgb(${r},${g},${b})`);
}
