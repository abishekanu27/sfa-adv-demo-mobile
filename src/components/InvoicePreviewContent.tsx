import React from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { MobileInvoiceData, formatItemTitle } from '../services/invoiceService';
import { getCompanyProfile } from '../database/db';
import { getCompanyLogo } from '../utils/companyBranding';

interface InvoicePreviewContentProps {
  invoice: MobileInvoiceData;
}

/**
 * Mobile Invoice Preview: Exclusively renders in Thermal POS Receipt format,
 * with columns (#, Item, QTY, UNIT, Rate, Amount)
 * and exact financial summary labels matching the Web Settings GST template.
 */
export default function InvoicePreviewContent({ invoice }: InvoicePreviewContentProps) {
  const company = invoice.company || getCompanyProfile();
  const invoiceSettings = company?.invoice_settings || {};
  const thermalWidth = invoiceSettings.thermal_width || company?.print_templates?.thermalWidth || '80mm';
  const is58mm = thermalWidth === '58mm';

  const isOrder = invoice.order_type === 'order';
  const isReturn = invoice.order_type === 'return';

  const custGst = (invoice.customer_gst || '').trim();
  const hasGst = Boolean(
    invoice.has_gst ||
    (custGst.length >= 3 && !['URP', 'NON-GST', 'NIL', 'NONE', 'UNDEFINED', 'NULL'].includes(custGst.toUpperCase()))
  );

  let paymentStatusText = '';
  let statusColor = '#047857';

  if (isOrder) {
    if (invoice.paid_amount > 0) {
      paymentStatusText = invoice.balance_due <= 0 ? 'ORDER PAID IN FULL' : `ADVANCE PAID (₹${invoice.paid_amount.toFixed(2)})`;
      statusColor = '#047857';
    } else {
      paymentStatusText = 'NO ADVANCE • DUE ON DELIVERY';
      statusColor = '#b45309';
    }
  } else if (isReturn) {
    paymentStatusText = 'PRODUCT RESTOCKED / RETURN';
    statusColor = '#b45309';
  } else {
    const isPaid = invoice.balance_due <= 0;
    const isPartial = invoice.paid_amount > 0 && invoice.balance_due > 0;
    paymentStatusText = isPaid ? 'PAID IN FULL' : isPartial ? 'PARTIAL PAYMENT' : 'CREDIT SALE';
    statusColor = isPaid ? '#047857' : isPartial ? '#b45309' : '#b91c1c';
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

  const defaultTitle = isOrder
    ? 'ADVANCE BOOKING ORDER RECEIPT'
    : isReturn
    ? 'PRODUCT RETURN RECEIPT'
    : (hasGst ? 'INVOICE' : 'ESTIMATE');

  const invoiceTitle = invoice.is_draft
    ? (isOrder ? 'PROVISIONAL BOOKING ORDER' : (hasGst ? 'PROVISIONAL INVOICE' : 'PROVISIONAL ESTIMATE'))
    : defaultTitle;

  const monoFont = Platform.OS === 'ios' ? 'Courier' : 'monospace';

  const dividerDoubleText = is58mm
    ? '=============================='
    : '========================================';
  const dividerSingleText = is58mm
    ? '------------------------------'
    : '----------------------------------------';

  const upiQrUrl = (invoiceSettings.show_upi_qr !== false && company.upi_id)
    ? `https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=0&data=${encodeURIComponent(
        `upi://pay?pa=${company.upi_id}&pn=${encodeURIComponent(companyName)}&am=${invoice.grand_total.toFixed(2)}&cu=INR`
      )}`
    : '';

function wrapText13(text: string, maxLen = 13): string {
  if (!text) return '';
  const words = text.split(/\s+/);
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
  return lines.join('\n');
}

  const totalDiscount = invoice.discount_amount != null
    ? Number(invoice.discount_amount)
    : 0;

  const subtotalGross = invoice.subtotal_gross != null
    ? Number(invoice.subtotal_gross)
    : invoice.items.reduce((sum, item) => {
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
    invoice.items.forEach(it => {
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

  const totalTaxable = invoice.total_taxable != null
    ? (invoice.total_taxable < subtotalGross ? invoice.total_taxable : computedTaxable)
    : computedTaxable;

  const totalCgst = invoice.total_cgst != null ? invoice.total_cgst : computedCgst;
  const totalSgst = invoice.total_sgst != null ? invoice.total_sgst : computedSgst;
  const totalGst = invoice.total_gst != null ? invoice.total_gst : (totalCgst + totalSgst);

  return (
    <View style={styles.container}>
      {/* THERMAL ROLL PAPER (Matches Settings Thermal Template Exactly) */}
      <View style={[styles.thermalPaper, { width: is58mm ? 300 : '100%', maxWidth: is58mm ? 320 : 390 }]}>
        
        {/* 1. Thermal Center Header */}
        <View style={{ alignItems: 'center' }}>
          {invoiceSettings.show_logo !== false ? (
            <Image
              source={{ uri: getCompanyLogo(company) }}
              style={{ width: 48, height: 48, marginBottom: 4 }}
              contentFit="contain"
            />
          ) : null}
          <Text style={[styles.thermalText, { fontSize: is58mm ? 13 : 15, fontWeight: '900', textAlign: 'center' }]}>
            {companyName}
          </Text>
          {companyAddress ? (
            <Text style={[styles.thermalText, { fontSize: is58mm ? 9 : 10, color: '#52525b', textAlign: 'center', marginTop: 1 }]}>
              {companyAddress}
            </Text>
          ) : null}
          {companyGstin ? (
            <Text style={[styles.thermalText, { fontSize: is58mm ? 9 : 10, color: '#52525b', textAlign: 'center' }]}>
              GSTIN: {companyGstin}
            </Text>
          ) : null}
          {companyPhone ? (
            <Text style={[styles.thermalText, { fontSize: is58mm ? 9 : 10, color: '#52525b', textAlign: 'center' }]}>
              Phone: {companyPhone}
            </Text>
          ) : null}
          {invoiceSettings.mobile_receipt_header ? (
            <Text style={[styles.thermalText, { fontSize: is58mm ? 9 : 10, fontWeight: '700', color: '#1e3a8a', textAlign: 'center', marginTop: 1 }]}>
              {invoiceSettings.mobile_receipt_header}
            </Text>
          ) : null}
          <View style={styles.thermalTitleBadge}>
            <Text style={[styles.thermalText, { fontSize: is58mm ? 9.5 : 10.5, fontWeight: '900', color: '#18181b' }]}>
              {invoiceTitle}
            </Text>
          </View>
        </View>

        {/* Double Dash Line */}
        <Text style={[styles.thermalText, styles.thermalDivider]}>{dividerDoubleText}</Text>

        {/* 2. Thermal Meta Arranged as Requested with Gaps */}
        <View style={{ gap: 6, paddingVertical: 2 }}>
          <Text style={[styles.thermalText, { fontWeight: '800', fontSize: is58mm ? 10 : 11 }]}>
            {isOrder ? 'Order:' : 'Invoice:'} {invoice.invoice_number}
          </Text>

          <Text style={[styles.thermalText, { fontSize: is58mm ? 9.5 : 10.5, color: '#18181b' }]}>
            Date & Time: {invoice.invoice_date || 'Today'}
          </Text>

          <Text style={[styles.thermalText, { fontWeight: '800', fontSize: is58mm ? 10 : 11, color: '#18181b' }]}>
            Customer Name: {invoice.customer_name}
          </Text>

          <View style={{ gap: 2 }}>
            {(invoice.customer_address || invoice.customer_place) ? (
              <Text style={[styles.thermalText, { fontSize: is58mm ? 9 : 10, color: '#18181b' }]}>
                Address: {invoice.customer_address || invoice.customer_place}
              </Text>
            ) : null}
            {invoice.customer_phone ? (
              <Text style={[styles.thermalText, { fontSize: is58mm ? 9 : 10, color: '#18181b' }]}>
                Phone: {invoice.customer_phone}
              </Text>
            ) : null}
            {invoice.customer_gst && invoice.customer_gst.trim() ? (
              <Text style={[styles.thermalText, { fontWeight: '800', color: '#1d4ed8', fontSize: is58mm ? 9 : 10 }]}>
                GSTIN: {invoice.customer_gst}
              </Text>
            ) : null}
          </View>

          <Text style={[styles.thermalText, { fontSize: is58mm ? 9.5 : 10.5, color: '#18181b' }]}>
            Salesman: {invoice.salesman_name || 'Sales Representative'}
          </Text>
        </View>

        {/* Single Dash Line */}
        <Text style={[styles.thermalText, styles.thermalDivider]}>{dividerSingleText}</Text>

        {/* 3. Items Table Header */}
        {hasGst ? (
          <View style={{ flexDirection: 'row', paddingVertical: 2.5, borderBottomWidth: 1, borderBottomColor: '#71717a', alignItems: 'center' }}>
            <Text style={[styles.thermalText, { fontWeight: '800', width: 14, fontSize: 7.5, flexShrink: 0 }]}>#</Text>
            <Text style={[styles.thermalText, { fontWeight: '800', flex: 1, minWidth: 50, fontSize: 7.5 }]}>Item</Text>
            <Text style={[styles.thermalText, { fontWeight: '800', width: 22, textAlign: 'center', fontSize: 7.5, flexShrink: 0 }]}>QTY</Text>
            <Text style={[styles.thermalText, { fontWeight: '800', width: 24, textAlign: 'center', fontSize: 7.5, flexShrink: 0 }]}>Unit</Text>
            <Text style={[styles.thermalText, { fontWeight: '800', width: 26, textAlign: 'center', fontSize: 7.5, flexShrink: 0 }]}>GST</Text>
            <Text style={[styles.thermalText, { fontWeight: '800', width: 48, textAlign: 'right', fontSize: 7.5, flexShrink: 0 }]}>Taxable Value</Text>
            <Text style={[styles.thermalText, { fontWeight: '800', width: 38, textAlign: 'right', fontSize: 7.5, flexShrink: 0 }]}>Rate</Text>
            <Text style={[styles.thermalText, { fontWeight: '800', width: 50, textAlign: 'right', fontSize: 7.5, flexShrink: 0 }]}>Total Amount</Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: '#71717a', alignItems: 'center' }}>
            <Text style={[styles.thermalText, { fontWeight: '800', width: 16, fontSize: 8.5, flexShrink: 0 }]}>#</Text>
            <Text style={[styles.thermalText, { fontWeight: '800', flex: 1, minWidth: 65, fontSize: 8.5 }]}>Item</Text>
            <Text style={[styles.thermalText, { fontWeight: '800', width: 28, textAlign: 'center', fontSize: 8.5, flexShrink: 0 }]}>QTY</Text>
            <Text style={[styles.thermalText, { fontWeight: '800', width: 30, textAlign: 'center', fontSize: 8.5, flexShrink: 0 }]}>Unit</Text>
            <Text style={[styles.thermalText, { fontWeight: '800', width: 48, textAlign: 'right', fontSize: 8.5, flexShrink: 0 }]}>Rate</Text>
            <Text style={[styles.thermalText, { fontWeight: '800', width: 56, textAlign: 'right', fontSize: 8.5, flexShrink: 0 }]}>Total Amount</Text>
          </View>
        )}

        {/* Items Rows */}
        {invoice.items.map((item, idx) => {
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
          const wrappedTitle = wrapText13(itemTitle);

          if (hasGst) {
            return (
              <View key={idx} style={{ flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: '#e4e4e7', alignItems: 'flex-start' }}>
                <Text style={[styles.thermalText, { width: 14, fontSize: 7, flexShrink: 0 }]}>{idx + 1}</Text>
                <Text style={[styles.thermalText, { flex: 1, minWidth: 50, fontSize: 7.5, fontWeight: '700', color: '#18181b', paddingRight: 2 }]}>
                  {wrappedTitle}
                </Text>
                <Text style={[styles.thermalText, { width: 22, textAlign: 'center', fontWeight: '800', fontSize: 7.5, color: '#18181b', flexShrink: 0 }]}>
                  {qty}
                </Text>
                <Text style={[styles.thermalText, { width: 24, textAlign: 'center', fontSize: 7, color: '#64748b', flexShrink: 0 }]}>
                  {unit}
                </Text>
                <Text style={[styles.thermalText, { width: 26, textAlign: 'center', color: '#475569', fontSize: 7, flexShrink: 0 }]}>
                  {gstRate}%
                </Text>
                <Text style={[styles.thermalText, { width: 48, textAlign: 'right', color: '#475569', fontSize: 7, flexShrink: 0 }]}>
                  ₹{taxable.toFixed(2)}
                </Text>
                <Text style={[styles.thermalText, { width: 38, textAlign: 'right', color: '#475569', fontSize: 7, flexShrink: 0 }]}>
                  ₹{rate.toFixed(2)}
                </Text>
                <Text style={[styles.thermalText, { width: 50, textAlign: 'right', fontWeight: '800', fontSize: 7.5, color: '#0f172a', flexShrink: 0 }]}>
                  ₹{total.toFixed(2)}
                </Text>
              </View>
            );
          } else {
            return (
              <View key={idx} style={{ flexDirection: 'row', paddingVertical: 3.5, borderBottomWidth: 0.5, borderBottomColor: '#e4e4e7', alignItems: 'flex-start' }}>
                <Text style={[styles.thermalText, { width: 16, fontSize: 8, flexShrink: 0 }]}>{idx + 1}</Text>
                <Text style={[styles.thermalText, { flex: 1, minWidth: 65, fontSize: 8.5, fontWeight: '700', color: '#18181b', paddingRight: 3 }]}>
                  {wrappedTitle}
                </Text>
                <Text style={[styles.thermalText, { width: 28, textAlign: 'center', fontWeight: '800', fontSize: 8.5, color: '#18181b', flexShrink: 0 }]}>
                  {qty}
                </Text>
                <Text style={[styles.thermalText, { width: 30, textAlign: 'center', fontSize: 8, color: '#64748b', flexShrink: 0 }]}>
                  {unit}
                </Text>
                <Text style={[styles.thermalText, { width: 48, textAlign: 'right', color: '#475569', fontSize: 8, flexShrink: 0 }]}>
                  ₹{rate.toFixed(2)}
                </Text>
                <Text style={[styles.thermalText, { width: 56, textAlign: 'right', fontWeight: '800', fontSize: 8.5, color: '#0f172a', flexShrink: 0 }]}>
                  ₹{total.toFixed(2)}
                </Text>
              </View>
            );
          }
        })}

        {/* Single Dash Line */}
        <Text style={[styles.thermalText, styles.thermalDivider]}>{dividerSingleText}</Text>

        {/* 4. Totals Block with EXACT Requested Labels */}
        <View style={{ gap: 2.5, marginTop: 2 }}>
          {totalDiscount > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[styles.thermalText, { color: '#dc2626', fontSize: 9.5 }]}>Total Discount:</Text>
              <Text style={[styles.thermalText, { color: '#dc2626', fontWeight: '700', fontSize: 9.5 }]}>- ₹{totalDiscount.toFixed(2)}</Text>
            </View>
          )}
          {hasGst && (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[styles.thermalText, { color: '#3f3f46', fontSize: 9.5 }]}>Total Taxable value:</Text>
                <Text style={[styles.thermalText, { fontWeight: '700', fontSize: 9.5 }]}>₹{totalTaxable.toFixed(2)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[styles.thermalText, { color: '#0369a1', fontSize: 9.5 }]}>CGST:</Text>
                <Text style={[styles.thermalText, { color: '#0369a1', fontWeight: '700', fontSize: 9.5 }]}>+ ₹{totalCgst.toFixed(2)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[styles.thermalText, { color: '#0369a1', fontSize: 9.5 }]}>SGST:</Text>
                <Text style={[styles.thermalText, { color: '#0369a1', fontWeight: '700', fontSize: 9.5 }]}>+ ₹{totalSgst.toFixed(2)}</Text>
              </View>
            </>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[styles.thermalText, { color: '#475569', fontSize: 9 }]}>
              Items: {invoice.items.length} ({invoice.items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0)} Units):
            </Text>
            <Text style={[styles.thermalText, { fontWeight: '700', fontSize: 9.5 }]}>
              Sub total: ₹{subtotalGross.toFixed(2)}
            </Text>
          </View>

          {(() => {
            const exactTotal = hasGst ? (totalTaxable + totalGst) : (subtotalGross - totalDiscount);
            const roundOffVal = invoice.round_off != null ? invoice.round_off : Math.round((invoice.grand_total - exactTotal) * 100) / 100;
            if (roundOffVal !== 0) {
              return (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={[styles.thermalText, { color: '#64748b', fontSize: 8.5 }]}>Round Off (Auto):</Text>
                  <Text style={[styles.thermalText, { color: roundOffVal > 0 ? '#047857' : '#b91c1c', fontWeight: '700', fontSize: 8.5 }]}>
                    {roundOffVal > 0 ? `+ ₹${roundOffVal.toFixed(2)}` : `- ₹${Math.abs(roundOffVal).toFixed(2)}`}
                  </Text>
                </View>
              );
            }
            return null;
          })()}

          {/* Double Dash Line before Grand Total */}
          <Text style={[styles.thermalText, styles.thermalDivider]}>{dividerDoubleText}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 1 }}>
            <Text style={[styles.thermalText, { fontWeight: '900', fontSize: 12, color: '#18181b' }]}>
              {isOrder ? 'Order Grand Total:' : 'Invoice Grand Total:'}
            </Text>
            <Text style={[styles.thermalText, { fontWeight: '900', fontSize: 13.5, color: '#18181b' }]}>
              ₹{invoice.grand_total.toFixed(2)}
            </Text>
          </View>
          {/* Double Dash Line after Grand Total */}
          <Text style={[styles.thermalText, styles.thermalDivider]}>{dividerDoubleText}</Text>

          {/* GST breakdown table matching the receipt */}
          {hasGst && (
            <View style={{ marginVertical: 4, paddingVertical: 2, borderTopWidth: 1, borderTopColor: '#71717a', borderBottomWidth: 1, borderBottomColor: '#71717a' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 2, borderBottomWidth: 0.5, borderBottomColor: '#e4e4e7' }}>
                <Text style={[styles.thermalText, { fontSize: 8.5, fontWeight: '800', width: '22%' }]}>GST%</Text>
                <Text style={[styles.thermalText, { fontSize: 8.5, fontWeight: '800', width: '26%', textAlign: 'right' }]}>TaxableAmt</Text>
                <Text style={[styles.thermalText, { fontSize: 8.5, fontWeight: '800', width: '26%', textAlign: 'right' }]}>CGSTAmt</Text>
                <Text style={[styles.thermalText, { fontSize: 8.5, fontWeight: '800', width: '26%', textAlign: 'right' }]}>SGSTAmt</Text>
              </View>
              {ratesMap.size > 0 ? Array.from(ratesMap.entries()).map(([gRate, val], k) => (
                <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 2 }}>
                  <Text style={[styles.thermalText, { fontSize: 8.5, width: '22%' }]}>GST {gRate}%</Text>
                  <Text style={[styles.thermalText, { fontSize: 8.5, width: '26%', textAlign: 'right' }]}>₹{val.taxable.toFixed(2)}</Text>
                  <Text style={[styles.thermalText, { fontSize: 8.5, width: '26%', textAlign: 'right' }]}>₹{val.cgst.toFixed(2)}</Text>
                  <Text style={[styles.thermalText, { fontSize: 8.5, width: '26%', textAlign: 'right' }]}>₹{val.sgst.toFixed(2)}</Text>
                </View>
              )) : (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 2 }}>
                  <Text style={[styles.thermalText, { fontSize: 8.5, width: '22%' }]}>GST {subtotalGross > 0 ? ((totalGst / (totalTaxable || 1)) * 100).toFixed(0) : '0'}%</Text>
                  <Text style={[styles.thermalText, { fontSize: 8.5, width: '26%', textAlign: 'right' }]}>₹{totalTaxable.toFixed(2)}</Text>
                  <Text style={[styles.thermalText, { fontSize: 8.5, width: '26%', textAlign: 'right' }]}>₹{totalCgst.toFixed(2)}</Text>
                  <Text style={[styles.thermalText, { fontSize: 8.5, width: '26%', textAlign: 'right' }]}>₹{totalSgst.toFixed(2)}</Text>
                </View>
              )}
            </View>
          )}

          {/* Amount Received & Balance Outstanding */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[styles.thermalText, { color: '#047857', fontWeight: '700', fontSize: 9.5 }]}>
              {isOrder ? 'Advance Received' : 'Amount Received'} ({invoice.payment_mode || 'Cash'}):
            </Text>
            <Text style={[styles.thermalText, { color: '#047857', fontWeight: '800', fontSize: 9.5 }]}>
              ₹{invoice.paid_amount.toFixed(2)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[styles.thermalText, { color: invoice.balance_due > 0 ? '#b91c1c' : '#52525b', fontWeight: '700', fontSize: 9.5 }]}>
              Balance Outstanding:
            </Text>
            <Text style={[styles.thermalText, { color: invoice.balance_due > 0 ? '#b91c1c' : '#52525b', fontWeight: '900', fontSize: 10 }]}>
              ₹{invoice.balance_due.toFixed(2)}
            </Text>
          </View>

          <View style={{ alignItems: 'center', marginTop: 4 }}>
            <Text style={[styles.thermalText, { fontSize: is58mm ? 9.5 : 10.5, fontWeight: '900', color: statusColor }]}>
              [ {paymentStatusText} ]
            </Text>
          </View>
        </View>

        {/* 5. UPI Pay Block */}
        {!isOrder && upiQrUrl ? (
          <View style={{ alignItems: 'center', marginTop: 8, padding: 6, borderWidth: 1, borderStyle: 'dashed', borderColor: '#a1a1aa', borderRadius: 4 }}>
            <Image source={{ uri: upiQrUrl }} style={{ width: is58mm ? 76 : 90, height: is58mm ? 76 : 90 }} />
            <Text style={[styles.thermalText, { fontWeight: '900', fontSize: is58mm ? 9 : 10, marginTop: 2 }]}>
              UPI PAY: {company.upi_id}
            </Text>
            <Text style={[styles.thermalText, { fontSize: 8, color: '#71717a' }]}>
              Scan to pay ₹{invoice.grand_total.toFixed(2)}
            </Text>
          </View>
        ) : null}

        {/* 6. Bank Details (if enabled in Web Settings) */}
        {invoiceSettings.show_bank_details && (company.bank_name || company.account_number) ? (
          <View style={{ marginTop: 6, padding: 4, borderWidth: 1, borderColor: '#e4e4e7', borderRadius: 4 }}>
            <Text style={[styles.thermalText, { fontSize: 8.5, fontWeight: '800', color: '#52525b' }]}>
              BANK DETAILS:
            </Text>
            {company.bank_name ? (
              <Text style={[styles.thermalText, { fontSize: 8.5, color: '#27272a' }]}>
                Bank: {company.bank_name}
              </Text>
            ) : null}
            {company.account_number ? (
              <Text style={[styles.thermalText, { fontSize: 8.5, color: '#27272a' }]}>
                A/C: {company.account_number}
              </Text>
            ) : null}
            {company.ifsc_code ? (
              <Text style={[styles.thermalText, { fontSize: 8.5, color: '#27272a' }]}>
                IFSC: {company.ifsc_code} {company.bank_branch ? `(${company.bank_branch})` : ''}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* 7. Terms & Conditions */}
        {invoiceSettings.show_terms && company.terms_and_conditions ? (
          <View style={{ marginTop: 6, paddingTop: 4, borderTopWidth: 0.5, borderTopColor: '#d4d4d8' }}>
            <Text style={[styles.thermalText, { fontSize: 8, fontWeight: '700', color: '#52525b' }]}>
              TERMS:
            </Text>
            <Text style={[styles.thermalText, { fontSize: 7.5, color: '#71717a', lineHeight: 11 }]}>
              {company.terms_and_conditions.split('\n')[0]}
            </Text>
          </View>
        ) : null}

        {/* 8. Thermal Footer (Exact Web Design) */}
        <View style={{ alignItems: 'center', marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#71717a' }}>
          <Text style={[styles.thermalText, { fontWeight: '800', fontSize: is58mm ? 8.5 : 9.5 }]}>
            {invoiceSettings.mobile_receipt_footer || 'THANK YOU FOR YOUR BUSINESS!'}
          </Text>
          <Text style={[styles.thermalText, { color: '#71717a', fontSize: is58mm ? 7.5 : 8.5, marginTop: 1 }]}>
            {invoiceSettings.mobile_receipt_tagline ? `*** ${invoiceSettings.mobile_receipt_tagline.toUpperCase()} ***` : '*** POWERED BY SOFTAIR SFA ***'}
          </Text>
        </View>

        {/* 9. Thermal Cut Guide */}
        <Text style={[styles.thermalText, { color: '#a1a1aa', textAlign: 'center', fontSize: 8, marginTop: 6, letterSpacing: 0.5 }]}>
          - - - - - - - - - - - [ CUT HERE ] - - - - - - - - - - -
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
  },
  thermalPaper: {
    backgroundColor: '#fffef8',
    borderColor: '#e4e4e7',
    borderWidth: 1,
    borderRadius: 4,
    paddingVertical: 14,
    paddingHorizontal: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  thermalText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#18181b',
  },
  thermalTitleBadge: {
    marginTop: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    backgroundColor: '#f4f4f5',
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  thermalDivider: {
    fontSize: 10,
    color: '#71717a',
    textAlign: 'center',
    letterSpacing: -0.5,
    marginVertical: 4,
  },
});
