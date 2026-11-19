# Data server contract

The games can't write to MySQL directly: browsers have no MySQL driver, and
database credentials in the frontend would be readable by anyone. Instead,
each finished run is POSTed as JSON to a small HTTP endpoint, which writes it
to MySQL. This folder describes what that endpoint has to do. The endpoint
itself isn't implemented yet.

- `schema.sql`: the MySQL table (`game_runs`).
- Endpoint URL: set in `../.env` as `VITE_DATA_API_URL` (currently a
  placeholder). The frontend reads it at build time.

## Request

```
POST <VITE_DATA_API_URL>
Content-Type: application/json

{ "schema_version": 1, "run_id": "uuid", "session_id": "uuid", "run_index": 1,
  "game": "trainingGame", "variant": "breath",
  "time": { "started_at": "2026-11-19T10:03:27.120Z", "ended_at": "…", "duration_s": 180.004, … },
  "summary": { "sheep_delivered": 12, … },
  "device": {…}, "audio": {…}, "calibration": {…}, "config": {…}, "detection": {…},
  "events": [ … ], "timeseries": { … } }
```

`audio` and `calibration` are only present for the breath variant. The body
is about 0.3 MB for a tap run and up to about 1 MB for a 3-minute breath run,
so the endpoint's request size limit must allow at least 5 MB to be safe.

## What the endpoint must do

1. Parse the JSON body and check that `run_id`, `session_id`, `game`,
   `variant` and `time.started_at` are present. If not, respond with
   **400**.
2. Insert one row into `game_runs` with a plain `INSERT`, copying the key
   fields into their columns and storing the whole body in `data`.
3. Respond with **201** if the row was stored. If the insert fails with a
   duplicate-key error (MySQL error 1062, same `run_id`), the run was already
   stored by an earlier attempt: respond with **200**. This way the database
   account the endpoint uses only needs the `INSERT` privilege.

How the frontend treats responses:

| Response | Frontend behaviour |
|---|---|
| 2xx, 409 | Stored. The run is removed from the device's queue. |
| 5xx, 408, 429, network error, timeout (30 s) | The run stays queued. The device stops for now and retries later (on page load, when the device comes back online, every 60 s, after the next run). |
| Other 4xx | The run stays queued. The device moves on to the next queued run. |

## CORS

The games are served from a different origin than the endpoint, and a JSON
POST triggers a CORS preflight. The endpoint must answer `OPTIONS` requests
and send these headers on both the preflight and the POST response:

```
Access-Control-Allow-Origin: <origin the games are served from>
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

## Access control

Anything shipped in the frontend, an API key included, is public, so the
endpoint is effectively open to anyone who knows its URL. Possible
mitigations, depending on the deployment:

- Restrict the endpoint by IP or network, for example to the lab network or
  VPN.
- Validate the payload strictly and cap the request size.
- Rate-limit requests.
