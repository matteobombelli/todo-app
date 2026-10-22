-- Goals: SMART goals over a fixed period, tracked by days of effort (½ or 1 a day) towards a target.
-- The rules that keep them honest (locking, the logging window) live in shared/goals.ts and are
-- enforced by worker/services/records.ts.
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  color TEXT NOT NULL,
  specific TEXT NOT NULL DEFAULT '',
  achievable TEXT NOT NULL DEFAULT '',
  relevant TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  target_days REAL NOT NULL,
  metric_label TEXT,
  metric_unit TEXT,
  metric_baseline REAL,
  metric_target REAL,
  before_note TEXT NOT NULL DEFAULT '',
  after_value REAL,
  after_note TEXT,
  status TEXT NOT NULL,
  -- Stamped by the server, never taken from a client.
  committed_at INTEGER,
  closed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_goals_user_seq ON goals(user_id, seq);

-- One live entry per goal and day; 0 effort is no entry at all.
CREATE TABLE goal_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_goal_entries_user_seq ON goal_entries(user_id, seq);
CREATE UNIQUE INDEX idx_goal_entries_live ON goal_entries(goal_id, date) WHERE deleted_at IS NULL;

-- When the evening nudge for goals not yet logged today goes out, as HH:MM; null turns it off.
ALTER TABLE users ADD COLUMN goal_reminder_time TEXT DEFAULT '20:00';
