import { useState } from "react";
import { ConversationSummary } from "../../types/chat";
import { ContactSearch } from "./ContactSearch";

type Props = {
  conversations: ConversationSummary[];
  activeId: string;
  onSelect: (id: string) => void;
  usernames: Map<string, string>;
  token: string;
  onNewContact: (userId: string, username: string) => void;
};

export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  usernames,
  token,
  onNewContact,
}: Props) {
  const [showSearch, setShowSearch] = useState(false);

  const handleSelect = (userId: string, username: string) => {
    onNewContact(userId, username);
    onSelect(userId);
    setShowSearch(false);
  };

  return (
    <aside className="chat-sidebar">
      <div className="sidebar-header">
        <span>Conversations</span>
        <button
          className="sidebar-new-btn"
          onClick={() => setShowSearch((s) => !s)}
          title="New conversation"
        >
          +
        </button>
      </div>

      {showSearch && (
        <ContactSearch
          token={token}
          onSelect={handleSelect}
          onClose={() => setShowSearch(false)}
        />
      )}

      <div className="sidebar-conversations">
        {conversations.length === 0 && !showSearch && (
          <p className="sidebar-empty">
            No conversations yet.<br />Press + to find someone.
          </p>
        )}
        {conversations.map((conv) => {
          const name = usernames.get(conv.id);
          const displayName = name ?? `${conv.id.slice(0, 8)}…`;
          const avatarText = (name ?? conv.id).slice(0, 2).toUpperCase();
          return (
            <div
              key={conv.id}
              className={`conv-item${conv.id === activeId ? " conv-item-active" : ""}`}
              onClick={() => onSelect(conv.id)}
            >
              <div className="conv-avatar">{avatarText}</div>
              <div className="conv-info">
                <div className="conv-id">{displayName}</div>
                <div className="conv-preview">{conv.preview}</div>
              </div>
              <span className="conv-time">{conv.timestamp}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
