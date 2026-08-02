package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// handleRunDueDateAutoUpdate is the manual "Run now" endpoint (Board
// Settings). It always runs immediately regardless of that board's own
// enabled/time configuration — an explicit action always just executes.
func (s *Server) handleRunDueDateAutoUpdate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BoardPath string `json:"boardPath"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req) // empty body is valid (all boards)

	updated, boardsScanned, err := s.RunDueDateAutoUpdate(req.BoardPath)
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

// RunDueDateAutoUpdate bumps overdue dueDates (strictly before today) forward
// by the configured number of days, for cards not sitting in a column the
// board has marked Completed. Manual and scheduled runs use the same
// Global → Board → Card eligibility rules, so "Run now" is a previewable
// immediate execution of the configuration rather than a bypass of it.
//
// boardPath == "" scans every board in the workspace; a specific board path
// scopes it to just that board's cards. There is no enabled/schedule gating
// here at all — that's entirely the scheduler's job (checkScheduledDueDate
// AutoUpdates); this function unconditionally processes whatever board(s)
// it's given, whether called from the manual "Run now" endpoint or from a
// board whose own scheduled time just matched.
func (s *Server) RunDueDateAutoUpdate(boardPath string) (updated int, boardsScanned int, err error) {
	return s.runDueDateAutoUpdate(boardPath, false)
}

func dueDateAutoUpdateOffset(raw string) (int, bool) {
	if raw == "" {
		return 0, false
	}
	days, err := strconv.Atoi(raw)
	if err != nil || days < 0 {
		return 0, false
	}
	return days, true
}

func (s *Server) runDueDateAutoUpdate(boardPath string, forceBoardEnabled bool) (updated int, boardsScanned int, err error) {
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

	globalEnabled, _ := s.db.GetSetting("due_date_auto_update_enabled", "false")
	globalOffsetRaw, _ := s.db.GetSetting("due_date_auto_update_days_ahead", "0")
	globalOffset, _ := dueDateAutoUpdateOffset(globalOffsetRaw)
	today := time.Now()

	for _, bp := range boards {
		boardFM, ferr := s.db.GetFrontMatterFlat(bp)
		if ferr != nil {
			continue
		}
		boardEnabled := forceBoardEnabled || globalEnabled == "true"
		if !forceBoardEnabled {
			switch boardFM["dueDateAutoUpdate"] {
			case "on":
				boardEnabled = true
			case "off":
				boardEnabled = false
			}
		}
		boardOffset := globalOffset
		if days, ok := dueDateAutoUpdateOffset(boardFM["dueDateAutoUpdateDaysAhead"]); ok {
			boardOffset = days
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

		cards, cerr := s.db.QueryCards(prefix, nil, today.Format("2006-01-02"))
		if cerr != nil {
			continue
		}

		for _, card := range cards {
			cardEnabled := boardEnabled
			switch card.Fields["dueDateAutoUpdate"] {
			case "on":
				cardEnabled = true
			case "off":
				cardEnabled = false
			}
			if !cardEnabled {
				continue
			}
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
			daysAhead := boardOffset
			if days, ok := dueDateAutoUpdateOffset(card.Fields["dueDateAutoUpdateDaysAhead"]); ok {
				daysAhead = days
			}
			newDueDate := today.AddDate(0, 0, daysAhead).Format("2006-01-02")
			if orig := card.Fields["dueDate"]; orig != "" {
				if idx := strings.Index(orig, "T"); idx != -1 {
					newDueDate += orig[idx:]
				}
			}
			if uerr := s.UpdateFrontMatter(card.Path, map[string]interface{}{"dueDate": newDueDate}); uerr == nil {
				updated++
			}
		}
	}

	return updated, boardsScanned, nil
}
