package service

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrInvalidToken = errors.New("invalid token")

type Claims struct {
	ID        string   `json:"jti"`
	Subject   string   `json:"sub"`
	TokenType string   `json:"typ"`
	Role      string   `json:"role"`
	TeamIDs   []string `json:"teamIds,omitempty"`
	IssuedAt  int64    `json:"iat"`
	ExpiresAt int64    `json:"exp"`
}

type TokenManager struct {
	secret          []byte
	accessTokenTTL  time.Duration
	refreshTokenTTL time.Duration
}

func NewTokenManager(secret string, accessTokenTTL, refreshTokenTTL time.Duration) *TokenManager {
	return &TokenManager{
		secret:          []byte(secret),
		accessTokenTTL:  accessTokenTTL,
		refreshTokenTTL: refreshTokenTTL,
	}
}

func (tm *TokenManager) AccessTokenTTL() time.Duration {
	return tm.accessTokenTTL
}

func (tm *TokenManager) RefreshTokenTTL() time.Duration {
	return tm.refreshTokenTTL
}

func (tm *TokenManager) NewTokenPair(userID, role string, teamIDs []string) (accessToken string, refreshToken string, expiresIn int64, err error) {
	now := time.Now().UTC()
	normalizedTeamIDs := normalizeTeamIDs(teamIDs)

	accessClaims := Claims{
		ID:        newTokenID(),
		Subject:   userID,
		TokenType: "access",
		Role:      role,
		TeamIDs:   normalizedTeamIDs,
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(tm.accessTokenTTL).Unix(),
	}
	refreshClaims := Claims{
		ID:        newTokenID(),
		Subject:   userID,
		TokenType: "refresh",
		Role:      role,
		TeamIDs:   normalizedTeamIDs,
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(tm.refreshTokenTTL).Unix(),
	}

	accessToken, err = tm.sign(accessClaims)
	if err != nil {
		return "", "", 0, err
	}
	refreshToken, err = tm.sign(refreshClaims)
	if err != nil {
		return "", "", 0, err
	}
	return accessToken, refreshToken, int64(tm.accessTokenTTL.Seconds()), nil
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

func (tm *TokenManager) sign(claims Claims) (string, error) {
	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	headerBytes, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}

	encodedHeader := base64.RawURLEncoding.EncodeToString(headerBytes)
	encodedPayload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	signingInput := encodedHeader + "." + encodedPayload
	signature := tm.signRaw(signingInput)

	return fmt.Sprintf("%s.%s", signingInput, signature), nil
}

func (tm *TokenManager) signRaw(data string) string {
	mac := hmac.New(sha256.New, tm.secret)
	mac.Write([]byte(data))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func newTokenID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("tok-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

func normalizeTeamIDs(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, raw := range values {
		v := strings.TrimSpace(raw)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		result = append(result, v)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}
