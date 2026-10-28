// Copyright (c) 2026, Rademics. All rights reserved.
// Owner, 28 October 2026: catch typing mistakes in mobile numbers, PIN codes and PANs.
import { describe, expect, it } from 'vitest';
import { INDIAN_MOBILE, pinCodeStateProblem } from './india.js';
import { addressSchema, createCustomerSchema, createSupplierSchema, supplierPanProblem, updateAddressSchema } from './schemas/parties.js';

describe('mobile numbers', () => {
  it('take 10 digits starting with 6, 7, 8 or 9', () => {
    for (const ok of ['9840012345', '6000000000', '7012345678', '8123456789']) expect(INDIAN_MOBILE.test(ok)).toBe(true);
    for (const bad of ['1234567890', '5840012345', '0984001234', '984001234', '98400123456']) expect(INDIAN_MOBILE.test(bad)).toBe(false);
  });

  it('a customer with a mobile starting with 1 is refused with a plain message', () => {
    const r = createCustomerSchema.safeParse({ name: 'Ravi', mobile: '1234567890' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe('Mobile number must be 10 digits starting with 6, 7, 8 or 9');
  });
});

describe('PIN code and state', () => {
  it('a Bengaluru PIN code is refused for a Tamil Nadu address', () => {
    expect(pinCodeStateProblem('560001', '33')).toBe('PIN code 560001 is not in Tamil Nadu: PIN codes there start with 6. Check the PIN code or the state.');
  });

  it('accepts real addresses, including the places that cross zones', () => {
    const real: [string, string][] = [
      ['600017', '33'], // Chennai, Tamil Nadu
      ['560001', '29'], // Bengaluru, Karnataka
      ['682001', '32'], // Kochi, Kerala
      ['500001', '36'], // Hyderabad, Telangana
      ['403001', '30'], // Panaji, Goa
      ['110001', '07'], // New Delhi
      ['160017', '04'], // Chandigarh
      ['194101', '38'], // Leh, Ladakh
      ['737101', '11'], // Gangtok, Sikkim
      ['744101', '35'], // Port Blair, Andaman and Nicobar
      ['396210', '26'], // Daman
      ['682555', '31'], // Lakshadweep
      ['605001', '34'], // Puducherry
      ['673310', '34'], // Mahe, Puducherry (in Kerala's zone)
      ['533464', '34'], // Yanam, Puducherry (in Andhra Pradesh's zone)
      ['834001', '20'], // Ranchi, Jharkhand
      ['781001', '18'], // Guwahati, Assam
    ];
    for (const [pin, state] of real) expect(pinCodeStateProblem(pin, state), `${pin} in ${state}`).toBeNull();
  });

  it('never refuses an Army post office PIN, or when the PIN or state is missing', () => {
    expect(pinCodeStateProblem('900001', '33')).toBeNull();
    expect(pinCodeStateProblem(null, '33')).toBeNull();
    expect(pinCodeStateProblem('600017', null)).toBeNull();
  });

  it('is checked on a new address and on a change that sends both', () => {
    const address = { addressLine1: '12 MG Road', city: 'Chennai', stateCode: '33', pincode: '560001' };
    const added = addressSchema.safeParse(address);
    expect(added.success).toBe(false);
    expect(added.error?.issues[0].path).toEqual(['pincode']);
    expect(updateAddressSchema.safeParse({ stateCode: '33', pincode: '560001' }).success).toBe(false);
    expect(updateAddressSchema.safeParse({ city: 'Chennai' }).success).toBe(true);
    expect(createCustomerSchema.safeParse({ name: 'Ravi', address }).success).toBe(false);
  });
});

describe('supplier PAN and GSTIN', () => {
  // Characters 3 to 12 of the GSTIN are the PAN.
  const gstin = '33AAACM1234B1ZD';

  it('agree, or the PAN is refused next to its box', () => {
    expect(supplierPanProblem('AAACM1234B', gstin)).toBeNull();
    expect(supplierPanProblem('AAACM1243B', gstin)).toBe('This GSTIN belongs to PAN AAACM1234B, not AAACM1243B. Check the PAN or the GSTIN.');
    const r = createSupplierSchema.safeParse({ name: 'Sri Murugan Traders', gstin, pan: 'AAACM1243B' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.find((i) => i.path[0] === 'pan')).toBeTruthy();
  });

  it('either one alone is fine', () => {
    expect(supplierPanProblem('AAACM1234B', null)).toBeNull();
    expect(supplierPanProblem(null, gstin)).toBeNull();
  });
});
