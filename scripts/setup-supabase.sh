#!/bin/bash
# Sift — Supabase Setup Script
# Run this after creating a Supabase project to apply the initial schema.
#
# Prerequisites:
#   1. Install Supabase CLI: brew install supabase/tap/supabase
#   2. Login: supabase login
#   3. Link to your project: supabase link --project-ref YOUR_PROJECT_REF
#
# Usage:
#   ./scripts/setup-supabase.sh

set -euo pipefail

echo "Applying Sift database migration..."

# Check if supabase CLI is available
if ! command -v supabase &> /dev/null; then
  echo "Error: supabase CLI not found. Install with: brew install supabase/tap/supabase"
  exit 1
fi

# Apply the migration
supabase db push

echo ""
echo "Migration applied successfully!"
echo ""
echo "Next steps:"
echo "  1. Go to your Supabase dashboard → Settings → API"
echo "  2. Copy the 'URL' and 'anon public' key into .env.local:"
echo "     NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co"
echo "     NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ..."
echo "     SUPABASE_SERVICE_ROLE_KEY=eyJ..."
echo ""
echo "  3. Go to Authentication → JWT Secret and configure Clerk JWT template:"
echo "     - In Clerk Dashboard → JWT Templates → Create template"
echo "     - Name: supabase"
echo "     - Signing algorithm: HS256"
echo "     - Signing key: your Supabase JWT Secret"
echo ""
