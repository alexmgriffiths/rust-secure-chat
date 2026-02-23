import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useChat } from "../hooks/useChat";
import { ChatNav } from "../components/chat/ChatNav";
import { ConversationSidebar } from "../components/chat/ConversationSidebar";
import { MessageList } from "../components/chat/MessageList";
import { DebugConsole } from "../components/chat/DebugConsole";
import { MessageInput } from "../components/chat/MessageInput";

type AuthCtx = { token: string; userId: string; logout: () => void };

export default function ChatPage() {
  const { token, userId, logout } = useAuth() as AuthCtx;
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const handleAuthFailure = () => {
    logout();
    navigate("/login");
  };

  const chat = useChat(token, userId, handleAuthFailure);
  const [showFingerprint, setShowFingerprint] = useState(false);

  const handleLogout = () => {
    chat.disconnect();
    logout();
    navigate("/login");
  };

  const handleSend = (text: string) => {
    chat.sendMessage(text).catch((err) => {
      console.error("Send failed:", err);
    });
  };

  const isConnected = chat.wsStatus === "connected";
  const hasRecipient = !!chat.recipientId;
  const recipientName = chat.recipientId ? chat.usernames.get(chat.recipientId) : undefined;
  const recipientIsTyping = chat.recipientId ? chat.typingUsers.has(chat.recipientId) : false;
  const fingerprint = hasRecipient ? chat.getFingerprint(chat.recipientId) : null;

  return (
    <div className="chat-shell">
      <ChatNav
        wsStatus={chat.wsStatus}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={handleLogout}
      />
      <div className="chat-body">
        <ConversationSidebar
          conversations={chat.conversations}
          activeId={chat.recipientId}
          onSelect={chat.setRecipientId}
          usernames={chat.usernames}
          token={token}
          onNewContact={chat.addContact}
        />
        <div className="chat-main">
          <div className="to-row">
            <span className="to-label">To</span>
            <div className="to-divider" />
            {hasRecipient ? (
              <>
                <span className="to-name">{recipientName ?? `${chat.recipientId.slice(0, 8)}…`}</span>
                {fingerprint && (
                  <button
                    className="to-lock"
                    onClick={() => setShowFingerprint(true)}
                    title="View safety number"
                    aria-label="View safety number"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </button>
                )}
                <button className="to-clear" onClick={() => chat.setRecipientId("")}>✕</button>
              </>
            ) : (
              <span className="to-placeholder">Press + in the sidebar to start a conversation</span>
            )}
          </div>
          <MessageList messages={chat.messages} isTyping={recipientIsTyping} />
          <DebugConsole log={chat.log} onClear={chat.clearLog} />
          <MessageInput
            disabled={!isConnected || !hasRecipient}
            placeholder={!hasRecipient ? "Enter a recipient first…" : "Message"}
            onSend={handleSend}
            onTyping={chat.notifyTyping}
          />
        </div>
      </div>

      {showFingerprint && fingerprint && (
        <div className="fp-overlay" onClick={() => setShowFingerprint(false)}>
          <div className="fp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fp-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h2 className="fp-title">Safety Number</h2>
            <p className="fp-desc">
              Compare this number with {recipientName ?? "your contact"} on another channel.
              If it matches, your conversation is secure.
            </p>
            <pre className="fp-code">{fingerprint}</pre>
            <button className="fp-done" onClick={() => setShowFingerprint(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
