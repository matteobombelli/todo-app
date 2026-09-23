import { CalendarDays, CloudOff, ListTodo, Plus, RefreshCw, Settings, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useAuth } from "./auth/AuthProvider";
import { IconButton } from "./components/IconButton";
import { setNavDirection } from "./components/motion";
import { Spinner } from "./components/Spinner";
import { useData, useLists } from "./data/hooks";
import { startSyncLoop, store } from "./data/instance";
import { SettingsModal } from "./SettingsModal";
import { ListEditor } from "./todo/ListEditor";
import { ListRows } from "./todo/ListRows";

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
      <NavLink to="/todo" className="tab" viewTransition onClick={() => setNavDirection("tab")}>
        <ListTodo size={20} aria-hidden="true" />
        <span>Todo</span>
      </NavLink>
      <NavLink to="/calendar" className="tab" viewTransition onClick={() => setNavDirection("tab")}>
        <CalendarDays size={20} aria-hidden="true" />
        <span>Calendar</span>
      </NavLink>
    </nav>
  );
}

/** Wide screens only: the tabs, every list, and sync status and settings at the bottom. */
function Sidebar({ onSettings }: { onSettings: () => void }) {
  const { user } = useAuth();
  const lists = useLists();
  const [creating, setCreating] = useState(false);
  return (
    <aside className="sidebar">
      <span className="sidebar__brand">Todo</span>
      <Tabs className="tabs tabs--side" />
      <div className="sidebar__heading">
        <h2>Lists</h2>
        <IconButton icon={Plus} label="New list" onClick={() => setCreating(true)} />
      </div>
      <div className="sidebar__lists">
        <ListRows compact />
      </div>
      <div className="sidebar__footer">
        <span className="sidebar__user">{user?.email}</span>
        <SyncIndicator />
        <IconButton icon={Settings} label="Settings" onClick={onSettings} />
      </div>
      {creating && (
        <ListEditor list={null} nextSortOrder={(lists.at(-1)?.sort_order ?? 0) + 1} onClose={() => setCreating(false)} />
      )}
    </aside>
  );
}

/** The signed-in app: loads the user's mirror, keeps it synced, and lays out the two tabs. */
export default function Shell() {
  const { user } = useAuth();
  const { loaded } = useData();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const userId = user!.id;

  // Back and forward buttons replay a route's view transition; they should slide the way back does.
  useEffect(() => {
    const onPop = () => setNavDirection("pop");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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
      {loaded && <Sidebar onSettings={() => setSettingsOpen(true)} />}
      <div className="shell__content">
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
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
