package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInlineVaultImages(t *testing.T) {
	root := t.TempDir()
	asset := filepath.Join(root, "calendar test", "assets", "Documents", "photo.png")
	if err := os.MkdirAll(filepath.Dir(asset), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(asset, []byte("png data"), 0o644); err != nil {
		t.Fatal(err)
	}

	html := `<img src="/calendar%20test/assets/Documents/photo.png"><img src="https://example.test/photo.png">`
	got := inlineVaultImages(html, root)
	if !strings.Contains(got, `src="data:image/png;base64,cG5nIGRhdGE="`) {
		t.Fatalf("vault image was not embedded: %s", got)
	}
	if !strings.Contains(got, `src="https://example.test/photo.png"`) {
		t.Fatalf("remote image should be untouched: %s", got)
	}
}

func TestCollectExportAssetsRewritesPortableLinks(t *testing.T) {
	root := t.TempDir()
	asset := filepath.Join(root, "team space", "assets", "Documents", "photo.png")
	if err := os.MkdirAll(filepath.Dir(asset), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(asset, []byte("image bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	content, assets := collectExportAssets(`<img src="/team%20space/assets/Documents/photo.png"><a href="/team%20space/Documents/other.md">other</a>`, root)
	if strings.Contains(content, `src="/team%20space`) || !strings.Contains(content, `src="team%20space/assets/Documents/photo.png"`) {
		t.Fatalf("asset URL was not made relative: %s", content)
	}
	if len(assets) != 1 || string(assets["team space/assets/Documents/photo.png"]) != "image bytes" {
		t.Fatalf("unexpected archived assets: %#v", assets)
	}
}
