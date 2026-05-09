## Summary

-

## Review invariants

State the ownership boundaries and negative constraints reviewers must preserve.

- UI/session state:
- Daemon/server/protocol/persisted state:
- State that must not be cleared or rewritten by this change:
- Public contract or persisted format affected:

For OAuth-like flows, launch failure is UI-only; daemon callback-validation state must survive until callback, TTL, or explicit user cancellation.

## Tests

-
