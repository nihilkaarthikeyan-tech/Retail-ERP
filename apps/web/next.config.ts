// Copyright (c) 2026, Rademics. All rights reserved.
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Image resizing needs the `sharp` package (LGPL libvips), which we exclude
  // in the root package.json under the licence rules. Images are served as-is.
  images: { unoptimized: true },
  partialPrefetching: true,
  // Code audit, 27 October 2026: standard browser protections. No other site may show
  // our screens inside its own page (to trick a click), files are not guessed as
  // another type, and addresses are not passed on to other sites.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
