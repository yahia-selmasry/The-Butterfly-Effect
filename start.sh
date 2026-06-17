#!/bin/sh
python3 -m pip install -r requirements.txt --quiet --break-system-packages 2>/dev/null || \
python3 -m pip install -r requirements.txt --quiet || true
python3 -m gunicorn app:app --bind 0.0.0.0:8080
