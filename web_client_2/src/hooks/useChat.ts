import { useEffect, useRef, useState } from "react";
import { useIndexedDB } from "./useIndexDb";
import {
  fetchAllDeviceBundles,
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
import { ConversationSummary, LogEntry, Message, WsStatus } from "../types/chat";

const WS_URL = "ws://localhost:9901";

function isJwtExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function hydrateBytes(v: any): Uint8Array {
  return new Uint8Array(Object.values(v));
}

function hydrateSession(raw: any): RatchetState {
  const b = hydrateBytes;
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
}

function hydrateKeys(raw: any) {
  const b = hydrateBytes;
  return {
    ...raw,
    privateStore: {
      ...raw.privateStore,
      identity_x25519_private: b(raw.privateStore.identity_x25519_private),
      identity_ed25519_private: b(raw.privateStore.identity_ed25519_private),
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
}

export function useChat(token: string, userId: string, onAuthFailure: () => void) {
  const { getAllValues, putValue, isDBConnecting } = useIndexedDB("keys-db", [
    "keys-table",
    "sessions-table",
    "messages-table",
    "contacts-table",
  ]);

  const [wsStatus, setWsStatus] = useState<WsStatus>("disconnected");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [recipientId, setRecipientIdState] = useState("");

  const socketRef = useRef<WebSocket | null>(null);
  const keysRef = useRef<any>(null);
  const sessionsRef = useRef<Map<string, RatchetState>>(new Map());
  const ikToUserIdRef = useRef<Map<string, string>>(new Map());
  const conversationsRef = useRef<Map<string, Message[]>>(new Map());
  const recipientIdRef = useRef("");
  const msgIdRef = useRef(0);
  const logIdRef = useRef(0);
  const pendingAcks = useRef<Map<string, { newState: RatchetState; sessionKey: string }>>(new Map());

  const setRecipientId = (id: string) => {
    recipientIdRef.current = id;
    setRecipientIdState(id);
    setMessages(conversationsRef.current.get(id) ?? []);
  };

  const addLog = (direction: LogEntry["direction"], content: string) => {
    setLog((prev) => [
      ...prev,
      { id: ++logIdRef.current, direction, content, timestamp: now() },
    ]);
  };

  const saveSession = (key: string, state: RatchetState) => {
    putValue("sessions-table", { id: key, ...state } as any).catch(
      (err) => console.error("Failed to persist session:", err),
    );
  };

  const saveContact = (ik: string, senderId: string) => {
    if (ikToUserIdRef.current.has(ik)) return;
    ikToUserIdRef.current.set(ik, senderId);
    putValue("contacts-table", { id: ik, user_id: senderId } as any).catch(
      (err) => console.error("Failed to save contact:", err),
    );
  };

  const appendMessage = (conversationId: string, kind: "sent" | "received", text: string) => {
    const timestamp = now();
    const msg: Message = { id: ++msgIdRef.current, kind, content: text, timestamp };
    const existing = conversationsRef.current.get(conversationId) ?? [];
    conversationsRef.current.set(conversationId, [...existing, msg]);
    if (conversationId === recipientIdRef.current) {
      setMessages([...conversationsRef.current.get(conversationId)!]);
    }
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== conversationId);
      return [{ id: conversationId, preview: text, timestamp }, ...filtered];
    });
    putValue("messages-table", {
      conversation_id: conversationId,
      kind,
      content: text,
      timestamp,
    } as any).catch((err) => console.error("Failed to save message:", err));
  };

  const connect = () => {
    if (isJwtExpired(token)) {
      onAuthFailure();
      return;
    }

    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onopen = () => {
      setWsStatus("connected");
      const lastSeq = parseInt(localStorage.getItem(`relay_last_seq_${userId}`) ?? "0");
      const frame = JSON.stringify({ type: "authenticate", token, last_seq: lastSeq });
      ws.send(frame);
      addLog("sent", frame);
    };

    ws.onmessage = (event: MessageEvent) => {
      addLog("received", event.data);
      const parsed = JSON.parse(event.data);

      if (parsed.type === "error") {
        console.error("Server error:", parsed.message);
        if (isJwtExpired(token)) onAuthFailure();
        return;
      }

      if (parsed.type === "ack") {
        const pending = pendingAcks.current.get(parsed.message_id);
        if (pending) {
          // sessionsRef is already updated in-memory at encrypt time — just persist to IndexedDB now
          saveSession(pending.sessionKey, pending.newState);
          pendingAcks.current.delete(parsed.message_id);
        }
        return;
      }

      if (parsed.type !== "delivery") return;

      const deliverySeq = parsed.seq as number;
      const lastSeq = parseInt(localStorage.getItem(`relay_last_seq_${userId}`) ?? "0");
      if (deliverySeq > lastSeq) {
        localStorage.setItem(`relay_last_seq_${userId}`, deliverySeq.toString());
      }

      const envelope = JSON.parse(parsed.payload);

      const myDeviceId = keysRef.current?.device_id;
      if (envelope.device_id !== undefined && envelope.device_id !== myDeviceId) return;

      if (envelope.type === "init") {
        const { masterSecret } = receiveX3DH(keysRef.current, envelope);
        let state = initRatchetReceiver(
          masterSecret,
          keysRef.current.privateStore.signed_prekey_private,
          keysRef.current.publicUpload.signed_prekey_public,
        );
        const { state: newState, plaintext } = ratchetDecrypt(state, envelope, envelope.ct, envelope.nonce);
        sessionsRef.current.set(envelope.ik, newState);
        saveSession(envelope.ik, newState);
        const parsedPayload = JSON.parse(plaintext);
        if (parsedPayload.sync) {
          appendMessage(parsedPayload.to, "sent", parsedPayload.text);
        } else {
          saveContact(envelope.ik, parsedPayload.sender_id);
          appendMessage(parsedPayload.sender_id, "received", parsedPayload.text);
        }

      } else if (envelope.type === "msg") {
        const state = sessionsRef.current.get(envelope.ik);
        if (!state) {
          console.error("No session for sender", envelope.ik);
          return;
        }
        const { state: newState, plaintext } = ratchetDecrypt(state, envelope, envelope.ct, envelope.nonce);
        sessionsRef.current.set(envelope.ik, newState);
        saveSession(envelope.ik, newState);
        const parsedPayload = JSON.parse(plaintext);
        if (parsedPayload.sync) {
          appendMessage(parsedPayload.to, "sent", parsedPayload.text);
        } else {
          const senderId = ikToUserIdRef.current.get(envelope.ik);
          if (!senderId) {
            console.error("Unknown sender IK, cannot attribute message", envelope.ik);
            return;
          }
          appendMessage(senderId, "received", parsedPayload.text);
        }
      }
    };

    ws.onclose = () => setWsStatus("disconnected");
    ws.onerror = () => setWsStatus("disconnected");
  };

  const disconnect = () => {
    socketRef.current?.close();
  };

  const sendMessage = async (text: string) => {
    if (isJwtExpired(token)) {
      onAuthFailure();
      throw new Error("Session expired");
    }

    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }

    const rid = recipientIdRef.current;
    const myIK = toBase64(keysRef.current.publicUpload.identity_x25519_public);
    const plaintext = JSON.stringify({ sender_id: userId, text });

    const deviceSessions = Array.from(sessionsRef.current.entries())
      .filter(([key]) => key.startsWith(`${rid}:`));

    if (deviceSessions.length === 0) {
      // No existing sessions — initiate X3DH for each of recipient's devices
      const bundles = await fetchAllDeviceBundles(rid, token);
      for (const bundle of bundles) {
        if (!verifyBundle(bundle)) {
          console.error("Bundle verification failed for device", bundle.device_id);
          continue;
        }
        const x3dh = initiateX3DH(keysRef.current, bundle);
        let state = initRatchetSender(x3dh.masterSecret, x3dh.ekPriv, x3dh.ekPub, bundle.signed_prekey_public);
        const { state: newState, header, ct, nonce } = ratchetEncrypt(state, plaintext);
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
        const message_id = crypto.randomUUID();
        const sessionKey = `${rid}:${bundle.device_id}`;
        sessionsRef.current.set(sessionKey, newState);
        const frame = JSON.stringify({ type: "send", message_id, mailbox_id: rid, payload: envelope });
        socketRef.current!.send(frame);
        pendingAcks.current.set(message_id, { newState, sessionKey });
        addLog("sent", frame);
      }
    } else {
      // Existing sessions — encrypt once per known device session
      for (const [sessionKey, state] of deviceSessions) {
        const { state: newState, header, ct, nonce } = ratchetEncrypt(state, plaintext);
        const deviceId = parseInt(sessionKey.split(":")[1]);
        const envelope = JSON.stringify({ type: "msg", ik: myIK, device_id: deviceId, ...header, ct, nonce });
        const message_id = crypto.randomUUID();
        sessionsRef.current.set(sessionKey, newState);
        const frame = JSON.stringify({ type: "send", message_id, mailbox_id: rid, payload: envelope });
        socketRef.current!.send(frame);
        pendingAcks.current.set(message_id, { newState, sessionKey });
        addLog("sent", frame);
      }
    }

    // Sync sent message to own other devices
    const syncPlaintext = JSON.stringify({ sync: true, to: rid, text });
    const mySyncSessions = Array.from(sessionsRef.current.entries())
      .filter(([key]) => key.startsWith(`${userId}:`));

    if (mySyncSessions.length === 0) {
      const ownBundles = await fetchAllDeviceBundles(userId, token);
      for (const bundle of ownBundles) {
        if (bundle.device_id === keysRef.current.device_id) continue;
        if (!verifyBundle(bundle)) continue;
        const x3dh = initiateX3DH(keysRef.current, bundle);
        let state = initRatchetSender(x3dh.masterSecret, x3dh.ekPriv, x3dh.ekPub, bundle.signed_prekey_public);
        const { state: newState, header, ct, nonce } = ratchetEncrypt(state, syncPlaintext);
        const syncEnvelope = JSON.stringify({
          type: "init", ik: myIK, ek: toBase64(x3dh.ekPub),
          opk_id: x3dh.opkId, device_id: x3dh.deviceId,
          ...header, ct, nonce,
        });
        const message_id = crypto.randomUUID();
        const sessionKey = `${userId}:${bundle.device_id}`;
        sessionsRef.current.set(sessionKey, newState);
        const frame = JSON.stringify({ type: "send", message_id, mailbox_id: userId, payload: syncEnvelope });
        socketRef.current!.send(frame);
        pendingAcks.current.set(message_id, { newState, sessionKey });
        addLog("sent", frame);
      }
    } else {
      for (const [sessionKey, state] of mySyncSessions) {
        const { state: newState, header, ct, nonce } = ratchetEncrypt(state, syncPlaintext);
        const deviceId = parseInt(sessionKey.split(":")[1]);
        const syncEnvelope = JSON.stringify({ type: "msg", ik: myIK, device_id: deviceId, ...header, ct, nonce });
        const message_id = crypto.randomUUID();
        sessionsRef.current.set(sessionKey, newState);
        const frame = JSON.stringify({ type: "send", message_id, mailbox_id: userId, payload: syncEnvelope });
        socketRef.current!.send(frame);
        pendingAcks.current.set(message_id, { newState, sessionKey });
        addLog("sent", frame);
      }
    }

    appendMessage(rid, "sent", text);
  };

  const clearLog = () => setLog([]);

  useEffect(() => {
    if (isDBConnecting) return;

    getAllValues("keys-table").then(async (dbKeys) => {
      const raw = dbKeys[0];
      if (!raw) return;

      keysRef.current = hydrateKeys(raw);

      const storedSessions = await getAllValues("sessions-table");
      for (const s of storedSessions) {
        sessionsRef.current.set(s.id, hydrateSession(s));
      }

      const contacts = await getAllValues("contacts-table");
      for (const c of contacts) {
        ikToUserIdRef.current.set(c.id, c.user_id);
      }

      const storedMessages = await getAllValues("messages-table");
      for (const m of storedMessages) {
        const existing = conversationsRef.current.get(m.conversation_id) ?? [];
        conversationsRef.current.set(m.conversation_id, [
          ...existing,
          { id: ++msgIdRef.current, kind: m.kind, content: m.content, timestamp: m.timestamp },
        ]);
      }

      const summaries: ConversationSummary[] = [];
      for (const [id, msgs] of Array.from(conversationsRef.current.entries())) {
        const last = msgs[msgs.length - 1];
        summaries.unshift({ id, preview: last.content, timestamp: last.timestamp });
      }
      setConversations(summaries);

      connect();
    });

    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDBConnecting]);

  return {
    wsStatus,
    messages,
    conversations,
    log,
    recipientId,
    setRecipientId,
    sendMessage,
    disconnect,
    clearLog,
  };
}
