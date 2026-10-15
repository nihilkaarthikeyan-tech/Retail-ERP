// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState } from "react";
import { Button, RadioInput } from "@/components/ui";
import { BILL_KIND_LABELS } from "@/lib/purchasing";
import { KIND_EXPLANATIONS, type NewBillKind } from "./bills-lines";

const KINDS: NewBillKind[] = ["against_receipt", "receives_goods", "services"];

/** First step of recording a bill: what kind of bill is it? */
export function BillKindChooser({ onChoose }: { onChoose: (kind: NewBillKind) => void }) {
  const [kind, setKind] = useState<NewBillKind>("against_receipt");
  return (
    <>
      <h1>Record a supplier bill</h1>
      <div className="card">
        <fieldset>
          <legend>What is this bill for?</legend>
          {KINDS.map((k) => (
            <RadioInput key={k} id={`bill-kind-${k}`} name="bill-kind" value={k} checked={kind === k} onChange={() => setKind(k)} label={BILL_KIND_LABELS[k]} description={KIND_EXPLANATIONS[k]} />
          ))}
        </fieldset>
        <div className="actions">
          <Button variant="primary" onClick={() => onChoose(kind)}>
            Next
          </Button>
        </div>
      </div>
    </>
  );
}
