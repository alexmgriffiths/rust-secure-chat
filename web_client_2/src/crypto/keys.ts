import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import axios from "axios";

type OneTimePreKeyPublic = { key_id: number; public_key: Uint8Array };
type OneTimePreKeyPrivate = { key_id: number; private_key: Uint8Array };

export type DeviceKeys = {
  device_id?: number; // assigned by the server after upload, stored alongside keys

  publicUpload: {
    // Identity keys (two-key model)
    identity_x25519_public: Uint8Array; // for DH
    identity_ed25519_public: Uint8Array; // for verifying SPK signature

    signed_prekey_id: number;
    signed_prekey_public: Uint8Array;
    signed_prekey_signature: Uint8Array;

    one_time_prekeys: OneTimePreKeyPublic[];
  };

  privateStore: {
    identity_x25519_private: Uint8Array;
    identity_ed25519_private: Uint8Array;

    signed_prekey_id: number;
    signed_prekey_private: Uint8Array;

    one_time_prekeys: OneTimePreKeyPrivate[];
  };
};

// Restore a DeviceKeys object from its IndexedDB-persisted form.
// Each Uint8Array field may come back as a plain {0:x,1:y,...} object,
// a number[], or a Uint8Array — Object.values handles all three cases.
export function deserializeDeviceKeys(raw: any): DeviceKeys {
  const b = (v: any): Uint8Array => new Uint8Array(Object.values(v) as number[]);
  return {
    device_id: raw.device_id,
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

export function generateDeviceKeys(): DeviceKeys {
  // One Ed25519 keypair serves as the identity — same secret, two coordinate systems.
  // toMontgomerySecret / toMontgomery convert to X25519 form for DH operations.
  const identity_ed25519_private = ed25519.utils.randomSecretKey();
  const identity_ed25519_public = ed25519.getPublicKey(
    identity_ed25519_private,
  );
  const identity_x25519_private = ed25519.utils.toMontgomerySecret(
    identity_ed25519_private,
  );
  const identity_x25519_public = ed25519.utils.toMontgomery(
    identity_ed25519_public,
  );

  // Signed PreKey (X25519) + signature by Ed25519 identity
  const signed_prekey_id = 1;
  const signed_prekey_private = x25519.utils.randomSecretKey();
  const signed_prekey_public = x25519.getPublicKey(signed_prekey_private);
  const signed_prekey_signature = ed25519.sign(
    signed_prekey_public,
    identity_ed25519_private,
  );

  // One-time prekeys (X25519)
  const one_time_prekeys_public: OneTimePreKeyPublic[] = [];
  const one_time_prekeys_private: OneTimePreKeyPrivate[] = [];

  for (let i = 1; i <= 10; i++) {
    const private_key = x25519.utils.randomSecretKey();
    const public_key = x25519.getPublicKey(private_key);
    one_time_prekeys_public.push({ key_id: i, public_key });
    one_time_prekeys_private.push({ key_id: i, private_key });
  }

  return {
    publicUpload: {
      identity_x25519_public,
      identity_ed25519_public,
      signed_prekey_id,
      signed_prekey_public,
      signed_prekey_signature,
      one_time_prekeys: one_time_prekeys_public,
    },
    privateStore: {
      identity_x25519_private,
      identity_ed25519_private,
      signed_prekey_id,
      signed_prekey_private,
      one_time_prekeys: one_time_prekeys_private,
    },
  };
}

export async function uploadDeviceKeys(
  userId: string,
  token: string,
  keys: any,
  deviceName: string,
): Promise<number> {
  const response = await axios.post(
    `http://localhost:3000/users/${userId}/devices`,
    {
      device_name: deviceName,
      identity_key_ed25519_public: Array.from(keys.identity_ed25519_public),
      identity_key_x25519_public: Array.from(keys.identity_x25519_public),
      signed_prekey_id: keys.signed_prekey_id,
      signed_prekey_public: Array.from(keys.signed_prekey_public),
      signed_prekey_signature: Array.from(keys.signed_prekey_signature),
      one_time_prekeys: keys.one_time_prekeys.map((k: any) => ({
        key_id: k.key_id,
        public_key: Array.from(k.public_key),
      })),
    },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return response.data.device_id as number;
}
