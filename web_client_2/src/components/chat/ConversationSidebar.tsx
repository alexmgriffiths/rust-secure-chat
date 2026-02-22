import { ConversationSummary } from "../../types/chat";

type Props = {
  conversations: ConversationSummary[];
  activeId: string;
  onSelect: (id: string) => void;
};

export function ConversationSidebar({ conversations, activeId, onSelect }: Props) {
  return (
    <aside className="chat-sidebar">
      <div className="sidebar-header">Conversations</div>
      <div className="sidebar-conversations">
        {conversations.length === 0 ? (
          <p className="sidebar-empty">
            No conversations yet.<br />Paste a recipient ID to start.
          </p>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conv-item${conv.id === activeId ? " conv-item-active" : ""}`}
              onClick={() => onSelect(conv.id)}
            >
              <div className="conv-avatar">{conv.id.slice(0, 2).toUpperCase()}</div>
              <div className="conv-info">
                <div className="conv-id">{conv.id.slice(0, 8)}…</div>
                <div className="conv-preview">{conv.preview}</div>
              </div>
              <span className="conv-time">{conv.timestamp}</span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
