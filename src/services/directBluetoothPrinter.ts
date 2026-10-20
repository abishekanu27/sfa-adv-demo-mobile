/**
 * directBluetoothPrinter.ts
 * High-performance, direct In-App Bluetooth ESC/POS Thermal Printing.
 * Bypasses Android print spooler and eliminates third-party apps like RawBT completely.
 * Native hardware control for Posiflow PSF310 (80mm) and all ESC/POS thermal printers.
 */

import { Platform, PermissionsAndroid } from 'react-native';
import { getCompanyProfile, ExpenseRecord } from '../database/db';

export type Node =
  | { type: 'text'; content: string; style?: any }
  | { type: 'line'; style?: 'solid' | 'dashed'; character?: string }
  | { type: 'raw'; data: number[] }
  | { type: 'qr'; content: string; size?: number; errorLevel?: string }
  | { type: 'feed'; lines: number }
  | { type: 'cut'; partial?: boolean }
  | { type: 'image'; [key: string]: any };

export interface Device {
  address: string;
  name?: string;
  deviceType?: string;
  rssi?: number;
}

export function text(content: string, style?: any): Node {
  return { type: 'text', content: sanitizeAscii(content), style };
}
export function line(options?: { style?: 'solid' | 'dashed'; character?: string }): Node {
  return { type: 'line', ...options };
}
export function raw(data: number[]): Node {
  return { type: 'raw', data };
}
export function qr(content: string, options?: any): Node {
  return { type: 'qr', content, ...options };
}
export function feed(lines: number): Node {
  return { type: 'feed', lines };
}
export function cut(options?: { partial?: boolean }): Node {
  return { type: 'cut', partial: options?.partial };
}
export function image(source: any): Node {
  return { type: 'image', ...source };
}

let _driverCached: any = null;
function getThermalPrinter(): any {
  if (_driverCached !== null) return _driverCached;
  try {
    // Only resolve native module dynamically when executed in a native client/APK
    const mod = require('react-native-thermal-printer-driver');
    _driverCached = mod?.default || mod;
    return _driverCached;
  } catch {
    _driverCached = false;
    return null;
  }
}
import { getCompanyLogo } from '../utils/companyBranding';
import { getPrinterSettings, savePrinterSettings } from './printerSettingsService';
import type { MobileInvoiceData } from './invoiceService';
import type { ReportPrintOptions } from './reportPrintService';

let printAbortedGlobal = false;

export function abortActivePrint(): void {
  printAbortedGlobal = true;
}

export function resetActivePrintAbort(): void {
  printAbortedGlobal = false;
}

export function isPrintAborted(): boolean {
  return printAbortedGlobal;
}

/**
 * Normalizes Bluetooth address for react-native-thermal-printer-driver.
 * The native driver requires "bt:<MAC>" format for Bluetooth Classic (SPP)
 * and uppercase colons (e.g. "bt:86:67:7A:63:8E:DF").
 */
export function normalizeBluetoothAddress(rawAddress: string, deviceType?: string): string {
  let cleaned = (rawAddress || '').trim();
  if (!cleaned) return '';

  let scheme = 'bt';
  let mac = cleaned;

  if (cleaned.startsWith('bt:') || cleaned.startsWith('ble:') || cleaned.startsWith('lan:')) {
    const colonIdx = cleaned.indexOf(':');
    scheme = cleaned.substring(0, colonIdx);
    mac = cleaned.substring(colonIdx + 1);
  } else if (deviceType === 'ble') {
    scheme = 'ble';
  }

  // Format MAC: replace hyphens with colons, remove spaces, uppercase
  const formattedMac = mac.replace(/-/g, ':').replace(/\s+/g, '').toUpperCase();
  return `${scheme}:${formattedMac}`;
}

/**
 * Strips technical scheme prefix ("bt:") for clean UI display to the user
 */
export function formatDisplayMacAddress(address: string): string {
  if (!address) return '';
  if (address.startsWith('bt:') || address.startsWith('ble:') || address.startsWith('lan:')) {
    return address.substring(address.indexOf(':') + 1);
  }
  return address.replace(/-/g, ':').toUpperCase();
}

/**
 * Request runtime Bluetooth permissions on Android (API 31+ requires BLUETOOTH_CONNECT & BLUETOOTH_SCAN)
 */
export async function requestBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  try {
    const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    if (apiLevel >= 31) {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      ]);
      const connectOk = granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
      const scanOk = granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED;
      return connectOk && scanOk;
    } else {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Bluetooth Permissions Required',
          message: 'SoftAir SFA requires location permission to connect to Bluetooth thermal printers.',
          buttonPositive: 'Allow',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch (err) {
    console.warn('[DirectPrinter] requestBluetoothPermissions error:', err);
    return false;
  }
}

/**
 * Check if native direct Bluetooth thermal driver is loaded and available
 */
export function isDirectBluetoothSupported(): boolean {
  try {
    const driver = getThermalPrinter();
    return Platform.OS === 'android' && Boolean(driver && typeof driver.scan === 'function');
  } catch {
    return false;
  }
}

/**
 * Scan for paired and nearby Bluetooth printers
 */
export async function scanBluetoothPrinters(): Promise<{ paired: Device[]; found: Device[] }> {
  const driver = getThermalPrinter();
  if (!driver || !isDirectBluetoothSupported()) {
    console.warn('[DirectPrinter] Native Bluetooth thermal driver is not supported on this platform/runtime.');
    return { paired: [], found: [] };
  }

  await requestBluetoothPermissions();

  try {
    const result = await driver.scan();
    const rawPaired = result.paired || [];
    const rawFound = result.found || [];

    // Helper to sort likely thermal POS printers to the top
    const isLikelyPrinter = (name?: string) => {
      if (!name) return false;
      const lower = name.toLowerCase();
      return (
        lower.includes('amigos') || // Posiflow PSF310 Bluetooth board broadcast name
        lower.includes('8edf') ||
        lower.includes('pos') ||
        lower.includes('psf') ||
        lower.includes('print') ||
        lower.includes('mpt') ||
        lower.includes('rpp') ||
        lower.includes('rp-') ||
        lower.includes('thermal') ||
        lower.includes('everycom') ||
        lower.includes('tvs')
      );
    };

    // Ensure all returned addresses have the "bt:" scheme prefix for native TransportFactory
    const paired = (rawPaired || []).map((d: Device) => ({
      ...d,
      address: normalizeBluetoothAddress(d.address, d.deviceType),
    }));

    const found = (rawFound || []).map((d: Device) => ({
      ...d,
      address: normalizeBluetoothAddress(d.address, d.deviceType),
    }));

    paired.sort((a: Device, b: Device) => {
      const aScore = isLikelyPrinter(a.name) ? 1 : 0;
      const bScore = isLikelyPrinter(b.name) ? 1 : 0;
      return bScore - aScore;
    });

    return { paired, found };
  } catch (error: any) {
    console.error('[DirectPrinter] Failed to scan Bluetooth devices:', error);
    throw error;
  }
}

/**
 * Test connectivity with a specific printer address
 */
export async function testPrinterConnection(address: string): Promise<boolean> {
  const driver = getThermalPrinter();
  if (!address || !driver || !isDirectBluetoothSupported()) return false;
  await requestBluetoothPermissions();
  const normalized = normalizeBluetoothAddress(address);
  try {
    const res = await driver.testConnection(normalized);
    if (res && res.success) return true;

    // If bt: fails, attempt ble: fallback once
    if (normalized.startsWith('bt:')) {
      const bleAddr = normalized.replace(/^bt:/, 'ble:');
      try {
        const bleRes = await driver.testConnection(bleAddr);
        if (bleRes && bleRes.success) {
          savePrinterSettings({ printerAddress: bleAddr });
          return true;
        }
      } catch {}
    }
    return false;
  } catch (err) {
    console.warn('[DirectPrinter] testConnection failed for', normalized, err);
    return false;
  }
}

/**
 * Ensures a Bluetooth printer is ready for direct in-app ESC/POS printing.
 * If no printer address is configured yet, auto-scans paired Bluetooth POS printers
 * from Android's bonded devices list and auto-connects to eliminate setup friction.
 */
export async function ensureOrAutoConnectPrinter(): Promise<string> {
  const settings = getPrinterSettings();
  if (settings.printerAddress && settings.printerAddress.trim().length > 0) {
    return settings.printerAddress.trim();
  }

  if (Platform.OS !== 'android') {
    return '';
  }

  if (!isDirectBluetoothSupported()) {
    throw new Error('Direct In-App Bluetooth printing is supported in the installed Android APK build. Please install the APK preview build to print directly without external apps.');
  }

  // Auto-scan paired devices from Android BluetoothAdapter bonded devices list
  try {
    const scanRes = await scanBluetoothPrinters();
    const paired = scanRes?.paired || [];
    if (paired.length > 0) {
      const isLikelyPrinter = (name?: string) => {
        if (!name) return false;
        const lower = name.toLowerCase();
        return (
          lower.includes('amigos') ||
          lower.includes('8edf') ||
          lower.includes('pos') ||
          lower.includes('psf') ||
          lower.includes('print') ||
          lower.includes('mpt') ||
          lower.includes('mtp') ||
          lower.includes('rpp') ||
          lower.includes('rp-') ||
          lower.includes('thermal') ||
          lower.includes('everycom') ||
          lower.includes('tvs') ||
          lower.includes('bluetooth') ||
          lower.includes('innerprinter') ||
          lower.includes('xp') ||
          lower.includes('esc') ||
          lower.includes('zj') ||
          lower.includes('hc-') ||
          lower.includes('hc05') ||
          lower.includes('hc06') ||
          lower.includes('qs') ||
          lower.includes('pt-') ||
          lower.includes('pt2') ||
          lower.includes('hoin') ||
          lower.includes('netum') ||
          lower.includes('receipt') ||
          lower.includes('dprint') ||
          lower.includes('sunmi') ||
          lower.includes('imin') ||
          lower.includes('milestone')
        );
      };

      const isNonPrinter = (name?: string) => {
        if (!name) return false;
        const l = name.toLowerCase();
        return (
          l.includes('buds') ||
          l.includes('airpod') ||
          l.includes('headphone') ||
          l.includes('ear') ||
          l.includes('watch') ||
          l.includes('band') ||
          l.includes('speaker') ||
          l.includes('sound') ||
          l.includes('car') ||
          l.includes('handsfree')
        );
      };

      const matched =
        paired.find(p => isLikelyPrinter(p.name)) ||
        paired.find(p => !isNonPrinter(p.name)) ||
        (paired.length === 1 ? paired[0] : null);
      if (matched && matched.address) {
        const normalized = normalizeBluetoothAddress(matched.address, matched.deviceType);
        const nameLower = (matched.name || '').toLowerCase();
        const detectedPaper = nameLower.includes('58') ? '58mm' : '80mm';
        savePrinterSettings({
          printerName: matched.name || 'Bluetooth Printer',
          printerAddress: normalized,
          printerType: 'bluetooth',
          isConnected: true,
          directPrint: true,
          paperSize: detectedPaper,
        });
        return normalized;
      }
    }
  } catch (scanErr) {
    console.warn('[DirectPrinter] Auto-connect paired printer scan error:', scanErr);
  }

  throw new Error('No Bluetooth printer connected. Please turn on Bluetooth, pair your thermal printer in Android Bluetooth Settings, and select it under Settings -> Printer Setup.');
}

/**
 * Pair & Save a Bluetooth printer as default

 */
export async function setDirectBluetoothPrinter(device: { name?: string; address?: string; deviceType?: string }): Promise<boolean> {
  try {
    const normalizedAddr = normalizeBluetoothAddress(device.address || '', device.deviceType);
    const is58 = device.name && device.name.toLowerCase().includes('58');
    savePrinterSettings({
      printerName: device.name || 'Bluetooth Printer',
      printerAddress: normalizedAddr,
      printerType: 'bluetooth',
      isConnected: true,
      directPrint: true,
      paperSize: is58 ? '58mm' : '80mm',
    });
    return true;
  } catch (e) {
    console.error('[DirectPrinter] Could not save printer settings:', e);
    return false;
  }
}

/**
 * Sanitizes any text string for 100% clean Western ASCII thermal printing.
 * Strips UTF-8 multi-byte characters that cause Chinese glyphs (e.g. 鈦, 痼) on Posiflow printers.
 */
export function sanitizeAscii(str: string | undefined | null): string {
  if (!str) return '';
  return String(str)
    // Replace bullet points (which trigger Chinese character modes on ESC/POS printers)
    .replace(/[\u2022\u25CF\u00B7]/g, ' ')
    // Replace narrow non-breaking space (U+202F) and standard non-breaking space (U+00A0)
    .replace(/[\u202F\u00A0]/g, ' ')
    // Replace Indian Rupee symbol
    .replace(/\u20B9/g, 'Rs.')
    // Replace typographic smart quotes and dashes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    // Keep only printable ASCII (32-126) and newline
    .replace(/[^\x20-\x7E\n]/g, '')
    .trimEnd();
}

/**
 * Strips warehouse name or warehouse tags so it never appears on printed receipts/invoices.
 */
export function cleanProductName(name: string): string {
  if (!name) return '';
  return name
    .replace(/\s*[\(\[][^\)\]]*(?:warehouse|wh|godown|depot)[^\)\]]*[\)\]]/gi, '')
    .trim();
}

/**
 * Formats item description according to the required specification:
 * # | Item (Bag - 10/Pkt) | QTY | UNIT | Rate | Amount
 */
export function formatItemTitle(item: any): string {
  const hsn = sanitizeAscii(item.hsn_code || '').trim();
  const rawName = cleanProductName(item.product_name || '');

  // Strip leading HSN if already present in product name
  let cleanName = rawName;
  if (hsn && hsn !== '—' && hsn !== '-') {
    cleanName = cleanName.replace(new RegExp(`^${hsn}\\s*[-–—:]?\\s*`, 'i'), '').trim();
  }
  // Strip any leading numeric HSN-like pattern (e.g. 1234 - or 12345678 -)
  cleanName = cleanName.replace(/^\d{4,8}\s*[-–—:]\s*/, '').trim();

  const pkg = sanitizeAscii(item.package_type || '').trim();
  const itemsPerPkg = Math.max(1, Number(item.items_per_package) || 1);

  let pkgTag = '';
  if (pkg && pkg.toLowerCase().includes('bag')) {
    pkgTag = itemsPerPkg > 1 ? ` (Bag - ${itemsPerPkg}/Pkt)` : ' (Bag)';
  } else if (pkg && pkg.toLowerCase().includes('box')) {
    pkgTag = itemsPerPkg > 1 ? ` (Box - ${itemsPerPkg}/Pkt)` : ' (Box)';
  } else if (pkg && pkg.toLowerCase() !== 'loose' && pkg.toLowerCase() !== 'pcs' && pkg.toLowerCase() !== 'units') {
    pkgTag = itemsPerPkg > 1 ? ` (${pkg} - ${itemsPerPkg}/Pkt)` : ` (${pkg})`;
  }

  return `${cleanName}${pkgTag}`.trim();
}

/**
 * Clean receipt date formatter returning pure ASCII without narrow non-breaking spaces
 */
export function formatReceiptDate(rawDate?: string): string {
  if (!rawDate) {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mon = months[d.getMonth()];
    const yr = d.getFullYear();
    let hours = d.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}-${mon}-${yr} ${String(hours).padStart(2, '0')}:${mins} ${ampm}`;
  }
  return sanitizeAscii(rawDate).replace(/\s+/g, ' ');
}

/**
 * Formats a 2-column key-value row (Left aligned label, Right aligned value)
 * across exactly `width` characters (48 for 80mm, 32 for 58mm).
 */
export function formatRow2(left: string, right: string, width: number = 48): string {
  const l = sanitizeAscii(left);
  const r = sanitizeAscii(right);
  const spacesNeeded = width - l.length - r.length;
  if (spacesNeeded >= 1) {
    return l + ' '.repeat(spacesNeeded) + r;
  }
  // If line exceeds total width, truncate left while keeping right intact
  const maxLeft = Math.max(1, width - r.length - 1);
  return l.slice(0, maxLeft) + ' ' + r;
}

/**
 * Wraps text cleanly up to maxLen characters (breaking words if necessary).
 */
export function wrapTextByLength(text: string, maxLen: number = 13): string[] {
  const clean = sanitizeAscii(text).trim();
  if (clean.length <= maxLen) return [clean];

  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      if (word.length <= maxLen) {
        current = word;
      } else {
        let rem = word;
        while (rem.length > maxLen) {
          lines.push(rem.slice(0, maxLen));
          rem = rem.slice(maxLen);
        }
        current = rem;
      }
    } else {
      if ((current + ' ' + word).length <= maxLen) {
        current += ' ' + word;
      } else {
        lines.push(current);
        if (word.length <= maxLen) {
          current = word;
        } else {
          let rem = word;
          while (rem.length > maxLen) {
            lines.push(rem.slice(0, maxLen));
            rem = rem.slice(maxLen);
          }
          current = rem;
        }
      }
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [clean.slice(0, maxLen)];
}

/**
 * Formats invoice item row with strict character width boundaries:
 * 80mm: # (3) + Item (13) + gap (1) + Qty (4) + gap (1) + Unit (4) + gap (2) + Rate (8) + gap (2) + Amount (10) = 48 chars
 * If item name exceeds 13 chars, wrapped onto next line aligned under Item column (indent 3 chars).
 * 58mm: Item Description + Qty/Unit @ Rate + Amount across 32 chars
 */
export function formatInvoiceItemRow(
  index: number,
  itemName: string,
  qty: number,
  unit: string,
  rate: number,
  amount: number,
  width: number = 44,
  hasGst: boolean = false,
  gstRate: number = 0,
  taxable: number = 0
): string[] {
  const is80 = width >= 40;
  const cleanUnit = sanitizeAscii(unit || 'Pcs');

  if (hasGst) {
    if (is80) {
      // 80mm Tax Invoice:
      // # (2) + Item (7) + gap (1) + QTY (3) + gap (1) + UNT (3) + gap (1) + GST (3) + gap (1) + Taxable (7) + gap (1) + RATE (6) + gap (1) + TOTAL (7) = 44 chars
      const wrappedNameLines = wrapTextByLength(itemName, 7);
      const idxStr = `${index}`.padEnd(2, ' ').slice(0, 2);
      const firstChunk = (wrappedNameLines[0] || '').padEnd(7, ' ').slice(0, 7);
      const qtyStr = `${qty}`.padStart(3, ' ').slice(0, 3);
      const unitStr = cleanUnit.slice(0, 3).padEnd(3, ' ');
      const gstStr = `${gstRate}%`.padStart(3, ' ').slice(0, 3);
      const taxStr = taxable.toFixed(2).padStart(7, ' ').slice(0, 7);
      const rateStr = rate.toFixed(2).padStart(6, ' ').slice(0, 6);
      const amtStr = amount.toFixed(2).padStart(7, ' ').slice(0, 7);

      const line1 = `${idxStr}${firstChunk} ${qtyStr} ${unitStr} ${gstStr} ${taxStr} ${rateStr} ${amtStr}`;
      const lines = [line1];

      for (let i = 1; i < wrappedNameLines.length; i++) {
        lines.push('  ' + wrappedNameLines[i]);
      }
      return lines;
    } else {
      // 58mm Tax Invoice
      const prefix = `${index}. `;
      const wrappedNameLines = wrapTextByLength(itemName, 16);
      const lines: string[] = [prefix + (wrappedNameLines[0] || '')];
      for (let i = 1; i < wrappedNameLines.length; i++) {
        lines.push('   ' + wrappedNameLines[i]);
      }

      const qtyUnitGst = `   ${qty} ${cleanUnit} GST:${gstRate}%`;
      const taxRateAmt = `Tax:${taxable.toFixed(1)} @${rate.toFixed(1)} Rs.${amount.toFixed(1)}`;
      const spaces = Math.max(1, 32 - qtyUnitGst.length - taxRateAmt.length);
      if (qtyUnitGst.length + taxRateAmt.length + 1 <= 32) {
        lines.push(qtyUnitGst + ' '.repeat(spaces) + taxRateAmt);
      } else {
        lines.push(qtyUnitGst);
        lines.push(`   Tax:${taxable.toFixed(1)} Rate:${rate.toFixed(1)} Tot:${amount.toFixed(1)}`);
      }
      return lines;
    }
  } else {
    // Non-Tax Invoice (Estimate: remove only MRP)
    if (is80) {
      // 80mm: # (2) + Item (17) + gap (1) + QTY (3) + gap (1) + UNT (3) + gap (1) + RATE (7) + gap (1) + TOTAL (8) = 44 chars
      const wrappedNameLines = wrapTextByLength(itemName, 17);
      const idxStr = `${index}`.padEnd(2, ' ').slice(0, 2);
      const firstChunk = (wrappedNameLines[0] || '').padEnd(17, ' ').slice(0, 17);
      const qtyStr = `${qty}`.padStart(3, ' ');
      const unitStr = cleanUnit.slice(0, 3).padEnd(3, ' ');
      const rateStr = rate.toFixed(2).padStart(7, ' ');
      const amtStr = amount.toFixed(2).padStart(8, ' ');

      const line1 = `${idxStr}${firstChunk} ${qtyStr} ${unitStr} ${rateStr} ${amtStr}`;
      const lines = [line1];

      for (let i = 1; i < wrappedNameLines.length; i++) {
        lines.push('  ' + wrappedNameLines[i]);
      }
      return lines;
    } else {
      // 58mm Estimate
      const prefix = `${index}. `;
      const wrappedNameLines = wrapTextByLength(itemName, 16);
      const lines: string[] = [prefix + (wrappedNameLines[0] || '')];
      for (let i = 1; i < wrappedNameLines.length; i++) {
        lines.push('   ' + wrappedNameLines[i]);
      }

      const qtyUnit = `   ${qty} ${cleanUnit}`;
      const rateAmt = `@${rate.toFixed(1)} Rs.${amount.toFixed(1)}`;
      const spaces = Math.max(1, 32 - qtyUnit.length - rateAmt.length);
      lines.push(qtyUnit + ' '.repeat(spaces) + rateAmt);
      return lines;
    }
  }
}

/**
 * Build ESC/POS document nodes for thermal receipt.
 * Matches on-screen InvoicePreviewContent 1-to-1: titles, customer info, columns, totals, status box, and footers.
 */
export function buildInvoiceEscPosNodes(data: MobileInvoiceData, paperSize: '58mm' | '80mm' = '80mm'): Node[] {
  const is80 = paperSize === '80mm';
  const totalChars = is80 ? 44 : 32;
  const company = data.company || getCompanyProfile();
  const settings = getPrinterSettings();

  const isOrder = data.order_type === 'order' || (data.invoice_number && data.invoice_number.includes('-ORD-'));
  const isReturn = data.order_type === 'return' || (data.invoice_number && data.invoice_number.includes('-RET-'));
  const isPayment = data.order_type === 'payment';

  const custGst = (data.customer_gst || '').trim();
  const hasGst = Boolean(
    data.has_gst ||
    (custGst.length >= 3 && !['URP', 'NON-GST', 'NIL', 'NONE', 'UNDEFINED', 'NULL'].includes(custGst.toUpperCase()))
  );

  const defaultTitle = isOrder
    ? 'ADVANCE BOOKING ORDER RECEIPT'
    : isReturn
    ? 'PRODUCT RETURN RECEIPT'
    : isPayment
    ? 'PAYMENT RECEIPT'
    : hasGst
    ? 'INVOICE'
    : 'ESTIMATE';

  const invoiceTitle = data.is_draft
    ? (isOrder ? 'PROVISIONAL BOOKING ORDER' : (hasGst ? 'PROVISIONAL INVOICE' : 'PROVISIONAL ESTIMATE'))
    : defaultTitle;

  const nodes: Node[] = [];

  // Hardware Reset & Clear Buffer:
  // 1. ESC @ (0x1B, 0x40): Initialize printer & flush line buffer
  // 2. LF (0x0A): Clear any stuck partial line from prior prints
  // 3. FS . (0x1C, 0x2E): Force cancel Chinese mode
  // 4. ESC t 0 (0x1B, 0x74, 0x00): Lock Code Page 0 (CP437 USA Standard Western ASCII)
  nodes.push(
    raw([
      0x1B, 0x40,
      0x0A,
      0x1C, 0x2E,
      0x1B, 0x74, 0x00,
    ])
  );

  // 0. Company Logo (Printed centered if enabled in printer settings)
  const shouldPrintLogo = settings.printLogo !== false;
  const logoUrl = getCompanyLogo(company);
  if (shouldPrintLogo && logoUrl && logoUrl.trim().length > 0) {
    const cleanLogo = logoUrl.trim();
    const logoWidth = is80 ? 256 : 192;
    if (cleanLogo.startsWith('data:image') || (!cleanLogo.startsWith('http') && !cleanLogo.startsWith('file:') && !cleanLogo.startsWith('/'))) {
      nodes.push(image({ base64: cleanLogo, width: logoWidth, align: 'center' } as any));
    } else if (cleanLogo.startsWith('http://') || cleanLogo.startsWith('https://')) {
      nodes.push(image({ url: cleanLogo, width: logoWidth, align: 'center' } as any));
    } else {
      nodes.push(image({ uri: cleanLogo, width: logoWidth, align: 'center' } as any));
    }
    nodes.push(feed(1));
  }

  // 1. Header: Company Name & Contact Info (Centered)
  const compName = sanitizeAscii(company.company_name || 'SOFTAIR SOLUTIONS PVTLTD');
  nodes.push(text(compName, { align: 'center', bold: true }));

  if (company.tagline) {
    nodes.push(text(sanitizeAscii(company.tagline), { align: 'center' }));
  }

  const addrParts = [
    company.address_line1 || company.address,
    company.city,
    company.state,
    company.pincode,
  ]
    .filter(Boolean)
    .map(sanitizeAscii);

  if (addrParts.length > 0) {
    nodes.push(text(addrParts.join(', '), { align: 'center' }));
  } else {
    nodes.push(text('Kerala', { align: 'center' }));
  }

  const gstinPart = (company.gstin || company.tax_id) ? `GSTIN: ${sanitizeAscii(company.gstin || company.tax_id)}` : '';
  const phonePart = company.phone ? `Phone: ${sanitizeAscii(company.phone)}` : '';
  if (gstinPart) {
    nodes.push(text(gstinPart, { align: 'center' }));
  }
  if (phonePart) {
    nodes.push(text(phonePart, { align: 'center' }));
  }

  // Mobile Receipt Sub-Header / Note from Web Settings Hub
  const invoiceSettings = company.invoice_settings || {};
  const mobileHeaderNote = sanitizeAscii(invoiceSettings.mobile_receipt_header || '');
  if (mobileHeaderNote) {
    nodes.push(text(mobileHeaderNote, { align: 'center' }));
  }

  // Document Title Badge
  nodes.push(text(`[ ${invoiceTitle} ]`, { align: 'center', bold: true }));
  nodes.push(text('='.repeat(totalChars)));

  // 2. Meta Section Arranged as Requested with Gaps
  const invLabel = isOrder ? 'Order:' : 'Invoice:';
  nodes.push(text(`${invLabel} ${sanitizeAscii(data.invoice_number)}`, { bold: true }));
  nodes.push(text('')); // Gap

  const invDate = formatReceiptDate(data.invoice_date);
  nodes.push(text(`Date & Time: ${invDate}`));
  nodes.push(text('')); // Gap

  nodes.push(text(`Customer Name: ${sanitizeAscii(data.customer_name)}`, { bold: true }));
  // Customer ID is removed!
  nodes.push(text('')); // Gap

  const custAddr = sanitizeAscii(data.customer_address || data.customer_place || '');
  if (custAddr) {
    nodes.push(text(`Address: ${custAddr}`));
  }
  if (data.customer_phone) {
    nodes.push(text(`Phone: ${sanitizeAscii(data.customer_phone)}`));
  }
  if (data.customer_gst && data.customer_gst.trim()) {
    nodes.push(text(`GSTIN: ${sanitizeAscii(data.customer_gst)}`));
  }
  nodes.push(text('')); // Gap

  nodes.push(text(`Salesman: ${sanitizeAscii(data.salesman_name || 'Sales Representative')}`));

  nodes.push(text('-'.repeat(totalChars)));

  // 3. Line Items Table Header
  if (hasGst) {
    if (is80) {
      // 80mm: # (2) + Item (7) + gap (1) + QTY (3) + gap (1) + UNT (3) + gap (1) + GST (3) + gap (1) + Taxable (7) + gap (1) + RATE (6) + gap (1) + TOTAL (7) = 44 chars
      const hIdx = '# ';
      const hItem = 'Item'.padEnd(7, ' ');
      const hQty = 'QTY';
      const hUnit = 'UNT';
      const hGst = 'GST';
      const hTax = 'Taxable';
      const hRate = '  Rate';
      const hAmt = '  Total';
      nodes.push(text(`${hIdx}${hItem} ${hQty} ${hUnit} ${hGst} ${hTax} ${hRate} ${hAmt}`));
    } else {
      nodes.push(text('#  Item      QTY UNT GST Tax Tot'));
    }
  } else {
    if (is80) {
      // 80mm: # (2) + Item (17) + gap (1) + QTY (3) + gap (1) + UNT (3) + gap (1) + RATE (7) + gap (1) + TOTAL (8) = 44 chars
      const hIdx = '# ';
      const hItem = 'Item'.padEnd(17, ' ');
      const hQty = 'QTY';
      const hUnit = 'UNT';
      const hRate = '   RATE';
      const hAmt = '   TOTAL';
      nodes.push(text(`${hIdx}${hItem} ${hQty} ${hUnit} ${hRate} ${hAmt}`));
    } else {
      nodes.push(text('#  Item       QTY UNT Rate Total'));
    }
  }
  nodes.push(text('-'.repeat(totalChars)));

  // Items Rows with Requested Format
  (data.items || []).forEach((item, idx) => {
    const qty = Number(item.qty) || 1;
    const rate = Number(item.unit_price) || 0;
    const amount = Number(item.total) || (qty * rate);
    const rawUnit = item.unit || item.package_type || 'Pcs';
    const unit = rawUnit.toLowerCase() === 'loose' ? 'Bag' : rawUnit;
    const itemTitle = formatItemTitle(item);
    const gstRate = item.gst_rate != null ? Number(item.gst_rate) : (hasGst ? 18 : 0);

    let taxable = amount;
    if (hasGst && gstRate > 0) {
      if (item.taxable_amount != null && Number(item.taxable_amount) < amount && Number(item.taxable_amount) > 0) {
        taxable = Number(item.taxable_amount);
      } else {
        taxable = Math.round((amount / (1 + gstRate / 100)) * 100) / 100;
      }
    }

    const rows = formatInvoiceItemRow(idx + 1, itemTitle, qty, unit, rate, amount, totalChars, hasGst, gstRate, taxable);
    rows.forEach(r => nodes.push(text(r)));
  });

  nodes.push(text('-'.repeat(totalChars)));

  // 4. Totals Block with Clean Formatting & Separate CGST / SGST Percentages
  const subtotalGross = data.subtotal_gross != null 
    ? Number(data.subtotal_gross) 
    : (data.items || []).reduce((sum, it) => {
        const qty = Number(it.qty) || 1;
        const rate = Number(it.unit_price) || 0;
        const lineTotal = Number(it.total);
        return sum + (!isNaN(lineTotal) && lineTotal > 0 ? lineTotal : (qty * rate));
      }, 0);
  const totalDiscount = data.discount_amount != null ? Number(data.discount_amount) : 0;
  const netGross = Math.max(0, subtotalGross - totalDiscount);
  const discountFactor = subtotalGross > 0 ? (netGross / subtotalGross) : 1;

  const ratesMap = new Map<number, { taxable: number; cgst: number; sgst: number }>();
  let computedTaxable = 0;
  let computedCgst = 0;
  let computedSgst = 0;

  if (hasGst) {
    (data.items || []).forEach(it => {
      const qty = Number(it.qty) || 1;
      const rate = Number(it.unit_price) || 0;
      const rawTotal = Number(it.total);
      const lineTotal = (!isNaN(rawTotal) && rawTotal > 0) ? rawTotal : (qty * rate);
      const discountedItemTotal = lineTotal * discountFactor;
      const gRate = Number(it.gst_rate) || 0;
      if (gRate > 0) {
        const itemTaxable = Math.round((discountedItemTotal / (1 + gRate / 100)) * 100) / 100;
        const itemGst = Math.round((discountedItemTotal - itemTaxable) * 100) / 100;
        const cgst = Math.round((itemGst / 2) * 100) / 100;
        const sgst = Math.round((itemGst - cgst) * 100) / 100;
        computedTaxable += itemTaxable;
        computedCgst += cgst;
        computedSgst += sgst;
        if (!ratesMap.has(gRate)) {
          ratesMap.set(gRate, { taxable: itemTaxable, cgst, sgst });
        } else {
          const prev = ratesMap.get(gRate)!;
          prev.taxable += itemTaxable;
          prev.cgst += cgst;
          prev.sgst += sgst;
        }
      } else {
        computedTaxable += discountedItemTotal;
      }
    });
    computedTaxable = Math.round(computedTaxable * 100) / 100;
    computedCgst = Math.round(computedCgst * 100) / 100;
    computedSgst = Math.round(computedSgst * 100) / 100;
  } else {
    computedTaxable = netGross;
  }

  const totalTaxable = data.total_taxable != null
    ? (data.total_taxable < subtotalGross ? data.total_taxable : computedTaxable)
    : computedTaxable;
  const totalCgst = data.total_cgst != null ? data.total_cgst : computedCgst;
  const totalSgst = data.total_sgst != null ? data.total_sgst : computedSgst;
  const totalGst = totalCgst + totalSgst;

  if (totalDiscount > 0) {
    nodes.push(text(formatRow2('Total Discount:', `-Rs. ${totalDiscount.toFixed(2)}`, totalChars)));
  }

  if (hasGst) {
    nodes.push(text(formatRow2('Total Taxable Value:', `Rs. ${totalTaxable.toFixed(2)}`, totalChars)));

    if (ratesMap.size > 0) {
      ratesMap.forEach((val, gRate) => {
        const half = (gRate / 2).toFixed(1).replace(/\.0$/, '');
        nodes.push(text(formatRow2(`CGST (${half}%):`, `+Rs. ${val.cgst.toFixed(2)}`, totalChars)));
        nodes.push(text(formatRow2(`SGST (${half}%):`, `+Rs. ${val.sgst.toFixed(2)}`, totalChars)));
      });
    } else {
      nodes.push(text(formatRow2('CGST:', `+Rs. ${totalCgst.toFixed(2)}`, totalChars)));
      nodes.push(text(formatRow2('SGST:', `+Rs. ${totalSgst.toFixed(2)}`, totalChars)));
    }
  }

  const totalOrderUnits = (data.items || []).reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const itemCount = (data.items || []).length;
  const itemsSummary = `Items: ${itemCount} (${totalOrderUnits} Units)`;
  nodes.push(text(formatRow2(itemsSummary, `Sub Total: Rs. ${subtotalGross.toFixed(2)}`, totalChars)));

  if (data.round_off && data.round_off !== 0) {
    const roSign = data.round_off > 0 ? '+' : '';
    nodes.push(text(formatRow2('Round Off:', `${roSign}Rs. ${data.round_off.toFixed(2)}`, totalChars)));
  }

  nodes.push(text('='.repeat(totalChars)));
  nodes.push(text(formatRow2('Invoice Grand Total:', `Rs. ${data.grand_total.toFixed(2)}`, totalChars), { bold: true }));
  nodes.push(text('='.repeat(totalChars)));

  if (hasGst) {
    nodes.push(text('-'.repeat(totalChars)));
    if (is80) {
      nodes.push(text('GST%        TaxableAmt    CGSTAmt    SGSTAmt'));
      if (ratesMap.size > 0) {
        ratesMap.forEach((val, gRate) => {
          const rStr = `GST ${gRate}%`.padEnd(8, ' ');
          const tStr = `Rs.${val.taxable.toFixed(2)}`.padStart(14, ' ');
          const cStr = `Rs.${val.cgst.toFixed(2)}`.padStart(11, ' ');
          const sStr = `Rs.${val.sgst.toFixed(2)}`.padStart(11, ' ');
          nodes.push(text(rStr + tStr + cStr + sStr));
        });
      } else {
        const avgRate = subtotalGross > 0 ? ((totalGst / (totalTaxable || 1)) * 100).toFixed(0) : '0';
        const rStr = `GST ${avgRate}%`.padEnd(8, ' ');
        const tStr = `Rs.${totalTaxable.toFixed(2)}`.padStart(14, ' ');
        const cStr = `Rs.${totalCgst.toFixed(2)}`.padStart(11, ' ');
        const sStr = `Rs.${totalSgst.toFixed(2)}`.padStart(11, ' ');
        nodes.push(text(rStr + tStr + cStr + sStr));
      }
    } else {
      nodes.push(text(formatRow2('Taxable Amt:', `Rs. ${totalTaxable.toFixed(2)}`, totalChars)));
      nodes.push(text(formatRow2('CGST:', `Rs. ${totalCgst.toFixed(2)}`, totalChars)));
      nodes.push(text(formatRow2('SGST:', `Rs. ${totalSgst.toFixed(2)}`, totalChars)));
    }
    nodes.push(text('-'.repeat(totalChars)));
  }
  nodes.push(text('='.repeat(totalChars)));

  const payMode = sanitizeAscii(data.payment_mode || 'Cash');
  const paidAmt = Number(data.paid_amount) || 0;
  nodes.push(text(formatRow2(`Paid (${payMode}):`, `Rs. ${paidAmt.toFixed(2)}`, totalChars)));

  if (data.balance_due && data.balance_due > 0) {
    nodes.push(text(formatRow2('Balance Outstanding:', `Rs. ${Number(data.balance_due).toFixed(2)}`, totalChars)));
  }

  const isPaid = paidAmt >= (data.grand_total || 0) - 0.05;
  const isPartial = paidAmt > 0 && !isPaid;
  const paymentStatusText = isPaid ? 'PAID IN FULL' : isPartial ? 'PARTIALLY PAID' : (isOrder ? 'ORDER CONFIRMED' : 'PAYMENT DUE / UNPAID');

  nodes.push(text(`[ ${paymentStatusText} ]`, { align: 'center' }));

  // 5. UPI Pay Block
  const upiId = company.upi_id?.trim();
  if (settings.printUpiQr && upiId && data.balance_due && data.balance_due > 0) {
    const cleanUpi = sanitizeAscii(upiId);
    const upiUri = `upi://pay?pa=${encodeURIComponent(cleanUpi)}&pn=${encodeURIComponent(compName)}&am=${data.balance_due.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Bill ${data.invoice_number}`)}`;
    nodes.push(text('-'.repeat(totalChars)));
    nodes.push(feed(1));
    nodes.push(text(`UPI PAY: ${cleanUpi}`, { align: 'center' }));
    nodes.push(qr(upiUri, { size: is80 ? 6 : 5, errorLevel: 'M' }));
    nodes.push(text(`Scan to pay Rs. ${data.balance_due.toFixed(2)}`, { align: 'center' }));
  }

  // 6. Notes & Terms
  nodes.push(text('-'.repeat(totalChars)));
  if (data.notes) {
    nodes.push(text(`Note: ${sanitizeAscii(data.notes)}`));
  } else {
    nodes.push(text(`Note: ${isOrder ? `Advance Booking Order (${data.items?.length || 1} items)` : 'Direct Van Sale'}`));
  }

  const terms = sanitizeAscii(company.terms_and_conditions || '').trim();
  if (settings.printTerms && terms) {
    nodes.push(text('Terms & Conditions:'));
    nodes.push(text(terms));
    nodes.push(feed(1));
  }

  // 7. Footer (Editable from Web Setting Hub)
  const footerMsg = sanitizeAscii(invoiceSettings.mobile_receipt_footer || 'Thank you for your business!');
  const taglineMsg = sanitizeAscii(invoiceSettings.mobile_receipt_tagline || 'Powered by SoftAir SFA');

  nodes.push(text(footerMsg, { align: 'center' }));
  nodes.push(text(taglineMsg, { align: 'center', font: 'B' }));
  nodes.push(text('- - - - - - - - - [ CUT HERE ] - - - - - - - - -', { align: 'center', font: 'B' }));

  // Feed & Cut
  nodes.push(feed(settings.feedLines || 4));
  nodes.push(cut({ partial: false }));

  return nodes;
}

/**
 * Direct print invoice over Bluetooth without any third-party app
 */
export async function printInvoiceDirectBluetooth(data: MobileInvoiceData): Promise<boolean> {
  let settings = getPrinterSettings();
  let rawAddress = (settings.printerAddress || '').trim();

  if (!rawAddress) {
    rawAddress = await ensureOrAutoConnectPrinter();
    settings = getPrinterSettings();
  }

  const driver = getThermalPrinter();
  if (!driver || !isDirectBluetoothSupported()) {
    throw new Error('Direct In-App Bluetooth printing is supported in the installed Android APK build. Please install the APK preview build to print directly without external apps.');
  }

  await requestBluetoothPermissions();
  resetActivePrintAbort();

  const address = normalizeBluetoothAddress(rawAddress);
  const paperWidthMm = settings.paperSize === '58mm' ? 58 : 80;
  const nodes = buildInvoiceEscPosNodes(data, settings.paperSize === '58mm' ? '58mm' : '80mm');

  if (isPrintAborted()) {
    throw new Error('Print cancelled by user.');
  }

  try {
    const result = await driver.print(address, nodes, {
      paperWidthMm,
      codePage: 'cp437',
      timeout: 15000,
    });

    if (isPrintAborted()) {
      throw new Error('Print cancelled by user.');
    }

    if (result && result.success) {
      return true;
    }

    // In case Bluetooth Classic failed, try BLE scheme fallback once
    if (address.startsWith('bt:') && !isPrintAborted()) {
      const bleAddr = address.replace(/^bt:/, 'ble:');
      try {
        const bleResult = await driver.print(bleAddr, nodes, {
          paperWidthMm,
          codePage: 'cp437',
          timeout: 15000,
        });
        if (bleResult && bleResult.success) {
          savePrinterSettings({ printerAddress: bleAddr });
          return true;
        }
      } catch {}
    }

    if (result && result.error) {
      throw new Error(`Printer returned: ${result.error.message || result.error.code}`);
    }

    return true;
  } catch (err: any) {
    if (isPrintAborted()) {
      throw new Error('Print cancelled by user.');
    }
    // Safety retry without image if image print had an issue
    if (nodes.some(n => n.type === 'image')) {
      console.warn('[DirectPrinter] Image print had issue, retrying receipt text cleanly...');
      const textOnlyNodes = nodes.filter(n => n.type !== 'image');
      try {
        const fallbackResult = await driver.print(address, textOnlyNodes, {
          paperWidthMm,
          codePage: 'cp437',
          timeout: 12000,
        });
        if (fallbackResult && fallbackResult.success) {
          return true;
        }
      } catch (fallbackErr) {
        console.error('[DirectPrinter] Fallback print also failed:', fallbackErr);
      }
    }
    console.error('[DirectPrinter] printInvoiceDirectBluetooth error:', err);
    throw new Error(`Failed to print directly to ${settings.printerName || 'Bluetooth Printer'}: ${err.message || err}`);
  }
}

/**
 * Build ESC/POS document nodes for Expense Voucher
 */
export function buildExpenseEscPosNodes(
  expense: ExpenseRecord,
  paperSize: '58mm' | '80mm' = '80mm'
): Node[] {
  const is80 = paperSize === '80mm';
  const totalChars = is80 ? 48 : 32;
  const company = getCompanyProfile();
  const settings = getPrinterSettings();

  const nodes: Node[] = [];

  // Hardware Reset & Clear Buffer
  nodes.push(raw([0x1B, 0x40, 0x0A, 0x1C, 0x2E, 0x1B, 0x74, 0x00]));

  // Logo (Printed centered if enabled)
  const shouldPrintLogo = settings.printLogo !== false;
  const logoUrl = getCompanyLogo(company);
  if (shouldPrintLogo && logoUrl && logoUrl.trim().length > 0) {
    const cleanLogo = logoUrl.trim();
    const logoWidth = is80 ? 256 : 192;
    if (cleanLogo.startsWith('data:image') || (!cleanLogo.startsWith('http') && !cleanLogo.startsWith('file:') && !cleanLogo.startsWith('/'))) {
      nodes.push(image({ base64: cleanLogo, width: logoWidth, align: 'center' } as any));
    } else if (cleanLogo.startsWith('http://') || cleanLogo.startsWith('https://')) {
      nodes.push(image({ url: cleanLogo, width: logoWidth, align: 'center' } as any));
    } else {
      nodes.push(image({ uri: cleanLogo, width: logoWidth, align: 'center' } as any));
    }
    nodes.push(feed(1));
  }

  // Company Name & Header
  const compName = sanitizeAscii(company.company_name || 'SOFTAIR SOLUTIONS PVTLTD');
  nodes.push(text(compName, { align: 'center', bold: true }));
  const cityState = [company.city, company.state].filter(Boolean).map(sanitizeAscii).join(', ');
  if (cityState) {
    nodes.push(text(cityState, { align: 'center' }));
  }
  if (company.phone) {
    nodes.push(text(`Tel: ${sanitizeAscii(company.phone)}`, { align: 'center' }));
  }

  // Voucher Title Badge
  nodes.push(text('[ EXPENSE CASH VOUCHER ]', { align: 'center', bold: true }));
  nodes.push(text('='.repeat(totalChars)));

  // Voucher Meta
  const voucherCode = expense.expense_code || `EXP-${expense.id.slice(0, 8).toUpperCase()}`;
  const expenseDate = formatReceiptDate(expense.expense_date);
  nodes.push(text(formatRow2(`VOUCHER NO: ${voucherCode}`, `DATE: ${expenseDate}`, totalChars)));

  // Staff & Vehicle
  const staff = `STAFF: ${sanitizeAscii(expense.salesman_name || 'Sales Representative')}`;
  nodes.push(text(staff, { bold: true }));

  nodes.push(text('-'.repeat(totalChars)));

  // Expense Details
  nodes.push(text(formatRow2('CATEGORY:', sanitizeAscii(expense.category), totalChars), { bold: true }));
  nodes.push(text(formatRow2('PAYMENT MODE:', sanitizeAscii(expense.payment_mode || 'Cash'), totalChars)));

  if (expense.reason) {
    nodes.push(text('-'.repeat(totalChars)));
    nodes.push(text('PARTICULARS / REASON:', { bold: true }));
    nodes.push(text(sanitizeAscii(expense.reason)));
  }

  nodes.push(text('='.repeat(totalChars)));

  // Large Amount Display
  const amtFormatted = `Rs. ${Number(expense.amount || 0).toFixed(2)}`;
  nodes.push(text(formatRow2('VOUCHER TOTAL:', amtFormatted, totalChars), { bold: true, size: is80 ? 2 : 1 }));
  nodes.push(text('='.repeat(totalChars)));

  // Status & Authorization
  nodes.push(text('[ CASH DISBURSED & RECONCILED ]', { align: 'center', bold: true }));
  nodes.push(feed(1));

  // Signature Block
  if (is80) {
    nodes.push(text(formatRow2('Prepared By: ___________', 'Receiver Sign: ___________', totalChars)));
  } else {
    nodes.push(text('Prepared By: _______________'));
    nodes.push(text('Receiver Sign: _______________'));
  }

  nodes.push(feed(1));
  nodes.push(text('*** OFFICIAL ACCOUNTS VOUCHER ***', { align: 'center' }));
  nodes.push(feed(settings.feedLines || 4));
  nodes.push(cut({ partial: false }));

  return nodes;
}

/**
 * Direct print Expense Voucher over Bluetooth
 */
export async function printExpenseDirectBluetooth(expense: ExpenseRecord): Promise<boolean> {
  let settings = getPrinterSettings();
  let rawAddress = (settings.printerAddress || '').trim();

  if (!rawAddress) {
    rawAddress = await ensureOrAutoConnectPrinter();
    settings = getPrinterSettings();
  }

  const driver = getThermalPrinter();
  if (!driver || !isDirectBluetoothSupported()) {
    throw new Error('Direct In-App Bluetooth printing is supported in the installed Android APK build. Please install the APK preview build to print directly without external apps.');
  }

  await requestBluetoothPermissions();
  resetActivePrintAbort();

  const address = normalizeBluetoothAddress(rawAddress);
  const paperWidthMm = settings.paperSize === '58mm' ? 58 : 80;
  const nodes = buildExpenseEscPosNodes(expense, settings.paperSize === '58mm' ? '58mm' : '80mm');

  if (isPrintAborted()) {
    throw new Error('Print cancelled by user.');
  }

  try {
    const result = await driver.print(address, nodes, {
      paperWidthMm,
      codePage: 'cp437',
      timeout: 15000,
    });

    if (isPrintAborted()) {
      throw new Error('Print cancelled by user.');
    }

    if (result && result.success) return true;

    // Retry BLE if bt: scheme
    if (address.startsWith('bt:') && !isPrintAborted()) {
      const bleAddr = address.replace(/^bt:/, 'ble:');
      try {
        const bleResult = await driver.print(bleAddr, nodes, {
          paperWidthMm,
          codePage: 'cp437',
          timeout: 15000,
        });
        if (bleResult && bleResult.success) {
          savePrinterSettings({ printerAddress: bleAddr });
          return true;
        }
      } catch {}
    }

    return true;
  } catch (err: any) {
    if (isPrintAborted()) {
      throw new Error('Print cancelled by user.');
    }
    if (nodes.some(n => n.type === 'image')) {
      const textOnly = nodes.filter(n => n.type !== 'image');
      try {
        const fallback = await driver.print(address, textOnly, {
          paperWidthMm,
          codePage: 'cp437',
          timeout: 12000,
        });
        if (fallback && fallback.success) return true;
      } catch {}
    }
    throw new Error(`Failed to print expense voucher: ${err.message || err}`);
  }
}

/**
 * Build ESC/POS document nodes for Reports
 */
export function buildReportEscPosNodes(
  options: ReportPrintOptions,
  paperSize: '58mm' | '80mm' = '80mm'
): Node[] {
  const is80 = paperSize === '80mm';
  const totalChars = is80 ? 48 : 32;
  const company = getCompanyProfile();
  const settings = getPrinterSettings();

  const nodes: Node[] = [];

  // Reset & Clear
  nodes.push(raw([0x1B, 0x40, 0x0A, 0x1C, 0x2E, 0x1B, 0x74, 0x00]));

  // Logo
  const shouldPrintLogo = settings.printLogo !== false;
  const logoUrl = getCompanyLogo(company);
  if (shouldPrintLogo && logoUrl && logoUrl.trim().length > 0) {
    const cleanLogo = logoUrl.trim();
    const logoWidth = is80 ? 256 : 192;
    if (cleanLogo.startsWith('data:image') || (!cleanLogo.startsWith('http') && !cleanLogo.startsWith('file:') && !cleanLogo.startsWith('/'))) {
      nodes.push(image({ base64: cleanLogo, width: logoWidth, align: 'center' } as any));
    } else if (cleanLogo.startsWith('http://') || cleanLogo.startsWith('https://')) {
      nodes.push(image({ url: cleanLogo, width: logoWidth, align: 'center' } as any));
    } else {
      nodes.push(image({ uri: cleanLogo, width: logoWidth, align: 'center' } as any));
    }
    nodes.push(feed(1));
  }

  // Company Name
  const compName = sanitizeAscii(company.company_name || 'SOFTAIR SOLUTIONS PVTLTD');
  nodes.push(text(compName, { align: 'center', bold: true }));

  // Report Title Badge
  nodes.push(text(`[ ${sanitizeAscii(options.title.toUpperCase())} ]`, { align: 'center', bold: true }));
  if (options.subtitle) {
    nodes.push(text(sanitizeAscii(options.subtitle), { align: 'center' }));
  }
  nodes.push(text('='.repeat(totalChars)));

  // Meta
  const nowStr = formatReceiptDate();
  nodes.push(text(formatRow2('DATE & TIME:', nowStr, totalChars)));
  if (options.salesmanName) {
    nodes.push(text(`SALES REP: ${sanitizeAscii(options.salesmanName)}`));
  }
  if (options.vehicleRegNo || options.routeName) {
    const vehPart = options.vehicleRegNo ? `VAN: ${sanitizeAscii(options.vehicleRegNo)}` : '';
    const routePart = options.routeName ? `ROUTE: ${sanitizeAscii(options.routeName)}` : '';
    nodes.push(text(formatRow2(vehPart, routePart, totalChars)));
  }

  // Summary Cards / KPI Block
  if (options.summaryCards && options.summaryCards.length > 0) {
    nodes.push(text('-'.repeat(totalChars)));
    nodes.push(text('SUMMARY TOTALS', { bold: true }));
    for (const card of options.summaryCards) {
      nodes.push(text(formatRow2(sanitizeAscii(card.label) + ':', sanitizeAscii(card.value), totalChars)));
    }
  }

  // Table Data
  if (options.rows && options.rows.length > 0) {
    nodes.push(text('-'.repeat(totalChars)));
    for (let rIdx = 0; rIdx < options.rows.length; rIdx++) {
      const row = options.rows[rIdx];
      const primaryCol = sanitizeAscii(String(row[0] || ''));
      const secondaryCol = sanitizeAscii(String(row[1] || ''));
      const amountCol = sanitizeAscii(String(row[row.length - 1] || ''));

      if (row.length === 2) {
        nodes.push(text(formatRow2(primaryCol, secondaryCol, totalChars)));
      } else {
        nodes.push(text(formatRow2(`${rIdx + 1}. ${primaryCol}`, amountCol, totalChars)));
        if (secondaryCol && secondaryCol !== primaryCol) {
          nodes.push(text(`   ${secondaryCol}`, { font: 'B' }));
        }
      }
    }
  }

  if (options.footerNote) {
    nodes.push(text('-'.repeat(totalChars)));
    nodes.push(text(sanitizeAscii(options.footerNote), { align: 'center' }));
  }

  nodes.push(text('='.repeat(totalChars)));
  nodes.push(text('*** END OF REPORT ***', { align: 'center', bold: true }));
  nodes.push(feed(settings.feedLines || 4));
  nodes.push(cut({ partial: false }));

  return nodes;
}

/**
 * Direct print Report over Bluetooth
 */
export async function printReportDirectBluetooth(options: ReportPrintOptions, paperWidth?: '58mm' | '80mm'): Promise<boolean> {
  let settings = getPrinterSettings();
  let rawAddress = (settings.printerAddress || '').trim();

  if (!rawAddress) {
    rawAddress = await ensureOrAutoConnectPrinter();
    settings = getPrinterSettings();
  }

  const driver = getThermalPrinter();
  if (!driver || !isDirectBluetoothSupported()) {
    throw new Error('Direct In-App Bluetooth printing is supported in the installed Android APK build. Please install the APK preview build to print directly without external apps.');
  }

  await requestBluetoothPermissions();
  resetActivePrintAbort();

  const chosenWidth = paperWidth || (settings.paperSize === '58mm' ? '58mm' : '80mm');
  const address = normalizeBluetoothAddress(rawAddress);
  const paperWidthMm = chosenWidth === '58mm' ? 58 : 80;
  const nodes = buildReportEscPosNodes(options, chosenWidth);

  if (isPrintAborted()) {
    throw new Error('Print cancelled by user.');
  }

  try {
    const result = await driver.print(address, nodes, {
      paperWidthMm,
      codePage: 'cp437',
      timeout: 18000,
    });

    if (isPrintAborted()) {
      throw new Error('Print cancelled by user.');
    }

    if (result && result.success) return true;

    if (address.startsWith('bt:') && !isPrintAborted()) {
      const bleAddr = address.replace(/^bt:/, 'ble:');
      try {
        const bleResult = await driver.print(bleAddr, nodes, {
          paperWidthMm,
          codePage: 'cp437',
          timeout: 18000,
        });
        if (bleResult && bleResult.success) {
          savePrinterSettings({ printerAddress: bleAddr });
          return true;
        }
      } catch {}
    }

    return true;
  } catch (err: any) {
    if (isPrintAborted()) {
      throw new Error('Print cancelled by user.');
    }
    if (nodes.some(n => n.type === 'image')) {
      const textOnly = nodes.filter(n => n.type !== 'image');
      try {
        const fallback = await driver.print(address, textOnly, {
          paperWidthMm,
          codePage: 'cp437',
          timeout: 14000,
        });
        if (fallback && fallback.success) return true;
      } catch {}
    }
    throw new Error(`Failed to print report: ${err.message || err}`);
  }
}

/**
 * Print a hardware test / calibration slip directly via Bluetooth
 */
export async function printDiagnosticSlipDirectBluetooth(): Promise<boolean> {
  let settings = getPrinterSettings();
  let rawAddress = (settings.printerAddress || '').trim();

  if (!rawAddress) {
    rawAddress = await ensureOrAutoConnectPrinter();
    settings = getPrinterSettings();
  }

  await requestBluetoothPermissions();

  const address = normalizeBluetoothAddress(rawAddress);
  const displayMac = formatDisplayMacAddress(address);
  const is80 = settings.paperSize === '80mm';
  const paperWidthMm = is80 ? 80 : 58;
  const totalChars = is80 ? 48 : 32;
  const now = formatReceiptDate();

  const nodes: Node[] = [
    raw([0x1B, 0x40, 0x1C, 0x2E, 0x1B, 0x74, 0x00]),
    text('BLUETOOTH PRINTER DIRECT TEST', { align: 'center', bold: true, size: is80 ? 2 : 1 }),
    text('SoftAir SFA Direct Bluetooth Engine', { align: 'center' }),
    text('='.repeat(totalChars)),
    text(formatRow2('Printer:', sanitizeAscii(settings.printerName || 'Bluetooth Printer'), totalChars)),
    text(formatRow2('Bluetooth MAC:', displayMac, totalChars)),
    text(formatRow2('Paper Roll:', `${paperWidthMm}mm (${totalChars} Chars/Line)`, totalChars)),
    text(formatRow2('Driver:', 'Native ESC/POS TurboModule', totalChars)),
    text(formatRow2('Timestamp:', now, totalChars)),
    text('-'.repeat(totalChars)),
    text('100% Watermark-Free Direct Printing', { align: 'center', bold: true }),
    text('RawBT & External Apps Bypassed Successfully!', { align: 'center' }),
    text('='.repeat(totalChars)),
    feed(settings.feedLines || 3),
    cut({ partial: false }),
  ];

  const driver = getThermalPrinter();
  if (!driver) {
    throw new Error('Direct Bluetooth driver is only available on Android native builds.');
  }

  let result = await driver.print(address, nodes, { paperWidthMm, codePage: 'cp437', timeout: 10000 });
  if (result && !result.success && address.startsWith('bt:')) {
    const bleAddr = address.replace(/^bt:/, 'ble:');
    try {
      const bleResult = await driver.print(bleAddr, nodes, { paperWidthMm, codePage: 'cp437', timeout: 10000 });
      if (bleResult && bleResult.success) {
        savePrinterSettings({ printerAddress: bleAddr });
        return true;
      }
    } catch {}
  }

  if (result && !result.success && result.error) {
    throw new Error(result.error.message);
  }
  return true;
}
