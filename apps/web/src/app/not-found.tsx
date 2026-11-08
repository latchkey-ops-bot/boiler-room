import Link from 'next/link';
import { Boyle } from '../components/boyle.tsx';

export default function NotFound() {
  return (
    <main className="surface-marketing empty" style={{ minHeight: '70vh', alignContent: 'center' }}>
      <Boyle size={96} />
      <h1>Nothing here</h1>
      <p>This page doesn't exist, or it isn't yours.</p>
      <Link className="btn btn-primary" href="/">
        Go home
      </Link>
    </main>
  );
}
