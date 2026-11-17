INSERT INTO applications (id, name, email, track, city, detail, followers, submitted, status) VALUES
('app-1', 'Layla Haddad', 'layla@thegulfedit.com', 'Media', 'Dubai', 'Senior editor, The Gulf Edit — food & travel', '—', '2026-09-29', 'pending'),
('app-2', 'Omar Rashid', 'omar.creates@gmail.com', 'Creators', 'Dubai', 'Lifestyle & fashion, IG + TikTok', '128k', '2026-09-29', 'pending'),
('app-3', 'Chef Marco Vitale', 'marco@casavitale.ae', 'Tastemakers', 'Dubai', 'Executive chef, Casa Vitale', '22k', '2026-09-28', 'pending'),
('app-4', 'A. Al Suwaidi', 'office@alsuwaidi-group.ae', 'Private Circle', 'Abu Dhabi', 'Referred by member #0142 — assistant contact on file', 'Private', '2026-09-27', 'pending'),
('app-5', 'Sofia Mendes', 'sofia@luxereport.co', 'Creators', 'Dubai', 'Beauty creator — YouTube + IG', '41k', '2026-09-26', 'pending')
ON CONFLICT (id) DO NOTHING;

INSERT INTO events (
  id, title, brand, venue, date, time, gates_open_time, area, category,
  tracks, capacity, confirmed, ticket_price, ticket_currency, ticket_url,
  reservation_phone, creator_pass_note, age_restriction, hashtag,
  application_deadline, action_label, about, who_is_invited, status
) VALUES
('client-pataakha-2026', 'PATAAKHA: Pre-Diwali Bash', '', 'Surf Club, West Beach', '2026-11-04', '', '', 'Palm Jumeirah', 'Nightlife', '{}', 0, 0, 0, 'AED', 'https://district.ae/events/pataakha-2026-buy-tickets', '050-8553372', 'RSVP for limited creator passes.', '21+', '#RoadToPataakha', NULL, 'Buy tickets', 'PATAAKHA turns Surf Club into one massive firecracker of a night, headlined by AFTERALL live with G2, Vkram and Rahul Kateja. Surf Club is allowing desi dress on the beach for the first time. Picture 1,500 people, sand underfoot, sea breeze and bass you feel in your chest.', 'Tickets and reservations; age 21+. Limited creator passes by RSVP.', 'published'),
('client-double-trouble-2026', 'Double Trouble: Raunaq Rajani & Gursimran Khamba', '', 'Emirates Theatre', '2026-11-29', '17:00', '', 'Dubai', 'Comedy', '{}', 0, 0, 0, 'AED', 'https://dubai.platinumlist.net/event-tickets/109363/double-trouble-ft-gursimran-khamba-and-raunaq-rajani', '', 'RSVP for limited creator spots.', '', '', NULL, 'Buy tickets', 'Raunaq Rajani and Gursimran Khamba bring Double Trouble to Dubai for a night of quick wit, brutally honest observations and jokes to repeat in the group chat. Catch them live together on one stage.', 'Limited creator spots; request a creator pass through RSVP DXB.', 'published'),
('client-chai-chandan-2026', 'Chai with Chandan: Chandan Prabhakar', '', 'Emirates Theatre', '2026-12-19', '', '16:00', 'Dubai', 'Comedy', '{}', 0, 0, 0, 'AED', '', '', 'RSVP for limited creator spots.', '', '', NULL, 'Ticket link to add', 'Chandan Prabhakar brings his signature desi humour to Dubai, with warmth, nostalgia and comedy for the whole family.', 'Gates open at 4:00 PM. Ticket link to be added. Creator spots are limited; request a creator pass through RSVP DXB.', 'published'),
('client-kullu-comedy-2026', 'Kullu, Nishant Suri & Kaustubh Aggarwal', '', 'Emirates Theatre', '2026-12-26', '', '', 'Dubai', 'Comedy', '{}', 0, 0, 0, 'AED', '', '', 'RSVP for limited creator spots.', '', '', NULL, 'Ticket link to add', 'Kullu, Nishant Suri and Kaustubh Aggarwal team up for one night of back-to-back comedy sets and desi energy.', 'Creator spots are limited; request a creator pass through RSVP DXB.', 'published'),
('client-global-digital-creator-awards-2027', 'Global Digital Creator Awards: Asian Film Festival of Dubai', 'Asian Film Festival of Dubai', '', '2027-02-05', '', '', 'Dubai', 'Awards', '{}', 0, 0, 0, 'AED', 'https://www.affdubai.com/awards', '', 'Post one video in collaboration with @asian.filmfestivalofdubai and submit the form at affdubai.com/awards. There are 20 categories, with winners selected by public vote and jury.', '', '', '2026-11-28', 'Get nominated', 'The Asian Film Festival of Dubai is celebrating creators with the Global Digital Creator Awards. Open to food, fashion, travel, comedy, lifestyle and other creators. Nominations close 28 November 2026; awards night in Dubai is 5 February 2027.', 'Nomination requires a collaboration video with @asian.filmfestivalofdubai and the online form.', 'published')
ON CONFLICT (id) DO NOTHING;

INSERT INTO members (id, name, email, track, rank, points, events, city) VALUES
('m1', 'Tejas Nair', 'tejas@creators.ae', 'Creators', 'Gold', 640, 18, 'Dubai'),
('m2', 'Hala Zayed', 'hala@example.com', 'Media', 'Diamond', 1180, 31, 'Dubai'),
('m3', 'Rami Fawaz', 'rami@example.com', 'Tastemakers', 'Silver', 310, 9, 'Sharjah'),
('m4', 'Private #0142', 'private-0142@example.com', 'Private Circle', 'Bronze', 0, 6, 'Dubai'),
('m5', 'Nadia Khan', 'nadia@example.com', 'Creators', 'Platinum', 2740, 58, 'Dubai'),
('m6', 'Jon Abela', 'jon@example.com', 'Media', 'Silver', 220, 7, 'Dubai')
ON CONFLICT (id) DO NOTHING;

INSERT INTO events (id, title, brand, venue, date, time, area, category, tracks, capacity, confirmed, status) VALUES
('atlantis-chef-table', 'Chef''s Table at Ossiano', 'Atlantis The Royal', 'Ossiano, Atlantis The Royal', '2026-10-03', '19:30', 'Palm Jumeirah', 'Dining', ARRAY['Media','Tastemakers'], 24, 21, 'published'),
('jumeirah-spring-launch', 'Spring Collection Launch', 'Maison Dalia', 'Alserkal Avenue, Warehouse 42', '2026-10-04', '20:00', 'Al Quoz', 'Fashion', ARRAY['Creators','Media'], 120, 120, 'published'),
('dubai-hills-preview', 'Private Residence Preview', 'Vantage Developments', 'Dubai Hills Estate', '2026-10-08', '18:00', 'Dubai Hills', 'Property', ARRAY['Private Circle'], 16, 9, 'published'),
('marina-sunset-session', 'Sunset Listening Session', 'Nuvo Audio', 'Bluewaters Terrace', '2026-10-11', '17:30', 'Bluewaters', 'Music', ARRAY['Creators','Tastemakers'], 80, 54, 'published'),
('difc-art-night', 'Collectors Night', 'Gallery Seventeen', 'DIFC Gate Village 9', '2026-10-16', '19:00', 'DIFC', 'Art', ARRAY['Private Circle','Tastemakers'], 40, 28, 'published'),
('beach-club-opening', 'Season Opening Brunch', 'Sirene Beach Club', 'Jumeirah Beach Road', '2026-10-18', '13:00', 'Jumeirah', 'Nightlife', ARRAY['Creators','Media','Tastemakers'], 200, 142, 'pending')
ON CONFLICT (id) DO NOTHING;

INSERT INTO wall_posts (id, brand, type, body, posted, boosted, status, event_id) VALUES
('w1', 'Sirene Beach Club', 'Places Just Opened', 'Six places just opened for Season Opening Brunch this Saturday. First come, first served.', '2h ago', TRUE, 'live', 'beach-club-opening'),
('w2', 'Maison Dalia', 'New Event', 'Spring Collection Launch — Alserkal Avenue, 4 October. Creators and fashion press only.', '5h ago', FALSE, 'live', 'jumeirah-spring-launch'),
('w3', 'Nuvo Audio', 'Member Offer', '20% member discount on the terrace menu all October. Show your digital pass.', 'Yesterday', FALSE, 'live', NULL),
('w4', 'Atlantis The Royal', 'Recap', 'Thank you to everyone who joined last week''s Chef''s Table. 41 pieces of content collected.', '2 days ago', FALSE, 'live', NULL),
('w5', 'Gallery Seventeen', 'Sponsored', 'Collectors Night at DIFC — a curator-led evening with the artists present.', 'Pending review', FALSE, 'pending', 'difc-art-night')
ON CONFLICT (id) DO NOTHING;

INSERT INTO clients (id, name, package, credits, events, status) VALUES
('b1', 'Atlantis The Royal', 'Signature', 42, 11, 'active'),
('b2', 'Maison Dalia', 'Launch', 8, 3, 'active'),
('b3', 'Sirene Beach Club', 'Season', 26, 7, 'active'),
('b4', 'Vantage Developments', 'Private', 15, 2, 'trial'),
('b5', 'Nuvo Audio', 'Launch', 4, 1, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO guests (id, name, track, event_id, plus_ones, code, status) VALUES
('g1', 'Tejas Nair', 'Creators', 'marina-sunset-session', 1, 'RSVP-4471', 'confirmed'),
('g2', 'Hala Zayed', 'Media', 'marina-sunset-session', 0, 'RSVP-2208', 'confirmed'),
('g3', 'Rami Fawaz', 'Tastemakers', 'marina-sunset-session', 1, 'RSVP-9014', 'confirmed'),
('g4', 'Nadia Khan', 'Creators', 'marina-sunset-session', 2, 'RSVP-7731', 'confirmed'),
('g5', 'Jon Abela', 'Media', 'marina-sunset-session', 0, 'RSVP-5520', 'confirmed')
ON CONFLICT (id) DO NOTHING;

-- The workbook identifies these seeded wall posts and client accounts as demo data.
DELETE FROM wall_posts WHERE id IN ('w1', 'w2', 'w3', 'w4', 'w5');
DELETE FROM clients WHERE id IN ('b1', 'b2', 'b3', 'b4', 'b5');
