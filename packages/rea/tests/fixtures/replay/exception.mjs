export default function fail(value) {
  throw new TypeError(`fixture:${value}`);
}
