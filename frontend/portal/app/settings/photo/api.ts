export const MAX_PHOTO_BYTES = 384 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_ENDPOINT = "/api/member/organization-photo";
type PhotoOperation = "load" | "upload" | "remove";

export class PhotoRequestError extends Error {
  constructor(
    public readonly operation: PhotoOperation,
    public readonly status: number | null,
  ) {
    super(photoErrorMessage(operation, status));
    this.name = "PhotoRequestError";
  }
}

export async function readPhoto(
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<Blob | null> {
  const response = await requestPhoto("load", {
    method: "GET", signal,
  }, request);
  if (response.status === 404) return null;
  let photo: Blob;
  try {
    photo = await response.blob();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw photoFailure("load", null);
  }
  if (!PHOTO_TYPES.includes(photo.type.split(";")[0]) || photo.size === 0) {
    throw photoFailure("load", 502);
  }
  return photo;
}

export async function uploadPhoto(
  photo: File,
  request: typeof fetch = fetch,
): Promise<void> {
  if (!PHOTO_TYPES.includes(photo.type) || photo.size === 0) {
    throw photoFailure("upload", 400);
  }
  if (photo.size > MAX_PHOTO_BYTES) throw photoFailure("upload", 413);
  await requestPhoto("upload", {
    method: "PUT", headers: { "Content-Type": photo.type }, body: photo,
  }, request);
}

export async function removePhoto(
  request: typeof fetch = fetch,
): Promise<void> {
  await requestPhoto("remove", { method: "DELETE" }, request);
}

// Mental model: use the authenticated portal bridge, then expose only bounded status diagnostics.
async function requestPhoto(
  operation: PhotoOperation,
  init: RequestInit,
  request: typeof fetch,
): Promise<Response> {
  let response: Response;
  try {
    const path = operation === "load" ? "/api/member/self-photo" : PHOTO_ENDPOINT;
    response = await request(path, { ...init, credentials: "include", cache: "no-store" });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw photoFailure(operation, null);
  }
  if (!response.ok && !(operation === "load" && response.status === 404)) {
    throw photoFailure(operation, response.status);
  }
  return response;
}

function photoFailure(
  operation: PhotoOperation,
  status: number | null,
): PhotoRequestError {
  console.warn({ event: "portal.photo.request_failed", component: "profile-photo", operation, status });
  return new PhotoRequestError(operation, status);
}

function photoErrorMessage(
  operation: PhotoOperation,
  status: number | null,
): string {
  const action = operation === "load" ? "ma-load" : operation === "upload" ? "ma-save" : "ma-remove";
  const prefix = `Hindi ${action} ang profile photo`;
  if (status === null) return `${prefix}. Tingnan ang connection mo at subukan ulit.`;
  if (status === 401) return `${prefix} (401). Mag-sign in ulit bago subukan muli.`;
  if (status === 403) return `${prefix} (403). Hindi pinayagan ang request; i-refresh ang session mo.`;
  if (status === 413) return `${prefix} (413). Gumamit ng photo na hindi lalampas sa 384 KB.`;
  if (operation === "upload" && [400, 415, 422].includes(status)) {
    return `${prefix} (${status}). Gumamit ng valid JPEG, PNG, o WebP na hindi lalampas sa 384 KB.`;
  }
  if (status === 429) return `${prefix} (429). Masyadong maraming request; maghintay bago subukan ulit.`;
  if ([502, 503, 504].includes(status)) return `${prefix} (${status}). Hindi available ang photo service ngayon; subukan ulit mamaya.`;
  return `${prefix} (${status}). Subukan ulit; kung hindi pa rin gumana, i-report ang status na ito.`;
}
