import type { ReactNode } from 'react';
import { presence } from '../core/presence.ts';
import { markBox } from '../layout/scenes.ts';
import { Backdrop } from './backdrop.tsx';
import { BrandMark, type MarkPlacement } from './brand-mark.tsx';
import { useScene } from './scene-runtime.tsx';

/** The corner mark, on the container's clock unless it has just been carried in. */
export const SceneMark = ({ placement }: { placement: MarkPlacement }) => {
  const { frame, stage, timing, carriedIn, carriedOut, overlayHides } = useScene();
  if (overlayHides('mark')) return null;
  const { visible } = presence(frame, timing.container);
  // Across a carry the mark is in both scenes at once, so it holds rather than dipping.
  const stays = carriedIn !== undefined || carriedOut !== undefined;
  return (
    <BrandMark placement={placement} unit={stage.unit} style={{ opacity: stays ? 1 : visible }} />
  );
};

export const cornerMark = (stage: Parameters<typeof markBox>[0]): MarkPlacement => ({
  box: markBox(stage),
  align: 'start',
});

/** What every scene sits on. `clock` stops the backdrop's drift, for a scene that holds still. */
export const SceneBase = ({
  seed,
  clock,
  children,
}: {
  seed: string;
  clock?: number;
  children?: ReactNode;
}) => (
  <>
    <Backdrop seed={seed} {...(clock === undefined ? {} : { clock })} />
    {children}
  </>
);
