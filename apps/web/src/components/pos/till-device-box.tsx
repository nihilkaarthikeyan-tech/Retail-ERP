// Copyright (c) 2026, Rademics. All rights reserved.
// Pairing this browser with a till (pos-offline plan §9) and with the Till Helper.
"use client";

import { useState, useSyncExternalStore } from "react";
import { Alert, Button, Dialog, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { getTillDevice, setTillDevice } from "@/lib/till-device";
import { type TillDto, TILL_HELPER_TOKEN_KEY } from "./pos-shared";

const noop = () => () => {};

/** The till this browser is registered as (read after hydration only). */
function useThisComputerTill(): string {
  return useSyncExternalStore(
    noop,
    () => getTillDevice()?.tillId ?? "",
    () => "",
  );
}

function readHelperToken(): string {
  try {
    return localStorage.getItem(TILL_HELPER_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function TillDeviceBox({ till, canSetup, onRegistered }: { till: TillDto; canSetup: boolean; onRegistered?: () => void }) {
  const storedTillId = useThisComputerTill();
  const [registeredNow, setRegisteredNow] = useState(false);
  const [deviceName, setDeviceName] = useState(`Till ${till.code} computer`);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isThisOne = registeredNow || storedTillId === till.id;

  async function register() {
    setError(null);
    const name = deviceName.trim();
    if (!name) {
      setError("Give this computer a name, for example “Counter 1”.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ deviceId: string; token: string }>(`/pos/tills/${till.id}/register`, { deviceName: name });
      setTillDevice({ tillId: till.id, tillCode: till.code, deviceName: name, token: res.token });
      setRegisteredNow(true);
      setConfirming(false);
      onRegistered?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Till computer</h2>
      {till.devices.length ? (
        <dl className="kv">
          {till.devices.map((d) => (
            <div key={d.id} style={{ display: "contents" }}>
              <dt>Registered computer</dt>
              <dd>
                {d.deviceName} <span className="muted">(last seen {formatDateTime(d.lastSeenAt)})</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">No computer is registered for this till yet, so nobody can bill on it.</p>
      )}
      {isThisOne ? <Alert kind="success">This computer is till {till.code}.</Alert> : null}
      <Alert kind="error">{error}</Alert>
      {canSetup ? (
        <>
          <p className="muted">Open this page on the counter computer and press the button there. Only one computer can be a till at a time.</p>
          <div className="form-grid">
            <TextInput id="till-device-name" label="Name of this computer" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} autoComplete="off" />
          </div>
          <div className="actions">
            <Button variant="primary" onClick={() => setConfirming(true)}>
              Use this computer as till {till.code}
            </Button>
          </div>
        </>
      ) : null}
      <Dialog open={confirming} title={`Use this computer as till ${till.code}?`} onClose={() => setConfirming(false)}>
        <Alert kind="info">
          {till.devices.length
            ? `The computer registered now (${till.devices.map((d) => d.deviceName).join(", ")}) will stop working as till ${till.code}. Make sure its bills have all been sent first.`
            : `This browser will be able to bill as till ${till.code}.`}
        </Alert>
        <Alert kind="error">{error}</Alert>
        <div className="actions">
          <Button variant="primary" busy={busy} onClick={() => void register()}>
            Yes, use this computer
          </Button>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      </Dialog>
    </div>
  );
}

/** Where the Till Helper listens on the till computer itself (pos-offline plan §9). */
export const TILL_HELPER_URL = "http://127.0.0.1:47120";

/**
 * Pairs this browser with the Till Helper (printer and cash drawer): the helper
 * shows a 6-digit code when it starts; the code is exchanged once for the
 * helper's token, which is kept in this browser only.
 */
export function HelperPairingBox() {
  const stored = useSyncExternalStore(noop, readHelperToken, () => "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState(false);

  async function pair() {
    setError(null);
    if (!/^d{6}$/.test(code.trim())) {
      setError("Type the 6-digit code the Till Helper shows.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${TILL_HELPER_URL}/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim() }) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: string; error?: string };
      if (!res.ok || !body.token) throw new Error(body.error ?? "The Till Helper refused the code");
      localStorage.setItem(TILL_HELPER_TOKEN_KEY, body.token);
      setPaired(true);
      setCode("");
    } catch (err) {
      setError(err instanceof TypeError ? "The Till Helper is not running on this computer." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function forget() {
    try {
      localStorage.removeItem(TILL_HELPER_TOKEN_KEY);
    } catch {
      // Nothing stored.
    }
    setPaired(false);
  }

  const isPaired = paired || !!stored;
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Till Helper (printer and cash drawer)</h2>
      <p className="muted">The Till Helper on this computer drives the receipt printer and cash drawer. When it starts it shows a 6-digit pairing code; type it here once.</p>
      {isPaired ? <Alert kind="success">This computer is paired with its Till Helper.</Alert> : null}
      <Alert kind="error">{error}</Alert>
      <div className="form-grid">
        <TextInput id="till-helper-code" label="Pairing code" className="mono" inputMode="numeric" value={code} autoComplete="off" onChange={(e) => setCode(e.target.value)} />
      </div>
      <div className="actions">
        <Button busy={busy} onClick={() => void pair()}>
          Pair
        </Button>
        {isPaired ? <Button onClick={forget}>Forget the pairing</Button> : null}
      </div>
    </div>
  );
}
