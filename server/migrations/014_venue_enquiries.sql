CREATE TABLE IF NOT EXISTS venue_enquiries (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  venue_name TEXT NOT NULL,
  visitor_name TEXT NOT NULL,
  visitor_email TEXT NOT NULL,
  visitor_phone TEXT NOT NULL DEFAULT '',
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  destination_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS venue_enquiries_venue_created_idx
  ON venue_enquiries (venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS venue_enquiries_email_idx
  ON venue_enquiries (lower(visitor_email), created_at DESC);
