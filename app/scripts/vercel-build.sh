#!/bin/sh
# Vercel's build. The one thing it guards: a preview (any non-production
# build) must never touch the live database.
#
# Previews used to share DATABASE_URL with production and run `prisma db
# push` against it — an unmerged branch's preview could change the live
# schema, which once blocked every production deploy. Now a preview builds
# and runs against STAGING_DATABASE_URL (the cstl-staging Neon database,
# connected to the Preview environment only) and refuses to build at all if
# that isn't set, rather than falling back to production.
set -e

if [ "$VERCEL_ENV" != "production" ]; then
  if [ -z "$STAGING_DATABASE_URL" ]; then
    echo "Refusing to build a preview without STAGING_DATABASE_URL — previews must not use the live database."
    exit 1
  fi
  export DATABASE_URL="$STAGING_DATABASE_URL"
  echo "Preview build: using the staging database."
fi

prisma generate
prisma db push --skip-generate
next build
