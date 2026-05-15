package model

import "time"

type Role string

type Status string

const (
	RoleUser    Role = "user"
	RoleManager Role = "manager"
	RoleAdmin   Role = "admin"
)

const (
	StatusActive    Status = "active"
	StatusInactive  Status = "inactive"
	StatusSuspended Status = "suspended"
)

type User struct {
	ID             string     `json:"id"`
	Email          string     `json:"email"`
	PasswordHash   string     `json:"-"`
	Name           string     `json:"name"`
	Bio            string     `json:"bio,omitempty"`
	GitHubURL      string     `json:"githubUrl,omitempty"`
	LinkedInURL    string     `json:"linkedInUrl,omitempty"`
	Telegram       string     `json:"telegram,omitempty"`
	WebsiteURL     string     `json:"websiteUrl,omitempty"`
	SecondaryEmail string     `json:"secondaryEmail,omitempty"`
	Role           Role       `json:"role"`
	Status         Status     `json:"status"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	DeletedAt      *time.Time `json:"-"`
}

type TokenPair struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int64  `json:"expiresIn"`
}

type AuthResponse struct {
	User   User      `json:"user"`
	Tokens TokenPair `json:"tokens"`
}
