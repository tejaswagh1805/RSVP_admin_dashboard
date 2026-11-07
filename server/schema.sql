CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  track TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Dubai',
  detail TEXT NOT NULL DEFAULT '',
  followers TEXT NOT NULL DEFAULT '—',
  profile_url TEXT NOT NULL DEFAULT '',
  handle TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  outlet TEXT NOT NULL DEFAULT '',
  application_role TEXT NOT NULL DEFAULT '',
  all_profiles TEXT NOT NULL DEFAULT '',
  source_track TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  submitted DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS rsvp_member_number_seq START WITH 4;

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY DEFAULT ('mem-' || gen_random_uuid()::text),
  member_number INTEGER NOT NULL DEFAULT nextval('rsvp_member_number_seq'),
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  track TEXT NOT NULL,
  source_track TEXT NOT NULL DEFAULT '',
  rank TEXT NOT NULL DEFAULT 'Bronze',
  points INTEGER NOT NULL DEFAULT 0,
  events INTEGER NOT NULL DEFAULT 0,
  city TEXT NOT NULL DEFAULT 'Dubai',
  profile_url TEXT NOT NULL DEFAULT '',
  handle TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  followers INTEGER NOT NULL DEFAULT 0,
  mobile TEXT NOT NULL DEFAULT '',
  outlet TEXT NOT NULL DEFAULT '',
  member_role TEXT NOT NULL DEFAULT '',
  all_profiles TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'approved',
  joined DATE,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE members ADD COLUMN IF NOT EXISTS member_number INTEGER;

WITH numbered_members AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) + 3 AS member_number
  FROM members
)
UPDATE members AS member
SET member_number = numbered_members.member_number::INTEGER
FROM numbered_members
WHERE member.id = numbered_members.id
  AND member.member_number IS NULL;

SELECT setval(
  'rsvp_member_number_seq',
  GREATEST(COALESCE((SELECT MAX(member_number) FROM members), 3), 3),
  TRUE
);

ALTER TABLE members
  ALTER COLUMN member_number SET DEFAULT nextval('rsvp_member_number_seq'),
  ALTER COLUMN member_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS members_member_number_uidx
  ON members (member_number);

CREATE TABLE IF NOT EXISTS member_sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS member_sessions_member_id_idx ON member_sessions(member_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  date DATE,
  time TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Dining',
  tracks TEXT[] NOT NULL DEFAULT '{}',
  capacity INTEGER NOT NULL DEFAULT 80 CHECK (capacity >= 0),
  confirmed INTEGER NOT NULL DEFAULT 0,
  ticket_price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (ticket_price >= 0),
  ticket_currency TEXT NOT NULL DEFAULT 'AED',
  dress_code TEXT NOT NULL DEFAULT '',
  about TEXT NOT NULL DEFAULT '',
  included TEXT[] NOT NULL DEFAULT '{}',
  who_is_invited TEXT NOT NULL DEFAULT '',
  host_note TEXT NOT NULL DEFAULT '',
  image_key TEXT NOT NULL DEFAULT '',
  image_data TEXT NOT NULL DEFAULT '',
  image_gallery TEXT[] NOT NULL DEFAULT '{}',
  track_capacities JSONB NOT NULL DEFAULT '{}',
  influencer_deliverables TEXT NOT NULL DEFAULT '',
  map_url TEXT NOT NULL DEFAULT '',
  end_date DATE,
  end_time TEXT NOT NULL DEFAULT '',
  gates_open_time TEXT NOT NULL DEFAULT '',
  ticket_url TEXT NOT NULL DEFAULT '',
  reservation_phone TEXT NOT NULL DEFAULT '',
  creator_pass_note TEXT NOT NULL DEFAULT '',
  creator_pass_form_url TEXT NOT NULL DEFAULT '',
  creator_pass_form_error TEXT NOT NULL DEFAULT '',
  age_restriction TEXT NOT NULL DEFAULT '',
  hashtag TEXT NOT NULL DEFAULT '',
  application_deadline DATE,
  action_label TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL DEFAULT '',
  video_gallery TEXT[] NOT NULL DEFAULT '{}',
  latest_event BOOLEAN NOT NULL DEFAULT TRUE,
  top_pick BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'published', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS track_capacities JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS influencer_deliverables TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS map_url TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS end_time TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS gates_open_time TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_url TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS reservation_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS creator_pass_note TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS creator_pass_form_url TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS creator_pass_form_error TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS age_restriction TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS hashtag TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS application_deadline DATE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS action_label TEXT NOT NULL DEFAULT '';
ALTER TABLE events ALTER COLUMN brand SET DEFAULT '';
ALTER TABLE events ALTER COLUMN brand DROP NOT NULL;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_capacity_check;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_capacity_nonnegative;
ALTER TABLE events ADD CONSTRAINT events_capacity_nonnegative CHECK (capacity >= 0);

CREATE TABLE IF NOT EXISTS event_rsvp_requests (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  member_email TEXT NOT NULL,
  track TEXT NOT NULL,
  guest_names TEXT[] NOT NULL DEFAULT '{}',
  deliverables_agreed BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'waitlisted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, member_id)
);

CREATE INDEX IF NOT EXISTS event_rsvp_requests_event_status_idx ON event_rsvp_requests(event_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS event_rsvp_requests_member_idx ON event_rsvp_requests(member_id, created_at DESC);


CREATE TABLE IF NOT EXISTS wall_posts (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  posted TEXT NOT NULL DEFAULT 'Just now',
  boosted BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'live', 'removed')),
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_media (
  id TEXT PRIMARY KEY,
  slot TEXT NOT NULL CHECK (slot IN ('gallery', 'top_pick')),
  title TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  object_key TEXT NOT NULL,
  link_url TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS people_profiles (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('artist', 'influencer')),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL,
  object_key TEXT NOT NULL,
  gallery_images TEXT[] NOT NULL DEFAULT '{}',
  instagram_url TEXT NOT NULL DEFAULT '',
  tiktok_url TEXT NOT NULL DEFAULT '',
  youtube_url TEXT NOT NULL DEFAULT '',
  x_url TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE people_profiles ADD COLUMN IF NOT EXISTS subtitle TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('Our partners', 'Desi luxe', 'Dinner to party', 'Bars & night culture', 'Coffee', 'Daytime & alcohol-free')),
  name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  highlights TEXT[] NOT NULL DEFAULT '{}',
  offer TEXT NOT NULL DEFAULT '',
  featured_date DATE,
  image_url TEXT NOT NULL,
  object_key TEXT NOT NULL,
  website_url TEXT NOT NULL DEFAULT '',
  more_info_url TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  content_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS venues_category_order_idx ON venues (category, active, display_order, name);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  package TEXT NOT NULL DEFAULT 'Launch',
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  events INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trial', 'paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  track TEXT NOT NULL,
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  plus_ones INTEGER NOT NULL DEFAULT 0 CHECK (plus_ones >= 0),
  code TEXT NOT NULL UNIQUE,
  checked_in_at TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'pending_review', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guest_invitations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  guest_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  table_no TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  plus_ones INTEGER NOT NULL DEFAULT 0 CHECK (plus_ones BETWEEN 0 AND 2),
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ticket_requests (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  guest_name TEXT NOT NULL DEFAULT '',
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AED',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'awaiting_payment', 'paid', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_in_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS event_ticket_inquiries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  request_type TEXT NOT NULL DEFAULT 'ticket',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'closed', 'accepted', 'waitlisted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE event_ticket_inquiries ADD COLUMN IF NOT EXISTS instagram_handle TEXT NOT NULL DEFAULT '';
ALTER TABLE event_ticket_inquiries ADD COLUMN IF NOT EXISTS instagram_followers TEXT NOT NULL DEFAULT '';
ALTER TABLE event_ticket_inquiries ADD COLUMN IF NOT EXISTS creator_address TEXT NOT NULL DEFAULT '';
ALTER TABLE event_ticket_inquiries ADD COLUMN IF NOT EXISTS request_notes TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS event_ticket_inquiries_event_created_idx
  ON event_ticket_inquiries(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_ticket_inquiries_type_status_idx
  ON event_ticket_inquiries(event_id, request_type, status, created_at DESC);
ALTER TABLE ticket_requests ADD COLUMN IF NOT EXISTS stripe_session_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ticket_requests ADD COLUMN IF NOT EXISTS ticket_token TEXT UNIQUE;
ALTER TABLE ticket_requests ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE ticket_requests ADD COLUMN IF NOT EXISTS ticket_delivered_at TIMESTAMPTZ;
ALTER TABLE ticket_requests ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE ticket_requests DROP CONSTRAINT IF EXISTS ticket_requests_status_check;
ALTER TABLE ticket_requests ADD CONSTRAINT ticket_requests_status_check CHECK (status IN ('pending', 'awaiting_payment', 'approved', 'paid', 'rejected'));

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Admin' CHECK (role IN ('Owner', 'Admin')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE applications ADD COLUMN IF NOT EXISTS profile_url TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS handle TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS mobile TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS outlet TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS application_role TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS all_profiles TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS source_track TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE members ADD COLUMN IF NOT EXISTS source_track TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS profile_url TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS handle TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS followers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS mobile TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS outlet TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS member_role TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS all_profiles TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE members ADD COLUMN IF NOT EXISTS joined DATE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE events ADD COLUMN IF NOT EXISTS area TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_price NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_currency TEXT NOT NULL DEFAULT 'AED';
ALTER TABLE events ADD COLUMN IF NOT EXISTS dress_code TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS about TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS included TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE events ADD COLUMN IF NOT EXISTS who_is_invited TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS host_note TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS image_key TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS image_data TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS image_gallery TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE site_media ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image';
ALTER TABLE site_media ADD COLUMN IF NOT EXISTS captions_url TEXT NOT NULL DEFAULT '';
ALTER TABLE site_media ADD COLUMN IF NOT EXISTS captions_url TEXT NOT NULL DEFAULT '';
ALTER TABLE site_media ADD COLUMN IF NOT EXISTS captions_url TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS video_url TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS video_gallery TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE events ADD COLUMN IF NOT EXISTS top_pick BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS latest_event BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events ADD CONSTRAINT events_status_check CHECK (status IN ('draft', 'pending', 'published', 'closed'));

CREATE INDEX IF NOT EXISTS applications_status_idx ON applications(status, submitted DESC);
CREATE INDEX IF NOT EXISTS events_date_idx ON events(date);
CREATE INDEX IF NOT EXISTS guests_event_idx ON guests(event_id);
CREATE INDEX IF NOT EXISTS guest_invitations_event_created_idx ON guest_invitations(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS guest_invitations_event_status_idx ON guest_invitations(event_id, status);
CREATE INDEX IF NOT EXISTS ticket_requests_created_idx ON ticket_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS members_track_idx ON members(track, rank);
