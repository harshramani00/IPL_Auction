/** "6 crore 75 lakh", "2 crore", "30 lakh": how an auctioneer says it. */
export function spokenAmount(lakhs: number): string {
  const crore = Math.floor(lakhs / 100);
  const rest = lakhs % 100;
  if (!crore) return `${rest} lakh`;
  return rest ? `${crore} crore ${rest} lakh` : `${crore} crore`;
}
