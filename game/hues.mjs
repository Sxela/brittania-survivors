// The source client supplies one 256-color ramp per hue, indexed by red.
// Keep alpha untouched; partial hues recolor grayscale pixels only.
export function hueIdentity(value, partial = false) {
  const raw = Number.isInteger(value) ? value & 0xffff : 0;
  return {
    id: raw & 0x3fff,
    partial: partial || Boolean(raw & 0x8000),
    spectral: Boolean(raw & 0x4000),
  };
}

export function applyHue(pixels, palette, partial = false) {
  if (!palette?.length) return pixels;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const r = pixels[i],
      g = pixels[i + 1],
      b = pixels[i + 2];
    if (partial && (r !== g || r !== b)) continue;
    const color = palette[Math.floor((r * (palette.length - 1)) / 255)];
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
  }
  return pixels;
}

// Spectral hue is a shadow/transparency mode, corroborated against ClassicUO.
export function applySpectral(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] * Math.max(0, 1 - (pixels[i] / 255) * 1.5);
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
    pixels[i + 3] = alpha;
  }
  return pixels;
}
