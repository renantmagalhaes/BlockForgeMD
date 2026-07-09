package parser

import (
	"encoding/json"
	"path/filepath"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// This file makes on-disk asset references (cover images, attachments, and
// inline pasted images) portable when the vault is viewed as plain files —
// e.g. synced to GitHub as a backup. The app itself needs server-rooted
// absolute paths like "/Default/assets/Documents/foo.png" so the SPA can
// fetch them from a single origin, but GitHub's markdown renderer resolves a
// leading "/" against github.com itself, not the repository, so those links
// render broken there. The fix: store paths on disk relative to the note's
// own location (which GitHub — and any other plain file viewer — resolves
// correctly), and transparently expand them back to absolute paths whenever
// content is read for the app to use. Existing files with absolute paths
// already on disk are left as-is until next saved (AbsoluteAssetPath and
// RewriteAssetPaths are no-ops for paths that aren't recognized as needing
// conversion), so this never touches or migrates content it doesn't have to.

var mdImageRe = regexp.MustCompile(`(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))`)

// isAppAssetPath reports whether p looks like one of this app's server-rooted
// asset URLs (e.g. "/Default/assets/..." or "/assets/foo.png") as opposed to
// an external URL, a data URI, or an already-relative path.
func isAppAssetPath(p string) bool {
	return strings.HasPrefix(p, "/") && !strings.HasPrefix(p, "//")
}

// RelativeAssetPath converts an absolute in-app asset URL into a path
// relative to notePath's own directory. Non-asset-path inputs (external
// URLs, already-relative paths, empty strings) are returned unchanged.
func RelativeAssetPath(notePath, assetURL string) string {
	if !isAppAssetPath(assetURL) {
		return assetURL
	}
	noteDir := filepath.Dir(filepath.FromSlash(notePath))
	target := filepath.FromSlash(strings.TrimPrefix(assetURL, "/"))
	rel, err := filepath.Rel(noteDir, target)
	if err != nil {
		return assetURL
	}
	return filepath.ToSlash(rel)
}

// AbsoluteAssetPath reverses RelativeAssetPath: given a path found in a
// note's on-disk content, resolves it to the app's absolute "/..." form for
// in-app use. Already-absolute paths (old files saved before this feature
// existed), external URLs, and empty strings pass through unchanged.
func AbsoluteAssetPath(notePath, maybeRel string) string {
	if maybeRel == "" || strings.HasPrefix(maybeRel, "/") || strings.Contains(maybeRel, "://") {
		return maybeRel
	}
	noteDir := filepath.Dir(filepath.FromSlash(notePath))
	joined := filepath.Join(noteDir, filepath.FromSlash(maybeRel))
	return "/" + filepath.ToSlash(joined)
}

// RebaseAssetPaths rewrites a note's relative asset references so they stay
// valid after the note itself moves from oldPath to newPath — a relative
// path is only correct as long as the file's own location doesn't change, so
// every move needs its stored references recomputed for the new location.
// Already-absolute (old-style) references are left untouched: they're
// server-rooted, not relative to the file, so a move never affects them.
func RebaseAssetPaths(oldPath, newPath, content string) string {
	return RewriteAssetPaths(newPath, content, func(_ string, url string) string {
		if isAppAssetPath(url) {
			return url
		}
		return RelativeAssetPath(newPath, AbsoluteAssetPath(oldPath, url))
	})
}

// RewriteAssetPaths applies convert to every asset reference in a note's raw
// content: the front matter `cover` field, each `attachments` entry's `url`,
// and every inline markdown image `![alt](url)` in the body. Used with
// RelativeAssetPath before writing to disk, and AbsoluteAssetPath after
// reading, so the two round-trip losslessly for any content already in
// either form.
func RewriteAssetPaths(notePath, content string, convert func(notePath, url string) string) string {
	lines := strings.Split(content, "\n")
	fmRaw, bodyLines, _ := extractFrontMatter(lines)

	body := strings.Join(bodyLines, "\n")
	newBody := mdImageRe.ReplaceAllStringFunc(body, func(m string) string {
		sub := mdImageRe.FindStringSubmatch(m)
		return sub[1] + convert(notePath, sub[2]) + sub[3]
	})

	if len(fmRaw) == 0 {
		return newBody
	}

	var fm map[string]interface{}
	if err := yaml.Unmarshal([]byte(strings.Join(fmRaw, "\n")), &fm); err != nil {
		// Front matter didn't parse — leave it untouched, only body images rewritten.
		var out strings.Builder
		out.WriteString("---\n")
		out.WriteString(strings.Join(fmRaw, "\n"))
		out.WriteString("\n---\n")
		out.WriteString(newBody)
		return out.String()
	}

	changed := rewriteFrontMatterAssetFields(fm, notePath, convert)

	var out strings.Builder
	out.WriteString("---\n")
	if changed {
		newFmBytes, err := yaml.Marshal(fm)
		if err != nil {
			out.WriteString(strings.Join(fmRaw, "\n"))
			out.WriteString("\n")
		} else {
			out.Write(newFmBytes)
		}
	} else {
		out.WriteString(strings.Join(fmRaw, "\n"))
		out.WriteString("\n")
	}
	out.WriteString("---\n")
	out.WriteString(newBody)
	return out.String()
}

// rewriteFrontMatterAssetFields mutates fm's `cover` and `attachments` fields
// in place via convert, reporting whether anything changed.
func rewriteFrontMatterAssetFields(fm map[string]interface{}, notePath string, convert func(notePath, url string) string) bool {
	changed := false

	if cover, ok := fm["cover"].(string); ok && cover != "" {
		if newCover := convert(notePath, cover); newCover != cover {
			fm["cover"] = newCover
			changed = true
		}
	}

	if attRaw, ok := fm["attachments"].(string); ok && attRaw != "" {
		var atts []map[string]interface{}
		if err := json.Unmarshal([]byte(attRaw), &atts); err == nil {
			attChanged := false
			for _, a := range atts {
				if u, ok := a["url"].(string); ok {
					if nu := convert(notePath, u); nu != u {
						a["url"] = nu
						attChanged = true
					}
				}
			}
			if attChanged {
				if b, err := json.Marshal(atts); err == nil {
					fm["attachments"] = string(b)
					changed = true
				}
			}
		}
	}

	return changed
}

// RewriteFrontMatterMapAssetFields applies convert to the `cover` and
// `attachments` values of an already-parsed front-matter string map (as
// stored in the DB / returned by ListFiles), for callers that only have that
// form available rather than the raw file content.
func RewriteFrontMatterMapAssetFields(fmMap map[string]string, notePath string, convert func(notePath, url string) string) {
	if fmMap == nil {
		return
	}
	if cover, ok := fmMap["cover"]; ok && cover != "" {
		fmMap["cover"] = convert(notePath, cover)
	}
	if attRaw, ok := fmMap["attachments"]; ok && attRaw != "" {
		var atts []map[string]interface{}
		if err := json.Unmarshal([]byte(attRaw), &atts); err == nil {
			changed := false
			for _, a := range atts {
				if u, ok := a["url"].(string); ok {
					if nu := convert(notePath, u); nu != u {
						a["url"] = nu
						changed = true
					}
				}
			}
			if changed {
				if b, err := json.Marshal(atts); err == nil {
					fmMap["attachments"] = string(b)
				}
			}
		}
	}
}
