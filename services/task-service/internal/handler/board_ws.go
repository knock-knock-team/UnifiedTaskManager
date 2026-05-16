package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"UnifiedTaskManager/services/task-service/internal/board"
)

func newBoardUpgrader(allowedOrigins string) websocket.Upgrader {
	allowed := parseAllowedOrigins(allowedOrigins)
	return websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := strings.TrimSpace(r.Header.Get("Origin"))
			if origin == "" || len(allowed) == 0 {
				return true
			}
			return allowed[origin]
		},
	}
}

func parseAllowedOrigins(raw string) map[string]bool {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "*" {
		return nil
	}
	result := make(map[string]bool)
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			result[part] = true
		}
	}
	return result
}

func (h *HTTPHandler) boardStream(w http.ResponseWriter, r *http.Request) {
	if h.boardHub == nil {
		writeError(w, http.StatusServiceUnavailable, "board sync unavailable")
		return
	}
	projectID := strings.TrimSpace(r.URL.Query().Get("projectId"))
	teamID := strings.TrimSpace(r.URL.Query().Get("teamId"))
	if teamID == "" {
		teamID = strings.TrimSpace(r.Header.Get("X-Team-Id"))
	}
	if teamID == "" {
		teamID = strings.TrimSpace(currentTeamID(r.Context()))
	}
	if projectID == "" || teamID == "" {
		writeError(w, http.StatusBadRequest, "projectId and teamId are required")
		return
	}
	if !h.ensureProjectPermission(w, r, teamID, projectID, "tasks.read") {
		return
	}

	userID := currentUserID(r.Context())
	userName := strings.TrimSpace(r.URL.Query().Get("displayName"))
	if userName == "" {
		userName = userID
	}

	upgrader := newBoardUpgrader(h.allowOrigin)
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("board ws upgrade failed: %v", err)
		return
	}

	client, unregister := h.boardHub.Register(teamID, projectID, userID, userName)
	defer unregister()
	defer conn.Close()

	h.sendBoardSnapshot(client, teamID, projectID)

	done := make(chan struct{})
	go func() {
		defer close(done)
		for payload := range client.Send {
			if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				return
			}
		}
	}()

	conn.SetReadDeadline(time.Now().Add(120 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(120 * time.Second))
		h.boardHub.TouchPresence(teamID, projectID, userID, userName)
		return nil
	})

	go func() {
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			return
		}
		conn.SetReadDeadline(time.Now().Add(120 * time.Second))

		var envelope struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(message, &envelope); err != nil {
			continue
		}
		switch envelope.Type {
		case "ping", "presence.ping":
			h.boardHub.TouchPresence(teamID, projectID, userID, userName)
		case "resync":
			h.sendBoardSnapshot(client, teamID, projectID)
		}
	}
}

func (h *HTTPHandler) sendBoardSnapshot(client *board.Client, teamID, projectID string) {
	if h.boardHub == nil || client == nil {
		return
	}
	tasks, _, err := h.svc.ListByProject(projectID, 200, 0, "")
	if err != nil {
		return
	}
	columns, err := h.svc.ListColumnsByProject(projectID)
	if err != nil {
		return
	}
	h.boardHub.SendSnapshot(client, tasks, columns)
}
