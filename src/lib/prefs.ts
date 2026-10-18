import { DEFAULT_FUEL, isFuelCode, type FuelCode } from "@/lib/fuels";

export const FUEL_COOKIE = "pm_fuel";
export const RADIUS_COOKIE = "pm_radius";
export const RADII = [3, 5, 10, 20] as const;
export const DEFAULT_RADIUS = 10;

export function parseFuel(value: unknown): FuelCode | null {
  return isFuelCode(value) ? value : null;
}

export function parseRadius(value: unknown): number | null {
  const n = Number(value);
  return (RADII as readonly number[]).includes(n) ? n : null;
}

export { DEFAULT_FUEL };
