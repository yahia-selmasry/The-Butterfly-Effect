#!/bin/sh
set -e
echo "=== START.SH ==="
echo "Python: $(python3 --version 2>&1 || echo NOT FOUND)"
echo "Gunicorn: $(gunicorn --version 2>&1 || echo NOT FOUND)"
echo "Pip: $(pip3 --version 2>&1 || echo NOT FOUND)"
echo "PATH: $PATH"

# Install deps if pip is available
if command -v pip3 >/dev/null 2>&1; then
  pip3 install -r requirements.txt --quiet --break-system-packages 2>/dev/null || \
  pip3 install -r requirements.txt --quiet || true
fi

# Try gunicorn directly, fall back to python -m gunicorn
if command -v gunicorn >/dev/null 2>&1; then
  exec gunicorn app:app --bind 0.0.0.0:8080 --workers 1
else
  exec python3 -m gunicorn app:app --bind 0.0.0.0:8080 --workers 1
fi
