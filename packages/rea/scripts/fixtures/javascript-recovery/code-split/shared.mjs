export class Cart {
  constructor() {
    this.items = [];
  }
  add(price) {
    this.items.push(price);
    return this;
  }
  total() {
    return this.items.reduce((sum, price) => sum + price, 0);
  }
}
export const formatPrice = (value) => `$${value.toFixed(2)}`;
export const TAX_RATE = 0.08;
