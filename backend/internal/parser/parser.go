package parser

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"blockforgemd/internal/db"
	"gopkg.in/yaml.v3"
)

var (
	headerRegexp = regexp.MustCompile(`^#\s+(.+)$`)
	taskRegexp   = regexp.MustCompile(`^\s*[\-\*]\s+\[([ xX])\]\s+(.+)$`)
)

type ParseResult struct {
	Record      db.FileRecord
	FrontMatter map[string]interface{}
	Tasks       []db.TaskRecord
}

// ParseFile parses a markdown file, extracting front matter and inline tasks.
func ParseFile(rootPath, relPath string) (*ParseResult, error) {
	fullPath := filepath.Join(rootPath, relPath)
	file, err := os.Open(fullPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	// Compute hash and read content
	hasher := sha256.New()
	var buf strings.Builder
	tee := io.TeeReader(file, hasher)

	scanner := bufio.NewScanner(tee)
	scanner.Buffer(make([]byte, 64*1024), 32*1024*1024) // allow lines up to 32 MB (base64 images)
	var lines []string
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
		buf.WriteString(scanner.Text() + "\n")
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	contentHash := hex.EncodeToString(hasher.Sum(nil))

	// Get file modification time
	info, err := os.Stat(fullPath)
	var updatedAt time.Time
	if err == nil {
		updatedAt = info.ModTime()
	} else {
		updatedAt = time.Now()
	}

	// Parse front matter and body
	fmRaw, bodyLines, startLineOfBody := extractFrontMatter(lines)

	var fm map[string]interface{}
	if len(fmRaw) > 0 {
		if err := yaml.Unmarshal([]byte(strings.Join(fmRaw, "\n")), &fm); err != nil {
			// If YAML is invalid, just ignore it and keep fm empty
			fm = make(map[string]interface{})
		}
	} else {
		fm = make(map[string]interface{})
	}

	// Determine Title
	title := ""
	if t, ok := fm["title"].(string); ok && t != "" {
		title = t
	} else {
		// Look for the first H1 header in the body
		for _, line := range bodyLines {
			if match := headerRegexp.FindStringSubmatch(line); len(match) > 1 {
				title = strings.TrimSpace(match[1])
				break
			}
		}
	}
	if title == "" {
		// Fallback to filename without extension
		base := filepath.Base(relPath)
		ext := filepath.Ext(base)
		title = strings.TrimSuffix(base, ext)
	}

	// Determine Type
	fileType := "document"
	if t, ok := fm["type"].(string); ok && t != "" {
		fileType = t
	} else {
		if strings.HasSuffix(relPath, ".excalidraw.md") || strings.HasSuffix(relPath, ".excalidraw") {
			fileType = "canvas"
		}
	}

	// Parse inline tasks from the full file (mapping to original line numbers)
	var tasks []db.TaskRecord
	for i, line := range lines {
		if match := taskRegexp.FindStringSubmatch(line); len(match) > 2 {
			completed := strings.ToLower(match[1]) == "x"
			content := strings.TrimSpace(match[2])
			lineNum := i + 1 // 1-indexed

			tasks = append(tasks, db.TaskRecord{
				ID:         fmtTaskID(relPath, lineNum),
				FilePath:   relPath,
				Content:    content,
				Completed:  completed,
				LineNumber: lineNum,
			})
		}
	}

	// For types that embed binary blobs (base64 images, JSON data), skip full-text
	// content storage — their content is not human-searchable and can be very large.
	searchContent := buf.String()
	switch fileType {
	case "mindmap", "canvas", "diagram":
		searchContent = ""
	}

	// Build file record
	record := db.FileRecord{
		Path:        relPath,
		Title:       title,
		Type:        fileType,
		ContentHash: contentHash,
		UpdatedAt:   updatedAt,
		Content:     searchContent,
	}

	// If it is a canvas type, double check we have Excalidraw or Draw.io config
	_ = startLineOfBody // could be useful for complex canvas extracting, but for now full parsing suffices

	return &ParseResult{
		Record:      record,
		FrontMatter: fm,
		Tasks:       tasks,
	}, nil
}

func fmtTaskID(path string, line int) string {
	hasher := sha256.New()
	hasher.Write([]byte(path))
	hasher.Write([]byte{byte(line)})
	return hex.EncodeToString(hasher.Sum(nil))[:16]
}

// extractFrontMatter splits lines into front matter and the rest of the body.
func extractFrontMatter(lines []string) (fm []string, body []string, bodyStartIdx int) {
	if len(lines) == 0 {
		return nil, nil, 0
	}

	if strings.TrimSpace(lines[0]) != "---" {
		return nil, lines, 0
	}

	var fmEnd int = -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			fmEnd = i
			break
		}
	}

	if fmEnd == -1 {
		// No closing --- found, treat entire file as body
		return nil, lines, 0
	}

	fm = lines[1:fmEnd]
	body = lines[fmEnd+1:]
	return fm, body, fmEnd + 1
}

// ExtractTags reads the `tags` front-matter field out of a raw file's content
// (YAML list or inline array) and returns a clean, deduplicated tag slice.
func ExtractTags(content string) []string {
	fmRaw, _, _ := extractFrontMatter(strings.Split(content, "\n"))
	if len(fmRaw) == 0 {
		return nil
	}

	var fm map[string]interface{}
	if err := yaml.Unmarshal([]byte(strings.Join(fmRaw, "\n")), &fm); err != nil {
		return nil
	}

	raw, ok := fm["tags"]
	if !ok {
		return nil
	}
	list, ok := raw.([]interface{})
	if !ok {
		return nil
	}

	seen := make(map[string]bool, len(list))
	tags := make([]string, 0, len(list))
	for _, v := range list {
		t, ok := v.(string)
		if !ok || t == "" || seen[t] {
			continue
		}
		seen[t] = true
		tags = append(tags, t)
	}
	return tags
}

// UpdateFrontMatterInFile reads a file, updates specific front matter keys, and writes it back.
func UpdateFrontMatterInFile(rootPath, relPath string, updates map[string]interface{}) (string, error) {
	fullPath := filepath.Join(rootPath, relPath)
	file, err := os.Open(fullPath)
	if err != nil {
		return "", err
	}

	var lines []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	file.Close()

	fmRaw, bodyLines, _ := extractFrontMatter(lines)

	var fm map[string]interface{}
	if len(fmRaw) > 0 {
		if err := yaml.Unmarshal([]byte(strings.Join(fmRaw, "\n")), &fm); err != nil {
			fm = make(map[string]interface{})
		}
	} else {
		fm = make(map[string]interface{})
	}

	// Apply updates
	for k, v := range updates {
		if v == nil {
			delete(fm, k)
		} else {
			fm[k] = v
		}
	}

	// Front-matter updates (e.g. a newly uploaded cover image) always carry
	// the app's absolute "/Workspace/assets/..." form — store it relative to
	// this file instead, same as body images, so the vault stays portable.
	rewriteFrontMatterAssetFields(fm, relPath, RelativeAssetPath)

	// Re-serialize front matter
	var newFmBytes []byte
	if len(fm) > 0 {
		newFmBytes, err = yaml.Marshal(fm)
		if err != nil {
			return "", err
		}
	}

	// Reassemble file
	var outBuilder strings.Builder
	if len(newFmBytes) > 0 {
		outBuilder.WriteString("---\n")
		outBuilder.Write(newFmBytes)
		outBuilder.WriteString("---\n")
	}
	outBuilder.WriteString(strings.Join(bodyLines, "\n"))
	if len(bodyLines) > 0 {
		outBuilder.WriteString("\n")
	}

	newContent := outBuilder.String()

	// Write back to file
	err = os.WriteFile(fullPath, []byte(newContent), 0644)
	if err != nil {
		return "", err
	}

	// Compute new hash
	hasher := sha256.New()
	hasher.Write([]byte(newContent))
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

// UpdateTaskStatusInFile toggles the checkmark for a task at a specific line number.
func UpdateTaskStatusInFile(rootPath, relPath string, lineNum int, completed bool) (string, error) {
	fullPath := filepath.Join(rootPath, relPath)
	file, err := os.Open(fullPath)
	if err != nil {
		return "", err
	}

	var lines []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	file.Close()

	if lineNum < 1 || lineNum > len(lines) {
		return "", errors.New("line number out of range")
	}

	targetIdx := lineNum - 1
	line := lines[targetIdx]

	if match := taskRegexp.FindStringSubmatch(line); len(match) > 2 {
		checkbox := " "
		if completed {
			checkbox = "x"
		}

		// Rebuild the task line, keeping indentation
		indent := line[:strings.Index(line, "-") + 1]
		if indent == "" {
			indent = line[:strings.Index(line, "*") + 1]
		}
		// In case we can't find it easily, let's match exact position of hyphen/asterisk
		prefixIdx := strings.IndexAny(line, "-*")
		if prefixIdx != -1 {
			lines[targetIdx] = line[:prefixIdx] + string(line[prefixIdx]) + " [" + checkbox + "] " + match[2]
		}
	} else {
		return "", errors.New("no task checkbox found on specified line")
	}

	newContent := strings.Join(lines, "\n") + "\n"
	err = os.WriteFile(fullPath, []byte(newContent), 0644)
	if err != nil {
		return "", err
	}

	hasher := sha256.New()
	hasher.Write([]byte(newContent))
	return hex.EncodeToString(hasher.Sum(nil)), nil
}
