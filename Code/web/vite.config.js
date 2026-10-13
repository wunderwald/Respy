import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Games this project bundles. Each one gets its own HTML entry
// (<name>.html) alongside the launcher (index.html).
export const GAMES = ['trainingGame', 'chromeDinoGame']

// The Vite --mode flag selects what `vite build`/`vite dev` targets:
//   (default mode, 'development'/'production') -> everything (launcher + every
//                                                  game), one combined dist/
//   --mode launcher     -> just the launcher, dist/launcher/
//   --mode <gameName>   -> just that one game, dist/<gameName>/ — no launcher,
//                          no other game's code, for flashing a single tablet.
// A --mode flag (not an env var) so this works identically in cmd.exe on
// Windows tablets, matching the convention already used in ../app.
// See package.json's build:<game> / dev:<game> scripts.
function inputsFor(mode) {
  if (mode === 'development' || mode === 'production') {
    return Object.fromEntries([
      ['main', 'index.html'],
      ...GAMES.map((g) => [g, `${g}.html`]),
    ])
  }
  if (mode === 'launcher') return { main: 'index.html' }
  if (!GAMES.includes(mode)) throw new Error(`Unknown --mode: ${mode}`)
  return { [mode]: `${mode}.html` }
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: {
    outDir: mode === 'development' || mode === 'production' ? 'dist' : `dist/${mode}`,
    rollupOptions: { input: inputsFor(mode) },
    // The AudioWorklet processor module (shared/mic/breathEnvelopeProcessor.js)
    // is small enough to otherwise get base64-inlined as a data: URL — but
    // Safari (the realistic iPad target) has known issues loading worklet
    // modules from data: URLs, so disable inlining to guarantee it's always
    // served as a real, fetchable .js file.
    assetsInlineLimit: 0,
  },
}))
