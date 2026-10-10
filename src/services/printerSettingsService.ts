/**
 * printerSettingsService.ts
 * Manages Mobile Bluetooth Printer Connection, Paper Size, and Print Font Scaling.
 */

import { Platform } from 'react-native';
import * as Print from 'expo-print';
import { getSyncMeta, setSyncMeta, getCompanyProfile, setCompanyProfile } from '../database/db';
import {
  isDirectBluetoothSupported,
  scanBluetoothPrinters,
  setDirectBluetoothPrinter,
  testPrinterConnection,
  printDiagnosticSlipDirectBluetooth,
  printExpenseDirectBluetooth,
  printReportDirectBluetooth,
  abortActivePrint,
  resetActivePrintAbort,
  isPrintAborted,
  normalizeBluetoothAddress,
  formatDisplayMacAddress,
  ensureOrAutoConnectPrinter,
} from './directBluetoothPrinter';

export {
  isDirectBluetoothSupported,
  scanBluetoothPrinters,
  setDirectBluetoothPrinter,
  testPrinterConnection,
  printDiagnosticSlipDirectBluetooth,
  printExpenseDirectBluetooth,
  printReportDirectBluetooth,
  abortActivePrint,
  resetActivePrintAbort,
  isPrintAborted,
  normalizeBluetoothAddress,
  formatDisplayMacAddress,
  ensureOrAutoConnectPrinter,
};

export type PaperSize = '58mm' | '80mm' | 'A4';
export type FontSizePreset = 'compact' | 'normal' | 'large' | 'extralarge';

export interface BluetoothDevice {
  id: string;
  name: string;
  address?: string;
  type?: 'thermal_58' | 'thermal_80' | 'generic';
  paired?: boolean;
}

export interface MobilePrinterSettings {
  printerName: string;
  printerAddress: string;
  printerType: 'bluetooth' | 'network' | 'system';
  isConnected: boolean;
  directPrint: boolean; // Direct print mode: bypasses preview/options dialog
  paperSize: PaperSize;
  fontScale: number; // 0.85, 1.0, 1.15, 1.3
  fontSizePreset: FontSizePreset;
  feedLines: number;
  printDensity: 'normal' | 'high';
  printLogo: boolean;
  printGstin: boolean;
  printUpiQr: boolean;
  printTerms: boolean;
  printSignature: boolean;
  autoPrintOnSale: boolean;
}

export const DEFAULT_PRINTER_SETTINGS: MobilePrinterSettings = {
  printerName: '',
  printerAddress: '',
  printerType: 'bluetooth',
  isConnected: false,
  directPrint: true,
  paperSize: '80mm',
  fontScale: 1.0,
  fontSizePreset: 'normal',
  feedLines: 2,
  printDensity: 'normal',
  printLogo: true,
  printGstin: true,
  printUpiQr: true,
  printTerms: true,
  printSignature: true,
  autoPrintOnSale: false,
};

// Available Bluetooth printers (populated dynamically via scan)
export const PRECONFIGURED_BLUETOOTH_PRINTERS: BluetoothDevice[] = [];

/**
 * Retrieve current saved printer settings from SQLite / local meta
 */
export function getPrinterSettings(): MobilePrinterSettings {
  try {
    const raw = getSyncMeta('printer_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          ...DEFAULT_PRINTER_SETTINGS,
          ...parsed,
        };
      }
    }
  } catch (e) {
    console.warn('Failed to parse printer settings, using defaults:', e);
  }
  return DEFAULT_PRINTER_SETTINGS;
}

/**
 * Save updated printer settings and sync with company thermal profile
 */
export function savePrinterSettings(settings: Partial<MobilePrinterSettings>): MobilePrinterSettings {
  const current = getPrinterSettings();
  const merged: MobilePrinterSettings = {
    ...current,
    ...settings,
  };

  try {
    setSyncMeta('printer_settings', JSON.stringify(merged));

    // Also synchronize paperSize with companyProfile.invoice_settings.thermal_width
    const company = getCompanyProfile();
    const thermalWidth = merged.paperSize === '58mm' ? '58mm' : '80mm';
    setCompanyProfile({
      invoice_settings: {
        ...(company.invoice_settings || {}),
        thermal_width: thermalWidth,
        show_logo: merged.printLogo,
        show_gst_breakdown: merged.printGstin,
        show_upi_qr: merged.printUpiQr,
        show_terms: merged.printTerms,
        show_signature: merged.printSignature,
      },
      print_templates: {
        ...(company.print_templates || {}),
        thermalWidth: thermalWidth,
        paperSize: merged.paperSize === 'A4' ? 'A4' : thermalWidth,
      }
    });
  } catch (e) {
    console.error('Failed to save printer settings:', e);
  }

  return merged;
}

/**
 * Connect to a chosen Bluetooth printer
 */
export async function connectPrinter(device: { name?: string; address?: string; type?: 'thermal_58' | 'thermal_80' | 'generic'; deviceType?: string }): Promise<boolean> {
  const normAddr = normalizeBluetoothAddress(device.address || '', device.deviceType);
  const is58 = device.type === 'thermal_58' || (device.name && device.name.toLowerCase().includes('58'));
  savePrinterSettings({
    printerName: device.name || 'Bluetooth Printer',
    printerAddress: normAddr,
    printerType: 'bluetooth',
    isConnected: true,
    directPrint: true,
    paperSize: is58 ? '58mm' : '80mm',
  });
  return true;
}

/**
 * Disconnect current printer
 */
export async function disconnectPrinter(): Promise<void> {
  savePrinterSettings({
    printerName: '',
    printerAddress: '',
    isConnected: false,
  });
}

/**
 * Validates and retrieves the active direct AirPrint / Network printer URL
 */
export function getDirectPrinterUrl(): string | undefined {
  const settings = getPrinterSettings();
  const addr = (settings.printerAddress || '').trim();
  if (Platform.OS === 'ios' && (addr.includes('://') || addr.startsWith('ipp') || addr.startsWith('socket'))) {
    return addr;
  }
  return undefined;
}

/**
 * Trigger native AirPrint / thermal printer discovery picker to establish direct printing
 */
export async function pairDirectPrinter(): Promise<{ name: string; url: string } | null> {
  if (Platform.OS === 'ios') {
    const selected = await Print.selectPrinterAsync();
    if (selected && selected.url) {
      savePrinterSettings({
        printerName: selected.name || 'Direct Thermal Printer',
        printerAddress: selected.url,
        isConnected: true,
        directPrint: true,
      });
      return selected;
    }
  }
  return null;
}

/**
 * Generates and prints a clean diagnostic test slip
 */
export async function printDiagnosticTestSlip(): Promise<void> {
  const settings = getPrinterSettings();

  // 1. Direct Bluetooth ESC/POS hardware test on Android: NEVER redirect to external apps
  if (Platform.OS === 'android') {
    if (!isDirectBluetoothSupported()) {
      throw new Error('Direct In-App Bluetooth printing is supported in the installed Android APK build. Please install the APK preview build to print directly without external apps.');
    }
    await ensureOrAutoConnectPrinter();
    await printDiagnosticSlipDirectBluetooth();
    return;
  }

  // 2. Direct Bluetooth ESC/POS hardware test (Posiflow PSF310 & compatible thermal printers)
  if (
    settings.printerType === 'bluetooth' &&
    settings.printerAddress &&
    isDirectBluetoothSupported()
  ) {
    await printDiagnosticSlipDirectBluetooth();
    return;
  }

  const company = getCompanyProfile();
  const is58mm = settings.paperSize === '58mm';
  const scale = settings.fontScale || 1.0;
  const now = new Date().toLocaleString('en-IN');

  const testHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <style>
        @page { margin: 0; size: ${is58mm ? '58mm' : '80mm'} auto; }
        body {
          font-family: 'Courier New', Courier, monospace, system-ui;
          width: ${is58mm ? '48mm' : '72mm'};
          margin: 0 auto;
          padding: 8px 4px;
          color: #000000;
          font-size: ${(11 * scale).toFixed(1)}px;
          line-height: 1.35;
        }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        .divider {
          border-top: 1px dashed #000000;
          margin: 6px 0;
        }
        .double-divider {
          border-top: 2px solid #000000;
          margin: 6px 0;
        }
        .row {
          display: flex;
          justify-content: space-between;
          font-size: ${(10 * scale).toFixed(1)}px;
          margin: 2px 0;
        }
        .title {
          font-size: ${(14 * scale).toFixed(1)}px;
          font-weight: 900;
          letter-spacing: 0.5px;
        }
        .sub {
          font-size: ${(9.5 * scale).toFixed(1)}px;
        }
        .box {
          border: 1px solid #000000;
          padding: 4px;
          margin: 6px 0;
          text-align: center;
          font-size: ${(10 * scale).toFixed(1)}px;
        }
      </style>
    </head>
    <body>
      <div class="center title bold">${company.company_name || 'SALES FORCE SFA'}</div>
      <div class="center sub">*** PRINTER DIAGNOSTIC TEST ***</div>
      <div class="divider"></div>

      <div class="row">
        <span>STATUS:</span>
        <span class="bold">ONLINE / CONNECTED</span>
      </div>
      <div class="row">
        <span>PRINTER:</span>
        <span class="bold">${settings.printerName}</span>
      </div>
      <div class="row">
        <span>INTERFACE:</span>
        <span>${settings.printerType.toUpperCase()} (ESC/POS)</span>
      </div>
      <div class="row">
        <span>PAPER ROLL:</span>
        <span class="bold">${settings.paperSize}</span>
      </div>
      <div class="row">
        <span>FONT SCALE:</span>
        <span class="bold">${Math.round(scale * 100)}% (${settings.fontSizePreset.toUpperCase()})</span>
      </div>
      <div class="row">
        <span>DIRECT PRINT:</span>
        <span class="bold">${settings.directPrint ? 'ENABLED (BYPASS DIALOG)' : 'DISABLED'}</span>
      </div>
      <div class="row">
        <span>TIMESTAMP:</span>
        <span>${now}</span>
      </div>

      <div class="double-divider"></div>
      <div class="center bold" style="font-size: ${(10.5 * scale).toFixed(1)}px;">PRINT ALIGNMENT SAMPLE</div>
      <div class="row bold">
        <span>ITEM NAME</span>
        <span>QTY</span>
        <span>TOTAL</span>
      </div>
      <div class="divider"></div>
      <div class="row">
        <span>1. Basmati Rice 5kg</span>
        <span>2</span>
        <span>Rs. 760.00</span>
      </div>
      <div class="row">
        <span>2. Coconut Oil 1L</span>
        <span>5</span>
        <span>Rs. 950.00</span>
      </div>
      <div class="divider"></div>
      <div class="row bold" style="font-size: ${(12 * scale).toFixed(1)}px;">
        <span>NET AMOUNT:</span>
        <span>Rs. 1,710.00</span>
      </div>

      <div class="box bold">
        SUCCESS: 1-TOUCH DIRECT THERMAL PRINTING READY
      </div>

      <div class="center sub">SoftAir SFA Mobile v1.0.0</div>
      ${'<br/>'.repeat(settings.feedLines || 2)}
    </body>
    </html>
  `;

  let printerUrl = getDirectPrinterUrl();
  if (Platform.OS === 'ios' && !printerUrl && settings.directPrint) {
    const paired = await pairDirectPrinter();
    if (paired) {
      printerUrl = paired.url;
    }
  }

  const printOptions: Print.PrintOptions = {
    html: testHtml,
    width: is58mm ? 164 : 226,
  };
  if (printerUrl) {
    printOptions.printerUrl = printerUrl;
  }

  await Print.printAsync(printOptions);
}
