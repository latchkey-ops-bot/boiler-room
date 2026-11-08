import type { CSSProperties } from 'react';
import { wordRise } from '../core/curves.ts';
import { textDirection } from '../layout/bidi.ts';
import { rise as rises } from '../tokens.ts';
import { useScene } from './scene-runtime.tsx';
import { specPx } from './type.tsx';

/**
 * Lines of copy whose words pop in at full opacity and rise into place on `wordRise`, one frame
 * apart, from `start`: the T3 entry and every word rise in the library. Each word is an
 * inline-block span transformed on its own, so the line's layout never changes as words arrive.
 * Put it inside the element that sets the font, size and position of the block.
 */
export const RisingWords = ({
  lines,
  f,
  start = 0,
  stagger = 1,
  rise = rises.short,
  colorOf,
}: {
  /** The fitted lines, in reading order. */
  lines: readonly string[];
  /** Spec frames from the scene's start. */
  f: number;
  /** The spec frame the first word appears on. */
  start?: number;
  stagger?: number;
  rise?: { rise: number; k: number };
  /** A colour for word `index` of the whole block, counted from 0, such as the accent. */
  colorOf?: (index: number) => string | undefined;
}) => {
  const { stage } = useScene();
  // Each word's index in the whole block, which also keys each line by its first word.
  let next = 0;
  const blocks = lines.map((line) => ({
    line,
    words: line.split(' ').map((word) => {
      next += 1;
      return { word, index: next - 1 };
    }),
  }));
  return (
    <>
      {blocks.map(({ line, words }) => (
        <div
          key={`line-${words[0]?.index ?? 0}`}
          style={{ direction: textDirection(line), whiteSpace: 'pre' }}
        >
          {words.map(({ word, index }, position) => {
            const { visible, y } = wordRise(f - start, index, stagger, rise.rise, rise.k);
            const color = colorOf?.(index);
            const style: CSSProperties = {
              display: 'inline-block',
              opacity: visible ? 1 : 0,
              transform: `translateY(${specPx(stage, y)}px)`,
              ...(color ? { color } : {}),
            };
            return (
              <span key={`${word}-${index}`}>
                {position > 0 ? ' ' : ''}
                <span style={style}>{word}</span>
              </span>
            );
          })}
        </div>
      ))}
    </>
  );
};
