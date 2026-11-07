export default function allocateUntilKilled() {
  const retained = [];
  while (true) {
    const allocation = new Uint8Array(1024 * 1024);
    allocation.fill(1);
    retained.push(allocation);
  }
}
