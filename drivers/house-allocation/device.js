'use strict';

const AllocationDevice = require('../../lib/AllocationDevice');

module.exports = class HouseAllocationDevice extends AllocationDevice {

  /** The whole-house device receives the house split directly, not via a monitored device. */
  getMonitoredDeviceId() {
    return null;
  }
};
