import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url));
for (const size of [192, 512]) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(new URL(`../public/icon-${size}.png`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
}
console.log('ícones gerados');
