// Copyright (c) 2026, Rademics. All rights reserved.
// GST state codes as published on the GST portal (https://www.gst.gov.in).

export const INDIAN_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

// Object key order puts "10"–"38" before "01"–"09" (integer-like keys first),
// so lists for dropdowns must come from here, sorted by code.
export const STATE_CODES = Object.keys(INDIAN_STATES).sort();

/** [code, name] pairs sorted by code, for dropdowns. */
export const INDIAN_STATE_OPTIONS: [string, string][] = STATE_CODES.map((code) => [code, INDIAN_STATES[code]]);

export function isStateCode(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(INDIAN_STATES, value);
}

/** "Karnataka (29)" for messages; the code alone if it is not a state. */
export function stateWithCode(code: string): string {
  return INDIAN_STATES[code] ? `${INDIAN_STATES[code]} (${code})` : code;
}

/**
 * India Post's PIN zones: the first digit of every PIN code (https://www.indiapost.gov.in).
 * Coarse on purpose, so a genuine address is never refused: only a PIN code from a different
 * zone than its state is caught (owner, 28 October 2026: "state Tamil Nadu, PIN 560001").
 * Puducherry spans two zones (Mahe is in Kerala's, Yanam in Andhra Pradesh's). PIN codes
 * starting with 9 are the Army and field post offices, valid anywhere.
 */
const PIN_ZONES: Record<string, string> = {
  '01': '1', '02': '1', '03': '1', '04': '1', '06': '1', '07': '1', '38': '1',
  '05': '2', '09': '2',
  '08': '3', '24': '3', '26': '3',
  '22': '4', '23': '4', '27': '4', '30': '4',
  '29': '5', '36': '5', '37': '5', '34': '56',
  '31': '6', '32': '6', '33': '6',
  '11': '7', '12': '7', '13': '7', '14': '7', '15': '7', '16': '7', '17': '7', '18': '7', '19': '7', '21': '7', '35': '7',
  '10': '8', '20': '8',
};

/** Why a PIN code cannot be in that state, or null when it can (or one of them is missing). */
export function pinCodeStateProblem(pincode: string | null | undefined, stateCode: string | null | undefined): string | null {
  const pin = pincode?.trim();
  if (!pin || !stateCode || !/^[1-9]\d{5}$/.test(pin) || pin.startsWith('9')) return null;
  const zones = PIN_ZONES[stateCode];
  if (!zones || zones.includes(pin[0])) return null;
  const starts = zones.split('').join(' or ');
  return `PIN code ${pin} is not in ${INDIAN_STATES[stateCode]}: PIN codes there start with ${starts}. Check the PIN code or the state.`;
}

/** Indian mobile numbers have 10 digits and start with 6, 7, 8 or 9. */
export const INDIAN_MOBILE = /^[6-9]\d{9}$/;
export const INDIAN_MOBILE_MESSAGE = 'Mobile number must be 10 digits starting with 6, 7, 8 or 9';
