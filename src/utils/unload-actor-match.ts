/**
 * Match Settings identity to dock unload actor (unloaded_by / scanned_by on unload line).
 */
export function settingsMatchUnloadedActor(
  settings: { user_id?: string | null; user_code?: string | null },
  unloadedBy: string | null | undefined
): boolean {
  const actor = String(unloadedBy || "").trim();
  if (!actor) return false;
  const a = actor.toUpperCase();
  const uid = String(settings.user_id || "").trim();
  const uco = String(settings.user_code || "").trim();
  const display = (uco || uid).trim();
  if (uid && uid.toUpperCase() === a) return true;
  if (uco && uco.toUpperCase() === a) return true;
  if (display && display.toUpperCase() === a) return true;
  return false;
}
