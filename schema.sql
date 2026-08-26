-- subconverter logs D1 schema (retention default 180d, see spec_ui §7.6)
CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  time INTEGER NOT NULL,          -- epoch ms
  ip TEXT NOT NULL,               -- desensitized
  target TEXT,
  nodes INTEGER,
  cache TEXT,                     -- hit/miss
  status INTEGER,
  duration INTEGER,               -- ms
  detail TEXT,                    -- blocked_by_allowlist etc., no raw subscription
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(time);
CREATE INDEX IF NOT EXISTS idx_logs_ip ON logs(ip);
CREATE INDEX IF NOT EXISTS idx_logs_target ON logs(target);

-- retention config is stored in KV_ADMIN (retention:days), this table is for audit only
CREATE TABLE IF NOT EXISTS retention_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  changed_at INTEGER NOT NULL,
  old_days INTEGER,
  new_days INTEGER,
  changed_by TEXT
);
