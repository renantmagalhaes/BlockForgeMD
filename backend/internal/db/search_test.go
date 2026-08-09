package db

import (
	"path/filepath"
	"testing"
	"time"
)

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"  Café  Menu ": "cafe menu",
		"Résumé":        "resume",
		"æther":         "aether",
		"Straße":        "straße", // eszett is left as-is (not an accent)
		"foo\tbar":      "foo bar",
	}
	for in, want := range cases {
		if got := normalize(in); got != want {
			t.Errorf("normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestEditDistanceClose(t *testing.T) {
	if !editDistanceClose("blok", "block") {
		t.Error("expected blok~block to be close")
	}
	if !editDistanceClose("reports", "report") {
		t.Error("expected reports~report to be close")
	}
	if editDistanceClose("cat", "xray") {
		t.Error("expected cat~xray to be far")
	}
}

func TestWordPrefixFuzzy(t *testing.T) {
	if !wordPrefixFuzzy("meeting notes", "meet") {
		t.Error("expected meet to prefix-match meeting")
	}
	if !wordPrefixFuzzy("meeting notes", "meeting") {
		t.Error("expected exact word to match")
	}
	if wordPrefixFuzzy("meeting notes", "xyz") {
		t.Error("expected xyz to not match")
	}
}

// TestRankingPrioritizesTitle verifies that title matches rank above content
// matches, including a bounded fuzzy typo.
func TestRankingPrioritizesTitle(t *testing.T) {
	recs := []FileRecord{
		{Path: "Default/Documents/A.md", Title: "Project Alpha Plan", UpdatedAt: time.Now()},
		{Path: "Default/Documents/B.md", Title: "Misc Notes", Content: "mentions project alpha somewhere in a long body", UpdatedAt: time.Now()},
	}

	db := &DB{}

	// No history: title match should win.
	out := db.rankResults(recs, "project alpha", "")
	if len(out) != 2 {
		t.Fatalf("expected 2 results, got %d", len(out))
	}
	if out[0].Path != "Default/Documents/A.md" {
		t.Errorf("title match should rank first, got %s", out[0].Path)
	}

	// Fuzzy variant: a misspelled query should still surface the title match.
	out = db.rankResults(recs, "projet alpa", "")
	if len(out) == 0 || out[0].Path != "Default/Documents/A.md" {
		t.Errorf("fuzzy query should still find the title match, got %+v", out)
	}
}

func TestRankingDemotesCompletedKanbanCards(t *testing.T) {
	now := time.Now()
	recs := []FileRecord{
		{Path: "Default/Boards/active.md", Title: "Ship release", Type: "task", UpdatedAt: now, FrontMatter: map[string]string{"status": "In Progress"}},
		{Path: "Default/Boards/completed.md", Title: "Ship release", Type: "task", UpdatedAt: now, FrontMatter: map[string]string{"status": "Completed"}},
	}

	out := (&DB{}).rankResults(recs, "ship release", "")
	if len(out) != 2 {
		t.Fatalf("expected 2 results, got %d", len(out))
	}
	if out[0].Path != "Default/Boards/active.md" {
		t.Errorf("active card should rank ahead of completed card, got %s", out[0].Path)
	}
	if out[0].Score <= out[1].Score {
		t.Errorf("active score (%v) should exceed completed score (%v)", out[0].Score, out[1].Score)
	}
}

func TestSearchIndexesContentAndLearnsRepeatedOpens(t *testing.T) {
	db, err := NewDB(filepath.Join(t.TempDir(), "blockforge.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Conn.Close() })

	now := time.Now().UTC()
	files := []FileRecord{
		{Path: "Default/Documents/A.md", Title: "Roadmap", Type: "document", ContentHash: "a", UpdatedAt: now, Content: "Planning for the café launch."},
		{Path: "Default/Documents/B.md", Title: "Roadmap", Type: "document", ContentHash: "b", UpdatedAt: now, Content: "Other roadmap notes."},
	}
	for _, file := range files {
		if err := db.UpsertFile(file, nil, nil); err != nil {
			t.Fatal(err)
		}
	}

	// Accent-insensitive content lookup is served from the normalized index.
	out, err := db.Search("cafe", "Default/", "")
	if err != nil || len(out) != 1 || out[0].Path != files[0].Path {
		t.Fatalf("indexed content search = %#v, %v", out, err)
	}
	if out[0].Score <= 0 {
		t.Fatal("search result did not expose its relevance score")
	}

	user, err := db.CreateUser("search-test-user", "hash")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if err := db.RecordSearchOpen(user.ID, " ROADMAP ", files[1].Path); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := db.Conn.QueryRow("SELECT open_count FROM search_history WHERE user_id = ? AND query = ? AND file_path = ?", user.ID, "roadmap", files[1].Path).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 3 {
		t.Fatalf("open_count = %d, want 3", count)
	}

	out, err = db.Search("roadmap", "Default/", user.ID)
	if err != nil || len(out) != 2 || out[0].Path != files[1].Path {
		t.Fatalf("history-ranked search = %#v, %v", out, err)
	}
}

// TestFuzzyTypoFindsTitle reproduces the reported bug: a card titled "next
// date" must be found when the user types "nixt date" (a one-edit typo).
func TestFuzzyTypoFindsTitle(t *testing.T) {
	recs := []FileRecord{
		{Path: "Default/Boards/next date.md", Title: "next date", UpdatedAt: time.Now()},
		{Path: "Default/Documents/Other.md", Title: "Other", UpdatedAt: time.Now()},
	}

	db := &DB{}
	out := db.rankResults(recs, "nixt date", "")
	if len(out) == 0 {
		t.Fatal("expected at least one result for typo'd query 'nixt date'")
	}
	if out[0].Path != "Default/Boards/next date.md" {
		t.Errorf("expected 'next date' to rank first for 'nixt date', got %+v", out)
	}
}

// TestFuzzyTypoFindsTitleSingleTerm checks a single-term typo also matches.
func TestFuzzyTypoFindsTitleSingleTerm(t *testing.T) {
	recs := []FileRecord{
		{Path: "Default/Documents/next date.md", Title: "next date", UpdatedAt: time.Now()},
	}
	db := &DB{}
	out := db.rankResults(recs, "nixt", "")
	if len(out) != 1 {
		t.Fatalf("expected 1 result for 'nixt', got %d", len(out))
	}
}
