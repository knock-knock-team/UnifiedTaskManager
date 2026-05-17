package repository

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"unified-task-manager/services/user-service/internal/model"
)

func TestPostgresRepositoryIntegrationCRUD(t *testing.T) {
	dbURL := os.Getenv("INTEGRATION_DB_URL")
	if dbURL == "" {
		t.Skip("INTEGRATION_DB_URL is not set")
	}

	ctx := context.Background()
	repo, err := NewPostgresUserRepository(ctx, dbURL)
	if err != nil {
		t.Fatalf("init postgres repo failed: %v", err)
	}
	if err := repo.EnsureSchema(ctx); err != nil {
		t.Fatalf("ensure schema failed: %v", err)
	}

	now := time.Now().UTC()
	uniqueSuffix := now.UnixNano()
	user := model.User{
		ID:           fmt.Sprintf("11111111-1111-4111-8111-%012d", uniqueSuffix%1_000_000_000_000),
		Email:        fmt.Sprintf("integration-user-%d@example.com", uniqueSuffix),
		PasswordHash: "hash",
		Name:         "Integration User",
		Role:         model.RoleUser,
		Status:       model.StatusActive,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	created, err := repo.Create(user)
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}
	if created.ID != user.ID {
		t.Fatalf("expected id %s got %s", user.ID, created.ID)
	}

	fetched, err := repo.FindByID(user.ID)
	if err != nil {
		t.Fatalf("find by id failed: %v", err)
	}
	if fetched.Email != user.Email {
		t.Fatalf("expected email %s got %s", user.Email, fetched.Email)
	}

	t.Cleanup(func() {
		_ = repo.Delete(user.ID)
	})

	fetched.Name = "Updated Name"
	fetched.UpdatedAt = time.Now().UTC()
	updated, err := repo.Update(fetched)
	if err != nil {
		t.Fatalf("update failed: %v", err)
	}
	if updated.Name != "Updated Name" {
		t.Fatalf("expected updated name, got %s", updated.Name)
	}

	items, total, err := repo.List(50, 0, "integration-user")
	if err != nil {
		t.Fatalf("list failed: %v", err)
	}
	if total < 1 || len(items) < 1 {
		t.Fatalf("expected list to include user, total=%d len=%d", total, len(items))
	}

	if err := repo.Delete(user.ID); err != nil {
		t.Fatalf("delete failed: %v", err)
	}
	if _, err := repo.FindByID(user.ID); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}
