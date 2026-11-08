import { clerkClient, currentUser } from '@clerk/nextjs/server';
import type { Metadata } from 'next';
import { type SettingsOwner, SettingsScreen } from '../../../components/settings-screen.tsx';
import { pageContext } from '../../../server/next.ts';
import '../../../styles/delivery.css';

export const metadata: Metadata = { title: 'Settings' };

/** The account the videos belong to. Profile and password live in Clerk's own screen. */
export default async function SettingsPage() {
  const ctx = await pageContext();
  const [user, owner] = await Promise.all([
    currentUser().catch(() => null),
    ownerOf(ctx.account.kind, ctx.account.clerkOrgId),
  ]);
  return (
    <SettingsScreen
      person={
        user
          ? {
              name: user.fullName ?? user.username ?? null,
              email: user.primaryEmailAddress?.emailAddress ?? null,
            }
          : null
      }
      owner={owner}
      accountId={ctx.account.id}
      memberSince={ctx.account.createdAt}
    />
  );
}

/** The organisation's name when the videos are shared. A failed lookup still says who sees them. */
async function ownerOf(kind: 'user' | 'org', orgId: string | null): Promise<SettingsOwner> {
  if (kind === 'user' || !orgId) return { kind: 'user' };
  try {
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({ organizationId: orgId });
    return { kind: 'org', name: org.name };
  } catch {
    return { kind: 'org', name: null };
  }
}
