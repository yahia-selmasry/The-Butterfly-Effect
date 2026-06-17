#!/bin/sh
PYTHON=/nix/store/flbj8bq2vznkcwss7sm0ky8rd0k6kar7-python-wrapped-0.1.0/bin/python3
$PYTHON -m pip install -r requirements.txt --quiet --break-system-packages 2>/dev/null || true
$PYTHON -m gunicorn app:app --bind 0.0.0.0:8080
