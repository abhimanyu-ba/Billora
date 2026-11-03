# Billora — Billing & Business Management

Offline billing software for salons (works for any service business). It's a single Windows `.exe`: no installation and no internet needed.

## For the shop owner
1. Copy `Billora.exe` anywhere, e.g. `C:\Billora\`, and double-click it. Right-click → *Send to → Desktop (create shortcut)* to add a desktop shortcut.
2. On first start, a setup screen asks for your business details. If you have a setup file (e.g. `maestro-setup.json`), click **I have a setup / backup file** instead.
3. Bill with **New Bill**: tap services (or type and press Enter), pick the payment mode, then **Save & Print (F9)**.

Data is saved automatically in `%APPDATA%\Billora`, with a daily backup copy kept for 60 days.
**Portable mode:** create a folder named `BilloraData` next to `Billora.exe`, and data will be kept there instead (useful on a pen drive).

Shortcuts: `F1` new bill · `F2` search services · `Enter` add first match · `F9` save & print · `Esc` close dialog.

Windows may show "Windows protected your PC" the first time, because the exe isn't code-signed. Click **More info → Run anyway**. For selling, buy a code-signing certificate to remove this message.

## Features
- Setup wizard. Each business sets its own name, logo, address, GSTIN, groups (Women/Men or any), services and staff
- GST: prices include GST / GST added on top / no GST, with CGST + SGST split, SAC code, and invoice numbers that restart every financial year (`PREFIX/26-27/0001`)
- Price ranges (e.g. ₹6000–10000), editable price per bill, custom items, ₹ or % discount
- Cash / UPI / Card / Split payment, cash change calculator
- Staff per service, with staff performance report for commission
- Customer lookup by mobile (visit count, total spent, last services)
- Bill sizes: 80 mm and 58 mm thermal, A5, A4. Works with any printer through the Windows print dialog
- Send bill on WhatsApp, reprint, cancel (cancelled bills are kept and marked, not deleted)
- Reports: sales, GST summary, payment modes, staff, top services, categories, day by day; print or CSV export for the accountant
- Services import/export as CSV (edit your menu in Excel)
- Full backup export/restore

## For developers (Claude Code)
Built with Go plus plain HTML/CSS/JS. Go serves the embedded `web/` folder on `127.0.0.1:47321` and shows it in its own window using WebView2 (the Edge engine built into Windows). The only third-party module, `github.com/wailsapp/go-webview2`, is vendored in `vendor/`, so it builds offline. If WebView2 is missing, it opens Edge (or Chrome) in app mode instead.

```
main.go                     local server, storage (JSON files), browser fallback
window_windows.go           native WebView2 window
web/index.html, app.css     UI
web/app.js                  all app logic (billing math in paise, printing, reports)
web/splash.jpg, icon.png    branding
icon.ico + mkrsrc.py        builds rsrc_windows_amd64.syso (exe icon + manifest)
menu.py                     generates maestro-setup.json (Maestro Unisex Salon preset)
build.bat / build.sh        build dist/Billora.exe
```

Build (requires Go 1.22+): `build.bat` on Windows or `./build.sh` on Linux/macOS.
Run in dev: `go run .` then open http://127.0.0.1:47321
