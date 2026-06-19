#!/bin/sh
echo "=== START.SH ==="
echo "PATH: $PATH"
echo "Python3: $(python3 --version 2>&1)"
echo "Which python3: $(which python3 2>&1)"
echo "Which pip3: $(which pip3 2>&1)"
echo "Which gunicorn: $(which gunicorn 2>&1)"

# Find python3 anywhere common
PYTHON=""
for p in python3 python3.11 python3.10 /usr/bin/python3 /usr/local/bin/python3; do
  if $p --version >/dev/null 2>&1; then
    PYTHON=$p
    echo "Found python at: $PYTHON"
    break
  fi
done

if [ -z "$PYTHON" ]; then
  echo "ERROR: No python3 found. Listing /usr/bin and /usr/local/bin:"
  ls /usr/bin/python* 2>&1 || true
  ls /usr/local/bin/python* 2>&1 || true
  ls /nix/var/nix/profiles/ 2>&1 || true
  exit 1
fi

# Install deps
$PYTHON -m pip install -r requirements.txt --break-system-packages -q 2>/dev/null || \
$PYTHON -m pip install -r requirements.txt -q || true

echo "Starting gunicorn..."
exec $PYTHON -m gunicorn app:app --bind 0.0.0.0:8080 --workers 1
