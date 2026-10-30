// Copyright (c) 2026, Rademics. All rights reserved.
// Screen tests wait up to 10 seconds (not 1) for the screen to show something. When the whole
// suite runs at once the computer is busy, and a few tests failed only then (launch check,
// 27 October 2026; audit 14, 30 October 2026, right after the acceptance tests, 3 seconds was not
// enough either). A real problem still fails, just later.
import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 10_000 });

// Audit 9: Finalise and Post ask first (window.confirm). The test browser has no dialog; the screen
// tests answer "yes" unless a test says otherwise.
if (typeof window !== "undefined") window.confirm = () => true;
