-- MySQL schema for game run data uploaded by the web games.
-- Requires MySQL 5.7.8+ / 8.x (JSON column type). MariaDB: JSON is an alias
-- for LONGTEXT with a JSON_VALID check — works the same for this table.
--
-- One row per finished run. The complete run document (as POSTed by the
-- game, see README.md) is kept verbatim in `data`; the columns before it are
-- copies of its key fields, for filtering/joining without parsing JSON.
-- Events / time series can be queried straight from `data` with JSON_TABLE
-- (MySQL 8) or exported and analysed offline.

CREATE TABLE IF NOT EXISTS game_runs (
  id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  run_id           CHAR(36)         NOT NULL,           -- doc.run_id (UUID), unique per run
  session_id       CHAR(36)         NOT NULL,           -- doc.session_id, one per page load
  run_index        INT UNSIGNED     NOT NULL,           -- doc.run_index within the session
  schema_version   SMALLINT UNSIGNED NOT NULL,          -- doc.schema_version
  game             VARCHAR(64)      NOT NULL,           -- 'trainingGame' | 'trainingGameControl'
  variant          VARCHAR(16)      NOT NULL,           -- 'breath' | 'tap'
  started_at       DATETIME(3)      NOT NULL,           -- doc.time.started_at (UTC)
  ended_at         DATETIME(3)      NOT NULL,           -- doc.time.ended_at (UTC)
  duration_s       DECIMAL(10,3)    NOT NULL,           -- doc.time.duration_s
  sheep_delivered  INT UNSIGNED     NULL,               -- doc.summary.sheep_delivered
  received_at      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  client_ip        VARCHAR(45)      NULL,               -- optional, set by the endpoint
  data             JSON             NOT NULL,           -- the full run document

  PRIMARY KEY (id),
  UNIQUE KEY uq_run_id (run_id),                       -- retried uploads are no-ops
  KEY ix_session (session_id),
  KEY ix_game_started (game, variant, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One run document is roughly 0.3 MB (tap) to 1 MB (3-min breath run), so
-- the server's max_allowed_packet (MySQL 8 default: 64 MB) is ample.

-- Example insert, as the endpoint should do it (idempotent on run_id):
--
-- INSERT INTO game_runs
--   (run_id, session_id, run_index, schema_version, game, variant,
--    started_at, ended_at, duration_s, sheep_delivered, client_ip, data)
-- VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
-- ON DUPLICATE KEY UPDATE id = id;
--
-- (started_at/ended_at: the ISO strings from doc.time, converted to
--  'YYYY-MM-DD HH:MM:SS.fff' UTC.)

-- Example: exhale events of all breath runs, one row each (MySQL 8):
--
-- SELECT r.run_id, e.t_ms, e.type, e.duration_ms
-- FROM game_runs r,
--      JSON_TABLE(r.data, '$.events[*]' COLUMNS (
--        t_ms        DOUBLE      PATH '$.t_ms',
--        type        VARCHAR(32) PATH '$.type',
--        duration_ms DOUBLE      PATH '$.duration_ms'
--      )) e
-- WHERE r.variant = 'breath' AND e.type IN ('exhale_start', 'exhale_end');
