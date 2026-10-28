// Copyright (c) 2026, Rademics. All rights reserved.
import { imageTypeOf } from './image-type.js';

describe('audit 1: a picture is known by its own bytes', () => {
  it('recognises JPEG, PNG and WebP, and nothing else', () => {
    expect(imageTypeOf(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(imageTypeOf(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(imageTypeOf(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
    expect(imageTypeOf(Buffer.from('<svg onload="alert(1)">'))).toBeNull();
    expect(imageTypeOf(Buffer.from('<html><script>'))).toBeNull();
    expect(imageTypeOf(new Uint8Array())).toBeNull();
  });
});
