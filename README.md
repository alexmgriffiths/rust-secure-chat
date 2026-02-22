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
- Safe ratchet state handling — state only advances after a message is confirmed sent, so a failed send can't corrupt the session
- Offline message delivery -
- Multi-device support

## What still needs doing

**User discovery** — Right now you have to paste someone's UUID to message them, which is terrible. A simple username search endpoint on the auth service would fix this, and the sidebar could show names instead of truncated IDs.

**OPK replenishment** — Each new session from a new contact consumes one of your one-time prekeys. You uploaded 10 on registration and never get more. The client should check how many are left on the server after initiating a session and top up when running low.

**Token refresh** — JWTs expire after 15 minutes. There's no refresh token flow, so users have to log in again every 15 minutes. Either a refresh token endpoint or a much longer TTL for development would help.

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
