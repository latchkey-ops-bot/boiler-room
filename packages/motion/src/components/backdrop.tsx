import { noise2D } from '@remotion/noise';
import { AbsoluteFill } from 'remotion';
import { useBrand } from '../brand/brand-context.tsx';
import { useScene } from './scene-runtime.tsx';

const DRIFT_SPEED = 0.006;
const DRIFT_RANGE = 16;

/** The brand's background with a slow glow of its primary colour, seeded so it never repeats a look. */
export const Backdrop = ({ seed, clock }: { seed: string; clock?: number }) => {
  const { colors } = useBrand();
  const scene = useScene();
  const frame = clock ?? scene.frame;
  const x = 50 + noise2D(`${seed}-x`, frame * DRIFT_SPEED, 0) * DRIFT_RANGE;
  const y = 40 + noise2D(`${seed}-y`, 0, frame * DRIFT_SPEED) * DRIFT_RANGE;
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
