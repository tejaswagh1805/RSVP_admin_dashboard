CREATE TABLE IF NOT EXISTS public_enquiries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public_enquiries DROP CONSTRAINT IF EXISTS public_enquiries_kind_check;
ALTER TABLE public_enquiries ADD CONSTRAINT public_enquiries_kind_check
  CHECK (kind IN ('host', 'press', 'press_asset', 'content'));
CREATE INDEX IF NOT EXISTS public_enquiries_kind_created_idx ON public_enquiries(kind, created_at DESC);
