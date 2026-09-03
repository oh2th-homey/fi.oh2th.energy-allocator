'use strict';

const Homey = require('homey');
const { HomeyAPI } = require('homey-api');
const { computeHouseSplit, attribute } = require('./lib/allocation');

const CONFIG_KEY = 'config';

const DEFAULT_CONFIG = {
  grid: null, // { deviceId, importCapability, exportCapability }
  pv: [], // [{ deviceId, capability }]
  battery: [], // [{ deviceId, chargeCapability, dischargeCapability }]
  intervalSeconds: 60,
  smoothingMinutes: 5,
  shareChangeThreshold: 5,
};

module.exports = class EnergyAllocatorApp extends Homey.App {

  async onInit() {
    /** @type {Set<import('./lib/AllocationDevice')>} */
    this.consumers = new Set();
    /** @type {Map<string, number>} key `${deviceId}::${capability}` -> last raw reading */
    this.baselines = new Map();
    this.lastTickAt = null;
    this._sampleTimer = null;

    this.homeyApi = await HomeyAPI.createAppAPI({ homey: this.homey });

    this.homey.settings.on('set', (key) => {
      if (key === CONFIG_KEY) this.restartSampler('configuration changed');
    });

    this.restartSampler('startup');
    this.log('Energy Allocator initialised');
  }

  async onUninit() {
    if (this._sampleTimer) this.homey.clearInterval(this._sampleTimer);
  }

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  getConfig() {
    const stored = this.homey.settings.get(CONFIG_KEY);
    return {
      ...DEFAULT_CONFIG,
      ...(stored && typeof stored === 'object' ? stored : {}),
    };
  }

  async setConfig(config) {
    const merged = {
      ...DEFAULT_CONFIG,
      ...(config && typeof config === 'object' ? config : {}),
    };
    merged.pv = Array.isArray(merged.pv) ? merged.pv : [];
    merged.battery = Array.isArray(merged.battery) ? merged.battery : [];

    this.homey.settings.set(CONFIG_KEY, merged);
    this.restartSampler('configuration saved');
    return merged;
  }

  // ---------------------------------------------------------------------------
  // Consumer registry (allocator devices)
  // ---------------------------------------------------------------------------

  registerConsumer(device) {
    this.consumers.add(device);
  }

  unregisterConsumer(device) {
    this.consumers.delete(device);
  }

  // ---------------------------------------------------------------------------
  // Sampling loop
  // ---------------------------------------------------------------------------

  restartSampler(reason) {
    if (this._sampleTimer) {
      this.homey.clearInterval(this._sampleTimer);
      this._sampleTimer = null;
    }
    this.baselines.clear();
    this.lastTickAt = null;

    const cfg = this.getConfig();
    const intervalMs = Math.max(10, Number(cfg.intervalSeconds) || 60) * 1000;

    this._sampleTimer = this.homey.setInterval(() => {
      this.tick().catch((err) => this.error('sample tick failed:', err));
    }, intervalMs);

    this.homey.setTimeout(() => {
      this.tick().catch((err) => this.error('initial sample tick failed:', err));
    }, 2500);

    this.log(`sampler (re)started - ${reason}; interval ${intervalMs / 1000}s`);
  }

  _key(deviceId, capability) {
    return `${deviceId}::${capability}`;
  }

  _readValue(devices, deviceId, capability) {
    const device = devices[deviceId];
    if (!device) throw new Error(`device ${deviceId} not found`);
    const capObj = device.capabilitiesObj && device.capabilitiesObj[capability];
    if (!capObj || typeof capObj.value !== 'number' || !Number.isFinite(capObj.value)) {
      throw new Error(`capability ${capability} unavailable on ${device.name || deviceId}`);
    }
    return capObj.value;
  }

  async tick() {
    const cfg = this.getConfig();
    if (!cfg.grid || !cfg.grid.deviceId || !cfg.grid.importCapability) return;

    const devices = await this.homeyApi.devices.getDevices();

    /** @type {{key:string, deviceId:string, capability:string}[]} */
    const reads = [];
    const addRead = (deviceId, capability) => {
      if (deviceId && capability) {
        reads.push({ key: this._key(deviceId, capability), deviceId, capability });
      }
    };

    addRead(cfg.grid.deviceId, cfg.grid.importCapability);
    if (cfg.grid.exportCapability) addRead(cfg.grid.deviceId, cfg.grid.exportCapability);
    for (const src of cfg.pv) addRead(src.deviceId, src.capability);
    for (const src of cfg.battery) {
      addRead(src.deviceId, src.chargeCapability);
      addRead(src.deviceId, src.dischargeCapability);
    }

    /** @type {Map<object, {key:string}>} consumer -> monitored read */
    const monitoredReads = new Map();
    for (const consumer of this.consumers) {
      const monitoredId = consumer.getMonitoredDeviceId();
      if (!monitoredId) continue;
      const rec = { key: this._key(monitoredId, 'meter_power'), deviceId: monitoredId, capability: 'meter_power' };
      monitoredReads.set(consumer, rec);
      reads.push(rec);
    }

    // Read every needed value; if any is missing, skip this tick and keep the
    // baselines - the sample-gap guard below will re-baseline if the outage lasts.
    const current = new Map();
    try {
      for (const read of reads) {
        current.set(read.key, this._readValue(devices, read.deviceId, read.capability));
      }
    } catch (err) {
      this.log(`skipping tick: ${err.message}`);
      return;
    }

    const now = Date.now();

    // First tick after (re)start: just establish baselines.
    if (this.lastTickAt === null || this.baselines.size === 0) {
      for (const [key, value] of current) this.baselines.set(key, value);
      this.lastTickAt = now;
      return;
    }

    const dtSeconds = (now - this.lastTickAt) / 1000;
    const maxGapSeconds = Math.max((Number(cfg.intervalSeconds) || 60) * 5, 300);

    const rebaseline = () => {
      for (const [key, value] of current) this.baselines.set(key, value);
      this.lastTickAt = now;
    };

    // Per-counter deltas + reset detection.
    const delta = new Map();
    let resetDetected = false;
    for (const [key, value] of current) {
      const base = this.baselines.get(key);
      const dv = base === undefined ? 0 : value - base;
      if (dv < -1e-6) resetDetected = true;
      delta.set(key, Math.max(0, dv));
    }

    if (resetDetected) {
      this.log('meter reset detected - re-baselining, interval skipped');
      rebaseline();
      return;
    }
    if (dtSeconds > maxGapSeconds) {
      this.log(`sample gap ${Math.round(dtSeconds)}s exceeds ${maxGapSeconds}s - re-baselining, interval skipped`);
      rebaseline();
      return;
    }

    const d = (deviceId, capability) => delta.get(this._key(deviceId, capability)) || 0;

    const gridImport = d(cfg.grid.deviceId, cfg.grid.importCapability);
    const gridExport = cfg.grid.exportCapability ? d(cfg.grid.deviceId, cfg.grid.exportCapability) : 0;

    let pv = 0;
    for (const src of cfg.pv) pv += d(src.deviceId, src.capability);

    let batCharge = 0;
    let batDischarge = 0;
    for (const src of cfg.battery) {
      batCharge += d(src.deviceId, src.chargeCapability);
      batDischarge += d(src.deviceId, src.dischargeCapability);
    }

    const split = computeHouseSplit({ gridImport, gridExport, pv, batCharge, batDischarge });
    if (!split.ok) {
      this.log(`interval skipped: ${split.reason}`);
      rebaseline();
      return;
    }

    for (const consumer of this.consumers) {
      try {
        const monitored = monitoredReads.get(consumer);
        if (monitored) {
          const deviceDelta = delta.get(monitored.key) || 0;
          const allocation = deviceDelta > 0
            ? attribute(deviceDelta, split)
            : { grid: 0, pv: 0, bat: 0, total: 0 };
          await consumer.applyAllocation(allocation);
        } else {
          await consumer.applyAllocation({
            grid: split.houseGrid,
            pv: split.housePv,
            bat: split.houseBat,
            total: split.houseTotal,
          });
        }
      } catch (err) {
        this.error(`consumer ${consumer.getName ? consumer.getName() : '?'} update failed:`, err);
      }
    }

    rebaseline();
  }

  // ---------------------------------------------------------------------------
  // Settings-page support (see api.js)
  // ---------------------------------------------------------------------------

  /**
   * All Homey devices that expose one or more `meter_power` capabilities,
   * with the concrete capability ids the settings UI can map to source roles.
   */
  async getMeterDevices() {
    const devices = await this.homeyApi.devices.getDevices();
    const result = [];

    for (const device of Object.values(devices)) {
      const meterCaps = (device.capabilities || [])
        .filter((cap) => cap === 'meter_power' || cap.startsWith('meter_power.'));
      if (meterCaps.length === 0) continue;

      result.push({
        id: device.id,
        name: device.name,
        zone: device.zoneName || null,
        capabilities: meterCaps.map((cap) => ({
          id: cap,
          title: (device.capabilitiesObj
            && device.capabilitiesObj[cap]
            && device.capabilitiesObj[cap].title) || cap,
        })),
      });
    }

    result.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return result;
  }
};
