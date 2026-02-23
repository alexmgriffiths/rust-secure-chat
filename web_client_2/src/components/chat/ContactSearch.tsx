import { useEffect, useState } from "react";
import axios from "axios";

const API_URL = "http://localhost:3000";

type UserResult = { id: string; username: string };

type Props = {
  token: string;
  onSelect: (userId: string, username: string) => void;
  onClose: () => void;
};

export function ContactSearch({ token, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get(`${API_URL}/users/search`, {
          params: { q: query.trim() },
          headers: { Authorization: `Bearer ${token}` },
        });
        setResults(res.data ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, token]);

  return (
    <div className="contact-search-wrap">
      <div className="contact-search-header">
        <input
          className="contact-search-input"
          placeholder="Search by username…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button className="contact-search-close" onClick={onClose} aria-label="Close search">
          ✕
        </button>
      </div>
      {loading && <div className="contact-search-status">Searching…</div>}
      {!loading && query.trim() && results.length === 0 && (
        <div className="contact-search-status">No users found</div>
      )}
      {results.length > 0 && (
        <div className="contact-search-results">
          {results.map((user) => (
            <div
              key={user.id}
              className="contact-result-item"
              onClick={() => onSelect(user.id, user.username)}
            >
              <div className="conv-avatar">{user.username.slice(0, 2).toUpperCase()}</div>
              <div className="conv-info">
                <div className="conv-id">{user.username}</div>
                <div className="conv-preview">{user.id.slice(0, 8)}…</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
