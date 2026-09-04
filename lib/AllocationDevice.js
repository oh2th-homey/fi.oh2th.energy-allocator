'use strict';

const Homey = require('homey');
const SmoothingWindow = require('./SmoothingWindow');

const ENERGY_CAPS = ['meter_power.grid', 'meter_power.pv', 'meter_power.bat'];
const SHARE_CAPS = ['th_grid_share', 'th_self_sufficiency'];

// Grid is mandatory, so it (and the shares / reset button) are always present.
const STATIC_CAPS = ['meter_power.grid', ...SHARE_CAPS, 'button.reset_meter'];

// Solar / battery outputs only exist while the app config has at least one
// source of that kind. Ordered as they should appear in the UI.
const DYNAMIC_CAPS = ['meter_power.pv', 'meter_power.bat'];

// Full display order, used so a re-added capability lands in a sensible slot.
const CAP_ORDER = [
  'meter_power.grid',
  'meter_power.pv',
  'meter_power.bat',
  'th_grid_share',
  'th_self_sufficiency',
  'button.reset_meter',
];

/**
 * Shared behaviour for the two allocator device types. Subclasses implement
 * {@link AllocationDevice#getMonitoredDeviceId}:
 *   - device-allocation returns the id of the device it follows
 *   - house-allocation returns null (it receives the whole-house split directly)
 */
class AllocationDevice extends Homey.Device {

  async onInit() {
    this.window = new SmoothingWindow(this._smoothingMs());
    this._lastTriggeredShare = null;

    await this._syncCapabilities();

    this.registerCapabilityListener('button.reset_meter', async () => this.resetMeters());

    try {
      this._shareChangedTrigger = this.homey.flow.getDeviceTriggerCard('grid_share_changed');
    } catch (err) {
      this._shareChangedTrigger = null; // driver has no such Flow card
    }

    this.homey.app.registerConsumer(this);
    this.setAvailable().catch(this.error);
    this.log(`initialised (monitoredDeviceId=${this.getMonitoredDeviceId() || 'none'})`);
  }

  onDeleted() {
    this.homey.app.unregisterConsumer(this);
  }

  /** @returns {string|null} */
  getMonitoredDeviceId() {
    return null;
  }

  _smoothingMs() {
    const cfg = this.homey.app.getConfig();
    return Math.max(1, cfg.smoothingMinutes || 5) * 60 * 1000;
  }

  /**
   * Which dynamic capabilities the current app config calls for.
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
   * Bring this device's capability set in line with the app config: static caps
   * are always present; `meter_power.pv` / `meter_power.bat` are added when the
   * first solar / battery source is configured and removed when the last one is
   * deleted. Safe to call repeatedly (idempotent).
   */
  async _syncCapabilities() {
    const wanted = this._wantedDynamicCaps();

    for (const cap of CAP_ORDER) {
      const shouldHave = STATIC_CAPS.includes(cap) || wanted[cap] === true;
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

  /**
   * Called by the app whenever the source configuration changes, so a newly
   * added / removed solar or battery source is reflected on the device.
   */
  async onConfigChanged() {
    this.window.setWindow(this._smoothingMs());
    await this._syncCapabilities();
  }

  /**
   * Called by the app once per sampling interval with this consumer's share of
   * the interval's energy.
   *
   * @param {{grid:number, pv:number, bat:number, total:number}} allocation
   */
  async applyAllocation({ grid, pv, bat, total }) {
    await this._bump('meter_power.grid', grid);
    await this._bump('meter_power.pv', pv);
    await this._bump('meter_power.bat', bat);

    this.window.setWindow(this._smoothingMs());
    this.window.add({ grid, pv, bat, total });

    const shares = this.window.shares();
    if (!shares) return;

    const gridShare = round(shares.gridShare, 1);
    const selfSufficiency = round(shares.selfSufficiency, 1);
    await this.setCapabilityValue('th_grid_share', gridShare).catch(this.error);
    await this.setCapabilityValue('th_self_sufficiency', selfSufficiency).catch(this.error);

    this._maybeTriggerShareChanged(gridShare, selfSufficiency);
  }

  async _bump(cap, amount) {
    if (!amount || amount <= 0) return;
    if (!this.hasCapability(cap)) return;
    const current = this.getCapabilityValue(cap) || 0;
    await this.setCapabilityValue(cap, current + amount).catch(this.error);
  }

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
