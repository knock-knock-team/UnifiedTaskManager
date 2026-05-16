package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var ErrInvalidToken = errors.New("invalid token")

type Claims struct {
	ID        string   `json:"jti"`
	Subject   string   `json:"sub"`
	TokenType string   `json:"typ"`
	Role      string   `json:"role"`
	TeamID    string   `json:"teamId,omitempty"`
	TeamIDs   []string `json:"teamIds,omitempty"`
	IssuedAt  int64    `json:"iat"`
	ExpiresAt int64    `json:"exp"`
}

type TokenManager struct {
	secret []byte
}

func NewTokenManager(secret string) *TokenManager {
	return &TokenManager{secret: []byte(secret)}
}

func (tm *TokenManager) Parse(tokenString, expectedType string) (*Claims, error) {
	parts := strings.Split(tokenString, ".")
	if len(parts) != 3 {
		return nil, ErrInvalidToken
	}

	signingInput := parts[0] + "." + parts[1]
	expectedSig := tm.signRaw(signingInput)
	if !hmac.Equal([]byte(parts[2]), []byte(expectedSig)) {
		return nil, ErrInvalidToken
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, ErrInvalidToken
	}

	claims := &Claims{}
	if err := json.Unmarshal(payloadBytes, claims); err != nil {
		return nil, ErrInvalidToken
	}
	if claims.TokenType != expectedType || claims.Subject == "" || claims.ExpiresAt <= time.Now().Unix() {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

func (tm *TokenManager) signRaw(data string) string {
	mac := hmac.New(sha256.New, tm.secret)
	mac.Write([]byte(data))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
