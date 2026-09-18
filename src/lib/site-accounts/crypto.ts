import {
  randomBytes,
  scrypt as scryptCb,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";

/**
 * [P11-1] 사용자(방문자) 계정의 두 가지 비밀 — 성격이 달라 함수를 나눈다.
 *
 * - 비밀번호: **해시**한다. 되돌릴 필요가 없다(로그인 때 "같은 값인지"만 확인).
 * - Anthropic API 키: **암호화**한다. 되돌려야 한다 — AI를 부를 때 원래 키가
 *   다시 필요하기 때문이다([P11-4], 사용자 본인 명의로 과금).
 */

const scrypt = promisify(scryptCb);

const SALT_BYTES = 16;
const KEY_LENGTH = 64;

/** `salt:hash` 형태의 문자열 하나로 저장한다 — 표에 칼럼을 늘리지 않는다. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;

  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  // 길이가 다르면 timingSafeEqual이 던진다 — 길이 자체도 비교 전에 맞춰본다.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

const IV_BYTES = 12; // AES-GCM 표준 IV 길이

/** 짧을 수 있는 비밀값을 그대로 AES 키로 쓰지 않고 scrypt로 32바이트로 늘린다. */
function encryptionKey(): Buffer {
  const secret = process.env.SITE_API_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "SITE_API_KEY_ENCRYPTION_SECRET이 설정되지 않았습니다. 사용자 API 키를 암호화할 수 없습니다.",
    );
  }
  return scryptSync(secret, "site-api-key-encryption", 32);
}

/** `iv:authTag:cipherText`(전부 hex) 하나의 문자열로 저장한다. */
export function encryptApiKey(plainKey: string): string {
  const key = encryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainKey, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptApiKey(stored: string): string {
  const [ivHex, authTagHex, cipherHex] = stored.split(":");
  if (!ivHex || !authTagHex || !cipherHex) {
    throw new Error("저장된 API 키 형식이 올바르지 않습니다.");
  }

  const key = encryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
