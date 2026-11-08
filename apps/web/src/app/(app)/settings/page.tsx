import { SignOutButton } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { pageContext } from '../../../server/next.ts';

export const metadata: Metadata = { title: 'Settings' };

/** The account the videos belong to. Profile and security live in Clerk's menu. */
export default async function SettingsPage() {
  const ctx = await pageContext();
  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p className="lede">Your videos belong to this account.</p>
      </div>
      <section className="card stack">
        <dl className="settings-list">
          <dt className="label">Account</dt>
          <dd className="mono">{ctx.account.id}</dd>
          <dt className="label">Owner</dt>
          <dd>{ctx.account.kind === 'org' ? 'Your organisation' : 'You'}</dd>
          <dt className="label">Member since</dt>
          <dd>{ctx.account.createdAt.toISOString().slice(0, 10)}</dd>
        </dl>
        <div>
          <SignOutButton>
            <button className="btn" type="button">
              Log out
            </button>
          </SignOutButton>
        </div>
      </section>
    </>
  );
}
