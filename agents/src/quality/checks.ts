/**
 * The checks code makes before any model looks: what the file is, whether it is the render of the
 * campaign under review, its size, rate and length, black and frozen frames, the ground colour,
 * and whether every claim and brand colour on screen traces back to the research. Each check is a
 * pure function of measurements, so it can be tested without a film.
 */
import {
  type Campaign,
  type CampaignFrames,
  type Issue,
  namesIn,
  namesNotQuoted,
  sceneFrames,
  superlativeForms,
  type ValidationResult,
} from '@boiler-room/schema';
import { checkQuote, type PageIndex } from '../researcher/verify.ts';
import {
  BLACK_MAX,
  BLANK_EDGES,
  blackRuns,
  blankRuns,
  channelDistance,
  FLASH_WINDOW,
  type Flash,
  type FrameStats,
  flashRuns,
  hexToRgb,
  type Rgb,
  type Run,
  rgbToHex,
  STATIC_MAD,
  staticRuns,
} from './measure.ts';
import type { CheckResult, Owner, QcCheck, QcIssue, Severity } from './output.ts';

export interface Findings {
  checks: QcCheck[];
  issues: QcIssue[];
}

const merge = (...parts: Findings[]): Findings => ({
  checks: parts.flatMap((part) => part.checks),
  issues: parts.flatMap((part) => part.issues),
});

/** A frame as minutes:seconds.frames, such as 0:03.15 for frame 105 at 30 fps. */
export function timecode(frame: number, fps: number): string {
  const seconds = Math.floor(frame / fps);
  const rest = frame - seconds * fps;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${String(rest).padStart(2, '0')}`;
}

/** The id of the scene on screen at a frame, from `sceneFrames`. */
export function sceneAt(frames: CampaignFrames, frame: number): string | null {
  return (
    frames.scenes.find(
      ({ from, durationInFrames }) => frame >= from && frame < from + durationInFrames,
    )?.id ?? null
  );
}

function check(
  id: string,
  result: CheckResult,
  measured: string,
  threshold: string,
  frames: number[] = [],
): QcCheck {
  return { id, result, measured, threshold, frames, source: 'code' };
}

interface IssueInput {
  severity: Severity;
  check: string;
  owner: Owner;
  what: string;
  fix: string;
  sceneId?: string | null;
  frame?: number | null;
}

function codeIssue(input: IssueInput, fps: number): QcIssue {
  const frame = input.frame ?? null;
  return {
    severity: input.severity,
    check: input.check,
    sceneId: input.sceneId ?? null,
    frame,
    timecode: frame === null ? null : timecode(frame, fps),
    what: input.what,
    fix: input.fix,
    owner: input.owner,
    source: 'code',
  };
}

const listRuns = (runs: readonly Run[], limit = 6) =>
  runs
    .slice(0, limit)
    .map((run) => (run.length === 1 ? `${run.from}` : `${run.from}-${run.to} (${run.length})`))
    .join(', ') + (runs.length > limit ? `, and ${runs.length - limit} more` : '');

// ---------------------------------------------------------------------------------------------
// Is this the render of the campaign under review?

export interface IntegrityInput {
  filmSha256: string;
  manifestFilmSha256: string;
  campaignSha256: string;
  manifestCampaignSha256: string;
  campaignFile: string;
  /** Contact-sheet stills compared with the same frames decoded from the film here. */
  stills: { frame: number; file: string; mad: number }[];
  /** Files the quality index names that are not in the quality folder. */
  missing?: string[];
  fps: number;
}

/** Checks that decide whether the film under review is this campaign's render, complete. */
export const INTEGRITY_CHECKS = ['film-hash', 'campaign-hash', 'stills-from-film', 'artifacts'];

/** Stills that differ from the film by more than this many levels were not taken from it. */
export const STILL_MATCH_MAD = 3;

export function checkIntegrity(input: IntegrityInput): Findings {
  const issues: QcIssue[] = [];
  const filmOk = input.filmSha256 === input.manifestFilmSha256;
  if (!filmOk) {
    issues.push(
      codeIssue(
        {
          severity: 'blocker',
          check: 'film-hash',
          owner: 'motion',
          what: `The film's SHA-256 is ${input.filmSha256.slice(0, 16)}…, but the manifest records ${input.manifestFilmSha256.slice(0, 16)}…. This is not the file the render step wrote.`,
          fix: 'Render the campaign again and review the film exactly as the render step wrote it.',
        },
        input.fps,
      ),
    );
  }
  const campaignOk = input.campaignSha256 === input.manifestCampaignSha256;
  if (!campaignOk) {
    issues.push(
      codeIssue(
        {
          severity: 'blocker',
          check: 'campaign-hash',
          owner: 'director',
          what: `${input.campaignFile} has SHA-256 ${input.campaignSha256.slice(0, 16)}…, but the film was rendered from a file with ${input.manifestCampaignSha256.slice(0, 16)}…. The campaign was changed after the render, so the film does not show it.`,
          fix: 'Render the campaign as it is now, then review that film. Never review a film against a campaign it was not rendered from.',
        },
        input.fps,
      ),
    );
  }
  const stale = input.stills.filter((still) => still.mad > STILL_MATCH_MAD);
  for (const still of stale) {
    issues.push(
      codeIssue(
        {
          severity: 'blocker',
          check: 'stills-from-film',
          owner: 'motion',
          frame: still.frame,
          what: `The quality still for frame ${still.frame} differs from that frame of the film by ${still.mad.toFixed(2)} levels on average, so the inspection images are not from this film.`,
          fix: 'Regenerate the quality artifacts from the stitched film (render without --no-quality).',
        },
        input.fps,
      ),
    );
  }
  if (input.stills.length === 0) {
    issues.push(
      codeIssue(
        {
          severity: 'blocker',
          check: 'stills-from-film',
          owner: 'motion',
          what: 'No contact or transition still the quality index names could be compared with the film, so nothing shows the quality artifacts are from this film.',
          fix: 'Regenerate the quality artifacts from the stitched film (render without --no-quality).',
        },
        input.fps,
      ),
    );
  }
  const missing = input.missing ?? [];
  if (missing.length) {
    issues.push(
      codeIssue(
        {
          severity: 'blocker',
          check: 'artifacts',
          owner: 'motion',
          what: `The quality index names ${missing.length} file(s) the render folder does not hold: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? `, and ${missing.length - 6} more` : ''}. The folder is not what the render step wrote.`,
          fix: 'Render again with quality artifacts, and review the render folder exactly as the render step wrote it.',
        },
        input.fps,
      ),
    );
  }
  const worst = Math.max(0, ...input.stills.map((still) => still.mad));
  return {
    checks: [
      check(
        'film-hash',
        filmOk ? 'pass' : 'fail',
        `film ${input.filmSha256.slice(0, 16)}…, manifest ${input.manifestFilmSha256.slice(0, 16)}…`,
        'equal',
      ),
      check(
        'campaign-hash',
        campaignOk ? 'pass' : 'fail',
        `campaign file ${input.campaignSha256.slice(0, 16)}…, rendered from ${input.manifestCampaignSha256.slice(0, 16)}…`,
        'equal',
      ),
      check(
        'stills-from-film',
        input.stills.length === 0 ? 'fail' : stale.length ? 'fail' : 'pass',
        input.stills.length
          ? `${input.stills.length} contact stills against the film, worst ${worst.toFixed(2)} levels`
          : 'no contact stills to compare',
        `every still within ${STILL_MATCH_MAD} levels of its frame`,
        input.stills.map((still) => still.frame),
      ),
      check(
        'artifacts',
        missing.length ? 'fail' : 'pass',
        missing.length
          ? `${missing.length} named file(s) missing`
          : 'every file the quality index names is in the folder',
        'every file the quality index names is in the quality folder',
      ),
    ],
    issues,
  };
}

// ---------------------------------------------------------------------------------------------
// Size, rate and length.

/** Sizes the render may have for each format: 1080p or 4K. */
export const FORMAT_SIZES: Record<string, readonly (readonly [number, number])[]> = {
  '16:9': [
    [1920, 1080],
    [3840, 2160],
  ],
  '9:16': [
    [1080, 1920],
    [2160, 3840],
  ],
  '1:1': [
    [1080, 1080],
    [2160, 2160],
  ],
};

export interface ProbeInput {
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSeconds: number;
  hasAudio: boolean;
  format: string;
  muted: boolean;
  cut: Pick<Campaign, 'scenes' | 'fps' | 'durationSeconds'>;
}

export function checkProbe(input: ProbeInput): Findings {
  const expected = sceneFrames(input.cut);
  const fps = input.cut.fps;
  const issues: QcIssue[] = [];
  const sizes = FORMAT_SIZES[input.format] ?? [];
  const sizeOk = sizes.some(([w, h]) => w === input.width && h === input.height);
  const [ratioW, ratioH] = input.format.split(':').map(Number);
  const aspectOk =
    ratioW !== undefined &&
    ratioH !== undefined &&
    ratioH > 0 &&
    input.width * ratioH === input.height * ratioW;
  if (!sizeOk) {
    issues.push(
      codeIssue(
        {
          severity: 'major',
          check: 'size',
          owner: 'motion',
          what: `The film is ${input.width} x ${input.height}${aspectOk ? '' : `, which is not ${input.format}`}. ${input.format} renders at ${sizes.map(([w, h]) => `${w} x ${h}`).join(' or ')}.`,
          fix: `Render at ${sizes[0]?.join(' x ') ?? 'the size of the format'} for ${input.format}.`,
        },
        fps,
      ),
    );
  }
  const fpsOk = Math.abs(input.fps - fps) < 1e-6;
  if (!fpsOk) {
    issues.push(
      codeIssue(
        {
          severity: 'major',
          check: 'fps',
          owner: 'motion',
          what: `The film runs at ${input.fps} fps; the campaign is ${fps} fps.`,
          fix: `Render at the campaign's ${fps} fps.`,
        },
        fps,
      ),
    );
  }
  const framesOk = input.frames === expected.durationInFrames;
  if (!framesOk) {
    const short = input.frames < expected.durationInFrames;
    issues.push(
      codeIssue(
        {
          severity: 'major',
          check: 'frame-count',
          owner: 'motion',
          frame: Math.min(input.frames, expected.durationInFrames),
          sceneId: sceneAt(expected, Math.min(input.frames, expected.durationInFrames - 1)),
          what: `The film has ${input.frames} frames; sceneFrames gives ${expected.durationInFrames}. It is ${Math.abs(input.frames - expected.durationInFrames)} frames ${short ? 'short' : 'long'}.`,
          fix: 'Render every frame of sceneFrames(campaign).durationInFrames, and check that no chunk was dropped or repeated when stitching.',
        },
        fps,
      ),
    );
  }
  const durationOk = Math.abs(input.durationSeconds - input.cut.durationSeconds) <= 1 / fps + 1e-6;
  if (!durationOk) {
    issues.push(
      codeIssue(
        {
          severity: 'major',
          check: 'duration',
          owner: 'motion',
          what: `The film lasts ${input.durationSeconds.toFixed(3)} s; the campaign lasts ${input.cut.durationSeconds} s.`,
          fix: `Render the campaign's ${input.cut.durationSeconds} s.`,
        },
        fps,
      ),
    );
  }
  let audio: QcCheck;
  if (input.muted) {
    audio = check(
      'audio-stream',
      'n/a',
      input.hasAudio
        ? 'the manifest says muted, yet the film has an audio stream'
        : 'muted render (manifest settings.muted); the audio checks wait for a render with sound',
      'an audio stream when the render is not muted',
    );
  } else {
    audio = check(
      'audio-stream',
      input.hasAudio ? 'pass' : 'fail',
      input.hasAudio ? 'audio stream present' : 'no audio stream',
      'an audio stream',
    );
    if (!input.hasAudio) {
      issues.push(
        codeIssue(
          {
            severity: 'major',
            check: 'audio-stream',
            owner: 'motion',
            what: 'The render is not muted but has no audio stream.',
            fix: 'Render with the campaign audio, or mark the render muted.',
          },
          fps,
        ),
      );
    }
  }
  return {
    checks: [
      check(
        'size',
        sizeOk ? 'pass' : 'fail',
        `${input.width} x ${input.height}, ${aspectOk ? '' : 'not '}${input.format}`,
        sizes.map(([w, h]) => `${w} x ${h}`).join(' or ') || `a known format, not ${input.format}`,
      ),
      check('fps', fpsOk ? 'pass' : 'fail', `${input.fps} fps`, `${fps} fps`),
      check(
        'frame-count',
        framesOk ? 'pass' : 'fail',
        `${input.frames} decoded frames`,
        `${expected.durationInFrames}, from sceneFrames`,
      ),
      check(
        'duration',
        durationOk ? 'pass' : 'fail',
        `${input.durationSeconds.toFixed(3)} s`,
        `${input.cut.durationSeconds} s within one frame`,
      ),
      audio,
    ],
    issues,
  };
}

// ---------------------------------------------------------------------------------------------
// Black and frozen frames.

/** The longest run of identical-looking frames allowed outside the end card. */
export const MAX_STATIC_RUN = 30;

/** Black frames are allowed only inside a `t16` dip to black, which spans its boundary. */
const T16_REACH = 12;

/** Blank frames `t5` allows after its seam: 2, or 5 for a chapter blink into a pivot card. */
const T5_BLANK = 2;
const T5_PIVOT_BLANK = 5;

/** Frames that may show only ground: after a `t5` seam, and inside a `t16` dip. */
export function blankAllowed(
  cut: Pick<Campaign, 'scenes' | 'fps' | 'durationSeconds'>,
): { from: number; to: number; why: string }[] {
  const frames = sceneFrames(cut);
  return frames.scenes.flatMap((_scene, index) => {
    const next = frames.scenes[index + 1];
    const transition = cut.scenes[index]?.transitionOut;
    if (!next) return [];
    if (transition === 't5') {
      const pivot = cut.scenes[index + 1]?.props.variant === 'pivot';
      return [
        {
          from: next.from,
          to: next.from + (pivot ? T5_PIVOT_BLANK : T5_BLANK) - 1,
          why: `t5 at F${next.from}`,
        },
      ];
    }
    if (transition === 't16') {
      return [
        { from: next.from - T16_REACH, to: next.from + T16_REACH - 1, why: `t16 at F${next.from}` },
      ];
    }
    return [];
  });
}

/**
 * Frames code flags on every frame of the film, whether or not the agent is shown them: runs of
 * empty ground outside what `t5` and `t16` allow (frame 0 is the frame-0 check's), and flashes,
 * where the picture jumps away and back within a few frames.
 */
export function frameOutliers(
  stats: readonly FrameStats[],
  cut: Pick<Campaign, 'scenes' | 'fps' | 'durationSeconds'>,
): { blank: Run[]; flash: Flash[] } {
  const allowed = blankAllowed(cut);
  const within = (run: Run, pad = 0) =>
    allowed.some((span) => run.from >= span.from - pad && run.to <= span.to + pad);
  const blank = blankRuns(stats).filter((run) => run.from > 0 && !within(run));
  const covered = [...blackRuns(stats), ...blankRuns(stats)];
  const flash = flashRuns(stats).filter(
    (run) =>
      !within(run, 1) && !covered.some((other) => other.from <= run.to && other.to >= run.from),
  );
  return { blank, flash };
}

export function checkFrames(
  stats: readonly FrameStats[],
  cut: Pick<Campaign, 'scenes' | 'fps' | 'durationSeconds'>,
): Findings {
  const frames = sceneFrames(cut);
  const fps = cut.fps;
  const issues: QcIssue[] = [];

  const dips = frames.scenes.flatMap((_scene, index) => {
    const next = frames.scenes[index + 1];
    return cut.scenes[index]?.transitionOut === 't16' && next ? [next.from] : [];
  });
  const measuredEdges = stats.some((stat) => stat.edges !== undefined);
  const measuredEcho = stats.some((stat) => stat.echo !== undefined);
  const outliers = frameOutliers(stats, cut);
  for (const run of outliers.blank) {
    const sceneId = sceneAt(frames, run.from);
    issues.push(
      codeIssue(
        {
          severity: 'major',
          check: 'blank-frames',
          owner: 'motion',
          frame: run.from,
          sceneId,
          what: `${run.length === 1 ? `Frame ${run.from} shows` : `Frames ${run.from}-${run.to} (${run.length}) show`} only ground: at most ${BLANK_EDGES} edge pixels at 320 x 180, in scene ${sceneId ?? 'none'}, outside any t5 blink or t16 dip.`,
          fix: `Find why ${sceneId ?? 'the film'} draws nothing at ${timecode(run.from, fps)}: a chunk that rendered empty, a layer that has not entered, or a transition that leaves the ground bare. Only a t5 seam may show empty ground, for 2 frames (5 into a pivot).`,
        },
        fps,
      ),
    );
  }
  for (const run of outliers.flash) {
    const sceneId = sceneAt(frames, run.from);
    issues.push(
      codeIssue(
        {
          severity: 'major',
          check: 'flash-frames',
          owner: 'motion',
          frame: run.from,
          sceneId,
          what: `${run.length === 1 ? `Frame ${run.from}` : `Frames ${run.from}-${run.to} (${run.length})`} jump away from the picture and back: ${run.jumpIn.toFixed(1)} levels in and ${run.jumpOut.toFixed(1)} out, and frame ${run.to + 1} is within ${run.back.toFixed(2)} levels of frame ${run.from - 1}. Something showed for ${run.length} frame${run.length === 1 ? '' : 's'} that the scene does not.`,
          fix: `Look at ${timecode(run.from, fps)} to ${timecode(run.to, fps)} in ${sceneId ?? 'the film'}: a chunk from another render, a frame drawn out of order, or a layer that flashes. Render those frames again.`,
        },
        fps,
      ),
    );
  }
  const black = blackRuns(stats).filter(
    (run) =>
      !dips.some((boundary) => run.from >= boundary - T16_REACH && run.to < boundary + T16_REACH),
  );
  for (const run of black) {
    const sceneId = sceneAt(frames, run.from);
    issues.push(
      codeIssue(
        {
          severity: 'major',
          check: 'black-frames',
          owner: 'motion',
          frame: run.from,
          sceneId,
          what: `${run.length} black frame${run.length === 1 ? '' : 's'} (no channel above ${BLACK_MAX}) at ${run.length === 1 ? `frame ${run.from}` : `frames ${run.from}-${run.to}`}, in scene ${sceneId ?? 'none'}, outside any t16 dip.`,
          fix: `Find why ${sceneId ?? 'the film'} renders nothing at ${timecode(run.from, fps)}: a chunk that failed to draw, a missing asset, or a layer that has not entered yet. The scene must show content on every frame.`,
        },
        fps,
      ),
    );
  }

  const first = stats[0];
  const frameZeroBare = first?.edges !== undefined && first.edges <= BLANK_EDGES;
  const frameZeroOk = Boolean(first && first.spread > 0 && first.max > BLACK_MAX && !frameZeroBare);
  if (first && !frameZeroOk) {
    issues.push(
      codeIssue(
        {
          severity: 'major',
          check: 'frame-0',
          owner: 'motion',
          frame: 0,
          sceneId: sceneAt(frames, 0),
          what: `Frame 0 is ${first.max <= BLACK_MAX ? 'black' : first.spread > 0 ? 'only ground' : 'one flat colour'} (max ${first.max}, spread ${first.spread.toFixed(2)}${first.edges !== undefined ? `, ${first.edges} edge pixels` : ''}).`,
          fix: 'Put content on screen from frame 0: the first scene starts in motion, not from an empty ground.',
        },
        fps,
      ),
    );
  }

  const endCard = frames.scenes.at(-1);
  const inEndCard = (run: Run) => Boolean(endCard && run.from >= endCard.from);
  const frozen = staticRuns(stats).filter((run) => run.length > MAX_STATIC_RUN && !inEndCard(run));
  for (const run of frozen) {
    const sceneId = sceneAt(frames, run.from);
    issues.push(
      codeIssue(
        {
          severity: 'major',
          check: 'static-runs',
          owner: 'motion',
          frame: run.from,
          sceneId,
          what: `Frames ${run.from}-${run.to} (${run.length} frames, ${(run.length / fps).toFixed(1)} s) do not change: each differs from the one before by under ${STATIC_MAD} levels.`,
          fix: `Keep ${sceneId ?? 'the scene'} moving through ${timecode(run.to, fps)}: no hold over ${MAX_STATIC_RUN} frames outside the end card. If the picture froze because frames repeat, render those frames again.`,
        },
        fps,
      ),
    );
  }
  const allStatic = staticRuns(stats);
  const longest = allStatic.reduce<Run | undefined>(
    (best, run) => (!best || run.length > best.length ? run : best),
    undefined,
  );
  const endHold = endCard ? allStatic.filter((run) => run.from >= endCard.from).at(-1) : undefined;

  return {
    checks: [
      check(
        'black-frames',
        black.length ? 'fail' : 'pass',
        black.length
          ? `black at ${listRuns(black)}`
          : `none; darkest frame has max ${Math.min(...stats.map((stat) => stat.max))}`,
        `no frame with every channel at ${BLACK_MAX} or below, outside a t16 dip`,
        black.map((run) => run.from),
      ),
      check(
        'frame-0',
        frameZeroOk ? 'pass' : 'fail',
        first
          ? `max ${first.max}, mean ${first.mean.toFixed(1)}, spread ${first.spread.toFixed(2)}${first.edges !== undefined ? `, ${first.edges} edge pixels` : ''}`
          : 'no frames decoded',
        `pixel variance above 0, not black, and more than ${BLANK_EDGES} edge pixels (not only ground)`,
        [0],
      ),
      check(
        'blank-frames',
        !measuredEdges ? 'n/a' : outliers.blank.length ? 'fail' : 'pass',
        !measuredEdges
          ? 'edges not measured'
          : outliers.blank.length
            ? `empty ground at ${listRuns(outliers.blank)}`
            : `none outside t5 and t16; fewest edge pixels after frame 0: ${Math.min(...stats.slice(1).map((stat) => stat.edges ?? Number.POSITIVE_INFINITY))}`,
        `no frame after frame 0 with at most ${BLANK_EDGES} edge pixels (only ground), except after a t5 seam or inside a t16 dip`,
        outliers.blank.map((run) => run.from),
      ),
      check(
        'flash-frames',
        !measuredEcho ? 'n/a' : outliers.flash.length ? 'fail' : 'pass',
        !measuredEcho
          ? 'earlier frames not compared'
          : outliers.flash.length
            ? `flash at ${listRuns(outliers.flash)}`
            : `no run of ${FLASH_WINDOW} frames or fewer that jumps away from the picture and back`,
        `no run of up to ${FLASH_WINDOW} frames that jumps away and back, on any frame`,
        outliers.flash.map((run) => run.from),
      ),
      check(
        'static-runs',
        frozen.length ? 'fail' : 'pass',
        frozen.length
          ? `frozen at ${listRuns(frozen)}`
          : `longest run ${longest ? `${longest.length} frames at ${longest.from}` : '0 frames'}; end-card hold ${endHold ? `${endHold.length} frames` : 'none'}`,
        `no run over ${MAX_STATIC_RUN} identical frames (MAD < ${STATIC_MAD}) outside the end card`,
        frozen.map((run) => run.from),
      ),
    ],
    issues,
  };
}

// ---------------------------------------------------------------------------------------------
// Ground colour in the rendered frames.

/** A ground patch must match `brand.colors.background` within this many levels per channel. */
export const GROUND_TOLERANCE = 3;

export interface GroundSample {
  frame: number;
  sceneId: string | null;
  colour: Rgb;
  distance: number;
}

/**
 * Scene types whose rest frame shows no `brand.colors.background` where the ground patches sit,
 * by their own spec, and why. Sampling them reports the scene working as specified as a motion
 * failure, which no agent can fix and which stops every route-back: the first posthog.com film
 * failed on both of these.
 */
export const GROUND_UNSAMPLED: Readonly<Record<string, string>> = {
  'tile-wall':
    'its rows of tiles cover the frame but for gutters narrower than a patch is inset, so every patch lands on a tile',
  'colour-event': 'its ground is brand.colors.primary, or a generated field, by its spec',
};

export interface UnsampledRest {
  frame: number;
  sceneId: string;
  type: string;
}

export function checkGround(
  background: string,
  samples: readonly GroundSample[],
  fps: number,
  unsampled: readonly UnsampledRest[] = [],
): Findings {
  const off = samples.filter((sample) => sample.distance > GROUND_TOLERANCE);
  const issues = off.map((sample) =>
    codeIssue(
      {
        severity: 'major',
        check: 'ground',
        owner: 'motion',
        frame: sample.frame,
        sceneId: sample.sceneId,
        what: `No ground patch at frame ${sample.frame} matches brand.colors.background ${background}: the nearest is ${rgbToHex(sample.colour)}, ${Math.round(sample.distance)} levels off.`,
        fix: `Paint the ground of ${sample.sceneId ?? 'this scene'} from brand.colors.background (${background}), or have the Art Director set the colour the film should show.`,
      },
      fps,
    ),
  );
  const skipped = unsampled.length
    ? `; not sampled: ${unsampled.map((rest) => `F${rest.frame} ${rest.sceneId} (${rest.type}: ${GROUND_UNSAMPLED[rest.type] ?? 'no ground by its spec'})`).join(', ')}`
    : '';
  return {
    checks: [
      check(
        'ground',
        samples.length === 0 ? 'n/a' : off.length ? 'fail' : 'pass',
        `${
          samples.length
            ? samples
                .map(
                  (sample) =>
                    `F${sample.frame} ${rgbToHex(sample.colour)} (${Math.round(sample.distance)})`,
                )
                .join(', ')
            : 'no rest frames sampled'
        }${skipped}`,
        `a 20 x 20 ground patch within ${GROUND_TOLERANCE} levels of ${background} on every rest frame`,
        samples.map((sample) => sample.frame),
      ),
    ],
    issues,
  };
}

// ---------------------------------------------------------------------------------------------
// The campaign gate, and claims traced to the research.

const ISSUE_ROUTES: Record<string, { severity: Severity; owner: Owner }> = {
  SCHEMA_INVALID: { severity: 'blocker', owner: 'director' },
  SCENE_TIMING: { severity: 'major', owner: 'director' },
  ASSET_UNDECLARED: { severity: 'blocker', owner: 'art-director' },
  ASSET_UNAVAILABLE: { severity: 'blocker', owner: 'art-director' },
  CLAIM_UNKNOWN: { severity: 'blocker', owner: 'director' },
  CLAIM_UNBACKED: { severity: 'blocker', owner: 'director' },
  CLAIM_SUPERLATIVE: { severity: 'blocker', owner: 'director' },
  TEXT_TOO_LONG: { severity: 'major', owner: 'director' },
  CONTRAST_LOW: { severity: 'major', owner: 'art-director' },
  VARIANT_INVALID: { severity: 'major', owner: 'director' },
  SCENE_TYPE_UNKNOWN: { severity: 'minor', owner: 'motion' },
};

/** The scene a validation path points into, such as `scenes[2].text[0].value`. */
function sceneOfPath(campaign: Campaign | undefined, path: string): string | null {
  const scene = /^scenes\[(\d+)\]/.exec(path);
  if (scene) return campaign?.scenes[Number(scene[1])]?.id ?? null;
  const hook = /^variants\.hooks\[(\d+)\]/.exec(path);
  if (hook) return campaign?.variants.hooks[Number(hook[1])]?.id ?? null;
  return null;
}

function routeIssue(issue: Issue, campaign: Campaign | undefined, fps: number): QcIssue {
  const route = ISSUE_ROUTES[issue.code] ?? { severity: 'major', owner: 'director' };
  const claims = issue.code.startsWith('CLAIM_');
  return codeIssue(
    {
      severity: route.severity,
      check: claims
        ? 'claims-cited'
        : issue.code === 'SCENE_TYPE_UNKNOWN'
          ? 'scene-registry'
          : 'gate',
      owner: route.owner,
      sceneId: sceneOfPath(campaign, issue.path),
      what: `${issue.code} at ${issue.path}: ${issue.message}`,
      fix: issue.fix,
    },
    fps,
  );
}

interface CopyFinding {
  sceneId: string;
  path: string;
  value: string;
  /** The superlative form, or the names, the cited quotes do not state. */
  what: string;
  why: string;
}

/**
 * Copy the cited quotes do not support, beyond the numbers `validateCampaign` checks: a
 * superlative the cited quotes do not state as a word of their own ("Fastest scheduling" citing
 * "The fastest-growing companies use it"; the validator stays silent once copy cites anything),
 * and a customer, company or product name no cited quote names.
 */
function unsupportedCopy(campaign: Campaign): CopyFinding[] {
  const quotes = new Map(campaign.claims.map((claim) => [claim.id, claim.quote]));
  const knownNames = campaign.claims.flatMap((claim) => namesIn(claim.quote));
  const scenes = [
    ...campaign.scenes.map((scene, index) => ({ scene, path: `scenes[${index}]` })),
    ...campaign.variants.hooks.map((scene, index) => ({ scene, path: `variants.hooks[${index}]` })),
  ];
  return scenes.flatMap(({ scene, path }) =>
    [
      ...scene.text.map((item, index) => ({
        path: `${path}.text[${index}].value`,
        value: item.value,
        ids: item.claimIds,
      })),
      ...(scene.voiceover
        ? [
            {
              path: `${path}.voiceover.text`,
              value: scene.voiceover.text,
              ids: scene.voiceover.claimIds,
            },
          ]
        : []),
    ].flatMap(({ path: at, value, ids }): CopyFinding[] => {
      const cited = ids.flatMap((id) => quotes.get(id) ?? []);
      const finding = (what: string, why: string): CopyFinding => ({
        sceneId: scene.id,
        path: at,
        value,
        what,
        why,
      });
      const names = namesNotQuoted(value, cited, {
        brandName: campaign.brand.name,
        known: knownNames,
      });
      const named = names.length
        ? [
            finding(
              names.map((name) => `"${name}"`).join(', '),
              cited.length
                ? 'which its cited quotes do not name'
                : 'and cites no claim that names them',
            ),
          ]
        : [];
      if (cited.length === 0) return named;
      const quoted = cited.flatMap((quote) => superlativeForms(quote));
      return [
        ...[...new Set(superlativeForms(value))]
          .filter((form) => !quoted.includes(form))
          .map((form) =>
            finding(
              `"${form}"`,
              `which its cited quotes do not state as a word of its own${quoted.length ? ` (they say ${quoted.map((each) => `"${each}"`).join(', ')})` : ''}`,
            ),
          ),
        ...named,
      ];
    }),
  );
}

/**
 * `validateCampaign` as the skill's gate step runs it. `plain` runs without the scene registry and
 * decides the gate. `registry` runs with the 15-type `sceneRegistry` that the Director writes to:
 * a scene type outside it is reported as a minor issue for motion, because the renderer's
 * placeholder scenes are being reconciled with the registry separately, and the registry's own
 * text limits apply to every scene whose type it knows.
 */
export function checkGate(
  plain: ValidationResult,
  registry: ValidationResult,
  campaign: Campaign | undefined,
  fps: number,
): Findings {
  const blocking = plain.issues.filter(
    (issue) => issue.severity === 'error' || issue.code === 'CLAIM_SUPERLATIVE',
  );
  const claimIssues = blocking.filter((issue) => issue.code.startsWith('CLAIM_'));
  const otherIssues = blocking.filter((issue) => !issue.code.startsWith('CLAIM_'));
  const plainKeys = new Set(plain.issues.map((issue) => `${issue.code} ${issue.path}`));
  const registryOnly = registry.issues.filter(
    (issue) =>
      !plainKeys.has(`${issue.code} ${issue.path}`) &&
      (issue.code === 'SCENE_TYPE_UNKNOWN' || issue.code === 'TEXT_TOO_LONG'),
  );
  const unknownTypes = registryOnly.filter((issue) => issue.code === 'SCENE_TYPE_UNKNOWN');
  const registryLimits = registryOnly.filter((issue) => issue.code === 'TEXT_TOO_LONG');

  const unsupported = campaign ? unsupportedCopy(campaign) : [];
  const uncited = (campaign?.scenes ?? []).flatMap((scene) =>
    scene.text.filter((item) => item.claimIds.length === 0).map((item) => `${scene.id}/${item.id}`),
  );
  const types = [...new Set(unknownTypes.map((issue) => /"([^"]+)"/.exec(issue.message)?.[1]))];

  return {
    checks: [
      check(
        'gate',
        otherIssues.length ? 'fail' : 'pass',
        otherIssues.length
          ? otherIssues.map((issue) => `${issue.code} ${issue.path}`).join('; ')
          : 'validateCampaign ok',
        'validateCampaign ok',
      ),
      check(
        'claims-cited',
        claimIssues.length || unsupported.length ? 'fail' : 'pass',
        claimIssues.length || unsupported.length
          ? [
              ...claimIssues.map((issue) => `${issue.code} ${issue.path}`),
              ...unsupported.map((each) => `${each.what} not in its cited quotes at ${each.path}`),
            ].join('; ')
          : `every number in copy and voiceover is in a cited quote; ${uncited.length} text item(s) cite no claim and state no number, superlative or name${uncited.length ? ` (${uncited.join(', ')})` : ''}`,
        'no CLAIM_UNBACKED, CLAIM_UNKNOWN or CLAIM_SUPERLATIVE; every cited superlative is a word of its own in a cited quote, and every name on screen is in one',
      ),
      check(
        'scene-registry',
        registryLimits.length ? 'fail' : unknownTypes.length ? 'n/a' : 'pass',
        [
          unknownTypes.length
            ? `scene types outside the 15-type registry: ${types.join(', ')}; registry text limits not applied to them`
            : 'every scene type is in the registry',
          ...registryLimits.map((issue) => `TEXT_TOO_LONG ${issue.path}`),
        ].join('; '),
        'scene types from sceneRegistry, within their text limits',
      ),
    ],
    issues: [
      ...[...blocking, ...registryLimits].map((issue) => routeIssue(issue, campaign, fps)),
      ...unsupported.map((each) =>
        codeIssue(
          {
            severity: 'blocker',
            check: 'claims-cited',
            owner: 'director',
            sceneId: each.sceneId,
            what: `${each.path} "${each.value}" says ${each.what}, ${each.why}.`,
            fix: `Remove ${each.what} from ${each.path}, or cite a claim whose quote states it about the same thing.`,
          },
          fps,
        ),
      ),
      ...(unknownTypes.length
        ? [
            codeIssue(
              {
                severity: 'minor',
                check: 'scene-registry',
                owner: 'motion',
                what: `The film uses scene types the 15-type sceneRegistry does not have: ${types.join(', ')} (${unknownTypes.map((issue) => issue.path).join(', ')}). Their text limits fell back to DEFAULT_TEXT_LIMITS.`,
                fix: 'Build these scenes as registry types (docs/motion/scenes), so the Director writes to one contract and the registry limits apply. This is the reconciliation already planned for the motion package.',
              },
              fps,
            ),
          ]
        : []),
    ],
  };
}

/** What Quality Check reads from a Researcher result. */
export interface ResearchFacts {
  brand: { colors: Record<string, string | undefined> };
  claims: { id: string; quote: string; sourceUrl: string }[];
  /** `brand_details.accents`, the other colours the Researcher measured. */
  accents: string[];
}

const words = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
const page = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

/** What the stored page text says about a quote, in words for the report. */
const STORED_VERDICTS: Record<string, string> = {
  missing: 'is not in the stored text of its page',
  meta: 'is only in the title, meta tags or alt text of its page',
  concealed: 'is only in text on its page styled so nobody can see it',
  illustrative: 'only appears inside a product mockup on its page, so its figures are sample data',
  'no page': 'cites a page the Researcher did not capture',
};

/**
 * Every claim the campaign makes must be one the Researcher verified: the same quote, word for
 * word, from the same page. A claim the Director wrote without the research is invented, however
 * well its copy cites it. With `pages`, the Researcher's stored page text, each quote is also
 * checked against that text by the Researcher's own verbatim rule, so a research file that was
 * edited after the gate cannot vouch for a quote.
 */
export function checkResearchClaims(
  campaign: Campaign,
  research: ResearchFacts | undefined,
  fps: number,
  pages?: PageIndex,
): Findings {
  if (!research) {
    return {
      checks: [
        check(
          'claims-research',
          'n/a',
          'no research supplied (--research), so claims were checked against the campaign alone',
          "every campaign claim's quote is a research quote from the same page",
        ),
      ],
      issues: [],
    };
  }
  const known = research.claims.map((claim) => ({
    quote: words(claim.quote),
    page: page(claim.sourceUrl),
  }));
  const used = new Set(
    campaign.scenes.flatMap((scene) => [
      ...scene.text.flatMap((item) => item.claimIds),
      ...(scene.voiceover?.claimIds ?? []),
    ]),
  );
  const stored = (claim: Campaign['claims'][number]) => {
    if (!pages) return 'found';
    const text = pages.find(claim.sourceUrl);
    return text ? checkQuote(text, claim.quote) : 'no page';
  };
  const reasons = new Map<string, string[]>();
  for (const claim of campaign.claims) {
    const quote = words(claim.quote);
    const why: string[] = [];
    if (!known.some((entry) => entry.quote === quote && entry.page === page(claim.sourceUrl)))
      why.push('no research claim states it');
    const verdict = stored(claim);
    if (verdict !== 'found') why.push(`it ${STORED_VERDICTS[verdict] ?? verdict}`);
    if (why.length) reasons.set(claim.id, why);
  }
  const invented = campaign.claims.filter((claim) => reasons.has(claim.id));
  const frames = sceneFrames(campaign);
  const issues = invented.map((claim) => {
    const scene = campaign.scenes.find(
      (item) =>
        item.text.some((text) => text.claimIds.includes(claim.id)) ||
        item.voiceover?.claimIds.includes(claim.id),
    );
    const sceneFrame = frames.scenes.find((item) => item.id === scene?.id);
    const shown = used.has(claim.id);
    return codeIssue(
      {
        severity: 'blocker',
        check: 'claims-research',
        owner: 'director',
        sceneId: scene?.id ?? null,
        frame: sceneFrame?.from ?? null,
        what: `Claim "${claim.id}" quotes "${claim.quote}" from ${claim.sourceUrl}, but ${(reasons.get(claim.id) ?? []).join(', and ')}${shown ? '; the film shows copy that cites it' : ''}.`,
        fix: shown
          ? `Remove claim "${claim.id}" and the copy that cites it, or cite a research claim whose quote states the same thing.`
          : `Remove claim "${claim.id}" from the campaign.`,
      },
      fps,
    );
  });
  return {
    checks: [
      check(
        'claims-research',
        invented.length ? 'fail' : 'pass',
        invented.length
          ? `not traced: ${invented.map((claim) => `${claim.id} (${(reasons.get(claim.id) ?? []).join('; ')})`).join(', ')}`
          : `${campaign.claims.length} campaign claim(s), all research quotes from the same page${pages ? ', each found in the stored text of that page' : ''}`,
        `every campaign claim's quote is a research quote from the same page${pages ? ', in the stored text of that page' : ''}`,
      ),
    ],
    issues,
  };
}

const NEUTRALS = ['#FFFFFF', '#000000'];

/**
 * Brand colours must be ones the Researcher measured on the site. The Art Director may keep ink
 * readable with black or white, so the foreground may also be one of those.
 */
export function checkResearchBrand(
  campaign: Campaign,
  research: ResearchFacts | undefined,
  fps: number,
): Findings {
  if (!research) {
    return {
      checks: [
        check(
          'brand-research',
          'n/a',
          'no research supplied (--research), so brand colours were not traced',
          'brand colours measured on the site',
        ),
      ],
      issues: [],
    };
  }
  const palette = new Set(
    [...Object.values(research.brand.colors), ...research.accents]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toUpperCase()),
  );
  const rules: { key: keyof Campaign['brand']['colors']; extra: string[]; severity: Severity }[] = [
    { key: 'background', extra: [], severity: 'major' },
    { key: 'primary', extra: [], severity: 'major' },
    { key: 'foreground', extra: NEUTRALS, severity: 'major' },
    { key: 'accent', extra: NEUTRALS, severity: 'minor' },
    { key: 'muted', extra: NEUTRALS, severity: 'minor' },
  ];
  const off = rules.flatMap((rule) => {
    const value = campaign.brand.colors[rule.key]?.toUpperCase();
    if (!value || palette.has(value) || rule.extra.includes(value)) return [];
    const measured =
      research.brand.colors[rule.key] ?? (rule.key === 'accent' ? research.accents[0] : undefined);
    const nearest = [...palette]
      .map((hex) => ({ hex, distance: channelDistance(hexToRgb(hex), hexToRgb(value)) }))
      .sort((a, b) => a.distance - b.distance)[0];
    return [{ rule, value, measured, nearest }];
  });
  const issues = off.map(({ rule, value, measured, nearest }) =>
    codeIssue(
      {
        severity: rule.severity,
        check: 'brand-research',
        owner: 'art-director',
        what: `brand.colors.${rule.key} is ${value}, which the Researcher did not measure on the site${measured ? ` (it measured ${measured.toUpperCase()} for ${rule.key})` : ''}. Measured colours: ${[...palette].join(', ')}.`,
        fix: `Set brand.colors.${rule.key} to ${measured?.toUpperCase() ?? nearest?.hex ?? 'a measured colour'}${rule.key === 'foreground' ? ', or to black or white for contrast' : ''}, then render again.`,
      },
      fps,
    ),
  );
  return {
    checks: [
      check(
        'brand-research',
        issues.some((issue) => issue.severity !== 'minor') ? 'fail' : 'pass',
        off.length
          ? off.map(({ rule, value }) => `${rule.key} ${value} not measured`).join('; ')
          : `background, primary, foreground${campaign.brand.colors.accent ? ', accent' : ''}${campaign.brand.colors.muted ? ', muted' : ''} all measured on the site`,
        'brand colours from the research palette (foreground may be black or white)',
      ),
    ],
    issues,
  };
}

export { merge };
