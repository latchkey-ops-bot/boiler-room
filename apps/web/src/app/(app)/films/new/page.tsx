import type { Metadata } from 'next';
import { Icon, type IconName } from '../../../../components/icon.tsx';
import { NewFilmForm } from '../../../../components/new-film-form.tsx';
import { requireSignedIn } from '../../../../server/next.ts';

export const metadata: Metadata = { title: 'New video' };

const NEXT: { icon: IconName; text: string; you?: boolean }[] = [
  { icon: 'search', text: 'The Researcher reads your site and copies every claim word for word.' },
  { icon: 'clapper', text: 'The Director writes a short script from those claims.' },
  { icon: 'user', text: 'You read it and approve it. Nothing renders until you do.', you: true },
  { icon: 'mail', text: 'The crew animates it, cuts a file for each channel and sends it over.' },
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
          {NEXT.map((step) => (
            <li key={step.icon}>
              <span className={step.you ? 'crew crew-you' : 'crew crew-waiting'}>
                <Icon name={step.icon} />
              </span>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
