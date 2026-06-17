#!/bin/sh
/home/runner/workspace/.pythonlibs/bin/python -m pip install -r requirements.txt --quiet
/home/runner/workspace/.pythonlibs/bin/python -m gunicorn app:app --bind 0.0.0.0:8080
