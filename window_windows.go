//go:build windows

// Native Billora window: a plain Win32 window hosting Microsoft WebView2 (the Edge engine
// built into Windows), so the app has its own window, icon and taskbar entry instead of a
// browser window. Uses the Wails go-webview2 loader in its default pure-Go mode, which loads
// the installed WebView2 runtime normally (no DLL is embedded or loaded from memory).
// If WebView2 is missing or fails to start, main falls back to Edge/Chrome app mode.
package main

import (
	neturl "net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/wailsapp/go-webview2/pkg/edge"
	"github.com/wailsapp/go-webview2/webviewloader"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// Win32 windows and WebView2 must live on the main OS thread.
func init() { runtime.LockOSThread() }

const wndClassName = "BilloraMainWindow"

var (
	user32               = windows.NewLazySystemDLL("user32.dll")
	kernel32             = windows.NewLazySystemDLL("kernel32.dll")
	gdi32                = windows.NewLazySystemDLL("gdi32.dll")
	pRegisterClassExW    = user32.NewProc("RegisterClassExW")
	pCreateWindowExW     = user32.NewProc("CreateWindowExW")
	pDefWindowProcW      = user32.NewProc("DefWindowProcW")
	pShowWindow          = user32.NewProc("ShowWindow")
	pUpdateWindow        = user32.NewProc("UpdateWindow")
	pGetMessageW         = user32.NewProc("GetMessageW")
	pTranslateMessage    = user32.NewProc("TranslateMessage")
	pDispatchMessageW    = user32.NewProc("DispatchMessageW")
	pPostQuitMessage     = user32.NewProc("PostQuitMessage")
	pDestroyWindow       = user32.NewProc("DestroyWindow")
	pLoadImageW          = user32.NewProc("LoadImageW")
	pLoadCursorW         = user32.NewProc("LoadCursorW")
	pFindWindowW         = user32.NewProc("FindWindowW")
	pSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	pIsIconic            = user32.NewProc("IsIconic")
	pSetWindowPos        = user32.NewProc("SetWindowPos")
	pGetSystemMetrics    = user32.NewProc("GetSystemMetrics")
	pGetDpiForWindow     = user32.NewProc("GetDpiForWindow")
	pGetModuleHandleW    = kernel32.NewProc("GetModuleHandleW")
	pCreateSolidBrush    = gdi32.NewProc("CreateSolidBrush")
	pShellExecuteW       = windows.NewLazySystemDLL("shell32.dll").NewProc("ShellExecuteW")
)

const (
	wsOverlappedWindow = 0x00CF0000
	cwUseDefault       = 0x80000000
	swShowMaximized    = 3
	swRestore          = 9
	swHide             = 0
	wmMove             = 0x0003
	wmSize             = 0x0005
	wmActivate         = 0x0006
	wmClose            = 0x0010
	wmDestroy          = 0x0002
	wmGetMinMaxInfo    = 0x0024
	wmDpiChanged       = 0x02E0
	imageIcon          = 1
	lrShared           = 0x8000
	idcArrow           = 32512
	swpNoZOrder        = 0x0004
	swpNoActivate      = 0x0010
	smCxIcon, smCyIcon = 11, 12
	smCxSmIcon         = 49
	smCySmIcon         = 50
)

type wndClassExW struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

type point struct{ x, y int32 }

type winMsg struct {
	hwnd     uintptr
	message  uint32
	wParam   uintptr
	lParam   uintptr
	time     uint32
	pt       point
	lPrivate uint32
}

type winRect struct{ left, top, right, bottom int32 }

type minMaxInfo struct {
	reserved, maxSize, maxPosition, minTrackSize, maxTrackSize point
}

var (
	wv        *edge.Chromium
	wvReady   bool
	mainHwnd  uintptr
	wndProcCB = syscall.NewCallback(wndProc)
)

// Runs after the page loads: opens outside links (WhatsApp etc.) in the normal browser
// and hides the browser right-click menu except where it is useful (text boxes).
const injectJS = `(function(){
 if(!window.chrome||!window.chrome.webview)return;
 function ext(u){try{var x=new URL(u,location.href);return (x.protocol==='https:'||x.protocol==='http:')&&x.origin!==location.origin?x.href:null}catch(e){return null}}
 function go(u){window.chrome.webview.postMessage('open:'+u)}
 var o=window.open;
 window.open=function(u){var x=ext(u);if(x){go(x);return null}return o.apply(window,arguments)};
 document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a||a.hasAttribute('download'))return;var x=ext(a.href);if(x){e.preventDefault();go(x)}},true);
 document.addEventListener('contextmenu',function(e){if(!(e.target&&e.target.closest&&e.target.closest('input,textarea,[contenteditable="true"]')))e.preventDefault()});
})();`

func webviewAvailable() bool {
	v, err := webviewloader.GetAvailableCoreWebView2BrowserVersionString("")
	return err == nil && v != ""
}

// runNativeWindow shows the Billora window and blocks until it is closed.
// Returns false (without showing anything) if WebView2 is not installed.
func runNativeWindow(url string) bool {
	hinst, _, _ := pGetModuleHandleW.Call(0)
	big := loadAppIcon(hinst, smCxIcon, smCyIcon)
	small := loadAppIcon(hinst, smCxSmIcon, smCySmIcon)
	showSplash(hinst, big)
	if !webviewAvailable() {
		closeSplash()
		return false
	}
	cls, _ := windows.UTF16PtrFromString(wndClassName)
	title, _ := windows.UTF16PtrFromString("Billora")
	cursor, _, _ := pLoadCursorW.Call(0, idcArrow)
	brush, _, _ := pCreateSolidBrush.Call(0x00F6F4F3) // #f3f4f6, the app background
	wc := wndClassExW{
		lpfnWndProc: wndProcCB, hInstance: hinst, hIcon: big, hIconSm: small,
		hCursor: cursor, hbrBackground: brush, lpszClassName: cls,
	}
	wc.cbSize = uint32(unsafe.Sizeof(wc))
	if r, _, _ := pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		return false
	}
	mainHwnd, _, _ = pCreateWindowExW.Call(0, uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(title)),
		wsOverlappedWindow, cwUseDefault, cwUseDefault, 1366, 800, 0, 0, hinst, 0)
	if mainHwnd == 0 {
		closeSplash()
		return false
	}
	// The main window stays hidden behind the splash until the page posts 'ready'.

	wv = edge.NewChromium()
	wv.DataPath = filepath.Join(dataDir, "webview")
	wv.MessageCallback = onWebMessage
	// Developer testing only: BILLORA_DEVTOOLS_PORT lets an automated test drive the real window
	// over Chrome DevTools Protocol on 127.0.0.1. Never set on customer PCs.
	if dbg := envDigits("BILLORA_DEVTOOLS_PORT", ""); dbg != "" {
		wv.AdditionalBrowserArgs = []string{"--remote-debugging-port=" + dbg, "--remote-allow-origins=http://127.0.0.1:" + dbg}
	}
	wv.SetErrorCallback(func(err error) {
		logError("webview: " + err.Error())
		if !wvReady {
			// WebView2 could not start: hide our window and use Edge/Chrome app mode instead.
			// Block here so the library does not exit the process; the watchdog ends it later.
			mainShown = true // stop the splash timer from showing the broken window
			closeSplash()
			pShowWindow.Call(mainHwnd, swHide)
			browserMode(url)
			select {}
		}
	})
	wv.Embed(mainHwnd)
	wv.SetBackgroundColour(0xf3, 0xf4, 0xf6, 0xff)
	if s, err := wv.GetSettings(); err == nil {
		s.PutAreDevToolsEnabled(false)
		s.PutIsStatusBarEnabled(false)
		s.PutIsZoomControlEnabled(false)
		if s3 := s.GetICoreWebView2Settings3(); s3 != nil {
			s3.PutAreBrowserAcceleratorKeysEnabled(false) // no F5 reload, Ctrl+F, Ctrl+P, F12...
		}
	}
	// Let WebView2 follow the Windows display scale (125%, 150%...) itself. Do NOT call
	// PutRasterizationScale/PutZoomFactor: the library passes the float64 in an integer
	// register, so WebView2 reads garbage from XMM1 and the page gets a random size.
	if c := wv.GetController(); c != nil {
		if c3 := c.GetICoreWebView2Controller3(); c3 != nil {
			c3.PutShouldDetectMonitorScaleChanges(true)
		}
	}
	wv.Init(injectJS)
	wvReady = true
	wv.Resize()
	wv.Navigate(url)
	if splashHwnd == 0 {
		showMain() // no splash (e.g. image failed): show the window right away
	}

	var m winMsg
	for {
		r, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		pDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
	return true
}

func wndProc(hwnd, msg, wParam, lParam uintptr) uintptr {
	switch msg {
	case wmSize:
		if wvReady {
			wv.Resize()
		}
	case wmMove:
		if wvReady {
			wv.NotifyParentWindowPositionChanged()
		}
	case wmActivate:
		if wvReady && wParam&0xFFFF != 0 {
			focusWebview()
		}
	case wmDpiChanged:
		r := (*winRect)(unsafe.Pointer(lParam))
		pSetWindowPos.Call(hwnd, 0, uintptr(r.left), uintptr(r.top),
			uintptr(r.right-r.left), uintptr(r.bottom-r.top), swpNoZOrder|swpNoActivate)
		return 0
	case wmGetMinMaxInfo:
		mmi := (*minMaxInfo)(unsafe.Pointer(lParam))
		d := int32(windowDpi(hwnd))
		mmi.minTrackSize = point{900 * d / 96, 600 * d / 96}
		return 0
	case wmClose:
		pDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		pPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := pDefWindowProcW.Call(hwnd, msg, wParam, lParam)
	return r
}

// focusWebview gives keyboard focus to the page. Calls the controller directly because the
// library's Focus() exits the process on any error, and MoveFocus returns E_INVALIDARG
// ("The parameter is incorrect") while the window is hidden or minimised - harmless.
func focusWebview() {
	if c := wv.GetController(); c != nil {
		c.MoveFocus(edge.COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC)
	}
}

func windowDpi(hwnd uintptr) uint32 {
	if pGetDpiForWindow.Find() != nil {
		return 96
	}
	d, _, _ := pGetDpiForWindow.Call(hwnd)
	if d == 0 {
		return 96
	}
	return uint32(d)
}

func loadAppIcon(hinst uintptr, cxMetric, cyMetric uintptr) uintptr {
	cx, _, _ := pGetSystemMetrics.Call(cxMetric)
	cy, _, _ := pGetSystemMetrics.Call(cyMetric)
	h, _, _ := pLoadImageW.Call(hinst, 1, imageIcon, cx, cy, lrShared) // icon group id 1 (mkrsrc.py)
	return h
}

// Messages posted from the page via window.chrome.webview.postMessage.
func onWebMessage(message string, _ *edge.ICoreWebView2, _ *edge.ICoreWebView2WebMessageReceivedEventArgs) {
	if message == "ready" {
		splashReady()
		return
	}
	if rest, ok := strings.CutPrefix(message, "splash:"); ok {
		pct, text, _ := strings.Cut(rest, ":")
		if p, err := strconv.ParseFloat(pct, 64); err == nil {
			splashProgress(p, text)
		}
		return
	}
	if rest, ok := strings.CutPrefix(message, "wa:"); ok {
		phone, text, _ := strings.Cut(rest, "\n")
		openWhatsApp(phone, text)
		return
	}
	if u, ok := strings.CutPrefix(message, "open:"); ok &&
		(strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://")) && !strings.ContainsAny(u, "\"\r\n") {
		shellOpen(u)
	}
}

// openWhatsApp opens a chat with a 10-digit Indian mobile, receipt text pre-filled.
// WhatsApp Desktop is used directly when installed; otherwise WhatsApp Web (wa.me).
func openWhatsApp(phone, text string) {
	if len(phone) != 10 || strings.Trim(phone, "0123456789") != "" {
		return
	}
	enc := strings.ReplaceAll(neturl.QueryEscape(text), "+", "%20") // WhatsApp shows '+' literally
	if whatsAppInstalled() {
		shellOpen("whatsapp://send?phone=91" + phone + "&text=" + enc)
		return
	}
	shellOpen("https://wa.me/91" + phone + "?text=" + enc)
}

// whatsAppInstalled reports whether the whatsapp:// link is registered. The Microsoft Store
// app registers only the "URL Protocol" marker (no shell\open\command), so check that.
func whatsAppInstalled() bool {
	k, err := registry.OpenKey(registry.CLASSES_ROOT, `whatsapp`, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	_, _, err = k.GetStringValue("URL Protocol")
	return err == nil
}

func shellOpen(target string) {
	verb, _ := windows.UTF16PtrFromString("open")
	t, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return
	}
	if r, _, _ := pShellExecuteW.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(t)), 0, 0, 1); r <= 32 {
		logError("could not open " + strings.SplitN(target, "?", 2)[0])
	}
}

// focusExistingWindow brings an already-open Billora window to the front (second launch).
func focusExistingWindow() bool {
	cls, _ := windows.UTF16PtrFromString(wndClassName)
	h, _, _ := pFindWindowW.Call(uintptr(unsafe.Pointer(cls)), 0)
	if h == 0 {
		return false
	}
	if v, _, _ := pIsWindowVisible.Call(h); v == 0 { // still starting: show its splash instead
		scls, _ := windows.UTF16PtrFromString(splashClassName)
		if s, _, _ := pFindWindowW.Call(uintptr(unsafe.Pointer(scls)), 0); s != 0 {
			pSetForegroundWindow.Call(s)
		}
		return true
	}
	if r, _, _ := pIsIconic.Call(h); r != 0 {
		pShowWindow.Call(h, swRestore)
	}
	pSetForegroundWindow.Call(h)
	return true
}

func logError(s string) {
	f, err := os.OpenFile(filepath.Join(dataDir, "error.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	f.WriteString(time.Now().Format("2006-01-02 15:04:05 ") + s + "\r\n")
}
