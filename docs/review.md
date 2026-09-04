# Review of Energy Allocator

## Overview

This is a thoughtful and well-structured Homey app with a clear energy-allocation model. The implementation is strongest around the core accounting logic and the reset-handling strategy, which are the hardest parts of this kind of app.

The project is organized around a clear design:

- [app.js](app.js) holds the app configuration, consumer registry, and sampling loop.
- [lib/allocation.js](lib/allocation.js) contains the house-balance split algorithm.
- [lib/AllocationDevice.js](lib/AllocationDevice.js) implements the shared device behavior.
- [lib/SmoothingWindow.js](lib/SmoothingWindow.js) smooths share values over time.
- [settings/index.html](settings/index.html) provides the source-meter configuration UI.

## What is good

### 1. The core concept is sound

The app correctly treats cumulative kWh counters as the source of truth and deliberately avoids relying on `measure_power` for allocation. This is the right design choice for Homey energy attribution because cumulative counters are the stable data needed for interval accounting.

### 2. Reset handling is a real strength

The logic in [app.js](app.js#L100-L187) explicitly tracks per-counter baselines and rejects intervals when a meter resets or when the sample gap is implausible. That is exactly the kind of robustness needed for Homey installations where counters can be re-seeded or zeroed at any time.

### 3. The energy-balance algorithm is clear and conservative

The math in [lib/allocation.js](lib/allocation.js#L9-L67) is easy to follow and intentionally rejects impossible intervals instead of generating impossible energy totals. It handles the priority ordering correctly:

- battery charging: PV first, then grid
- export: PV first, then battery, then grid

This makes the app conservative and avoids silently inventing energy.

### 4. Device behavior is cleanly separated

The shared logic in [lib/AllocationDevice.js](lib/AllocationDevice.js#L7-L98) keeps common behavior in one place, while the individual drivers only differ in how they identify the monitored device. That is a good pattern for a Homey app with multiple device types.

### 5. The share smoothing approach is reasonable

The trailing-window approach in [lib/SmoothingWindow.js](lib/SmoothingWindow.js#L1-L46) avoids overly jumpy grid-share readings and is appropriate for a sensor-like app.

## Risks and concerns

### 1. Consumer registration edge case

In [app.js](app.js#L34-L59), the app creates a baseline map only during sampling. If a monitored device is registered after startup or during a period when its baseline is not yet established, the first interval can be distorted or effectively treated as a fresh reading.

This is not catastrophic, but it is a real edge case that will show up during onboarding or after device creation.

### 2. Some intervals are intentionally dropped

The app chooses to skip intervals when the house balance is inconsistent or a counter resets. That decision is defensible, but it means that a small amount of real energy is lost from cumulative totals over time. This tradeoff is acceptable for the stated design, but it should be treated as a deliberate loss of precision, not as a hidden bug.

### 3. Limited automated coverage

The energy math is subtle enough that it should have a clear unit-test suite. The logic in [lib/allocation.js](lib/allocation.js#L9-L67) is exactly the kind of pure function that benefits from regression tests for:

- negative or near-zero totals
- export vs charge precedence
- grid/PV/battery edge cases
- zero-sum and impossible energy-balance cases

At the moment, there is no automated coverage for these cases.

### 4. Configuration validation could be stronger

The settings UI in [settings/index.html](settings/index.html#L170-L233) validates basic issues, but it does not fully guard against duplicate mappings or misleading capability selections. This app depends heavily on correct user configuration, so a little more validation would reduce support burden.

### 5. The effect of startup timing is not fully hardened

The app starts the sampler after a short delay in [app.js](app.js#L65-L79). During startup, it immediately establishes baselines, which is a good pattern, but there is still a possibility of transient values being seen before the first stable sampling period if devices are slow to initialize.

## Overall assessment

This is a solid v1 implementation with a strong architectural foundation. The most important quality is that it prioritizes correctness over false precision: if the data is inconsistent, it skips the interval rather than inventing energy.

That makes the app more trustworthy for real-world Homey installations, even if it means some intervals are lost.

## Recommended next steps

1. Add unit tests around the house-balance logic in [lib/allocation.js](lib/allocation.js).
2. Harden startup and new-consumer registration so the first interval cannot distort device totals.
3. Add a bit more config validation in [settings/index.html](settings/index.html).
4. Continue to document the deliberate “skip bad intervals” behavior in the user-facing docs so the tradeoff is clear.

## Final verdict

The app is well-designed, thoughtful, and clearly aligned with real Homey energy-meter behavior. It is not yet fully hardened for every edge case, but it shows a good technical foundation and a realistic approach to the hardest problem in this type of app: handling real-world meter resets and inconsistent energy flows without pretending the numbers are more precise than they are.
