-- Subtasks: parent_id names another item in the same list, one level deep (the service layer
-- checks both). Deleting, moving or completing the parent carries its subtasks along.
ALTER TABLE items ADD COLUMN parent_id TEXT;

CREATE INDEX idx_items_parent ON items(parent_id);
