# stream — LSL Bridge and Marker Output

Two classes in [app/modules/stream/](./modules/stream/) connect the Electron frontend to the Python LSL bridge via WebSocket.

---

## StreamManager

Manages the WebSocket connection to the LSL bridge, renders a stream-selection dropdown, and emits typed events to the frontend.

```js
import { StreamManager } from './modules/stream/stream.js';

const sm = new StreamManager({
  container: document.querySelector('#stream-selector'),
  wsUrl:     'ws://localhost:8765',
  label:     'resp stream',
  filter:    'resp',              // auto-select first stream whose name contains this
});

sm.on('sample', ({ value, channels, timestamp }) => { /* called on every sample */ });
sm.on('status', ({ type, text, stream }) => {
  // type: 'connected' | 'disconnected' | 'searching'
});
sm.on('streams', (streams) => { /* full list whenever it changes */ });
```

**Auto-selection**: if `filter` is set and no stream has been manually chosen, `StreamManager` automatically selects the first stream whose name contains the filter string (excluding marker streams). It will not override a user's explicit "— none —" selection.

**The stream-selection dropdown is never locked**, even once an experiment session is underway and every other control is disabled — there's no `disable()` method, and no frontend calls one. This is deliberate: if the input stream drops mid-session, the experimenter must always be able to reselect or recheck it without the session blocking that.

**Reconnection**: the WebSocket reconnects automatically after a 3-second delay if the connection drops. Recovering the *same* selected stream by name is handled on the bridge side, not by resending `select_stream` on reconnect — the bridge keeps `selected_stream_name` as process-level state, independent of any one client connection, so:
- If the **LSL stream itself** drops (sensor unplugged, source app closed, …), the bridge's `read_one_stream` loop keeps retrying `resolve_byprop` for that same name indefinitely and reconnects automatically the moment it reappears — no client involvement needed.
- If the **WebSocket connection** between Electron and the bridge drops and `StreamManager` reconnects, the bridge's `ws_handler` immediately replies with the current status (`connected`/`searching`/`disconnected`) derived from its still-intact `selected_stream_name` — so the previously-selected stream carries over automatically, with no explicit reselection step required.
- The only case that doesn't recover automatically is the **bridge process itself** dying and restarting (not just a dropped connection) — that resets its in-memory selection, and the experimenter needs to reselect from the dropdown once it's back.

---

## MarkerStream

Sends string markers to a WebSocket endpoint for LSL forwarding. Non-blocking — markers are queued if the socket is not yet open.

```js
import { MarkerStream } from './modules/stream/markerStream.js';

const markers = new MarkerStream('ws://localhost:9001');
markers.send('trial_start_t0');
markers.send('trial_end_t0');
```

Reconnects automatically every 2 seconds if the connection is lost. Queued markers are flushed on reconnect.

---

## LSL bridge

The bridge ([lsl_ws_bridge/README.md](../../lsl_ws_bridge/README.md)) is a Python process that:

1. Discovers available LSL streams and broadcasts the list to connected clients.
2. Forwards samples from the selected stream as `{ type: 'sample', value, channels, timestamp }` JSON over WebSocket.
3. Accepts `{ type: 'select_stream', name }` messages from clients to switch streams.
4. Receives plain-text marker strings on a separate port and writes them to an LSL outlet (`RespFishMarkers`).

The bridge is started automatically by the Electron main process. To run it manually:

```bash
cd lsl_ws_bridge && python main.py
```

See [lsl_ws_bridge/README.md](../../lsl_ws_bridge/README.md) for port assignments and configuration.
