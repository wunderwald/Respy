# Hosting the Respy web games

This document describes the server setup for the Respy breathing games: what
we need from the university, and what the research team sets up itself.
`<domain>` stands for the project domain, which hasn't been assigned yet.

## Overview

The games are a static web app (HTML, JavaScript, CSS) that children play on
tablets in the browser. At the end of each game run, the browser sends the
recorded data as one JSON document to a small server-side script, which stores
it in a MySQL database.

```
Tablet browser                       University web hosting               University MySQL
──────────────                       ──────────────────────               ────────────────
https://<domain>/         ── GET ──▶ static files (the games)
                                                                          database
end of a game run         ── POST ─▶ /api/runs.php (PHP) ──── INSERT ──▶  table game_runs
(JSON, ≈ 0.3–1 MB)                                                        
```

- The games and the data endpoint run on the **same domain**, so no
  cross-origin (CORS) configuration is needed.
- The browser never connects to the database. Only the PHP script does, using
  a database account restricted to `INSERT`.
- Tablets keep each run on the device until the server confirms it has been
  stored, so short outages don't lose data.

---

## 1. What we need from the university

### 1.1 Domain and HTTPS (required)

| Item | Requirement |
|---|---|
| Domain | `<domain>`, pointing to the web hosting below. |
| TLS certificate | A valid, publicly trusted certificate for `<domain>` (for example Let's Encrypt or the university CA), renewed automatically. |
| HTTP → HTTPS | Redirect all `http://` requests to `https://`. |

HTTPS is mandatory, not optional: browsers only allow microphone access on
pages served over HTTPS, and the main game is controlled by breathing into
the microphone.

### 1.2 Web hosting

| Item | Requirement |
|---|---|
| Static files | Serve a folder of HTML, JS, CSS and SVG files at the domain root `https://<domain>/`. |
| Server-side scripting | PHP 8.1 or newer, with the `pdo_mysql` extension. |
| Request size | Accept POST request bodies of at least **8 MB** on `/api/` (PHP `post_max_size` ≥ 8M; web server body limit, for example Apache `LimitRequestBody`, ≥ 8 MB). |
| Script limits | `memory_limit` ≥ 128M, `max_execution_time` ≥ 30 s. |
| Configuration | `.htaccess` files allowed (Apache), or an equivalent way for us to set the HTTP headers and access rules in 1.3. |
| Upload access | SFTP or SSH access for the research team to upload and replace files. |
| Credentials outside the web root | A directory that is **not** publicly reachable over HTTP, where the PHP script can read a config file with the database password. If there is no such directory, we will protect a folder with a deny rule in `.htaccess`. |

If PHP isn't offered, please tell us which server-side runtime is available
(for example Python or Node.js). The endpoint is small and can be written for
any of them.

### 1.3 HTTP headers and filters on the web server

Some default hosting configurations block what the games need. Please check:

- **Microphone permission:** the response headers must not deny the
  microphone. A header such as `Permissions-Policy: microphone=()` would
  break the main game. Either send no `Permissions-Policy` header, or allow
  it for the site itself: `Permissions-Policy: microphone=(self)`.
- **Content-Security-Policy:** if the hosting sets one, it must allow scripts
  and `connect-src` from `'self'`. The games load no external resources.
- **Web application firewall (for example ModSecurity):** POST requests to
  `/api/runs.php` with JSON bodies of up to 1–2 MB must not be blocked or cut
  off.
- **MIME types:** `.js` files must be served as `text/javascript` (or
  `application/javascript`). Browsers refuse to run JavaScript modules served
  with any other type.

### 1.4 MySQL database

| Item | Requirement |
|---|---|
| Version | MySQL 8.0+ (preferred) or MariaDB 10.5+. |
| Database | One database, for example `respy`, with character set `utf8mb4`. |
| Storage | About **5 GB** to start (see the estimate in section 5). |
| `max_allowed_packet` | ≥ 16 MB (the MySQL 8 default of 64 MB is fine). |
| Network access | Reachable from the web hosting (host and port). Not reachable from the public internet. |

Two database accounts:

| Account | Used by | Privileges |
|---|---|---|
| `respy_app` | The PHP endpoint on the web server | `INSERT` on `respy.game_runs` only. No `SELECT`, `UPDATE`, `DELETE` or schema changes. |
| `respy_admin` | The research team | All privileges on database `respy`. Used to create the table and to read and export data for analysis. |

For analysis, the research team needs read access to the data, through one
of:
- phpMyAdmin (or a similar web interface),
- a direct MySQL connection over VPN or SSH tunnel, or
- regular database dumps.

Please tell us which of these is possible.

### 1.5 Backups and data protection

- **Backups:** regular automated backups of the database, for example daily,
  with stated retention. Please tell us the schedule and how a restore is
  requested.
- **What is stored:** pseudonymous research data from children. That is
  breathing and tap time series, game events, calibration values, and technical
  device information (browser user agent, screen size, microphone model
  name). **No names or other direct identifiers** are stored. The table has an
  optional `client_ip` column, which we plan to leave empty.
- **Web server access logs:** these contain the IP addresses of the tablets.
  Please tell us how long access logs are kept.
- The data must stay on university-operated infrastructure. Please tell us
  where the hosting and the database are located.

### 1.6 What we need back from IT

- [ ] Domain name, and confirmation that HTTPS is active
- [ ] SFTP/SSH host, username and login method
- [ ] Path of the public web root, and of a non-public directory for the config file
- [ ] PHP version, and confirmation that `pdo_mysql` is installed and the request size limits are set
- [ ] Confirmation of the header and firewall points in 1.3
- [ ] MySQL host, port and database name
- [ ] Credentials for `respy_app` and `respy_admin`
- [ ] How we access the data for analysis (phpMyAdmin URL, VPN/SSH details, or dumps)
- [ ] Backup schedule and retention, access log retention, server location

---

## 2. What the research team sets up

1. **Database table:** run [`server/schema.sql`](server/schema.sql) once as
   `respy_admin`. This creates the table `game_runs`: one row per finished
   game run, with the full run document in a JSON column.
2. **Data endpoint:** upload the PHP script to `/api/runs.php`, and put its
   config file (database host, name, and the `respy_app` credentials) in the
   non-public directory. Its behaviour is specified in
   [`server/README.md`](server/README.md).
3. **Point the games at the endpoint:** set the endpoint URL in
   [`.env`](.env):
   ```
   VITE_DATA_API_URL=https://<domain>/api/runs.php
   ```
4. **Build the games:** run `npm run build`, which writes the finished app to
   `dist/`.
5. **Upload:** copy the *contents* of `dist/` into the public web root.
6. **Cache rules** in `.htaccess`:
   - `*.html`: no caching, so tablets pick up new versions.
   - `assets/*`: cache for a long time. These file names change with every
     build.
7. **Acceptance test** (section 4).

Updating the games later means repeating steps 4 and 5. The endpoint and the
database stay the same.

---

## 3. URLs after deployment

| URL | What |
|---|---|
| `https://<domain>/` | Game menu (microphone check, game selection, upload status) |
| `https://<domain>/trainingGame.html` | River Crossing (breath) |
| `https://<domain>/trainingGameControl.html` | River Crossing (tap) |
| `https://<domain>/chromeDinoGame.html` | Breath Runner |
| `https://<domain>/api/runs.php` | Data endpoint (POST only) |

The games are built to be served from the domain **root**. If they have to
live in a subfolder (for example `https://<domain>/games/`), the build setting
`base` in `vite.config.js` has to be changed first.

---

## 4. Acceptance test

On a tablet that will be used in the study:

1. Open `https://<domain>/`. There must be no certificate warning, and the
   menu must show "Mikrofon bereit" after the microphone permission is
   granted.
2. Play one run of River Crossing (breath) and one of River Crossing (tap)
   until the time is up.
3. Open the menu again. No "noch nicht hochgeladen" message may be shown.
4. In the database, check that there is one new row per run:
   ```sql
   SELECT run_id, game, variant, started_at, duration_s, sheep_delivered,
          JSON_LENGTH(data, '$.events') AS n_events
   FROM game_runs ORDER BY received_at DESC LIMIT 5;
   ```

---

## 5. Storage estimate

| | Per run (3 minutes) |
|---|---|
| River Crossing (breath): about 100 samples/s × 6 values, plus events | about 1 MB |
| River Crossing (tap): about 60 samples/s × 4 values, plus each tap | about 0.3 MB |

Example: 60 children × 10 sessions × 2 runs = 1,200 runs, which is about
0.8 GB of raw JSON. With MySQL storage overhead, indexes and room to grow,
5 GB is comfortable.
