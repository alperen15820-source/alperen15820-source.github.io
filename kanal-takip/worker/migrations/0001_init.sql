-- Kanal Takip: çok kullanıcılı şema (Cloudflare D1 / SQLite)

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  locale TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  prefs TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  morning_date TEXT
);

CREATE TABLE devices (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  env TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX devices_user ON devices(user_id);

-- Kanallar kullanıcılar arasında paylaşılır: her kanal bir kez yoklanır.
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  polled_at INTEGER,
  playlist_at INTEGER
);

CREATE TABLE subscriptions (
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  position INTEGER NOT NULL,
  celebrated TEXT,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX subs_channel ON subscriptions(channel_id);

-- Bildirim bekleme süreleri (aynı şey için tekrar bildirim gönderme)
CREATE TABLE alerts (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  t INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel_id TEXT,
  video_id TEXT,
  url TEXT,
  milestone INTEGER
);
CREATE INDEX events_user_t ON events(user_id, t DESC);

CREATE TABLE handles (
  handle TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  resolved_at INTEGER NOT NULL
);

CREATE TABLE ratelimits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
