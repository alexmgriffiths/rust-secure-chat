import { useRef, useState } from "react";

type Props = {
  disabled: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
  onTyping?: (isTyping: boolean) => void;
};

export function MessageInput({ disabled, placeholder = "Message", onSend, onTyping }: Props) {
  const [value, setValue] = useState("");
  const stopTypingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    if (onTyping) {
      onTyping(true);
      if (stopTypingTimeout.current) clearTimeout(stopTypingTimeout.current);
      stopTypingTimeout.current = setTimeout(() => onTyping(false), 2000);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!value.trim()) return;
    if (onTyping) {
      onTyping(false);
      if (stopTypingTimeout.current) clearTimeout(stopTypingTimeout.current);
    }
    onSend(value);
    setValue("");
  };

  return (
    <form className="chat-input-bar" onSubmit={handleSubmit}>
      <input
        className="chat-input-field"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
      />
      <button
        type="submit"
        className="btn-send"
        disabled={disabled || !value.trim()}
        aria-label="Send"
      >
        <svg
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </form>
  );
}
