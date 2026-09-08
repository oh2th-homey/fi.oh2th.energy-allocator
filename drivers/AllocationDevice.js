'use strict';

const Homey = require('homey');
const SmoothingWindow = require('../lib/SmoothingWindow');
const { SAMPLE_INTERVAL_SECONDS, SMOOTHING_INTERVALS } = require('../lib/constants');

const ENERGY_CAPS = ['meter_power.total', 'meter_power.grid', 'meter_power.pv', 'meter_power.bat'];
const SHARE_CAPS = ['measure_grid_share', 'measure_self_sufficiency'];

/** Always present: grid meter, shares, and reset button. */
const STATIC_CAPS = ['meter_power.grid', ...SHARE_CAPS, 'button.reset_meter'];

/** Present only while the app config has at least one source of that kind. */
const DYNAMIC_CAPS = ['meter_power.pv', 'meter_power.bat'];

/** Capability display order. */
const CAP_ORDER = [
  'meter_power.grid',
  'meter_power.pv',
  'meter_power.bat',
  'measure_grid_share',
  'measure_self_sufficiency',
  'button.reset_meter',
];

/**
 * Shared behaviour for the two allocator device types.
 * Subclasses implement {@link AllocationDevice#getMonitoredCounters}:
 *   - device-allocation: one counter, or several summed
 *   - house-allocation: `[]`
 */
class AllocationDevice extends Homey.Device {

  async onInit() {
    this.window = new SmoothingWindow(this._smoothingMs());
    this._lastTriggeredShare = null;

    await this._syncCapabilities();

    this.registerCapabilityListener('button.reset_meter', async () => this.resetMeters());

    // App-wide device trigger cards, shared by both allocator drivers.
    this._shareChangedTrigger = this.homey.flow.getDeviceTriggerCard('grid_share_changed');
    this._energyChangedTrigger = this.homey.flow.getDeviceTriggerCard('energy_allocation_changed');

    this.homey.app.registerConsumer(this);
    this.setAvailable().catch(this.error);

    const counters = this.getMonitoredCounters();
    const countersLabel = counters.length > 0
      ? counters.map((c) => `${c.deviceId}:${c.capability}`).join(', ')
      : 'none (house)';
    this.log(`initialised (counters=${countersLabel})`);
  }

  onDeleted() {
    this.homey.app.unregisterConsumer(this);
  }

  /**
   * `meter_power(.x)` counters this allocator sums to derive its own
   * consumption delta each interval. Empty for house-allocation, which
   * receives the whole-house split directly.
   * @returns {{deviceId:string, capability:string}[]}
   */
  getMonitoredCounters() {
    return [];
  }

  /**
   * Share-smoothing window duration, in milliseconds.
   * @returns {number}
   */
  _smoothingMs() {
    return SAMPLE_INTERVAL_SECONDS * SMOOTHING_INTERVALS * 1000;
  }

  /**
   * Extra capabilities always present for this allocator type, beyond the
   * common set in {@link STATIC_CAPS}. Empty for house-allocation.
   * @returns {string[]}
   */
  _extraStaticCaps() {
    return [];
  }

  /**
   * Dynamic capabilities the current app config calls for.
   * @returns {Record<string, boolean>}
   */
  _wantedDynamicCaps() {
    const cfg = this.homey.app.getConfig();
    return {
      'meter_power.pv': Array.isArray(cfg.pv) && cfg.pv.length > 0,
      'meter_power.bat': Array.isArray(cfg.battery) && cfg.battery.length > 0,
    };
  }

  /**
   * Brings this device's capability set in line with the app config. Adds
   * `meter_power.pv` / `meter_power.bat` when the first solar / battery
   * source is configured, removes them when the last one is deleted.
   * Idempotent.
   */
  async _syncCapabilities() {
    const wanted = this._wantedDynamicCaps();
    const extra = this._extraStaticCaps();
    const order = [...new Set([...CAP_ORDER, ...extra])];

    for (const cap of order) {
      const shouldHave = STATIC_CAPS.includes(cap) || extra.includes(cap) || wanted[cap] === true;
      const has = this.hasCapability(cap);

      if (shouldHave && !has) {
        await this.addCapability(cap).catch(this.error);
      } else if (!shouldHave && has && DYNAMIC_CAPS.includes(cap)) {
        await this.removeCapability(cap).catch(this.error);
      }
    }

    for (const cap of ENERGY_CAPS) {
      if (this.hasCapability(cap) && typeof this.getCapabilityValue(cap) !== 'number') {
        await this.setCapabilityValue(cap, 0).catch(this.error);
      }
    }
  }

  /** Called by the app when the source configuration changes. */
  async onConfigChanged() {
    await this._syncCapabilities();
  }

  /**
   * Called by the app once per sampling interval with this consumer's share
   * of the interval's energy.
   * @param {{grid:number, pv:number, bat:number, total:number}} allocation
   */
  async applyAllocation({ grid, pv, bat, total }) {
    await this._bump('meter_power.total', total);
    await this._bump('meter_power.grid', grid);
    await this._bump('meter_power.pv', pv);
    await this._bump('meter_power.bat', bat);

    this._maybeTriggerEnergyAllocationChanged(grid, pv, bat, total);

    this.window.add({ grid, pv, bat, total });

    const shares = this.window.shares();
    if (!shares) return;

    const gridShare = round(shares.gridShare, 1);
    const selfSufficiency = round(shares.selfSufficiency, 1);
    await this.setCapabilityValue('measure_grid_share', gridShare).catch(this.error);
    await this.setCapabilityValue('measure_self_sufficiency', selfSufficiency).catch(this.error);

    this._maybeTriggerShareChanged(gridShare, selfSufficiency);
  }

  async _bump(cap, amount) {
    if (!amount || amount <= 0) return;
    if (!this.hasCapability(cap)) return;
    const current = this.getCapabilityValue(cap) || 0;
    await this.setCapabilityValue(cap, current + amount).catch(this.error);
  }

  /**
   * Fires the `grid_share_changed` trigger when the grid share has moved
   * past {@link EnergyAllocatorApp#getConfig}'s `shareChangeThreshold` since
   * the last fire.
   * @param {number} gridShare
   * @param {number} selfSufficiency
   */
  _maybeTriggerShareChanged(gridShare, selfSufficiency) {
    const cfg = this.homey.app.getConfig();
    const threshold = Math.max(0, cfg.shareChangeThreshold || 0);

    if (this._lastTriggeredShare !== null
      && Math.abs(gridShare - this._lastTriggeredShare) < threshold) {
      return;
    }
    this._lastTriggeredShare = gridShare;

    if (!this._shareChangedTrigger) return;
    this._shareChangedTrigger
      .trigger(this, { grid_share: gridShare, self_sufficiency: selfSufficiency })
      .catch(this.error);
  }

  /**
   * Fires the `energy_allocation_changed` trigger whenever this interval
   * added energy to at least one of the grid/pv/bat/total counters, with the
   * device's current cumulative values as tokens. Capabilities this device
   * doesn't have (`meter_power.total` on house-allocation, `meter_power.pv`
   * / `.bat` when not configured) report 0.
   * @param {number} grid
   * @param {number} pv
   * @param {number} bat
   * @param {number} total
   */
  _maybeTriggerEnergyAllocationChanged(grid, pv, bat, total) {
    if (!this._energyChangedTrigger) return;
    if (!(grid > 0 || pv > 0 || bat > 0 || total > 0)) return;

    const value = (cap) => (this.hasCapability(cap) ? this.getCapabilityValue(cap) || 0 : 0);
    this._energyChangedTrigger
      .trigger(this, {
        grid_energy: value('meter_power.grid'),
        pv_energy: value('meter_power.pv'),
        bat_energy: value('meter_power.bat'),
        total_energy: value('meter_power.total'),
      })
      .catch(this.error);
  }

  /** Resets all energy and share capabilities to zero/null and clears the smoothing window. */
  async resetMeters() {
    this.window.clear();
    this._lastTriggeredShare = null;
    for (const cap of ENERGY_CAPS) {
      if (this.hasCapability(cap)) {
        await this.setCapabilityValue(cap, 0).catch(this.error);
      }
    }
    for (const cap of SHARE_CAPS) {
      await this.setCapabilityValue(cap, null).catch(this.error);
    }
    this.log('allocation meters reset');
  }
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

AllocationDevice.ENERGY_CAPS = ENERGY_CAPS;
AllocationDevice.SHARE_CAPS = SHARE_CAPS;

module.exports = AllocationDevice;
