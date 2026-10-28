// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 4: a document with a registered e-invoice (IRN) cannot be cancelled in
// the shop until the IRN is cancelled on the portal (within 24 hours), else a
// return or credit note must be made (e-invoice cancellation rules, GSTN).
import type { Db } from '../audit/audit.service.js';

export async function hasLiveIrn(db: Db, documentType: string, documentId: string): Promise<boolean> {
  const e = await db.eInvoice.findUnique({ where: { documentType_documentId: { documentType, documentId } }, select: { status: true } });
  return e?.status === 'registered';
}

export const LIVE_IRN_MESSAGE = 'This document has a registered e-invoice (IRN). Cancel the IRN on the e-invoice portal first (possible within 24 hours), then cancel here; after that, make a return instead';
