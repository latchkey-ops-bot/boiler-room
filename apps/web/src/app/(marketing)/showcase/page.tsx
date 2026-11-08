import type { Metadata } from 'next';
import { ShowcaseWall } from '../../../components/showcase-wall.tsx';
import { loadMyShowcase, loadShowcase, type MyShowcase } from '../../../server/marketing.ts';

export const metadata: Metadata = { title: 'Showcase' };
export const dynamic = 'force-dynamic';

/** The launch wall: real films whose founders chose to show them, Boiler Room's own first. */
export default async function Showcase() {
  const [launches, mine] = await Promise.all([loadShowcase(24), loadMyShowcase()]);
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
          </div>
          {mine ? <YourFilms mine={mine} /> : null}
          <ShowcaseWall launches={launches} />
        </div>
      </section>
      <div className="dither dither-cream" />
    </>
  );
}

/** For a founder who opted in: where their own film is. */
function YourFilms({ mine }: { mine: MyShowcase }) {
  return (
    <div className="alert alert-done wall-mine" role="status">
      <p>
        {mine.shown > 0 ? (
          <>
            <strong>
              {mine.shown === 1
                ? 'Your video is on the wall.'
                : `${mine.shown} of your videos are on the wall.`}
            </strong>{' '}
            It went up the moment you turned the showcase on. Turn it off on the video's delivery
            page at any time.
          </>
        ) : null}
        {mine.shown > 0 && mine.simulated > 0 ? ' ' : null}
        {mine.simulated > 0 ? (
          <>
            <strong>
              {mine.simulated === 1
                ? 'Your simulated video stays off the wall.'
                : 'Your simulated videos stay off the wall.'}
            </strong>{' '}
            Only real launches appear here. A real video goes up as soon as you turn the showcase
            on.
          </>
        ) : null}
      </p>
    </div>
  );
}
