export interface PinCredentials {
  algorithm: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  hash: string;
  createdAt: string;
  /**
   * The PIN's number of digits, so the lock screen can unlock on the last
   * one (owner, 10 Oct 2026, as in the Trading OS). Absent on a PIN set
   * before then: it is learned at that PIN's next correct entry.
   */
  length?: number;
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}
