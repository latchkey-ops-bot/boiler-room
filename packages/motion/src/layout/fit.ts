export interface FitRequest {
  text: string;
  maxWidth: number;
  maxHeight: number;
  maxSize: number;
  maxLines: number;
  lineHeight: number;
}

export interface FitResult {
  fontSize: number;
  lines: string[];
  /** The height the lines take at this size. */
  height: number;
  /** The width of the longest line at this size. */
  width: number;
}

/** What fitting needs from the browser, kept apart so the choice itself is a pure function. */
export interface TextMeasure {
  /** The largest size at which the text fits the width on `maxLines` lines. */
  fitLines: (maxLines: number) => { fontSize: number; lines: string[] };
  /** The width of a line at a font size. */
  widthOf: (line: string, fontSize: number) => number;
}

function wrap(words: readonly string[], width: number, widthOf: (line: string) => number) {
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (widthOf(next) <= width) {
      line = next;
    } else {
      if (!line || widthOf(word) > width) return undefined;
      lines.push(line);
      line = word;
    }
  }
  return [...lines, line];
}

/** The same words on the same number of lines, as evenly as they go, so no word is left alone. */
function balance(lines: string[], maxWidth: number, widthOf: (line: string) => number): string[] {
  if (lines.length < 2) return lines;
  const words = lines.join(' ').split(' ');
  let best = lines;
  let low = 0;
  let high = maxWidth;
  for (let step = 0; step < 12; step += 1) {
    const middle = (low + high) / 2;
    const wrapped = wrap(words, middle, widthOf);
    if (wrapped && wrapped.length <= lines.length) {
      best = wrapped;
      high = middle;
    } else {
      low = middle;
    }
  }
  return best;
}

/**
 * The largest size that fits the box, trying each line count up to `maxLines`. Fewer lines win a
 * tie. Text is only ever made smaller to fit, so it cannot leave its box or be cropped.
 */
export function fitBlock(request: FitRequest, measure: TextMeasure): FitResult {
  const { maxWidth, maxHeight, maxSize, maxLines, lineHeight } = request;
  let bestSize = 0;
  let bestLines: string[] = [];
  for (let count = 1; count <= maxLines; count += 1) {
    const { fontSize, lines } = measure.fitLines(count);
    if (lines.length === 0) continue;
    const tallest = maxHeight / (lines.length * lineHeight);
    const size = Math.floor(Math.min(fontSize, tallest, maxSize));
    if (size > bestSize) {
      bestSize = size;
      bestLines = lines;
    }
  }
  const widthOf = (line: string) => measure.widthOf(line, bestSize);
  const lines = balance(bestLines, maxWidth, widthOf);
  return {
    fontSize: bestSize,
    lines,
    height: bestSize * lineHeight * lines.length,
    width: Math.max(0, ...lines.map(widthOf)),
  };
}
