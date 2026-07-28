package googlecalendar

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// stateTTL bounds how long an in-flight OAuth consent flow can take before
// the signed state token is rejected as expired (replay/staleness guard).
const stateTTL = 10 * time.Minute

// SignState produces a compact, tamper-evident token binding an OAuth
// consent flow to the BlockForgeMD user who started it. The callback route
// Google redirects to can't sit behind the normal session-cookie middleware
// (it's the bare browser hitting it, not an authenticated fetch), so this is
// what proves which user is completing the flow.
func SignState(userID string, key [32]byte) string {
	payload := fmt.Sprintf("%s|%d", userID, time.Now().Add(stateTTL).Unix())
	encodedPayload := base64.RawURLEncoding.EncodeToString([]byte(payload))
	sig := signPayload(encodedPayload, key)
	return encodedPayload + "." + sig
}

// VerifyState checks the signature and expiry and returns the bound user ID.
func VerifyState(state string, key [32]byte) (string, error) {
	parts := strings.SplitN(state, ".", 2)
	if len(parts) != 2 {
		return "", errors.New("malformed oauth state")
	}
	encodedPayload, sig := parts[0], parts[1]
	if !hmac.Equal([]byte(sig), []byte(signPayload(encodedPayload, key))) {
		return "", errors.New("invalid oauth state signature")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(encodedPayload)
	if err != nil {
		return "", errors.New("invalid oauth state encoding")
	}
	idx := strings.LastIndex(string(payloadBytes), "|")
	if idx < 0 {
		return "", errors.New("malformed oauth state payload")
	}
	userID := string(payloadBytes[:idx])
	expiryUnix, err := strconv.ParseInt(string(payloadBytes[idx+1:]), 10, 64)
	if err != nil {
		return "", errors.New("malformed oauth state expiry")
	}
	if time.Now().Unix() > expiryUnix {
		return "", errors.New("oauth state expired, please try connecting again")
	}
	return userID, nil
}

func signPayload(encodedPayload string, key [32]byte) string {
	mac := hmac.New(sha256.New, key[:])
	mac.Write([]byte(encodedPayload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
