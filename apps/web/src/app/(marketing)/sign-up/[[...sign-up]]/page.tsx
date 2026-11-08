import { SignUp } from '@clerk/nextjs';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sign up' };

export default function SignUpPage() {
  return (
    <div className="auth-page bg-dots">
      <div className="section-head">
        <h1>Start your launch video</h1>
        <p className="muted">Make an account, then paste your URL. You approve the script.</p>
      </div>
      <SignUp />
    </div>
  );
}
