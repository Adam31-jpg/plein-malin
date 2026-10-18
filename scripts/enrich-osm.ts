/** Noms et enseignes des stations depuis OpenStreetMap : `npm run enrich:osm`. */
import "dotenv/config";
import { getDb } from "@/lib/db";
import { enrichFromOsm } from "@/lib/osm";

enrichFromOsm(getDb())
  .then((r) => {
    console.log(`[osm] ${r.matched} stations nommées sur ${r.total}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`[osm] ÉCHEC : ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
