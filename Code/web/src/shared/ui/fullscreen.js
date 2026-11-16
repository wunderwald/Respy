// Fullscreen on game start. Browsers only allow entering fullscreen from a
// user gesture (tap/click) and drop it on every page navigation, so it can't
// be set once in the launcher — each game page requests it from its own
// "tap to start" handler instead.
//
// Support: Android Chrome/Firefox and desktop — yes. iPad Safari — yes
// (webkit-prefixed before iPadOS 16.4). iPhone Safari — no API for
// non-video elements; this is then a silent no-op.

export function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;

  try {
    if (el.requestFullscreen) {
      // navigationUI: 'hide' — ask Android Chrome to hide its nav bar too.
      el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
  } catch {
    // Not allowed / not supported — the game still works windowed.
  }
}
