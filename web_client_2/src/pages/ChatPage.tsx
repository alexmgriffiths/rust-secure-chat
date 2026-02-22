import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { MoonIcon } from "../components/icons/MoonIcon";
import { SunIcon } from "../components/icons/SunIcon";
import { useIndexedDB } from "../hooks/useIndexDb";
import {
  fetchPrekeyBundle,
  initiateX3DH,
  receiveX3DH,
  toBase64,
  verifyBundle,
} from "../crypto/x3dh";
import {
  RatchetState,
  initRatchetReceiver,
  initRatchetSender,
  ratchetDecrypt,
  ratchetEncrypt,
} from "../crypto/ratchet";

const WS_URL = "ws://localhost:9901";

type WsStatus = "disconnected" | "connecting" | "connected";

type Message = {
  id: number;
  kind: "sent" | "received" | "system";
  content: string;
  timestamp: string;
};

type LogEntry = {
  id: number;
  direction: "sent" | "received";
  timestamp: string;
  content: string;
};

type AuthCtx = { token: string; userId: string; logout: () => void };

function now() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Bubble({ msg }: { msg: Message }) {
  if (msg.kind === "system") {
    return (
      <div className="msg-system">
        <span>{msg.content}</span>
      </div>
    );
  }
  return (
    <div className={`msg-row msg-row-${msg.kind}`}>
      <div className={`bubble bubble-${msg.kind}`}>
        <span className="bubble-text">{msg.content}</span>
        <span className="bubble-time">{msg.timestamp}</span>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { token, userId, logout } = useAuth() as AuthCtx;
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();

  const { getAllValues, putValue, isDBConnecting } = useIndexedDB("keys-db", [
    "keys-table",
    "sessions-table",
  ]);

  const [wsStatus, setWsStatus] = useState<WsStatus>("disconnected");
  const socketRef = useRef<WebSocket | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgInput, setMsgInput] = useState("");

  const [log, setLog] = useState<LogEntry[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const logIdRef = useRef(0);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  const keysRef = useRef<any>(null);
  const sessionsRef = useRef<Map<string, RatchetState>>(new Map());

  const hydrateSession = (raw: any): RatchetState => {
    const b = (v: any) => new Uint8Array(Object.values(v));
    return {
      RK: b(raw.RK),
      CKs: raw.CKs ? b(raw.CKs) : null,
      CKr: raw.CKr ? b(raw.CKr) : null,
      DHs: { pub: b(raw.DHs.pub), priv: b(raw.DHs.priv) },
      DHr: raw.DHr ? b(raw.DHr) : null,
      Ns: raw.Ns,
      Nr: raw.Nr,
      PN: raw.PN,
    };
  };

  const saveSession = (key: string, state: RatchetState) => {
    putValue("sessions-table", { id: key, ...state } as any).catch(
      (err) => console.error("Failed to persist session:", err),
    );
  };
  const msgIdRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-connect on mount
  useEffect(() => {
    if (isDBConnecting) return;

    getAllValues("keys-table").then(async (dbKeys) => {
      const raw = dbKeys[0];
      if (!raw) return;
      // IndexedDB deserializes Uint8Array as plain {0: x, 1: y, ...} objects — re-wrap them
      const b = (v: any) => new Uint8Array(Object.values(v));
      const hydrated = {
        ...raw,
        privateStore: {
          ...raw.privateStore,
          identity_x25519_private: b(raw.privateStore.identity_x25519_private),
          identity_ed25519_private: b(
            raw.privateStore.identity_ed25519_private,
          ),
          signed_prekey_private: b(raw.privateStore.signed_prekey_private),
          one_time_prekeys: raw.privateStore.one_time_prekeys.map((k: any) => ({
            key_id: k.key_id,
            private_key: b(k.private_key),
          })),
        },
        publicUpload: {
          ...raw.publicUpload,
          identity_x25519_public: b(raw.publicUpload.identity_x25519_public),
          identity_ed25519_public: b(raw.publicUpload.identity_ed25519_public),
          signed_prekey_public: b(raw.publicUpload.signed_prekey_public),
          signed_prekey_signature: b(raw.publicUpload.signed_prekey_signature),
          one_time_prekeys: raw.publicUpload.one_time_prekeys.map((k: any) => ({
            key_id: k.key_id,
            public_key: b(k.public_key),
          })),
        },
      };
      keysRef.current = hydrated;

      const storedSessions = await getAllValues("sessions-table");
      for (const s of storedSessions) {
        sessionsRef.current.set(s.id, hydrateSession(s));
      }

      handleConnect();
    });

    return () => handleDisconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDBConnecting]);

  useEffect(() => {
    if (consoleOpen)
      consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log, consoleOpen]);

  const addMessage = (kind: Message["kind"], content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: ++msgIdRef.current, kind, content, timestamp: now() },
    ]);
  };

  const addLog = (direction: LogEntry["direction"], content: string) => {
    setLog((prev) => [
      ...prev,
      { id: ++logIdRef.current, direction, content, timestamp: now() },
    ]);
  };

  const prettyJson = (raw: string) => {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  };

  const handleConnect = () => {
    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;
    ws.onopen = () => {
      setWsStatus("connected");
      const auth_request = JSON.stringify({
        type: "authenticate",
        token: token,
      });
      ws.send(auth_request);
      addLog("sent", auth_request);
    };

    ws.onmessage = (event: MessageEvent) => {
      addLog("received", event.data);
      const parsedEvent = JSON.parse(event.data);
      if (parsedEvent.type !== "delivery") return;

      const envelope = JSON.parse(parsedEvent.payload);

      if (envelope.type === "init") {
        // First message — run X3DH receive, init ratchet, decrypt
        const { masterSecret } = receiveX3DH(keysRef.current, envelope);
        let state = initRatchetReceiver(
          masterSecret,
          keysRef.current.privateStore.signed_prekey_private,
          keysRef.current.publicUpload.signed_prekey_public,
        );
        const { state: newState, plaintext } = ratchetDecrypt(
          state,
          envelope,
          envelope.ct,
          envelope.nonce,
        );
        // Key sessions by sender's IK — pseudonymous but stable per device
        sessionsRef.current.set(envelope.ik, newState);
        saveSession(envelope.ik, newState);
        const { text } = JSON.parse(plaintext);
        addMessage("received", text);

      } else if (envelope.type === "msg") {
        const state = sessionsRef.current.get(envelope.ik);
        if (!state) {
          console.error("No session for sender", envelope.ik);
          return;
        }
        const { state: newState, plaintext } = ratchetDecrypt(
          state,
          envelope,
          envelope.ct,
          envelope.nonce,
        );
        sessionsRef.current.set(envelope.ik, newState);
        saveSession(envelope.ik, newState);
        const { text } = JSON.parse(plaintext);
        addMessage("received", text);
      }
    };

    ws.onclose = () => {
      setWsStatus("disconnected");
    };

    ws.onerror = () => {
      setWsStatus("disconnected");
    };
  };

  const handleDisconnect = () => {
    if (socketRef && socketRef.current) socketRef.current.close();
  };

  const sendMessage = async (text: string) => {
    const myIK = toBase64(keysRef.current.publicUpload.identity_x25519_public);
    const existingSession = sessionsRef.current.get(recipientId);
    const plaintext = JSON.stringify({ sender_id: userId, text });

    if (!existingSession) {
      // First message to this recipient — X3DH handshake + init ratchet
      const bundle = await fetchPrekeyBundle(recipientId, token);
      verifyBundle(bundle);
      const x3dh = initiateX3DH(keysRef.current, bundle);
      let state = initRatchetSender(
        x3dh.masterSecret,
        x3dh.ekPriv,
        x3dh.ekPub,
        bundle.signed_prekey_public,
      );
      const { state: newState, header, ct, nonce } = ratchetEncrypt(state, plaintext);
      sessionsRef.current.set(recipientId, newState);
      saveSession(recipientId, newState);

      const envelope = JSON.stringify({
        type: "init",
        ik: myIK,
        ek: toBase64(x3dh.ekPub),
        opk_id: x3dh.opkId,
        device_id: x3dh.deviceId,
        ...header,
        ct,
        nonce,
      });
      const frame = JSON.stringify({ type: "send", mailbox_id: recipientId, payload: envelope });
      socketRef.current!.send(frame);
      addLog("sent", frame);
    } else {
      // Subsequent message — advance existing ratchet state
      const { state: newState, header, ct, nonce } = ratchetEncrypt(existingSession, plaintext);
      sessionsRef.current.set(recipientId, newState);
      saveSession(recipientId, newState);

      const envelope = JSON.stringify({
        type: "msg",
        ik: myIK,
        ...header,
        ct,
        nonce,
      });
      const frame = JSON.stringify({ type: "send", mailbox_id: recipientId, payload: envelope });
      socketRef.current!.send(frame);
      addLog("sent", frame);
    }
  };

  const handleSend = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!msgInput.trim()) return;
    const text = msgInput;
    setMsgInput("");
    addMessage("sent", text);
    sendMessage(text).catch((err) => {
      console.error("Send failed:", err);
      addMessage("system", "Failed to send message.");
    });
  };

  const isConnected = wsStatus === "connected";

  const handleLogout = () => {
    handleDisconnect();
    logout();
    navigate("/login");
  };

  const statusLabel: Record<WsStatus, string> = {
    connected: "Secure",
    connecting: "Connecting",
    disconnected: "Offline",
  };

  return (
    <div className="chat-shell">
      {/* Nav */}
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
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button className="nav-signout" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </nav>

      {/* To: row */}
      <div className="to-row">
        <span className="to-label">To</span>
        <div className="to-divider" />
        <input
          className="to-input"
          placeholder="Recipient ID"
          value={recipientId}
          onChange={(e) => setRecipientId(e.target.value)}
          spellCheck={false}
        />
      </div>

      {/* Messages */}
      <div className="messages-area">
        {messages.length === 0 ? (
          <div className="messages-empty">
            <p className="empty-headline">No messages yet</p>
            <p className="empty-sub">
              Paste a recipient ID above and say hello.
            </p>
          </div>
        ) : (
          messages.map((msg) => <Bubble key={msg.id} msg={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Debug console */}
      <div className="console-drawer">
        <button
          className="console-bar"
          onClick={() => setConsoleOpen((o) => !o)}
        >
          <span className="console-bar-left">
            <span className="console-label">Console</span>
            {log.length > 0 && (
              <span className="console-count">{log.length}</span>
            )}
          </span>
          <span className="console-bar-right">
            {log.length > 0 && (
              <span
                className="console-clear"
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLog([]);
                }}
              >
                Clear
              </span>
            )}
            <svg
              className={`console-chevron${consoleOpen ? " console-chevron-open" : ""}`}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </span>
        </button>
        {consoleOpen && (
          <div className="console-entries">
            {log.length === 0 ? (
              <span className="console-empty">No frames yet.</span>
            ) : (
              log.map((entry) => (
                <div
                  key={entry.id}
                  className={`console-entry console-${entry.direction}`}
                >
                  <span className="console-meta">
                    <span className="console-arrow">
                      {entry.direction === "sent" ? "↑" : "↓"}
                    </span>
                    <span className="console-time">{entry.timestamp}</span>
                  </span>
                  <pre className="console-body">
                    {prettyJson(entry.content)}
                  </pre>
                </div>
              ))
            )}
            <div ref={consoleEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <form className="chat-input-bar" onSubmit={handleSend}>
        <input
          className="chat-input-field"
          value={msgInput}
          onChange={(e) => setMsgInput(e.target.value)}
          placeholder={!recipientId ? "Enter a recipient first…" : "Message"}
          disabled={!isConnected || !recipientId}
        />
        <button
          type="submit"
          className="btn-send"
          disabled={!isConnected || !recipientId || !msgInput.trim()}
          aria-label="Send"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  );
}
