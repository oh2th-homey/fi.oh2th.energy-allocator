# Review of Energy Allocator

## Scope and status

This review reflects the current v1 implementation. The app has a sound accounting
model and the source/configuration flow is implemented. The project has passed the
Homey publish validation in the current workspace, but it has not yet been verified
on Homey hardware.

## Findings

### High: configuration is not validated at the API boundary

The settings page performs only two checks in [settings/index.html](../settings/index.html#L300-L305),
while [api.js](../api.js#L9-L12) forwards arbitrary request data to
[app.js](../app.js#L54-L64). `setConfig()` normalizes only the `pv` and `battery`
array types. It does not reject invalid or non-finite sampling values, malformed
source records, duplicate mappings, a battery source whose charge/discharge
capabilities do not exist on the selected device, or a grid export capability that
is the same as the import capability.

This matters because API callers are not limited to the bundled settings page, and
invalid values can affect sampler timing or produce misleading allocations. Validate
and normalize the complete configuration in one shared app-level function before
persisting it; keep the UI validation as a usability improvement rather than the
security or correctness boundary.

## Confirmed strengths

- [app.js](../app.js#L120-L237) keeps an individual baseline for every configured
  counter, detects decreases, rejects excessive sample gaps, and re-baselines after
  a discarded interval.
- [lib/allocation.js](../lib/allocation.js#L21-L60) uses a clear energy-balance
  equation and refuses to allocate an inconsistent interval instead of inventing
  energy.
- [lib/AllocationDevice.js](../lib/AllocationDevice.js#L32-L105) cleanly shares
  behavior between device and house allocation drivers, including dynamic PV/battery
  capabilities.
- [lib/SmoothingWindow.js](../lib/SmoothingWindow.js#L31-L55) derives shares from
  trailing energy totals, which is more stable than smoothing percentages directly.
- [app.js](../app.js#L242-L283) excludes this app's own allocator devices from source
  selection, preventing an allocation feedback loop.

## Accepted v1 tradeoffs

- A restart loses the in-flight interval because baselines are held in memory. The
  first successful sample after startup establishes a new baseline.
- Inconsistent, reset, or excessively delayed intervals are intentionally discarded.
  This can slightly under-count cumulative allocation totals, but avoids false
  precision and is consistent with the stated design.
- Monitored devices currently require a plain `meter_power` capability; selecting a
  monitored sub-capability is deferred.
- The app still needs hardware testing and replacement artwork before publication.

## Recommended next steps

1. Add shared configuration validation in [app.js](../app.js).
2. Test pairing, capability synchronization, reset behavior, and Flow cards on
   hardware before publishing.

## Verdict

The implementation is a credible v1 with a conservative and well-separated core.
The main release risk is not the allocation algorithm itself; it is the fact that
configuration validity currently depends on the settings page. Address that before
treating the app as production-ready.
