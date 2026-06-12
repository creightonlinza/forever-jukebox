export function isLikelyJobId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}
