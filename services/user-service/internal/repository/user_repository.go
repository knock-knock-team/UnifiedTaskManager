package repository

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"unified-task-manager/services/user-service/internal/model"
)

var (
	ErrNotFound      = errors.New("user not found")
	ErrEmailConflict = errors.New("email already exists")
)

type UserRepository interface {
	Create(user model.User) (model.User, error)
	FindByID(id string) (model.User, error)
	FindByEmail(email string) (model.User, error)
	FindByTag(tag string) (model.User, error)
	Update(user model.User) (model.User, error)
	List(limit, offset int, search string) ([]model.User, int, error)
	Delete(id string) error
	Ping(ctx context.Context) error
}

type RefreshTokenStore interface {
	StoreRefreshToken(ctx context.Context, tokenHash, userID string, expiresAt time.Time) error
	RotateRefreshToken(ctx context.Context, oldTokenHash, newTokenHash, userID string, expiresAt time.Time) error
	ListTeamIDsByUserID(ctx context.Context, userID string) ([]string, error)
}

type RegistrationVerificationStore interface {
	UpsertRegistrationVerification(ctx context.Context, item model.RegistrationVerification) error
	FindRegistrationVerification(ctx context.Context, email string) (model.RegistrationVerification, error)
	DeleteRegistrationVerification(ctx context.Context, email string) error
	UpsertPasswordResetVerification(ctx context.Context, item model.PasswordResetVerification) error
	FindPasswordResetVerification(ctx context.Context, email string) (model.PasswordResetVerification, error)
	DeletePasswordResetVerification(ctx context.Context, email string) error
}

type TeamStore interface {
	CreateTeam(ctx context.Context, team model.Team) (model.Team, error)
	FindTeamByID(ctx context.Context, teamID string) (model.Team, error)
	ListTeamsByUserID(ctx context.Context, userID string) ([]model.Team, error)
	DeleteTeam(ctx context.Context, teamID string) error

	CreateTeamRole(ctx context.Context, role model.TeamRole) (model.TeamRole, error)
	ListTeamRoles(ctx context.Context, teamID string) ([]model.TeamRole, error)
	FindTeamRole(ctx context.Context, teamID, roleKey string) (model.TeamRole, error)

	UpsertTeamMember(ctx context.Context, member model.TeamMember) (model.TeamMember, error)
	FindTeamMember(ctx context.Context, teamID, userID string) (model.TeamMember, error)
	ListTeamMembers(ctx context.Context, teamID string) ([]model.TeamMember, error)

	CreateTeamInvite(ctx context.Context, invite model.TeamInvite, tokenHash string) (model.TeamInvite, error)
	FindTeamInviteByID(ctx context.Context, inviteID string) (model.TeamInvite, error)
	FindPendingInviteByTokenHash(ctx context.Context, tokenHash string) (model.TeamInvite, error)
	ListPendingInvitesByEmail(ctx context.Context, email string) ([]model.TeamInvite, error)
	MarkInviteAccepted(ctx context.Context, inviteID, acceptedBy string) error

	EnsureUserTeamMembership(ctx context.Context, userID, teamID string) error

	CreateProject(ctx context.Context, project model.Project) (model.Project, error)
	ListProjectsByTeamID(ctx context.Context, teamID string) ([]model.Project, error)
	FindProjectByID(ctx context.Context, projectID string) (model.Project, error)
	DeleteProject(ctx context.Context, projectID string) error

	CreateProjectRole(ctx context.Context, role model.ProjectRole) (model.ProjectRole, error)
	ListProjectRoles(ctx context.Context, projectID string) ([]model.ProjectRole, error)
	FindProjectRole(ctx context.Context, projectID, roleKey string) (model.ProjectRole, error)

	UpsertProjectMember(ctx context.Context, member model.ProjectMember) (model.ProjectMember, error)
	FindProjectMember(ctx context.Context, projectID, userID string) (model.ProjectMember, error)
	ListProjectMembers(ctx context.Context, projectID string) ([]model.ProjectMember, error)
}

type UserStore interface {
	UserRepository
	RefreshTokenStore
	RegistrationVerificationStore
	TeamStore
}

type refreshTokenRecord struct {
	userID    string
	expiresAt time.Time
}

type inviteRecord struct {
	invite    model.TeamInvite
	tokenHash string
}

type InMemoryUserRepository struct {
	mu                         sync.RWMutex
	byID                       map[string]model.User
	emailTo                    map[string]string
	refreshTokens              map[string]refreshTokenRecord
	registrationVerifications  map[string]model.RegistrationVerification
	passwordResetVerifications map[string]model.PasswordResetVerification
	userTeams                  map[string]map[string]struct{}
	teams                      map[string]model.Team
	teamRoles                  map[string]map[string]model.TeamRole
	teamMembers                map[string]map[string]model.TeamMember
	teamInvites                map[string]inviteRecord
	projects                   map[string]model.Project
	projectRoles               map[string]map[string]model.ProjectRole
	projectMember              map[string]map[string]model.ProjectMember
}

func NewInMemoryUserRepository() *InMemoryUserRepository {
	return &InMemoryUserRepository{
		byID:                       make(map[string]model.User),
		emailTo:                    make(map[string]string),
		refreshTokens:              make(map[string]refreshTokenRecord),
		registrationVerifications:  make(map[string]model.RegistrationVerification),
		passwordResetVerifications: make(map[string]model.PasswordResetVerification),
		userTeams:                  make(map[string]map[string]struct{}),
		teams:                      make(map[string]model.Team),
		teamRoles:                  make(map[string]map[string]model.TeamRole),
		teamMembers:                make(map[string]map[string]model.TeamMember),
		teamInvites:                make(map[string]inviteRecord),
		projects:                   make(map[string]model.Project),
		projectRoles:               make(map[string]map[string]model.ProjectRole),
		projectMember:              make(map[string]map[string]model.ProjectMember),
	}
}

func (r *InMemoryUserRepository) Create(user model.User) (model.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	emailKey := strings.ToLower(user.Email)
	if _, exists := r.emailTo[emailKey]; exists {
		return model.User{}, ErrEmailConflict
	}

	r.byID[user.ID] = user
	r.emailTo[emailKey] = user.ID
	return user, nil
}

func (r *InMemoryUserRepository) FindByID(id string) (model.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	user, ok := r.byID[id]
	if !ok || user.DeletedAt != nil {
		return model.User{}, ErrNotFound
	}
	return user, nil
}

func (r *InMemoryUserRepository) FindByEmail(email string) (model.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	id, ok := r.emailTo[strings.ToLower(email)]
	if !ok {
		return model.User{}, ErrNotFound
	}
	user, ok := r.byID[id]
	if !ok || user.DeletedAt != nil {
		return model.User{}, ErrNotFound
	}
	return user, nil
}

func (r *InMemoryUserRepository) Update(user model.User) (model.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	current, ok := r.byID[user.ID]
	if !ok || current.DeletedAt != nil {
		return model.User{}, ErrNotFound
	}

	if !strings.EqualFold(current.Email, user.Email) {
		if _, exists := r.emailTo[strings.ToLower(user.Email)]; exists {
			return model.User{}, ErrEmailConflict
		}
		delete(r.emailTo, strings.ToLower(current.Email))
		r.emailTo[strings.ToLower(user.Email)] = user.ID
	}

	r.byID[user.ID] = user
	return user, nil
}

func (r *InMemoryUserRepository) List(limit, offset int, search string) ([]model.User, int, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	search = strings.ToLower(strings.TrimSpace(search))
	all := make([]model.User, 0, len(r.byID))
	for _, user := range r.byID {
		if user.DeletedAt != nil {
			continue
		}
		if search != "" {
			if !strings.Contains(strings.ToLower(user.Name), search) && !strings.Contains(strings.ToLower(user.Email), search) && !strings.Contains(strings.ToLower(user.Tag), search) {
				continue
			}
		}
		all = append(all, user)
	}

	total := len(all)
	if offset >= total {
		return []model.User{}, total, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return all[offset:end], total, nil
}

func (r *InMemoryUserRepository) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	user, ok := r.byID[id]
	if !ok || user.DeletedAt != nil {
		return ErrNotFound
	}
	now := time.Now().UTC()
	user.DeletedAt = &now
	user.UpdatedAt = now
	r.byID[id] = user
	return nil
}

func (r *InMemoryUserRepository) Ping(_ context.Context) error {
	return nil
}

func (r *InMemoryUserRepository) FindByTag(tag string) (model.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tag = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(tag, "@")))
	for _, user := range r.byID {
		if user.DeletedAt != nil {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(user.Tag), tag) {
			return user, nil
		}
	}
	return model.User{}, ErrNotFound
}
func (r *InMemoryUserRepository) StoreRefreshToken(_ context.Context, tokenHash, userID string, expiresAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.refreshTokens[tokenHash] = refreshTokenRecord{userID: userID, expiresAt: expiresAt.UTC()}
	return nil
}

func (r *InMemoryUserRepository) RotateRefreshToken(_ context.Context, oldTokenHash, newTokenHash, userID string, expiresAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	record, ok := r.refreshTokens[oldTokenHash]
	if !ok || record.userID != userID || time.Now().UTC().After(record.expiresAt) {
		return ErrNotFound
	}
	delete(r.refreshTokens, oldTokenHash)
	r.refreshTokens[newTokenHash] = refreshTokenRecord{userID: userID, expiresAt: expiresAt.UTC()}
	return nil
}

func (r *InMemoryUserRepository) UpsertRegistrationVerification(_ context.Context, item model.RegistrationVerification) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	email := strings.ToLower(strings.TrimSpace(item.Email))
	if email == "" {
		return ErrNotFound
	}
	item.Email = email
	r.registrationVerifications[email] = item
	return nil
}

func (r *InMemoryUserRepository) FindRegistrationVerification(_ context.Context, email string) (model.RegistrationVerification, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	item, ok := r.registrationVerifications[strings.ToLower(strings.TrimSpace(email))]
	if !ok {
		return model.RegistrationVerification{}, ErrNotFound
	}
	return item, nil
}

func (r *InMemoryUserRepository) DeleteRegistrationVerification(_ context.Context, email string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	delete(r.registrationVerifications, strings.ToLower(strings.TrimSpace(email)))
	return nil
}

func (r *InMemoryUserRepository) UpsertPasswordResetVerification(_ context.Context, item model.PasswordResetVerification) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	email := strings.ToLower(strings.TrimSpace(item.Email))
	if email == "" {
		return ErrNotFound
	}
	item.Email = email
	r.passwordResetVerifications[email] = item
	return nil
}

func (r *InMemoryUserRepository) FindPasswordResetVerification(_ context.Context, email string) (model.PasswordResetVerification, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	item, ok := r.passwordResetVerifications[strings.ToLower(strings.TrimSpace(email))]
	if !ok {
		return model.PasswordResetVerification{}, ErrNotFound
	}
	return item, nil
}

func (r *InMemoryUserRepository) DeletePasswordResetVerification(_ context.Context, email string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	delete(r.passwordResetVerifications, strings.ToLower(strings.TrimSpace(email)))
	return nil
}

func (r *InMemoryUserRepository) ListTeamIDsByUserID(_ context.Context, userID string) ([]string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	teams, ok := r.userTeams[userID]
	if !ok || len(teams) == 0 {
		return []string{}, nil
	}
	result := make([]string, 0, len(teams))
	for teamID := range teams {
		result = append(result, teamID)
	}
	return result, nil
}

func (r *InMemoryUserRepository) CreateTeam(_ context.Context, team model.Team) (model.Team, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.teams[team.ID] = team
	return team, nil
}

func (r *InMemoryUserRepository) FindTeamByID(_ context.Context, teamID string) (model.Team, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	team, ok := r.teams[teamID]
	if !ok {
		return model.Team{}, ErrNotFound
	}
	return team, nil
}

func (r *InMemoryUserRepository) ListTeamsByUserID(_ context.Context, userID string) ([]model.Team, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	teamSet := r.userTeams[userID]
	if len(teamSet) == 0 {
		return []model.Team{}, nil
	}

	result := make([]model.Team, 0, len(teamSet))
	for teamID := range teamSet {
		if team, ok := r.teams[teamID]; ok {
			result = append(result, team)
		}
	}
	return result, nil
}

func (r *InMemoryUserRepository) DeleteTeam(_ context.Context, teamID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.teams[teamID]; !ok {
		return ErrNotFound
	}

	delete(r.teams, teamID)
	delete(r.teamRoles, teamID)
	delete(r.teamMembers, teamID)

	for inviteID, record := range r.teamInvites {
		if record.invite.TeamID == teamID {
			delete(r.teamInvites, inviteID)
		}
	}

	for userID, teams := range r.userTeams {
		delete(teams, teamID)
		if len(teams) == 0 {
			delete(r.userTeams, userID)
		}
	}

	for projectID, project := range r.projects {
		if project.TeamID != teamID {
			continue
		}
		delete(r.projects, projectID)
		delete(r.projectRoles, projectID)
		delete(r.projectMember, projectID)
	}

	return nil
}

func (r *InMemoryUserRepository) CreateTeamRole(_ context.Context, role model.TeamRole) (model.TeamRole, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.teams[role.TeamID]; !ok {
		return model.TeamRole{}, ErrNotFound
	}
	if _, ok := r.teamRoles[role.TeamID]; !ok {
		r.teamRoles[role.TeamID] = make(map[string]model.TeamRole)
	}
	r.teamRoles[role.TeamID][role.Key] = role
	return role, nil
}

func (r *InMemoryUserRepository) ListTeamRoles(_ context.Context, teamID string) ([]model.TeamRole, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rolesMap := r.teamRoles[teamID]
	result := make([]model.TeamRole, 0, len(rolesMap))
	for _, role := range rolesMap {
		result = append(result, role)
	}
	return result, nil
}

func (r *InMemoryUserRepository) FindTeamRole(_ context.Context, teamID, roleKey string) (model.TeamRole, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rolesMap := r.teamRoles[teamID]
	role, ok := rolesMap[roleKey]
	if !ok {
		return model.TeamRole{}, ErrNotFound
	}
	return role, nil
}

func (r *InMemoryUserRepository) UpsertTeamMember(_ context.Context, member model.TeamMember) (model.TeamMember, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.teams[member.TeamID]; !ok {
		return model.TeamMember{}, ErrNotFound
	}
	if _, ok := r.teamMembers[member.TeamID]; !ok {
		r.teamMembers[member.TeamID] = make(map[string]model.TeamMember)
	}
	r.teamMembers[member.TeamID][member.UserID] = member
	if _, ok := r.userTeams[member.UserID]; !ok {
		r.userTeams[member.UserID] = make(map[string]struct{})
	}
	r.userTeams[member.UserID][member.TeamID] = struct{}{}
	return member, nil
}

func (r *InMemoryUserRepository) FindTeamMember(_ context.Context, teamID, userID string) (model.TeamMember, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	members := r.teamMembers[teamID]
	member, ok := members[userID]
	if !ok {
		return model.TeamMember{}, ErrNotFound
	}
	return member, nil
}

func (r *InMemoryUserRepository) ListTeamMembers(_ context.Context, teamID string) ([]model.TeamMember, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	members := r.teamMembers[teamID]
	result := make([]model.TeamMember, 0, len(members))
	for _, member := range members {
		result = append(result, member)
	}
	return result, nil
}

func (r *InMemoryUserRepository) CreateTeamInvite(_ context.Context, invite model.TeamInvite, tokenHash string) (model.TeamInvite, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.teamInvites[invite.ID] = inviteRecord{invite: invite, tokenHash: tokenHash}
	return invite, nil
}

func (r *InMemoryUserRepository) FindPendingInviteByTokenHash(_ context.Context, tokenHash string) (model.TeamInvite, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, record := range r.teamInvites {
		if record.tokenHash == tokenHash && record.invite.Status == "pending" {
			return record.invite, nil
		}
	}
	return model.TeamInvite{}, ErrNotFound
}

func (r *InMemoryUserRepository) FindTeamInviteByID(_ context.Context, inviteID string) (model.TeamInvite, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	record, ok := r.teamInvites[strings.TrimSpace(inviteID)]
	if !ok {
		return model.TeamInvite{}, ErrNotFound
	}
	return record.invite, nil
}

func (r *InMemoryUserRepository) ListPendingInvitesByEmail(_ context.Context, email string) ([]model.TeamInvite, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	email = strings.ToLower(strings.TrimSpace(email))
	items := make([]model.TeamInvite, 0)
	for _, record := range r.teamInvites {
		invite := record.invite
		if invite.Status != "pending" {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(invite.Email), email) {
			continue
		}
		if team, ok := r.teams[invite.TeamID]; ok {
			invite.TeamName = team.Name
		}
		items = append(items, invite)
	}
	return items, nil
}

func (r *InMemoryUserRepository) MarkInviteAccepted(_ context.Context, inviteID, _ string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	record, ok := r.teamInvites[inviteID]
	if !ok {
		return ErrNotFound
	}
	record.invite.Status = "accepted"
	record.invite.UpdatedAt = time.Now().UTC()
	r.teamInvites[inviteID] = record
	return nil
}

func (r *InMemoryUserRepository) EnsureUserTeamMembership(_ context.Context, userID, teamID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.userTeams[userID]; !ok {
		r.userTeams[userID] = make(map[string]struct{})
	}
	r.userTeams[userID][teamID] = struct{}{}
	return nil
}

func (r *InMemoryUserRepository) CreateProject(_ context.Context, project model.Project) (model.Project, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.teams[project.TeamID]; !ok {
		return model.Project{}, ErrNotFound
	}
	r.projects[project.ID] = project
	return project, nil
}

func (r *InMemoryUserRepository) ListProjectsByTeamID(_ context.Context, teamID string) ([]model.Project, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]model.Project, 0)
	for _, item := range r.projects {
		if item.TeamID == teamID {
			result = append(result, item)
		}
	}
	return result, nil
}

func (r *InMemoryUserRepository) FindProjectByID(_ context.Context, projectID string) (model.Project, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.projects[projectID]
	if !ok {
		return model.Project{}, ErrNotFound
	}
	return item, nil
}

func (r *InMemoryUserRepository) DeleteProject(_ context.Context, projectID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.projects[projectID]; !ok {
		return ErrNotFound
	}
	delete(r.projects, projectID)
	delete(r.projectRoles, projectID)
	delete(r.projectMember, projectID)
	return nil
}

func (r *InMemoryUserRepository) CreateProjectRole(_ context.Context, role model.ProjectRole) (model.ProjectRole, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.projects[role.ProjectID]; !ok {
		return model.ProjectRole{}, ErrNotFound
	}
	if _, ok := r.projectRoles[role.ProjectID]; !ok {
		r.projectRoles[role.ProjectID] = make(map[string]model.ProjectRole)
	}
	r.projectRoles[role.ProjectID][role.Key] = role
	return role, nil
}

func (r *InMemoryUserRepository) ListProjectRoles(_ context.Context, projectID string) ([]model.ProjectRole, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	roles := r.projectRoles[projectID]
	result := make([]model.ProjectRole, 0, len(roles))
	for _, role := range roles {
		result = append(result, role)
	}
	return result, nil
}

func (r *InMemoryUserRepository) FindProjectRole(_ context.Context, projectID, roleKey string) (model.ProjectRole, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	role, ok := r.projectRoles[projectID][roleKey]
	if !ok {
		return model.ProjectRole{}, ErrNotFound
	}
	return role, nil
}

func (r *InMemoryUserRepository) UpsertProjectMember(_ context.Context, member model.ProjectMember) (model.ProjectMember, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.projects[member.ProjectID]; !ok {
		return model.ProjectMember{}, ErrNotFound
	}
	if _, ok := r.projectMember[member.ProjectID]; !ok {
		r.projectMember[member.ProjectID] = make(map[string]model.ProjectMember)
	}
	r.projectMember[member.ProjectID][member.UserID] = member
	return member, nil
}

func (r *InMemoryUserRepository) FindProjectMember(_ context.Context, projectID, userID string) (model.ProjectMember, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	member, ok := r.projectMember[projectID][userID]
	if !ok {
		return model.ProjectMember{}, ErrNotFound
	}
	return member, nil
}

func (r *InMemoryUserRepository) ListProjectMembers(_ context.Context, projectID string) ([]model.ProjectMember, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	members := r.projectMember[projectID]
	result := make([]model.ProjectMember, 0, len(members))
	for _, member := range members {
		result = append(result, member)
	}
	return result, nil
}
