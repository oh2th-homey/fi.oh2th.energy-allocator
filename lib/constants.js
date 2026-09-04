'use strict';

/**
 * Fixed meter sampling interval, in seconds. Deliberately not user-configurable:
 * many meters (e.g. PV inverters reporting `meter_power` to 0.1 kWh) barely move
 * over a short interval at low power, which produced a stream of zero-delta
 * "skipped" intervals. 5 minutes gives the counters time to advance.
 */
const SAMPLE_INTERVAL_SECONDS = 300;

/**
 * Share-smoothing window length, expressed as a count of sample intervals
 * (so ~{@link SAMPLE_INTERVAL_SECONDS} * this seconds of trailing data).
 */
const SMOOTHING_INTERVALS = 5;

module.exports = { SAMPLE_INTERVAL_SECONDS, SMOOTHING_INTERVALS };
