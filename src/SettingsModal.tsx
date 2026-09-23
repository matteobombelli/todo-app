import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "./auth/AuthProvider";
import { Modal } from "./components/Modal";
import { store } from "./data/instance";

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout, setTimezone } = useAuth();
  const navigate = useNavigate();
  const zones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const [error, setError] = useState<string | null>(null);

  async function onTimezone(tz: string) {
    setError(null);
    try {
      await setTimezone(tz);
    } catch {
      setError("Could not save. Are you online?");
    }
  }

  async function onLogout() {
    const { pending } = store.getSnapshot();
    if (pending > 0 && !confirm(`${pending} change${pending === 1 ? " has" : "s have"} not synced yet and will be lost. Log out anyway?`)) return;
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
          <select value={user.timezone} onChange={(e) => void onTimezone(e.target.value)}>
            {zones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
          <span className="field__hint">Used by Claude to know what "today" is. The app itself uses this device's clock.</span>
        </label>
        {error && <p className="form__error">{error}</p>}
        <div className="form__actions">
          <button type="button" onClick={() => void onLogout()}>
            Log out
          </button>
        </div>
      </div>
    </Modal>
  );
}
