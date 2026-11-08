import { isAnimated } from './animation.ts';
import type { LogoProbe } from './logo.ts';

const SAMPLE_SIZE = 48;

const toHex = (value: number) => Math.round(value).toString(16).padStart(2, '0');

function loadImage(url: string, crossOrigin: boolean): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = url;
  });
}

/** Channels are rounded to 16 levels, which keeps a logo's palette to a handful of colours. */
const quantize = (channel: number) => Math.min(15, Math.round(channel / 17)) * 17;
const PALETTE_SIZE = 24;

/** Reads the visible pixels, which a host that sends no CORS header does not allow. */
function readPixels(image: HTMLImageElement): Pick<LogoProbe, 'coverage' | 'palette'> {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return {};
  try {
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const weights = new Map<string, number>();
    let ink = 0;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = (data[index + 3] ?? 0) / 255;
      if (alpha === 0) continue;
      const color = `#${[data[index], data[index + 1], data[index + 2]]
        .map((channel) => toHex(quantize(channel ?? 0)))
        .join('')}`.toUpperCase();
      weights.set(color, (weights.get(color) ?? 0) + alpha);
      ink += alpha;
    }
    const coverage = ink / (SAMPLE_SIZE * SAMPLE_SIZE);
    if (ink === 0) return { coverage };
    const palette = [...weights]
      .sort(([a, wa], [b, wb]) => wb - wa || a.localeCompare(b))
      .slice(0, PALETTE_SIZE)
      .map(([color, weight]) => ({ color, share: weight / ink }));
    return { coverage, palette };
  } catch {
    return {};
  }
}

/** Whether the file animates, from its bytes. Undefined when the host will not let them be read. */
async function readAnimated(url: string): Promise<boolean | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    return isAnimated(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return undefined;
  }
}

/** Loads an image to learn its size and, where it is allowed, what it looks like and if it moves. */
export async function probeImage(url: string): Promise<LogoProbe> {
  const readable = await loadImage(url, true);
  const image = readable ?? (await loadImage(url, false));
  if (!image) return { loaded: false };
  const animated = readable ? await readAnimated(url) : undefined;
  return {
    loaded: true,
    width: image.naturalWidth,
    height: image.naturalHeight,
    ...(animated === undefined ? {} : { animated }),
    ...(readable ? readPixels(readable) : {}),
  };
}

export async function fileIsReachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}
