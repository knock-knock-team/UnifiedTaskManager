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

	"UnifiedTaskManager/services/user-service/internal/model"
	"UnifiedTaskManager/services/user-service/internal/repository"
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
	access, refresh, expiresIn, err := s.tokens.NewTokenPair(user.ID, string(user.Role))
	if err != nil {
		return model.TokenPair{}, err
	}
	newRefreshHash := hashToken(refresh)
	if err := s.repo.RotateRefreshToken(context.Background(), refreshHash, newRefreshHash, user.ID, time.Now().UTC().Add(s.tokens.RefreshTokenTTL())); err != nil {
		return model.TokenPair{}, ErrUnauthorized
	}
	return model.TokenPair{AccessToken: access, RefreshToken: refresh, ExpiresIn: expiresIn}, nil
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
	access, refresh, expiresIn, err := s.tokens.NewTokenPair(user.ID, string(user.Role))
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
