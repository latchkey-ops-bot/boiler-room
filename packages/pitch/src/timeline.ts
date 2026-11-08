import { z } from 'zod';
import raw from '../timeline.json';

const Span = z.object({
  id: z.string().min(1),
  start: z.number().min(0),
  end: z.number().positive(),
});

const TimelineSchema = z.object({
  fps: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  finishedFilm: z.object({ file: z.string().min(1), site: z.string().min(1) }),
  montage: z.array(
    z.object({ file: z.string().min(1), site: z.string().min(1), from: z.number().min(0) }),
  ),
  sections: z.array(Span.extend({ scenes: z.array(Span).min(1) })).min(1),
});

export type Timeline = z.infer<typeof TimelineSchema>;
export type Scene = Timeline['sections'][number]['scenes'][number];

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * Parses timeline.json and checks that it is one unbroken strip: sections start at 0 and follow
 * each other, and each section's scenes fill it exactly. Retiming is editing that file, so a gap or
 * an overlap stops the render instead of leaving a black hole in the film.
 */
export function checkTimeline(input: unknown): Timeline {
  const parsed = TimelineSchema.parse(input);
  let cursor = 0;
  for (const section of parsed.sections) {
    if (!near(section.start, cursor)) {
      throw new Error(
        `timeline.json: section ${section.id} starts at ${section.start}, not ${cursor}`,
      );
    }
    let inner = section.start;
    for (const scene of section.scenes) {
      if (!near(scene.start, inner)) {
        throw new Error(`timeline.json: scene ${scene.id} starts at ${scene.start}, not ${inner}`);
      }
      if (scene.end <= scene.start) {
        throw new Error(`timeline.json: scene ${scene.id} ends before it starts`);
      }
      inner = scene.end;
    }
    if (!near(inner, section.end)) {
      throw new Error(
        `timeline.json: the scenes of ${section.id} end at ${inner}, not ${section.end}`,
      );
    }
    cursor = section.end;
  }
  return parsed;
}

export const timeline = checkTimeline(raw);

export const allScenes = (t: Timeline = timeline): Scene[] => t.sections.flatMap((s) => s.scenes);

export const totalSeconds = (t: Timeline = timeline): number => t.sections.at(-1)?.end ?? 0;
