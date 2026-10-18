/** Carburants publiés par le flux officiel (l'id est celui de l'API). */
export const FUELS = [
  { code: "gazole", label: "Gazole", apiName: "Gazole", apiId: 1 },
  { code: "sp95", label: "SP95", apiName: "SP95", apiId: 2 },
  { code: "e10", label: "E10", apiName: "E10", apiId: 5 },
  { code: "sp98", label: "SP98", apiName: "SP98", apiId: 6 },
  { code: "e85", label: "E85", apiName: "E85", apiId: 3 },
  { code: "gplc", label: "GPLc", apiName: "GPLc", apiId: 4 },
] as const;

export type FuelCode = (typeof FUELS)[number]["code"];

export const DEFAULT_FUEL: FuelCode = "gazole";

const byApiName = new Map<string, FuelCode>(FUELS.map((f) => [f.apiName.toLowerCase(), f.code]));
const byApiId = new Map<number, FuelCode>(FUELS.map((f) => [f.apiId, f.code]));

export function fuelFromApi(name: string | undefined, id?: number): FuelCode | null {
  if (name) {
    const code = byApiName.get(name.toLowerCase());
    if (code) return code;
  }
  return id !== undefined ? (byApiId.get(id) ?? null) : null;
}

export function isFuelCode(value: unknown): value is FuelCode {
  return typeof value === "string" && FUELS.some((f) => f.code === value);
}

export function fuelLabel(code: FuelCode): string {
  return FUELS.find((f) => f.code === code)!.label;
}
