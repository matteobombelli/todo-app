import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { EVENT_REMINDER_MINUTES, ITEM_REMINDER_TIMES, type SettingsBody } from "../shared/api";
import { useAuth } from "./auth/AuthProvider";
import { useConfirm } from "./components/ConfirmDialog";
import { Modal } from "./components/Modal";
import { store } from "./data/instance";
import { formatTime } from "./format";
import { disablePush, enablePush, pushState, type PushState } from "./push";

const PUSH_HINTS: Record<PushState, string> = {
  on: "Reminders for to-dos and timed events are on for this device.",
  off: "Get reminders for to-dos and timed events on this device.",
  denied: "Notifications are blocked in this browser's settings.",
  unsupported: "Not available here. On iPhone and iPad, add the app to your Home Screen first.",
};

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout, updateSettings } = useAuth();
  const navigate = useNavigate();
  const zones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const [push, setPush] = useState<PushState | null>(null);

  useEffect(() => {
    if (open) pushState().then(setPush, () => setPush("unsupported"));
  }, [open]);

  async function onSettings(settings: SettingsBody) {
    setError(null);
    try {
      await updateSettings(settings);
    } catch {
      setError("Could not save. Are you online?");
    }
  }

  async function onPushToggle() {
    setError(null);
    try {
      if (push === "on") {
        await disablePush();
        setPush("off");
      } else {
        setPush(await enablePush());
      }
    } catch {
      setError("Could not change notifications. Are you online?");
    }
  }

  async function onLogout() {
    const { pending } = store.getSnapshot();
    const message = `${pending} change${pending === 1 ? " has" : "s have"} not synced yet and will be lost.`;
    if (pending > 0 && !(await confirm("Log out?", message, "Log out"))) return;
    // Otherwise this device keeps receiving the previous account's reminders.
    await disablePush().catch(() => undefined);
    await logout().catch(() => undefined);
    await store.clear();
    navigate("/login", { replace: true });
  }

  if (!user) return null;
  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <div className="form">
        <p className="muted">Signed in as {user.email}</p>
        <label className="field">
          <span className="field__label">Timezone</span>
          <select value={user.timezone} onChange={(e) => void onSettings({ timezone: e.target.value })}>
            {zones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
          <span className="field__hint">
            Used by Claude to know what "today" is, and to time reminders. The app itself uses this device's clock.
          </span>
        </label>
        <div className="field">
          <span className="field__label">Notifications</span>
          <div>
            <button type="button" disabled={push !== "on" && push !== "off"} onClick={() => void onPushToggle()}>
              {push === "on" ? "Turn off" : "Turn on"}
            </button>
          </div>
          {push && <span className="field__hint">{PUSH_HINTS[push]}</span>}
        </div>
        <label className="field">
          <span className="field__label">Event reminders</span>
          <select
            value={user.event_reminder_minutes ?? 0}
            onChange={(e) => void onSettings({ event_reminder_minutes: Number(e.target.value) })}
          >
            {EVENT_REMINDER_MINUTES.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "When the event starts" : `${m} minutes before`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">To-dos without a time</span>
          <select
            value={user.item_reminder_time ?? ""}
            onChange={(e) => void onSettings({ item_reminder_time: e.target.value || null })}
          >
            <option value="">No reminder</option>
            {ITEM_REMINDER_TIMES.map((t) => (
              <option key={t} value={t}>
                {`At ${formatTime(t)} on the day`}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="form__error">{error}</p>}
        <div className="form__actions">
          <button type="button" onClick={() => void onLogout()}>
            Log out
          </button>
        </div>
      </div>
      {confirmDialog}
    </Modal>
  );
}
