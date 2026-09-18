export const CONFIG = {
  DURATION_SECS:     420,   // 7 minutes — also the fallback duration if the video is missing
  SUBJECT_CODE:      'TEST',
  DATA_DIR:          'output_data/baseline', // do not change

  // Resting-state video. Plays full-screen during the recording; if the file
  // is missing, falls back to the plain countdown display (DURATION_SECS).
  VIDEO_PATH: 'videos/01_Inscapes_NoScannerSound_h264.mov',
  VIDEO_MISSING_WARNING: 'video missing: download 01_Inscapes_NoScannerSound_h264.mov ' +
    'from https://www.headspacestudios.org/inscapes and place it in app/videos/.',

  SEND_MARKERS:      true,
  MARKER_STREAM_URL: 'ws://localhost:9001',
};

export const STATE = {
  IDLE:    'idle',
  PLAYING: 'playing',
  DONE:    'done',
};
