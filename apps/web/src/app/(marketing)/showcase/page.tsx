import type { Metadata } from 'next';
import { Icon } from '../../../components/icon.tsx';
import { ShowcaseWall } from '../../../components/showcase-wall.tsx';
import { loadShowcase } from '../../../server/marketing.ts';

export const metadata: Metadata = { title: 'Showcase' };
export const dynamic = 'force-dynamic';

/** The launch wall: real films whose founders chose to show them, Boiler Room's own first. */
export default async function Showcase() {
  const launches = await loadShowcase(24);
  return (
    <>
      <div
        className="dither dither-cream dither-up"
        style={{ backgroundColor: 'var(--br-paper)' }}
      />
      <section className="section bg-cream showcase-page">
        <div className="wrap">
          <div className="wall-head">
            <div className="section-head">
              <span className="label eyebrow">
                <b>BR</b> Showcase
              </span>
              <h1>Fresh out of the boiler room</h1>
              <p>
                Launch videos the crew made, shown by the founders who launched them. Every one is a
                real launch.
              </p>
            </div>
            {/* A plain link: /start is a route handler that redirects, not a page. */}
            <a className="btn btn-primary" href="/start">
              <Icon name="plus" />
              Make yours
            </a>
          </div>
          <ShowcaseWall launches={launches} />
        </div>
      </section>
      <div className="dither dither-cream" />
    </>
  );
}
