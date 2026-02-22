import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { MoonIcon } from "../components/icons/MoonIcon";
import { SunIcon } from "../components/icons/SunIcon";
import { generateDeviceKeys, uploadDeviceKeys } from "../crypto/keys";

type AuthCtx = {
  token: string;
  userId: string;
  isAuthenticated: boolean;
  isDBConnecting: boolean;
  checkHasKeys: () => Promise<boolean>;
  putKeys: (keys: object) => Promise<void>;
};

export default function DeviceSetupPage() {
  const {
    token,
    userId,
    isAuthenticated,
    isDBConnecting,
    checkHasKeys,
    putKeys,
  } = useAuth() as AuthCtx;
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [deviceName, setDeviceName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // If keys already exist (returning device), skip straight to chat
  useEffect(() => {
    console.log("IS db connecting changed:", isDBConnecting);
    if (isDBConnecting) return;
    checkHasKeys().then((hasKeys) => {
      if (hasKeys) navigate("/chat", { replace: true });
    });
  }, [isDBConnecting]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAuthenticated) return <Navigate to="/login" />;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!deviceName.trim()) return;
    setError("");
    setLoading(true);
    try {
      const keys = generateDeviceKeys();
      const device_id = await uploadDeviceKeys(
        userId,
        token,
        keys.publicUpload,
        deviceName.trim(),
      );
      await putKeys({ ...keys, device_id });
      navigate("/chat");
    } catch (err: any) {
      setError("Failed to register device. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <button
        className="theme-toggle-float"
        onClick={toggleTheme}
        aria-label="Toggle theme"
      >
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>

      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-logo">⬡</span>
          <span className="auth-logo-name">Relay</span>
        </div>

        <h1 className="auth-heading">New device</h1>
        <p className="auth-sub">
          Give this device a name so you can recognize it later.
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label className="auth-label">Device name</label>
            <input
              className="auth-input"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="My MacBook, Work PC…"
              autoFocus
              disabled={isDBConnecting || loading}
            />
          </div>

          {error && <p className="auth-banner auth-banner-error">{error}</p>}

          <button
            type="submit"
            className="auth-submit"
            disabled={isDBConnecting || loading || !deviceName.trim()}
          >
            {loading ? "Setting up…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
