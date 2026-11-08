'use client';

import { SignOutButton, useClerk } from '@clerk/nextjs';

/** Opens Clerk's own profile screen: name, email, password and sessions. */
export function ManageProfileButton() {
  const clerk = useClerk();
  return (
    <button className="btn btn-sm" type="button" onClick={() => clerk.openUserProfile()}>
      Manage profile and password
    </button>
  );
}

export function LogOutButton() {
  return (
    <SignOutButton redirectUrl="/">
      <button className="btn" type="button">
        Log out
      </button>
    </SignOutButton>
  );
}
