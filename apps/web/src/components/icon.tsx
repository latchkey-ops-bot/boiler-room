import { ICON_PATHS, type IconName } from './icons.generated.ts';

export type { IconName };

/**
 * A pixel icon from the design system, drawn in currentColor on its 12 by 12 grid. Use it at 12, 24
 * or 36px (`size="sm"`, the default, `size="lg"`); CSS can set other whole multiples. Icons are
 * decoration: always put the words beside them.
 */
export function Icon({
  name,
  size,
  className,
}: {
  name: IconName;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const classes = ['icon', size === 'sm' ? 'icon-sm' : size === 'lg' ? 'icon-lg' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <i className={classes}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 12 12"
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
      >
        <path fill="currentColor" d={ICON_PATHS[name]} />
      </svg>
    </i>
  );
}
