-- Todo app v1 schema.
-- Ids are TEXT UUIDs (client-generated for synced rows), timestamps INTEGER unix milliseconds.
-- Dates are floating 'YYYY-MM-DD', times floating 'HH:MM'.
--
-- Every synced table carries seq (the owner's user_seq value at the row's last write) and
-- deleted_at (soft delete, so the deletion syncs as a tombstone).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  created_at INTEGER NOT NULL
);

-- id is hex(sha256(session token)); the raw token only ever lives in the cookie.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE user_seq (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL
);

-- Mutation op ids already applied, so a retried batch is not applied twice.
CREATE TABLE applied_ops (
  op_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_applied_ops_created ON applied_ops(created_at);

CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_lists_user_seq ON lists(user_id, seq);

-- list_id has no foreign key: ownership and liveness are checked by the service layer, and a
-- tombstoned list keeps its tombstoned items.
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  due_time TEXT,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_items_user_seq ON items(user_id, seq);
CREATE INDEX idx_items_list ON items(list_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  all_day INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  start_time TEXT,
  end_date TEXT NOT NULL,
  end_time TEXT,
  rrule TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_events_user_seq ON events(user_id, seq);

-- Override or cancellation of one occurrence of a recurring event, keyed by the date the rule
-- generated. Null override columns inherit from the event.
CREATE TABLE event_exceptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  occurrence_date TEXT NOT NULL,
  cancelled INTEGER NOT NULL,
  title TEXT,
  notes TEXT,
  color TEXT,
  all_day INTEGER,
  start_date TEXT,
  start_time TEXT,
  end_date TEXT,
  end_time TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (event_id, occurrence_date)
);

CREATE INDEX idx_event_exceptions_user_seq ON event_exceptions(user_id, seq);
