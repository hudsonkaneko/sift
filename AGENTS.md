# AGENTS.md

## Cursor Cloud specific instructions

### Overview

**Sift** is a single Next.js 16 application (not a monorepo) — an AI-powered weekly schedule planner for ADHD brains. It uses Clerk for auth, Supabase for storage, and Anthropic Claude for AI chat. All backend logic lives in Next.js API routes under `src/app/api/`.

### Prerequisites

- **Node.js 20** (per `.nvmrc`). nvm is pre-configured with `default` alias set to 20.
- **npm** is the package manager (`package-lock.json` present).

### Environment variables

The app requires a `.env.local` file. See `DEPLOY.md` for the full list. The key variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Must be a valid Clerk key format (`pk_test_<base64>` where decoded value ends with `$` and contains `.`) |
| `CLERK_SECRET_KEY` | Yes | From Clerk dashboard |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `ANTHROPIC_API_KEY` | Optional | Only needed for AI chat feature |

### Running the app

- **Dev server**: `npm run dev` (port 3000)
- **Build**: `npm run build`
- **Lint**: `npx eslint` (pre-existing lint warnings/errors in the codebase)

### Gotchas

- **Clerk publishable key format**: The `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` must pass Clerk's internal validation. A placeholder like `pk_test_placeholder` will cause the build to fail during static page generation. The key must be `pk_test_<base64>` where the base64-decoded value ends with `$`, contains `.`, and has no `$` before the trailing one. Example valid placeholder: `pk_test_cGxhY2Vob2xkZXIuY2xlcmsuYWNjb3VudHMuZGV2JA==` (encodes `placeholder.clerk.accounts.dev$`).
- **Clerk sign-in for testing**: Clerk requires email verification on new-device sign-in, which blocks automated testing. To bypass this, create a sign-in token via the Clerk Backend API: `POST https://api.clerk.com/v1/sign_in_tokens` with `{"user_id": "<clerk_user_id>"}` using `$CLERK_SECRET_KEY`. Navigate directly to `http://localhost:3000/sign-in?__clerk_ticket=<token>` (tokens are single-use; do NOT navigate to the Clerk-hosted URL first or the token will be consumed).
- **User sync to Supabase**: When creating users via the Clerk API (not through the sign-up UI), they won't be synced to Supabase automatically (the webhook only fires for UI-driven sign-ups). Manually insert the user: `POST ${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/users` with the service role key, providing `id` (Clerk user ID), `email`, and `display_name`.
- **No test suite**: The codebase has no automated tests.
- **All data services are cloud-hosted**: Supabase and Clerk are external cloud services with no local Docker alternative configured. Full app functionality (auth, data persistence) requires real API keys.
- **Landing page (`/`) is a public route** and renders without authentication. Auth pages (`/sign-in`, `/sign-up`) require valid Clerk keys to display the Clerk UI components.
- **API routes use service role key**: All Supabase operations in API routes use `createServiceClient()` with the service role key (bypassing RLS), not per-user JWT tokens.
