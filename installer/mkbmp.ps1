# Draws the MSI wizard images from web\icon.png (Billora's own brand, never a customer logo):
#   dialog.bmp 493x312 - Welcome/Finish pages (blue panel on the left 164 px; text goes on the right)
#   banner.bmp 493x58  - top banner on the other pages (icon on the right)
# Run: powershell -ExecutionPolicy Bypass -File installer\mkbmp.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$icon = [System.Drawing.Image]::FromFile((Join-Path $root 'web\icon.png'))

function New-Canvas($w, $h) {
    $b = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($b)
    $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.Clear([System.Drawing.Color]::White)
    return $b, $g
}

# Welcome / Finish side image
$b, $g = New-Canvas 493 312
$panel = New-Object System.Drawing.Rectangle 0, 0, 164, 312
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $panel, ([System.Drawing.Color]::FromArgb(13, 91, 215)), ([System.Drawing.Color]::FromArgb(22, 48, 110)), 90
$g.FillRectangle($grad, $panel)
$disc = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$g.FillEllipse($disc, 22, 70, 120, 120)
$g.DrawImage($icon, 34, 82, 96, 96)
$f1 = New-Object System.Drawing.Font 'Segoe UI', 20, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$f2 = New-Object System.Drawing.Font 'Segoe UI', 11, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'
$white = [System.Drawing.Brushes]::White
$g.DrawString('Billora', $f1, $white, (New-Object System.Drawing.RectangleF 0, 204, 164, 30), $fmt)
$g.DrawString("Billing & Business`nManagement", $f2, $white, (New-Object System.Drawing.RectangleF 0, 234, 164, 40), $fmt)
$b.Save((Join-Path $PSScriptRoot 'dialog.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $b.Dispose()

# Top banner
$b, $g = New-Canvas 493 58
$g.DrawImage($icon, 433, 5, 48, 48)
$line = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(13, 91, 215)), 2
$g.DrawLine($line, 0, 57, 493, 57)
$b.Save((Join-Path $PSScriptRoot 'banner.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $b.Dispose(); $icon.Dispose()
Write-Output 'wrote installer\dialog.bmp and installer\banner.bmp'
