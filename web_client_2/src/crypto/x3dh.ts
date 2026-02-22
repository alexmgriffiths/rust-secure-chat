import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import axios from "axios";
import { DeviceKeys } from "./keys";

type OneTimePrekey = {
  key_id: number;
  public_key: Uint8Array;
};

export type PreKeyBundle = {
  device_id: number;
  identity_key_ed25519_public: Uint8Array;
  identity_key_x25519_public: Uint8Array;
  signed_prekey_id: number;
  signed_prekey_public: Uint8Array;
  signed_prekey_signature: Uint8Array;
  one_time_prekey: OneTimePrekey | null;
};

export type X3DHResult = {
  masterSecret: Uint8Array;
  ekPriv: Uint8Array;
  ekPub: Uint8Array;
  opkId: number | null;
  deviceId: number;
};

export type InitHeader = {
  ik: string;
  ek: string;
  opk_id: number | null;
  device_id: number;
};

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
}

export function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function fetchAllDeviceBundles(
  recipientId: string,
  token: string,
): Promise<PreKeyBundle[]> {
  const { data } = await axios.get(
    `http://localhost:3000/users/${recipientId}/all-keys`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  // Server returns byte arrays as plain number arrays — convert back to Uint8Array
  let devices: PreKeyBundle[] = [];
  data.forEach((device: any) => {
    devices.push({
      device_id: device.device_id,
      identity_key_ed25519_public: new Uint8Array(
        device.identity_key_ed25519_public,
      ),
      identity_key_x25519_public: new Uint8Array(
        device.identity_key_x25519_public,
      ),
      signed_prekey_id: device.signed_prekey_id,
      signed_prekey_public: new Uint8Array(device.signed_prekey_public),
      signed_prekey_signature: new Uint8Array(device.signed_prekey_signature),
      one_time_prekey: device.one_time_prekey
        ? {
            key_id: device.one_time_prekey.key_id,
            public_key: new Uint8Array(device.one_time_prekey.public_key),
          }
        : null,
    });
  });
  return devices;
}

export async function fetchPrekeyBundle(
  recipientId: string,
  token: string,
): Promise<PreKeyBundle> {
  const { data } = await axios.get(
    `http://localhost:3000/users/${recipientId}/keys`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  // Server returns byte arrays as plain number arrays — convert back to Uint8Array
  return {
    device_id: data.device_id,
    identity_key_ed25519_public: new Uint8Array(
      data.identity_key_ed25519_public,
    ),
    identity_key_x25519_public: new Uint8Array(data.identity_key_x25519_public),
    signed_prekey_id: data.signed_prekey_id,
    signed_prekey_public: new Uint8Array(data.signed_prekey_public),
    signed_prekey_signature: new Uint8Array(data.signed_prekey_signature),
    one_time_prekey: data.one_time_prekey
      ? {
          key_id: data.one_time_prekey.key_id,
          public_key: new Uint8Array(data.one_time_prekey.public_key),
        }
      : null,
  };
}

export function verifyBundle(bundle: PreKeyBundle): boolean {
  const valid = ed25519.verify(
    bundle.signed_prekey_signature,
    bundle.signed_prekey_public,
    bundle.identity_key_ed25519_public,
  );
  return valid;
}

export function initiateX3DH(
  myKeys: DeviceKeys,
  bundle: PreKeyBundle,
): X3DHResult {
  // Fresh ephemeral keypair — used once, then becomes the first ratchet keypair
  const ekPriv = x25519.utils.randomSecretKey();
  const ekPub = x25519.getPublicKey(ekPriv);

  // Four DH operations
  const DH1 = x25519.getSharedSecret(
    myKeys.privateStore.identity_x25519_private,
    bundle.signed_prekey_public,
  );
  const DH2 = x25519.getSharedSecret(ekPriv, bundle.identity_key_x25519_public);
  const DH3 = x25519.getSharedSecret(ekPriv, bundle.signed_prekey_public);

  const dhInput = bundle.one_time_prekey
    ? concatBytes(
        DH1,
        DH2,
        DH3,
        x25519.getSharedSecret(ekPriv, bundle.one_time_prekey.public_key),
      )
    : concatBytes(DH1, DH2, DH3);

  // HKDF with 32 zero bytes as salt, new TextEncoder().encode("X3DH") as info
  const masterSecret = hkdf(
    sha256,
    dhInput,
    new Uint8Array(32),
    new TextEncoder().encode("X3DH"),
    32,
  );

  return {
    masterSecret,
    ekPriv,
    ekPub,
    opkId: bundle.one_time_prekey?.key_id ?? null,
    deviceId: bundle.device_id,
  };
}

export function receiveX3DH(
  myKeys: DeviceKeys,
  header: InitHeader,
): { masterSecret: Uint8Array } {
  const aliceIKx25519 = fromBase64(header.ik);
  const aliceEK = fromBase64(header.ek);

  // Look up the consumed OPK private key by key_id
  const opkEntry =
    header.opk_id !== null
      ? myKeys.privateStore.one_time_prekeys.find(
          (k) => k.key_id === header.opk_id,
        )
      : null;

  // Mirror DH operations — same inputs, same outputs
  const DH1 = x25519.getSharedSecret(
    myKeys.privateStore.signed_prekey_private,
    aliceIKx25519,
  );
  const DH2 = x25519.getSharedSecret(
    myKeys.privateStore.identity_x25519_private,
    aliceEK,
  );
  const DH3 = x25519.getSharedSecret(
    myKeys.privateStore.signed_prekey_private,
    aliceEK,
  );

  const dhInput = opkEntry
    ? concatBytes(
        DH1,
        DH2,
        DH3,
        x25519.getSharedSecret(opkEntry.private_key, aliceEK),
      )
    : concatBytes(DH1, DH2, DH3);

  const masterSecret = hkdf(
    sha256,
    dhInput,
    new Uint8Array(32),
    new TextEncoder().encode("X3DH"),
    32,
  );

  return { masterSecret };
}
