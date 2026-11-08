import { markBox } from '../layout/scenes.ts';
import { BrandMark, type MarkPlacement } from './brand-mark.tsx';
import { useScene } from './scene-runtime.tsx';

/**
 * The corner mark. It pops in at full opacity on the scene's first drawn frame, as type does,
 * and never fades: a wordmark is type, and the reference spec allows no whole-line crossfade. Two
 * scenes that both draw it hold it in one place across the seam, so it does not blink.
 */
export const SceneMark = ({ placement }: { placement: MarkPlacement }) => {
  const { stage } = useScene();
  return <BrandMark placement={placement} unit={stage.unit} />;
};

export const cornerMark = (stage: Parameters<typeof markBox>[0]): MarkPlacement => ({
  box: markBox(stage),
  align: 'start',
});
