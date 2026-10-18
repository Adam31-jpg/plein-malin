// Le worker de MapLibre v6 est un module ES séparé que le bundler ne sert pas :
// on le copie dans public/ (versionné par son numéro) et la carte le charge via setWorkerUrl().
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("maplibre-gl/package.json");
const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));
mkdirSync("public/vendor", { recursive: true });
copyFileSync(join(dirname(pkgPath), "dist", "maplibre-gl-worker.mjs"), `public/vendor/maplibre-gl-worker-${version}.mjs`);
console.log(`maplibre-gl-worker-${version}.mjs → public/vendor/`);
