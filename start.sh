#!/bin/sh
# Find python3 wherever it is
PYTHON=$(command -v python3 || command -v python)
if [ -z "$PYTHON" ]; then
  echo "ERROR: No python found" && exit 1
fi
echo "Using Python: $PYTHON"
$PYTHON --version
$PYTHON -m pip install -r requirements.txt --quiet --break-system-packages 2>/dev/null || \
$PYTHON -m pip install -r requirements.txt --quiet
$PYTHON -m gunicorn app:app --bind 0.0.0.0:8080
