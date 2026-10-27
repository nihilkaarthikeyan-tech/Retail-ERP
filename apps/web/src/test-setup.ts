// Copyright (c) 2026, Rademics. All rights reserved.
// Screen tests wait up to 3 seconds (not 1) for the screen to show something. When the whole
// suite runs at once the computer is busy, and a few tests failed only then (launch check,
// 27 October 2026); a real problem still fails, just 2 seconds later.
import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 3000 });
