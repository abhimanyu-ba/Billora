//go:build windows

// Floating launch screen (like Visual Studio / Adobe): a borderless, centred window with
// rounded corners and a shadow that shows web/splash.jpg plus a progress bar while the
// main window loads hidden behind it. The page reports progress with
// postMessage('splash:<pct>:<text>') and postMessage('ready') (see boot() in app.js).
package main

import (
	"bytes"
	"image"
	"image/draw"
	"image/jpeg"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	dwmapi                  = windows.NewLazySystemDLL("dwmapi.dll")
	pDwmSetWindowAttribute  = dwmapi.NewProc("DwmSetWindowAttribute")
	pBeginPaint             = user32.NewProc("BeginPaint")
	pEndPaint               = user32.NewProc("EndPaint")
	pInvalidateRect         = user32.NewProc("InvalidateRect")
	pSetTimer               = user32.NewProc("SetTimer")
	pKillTimer              = user32.NewProc("KillTimer")
	pDrawTextW              = user32.NewProc("DrawTextW")
	pGetDpiForSystem        = user32.NewProc("GetDpiForSystem")
	pIsWindowVisible        = user32.NewProc("IsWindowVisible")
	pGetDC                  = user32.NewProc("GetDC")
	pReleaseDC              = user32.NewProc("ReleaseDC")
	pCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	pCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	pSelectObject           = gdi32.NewProc("SelectObject")
	pDeleteObject           = gdi32.NewProc("DeleteObject")
	pDeleteDC               = gdi32.NewProc("DeleteDC")
	pBitBlt                 = gdi32.NewProc("BitBlt")
	pStretchDIBits          = gdi32.NewProc("StretchDIBits")
	pSetStretchBltMode      = gdi32.NewProc("SetStretchBltMode")
	pSetBrushOrgEx          = gdi32.NewProc("SetBrushOrgEx")
	pRoundRect              = gdi32.NewProc("RoundRect")
	pGetStockObject         = gdi32.NewProc("GetStockObject")
	pCreateFontW            = gdi32.NewProc("CreateFontW")
	pSetTextColor           = gdi32.NewProc("SetTextColor")
	pSetBkMode              = gdi32.NewProc("SetBkMode")
)

const (
	splashClassName = "BilloraSplash"
	wsPopup         = 0x80000000
	csDropShadow    = 0x00020000
	wmPaint         = 0x000F
	wmEraseBkgnd    = 0x0014
	wmTimer         = 0x0113
	srcCopy         = 0x00CC0020
	idcAppStarting  = 32650
)

type paintStruct struct {
	hdc        uintptr
	fErase     int32
	rcPaint    winRect
	fRestore   int32
	fIncUpdate int32
	reserved   [32]byte
}

type bitmapInfoHeader struct {
	biSize          uint32
	biWidth         int32
	biHeight        int32
	biPlanes        uint16
	biBitCount      uint16
	biCompression   uint32
	biSizeImage     uint32
	biXPelsPerMeter int32
	biYPelsPerMeter int32
	biClrUsed       uint32
	biClrImportant  uint32
}

var (
	splashHwnd      uintptr
	splashCB        = syscall.NewCallback(splashProc)
	spW, spH        int32
	spBgDC, spBgBmp uintptr
	spOldBg, spFont uintptr
	spStart         time.Time
	spReadyAt       time.Time
	spTarget, spCur float64
	spText          = "Starting Billora..."
	spReady         bool
	mainShown       bool
)

// showSplash draws the launch screen immediately. Any failure just means no splash.
func showSplash(hinst, icon uintptr) {
	b, err := webFS.ReadFile("web/splash.jpg")
	if err != nil {
		return
	}
	src, err := jpeg.Decode(bytes.NewReader(b))
	if err != nil {
		return
	}
	img := image.NewRGBA(src.Bounds())
	draw.Draw(img, img.Bounds(), src, src.Bounds().Min, draw.Src)
	for i := 0; i < len(img.Pix); i += 4 { // RGBA -> BGRA for GDI
		img.Pix[i], img.Pix[i+2] = img.Pix[i+2], img.Pix[i]
	}
	iw, ih := int32(img.Bounds().Dx()), int32(img.Bounds().Dy())

	dpi := uintptr(96)
	if pGetDpiForSystem.Find() == nil {
		if d, _, _ := pGetDpiForSystem.Call(); d != 0 {
			dpi = d
		}
	}
	sw, _, _ := pGetSystemMetrics.Call(0)
	sh, _, _ := pGetSystemMetrics.Call(1)
	spW = int32(760 * dpi / 96)
	if m := int32(sw) * 80 / 100; spW > m {
		spW = m
	}
	spH = spW * ih / iw

	cls, _ := windows.UTF16PtrFromString(splashClassName)
	title, _ := windows.UTF16PtrFromString("Billora")
	cursor, _, _ := pLoadCursorW.Call(0, idcAppStarting)
	wc := wndClassExW{style: csDropShadow, lpfnWndProc: splashCB, hInstance: hinst,
		hIcon: icon, hIconSm: icon, hCursor: cursor, lpszClassName: cls}
	wc.cbSize = uint32(unsafe.Sizeof(wc))
	pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
	splashHwnd, _, _ = pCreateWindowExW.Call(0, uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(title)),
		wsPopup, uintptr((int32(sw)-spW)/2), uintptr((int32(sh)-spH)/2), uintptr(spW), uintptr(spH), 0, 0, hinst, 0)
	if splashHwnd == 0 {
		return
	}
	round := uint32(2) // DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND (Windows 11)
	pDwmSetWindowAttribute.Call(splashHwnd, 33, uintptr(unsafe.Pointer(&round)), 4)

	// Scale the picture once into a cached bitmap; each frame only adds the bar and text.
	hdc, _, _ := pGetDC.Call(splashHwnd)
	spBgDC, _, _ = pCreateCompatibleDC.Call(hdc)
	spBgBmp, _, _ = pCreateCompatibleBitmap.Call(hdc, uintptr(spW), uintptr(spH))
	spOldBg, _, _ = pSelectObject.Call(spBgDC, spBgBmp)
	pSetStretchBltMode.Call(spBgDC, 4) // HALFTONE: smooth downscaling
	pSetBrushOrgEx.Call(spBgDC, 0, 0, 0)
	bih := bitmapInfoHeader{biSize: 40, biWidth: iw, biHeight: -ih, biPlanes: 1, biBitCount: 32}
	pStretchDIBits.Call(spBgDC, 0, 0, uintptr(spW), uintptr(spH), 0, 0, uintptr(iw), uintptr(ih),
		uintptr(unsafe.Pointer(&img.Pix[0])), uintptr(unsafe.Pointer(&bih)), 0, srcCopy)
	pReleaseDC.Call(splashHwnd, hdc)
	face, _ := windows.UTF16PtrFromString("Segoe UI")
	fh := -(spW * 13 / 1000) // same as the web splash: 1.3% of the width
	spFont, _, _ = pCreateFontW.Call(uintptr(fh), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(face)))

	spStart, spTarget = time.Now(), 12
	pShowWindow.Call(splashHwnd, 1)
	pUpdateWindow.Call(splashHwnd)
	pSetTimer.Call(splashHwnd, 1, 16, 0)
}

func splashProc(hwnd, msg, wParam, lParam uintptr) uintptr {
	switch msg {
	case wmEraseBkgnd:
		return 1
	case wmPaint:
		paintSplash(hwnd)
		return 0
	case wmTimer:
		splashTick(hwnd)
		return 0
	}
	r, _, _ := pDefWindowProcW.Call(hwnd, msg, wParam, lParam)
	return r
}

func splashTick(hwnd uintptr) {
	if !spReady && spTarget < 90 {
		spTarget += 0.04 // keep creeping so it never looks stuck
	}
	if spCur < spTarget {
		spCur += (spTarget-spCur)*0.12 + 0.15
		if spCur > spTarget {
			spCur = spTarget
		}
	}
	pInvalidateRect.Call(hwnd, 0, 0)
	el := time.Since(spStart)
	if spReady && spCur >= 99.5 && el > 1800*time.Millisecond && time.Since(spReadyAt) > 300*time.Millisecond {
		showMain()
	} else if el > 20*time.Second { // safety net: never hide the app behind the splash
		showMain()
	}
}

func paintSplash(hwnd uintptr) {
	var ps paintStruct
	hdc, _, _ := pBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	defer pEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	mem, _, _ := pCreateCompatibleDC.Call(hdc)
	bmp, _, _ := pCreateCompatibleBitmap.Call(hdc, uintptr(spW), uintptr(spH))
	oldBmp, _, _ := pSelectObject.Call(mem, bmp)
	pBitBlt.Call(mem, 0, 0, uintptr(spW), uintptr(spH), spBgDC, 0, 0, srcCopy)

	// Positions match the web splash (app.css .sp-txt / .sp-bar).
	l, w := spW*2135/10000, spW*4073/10000
	bt, bh := spH*877/1000, spH*19/1000
	if bh < 4 {
		bh = 4
	}
	nullPen, _, _ := pGetStockObject.Call(8)
	oldPen, _, _ := pSelectObject.Call(mem, nullPen)
	track, _, _ := pCreateSolidBrush.Call(0x00EEE7E3) // #e3e7ee
	oldBr, _, _ := pSelectObject.Call(mem, track)
	pRoundRect.Call(mem, uintptr(l), uintptr(bt), uintptr(l+w+1), uintptr(bt+bh+1), uintptr(bh), uintptr(bh))
	if fw := int32(float64(w) * spCur / 100); fw > 0 {
		if fw < bh {
			fw = bh
		}
		fill, _, _ := pCreateSolidBrush.Call(0x00E06B1A) // #1a6be0
		pSelectObject.Call(mem, fill)
		pRoundRect.Call(mem, uintptr(l), uintptr(bt), uintptr(l+fw+1), uintptr(bt+bh+1), uintptr(bh), uintptr(bh))
		pSelectObject.Call(mem, track)
		pDeleteObject.Call(fill)
	}
	pSelectObject.Call(mem, oldBr)
	pSelectObject.Call(mem, oldPen)
	pDeleteObject.Call(track)

	oldFont, _, _ := pSelectObject.Call(mem, spFont)
	pSetBkMode.Call(mem, 1)             // transparent
	pSetTextColor.Call(mem, 0x00442A1F) // #1f2a44
	txt, _ := windows.UTF16PtrFromString(spText)
	tr := winRect{l, spH * 832 / 1000, l + w, bt - 2}
	pDrawTextW.Call(mem, uintptr(unsafe.Pointer(txt)), ^uintptr(0), uintptr(unsafe.Pointer(&tr)), 0x1|0x20|0x800) // centre, single line, no prefix
	pSelectObject.Call(mem, oldFont)

	pBitBlt.Call(hdc, 0, 0, uintptr(spW), uintptr(spH), mem, 0, 0, srcCopy)
	pSelectObject.Call(mem, oldBmp)
	pDeleteObject.Call(bmp)
	pDeleteDC.Call(mem)
}

// splashProgress handles 'splash:<pct>:<text>' from the page.
func splashProgress(pct float64, text string) {
	if pct > spTarget {
		spTarget = pct
	}
	if text != "" {
		spText = text
	}
}

func splashReady() {
	if !spReady {
		spReady, spReadyAt, spTarget, spText = true, time.Now(), 100, "Ready"
	}
	if splashHwnd == 0 {
		showMain()
	}
}

// showMain swaps the splash for the (already loaded) main window.
func showMain() {
	if mainShown {
		return
	}
	mainShown = true
	pShowWindow.Call(mainHwnd, swShowMaximized)
	pSetForegroundWindow.Call(mainHwnd)
	if wvReady {
		if c := wv.GetController(); c != nil {
			c.PutIsVisible(true) // created inside a hidden window: switch rendering on
		}
		wv.Resize()
		focusWebview()
	}
	closeSplash()
	if !spReady {
		logError("main window shown by 20 s timeout (page never reported ready)")
	}
}

func closeSplash() {
	if splashHwnd == 0 {
		return
	}
	pKillTimer.Call(splashHwnd, 1)
	pDestroyWindow.Call(splashHwnd)
	splashHwnd = 0
	pSelectObject.Call(spBgDC, spOldBg)
	pDeleteObject.Call(spBgBmp)
	pDeleteDC.Call(spBgDC)
	pDeleteObject.Call(spFont)
}
