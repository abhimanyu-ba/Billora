#!/bin/sh
set -e
cd "$(dirname "$0")"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H windowsgui" -o dist/Billora.exe .
echo "Built dist/Billora.exe"
