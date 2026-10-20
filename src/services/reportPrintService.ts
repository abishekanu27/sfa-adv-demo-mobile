import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { getCompanyProfile, getAssignedRoute } from '../database/db';
import { getCompanyLogo } from '../utils/companyBranding';
import {
  getPrinterSettings,
  getDirectPrinterUrl,
  printReportDirectBluetooth,
  isDirectBluetoothSupported,
  abortActivePrint,
  isPrintAborted,
  ensureOrAutoConnectPrinter,
} from './printerSettingsService';

export type ReportType =
  | 'collections'
  | 'route_wise'
  | 'payments'
  | 'outstanding'
  | 'expenses'
  | 'orders'
  | 'items_wise'
  | 'customers_wise'
  | 'closing_stock';

export type ThermalWidth = '58mm' | '80mm';

export interface ReportPrintOptions {
  title: string;
  subtitle?: string;
  salesmanName?: string;
  vehicleRegNo?: string;
  routeName?: string;
  headers: string[];
  rows: (string | number)[][];
  summaryCards?: { label: string; value: string; color?: string }[];
  footerNote?: string;
  paperWidth?: ThermalWidth;
}

export function formatINR(val: number | string | undefined | null): string {
  const num = typeof val === 'number' ? val : parseFloat(String(val) || '0');
  if (isNaN(num)) return '₹0.00';
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Generates thermal-optimized HTML formatted strictly for 58mm or 80mm roll paper
 */
export function generateReportHtml(options: ReportPrintOptions): string {
  const company = getCompanyProfile();
  const assigned = getAssignedRoute();
  const now = new Date();
  const printDateStr = now.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const printerSettings = getPrinterSettings();
  const paperWidth: ThermalWidth = options.paperWidth || (printerSettings.paperSize === '58mm' ? '58mm' : '80mm');
  const is58mm = paperWidth === '58mm';
  const fontScale = printerSettings.fontScale || 1.0;

  const salesman = options.salesmanName || 'Sales Representative';
  const vehicle = options.vehicleRegNo || assigned?.vehicle_reg_no || 'Assigned Van';
  const route = options.routeName || assigned?.route_name || 'Assigned Territory';

  const companyLogo = getCompanyLogo(company);
  const companyName = company.company_name || '';
  const companyAddress = [company.address, company.city, company.state].filter(Boolean).join(', ');
  const companyGstin = company.gstin ? `GSTIN: ${company.gstin}` : '';
  const companyPhone = company.phone ? `Phone: ${company.phone}` : '';

  const dividerDouble = is58mm ? '==============================' : '========================================';
  const dividerSingle = is58mm ? '------------------------------' : '----------------------------------------';

  // Render KPI Summary Block
  const summaryBlockHtml =
    options.summaryCards && options.summaryCards.length > 0
      ? `
      <div class="divider">${dividerSingle}</div>
      <div class="section-title">SUMMARY TOTALS</div>
      <div class="kpi-box">
        ${options.summaryCards
          .map(
            (c) => `
          <div class="kpi-row">
            <span class="kpi-label">${c.label}:</span>
            <span class="kpi-val">${c.value}</span>
          </div>
        `
          )
          .join('')}
      </div>
    `
      : '';

  // Render Table Header & Rows
  const tableHeadersHtml = options.headers
    .map((h, i) => {
      const isRight = i === options.headers.length - 1;
      const isLeft = i === 0;
      return `<th class="${isRight ? 'th-right' : isLeft ? 'th-left' : 'th-center'}">${h}</th>`;
    })
    .join('');

  const tableRowsHtml = options.rows
    .map((row) => {
      return `
      <tr>
        ${row
          .map((cell, cIdx) => {
            const isRight =
              cIdx === row.length - 1 ||
              (typeof cell === 'string' &&
                (cell.startsWith('₹') || cell.startsWith('-₹') || cell.startsWith('+₹')));
            const isLeft = cIdx === 0;
            return `<td class="${isRight ? 'td-right font-bold' : isLeft ? 'td-left' : 'td-center'}">${cell ?? '-'}</td>`;
          })
          .join('')}
      </tr>
    `;
    })
    .join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
        <title>${options.title}</title>
        <style>
          @media print {
            @page {
              margin: 0;
              size: ${is58mm ? '58mm auto' : '80mm auto'};
            }
            html, body {
              margin: 0;
              padding: ${is58mm ? '2mm 1mm' : '4mm 2mm'};
              width: ${is58mm ? '56mm' : '78mm'};
              background: #ffffff;
            }
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body {
            font-family: 'Courier New', Courier, monospace;
            margin: 0 auto;
            padding: ${is58mm ? '4px 2px 26mm 2px' : '8px 4px 30mm 4px'};
            color: #000000;
            background: #ffffff;
            max-width: ${is58mm ? '280px' : '385px'};
            width: 100%;
            font-size: ${is58mm ? '9px' : '10.5px'};
            line-height: 1.3;
          }
          .header {
            text-align: center;
            margin-bottom: 4px;
          }
          .logo-img {
            max-width: ${is58mm ? '36px' : '48px'};
            max-height: ${is58mm ? '36px' : '48px'};
            margin: 0 auto 3px auto;
            display: block;
            object-fit: contain;
          }
          .company-name {
            font-size: ${is58mm ? '9.5px' : '11px'};
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.2px;
            margin: 0;
            color: #000000;
          }
          .company-sub {
            font-size: ${is58mm ? '7.5px' : '9px'};
            color: #222222;
            margin: 1px 0;
            line-height: 1.25;
          }
          .divider {
            font-family: 'Courier New', Courier, monospace;
            font-size: ${is58mm ? '8.5px' : '10.5px'};
            color: #000000;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            letter-spacing: -0.05em;
            margin: 3px 0;
          }
          .report-title {
            text-align: center;
            font-size: ${is58mm ? '11px' : '13px'};
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin: 2px 0 1px 0;
          }
          .report-subtitle {
            text-align: center;
            font-size: ${is58mm ? '8px' : '9.5px'};
            color: #333333;
            margin-bottom: 3px;
          }
          .meta-section {
            margin: 4px 0;
            font-size: ${is58mm ? '8px' : '9.5px'};
          }
          .meta-row {
            display: flex;
            justify-content: space-between;
            margin: 1.5px 0;
          }
          .meta-label {
            color: #444444;
          }
          .meta-val {
            font-weight: 700;
            color: #000000;
          }
          .section-title {
            text-align: center;
            font-weight: 800;
            font-size: ${is58mm ? '8.5px' : '10px'};
            margin: 2px 0;
            text-transform: uppercase;
          }
          .kpi-box {
            border: 1px dashed #000000;
            padding: 3px 5px;
            margin: 3px 0;
            font-size: ${is58mm ? '8.5px' : '10px'};
          }
          .kpi-row {
            display: flex;
            justify-content: space-between;
            margin: 1px 0;
          }
          .kpi-label {
            font-weight: 600;
          }
          .kpi-val {
            font-weight: 900;
          }
          .thermal-table {
            width: 100%;
            border-collapse: collapse;
            margin: 4px 0;
            table-layout: auto;
          }
          .thermal-table th {
            font-size: ${is58mm ? '7px' : '8.5px'};
            font-weight: 900;
            text-transform: uppercase;
            padding: 3px 1px;
            border-top: 1px solid #000000;
            border-bottom: 1px solid #000000;
            color: #000000;
          }
          .thermal-table td {
            font-size: ${is58mm ? '7px' : '8.5px'};
            padding: 2.5px 1px;
            border-bottom: 0.5px dashed #cccccc;
            vertical-align: top;
            color: #000000;
            word-break: break-word;
          }
          .th-left, .td-left {
            text-align: left;
          }
          .th-center, .td-center {
            text-align: center;
          }
          .th-right, .td-right {
            text-align: right;
          }
          .font-bold {
            font-weight: 800;
          }
          .footer-section {
            margin-top: 6px;
            text-align: center;
            font-size: ${is58mm ? '7.5px' : '9px'};
          }
          .sign-area {
            display: flex;
            justify-content: space-between;
            margin-top: 14px;
            font-size: ${is58mm ? '7.5px' : '9px'};
            text-align: center;
          }
          .sign-col {
            width: 44%;
          }
          .sign-line {
            border-bottom: 1px dashed #000000;
            height: 18px;
            margin-bottom: 3px;
          }
          .cut-line {
            text-align: center;
            margin-top: 14px;
            font-size: ${is58mm ? '7px' : '8px'};
            color: #666666;
          }
        </style>
      </head>
      <body>
        <div class="header">
          ${companyLogo ? `<img src="${companyLogo}" class="logo-img" alt="Logo" onerror="this.style.display='none';" />` : ''}
          <div class="company-name">${companyName}</div>
          ${companyAddress ? `<div class="company-sub">${companyAddress}</div>` : ''}
          ${[companyGstin, companyPhone].filter(Boolean).length > 0 ? `<div class="company-sub">${[companyGstin, companyPhone].filter(Boolean).join(' • ')}</div>` : ''}
        </div>

        <div class="divider">${dividerDouble}</div>

        <div class="report-title">*** ${options.title} ***</div>
        ${options.subtitle ? `<div class="report-subtitle">${options.subtitle}</div>` : ''}

        <div class="divider">${dividerSingle}</div>

        <div class="meta-section">
          <div class="meta-row">
            <span class="meta-label">Date & Time:</span>
            <span class="meta-val">${printDateStr}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Sales Representative:</span>
            <span class="meta-val">${salesman}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Vehicle / Van:</span>
            <span class="meta-val">${vehicle}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Route / Territory:</span>
            <span class="meta-val">${route}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Thermal Format:</span>
            <span class="meta-val">${paperWidth} Roll Paper</span>
          </div>
        </div>

        ${summaryBlockHtml}

        <div class="divider">${dividerSingle}</div>

        <table class="thermal-table">
          <thead>
            <tr>${tableHeadersHtml}</tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>

        <div class="divider">${dividerDouble}</div>

        <div class="footer-section">
          <div>Total Records Printed: <strong>${options.rows.length}</strong></div>
          <div style="margin-top: 2px;">*** SALESFORCE MOBILE FIELD ERP ***</div>
          ${options.footerNote ? `<div style="font-style: italic; margin-top: 3px;">"${options.footerNote}"</div>` : ''}
        </div>

        <div class="sign-area">
          <div class="sign-col">
            <div class="sign-line"></div>
            <div>Salesman Signature</div>
          </div>
          <div class="sign-col">
            <div class="sign-line"></div>
            <div>Depot In-Charge</div>
          </div>
        </div>

        <div class="cut-line">
          - - - - - - - [ CUT HERE ] - - - - - - -
        </div>
      </body>
    </html>
  `;
}

/**
 * Print report directly to connected printer (Wi-Fi, Bluetooth, Android/iOS print spooler)
 * Formats strictly for 58mm or 80mm thermal roll paper
 */
export async function printReportDocument(options: ReportPrintOptions, paperWidth?: ThermalWidth): Promise<void> {
  const printerSettings = getPrinterSettings();
  const chosenWidth: ThermalWidth = paperWidth || options.paperWidth || (printerSettings.paperSize === '58mm' ? '58mm' : '80mm');

  // On Android: Direct In-App Bluetooth ESC/POS printing matching Invoices and Orders
  if (Platform.OS === 'android') {
    if (!isDirectBluetoothSupported()) {
      throw new Error('Direct In-App Bluetooth printing is supported in the installed Android APK build. Please install the APK preview build to print directly without external apps.');
    }
    await ensureOrAutoConnectPrinter();
    await printReportDirectBluetooth(options, chosenWidth);
    return;
  }

  // Direct In-App Bluetooth ESC/POS printing for other platforms if address configured
  if (
    printerSettings.printerAddress &&
    isDirectBluetoothSupported()
  ) {
    await printReportDirectBluetooth(options, chosenWidth);
    return;
  }

  const html = generateReportHtml({ ...options, paperWidth: chosenWidth });
  const printerUrl = getDirectPrinterUrl();

  const printOptions: Print.PrintOptions = {
    html,
    width: chosenWidth === '58mm' ? 164 : 226,
  };
  if (printerUrl) {
    printOptions.printerUrl = printerUrl;
  }

  try {
    await Print.printAsync(printOptions);
  } catch (e: any) {
    const msg = (e?.message || e?.reason || e?.toString() || '').toLowerCase();
    if (
      msg.includes('complete') ||
      msg.includes('incomplete') ||
      msg.includes('cancel') ||
      msg.includes('dismiss') ||
      msg.includes('abort') ||
      msg.includes('picker')
    ) {
      // User cancelled print dialog
      return;
    }
    throw e;
  }
}

/**
 * Share report document as narrow Thermal PDF document (WhatsApp, Drive, Email, Bluetooth)
 */
export async function shareReportPdfDocument(options: ReportPrintOptions, paperWidth?: ThermalWidth): Promise<void> {
  const printerSettings = getPrinterSettings();
  const chosenWidth: ThermalWidth = paperWidth || options.paperWidth || (printerSettings.paperSize === '58mm' ? '58mm' : '80mm');
  const html = generateReportHtml({ ...options, paperWidth: chosenWidth });
  const is58mm = chosenWidth === '58mm';

  // 58mm at 72dpi ≈ 164 points; 80mm at 72dpi ≈ 227 points
  const { uri } = await Print.printToFileAsync({
    html,
    width: is58mm ? 164 : 227,
  });

  const isAvailable = await Sharing.isAvailableAsync();
  if (isAvailable) {
    await Sharing.shareAsync(uri, {
      UTI: '.pdf',
      mimeType: 'application/pdf',
      dialogTitle: `Share ${options.title} (${chosenWidth})`,
    });
  } else {
    throw new Error('Sharing is not supported on this device');
  }
}
