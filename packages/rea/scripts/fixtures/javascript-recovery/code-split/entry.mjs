import { formatPrice } from "./shared.mjs";
console.log(formatPrice(1));
import("./checkout.mjs").then(({ checkout }) => console.log(checkout([1, 2])));
