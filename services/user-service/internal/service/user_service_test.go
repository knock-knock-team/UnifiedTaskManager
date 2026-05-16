package service

import (
	"errors"
	"testing"
	"time"

	"UnifiedTaskManager/services/user-service/internal/model"
	"UnifiedTaskManager/services/user-service/internal/repository"
)

func newTestService() UserService {
	repo := repository.NewInMemoryUserRepository()
	tokens := NewTokenManager("test-secret", 15*time.Minute, 24*time.Hour)
	return NewUserService(repo, tokens)
}

func TestRegisterAndLogin(t *testing.T) {
	svc := newTestService()

	registered, err := svc.Register("user@example.com", "password123", "User")
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}
	if registered.User.Role != model.RoleUser {
		t.Fatalf("expected role user, got %s", registered.User.Role)
	}
	if registered.User.PasswordHash != "" {
		t.Fatal("password hash should not be exposed")
	}

	loggedIn, err := svc.Login("user@example.com", "password123")
	if err != nil {
		t.Fatalf("login failed: %v", err)
	}
	if loggedIn.Tokens.AccessToken == "" {
		t.Fatal("expected access token")
	}
}

func TestRefreshTokenRotation(t *testing.T) {
	svc := newTestService()

	registered, err := svc.Register("refresh@example.com", "password123", "Refresh User")
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}

	refreshed, err := svc.Refresh(registered.Tokens.RefreshToken)
	if err != nil {
		t.Fatalf("refresh failed: %v", err)
	}
	if refreshed.AccessToken == "" || refreshed.RefreshToken == "" {
		t.Fatal("expected rotated token pair")
	}

	if _, err := svc.Refresh(registered.Tokens.RefreshToken); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expected old refresh token to be rejected, got %v", err)
	}

	if _, err := svc.Refresh(refreshed.RefreshToken); err != nil {
		t.Fatalf("second refresh with rotated token failed: %v", err)
	}
}

func TestBootstrapAdminCreatesAndPromotes(t *testing.T) {
	svc := newTestService()

	_, err := svc.Register("promote@example.com", "password123", "Regular User")
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}

	admin, err := svc.BootstrapAdmin("promote@example.com", "newpassword123", "Root")
	if err != nil {
		t.Fatalf("bootstrap admin failed: %v", err)
	}
	if admin.Role != model.RoleAdmin {
		t.Fatalf("expected admin role, got %s", admin.Role)
	}

	_, err = svc.Login("promote@example.com", "newpassword123")
	if err != nil {
		t.Fatalf("login with bootstrapped admin password failed: %v", err)
	}
}

func TestRBACForNonAdmin(t *testing.T) {
	svc := newTestService()

	user, err := svc.Register("rbac@example.com", "password123", "User")
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}

	_, _, err = svc.ListUsers(string(model.RoleUser), 20, 0, "")
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected forbidden for list users, got %v", err)
	}

	err = svc.DeleteUserByID(string(model.RoleUser), user.User.ID)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected forbidden for delete user, got %v", err)
	}
}
