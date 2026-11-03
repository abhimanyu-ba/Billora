# Billora — notes for Claude Code

Billora is a commercial, white-label offline billing app for salons, sold to many businesses. Never hard-code any one customer's details. Customer-specific data belongs in setup/backup JSON files (see `menu.py` → `maestro-setup.json`).

## Architecture
- `main.go`: embeds `web/`, serves it on 127.0.0.1:47321, and stores `settings|services|staff|bills` as JSON files in `%APPDATA%\Billora` (or `BilloraData\` next to the exe). It writes atomically and takes a daily backup. If the port is busy, it focuses the existing window (or opens a browser window) and exits.
- `window_windows.go`: native Win32 window hosting WebView2 via `github.com/wailsapp/go-webview2` (only third-party dep, vendored in `vendor/` so it builds offline). Use its default pure-Go loader; never build with the `native_webview2loader` tag (embeds a DLL and loads it from memory, which antivirus flags). App quits when the window closes. Outside links (WhatsApp) are sent to the default browser via `postMessage('open:…')`. If WebView2 is missing or fails, it falls back to Edge/Chrome app mode (`browserMode`), which exits ~25 s after `/api/ping` stops. Errors go to `error.log` in the data dir.
- `web/app.js`: one plain JS file, no framework. Global state `S`; `save(key)` POSTs a whole collection.
- Money is stored in **paise (integers)** on bills; services store rupees. Use `calc()` for all totals.
- GST modes: `inclusive` | `exclusive` | `none`. CGST = SGST = half the rate.
- Invoice no: `PREFIX/FY/0001`, sequence per financial year (`fyOf`, `nextInvoice`). Keep it at 16 chars or fewer (GST rule).
- Bills are never deleted, only `status: 'cancelled'`.
- Backup file format: `{type:'billora-backup', version, settings, services, staff, bills}`.

## Build
`./build.sh` (or `build.bat`) → `dist/Billora.exe`. Installer: `build-installer.bat` → `dist/Billora-Setup-<ver>.msi` (WiX 5 via `dotnet tool`, `installer/Billora.wxs`; per-user, no admin; never change its UpgradeCode). Don't switch to Inno Setup: K7 deletes its SetupLdr stub. Installer art comes from `web/icon.png` via `installer/mkbmp.ps1`; never use `logo.png` (that's a customer's logo). Don't add `-s -w` to ldflags: the stripped WebView2 build was deleted by K7 antivirus, the unstripped one passed. Check each release on virustotal.com. To change the icon or version, replace `icon.ico` and/or run `python mkrsrc.py icon.ico rsrc_windows_amd64.syso 1.0.0` (embeds icon, manifest and VERSIONINFO publisher details; bump the version each release). Unsigned builds without VERSIONINFO were deleted by K7 antivirus, so keep it.

## Ideas / roadmap
License keys for selling, multi-PC sync, appointments, product inventory, SMS, loyalty points, membership packages.
