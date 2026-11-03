import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { readFile } from 'node:fs/promises';

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl || /USER:PASSWORD|@HOST\/DBNAME/i.test(databaseUrl)) {
  throw new Error('Set a valid DATABASE_URL in the admin project .env before running this migration.');
}

const sql = neon(databaseUrl);
for (const file of ['001_event_ticket_inquiries.sql', '002_creator_pass_requests.sql', '003_event_date_optional.sql', '004_creator_pass_applicant_details.sql', '005_google_form_event_interest.sql', '006_creator_pass_google_forms.sql']) {
  const migrationUrl = new URL(`./migrations/${file}`, import.meta.url);
  const migration = await readFile(migrationUrl, 'utf8');
  for (const statement of migration.split(';').map((part) => part.trim()).filter(Boolean)) {
    await sql.query(statement);
  }
}
console.info('Event request tables and optional event date are ready.');
