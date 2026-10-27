/**
 * printerConfig.ts
 * Shared printer types, defaults, and persistence to prevent require cycles.
 */

import { getSyncMeta, setSyncMeta, getCompanyProfile, setCompanyProfile } from '../database/db';

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
