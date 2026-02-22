import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";

const AUTH_URL = "http://localhost:3000";

type Mode = "login" | "register";
type Auth = {
  isAuthenticated: boolean;
  login: (creds: { username: string; password: string }) => Promise<string>;
  checkHasKeys: () => Promise<boolean>;
};

export default function LoginPage() {
  const { isAuthenticated, login, checkHasKeys } = useAuth() as Auth;
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setSuccess("");
    setPassword("");
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login({ username, password });
      const hasKeys = await checkHasKeys();
      navigate(hasKeys ? "/chat" : "/device-setup");
    } catch {
      console.error(e);
      setError("Incorrect username or password.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await axios.post(`${AUTH_URL}/register`, { username, password });
      setSuccess("Account created. Sign in to continue.");
      switchMode("login");
    } catch (err: any) {
      setError(
        err.response?.data?.message ??
          "Registration failed. Try a different username.",
      );
    } finally {
      setLoading(false);
    }
  };

  const isLogin = mode === "login";

  return (
    <div className="auth-shell">
      <button
        className="theme-toggle-float"
        onClick={toggleTheme}
        aria-label="Toggle theme"
      >
        {theme === "dark" ? (
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-logo">⬡</span>
          <span className="auth-logo-name">Relay</span>
        </div>

        <h1 className="auth-heading">
          {isLogin ? "Welcome back" : "Create your account"}
        </h1>
        <p className="auth-sub">
          {isLogin ? "Sign in to continue" : "Get started in seconds"}
        </p>

        <form
          onSubmit={isLogin ? handleLogin : handleRegister}
          className="auth-form"
        >
          <div className="auth-field">
            <label className="auth-label">Username</label>
            <input
              className="auth-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="auth-field">
            <label className="auth-label">Password</label>
            <input
              className="auth-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                isLogin ? "Enter your password" : "Choose a password"
              }
              autoComplete={isLogin ? "current-password" : "new-password"}
            />
          </div>

          {error && <p className="auth-banner auth-banner-error">{error}</p>}
          {success && (
            <p className="auth-banner auth-banner-success">{success}</p>
          )}

          <button
            type="submit"
            className="auth-submit"
            disabled={loading || !username.trim() || !password.trim()}
          >
            {loading ? "…" : isLogin ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="auth-switch-btn"
            onClick={() => switchMode(isLogin ? "register" : "login")}
          >
            {isLogin ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
