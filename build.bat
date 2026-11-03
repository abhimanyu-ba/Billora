@echo off
cd /d "%~dp0"
set GOOS=windows
set GOARCH=amd64
set CGO_ENABLED=0
go build -trimpath -ldflags "-H windowsgui" -o dist\Billora.exe .
echo Built dist\Billora.exe
pause
