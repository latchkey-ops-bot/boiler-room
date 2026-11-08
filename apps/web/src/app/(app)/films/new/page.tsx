import type { Metadata } from 'next';
import { Icon, type IconName } from '../../../../components/icon.tsx';
import { NewFilmForm } from '../../../../components/new-film-form.tsx';
import { STOP_LABELS, type Stop } from '../../../../lib/film.ts';
import { requireSignedIn } from '../../../../server/next.ts';

export const metadata: Metadata = { title: 'New video' };

/** The same four stops as How it works on the landing page and the film's progress card. */
const NEXT: { stop: Stop; icon: IconName; text: string }[] = [
  {
    stop: 'research',
    icon: 'search',
    text: 'The Researcher reads your site and copies every claim.',
  },
  {
    stop: 'script',
    icon: 'clapper',
    text: 'The Director writes it; the Validator checks every number.',
  },
  {
    stop: 'approve',
    icon: 'user',
    text: 'You read it and approve it. Nothing renders until you do.',
  },
  {
    stop: 'make',
    icon: 'film',
    text: 'The crew animates it, cuts a file for each shape, and sends it.',
  },
];

/** One job: paste the website. The landing page's URL field lands here with `?url=`. */
export default async function NewFilmPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}) {
  await requireSignedIn();
  const { url } = await searchParams;
  const initialUrl = typeof url === 'string' ? url.slice(0, 2048) : '';
  return (
    <div className="new-film">
      <div className="page-head">
        <span className="label eyebrow">
          <b>01</b> New video
        </span>
        <h1>What are you launching?</h1>
        <p className="lede">
          Paste your website. The Researcher reads it, the Director writes a script, and you approve
          it before anything renders.
        </p>
      </div>
      <NewFilmForm initialUrl={initialUrl} />
      <section className="next-steps" aria-labelledby="next-steps-title">
        <h2 id="next-steps-title" className="label">
          What happens next
        </h2>
        <ol>
          {NEXT.map((step, index) => (
            <li key={step.stop}>
              <span className={step.stop === 'approve' ? 'crew crew-you' : 'crew crew-waiting'}>
                <Icon name={step.icon} />
              </span>
              <p>
                <strong>
                  {index + 1}. {STOP_LABELS[step.stop]}
                </strong>{' '}
                {step.text}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
