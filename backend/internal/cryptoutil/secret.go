// Package cryptoutil provides at-rest encryption for plugin secrets (OAuth
// client secrets, refresh/access tokens) stored in the SQLite cache. It is
// deliberately stdlib-only (AES-256-GCM) — these values must be decryptable
// later (unlike passwords/API keys, which are one-way hashed), so a proper
// reversible cipher is needed rather than bcrypt/sha256.
package cryptoutil

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const keyFileName = "plugin.key"
const keySize = 32 // AES-256

// LoadOrCreateKey reads the encryption key from <rootPath>/.blockforge/plugin.key,
// generating and persisting a new random one on first use. The key file is
// written with 0600 permissions and lives alongside cache.db, so it's covered
// by the same backup/volume as the rest of the workspace's local state.
func LoadOrCreateKey(rootPath string) ([keySize]byte, error) {
	var key [keySize]byte

	dir := filepath.Join(rootPath, ".blockforge")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return key, fmt.Errorf("failed to create .blockforge dir: %w", err)
	}
	path := filepath.Join(dir, keyFileName)

	if data, err := os.ReadFile(path); err == nil {
		decoded, err := hex.DecodeString(string(data))
		if err != nil || len(decoded) != keySize {
			return key, fmt.Errorf("plugin.key is corrupt (expected %d hex-encoded bytes)", keySize)
		}
		copy(key[:], decoded)
		return key, nil
	} else if !os.IsNotExist(err) {
		return key, fmt.Errorf("failed to read plugin.key: %w", err)
	}

	if _, err := rand.Read(key[:]); err != nil {
		return key, fmt.Errorf("failed to generate encryption key: %w", err)
	}
	if err := os.WriteFile(path, []byte(hex.EncodeToString(key[:])), 0600); err != nil {
		return key, fmt.Errorf("failed to persist plugin.key: %w", err)
	}
	return key, nil
}

// Encrypt seals plaintext with AES-256-GCM, prepending the random nonce to
// the returned ciphertext.
func Encrypt(key [keySize]byte, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt reverses Encrypt, reading the nonce back off the front of ciphertext.
func Decrypt(key [keySize]byte, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}
	nonce, sealed := ciphertext[:nonceSize], ciphertext[nonceSize:]
	return gcm.Open(nil, nonce, sealed, nil)
}
