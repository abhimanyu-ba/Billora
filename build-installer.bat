@echo off
rem Builds dist\Billora.exe, then the installer dist\Billora-Setup-<version>.msi
rem Version comes from the exe (set by: python mkrsrc.py icon.ico rsrc_windows_amd64.syso X.Y.Z).
rem One-time setup (free, WiX 5 - newer WiX asks commercial users for a maintenance fee):
rem   dotnet tool install --global wix --version 5.0.2
rem   wix extension add -g WixToolset.UI.wixext/5.0.2
rem   wix extension add -g WixToolset.Util.wixext/5.0.2
cd /d "%~dp0"
call build.bat < nul
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Get-Item dist\Billora.exe).VersionInfo.ProductVersion"`) do set VER=%%v
wix build installer\Billora.wxs -arch x64 -ext WixToolset.UI.wixext -ext WixToolset.Util.wixext -d Version=%VER% -pdbtype none -o dist\Billora-Setup-%VER%.msi
if errorlevel 1 (echo Installer build FAILED & pause & exit /b 1)
echo Built dist\Billora-Setup-%VER%.msi
pause
