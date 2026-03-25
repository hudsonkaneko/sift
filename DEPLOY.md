# Sift — Deployment Guide

## 1. Supabase Setup

1. **Create project** at [supabase.com](https://supabase.com)
   - Choose a region close to your users (e.g., `us-east-1`)
   - Save the generated database password

2. **Apply the schema** — choose one method:

   **Option A: Via Supabase CLI**
   ```bash
   brew install supabase/tap/supabase
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

   **Option B: Via SQL Editor**
   - Go to Supabase Dashboard → SQL Editor
   - Paste the contents of `supabase/migrations/001_initial_schema.sql`
   - Click "Run"

3. **Get your keys** from Settings → API:
   - `NEXT_PUBLIC_SUPABASE_URL` — Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon/public key
   - `SUPABASE_SERVICE_ROLE_KEY` — service_role key (keep secret!)

## 2. Clerk Setup

1. **Create application** at [clerk.com](https://clerk.com)
   - Enable Google OAuth and Email/Password sign-in methods

2. **Get your keys** from API Keys:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`

3. **Configure webhook** (for user sync to Supabase):
   - Go to Webhooks → Add Endpoint
   - URL: `https://your-domain.vercel.app/api/webhooks/clerk`
   - Events: `user.created`, `user.updated`, `user.deleted`
   - Copy the Signing Secret → `CLERK_WEBHOOK_SECRET`

4. **Configure JWT template** (for Supabase RLS):
   - Go to JWT Templates → Create template
   - Name: `supabase`
   - Signing algorithm: `HS256`
   - Signing key: Your Supabase JWT Secret (from Supabase Settings → API → JWT Settings)
   - Claims: `{ "sub": "{{user.id}}" }`

## 3. Google Calendar Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. **Create OAuth 2.0 Client ID** (Web application type)
3. **Add Authorized redirect URI**: `https://YOUR-DOMAIN/api/google-calendar/callback`
   - For local dev: `http://localhost:3000/api/google-calendar/callback`
   - For Vercel: `https://your-app.vercel.app/api/google-calendar/callback`
4. **Enable the Google Calendar API**: APIs & Services → Library → search "Google Calendar API" → Enable
5. Copy Client ID → `GOOGLE_CLIENT_ID`
6. Copy Client Secret → `GOOGLE_CLIENT_SECRET`

> **Important**: The redirect URI must match EXACTLY (including protocol and trailing path). If you use a custom domain, add that as a redirect URI too.

## 4. Anthropic Setup

1. Get API key from [console.anthropic.com](https://console.anthropic.com)
2. Set `ANTHROPIC_API_KEY` in your environment

## 5. Vercel Deployment

1. **Push to GitHub:**
   ```bash
   cd sift-web
   git remote add origin https://github.com/YOUR_USERNAME/sift-web.git
   git push -u origin main
   ```

2. **Import to Vercel:**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your GitHub repository
   - Framework: Next.js (auto-detected)

3. **Set environment variables** in Vercel project settings:
   ```
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
   CLERK_SECRET_KEY=sk_...
   CLERK_WEBHOOK_SECRET=whsec_...
   NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
   NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ANTHROPIC_API_KEY=sk-ant-...
   ```

4. **Deploy** — Vercel will auto-deploy on push to main

5. **Update Clerk webhook URL** to your production domain

## 6. Local Development

```bash
# Copy env template
cp .env.local.example .env.local
# Fill in all values in .env.local

# Install and run
nvm use 20
npm install
npm run dev
```

## Environment Variables Summary

| Variable | Where | Public? |
|----------|-------|---------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk Dashboard → API Keys | Yes |
| `CLERK_SECRET_KEY` | Clerk Dashboard → API Keys | No |
| `CLERK_WEBHOOK_SECRET` | Clerk Dashboard → Webhooks | No |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Static: `/sign-in` | Yes |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Static: `/sign-up` | Yes |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Settings → API | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API | No |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → Credentials | No |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → Credentials | No |
| `ANTHROPIC_API_KEY` | Anthropic Console → API Keys | No |
