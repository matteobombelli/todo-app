-- One live exception per occurrence. The table-level UNIQUE (event_id, occurrence_date) counted
-- tombstones too, so once an occurrence's exception was deleted (an undone cancellation, say) no
-- new one could ever be written for it. SQLite can't drop a table constraint, so the table is
-- rebuilt with the same columns and a partial unique index instead.
PRAGMA defer_foreign_keys = true;

CREATE TABLE event_exceptions_new (
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
  deleted_at INTEGER
);

INSERT INTO event_exceptions_new
  (id, user_id, event_id, occurrence_date, cancelled, title, notes, color, all_day, start_date, start_time, end_date, end_time, created_at, updated_at, seq, deleted_at)
SELECT id, user_id, event_id, occurrence_date, cancelled, title, notes, color, all_day, start_date, start_time, end_date, end_time, created_at, updated_at, seq, deleted_at
FROM event_exceptions;

DROP TABLE event_exceptions;
ALTER TABLE event_exceptions_new RENAME TO event_exceptions;

CREATE INDEX idx_event_exceptions_user_seq ON event_exceptions(user_id, seq);
CREATE UNIQUE INDEX idx_event_exceptions_live ON event_exceptions(event_id, occurrence_date) WHERE deleted_at IS NULL;
