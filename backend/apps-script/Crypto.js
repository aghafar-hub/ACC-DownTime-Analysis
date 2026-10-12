/** Hashing, constant-time compare, password hash and session token. */

function bytesToHex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    var h = (bytes[i] & 0xff).toString(16);
    s += h.length === 1 ? '0' + h : h;
  }
  return s;
}

function sha256Hex_(text) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

function hmacSha256Hex_(message, key) {
  return bytesToHex_(Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, message, key));
}

function base64url_(text) {
  return Utilities.base64EncodeWebSafe(text, Utilities.Charset.UTF_8).replace(/=+$/, '');
}

function base64urlDecode_(b64) {
  var s = String(b64);
  while (s.length % 4) s += '=';
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString();
}

/** Compare two strings without stopping at the first difference. */
function constantTimeEquals_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// ---------- passwords ----------

function getHashRounds_() {
  var n = Number(getProp_(PROP.ROUNDS));
  if (n >= 1 && n <= HASH_ROUNDS_MAX) return Math.trunc(n);
  return HASH_ROUNDS_DEFAULT;
}

/** Iterated HMAC-SHA256 keyed with the server pepper; salt is per user. */
function hashPassword_(password, salt, rounds) {
  var pepper = getSecret_(PROP.PEPPER);
  var h = hmacSha256Hex_(salt + ':' + password, pepper);
  for (var i = 1; i < rounds; i++) h = hmacSha256Hex_(h + salt, pepper);
  return h;
}

function newSalt_() { return Utilities.getUuid(); }

function verifyPassword_(user, password) {
  return constantTimeEquals_(hashPassword_(password, user.password_salt, user.hash_rounds), user.password_hash);
}

/** New credentials fields for a password: fresh salt, current rounds. */
function newCredentials_(password) {
  var salt = newSalt_();
  var rounds = getHashRounds_();
  return { password_salt: salt, hash_rounds: rounds, password_hash: hashPassword_(password, salt, rounds) };
}

// ---------- session token ----------

function signToken_(payload) {
  var body = base64url_(JSON.stringify(payload));
  return body + '.' + hmacSha256Hex_(body, getSecret_(PROP.SECRET));
}

/** Returns the payload of a genuine, unexpired token, otherwise null. */
function verifyToken_(token) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  var parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!constantTimeEquals_(hmacSha256Hex_(parts[0], getSecret_(PROP.SECRET)), parts[1])) return null;
  var payload;
  try { payload = JSON.parse(base64urlDecode_(parts[0])); } catch (e) { return null; }
  if (!payload || typeof payload.uid !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp <= nowMs_()) return null;
  return payload;
}

// ---------- temporary passwords ----------

var TEMP_ALPHABET_LOWER = 'abcdefghjkmnpqrstuvwxyz';
var TEMP_ALPHABET_UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
var TEMP_ALPHABET_DIGIT = '23456789';

/** Random temporary password (no look-alike characters), unbiased, from UUID randomness. */
function generateTempPassword_() {
  var alphabet = TEMP_ALPHABET_LOWER + TEMP_ALPHABET_UPPER + TEMP_ALPHABET_DIGIT;
  var limit = 256 - (256 % alphabet.length);
  for (;;) {
    var out = '';
    var hex = '';
    while (out.length < TEMP_PASSWORD_LENGTH) {
      if (hex.length < 2) hex = randomHex_(64);
      var b = parseInt(hex.slice(0, 2), 16);
      hex = hex.slice(2);
      if (b < limit) out += alphabet.charAt(b % alphabet.length);
    }
    if (/[a-z]/.test(out) && /[A-Z]/.test(out) && /[0-9]/.test(out)) return out;
  }
}
