// Copyright (c) 2026, Rademics. All rights reserved.
import { diffRecords } from './audit.service.js';

describe('diffRecords', () => {
  it('lists only the fields that changed, with old and new values', () => {
    const before = { name: 'Main Store', city: 'Chennai', active: true, phone: null };
    const after = { name: 'Main Store', city: 'Coimbatore', active: true, phone: '9876543210' };
    expect(diffRecords(before, after)).toEqual({
      city: { old: 'Chennai', new: 'Coimbatore' },
      phone: { old: null, new: '9876543210' },
    });
  });

  it('never records password hashes or bookkeeping fields', () => {
    const changes = diffRecords(
      { passwordHash: 'a', updatedAt: new Date(1), email: 'x@y.z' },
      { passwordHash: 'b', updatedAt: new Date(2), email: 'x@y.z' },
    );
    expect(changes).toEqual({});
  });

  it('treats equal dates as unchanged and different dates as changed', () => {
    const d = new Date('2026-04-01T00:00:00Z');
    expect(diffRecords({ startDate: d }, { startDate: new Date(d) })).toEqual({});
    expect(diffRecords({ startDate: d }, { startDate: new Date('2026-04-02T00:00:00Z') })).toEqual({
      startDate: { old: '2026-04-01T00:00:00.000Z', new: '2026-04-02T00:00:00.000Z' },
    });
  });
});
