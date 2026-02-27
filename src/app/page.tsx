import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const { userId } = await auth();

  if (userId) {
    redirect('/dashboard');
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-secondary">
      <div className="text-center space-y-6">
        <h1 className="text-4xl font-bold text-text-primary">
          <span className="text-accent">Sift</span>
        </h1>
        <p className="text-lg text-text-secondary max-w-md">
          AI-powered schedule planner built for ADHD brains.
          Chat with your planner, and it builds your week.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/sign-up"
            className="px-6 py-2.5 bg-accent text-white rounded-xl font-medium hover:bg-accent-dim transition-colors"
          >
            Get Started
          </Link>
          <Link
            href="/sign-in"
            className="px-6 py-2.5 bg-bg-primary text-text-primary border border-border rounded-xl font-medium hover:bg-bg-hover transition-colors"
          >
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
