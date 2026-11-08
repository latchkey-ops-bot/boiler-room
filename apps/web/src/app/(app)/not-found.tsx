import Link from 'next/link';
import { Boyle } from '../../components/boyle.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import '../../styles/delivery.css';

/** A video that does not exist, or belongs to another account. Inside the app, not the website. */
export default function AppNotFound() {
  return (
    <EmptyState
      heading="h1"
      title="We can't find that video"
      art={<Boyle size={96} />}
      action={
        <Link className="btn btn-primary" href="/films">
          Your videos
        </Link>
      }
    >
      <p>The link may be wrong, or the video belongs to another account.</p>
    </EmptyState>
  );
}
