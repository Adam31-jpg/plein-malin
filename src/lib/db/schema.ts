import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Une station-service. L'id est celui de l'API officielle. */
export const stations = pgTable(
  "stations",
  {
    id: integer("id").primaryKey(),
    postalCode: text("postal_code"),
    city: text("city"),
    address: text("address"),
    departement: text("departement"),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    roadType: text("road_type"),
    automate24: boolean("automate_24").notNull().default(false),
    services: jsonb("services").$type<string[]>().notNull().default([]),
    openingHours: text("opening_hours"),
    /** Nom et enseigne, depuis OpenStreetMap (tag ref:FR:prix-carburants = id officiel). */
    name: text("name"),
    brand: text("brand"),
    /** Carburants en rupture temporaire (codes), selon le dernier relevé. */
    outOfStock: jsonb("out_of_stock").$type<string[]>().notNull().default([]),
    /** Dernière fois que la station figurait dans le flux. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stations_lat_lon_idx").on(t.lat, t.lon), index("stations_departement_idx").on(t.departement)],
);

/**
 * Historique : une ligne par CHANGEMENT de prix (station, carburant).
 * `updatedAt` = date de mise à jour déclarée par la station (date_maj).
 */
export const priceHistory = pgTable(
  "price_history",
  {
    stationId: integer("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    fuel: text("fuel").notNull(),
    price: numeric("price", { precision: 5, scale: 3, mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  // Clé primaire = l'unicité dont on a besoin : pas d'id ni d'index secondaire,
  // ~2× plus compact (≈ 1,6 M lignes pour 6 mois au niveau national).
  (t) => [primaryKey({ columns: [t.stationId, t.fuel, t.updatedAt] })],
);

/**
 * Dernier prix connu par (station, carburant). Sert à la détection de changement
 * et à la page d'accueil (fraîcheur = date de dernière confirmation du prix).
 */
export const currentPrices = pgTable(
  "current_prices",
  {
    stationId: integer("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    fuel: text("fuel").notNull(),
    price: numeric("price", { precision: 5, scale: 3, mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.stationId, t.fuel] }), index("current_prices_fuel_idx").on(t.fuel)],
);

/** Journal des passages du worker (supervision + bandeau "données du …"). */
export const ingestRuns = pgTable("ingest_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  departements: text("departements").notNull(),
  stationsSeen: integer("stations_seen").notNull().default(0),
  priceChanges: integer("price_changes").notNull().default(0),
  status: text("status").notNull().default("running"),
  error: text("error"),
});

/**
 * Marchés, un point par jour ouvré : Brent ($/baril), gazole et essence raffinés
 * ($/gallon, port de New York) — sources EIA via FRED — et EUR/USD (BCE).
 */
export const marketDaily = pgTable("market_daily", {
  day: date("day").primaryKey(),
  brentUsd: numeric("brent_usd", { precision: 8, scale: 3, mode: "number" }),
  dieselUsdGal: numeric("diesel_usd_gal", { precision: 8, scale: 4, mode: "number" }),
  gasolineUsdGal: numeric("gasoline_usd_gal", { precision: 8, scale: 4, mode: "number" }),
  eurUsd: numeric("eur_usd", { precision: 8, scale: 5, mode: "number" }),
});

/**
 * Prix médian quotidien par carburant dans la zone collectée (stations dont le prix
 * a été confirmé dans les 30 jours). Sert de série de référence pour la prévision.
 */
export const fuelDaily = pgTable(
  "fuel_daily",
  {
    day: date("day").notNull(),
    fuel: text("fuel").notNull(),
    /** Code département (« 31 », « 2A »…). */
    area: text("area").notNull().default("31"),
    median: numeric("median", { precision: 5, scale: 3, mode: "number" }).notNull(),
    stations: integer("stations").notNull(),
  },
  (t) => [primaryKey({ columns: [t.area, t.fuel, t.day] })],
);

/** Dernière prévision calculée par département et carburant (une fois par jour). */
export const forecasts = pgTable(
  "forecasts",
  {
    fuel: text("fuel").notNull(),
    area: text("area").notNull().default("31"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull(),
  },
  (t) => [primaryKey({ columns: [t.area, t.fuel] })],
);

/**
 * Audience : une ligne par visiteur et par jour. Aucune adresse IP n'est stockée :
 * `visitor` est une empreinte (SHA-256 de sel secret + jour + IP + navigateur), impossible à
 * inverser et différente chaque jour ; `visitorMonth` fait de même à l'échelle du mois pour
 * compter les visiteurs uniques sur une période. Localisation approximative fournie par Cloudflare.
 */
export const visits = pgTable(
  "visits",
  {
    day: date("day").notNull(),
    visitor: text("visitor").notNull(),
    visitorMonth: text("visitor_month").notNull(),
    pageviews: integer("pageviews").notNull().default(1),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    country: text("country"),
    region: text("region"),
    city: text("city"),
    device: text("device").notNull(),
    entryPath: text("entry_path").notNull(),
    referrer: text("referrer"),
  },
  (t) => [primaryKey({ columns: [t.day, t.visitor] }), index("visits_last_seen_idx").on(t.lastSeen)],
);
