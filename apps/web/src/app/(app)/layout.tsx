import { UserButton } from '@clerk/nextjs';
import type { ReactNode } from 'react';
import { AppNav } from '../../components/app-nav.tsx';
import { Brand } from '../../components/brand.tsx';
import { Icon } from '../../components/icon.tsx';
import { requireSignedIn, workerBindings } from '../../server/next.ts';
import { pipelineKindFrom } from '../../server/pipeline/index.ts';

export const dynamic = 'force-dynamic';

/** The app: the 2px pixel, a 248px sidebar and one content column. Signed-in founders only. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSignedIn();
  const simulated = pipelineKindFrom(workerBindings().PIPELINE) === 'simulated';
  return (
    <div className="surface-app app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="side">
        <Brand href="/films" />
        <AppNav />
        <div className="me">
          <UserButton />
        </div>
      </aside>
      <div>
        {simulated ? (
          <p className="env-note" role="note">
            <Icon name="warning" size="sm" />
            Simulated films: no crew is working here, and nothing is rendered.
          </p>
        ) : null}
        <main id="main" className="app-main">
          {children}
        </main>
      </div>
    </div>
  );
}
