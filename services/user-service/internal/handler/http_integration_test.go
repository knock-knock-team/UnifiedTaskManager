package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"unified-task-manager/services/user-service/internal/model"
	"unified-task-manager/services/user-service/internal/repository"
	"unified-task-manager/services/user-service/internal/service"
)

type captureEmailSender struct {
	code string
}

func (s *captureEmailSender) SendRegistrationCode(_, _, code string) error {
	s.code = code
	return nil
}

func (s *captureEmailSender) SendPasswordResetCode(_, _, code string) error {
	s.code = code
	return nil
}

func newIntegrationServer(t *testing.T) (*httptest.Server, *repository.InMemoryUserRepository, service.UserService, *captureEmailSender) {
	t.Helper()
	repo := repository.NewInMemoryUserRepository()
	tokens := service.NewTokenManager("integration-secret", 15*time.Minute, 24*time.Hour)
	emailSender := &captureEmailSender{}
	svc := service.NewUserServiceWithEmailSender(repo, tokens, emailSender)

	if _, err := svc.BootstrapAdmin("admin@local.dev", "admin12345", "Admin"); err != nil {
		t.Fatalf("bootstrap admin failed: %v", err)
	}

	h := NewHTTPHandler(svc)
	return httptest.NewServer(h.Routes()), repo, svc, emailSender
}

func TestIntegrationAuthRBACAndCRUD(t *testing.T) {
	ts, _, _, emailSender := newIntegrationServer(t)
	defer ts.Close()

	postJSON(t, ts.URL+"/v1/auth/register/start", map[string]interface{}{
		"email": "user1@example.com",
	}, http.StatusAccepted)
	if emailSender.code == "" {
		t.Fatal("expected registration code to be sent")
	}
	postJSON(t, ts.URL+"/v1/auth/register/verify", map[string]interface{}{
		"email": "user1@example.com",
		"code":  emailSender.code,
	}, http.StatusOK)
	registered := postJSON(t, ts.URL+"/v1/auth/register/complete", map[string]interface{}{
		"email":    "user1@example.com",
		"code":     emailSender.code,
		"password": "password123",
		"name":     "User One",
	}, http.StatusCreated)
	userID := registered["user"].(map[string]interface{})["id"].(string)

	userLogin := postJSON(t, ts.URL+"/v1/auth/login", map[string]interface{}{
		"email":    "user1@example.com",
		"password": "password123",
	}, http.StatusOK)
	userToken := userLogin["tokens"].(map[string]interface{})["accessToken"].(string)

	getWithBearer(t, ts.URL+"/v1/users", userToken, http.StatusForbidden)
	getWithBearer(t, ts.URL+"/v1/users/me", userToken, http.StatusOK)

	adminLogin := postJSON(t, ts.URL+"/v1/auth/login", map[string]interface{}{
		"email":    "admin@local.dev",
		"password": "admin12345",
	}, http.StatusOK)
	adminToken := adminLogin["tokens"].(map[string]interface{})["accessToken"].(string)

	listBody := getWithBearer(t, ts.URL+"/v1/users?limit=20&offset=0", adminToken, http.StatusOK)
	items := listBody["items"].([]interface{})
	if len(items) < 2 {
		t.Fatalf("expected at least 2 users, got %d", len(items))
	}

	patchWithBearer(t, ts.URL+"/v1/users/"+userID, adminToken, map[string]interface{}{
		"role":   string(model.RoleManager),
		"status": string(model.StatusInactive),
	}, http.StatusOK)

	deleteWithBearer(t, ts.URL+"/v1/users/"+userID, adminToken, http.StatusNoContent)
	getWithBearer(t, ts.URL+"/v1/users/"+userID, adminToken, http.StatusNotFound)
}

func TestIntegrationAdminRoleIsRevalidatedFromDatabase(t *testing.T) {
	ts, repo, _, _ := newIntegrationServer(t)
	defer ts.Close()

	adminLogin := postJSON(t, ts.URL+"/v1/auth/login", map[string]interface{}{
		"email":    "admin@local.dev",
		"password": "admin12345",
	}, http.StatusOK)
	adminToken := adminLogin["tokens"].(map[string]interface{})["accessToken"].(string)

	adminUser, err := repo.FindByEmail("admin@local.dev")
	if err != nil {
		t.Fatalf("find admin failed: %v", err)
	}
	adminUser.Role = model.RoleUser
	adminUser.UpdatedAt = time.Now().UTC()
	if _, err := repo.Update(adminUser); err != nil {
		t.Fatalf("downgrade admin failed: %v", err)
	}

	getWithBearer(t, ts.URL+"/v1/users?limit=20&offset=0", adminToken, http.StatusForbidden)
}

func TestRegistrationStartDoesNotRevealExistingEmail(t *testing.T) {
	ts, _, _, emailSender := newIntegrationServer(t)
	defer ts.Close()

	emailSender.code = ""
	postJSON(t, ts.URL+"/v1/auth/register/start", map[string]interface{}{
		"email": "admin@local.dev",
	}, http.StatusAccepted)
	if emailSender.code != "" {
		t.Fatal("expected no registration code to be sent for existing email")
	}
}

func postJSON(t *testing.T, url string, payload interface{}, expectedStatus int) map[string]interface{} {
	t.Helper()
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	resp, err := http.Post(url, "application/json", bytes.NewReader(data))
	if err != nil {
		t.Fatalf("post request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expectedStatus {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected status %d, got %d body=%s", expectedStatus, resp.StatusCode, string(body))
	}
	return decodeBody(t, resp.Body)
}

func getWithBearer(t *testing.T, url, token string, expectedStatus int) map[string]interface{} {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("create request failed: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("get request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expectedStatus {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected status %d, got %d body=%s", expectedStatus, resp.StatusCode, string(body))
	}
	if expectedStatus == http.StatusNoContent {
		return map[string]interface{}{}
	}
	return decodeBody(t, resp.Body)
}

func patchWithBearer(t *testing.T, url, token string, payload interface{}, expectedStatus int) map[string]interface{} {
	t.Helper()
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	req, err := http.NewRequest(http.MethodPatch, url, bytes.NewReader(data))
	if err != nil {
		t.Fatalf("create request failed: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("patch request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expectedStatus {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected status %d, got %d body=%s", expectedStatus, resp.StatusCode, string(body))
	}
	return decodeBody(t, resp.Body)
}

func deleteWithBearer(t *testing.T, url, token string, expectedStatus int) {
	t.Helper()
	req, err := http.NewRequest(http.MethodDelete, url, nil)
	if err != nil {
		t.Fatalf("create request failed: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("delete request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expectedStatus {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected status %d, got %d body=%s", expectedStatus, resp.StatusCode, string(body))
	}
}

func decodeBody(t *testing.T, body io.Reader) map[string]interface{} {
	t.Helper()
	payload := map[string]interface{}{}
	if err := json.NewDecoder(body).Decode(&payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	return payload
}
