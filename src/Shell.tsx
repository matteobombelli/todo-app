import { CalendarDays, CloudOff, ListTodo, RefreshCw, Settings, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useAuth } from "./auth/AuthProvider";
import { IconButton } from "./components/IconButton";
import { Spinner } from "./components/Spinner";
import { useData } from "./data/hooks";
import { startSyncLoop, store } from "./data/instance";
import { SettingsModal } from "./SettingsModal";

function SyncIndicator() {
  const { status, pending } = useData();
  const label =
    status === "offline"
      ? `Offline${pending ? `, ${pending} change${pending === 1 ? "" : "s"} waiting` : ""}`
      : status === "error"
        ? "Sync failed, retrying"
        : null;
  if (status === "syncing") return <RefreshCw className="sync-indicator sync-indicator--busy" size={16} aria-label="Syncing" />;
  if (!label) return null;
  const Icon = status === "offline" ? CloudOff : TriangleAlert;
  return (
    <span className="sync-indicator" title={label}>
      <Icon size={16} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Tabs({ className }: { className: string }) {
  return (
    <nav className={className} aria-label="Sections">
      <NavLink to="/todo" className="tab">
        <ListTodo size={20} aria-hidden="true" />
        <span>Todo</span>
      </NavLink>
      <NavLink to="/calendar" className="tab">
        <CalendarDays size={20} aria-hidden="true" />
        <span>Calendar</span>
      </NavLink>
    </nav>
  );
}

/** The signed-in app: loads the user's mirror, keeps it synced, and lays out the two tabs. */
export default function Shell() {
  const { user } = useAuth();
  const { loaded } = useData();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const userId = user!.id;

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void store.load(userId).then(() => {
      if (!cancelled) stop = startSyncLoop();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [userId]);

  return (
    <div className="shell">
      <header className="app-header">
        <span className="app-header__brand">Todo</span>
        <Tabs className="tabs tabs--top" />
        <div className="app-header__end">
          <SyncIndicator />
          <IconButton icon={Settings} label="Settings" onClick={() => setSettingsOpen(true)} />
        </div>
      </header>
      <main className="shell__main">{loaded ? <Outlet /> : <Spinner />}</main>
      <Tabs className="tabs tabs--bottom" />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
