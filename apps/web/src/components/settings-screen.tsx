import { LogOutButton, ManageProfileButton } from './account-buttons.tsx';
import { Icon } from './icon.tsx';

export interface SettingsPerson {
  name: string | null;
  email: string | null;
}

/** Who sees the videos: the founder alone, or everyone in their Clerk organisation. */
export type SettingsOwner = { kind: 'user' } | { kind: 'org'; name: string | null };

/**
 * The account the videos belong to, and the way out. Clerk keeps the profile and password, so
 * this screen links to Clerk's own screen for those. It takes plain data, so tests render it
 * without Clerk.
 */
export function SettingsScreen({
  person,
  owner,
  accountId,
  memberSince,
}: {
  person: SettingsPerson | null;
  owner: SettingsOwner;
  accountId: string;
  memberSince: Date;
}) {
  const since = memberSince.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p className="lede">Your account, and who can see your videos.</p>
      </div>

      <div className="settings">
        <section className="card settings-card" aria-labelledby="you-title">
          <div className="person">
            <span className="crew crew-person">
              <Icon name="user" />
            </span>
            <div className="who">
              <h2 id="you-title" className="card-title">
                {person?.name ?? 'You'}
              </h2>
              {person?.email ? <span className="muted">{person.email}</span> : null}
            </div>
          </div>
          <div>
            <ManageProfileButton />
          </div>
        </section>

        <section className="card card-flat settings-card" aria-labelledby="videos-title">
          <h2 id="videos-title" className="card-title">
            Your videos
          </h2>
          <dl className="settings-list">
            <dt className="label">Who can see them</dt>
            <dd>
              {owner.kind === 'org'
                ? `Everyone in ${owner.name ?? 'your organisation'}`
                : 'Only you'}
            </dd>
            <dt className="label">Member since</dt>
            <dd>{since}</dd>
            <dt className="label">Account</dt>
            <dd className="mono">{accountId}</dd>
          </dl>
        </section>

        <section className="settings-out" aria-label="Log out">
          <LogOutButton />
          <p className="hint">Your videos stay here for when you come back.</p>
        </section>
      </div>
    </>
  );
}
