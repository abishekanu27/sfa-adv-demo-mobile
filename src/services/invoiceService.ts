import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { getCompanyProfile, CompanyProfile } from '../database/db';
import { getCompanyLogo } from '../utils/companyBranding';
import { getPrinterSettings, savePrinterSettings, getDirectPrinterUrl, pairDirectPrinter } from './printerSettingsService';
import { isDirectBluetoothSupported, printInvoiceDirectBluetooth, ensureOrAutoConnectPrinter } from './directBluetoothPrinter';

export interface InvoiceItem {
  product_id?: string | number;
  product_name: string;
  product_sku?: string;
  package_type?: string;
  unit?: string;
  qty: number;
  unit_price: number;
  total: number;
  mrp?: number;
  hsn_code?: string;
  gst_rate?: number;
  cgst_rate?: number;
  sgst_rate?: number;
  cgst_amount?: number;
  sgst_amount?: number;
  total_gst?: number;
  taxable_amount?: number;
  discount?: number;
  discount_amount?: number;
  items_per_package?: number;
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
export function formatItemTitle(item: InvoiceItem): string {
  const hsn = (item.hsn_code || '').trim();
  const rawName = cleanProductName(item.product_name || '');

  // Strip leading HSN if already present in product name
  let cleanName = rawName;
  if (hsn && hsn !== '—' && hsn !== '-') {
    cleanName = cleanName.replace(new RegExp(`^${hsn}\\s*[-–—:]?\\s*`, 'i'), '').trim();
  }
  // Strip any leading numeric HSN-like pattern (e.g. 1234 - or 12345678 -)
  cleanName = cleanName.replace(/^\d{4,8}\s*[-–—:]\s*/, '').trim();

  const pkg = (item.package_type || '').trim();
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

export interface MobileInvoiceData {
  invoice_number: string;
  invoice_date?: string;
  due_date?: string;
  customer_name: string;
  customer_code?: string;
  customer_place?: string;
  customer_address?: string;
  customer_city?: string;
  customer_state?: string;
  customer_phone?: string;
  customer_gst?: string;
  salesman_name?: string;
  salesman_phone?: string;
  vehicle_reg_no?: string;
  route_name?: string;
  items: InvoiceItem[];
  subtotal: number;
  subtotal_gross?: number;
  discount_amount?: number;
  round_off?: number;
  grand_total: number;
  paid_amount: number;
  balance_due: number;
  payment_mode?: string;
  payment_status?: string;
  notes?: string;
  is_draft?: boolean;
  order_type?: 'sale' | 'order' | 'return' | 'payment';
  company?: CompanyProfile;
  has_gst?: boolean;
  total_taxable?: number;
  total_cgst?: number;
  total_sgst?: number;
  total_gst?: number;
}

/**
 * Generates an A4 Full Standard Invoice (GST Tax Invoice or Commercial Bill)
 * matching the Web Settings / Invoices Menu template exactly.
 */
export function generateA4InvoiceHtml(data: MobileInvoiceData): string {
  const company = data.company || getCompanyProfile();
  const invoiceSettings = company?.invoice_settings || {};

  const companyName = company.company_name || '';
  const legalName = company.legal_name || companyName;
  const companyAddress = [
    company.address_line1,
    company.address_line2,
    company.city,
    company.state ? `${company.state}${company.pincode ? ' - ' + company.pincode : ''}` : company.pincode
  ].filter(Boolean).join(', ') || company.address || '';
  const companyGstin = company.gstin || company.tax_id || '';
  const companyPhone = company.phone || '';
  const companyEmail = company.email || '';
  const companyState = company.state || '';
  const companyStateCode = company.state_code || '';

  const custGst = (data.customer_gst || '').trim();
  const hasGst = Boolean(
    data.has_gst ||
    (custGst.length >= 3 && !['URP', 'NON-GST', 'NIL', 'NONE', 'UNDEFINED', 'NULL'].includes(custGst.toUpperCase()))
  );

  const isOrder = data.order_type === 'order';
  const isReturn = data.order_type === 'return';

  const invoiceTitle = isOrder
    ? 'ADVANCE BOOKING ORDER'
    : isReturn
    ? 'PRODUCT RETURN CREDIT MEMO'
    : (hasGst ? 'INVOICE' : 'ESTIMATE');

  const invoiceDate = data.invoice_date || new Date().toISOString().split('T')[0];
  const dueDate = data.due_date || invoiceDate;

  // Normalized Calculation
  const totalDiscount = data.discount_amount != null
    ? Number(data.discount_amount)
    : 0;

  const subtotalGross = data.subtotal_gross != null
    ? Number(data.subtotal_gross)
    : data.items.reduce((sum, item) => {
        const qty = Number(item.qty) || 1;
        const rate = Number(item.unit_price) || 0;
        const lineTotal = Number(item.total);
        return sum + (!isNaN(lineTotal) && lineTotal > 0 ? lineTotal : (qty * rate));
      }, 0);

  const netGross = Math.max(0, subtotalGross - totalDiscount);
  const discountFactor = subtotalGross > 0 ? (netGross / subtotalGross) : 1;

  let computedTaxable = 0;
  let computedCgst = 0;
  let computedSgst = 0;

  if (hasGst) {
    data.items.forEach(it => {
      const qty = Number(it.qty) || 1;
      const rate = Number(it.unit_price) || 0;
      const rawTotal = Number(it.total);
      const lineTotal = (!isNaN(rawTotal) && rawTotal > 0) ? rawTotal : (qty * rate);
      const discountedItemTotal = lineTotal * discountFactor;
      const gRate = Number(it.gst_rate) || 0;
      if (gRate > 0) {
        const itemTaxable = Math.round((discountedItemTotal / (1 + gRate / 100)) * 100) / 100;
        const itemGst = Math.round((discountedItemTotal - itemTaxable) * 100) / 100;
        const itemCgst = Math.round((itemGst / 2) * 100) / 100;
        const itemSgst = Math.round((itemGst - itemCgst) * 100) / 100;
        computedTaxable += itemTaxable;
        computedCgst += itemCgst;
        computedSgst += itemSgst;
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
  const totalGst = data.total_gst != null ? data.total_gst : (totalCgst + totalSgst);

  const upiQrUrl = (invoiceSettings.show_upi_qr !== false && company.upi_id)
    ? `https://api.qrserver.com/v1/create-qr-code/?size=140x140&margin=0&data=${encodeURIComponent(
        `upi://pay?pa=${company.upi_id}&pn=${encodeURIComponent(companyName)}&am=${data.grand_total.toFixed(2)}&cu=INR`
      )}`
    : '';

  const itemsRows = data.items.map((item, idx) => {
    const qty = Number(item.qty) || 1;
    const rate = Number(item.unit_price) || 0;
    const gross = qty * rate;
    const rawLineTotal = Number(item.total);
    const lineTotal = (!isNaN(rawLineTotal) && rawLineTotal > 0) ? rawLineTotal : gross;
    const gstRate = item.gst_rate != null ? Number(item.gst_rate) : (hasGst ? 18 : 0);

    let taxable = lineTotal;
    let cgst = 0;
    let sgst = 0;

    if (hasGst && gstRate > 0) {
      if (item.taxable_amount != null && Number(item.taxable_amount) < lineTotal && Number(item.taxable_amount) > 0) {
        taxable = Number(item.taxable_amount);
        const diffGst = Math.max(0, lineTotal - taxable);
        cgst = item.cgst_amount != null ? Number(item.cgst_amount) : diffGst / 2;
        sgst = item.sgst_amount != null ? Number(item.sgst_amount) : diffGst / 2;
      } else {
        // Taxable Value = Total - GST = lineTotal / (1 + gstRate / 100)
        taxable = Math.round((lineTotal / (1 + gstRate / 100)) * 100) / 100;
        const lineGst = Math.round((lineTotal - taxable) * 100) / 100;
        cgst = Math.round((lineGst / 2) * 100) / 100;
        sgst = Math.round((lineGst - cgst) * 100) / 100;
      }
    }
    const hsn = (item.hsn_code || '—').trim();
    const itemTitle = formatItemTitle(item);
    if (hasGst) {
      return `
        <tr>
          <td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px;">${idx + 1}</td>
          <td style="border: 1px solid #cbd5e1; padding: 6px;">
            <strong style="color: #0f172a; font-size: 11px;">${itemTitle}</strong>
            ${item.product_sku ? `<div style="font-size: 9px; color: #64748b;">SKU: ${item.product_sku}</div>` : ''}
          </td>
          <td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px; font-size: 10px; color: #475569;">${hsn}</td>
          <td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px; font-weight: 600;">${qty}</td>
          <td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px; font-size: 10px; color: #64748b;">${item.unit || item.package_type || 'Pcs'}</td>
          <td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px; font-size: 10px; color: #475569;">${gstRate}%</td>
          <td style="text-align: right; border: 1px solid #cbd5e1; padding: 6px; font-weight: 600;">₹${taxable.toFixed(2)}</td>
          <td style="text-align: right; border: 1px solid #cbd5e1; padding: 6px;">₹${rate.toFixed(2)}</td>
          <td style="text-align: right; border: 1px solid #cbd5e1; padding: 6px; font-size: 10px;">₹${cgst.toFixed(2)}<br/><span style="color:#64748b;">(${gstRate/2}%)</span></td>
          <td style="text-align: right; border: 1px solid #cbd5e1; padding: 6px; font-size: 10px;">₹${sgst.toFixed(2)}<br/><span style="color:#64748b;">(${gstRate/2}%)</span></td>
          <td style="text-align: right; border: 1px solid #cbd5e1; padding: 6px; font-weight: 700; color: #1e3a8a;">₹${lineTotal.toFixed(2)}</td>
        </tr>
      `;
    } else {
      return `
        <tr>
          <td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px;">${idx + 1}</td>
          <td style="border: 1px solid #cbd5e1; padding: 6px;">
            <strong style="color: #0f172a; font-size: 11px;">${itemTitle}</strong>
            ${item.product_sku ? `<div style="font-size: 9px; color: #64748b;">SKU: ${item.product_sku}</div>` : ''}
          </td>
          <td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px; font-size: 10px; color: #475569;">${hsn}</td>
          <td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px; font-weight: 600;">${qty}</td>
          <td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px; font-size: 10px; color: #64748b;">${item.unit || item.package_type || 'Pcs'}</td>
          <td style="text-align: right; border: 1px solid #cbd5e1; padding: 6px;">₹${rate.toFixed(2)}</td>
          <td style="text-align: right; border: 1px solid #cbd5e1; padding: 6px; font-weight: 700; color: #d97706;">₹${lineTotal.toFixed(2)}</td>
        </tr>
      `;
    }
  }).join('');

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>${invoiceTitle} - ${data.invoice_number}</title>
    <style>
      @page {
        size: A4 portrait;
        margin: 12mm 12mm 12mm 12mm;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        color: #0f172a;
        background: #ffffff;
        font-size: 11px;
        line-height: 1.4;
        padding: 10px;
        -webkit-print-color-adjust: exact;
      }
      .sheet {
        width: 100%;
        max-width: 800px;
        margin: 0 auto;
        background: #ffffff;
      }
      .header-table {
        width: 100%;
        border-bottom: 2.5px solid #0f172a;
        padding-bottom: 12px;
        margin-bottom: 12px;
      }
      .company-title {
        font-size: 18px;
        font-weight: 800;
        color: #0f172a;
        margin-bottom: 3px;
        letter-spacing: -0.02em;
      }
      .company-meta {
        font-size: 10.5px;
        color: #475569;
        line-height: 1.35;
      }
      .badge-title {
        display: inline-block;
        background: ${hasGst ? '#1d4ed8' : '#d97706'};
        color: #ffffff;
        padding: 5px 12px;
        border-radius: 4px;
        font-weight: 800;
        font-size: 12px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      .parties-grid {
        width: 100%;
        border: 1px solid #cbd5e1;
        border-radius: 5px;
        background: #f8fafc;
        margin-bottom: 14px;
      }
      .party-cell {
        padding: 10px 14px;
        vertical-align: top;
        width: 50%;
        font-size: 11px;
      }
      .party-cell:first-child {
        border-right: 1px solid #cbd5e1;
      }
      .party-label {
        font-size: 10px;
        font-weight: 800;
        color: #64748b;
        text-transform: uppercase;
        margin-bottom: 4px;
        letter-spacing: 0.5px;
      }
      .party-name {
        font-size: 13.5px;
        font-weight: 800;
        color: #0f172a;
        margin-bottom: 2px;
      }
      .items-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 14px;
        font-size: 10.5px;
      }
      .items-table th {
        background: #0f172a;
        color: #ffffff;
        padding: 7px 6px;
        font-weight: 700;
        border: 1px solid #0f172a;
        font-size: 10px;
        text-transform: uppercase;
      }
      .items-table tr:nth-child(even) td {
        background: #f8fafc;
      }
      .footer-table {
        width: 100%;
        border-collapse: collapse;
      }
      .footer-cell {
        vertical-align: top;
      }
      .bank-card {
        border: 1px solid #cbd5e1;
        border-radius: 5px;
        padding: 10px;
        background: #f8fafc;
        font-size: 10.5px;
        line-height: 1.45;
        margin-bottom: 10px;
      }
      .terms-card {
        border: 1px solid #cbd5e1;
        border-radius: 5px;
        padding: 10px;
        background: #ffffff;
        font-size: 9.5px;
        color: #64748b;
        line-height: 1.4;
      }
      .calc-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
      }
      .calc-table td {
        padding: 5px 8px;
      }
      .calc-table tr.grand td {
        border-top: 2px solid #0f172a;
        border-bottom: 2px solid #0f172a;
        font-size: 14px;
        font-weight: 800;
        color: ${hasGst ? '#1d4ed8' : '#d97706'};
        padding: 7px 8px;
      }
      .sign-box {
        text-align: right;
        font-size: 11px;
        margin-top: 24px;
      }
      .upi-box {
        text-align: center;
        border: 1px dashed #94a3b8;
        border-radius: 5px;
        padding: 8px;
        background: #ffffff;
        display: inline-block;
      }
    </style>
  </head>
  <body>
    <div class="sheet">
      <!-- HEADER -->
      <table class="header-table">
        <tr>
          <td style="vertical-align: top;">
            ${invoiceSettings.show_logo ? `<img src="${getCompanyLogo(company)}" alt="Logo" style="max-height: 48px; max-width: 140px; margin-bottom: 6px; object-fit: contain;" />` : ''}
            <div class="company-title">${legalName}</div>
            <div class="company-meta">
              ${companyAddress}<br/>
              <strong>GSTIN:</strong> ${companyGstin} | <strong>State:</strong> ${companyState} (${companyStateCode})<br/>
              ${companyPhone ? `<strong>Phone:</strong> ${companyPhone} ` : ''}${companyEmail ? `| <strong>Email:</strong> ${companyEmail}` : ''}
            </div>
          </td>
          <td style="vertical-align: top; text-align: right;">
            <div class="badge-title">${invoiceTitle}</div>
            ${!hasGst ? '<div style="font-size: 10px; color: #b45309; font-weight: 700; margin-top: 3px;">Non-GST / Commercial Retail Sale</div>' : ''}
            <div style="margin-top: 8px; font-size: 11px; line-height: 1.45; text-align: right;">
              <strong>${hasGst ? 'Invoice No:' : 'Bill No:'}</strong> <span style="font-size: 12px; font-weight: 700;">${data.invoice_number}</span><br/>
              <strong>Date:</strong> ${invoiceDate}<br/>
              <strong>Due Date:</strong> ${dueDate}<br/>
              <strong>Reverse Charge:</strong> No
            </div>
          </td>
        </tr>
      </table>

      <!-- PARTIES & DISPATCH -->
      <table class="parties-grid">
        <tr>
          <td class="party-cell">
            <div class="party-label">${hasGst ? 'Billed To (Customer):' : 'Customer / Buyer:'}</div>
            <div class="party-name">${data.customer_name}</div>
            <div>${data.customer_address || data.customer_place || 'Kerala, India'}</div>
            ${data.customer_phone ? `<div>Phone: ${data.customer_phone}</div>` : ''}
            <div style="margin-top: 4px; font-weight: 700;">
              ${hasGst ? `<span style="color: #1d4ed8;">GSTIN: ${data.customer_gst}</span>` : '<span style="color: #64748b;">Category: Retail Consumer (Non-GST)</span>'}
            </div>
          </td>
          <td class="party-cell">
            <div class="party-label">Dispatched &amp; Delivery Details:</div>
            <div><strong>Place of Supply:</strong> ${companyState} (${companyStateCode})</div>
            <div><strong>Sales Executive:</strong> ${data.salesman_name || 'Sales Representative'}</div>
            <div><strong>Vehicle / Van:</strong> ${data.vehicle_reg_no || 'N/A'}</div>
            <div><strong>Payment Mode:</strong> ${data.payment_mode || 'Cash'}</div>
            <div><strong>Status:</strong> <span style="color: ${data.balance_due <= 0 ? '#15803d' : '#b91c1c'}; font-weight: 700;">${data.balance_due <= 0 ? 'PAID' : (data.paid_amount > 0 ? 'PARTIAL' : 'PENDING')}</span></div>
          </td>
        </tr>
      </table>

      <!-- ITEMS TABLE -->
      <table class="items-table">
        <thead>
          <tr>
            <th style="width: 28px; text-align: center;">#</th>
            <th style="text-align: left;">Product Description</th>
            <th style="width: 55px; text-align: center;">HSN</th>
            <th style="width: 40px; text-align: center;">Qty</th>
            <th style="width: 40px; text-align: center;">Unit</th>
            ${hasGst ? `
              <th style="width: 50px; text-align: center;">GST (%)</th>
              <th style="width: 75px; text-align: right;">Taxable Value</th>
              <th style="width: 65px; text-align: right;">Rate (₹)</th>
              <th style="width: 60px; text-align: right;">CGST</th>
              <th style="width: 60px; text-align: right;">SGST</th>
              <th style="width: 75px; text-align: right;">Total</th>
            ` : `
              <th style="width: 65px; text-align: right;">Rate (₹)</th>
              <th style="width: 75px; text-align: right;">Total (₹)</th>
            `}
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>

      <!-- SUMMARY & BANK DETAILS -->
      <table class="footer-table">
        <tr>
          <td class="footer-cell" style="width: 52%; padding-right: 14px;">
            ${invoiceSettings.show_bank_details !== false && company.bank_name ? `
              <div class="bank-card">
                <strong>Bank Account Details for NEFT / RTGS / UPI:</strong><br/>
                Bank: <strong>${company.bank_name}</strong> | A/c No: <strong>${company.account_number || '50200012345678'}</strong><br/>
                IFSC: <strong>${company.ifsc_code || 'HDFC0001234'}</strong> | Branch: ${company.bank_branch || company.city || 'Main Branch'}<br/>
                Account Holder: <strong>${company.account_holder || legalName}</strong>
              </div>
            ` : ''}

            ${invoiceSettings.show_terms !== false && company.terms_and_conditions ? `
              <div class="terms-card">
                <strong style="color: #475569; text-transform: uppercase;">Terms &amp; Conditions:</strong><br/>
                ${company.terms_and_conditions.split('\n').filter(Boolean).map(l => `<div>• ${l}</div>`).join('')}
              </div>
            ` : ''}
          </td>

          <td class="footer-cell" style="width: 48%;">
            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 5px; padding: 8px;">
              <table class="calc-table">
                <tr>
                  <td>Subtotal (Gross):</td>
                  <td style="text-align: right; font-weight: 600;">₹${subtotalGross.toFixed(2)}</td>
                </tr>
                ${totalDiscount > 0 ? `
                  <tr style="color: #dc2626;">
                    <td>Total Discount:</td>
                    <td style="text-align: right; font-weight: 700; color: #dc2626;">- ₹${totalDiscount.toFixed(2)}</td>
                  </tr>
                ` : ''}
                ${hasGst ? `
                  <tr>
                    <td>Total Taxable Value:</td>
                    <td style="text-align: right; font-weight: 600;">₹${totalTaxable.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>Central GST (CGST):</td>
                    <td style="text-align: right; color: #1d4ed8;">+ ₹${totalCgst.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>State GST (SGST):</td>
                    <td style="text-align: right; color: #1d4ed8;">+ ₹${totalSgst.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="font-weight: 700;">Total GST Amount:</td>
                    <td style="text-align: right; font-weight: 700; color: #1d4ed8;">₹${totalGst.toFixed(2)}</td>
                  </tr>
                ` : `
                  <tr>
                    <td style="color: #64748b;">GST Tax:</td>
                    <td style="text-align: right; font-style: italic; color: #64748b;">Nil (0% Exempt)</td>
                  </tr>
                `}
                ${(() => {
                  const exactTotal = hasGst ? (totalTaxable + totalGst) : (subtotalGross - totalDiscount);
                  const roundOffVal = data.round_off != null ? data.round_off : Math.round((data.grand_total - exactTotal) * 100) / 100;
                  if (roundOffVal !== 0) {
                    return `
                      <tr style="color: #64748b; font-size: 11px;">
                        <td>Round Off (Auto):</td>
                        <td style="text-align: right; color: ${roundOffVal > 0 ? '#15803d' : '#b91c1c'}; font-weight: 600;">
                          ${roundOffVal > 0 ? `+ ₹${roundOffVal.toFixed(2)}` : `- ₹${Math.abs(roundOffVal).toFixed(2)}`}
                        </td>
                      </tr>
                    `;
                  }
                  return '';
                })()}
                <tr class="grand">
                  <td>Grand Total:</td>
                  <td style="text-align: right;">₹${data.grand_total.toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="color: #15803d; font-weight: 700;">Paid Amount (${data.payment_mode || 'Cash'}):</td>
                  <td style="text-align: right; color: #15803d; font-weight: 700;">₹${data.paid_amount.toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="color: ${data.balance_due > 0 ? '#b91c1c' : '#475569'}; font-weight: 700;">Balance Due:</td>
                  <td style="text-align: right; color: ${data.balance_due > 0 ? '#b91c1c' : '#475569'}; font-weight: 800;">₹${data.balance_due.toFixed(2)}</td>
                </tr>
              </table>
            </div>

            <!-- UPI QR & Signature -->
            <table style="width: 100%; margin-top: 14px;">
              <tr>
                <td style="vertical-align: middle;">
                  ${upiQrUrl ? `
                    <div class="upi-box">
                      <img src="${upiQrUrl}" alt="UPI" style="width: 58px; height: 58px; display: block; margin: 0 auto;" />
                      <div style="font-size: 8.5px; font-weight: 700; margin-top: 3px; color: #0f172a;">UPI: ${company.upi_id}</div>
                    </div>
                  ` : ''}
                </td>
                <td style="vertical-align: bottom; text-align: right;">
                  <div style="font-size: 10.5px; font-weight: 700;">For ${companyName}</div>
                  <div style="height: 38px;"></div>
                  <div style="font-size: 10px; color: #475569; border-top: 1px solid #94a3b8; display: inline-block; padding-top: 2px;">
                    Authorized Signatory
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  </body>
  </html>
  `;
}

/**
 * Wraps long product descriptions exceeding maxLen characters (default 13)
 * onto subsequent lines using <br/> for HTML thermal rendering.
 */
export function wrapThermalItemName(name: string, maxLen = 13): string {
  if (!name) return '';
  const words = name.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      if (word.length > maxLen) {
        for (let i = 0; i < word.length; i += maxLen) {
          lines.push(word.slice(i, i + maxLen));
        }
      } else {
        current = word;
      }
    } else if ((current + ' ' + word).length <= maxLen) {
      current += ' ' + word;
    } else {
      lines.push(current);
      if (word.length > maxLen) {
        for (let i = 0; i < word.length; i += maxLen) {
          lines.push(word.slice(i, i + maxLen));
        }
        current = '';
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.join('<br/>');
}

/**
 * Generates Thermal POS Receipt HTML (80mm / 58mm)
 * matching Web Settings / Invoices Menu thermal template.
 */
export function generateThermalInvoiceHtml(data: MobileInvoiceData): string {
  const company = data.company || getCompanyProfile();
  const invoiceSettings = company?.invoice_settings || {};
  const printerSettings = getPrinterSettings();
  const thermalWidth = printerSettings.paperSize === 'A4' ? '80mm' : (printerSettings.paperSize || invoiceSettings.thermal_width || company?.print_templates?.thermalWidth || '80mm');
  const is58mm = thermalWidth === '58mm';
  const fontScale = printerSettings.fontScale || 1.0;

  const formattedDate = data.invoice_date || new Date().toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const isOrder = data.order_type === 'order';
  const isReturn = data.order_type === 'return';

  let paymentStatusText = '';
  let statusColor = '#059669';

  if (isOrder) {
    if (data.paid_amount > 0) {
      paymentStatusText = data.balance_due <= 0 ? 'ORDER PAID IN FULL' : `ADVANCE PAID (₹${data.paid_amount.toFixed(2)})`;
      statusColor = '#059669';
    } else {
      paymentStatusText = 'NO ADVANCE • DUE ON DELIVERY';
      statusColor = '#d97706';
    }
  } else if (isReturn) {
    paymentStatusText = 'PRODUCT RESTOCKED / RETURN';
    statusColor = '#b45309';
  } else {
    paymentStatusText = data.balance_due <= 0 ? 'PAID IN FULL' : data.paid_amount > 0 ? 'PARTIAL PAYMENT' : 'CREDIT SALE';
    statusColor = data.balance_due <= 0 ? '#059669' : data.paid_amount > 0 ? '#d97706' : '#dc2626';
  }

  const companyName = company.company_name || company.legal_name || '';
  const addressParts = [
    company.address_line1,
    company.address_line2,
    company.city,
    company.state ? `${company.state}${company.pincode ? ' - ' + company.pincode : ''}` : company.pincode,
  ].filter(Boolean);
  const companyAddress = addressParts.length > 0 ? addressParts.join(', ') : (company.address || '');
  const companyGstin = company.gstin || company.tax_id || '';
  const companyPhone = company.phone || '';

  const custGst = (data.customer_gst || '').trim();
  const hasGst = Boolean(
    data.has_gst ||
    (custGst.length >= 3 && !['URP', 'NON-GST', 'NIL', 'NONE', 'UNDEFINED', 'NULL'].includes(custGst.toUpperCase()))
  );

  const defaultTitle = isOrder
    ? 'ADVANCE BOOKING ORDER RECEIPT'
    : isReturn
    ? 'PRODUCT RETURN RECEIPT'
    : (hasGst ? 'INVOICE' : 'ESTIMATE');

  const invoiceTitle = data.is_draft
    ? (isOrder ? 'PROVISIONAL BOOKING ORDER' : (hasGst ? 'PROVISIONAL INVOICE' : 'PROVISIONAL ESTIMATE'))
    : defaultTitle;

  const dividerDouble = is58mm ? '==============================' : '========================================';
  const dividerSingle = is58mm ? '------------------------------' : '----------------------------------------';

  const totalDiscount = data.discount_amount != null
    ? Number(data.discount_amount)
    : 0;

  const subtotalGross = data.subtotal_gross != null
    ? Number(data.subtotal_gross)
    : data.items.reduce((sum, item) => {
        const qty = Number(item.qty) || 1;
        const rate = Number(item.unit_price) || 0;
        const lineTotal = Number(item.total);
        return sum + (!isNaN(lineTotal) && lineTotal > 0 ? lineTotal : (qty * rate));
      }, 0);

  const netGross = Math.max(0, subtotalGross - totalDiscount);
  const discountFactor = subtotalGross > 0 ? (netGross / subtotalGross) : 1;

  const ratesMap = new Map<number, { taxable: number; cgst: number; sgst: number }>();
  let computedTaxable = 0;
  let computedCgst = 0;
  let computedSgst = 0;

  if (hasGst) {
    data.items.forEach(it => {
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
  const totalGst = data.total_gst != null ? data.total_gst : (totalCgst + totalSgst);

  const itemsRowsHtml = data.items
    .map((item, idx) => {
      const qty = Number(item.qty) || 1;
      const rate = Number(item.unit_price) || 0;
      const gross = qty * rate;
      const rawLineTotal = Number(item.total);
      const lineTotal = (!isNaN(rawLineTotal) && rawLineTotal > 0) ? rawLineTotal : gross;
      const gstRate = item.gst_rate != null ? Number(item.gst_rate) : (hasGst ? 18 : 0);

      let taxable = lineTotal;
      let cgst = 0;
      let sgst = 0;

      if (hasGst && gstRate > 0) {
        if (item.taxable_amount != null && Number(item.taxable_amount) < lineTotal && Number(item.taxable_amount) > 0) {
          taxable = Number(item.taxable_amount);
          const diffGst = Math.max(0, lineTotal - taxable);
          cgst = item.cgst_amount != null ? Number(item.cgst_amount) : diffGst / 2;
          sgst = item.sgst_amount != null ? Number(item.sgst_amount) : diffGst / 2;
        } else {
          taxable = Math.round((lineTotal / (1 + gstRate / 100)) * 100) / 100;
          const lineGst = Math.round((lineTotal - taxable) * 100) / 100;
          cgst = Math.round((lineGst / 2) * 100) / 100;
          sgst = Math.round((lineGst - cgst) * 100) / 100;
        }
      }
      const total = lineTotal;
      const rawUnit = item.unit || item.package_type || 'Pcs';
      const unit = rawUnit.toLowerCase() === 'loose' ? 'Bag' : rawUnit;
      const itemTitle = formatItemTitle(item);
      const wrappedTitle = wrapThermalItemName(itemTitle, 13);
      if (hasGst) {
        return `
          <tr style="border-bottom: 0.5px solid #e4e4e7;">
            <td style="padding: 3px 1px; font-size: ${is58mm ? '7px' : '8px'}; vertical-align: top; width: 14px;">${idx + 1}</td>
            <td style="padding: 3px 1px; font-size: ${is58mm ? '7.5px' : '8.5px'}; font-weight: 700; color: #18181b; vertical-align: top; word-break: break-word;">
              ${wrappedTitle}
            </td>
            <td style="padding: 3px 1px; font-size: ${is58mm ? '7.5px' : '8.5px'}; text-align: center; font-weight: 700; vertical-align: top; width: 22px;">${qty}</td>
            <td style="padding: 3px 1px; font-size: ${is58mm ? '7px' : '8px'}; text-align: center; color: #64748b; vertical-align: top; width: 24px;">${unit}</td>
            <td style="padding: 3px 1px; font-size: ${is58mm ? '7px' : '8px'}; text-align: center; color: #475569; vertical-align: top; width: 26px;">${gstRate}%</td>
            <td style="padding: 3px 1px; font-size: ${is58mm ? '7px' : '8px'}; text-align: right; color: #475569; vertical-align: top; width: 48px; white-space: nowrap;">₹${taxable.toFixed(2)}</td>
            <td style="padding: 3px 1px; font-size: ${is58mm ? '7px' : '8px'}; text-align: right; color: #475569; vertical-align: top; width: 38px; white-space: nowrap;">₹${rate.toFixed(2)}</td>
            <td style="padding: 3px 1px; font-size: ${is58mm ? '7.5px' : '8.5px'}; text-align: right; font-weight: 800; color: #0f172a; vertical-align: top; width: 50px; white-space: nowrap;">₹${total.toFixed(2)}</td>
          </tr>
        `;
      } else {
        return `
          <tr style="border-bottom: 0.5px solid #e4e4e7;">
            <td style="padding: 4px 1px; font-size: ${is58mm ? '8px' : '9px'}; vertical-align: top; width: 14px;">${idx + 1}</td>
            <td style="padding: 4px 1px; font-size: ${is58mm ? '8.5px' : '9.5px'}; font-weight: 700; color: #18181b; vertical-align: top; word-break: break-word;">
              ${wrappedTitle}
            </td>
            <td style="padding: 4px 1px; font-size: ${is58mm ? '8.5px' : '9.5px'}; text-align: center; font-weight: 700; vertical-align: top; width: 28px;">${qty}</td>
            <td style="padding: 4px 1px; font-size: ${is58mm ? '8px' : '9px'}; text-align: center; color: #64748b; vertical-align: top; width: 30px;">${unit}</td>
            <td style="padding: 4px 1px; font-size: ${is58mm ? '8px' : '9px'}; text-align: right; color: #475569; vertical-align: top; width: 48px; white-space: nowrap;">₹${rate.toFixed(2)}</td>
            <td style="padding: 4px 1px; font-size: ${is58mm ? '8.5px' : '9.5px'}; text-align: right; font-weight: 800; color: #0f172a; vertical-align: top; width: 56px; white-space: nowrap;">₹${total.toFixed(2)}</td>
          </tr>
        `;
      }
    })
    .join('');

  const upiQrUrl = (invoiceSettings.show_upi_qr !== false && company.upi_id)
    ? `https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=0&data=${encodeURIComponent(
        `upi://pay?pa=${company.upi_id}&pn=${encodeURIComponent(companyName)}&am=${data.grand_total.toFixed(2)}&cu=INR`
      )}`
    : '';

  return `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
      <title>${invoiceTitle} - ${data.invoice_number}</title>
      <style>
        @media print {
          @page {
            margin: 0;
            size: ${is58mm ? '58mm auto' : '80mm auto'};
          }
          body {
            margin: 0;
            padding: ${is58mm ? '2px' : '6px'};
            background: #ffffff;
          }
        }
        body {
          font-family: 'Courier New', Courier, monospace;
          margin: 0;
          padding: ${is58mm ? '6px 4px' : '12px 8px'};
          color: #18181b;
          background: #fffef8;
          -webkit-print-color-adjust: exact;
        }
        .invoice-card {
          max-width: ${is58mm ? '300px' : '390px'};
          margin: 0 auto;
          background: #fffef8;
          box-sizing: border-box;
        }
        .header {
          text-align: center;
          padding-bottom: 4px;
        }
        .logo-img {
          max-width: 44px;
          max-height: 44px;
          margin: 0 auto 3px auto;
          display: block;
          object-fit: contain;
        }
        .company-name {
          font-size: ${( (is58mm ? 13 : 15) * fontScale ).toFixed(1)}px;
          font-weight: 900;
          letter-spacing: 0.3px;
          color: #18181b;
          margin: 0 0 2px 0;
          text-transform: uppercase;
        }
        .sub-header {
          font-size: ${( (is58mm ? 9 : 10.5) * fontScale ).toFixed(1)}px;
          color: #52525b;
          margin: 1px 0;
          line-height: 1.3;
        }
        .thermal-dash {
          font-family: 'Courier New', Courier, monospace;
          font-size: ${is58mm ? '9.5px' : '11px'};
          color: #71717a;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          letter-spacing: -0.05em;
          margin: 3px 0;
        }
        .badge {
          display: inline-block;
          font-size: ${is58mm ? '9px' : '10px'};
          font-weight: 800;
          text-transform: uppercase;
          padding: 2px 6px;
          border-radius: 3px;
          margin-top: 4px;
          letter-spacing: 0.5px;
        }
        .meta-grid {
          display: flex;
          justify-content: space-between;
          padding: 6px 0;
          font-size: ${is58mm ? '10.5px' : '12px'};
        }
        .meta-col {
          flex: 1;
        }
        .meta-label {
          font-size: ${is58mm ? '9px' : '10px'};
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
        }
        .meta-val {
          font-size: ${is58mm ? '10.5px' : '12px'};
          font-weight: 800;
          color: #0f172a;
          margin-top: 1px;
        }
        .items-table {
          width: 100%;
          border-collapse: collapse;
          margin: 4px 0;
        }
        .items-table th {
          font-size: ${is58mm ? '7.5px' : '8.5px'};
          font-weight: 800;
          text-transform: uppercase;
          color: #18181b;
          padding: 3px 1px;
          border-bottom: 1px solid #71717a;
        }
        .totals-section {
          margin-top: 6px;
          font-size: ${is58mm ? '10.5px' : '12px'};
        }
        .total-row {
          display: flex;
          justify-content: space-between;
          padding: 1.5px 0;
        }
        .net-total-row {
          display: flex;
          justify-content: space-between;
          font-size: ${is58mm ? '12px' : '14px'};
          font-weight: 900;
          color: #18181b;
          padding: 3px 0;
        }
        .stamp-box {
          border: 1px dashed #71717a;
          padding: 6px;
          margin-top: 8px;
          border-radius: 4px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .upi-box {
          text-align: center;
          margin-top: 8px;
          padding: 6px;
          border: 1px dashed #a1a1aa;
          border-radius: 4px;
        }
        .bank-box {
          margin-top: 6px;
          padding: 4px 6px;
          border: 1px solid #e4e4e7;
          border-radius: 4px;
          font-size: ${is58mm ? '8.5px' : '9.5px'};
          color: #3f3f46;
        }
        .footer {
          text-align: center;
          margin-top: 8px;
          font-size: ${is58mm ? '8px' : '9.5px'};
          color: #71717a;
          border-top: 1px solid #71717a;
          padding-top: 6px;
        }
        .cut-line {
          text-align: center;
          font-size: 8px;
          color: #a1a1aa;
          margin-top: 8px;
          letter-spacing: 0.5px;
        }
      </style>
    </head>
    <body>
      <div class="invoice-card">
        <!-- Center Header -->
        <div class="header">
          ${invoiceSettings.show_logo ? `<img src="${getCompanyLogo(company)}" class="logo-img" alt="Logo" onerror="this.style.display='none';" />` : ''}
          <div class="company-name">${companyName}</div>
          ${company.tagline ? `<div class="sub-header" style="font-weight: 600;">${company.tagline}</div>` : ''}
          ${companyAddress ? `<div class="sub-header">${companyAddress}</div>` : ''}
          <div class="sub-header">
            ${companyGstin ? `<div><strong>GSTIN:</strong> ${companyGstin}</div>` : ''}
            ${companyPhone ? `<div><strong>Phone:</strong> ${companyPhone}</div>` : ''}
          </div>
          ${invoiceSettings.mobile_receipt_header ? `<div class="sub-header" style="font-weight: 700; color: #1e3a8a; margin-top: 2px;">${invoiceSettings.mobile_receipt_header}</div>` : ''}
          <div class="badge" style="background: ${data.is_draft ? '#fef3c7' : '#f4f4f5'}; color: ${data.is_draft ? '#b45309' : '#18181b'}; border: 1px solid ${data.is_draft ? '#fde68a' : '#e4e4e7'};">
            ${invoiceTitle}
          </div>
        </div>

        <div class="thermal-dash">${dividerDouble}</div>

        <!-- Meta Section Arranged as Requested with Gaps -->
        <div style="padding: 2px 0;">
          <div style="font-size: ${is58mm ? '10px' : '11.5px'};">
            <strong>${isOrder ? 'Order:' : 'Invoice:'}</strong> ${data.invoice_number}
          </div>

          <div style="height: 6px;"></div>

          <div style="font-size: ${is58mm ? '9.5px' : '11px'}; color: #18181b;">
            <strong>Date & Time:</strong> ${formattedDate}
          </div>

          <div style="height: 6px;"></div>

          <div style="font-size: ${is58mm ? '10.5px' : '12px'}; color: #18181b;">
            <strong>Customer Name:</strong> ${data.customer_name}
          </div>

          <div style="height: 6px;"></div>

          ${(data.customer_address || data.customer_place) ? `
            <div style="font-size: ${is58mm ? '9.5px' : '11px'}; color: #18181b;">
              <strong>Address:</strong> ${data.customer_address || data.customer_place}
            </div>
          ` : ''}
          ${data.customer_phone ? `
            <div style="font-size: ${is58mm ? '9.5px' : '11px'}; color: #18181b;">
              <strong>Phone:</strong> ${data.customer_phone}
            </div>
          ` : ''}
          ${(hasGst && data.customer_gst) ? `
            <div style="font-size: ${is58mm ? '9.5px' : '11px'}; font-weight: 700; color: #0369a1;">
              <strong>GSTIN:</strong> ${data.customer_gst}
            </div>
          ` : ''}

          <div style="height: 6px;"></div>

          <div style="font-size: ${is58mm ? '9.5px' : '11px'}; color: #18181b;">
            <strong>Salesman:</strong> ${data.salesman_name || 'Sales Representative'}
          </div>
        </div>

        <div class="thermal-dash">${dividerSingle}</div>

        <!-- Items Table -->
        <table class="items-table">
          <thead>
            ${hasGst ? `
              <tr>
                <th style="text-align: left; width: 14px; padding: 2px 1px; font-size: ${is58mm ? '7px' : '8px'};">#</th>
                <th style="text-align: left; padding: 2px 1px; font-size: ${is58mm ? '7px' : '8px'};">Item</th>
                <th style="text-align: center; width: 22px; padding: 2px 1px; font-size: ${is58mm ? '7px' : '8px'};">QTY</th>
                <th style="text-align: center; width: 24px; padding: 2px 1px; font-size: ${is58mm ? '7px' : '8px'};">Unit</th>
                <th style="text-align: center; width: 26px; padding: 2px 1px; font-size: ${is58mm ? '7px' : '8px'};">GST</th>
                <th style="text-align: right; width: 48px; padding: 2px 1px; font-size: ${is58mm ? '7px' : '8px'};">Taxable Value</th>
                <th style="text-align: right; width: 38px; padding: 2px 1px; font-size: ${is58mm ? '7px' : '8px'};">Rate</th>
                <th style="text-align: right; width: 50px; padding: 2px 1px; font-size: ${is58mm ? '7px' : '8px'}; white-space: nowrap;">Total Amount</th>
              </tr>
            ` : `
              <tr>
                <th style="text-align: left; width: 14px; padding: 3px 1px;">#</th>
                <th style="text-align: left; padding: 3px 1px;">Item</th>
                <th style="text-align: center; width: 28px; padding: 3px 1px;">QTY</th>
                <th style="text-align: center; width: 30px; padding: 3px 1px;">Unit</th>
                <th style="text-align: right; width: 48px; padding: 3px 1px;">Rate</th>
                <th style="text-align: right; width: 56px; padding: 3px 1px; white-space: nowrap;">Total Amount</th>
              </tr>
            `}
          </thead>
          <tbody>
            ${itemsRowsHtml}
          </tbody>
        </table>

        <div class="thermal-dash">${dividerSingle}</div>

        <!-- Totals Block with EXACT Requested Labels -->
        <div class="totals-section">
          ${totalDiscount > 0 ? `
            <div class="total-row" style="color: #dc2626;">
              <span>Total Discount:</span>
              <span>- ₹${totalDiscount.toFixed(2)}</span>
            </div>
          ` : ''}
          ${hasGst ? `
            <div class="total-row">
              <span>Total Taxable Value:</span>
              <span>₹${totalTaxable.toFixed(2)}</span>
            </div>
            <div class="total-row" style="color: #0369a1;">
              <span>Central GST (CGST):</span>
              <span>+ ₹${totalCgst.toFixed(2)}</span>
            </div>
            <div class="total-row" style="color: #0369a1;">
              <span>State GST (SGST):</span>
              <span>+ ₹${totalSgst.toFixed(2)}</span>
            </div>
          ` : ''}
          <div class="total-row">
            <span style="color: #475569;">Items: ${data.items.length} (${data.items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0)} Units)</span>
            <span>Sub Total: ₹${subtotalGross.toFixed(2)}</span>
          </div>

          ${(() => {
            const exactTotal = hasGst ? (totalTaxable + totalGst) : (subtotalGross - totalDiscount);
            const roundOffVal = data.round_off != null ? data.round_off : Math.round((data.grand_total - exactTotal) * 100) / 100;
            if (roundOffVal !== 0) {
              return `
                <div class="total-row" style="color: #64748b; font-size: 8.5px;">
                  <span>Round Off (Auto):</span>
                  <span style="color: ${roundOffVal > 0 ? '#15803d' : '#b91c1c'}; font-weight: 700;">
                    ${roundOffVal > 0 ? `+ ₹${roundOffVal.toFixed(2)}` : `- ₹${Math.abs(roundOffVal).toFixed(2)}`}
                  </span>
                </div>
              `;
            }
            return '';
          })()}

          <div class="thermal-dash">${dividerDouble}</div>
          <div class="net-total-row">
            <span>Invoice Grand Total:</span>
            <span>₹${data.grand_total.toFixed(2)}</span>
          </div>
          <div class="thermal-dash">${dividerDouble}</div>

          ${hasGst ? `
            <table style="width: 100%; border-collapse: collapse; margin: 4px 0; font-size: ${is58mm ? '8.5px' : '9.5px'};">
              <thead>
                <tr style="border-top: 1px dashed #71717a; border-bottom: 1px dashed #71717a;">
                  <th style="text-align: left; padding: 2px 1px; font-weight: 800;">GST%</th>
                  <th style="text-align: right; padding: 2px 1px; font-weight: 800;">TaxableAmt</th>
                  <th style="text-align: right; padding: 2px 1px; font-weight: 800;">CGSTAmt</th>
                  <th style="text-align: right; padding: 2px 1px; font-weight: 800;">SGSTAmt</th>
                </tr>
              </thead>
              <tbody>
                ${ratesMap.size > 0 ? Array.from(ratesMap.entries()).map(([gRate, val]) => `
                  <tr>
                    <td style="text-align: left; padding: 2px 1px;">GST ${gRate}%</td>
                    <td style="text-align: right; padding: 2px 1px;">₹${val.taxable.toFixed(2)}</td>
                    <td style="text-align: right; padding: 2px 1px;">₹${val.cgst.toFixed(2)}</td>
                    <td style="text-align: right; padding: 2px 1px;">₹${val.sgst.toFixed(2)}</td>
                  </tr>
                `).join('') : `
                  <tr>
                    <td style="text-align: left; padding: 2px 1px;">GST ${subtotalGross > 0 ? ((totalGst / (totalTaxable || 1)) * 100).toFixed(0) : '0'}%</td>
                    <td style="text-align: right; padding: 2px 1px;">₹${totalTaxable.toFixed(2)}</td>
                    <td style="text-align: right; padding: 2px 1px;">₹${totalCgst.toFixed(2)}</td>
                    <td style="text-align: right; padding: 2px 1px;">₹${totalSgst.toFixed(2)}</td>
                  </tr>
                `}
              </tbody>
            </table>
            <div class="thermal-dash">${dividerSingle}</div>
          ` : ''}

          <div class="total-row" style="color: #059669; font-weight: 700;">
            <span>Amount Received (${data.payment_mode || 'Cash'}):</span>
            <span>₹${data.paid_amount.toFixed(2)}</span>
          </div>
          <div class="total-row" style="color: ${data.balance_due > 0 ? '#dc2626' : '#52525b'}; font-weight: 800;">
            <span>Balance Outstanding:</span>
            <span>₹${data.balance_due.toFixed(2)}</span>
          </div>

          <div style="text-align: center; margin-top: 5px; font-weight: 900; font-size: ${is58mm ? '9.5px' : '10.5px'}; color: ${statusColor};">
            [ ${paymentStatusText} ]
          </div>
        </div>

        <!-- Status Box -->
        <div class="stamp-box">
          <div>
            <div style="font-size: ${is58mm ? '8.5px' : '9.5px'}; color: #64748b; font-weight: 700; text-transform: uppercase;">Payment Status</div>
            <div style="font-size: ${is58mm ? '11px' : '12.5px'}; font-weight: 900; color: ${statusColor};">
              ${paymentStatusText}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: ${is58mm ? '8.5px' : '9.5px'}; color: #64748b; font-weight: 700; text-transform: uppercase;">Mode</div>
            <div style="font-size: ${is58mm ? '10.5px' : '12px'}; font-weight: 800; color: #1e293b;">
              ${data.payment_mode || 'Cash'}
            </div>
          </div>
        </div>

        ${data.notes ? `<p style="font-size: ${is58mm ? '9.5px' : '11px'}; color: #64748b; margin: 6px 0 0 0; font-style: italic;">Note: ${data.notes}</p>` : ''}

        <!-- UPI QR Code Block -->
        ${upiQrUrl ? `
          <div class="upi-box">
            <div style="font-size: ${is58mm ? '8.5px' : '10px'}; font-weight: 800; color: #475569; text-transform: uppercase; margin-bottom: 4px;">
              Scan & Pay via UPI
            </div>
            <img src="${upiQrUrl}" alt="UPI QR" style="width: ${is58mm ? '90px' : '110px'}; height: ${is58mm ? '90px' : '110px'}; margin: 0 auto; display: block;" onerror="this.style.display='none';" />
            <div style="font-size: ${is58mm ? '10px' : '11.5px'}; font-weight: 900; color: #0f172a; margin-top: 4px;">
              ${company.upi_id}
            </div>
          </div>
        ` : ''}

        <!-- Bank Details Block -->
        ${invoiceSettings.show_bank_details && (company.bank_name || company.account_number) ? `
          <div class="bank-box">
            <div style="font-weight: 800; text-transform: uppercase; color: #64748b; font-size: ${is58mm ? '8px' : '9.5px'}; margin-bottom: 2px;">
              Bank Payment Details
            </div>
            ${company.bank_name ? `<div><strong>Bank:</strong> ${company.bank_name}</div>` : ''}
            ${company.account_number ? `<div><strong>A/C No:</strong> ${company.account_number}</div>` : ''}
            ${company.ifsc_code ? `<div><strong>IFSC:</strong> ${company.ifsc_code}${company.bank_branch ? ` (${company.bank_branch})` : ''}</div>` : ''}
            ${company.account_holder ? `<div><strong>Beneficiary:</strong> ${company.account_holder}</div>` : ''}
          </div>
        ` : ''}

        <!-- Terms & Conditions -->
        ${invoiceSettings.show_terms && company.terms_and_conditions ? `
          <div style="margin-top: 8px; font-size: ${is58mm ? '8px' : '9px'}; color: #64748b; line-height: 1.35; border-top: 1px dashed #cbd5e1; padding-top: 4px;">
            <div style="font-weight: 700; text-transform: uppercase; color: #475569; margin-bottom: 2px;">Terms & Conditions:</div>
            ${company.terms_and_conditions.split('\n').filter(Boolean).map(line => `<div>${line}</div>`).join('')}
          </div>
        ` : ''}

        <!-- Footer -->
        <div class="footer">
          <p style="margin: 0; font-weight: 700;">${invoiceSettings.mobile_receipt_footer || '*** THANK YOU FOR YOUR BUSINESS! ***'}</p>
          <p style="margin: 2px 0 0 0;">${invoiceSettings.mobile_receipt_tagline ? `*** ${invoiceSettings.mobile_receipt_tagline.toUpperCase()} ***` : '*** POWERED BY SOFTAIR SFA ***'}</p>
        </div>

        <!-- Thermal Paper Cut Guide -->
        <div class="cut-line">
          - - - - - - - - - - - [ CUT HERE ] - - - - - - - - - - -
        </div>
        ${'<br/>'.repeat(printerSettings.feedLines || 2)}
      </div>
    </body>
  </html>
  `;
}

/**
 * Universal HTML generator (defaults strictly to Thermal on Mobile)
 */
export function generateInvoiceHtml(data: MobileInvoiceData, format: 'thermal' | 'a4' = 'thermal'): string {
  if (format === 'a4') {
    return generateA4InvoiceHtml(data);
  }
  return generateThermalInvoiceHtml(data);
}

/**
 * Print invoice to printer (defaults to Thermal POS printer with 1-touch direct printing)
 */
export async function printInvoice(data: MobileInvoiceData, format?: 'thermal' | 'a4'): Promise<void> {
  const printerSettings = getPrinterSettings();
  const targetFormat = format || (printerSettings.paperSize === 'A4' ? 'a4' : 'thermal');

  // Direct In-App Bluetooth ESC/POS printing: Instant 1-touch, no RawBT watermark, no external app redirects
  if (targetFormat !== 'a4') {
    if (Platform.OS === 'android') {
      // NEVER redirect to 3rd party apps (RawBT, Print Spooler) on Android thermal receipts
      if (!isDirectBluetoothSupported()) {
        throw new Error('Direct In-App Bluetooth printing is supported in the installed Android APK build. Please install the APK preview build to print directly without external apps.');
      }
      await ensureOrAutoConnectPrinter();
      await printInvoiceDirectBluetooth(data);
      return;
    }

    if (
      printerSettings.directPrint &&
      printerSettings.printerType === 'bluetooth' &&
      printerSettings.printerAddress &&
      isDirectBluetoothSupported()
    ) {
      await printInvoiceDirectBluetooth(data);
      return;
    }
  }

  const html = targetFormat === 'a4' ? generateA4InvoiceHtml(data) : generateThermalInvoiceHtml(data);
  const is58mm = printerSettings.paperSize === '58mm';

  let printerUrl = getDirectPrinterUrl();

  // If on iOS and direct printing is enabled (default) but no direct AirPrint/thermal printer URL is saved yet:
  // Instead of showing the native print options sheet with image preview, prompt user with dedicated printer selector
  if (Platform.OS === 'ios' && !printerUrl && printerSettings.directPrint) {
    try {
      const selected = await pairDirectPrinter();
      if (selected && selected.url) {
        printerUrl = selected.url;
      }
    } catch (pickerErr: any) {
      const msg = (pickerErr?.message || pickerErr?.reason || pickerErr?.toString() || '').toLowerCase();
      if (msg.includes('cancel') || msg.includes('dismiss') || msg.includes('picker')) {
        const err = new Error('Printer selection canceled.');
        err.name = 'PrintCancelled';
        throw err;
      }
    }
  }

  const printOptions: Print.PrintOptions = {
    html,
    width: targetFormat === 'a4' ? 595 : (is58mm ? 164 : 226),
  };

  if (printerUrl) {
    printOptions.printerUrl = printerUrl;
  }

  try {
    await Print.printAsync(printOptions);
  } catch (e: any) {
    const msg = (e?.message || e?.reason || e?.toString() || '').toLowerCase();

    // If the saved printer is offline / unavailable, allow one quick re-pairing
    if ((msg.includes('not available') || msg.includes('provided printer')) && Platform.OS === 'ios') {
      try {
        const reselected = await pairDirectPrinter();
        if (reselected && reselected.url) {
          printOptions.printerUrl = reselected.url;
          await Print.printAsync(printOptions);
          return;
        }
      } catch (retryErr) {
        // proceed to default error handler
      }
    }

    if (
      msg.includes('complete') ||
      msg.includes('incomplete') ||
      msg.includes('cancel') ||
      msg.includes('dismiss') ||
      msg.includes('abort') ||
      msg.includes('picker')
    ) {
      const err = new Error('The print operation was canceled.');
      err.name = 'PrintCancelled';
      throw err;
    }
    throw e;
  }
}

/**
 * Share invoice as Thermal PDF document (matches Web Settings Thermal template)
 */
export async function shareInvoicePdf(data: MobileInvoiceData, format: 'thermal' | 'a4' = 'thermal'): Promise<void> {
  const html = format === 'a4' ? generateA4InvoiceHtml(data) : generateThermalInvoiceHtml(data);
  const { uri } = await Print.printToFileAsync({ html });
  const isAvailable = await Sharing.isAvailableAsync();
  if (isAvailable) {
    await Sharing.shareAsync(uri, {
      UTI: '.pdf',
      mimeType: 'application/pdf',
      dialogTitle: `Share Invoice ${data.invoice_number}`,
    });
  } else {
    throw new Error('Sharing is not available on this device');
  }
}
