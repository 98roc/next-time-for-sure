import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/** 直接从网页favicon生成桌面PNG和多尺寸ICO，避免两端品牌图形漂移。 */
async function buildIcons() {
  const source = await readFile(join(import.meta.dirname, '../../web/public/favicon.svg'));
  const assets = join(import.meta.dirname, '../assets');
  await writeFile(join(assets, 'logo.svg'), source);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = await Promise.all(sizes.map(size => sharp(source, { density: 384 }).resize(size, size).png().toBuffer()));
  await writeFile(join(assets, 'icon.png'), frames[frames.length - 1]);

  // ICO目录中的每个图像采用PNG编码，256尺寸按ICO格式记为0。
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  for (let index = 0; index < frames.length; index++) {
    const entry = 6 + index * 16;
    header[entry] = sizes[index] % 256;
    header[entry + 1] = sizes[index] % 256;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frames[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frames[index].length;
  }
  await writeFile(join(assets, 'icon.ico'), Buffer.concat([header, ...frames]));
}

void buildIcons().catch(error => { console.error(error); process.exitCode = 1; });
