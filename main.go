// Billora - offline billing & business management.
// A tiny local web server + native WebView2 window (window_windows.go), falling back to
// an Edge/Chrome "app mode" window if WebView2 is unavailable. Data is stored as JSON
// files in %APPDATA%\Billora (or next to the exe in portable mode).
package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

//go:embed web
var webFS embed.FS

// port can be overridden with BILLORA_PORT (digits only) to run a test copy next to the real app.
var port = envDigits("BILLORA_PORT", "47321")

// envDigits returns the environment variable if it is all digits, else def.
func envDigits(name, def string) string {
	v := os.Getenv(name)
	if v == "" || strings.Trim(v, "0123456789") != "" {
		return def
	}
	return v
}

var (
	dataDir     string
	mu          sync.Mutex
	lastPing    atomic.Int64
	validKey    = regexp.MustCompile(`^(settings|services|staff|bills|products)$`)
	collections = []string{"settings", "services", "staff", "bills", "products"}
)

func main() {
	dataDir = resolveDataDir()
	os.MkdirAll(filepath.Join(dataDir, "backups"), 0o755)
	url := "http://127.0.0.1:" + port + "/"

	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		// Already running: bring its window to the front (or open another browser window).
		if !focusExistingWindow() {
			openWindow(url)
		}
		return
	}
	dailyBackup()

	sub, _ := fs.Sub(webFS, "web")
	mux := http.NewServeMux()
	mux.Handle("/", noCache(http.FileServer(http.FS(sub))))
	mux.HandleFunc("/api/load", handleLoad)
	mux.HandleFunc("/api/store/", handleStore)
	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		lastPing.Store(time.Now().Unix())
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("/api/info", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"dataDir": dataDir})
	})
	mux.HandleFunc("/api/opendata", func(w http.ResponseWriter, r *http.Request) {
		if runtime.GOOS == "windows" {
			exec.Command("explorer", dataDir).Start()
		}
		w.Write([]byte("ok"))
	})

	go http.Serve(ln, mux)

	// Preferred: native Billora window (WebView2). The app quits when it is closed.
	if runNativeWindow(url) {
		mu.Lock() // let any save in progress finish first
		os.Exit(0)
	}
	// Fallback: Edge/Chrome app-mode window.
	browserMode(url)
	select {}
}

// browserMode opens the UI in Edge/Chrome app mode and quits once no window has
// pinged /api/ping for a while (all windows closed).
func browserMode(url string) {
	lastPing.Store(time.Now().Unix() + 60) // grace period for the window to open
	go func() {
		for {
			time.Sleep(5 * time.Second)
			if time.Now().Unix()-lastPing.Load() > 25 {
				os.Exit(0)
			}
		}
	}()
	openWindow(url)
}

func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		h.ServeHTTP(w, r)
	})
}

func resolveDataDir() string {
	exe, _ := os.Executable()
	exeDir := filepath.Dir(exe)
	// Portable mode: a folder named BilloraData next to the exe is used if present.
	if st, err := os.Stat(filepath.Join(exeDir, "BilloraData")); err == nil && st.IsDir() {
		return filepath.Join(exeDir, "BilloraData")
	}
	if ad := os.Getenv("APPDATA"); ad != "" {
		return filepath.Join(ad, "Billora")
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, ".billora")
}

func handleLoad(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	defer mu.Unlock()
	out := map[string]json.RawMessage{}
	for _, k := range collections {
		b, err := os.ReadFile(filepath.Join(dataDir, k+".json"))
		if err == nil && json.Valid(b) {
			out[k] = b
		} else {
			out[k] = json.RawMessage("null")
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func handleStore(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(r.URL.Path, "/api/store/")
	if r.Method != http.MethodPost || !validKey.MatchString(key) {
		http.Error(w, "bad request", 400)
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 200<<20))
	if err != nil || !json.Valid(b) {
		http.Error(w, "invalid json", 400)
		return
	}
	mu.Lock()
	defer mu.Unlock()
	if err := atomicWrite(filepath.Join(dataDir, key+".json"), b); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Write([]byte("ok"))
}

func atomicWrite(path string, b []byte) error {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	f.Sync()
	f.Close()
	return os.Rename(tmp, path)
}

// Copies data files into backups/YYYY-MM-DD/ once a day, keeping the last 60 days.
func dailyBackup() {
	day := time.Now().Format("2006-01-02")
	dst := filepath.Join(dataDir, "backups", day)
	if _, err := os.Stat(dst); err == nil {
		return
	}
	any := false
	for _, k := range collections {
		b, err := os.ReadFile(filepath.Join(dataDir, k+".json"))
		if err != nil {
			continue
		}
		if !any {
			os.MkdirAll(dst, 0o755)
			any = true
		}
		os.WriteFile(filepath.Join(dst, k+".json"), b, 0o644)
	}
	entries, _ := os.ReadDir(filepath.Join(dataDir, "backups"))
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for len(names) > 60 {
		os.RemoveAll(filepath.Join(dataDir, "backups", names[0]))
		names = names[1:]
	}
}

func openWindow(url string) {
	if runtime.GOOS != "windows" {
		fmt.Println("Open", url)
		return
	}
	profile := filepath.Join(dataDir, "window")
	var candidates []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		base := os.Getenv(env)
		if base == "" {
			continue
		}
		candidates = append(candidates,
			filepath.Join(base, `Microsoft\Edge\Application\msedge.exe`),
			filepath.Join(base, `Google\Chrome\Application\chrome.exe`))
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			cmd := exec.Command(c, "--app="+url, "--user-data-dir="+profile,
				"--no-first-run", "--disable-features=Translate", "--window-size=1366,800", "--start-maximized")
			if cmd.Start() == nil {
				return
			}
		}
	}
	exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}
