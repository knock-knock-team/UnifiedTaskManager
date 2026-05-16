package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"

	"unified-task-manager/services/user-service/internal/model"
	"unified-task-manager/services/user-service/internal/repository"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrForbidden    = errors.New("forbidden")
	ErrBadRequest   = errors.New("bad request")
)

type UserService interface {
	Register(email, password, name string) (model.AuthResponse, error)
	Login(email, password string) (model.AuthResponse, error)
	Refresh(refreshToken string) (model.TokenPair, error)
	LookupUserByID(currentUserID, userID string) (model.User, error)
	LookupUserByTag(currentUserID, tag string) (model.User, error)
	LookupUserByEmail(currentUserID, email string) (model.User, error)
	CreateTeam(currentUserID, name string) (model.Team, error)
	ListMyTeams(currentUserID string) ([]model.Team, error)
	DeleteTeam(currentUserID, teamID string) error
	CreateTeamRole(currentUserID, teamID, key, name string, permissions []string) (model.TeamRole, error)
	ListTeamRoles(currentUserID, teamID string) ([]model.TeamRole, error)
	InviteToTeam(currentUserID, teamID, email, roleKey string, ttlHours int) (model.TeamInvite, string, error)
	AcceptTeamInvite(currentUserID, token string) (model.TeamMember, error)
	ListMyPendingInvites(currentUserID string) ([]model.TeamInvite, error)
	AcceptTeamInviteByID(currentUserID, inviteID string) (model.TeamMember, error)
	ListTeamMembers(currentUserID, teamID string) ([]model.TeamMember, error)
	UpdateTeamMemberRole(currentUserID, teamID, memberUserID, roleKey string) (model.TeamMember, error)
	CreateProject(currentUserID, teamID, name string) (model.Project, error)
	ListTeamProjects(currentUserID, teamID string) ([]model.Project, error)
	DeleteProject(currentUserID, teamID, projectID string) error
	CreateProjectRole(currentUserID, teamID, projectID, key, name, inheritTeamRoleKey string, permissions []string) (model.ProjectRole, error)
	ListProjectRoles(currentUserID, teamID, projectID string) ([]model.ProjectRole, error)
	AssignProjectMember(currentUserID, teamID, projectID, memberUserID, roleKey string) (model.ProjectMember, error)
	ListProjectMembers(currentUserID, teamID, projectID string) ([]model.ProjectMember, error)
	CheckProjectPermission(currentUserID, teamID, projectID, permission string) (model.PermissionCheckResult, error)
	GetByID(requestorRole, userID string) (model.User, error)
	GetCurrentUser(currentUserID string) (model.User, error)
	UpdateCurrentUser(currentUserID string, update ProfileUpdate) (model.User, error)
	ListUsers(requestorRole string, limit, offset int, search string) ([]model.User, int, error)
	UpdateUserByID(requestorRole, userID, name, role, status string) (model.User, error)
	DeleteUserByID(requestorRole, userID string) error
	BootstrapAdmin(email, password, name string) (model.User, error)
	ParseAccessToken(token string) (userID, role string, err error)
}

type ProfileUpdate struct {
	Name           *string
	Tag            *string
	Bio            *string
	GitHubURL      *string
	LinkedInURL    *string
	Telegram       *string
	WebsiteURL     *string
	SecondaryEmail *string
	Password       *string
}

type userService struct {
	repo   repository.UserStore
	tokens *TokenManager
}

func NewUserService(repo repository.UserStore, tokens *TokenManager) UserService {
	return &userService{repo: repo, tokens: tokens}
}

func (s *userService) Register(email, password, name string) (model.AuthResponse, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	name = strings.TrimSpace(name)
	if email == "" || password == "" || name == "" || len(password) < 8 {
		return model.AuthResponse{}, ErrBadRequest
	}

	hash, err := hashPassword(password)
	if err != nil {
		return model.AuthResponse{}, err
	}

	now := time.Now().UTC()
	user := model.User{
		ID:           newID(),
		Email:        email,
		PasswordHash: hash,
		Name:         name,
		Role:         model.RoleUser,
		Status:       model.StatusActive,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	created, err := s.repo.Create(user)
	if err != nil {
		return model.AuthResponse{}, err
	}

	tokens, err := s.issueTokenPair(created)
	if err != nil {
		return model.AuthResponse{}, err
	}

	return model.AuthResponse{
		User:   sanitizeUser(created),
		Tokens: tokens,
	}, nil
}

func (s *userService) Login(email, password string) (model.AuthResponse, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || password == "" {
		return model.AuthResponse{}, ErrBadRequest
	}

	user, err := s.repo.FindByEmail(email)
	if err != nil {
		return model.AuthResponse{}, ErrUnauthorized
	}
	if user.Status != model.StatusActive {
		return model.AuthResponse{}, ErrForbidden
	}
	if !checkPassword(user.PasswordHash, password) {
		return model.AuthResponse{}, ErrUnauthorized
	}

	tokens, err := s.issueTokenPair(user)
	if err != nil {
		return model.AuthResponse{}, err
	}

	return model.AuthResponse{
		User:   sanitizeUser(user),
		Tokens: tokens,
	}, nil
}

func (s *userService) Refresh(refreshToken string) (model.TokenPair, error) {
	claims, err := s.tokens.Parse(refreshToken, "refresh")
	if err != nil {
		return model.TokenPair{}, ErrUnauthorized
	}

	refreshHash := hashToken(refreshToken)
	user, err := s.repo.FindByID(claims.Subject)
	if err != nil {
		return model.TokenPair{}, ErrUnauthorized
	}
	teamIDs, err := s.repo.ListTeamIDsByUserID(context.Background(), user.ID)
	if err != nil {
		return model.TokenPair{}, err
	}
	access, refresh, expiresIn, err := s.tokens.NewTokenPair(user.ID, string(user.Role), teamIDs)
	if err != nil {
		return model.TokenPair{}, err
	}
	newRefreshHash := hashToken(refresh)
	if err := s.repo.RotateRefreshToken(context.Background(), refreshHash, newRefreshHash, user.ID, time.Now().UTC().Add(s.tokens.RefreshTokenTTL())); err != nil {
		return model.TokenPair{}, ErrUnauthorized
	}
	return model.TokenPair{AccessToken: access, RefreshToken: refresh, ExpiresIn: expiresIn}, nil
}

func (s *userService) CreateTeam(currentUserID, name string) (model.Team, error) {
	currentUserID = strings.TrimSpace(currentUserID)
	name = strings.TrimSpace(name)
	if currentUserID == "" || name == "" {
		return model.Team{}, ErrBadRequest
	}

	now := time.Now().UTC()
	team := model.Team{
		ID:        newID(),
		Name:      name,
		CreatedBy: currentUserID,
		CreatedAt: now,
		UpdatedAt: now,
	}
	created, err := s.repo.CreateTeam(context.Background(), team)
	if err != nil {
		return model.Team{}, err
	}

	defaultRoles := []model.TeamRole{
		{TeamID: created.ID, Key: "owner", Name: "Owner", Permissions: []string{"teams.manage", "roles.manage", "members.manage", "projects.manage"}, System: true, CreatedAt: now, UpdatedAt: now},
		{TeamID: created.ID, Key: "admin", Name: "Admin", Permissions: []string{"roles.manage", "members.manage", "projects.manage"}, System: true, CreatedAt: now, UpdatedAt: now},
		{TeamID: created.ID, Key: "member", Name: "Member", Permissions: []string{"tasks.read", "tasks.write"}, System: true, CreatedAt: now, UpdatedAt: now},
	}
	for _, role := range defaultRoles {
		if _, err := s.repo.CreateTeamRole(context.Background(), role); err != nil {
			return model.Team{}, err
		}
	}

	_, err = s.repo.UpsertTeamMember(context.Background(), model.TeamMember{
		TeamID:    created.ID,
		UserID:    currentUserID,
		RoleKey:   "owner",
		JoinedAt:  now,
		CreatedAt: now,
		UpdatedAt: now,
	})
	if err != nil {
		return model.Team{}, err
	}
	if err := s.repo.EnsureUserTeamMembership(context.Background(), currentUserID, created.ID); err != nil {
		return model.Team{}, err
	}

	return created, nil
}

func (s *userService) ListMyTeams(currentUserID string) ([]model.Team, error) {
	currentUserID = strings.TrimSpace(currentUserID)
	if currentUserID == "" {
		return nil, ErrUnauthorized
	}
	return s.repo.ListTeamsByUserID(context.Background(), currentUserID)
}

func (s *userService) DeleteTeam(currentUserID, teamID string) error {
	currentUserID = strings.TrimSpace(currentUserID)
	teamID = strings.TrimSpace(teamID)
	if currentUserID == "" || teamID == "" {
		return ErrBadRequest
	}
	team, err := s.repo.FindTeamByID(context.Background(), teamID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(team.CreatedBy) != currentUserID {
		return ErrForbidden
	}
	return s.repo.DeleteTeam(context.Background(), teamID)
}

func (s *userService) CreateTeamRole(currentUserID, teamID, key, name string, permissions []string) (model.TeamRole, error) {
	if err := s.requireTeamAdmin(currentUserID, teamID); err != nil {
		return model.TeamRole{}, err
	}
	key = normalizeRoleKey(key)
	name = strings.TrimSpace(name)
	if key == "" || name == "" {
		return model.TeamRole{}, ErrBadRequest
	}
	for _, reserved := range []string{"owner", "admin", "member"} {
		if key == reserved {
			return model.TeamRole{}, ErrBadRequest
		}
	}
	now := time.Now().UTC()
	role := model.TeamRole{
		TeamID:      strings.TrimSpace(teamID),
		Key:         key,
		Name:        name,
		Permissions: normalizePermissions(permissions),
		System:      false,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	return s.repo.CreateTeamRole(context.Background(), role)
}

func (s *userService) ListTeamRoles(currentUserID, teamID string) ([]model.TeamRole, error) {
	if err := s.requireTeamMembership(currentUserID, teamID); err != nil {
		return nil, err
	}
	return s.repo.ListTeamRoles(context.Background(), strings.TrimSpace(teamID))
}

func (s *userService) InviteToTeam(currentUserID, teamID, email, roleKey string, ttlHours int) (model.TeamInvite, string, error) {
	if err := s.requireTeamAdmin(currentUserID, teamID); err != nil {
		return model.TeamInvite{}, "", err
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if _, err := mail.ParseAddress(email); err != nil {
		return model.TeamInvite{}, "", ErrBadRequest
	}
	roleKey = normalizeRoleKey(roleKey)
	if roleKey == "" {
		roleKey = "member"
	}
	if _, err := s.repo.FindTeamRole(context.Background(), strings.TrimSpace(teamID), roleKey); err != nil {
		return model.TeamInvite{}, "", ErrBadRequest
	}
	if ttlHours <= 0 || ttlHours > 24*30 {
		ttlHours = 72
	}

	now := time.Now().UTC()
	token := randomToken()
	invite := model.TeamInvite{
		ID:        newID(),
		TeamID:    strings.TrimSpace(teamID),
		Email:     email,
		RoleKey:   roleKey,
		Status:    "pending",
		InvitedBy: strings.TrimSpace(currentUserID),
		ExpiresAt: now.Add(time.Duration(ttlHours) * time.Hour),
		CreatedAt: now,
		UpdatedAt: now,
	}
	created, err := s.repo.CreateTeamInvite(context.Background(), invite, hashToken(token))
	if err != nil {
		return model.TeamInvite{}, "", err
	}
	return created, token, nil
}

func (s *userService) AcceptTeamInvite(currentUserID, token string) (model.TeamMember, error) {
	currentUserID = strings.TrimSpace(currentUserID)
	token = strings.TrimSpace(token)
	if currentUserID == "" || token == "" {
		return model.TeamMember{}, ErrBadRequest
	}

	invite, err := s.repo.FindPendingInviteByTokenHash(context.Background(), hashToken(token))
	if err != nil {
		return model.TeamMember{}, ErrUnauthorized
	}
	if invite.Status != "pending" || time.Now().UTC().After(invite.ExpiresAt) {
		return model.TeamMember{}, ErrUnauthorized
	}

	user, err := s.repo.FindByID(currentUserID)
	if err != nil {
		return model.TeamMember{}, ErrUnauthorized
	}
	if !strings.EqualFold(strings.TrimSpace(user.Email), strings.TrimSpace(invite.Email)) {
		return model.TeamMember{}, ErrForbidden
	}

	now := time.Now().UTC()
	member := model.TeamMember{
		TeamID:    invite.TeamID,
		UserID:    currentUserID,
		RoleKey:   invite.RoleKey,
		InvitedBy: invite.InvitedBy,
		JoinedAt:  now,
		CreatedAt: now,
		UpdatedAt: now,
	}
	result, err := s.repo.UpsertTeamMember(context.Background(), member)
	if err != nil {
		return model.TeamMember{}, err
	}
	if err := s.repo.MarkInviteAccepted(context.Background(), invite.ID, currentUserID); err != nil {
		return model.TeamMember{}, err
	}
	if err := s.repo.EnsureUserTeamMembership(context.Background(), currentUserID, invite.TeamID); err != nil {
		return model.TeamMember{}, err
	}
	return result, nil
}

func (s *userService) ListMyPendingInvites(currentUserID string) ([]model.TeamInvite, error) {
	currentUserID = strings.TrimSpace(currentUserID)
	if currentUserID == "" {
		return nil, ErrUnauthorized
	}
	user, err := s.repo.FindByID(currentUserID)
	if err != nil {
		return nil, ErrUnauthorized
	}
	return s.repo.ListPendingInvitesByEmail(context.Background(), user.Email)
}

func (s *userService) AcceptTeamInviteByID(currentUserID, inviteID string) (model.TeamMember, error) {
	currentUserID = strings.TrimSpace(currentUserID)
	inviteID = strings.TrimSpace(inviteID)
	if currentUserID == "" || inviteID == "" {
		return model.TeamMember{}, ErrBadRequest
	}

	user, err := s.repo.FindByID(currentUserID)
	if err != nil {
		return model.TeamMember{}, ErrUnauthorized
	}

	invite, err := s.repo.FindTeamInviteByID(context.Background(), inviteID)
	if err != nil {
		return model.TeamMember{}, ErrUnauthorized
	}
	if invite.Status != "pending" || time.Now().UTC().After(invite.ExpiresAt) {
		return model.TeamMember{}, ErrUnauthorized
	}
	if !strings.EqualFold(strings.TrimSpace(user.Email), strings.TrimSpace(invite.Email)) {
		return model.TeamMember{}, ErrForbidden
	}

	now := time.Now().UTC()
	member := model.TeamMember{
		TeamID:    invite.TeamID,
		UserID:    currentUserID,
		RoleKey:   invite.RoleKey,
		InvitedBy: invite.InvitedBy,
		JoinedAt:  now,
		CreatedAt: now,
		UpdatedAt: now,
	}
	result, err := s.repo.UpsertTeamMember(context.Background(), member)
	if err != nil {
		return model.TeamMember{}, err
	}
	if err := s.repo.MarkInviteAccepted(context.Background(), invite.ID, currentUserID); err != nil {
		return model.TeamMember{}, err
	}
	if err := s.repo.EnsureUserTeamMembership(context.Background(), currentUserID, invite.TeamID); err != nil {
		return model.TeamMember{}, err
	}
	return result, nil
}

func (s *userService) ListTeamMembers(currentUserID, teamID string) ([]model.TeamMember, error) {
	if err := s.requireTeamMembership(currentUserID, teamID); err != nil {
		return nil, err
	}
	return s.repo.ListTeamMembers(context.Background(), strings.TrimSpace(teamID))
}

func (s *userService) UpdateTeamMemberRole(currentUserID, teamID, memberUserID, roleKey string) (model.TeamMember, error) {
	if err := s.requireTeamAdmin(currentUserID, teamID); err != nil {
		return model.TeamMember{}, err
	}
	roleKey = normalizeRoleKey(roleKey)
	if roleKey == "" {
		return model.TeamMember{}, ErrBadRequest
	}
	if _, err := s.repo.FindTeamRole(context.Background(), strings.TrimSpace(teamID), roleKey); err != nil {
		return model.TeamMember{}, ErrBadRequest
	}
	member, err := s.repo.FindTeamMember(context.Background(), strings.TrimSpace(teamID), strings.TrimSpace(memberUserID))
	if err != nil {
		return model.TeamMember{}, err
	}
	if member.RoleKey == "owner" && roleKey != "owner" {
		return model.TeamMember{}, ErrForbidden
	}
	member.RoleKey = roleKey
	member.UpdatedAt = time.Now().UTC()
	return s.repo.UpsertTeamMember(context.Background(), member)
}

func (s *userService) CreateProject(currentUserID, teamID, name string) (model.Project, error) {
	if err := s.requireTeamAdmin(currentUserID, teamID); err != nil {
		return model.Project{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return model.Project{}, ErrBadRequest
	}
	now := time.Now().UTC()
	project := model.Project{
		ID:        newID(),
		TeamID:    strings.TrimSpace(teamID),
		Name:      name,
		CreatedBy: strings.TrimSpace(currentUserID),
		CreatedAt: now,
		UpdatedAt: now,
	}
	created, err := s.repo.CreateProject(context.Background(), project)
	if err != nil {
		return model.Project{}, err
	}
	defaultRoles := []model.ProjectRole{
		{ProjectID: created.ID, Key: "owner", Name: "Owner", Permissions: []string{"tasks.read", "tasks.write", "project.members.manage", "project.roles.manage"}, InheritTeamRoleKey: "owner", System: true, CreatedAt: now, UpdatedAt: now},
		{ProjectID: created.ID, Key: "admin", Name: "Admin", Permissions: []string{"tasks.read", "tasks.write", "project.members.manage"}, InheritTeamRoleKey: "admin", System: true, CreatedAt: now, UpdatedAt: now},
		{ProjectID: created.ID, Key: "member", Name: "Member", Permissions: []string{"tasks.read", "tasks.write"}, InheritTeamRoleKey: "member", System: true, CreatedAt: now, UpdatedAt: now},
	}
	for _, role := range defaultRoles {
		if _, err := s.repo.CreateProjectRole(context.Background(), role); err != nil {
			return model.Project{}, err
		}
	}
	_, err = s.repo.UpsertProjectMember(context.Background(), model.ProjectMember{
		ProjectID: created.ID,
		UserID:    strings.TrimSpace(currentUserID),
		RoleKey:   "owner",
		CreatedAt: now,
		UpdatedAt: now,
	})
	if err != nil {
		return model.Project{}, err
	}
	return created, nil
}

func (s *userService) ListTeamProjects(currentUserID, teamID string) ([]model.Project, error) {
	if err := s.requireTeamMembership(currentUserID, teamID); err != nil {
		return nil, err
	}
	return s.repo.ListProjectsByTeamID(context.Background(), strings.TrimSpace(teamID))
}

func (s *userService) DeleteProject(currentUserID, teamID, projectID string) error {
	if err := s.requireTeamAdmin(currentUserID, teamID); err != nil {
		return err
	}
	project, err := s.repo.FindProjectByID(context.Background(), strings.TrimSpace(projectID))
	if err != nil {
		return err
	}
	if project.TeamID != strings.TrimSpace(teamID) {
		return ErrForbidden
	}
	return s.repo.DeleteProject(context.Background(), project.ID)
}

func (s *userService) CreateProjectRole(currentUserID, teamID, projectID, key, name, inheritTeamRoleKey string, permissions []string) (model.ProjectRole, error) {
	if err := s.requireTeamAdmin(currentUserID, teamID); err != nil {
		return model.ProjectRole{}, err
	}
	project, err := s.repo.FindProjectByID(context.Background(), strings.TrimSpace(projectID))
	if err != nil {
		return model.ProjectRole{}, err
	}
	if project.TeamID != strings.TrimSpace(teamID) {
		return model.ProjectRole{}, ErrForbidden
	}

	key = normalizeRoleKey(key)
	name = strings.TrimSpace(name)
	inheritTeamRoleKey = normalizeRoleKey(inheritTeamRoleKey)
	if key == "" || name == "" {
		return model.ProjectRole{}, ErrBadRequest
	}
	for _, reserved := range []string{"owner", "admin", "member"} {
		if key == reserved {
			return model.ProjectRole{}, ErrBadRequest
		}
	}
	if inheritTeamRoleKey != "" {
		if _, err := s.repo.FindTeamRole(context.Background(), strings.TrimSpace(teamID), inheritTeamRoleKey); err != nil {
			return model.ProjectRole{}, ErrBadRequest
		}
	}
	now := time.Now().UTC()
	role := model.ProjectRole{
		ProjectID:          project.ID,
		Key:                key,
		Name:               name,
		Permissions:        normalizePermissions(permissions),
		InheritTeamRoleKey: inheritTeamRoleKey,
		System:             false,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	return s.repo.CreateProjectRole(context.Background(), role)
}

func (s *userService) ListProjectRoles(currentUserID, teamID, projectID string) ([]model.ProjectRole, error) {
	if err := s.requireTeamMembership(currentUserID, teamID); err != nil {
		return nil, err
	}
	project, err := s.repo.FindProjectByID(context.Background(), strings.TrimSpace(projectID))
	if err != nil {
		return nil, err
	}
	if project.TeamID != strings.TrimSpace(teamID) {
		return nil, ErrForbidden
	}
	return s.repo.ListProjectRoles(context.Background(), project.ID)
}

func (s *userService) AssignProjectMember(currentUserID, teamID, projectID, memberUserID, roleKey string) (model.ProjectMember, error) {
	if err := s.requireTeamAdmin(currentUserID, teamID); err != nil {
		return model.ProjectMember{}, err
	}
	project, err := s.repo.FindProjectByID(context.Background(), strings.TrimSpace(projectID))
	if err != nil {
		return model.ProjectMember{}, err
	}
	if project.TeamID != strings.TrimSpace(teamID) {
		return model.ProjectMember{}, ErrForbidden
	}
	if err := s.requireTeamMembership(memberUserID, teamID); err != nil {
		return model.ProjectMember{}, ErrBadRequest
	}

	roleKey = normalizeRoleKey(roleKey)
	if roleKey != "" {
		if _, err := s.repo.FindProjectRole(context.Background(), project.ID, roleKey); err != nil {
			return model.ProjectMember{}, ErrBadRequest
		}
	}
	now := time.Now().UTC()
	member := model.ProjectMember{
		ProjectID: project.ID,
		UserID:    strings.TrimSpace(memberUserID),
		RoleKey:   roleKey,
		CreatedAt: now,
		UpdatedAt: now,
	}
	return s.repo.UpsertProjectMember(context.Background(), member)
}

func (s *userService) ListProjectMembers(currentUserID, teamID, projectID string) ([]model.ProjectMember, error) {
	if err := s.requireTeamMembership(currentUserID, teamID); err != nil {
		return nil, err
	}
	project, err := s.repo.FindProjectByID(context.Background(), strings.TrimSpace(projectID))
	if err != nil {
		return nil, err
	}
	if project.TeamID != strings.TrimSpace(teamID) {
		return nil, ErrForbidden
	}
	return s.repo.ListProjectMembers(context.Background(), project.ID)
}

func (s *userService) CheckProjectPermission(currentUserID, teamID, projectID, permission string) (model.PermissionCheckResult, error) {
	permission = strings.ToLower(strings.TrimSpace(permission))
	if permission == "" {
		return model.PermissionCheckResult{}, ErrBadRequest
	}
	teamID = strings.TrimSpace(teamID)
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return model.PermissionCheckResult{}, ErrBadRequest
	}

	project, err := s.repo.FindProjectByID(context.Background(), projectID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return model.PermissionCheckResult{Allowed: false}, nil
		}
		return model.PermissionCheckResult{}, err
	}
	if teamID == "" || teamID != project.TeamID {
		teamID = project.TeamID
	}

	teamMember, err := s.repo.FindTeamMember(context.Background(), teamID, strings.TrimSpace(currentUserID))
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return model.PermissionCheckResult{Allowed: false}, nil
		}
		return model.PermissionCheckResult{}, err
	}

	effectivePermissions := make([]string, 0)
	matched := make([]string, 0)
	teamRole, err := s.repo.FindTeamRole(context.Background(), teamID, teamMember.RoleKey)
	if err == nil {
		effectivePermissions = append(effectivePermissions, teamRole.Permissions...)
	}

	// Keep backward compatibility for existing teams where owner/admin roles
	// were configured with projects.manage but without explicit tasks.* scopes.
	teamNormalized := normalizePermissions(effectivePermissions)
	for _, p := range teamNormalized {
		if p == "projects.manage" {
			effectivePermissions = append(effectivePermissions, "tasks.read", "tasks.write")
			break
		}
	}

	projectMember, err := s.repo.FindProjectMember(context.Background(), projectID, strings.TrimSpace(currentUserID))
	if err != nil && !errors.Is(err, repository.ErrNotFound) {
		return model.PermissionCheckResult{}, err
	}

	var projectRoleKey string
	if err == nil && projectMember.RoleKey != "" {
		projectRole, err := s.repo.FindProjectRole(context.Background(), projectID, projectMember.RoleKey)
		if err == nil {
			projectRoleKey = projectRole.Key
			effectivePermissions = append(effectivePermissions, projectRole.Permissions...)
			if projectRole.InheritTeamRoleKey != "" {
				if inheritedRole, err := s.repo.FindTeamRole(context.Background(), teamID, projectRole.InheritTeamRoleKey); err == nil {
					effectivePermissions = append(effectivePermissions, inheritedRole.Permissions...)
				}
			}
		}
	}

	normalized := normalizePermissions(effectivePermissions)
	allowed := false
	for _, p := range normalized {
		if p == permission {
			allowed = true
			matched = append(matched, p)
		}
	}

	source := "team"
	if projectRoleKey != "" {
		source = "project"
	}
	return model.PermissionCheckResult{
		Allowed:     allowed,
		Source:      source,
		TeamRoleKey: teamMember.RoleKey,
		ProjectRole: projectRoleKey,
		Matched:     matched,
	}, nil
}

func (s *userService) GetByID(requestorRole, userID string) (model.User, error) {
	if !isAdmin(requestorRole) {
		return model.User{}, ErrForbidden
	}
	user, err := s.repo.FindByID(userID)
	if err != nil {
		return model.User{}, err
	}
	return sanitizeUser(user), nil
}

func (s *userService) GetCurrentUser(currentUserID string) (model.User, error) {
	user, err := s.repo.FindByID(currentUserID)
	if err != nil {
		return model.User{}, err
	}
	return sanitizeUser(user), nil
}

func (s *userService) LookupUserByID(currentUserID, userID string) (model.User, error) {
	currentUserID = strings.TrimSpace(currentUserID)
	if currentUserID == "" {
		return model.User{}, ErrUnauthorized
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return model.User{}, ErrBadRequest
	}
	user, err := s.repo.FindByID(userID)
	if err != nil {
		return model.User{}, repository.ErrNotFound
	}
	return sanitizeUser(user), nil
}

func (s *userService) LookupUserByTag(currentUserID, tag string) (model.User, error) {
	currentUserID = strings.TrimSpace(currentUserID)
	if currentUserID == "" {
		return model.User{}, ErrUnauthorized
	}
	normalizedTag := normalizeUserTag(tag)
	if normalizedTag == "" {
		return model.User{}, ErrBadRequest
	}
	user, err := s.repo.FindByTag(normalizedTag)
	if err != nil {
		return model.User{}, repository.ErrNotFound
	}
	return sanitizeUser(user), nil
}

func (s *userService) LookupUserByEmail(currentUserID, email string) (model.User, error) {
	currentUserID = strings.TrimSpace(currentUserID)
	if currentUserID == "" {
		return model.User{}, ErrUnauthorized
	}
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	if normalizedEmail == "" {
		return model.User{}, ErrBadRequest
	}
	if _, err := mail.ParseAddress(normalizedEmail); err != nil {
		return model.User{}, ErrBadRequest
	}
	user, err := s.repo.FindByEmail(normalizedEmail)
	if err != nil {
		return model.User{}, repository.ErrNotFound
	}
	return sanitizeUser(user), nil
}

func (s *userService) UpdateCurrentUser(currentUserID string, update ProfileUpdate) (model.User, error) {
	user, err := s.repo.FindByID(currentUserID)
	if err != nil {
		return model.User{}, err
	}

	updated := false
	if update.Name != nil {
		user.Name = strings.TrimSpace(*update.Name)
		updated = true
	}
	if update.Tag != nil {
		tag := strings.TrimSpace(*update.Tag)
		if tag != "" {
			normalizedTag := normalizeUserTag(tag)
			if normalizedTag == "" {
				return model.User{}, ErrBadRequest
			}
			user.Tag = normalizedTag
		} else {
			user.Tag = ""
		}
		updated = true
	}
	if update.Bio != nil {
		user.Bio = strings.TrimSpace(*update.Bio)
		updated = true
	}
	if update.GitHubURL != nil {
		githubURL := strings.TrimSpace(*update.GitHubURL)
		if githubURL != "" {
			if err := validateHTTPURL(githubURL); err != nil {
				return model.User{}, ErrBadRequest
			}
		}
		user.GitHubURL = githubURL
		updated = true
	}
	if update.LinkedInURL != nil {
		linkedInURL := strings.TrimSpace(*update.LinkedInURL)
		if linkedInURL != "" {
			if err := validateHTTPURL(linkedInURL); err != nil {
				return model.User{}, ErrBadRequest
			}
		}
		user.LinkedInURL = linkedInURL
		updated = true
	}
	if update.Telegram != nil {
		telegram := strings.TrimSpace(*update.Telegram)
		if telegram != "" && !isValidTelegram(telegram) {
			return model.User{}, ErrBadRequest
		}
		user.Telegram = telegram
		updated = true
	}
	if update.WebsiteURL != nil {
		websiteURL := strings.TrimSpace(*update.WebsiteURL)
		if websiteURL != "" {
			if err := validateHTTPURL(websiteURL); err != nil {
				return model.User{}, ErrBadRequest
			}
		}
		user.WebsiteURL = websiteURL
		updated = true
	}
	if update.SecondaryEmail != nil {
		secondaryEmail := strings.ToLower(strings.TrimSpace(*update.SecondaryEmail))
		if secondaryEmail != "" {
			if _, err := mail.ParseAddress(secondaryEmail); err != nil {
				return model.User{}, ErrBadRequest
			}
		}
		user.SecondaryEmail = secondaryEmail
		updated = true
	}
	if update.Password != nil {
		password := strings.TrimSpace(*update.Password)
		if password != "" {
			if len(password) < 8 {
				return model.User{}, ErrBadRequest
			}
			hash, err := hashPassword(password)
			if err != nil {
				return model.User{}, err
			}
			user.PasswordHash = hash
			updated = true
		}
	}
	if !updated {
		return model.User{}, ErrBadRequest
	}

	user.UpdatedAt = time.Now().UTC()
	result, err := s.repo.Update(user)
	if err != nil {
		return model.User{}, err
	}
	return sanitizeUser(result), nil
}

func (s *userService) ListUsers(requestorRole string, limit, offset int, search string) ([]model.User, int, error) {
	if !isAdmin(requestorRole) {
		return nil, 0, ErrForbidden
	}
	if limit <= 0 || limit > 100 || offset < 0 {
		return nil, 0, ErrBadRequest
	}
	items, total, err := s.repo.List(limit, offset, search)
	if err != nil {
		return nil, 0, err
	}
	for i := range items {
		items[i] = sanitizeUser(items[i])
	}
	return items, total, nil
}

func (s *userService) UpdateUserByID(requestorRole, userID, name, role, status string) (model.User, error) {
	if !isAdmin(requestorRole) {
		return model.User{}, ErrForbidden
	}
	user, err := s.repo.FindByID(userID)
	if err != nil {
		return model.User{}, err
	}

	updated := false
	if strings.TrimSpace(name) != "" {
		user.Name = strings.TrimSpace(name)
		updated = true
	}
	if role != "" {
		parsedRole, ok := parseRole(role)
		if !ok {
			return model.User{}, ErrBadRequest
		}
		user.Role = parsedRole
		updated = true
	}
	if status != "" {
		parsedStatus, ok := parseStatus(status)
		if !ok {
			return model.User{}, ErrBadRequest
		}
		user.Status = parsedStatus
		updated = true
	}
	if !updated {
		return model.User{}, ErrBadRequest
	}

	user.UpdatedAt = time.Now().UTC()
	result, err := s.repo.Update(user)
	if err != nil {
		return model.User{}, err
	}
	return sanitizeUser(result), nil
}

func (s *userService) DeleteUserByID(requestorRole, userID string) error {
	if !isAdmin(requestorRole) {
		return ErrForbidden
	}
	return s.repo.Delete(userID)
}

func (s *userService) ParseAccessToken(token string) (userID, role string, err error) {
	claims, err := s.tokens.Parse(token, "access")
	if err != nil {
		return "", "", ErrUnauthorized
	}
	return claims.Subject, claims.Role, nil
}

func (s *userService) BootstrapAdmin(email, password, name string) (model.User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	name = strings.TrimSpace(name)
	if email == "" || password == "" {
		return model.User{}, ErrBadRequest
	}
	if name == "" {
		name = "System Admin"
	}

	hash, err := hashPassword(password)
	if err != nil {
		return model.User{}, err
	}

	user, err := s.repo.FindByEmail(email)
	if err != nil {
		if !errors.Is(err, repository.ErrNotFound) {
			return model.User{}, err
		}
		now := time.Now().UTC()
		created, createErr := s.repo.Create(model.User{
			ID:           newID(),
			Email:        email,
			PasswordHash: hash,
			Name:         name,
			Role:         model.RoleAdmin,
			Status:       model.StatusActive,
			CreatedAt:    now,
			UpdatedAt:    now,
		})
		if createErr != nil {
			return model.User{}, createErr
		}
		return sanitizeUser(created), nil
	}

	user.Role = model.RoleAdmin
	user.Status = model.StatusActive
	if name != "" {
		user.Name = name
	}
	user.PasswordHash = hash
	user.UpdatedAt = time.Now().UTC()

	updated, err := s.repo.Update(user)
	if err != nil {
		return model.User{}, err
	}
	return sanitizeUser(updated), nil
}

func sanitizeUser(user model.User) model.User {
	user.PasswordHash = ""
	return user
}

func normalizeUserTag(value string) string {
	tag := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(value, "@")))
	if tag == "" {
		return ""
	}
	if len(tag) < 3 || len(tag) > 24 {
		return ""
	}
	for _, r := range tag {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			continue
		}
		return ""
	}
	return tag
}

func isAdmin(role string) bool {
	return role == string(model.RoleAdmin)
}

func parseRole(value string) (model.Role, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case string(model.RoleUser):
		return model.RoleUser, true
	case string(model.RoleManager):
		return model.RoleManager, true
	case string(model.RoleAdmin):
		return model.RoleAdmin, true
	default:
		return "", false
	}
}

func parseStatus(value string) (model.Status, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case string(model.StatusActive):
		return model.StatusActive, true
	case string(model.StatusInactive):
		return model.StatusInactive, true
	case string(model.StatusSuspended):
		return model.StatusSuspended, true
	default:
		return "", false
	}
}

func newID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("u-%d", time.Now().UnixNano())
	}

	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80

	full := hex.EncodeToString(buf)
	return full[0:8] + "-" + full[8:12] + "-" + full[12:16] + "-" + full[16:20] + "-" + full[20:32]
}

func hashPassword(password string) (string, error) {
	const (
		memory      uint32 = 64 * 1024
		iterations  uint32 = 3
		parallelism uint8  = 2
		saltLength         = 16
		keyLength   uint32 = 32
	)

	salt := make([]byte, saltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}

	hash := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, keyLength)
	encodedSalt := base64.RawStdEncoding.EncodeToString(salt)
	encodedHash := base64.RawStdEncoding.EncodeToString(hash)

	return fmt.Sprintf("argon2id$v=19$m=%d,t=%d,p=%d$%s$%s", memory, iterations, parallelism, encodedSalt, encodedHash), nil
}

func checkPassword(storedHash, password string) bool {
	parts := strings.Split(storedHash, "$")
	if len(parts) != 5 || parts[0] != "argon2id" || parts[1] != "v=19" {
		return false
	}

	params := strings.Split(parts[2], ",")
	if len(params) != 3 {
		return false
	}

	memory, err := parseHashParam(params[0], "m=")
	if err != nil {
		return false
	}
	iterations, err := parseHashParam(params[1], "t=")
	if err != nil {
		return false
	}
	parallelism, err := parseHashParam(params[2], "p=")
	if err != nil {
		return false
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	hash, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}

	calculated := argon2.IDKey([]byte(password), salt, uint32(iterations), uint32(memory), uint8(parallelism), uint32(len(hash)))
	return subtle.ConstantTimeCompare(hash, calculated) == 1
}

func parseHashParam(value, prefix string) (int, error) {
	if !strings.HasPrefix(value, prefix) {
		return 0, errors.New("invalid hash param")
	}
	return strconv.Atoi(strings.TrimPrefix(value, prefix))
}

func isValidTelegram(value string) bool {
	if strings.HasPrefix(value, "https://t.me/") || strings.HasPrefix(value, "http://t.me/") {
		return true
	}
	if strings.HasPrefix(value, "@") && len(value) >= 6 && len(value) <= 33 {
		return !strings.ContainsAny(value, " /")
	}
	return false
}

func validateHTTPURL(value string) error {
	u, err := url.ParseRequestURI(value)
	if err != nil {
		return err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("invalid URL scheme")
	}
	if u.Host == "" {
		return errors.New("missing URL host")
	}
	return nil
}

func (s *userService) issueTokenPair(user model.User) (model.TokenPair, error) {
	teamIDs, err := s.repo.ListTeamIDsByUserID(context.Background(), user.ID)
	if err != nil {
		return model.TokenPair{}, err
	}

	access, refresh, expiresIn, err := s.tokens.NewTokenPair(user.ID, string(user.Role), teamIDs)
	if err != nil {
		return model.TokenPair{}, err
	}

	if err := s.repo.StoreRefreshToken(context.Background(), hashToken(refresh), user.ID, time.Now().UTC().Add(s.tokens.RefreshTokenTTL())); err != nil {
		return model.TokenPair{}, err
	}

	return model.TokenPair{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    expiresIn,
	}, nil
}

func hashToken(token string) string {
	sum := sha256Sum(token)
	return hex.EncodeToString(sum[:])
}

func sha256Sum(value string) [32]byte {
	return sha256.Sum256([]byte(value))
}

func normalizeRoleKey(value string) string {
	v := strings.ToLower(strings.TrimSpace(value))
	v = strings.ReplaceAll(v, " ", "_")
	if len(v) > 64 {
		v = v[:64]
	}
	return v
}

func normalizePermissions(items []string) []string {
	if len(items) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(items))
	result := make([]string, 0, len(items))
	for _, raw := range items {
		v := strings.ToLower(strings.TrimSpace(raw))
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		result = append(result, v)
	}
	return result
}

func (s *userService) requireTeamMembership(currentUserID, teamID string) error {
	member, err := s.repo.FindTeamMember(context.Background(), strings.TrimSpace(teamID), strings.TrimSpace(currentUserID))
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return ErrForbidden
		}
		return err
	}
	if strings.TrimSpace(member.UserID) == "" {
		return ErrForbidden
	}
	return nil
}

func (s *userService) requireTeamAdmin(currentUserID, teamID string) error {
	member, err := s.repo.FindTeamMember(context.Background(), strings.TrimSpace(teamID), strings.TrimSpace(currentUserID))
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return ErrForbidden
		}
		return err
	}
	role := strings.ToLower(strings.TrimSpace(member.RoleKey))
	if role != "owner" && role != "admin" {
		return ErrForbidden
	}
	return nil
}

func randomToken() string {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return newID()
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}
