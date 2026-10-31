import { Cart, formatPrice, TAX_RATE } from "./shared.mjs";
export function checkout(prices) {
  const cart = new Cart();
  prices.forEach((price) => cart.add(price));
  return formatPrice(cart.total() * (1 + TAX_RATE));
}
