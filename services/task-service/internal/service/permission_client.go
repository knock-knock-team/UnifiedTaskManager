package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type PermissionClient struct {
	baseURL string
	client  *http.Client
}

func NewPermissionClient(baseURL string, timeout time.Duration) *PermissionClient {
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	return &PermissionClient{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		client:  &http.Client{Timeout: timeout},
	}
}

func (c *PermissionClient) CheckProjectPermission(ctx context.Context, accessToken, teamID, projectID, permission string) (bool, error) {
	if c == nil || c.baseURL == "" {
		return false, errors.New("permission client is not configured")
	}
	if strings.TrimSpace(accessToken) == "" {
		return false, errors.New("missing access token")
	}
	payload := map[string]string{
		"teamId":     strings.TrimSpace(teamID),
		"projectId":  strings.TrimSpace(projectID),
		"permission": strings.TrimSpace(permission),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return false, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/permissions/check", bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusInternalServerError {
		return false, fmt.Errorf("permission service failed with status %d", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return false, nil
	}

	var parsed struct {
		Allowed bool `json:"allowed"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return false, err
	}
	return parsed.Allowed, nil
}
