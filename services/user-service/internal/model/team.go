package model

import "time"

type Team struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type TeamRole struct {
	TeamID      string    `json:"teamId"`
	Key         string    `json:"key"`
	Name        string    `json:"name"`
	Permissions []string  `json:"permissions"`
	System      bool      `json:"system"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type TeamMember struct {
	TeamID    string    `json:"teamId"`
	UserID    string    `json:"userId"`
	RoleKey   string    `json:"roleKey"`
	InvitedBy string    `json:"invitedBy,omitempty"`
	JoinedAt  time.Time `json:"joinedAt"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type TeamInvite struct {
	ID        string    `json:"id"`
	TeamID    string    `json:"teamId"`
	TeamName  string    `json:"teamName,omitempty"`
	Email     string    `json:"email"`
	RoleKey   string    `json:"roleKey"`
	Status    string    `json:"status"`
	InvitedBy string    `json:"invitedBy"`
	ExpiresAt time.Time `json:"expiresAt"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Project struct {
	ID        string    `json:"id"`
	TeamID    string    `json:"teamId"`
	Name      string    `json:"name"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ProjectRole struct {
	ProjectID          string    `json:"projectId"`
	Key                string    `json:"key"`
	Name               string    `json:"name"`
	Permissions        []string  `json:"permissions"`
	InheritTeamRoleKey string    `json:"inheritTeamRoleKey,omitempty"`
	System             bool      `json:"system"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type ProjectMember struct {
	ProjectID string    `json:"projectId"`
	UserID    string    `json:"userId"`
	RoleKey   string    `json:"roleKey,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type PermissionCheckResult struct {
	Allowed     bool     `json:"allowed"`
	Source      string   `json:"source,omitempty"`
	TeamRoleKey string   `json:"teamRoleKey,omitempty"`
	ProjectRole string   `json:"projectRoleKey,omitempty"`
	Matched     []string `json:"matched,omitempty"`
}
