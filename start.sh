#!/bin/sh
set -e

PYTHON=$(which python3.11 || which python3 || echo "")
if [ -z "$PYTHON" ]; then echo "ERROR: python3 not found"; exit 1; fi
echo "Using $($PYTHON --version 2>&1)"

# Create venv if it doesn't exist, then install deps there
if [ ! -f ".venv/bin/gunicorn" ]; then
  echo "Setting up virtualenv..."
  $PYTHON -m venv .venv
  .venv/bin/pip install --quiet flask flask-login werkzeug psycopg2-binary gunicorn
fi

exec .venv/bin/gunicorn app:app --bind 0.0.0.0:8080 --workers 1 --timeout 120
