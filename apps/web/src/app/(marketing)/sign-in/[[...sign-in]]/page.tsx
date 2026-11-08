import { SignIn } from '@clerk/nextjs';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Log in' };

export default function SignInPage() {
  return (
    <div className="auth-page bg-dots">
      <div className="section-head">
        <h1>Welcome back</h1>
        <p className="muted">Log in to see your videos and what the crew decided.</p>
      </div>
      <SignIn />
    </div>
  );
}
