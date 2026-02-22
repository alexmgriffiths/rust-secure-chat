export type WsStatus = "disconnected" | "connecting" | "connected";

export type Message = {
  id: number;
  kind: "sent" | "received" | "system";
  content: string;
  timestamp: string;
};

export type LogEntry = {
  id: number;
  direction: "sent" | "received";
  timestamp: string;
  content: string;
};

export type ConversationSummary = {
  id: string;
  preview: string;
  timestamp: string;
};
