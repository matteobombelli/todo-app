-- An item's place among the items it ties with (same due date and time): null sorts by created_at,
-- so an item added below another gets a position between its neighbours.
ALTER TABLE items ADD COLUMN position REAL;

-- When items due on a date without a time notify, as HH:MM on their due date; null turns them off.
ALTER TABLE users ADD COLUMN item_reminder_time TEXT DEFAULT '09:00';
