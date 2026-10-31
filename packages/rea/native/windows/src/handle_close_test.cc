#include "handle_close.hpp"

#include <cstdlib>
#include <iostream>
#include <string>
#include <utility>
#include <vector>

namespace {

int failures = 0;

void expect(bool condition, const char* description) {
  if (condition) return;
  ++failures;
  std::cerr << "failed: " << description << '\n';
}

rea::CloseAttempt fail(std::uint32_t error) {
  return {false, error};
}

rea::LivenessProbe live(rea::HandleLiveness liveness, std::uint32_t error = 0) {
  return {liveness, error};
}

void testDecisionMatrix() {
  const auto released = rea::decideOwnedHandleClose(true, 5, live(rea::HandleLiveness::Open, 9));
  expect(released.disposition == rea::HandleCloseDisposition::Released && released.clearValue &&
             !released.retryClose && released.closeError == 0,
         "a successful close clears the value and does not retry");

  const auto still = rea::decideOwnedHandleClose(false, 6, live(rea::HandleLiveness::Open));
  expect(still.disposition == rea::HandleCloseDisposition::Unconfirmed && !still.clearValue &&
             !still.retryClose && still.closeError == 6,
         "an open probe after a failed close does not authorize another close");

  const auto gone = rea::decideOwnedHandleClose(false, 6, live(rea::HandleLiveness::NotInTable, 6));
  expect(gone.disposition == rea::HandleCloseDisposition::TerminalInvalid && gone.clearValue &&
             !gone.retryClose && gone.evidenceError == 6,
         "a value missing from the handle table is dropped and never closed again");

  const auto unknown =
      rea::decideOwnedHandleClose(false, 5, live(rea::HandleLiveness::Unavailable, 12));
  expect(unknown.disposition == rea::HandleCloseDisposition::Unconfirmed && !unknown.clearValue &&
             !unknown.retryClose && unknown.closeError == 5 && unknown.evidenceError == 12,
         "unavailable liveness keeps the value and blocks another close");
}

void testReleaseRetainsAndRetriesOnlyLiveValues() {
  rea::OwnedHandle<int> handle(-1);
  expect(handle.park(4, false), "adopt the first value");
  int closes = 0;
  int probes = 0;
  const auto decision = handle.release(
      [&](int) {
        ++closes;
        return fail(6);
      },
      [&](int) {
        ++probes;
        return live(rea::HandleLiveness::Open);
      });
  expect(decision.disposition == rea::HandleCloseDisposition::Unconfirmed && handle.get() == 4 &&
             closes == 1 && probes == 1 && handle.closeBlocked(),
         "a failed close of a value that still looks open keeps that value blocked");

  const auto retried = handle.release(
      [&](int) {
        ++closes;
        return rea::CloseAttempt{true, 0};
      },
      [&](int) {
        ++probes;
        return live(rea::HandleLiveness::Open);
      });
  expect(retried.disposition == rea::HandleCloseDisposition::Unconfirmed && handle.get() == 4 &&
             handle.closeBlocked() && closes == 1 && probes == 2,
         "a later open probe does not close a value whose previous close failed");
}

void testUnconfirmedCloseDoesNotCallCloseAgain() {
  rea::OwnedHandle<int> handle(-1);
  expect(handle.park(8, false), "adopt the unconfirmed value");
  int closes = 0;
  int probes = 0;
  handle.release(
      [&](int) {
        ++closes;
        return fail(5);
      },
      [&](int) {
        ++probes;
        return live(rea::HandleLiveness::Unavailable, 12);
      });
  expect(handle.get() == 8 && handle.closeBlocked() && closes == 1 && probes == 1,
         "the first failed close records unconfirmed liveness");

  handle.release(
      [&](int) {
        ++closes;
        return fail(5);
      },
      [&](int) {
        ++probes;
        return live(rea::HandleLiveness::Unavailable, 12);
      });
  expect(closes == 1 && probes == 2 && handle.get() == 8 && handle.closeBlocked(),
         "unconfirmed liveness does not call close again");

  handle.release(
      [&](int) {
        ++closes;
        return rea::CloseAttempt{true, 0};
      },
      [&](int) {
        ++probes;
        return live(rea::HandleLiveness::Open);
      });
  expect(handle.get() == 8 && handle.closeBlocked() && closes == 1 && probes == 3,
         "a later open probe still does not close the unconfirmed value");
}

void testTerminalInvalidityDropsTheValue() {
  rea::OwnedHandle<int> handle(-1);
  expect(handle.park(3, false), "adopt the invalid value");
  int closes = 0;
  const auto decision = handle.release(
      [&](int) {
        ++closes;
        return fail(6);
      },
      [&](int) { return live(rea::HandleLiveness::NotInTable, 6); });
  expect(decision.disposition == rea::HandleCloseDisposition::TerminalInvalid &&
             handle.fullyReleased() && closes == 1,
         "terminal invalidity clears the owner");
  handle.release(
      [&](int) {
        ++closes;
        return fail(6);
      },
      [&](int) { return live(rea::HandleLiveness::Open); });
  expect(closes == 1 && handle.fullyReleased(),
         "a dropped value is not passed to close again");
}

void testBlockedProbeCanDiscoverTerminalInvalidityWithoutClosing() {
  rea::OwnedHandle<int> handle(-1);
  expect(handle.park(9, true), "install a close-blocked value");
  int closes = 0;
  const auto decision = handle.release(
      [&](int) {
        ++closes;
        return fail(1);
      },
      [&](int) { return live(rea::HandleLiveness::NotInTable, 6); });
  expect(decision.disposition == rea::HandleCloseDisposition::TerminalInvalid &&
             handle.fullyReleased() && closes == 0,
         "a blocked value that is no longer in the table is not closed");
}

void testResetParksTheReplacementAndOverflowsTheThirdValue() {
  rea::OwnedHandle<int> handle(-1);
  expect(handle.park(1, false), "adopt the current value");
  std::vector<std::pair<int, bool>> sunk;
  handle.reset(
      2,
      [&](int) { return fail(6); },
      [&](int) { return live(rea::HandleLiveness::Open); },
      [&](int value, bool block) { sunk.emplace_back(value, block); });
  expect(handle.get() == 1 && sunk.empty(), "a failed close does not overwrite the live value");

  int closes = 0;
  handle.reset(
      3,
      [&](int value) {
        ++closes;
        return value == 1 ? fail(6) : rea::CloseAttempt{true, 0};
      },
      [&](int) { return live(rea::HandleLiveness::Open); },
      [&](int value, bool block) { sunk.emplace_back(value, block); });
  expect(handle.get() == 1 && handle.closeBlocked() && sunk.size() == 1 && sunk[0].first == 3 &&
             !sunk[0].second && closes == 0,
         "a blocked value is not closed again and a third value is retained by the sink");
}

void testReleaseClosesTheParkedReplacementAfterTheCurrentValue() {
  rea::OwnedHandle<int> handle(-1);
  expect(handle.park(1, false), "adopt the current value");
  expect(handle.park(2, false), "park the replacement");
  std::vector<int> order;
  const auto decision = handle.release(
      [&](int value) {
        order.push_back(value);
        return rea::CloseAttempt{true, 0};
      },
      [&](int) { return live(rea::HandleLiveness::Unavailable, 1); });
  expect(decision.disposition == rea::HandleCloseDisposition::Released && handle.fullyReleased() &&
             order.size() == 2 && order[0] == 1 && order[1] == 2,
         "release closes the current value and then the parked replacement");
}

void testAbandonHandsSurvivingValuesToTheSinkOnce() {
  rea::OwnedHandle<int> handle(-1);
  expect(handle.park(7, false), "adopt the abandoned value");
  expect(handle.park(8, false), "park a second abandoned value");
  int closes = 0;
  std::vector<std::pair<int, bool>> sunk;
  handle.abandon(
      [&](int) {
        ++closes;
        return fail(5);
      },
      [&](int) { return live(rea::HandleLiveness::Unavailable, 11); },
      [&](int value, bool block) { sunk.emplace_back(value, block); });
  expect(handle.fullyReleased() && closes == 1 && sunk.size() == 2 && sunk[0] == std::make_pair(7, true) &&
             sunk[1] == std::make_pair(8, false),
         "abandon retains every surviving value and does not close the unconfirmed one twice");
}

void testMovePreservesTheCloseGate() {
  rea::OwnedHandle<int> handle(-1);
  expect(handle.park(4, true), "adopt a blocked value");
  rea::OwnedHandle<int> moved(std::move(handle));
  expect(handle.fullyReleased() && moved.get() == 4 && moved.closeBlocked(),
         "move transfers the value and its close gate");
  int closes = 0;
  moved.release([&](int) {
    ++closes;
    return fail(1);
  },
                [&](int) { return live(rea::HandleLiveness::Unavailable, 2); });
  expect(closes == 0 && moved.get() == 4 && moved.closeBlocked(),
         "a moved blocked value is probed and not closed while liveness is unknown");
}

}  // namespace

int main() {
  testDecisionMatrix();
  testReleaseRetainsAndRetriesOnlyLiveValues();
  testUnconfirmedCloseDoesNotCallCloseAgain();
  testTerminalInvalidityDropsTheValue();
  testBlockedProbeCanDiscoverTerminalInvalidityWithoutClosing();
  testResetParksTheReplacementAndOverflowsTheThirdValue();
  testReleaseClosesTheParkedReplacementAfterTheCurrentValue();
  testAbandonHandsSurvivingValuesToTheSinkOnce();
  testMovePreservesTheCloseGate();
  if (failures != 0) {
    std::cerr << failures << " assertion(s) failed\n";
    return EXIT_FAILURE;
  }
  return EXIT_SUCCESS;
}
