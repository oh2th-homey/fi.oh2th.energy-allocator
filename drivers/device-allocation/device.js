'use strict';

const AllocationDevice = require('../AllocationDevice');

module.exports = class DeviceAllocationDevice extends AllocationDevice {

  /**
   * Reads the monitored counter(s) from `store` (mutable, set by `driver.js`
   * `onRepair`), falling back to `data` for devices paired before the
   * `store`/`data` split existed.
   * @returns {{deviceId:string, capability:string}[]}
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
   * Pairing mode this device was created in. Fixed for the device's
   * lifetime; `onRepair` changes only the counter selection.
   * @returns {'individual'|'summary'}
   */
  getAllocationMode() {
    const data = this.getData();
    if (data.mode === 'summary' || data.mode === 'individual') return data.mode;

    const store = this.getStore();
    if (Array.isArray(store.counters) || Array.isArray(data.counters)) return 'summary';
    return 'individual';
  }

  /**
   * Adds `meter_power.total`, the running total allocated to this device
   * (`meter_power.grid + .pv + .bat`).
   * @returns {string[]}
   */
  _extraStaticCaps() {
    return ['meter_power.total'];
  }
};
