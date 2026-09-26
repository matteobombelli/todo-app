import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Spinner } from "../components/Spinner";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/calendar";
  const nextParam = new URLSearchParams(location.search).get("next");
  const next = nextParam?.startsWith("/authorize?") || nextParam?.startsWith("/connect/") ? nextParam : null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      // /authorize (connecting Claude) and /connect/* (connecting Save the Date) are served by the
      // Worker, not the SPA, so they need a real navigation.
      if (next) window.location.assign(next);
      else navigate(from, { replace: true });
    } catch (err) {
      setError(loginError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page page--centre">
      <form className="card card--auth" onSubmit={onSubmit}>
        <h1>Log in</h1>
        <input
          type="email"
          placeholder="Email"
          aria-label="Email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          aria-label="Password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="form__error">{error}</p>}
        <button type="submit" className="button--primary button--icon" disabled={busy}>
          {busy && <Spinner inline />}
          Log in
        </button>
        <p className="muted">
          No account? <Link to="/signup">Register</Link>
        </p>
      </form>
    </main>
  );
}

function loginError(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong. Try again.";
  if (err.status === 401) return "Invalid email or password";
  if (err.status === 400) return "Check your input";
  return err.message;
}
