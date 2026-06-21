#!/bin/sh
# v6 - force cache bust
set -e
PYTHON=$(which python3.11 || which python3 || echo "")
if [ -z "$PYTHON" ]; then echo "ERROR: python3 not found"; exit 1; fi
echo "Using $($PYTHON --version 2>&1)"
exec $PYTHON -m gunicorn app:app --bind 0.0.0.0:8080 --workers 1 --timeout 120
