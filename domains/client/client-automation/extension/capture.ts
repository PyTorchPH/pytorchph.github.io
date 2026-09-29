// Screenshots of the portal tab for bug reports.
// Module map (caller-first):
//   captureVisibleTab  asks the extension for a JPEG of the current tab, or null
//   isJpegDataUrl      accepts only a JPEG data URL

import { sendExtensionCommand } from "./bridge";
import { emitOperational, extensionSupports, probeExtension } from "./status";

const CAPTURE_TIMEOUT_MS = 15_000;

// Mental model: only an installed extension that offers capture is asked; any failure quietly means "no screenshot".
/** JPEG screenshot of the current portal tab, or null when the extension cannot take one. */
export async function captureVisibleTab(): Promise<string | null> {
  try {
    if (!extensionSupports(await probeExtension(), "capture_visible")) return null;
    const result = await sendExtensionCommand("capture_visible", {}, CAPTURE_TIMEOUT_MS);
    const dataUrl = result.ok && isJpegDataUrl(result.dataUrl) ? result.dataUrl : null;
    emitOperational(dataUrl ? "capture.succeeded" : `capture.${result.code || "failed"}`, dataUrl ? "succeeded" : "failed");
    return dataUrl;
  } catch {
    emitOperational("capture.timeout", "failed");
    return null;
  }
}

function isJpegDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/jpeg;base64,");
}
