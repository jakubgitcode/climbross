// Climbro hangboard over Web Bluetooth.
// The board uses Microchip's "Transparent UART" GATT profile and streams
// force readings as notifications as soon as they are enabled.

export const SERVICE_UUID = '49535343-fe7d-4ae5-8fa9-9fafd205e455';
export const NOTIFY_CHAR_UUID = '49535343-1e4d-4bd9-ba61-23c647249616';
export const WRITE_CHAR_UUID = '49535343-8841-43f4-a8d4-ecbe34729bb3';

// Advertised name prefixes seen in the official app (case varies by firmware).
const NAME_PREFIXES = ['Climbro', 'CLIMBRO', 'climbro', 'FIBO', 'Fibo', 'SmartBoard', 'SMARTBOARD',
  'Climboard', 'CLIMBOARD', 'RN4870', 'SmartEgg', 'SMARTEGG'];
const OLD_DEVICE_NAMES = ['FIBO', 'SMARTBOARD', 'CLIMBOARD'];

const SYNC1 = 0xaa;
const SYNC2 = 0x55;
const LEGACY_BATTERY = 0xf0;
const LEGACY_FORCE = 0xf5;
const LEGACY_ESCAPE = 0xf6; // stands in for the value 36

/**
 * Parses notification payloads into readings.
 * onReading({ kg, pcbV2, battery?, hanging? }) is called once per force sample.
 */
export class ClimbroParser {
  constructor(deviceName, onReading) {
    const upper = (deviceName || '').toUpperCase();
    this.isMini = upper.startsWith('CLIMBROMINI');
    this.isOld = OLD_DEVICE_NAMES.includes(upper);
    this.onReading = onReading;
    this.legacyFlag = 0;
    this.battery = null;
    // Mini reports hanging (1) vs lifting (0); smoothed like the official app.
    this.positions = [];
  }

  push(bytes) {
    if (bytes.length >= 8 && bytes[0] === SYNC1 && bytes[1] === SYNC2) {
      this.parseV2(bytes);
    } else {
      this.parseLegacy(bytes);
    }
  }

  parseV2(b) {
    const grams = (b[2] | (b[3] << 8) | (b[4] << 16) | (b[5] << 24)) | 0;
    this.battery = clampPct((b[7] - 32) * 10);
    const hanging = this.isMini ? this.updatePosition(b[6]) : true;
    let kg = grams / 1000;
    // Lifting mode on the Mini reads 0.5 kg low (from the official app).
    if (this.isMini && !hanging) kg += 0.5;
    this.onReading({ kg, pcbV2: true, battery: this.battery, hanging });
  }

  parseLegacy(bytes) {
    for (let v of bytes) {
      if (v === LEGACY_BATTERY) { this.legacyFlag = LEGACY_BATTERY; continue; }
      if (v === LEGACY_FORCE) { this.legacyFlag = LEGACY_FORCE; continue; }
      if (v === LEGACY_ESCAPE) v = 36;
      if (this.legacyFlag === LEGACY_BATTERY) {
        this.battery = clampPct(this.isOld ? (v - 155) * 1.2987 : (v - 112) * 0.8475);
        this.legacyFlag = 0;
      } else if (this.legacyFlag === LEGACY_FORCE) {
        this.onReading({ kg: v, pcbV2: false, battery: this.battery, hanging: true });
      }
    }
  }

  updatePosition(p) {
    this.positions.push(p);
    if (this.positions.length > 100) this.positions.shift();
    const avg = this.positions.reduce((a, x) => a + x, 0) / this.positions.length;
    return Math.round(avg) === 1;
  }
}

function clampPct(x) {
  return Math.max(0, Math.min(100, Math.round(x)));
}

/**
 * Smooths the live readout the same way the official app does: a running
 * average that resets whenever the signal jumps away from it.
 */
export class ForceFilter {
  constructor() { this.reset(); }

  reset() {
    this.queue = [];
    this.sum = 0;
    this.value = 0;
  }

  // Returns the cleaned raw value (noise floor applied); `value` holds the smoothed one.
  push({ kg, pcbV2, hanging }) {
    let f = kg;
    if ((!pcbV2 && f < 2) || (pcbV2 && hanging && f < 0.5)) f = 0;
    else if (pcbV2 && !hanging && f < 1) f = 0.5;

    this.queue.push(f);
    this.sum += f;
    if (this.queue.length > 140) this.sum -= this.queue.shift();
    const avg = this.sum / this.queue.length;
    if (Math.abs(avg - f) > (pcbV2 ? 0.4 : 2)) {
      this.value = f;
      this.queue = [f];
      this.sum = f;
    } else {
      this.value = avg;
    }
    return f;
  }
}

export function isSupported() {
  return !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
}

/** Connects to a board. Returns { name, disconnect() }. */
export async function connect({ onReading, onDisconnect, showAll = false }) {
  const options = showAll
    ? { acceptAllDevices: true, optionalServices: [SERVICE_UUID] }
    : {
        filters: [{ services: [SERVICE_UUID] }, ...NAME_PREFIXES.map((namePrefix) => ({ namePrefix }))],
        optionalServices: [SERVICE_UUID],
      };
  const device = await navigator.bluetooth.requestDevice(options);
  device.addEventListener('gattserverdisconnected', () => onDisconnect && onDisconnect());

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);
  const notify = await service.getCharacteristic(NOTIFY_CHAR_UUID);
  const parser = new ClimbroParser(device.name, onReading);
  notify.addEventListener('characteristicvaluechanged', (e) => {
    const dv = e.target.value;
    parser.push(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
  });
  await notify.startNotifications();

  return {
    name: device.name || 'Climbro',
    disconnect: () => device.gatt.connected && device.gatt.disconnect(),
  };
}

/** Fake board for trying the app without hardware: pull, hold, release. */
export function connectDemo({ onReading }) {
  const start = performance.now();
  const timer = setInterval(() => {
    const t = ((performance.now() - start) / 1000) % 12;
    let kg = 0;
    if (t > 2 && t < 9) {
      const ramp = Math.min(1, (t - 2) / 0.6);
      const fade = t > 7 ? Math.max(0, 1 - (t - 7) / 2) * 0.4 + 0.6 : 1;
      kg = 38 * ramp * fade + (Math.random() - 0.5) * 0.6;
      if (t > 8.6) kg = Math.max(0, kg * (9 - t) / 0.4);
    }
    onReading({ kg: Math.max(0, kg), pcbV2: true, battery: 87, hanging: true });
  }, 1000 / 80);
  return { name: 'Demo board', disconnect: () => clearInterval(timer) };
}
