// SPDX-License-Identifier: AGPL-3.0-or-later
import type { DirectTransport } from './direct.js';
export type DeviceErrorCode =
  | 'unsupported'
  | 'insecure-context'
  | 'permission-denied'
  | 'device-disconnected'
  | 'response-timeout'
  | 'notification-unavailable'
  | 'transport-failure'
  | 'connect-failed';
export class DeviceError extends Error {
  constructor(
    readonly code: DeviceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DeviceError';
  }
}
const classify = (error: unknown, action: string, stage: 'connect' | 'transfer' = 'transfer') => {
  if (error instanceof DeviceError) return error;
  const source = error as DOMException;
  if (source?.name === 'NotFoundError' || source?.name === 'SecurityError')
    return new DeviceError('permission-denied', `${action} was denied or no device was selected.`, { cause: error });
  // A failure while opening the port sent nothing, so it must not read like a
  // job that may have reached the printer.
  if (stage === 'connect')
    return new DeviceError(
      'connect-failed',
      `${action} could not open the device${source?.message ? `: ${source.message}` : '.'} Nothing was sent. Check that the printer is connected and that no other tab or application holds the port; macOS opens the cu. entry, not tty.`,
      { cause: error },
    );
  if (source?.name === 'NetworkError')
    return new DeviceError(
      'device-disconnected',
      `${action} lost the printer connection${source.message ? `: ${source.message}` : '.'} Reconnect it and inspect the job before retrying.`,
      { cause: error },
    );
  return new DeviceError('transport-failure', `${action} failed: ${source?.message ?? String(error)}`, {
    cause: error,
  });
};
interface BleCharacteristic {
  startNotifications(): Promise<BleCharacteristic>;
  writeValueWithoutResponse?(data: BufferSource): Promise<void>;
  writeValue?(data: BufferSource): Promise<void>;
  addEventListener(type: string, listener: (event: Event) => void): void;
}
interface BleServer {
  getPrimaryService(id: string): Promise<{ getCharacteristic(id: string): Promise<BleCharacteristic> }>;
  disconnect(): void;
}
interface BleDevice {
  gatt?: { connected: boolean; connect(): Promise<BleServer>; disconnect(): void };
}
interface BluetoothApi {
  requestDevice(options: unknown): Promise<BleDevice>;
}
export interface BluetoothOptions {
  service: string;
  writeCharacteristic: string;
  notifyCharacteristic?: string;
  filters?: unknown[];
  physicalWriteLimit?: number;
}
/** Optimistic BLE payload. Chrome negotiates a larger MTU than the 23-byte floor, and the 20-byte floor costs a delay per fragment. */
export const BLE_WRITE_LIMIT = 180;
const BLE_WRITE_FLOOR = 20;
const isPayloadTooLarge = (error: unknown) =>
  error instanceof Error && /too long|exceed|maximum|not supported|unknown reason/i.test(error.message);
export class WebBluetoothTransport implements DirectTransport {
  readonly kind = 'bluetooth' as const;
  readonly physicalWriteLimit: number;
  private device?: BleDevice;
  private server?: BleServer;
  private writer?: BleCharacteristic;
  private notifier?: BleCharacteristic;
  private replies: Uint8Array[] = [];
  private waiters: ((value: Uint8Array) => void)[] = [];
  private fragment: number;
  constructor(
    private options: BluetoothOptions,
    private bluetooth: BluetoothApi | undefined = (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth,
  ) {
    this.physicalWriteLimit = options.physicalWriteLimit ?? BLE_WRITE_LIMIT;
    this.fragment = this.physicalWriteLimit;
  }
  async connect() {
    if (!isSecureContext) throw new DeviceError('insecure-context', 'Web Bluetooth requires HTTPS or localhost.');
    if (!this.bluetooth) throw new DeviceError('unsupported', 'Web Bluetooth is unavailable in this browser.');
    try {
      const selection = this.options.filters
        ? { filters: this.options.filters, optionalServices: [this.options.service] }
        : { acceptAllDevices: true, optionalServices: [this.options.service] };
      this.device = await this.bluetooth.requestDevice(selection);
      if (!this.device.gatt) throw new Error('Selected device has no GATT server');
      this.server = await this.device.gatt.connect();
      const service = await this.server.getPrimaryService(this.options.service);
      this.writer = await service.getCharacteristic(this.options.writeCharacteristic);
      if (this.options.notifyCharacteristic)
        this.notifier = await service.getCharacteristic(this.options.notifyCharacteristic);
    } catch (error) {
      throw classify(error, 'Bluetooth connection', 'connect');
    }
  }
  async subscribe(_channel: string) {
    if (!this.notifier)
      throw new DeviceError('notification-unavailable', 'This printer definition has no notification characteristic.');
    await this.notifier.startNotifications();
    this.notifier.addEventListener('characteristicvaluechanged', (event) => {
      const view = (event.target as EventTarget & { value?: DataView }).value;
      if (!view) return;
      const data = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
      const waiter = this.waiters.shift();
      waiter ? waiter(data) : this.replies.push(data);
    });
  }
  async write(data: Uint8Array) {
    if (!this.writer) throw new DeviceError('device-disconnected', 'Bluetooth printer is not connected.');
    // The browser never reports the negotiated ATT MTU, so write optimistically
    // and halve on rejection, retrying the same bytes and remembering the size
    // the link accepted. A 20-byte floor costs a fragment per 20 bytes.
    for (let offset = 0; offset < data.length;) {
      const size = Math.min(this.fragment, data.length - offset);
      try {
        await this.send(data.subarray(offset, offset + size));
        offset += size;
      } catch (error) {
        if (size <= BLE_WRITE_FLOOR || !isPayloadTooLarge(error)) throw classify(error, 'Bluetooth write');
        this.fragment = Math.max(BLE_WRITE_FLOOR, size >> 1);
      }
    }
  }
  private async send(data: Uint8Array) {
    const buffer = new Uint8Array(data).buffer;
    if (this.writer!.writeValueWithoutResponse) return await this.writer!.writeValueWithoutResponse(buffer);
    if (this.writer!.writeValue) return await this.writer!.writeValue(buffer);
    throw new Error('Characteristic is not writable');
  }
  async waitResponse(_channel: string, timeoutMs: number, validation?: string, signal?: AbortSignal) {
    const deadline = performance.now() + timeoutMs;
    const collected: number[] = [];
    while (performance.now() < deadline) {
      const value = await this.nextReply(Math.max(1, deadline - performance.now()), timeoutMs, signal);
      if (validation !== 'phomemo-notification') return value;
      collected.push(...value);
      const frame = phomemoFrame(collected);
      if (frame) return frame;
    }
    throw new DeviceError('response-timeout', `Printer response timed out after ${timeoutMs} ms.`);
  }
  private async nextReply(remaining: number, timeoutMs: number, signal?: AbortSignal) {
    const queued = this.replies.shift();
    if (queued) return queued;
    return await new Promise<Uint8Array>((resolve, reject) => {
      const waiter = (value: Uint8Array) => {
        cleanup();
        resolve(value);
      };
      const abort = () => {
        cleanup();
        reject(new DOMException('Print cancelled.', 'AbortError'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((item) => item !== waiter);
        signal?.removeEventListener('abort', abort);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new DeviceError('response-timeout', `Printer response timed out after ${timeoutMs} ms.`));
      }, remaining);
      signal?.addEventListener('abort', abort, { once: true });
      this.waiters.push(waiter);
    });
  }
  async disconnect() {
    this.device?.gatt?.disconnect();
    this.device = undefined;
    this.writer = undefined;
    this.notifier = undefined;
  }
}
export interface SerialReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
  releaseLock(): void;
}
export interface SerialWriter {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  releaseLock(): void;
}
export interface SerialPort {
  readable?: { getReader(): SerialReader };
  writable?: { getWriter(): SerialWriter };
  open(options: {
    baudRate: number;
    dataBits: number;
    stopBits: number;
    parity: 'none';
    flowControl: 'none';
    bufferSize: number;
  }): Promise<void>;
  close(): Promise<void>;
}
export interface SerialApi {
  requestPort(options?: { filters?: { bluetoothServiceClassId: string }[] }): Promise<SerialPort>;
}
export interface SerialOptions {
  baudRate?: number;
  physicalWriteLimit?: number;
  commandWriteLimit?: number;
  bluetoothServiceClassId?: string;
  unfiltered?: boolean;
}
type SerialWaiter = { resolve: (data: Uint8Array) => void; reject: (error: unknown) => void };
export class WebSerialTransport implements DirectTransport {
  readonly kind = 'serial' as const;
  readonly physicalWriteLimit: number;
  readonly commandWriteLimit: number;
  private port?: SerialPort;
  private reader?: SerialReader;
  private writer?: SerialWriter;
  private replies: Uint8Array[] = [];
  private waiters: SerialWaiter[] = [];
  private reading = false;
  constructor(
    private options: SerialOptions = {},
    private serial: SerialApi | undefined = (navigator as Navigator & { serial?: SerialApi }).serial,
  ) {
    this.physicalWriteLimit = options.physicalWriteLimit ?? 512;
    this.commandWriteLimit = options.commandWriteLimit ?? 1024 * 1024;
  }
  async connect() {
    if (!isSecureContext) throw new DeviceError('insecure-context', 'Web Serial requires HTTPS or localhost.');
    if (!this.serial)
      throw new DeviceError(
        'unsupported',
        'Web Serial is unavailable in this browser. Use desktop Chrome 117 or newer.',
      );
    try {
      const service = this.options.bluetoothServiceClassId ?? '00001101-0000-1000-8000-00805f9b34fb';
      this.port = this.options.unfiltered
        ? await this.serial.requestPort()
        : await this.serial.requestPort({ filters: [{ bluetoothServiceClassId: service }] });
      await this.port.open({
        baudRate: this.options.baudRate ?? 115200,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
        bufferSize: 4096,
      });
      if (!this.port.writable) throw new Error('Selected serial port is not writable');
      this.writer = this.port.writable.getWriter();
      if (this.port.readable) {
        this.reader = this.port.readable.getReader();
        this.reading = true;
        void this.pump();
      }
    } catch (error) {
      throw classify(error, 'Bluetooth SPP connection', 'connect');
    }
  }
  async subscribe(_channel: string) {
    if (!this.reader)
      throw new DeviceError('notification-unavailable', 'This Bluetooth serial port has no readable stream.');
  }
  async write(data: Uint8Array) {
    if (!this.writer) throw new DeviceError('device-disconnected', 'Bluetooth serial printer is not connected.');
    try {
      await this.writer.write(new Uint8Array(data));
    } catch (error) {
      throw classify(error, 'Bluetooth SPP write');
    }
  }
  async waitResponse(_channel: string, timeoutMs: number, validation?: string, signal?: AbortSignal) {
    if (!this.reader)
      throw new DeviceError('notification-unavailable', 'This Bluetooth serial port has no readable stream.');
    const expected = validation === 'brother-status32' ? 32 : validation === 'phomemo-notification' ? 3 : 1;
    const collected: number[] = [];
    const deadline = performance.now() + timeoutMs;
    while (collected.length < expected || validation === 'phomemo-notification') {
      const remaining = deadline - performance.now();
      if (remaining <= 0)
        throw new DeviceError('response-timeout', `Printer response timed out after ${timeoutMs} ms.`);
      collected.push(...(await this.nextChunk(remaining, signal)));
      if (validation === 'phomemo-notification') {
        const frame = phomemoFrame(collected);
        if (frame) return frame;
      } else if (collected.length >= expected) return Uint8Array.from(collected);
    }
    return Uint8Array.from(collected);
  }
  async disconnect() {
    this.reading = false;
    const reader = this.reader;
    this.reader = undefined;
    if (reader) {
      try {
        await reader.cancel();
      } catch {}
      reader.releaseLock();
    }
    const writer = this.writer;
    this.writer = undefined;
    if (writer) {
      try {
        await writer.close();
      } catch {}
      writer.releaseLock();
    }
    const port = this.port;
    this.port = undefined;
    if (port)
      try {
        await port.close();
      } catch {}
    this.rejectWaiters(new DeviceError('device-disconnected', 'Bluetooth serial printer disconnected.'));
  }
  private async pump() {
    try {
      while (this.reading && this.reader) {
        const { done, value } = await this.reader.read();
        if (done) break;
        if (value?.length) {
          const waiter = this.waiters.shift();
          waiter ? waiter.resolve(new Uint8Array(value)) : this.replies.push(new Uint8Array(value));
        }
      }
      if (this.reading)
        this.rejectWaiters(new DeviceError('device-disconnected', 'Bluetooth serial printer stopped responding.'));
    } catch (error) {
      if (this.reading) this.rejectWaiters(classify(error, 'Bluetooth SPP read'));
    }
  }
  private async nextChunk(timeoutMs: number, signal?: AbortSignal) {
    const queued = this.replies.shift();
    if (queued) return queued;
    return await new Promise<Uint8Array>((resolve, reject) => {
      const waiter: SerialWaiter = {
        resolve: (data) => {
          cleanup();
          resolve(data);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };
      const abort = () => waiter.reject(new DOMException('Print cancelled.', 'AbortError'));
      const timer = setTimeout(
        () =>
          waiter.reject(
            new DeviceError('response-timeout', `Printer response timed out after ${Math.ceil(timeoutMs)} ms.`),
          ),
        timeoutMs,
      );
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((item) => item !== waiter);
        signal?.removeEventListener('abort', abort);
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.waiters.push(waiter);
    });
  }
  private rejectWaiters(error: unknown) {
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
}
interface UsbDevice {
  opened: boolean;
  configuration?: {
    interfaces: {
      interfaceNumber: number;
      alternates: {
        alternateSetting: number;
        endpoints: { endpointNumber: number; direction: 'in' | 'out'; type: string; packetSize: number }[];
      }[];
    }[];
  };
  open(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(value: number): Promise<void>;
  selectAlternateInterface(value: number, alternate: number): Promise<void>;
  transferOut(endpoint: number, data: BufferSource): Promise<{ status?: string; bytesWritten?: number }>;
  transferIn(endpoint: number, length: number): Promise<{ status?: string; data?: DataView }>;
  close(): Promise<void>;
}
interface UsbApi {
  requestDevice(options: unknown): Promise<UsbDevice>;
}
export interface UsbOptions {
  filters: { vendorId?: number; productId?: number; classCode?: number }[];
  configurationValue?: number;
  interfaceNumber?: number;
  outEndpoint?: number;
  inEndpoint?: number;
  physicalWriteLimit?: number;
  commandWriteLimit?: number;
}
export class WebUsbTransport implements DirectTransport {
  readonly kind = 'usb' as const;
  physicalWriteLimit: number;
  readonly commandWriteLimit: number;
  private device?: UsbDevice;
  private outEndpoint?: number;
  private inEndpoint?: number;
  constructor(
    private options: UsbOptions,
    private usb: UsbApi | undefined = (navigator as Navigator & { usb?: UsbApi }).usb,
  ) {
    this.physicalWriteLimit = options.physicalWriteLimit ?? 1024;
    this.commandWriteLimit = options.commandWriteLimit ?? 1024 * 1024;
  }
  async connect() {
    if (!isSecureContext) throw new DeviceError('insecure-context', 'WebUSB requires HTTPS or localhost.');
    if (!this.usb) throw new DeviceError('unsupported', 'WebUSB is unavailable in this browser.');
    try {
      this.device = await this.usb.requestDevice({ filters: this.options.filters });
      await this.device.open();
      if (!this.device.configuration) await this.device.selectConfiguration(this.options.configurationValue ?? 1);
      const iface = this.options.interfaceNumber ?? this.device.configuration?.interfaces[0]?.interfaceNumber ?? 0;
      await this.device.claimInterface(iface);
      const alternate = this.device.configuration?.interfaces.find((item) => item.interfaceNumber === iface)
        ?.alternates[0];
      if (alternate && alternate.alternateSetting)
        await this.device.selectAlternateInterface(iface, alternate.alternateSetting);
      const out = alternate?.endpoints.find((item) => item.direction === 'out' && item.type === 'bulk');
      const input = alternate?.endpoints.find((item) => item.direction === 'in' && item.type === 'bulk');
      this.outEndpoint = this.options.outEndpoint ?? out?.endpointNumber;
      this.inEndpoint = this.options.inEndpoint ?? input?.endpointNumber;
      if (this.outEndpoint === undefined) throw new Error('No bulk OUT endpoint');
      this.physicalWriteLimit = Math.min(this.physicalWriteLimit, out?.packetSize ?? this.physicalWriteLimit);
    } catch (error) {
      throw classify(error, 'USB connection', 'connect');
    }
  }
  async subscribe(_channel: string) {
    if (this.inEndpoint === undefined)
      throw new DeviceError('notification-unavailable', 'This USB printer has no response endpoint.');
  }
  async write(data: Uint8Array) {
    if (!this.device || this.outEndpoint === undefined)
      throw new DeviceError('device-disconnected', 'USB printer is not connected.');
    try {
      const result = await this.device.transferOut(this.outEndpoint, new Uint8Array(data).buffer);
      if (result.status && result.status !== 'ok') throw new Error(`transfer status ${result.status}`);
      if (result.bytesWritten !== undefined && result.bytesWritten !== data.byteLength)
        throw new Error(`short transfer: ${result.bytesWritten} of ${data.byteLength} bytes`);
    } catch (error) {
      throw classify(error, 'USB write');
    }
  }
  async waitResponse(_channel: string, timeoutMs: number, validation?: string, signal?: AbortSignal) {
    if (!this.device || this.inEndpoint === undefined)
      throw new DeviceError('notification-unavailable', 'This USB printer has no response endpoint.');
    const expected = validation === 'brother-status32' ? 32 : validation === 'phomemo-notification' ? 3 : 1;
    const collected: number[] = [];
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (signal?.aborted) throw new DOMException('Print cancelled.', 'AbortError');
      const remaining = Math.max(1, deadline - performance.now());
      const result = await cancellableUsbRead(
        this.device,
        this.inEndpoint,
        this.physicalWriteLimit,
        remaining,
        timeoutMs,
        signal,
      );
      if (result.status && result.status !== 'ok')
        throw new DeviceError('transport-failure', `USB read failed with ${result.status}.`);
      if (result.data?.byteLength) {
        collected.push(
          ...new Uint8Array(
            result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength),
          ),
        );
        if (validation === 'phomemo-notification') {
          const frame = phomemoFrame(collected);
          if (frame) return frame;
        } else if (collected.length >= expected) return Uint8Array.from(collected);
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (collected.length && validation !== 'phomemo-notification') return Uint8Array.from(collected);
    throw new DeviceError('response-timeout', `Printer response timed out after ${timeoutMs} ms.`);
  }
  async disconnect() {
    if (this.device?.opened) await this.device.close();
    this.device = undefined;
  }
}
function phomemoFrame(bytes: number[]): Uint8Array | undefined {
  const start = bytes.indexOf(0x1a);
  return start >= 0 && bytes.length - start >= 3 ? Uint8Array.from(bytes.slice(start)) : undefined;
}
function cancellableUsbRead(
  device: UsbDevice,
  endpoint: number,
  length: number,
  remaining: number,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  return new Promise<{ status?: string; data?: DataView }>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => finish(() => reject(new DOMException('Print cancelled.', 'AbortError')));
    const timer = setTimeout(
      () =>
        finish(() => reject(new DeviceError('response-timeout', `Printer response timed out after ${timeoutMs} ms.`))),
      remaining,
    );
    signal?.addEventListener('abort', abort, { once: true });
    device.transferIn(endpoint, length).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(classify(error, 'USB read'))),
    );
  });
}
