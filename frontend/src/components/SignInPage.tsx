'use client';

import { signIn } from 'next-auth/react';
import { Mascot } from './Mascot';

export function SignInPage() {
  return (
    <main className="signin-page">
      <section className="signin-panel">
        <Mascot size={56} />
        <div className="signin-copy">
          <h1>Ahmad's Chatbot</h1>
          <p>Sign in to keep your chats, files, and settings with your account.</p>
        </div>
        <button className="google-signin-btn" onClick={() => signIn('google')}>
          <span className="google-mark" aria-hidden="true">G</span>
          <span>Sign in with Google</span>
        </button>
      </section>
    </main>
  );
}
