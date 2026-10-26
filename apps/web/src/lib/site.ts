// Copyright (c) 2026, Rademics. All rights reserved.

/** The public address of the site: the API's address without "/api" (deploy/docker-compose.prod.yml). */
export const SITE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://retailerp.52digit.com/api").replace(/\/api\/?$/, "").replace(/^http:\/\/localhost:4000$/, "http://localhost:3000");
