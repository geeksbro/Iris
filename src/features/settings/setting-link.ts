/*
 * A way into one row of Settings from elsewhere (owner, 18 Oct 2026: the
 * "Prova" links of the release notes). The caller asks for a group and a
 * row, then opens Settings; Settings takes the request when it is on
 * screen — at once if it already is — shows that group, brings the row into
 * view and marks it for a moment. A request nobody takes is simply replaced
 * by the next one.
 */

export type SettingsSectionId = "security" | "data" | "experience" | "general" | "system";

export type SettingTarget = {
  section: SettingsSectionId;
  /** The row's `data-setting` name in SettingsView. */
  setting: string;
};

let pending: SettingTarget | null = null;
const listeners = new Set<() => void>();

export function requestSetting(target: SettingTarget) {
  pending = target;
  listeners.forEach((listener) => listener());
}

/** The waiting request, without taking it: the group Settings opens on. */
export function peekSettingRequest(): SettingTarget | null {
  return pending;
}

/** The waiting request, taken: it is answered once. */
export function takeSettingRequest(): SettingTarget | null {
  const target = pending;
  pending = null;
  return target;
}

export function subscribeSettingRequests(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
