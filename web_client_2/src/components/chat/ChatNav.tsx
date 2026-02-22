import { MoonIcon } from "../icons/MoonIcon";
import { SunIcon } from "../icons/SunIcon";
import { WsStatus } from "../../types/chat";

type Props = {
  wsStatus: WsStatus;
  theme: string;
  onToggleTheme: () => void;
  onLogout: () => void;
};

const statusLabel: Record<WsStatus, string> = {
  connected: "Secure",
  connecting: "Connecting",
  disconnected: "Offline",
};

export function ChatNav({ wsStatus, theme, onToggleTheme, onLogout }: Props) {
  return (
    <nav className="chat-nav">
      <div className="nav-brand">
        <span className="nav-logo">⬡</span>
        <span className="nav-name">Relay</span>
      </div>
      <div className="nav-end">
        <span className={`status-pill status-pill-${wsStatus}`}>
          <span className="status-dot" />
          {statusLabel[wsStatus]}
        </span>
        <button className="theme-toggle" onClick={onToggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
        <button className="nav-signout" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </nav>
  );
}
