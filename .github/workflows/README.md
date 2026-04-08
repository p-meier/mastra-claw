# GitHub Actions Workflows

## `db-migrate.yml` — Supabase Migration Pipeline

Applies migrations from `supabase/migrations/*.sql` to the production
Supabase project on every push to `main`. Lints them on every PR.

### Required repository secrets

Set these in **GitHub → Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Where to get it |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens → "Generate new token". Personal access token, not the project keys. |
| `SUPABASE_DB_PASSWORD` | The Postgres database password (currently set in `.env.local`). **Rotate before adding here.** |
| `SUPABASE_PROJECT_ID` | The project ref. For this repo: `bscjrirbspiogrfalxyr` |

### Required GitHub Environment

The `apply` job pins to a GitHub Environment called `production`. Create it
under **Settings → Environments → New environment → "production"** and
optionally add **required reviewers** so a human has to approve every
migration push to prod.

### How it works

| Trigger | Job | Effect |
|---|---|---|
| PR opened/updated touching `supabase/migrations/**` | `lint` | Runs `supabase db lint` against the linked project. Does NOT apply. Blocks merge if SQL is invalid. |
| Merge to `main` touching `supabase/migrations/**` | `apply` | Links to project, lists pending migrations, runs `supabase db push --linked --include-all --yes`, prints final history. |
| Manual dispatch | `apply` | Same as above, for re-runs after a failed deploy. |

The `concurrency` group ensures only one `apply` job runs at a time per
branch — no races on `schema_migrations`.

### What the workflow does NOT do (yet)

- **No Vercel/Railway deploy gating.** When you wire up Vercel, you must
  ensure the app deploy waits for this workflow. Easiest path: disable
  Vercel auto-deploy on push, then add a final step here that calls a Vercel
  Deploy Hook only after a successful `db push`.
- **No preview branches per PR.** That requires Supabase Branching (paid
  compute). When you enable it, replace the `lint` job with the
  Supabase-managed branch apply.
- **No rollback automation.** Forward-only migrations are the rule. If
  something is broken in production, write a new compensating migration.
