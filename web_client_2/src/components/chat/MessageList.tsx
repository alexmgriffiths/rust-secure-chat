import { useEffect, useRef } from "react";
import { Message } from "../../types/chat";

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

type Props = { messages: Message[]; isTyping?: boolean };

export function MessageList({ messages, isTyping }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  return (
    <div className="messages-area">
      {messages.length === 0 && !isTyping ? (
        <div className="messages-empty">
          <p className="empty-headline">No messages yet</p>
          <p className="empty-sub">Paste a recipient ID above and say hello.</p>
        </div>
      ) : (
        messages.map((msg) => <Bubble key={msg.id} msg={msg} />)
      )}
      {isTyping && (
        <div className="msg-row msg-row-received">
          <div className="bubble bubble-received bubble-typing">
            <span className="typing-dots">
              <span /><span /><span />
            </span>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
