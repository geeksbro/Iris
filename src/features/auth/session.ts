const sessionUnlockKey = "wealth-unlocked";

export function isSessionUnlocked(): boolean {
  try {
    return window.sessionStorage.getItem(sessionUnlockKey) === "1";
  } catch {
    return false;
  }
}

export function markSessionUnlocked(): void {
  try {
    window.sessionStorage.setItem(sessionUnlockKey, "1");
  } catch {
    return;
  }
}

export function clearSessionUnlock(): void {
  try {
    window.sessionStorage.removeItem(sessionUnlockKey);
  } catch {
    return;
  }
}
