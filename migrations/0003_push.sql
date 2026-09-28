-- Web Push reminders: timed items at their due time, timed events event_reminder_minutes early.
ALTER TABLE users ADD COLUMN event_reminder_minutes INTEGER NOT NULL DEFAULT 0;

-- One row per browser that enabled notifications. The endpoint is the push service URL the
-- browser handed out; a device re-subscribing under another account moves the row to that user.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);

-- Reminders already sent, so overlapping cron windows notify once. The key includes the target
-- date and time, so rescheduling notifies again.
CREATE TABLE push_sent (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX idx_push_sent_sent_at ON push_sent(sent_at);
