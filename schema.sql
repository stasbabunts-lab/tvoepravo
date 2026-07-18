-- Схема архіву (Cloudflare D1 / SQLite).
-- Публічний шар: incidents + evidence (знеособлено).
-- Захищений шар: submissions (контакти, IP-хеш, сирий payload) — лише для модерації.
-- Журнал: audit_log (chain of custody за Berkeley Protocol).
--
-- Застосувати:  npx wrangler d1 execute tvoepravo_archive --file=schema.sql --remote

-- Інциденти (події «who did what to whom»).
CREATE TABLE IF NOT EXISTS incidents (
  id           TEXT PRIMARY KEY,            -- uuid
  category     TEXT NOT NULL,               -- наразі лише 'tck'
  type         TEXT NOT NULL,               -- код типу з ARC_TYPES
  oblast       TEXT NOT NULL,
  city         TEXT,
  incident_date TEXT,                        -- YYYY-MM-DD (може бути NULL)
  date_approx  INTEGER NOT NULL DEFAULT 0,  -- 1 = дата приблизна
  summary      TEXT NOT NULL,
  actors       TEXT,                        -- JSON-масив кодів
  courts       TEXT,                        -- JSON-масив кодів судів
  status       TEXT NOT NULL DEFAULT 'pending', -- pending|verified|rejected|merged
  merged_into  TEXT,                        -- id інциденту, з яким об'єднано
  created_at   TEXT NOT NULL,
  verified_at  TEXT,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incidents_status  ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_lookup  ON incidents(category, oblast, incident_date);

-- Свідчення (посилання + доказова обгортка). Дедуп по canonical_id.
CREATE TABLE IF NOT EXISTS evidence (
  id           TEXT PRIMARY KEY,            -- uuid
  incident_id  TEXT NOT NULL REFERENCES incidents(id),
  url          TEXT NOT NULL,
  platform     TEXT,
  canonical_id TEXT,                        -- напр. youtube:<id>; UNIQUE → дедуп
  hash         TEXT,                        -- SHA-256 канонічного посилання
  snapshot_url TEXT,                        -- Wayback / archive.today
  captured_at  TEXT,
  created_at   TEXT NOT NULL
);
-- Ключовий дедуп: один і той самий ролик не задвоюється.
CREATE UNIQUE INDEX IF NOT EXISTS uq_evidence_canonical ON evidence(canonical_id) WHERE canonical_id IS NOT NULL;

-- Захищений шар: сирі подання, контакти, IP-хеш. НЕ публікується.
CREATE TABLE IF NOT EXISTS submissions (
  id           TEXT PRIMARY KEY,
  incident_id  TEXT REFERENCES incidents(id),
  contact      TEXT,                        -- email/telegram, лише для модерації
  ip_hash      TEXT,                        -- SHA-256(ip + salt), для анти-абузу
  user_agent   TEXT,
  raw_json     TEXT NOT NULL,               -- повний payload як надійшов
  turnstile_ok INTEGER NOT NULL DEFAULT 0,
  is_duplicate INTEGER NOT NULL DEFAULT 0,  -- 1 = свідчення вже було (другий свідок)
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_ip ON submissions(ip_hash, created_at);

-- Журнал дій модерації (ланцюг зберігання).
CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  incident_id  TEXT,
  action       TEXT NOT NULL,               -- submit|verify|reject|merge|edit
  actor        TEXT,                        -- email модератора з Cloudflare Access
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_incident ON audit_log(incident_id);
