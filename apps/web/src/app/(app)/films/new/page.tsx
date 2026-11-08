import type { Metadata } from 'next';
import { NewFilmForm } from '../../../../components/new-film-form.tsx';

export const metadata: Metadata = { title: 'New video' };

/** One job: paste the website. The landing page's URL field lands here with `?url=`. */
export default async function NewFilmPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}) {
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
    </div>
  );
}
