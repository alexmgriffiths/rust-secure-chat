# Relay

An end-to-end encrypted chat app built as a learning project. Messages are encrypted on the client before they ever leave the browser, and the server only ever sees opaque blobs it can't read.

## How it works

Three pieces:

**auth_service** — A small Rust/Axum HTTP server that handles user registration, login, and public key storage. When a user registers, their device generates a set of cryptographic keys and uploads the public halves here. The private keys never leave the browser.

**socket_server** — A Rust WebSocket server that acts as a dumb message router. It authenticates connections with a JWT, then forwards encrypted payloads between users. It has no idea what's inside any message.

**web_client_2** — A React/TypeScript frontend that does all the actual crypto work. It uses the Signal protocol (X3DH for session setup, Double Ratchet for ongoing messages) to encrypt everything before sending.

## The crypto

When Alice messages Bob for the first time, her client fetches Bob's public keys from the auth service and runs an X3DH key exchange to derive a shared secret — without either of them having talked before. That shared secret seeds a Double Ratchet, which generates a fresh encryption key for every single message. Past messages stay safe even if a key is ever compromised.

All message content is encrypted with ChaCha20-Poly1305. The server sees who's connected but never sees plaintext.

Message history is stored locally in IndexedDB because there's no way to re-decrypt it server-side — that's the point.

## What's done

- User registration and login (JWT-based)
- Device key generation on first login (Ed25519 identity key, X25519 signed prekey, 10 one-time prekeys)
- Key upload to auth service and retrieval for X3DH
- Full X3DH session initiation between two users
- Double Ratchet encryption for all messages after session setup
- Message history persisted locally in IndexedDB
- Conversation sidebar showing all active threads
- JWT expiry detection — redirects to login before the socket even opens
- Safe ratchet state handling — ratchet state advances in-memory immediately on encrypt and persists to IndexedDB only after the server ACKs the message, preventing key reuse on rapid sends while keeping IndexedDB consistent
- Offline message delivery — every message is persisted to Postgres before the server ACKs it; each device tracks a sequence cursor so it only fetches messages it hasn't seen yet on reconnect
- Multi-device support — each device is an independent X3DH identity; senders encrypt separately for every recipient device and sync sent messages to their own other devices; device ID filtering ensures each device only decrypts frames addressed to it
- WebSocket auto-reconnect — exponential backoff from 1s up to 30s on any unintentional disconnect; seamlessly re-authenticates and flushes missed messages via the sequence cursor
- Redis-backed multi-server routing — connections are tracked in Redis so messages route correctly across socket server instances; pub/sub delivers to the right server in real time
- User discovery — username search on the auth service with trigram similarity; sidebar shows names instead of truncated IDs; new conversations started by searching, not pasting UUIDs

## What still needs doing

**OPK replenishment** — Each new session from a new contact consumes one of your one-time prekeys. You uploaded 10 on registration and never get more. The client should check how many are left on the server after initiating a session and top up when running low.

**Skipped message keys** — The Double Ratchet implementation doesn't store keys for skipped messages. Out-of-order delivery would break the receive chain. The fix is a per-session map of `(ratchet_pub, message_number) → message_key` checked before the normal decrypt path.

**Session reset** — If a ratchet session gets permanently desynced there's no recovery path short of clearing IndexedDB. A "reset conversation" button that drops all sessions for a contact and forces a fresh X3DH init on the next message would fix this.

High value, low effort:

OPK replenishment — Already in your TODO and it's a real security gap. After any X3DH init, fire a check: GET /users/:id/devices to see remaining OPK count, top up if below a threshold. Maybe 20 lines of client code + a new auth service endpoint.

Medium value, medium effort:

Session reset — The escape hatch when things go wrong. A "Reset conversation" button that wipes all sessions for a contact and forces fresh X3DH on next send. Without it a desynced session is unrecoverable short of clearing all of IndexedDB.
Delivery/read receipts — delivered_at already exists in the DB. "Read" would be a new ack frame the client sends when a message is displayed. Small protocol addition, big UX improvement.

High value, high effort (probably not now):

Group chats — Needs Sender Keys (Signal's group protocol) or a simpler fan-out approach. Major protocol work.
Media sharing — Needs a separate upload service and encrypted attachment handling.
Push notifications — Web Push API for browsers, then APNs/FCM for mobile. Significant infra.

## Running it

You'll need Postgres running. The docker-compose file covers that.

```
docker-compose up -d
```

Then start each service:

```
# Auth service
cd auth_service && cargo run

# Socket server
cd socket_server && cargo run

# Web client
cd web_client_2 && npm start
```

The auth service runs on port 3000, socket server on 9901, and the React app on 3001.
