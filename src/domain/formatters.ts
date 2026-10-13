const euroFormatter = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  useGrouping: "always",
});

export function formatCurrency(amount: number): string {
  return euroFormatter.format(amount);
}
