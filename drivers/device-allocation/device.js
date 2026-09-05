'use strict';

const AllocationDevice = require('../../lib/AllocationDevice');

module.exports = class DeviceAllocationDevice extends AllocationDevice {

  /**
   * Monitored-counter state lives in **store** (mutable, so `driver.js`
   * `onRepair` can change it later) - `data` only carries the immutable
   * pairing identity: `uid` and `mode` (`individual` | `summary`, fixed for
   * the device's lifetime; repair cannot change it). Devices paired before
   * this existed have their counter(s) in `data` instead, read here as a
   * fallback so they keep working untouched until their first repair, after
   * which the repaired value lives in `store` and takes over.
   */
  getMonitoredCounters() {
    const store = this.getStore();
    if (Array.isArray(store.counters) && store.counters.length > 0) {
      return store.counters.map((c) => ({ deviceId: c.deviceId, capability: c.capability || 'meter_power' }));
    }
    if (store.deviceId) {
      return [{ deviceId: store.deviceId, capability: store.capability || 'meter_power' }];
    }

    const data = this.getData();
    if (Array.isArray(data.counters) && data.counters.length > 0) {
      return data.counters.map((c) => ({ deviceId: c.deviceId, capability: c.capability || 'meter_power' }));
    }
    if (data.deviceId) {
      return [{ deviceId: data.deviceId, capability: data.capability || 'meter_power' }];
    }
    return [];
  }

  /**
   * Which pairing mode this device was created in - fixed for its lifetime,
   * `onRepair` only ever changes the counter selection, never this.
   * @returns {'individual'|'summary'}
   */
  getAllocationMode() {
    const data = this.getData();
    if (data.mode === 'summary' || data.mode === 'individual') return data.mode;

    // Devices paired before `data.mode` existed: infer it from the data shape.
    const store = this.getStore();
    if (Array.isArray(store.counters) || Array.isArray(data.counters)) return 'summary';
    return 'individual';
  }
};
