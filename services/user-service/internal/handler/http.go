package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"UnifiedTaskManager/services/user-service/internal/model"
	"UnifiedTaskManager/services/user-service/internal/repository"
	"UnifiedTaskManager/services/user-service/internal/service"
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
	return &HTTPHandler{svc: svc, ping: readinessPing, allowOrigin: "*", limits: make(map[string][]time.Time)}
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
	mux.Handle("/metrics", promhttp.Handler())
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
	return h.withCORS(mux)
}

func (h *HTTPHandler) Run(addr string) error {
	return http.ListenAndServe(addr, h.Routes())
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
		writeJSON(w, http.StatusTooManyRequests, errorBody("RATE_LIMITED", "Too many requests"))
		return
	}
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	resp, err := h.svc.Register(req.Email, req.Password, req.Name)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, resp)
}

func (h *HTTPHandler) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}
	if !h.allowRate(r, "login", 10, time.Minute) {
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
		h.writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *HTTPHandler) refresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}
	if !h.allowRate(r, "refresh", 20, time.Minute) {
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
		writeJSON(w, http.StatusOK, user)
	case http.MethodDelete:
		err := h.svc.DeleteUserByID(role, userID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
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
			writeJSON(w, http.StatusUnauthorized, errorBody("UNAUTHORIZED", "Authorization header is required"))
			return
		}
		userID, _, err := h.svc.ParseAccessToken(parts[1])
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, errorBody("UNAUTHORIZED", "Invalid token"))
			return
		}
		user, err := h.svc.GetCurrentUser(userID)
		if err != nil || user.Status != "active" {
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
			writeJSON(w, http.StatusForbidden, errorBody("FORBIDDEN", "Admin role required"))
			return
		}
		if h.adminOpsToken != "" {
			if got := strings.TrimSpace(r.Header.Get("X-Admin-Ops-Token")); got != h.adminOpsToken {
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
