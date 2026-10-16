// Copyright (c) 2026, Rademics. All rights reserved.
// Which till this computer is (pos-offline plan §9). Set by the back-office
// "Use this computer as till …" button after POST /pos/tills/:id/register;
// read by the till screen, which sends the token as the x-till-token header.
// Kept in this browser only; never sent anywhere else.

export interface TillDeviceInfo {
  tillId: string;
  tillCode: string;
  deviceName: string;
  token: string;
}

const KEY = "retail-erp:till-device";
export const TILL_TOKEN_HEADER = "x-till-token";

export function getTillDevice(): TillDeviceInfo | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<TillDeviceInfo>;
    return v.tillId && v.token && v.tillCode ? (v as TillDeviceInfo) : null;
  } catch {
    return null;
  }
}

export function setTillDevice(info: TillDeviceInfo): void {
  localStorage.setItem(KEY, JSON.stringify(info));
}

export function clearTillDevice(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}
