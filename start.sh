#!/bin/sh
python -m pip install -r requirements.txt --quiet --break-system-packages 2>/dev/null || true
python -m gunicorn app:app --bind 0.0.0.0:8080
