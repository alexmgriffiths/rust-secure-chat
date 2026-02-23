import { useEffect, useRef, useState } from "react";
import { useIndexedDB } from "./useIndexDb";
import { computeFingerprint, fetchAllDeviceBundles, toBase64, verifyBundle } from "../crypto/x3dh";
import { RatchetState, decryptTyping, encryptTyping, deserializeSession, serializeSession } from "../crypto/ratchet";
import { deserializeDeviceKeys, fetchOPKCount, generateOPKBatch, uploadOPKBatch, OneTimePreKeyPrivate } from "../crypto/keys";
import { encryptForDevice, decryptInbound } from "../crypto/messaging";
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

function loadUsernames(userId: string): Map<string, string> {
  try {
    const raw = localStorage.getItem(`relay_usernames_${userId}`);
    return raw ? new Map(Object.entries(JSON.parse(raw))) : new Map();
  } catch {
    return new Map();
  }
}

export function useChat(token: string, userId: string, onAuthFailure: () => void) {
  const { getAllValues, putValue, deleteValue, isDBConnecting } = useIndexedDB("keys-db", [
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
  const [usernames, setUsernames] = useState<Map<string, string>>(() => loadUsernames(userId));
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());

  const socketRef = useRef<WebSocket | null>(null);
  const keysRef = useRef<any>(null);
  const sessionsRef = useRef<Map<string, RatchetState>>(new Map());
  const ikToUserIdRef = useRef<Map<string, string>>(new Map());
  const conversationsRef = useRef<Map<string, Message[]>>(new Map());
  const recipientIdRef = useRef("");
  const msgIdRef = useRef(0);
  const logIdRef = useRef(0);
  const pendingAcks = useRef<Map<string, { newState: RatchetState; sessionKey: string }>>(new Map());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  const intentionalDisconnectRef = useRef(false);
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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

  const setTypingForUser = (fromUserId: string, isTyping: boolean) => {
    const existing = typingTimeoutsRef.current.get(fromUserId);
    if (existing) clearTimeout(existing);

    if (isTyping) {
      setTypingUsers((prev) => { const next = new Set(prev); next.add(fromUserId); return next; });
      // Auto-clear if stop_typing is never received
      const t = setTimeout(() => {
        setTypingUsers((prev) => { const next = new Set(prev); next.delete(fromUserId); return next; });
        typingTimeoutsRef.current.delete(fromUserId);
      }, 4000);
      typingTimeoutsRef.current.set(fromUserId, t);
    } else {
      setTypingUsers((prev) => { const next = new Set(prev); next.delete(fromUserId); return next; });
      typingTimeoutsRef.current.delete(fromUserId);
    }
  };

  const notifyTyping = (isTyping: boolean) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return;
    const rid = recipientIdRef.current;
    if (!rid) return;

    // Find all sessions we have with this recipient (one per their device)
    const sessions = Array.from(sessionsRef.current.entries()).filter(([key]) =>
      key.startsWith(`${rid}:`),
    );
    if (sessions.length === 0) return; // No established session yet — skip

    const myIK = toBase64(keysRef.current.publicUpload.identity_x25519_public);
    for (const [, state] of sessions) {
      const { ct, nonce } = encryptTyping(state.typingKey, JSON.stringify({ ik: myIK }));
      const frame = JSON.stringify({
        type: isTyping ? "typing" : "stop_typing",
        mailbox_id: rid,
        payload: JSON.stringify({ ik: myIK, ct, nonce }),
      });
      socketRef.current!.send(frame);
    }
  };

  const saveSession = (key: string, state: RatchetState) => {
    putValue("sessions-table", serializeSession(key, state) as any).catch(
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
    intentionalDisconnectRef.current = false;

    if (isJwtExpired(token)) {
      onAuthFailure();
      return;
    }

    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onopen = () => {
      setWsStatus("connected");
      reconnectDelayRef.current = 1000;
      const lastSeq = parseInt(localStorage.getItem(`relay_last_seq_${userId}`) ?? "0");
      const frame = JSON.stringify({ type: "authenticate", token, last_seq: lastSeq });
      ws.send(frame);
      addLog("sent", frame);
      replenishOPKsIfNeeded();
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

      if (parsed.type === "typing" || parsed.type === "stop_typing") {
        try {
          const { ik, ct, nonce } = JSON.parse(parsed.payload);
          const state = sessionsRef.current.get(ik);
          if (!state) return; // No session for this sender — ignore
          decryptTyping(state.typingKey, ct, nonce); // throws if tampered
          const senderId = ikToUserIdRef.current.get(ik);
          if (senderId) setTypingForUser(senderId, parsed.type === "typing");
        } catch {
          // Wrong key or malformed — silently ignore
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
      if (myDeviceId !== undefined && envelope.device_id !== undefined && envelope.device_id !== myDeviceId) return;

      if (envelope.type === "init" || envelope.type === "msg") {
        if (envelope.type === "init") replenishOPKsIfNeeded();
        try {
          const { plaintext, newState, ik } = decryptInbound(
            keysRef.current,
            (senderIK) => sessionsRef.current.get(senderIK),
            envelope,
          );
          sessionsRef.current.set(ik, newState);
          saveSession(ik, newState);
          const parsedPayload = JSON.parse(plaintext);
          if (parsedPayload.sync) {
            appendMessage(parsedPayload.to, "sent", parsedPayload.text);
          } else {
            saveContact(ik, parsedPayload.sender_id);
            setTypingForUser(parsedPayload.sender_id, false);
            appendMessage(parsedPayload.sender_id, "received", parsedPayload.text);
            // If they sent an init, they started fresh (e.g. reset). Drop our outbound
            // session to them so our next reply also runs a fresh X3DH init rather than
            // sending a "msg" frame they can no longer decrypt.
            if (envelope.type === "init") {
              for (const key of Array.from(sessionsRef.current.keys())) {
                if (key.startsWith(`${parsedPayload.sender_id}:`)) {
                  sessionsRef.current.delete(key);
                  deleteValue("sessions-table", key);
                }
              }
            }
          }
        } catch (err) {
          console.error("Failed to decrypt inbound message:", err);
        }
      }
    };

    ws.onclose = () => {
      setWsStatus("disconnected");
      if (intentionalDisconnectRef.current) return;
      if (isJwtExpired(token)) {
        onAuthFailure();
        return;
      }
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, 30000);
      reconnectTimeoutRef.current = setTimeout(() => connect(), delay);
    };

    ws.onerror = () => setWsStatus("disconnected");
  };

  const disconnect = () => {
    intentionalDisconnectRef.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
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
    const plaintext = JSON.stringify({ sender_id: userId, text });

    // Always fetch the current device list so newly added devices are discovered automatically.
    // For each device: use existing ratchet session if we have one, otherwise X3DH init.
    const bundles = await fetchAllDeviceBundles(rid, token);
    for (const bundle of bundles) {
      if (!verifyBundle(bundle)) {
        console.error("Bundle verification failed for device", bundle.device_id);
        continue;
      }
      const sessionKey = `${rid}:${bundle.device_id}`;
      const { envelope, newState } = encryptForDevice(
        keysRef.current,
        bundle,
        plaintext,
        sessionsRef.current.get(sessionKey) ?? null,
      );
      const message_id = crypto.randomUUID();
      sessionsRef.current.set(sessionKey, newState);
      const frame = JSON.stringify({ type: "send", message_id, mailbox_id: rid, payload: envelope });
      socketRef.current!.send(frame);
      pendingAcks.current.set(message_id, { newState, sessionKey });
      addLog("sent", frame);
    }

    // Sync sent message to own other devices
    const syncPlaintext = JSON.stringify({ sync: true, to: rid, text });
    const ownBundles = await fetchAllDeviceBundles(userId, token);
    for (const bundle of ownBundles) {
      if (bundle.device_id === keysRef.current.device_id) continue; // skip self
      if (!verifyBundle(bundle)) continue;
      const sessionKey = `${userId}:${bundle.device_id}`;
      const { envelope: syncEnvelope, newState } = encryptForDevice(
        keysRef.current,
        bundle,
        syncPlaintext,
        sessionsRef.current.get(sessionKey) ?? null,
      );
      const message_id = crypto.randomUUID();
      sessionsRef.current.set(sessionKey, newState);
      const frame = JSON.stringify({ type: "send", message_id, mailbox_id: userId, payload: syncEnvelope });
      socketRef.current!.send(frame);
      pendingAcks.current.set(message_id, { newState, sessionKey });
      addLog("sent", frame);
    }

    appendMessage(rid, "sent", text);
  };

  const addContact = (contactUserId: string, username: string) => {
    setUsernames((prev) => {
      const next = new Map(prev);
      next.set(contactUserId, username);
      localStorage.setItem(`relay_usernames_${userId}`, JSON.stringify(Object.fromEntries(next)));
      return next;
    });
  };

  const clearLog = () => setLog([]);

  const getFingerprint = (recipientId: string): string | null => {
    if (!keysRef.current) return null;
    // Reverse-look up the recipient's IK from the contact map (IK → userId)
    const theirIK = Array.from(ikToUserIdRef.current.entries())
      .find(([, uid]) => uid === recipientId)?.[0] ?? null;
    if (!theirIK) return null;
    return computeFingerprint(keysRef.current.publicUpload.identity_x25519_public, theirIK);
  };

  const OPK_LOW_WATERMARK = 3;
  const OPK_REPLENISH_COUNT = 10;

  const replenishOPKsIfNeeded = async () => {
    if (!keysRef.current?.device_id) return;
    const deviceId = keysRef.current.device_id;
    try {
      const count = await fetchOPKCount(userId, deviceId, token);
      if (count >= OPK_LOW_WATERMARK) return;

      // Next key ID = one past the highest ID we've ever generated
      const maxId = keysRef.current.privateStore.one_time_prekeys.reduce(
        (m: number, k: OneTimePreKeyPrivate) => Math.max(m, k.key_id),
        0,
      );
      const { publicKeys, privateKeys } = generateOPKBatch(maxId + 1, OPK_REPLENISH_COUNT);
      await uploadOPKBatch(userId, deviceId, token, publicKeys);

      // Update in-memory keys
      keysRef.current.privateStore.one_time_prekeys.push(...privateKeys);
      keysRef.current.publicUpload.one_time_prekeys.push(...publicKeys);

      // Persist updated private keys to IndexedDB
      const rawKeys = await getAllValues("keys-table");
      if (rawKeys[0]) {
        const updated = {
          ...rawKeys[0],
          privateStore: {
            ...rawKeys[0].privateStore,
            one_time_prekeys: keysRef.current.privateStore.one_time_prekeys.map((k: OneTimePreKeyPrivate) => ({
              key_id: k.key_id,
              private_key: Array.from(k.private_key),
            })),
          },
        };
        putValue("keys-table", updated).catch((err) =>
          console.error("Failed to persist new OPKs:", err),
        );
      }
    } catch (err) {
      console.error("OPK replenishment check failed:", err);
    }
  };

  const resetSession = (contactId: string) => {
    // Delete all outbound session keys for this contact (keyed as `${contactId}:${deviceId}`)
    for (const key of Array.from(sessionsRef.current.keys())) {
      if (key.startsWith(`${contactId}:`)) {
        sessionsRef.current.delete(key);
        deleteValue("sessions-table", key);
      }
    }
    // Delete all inbound sessions for this contact — one per device (each device has its own IK)
    const theirIKs = Array.from(ikToUserIdRef.current.entries())
      .filter(([, uid]) => uid === contactId)
      .map(([ik]) => ik);
    for (const ik of theirIKs) {
      if (sessionsRef.current.has(ik)) {
        sessionsRef.current.delete(ik);
        deleteValue("sessions-table", ik);
      }
    }
  };

  useEffect(() => {
    if (isDBConnecting) return;

    getAllValues("keys-table").then(async (dbKeys) => {
      const raw = dbKeys[0];
      if (!raw) return;

      keysRef.current = deserializeDeviceKeys(raw);

      const storedSessions = await getAllValues("sessions-table");
      for (const s of storedSessions) {
        sessionsRef.current.set(s.id, deserializeSession(s));
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
    usernames,
    addContact,
    typingUsers,
    notifyTyping,
    getFingerprint,
    resetSession,
  };
}
