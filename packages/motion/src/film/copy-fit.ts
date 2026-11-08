/**
 * Copy a template refuses to set. motion never sets type smaller to make copy fit, so a type-card
 * line, a feature-card headline, or a stat-counter number and label, that does not fit at its cap
 * height stops the render with `TYPE_CARD_LAYOUT` or `LAYOUT_UNFIT`. Neither `validateCampaign`
 * nor `validateFilm` measures type, because measuring needs the brand fonts loaded in a browser.
 *
 * `copyFitIssues` measures every such scene of the cut in the page where `calculateMetadata` runs,
 * which the render service opens on its own machine before any computer exists, so one refusal
 * names every scene to shorten and costs no render. `layoutRefusals` reads the same refusals out of
 * the text of a render that failed, for the cases that still reach a computer.
 */
import { type Campaign, sceneFrames } from '@boiler-room/schema';
import { loadBrandFonts } from '../brand/fonts.ts';
import { themeFonts } from '../brand/theme.ts';
import { specFrame } from '../core/curves.ts';
import { FORMAT_SIZES, type Format, stageFor } from '../layout/stage.ts';
import { fitCardHeadline, headlineProblem, headlineWidth } from '../scenes/feature-card.tsx';
import { definitionOf } from '../scenes/registry.ts';
import {
  accentProblem,
  layoutProblems,
  type StatCounterProps,
  statLayout,
} from '../scenes/stat-counter.tsx';
import {
  TypeCardLayoutError,
  type TypeCardProps,
  typeCardLayout,
  variantOf,
} from '../scenes/type-card.tsx';
import type { FilmIssue } from './validate-film.ts';

/** Where a refusal starts: a type card names its scene or text, a stat-counter its code. */
const REFUSAL = /TYPE_CARD_LAYOUT at (?:scene|text) "|LAYOUT_UNFIT: /g;

/**
 * Every refusal in some text, once each: a render's output, an error message, a log. Each starts
 * at its code and runs to the end of its line, or to the next refusal or numbered item on it, so a
 * rejection printed on one line still gives one refusal per scene. The same refusal comes back
 * from every computer that drew the scene, and from every tab, so repeats are dropped.
 */
export function layoutRefusals(text: string): string[] {
  const found = new Set<string>();
  for (const line of text.split('\n')) {
    const starts = [...line.matchAll(REFUSAL)].map((match) => match.index);
    for (const [index, start] of starts.entries()) {
      let piece = line.slice(start, starts[index + 1] ?? line.length);
      const item = /\s\(\d+\)\s/.exec(piece);
      if (item) piece = piece.slice(0, item.index);
      piece = piece.trim();
      if (piece) found.add(piece);
    }
  }
  return [...found];
}

/**
 * The copy of the cut that its templates would refuse to set, one issue per scene, measured with
 * the brand fonts loaded. It needs a browser: `prepareFilm` runs it as part of the default probe.
 */
export async function copyFitIssues(campaign: Campaign, format: Format): Promise<FilmIssue[]> {
  await loadBrandFonts(campaign);
  const { width, height } = FORMAT_SIZES[format];
  const stage = stageFor(width, height);
  const fonts = themeFonts(campaign.brand);
  const { fps, scenes: frames } = sceneFrames(campaign);
  const issues: FilmIssue[] = [];
  for (const [index, scene] of campaign.scenes.entries()) {
    const path = `scenes[${index}]`;
    const parsed = definitionOf(scene.type)?.props.safeParse(scene.props);
    // A scene whose props do not parse is validateFilm's to refuse, which it already has.
    if (!parsed?.success) continue;
    if (scene.type === 'type-card') {
      try {
        typeCardLayout(scene.text, variantOf(parsed.data as TypeCardProps), stage, fonts, scene.id);
      } catch (error) {
        if (!(error instanceof TypeCardLayoutError)) throw error;
        const at = scene.text.findIndex(({ id }) => id === error.textId);
        const where = at >= 0 ? `${path}.text[${at}].value` : `${path}.text`;
        issues.push({
          code: 'TYPE_CARD_LAYOUT',
          severity: 'error',
          path: where,
          message: error.message,
          fix: `Shorten ${where}.`,
        });
      }
    }
    if (scene.type === 'feature-card') {
      // The same fit the scene makes on its first frame, at the drift its last frame reaches.
      const at = scene.text.findIndex(({ role }) => role === 'headline');
      const headline = scene.text[at];
      // A feature-card without a headline is validateFilm's TEXT_MISSING.
      if (!headline) continue;
      const dur = specFrame(frames[index]?.durationInFrames ?? 0, fps);
      if (fitCardHeadline(headline.value, stage, dur, fonts).fits) continue;
      const where = `${path}.text[${at}].value`;
      issues.push({
        code: 'LAYOUT_UNFIT',
        severity: 'error',
        path: where,
        message: `LAYOUT_UNFIT: ${headlineProblem(scene.id, headline, stage, headlineWidth(stage, dur))}`,
        fix: `Shorten ${where}.`,
      });
    }
    if (scene.type === 'stat-counter') {
      const headline = scene.text.find(({ role }) => role === 'headline');
      const label = scene.text.find(({ role }) => role === 'label');
      // A stat-counter without both is validateFilm's TEXT_MISSING.
      if (!headline || !label) continue;
      const layout = statLayout(headline.value, label.value, stage, fonts);
      const problems = layoutProblems(scene.id, { headline, label }, layout, stage);
      const accent = accentProblem(scene, (parsed.data as StatCounterProps).accent);
      if (accent) problems.push(accent);
      if (problems.length === 0) continue;
      issues.push({
        code: 'LAYOUT_UNFIT',
        severity: 'error',
        path: `${path}.text`,
        message: `LAYOUT_UNFIT: ${problems.join(' ')}`,
        fix: `Shorten the number or the label of ${path}.`,
      });
    }
  }
  return issues;
}
