#pragma once

#include <cstdint>
#include <utility>

namespace rea {

// A failed CloseHandle and a later liveness probe are not one atomic fact.
// Another thread can reuse the numeric value before GetHandleInformation
// runs, so an Open result does not prove the probed object is still ours.
// After a failed close, drop the value only when the probe says it is gone.
// Otherwise keep it and do not call CloseHandle again.

enum class HandleLiveness { Open, NotInTable, Unavailable };

enum class HandleCloseDisposition {
  Released,
  TerminalInvalid,
  Unconfirmed,
};

struct CloseAttempt {
  bool succeeded = false;
  std::uint32_t error = 0;
};

struct LivenessProbe {
  HandleLiveness liveness = HandleLiveness::Unavailable;
  std::uint32_t error = 0;
};

struct HandleCloseDecision {
  HandleCloseDisposition disposition = HandleCloseDisposition::Released;
  bool clearValue = false;
  bool retryClose = false;
  std::uint32_t closeError = 0;
  std::uint32_t evidenceError = 0;
};

inline HandleCloseDecision decideOwnedHandleClose(bool closeSucceeded,
                                                 std::uint32_t closeError,
                                                 LivenessProbe evidence) {
  if (closeSucceeded)
    return {HandleCloseDisposition::Released, true, false, 0, 0};
  switch (evidence.liveness) {
    case HandleLiveness::Open:
    case HandleLiveness::Unavailable:
      return {HandleCloseDisposition::Unconfirmed, false, false, closeError,
              evidence.error};
    case HandleLiveness::NotInTable:
      return {HandleCloseDisposition::TerminalInvalid, true, false, closeError,
              evidence.error};
  }
  return {HandleCloseDisposition::Unconfirmed, false, false, closeError,
          evidence.error};
}

// One current value plus at most one parked replacement. Close and liveness
// are injected so this gate can be tested without a kernel handle table.
template <class T>
class OwnedHandle {
 public:
  explicit OwnedHandle(T invalid) noexcept
      : invalid_(invalid), value_(invalid), extra_(invalid) {}

  OwnedHandle(const OwnedHandle&) = delete;
  OwnedHandle& operator=(const OwnedHandle&) = delete;

  OwnedHandle(OwnedHandle&& other) noexcept
      : invalid_(other.invalid_),
        value_(std::exchange(other.value_, other.invalid_)),
        extra_(std::exchange(other.extra_, other.invalid_)),
        blockValue_(std::exchange(other.blockValue_, false)),
        blockExtra_(std::exchange(other.blockExtra_, false)) {}

  OwnedHandle& operator=(OwnedHandle&&) = delete;

  T get() const noexcept { return value_; }
  T invalid() const noexcept { return invalid_; }
  bool valid() const noexcept { return value_ != invalid_; }
  bool fullyReleased() const noexcept {
    return value_ == invalid_ && extra_ == invalid_;
  }
  bool closeBlocked() const noexcept { return blockValue_; }

  // Install a value into an empty slot. A live owner uses reset.
  bool park(T value, bool blockClose) noexcept {
    if (value == invalid_) return true;
    if (value_ == invalid_) {
      value_ = value;
      blockValue_ = blockClose;
      return true;
    }
    if (extra_ == invalid_) {
      extra_ = value;
      blockExtra_ = blockClose;
      return true;
    }
    return false;
  }

  struct Slots {
    T value;
    T extra;
    bool blockValue;
    bool blockExtra;
  };

  Slots take() noexcept {
    Slots slots{value_, extra_, blockValue_, blockExtra_};
    value_ = invalid_;
    extra_ = invalid_;
    blockValue_ = false;
    blockExtra_ = false;
    return slots;
  }

  template <class Close, class Probe>
  HandleCloseDecision release(Close&& close, Probe&& probe) noexcept {
    HandleCloseDecision last{HandleCloseDisposition::Released, true, false, 0, 0};
    for (;;) {
      if (value_ == invalid_) {
        if (extra_ == invalid_) return last;
        value_ = extra_;
        blockValue_ = blockExtra_;
        extra_ = invalid_;
        blockExtra_ = false;
      }
      last = finalizeSlot(value_, blockValue_, close, probe);
      if (value_ != invalid_) return last;
    }
  }

  // Close the current owner. On an unconfirmed close, keep it and park `next`
  // instead of overwriting the numeric value. `sink` receives a value that
  // does not fit in the parked slot; it must retain that exact value.
  template <class Close, class Probe, class Sink>
  void reset(T next, Close&& close, Probe&& probe, Sink&& sink) noexcept {
    release(close, probe);
    if (!fullyReleased()) {
      if (next != invalid_ && next != value_ && next != extra_ && !park(next, false))
        sink(next, false);
      return;
    }
    value_ = next;
    blockValue_ = false;
  }

  // Last-resort detach. Release once, then hand any surviving values to `sink`
  // without a second close of a value whose liveness is not Open.
  template <class Close, class Probe, class Sink>
  void abandon(Close&& close, Probe&& probe, Sink&& sink) noexcept {
    release(close, probe);
    if (value_ != invalid_) sink(value_, blockValue_);
    if (extra_ != invalid_) sink(extra_, blockExtra_);
    value_ = invalid_;
    extra_ = invalid_;
    blockValue_ = false;
    blockExtra_ = false;
  }

 private:
  T invalid_;
  T value_;
  T extra_;
  bool blockValue_ = false;
  bool blockExtra_ = false;

  template <class Close, class Probe>
  HandleCloseDecision finalizeSlot(T& slot, bool& block, Close&& close,
                                  Probe&& probe) noexcept {
    if (slot == invalid_)
      return {HandleCloseDisposition::Released, true, false, 0, 0};
    if (block) {
      const LivenessProbe evidence = probe(slot);
      if (evidence.liveness == HandleLiveness::NotInTable) {
        slot = invalid_;
        block = false;
        return {HandleCloseDisposition::TerminalInvalid, true, false, 0,
                evidence.error};
      }
      // Open or unreadable: the number stays close-blocked. Closing it could
      // release an object that reused the value.
      return {HandleCloseDisposition::Unconfirmed, false, false, 0,
              evidence.error};
    }
    const CloseAttempt attempt = close(slot);
    if (attempt.succeeded) {
      slot = invalid_;
      block = false;
      return {HandleCloseDisposition::Released, true, false, 0, 0};
    }
    const LivenessProbe evidence = probe(slot);
    const HandleCloseDecision decision =
        decideOwnedHandleClose(false, attempt.error, evidence);
    if (decision.clearValue) {
      slot = invalid_;
      block = false;
    } else {
      block = !decision.retryClose;
    }
    return decision;
  }
};

}  // namespace rea
