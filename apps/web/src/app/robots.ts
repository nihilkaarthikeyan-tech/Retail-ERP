// Copyright (c) 2026, Rademics. All rights reserved.
import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Search engines may read the public pages; everything behind a login stays out of their index. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/login", "/signup"], disallow: ["/api/", "/admin", "/dashboard", "/till", "/setup", "/reset-password", "/confirm-email"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
