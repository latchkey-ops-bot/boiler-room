import { Fragment } from 'react';

const NUMBER = /(\$?\d[\d,.]*(?:%|x\b)?)/g;

/** Text with every number wearing the butter claim highlight. */
export function ClaimText({ text }: { text: string }) {
  const parts = text.split(NUMBER);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one string never reorder
          <span key={index} className="claim">
            {part}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one string never reorder
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
