/**
 * The seam wrapper of `docs/motion/transitions.md`: the transform a T1 puts on the layers that
 * move across a seam. The outgoing scene's layer takes `seamOut` over its last `n` frames, the
 * incoming scene's `seamIn` until its settle frame, and an anchor both scenes declare is carried
 * from where the outgoing scene left it to its own box on frame 11, on the `lift` curve. A cut,
 * T3, and T5 move nothing, so the layer is left as it is.
 */
import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';
import { type SceneRuntime, useScene } from '../components/scene-runtime.tsx';
import { liftAt, type Seam, seamIn, seamOut } from '../core/curves.ts';
import { lerpRect, type Rect } from '../layout/rect.ts';
import { seams } from '../tokens.ts';

/** One move on a seam's axis, as transforms about the frame's top left. */
function onAxis(seam: Seam, offset: number, unit: number, centre: { x: number; y: number }) {
  if (offset === 0) return '';
  if (seam.axis === 'x') return `translateX(${offset * unit}px)`;
  if (seam.axis === 'y') return `translateY(${offset * unit}px)`;
  // A scale seam is about the frame centre, as `Math.exp(offset)` so rates compose across the cut.
  const s = Math.exp(offset);
  return `translate(${centre.x}px, ${centre.y}px) scale(${s}) translate(${-centre.x}px, ${-centre.y}px)`;
}

/** The transform that draws a layer whose box is `natural` at `target` instead, scaled evenly. */
export function boxTransform(natural: Rect, target: Rect): string {
  const scale = natural.height > 0 ? target.height / natural.height : 1;
  const x = target.x + (target.width - natural.width * scale) / 2 - natural.x * scale;
  const y = target.y - natural.y * scale;
  return `translate(${x}px, ${y}px) scale(${scale})`;
}

export interface SeamTransformInput
  extends Pick<SceneRuntime, 'f' | 'dur' | 'in' | 'out' | 'anchors' | 'carryFrom'> {
  stage: { width: number; height: number };
  /** The anchor this layer draws, if it is one: it is carried rather than seamed on a carry. */
  anchor?: string | undefined;
}

/**
 * The CSS transform of a seamed layer at a spec frame, with its origin at the frame's top left. It
 * is a pure function of the frame and the plan.
 */
export function seamTransform({
  f,
  dur,
  in: incoming,
  out,
  anchors,
  carryFrom,
  stage,
  anchor,
}: SeamTransformInput): string | undefined {
  const unit = Math.min(stage.width, stage.height) / 1080;
  const centre = { x: stage.width / 2, y: stage.height / 2 };
  const parts: string[] = [];
  if (out?.name === 't1' && out.seam)
    parts.push(onAxis(out.seam, seamOut(f - dur, out.seam), unit, centre));
  if (incoming?.name === 't1' && incoming.seam) {
    const carried = anchor !== undefined && incoming.carry === anchor && carryFrom !== undefined;
    const box = carried ? anchors.find(({ id }) => id === anchor)?.box : undefined;
    if (carried && box) {
      const frames = seams.t1.carryFrames;
      if (f < frames) {
        const target = lerpRect(carryFrom, box(frames), liftAt(Math.max(0, f)));
        parts.push(boxTransform(box(f), target));
      }
    } else {
      parts.push(onAxis(incoming.seam, seamIn(f, incoming.seam), unit, centre));
    }
  }
  const transform = parts.filter(Boolean).join(' ');
  return transform === '' ? undefined : transform;
}

/** The seam transform of a layer of the current scene. */
export function useSeamTransform(anchor?: string): string | undefined {
  const { f, dur, in: incoming, out, anchors, carryFrom, stage } = useScene();
  return seamTransform({ f, dur, in: incoming, out, anchors, carryFrom, stage, anchor });
}

/**
 * A full-frame layer that moves across a seam. Wrap the scene's anchor in one with its `anchor` id,
 * and anything that moves with it, such as a card's panel, in one without.
 */
export const SeamLayer = ({
  anchor,
  children,
  style,
}: {
  anchor?: string;
  children: ReactNode;
  style?: CSSProperties;
}) => {
  const transform = useSeamTransform(anchor);
  return (
    <AbsoluteFill style={{ ...style, transform, transformOrigin: '0 0' }}>{children}</AbsoluteFill>
  );
};
