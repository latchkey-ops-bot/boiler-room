import { type CSSProperties, useMemo } from 'react';
import { Img } from 'remotion';
import { assetUrl } from '../brand/assets.ts';
import { useBrand } from '../brand/brand-context.tsx';
import type { BrandTheme } from '../brand/theme.ts';
import { type Align, fitContain, type Rect } from '../layout/rect.ts';
import { type as typography } from '../tokens.ts';
import { type TextSpec, useFit, useTextStyle } from './text.tsx';

export interface MarkPlacement {
  box: Rect;
  align: Align;
}

const wordmarkSpec = (unitsTall: number): TextSpec => ({
  font: 'display',
  weight: typography.weight.strong,
  lineHeight: typography.lineHeight.label,
  maxSize: unitsTall,
  maxLines: 2,
  letterSpacing: typography.tracking.display,
  color: ({ colors }: BrandTheme) => colors.foreground,
});

/** The brand's name in its display font, for a brand with no logo that can be used. */
const useWordmark = ({ box }: MarkPlacement, unit: number) => {
  const spec = useMemo(() => wordmarkSpec(box.height / unit), [box.height, unit]);
  return { spec, fit: useFit(useBrand().name, spec, box.width, box.height) };
};

/** Where the mark's ink sits inside its box, which is what a carry moves. */
export function useMarkRect(placement: MarkPlacement, unit: number): Rect {
  const { logo } = useBrand();
  const { box, align } = placement;
  const { fit } = useWordmark(placement, unit);
  if (logo.kind === 'image') return fitContain(box, logo.aspect, align, 'center');
  const aspect = fit.width / Math.max(1, fit.height);
  return fitContain(
    { ...box, height: fit.height, y: box.y + (box.height - fit.height) / 2 },
    aspect,
    align,
    'center',
  );
}

const Wordmark = ({
  placement,
  unit,
  style,
}: {
  placement: MarkPlacement;
  unit: number;
  style?: CSSProperties;
}) => {
  const { box, align } = placement;
  const { spec, fit } = useWordmark(placement, unit);
  const textStyle = useTextStyle(spec, fit);
  return (
    <div
      style={{
        ...textStyle,
        ...style,
        left: box.x,
        position: 'absolute',
        textAlign: align === 'center' ? 'center' : align === 'end' ? 'right' : 'left',
        top: box.y + (box.height - fit.height) / 2,
        width: box.width,
      }}
    >
      {fit.lines.map((line) => (
        <div key={line} style={{ whiteSpace: 'pre' }}>
          {line}
        </div>
      ))}
    </div>
  );
};

/** The logo, or the name when there is no logo to use. It always fits its box. */
export const BrandMark = ({
  placement,
  unit,
  style,
}: {
  placement: MarkPlacement;
  unit: number;
  style?: CSSProperties;
}) => {
  const { logo, radius } = useBrand();
  if (logo.kind === 'wordmark')
    return <Wordmark placement={placement} unit={unit} style={style ?? {}} />;
  const rect = fitContain(placement.box, logo.aspect, placement.align, 'center');
  // A logo on a box of its own colour is drawn as a plate with the brand's corners, rather than as
  // a hard-edged slab on a background it does not match.
  const corners = logo.plate ? Math.min(radius, Math.min(rect.width, rect.height) * 0.25) : 0;
  return (
    <Img
      src={assetUrl(logo.src)}
      style={{
        ...style,
        borderRadius: corners,
        height: rect.height,
        left: rect.x,
        position: 'absolute',
        top: rect.y,
        width: rect.width,
      }}
    />
  );
};
