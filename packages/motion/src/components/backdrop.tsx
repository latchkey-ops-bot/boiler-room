import { noise2D } from '@remotion/noise';
import { AbsoluteFill } from 'remotion';
import { useBrand } from '../brand/brand-context.tsx';
import type { Ground } from '../scenes/definition.ts';

const DRIFT_SPEED = 0.006;
const DRIFT_RANGE = 16;

/**
 * One ground of the `Stage`. `base` and `plate` are the brand's background with a slow glow of its
 * primary colour, drifting on the film's clock, so the ground never cuts at a seam. `event` is
 * full-bleed primary, and `black` true black.
 */
export const Backdrop = ({
  seed,
  clock,
  ground,
}: {
  seed: string;
  clock: number;
  ground: Ground;
}) => {
  const { colors } = useBrand();
  if (ground === 'event') return <AbsoluteFill style={{ background: colors.primary }} />;
  if (ground === 'black') return <AbsoluteFill style={{ background: '#000000' }} />;
  const x = 50 + noise2D(`${seed}-x`, clock * DRIFT_SPEED, 0) * DRIFT_RANGE;
  const y = 40 + noise2D(`${seed}-y`, 0, clock * DRIFT_SPEED) * DRIFT_RANGE;
  return (
    <AbsoluteFill style={{ background: colors.background }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(70% 70% at ${x}% ${y}%, ${colors.glow}, transparent 72%)`,
        }}
      />
    </AbsoluteFill>
  );
};
