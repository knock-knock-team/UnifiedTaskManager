package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/smtp"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type config struct {
	HTTPAddr          string
	DatabaseURL       string
	UserServiceURL    string
	JWTSecret         string
	CORSAllowOrigin   string
	AutoMigrate       bool
	SMTPHost          string
	SMTPPort          int
	SMTPUsername      string
	SMTPPassword      string
	SMTPFrom          string
	SMTPFromName      string
	DeadlineLookAhead time.Duration
	ScanInterval      time.Duration
	PermissionTimeout time.Duration
	PublicFrontendURL string
	AutoSendEnabled   bool
}

type task struct {
	ID             string
	Title          string
	Description    string
	Status         string
	Priority       string
	DueAt          time.Time
	CompletedAt    *time.Time
	AssigneeUserID string
	AssigneeName   string
	TeamID         string
	ProjectID      string
}

type notificationSettings struct {
	ProjectID           string `json:"projectId"`
	TeamID              string `json:"teamId"`
	NotifyBeforeMinutes int    `json:"notifyBeforeMinutes"`
	UrgentBeforeMinutes int    `json:"urgentBeforeMinutes"`
	UpdatedBy           string `json:"updatedBy,omitempty"`
	UpdatedAt           string `json:"updatedAt,omitempty"`
}

type user struct {
	ID    string
	Email string
	Name  string
}

type claims struct {
	Subject   string `json:"sub"`
	TokenType string `json:"typ"`
	Role      string `json:"role"`
	ExpiresAt int64  `json:"exp"`
}

type app struct {
	cfg    config
	db     *pgxpool.Pool
	client *http.Client
}

func main() {
	cfg := fromEnv()
	if cfg.JWTSecret == "" {
		log.Fatal("JWT_SECRET is required")
	}
	if cfg.SMTPHost == "" || cfg.SMTPUsername == "" || cfg.SMTPPassword == "" {
		log.Print("smtp is not fully configured; notification sends will fail until SMTP settings are provided")
	}

	ctx := context.Background()
	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("postgres init failed: %v", err)
	}
	defer db.Close()

	a := &app{cfg: cfg, db: db, client: &http.Client{Timeout: cfg.PermissionTimeout}}
	if cfg.AutoMigrate {
		if err := a.ensureSchema(ctx); err != nil {
			log.Fatalf("notification schema migration failed: %v", err)
		}
	}
	if cfg.AutoSendEnabled {
		go a.runScanner(ctx)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", a.healthz)
	mux.HandleFunc("/readyz", a.readyz)
	mux.HandleFunc("/v1/projects/", a.auth(a.projectSettings))
	mux.HandleFunc("/v1/tasks/", a.auth(a.taskNotification))

	log.Printf("notification-service starting on %s", cfg.HTTPAddr)
	if err := http.ListenAndServe(cfg.HTTPAddr, a.withCORS(mux)); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}

func (a *app) ensureSchema(ctx context.Context) error {
	const q = `
CREATE TABLE IF NOT EXISTS deadline_notifications (
	id BIGSERIAL PRIMARY KEY,
	task_id TEXT NOT NULL,
	assignee_user_id TEXT NOT NULL,
	due_at TIMESTAMPTZ NOT NULL,
	mode TEXT NOT NULL,
	sent_at TIMESTAMPTZ NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deadline_notifications_unique
	ON deadline_notifications(task_id, assignee_user_id, due_at, mode);
CREATE INDEX IF NOT EXISTS idx_deadline_notifications_task_id ON deadline_notifications(task_id);

CREATE TABLE IF NOT EXISTS deadline_notification_settings (
	project_id TEXT PRIMARY KEY,
	team_id TEXT NOT NULL,
	notify_before_minutes INTEGER NOT NULL,
	urgent_before_minutes INTEGER NOT NULL,
	updated_by TEXT NOT NULL DEFAULT '',
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deadline_notification_settings_team_id
	ON deadline_notification_settings(team_id);
`
	_, err := a.db.Exec(ctx, q)
	return err
}

func (a *app) runScanner(ctx context.Context) {
	ticker := time.NewTicker(a.cfg.ScanInterval)
	defer ticker.Stop()
	for {
		a.sendAutomaticBatch(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (a *app) sendAutomaticBatch(ctx context.Context) {
	tasks, err := a.findDueTasks(ctx)
	if err != nil {
		log.Printf("deadline scan failed: %v", err)
		return
	}
	for _, item := range tasks {
		if err := a.sendDeadlineNotification(ctx, item, "auto"); err != nil {
			log.Printf("deadline notification task=%s failed: %v", item.ID, err)
		}
	}
}

func (a *app) findDueTasks(ctx context.Context) ([]task, error) {
	const q = `
SELECT t.id, t.title, t.description, t.status, t.priority, t.due_at,
	t.completed_at, t.assignee_user_id, t.assignee_name, t.team_id, t.project_id
FROM tasks t
LEFT JOIN deadline_notification_settings s ON s.project_id = t.project_id
WHERE t.deleted_at IS NULL
	AND t.due_at IS NOT NULL
	AND t.completed_at IS NULL
	AND t.due_at > NOW()
	AND t.due_at <= NOW() + (COALESCE(s.notify_before_minutes, $1) * INTERVAL '1 minute')
	AND t.assignee_user_id <> ''
	AND NOT EXISTS (
		SELECT 1
		FROM deadline_notifications n
		WHERE n.task_id = t.id
			AND n.assignee_user_id = t.assignee_user_id
			AND n.due_at = t.due_at
			AND n.mode = 'auto'
	)
ORDER BY t.due_at ASC
LIMIT 100`
	rows, err := a.db.Query(ctx, q, int(a.cfg.DeadlineLookAhead.Minutes()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTasks(rows)
}

type projectInfo struct {
	ID        string
	TeamID    string
	CreatedBy string
}

func (a *app) projectSettings(w http.ResponseWriter, r *http.Request, token string, parsed *claims) {
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/projects/"), "/")
	parts := strings.Split(path, "/")
	if len(parts) != 2 || parts[1] != "notification-settings" {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "not found"})
		return
	}
	project, err := a.getProject(r.Context(), parts[0])
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"message": "project not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "internal server error"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		allowed, err := a.checkPermission(r.Context(), token, project.TeamID, project.ID, "tasks.read")
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"message": "dependency unavailable"})
			return
		}
		if !allowed && !a.canManageProjectSettings(r.Context(), parsed, project) {
			writeJSON(w, http.StatusForbidden, map[string]string{"message": "forbidden"})
			return
		}
		settings, err := a.getNotificationSettings(r.Context(), project.ID, project.TeamID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "internal server error"})
			return
		}
		writeJSON(w, http.StatusOK, settings)
	case http.MethodPatch:
		if !a.canManageProjectSettings(r.Context(), parsed, project) {
			writeJSON(w, http.StatusForbidden, map[string]string{"message": "forbidden"})
			return
		}
		var req struct {
			NotifyBeforeMinutes int `json:"notifyBeforeMinutes"`
			UrgentBeforeMinutes int `json:"urgentBeforeMinutes"`
		}
		if !decodeJSON(w, r, &req) {
			return
		}
		settings, err := a.saveNotificationSettings(r.Context(), project.ID, project.TeamID, parsed.Subject, req.NotifyBeforeMinutes, req.UrgentBeforeMinutes)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, errBadRequest) {
				status = http.StatusBadRequest
			}
			writeJSON(w, status, map[string]string{"message": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, settings)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"message": "method not allowed"})
	}
}

func (a *app) taskNotification(w http.ResponseWriter, r *http.Request, token string, _ *claims) {
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/tasks/"), "/")
	parts := strings.Split(path, "/")
	if len(parts) != 2 || parts[1] != "deadline-notification" {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "not found"})
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"message": "method not allowed"})
		return
	}
	taskID := strings.TrimSpace(parts[0])
	item, err := a.getTask(r.Context(), taskID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"message": "task not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "internal server error"})
		return
	}
	allowed, err := a.checkPermission(r.Context(), token, item.TeamID, item.ProjectID, "tasks.write")
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"message": "dependency unavailable"})
		return
	}
	if !allowed {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "forbidden"})
		return
	}
	if err := a.sendDeadlineNotification(r.Context(), item, "manual"); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errBadRequest) {
			status = http.StatusBadRequest
		}
		writeJSON(w, status, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

var errBadRequest = errors.New("bad request")

func (a *app) getProject(ctx context.Context, projectID string) (projectInfo, error) {
	const q = `
SELECT id, team_id, created_by::text
FROM projects
WHERE id = $1 AND deleted_at IS NULL`
	var item projectInfo
	err := a.db.QueryRow(ctx, q, strings.TrimSpace(projectID)).Scan(&item.ID, &item.TeamID, &item.CreatedBy)
	return item, err
}

func (a *app) getNotificationSettings(ctx context.Context, projectID, teamID string) (notificationSettings, error) {
	const q = `
SELECT project_id, team_id, notify_before_minutes, urgent_before_minutes, updated_by, updated_at
FROM deadline_notification_settings
WHERE project_id = $1`
	var item notificationSettings
	var updatedAt time.Time
	err := a.db.QueryRow(ctx, q, strings.TrimSpace(projectID)).Scan(
		&item.ProjectID,
		&item.TeamID,
		&item.NotifyBeforeMinutes,
		&item.UrgentBeforeMinutes,
		&item.UpdatedBy,
		&updatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return defaultNotificationSettings(projectID, teamID, a.cfg), nil
	}
	if err != nil {
		return notificationSettings{}, err
	}
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return item, nil
}

func (a *app) saveNotificationSettings(ctx context.Context, projectID, teamID, updatedBy string, notifyBeforeMinutes, urgentBeforeMinutes int) (notificationSettings, error) {
	if notifyBeforeMinutes < 1 || notifyBeforeMinutes > 60*24*30 {
		return notificationSettings{}, fmt.Errorf("%w: notifyBeforeMinutes must be between 1 and 43200", errBadRequest)
	}
	if urgentBeforeMinutes < 0 || urgentBeforeMinutes > notifyBeforeMinutes {
		return notificationSettings{}, fmt.Errorf("%w: urgentBeforeMinutes must be between 0 and notifyBeforeMinutes", errBadRequest)
	}
	const q = `
INSERT INTO deadline_notification_settings (project_id, team_id, notify_before_minutes, urgent_before_minutes, updated_by, updated_at)
VALUES ($1, $2, $3, $4, $5, NOW())
ON CONFLICT (project_id) DO UPDATE
SET team_id = EXCLUDED.team_id,
	notify_before_minutes = EXCLUDED.notify_before_minutes,
	urgent_before_minutes = EXCLUDED.urgent_before_minutes,
	updated_by = EXCLUDED.updated_by,
	updated_at = NOW()
RETURNING project_id, team_id, notify_before_minutes, urgent_before_minutes, updated_by, updated_at`
	var item notificationSettings
	var updatedAt time.Time
	err := a.db.QueryRow(ctx, q, strings.TrimSpace(projectID), strings.TrimSpace(teamID), notifyBeforeMinutes, urgentBeforeMinutes, strings.TrimSpace(updatedBy)).Scan(
		&item.ProjectID,
		&item.TeamID,
		&item.NotifyBeforeMinutes,
		&item.UrgentBeforeMinutes,
		&item.UpdatedBy,
		&updatedAt,
	)
	if err != nil {
		return notificationSettings{}, err
	}
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return item, nil
}

func defaultNotificationSettings(projectID, teamID string, cfg config) notificationSettings {
	notify := int(cfg.DeadlineLookAhead.Minutes())
	if notify <= 0 {
		notify = 1440
	}
	urgent := getenvInt("NOTIFICATION_DEFAULT_URGENT_BEFORE_MINUTES", 120)
	if urgent < 0 {
		urgent = 0
	}
	if urgent > notify {
		urgent = notify
	}
	return notificationSettings{
		ProjectID:           strings.TrimSpace(projectID),
		TeamID:              strings.TrimSpace(teamID),
		NotifyBeforeMinutes: notify,
		UrgentBeforeMinutes: urgent,
	}
}

func (a *app) canManageProjectSettings(ctx context.Context, parsed *claims, project projectInfo) bool {
	if parsed == nil || strings.TrimSpace(parsed.Subject) == "" {
		return false
	}
	if strings.EqualFold(parsed.Role, "admin") {
		return true
	}
	userID := strings.TrimSpace(parsed.Subject)
	if userID == strings.TrimSpace(project.CreatedBy) {
		return true
	}
	var teamCreatedBy string
	if err := a.db.QueryRow(ctx, `SELECT created_by::text FROM teams WHERE id = $1 AND deleted_at IS NULL`, project.TeamID).Scan(&teamCreatedBy); err == nil && teamCreatedBy == userID {
		return true
	}
	var teamRole string
	if err := a.db.QueryRow(ctx, `SELECT role_key FROM team_members WHERE team_id = $1 AND user_id = $2`, project.TeamID, userID).Scan(&teamRole); err == nil && isAdminRole(teamRole) {
		return true
	}
	var projectRole string
	if err := a.db.QueryRow(ctx, `SELECT role_key FROM project_members WHERE project_id = $1 AND user_id = $2`, project.ID, userID).Scan(&projectRole); err == nil && isAdminRole(projectRole) {
		return true
	}
	return false
}

func isAdminRole(role string) bool {
	role = strings.ToLower(strings.TrimSpace(role))
	return role == "owner" || role == "admin"
}

func (a *app) sendDeadlineNotification(ctx context.Context, item task, mode string) error {
	if item.CompletedAt != nil {
		return fmt.Errorf("%w: task is already done", errBadRequest)
	}
	if item.AssigneeUserID == "" {
		return fmt.Errorf("%w: assignee is not set", errBadRequest)
	}
	if item.DueAt.IsZero() {
		return fmt.Errorf("%w: deadline is not set", errBadRequest)
	}
	recipient, err := a.getUser(ctx, item.AssigneeUserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: assignee email was not found", errBadRequest)
		}
		return err
	}
	if strings.TrimSpace(recipient.Email) == "" {
		return fmt.Errorf("%w: assignee email is empty", errBadRequest)
	}
	if err := a.sendEmail(recipient, item); err != nil {
		return err
	}
	_, err = a.db.Exec(ctx, `
INSERT INTO deadline_notifications (task_id, assignee_user_id, due_at, mode, sent_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT DO NOTHING`, item.ID, item.AssigneeUserID, item.DueAt, mode)
	return err
}

func (a *app) getTask(ctx context.Context, taskID string) (task, error) {
	const q = `
SELECT id, title, description, status, priority, due_at, completed_at, assignee_user_id, assignee_name, team_id, project_id
FROM tasks
WHERE id = $1 AND deleted_at IS NULL`
	var item task
	err := a.db.QueryRow(ctx, q, strings.TrimSpace(taskID)).Scan(
		&item.ID,
		&item.Title,
		&item.Description,
		&item.Status,
		&item.Priority,
		&item.DueAt,
		&item.CompletedAt,
		&item.AssigneeUserID,
		&item.AssigneeName,
		&item.TeamID,
		&item.ProjectID,
	)
	return item, err
}

func (a *app) getUser(ctx context.Context, userID string) (user, error) {
	const q = `
SELECT id::text, email, name
FROM users
WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`
	var item user
	err := a.db.QueryRow(ctx, q, strings.TrimSpace(userID)).Scan(&item.ID, &item.Email, &item.Name)
	return item, err
}

func (a *app) sendEmail(recipient user, item task) error {
	host := strings.TrimSpace(a.cfg.SMTPHost)
	if host == "" {
		return errors.New("smtp host is not configured")
	}
	if strings.TrimSpace(a.cfg.SMTPUsername) == "" {
		return errors.New("smtp username is not configured")
	}
	if strings.TrimSpace(a.cfg.SMTPPassword) == "" {
		return errors.New("smtp password is not configured")
	}
	from := strings.TrimSpace(a.cfg.SMTPFrom)
	if from == "" {
		from = a.cfg.SMTPUsername
	}
	subject := "Приближается дедлайн задачи"
	body := a.renderBody(recipient, item)
	msg := buildMessage(from, a.cfg.SMTPFromName, recipient.Email, subject, body)
	addr := fmt.Sprintf("%s:%d", host, a.cfg.SMTPPort)
	auth := smtp.PlainAuth("", a.cfg.SMTPUsername, a.cfg.SMTPPassword, host)
	return smtp.SendMail(addr, auth, from, []string{recipient.Email}, msg)
}

func (a *app) renderBody(recipient user, item task) string {
	link := strings.TrimRight(a.cfg.PublicFrontendURL, "/")
	var due = item.DueAt.Local().Format("02.01.2006 15:04")
	data := map[string]string{
		"Name":        firstNonEmpty(recipient.Name, item.AssigneeName, "коллега"),
		"TaskTitle":   item.Title,
		"Description": item.Description,
		"DueAt":       due,
		"Link":        link,
	}
	const tpl = `Здравствуйте, {{.Name}}!

У задачи "{{.TaskTitle}}" скоро дедлайн: {{.DueAt}}.
{{if .Description}}
Описание:
{{.Description}}
{{end}}
{{if .Link}}
Откройте доску задач: {{.Link}}
{{end}}
`
	var buf bytes.Buffer
	_ = template.Must(template.New("body").Parse(tpl)).Execute(&buf, data)
	return buf.String()
}

func buildMessage(from, fromName, to, subject, body string) []byte {
	displayFrom := from
	if strings.TrimSpace(fromName) != "" {
		displayFrom = fmt.Sprintf("%s <%s>", fromName, from)
	}
	headers := []string{
		"From: " + displayFrom,
		"To: " + to,
		"Subject: " + mimeHeader(subject),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
	}
	return []byte(strings.Join(headers, "\r\n") + "\r\n\r\n" + body)
}

func mimeHeader(value string) string {
	return "=?UTF-8?B?" + base64.StdEncoding.EncodeToString([]byte(value)) + "?="
}

func (a *app) checkPermission(ctx context.Context, token, teamID, projectID, permission string) (bool, error) {
	payload, _ := json.Marshal(map[string]string{
		"teamId":     teamID,
		"projectId":  projectID,
		"permission": permission,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.cfg.UserServiceURL, "/")+"/v1/permissions/check", bytes.NewReader(payload))
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return false, fmt.Errorf("permission service failed with status %d", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return false, nil
	}
	var parsed struct {
		Allowed bool `json:"allowed"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return false, err
	}
	return parsed.Allowed, nil
}

func (a *app) auth(next func(http.ResponseWriter, *http.Request, string, *claims)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := strings.TrimSpace(r.Header.Get("Authorization"))
		if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Unauthorized"})
			return
		}
		token := strings.TrimSpace(header[len("Bearer "):])
		parsed, err := parseToken(token, a.cfg.JWTSecret)
		if err != nil || parsed.Subject == "" || parsed.TokenType != "access" || parsed.ExpiresAt <= time.Now().Unix() {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Invalid token"})
			return
		}
		next(w, r, token, parsed)
	}
}

func parseToken(tokenString, secret string) (*claims, error) {
	parts := strings.Split(tokenString, ".")
	if len(parts) != 3 {
		return nil, errors.New("invalid token")
	}
	signingInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(parts[2]), []byte(expectedSig)) {
		return nil, errors.New("invalid token")
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	parsed := &claims{}
	return parsed, json.Unmarshal(payloadBytes, parsed)
}

func (a *app) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *app) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := a.db.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"message": "not ready"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (a *app) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := a.cfg.CORSAllowOrigin
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Team-Id")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func scanTasks(rows pgx.Rows) ([]task, error) {
	items := make([]task, 0)
	for rows.Next() {
		var item task
		if err := rows.Scan(&item.ID, &item.Title, &item.Description, &item.Status, &item.Priority, &item.DueAt, &item.CompletedAt, &item.AssigneeUserID, &item.AssigneeName, &item.TeamID, &item.ProjectID); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid JSON"})
		return false
	}
	return true
}

func fromEnv() config {
	return config{
		HTTPAddr:          getenv("NOTIFICATION_SERVICE_HTTP_ADDR", ":8089"),
		DatabaseURL:       getenv("NOTIFICATION_DATABASE_URL", getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/unified_task_manager?sslmode=disable")),
		UserServiceURL:    getenv("NOTIFICATION_USER_SERVICE_URL", getenv("USER_SERVICE_URL", "http://localhost:8082")),
		JWTSecret:         getenv("JWT_SECRET", ""),
		CORSAllowOrigin:   getenv("CORS_ALLOW_ORIGIN", "*"),
		AutoMigrate:       getenvBool("NOTIFICATION_AUTO_MIGRATE", getenvBool("AUTO_MIGRATE", true)),
		SMTPHost:          getenv("SMTP_HOST", "smtp.yandex.ru"),
		SMTPPort:          getenvInt("SMTP_PORT", 587),
		SMTPUsername:      getenv("SMTP_USERNAME", ""),
		SMTPPassword:      getenv("SMTP_PASSWORD", ""),
		SMTPFrom:          getenv("SMTP_FROM", getenv("SMTP_USERNAME", "")),
		SMTPFromName:      getenv("SMTP_FROM_NAME", "Unified Task Manager"),
		DeadlineLookAhead: time.Duration(getenvInt("NOTIFICATION_DEADLINE_LOOKAHEAD_MINUTES", 60*24)) * time.Minute,
		ScanInterval:      time.Duration(getenvInt("NOTIFICATION_SCAN_INTERVAL_SECONDS", 300)) * time.Second,
		PermissionTimeout: time.Duration(getenvInt("NOTIFICATION_PERMISSION_TIMEOUT_SECONDS", 3)) * time.Second,
		PublicFrontendURL: getenv("PUBLIC_FRONTEND_URL", ""),
		AutoSendEnabled:   getenvBool("NOTIFICATION_AUTO_SEND_ENABLED", true),
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getenvBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func getenvInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
