// Shrinks big photos before upload: phone photos are often 3-12 MB, which is slow on venue Wi-Fi and
// can hit upload limits. 2000px on the long side keeps small label and discharge-sheet text readable.
const MAX_SIDE = 2000;
const QUALITY = 0.85;
const SMALL_ENOUGH = 1.5 * 1024 * 1024; // files under this with small dimensions are sent as-is

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    // "from-image" applies the photo's rotation (EXIF), so sideways phone photos come out upright
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const img = await decode(file);
    const w = img.width;
    const h = img.height;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    if (scale === 1 && file.size <= SMALL_ENOUGH) {
      if ("close" in img) img.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if ("close" in img) img.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file; // never make it worse
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // a format this browser can't decode (e.g. HEIC on some desktops): let the server try
  }
}