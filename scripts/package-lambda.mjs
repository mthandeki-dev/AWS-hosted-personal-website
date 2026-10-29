/** Dependency-free, deterministic ZIP writer for the four Lambda runtime files.
 * Uses standard ZIP STORE entries. No .env, frontend, tests, or tools can enter.
 * Rebuild after every backend runtime change: npm run package:lambda.
 */
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RUNTIME_FILES = Object.freeze([
  'handler.mjs', 'chat.mjs', 'knowledge.json', 'system-instruction.txt',
]);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function buildPackage(root = projectRoot) {
  const files = [];
  const directory = [];
  let offset = 0;
  for (const name of RUNTIME_FILES) {
    const bytes = await readFile(resolve(root, 'backend', name));
    const filename = Buffer.from(name, 'utf8');
    if (bytes.length > 0xffffffff) throw new Error('Runtime file exceeds ZIP32 size.');
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // ZIP 2.0.
    header.writeUInt16LE(0x0800, 6); // UTF-8 names; stored without compression.
    header.writeUInt16LE(33, 12); // Fixed DOS date: 1980-01-01, for repeatable output.
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    files.push(header, filename, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const centralBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(RUNTIME_FILES.length, 8);
  end.writeUInt16LE(RUNTIME_FILES.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...files, centralBytes, end]);
  const destination = resolve(root, 'deploy', 'chat.zip');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination + '.tmp', archive);
  await rename(destination + '.tmp', destination);
  return destination;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const destination = await buildPackage();
    console.log(`Created ${destination}`);
    console.log(`ZIP root: ${RUNTIME_FILES.join(', ')}`);
    console.log('No API keys, .env, frontend, tests, or development tools included.');
  } catch (error) {
    console.error(`Packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
