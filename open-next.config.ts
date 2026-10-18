import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Toutes les pages lisent la base à chaque requête : pas de cache incrémental (ni R2) nécessaire.
export default defineCloudflareConfig();
