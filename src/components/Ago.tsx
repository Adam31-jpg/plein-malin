import { formatAgo, freshness } from "@/lib/time";

/**
 * « il y a 2 h » avec la pastille de fraîcheur. Le texte dépend de l'heure courante,
 * il peut donc différer d'une minute entre le rendu serveur et le navigateur.
 */
export function Ago({ date, dot = false }: { date: string; dot?: boolean }) {
  return (
    <span className={dot ? `fresh fresh--${freshness(date)}` : undefined} suppressHydrationWarning>
      {formatAgo(date)}
    </span>
  );
}
