import { SignUp } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { Icon } from '../../../../components/icon.tsx';
import { carriedSite } from '../../../../lib/start.ts';

export const metadata: Metadata = { title: 'Sign up' };

/**
 * Sign-up, as the first wall after the landing page's URL field. The site the visitor typed rides
 * through in Clerk's `redirect_url`, so it shows here and fills the new video once they are in.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  const { redirect_url } = await searchParams;
  const site = carriedSite(typeof redirect_url === 'string' ? redirect_url : null);
  return (
    <div className="auth-page bg-dots">
      <div className="section-head">
        <h1>Start your launch video</h1>
        {site ? (
          <>
            <p className="carried">
              <Icon name="globe" size="sm" />
              {site}
            </p>
            <p className="muted">
              We kept your site. Make an account and it is waiting on the next screen, ready to go.
            </p>
          </>
        ) : (
          <p className="muted">Make an account, then paste your URL. You approve the script.</p>
        )}
      </div>
      <SignUp />
    </div>
  );
}
