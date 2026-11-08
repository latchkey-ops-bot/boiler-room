/**
 * What the Quality Check agent looks at: a contact sheet at one frame per second, the frames just
 * before, during and after each transition, and each scene at the size it has on a phone. Frames
 * are taken from the stitched film, so the agent judges the file that ships, compression included.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildTimeline } from '@boiler-room/motion';
import { type Campaign, sceneFrames, toFrame } from '@boiler-room/schema';
import { encodePng, extractFrames, readPng } from './media.ts';
import { composeSheet, type SheetTile } from './sheets.ts';

/** A phone held upright is about 390 CSS pixels wide, which is the width a viewer's eye judges. */
export const PHONE_WIDTH = 390;

export interface ContactFrame {
  frame: number;
  second: number;
  scene: string;
}

export interface TransitionStill {
  when: 'before' | 'during' | 'after';
  frame: number;
}

export interface TransitionPlan {
  index: number;
  name: string;
  /** The first frame of the incoming scene. */
  boundary: number;
  /** The overlay covers `from` up to but not including `to`. */
  from: number;
  to: number;
  stills: TransitionStill[];
}

export interface PhoneFrame {
  scene: string;
  frame: number;
}

export interface QualityPlan {
  fps: number;
  durationInFrames: number;
  contact: ContactFrame[];
  transitions: TransitionPlan[];
  phone: PhoneFrame[];
}

const clampFrame = (frame: number, durationInFrames: number) =>
  Math.min(durationInFrames - 1, Math.max(0, frame));

/** Which frames to pull, worked out from the cut alone, with frame numbers from `sceneFrames`. */
export function planQuality(
  cut: Pick<Campaign, 'scenes' | 'fps' | 'durationSeconds'>,
): QualityPlan {
  const { fps, durationInFrames, scenes } = sceneFrames(cut);
  const sceneAt = (frame: number) =>
    scenes.find(({ from, durationInFrames: length }) => frame >= from && frame < from + length)
      ?.id ?? '';

  const contact: ContactFrame[] = [];
  for (let second = 0; toFrame(second, fps) < durationInFrames; second += 1) {
    const frame = toFrame(second, fps);
    contact.push({ frame, second, scene: sceneAt(frame) });
  }

  const transitions = buildTimeline(cut).windows.map(
    ({ name, boundary, from, to }, index): TransitionPlan => ({
      index,
      name,
      boundary,
      from,
      to,
      stills: [
        { when: 'before', frame: clampFrame(from - 1, durationInFrames) },
        { when: 'during', frame: boundary },
        { when: 'after', frame: clampFrame(to, durationInFrames) },
      ],
    }),
  );

  // Two thirds into a scene its copy has landed and its exit has not begun.
  const phone = scenes.map(({ id, from, durationInFrames: length }) => ({
    scene: id,
    frame: from + Math.floor((length * 2) / 3),
  }));

  return { fps, durationInFrames, contact, transitions, phone };
}

const timecode = (frame: number, fps: number) => {
  const seconds = Math.floor(frame / fps);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

interface Layout {
  contactWidth: number;
  contactColumns: number;
  transitionWidth: number;
}

function layoutFor(width: number, height: number): Layout {
  const aspect = width / height;
  if (aspect > 1.2) return { contactWidth: 384, contactColumns: 5, transitionWidth: 640 };
  if (aspect < 0.8) return { contactWidth: 216, contactColumns: 8, transitionWidth: 360 };
  return { contactWidth: 288, contactColumns: 6, transitionWidth: 480 };
}

export interface QualityIndex {
  film: { file: string; width: number; height: number; fps: number; durationInFrames: number };
  contactSheet: { file: string; frames: ContactFrame[] };
  transitionSheet: { file: string } | null;
  transitions: (TransitionPlan & { files: Record<TransitionStill['when'], string> })[];
  phoneSheet: { file: string; widthPx: number; frames: PhoneFrame[] };
}

/** Writes every artifact into `dir`, with `index.json` naming each file and the frames it shows. */
export async function writeQualityArtifacts(
  film: string,
  plan: QualityPlan,
  size: { width: number; height: number },
  dir: string,
): Promise<QualityIndex> {
  const frames = path.join(dir, 'frames');
  const stills = path.join(dir, 'transitions');
  await mkdir(frames, { recursive: true });
  await mkdir(stills, { recursive: true });
  const layout = layoutFor(size.width, size.height);
  const pad = (frame: number) => String(frame).padStart(5, '0');

  const contactFiles = plan.contact.map(({ frame }) =>
    path.join(frames, `contact-${pad(frame)}.png`),
  );
  const phoneFiles = plan.phone.map(({ frame }) => path.join(frames, `phone-${pad(frame)}.png`));
  const transitionFiles = plan.transitions.map(
    ({ index, name, stills: list }) =>
      Object.fromEntries(
        list.map(({ when, frame }) => [
          when,
          path.join(stills, `${index + 1}-${name}-${when}-${pad(frame)}.png`),
        ]),
      ) as Record<TransitionStill['when'], string>,
  );
  const transitionThumbs = plan.transitions.flatMap(({ stills: list }) =>
    list.map(({ frame }) => path.join(frames, `transition-${pad(frame)}.png`)),
  );

  await extractFrames(film, [
    ...plan.contact.map(({ frame }, index) => ({
      frame,
      output: contactFiles[index] as string,
      width: layout.contactWidth,
    })),
    ...plan.phone.map(({ frame }, index) => ({
      frame,
      output: phoneFiles[index] as string,
      width: PHONE_WIDTH,
    })),
    ...plan.transitions.flatMap(({ stills: list }, index) =>
      list.map(({ when, frame }) => ({
        frame,
        output: (transitionFiles[index] as Record<string, string>)[when] as string,
      })),
    ),
    ...plan.transitions.flatMap(({ stills: list }) =>
      list.map(({ frame }) => ({
        frame,
        output: path.join(frames, `transition-${pad(frame)}.png`),
        width: layout.transitionWidth,
      })),
    ),
  ]);

  const tiles = async (files: string[], labels: string[]): Promise<SheetTile[]> =>
    Promise.all(
      files.map(async (file, index) => ({
        image: await readPng(file),
        label: labels[index] ?? '',
      })),
    );

  const contactSheet = path.join(dir, 'contact-sheet.png');
  await writeFile(
    contactSheet,
    encodePng(
      composeSheet(
        await tiles(
          contactFiles,
          plan.contact.map(({ frame }) => `${timecode(frame, plan.fps)}  F${frame}`),
        ),
        {
          columns: layout.contactColumns,
          title: `CONTACT SHEET  1 FRAME PER SECOND  ${plan.durationInFrames} FRAMES AT ${plan.fps} FPS`,
        },
      ),
    ),
  );

  let transitionSheet: string | null = null;
  if (plan.transitions.length > 0) {
    transitionSheet = path.join(dir, 'transitions-sheet.png');
    const labels = plan.transitions.flatMap(({ index, name, stills: list }) =>
      list.map(({ when, frame }) => `${index + 1} ${name} ${when} F${frame}`),
    );
    await writeFile(
      transitionSheet,
      encodePng(
        composeSheet(await tiles(transitionThumbs, labels), {
          columns: 3,
          title: 'TRANSITIONS  BEFORE  DURING  AFTER',
        }),
      ),
    );
  }

  const phoneSheet = path.join(dir, 'phone-sheet.png');
  await writeFile(
    phoneSheet,
    encodePng(
      composeSheet(
        await tiles(
          phoneFiles,
          plan.phone.map(({ scene, frame }) => `${scene} F${frame}`),
        ),
        {
          columns: size.width > size.height ? 2 : plan.phone.length,
          labelScale: 2,
          title: `PHONE SIZE  ${PHONE_WIDTH} PX WIDE`,
        },
      ),
    ),
  );

  const index: QualityIndex = {
    film: { file: film, ...size, fps: plan.fps, durationInFrames: plan.durationInFrames },
    contactSheet: { file: contactSheet, frames: plan.contact },
    transitionSheet: transitionSheet ? { file: transitionSheet } : null,
    transitions: plan.transitions.map((transition, index) => ({
      ...transition,
      files: transitionFiles[index] as Record<TransitionStill['when'], string>,
    })),
    phoneSheet: { file: phoneSheet, widthPx: PHONE_WIDTH, frames: plan.phone },
  };
  await writeFile(path.join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}
