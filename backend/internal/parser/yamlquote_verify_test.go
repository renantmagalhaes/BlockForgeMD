package parser

import (
	"testing"

	"gopkg.in/yaml.v3"
)

// Verifies the frontend's yamlQuote()-escaped output (App.tsx) round-trips
// correctly through the real YAML parser this app uses on disk — i.e. the
// actual fix for titles that previously corrupted frontmatter (colons,
// leading -/#/*/&/@, unbalanced/embedded quotes, backslashes).
func TestYamlQuoteFixRoundTrips(t *testing.T) {
	cases := []struct {
		original string
		quoted   string // exact output of App.tsx's yamlQuote()
	}{
		{"Meeting: Q1 Planning", `"Meeting: Q1 Planning"`},
		{"Status:", `"Status:"`},
		{"- bullet point idea", `"- bullet point idea"`},
		{"#urgent tasks", `"#urgent tasks"`},
		{"*anchor ref", `"*anchor ref"`},
		{"&weird", `"&weird"`},
		{"@mention someone", `"@mention someone"`},
		{`"unbalanced`, `"\"unbalanced"`},
		{`She said "hi"`, `"She said \"hi\""`},
		{`C:\Users\path`, `"C:\\Users\\path"`},
		{"[not a list]", `"[not a list]"`},
		{"{shouldbreak}", `"{shouldbreak}"`},
	}
	for _, c := range cases {
		content := "title: " + c.quoted + "\ntype: board\n"
		var fm map[string]interface{}
		if err := yaml.Unmarshal([]byte(content), &fm); err != nil {
			t.Errorf("title %q: expected valid YAML, got parse error: %v\ncontent: %q", c.original, err, content)
			continue
		}
		got, ok := fm["title"].(string)
		if !ok {
			t.Errorf("title %q: expected string title, got %T: %+v", c.original, fm["title"], fm["title"])
			continue
		}
		if got != c.original {
			t.Errorf("title %q: round-trip mismatch, got %q", c.original, got)
		}
		if typ, _ := fm["type"].(string); typ != "board" {
			t.Errorf("title %q: type field was lost/corrupted, got %+v", c.original, fm)
		}
	}
}
