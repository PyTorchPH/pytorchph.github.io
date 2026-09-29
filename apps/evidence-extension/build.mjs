import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { crc32, deflateRawSync } from "node:zlib";

const ICON_SIZES = [16, 32, 48, 128];
// Exactly what ships to the Chrome Web Store; nothing else in dist is packaged.
const PACKAGE_FILES = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "background.js",
  "portal-bridge.js",
  "source-collector.js",
  "local-ai.js",
  "popup.js",
  ...ICON_SIZES.map((size) => `icons/icon-${size}.png`),
];

await mkdir("dist/icons", { recursive: true });
await copyFile("manifest.json", "dist/manifest.json");
await copyFile("popup.html", "dist/popup.html");
await copyFile("popup.css", "dist/popup.css");
for (const size of ICON_SIZES) await copyFile(`icons/icon-${size}.png`, `dist/icons/icon-${size}.png`);
await rm("dist/.tsbuildinfo", { force: true });

if (process.argv.includes("--package")) {
  const { version } = JSON.parse(await readFile("manifest.json", "utf8"));
  const target = `dist/pytorch-ph-evidence-collector-${version}.zip`;
  await writeFile(target, await zip(PACKAGE_FILES));
  console.log(JSON.stringify({ event: "extension.packaged", outcome: "success", file: target, files: PACKAGE_FILES.length }));
}

// Minimal ZIP writer (deflate, no directories) so packaging needs no extra dependency.
async function zip(names) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of names) {
    const data = await readFile(`dist/${name}`);
    const compressed = deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(name, "utf8");
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(0, 10);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    locals.push(header, nameBytes, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += header.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
