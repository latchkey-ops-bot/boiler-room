'use client';

import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { Icon } from './icon.tsx';

/**
 * Who is signed in, as in the dashboard sample: a square crew-person tile and the person's name,
 * never Clerk's round avatar. It opens Settings, where the profile and log out are.
 */
export function AccountTile() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const name = user?.fullName || user?.firstName || email || 'Your account';
  return (
    <Link className="me" href="/settings" aria-label={`${name}: settings and log out`}>
      <span className="crew crew-person crew-person-sm" aria-hidden="true">
        <Icon name="user" />
      </span>
      <span className="who">
        <strong>{name}</strong>
        <span className="muted">Settings and log out</span>
      </span>
    </Link>
  );
}
