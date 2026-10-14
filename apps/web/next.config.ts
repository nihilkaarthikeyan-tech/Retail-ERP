// Copyright (c) 2026, Rademics. All rights reserved.
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Image resizing needs the `sharp` package (LGPL libvips), which we exclude
  // in the root package.json under the licence rules. Images are served as-is.
  images: { unoptimized: true },
  partialPrefetching: true,
};

export default nextConfig;
