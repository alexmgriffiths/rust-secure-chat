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
  const typingLabel = recipientIsTyping
    ? `${recipientName ?? chat.recipientId.slice(0, 8) + "…"} is typing`
    : null;

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
                <button className="to-clear" onClick={() => chat.setRecipientId("")}>✕</button>
              </>
            ) : (
              <span className="to-placeholder">Press + in the sidebar to start a conversation</span>
            )}
          </div>
          <MessageList messages={chat.messages} />
          <DebugConsole log={chat.log} onClear={chat.clearLog} />
          <div className={`typing-indicator${recipientIsTyping ? " typing-indicator-visible" : ""}`}>
            {typingLabel && (
              <>
                <span className="typing-label">{typingLabel}</span>
                <span className="typing-dots">
                  <span /><span /><span />
                </span>
              </>
            )}
          </div>
          <MessageInput
            disabled={!isConnected || !hasRecipient}
            placeholder={!hasRecipient ? "Enter a recipient first…" : "Message"}
            onSend={handleSend}
            onTyping={chat.notifyTyping}
          />
        </div>
      </div>
    </div>
  );
}
