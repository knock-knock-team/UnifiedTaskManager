package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	observability "observability-go"

	"unified-task-manager/services/user-service/internal/model"
	"unified-task-manager/services/user-service/internal/repository"
	"unified-task-manager/services/user-service/internal/service"
)

type contextKey string

const (
	ctxUserIDKey contextKey = "userID"
	ctxRoleKey   contextKey = "role"
)

type HTTPHandler struct {
	svc           service.UserService
	ping          func(context.Context) error
	adminOpsToken string
	adminOps      AdminOps
	allowOrigin   string
	limitMu       sync.Mutex
	limits        map[string][]time.Time
	logger        *slog.Logger
}

type AdminOps struct {
	TriggerOutboxFlush func(context.Context) (int, error)
	TriggerOutboxClean func(context.Context) (int, int, error)
}

func NewHTTPHandler(svc service.UserService, ping ...func(context.Context) error) *HTTPHandler {
	var readinessPing func(context.Context) error
	if len(ping) > 0 {
		readinessPing = ping[0]
	}
	return &HTTPHandler{svc: svc, ping: readinessPing, allowOrigin: "*", limits: make(map[string][]time.Time), logger: observability.NewLogger("user-service")}
}

func (h *HTTPHandler) SetCORSAllowOrigin(origin string) {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		origin = "*"
	}
	h.allowOrigin = origin
}

func (h *HTTPHandler) SetAdminOps(token string, ops AdminOps) {
	h.adminOpsToken = strings.TrimSpace(token)
	h.adminOps = ops
}

func (h *HTTPHandler) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", h.healthz)
	mux.HandleFunc("/readyz", h.readyz)
	mux.Handle("/metrics", observability.MetricsHandler())
	mux.HandleFunc("/v1/auth/register/start", h.registerStart)
	mux.HandleFunc("/v1/auth/register/verify", h.registerVerify)
	mux.HandleFunc("/v1/auth/register/complete", h.registerComplete)
	mux.HandleFunc("/v1/auth/register", h.register)
	mux.HandleFunc("/v1/auth/login", h.login)
	mux.HandleFunc("/v1/auth/refresh", h.refresh)
	mux.HandleFunc("/v1/users/me", h.auth(h.usersMe))
	mux.HandleFunc("/v1/users/lookup", h.auth(h.userLookup))
	mux.HandleFunc("/v1/users", h.auth(h.users))
	mux.HandleFunc("/v1/users/", h.auth(h.userByID))
	mux.HandleFunc("/v1/teams", h.auth(h.teams))
	mux.HandleFunc("/v1/teams/invites", h.auth(h.teamInvites))
	mux.HandleFunc("/v1/teams/invites/", h.auth(h.teamInvites))
	mux.HandleFunc("/v1/teams/invites/accept", h.auth(h.acceptTeamInvite))
	mux.HandleFunc("/v1/teams/", h.auth(h.teamByID))
	mux.HandleFunc("/v1/permissions/check", h.auth(h.permissionsCheck))
	mux.HandleFunc("/internal/admin/outbox/flush", h.auth(h.requireAdmin(h.adminOutboxFlush)))
	mux.HandleFunc("/internal/admin/outbox/clean", h.auth(h.requireAdmin(h.adminOutboxClean)))
	return observability.NewHTTPMetrics("user-service").Middleware(h.logger, h.withCORS(mux))
}

func (h *HTTPHandler) Run(addr string) error {
	return http.ListenAndServe(addr, h.Routes())
}

func (h *HTTPHandler) audit(r *http.Request, event string, attrs ...any) {
	if h.logger == nil {
		return
	}
	base := []any{
		"event_type", event,
		"actor_user_id", currentUserID(r.Context()),
		"actor_role", currentRole(r.Context()),
	}
	base = append(base, attrs...)
	h.logger.InfoContext(r.Context(), "audit_event", base...)
}

func (h *HTTPHandler) security(r *http.Request, event string, attrs ...any) {
	if h.logger == nil {
		return
	}
	base := []any{
		"event_type", event,
		"actor_user_id", currentUserID(r.Context()),
		"remote_addr", clientKey(r),
	}
	base = append(base, attrs...)
	h.logger.WarnContext(r.Context(), "security_event", base...)
}

func (h *HTTPHandler) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := h.allowOrigin
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Admin-Ops-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (h *HTTPHandler) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *HTTPHandler) readyz(w http.ResponseWriter, r *http.Request) {
	if h.ping == nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := h.ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, errorBody("NOT_READY", "Database is unavailable"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (h *HTTPHandler) register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}
	if !h.allowRate(r, "register", 10, time.Minute) {
		h.security(r, "rate_limited", "scope", "register")
		writeJSON(w, http.StatusTooManyRequests, errorBody("RATE_LIMITED", "Too many requests"))
		return
	}
	var req struct {
		Email    string `json:"email"`
		Code     string `json:"code"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	resp, err := h.svc.CompleteRegistration(req.Email, req.Code, req.Password, req.Name)
	if err != nil {
		h.security(r, "auth_register_failed", "reason", err.Error())
		h.writeServiceError(w, err)
		return
	}
	h.audit(r, "auth_registered", "target_user_id", resp.User.ID, "role", resp.User.Role, "status", resp.User.Status)
	writeJSON(w, http.StatusCreated, resp)
}

func (h *HTTPHandler) registerStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}
	if !h.allowRate(r, "register_start", 5, time.Minute) {
		h.security(r, "rate_limited", "scope", "register_start")
		writeJSON(w, http.StatusTooManyRequests, errorBody("RATE_LIMITED", "Too many requests"))
		return
	}
	var req struct {
		Email string `json:"email"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	resp, err := h.svc.StartRegistration(req.Email)
	if err != nil {
		h.security(r, "auth_register_code_failed", "reason", err.Error())
		h.writeServiceError(w, err)
		return
	}
	h.audit(r, "auth_register_code_sent")
	writeJSON(w, http.StatusAccepted, resp)
}

func (h *HTTPHandler) registerVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}
	if !h.allowRate(r, "register_verify", 10, time.Minute) {
		h.security(r, "rate_limited", "scope", "register_verify")
		writeJSON(w, http.StatusTooManyRequests, errorBody("RATE_LIMITED", "Too many requests"))
		return
	}
	var req struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	resp, err := h.svc.VerifyRegistrationCode(req.Email, req.Code)
	if err != nil {
		h.security(r, "auth_register_verify_failed", "reason", err.Error())
		h.writeServiceError(w, err)
		return
	}
	h.audit(r, "auth_register_code_verified")
	writeJSON(w, http.StatusOK, resp)
}

func (h *HTTPHandler) registerComplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}
	if !h.allowRate(r, "register_complete", 10, time.Minute) {
		h.security(r, "rate_limited", "scope", "register_complete")
		writeJSON(w, http.StatusTooManyRequests, errorBody("RATE_LIMITED", "Too many requests"))
		return
	}
	var req struct {
		Email    string `json:"email"`
		Code     string `json:"code"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	resp, err := h.svc.CompleteRegistration(req.Email, req.Code, req.Password, req.Name)
	if err != nil {
		h.security(r, "auth_register_complete_failed", "reason", err.Error())
		h.writeServiceError(w, err)
		return
	}
	h.audit(r, "auth_registered", "target_user_id", resp.User.ID, "role", resp.User.Role, "status", resp.User.Status)
	writeJSON(w, http.StatusCreated, resp)
}

func (h *HTTPHandler) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}
	if !h.allowRate(r, "login", 10, time.Minute) {
		h.security(r, "rate_limited", "scope", "login")
		writeJSON(w, http.StatusTooManyRequests, errorBody("RATE_LIMITED", "Too many requests"))
		return
	}
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	resp, err := h.svc.Login(req.Email, req.Password)
	if err != nil {
		h.security(r, "auth_login_failed", "reason", err.Error())
		h.writeServiceError(w, err)
		return
	}
	h.audit(r, "auth_login_succeeded", "target_user_id", resp.User.ID, "role", resp.User.Role, "status", resp.User.Status)
	writeJSON(w, http.StatusOK, resp)
}

func (h *HTTPHandler) refresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}
	if !h.allowRate(r, "refresh", 20, time.Minute) {
		h.security(r, "rate_limited", "scope", "refresh")
		writeJSON(w, http.StatusTooManyRequests, errorBody("RATE_LIMITED", "Too many requests"))
		return
	}
	var req struct {
		RefreshToken string `json:"refreshToken"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	resp, err := h.svc.Refresh(req.RefreshToken)
	if err != nil {
		h.security(r, "auth_refresh_failed", "reason", err.Error())
		h.writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *HTTPHandler) usersMe(w http.ResponseWriter, r *http.Request) {
	userID := currentUserID(r.Context())
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, errorBody("UNAUTHORIZED", "Unauthorized"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		user, err := h.svc.GetCurrentUser(userID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, user)
	case http.MethodPatch:
		var req struct {
			Name           *string `json:"name"`
			Tag            *string `json:"tag"`
			Bio            *string `json:"bio"`
			GitHubURL      *string `json:"githubUrl"`
			LinkedInURL    *string `json:"linkedInUrl"`
			Telegram       *string `json:"telegram"`
			WebsiteURL     *string `json:"websiteUrl"`
			SecondaryEmail *string `json:"secondaryEmail"`
			Password       *string `json:"password"`
		}
		if !decodeJSON(w, r, &req) {
			return
		}
		user, err := h.svc.UpdateCurrentUser(userID, service.ProfileUpdate{
			Name:           req.Name,
			Tag:            req.Tag,
			Bio:            req.Bio,
			GitHubURL:      req.GitHubURL,
			LinkedInURL:    req.LinkedInURL,
			Telegram:       req.Telegram,
			WebsiteURL:     req.WebsiteURL,
			SecondaryEmail: req.SecondaryEmail,
			Password:       req.Password,
		})
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		h.audit(r, "profile_updated", "target_user_id", userID, "password_changed", req.Password != nil)
		writeJSON(w, http.StatusOK, user)
	default:
		writeMethodNotAllowed(w)
	}
}

func (h *HTTPHandler) userLookup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}
	query := r.URL.Query()
	id := strings.TrimSpace(query.Get("id"))
	email := strings.TrimSpace(query.Get("email"))
	tag := strings.TrimSpace(query.Get("tag"))

	var (
		user model.User
		err  error
	)
	if id != "" {
		user, err = h.svc.LookupUserByID(currentUserID(r.Context()), id)
	} else if email != "" {
		user, err = h.svc.LookupUserByEmail(currentUserID(r.Context()), email)
	} else {
		user, err = h.svc.LookupUserByTag(currentUserID(r.Context()), tag)
	}
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (h *HTTPHandler) users(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}
	role := currentRole(r.Context())

	limit := readInt(r, "limit", 20)
	offset := readInt(r, "offset", 0)
	search := r.URL.Query().Get("search")

	items, total, err := h.svc.ListUsers(role, limit, offset, search)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *HTTPHandler) userByID(w http.ResponseWriter, r *http.Request) {
	role := currentRole(r.Context())
	userID := strings.TrimPrefix(r.URL.Path, "/v1/users/")
	if userID == "" || strings.Contains(userID, "/") {
		writeJSON(w, http.StatusNotFound, errorBody("NOT_FOUND", "Not found"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		user, err := h.svc.GetByID(role, userID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, user)
	case http.MethodPatch:
		var req struct {
			Name   string `json:"name"`
			Role   string `json:"role"`
			Status string `json:"status"`
		}
		if !decodeJSON(w, r, &req) {
			return
		}
		user, err := h.svc.UpdateUserByID(role, userID, req.Name, req.Role, req.Status)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		h.audit(r, "user_updated_by_admin", "target_user_id", userID, "role", user.Role, "status", user.Status)
		writeJSON(w, http.StatusOK, user)
	case http.MethodDelete:
		err := h.svc.DeleteUserByID(role, userID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		h.audit(r, "user_deleted_by_admin", "target_user_id", userID)
		w.WriteHeader(http.StatusNoContent)
	default:
		writeMethodNotAllowed(w)
	}
}

func (h *HTTPHandler) teams(w http.ResponseWriter, r *http.Request) {
	currentUserID := currentUserID(r.Context())
	switch r.Method {
	case http.MethodGet:
		teams, err := h.svc.ListMyTeams(currentUserID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"items": teams})
	case http.MethodPost:
		var req struct {
			Name string `json:"name"`
		}
		if !decodeJSON(w, r, &req) {
			return
		}
		team, err := h.svc.CreateTeam(currentUserID, req.Name)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		h.audit(r, "team_created", "team_id", team.ID)
		writeJSON(w, http.StatusCreated, team)
	default:
		writeMethodNotAllowed(w)
	}
}

func (h *HTTPHandler) acceptTeamInvite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}
	var req struct {
		Token string `json:"token"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	member, err := h.svc.AcceptTeamInvite(currentUserID(r.Context()), req.Token)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.audit(r, "team_invite_accepted", "team_id", member.TeamID, "target_user_id", member.UserID, "role_key", member.RoleKey)
	writeJSON(w, http.StatusOK, member)
}

func (h *HTTPHandler) teamInvites(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/teams/invites")
	path = strings.Trim(path, "/")

	if path == "" {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}
		items, err := h.svc.ListMyPendingInvites(currentUserID(r.Context()))
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"items": items})
		return
	}

	parts := strings.Split(path, "/")
	if len(parts) == 2 && parts[1] == "accept" {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		inviteID := strings.TrimSpace(parts[0])
		if inviteID == "" {
			writeJSON(w, http.StatusNotFound, errorBody("NOT_FOUND", "Not found"))
			return
		}
		member, err := h.svc.AcceptTeamInviteByID(currentUserID(r.Context()), inviteID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		h.audit(r, "team_invite_accepted", "invite_id", inviteID, "team_id", member.TeamID, "target_user_id", member.UserID, "role_key", member.RoleKey)
		writeJSON(w, http.StatusOK, member)
		return
	}

	writeJSON(w, http.StatusNotFound, errorBody("NOT_FOUND", "Not found"))
}

func (h *HTTPHandler) permissionsCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}
	var req struct {
		TeamID     string `json:"teamId"`
		ProjectID  string `json:"projectId"`
		Permission string `json:"permission"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	result, err := h.svc.CheckProjectPermission(currentUserID(r.Context()), req.TeamID, req.ProjectID, req.Permission)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *HTTPHandler) teamByID(w http.ResponseWriter, r *http.Request) {
	currentUserID := currentUserID(r.Context())
	path := strings.TrimPrefix(r.URL.Path, "/v1/teams/")
	if path == "" {
		writeJSON(w, http.StatusNotFound, errorBody("NOT_FOUND", "Not found"))
		return
	}

	parts := strings.Split(path, "/")
	teamID := strings.TrimSpace(parts[0])
	if teamID == "" {
		writeJSON(w, http.StatusNotFound, errorBody("NOT_FOUND", "Not found"))
		return
	}

	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			roles, err := h.svc.ListTeamRoles(currentUserID, teamID)
			if err != nil {
				h.writeServiceError(w, err)
				return
			}
			members, err := h.svc.ListTeamMembers(currentUserID, teamID)
			if err != nil {
				h.writeServiceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{"teamId": teamID, "roles": roles, "members": members})
			return
		case http.MethodDelete:
			if err := h.svc.DeleteTeam(currentUserID, teamID); err != nil {
				h.writeServiceError(w, err)
				return
			}
			h.audit(r, "team_deleted", "team_id", teamID)
			w.WriteHeader(http.StatusNoContent)
			return
		default:
			writeMethodNotAllowed(w)
			return
		}
	}

	resource := parts[1]
	switch resource {
	case "roles":
		switch r.Method {
		case http.MethodGet:
			roles, err := h.svc.ListTeamRoles(currentUserID, teamID)
			if err != nil {
				h.writeServiceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{"items": roles})
		case http.MethodPost:
			var req struct {
				Key         string   `json:"key"`
				Name        string   `json:"name"`
				Permissions []string `json:"permissions"`
			}
			if !decodeJSON(w, r, &req) {
				return
			}
			role, err := h.svc.CreateTeamRole(currentUserID, teamID, req.Key, req.Name, req.Permissions)
			if err != nil {
				h.writeServiceError(w, err)
				return
			}
			h.audit(r, "team_role_created", "team_id", teamID, "role_key", req.Key, "permission_count", len(req.Permissions))
			writeJSON(w, http.StatusCreated, role)
		default:
			writeMethodNotAllowed(w)
		}
	case "invite":
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		var req struct {
			Email    string `json:"email"`
			RoleKey  string `json:"roleKey"`
			TTLHours int    `json:"ttlHours"`
		}
		if !decodeJSON(w, r, &req) {
			return
		}
		invite, token, err := h.svc.InviteToTeam(currentUserID, teamID, req.Email, req.RoleKey, req.TTLHours)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		h.audit(r, "team_invite_created", "team_id", teamID, "invite_id", invite.ID, "role_key", req.RoleKey, "ttl_hours", req.TTLHours)
		writeJSON(w, http.StatusCreated, map[string]interface{}{"invite": invite, "token": token})
	case "members":
		if len(parts) == 2 {
			if r.Method != http.MethodGet {
				writeMethodNotAllowed(w)
				return
			}
			members, err := h.svc.ListTeamMembers(currentUserID, teamID)
			if err != nil {
				h.writeServiceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{"items": members})
			return
		}
		if len(parts) == 3 && r.Method == http.MethodPatch {
			memberUserID := strings.TrimSpace(parts[2])
			var req struct {
				RoleKey string `json:"roleKey"`
			}
			if !decodeJSON(w, r, &req) {
				return
			}
			member, err := h.svc.UpdateTeamMemberRole(currentUserID, teamID, memberUserID, req.RoleKey)
			if err != nil {
				h.writeServiceError(w, err)
				return
			}
			h.audit(r, "team_member_role_updated", "team_id", teamID, "target_user_id", memberUserID, "role_key", req.RoleKey)
			writeJSON(w, http.StatusOK, member)
			return
		}
		writeMethodNotAllowed(w)
	case "projects":
		if len(parts) == 2 {
			switch r.Method {
			case http.MethodGet:
				items, err := h.svc.ListTeamProjects(currentUserID, teamID)
				if err != nil {
					h.writeServiceError(w, err)
					return
				}
				writeJSON(w, http.StatusOK, map[string]interface{}{"items": items})
			case http.MethodPost:
				var req struct {
					Name string `json:"name"`
				}
				if !decodeJSON(w, r, &req) {
					return
				}
				project, err := h.svc.CreateProject(currentUserID, teamID, req.Name)
				if err != nil {
					h.writeServiceError(w, err)
					return
				}
				h.audit(r, "project_created", "team_id", teamID, "project_id", project.ID)
				writeJSON(w, http.StatusCreated, project)
			default:
				writeMethodNotAllowed(w)
			}
			return
		}

		projectID := strings.TrimSpace(parts[2])
		if projectID == "" {
			writeJSON(w, http.StatusNotFound, errorBody("NOT_FOUND", "Not found"))
			return
		}

		if len(parts) == 3 {
			switch r.Method {
			case http.MethodGet:
				roles, err := h.svc.ListProjectRoles(currentUserID, teamID, projectID)
				if err != nil {
					h.writeServiceError(w, err)
					return
				}
				members, err := h.svc.ListProjectMembers(currentUserID, teamID, projectID)
				if err != nil {
					h.writeServiceError(w, err)
					return
				}
				writeJSON(w, http.StatusOK, map[string]interface{}{"projectId": projectID, "roles": roles, "members": members})
			case http.MethodDelete:
				if err := h.svc.DeleteProject(currentUserID, teamID, projectID); err != nil {
					h.writeServiceError(w, err)
					return
				}
				h.audit(r, "project_deleted", "team_id", teamID, "project_id", projectID)
				w.WriteHeader(http.StatusNoContent)
			default:
				writeMethodNotAllowed(w)
			}
			return
		}

		if len(parts) >= 4 {
			subResource := strings.TrimSpace(parts[3])
			switch subResource {
			case "roles":
				switch r.Method {
				case http.MethodGet:
					items, err := h.svc.ListProjectRoles(currentUserID, teamID, projectID)
					if err != nil {
						h.writeServiceError(w, err)
						return
					}
					writeJSON(w, http.StatusOK, map[string]interface{}{"items": items})
				case http.MethodPost:
					var req struct {
						Key                string   `json:"key"`
						Name               string   `json:"name"`
						Permissions        []string `json:"permissions"`
						InheritTeamRoleKey string   `json:"inheritTeamRoleKey"`
					}
					if !decodeJSON(w, r, &req) {
						return
					}
					item, err := h.svc.CreateProjectRole(currentUserID, teamID, projectID, req.Key, req.Name, req.InheritTeamRoleKey, req.Permissions)
					if err != nil {
						h.writeServiceError(w, err)
						return
					}
					h.audit(r, "project_role_created", "team_id", teamID, "project_id", projectID, "role_key", req.Key, "permission_count", len(req.Permissions))
					writeJSON(w, http.StatusCreated, item)
				default:
					writeMethodNotAllowed(w)
				}
			case "members":
				switch r.Method {
				case http.MethodGet:
					items, err := h.svc.ListProjectMembers(currentUserID, teamID, projectID)
					if err != nil {
						h.writeServiceError(w, err)
						return
					}
					writeJSON(w, http.StatusOK, map[string]interface{}{"items": items})
				case http.MethodPost:
					var req struct {
						UserID  string `json:"userId"`
						RoleKey string `json:"roleKey"`
					}
					if !decodeJSON(w, r, &req) {
						return
					}
					item, err := h.svc.AssignProjectMember(currentUserID, teamID, projectID, req.UserID, req.RoleKey)
					if err != nil {
						h.writeServiceError(w, err)
						return
					}
					h.audit(r, "project_member_assigned", "team_id", teamID, "project_id", projectID, "target_user_id", req.UserID, "role_key", req.RoleKey)
					writeJSON(w, http.StatusCreated, item)
				default:
					writeMethodNotAllowed(w)
				}
			default:
				writeJSON(w, http.StatusNotFound, errorBody("NOT_FOUND", "Not found"))
			}
			return
		}
		writeJSON(w, http.StatusNotFound, errorBody("NOT_FOUND", "Not found"))
	default:
		writeJSON(w, http.StatusNotFound, errorBody("NOT_FOUND", "Not found"))
	}
}

func (h *HTTPHandler) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := strings.TrimSpace(r.Header.Get("Authorization"))
		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			h.security(r, "auth_missing_bearer")
			writeJSON(w, http.StatusUnauthorized, errorBody("UNAUTHORIZED", "Authorization header is required"))
			return
		}
		userID, _, err := h.svc.ParseAccessToken(parts[1])
		if err != nil {
			h.security(r, "auth_invalid_token", "reason", err.Error())
			writeJSON(w, http.StatusUnauthorized, errorBody("UNAUTHORIZED", "Invalid token"))
			return
		}
		user, err := h.svc.GetCurrentUser(userID)
		if err != nil || user.Status != "active" {
			h.security(r, "auth_inactive_or_missing_user", "target_user_id", userID)
			writeJSON(w, http.StatusUnauthorized, errorBody("UNAUTHORIZED", "Invalid token"))
			return
		}
		ctx := context.WithValue(r.Context(), ctxUserIDKey, userID)
		ctx = context.WithValue(ctx, ctxRoleKey, string(user.Role))
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

func (h *HTTPHandler) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if currentRole(r.Context()) != "admin" {
			h.security(r, "admin_role_required")
			writeJSON(w, http.StatusForbidden, errorBody("FORBIDDEN", "Admin role required"))
			return
		}
		if h.adminOpsToken != "" {
			if got := strings.TrimSpace(r.Header.Get("X-Admin-Ops-Token")); got != h.adminOpsToken {
				h.security(r, "admin_ops_token_invalid")
				writeJSON(w, http.StatusForbidden, errorBody("FORBIDDEN", "Invalid admin ops token"))
				return
			}
		}
		next.ServeHTTP(w, r)
	}
}

func (h *HTTPHandler) adminOutboxFlush(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}
	if h.adminOps.TriggerOutboxFlush == nil {
		writeJSON(w, http.StatusNotImplemented, errorBody("NOT_AVAILABLE", "Outbox flush operation is not available"))
		return
	}
	published, err := h.adminOps.TriggerOutboxFlush(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody("INTERNAL_ERROR", "Failed to flush outbox"))
		return
	}
	h.audit(r, "admin_outbox_flush", "published", published)
	writeJSON(w, http.StatusOK, map[string]interface{}{"published": published})
}

func (h *HTTPHandler) adminOutboxClean(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}
	if h.adminOps.TriggerOutboxClean == nil {
		writeJSON(w, http.StatusNotImplemented, errorBody("NOT_AVAILABLE", "Outbox cleaner operation is not available"))
		return
	}
	deleted, archived, err := h.adminOps.TriggerOutboxClean(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody("INTERNAL_ERROR", "Failed to run outbox cleaner"))
		return
	}
	h.audit(r, "admin_outbox_clean", "deleted", deleted, "archived", archived)
	writeJSON(w, http.StatusOK, map[string]interface{}{"deleted": deleted, "archived": archived})
}

func (h *HTTPHandler) writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrBadRequest):
		writeJSON(w, http.StatusBadRequest, errorBody("BAD_REQUEST", "Validation failed"))
	case errors.Is(err, service.ErrUnauthorized):
		writeJSON(w, http.StatusUnauthorized, errorBody("UNAUTHORIZED", "Unauthorized"))
	case errors.Is(err, service.ErrForbidden):
		writeJSON(w, http.StatusForbidden, errorBody("FORBIDDEN", "Forbidden"))
	case errors.Is(err, service.ErrEmailUnavailable):
		writeJSON(w, http.StatusServiceUnavailable, errorBody("EMAIL_UNAVAILABLE", "Email delivery is unavailable"))
	case errors.Is(err, service.ErrTooManyRequests):
		writeJSON(w, http.StatusTooManyRequests, errorBody("RATE_LIMITED", "Please wait before requesting another code"))
	case errors.Is(err, repository.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorBody("NOT_FOUND", "Resource not found"))
	case errors.Is(err, repository.ErrEmailConflict):
		writeJSON(w, http.StatusConflict, errorBody("EMAIL_CONFLICT", "Email already exists"))
	default:
		writeJSON(w, http.StatusInternalServerError, errorBody("INTERNAL_ERROR", "Internal server error"))
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dest interface{}) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("BAD_REQUEST", "Invalid JSON body"))
		return false
	}
	return true
}

func writeMethodNotAllowed(w http.ResponseWriter) {
	writeJSON(w, http.StatusMethodNotAllowed, errorBody("METHOD_NOT_ALLOWED", "Method not allowed"))
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func errorBody(code, message string) map[string]interface{} {
	return map[string]interface{}{
		"code":    code,
		"message": message,
	}
}

func currentUserID(ctx context.Context) string {
	value, _ := ctx.Value(ctxUserIDKey).(string)
	return value
}

func currentRole(ctx context.Context) string {
	value, _ := ctx.Value(ctxRoleKey).(string)
	return value
}

func readInt(r *http.Request, key string, fallback int) int {
	value := strings.TrimSpace(r.URL.Query().Get(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func (h *HTTPHandler) allowRate(r *http.Request, scope string, limit int, window time.Duration) bool {
	if limit <= 0 || window <= 0 {
		return true
	}

	key := clientKey(r) + ":" + scope
	now := time.Now().UTC()
	cutoff := now.Add(-window)

	h.limitMu.Lock()
	defer h.limitMu.Unlock()

	entries := h.limits[key]
	kept := entries[:0]
	for _, ts := range entries {
		if ts.After(cutoff) {
			kept = append(kept, ts)
		}
	}
	if len(kept) >= limit {
		h.limits[key] = kept
		return false
	}
	h.limits[key] = append(kept, now)
	return true
}

func clientKey(r *http.Request) string {
	forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For"))
	if forwarded != "" {
		parts := strings.Split(forwarded, ",")
		if len(parts) > 0 {
			candidate := strings.TrimSpace(parts[0])
			if candidate != "" {
				return candidate
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}
