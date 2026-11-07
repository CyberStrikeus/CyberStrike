// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Public source-owned fixture; generated runtime bytecode is never tracked.
contract InterfaceFixture {
  uint256 public stored;
  function set(uint256 value) external { stored = value; }
  function read() external view returns (uint256) { return stored; }
  function pair(uint32 a, address b) external pure returns (uint32, address) { return (a, b); }
  receive() external payable {}
  fallback() external {}
}
