-- Repeating items: the RRULE (same subset as events) repeats from due_date. Completing one moves
-- due_date to the next occurrence instead of completing the row.
ALTER TABLE items ADD COLUMN rrule TEXT;
