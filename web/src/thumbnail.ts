// Small square thumbnail of a scanned label for the Cabinet card. Stays on the device:
// it is stored apart from the medication data, so it is never sent to the API.
export async function makeThumbnail(file: File, size = 160): Promise<string | null> {
  try {
    const img = await createImageBitmap(file, { imageOrientation: "from-image" });
    const side = Math.min(img.width, img.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Center crop to a square, then scale down
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    img.close();
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null; // e.g. a HEIC photo this browser can't decode: the card shows an icon instead
  }
}
