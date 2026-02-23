// High-level send / receive helpers.
// These are the only functions an app needs to call — all X3DH and ratchet
// details are encapsulated here, making this folder portable across
// React, React Native, or any other TypeScript environment.

import { DeviceKeys } from "./keys";
import {
  PreKeyBundle,
  initiateX3DH,
  receiveX3DH,
  toBase64,
} from "./x3dh";
import {
  RatchetState,
  initRatchetReceiver,
  initRatchetSender,
  ratchetDecrypt,
  ratchetEncrypt,
} from "./ratchet";

export type OutboundResult = {
  envelope: string;    // JSON string ready to set as `payload` in a send frame
  newState: RatchetState;
};

export type InboundResult = {
  plaintext: string;
  newState: RatchetState;
  ik: string;          // sender's identity key (base64) — use as session map key
};

/**
 * Encrypt `plaintext` for a single remote device.
 *
 * Pass `existingSession = null` when there is no prior session — X3DH init
 * will be performed and the envelope will be of type "init".
 * Pass the current session when one exists — the ratchet is advanced and
 * the envelope will be of type "msg".
 */
export function encryptForDevice(
  myKeys: DeviceKeys,
  bundle: PreKeyBundle,
  plaintext: string,
  existingSession: RatchetState | null,
): OutboundResult {
  const myIK = toBase64(myKeys.publicUpload.identity_x25519_public);

  if (!existingSession) {
    const x3dh = initiateX3DH(myKeys, bundle);
    const initState = initRatchetSender(
      x3dh.masterSecret,
      x3dh.ekPriv,
      x3dh.ekPub,
      bundle.signed_prekey_public,
    );
    const { state: newState, header, ct, nonce } = ratchetEncrypt(initState, plaintext);
    return {
      envelope: JSON.stringify({
        type: "init",
        ik: myIK,
        ek: toBase64(x3dh.ekPub),
        opk_id: x3dh.opkId,
        device_id: x3dh.deviceId,
        ...header,
        ct,
        nonce,
      }),
      newState,
    };
  } else {
    const { state: newState, header, ct, nonce } = ratchetEncrypt(existingSession, plaintext);
    return {
      envelope: JSON.stringify({
        type: "msg",
        ik: myIK,
        device_id: bundle.device_id,
        ...header,
        ct,
        nonce,
      }),
      newState,
    };
  }
}

/**
 * Decrypt an inbound envelope (either "init" or "msg" type).
 *
 * `sessionLookup` is called with the sender's IK (base64) and must return
 * the current RatchetState for that sender, or undefined if none exists yet.
 *
 * Throws if the session is missing for a "msg" type envelope.
 */
export function decryptInbound(
  myKeys: DeviceKeys,
  sessionLookup: (ik: string) => RatchetState | undefined,
  envelope: any,
): InboundResult {
  const ik: string = envelope.ik;

  if (envelope.type === "init") {
    const { masterSecret } = receiveX3DH(myKeys, envelope);
    const state = initRatchetReceiver(
      masterSecret,
      myKeys.privateStore.signed_prekey_private,
      myKeys.publicUpload.signed_prekey_public,
    );
    const { state: newState, plaintext } = ratchetDecrypt(state, envelope, envelope.ct, envelope.nonce);
    return { plaintext, newState, ik };
  } else {
    const state = sessionLookup(ik);
    if (!state) throw new Error(`No session for sender IK: ${ik}`);
    const { state: newState, plaintext } = ratchetDecrypt(state, envelope, envelope.ct, envelope.nonce);
    return { plaintext, newState, ik };
  }
}
