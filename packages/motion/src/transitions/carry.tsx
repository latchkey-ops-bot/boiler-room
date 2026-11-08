import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { assetUrl } from '../brand/assets.ts';
import { BrandMark, type MarkPlacement, useMarkRect } from '../components/brand-mark.tsx';
import { BrowserFrame } from '../components/browser-frame.tsx';
import { lerpPose } from '../core/camera.ts';
import { bezier, lerp } from '../core/time.ts';
import type { CarryPlan } from '../film/plan.ts';
import { lerpRect } from '../layout/rect.ts';
import type { Stage } from '../layout/stage.ts';
import { easing } from '../tokens.ts';
import { windowProgress } from './timeline.ts';

const curve = bezier(easing.expressive);

/** How far a carry has gone at a film frame, eased. 0 and 1 are where the two scenes hold it. */
export const carryProgress = (frame: number, carry: Pick<CarryPlan, 'window'>): number =>
  curve(windowProgress(frame, carry.window));

/**
 * The image moves and resizes between where the two scenes hold it, and its browser bar grows or
 * shrinks with it. An address in the bar that the other end does not share fades out, or in.
 */
const CarriedImage = ({ carry, src, t }: { carry: CarryPlan; src: string; t: number }) => {
  if (!carry.image) return null;
  const { from, to } = carry.image;
  const same = from.address === to.address;
  const address =
    from.address && (same || t < 0.5)
      ? { text: from.address, opacity: same ? 1 : 1 - t * 2 }
      : to.address && t >= 0.5
        ? { text: to.address, opacity: t * 2 - 1 }
        : undefined;
  return (
    <BrowserFrame
      rect={lerpRect(from.rect, to.rect, t)}
      src={src}
      pose={lerpPose(from.pose, to.pose, t)}
      chrome={lerp(from.chrome, to.chrome, t)}
      address={address}
    />
  );
};

/**
 * The mark is drawn once, at the size it ends at, and moved and scaled from where it started. A
 * wordmark is never refitted mid-flight, so its line breaks cannot change as it moves.
 */
const CarriedMark = ({
  from,
  to,
  stage,
  t,
}: {
  from: MarkPlacement;
  to: MarkPlacement;
  stage: Stage;
  t: number;
}) => {
  const start = useMarkRect(from, stage.unit);
  const end = useMarkRect(to, stage.unit);
  const now = lerpRect(start, end, t);
  const scale = now.height / Math.max(1, end.height);
  return (
    <AbsoluteFill
      style={{
        transform: `translate(${now.x - end.x * scale}px, ${now.y - end.y * scale}px) scale(${scale})`,
        transformOrigin: '0 0',
      }}
    >
      <BrandMark placement={to} unit={stage.unit} />
    </AbsoluteFill>
  );
};

/** Draws the shared element above both scenes for the length of the carry. */
export const CarryOverlay = ({
  carry,
  filmFrom,
  imageSrc,
  marks,
  stage,
}: {
  carry: CarryPlan;
  /** The film frame this overlay's sequence starts at. */
  filmFrom: number;
  imageSrc: string | undefined;
  marks: { from: MarkPlacement; to: MarkPlacement };
  stage: Stage;
}) => {
  const t = carryProgress(useCurrentFrame() + filmFrom, carry);
  if (carry.element.kind === 'image' && imageSrc) {
    return <CarriedImage carry={carry} src={assetUrl(imageSrc)} t={t} />;
  }
  return <CarriedMark from={marks.from} to={marks.to} stage={stage} t={t} />;
};
