-- Remove only the known demo rows from seed.sql. Other wall posts and clients remain intact.
DELETE FROM wall_posts WHERE id IN ('w1', 'w2', 'w3', 'w4', 'w5');
DELETE FROM clients WHERE id IN ('b1', 'b2', 'b3', 'b4', 'b5');
