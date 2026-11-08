import { Show } from '@clerk/nextjs';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Brand } from '../../components/brand.tsx';
import '../../styles/marketing.css';

/** The marketing site: the 3px pixel, the paper page, one nav and one footer. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
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
          <Link href="/showcase">Showcase</Link>
          <Show when="signed-out">
            <Link href="/sign-in">Log in</Link>
          </Show>
          <Show when="signed-in">
            <Link href="/films">Your videos</Link>
          </Show>
        </div>
        <Link className="btn btn-primary btn-sm" href="/#start">
          Get my launch video
        </Link>
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
            <Link href="/showcase">Showcase</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
