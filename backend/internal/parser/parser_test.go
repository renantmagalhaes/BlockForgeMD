package parser

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseFile(t *testing.T) {
	// Create temporary workspace
	tempDir, err := os.MkdirTemp("", "blockforge-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Write a mock markdown task file
	fileName := "test-task.md"
	fileContent := `---
title: Test Task File
type: task
status: In Progress
priority: High
tags: [test, backend]
---

# Test Task File Header
Details about testing.

- [ ] Checkbox 1
- [x] Checkbox 2
`
	err = os.WriteFile(filepath.Join(tempDir, fileName), []byte(fileContent), 0644)
	if err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	// Parse file
	res, err := ParseFile(tempDir, fileName)
	if err != nil {
		t.Fatalf("ParseFile failed: %v", err)
	}

	// Assert meta properties
	if res.Record.Title != "Test Task File" {
		t.Errorf("expected title 'Test Task File', got '%s'", res.Record.Title)
	}
	if res.Record.Type != "task" {
		t.Errorf("expected type 'task', got '%s'", res.Record.Type)
	}

	// Assert front matter values
	if status, ok := res.FrontMatter["status"].(string); !ok || status != "In Progress" {
		t.Errorf("expected front matter status 'In Progress', got '%v'", res.FrontMatter["status"])
	}

	// Assert inline tasks checklist
	if len(res.Tasks) != 2 {
		t.Errorf("expected 2 checklist tasks, got %d", len(res.Tasks))
	} else {
		t1 := res.Tasks[0]
		if t1.Content != "Checkbox 1" || t1.Completed {
			t.Errorf("expected first task to be incomplete 'Checkbox 1', got '%s' (completed: %v)", t1.Content, t1.Completed)
		}

		t2 := res.Tasks[1]
		if t2.Content != "Checkbox 2" || !t2.Completed {
			t.Errorf("expected second task to be complete 'Checkbox 2', got '%s' (completed: %v)", t2.Content, t2.Completed)
		}
	}
}

func TestUpdateFrontMatterInFile(t *testing.T) {
	// Create temporary workspace
	tempDir, err := os.MkdirTemp("", "blockforge-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	fileName := "test-doc.md"
	fileContent := `---
title: Original Title
type: document
---
# Original Title
Body content.
`
	err = os.WriteFile(filepath.Join(tempDir, fileName), []byte(fileContent), 0644)
	if err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	// Update front matter
	_, err = UpdateFrontMatterInFile(tempDir, fileName, map[string]interface{}{
		"title":  "New Title",
		"status": "Done",
	})
	if err != nil {
		t.Fatalf("UpdateFrontMatterInFile failed: %v", err)
	}

	// Parse back
	res, err := ParseFile(tempDir, fileName)
	if err != nil {
		t.Fatalf("re-parsing failed: %v", err)
	}

	if res.Record.Title != "New Title" {
		t.Errorf("expected updated title 'New Title', got '%s'", res.Record.Title)
	}
	if status, ok := res.FrontMatter["status"].(string); !ok || status != "Done" {
		t.Errorf("expected status 'Done', got '%v'", res.FrontMatter["status"])
	}
}
