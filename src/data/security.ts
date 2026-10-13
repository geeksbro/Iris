import { wealthDb } from "./db";

/*
 * The device's security policy: how long an unlocked session may sit idle
 * before the gate locks it. It is security state, so it lives beside the PIN
 * credentials in the metadata table (never in a backup, which carries
 * financial records only). No record means the original rule: two minutes.
 *
 * There is no "never": the idle lock is part of the gate's contract, and
 * this dashboard shows real balances. The longest choice is fifteen minutes.
 */

const securityPolicyKey = "security-policy";

export const idleTimeoutChoices = [30_000, 60_000, 120_000, 300_000, 900_000] as const;
export type IdleTimeout = (typeof idleTimeoutChoices)[number];
export const defaultIdleTimeoutMs: IdleTimeout = 120_000;

export interface SecurityPolicy {
  idleTimeoutMs: IdleTimeout;
}

function isIdleTimeout(value: unknown): value is IdleTimeout {
  return typeof value === "number" && (idleTimeoutChoices as readonly number[]).includes(value);
}

/** The stored timeout, or the default when none is stored or it is not one of the choices. */
export async function getIdleTimeoutMs(): Promise<IdleTimeout> {
  const record = await wealthDb.metadata.get(securityPolicyKey);
  const stored = record?.value;
  if (typeof stored === "object" && stored !== null && "idleTimeoutMs" in stored && isIdleTimeout(stored.idleTimeoutMs)) {
    return stored.idleTimeoutMs;
  }
  return defaultIdleTimeoutMs;
}

export async function setIdleTimeoutMs(idleTimeoutMs: number): Promise<void> {
  if (!isIdleTimeout(idleTimeoutMs)) {
    throw new Error("Auto-lock must be one of the offered durations");
  }
  const policy: SecurityPolicy = { idleTimeoutMs };
  await wealthDb.metadata.put({ key: securityPolicyKey, value: policy });
}
