export function greet(name) {
  return `Hello ${name ?? "world"}`;
}
export function total(items) {
  return items.reduce((sum, value) => sum + value, 0);
}
