/** The mark is drawn on a 24 pixel grid. Draw it only at whole multiples. */
export type BoyleSize = 24 | 48 | 72 | 96 | 120 | 168 | 192;

/**
 * Boyle, the boiler. He blinks for two frames every four seconds. The rising trail of steam puffs
 * plays only while a film is being made (`steaming`), as the founder decided on 2026-11-07.
 */
export function Boyle({
  size = 96,
  onDeep = false,
  steaming = false,
  className,
}: {
  size?: BoyleSize;
  onDeep?: boolean;
  steaming?: boolean;
  className?: string;
}) {
  const mark = onDeep ? '/brand/boiler-mark-on-deep.svg' : '/brand/boiler-mark.svg';
  // The puff is 9 grid pixels wide, at the mark's scale.
  const puff = (size / 24) * 9;
  return (
    <span
      className={['mascot', 'boyle', className].filter(Boolean).join(' ')}
      style={{ width: size }}
      aria-hidden="true"
    >
      <img src={mark} width={size} height={size} alt="" />
      {onDeep ? null : (
        <img
          className="blink"
          src="/brand/boiler-mark-blink.svg"
          width={size}
          height={size}
          alt=""
        />
      )}
      {steaming ? (
        <>
          <img className="puff puff-a" src="/brand/puff.svg" width={puff} alt="" />
          <img className="puff puff-b" src="/brand/puff.svg" width={puff} alt="" />
        </>
      ) : null}
    </span>
  );
}
