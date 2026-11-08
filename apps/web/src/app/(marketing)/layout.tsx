import { Show } from '@clerk/nextjs';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Brand } from '../../components/brand.tsx';
import { MARKETING_CTA } from '../../lib/cta.ts';
import { showcaseOpen } from '../../server/marketing.ts';
import '../../styles/marketing.css';

export const dynamic = 'force-dynamic';

/**
 * The marketing site: the 3px pixel, the paper page, one nav and one footer. The nav names the
 * product at every width and always offers a way in: Log in, or Your videos once signed in. The
 * hero's URL field is the page's one primary action, so the nav's own call to action is the quiet
 * secondary button, and it steps aside on a phone, where the field is on the first screen.
 */
export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const showcase = await showcaseOpen();
  return (
    <div className="surface-marketing">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="site-nav wrap" aria-label="Main">
        <Brand />
        <div className="links">
          <Link href="/#how">How it works</Link>
          <Link href="/#channels">Channels</Link>
          {showcase ? <Link href="/showcase">Showcase</Link> : null}
        </div>
        <Show when="signed-out">
          <Link className="nav-in" href="/sign-in">
            Log in
          </Link>
          <Link className="btn btn-sm nav-cta" href="/#start">
            {MARKETING_CTA}
          </Link>
        </Show>
        <Show when="signed-in">
          <Link className="btn btn-sm nav-videos" href="/films">
            Your videos
          </Link>
        </Show>
      </nav>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="wrap">
          <img
            className="pixel"
            src="/brand/lockup.svg"
            width={124}
            height={48}
            alt="Boiler Room"
          />
          <span className="muted" style={{ fontSize: 14 }}>
            Made by a tiny crew of agents, for founders shipping this week.
          </span>
          <div className="links">
            <Link href="/#how">How it works</Link>
            <Link href="/#channels">Channels</Link>
            {showcase ? <Link href="/showcase">Showcase</Link> : null}
            <Show when="signed-out">
              <Link href="/sign-in">Log in</Link>
            </Show>
            <Show when="signed-in">
              <Link href="/films">Your videos</Link>
            </Show>
          </div>
        </div>
      </footer>
    </div>
  );
}
