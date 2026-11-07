ALTER TABLE events ADD COLUMN IF NOT EXISTS video_gallery TEXT[] NOT NULL DEFAULT '{}';
UPDATE events SET video_gallery = ARRAY[video_url] WHERE video_url <> '' AND cardinality(video_gallery) = 0;
