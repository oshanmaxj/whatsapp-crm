# WhatsApp CRM Backend - AI Integration

This backend includes OpenAI-powered features: AI auto replies, lead qualification & scoring, sentiment analysis, agent suggestions, and conversation summaries.

For the single-institute production setup for First Of Education International, see:

```text
backend/docs/first-of-education-production-readiness.md
```

## Environment
Create a `.env` file at the project root with these variables (example):

```
DB_NAME=whatsapp_crm
DB_USER=root
DB_PASSWORD=your_db_password
DB_HOST=127.0.0.1
DB_PORT=3306
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4.1-mini
REACT_APP_API_URL=http://localhost:4000/api
REACT_APP_SOCKET_URL=http://localhost:4000

# Optional: choose a different DB dialect
# Set `DB_DIALECT` to one of `mysql` (default), `postgres`, or `sqlite`.
# For `sqlite`, set `DB_STORAGE` to the sqlite file path (default `database.sqlite`).
# To use Supabase, set `DB_DIALECT=postgres` and provide `DATABASE_URL`.

# Example for Supabase/Postgres:
# DB_DIALECT=postgres
# DATABASE_URL=postgresql://postgres:<url-encoded-password>@db.your-supabase-project.supabase.co:5432/postgres
# Note: if your password contains special characters like `@`, `:` or `/`, percent-encode them.
# Example: password `firstofsolutions@1993` becomes `firstofsolutions%401993`.

# Example for SQLite (no DB server required):
# DB_DIALECT=sqlite
# DB_STORAGE=./data/whatsapp_crm.sqlite
```

## Install

From `backend/` run:

```bash
npm install
```

## Run migrations

The migration runner creates required feature tables and adds fields/indexes to existing tables. It is safe to run multiple times because it checks for existing schema objects before applying changes.

```bash
npm run migrate
```

## Start server

```bash
npm run dev
# or
npm start
```

## Repair duplicate conversations

After running migrations, inspect duplicate phone/account conversations without changing data:

```bash
npm run repair:conversations
```

Review the JSON summary, stop application traffic, then apply the repair:

```bash
npm run repair:conversations -- --apply
```

The apply mode runs in one database transaction, relinks every table containing a
`conversation_id` column, archives duplicate conversation rows, and creates the
active conversation identity unique index. Re-running it is safe.

## Notes
- The migration runner uses the same DB connection settings as `src/config/database.js`.
- If you prefer to run SQL manually, connect to your MySQL server and run equivalent ALTER TABLE statements.
- Make sure `OPENAI_API_KEY` is set for AI features to function.
