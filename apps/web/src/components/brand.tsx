import Link from 'next/link';

/** The mark at 48px and the wordmark at 20px, as in the samples' nav bars. */
export function Brand({ href = '/', compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link className="brand" href={href} aria-label="Boiler Room home">
      <img className="pixel" src="/brand/boiler-mark.svg" width={48} height={48} alt="" />
      {compact ? null : (
        <img
          className="pixel brand-word"
          src="/brand/wordmark.svg"
          width={136}
          height={20}
          alt="Boiler Room"
        />
      )}
    </Link>
  );
}
