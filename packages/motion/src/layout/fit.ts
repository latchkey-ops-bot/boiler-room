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
  /** The width of a line at a font size. */
  widthOf: (line: string, fontSize: number) => number;
}

/** A run of copy a line may end after. `space` is whether a space follows it in the copy. */
interface Piece {
  text: string;
  space: boolean;
}

// One locale for every machine, so the same copy always breaks in the same places. Word breaks in
// Chinese, Japanese and Thai come from ICU's dictionaries, which do not depend on the locale.
const words = new Intl.Segmenter('und', { granularity: 'word' });
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });

/** Scripts written without spaces, where a line may break between words. */
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
/** A hyphen or slash inside a word, after which a compound may break. */
const JOINER = /[\p{L}\p{N}][-‐‑‒–—/]$/u;
/** Punctuation that may not start a line, such as a comma, a full stop or a closing bracket. */
const CLOSING = /^[\p{Pe}\p{Pf}\p{Po}]/u;
/** Punctuation that may not end one, such as an opening bracket or quote. */
const OPENING = /[\p{Ps}\p{Pi}]$/u;

function mayBreakBetween(before: string, after: string): boolean {
  if (CLOSING.test(after) || OPENING.test(before)) return false;
  if (JOINER.test(before)) return /^[\p{L}\p{N}]/u.test(after);
  const last = [...before].at(-1) ?? '';
  const first = [...after][0] ?? '';
  return UNSPACED.test(last) || UNSPACED.test(first);
}

/** A word cut where a line may break inside it: after a hyphen, or between words of Chinese. */
function splitWord(word: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const { segment } of words.segment(word)) {
    if (current && mayBreakBetween(current, segment)) {
      parts.push(current);
      current = segment;
    } else {
      current += segment;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** The copy as the runs a line may end after. A line breaks at a space, and inside a word only as `splitWord` allows. */
export function breakPieces(text: string): Piece[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => {
      const parts = splitWord(word);
      return parts.map((part, index) => ({ text: part, space: index === parts.length - 1 }));
    });
}

const joined = (pieces: readonly Piece[]) =>
  pieces
    .map(({ text, space }, index) => (index > 0 && pieces[index - 1]?.space ? ` ${text}` : text))
    .join('');

/** Fills lines in order. Undefined when one piece is wider than a line on its own. */
function wrap(
  pieces: readonly Piece[],
  width: number,
  widthOf: (line: string) => number,
): string[] | undefined {
  const lines: string[] = [];
  let line: Piece[] = [];
  for (const piece of pieces) {
    const next = [...line, piece];
    if (widthOf(joined(next)) <= width) {
      line = next;
    } else {
      if (line.length === 0 || widthOf(piece.text) > width) return undefined;
      lines.push(joined(line));
      line = [piece];
    }
  }
  return line.length > 0 ? [...lines, joined(line)] : lines;
}

/** The largest whole size, up to `maxSize`, at which the pieces fill at most `count` lines. */
function largestSizeOn(
  pieces: readonly Piece[],
  count: number,
  { maxWidth, maxSize }: FitRequest,
  measure: TextMeasure,
): { fontSize: number; lines: string[] } {
  const linesAt = (size: number) => wrap(pieces, maxWidth, (line) => measure.widthOf(line, size));
  let low = 1;
  let high = Math.floor(maxSize);
  let best: { fontSize: number; lines: string[] } = { fontSize: 0, lines: [] };
  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    const lines = linesAt(size);
    if (lines && lines.length <= count) {
      best = { fontSize: size, lines };
      low = size + 1;
    } else {
      high = size - 1;
    }
  }
  return best;
}

/**
 * The largest size that fits the box, trying each line count up to `maxLines`. Fewer lines win a
 * tie. Text is only ever made smaller to fit, so it cannot leave its box or be cropped.
 */
function fitPieces(pieces: readonly Piece[], request: FitRequest, measure: TextMeasure) {
  const { maxHeight, maxSize, maxLines, lineHeight } = request;
  let bestSize = 0;
  let bestLines: string[] = [];
  for (let count = 1; count <= maxLines; count += 1) {
    const { fontSize, lines } = largestSizeOn(pieces, count, request, measure);
    if (lines.length === 0) continue;
    const tallest = maxHeight / (lines.length * lineHeight);
    const size = Math.floor(Math.min(fontSize, tallest, maxSize));
    if (size > bestSize) {
      bestSize = size;
      bestLines = lines;
    }
  }
  return { fontSize: bestSize, lines: bestLines };
}

/** The same pieces on the same number of lines, as evenly as they go, so no word is left alone. */
function balance(
  pieces: readonly Piece[],
  lines: string[],
  maxWidth: number,
  widthOf: (line: string) => number,
): string[] {
  if (lines.length < 2) return lines;
  let best = lines;
  let low = 0;
  let high = maxWidth;
  for (let step = 0; step < 12; step += 1) {
    const middle = (low + high) / 2;
    const wrapped = wrap(pieces, middle, widthOf);
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
 * Below this share of its role's size, a word too long for the line is broken between characters
 * instead, as `overflow-wrap: anywhere` does: a headline set smaller than its own subhead, or a
 * subhead set as a hairline, is worse than a word on two lines.
 */
const SMALLEST_SHARE = 1 / 3;

/**
 * Fits copy to a box. Lines break at spaces, after a hyphen inside a compound, and between words of
 * Chinese, Japanese and Thai, which have no spaces, but never before closing punctuation. A word
 * that still could not be set above a third of the role's size is broken between its characters.
 */
export function fitBlock(request: FitRequest, measure: TextMeasure): FitResult {
  const { maxWidth, maxSize } = request;
  const pieces = breakPieces(request.text);
  let best = { pieces, ...fitPieces(pieces, request, measure) };
  const smallest = Math.floor(maxSize * SMALLEST_SHARE);
  if (best.fontSize < smallest) {
    const tooLong = (piece: Piece) => measure.widthOf(piece.text, smallest) > maxWidth;
    if (pieces.some(tooLong)) {
      const broken = pieces.flatMap((piece) => {
        if (!tooLong(piece)) return [piece];
        const characters = [...graphemes.segment(piece.text)].map(({ segment }) => segment);
        return characters.map((text, index) => ({
          text,
          space: index === characters.length - 1 && piece.space,
        }));
      });
      const fit = fitPieces(broken, request, measure);
      if (fit.fontSize > best.fontSize) best = { pieces: broken, ...fit };
    }
  }
  const widthOf = (line: string) => measure.widthOf(line, best.fontSize);
  const lines = balance(best.pieces, best.lines, maxWidth, widthOf);
  return {
    fontSize: best.fontSize,
    lines,
    height: best.fontSize * request.lineHeight * lines.length,
    width: Math.max(0, ...lines.map(widthOf)),
  };
}
