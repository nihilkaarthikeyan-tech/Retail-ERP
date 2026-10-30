// Copyright (c) 2026, Rademics. All rights reserved.
// Screen tests wait up to 3 seconds (not 1) for the screen to show something. When the whole
// suite runs at once the computer is busy, and a few tests failed only then (launch check,
// 27 October 2026); a real problem still fails, just 2 seconds later.
import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 3000 });

// Audit 9: Finalise and Post ask first (window.confirm). The test browser has no dialog; the screen
// tests answer "yes" unless a test says otherwise.
if (typeof window !== "undefined") window.confirm = () => true;
