import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { LoginBody, RegisterBody, User } from "../../shared/api";
import { ApiError, UNAUTHORIZED_EVENT, api } from "../api/client";

interface AuthValue {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, inviteCode: string): Promise<void>;
  logout(): Promise<void>;
  setTimezone(timezone: string): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

// The last signed-in user, so the installed app opens offline. Only a 401 from the server clears it.
const USER_KEY = "todo:user";

function readCachedUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? "null") as User | null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: User | null): void {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(readCachedUser);
  const [loading, setLoading] = useState(() => readCachedUser() === null);

  const setUser = useCallback((u: User | null) => {
    writeCachedUser(u);
    setUserState(u);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<{ user: User }>("/auth/me")
      .then(({ user: u }) => {
        if (!cancelled) setUser(u);
      })
      .catch((err) => {
        // Offline or a server hiccup keeps the cached user; only a real 401 signs out.
        if (!cancelled && err instanceof ApiError && err.status === 401) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setUser]);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [setUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const body: LoginBody = { email, password };
      setUser((await api<{ user: User }>("/auth/login", { body })).user);
    },
    [setUser],
  );

  const register = useCallback(
    async (email: string, password: string, inviteCode: string) => {
      const body: RegisterBody = { email, password, inviteCode };
      setUser((await api<{ user: User }>("/auth/register", { body })).user);
    },
    [setUser],
  );

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
    }
  }, [setUser]);

  const setTimezone = useCallback(
    async (timezone: string) => {
      setUser((await api<{ user: User }>("/settings", { method: "PATCH", body: { timezone } })).user);
    },
    [setUser],
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, setTimezone }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
