HOST_IP = "100.1.1.1"

SCREEN_W = 1920
SCREEN_H = 1080
SCREEN_INDEX = 1          # 0-indexed PsychoPy screen; Screen 2 is index 1
SAMPLE_RATE = 500.0

EDF_FILENAME = "session"  # overridden per participant via --edf-filename

CONTROL_WS_HOST = "localhost"
CONTROL_WS_PORT = 9002

AUTO_CALIBRATE = True     # run calibration once automatically after connect()
AUTO_START = True         # start recording automatically once calibrated

# EyeLink setup mode opens on the camera-setup screen; calibration only starts
# when the operator presses C. These inject that C press automatically:
STARTUP_SKIP_CAMERA_SETUP = False   # first calibration: keep camera setup (adjust focus / thresholds)
RECAL_SKIP_CAMERA_SETUP = True      # app-triggered recalibrations: go straight to the targets
