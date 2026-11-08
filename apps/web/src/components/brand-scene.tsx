import type { CSSProperties, ReactNode } from 'react';
import {
  type BrandLook,
  type BrandSceneData,
  brandFontsHrefs,
  fontStack,
} from '../lib/brand-scene.ts';
import type { Format } from '../lib/film.ts';
import '../styles/brand-scene.css';

const SHAPE: Record<Format, string> = { '16:9': 'wide', '9:16': 'tall', '1:1': 'square' };
const NUMBER = /(\$?\d[\d,.]*(?:%|x\b)?)/g;

/**
 * One scene in the customer's brand, letterboxed in our dark stage. The one renderer for every
 * preview: script review, delivery and the landing page's sample. The customer's fonts load from
 * Google Fonts by name; a face that does not load falls back to a neutral system face, never ours.
 */
export function BrandStage({
  look,
  scene,
  format,
  tag,
  children,
}: {
  look: BrandLook;
  scene: BrandSceneData;
  format: Format;
  /** A short label on the stage, such as "Preview · Nova's brand". */
  tag?: string;
  /** Anything laid over the frame, such as a play button. */
  children?: ReactNode;
}) {
  const style = {
    '--bs-bg': look.background,
    '--bs-fg': look.foreground,
    '--bs-primary': look.primary,
    '--bs-muted': look.muted,
    '--bs-radius': `${look.radius}px`,
    '--bs-display': fontStack(look.displayFont),
    '--bs-body': fontStack(look.bodyFont),
  } as CSSProperties;
  const copy = scene.align === 'center' && !scene.showsProduct ? 'bs-copy bs-center' : 'bs-copy';
  return (
    <div className="brand-stage">
      {brandFontsHrefs(look).map((href) => (
        // React hoists these into the head once, however many previews ask for them.
        <link key={href} rel="stylesheet" href={href} precedence="brand-fonts" />
      ))}
      {tag ? <span className="bs-tag">{tag}</span> : null}
      <div
        className={`bs-frame bs-${SHAPE[format]}${scene.showsProduct ? ' bs-with-shot' : ''}`}
        style={style}
      >
        <div className={copy}>
          {scene.lines.map((line) => (
            <Line key={line.id} role={line.role} value={line.value} />
          ))}
        </div>
        {scene.showsProduct ? (
          <div className="bs-shot" aria-hidden="true">
            <div className="bs-dots">
              <i />
              <i />
              <i />
            </div>
            <div className="bs-bars">
              {[40, 62, 48, 80, 66, 96].map((height) => (
                <i key={height} style={{ height: `${height}%` }} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Line({ role, value }: { role: BrandSceneData['lines'][number]['role']; value: string }) {
  if (role === 'cta') return <span className="bs-cta">{value}</span>;
  const className = role === 'headline' ? 'bs-big' : role === 'label' ? 'bs-small' : 'bs-mid';
  const parts = value.split(NUMBER);
  return (
    <span className={className}>
      {parts.map((part, index) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one string never reorder
        index % 2 === 1 ? <em key={index}>{part}</em> : <span key={index}>{part}</span>,
      )}
    </span>
  );
}
