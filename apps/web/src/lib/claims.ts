import type { Claim } from '@boiler-room/schema';

/** A number as it is written: 40%, 3x, $29, 1,200. */
const NUMBER = /\$?\d[\d,.]*(?:%|x\b)?/g;

export type ClaimPart = { text: string; claim?: undefined } | { text: string; claim: Claim };

/**
 * Splits a crew message so the numbers it quotes from the customer's own site can wear the claim
 * highlight, with the quote one click away. A number counts only when it is written exactly as in
 * a claim's verbatim quote and reads as a figure (a %, a multiplier, money or thousands), so a count
 * such as "4 scenes" is never mistaken for a claim, and a figure with no source, such as the
 * "73%" the Validator refuses, is never highlighted.
 */
export function splitClaims(text: string, claims: readonly Claim[]): ClaimPart[] {
  const parts: ClaimPart[] = [];
  let last = 0;
  for (const match of text.matchAll(NUMBER)) {
    const figure = trimFigure(match[0]);
    if (!isFigure(figure)) continue;
    const claim = claims.find((candidate) => figuresIn(candidate.quote).includes(figure));
    if (!claim) continue;
    const start = match.index;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: figure, claim });
    last = start + figure.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

function figuresIn(quote: string): string[] {
  return [...quote.matchAll(NUMBER)].map((match) => trimFigure(match[0]));
}

/** "40." at the end of a sentence is 40. */
function trimFigure(figure: string): string {
  return figure.replace(/[.,]+$/, '');
}

function isFigure(figure: string): boolean {
  return /[%x$,]/.test(figure);
}
