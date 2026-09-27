import { copyFile, mkdir, rm } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await copyFile("manifest.json", "dist/manifest.json");
await copyFile("popup.html", "dist/popup.html");
await copyFile("popup.css", "dist/popup.css");
await rm("dist/.tsbuildinfo", { force: true });
