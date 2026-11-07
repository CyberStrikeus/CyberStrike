import { getHeapStatistics } from "node:v8";

// Observe the production stdin reader without supplying data or closing its pipe.
const iterate = process.stdin[Symbol.asyncIterator];
process.stdin[Symbol.asyncIterator] = function (...args) {
  process.stderr.write(
    `REA_TEST_STDIN_READ ${getHeapStatistics().heap_size_limit}\n`,
  );
  return iterate.apply(this, args);
};
