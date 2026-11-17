ALTER TABLE event_ticket_inquiries
  ADD COLUMN IF NOT EXISTS google_form_response_id TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS event_ticket_inquiries_google_form_response_uidx
  ON event_ticket_inquiries(google_form_response_id)
  WHERE google_form_response_id <> '';
