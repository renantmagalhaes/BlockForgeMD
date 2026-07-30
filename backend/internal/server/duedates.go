package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// handleRunDueDateAutoUpdate is the manual "Run now" endpoint — both the
// global (Settings) and per-board (Board Settings) buttons hit this, the
// latter with boardPath set. Manual runs always force=true.
func (s *Server) handleRunDueDateAutoUpdate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BoardPath string `json:"boardPath"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req) // empty body is valid (all boards)

	updated, boardsScanned, err := s.RunDueDateAutoUpdate(req.BoardPath, true)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, map[string]interface{}{
		"updatedCount":  updated,
		"boardsScanned": boardsScanned,
	})
}

// doneColumnNames mirrors Kanban.tsx's DONE_NAMES — the column names treated
// as "Completed" by default when a board hasn't explicitly configured its
// own completedColumns yet.
var doneColumnNames = map[string]bool{
	"done": true, "complete": true, "completed": true,
	"finished": true, "archive": true, "archived": true, "closed": true,
}

// RunDueDateAutoUpdate bumps overdue dueDates (strictly before today) to
// today, for cards not sitting in a column the board has marked Completed.
//
// boardPath == "" scans every board in the workspace; a specific board path
// scopes it to just that board's cards.
//
// force=true skips all enabled/off gating — used by both manual "Run now"
// buttons. force=false is the scheduled path: a board's own dueDateAutoUpdate
// override ("on"/"off") always wins regardless of the global enabled flag;
// a board with no override at all falls back to that global flag as its
// default. This lets a single board be turned on without having to first
// explicitly turn every other board off.
func (s *Server) RunDueDateAutoUpdate(boardPath string, force bool) (updated int, boardsScanned int, err error) {
	var boards []string
	if boardPath != "" {
		boards = []string{boardPath}
	} else {
		records, qerr := s.db.QueryByFrontMatter("type", "board")
		if qerr != nil {
			return 0, 0, qerr
		}
		for _, r := range records {
			boards = append(boards, r.Path)
		}
	}

	today := time.Now().Format("2006-01-02")
	singleBoardForceRun := force && boardPath != ""

	globalEnabled := false
	if !force {
		v, _ := s.db.GetSetting("due_date_auto_update_enabled", "false")
		globalEnabled = v == "true"
	}

	for _, bp := range boards {
		boardFM, ferr := s.db.GetFrontMatterFlat(bp)
		if ferr != nil {
			continue
		}

		override := boardFM["dueDateAutoUpdate"]
		if !singleBoardForceRun {
			if override == "off" {
				// Explicitly opted out — skipped by everything except a
				// manual "Run now" aimed directly at this one board.
				continue
			}
			if override != "on" && !force && !globalEnabled {
				// Scheduled run, no per-board override, and the global
				// default is off — nothing to do for this board.
				continue
			}
		}

		var completedColumns []string
		if raw := boardFM["completedColumns"]; raw != "" {
			_ = json.Unmarshal([]byte(raw), &completedColumns)
		} else {
			// A board with no explicit completedColumns hasn't had its
			// "Column Status" configured yet — the frontend (Kanban.tsx)
			// auto-detects Done-like columns by name in that case rather
			// than treating nothing as completed, so mirror that here to
			// avoid the two disagreeing about which cards are "done".
			var columns []string
			if raw := boardFM["columns"]; raw != "" {
				_ = json.Unmarshal([]byte(raw), &columns)
			}
			for _, c := range columns {
				if doneColumnNames[strings.ToLower(c)] {
					completedColumns = append(completedColumns, c)
				}
			}
		}

		boardsScanned++

		const suffix = ".board.md"
		prefix := bp
		if strings.HasSuffix(prefix, suffix) {
			prefix = prefix[:len(prefix)-len(suffix)]
		}
		prefix += "/"

		cards, cerr := s.db.QueryCards(prefix, nil, today)
		if cerr != nil {
			continue
		}

		for _, card := range cards {
			status := card.Fields["status"]
			isCompleted := false
			for _, c := range completedColumns {
				if strings.EqualFold(c, status) {
					isCompleted = true
					break
				}
			}
			if isCompleted {
				continue
			}
			// A dueDate can carry a specific time (e.g. "2026-07-20T14:00",
			// see the Google Calendar plugin) — bumping the date shouldn't
			// silently drop that time, so carry over whatever follows "T".
			newDueDate := today
			if orig := card.Fields["dueDate"]; orig != "" {
				if idx := strings.Index(orig, "T"); idx != -1 {
					newDueDate = today + orig[idx:]
				}
			}
			if uerr := s.UpdateFrontMatter(card.Path, map[string]interface{}{"dueDate": newDueDate}); uerr == nil {
				updated++
			}
		}
	}

	return updated, boardsScanned, nil
}
