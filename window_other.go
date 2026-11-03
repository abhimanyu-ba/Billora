//go:build !windows

package main

import "log"

// Non-Windows (development only): no native window; the UI is opened in a browser.
func runNativeWindow(url string) bool { return false }
func focusExistingWindow() bool       { return false }
func logError(s string)               { log.Println(s) }
