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
