/**
 * Direction for copy that is set word by word. The browser orders a line of plain text by the
 * Unicode bidirectional algorithm, but a word set as an `inline-block` box counts as a neutral
 * character, so a line of boxes takes the line's direction alone, and a left-to-right line shows
 * Hebrew or Arabic words in reverse. These say which way a block reads and which way each word
 * does, so the boxes are ordered as their letters would be.
 */

export type Direction = 'ltr' | 'rtl';

export const LRM = '‎';
export const RLM = '‏';

/** Scripts whose letters are strong right-to-left characters. */
const RIGHT_TO_LEFT =
  /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Yezidi}\p{Script=Mende_Kikakui}]/u;
const LETTER = /\p{L}/u;
const DIGIT = /\p{N}/u;

/** The direction of the first letter, which is how a paragraph's direction is found. */
function firstStrong(text: string): Direction | undefined {
  for (const char of text) {
    if (LETTER.test(char)) return RIGHT_TO_LEFT.test(char) ? 'rtl' : 'ltr';
  }
  return undefined;
}

/** Which way a block of copy reads. Copy with no letters at all reads left to right. */
export const textDirection = (text: string): Direction => firstStrong(text) ?? 'ltr';

/**
 * The mark to put on each side of each word's box: an invisible strong character of the word's own
 * direction, so the line orders the boxes as it would order the letters in them. A word with no
 * letters but a number in it follows the letters before it when they read left to right, as a
 * number after Latin letters does, and is otherwise left to the line. Punctuation gets no mark.
 */
export function wordMarks(
  words: readonly string[],
  base: Direction,
): ('' | typeof LRM | typeof RLM)[] {
  let previous = base;
  return words.map((word) => {
    const strong = firstStrong(word);
    if (strong) {
      previous = strong;
      return strong === 'rtl' ? RLM : LRM;
    }
    return DIGIT.test(word) && previous === 'ltr' ? LRM : '';
  });
}
