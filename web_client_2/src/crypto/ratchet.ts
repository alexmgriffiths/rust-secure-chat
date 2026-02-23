import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { toBase64, fromBase64 } from "./x3dh";

const MAX_SKIP = 1000;

export type RatchetKeypair = { pub: Uint8Array; priv: Uint8Array };

export type RatchetState = {
  RK: Uint8Array;
  CKs: Uint8Array | null;
  CKr: Uint8Array | null;
  DHs: RatchetKeypair;
  DHr: Uint8Array | null;
  Ns: number;
  Nr: number;
  PN: number;
  skippedKeys: Map<string, Uint8Array>; // `${dh_pub_b64}:${n}` -> MK
  typingKey: Uint8Array; // derived from masterSecret, never rotates, used for typing indicators
};

export type RatchetHeader = {
  dh: string; // base64 current DHs pub
  n: number;  // message number on this chain
  pn: number; // messages sent on previous chain
};

function KDF_RK(
  RK: Uint8Array,
  dhOut: Uint8Array,
): { newRK: Uint8Array; newCK: Uint8Array } {
  const out = hkdf(sha256, dhOut, RK, new TextEncoder().encode("ratchet"), 64);
  return { newRK: out.slice(0, 32), newCK: out.slice(32) };
}

function KDF_CK(CK: Uint8Array): { newCK: Uint8Array; MK: Uint8Array } {
  const out = hkdf(
    sha256,
    CK,
    new Uint8Array(1),
    new TextEncoder().encode("msg_keys"),
    64,
  );
  return { newCK: out.slice(0, 32), MK: out.slice(32) };
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function skipMessageKeys(state: RatchetState, until: number): RatchetState {
  if (until - state.Nr > MAX_SKIP) {
    throw new Error(`Too many skipped messages: gap of ${until - state.Nr}`);
  }
  const newSkipped = new Map(state.skippedKeys);
  let { CKr, Nr } = state;
  const dhKey = toBase64(state.DHr!);
  while (Nr < until) {
    const { newCK, MK } = KDF_CK(CKr!);
    newSkipped.set(`${dhKey}:${Nr}`, MK);
    CKr = newCK;
    Nr++;
  }
  return { ...state, CKr, Nr, skippedKeys: newSkipped };
}

function deriveTypingKey(masterSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, masterSecret, new Uint8Array(32), new TextEncoder().encode("typing"), 32);
}

export function initRatchetSender(
  masterSecret: Uint8Array,
  ekPriv: Uint8Array,
  ekPub: Uint8Array,
  bobSPKPub: Uint8Array,
): RatchetState {
  const typingKey = deriveTypingKey(masterSecret);
  const DHs: RatchetKeypair = { priv: ekPriv, pub: ekPub };
  const DHr = bobSPKPub;
  const dhOut = x25519.getSharedSecret(DHs.priv, DHr);
  const { newRK, newCK } = KDF_RK(masterSecret, dhOut);
  return { RK: newRK, CKs: newCK, CKr: null, DHs, DHr, Ns: 0, Nr: 0, PN: 0, skippedKeys: new Map(), typingKey };
}

export function initRatchetReceiver(
  masterSecret: Uint8Array,
  spkPriv: Uint8Array,
  spkPub: Uint8Array,
): RatchetState {
  const typingKey = deriveTypingKey(masterSecret);
  const DHs: RatchetKeypair = { priv: spkPriv, pub: spkPub };
  return {
    RK: masterSecret,
    CKs: null,
    CKr: null,
    DHs,
    DHr: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    skippedKeys: new Map(),
    typingKey,
  };
}

export function encryptTyping(typingKey: Uint8Array, payload: string): { ct: string; nonce: string } {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = chacha20poly1305(typingKey, nonce).encrypt(new TextEncoder().encode(payload));
  return { ct: toBase64(ct), nonce: toBase64(nonce) };
}

export function decryptTyping(typingKey: Uint8Array, ct: string, nonce: string): string {
  const plaintext = chacha20poly1305(typingKey, fromBase64(nonce)).decrypt(fromBase64(ct));
  return new TextDecoder().decode(plaintext);
}

export function ratchetEncrypt(
  state: RatchetState,
  plaintext: string,
): { state: RatchetState; header: RatchetHeader; ct: string; nonce: string } {
  const { newCK, MK } = KDF_CK(state.CKs!);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = chacha20poly1305(MK, nonce).encrypt(
    new TextEncoder().encode(plaintext),
  );
  const header: RatchetHeader = {
    dh: toBase64(state.DHs.pub),
    n: state.Ns,
    pn: state.PN,
  };
  const newState: RatchetState = { ...state, CKs: newCK, Ns: state.Ns + 1 };
  return { state: newState, header, ct: toBase64(ct), nonce: toBase64(nonce) };
}

export function ratchetDecrypt(
  state: RatchetState,
  header: RatchetHeader,
  ct: string,
  nonce: string,
): { state: RatchetState; plaintext: string } {
  const ctBytes = fromBase64(ct);
  const nonceBytes = fromBase64(nonce);
  const newDHr = fromBase64(header.dh);

  let s: RatchetState = { ...state, skippedKeys: new Map(state.skippedKeys) };

  // Check skipped keys cache first — handles out-of-order / late-arriving messages
  const skippedKey = `${header.dh}:${header.n}`;
  if (s.skippedKeys.has(skippedKey)) {
    const MK = s.skippedKeys.get(skippedKey)!;
    const newSkipped = new Map(s.skippedKeys);
    newSkipped.delete(skippedKey);
    const plaintextBytes = chacha20poly1305(MK, nonceBytes).decrypt(ctBytes);
    return {
      state: { ...s, skippedKeys: newSkipped },
      plaintext: new TextDecoder().decode(plaintextBytes),
    };
  }

  // DH ratchet step — triggered whenever we see a new ratchet public key from the other side
  if (s.DHr === null || !arraysEqual(newDHr, s.DHr)) {
    // Save any skipped message keys on the current receiving chain before rotating
    if (s.DHr !== null && s.CKr !== null) {
      s = skipMessageKeys(s, header.pn);
    }

    s = { ...s, PN: s.Ns, Ns: 0, Nr: 0 };

    // Derive the new receiving chain using the other side's new ratchet key
    const dhOut1 = x25519.getSharedSecret(s.DHs.priv, newDHr);
    const { newRK: rk1, newCK: ckr } = KDF_RK(s.RK, dhOut1);
    s = { ...s, RK: rk1, CKr: ckr, DHr: newDHr };

    // Generate a fresh sending keypair and seed the new sending chain
    const newPriv = x25519.utils.randomSecretKey();
    const newPub = x25519.getPublicKey(newPriv);
    const dhOut2 = x25519.getSharedSecret(newPriv, newDHr);
    const { newRK: rk2, newCK: cks } = KDF_RK(s.RK, dhOut2);
    s = { ...s, RK: rk2, CKs: cks, DHs: { priv: newPriv, pub: newPub } };
  }

  // Skip ahead to message n, caching any keys we step over
  s = skipMessageKeys(s, header.n);

  const { newCK, MK } = KDF_CK(s.CKr!);
  const plaintextBytes = chacha20poly1305(MK, nonceBytes).decrypt(ctBytes);

  return {
    state: { ...s, CKr: newCK, Nr: s.Nr + 1 },
    plaintext: new TextDecoder().decode(plaintextBytes),
  };
}
