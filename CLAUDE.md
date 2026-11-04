# Billora — notes for Claude Code

Billora is a commercial, white-label offline billing app for salons, sold to many businesses. Never hard-code any one customer's details. Customer-specific data belongs in setup/backup JSON files (see `menu.py` → `maestro-setup.json`).

## Architecture
- `main.go`: embeds `web/`, serves it on 127.0.0.1:47321, and stores `settings|services|staff|bills|products` as JSON files in `%APPDATA%\Billora` (or `BilloraData\` next to the exe). It writes atomically and takes a daily backup. If the port is busy, it focuses the existing window (or opens a browser window) and exits.
- `window_windows.go`: native Win32 window hosting WebView2 via `github.com/wailsapp/go-webview2` (only third-party dep, vendored in `vendor/` so it builds offline). Use its default pure-Go loader; never build with the `native_webview2loader` tag (embeds a DLL and loads it from memory, which antivirus flags). App quits when the window closes. Outside links (WhatsApp) are sent to the default browser via `postMessage('open:…')`. If WebView2 is missing or fails, it falls back to Edge/Chrome app mode (`browserMode`), which exits ~25 s after `/api/ping` stops. Errors go to `error.log` in the data dir.
- `web/app.js`: one plain JS file, no framework. Global state `S`; `save(key)` POSTs a whole collection.
- Money is stored in **paise (integers)** on bills; services store rupees. Use `calc()` for all totals.
- GST modes: `inclusive` | `exclusive` | `none`. CGST = SGST = half the rate. Rates are per line: services use `settings.gstRate`, a product may set its own `gstRate` (`''` = same as services). `calc()` shares the discount across lines, taxes each line, and returns `lines` (stored on bill items as `gstRate/taxable/cgst/sgst`) and `taxes` (per-rate totals, stored on the bill). Old bills have no `taxes`: always read GST through `billTaxes(b)` / `hasGST(b)` / `itemTax(b, i)`.
- Products (`S.products`): `{id, name, brand, cat, code (barcode), hsn, price (rupees), gstRate, stock, low, active}`. Bill items from products have `kind: 'product', pid, hsn`. Stock moves via `moveStock(bill, -1 | +1)` on save / cancel. A barcode scanner types into `#svcSearch` + Enter; an exact `code` match adds that product.
- Never write a DOM0 key handler as `el.onkeydown = e => e.key === 'Enter' && ok()`: returning `false` cancels every keystroke, so nothing can be typed. Use braces, or `addEventListener`.
- Invoice no: `PREFIX/FY/0001`, sequence per financial year (`fyOf`, `nextInvoice`). Keep it at 16 chars or fewer (GST rule).
- Bills are never deleted, only `status: 'cancelled'`.
- Backup file format: `{type:'billora-backup', version, settings, services, staff, bills, products}`.
- Testing the real window: set `BILLORA_PORT` (test copy on another port) and `BILLORA_DEVTOOLS_PORT` (Chrome DevTools Protocol on 127.0.0.1) and run the exe in portable mode (`BilloraData\` next to it, with a copy of the data) so live data is never touched. Close test windows with WM_CLOSE (`CloseMainWindow()`), not a hard kill: a killed WebView2 keeps the profile locked and the next start falls back to Edge. K7 holds newly built, unknown exes at startup (2 threads, no CPU); then test in headless Edge with the same CDP driver.

## Build
`./build.sh` (or `build.bat`) → `dist/Billora.exe`. Installer: `build-installer.bat` → `dist/Billora-Setup-<ver>.msi` (WiX 5 via `dotnet tool`, `installer/Billora.wxs`; per-user, no admin; never change its UpgradeCode). Don't switch to Inno Setup: K7 deletes its SetupLdr stub. Installer art comes from `web/icon.png` via `installer/mkbmp.ps1`; never use `logo.png` (that's a customer's logo). Don't add `-s -w` to ldflags: the stripped WebView2 build was deleted by K7 antivirus, the unstripped one passed. Check each release on virustotal.com. To change the icon or version, replace `icon.ico` and/or run `python mkrsrc.py icon.ico rsrc_windows_amd64.syso 1.0.0` (embeds icon, manifest and VERSIONINFO publisher details; bump the version each release). Unsigned builds without VERSIONINFO were deleted by K7 antivirus, so keep it.

## Ideas / roadmap
License keys for selling, multi-PC sync, appointments, purchase entries / supplier bills for products, SMS, loyalty points, membership packages.
