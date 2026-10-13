"use client";

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownToLine, ShieldAlert } from "lucide-react";

import { backupReminderFor, getBackupHealth } from "@/data/backup-health";
import { getPersistRequest, requestPersistentStorage } from "@/data/storage-persistence";
import { Button } from "@/features/dashboard/ui";
import { useLanguage } from "@/features/i18n/language";
import { backupReminderSnooze } from "@/features/settings/preferences";

/** "Later" puts the reminder off for this long. */
export const backupSnoozeDays = 3;

/*
 * THE BACKUP GUARD. Two jobs, both about not losing the archive:
 *
 * - the first time the archive holds something of the owner's, it asks the
 *   browser for persistent storage, once (storage-persistence.ts);
 * - it asks for a backup at the moments it matters (backup-health.ts): the
 *   first one once there is real data, then when the last one is two weeks
 *   old or several updates behind. "Later" puts it off for a few days; an
 *   export that matches the archive ends it.
 *
 * The words never call the browser a safe place: they say the export is the
 * copy that survives it.
 */
export function BackupGuard({ blocked, onExport }: { blocked: boolean; onExport: () => void }) {
  const { text } = useLanguage();
  const health = useLiveQuery(() => getBackupHealth(), [], undefined);
  const persist = useLiveQuery(() => getPersistRequest(), [], undefined);
  const snoozedUntil = backupReminderSnooze.use();

  const hasOwnData = health?.hasOwnData ?? false;
  useEffect(() => {
    // Once, on the first real data: undefined is "not read yet", null "never asked".
    if (hasOwnData && persist === null) void requestPersistentStorage();
  }, [hasOwnData, persist]);

  if (!health || blocked) return null;
  const reminder = backupReminderFor(health, new Date(), snoozedUntil || null);
  if (!reminder) return null;

  const title = reminder.reason === "first"
    ? text("Fai il primo backup", "Make your first backup")
    : reminder.reason === "time"
      ? text(`L'ultimo backup ha ${reminder.days} giorni`, `Your last backup is ${reminder.days} days old`)
      : text(`${reminder.changes} modifiche non sono nel backup`, `${reminder.changes} changes are not in your backup`);
  const body = reminder.reason === "first"
    ? text(
        "I tuoi dati esistono solo in questo browser. Un backup esportato e conservato altrove è l'unica copia che sopravvive se il browser li cancella o il dispositivo si guasta.",
        "Your data exists only in this browser. An exported backup kept elsewhere is the only copy that survives if the browser clears it or the device fails.",
      )
    : text(
        "Da allora i dati sono cambiati: esporta un nuovo backup e conservalo in un posto sicuro, fuori da questo browser.",
        "Your data has changed since: export a new backup and keep it somewhere safe, outside this browser.",
      );
  const denied = persist?.outcome === "denied"
    ? text(
        " Il browser non ha concesso l'archiviazione persistente: se lo spazio scarseggia, può cancellare l'archivio.",
        " The browser has not granted persistent storage: if space runs low, it may clear the archive.",
      )
    : "";

  const later = () => backupReminderSnooze.set(new Date(Date.now() + backupSnoozeDays * 86_400_000).toISOString());

  return (
    <section aria-labelledby="backup-reminder-title" className="backup-reminder" data-reason={reminder.reason}>
      <span aria-hidden="true" className="backup-reminder__icon"><ShieldAlert size={20} /></span>
      <div className="backup-reminder__text">
        <h2 id="backup-reminder-title">{title}</h2>
        <p>{body}{denied}</p>
      </div>
      <div className="backup-reminder__actions">
        <Button onClick={later} variant="ghost">{text("Più tardi", "Later")}</Button>
        <Button onClick={onExport} variant="primary">
          <ArrowDownToLine aria-hidden="true" size={16} /> {text("Esporta backup", "Export backup")}
        </Button>
      </div>
    </section>
  );
}
