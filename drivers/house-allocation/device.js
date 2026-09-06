'use strict';

const AllocationDevice = require('../AllocationDevice');

module.exports = class HouseAllocationDevice extends AllocationDevice {

  /**
   * @returns {{deviceId:string, capability:string}[]} always empty; the
   * whole-house device receives the house split directly.
   */
  getMonitoredCounters() {
    return [];
  }
};
