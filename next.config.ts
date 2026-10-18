import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Pas de Cache Components : leur ordonnancement repose sur setTimeout, que le
// runtime Cloudflare Workers ne garantit pas (pages bloquées en production).
// Les pages qui lisent la base sont rendues à la demande, en streaming via <Suspense>.
const nextConfig: NextConfig = {};

export default nextConfig;

initOpenNextCloudflareForDev();
