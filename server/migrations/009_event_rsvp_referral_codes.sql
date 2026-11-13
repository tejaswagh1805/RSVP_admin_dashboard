ALTER TABLE event_rsvp_requests
  ADD COLUMN IF NOT EXISTS referral_code TEXT NOT NULL DEFAULT '';
