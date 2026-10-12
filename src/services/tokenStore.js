const { query } = require('../db');
const { encryptJson, decryptJson } = require('../utils/cryptoBox');

async function getToken(channel) {
  const result = await query(
    'SELECT token_ciphertext, expires_at FROM oauth_tokens WHERE channel = $1',
    [channel]
  );

  if (!result.rowCount) return null;
  const token = decryptJson(result.rows[0].token_ciphertext);
  token.expires_at = result.rows[0].expires_at;
  return token;
}

async function setToken(channel, token) {
  const expiresAt = token.expires_at || token.expiresAt || (
    token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000) : null
  );
  const payload = { ...token };
  if (expiresAt) payload.expires_at = new Date(expiresAt).toISOString();

  await query(
    `INSERT INTO oauth_tokens (channel, token_ciphertext, expires_at, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (channel) DO UPDATE SET
       token_ciphertext = EXCLUDED.token_ciphertext,
       expires_at = EXCLUDED.expires_at,
       updated_at = now()`,
    [channel, encryptJson(payload), expiresAt]
  );
}

async function clearToken(channel) {
  await query('DELETE FROM oauth_tokens WHERE channel = $1', [channel]);
}

module.exports = { getToken, setToken, clearToken };
