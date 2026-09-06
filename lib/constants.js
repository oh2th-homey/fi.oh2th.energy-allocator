'use strict';

/** Meter sampling interval, in seconds. Fixed, not user-configurable. */
const SAMPLE_INTERVAL_SECONDS = 300;

/**
 * Share-smoothing window length, as a count of sample intervals.
 * Window duration is {@link SAMPLE_INTERVAL_SECONDS} * this value, in seconds.
 */
const SMOOTHING_INTERVALS = 6;

module.exports = { SAMPLE_INTERVAL_SECONDS, SMOOTHING_INTERVALS };
