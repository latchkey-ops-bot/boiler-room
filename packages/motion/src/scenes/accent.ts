import { z } from 'zod';

/**
 * `props.accent`: one phrase of one text item in the accent colour, as word indices with an
 * exclusive end. It is one object, so a scene holds at most one accent phrase.
 */
export const accentSchema = z
  .strictObject({
    textId: z.string().min(1),
    from: z.int().min(0),
    to: z.int().min(1),
  })
  .refine(({ from, to }) => from < to, {
    message: 'accent.to must be greater than accent.from: the phrase runs from `from` up to `to`',
    path: ['to'],
  });

export type Accent = z.infer<typeof accentSchema>;

export const isAccented = (accent: Accent | undefined, textId: string, word: number): boolean =>
  accent !== undefined && accent.textId === textId && word >= accent.from && word < accent.to;
