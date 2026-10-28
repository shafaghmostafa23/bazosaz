CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  bale_user_id TEXT NOT NULL UNIQUE,
  token_encrypted TEXT NOT NULL,
  webhook_secret_encrypted TEXT NOT NULL,
  webhook_secret_hash TEXT NOT NULL UNIQUE,
  webhook_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (webhook_status IN ('pending', 'active', 'error')),
  webhook_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('start', 'keyword')),
  trigger_value TEXT NOT NULL DEFAULT '',
  nodes_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (bot_id, trigger_type, trigger_value)
);

CREATE TABLE IF NOT EXISTS bot_users (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  bale_user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  language_code TEXT NOT NULL DEFAULT '',
  last_message TEXT NOT NULL DEFAULT '',
  variables_json TEXT NOT NULL DEFAULT '{}',
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bot_id, bale_user_id)
);
CREATE INDEX IF NOT EXISTS bot_users_seen_idx ON bot_users(bot_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS bot_users_username_idx ON bot_users(bot_id, username);

CREATE TABLE IF NOT EXISTS conversations (
  bot_id TEXT NOT NULL,
  bale_user_id TEXT NOT NULL,
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  node_index INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (bot_id, bale_user_id),
  FOREIGN KEY (bot_id, bale_user_id) REFERENCES bot_users(bot_id, bale_user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  bale_user_id TEXT,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_bot_created_idx ON events(bot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_user_created_idx ON events(bot_id, bale_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  bale_user_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status TEXT NOT NULL CHECK (status IN ('received', 'accepted', 'failed')),
  method TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  provider_message_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS message_logs_bot_created_idx ON message_logs(bot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_logs_user_created_idx ON message_logs(bot_id, bale_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_updates (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  update_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'done')),
  received_at TEXT NOT NULL,
  PRIMARY KEY (bot_id, update_id)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_at);
