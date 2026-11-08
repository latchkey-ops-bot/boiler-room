/**
 * The three beat templates of the `director-beat-templates` skill as data, so code can check a
 * campaign against the template it claims to fill. Frames are at 30 fps. Seam `k` is
 * `scenes[k - 1].transitionOut`; the last row has none.
 */

export const TEMPLATE_NAMES = ['short', 'standard', 'long'] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export const PROOF_TYPES = ['proof-bars', 'stat-counter'] as const;

/** What a row may hold, beside its own type, through a substitution the skill allows. */
export type RowSlot =
  | 'fixed'
  /** A proof row: `proof-bars` or `stat-counter`, one type for the film. */
  | 'proof'
  /** Long row 17: `iso-chain` or `cell-type`. */
  | 'set-piece'
  /** `tile-wall`, which becomes a `feature-card` with fewer than 6 captured tiles. */
  | 'tiles'
  /**
   * `site-scroll`, which becomes a `site-hero` on the best captured screen when the research has
   * no long captures with a CTA box for page 2 to land on.
   */
  | 'tour';

export interface TemplateRow {
  type: string;
  frames: number;
  seam: string | null;
  slot: RowSlot;
  variant?: 'name' | 'pivot';
}

export interface Template {
  name: TemplateName;
  label: 'Short' | 'Standard' | 'Long';
  durationSeconds: number;
  frames: number;
  rows: readonly TemplateRow[];
}

const row = (
  type: string,
  frames: number,
  seam: string | null,
  slot: RowSlot = 'fixed',
  variant?: 'name' | 'pivot',
): TemplateRow => ({ type, frames, seam, slot, ...(variant ? { variant } : {}) });

const proof = (seam: string) => row('proof', 96, seam, 'proof');

export const TEMPLATES: Record<TemplateName, Template> = {
  short: {
    name: 'short',
    label: 'Short',
    durationSeconds: 25,
    frames: 750,
    rows: [
      row('word-slam', 90, 't3'),
      row('logo-reveal', 60, 't1'),
      row('site-hero', 84, 't3'),
      row('type-card', 51, 't1'),
      row('feature-card', 72, 't5'),
      row('feature-card', 72, 't1'),
      proof('t3'),
      row('colour-event', 39, 't3'),
      row('type-card', 48, 't1'),
      row('type-card', 43, 't1', 'fixed', 'name'),
      row('end-card', 95, null),
    ],
  },
  standard: {
    name: 'standard',
    label: 'Standard',
    durationSeconds: 45,
    frames: 1350,
    rows: [
      row('word-slam', 90, 't3'),
      row('logo-reveal', 90, 't1'),
      row('site-hero', 96, 't3'),
      row('type-card', 54, 't3'),
      row('site-scroll', 72, 't1', 'tour'),
      proof('t5'),
      proof('t5'),
      proof('t5'),
      row('type-card', 54, 't1', 'fixed', 'pivot'),
      row('feature-card', 72, 't5'),
      row('feature-card', 72, 't5'),
      row('feature-card', 72, 't5'),
      row('feature-card', 72, 't3'),
      row('tile-wall', 66, 't3', 'tiles'),
      row('colour-event', 42, 't3'),
      row('type-card', 54, 't1'),
      row('type-card', 43, 't1', 'fixed', 'name'),
      row('end-card', 113, null),
    ],
  },
  long: {
    name: 'long',
    label: 'Long',
    durationSeconds: 65,
    frames: 1950,
    rows: [
      row('word-slam', 90, 't3'),
      row('logo-reveal', 90, 't1'),
      row('site-hero', 96, 't3'),
      row('type-card', 54, 't3'),
      row('tile-wall', 72, 't5', 'tiles'),
      row('type-card', 54, 't1', 'fixed', 'pivot'),
      row('type-card', 54, 't3'),
      row('site-scroll', 72, 't1', 'tour'),
      row('status-relay', 60, 't5'),
      row('status-relay', 60, 't5'),
      row('status-relay', 60, 't3'),
      proof('t5'),
      proof('t5'),
      proof('t3'),
      row('rail-words', 63, 't1'),
      row('rail-words', 63, 't3'),
      row('set-piece', 108, 't5', 'set-piece'),
      row('type-card', 54, 't1', 'fixed', 'pivot'),
      row('feature-card', 72, 't5'),
      row('feature-card', 72, 't5'),
      row('feature-card', 72, 't5'),
      row('feature-card', 72, 't5'),
      row('feature-card', 72, 't3'),
      row('colour-event', 42, 't3'),
      row('type-card', 54, 't1'),
      row('type-card', 43, 't1', 'fixed', 'name'),
      row('end-card', 113, null),
    ],
  },
};

export function templateFor(label: string): Template | undefined {
  return TEMPLATES[label.toLowerCase() as TemplateName];
}

/** The first frame of each row. */
export function rowStarts(template: Template): number[] {
  let from = 0;
  return template.rows.map((each) => {
    const start = from;
    from += each.frames;
    return start;
  });
}

/** Seconds as the skill writes them: `frame / 30`, rounded to 6 decimals. */
export const frameSeconds = (frame: number) => Math.round((frame / 30) * 1e6) / 1e6;
