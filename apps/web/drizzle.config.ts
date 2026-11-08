import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` only reads the schema and the migrations folder, so it needs no
// credentials. Wrangler applies the SQL files: see `pnpm web:db:migrate:<env>`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
