package repository

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"UnifiedTaskManager/services/user-service/internal/model"
)

var (
	ErrNotFound      = errors.New("user not found")
	ErrEmailConflict = errors.New("email already exists")
)

type UserRepository interface {
	Create(user model.User) (model.User, error)
	FindByID(id string) (model.User, error)
	FindByEmail(email string) (model.User, error)
	Update(user model.User) (model.User, error)
	List(limit, offset int, search string) ([]model.User, int, error)
	Delete(id string) error
	Ping(ctx context.Context) error
}

type RefreshTokenStore interface {
	StoreRefreshToken(ctx context.Context, tokenHash, userID string, expiresAt time.Time) error
	RotateRefreshToken(ctx context.Context, oldTokenHash, newTokenHash, userID string, expiresAt time.Time) error
}

type UserStore interface {
	UserRepository
	RefreshTokenStore
}

type refreshTokenRecord struct {
	userID    string
	expiresAt time.Time
}

type InMemoryUserRepository struct {
	mu            sync.RWMutex
	byID          map[string]model.User
	emailTo       map[string]string
	refreshTokens map[string]refreshTokenRecord
}

func NewInMemoryUserRepository() *InMemoryUserRepository {
	return &InMemoryUserRepository{
		byID:          make(map[string]model.User),
		emailTo:       make(map[string]string),
		refreshTokens: make(map[string]refreshTokenRecord),
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
			if !strings.Contains(strings.ToLower(user.Name), search) && !strings.Contains(strings.ToLower(user.Email), search) {
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
