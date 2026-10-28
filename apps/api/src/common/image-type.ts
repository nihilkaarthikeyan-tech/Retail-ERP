// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 1 (28 October 2026): a picture's type is read from its first bytes, not taken from what
// the browser says, so a file that is not really a picture is never stored and served back as one.

/** The image type the bytes really are, or null. */
export function imageTypeOf(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const b = (i: number) => bytes[i];
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b(i) === v)) return 'image/png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
