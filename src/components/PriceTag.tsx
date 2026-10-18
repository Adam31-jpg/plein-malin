import { splitPrice } from "@/lib/format";

export type Tone = "cheap" | "pricey" | "neutral";

/** Écart à la référence (médiane locale) en dessous duquel on reste neutre (0,5 ct). */
const NEUTRAL_BAND = 0.005;

export function toneFor(price: number, reference: number | null): Tone {
  if (reference === null) return "neutral";
  if (price < reference - NEUTRAL_BAND) return "cheap";
  if (price > reference + NEUTRAL_BAND) return "pricey";
  return "neutral";
}

export function PriceTag({ price, tone = "neutral", className = "" }: { price: number; tone?: Tone; className?: string }) {
  const { main, milli } = splitPrice(price);
  return (
    <span className={`price ${tone !== "neutral" ? `tone-${tone}` : ""} ${className}`} aria-label={`${main}${milli} euros le litre`}>
      {main}
      <small>{milli}</small>
    </span>
  );
}
