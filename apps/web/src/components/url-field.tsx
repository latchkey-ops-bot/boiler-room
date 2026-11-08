import { Icon } from './icon.tsx';

/**
 * The one field that matters: paste a URL, get a video. On the marketing site it is a plain GET
 * form to /films/new, so it works before sign-in: Clerk asks the visitor to sign in, then brings
 * them back with the URL filled in.
 */
export function UrlField({
  steam = false,
  label = 'Fire it up',
}: {
  steam?: boolean;
  label?: string;
}) {
  return (
    <form className="url-field px" action="/films/new" method="get">
      <Icon name="globe" />
      <input
        type="text"
        name="url"
        inputMode="url"
        autoComplete="url"
        placeholder="yourstartup.com"
        aria-label="Your product's URL"
        required
      />
      <button className={`btn ${steam ? 'btn-steam' : 'btn-primary'}`} type="submit">
        {label} <Icon name="arrow-right" />
      </button>
    </form>
  );
}
