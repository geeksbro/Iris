import { isValidPinFormat, type PinCredentials } from "@/domain/pin";

import { wealthDb } from "./db";

const pinCredentialsKey = "pin-credentials";
const pbkdf2Iterations = 100_000;
const derivedBitsLength = 256;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function derivePinHash(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    derivedBitsLength,
  );
  return toBase64(new Uint8Array(bits));
}

function constantTimeEquals(first: string, second: string): boolean {
  if (first.length !== second.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < first.length; index += 1) {
    mismatch |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return mismatch === 0;
}

function isPinCredentials(value: unknown): value is PinCredentials {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.algorithm === "PBKDF2-SHA256" &&
    typeof candidate.iterations === "number" &&
    Number.isInteger(candidate.iterations) &&
    candidate.iterations > 0 &&
    typeof candidate.salt === "string" &&
    candidate.salt.length > 0 &&
    typeof candidate.hash === "string" &&
    candidate.hash.length > 0 &&
    typeof candidate.createdAt === "string" &&
    (candidate.length === undefined || (Number.isInteger(candidate.length) && (candidate.length as number) >= 4 && (candidate.length as number) <= 8))
  );
}

export async function getPinCredentials(): Promise<PinCredentials | null> {
  const record = await wealthDb.metadata.get(pinCredentialsKey);
  if (!record || !isPinCredentials(record.value)) {
    return null;
  }
  return record.value;
}

/** When the PIN in force was set, and nothing else about it: no hash, no salt. */
export async function getPinSetAt(): Promise<string | null> {
  return (await getPinCredentials())?.createdAt ?? null;
}

/**
 * How many digits the PIN in force has, when known: the lock screen sends
 * the PIN by itself once that many are typed. Null for a PIN set before the
 * length was kept, until its next correct entry (verifyPin learns it).
 */
export async function getPinLength(): Promise<number | null> {
  return (await getPinCredentials())?.length ?? null;
}

export async function setupPin(pin: string): Promise<void> {
  if (!isValidPinFormat(pin)) {
    throw new Error("PIN must be 4 to 8 digits");
  }
  if (await getPinCredentials()) {
    throw new Error("A PIN is already configured on this device");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePinHash(pin, salt, pbkdf2Iterations);
  await wealthDb.metadata.put({
    key: pinCredentialsKey,
    value: {
      algorithm: "PBKDF2-SHA256",
      iterations: pbkdf2Iterations,
      salt: toBase64(salt),
      hash,
      createdAt: new Date().toISOString(),
      length: pin.length,
    },
  });
}

/**
 * Replaces the PIN, only for someone who knows the current one. The new PIN
 * gets a fresh salt and the current derivation; the old credentials are
 * overwritten in one write, never removed first, so a failure at any point
 * leaves the current PIN in force. Resolves false, changing nothing, when the
 * current PIN is wrong.
 */
export async function changePin(currentPin: string, nextPin: string): Promise<boolean> {
  if (!isValidPinFormat(nextPin)) {
    throw new Error("PIN must be 4 to 8 digits");
  }
  if (!(await verifyPin(currentPin))) {
    return false;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePinHash(nextPin, salt, pbkdf2Iterations);
  await wealthDb.metadata.put({
    key: pinCredentialsKey,
    value: {
      algorithm: "PBKDF2-SHA256",
      iterations: pbkdf2Iterations,
      salt: toBase64(salt),
      hash,
      createdAt: new Date().toISOString(),
      length: nextPin.length,
    },
  });
  return true;
}

export async function verifyPin(pin: string): Promise<boolean> {
  const credentials = await getPinCredentials();
  if (!credentials || !isValidPinFormat(pin)) {
    return false;
  }
  let matches: boolean;
  try {
    const candidate = await derivePinHash(pin, fromBase64(credentials.salt), credentials.iterations);
    matches = constantTimeEquals(candidate, credentials.hash);
  } catch {
    return false;
  }
  // A PIN set before its length was kept learns it here, from a correct
  // entry only. Best effort: failing to write it never fails the unlock.
  if (matches && credentials.length === undefined) {
    try {
      await wealthDb.metadata.put({ key: pinCredentialsKey, value: { ...credentials, length: pin.length } });
    } catch {
      // The lock screen keeps waiting for the button, as before.
    }
  }
  return matches;
}

export async function resetPinForTests(): Promise<void> {
  await wealthDb.metadata.delete(pinCredentialsKey);
}
