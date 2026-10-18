# Plein Malin

Prix des carburants en temps réel autour de soi, historique par station et aide pour choisir **où** et **quand** faire le plein. Pensé mobile d'abord (utilisable au volant : gros chiffres, cibles tactiles ≥ 44 px, mode sombre/clair automatique).

- **Données** : flux officiel [prix-des-carburants-en-france-flux-instantane-v2](https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/) (gratuit, sans clé, mis à jour toutes les 10 min).
- **Stack** : Next.js 16 (App Router, TypeScript) · PostgreSQL (Neon) + Drizzle ORM · MapLibre GL + tuiles [OpenFreeMap](https://openfreemap.org) (OpenStreetMap, sans clé) · déploiement Cloudflare Workers via [OpenNext](https://opennext.js.org/cloudflare).

## Ce que fait l'app

| | |
|---|---|
| **Prévision 7 jours** (en premier) | Prix médian du secteur, tendance estimée avec fourchette, conseil (« faire le plein maintenant » / « attendre »), Brent et EUR/USD. La **fiabilité est mesurée**, pas supposée : quand le modèle ne fait pas assez mieux que « le prix ne bouge pas », l'app affiche « Tendance incertaine » et ne conseille rien. |
| **Les moins chères près de moi** | Carte + les 5 stations les moins chères dans un rayon de 3 à 20 km (« Voir plus » pour toutes), avec nom/enseigne, écart à la médiane, fraîcheur du prix, bouton itinéraire. **Partout en France** : la liste interroge le flux officiel en direct autour de la position (~0,2 s) et ne retombe sur la dernière collecte en base que si le flux ne répond pas. |
| **Couverture nationale** | Collecte des ~9 800 stations de France toutes les 30 min (GitHub Actions), noms OpenStreetMap, 6 mois d'historique détaillé par station, médianes quotidiennes depuis 2024 et prévision **par département** (celui de la station la plus proche). |
| **Transparence** | Stations en rupture signalées. Prix non confirmés depuis 7 jours écartés et comptés. Prix anormaux marqués « à vérifier ». Badge « Même prix dans N stations TotalEnergies » (prix plafonné par l'enseigne). Alerte si les prix n'ont pas été relevés depuis 2 h. |
| **Fiche station** | Prix de tous les carburants, ruptures, courbe 30/90 jours (1 an d'historique officiel), comparaison avec les voisines, horaires. |

### La prévision, en clair

- **Ce qui est annoncé** : uniquement le **sens** à 7 jours, hausse, baisse ou stable. Jamais un montant : le backtest montre que le modèle trouve plus souvent la direction que l'ampleur.
- **Ce que regarde le modèle** (`src/lib/forecast.ts`, une régression linéaire) :
  - le prix médian quotidien du carburant dans le 31 ;
  - la variation sur 7 et 14 jours du cours de gros du produit raffiné (gazole ou essence, port de New York, EIA via FRED), converti en €/L avec l'EUR/USD de la BCE ;
  - la dynamique récente de la pompe ;
  - l'écart entre la pompe et son niveau habituel vu ce cours.
- **Données d'entraînement** : environ 4 ans de médianes quotidiennes (depuis 2023), reconstituées depuis les fichiers annuels officiels avec `npm run backfill:medians`, sans garder l'historique détaillé. Sur les 9 derniers mois, c'est mieux qu'un an d'historique ou qu'une fenêtre glissante.
- **Fiabilité mesurée sur 9 mois** : chaque jour est rejoué avec uniquement les infos connues à cette date. Les cours, publiés avec ~4 jours de retard, sont décalés d'autant. Pour chaque type d'annonce, on compte combien de fois elle était juste et on compare au taux obtenu en faisant cette annonce **systématiquement**.
- **Affiché comme fiable** si l'annonce du jour remplit trois conditions :
  - au moins 65 % de réussite ;
  - sur au moins 15 cas ;
  - pour une hausse ou une baisse, au moins 10 points de mieux que l'annonce systématique.
  - Sinon : **« Incertain »**, sans conseil.
- **Bilan au 18/10/2026**, hausse ou baisse annoncées :
  - gazole : bon sens 63 % (« incertain » aujourd'hui) ;
  - E10 et SP98 : bon sens 74 % (hausse annoncée, fiable) ;
  - SP95 : bon sens 68 %.

## Installation (développement)

Prérequis : Node.js ≥ 20.9, Docker.

```bash
npm install            # copie aussi le worker MapLibre dans public/vendor
cp .env.example .env
npm run db:up          # PostgreSQL 17 dans Docker (port 5433)
npm run db:migrate     # crée les tables
npm run collect        # première collecte (~1 s)
npm run import:history # 6 mois d'historique (fichier officiel de l'année, ~3 min)
npm run enrich:osm     # noms et enseignes depuis OpenStreetMap
npm run backfill:medians -- --from 2024-01-01   # médianes par département depuis 2024 (~5 min)
npm run sync:daily -- --days 365   # cours de marché, médianes de l'année, prévisions
npm run verify         # contrôle : base ↔ flux officiel en direct, fraîcheur des sources
npm run dev            # http://localhost:3000
```

### Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | `postgres://plein:plein@localhost:5433/plein_malin` | Connexion PostgreSQL (app + worker) |
| `COLLECT_DEPARTEMENTS` | `all` | `all` = toute la France en une requête (~9 Mo). Sinon, codes séparés par des virgules (`31,81`) pour un développement plus léger. |
| `COLLECT_INTERVAL_MINUTES` | `15` | Intervalle du mode `--watch` |

## Collecte et tâches planifiées (GitHub Actions)

La collecte nationale (~9 Mo de flux, ~10 s de traitement) dépasse largement la limite de CPU d'un Worker Cloudflare gratuit (10 ms). Elle tourne donc dans **GitHub Actions** (`.github/workflows/collect.yml`) :

| Quand (UTC) | Tâche | Contenu |
|---|---|---|
| toutes les 30 min de 5 h à 20 h, + 22 h et 1 h | `collect` | flux national → stations, prix actuels, changements de prix (comparaison faite dans PostgreSQL : rien n'est rapatrié) |
| 3 h 20 | `daily` | ménage (historique > 190 jours, journaux, visites), Brent/produits raffinés/EUR-USD, médianes des 3 derniers jours, prévisions des ~100 départements ; le lundi, noms OpenStreetMap |

Le workflow exécute `jobs/collector.mjs`, un module autonome empaqueté par `npm run build:job` (pas de `npm ci` à chaque passage : ~30 s facturées). Après une modification de `src/lib` ou `scripts/job.ts`, relancer `npm run build:job` et commiter le fichier ; la CI (`.github/workflows/ci.yml`) échoue s'il est périmé.

Secret du dépôt : `DATABASE_URL` (pooler Neon). Lancement manuel : onglet Actions → « Collecte des prix » → Run workflow, ou :

```bash
gh workflow run collect.yml -f task=daily
```

En local : `npm run collect` (une collecte), `npm run collect:watch` (boucle), `npm run sync:daily` (tâches quotidiennes).

## Historique et budget du plan gratuit

```bash
npm run import:history                # 365 derniers jours (max 400)
npm run import:history -- --days 90
```

L'import télécharge les fichiers annuels de `donnees.roulez-eco.fr` en streaming (340 Mo de XML par an, jamais chargés en mémoire). Il ne garde que les stations **actuellement ouvertes** des départements configurés et seulement les **changements** de prix (le fichier contient aussi chaque reconfirmation, soit 3,5 fois plus de lignes). Il est idempotent.

Pour rester dans le plan gratuit de Neon (0,5 Go de stockage, quota de calcul mensuel) :

| Levier | Réglage |
|---|---|
| Stockage | Seulement les changements de prix, seulement les stations ouvertes du 31. Rétention de **400 jours** : le ménage quotidien supprime l'historique plus ancien, sauf le dernier prix de chaque série. Journal de collecte gardé 14 jours. Base actuelle : ~20 Mo. |
| Calcul | Chaque collecte réveille la base (~5 min avant mise en veille). Collecte toutes les **20 min de 5 h à 20 h UTC** et **toutes les heures la nuit**, soit 58 réveils par jour au lieu de 96. Base plafonnée à **0,25 CU** dans `neon.ts`. |
| Requêtes web | Passent par Hyperdrive (pool de connexions Cloudflare), sans ouvrir une connexion Neon par visite. |

### Ce qu'on a appris du flux (et comment on le traite)

- `prix` est une **chaîne JSON** : un objet si la station n'a qu'un carburant, un tableau sinon.
- Les dates (`@maj`, `gazole_maj`…) sont en **heure de Paris**, même quand l'API les suffixe `+00:00`. On les convertit correctement en UTC (heure d'été/hiver comprises).
- `latitude`/`longitude` sont en degrés × 100 000 ; on utilise `geom` quand il est présent.
- Le flux **ne donne ni le nom ni l'enseigne** des stations : on affiche l'adresse (remise en forme).
- L'endpoint `/exports/json` renvoie tout un département en une requête (~200 stations pour le 31), sans pagination.

## Modèle de données

- `stations` — une ligne par station (id officiel, adresse, coordonnées, 24/24, services, horaires, `last_seen_at`).
- `price_history` — **une ligne par changement de prix** `(station_id, fuel, price, updated_at)` ; unicité sur `(station_id, fuel, updated_at)` pour que les re-collectes soient idempotentes.
- `current_prices` — dernier prix connu par `(station, carburant)` : sert à détecter les changements et à afficher la fraîcheur (un prix reconfirmé met à jour sa date sans créer d'historique). Un carburant qui disparaît du flux (rupture) en est retiré.
- `ingest_runs` — journal des collectes.

Migrations : `npm run db:generate` après modification de `src/lib/db/schema.ts`, puis `npm run db:migrate`.

## Audience (`/stats`)

Page protégée par mot de passe (`STATS_PASSWORD`) : visiteurs en ce moment, aujourd'hui, hier, 7 et 30 jours, courbe quotidienne, villes, régions, pays, appareils, pages d'entrée et sites d'origine.

- **Visiteurs uniques sans stocker d'IP** : chaque page vue est envoyée par le navigateur (`/api/hit`). Le serveur calcule une empreinte `SHA-256(sel secret + jour + IP + navigateur)`, puis oublie l'IP. Une même personne compte **une fois par jour**, et une fois par mois dans les totaux 7 et 30 jours.
- **Exclus** : robots, aperçus de liens (WhatsApp, Slack…), navigateurs « Do Not Track » / GPC, la page `/stats` elle-même, et ton appareil si tu cliques « Ne pas compter mes visites ».
- **Localisation** : ville, région et pays fournis par Cloudflare (approximatifs, parfois la ville du point de connexion de l'opérateur).
- Données conservées **13 mois** (recommandation CNIL) : avec ces règles, pas de bandeau de consentement nécessaire pour cette mesure.
- Limites honnêtes : un téléphone qui passe du Wi-Fi à la 4G dans la journée peut compter deux fois. Plusieurs personnes derrière la même box, avec le même navigateur, comptent une seule fois.

Secrets : `ANALYTICS_SALT` et `STATS_PASSWORD`, dans `.env` en local et via `npx wrangler secret put …` en production.

## API

- `GET /api/stations?lat=43.52&lon=1.40&radius=10&fuel=gazole` → stations du rayon triées par prix (noms, signalements), ruptures, médiane.
- `GET /api/forecast?fuel=gazole` → prévision 7 jours + résultats du backtest.
- `GET /api/stations/:id/history?days=90` → changements de prix de la station.

Carburants : `gazole`, `sp95`, `e10`, `sp98`, `e85`, `gplc`.

## Déploiement (Cloudflare + Neon)

Production : **https://plein-malin.sukya-467.workers.dev**

- **Base** : Neon (projet `falling-shape-57438265`, branche `production`, région eu-west-2), décrite dans `neon.ts`. `neon deploy` provisionne les services et écrit `DATABASE_URL` (pooler) et `DATABASE_URL_UNPOOLED` (directe) dans `.env`.
- **App** : Cloudflare Worker via OpenNext (l'ancien `next-on-pages` est abandonné). Les requêtes web passent par **Hyperdrive** (binding `HYPERDRIVE` dans `wrangler.jsonc`), qui maintient le pool de connexions vers Neon.
- **Collecte** : GitHub Actions (voir ci-dessus), connexion directe au pooler Neon via le secret `DATABASE_URL` du dépôt. Le Worker Cloudflare ne fait que servir l'app.
- Driver : `postgres.js` + Drizzle partout (Node, Workers, Hyperdrive). Les migrations utilisent `DATABASE_URL_UNPOOLED`.

```bash
neon login && neon deploy                       # (re)provisionne et tire les variables dans .env
npm run db:migrate                              # migrations sur la connexion directe
node -e 'require("dotenv").config();process.stdout.write(process.env.DATABASE_URL)' | npx wrangler secret put DATABASE_URL
npm run cf:deploy
```

Hyperdrive a été créé une fois avec `npx wrangler hyperdrive create plein-malin-db --connection-string="<DATABASE_URL_UNPOOLED>"`.

> ⚠️ Après `neon deploy`, `.env` pointe sur la branche **production** de Neon : `npm run dev` et `npm run collect` y écrivent. Pour développer sans toucher à la prod, créez une branche (`neon checkout dev --create`) ou remettez l'URL Docker locale de `.env.example`.

`npm run cf:preview` sert le build de production dans le runtime Workers en local (Hyperdrive → Postgres Docker via `localConnectionString`).

**Neon Auth** est provisionné (`NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` dans `.env`) mais pas encore utilisé : le MVP n'a pas de comptes utilisateurs.

## Scripts

| Script | |
|---|---|
| `dev` / `build` / `start` | Next.js |
| `test` | Tests unitaires (Vitest) : parsing du flux, fuseaux horaires, détection des changements |
| `typecheck` / `lint` | TypeScript / ESLint |
| `db:up` · `db:migrate` · `db:generate` · `db:studio` | Base de données |
| `collect` · `collect:watch` | Worker de collecte |
| `import:history` | Import de l'historique officiel |
| `enrich:osm` | Noms et enseignes (OpenStreetMap, appariement par l'id officiel) |
| `backfill:medians` | Médianes quotidiennes des années passées (fichiers officiels, sans historique détaillé) |
| `sync:daily` | Brent, gazole/essence raffinés, EUR/USD, médianes quotidiennes, prévisions |
| `verify` | Contrôle de véracité (code 1 si incohérence) |
| `cf:build` · `cf:preview` · `cf:deploy` | Cloudflare |

## Feuille de route

- Habitudes de chaque station (jour de changement de prix, réactivité aux hausses et aux baisses).
- Calcul « vaut-il le détour » (conso, litres, trajet aller-retour).
- **Étape 3** : tendance des prix à 7 jours (Brent, EUR/USD), habitudes de chaque station, recommandation « Plein maintenant / Attendre » avec indice de confiance.
