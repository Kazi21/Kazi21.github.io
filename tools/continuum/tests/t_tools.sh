#!/bin/sh
# Acceptance tests A1-A3 (calibration and analysis tools); see t_tools.py. Exit status 1 on failure.
exec python3 "$(dirname "$0")/t_tools.py" "$@"
