#!/bin/sh
python3 -m pip install -r requirements.txt --quiet
python3 -m gunicorn app:app --bind 0.0.0.0:8080
