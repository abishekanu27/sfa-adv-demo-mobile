import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  Dimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getCollectionsReportData,
  getRouteWiseSalesReportData,
  getPaymentsReportData,
  getOutstandingReportData,
  getExpensesReportData,
  getOrdersReportData,
  getItemsWiseSalesReportData,
  getCustomersWiseSalesReportData,
  getClosingStockReportData,
  getAssignedRoute,
  getCompanyProfile,
  CollectionReportItem,
  RouteWiseSaleItem,
  PaymentReportItem,
  OutstandingReportItem,
  ExpenseReportItem,
  OrderReportItem,
  ItemWiseSaleItem,
  CustomerWiseSaleItem,
  ClosingStockReportItem,
} from '../database/db';
import { syncDatabase } from '../database/sync';
import { useAuth } from '../context/AuthContext';
import {
  ReportType,
  ReportPrintOptions,
  printReportDocument,
  shareReportPdfDocument,
  formatINR,
  ThermalWidth,
} from '../services/reportPrintService';
import { abortActivePrint, getPrinterSettings } from '../services/printerSettingsService';
import { getCompanyLogo } from '../utils/companyBranding';

interface ReportTabMeta {
  key: ReportType;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
  bg: string;
  description: string;
}

const REPORT_TABS: ReportTabMeta[] = [
  {
    key: 'collections',
    label: 'Collections',
    icon: 'payments',
    color: '#059669',
    bg: '#d1fae5',
    description: 'Cash, UPI & Advance Collections Log',
  },
  {
    key: 'route_wise',
    label: 'Route Wise',
    icon: 'alt-route',
    color: '#2563eb',
    bg: '#dbeafe',
    description: 'Sales & Collections Grouped by Beat',
  },
  {
    key: 'payments',
    label: 'Payments',
    icon: 'receipt',
    color: '#7c3aed',
    bg: '#ede9fe',
    description: 'Customer Payment Receipts & Dues Clearance',
  },
  {
    key: 'outstanding',
    label: 'Outstanding',
    icon: 'hourglass-bottom',
    color: '#d97706',
    bg: '#fef3c7',
    description: 'Customer Receivables & Aging Credit',
  },
  {
    key: 'expenses',
    label: 'Expenses',
    icon: 'account-balance-wallet',
    color: '#e11d48',
    bg: '#ffe4e6',
    description: 'Field Fuel, Food & Operational Outflows',
  },
  {
    key: 'orders',
    label: 'Orders',
    icon: 'shopping-cart',
    color: '#0891b2',
    bg: '#cffafe',
    description: 'Customer Advance Booked Orders',
  },
  {
    key: 'items_wise',
    label: 'Items Wise',
    icon: 'inventory-2',
    color: '#4f46e5',
    bg: '#e0e7ff',
    description: 'SKU & Product Quantity Sales Analysis',
  },
  {
    key: 'customers_wise',
    label: 'Customers Wise',
    icon: 'people',
    color: '#0284c7',
    bg: '#e0f2fe',
    description: 'Customer Wise Purchase & Balance Ledger',
  },
  {
    key: 'closing_stock',
    label: 'Closing Stock',
    icon: 'inventory',
    color: '#0d9488',
    bg: '#ccfbf1',
    description: 'End-of-day Van Closing Stock & Reconciliation',
  },
];

export default function ReportsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ReportType>('collections');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Report Data States
  const [collectionsData, setCollectionsData] = useState<{
    items: CollectionReportItem[];
    totals: any;
  }>({ items: [], totals: {} });

  const [routeWiseData, setRouteWiseData] = useState<{
    items: RouteWiseSaleItem[];
    totals: any;
  }>({ items: [], totals: {} });

  const [paymentsData, setPaymentsData] = useState<{
    items: PaymentReportItem[];
    totals: any;
  }>({ items: [], totals: {} });

  const [outstandingData, setOutstandingData] = useState<{
    items: OutstandingReportItem[];
    totals: any;
  }>({ items: [], totals: {} });

  const [expensesData, setExpensesData] = useState<{
    items: ExpenseReportItem[];
    totals: any;
  }>({ items: [], totals: {} });

  const [ordersData, setOrdersData] = useState<{
    items: OrderReportItem[];
    totals: any;
  }>({ items: [], totals: {} });

  const [itemsWiseData, setItemsWiseData] = useState<{
    items: ItemWiseSaleItem[];
    totals: any;
  }>({ items: [], totals: {} });

  const [customersWiseData, setCustomersWiseData] = useState<{
    items: CustomerWiseSaleItem[];
    totals: any;
  }>({ items: [], totals: {} });

  const [closingStockData, setClosingStockData] = useState<{
    items: ClosingStockReportItem[];
    totals: any;
  }>({ items: [], totals: {} });

  const assignedRoute = getAssignedRoute();
  const company = getCompanyProfile();
  const printerSettings = getPrinterSettings();
  const paperWidth: ThermalWidth = printerSettings.paperSize === '58mm' ? '58mm' : '80mm';

  const loadActiveReportData = useCallback(() => {
    try {
      if (activeTab === 'collections') {
        setCollectionsData(getCollectionsReportData());
      } else if (activeTab === 'route_wise') {
        setRouteWiseData(getRouteWiseSalesReportData());
      } else if (activeTab === 'payments') {
        setPaymentsData(getPaymentsReportData());
      } else if (activeTab === 'outstanding') {
        setOutstandingData(getOutstandingReportData());
      } else if (activeTab === 'expenses') {
        setExpensesData(getExpensesReportData());
      } else if (activeTab === 'orders') {
        setOrdersData(getOrdersReportData());
      } else if (activeTab === 'items_wise') {
        setItemsWiseData(getItemsWiseSalesReportData());
      } else if (activeTab === 'customers_wise') {
        setCustomersWiseData(getCustomersWiseSalesReportData());
      } else if (activeTab === 'closing_stock') {
        setClosingStockData(getClosingStockReportData());
      }
    } catch (err) {
      console.warn('Error loading active report data:', err);
    }
  }, [activeTab]);

  useFocusEffect(
    useCallback(() => {
      loadActiveReportData();
    }, [loadActiveReportData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await syncDatabase();
    } catch (e) {
      console.warn('Sync warning on report refresh:', e);
    }
    loadActiveReportData();
    setRefreshing(false);
  };

  // Compile print options for current active tab
  const printOptions = useMemo<ReportPrintOptions>(() => {
    const sName = user?.name || user?.username || 'Sales Representative';
    const vReg = assignedRoute?.vehicle_reg_no || 'Assigned Van';
    const rName = assignedRoute?.route_name || 'Assigned Territory';

    if (activeTab === 'collections') {
      const { items, totals } = collectionsData;
      return {
        title: 'COLLECTIONS REPORT',
        subtitle: 'Daily Cash, UPI & Advance Booking Receipts',
        salesmanName: sName,
        vehicleRegNo: vReg,
        routeName: rName,
        summaryCards: [
          { label: 'Total Collections', value: formatINR(totals.totalCollected), color: '#059669' },
          { label: 'Cash Collected', value: formatINR(totals.cashCollected), color: '#16a34a' },
          { label: 'Online / UPI', value: formatINR(totals.onlineCollected), color: '#2563eb' },
          { label: 'Receipts Count', value: `${totals.totalTransactions || 0} Txns` },
        ],
        headers: ['Receipt / Code', 'Date', 'Customer Name', 'Type', 'Mode', 'Amount'],
        rows: items.map((r) => [
          r.booking_code,
          r.date,
          r.customer_name,
          r.sale_type,
          r.payment_mode,
          formatINR(r.amount_collected),
        ]),
        footerNote: 'All collected cash must be reconciled against logged field expenses.',
      };
    }

    if (activeTab === 'route_wise') {
      const { items, totals } = routeWiseData;
      return {
        title: 'ROUTE WISE SALES REPORT',
        subtitle: 'Territory / Beat Performance & Outstanding Ledger',
        salesmanName: sName,
        vehicleRegNo: vReg,
        routeName: rName,
        summaryCards: [
          { label: 'Total Route Sales', value: formatINR(totals.totalSales), color: '#2563eb' },
          { label: 'Cash Collected', value: formatINR(totals.cashCollected), color: '#059669' },
          { label: 'Balance Due', value: formatINR(totals.balanceDue), color: '#dc2626' },
          { label: 'Total Orders', value: `${totals.totalOrders || 0} Orders` },
        ],
        headers: ['Route / Beat Name', 'Orders', 'Total Sales', 'Collected', 'Balance Due'],
        rows: items.map((r) => [
          r.route_name,
          `${r.orders_count} orders`,
          formatINR(r.total_sales),
          formatINR(r.cash_collected),
          formatINR(r.balance_due),
        ]),
      };
    }

    if (activeTab === 'payments') {
      const { items, totals } = paymentsData;
      return {
        title: 'PAYMENTS RECEIVED REPORT',
        subtitle: 'Customer Inward Payments & Due Clearance Log',
        salesmanName: sName,
        vehicleRegNo: vReg,
        routeName: rName,
        summaryCards: [
          { label: 'Total Received', value: formatINR(totals.totalPayments), color: '#7c3aed' },
          { label: 'Physical Cash', value: formatINR(totals.cashTotal), color: '#059669' },
          { label: 'Online / Bank', value: formatINR(totals.onlineTotal), color: '#2563eb' },
          { label: 'Receipts', value: `${totals.receiptsCount || 0} Receipts` },
        ],
        headers: ['Receipt #', 'Date', 'Customer Name', 'Beat / Place', 'Mode', 'Amount'],
        rows: items.map((r) => [
          r.receipt_number,
          r.date,
          r.customer_name,
          r.customer_place,
          r.payment_mode,
          formatINR(r.amount),
        ]),
      };
    }

    if (activeTab === 'outstanding') {
      const { items, totals } = outstandingData;
      return {
        title: 'CUSTOMER OUTSTANDING REPORT',
        subtitle: 'Receivables, Credit Aging & Risk Analysis',
        salesmanName: sName,
        vehicleRegNo: vReg,
        routeName: rName,
        summaryCards: [
          { label: 'Total Outstanding', value: formatINR(totals.totalOutstanding), color: '#d97706' },
          { label: 'Customers with Dues', value: `${totals.debtorsCount || 0} Stores` },
          { label: 'Credit Limit Total', value: formatINR(totals.totalCreditLimit) },
        ],
        headers: ['Customer / Store', 'Place / Beat', 'Phone', 'Credit Limit', 'Risk', 'Balance Due'],
        rows: items.map((r) => [
          r.customer_name,
          r.route_area,
          r.phone,
          formatINR(r.credit_limit),
          r.risk_level,
          formatINR(r.outstanding_balance),
        ]),
      };
    }

    if (activeTab === 'expenses') {
      const { items, totals } = expensesData;
      return {
        title: 'FIELD EXPENSES REPORT',
        subtitle: 'Fuel, Meals, Maintenance & In-Hand Cash Audit',
        salesmanName: sName,
        vehicleRegNo: vReg,
        routeName: rName,
        summaryCards: [
          { label: 'Total Expenses', value: formatINR(totals.totalExpenses), color: '#e11d48' },
          { label: 'Fuel / Diesel', value: formatINR(totals.fuelTotal), color: '#d97706' },
          { label: 'Meals & Food', value: formatINR(totals.foodTotal), color: '#059669' },
          { label: 'Net Cash In-Hand', value: formatINR(totals.netInHandCash), color: '#047857' },
        ],
        headers: ['Expense Code', 'Date', 'Category', 'Reason / Purpose', 'Mode', 'Amount'],
        rows: items.map((r) => [
          r.expense_code,
          r.date,
          r.category,
          r.reason,
          r.payment_mode,
          `-${formatINR(r.amount)}`,
        ]),
      };
    }

    if (activeTab === 'orders') {
      const { items, totals } = ordersData;
      return {
        title: 'ORDERS BOOKING REPORT',
        subtitle: 'Advance Orders Booked & Spot Deliveries Register',
        salesmanName: sName,
        vehicleRegNo: vReg,
        routeName: rName,
        summaryCards: [
          { label: 'Total Orders Value', value: formatINR(totals.totalOrdersValue), color: '#0891b2' },
          { label: 'Advance Collected', value: formatINR(totals.totalAdvanceReceived), color: '#059669' },
          { label: 'Balance Receivable', value: formatINR(totals.totalBalanceDue), color: '#dc2626' },
          { label: 'Bookings Count', value: `${totals.totalOrdersCount || 0} Orders` },
        ],
        headers: ['Order Code', 'Date', 'Customer Name', 'Items Summary', 'Total Amount', 'Advance Paid', 'Balance Due'],
        rows: items.map((r) => [
          r.booking_code,
          r.date,
          r.customer_name,
          r.product_summary,
          formatINR(r.total_amount),
          formatINR(r.advance_amount),
          formatINR(r.balance_amount),
        ]),
      };
    }

    if (activeTab === 'items_wise') {
      const { items, totals } = itemsWiseData;
      return {
        title: 'ITEMS WISE SALES REPORT',
        subtitle: 'Quantity, Package Packs & Revenue Analysis by Product',
        salesmanName: sName,
        vehicleRegNo: vReg,
        routeName: rName,
        summaryCards: [
          { label: 'Total Revenue', value: formatINR(totals.totalRevenue), color: '#4f46e5' },
          { label: 'Units Sold', value: `${totals.totalUnitsSold || 0} Units`, color: '#059669' },
          { label: 'Packages Sold', value: `${totals.totalPackagesSold || 0} Packs` },
          { label: 'Unique SKUs', value: `${totals.productsCount || 0} Products` },
        ],
        headers: ['Product Name', 'Category', 'Packages Sold', 'Total Units Sold', 'Avg Price', 'Total Revenue'],
        rows: items.map((r) => [
          r.product_name,
          r.category_name,
          `${r.package_qty} packs`,
          `${r.total_units} pcs`,
          formatINR(r.avg_price),
          formatINR(r.total_revenue),
        ]),
      };
    }

    if (activeTab === 'customers_wise') {
      const { items, totals } = customersWiseData;
    return {
      title: 'CUSTOMERS WISE SALES REPORT',
      subtitle: 'Customer Purchase Volume, Paid Amounts & Pending Dues',
      salesmanName: sName,
      vehicleRegNo: vReg,
      routeName: rName,
      summaryCards: [
        { label: 'Total Sales Volume', value: formatINR(totals.totalRevenue), color: '#0284c7' },
        { label: 'Cash Collected', value: formatINR(totals.totalCollected), color: '#059669' },
        { label: 'Total Balance Due', value: formatINR(totals.totalBalanceDue), color: '#dc2626' },
        { label: 'Customers Served', value: `${totals.customersCount || 0} Stores` },
      ],
      headers: ['Customer / Store Name', 'Sales Count', 'Total Purchases', 'Amount Paid', 'Balance Due'],
      rows: items.map((r) => [
        r.customer_name,
        `${r.sales_count} txns`,
        formatINR(r.total_purchase),
        formatINR(r.total_paid),
        formatINR(r.balance_due),
      ]),
    };
  }

  // closing_stock
  const { items, totals } = closingStockData;
  return {
    title: 'VAN CLOSING STOCK REPORT',
    subtitle: 'End-of-Day Physical Van Stock Verification & Reconciliation',
    salesmanName: sName,
    vehicleRegNo: vReg,
    routeName: rName,
    summaryCards: [
      { label: 'Closing Valuation', value: formatINR(totals.totalClosingValue), color: '#0d9488' },
      { label: 'Closing Units', value: `${totals.totalClosingUnits || 0} Units`, color: '#2563eb' },
      { label: 'Loaded / Opening', value: `${totals.totalLoadedUnits || 0} Units`, color: '#4f46e5' },
      { label: 'Units Sold', value: `${totals.totalSoldUnits || 0} Units`, color: '#059669' },
      { label: 'SKU Count', value: `${totals.productsCount || 0} Products` },
    ],
    headers: ['Product Name', 'Category', 'SKU', 'Loaded Qty', 'Sold Qty', 'Closing Stock', 'Unit Rate', 'Stock Status', 'Closing Value'],
    rows: items.map((r) => [
      r.product_name,
      r.category_name,
      r.product_sku ? `SKU: ${r.product_sku}` : 'SKU: -',
      `${r.loaded_qty} ${r.unit}`,
      `${r.sold_qty} ${r.unit}`,
      r.closing_display,
      formatINR(r.unit_price),
      r.status,
      formatINR(r.total_value),
    ]),
    footerNote: 'Physical van stock verified & reconciled at end-of-day. Discrepancies must be audited before warehouse check-in.',
  };
}, [
  activeTab,
  collectionsData,
  routeWiseData,
  paymentsData,
  outstandingData,
  expensesData,
  ordersData,
  itemsWiseData,
  customersWiseData,
  closingStockData,
  user,
  assignedRoute,
]);

  const handlePrint = async () => {
    setPreviewVisible(true);
  };

  const handleConfirmPrintReport = async () => {
    setPrinting(true);
    try {
      const currentSettings = getPrinterSettings();
      const currentPaperWidth: ThermalWidth = currentSettings.paperSize === '58mm' ? '58mm' : '80mm';
      await printReportDocument(printOptions, currentPaperWidth);
      Alert.alert('Report Printed', `Successfully printed ${printOptions.title} directly via Bluetooth.`);
    } catch (e: any) {
      const errStr = (e?.message || e?.toString() || '').toLowerCase();
      if (!errStr.includes('cancelled') && !errStr.includes('stopped') && !errStr.includes('abort')) {
        const isSetupNeeded =
          errStr.includes('bluetooth') ||
          errStr.includes('printer') ||
          errStr.includes('settings');

        const buttons: any[] = [{ text: 'Cancel', style: 'cancel' }];
        if (isSetupNeeded) {
          buttons.push({
            text: 'Printer Setup',
            onPress: () => {
              setPreviewVisible(false);
              router.push('/settings');
            },
          });
        }

        Alert.alert(
          'Print Error',
          e.message || 'Could not print report directly. Please check printer connection.',
          buttons
        );
      }
    } finally {
      setPrinting(false);
    }
  };

  const handleStopReportPrint = () => {
    abortActivePrint();
    setPrinting(false);
    Alert.alert('Print Stopped', 'Report printing was stopped.');
  };

  const handleSharePdf = async () => {
    if (printing) return;
    setPrinting(true);
    try {
      await shareReportPdfDocument(printOptions, paperWidth);
    } catch (e: any) {
      Alert.alert('Share Notice', e.message || 'Unable to generate report PDF.');
    } finally {
      setPrinting(false);
    }
  };

  const activeMeta = REPORT_TABS.find((t) => t.key === activeTab) || REPORT_TABS[0];

  return (
    <View className="flex-1 bg-slate-50">
      {/* Top Header */}
      <View className="bg-white border-b border-slate-200 px-4 pt-3 pb-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-1">
            <Text className="text-base font-bold text-slate-900 leading-tight">Reports & Audits</Text>
            <View className="flex-row items-center gap-1.5 mt-0.5">
              <View className="w-2 h-2 rounded-full bg-emerald-500" />
              <Text className="text-[11px] font-semibold text-slate-500" numberOfLines={1}>
                {user?.name || 'Sales Representative'}
                {assignedRoute?.vehicle_reg_no ? ` • ${assignedRoute.vehicle_reg_no}` : ''}
              </Text>
            </View>
          </View>

          {/* Quick Action Buttons */}
          <View className="flex-row items-center gap-1.5">
            {/* Share PDF Button */}
            <TouchableOpacity
              onPress={handleSharePdf}
              disabled={printing}
              className="bg-slate-200 border border-slate-200 p-2 rounded-xl active:bg-slate-300"
              accessibilityLabel="Share PDF"
            >
              {printing ? (
                <ActivityIndicator size="small" color="#37ad27ff" />
              ) : (
                <MaterialIcons name="share" size={17} color="#334155" />
              )}
            </TouchableOpacity>

            {/* Print / Stop Document Button */}
            {printing ? (
              <TouchableOpacity
                onPress={handleStopReportPrint}
                className="bg-rose-600 active:bg-rose-700 px-3 py-2 rounded-xl flex-row items-center gap-1.5 shadow-xs"
                accessibilityLabel="Stop Printing Report"
              >
                <MaterialIcons name="stop-circle" size={17} color="#ffffff" />
                <Text className="text-xs font-bold text-white">Stop Printing</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={handlePrint}
                className="bg-blue-600 active:bg-blue-700 px-3 py-2 rounded-xl flex-row items-center gap-1.5 shadow-xs"
                accessibilityLabel="Print Report"
              >
                <MaterialIcons name="print" size={17} color="#ffffff" />
                <Text className="text-xs font-bold text-white">Print</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* 8 Specialized Reports Horizontal Category Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="flex-row gap-1.5 pt-3"
        >
          {REPORT_TABS.map((tab) => {
            const isSelected = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => {
                  setActiveTab(tab.key);
                  setSearchQuery('');
                }}
                className={`px-3 py-2 rounded-xl border mr-1.5 flex-row items-center gap-1.5 ${
                  isSelected ? 'bg-slate-900 border-slate-900' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <MaterialIcons
                  name={tab.icon}
                  size={15}
                  color={isSelected ? '#ffffff' : tab.color}
                />
                <Text
                  className={`text-xs font-bold ${
                    isSelected ? 'text-white' : 'text-slate-700'
                  }`}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Active Report Header & Description */}
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center gap-2 flex-1 pr-2">
            <View
              style={{ backgroundColor: activeMeta.bg }}
              className="w-9 h-9 rounded-xl items-center justify-center"
            >
              <MaterialIcons name={activeMeta.icon} size={20} color={activeMeta.color} />
            </View>
            <View>
              <Text className="text-sm font-bold text-slate-900 leading-tight">
                {activeMeta.label} Report
              </Text>
              <Text className="text-[11px] text-slate-500">{activeMeta.description}</Text>
            </View>
          </View>
        </View>

        {/* Dynamic Summary / KPI Ribbon Cards */}
        {printOptions.summaryCards && (
          <View className="flex-row flex-wrap gap-2 mb-4">
            {printOptions.summaryCards.map((card, i) => (
              <View
                key={i}
                className="flex-1 min-w-[140px] bg-white rounded-2xl p-3 border border-slate-100 shadow-xs"
              >
                <Text className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {card.label}
                </Text>
                <Text
                  style={{ color: card.color || '#0f172a' }}
                  className="text-base font-extrabold mt-0.5 leading-tight"
                  numberOfLines={1}
                >
                  {card.value}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Search Filter */}
        <View className="bg-white rounded-2xl px-3.5 py-2.5 flex-row items-center gap-2 border border-slate-200 mb-3 shadow-xs">
          <MaterialIcons name="search" size={20} color="#94a3b8" />
          <TextInput
            placeholder={`Search ${activeMeta.label} records...`}
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            className="flex-1 text-xs text-slate-800 p-0"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <MaterialIcons name="close" size={18} color="#94a3b8" />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Report Records Content */}
        {printOptions.rows.length > 0 ? (
          <View className="gap-2.5">
            {printOptions.rows
              .filter((row) => {
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return row.some((cell) => String(cell).toLowerCase().includes(q));
              })
              .map((row, idx) => (
                <View
                  key={idx}
                  className="bg-white rounded-2xl p-3.5 border border-slate-200/90 shadow-2xs"
                >
                  {/* Top Row: Primary Title & Main Value */}
                  <View className="flex-row items-start justify-between mb-1.5">
                    <View className="flex-1 pr-2">
                      <Text className="text-xs font-bold text-slate-900 leading-tight">
                        {row[0]}
                      </Text>
                      {row[1] ? (
                        <Text className="text-[11px] text-slate-500 mt-0.5">
                          {row[1]} {row[2] ? `• ${row[2]}` : ''}
                        </Text>
                      ) : null}
                    </View>

                    {/* Primary Highlight Value (Amount/Revenue) */}
                    <View className="items-end">
                      <Text
                        className={`text-sm font-extrabold ${
                          activeTab === 'outstanding' || String(row[row.length - 1]).startsWith('-')
                            ? 'text-rose-600'
                            : 'text-emerald-700'
                        }`}
                      >
                        {row[row.length - 1]}
                      </Text>
                    </View>
                  </View>

                  {/* Secondary Details / Columns */}
                  <View className="flex-row items-center justify-between pt-2 mt-1 border-t border-slate-50 flex-wrap gap-2">
                    {row.slice(3, row.length - 1).map((val, cIdx) => {
                      const isOutOfStock = val === 'Out of Stock' || val === 'High';
                      const isLowStock = val === 'Low Stock' || val === 'Medium';
                      const isInStock = val === 'In Stock' || val === 'Healthy';
                      return (
                        <View
                          key={cIdx}
                          className={`px-2 py-0.5 rounded-lg border ${
                            isOutOfStock
                              ? 'bg-rose-50 border-rose-200'
                              : isLowStock
                              ? 'bg-amber-50 border-amber-200'
                              : isInStock
                              ? 'bg-emerald-50 border-emerald-200'
                              : 'bg-slate-50 border-slate-100'
                          }`}
                        >
                          <Text
                            className={`text-[10px] font-semibold ${
                              isOutOfStock
                                ? 'text-rose-700'
                                : isLowStock
                                ? 'text-amber-700'
                                : isInStock
                                ? 'text-emerald-700'
                                : 'text-slate-600'
                            }`}
                          >
                            {printOptions.headers[cIdx + 3]}:{' '}
                            <Text
                              className={`font-bold ${
                                isOutOfStock
                                  ? 'text-rose-900'
                                  : isLowStock
                                  ? 'text-amber-900'
                                  : isInStock
                                  ? 'text-emerald-900'
                                  : 'text-slate-900'
                              }`}
                            >
                              {val}
                            </Text>
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
          </View>
        ) : (
          <View className="bg-white rounded-3xl p-8 items-center border border-slate-200 mt-2">
            <View className="w-16 h-16 rounded-full bg-slate-100 items-center justify-center mb-3">
              <MaterialIcons name={activeMeta.icon} size={32} color="#94a3b8" />
            </View>
            <Text className="text-sm font-bold text-slate-800 text-center">
              No {activeMeta.label} Records Found
            </Text>
            <Text className="text-xs text-slate-500 text-center mt-1 max-w-[240px]">
              {activeTab === 'closing_stock'
                ? 'Allocate van inventory or perform sales transactions to verify closing stock.'
                : 'Perform sales transactions, customer visits or field expenses to compile this report.'}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Report Thermal Receipt Preview Modal (Exact same architecture as Invoice/Order preview) */}
      <Modal
        visible={previewVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          if (printing) {
            handleStopReportPrint();
          } else {
            setPreviewVisible(false);
          }
        }}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' }}>
          <View
            style={{
              height: Platform.OS === 'ios' ? '92%' : '94%',
              maxHeight: Dimensions.get('window').height * 0.94,
              backgroundColor: '#ffffff',
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              overflow: 'hidden',
            }}
          >
            <View style={{ flex: 1, paddingTop: 16, paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 36 : 24 }}>
              {/* Modal Top Bar */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: '#0f172a' }}>
                    Report Receipt Preview
                  </Text>
                  <Text style={{ fontSize: 11, color: '#64748b', marginTop: 1 }} numberOfLines={1}>
                    {printOptions.title} • {paperWidth} Direct Thermal Print
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TouchableOpacity
                    onPress={handleSharePdf}
                    disabled={printing}
                    style={{
                      height: 34,
                      paddingHorizontal: 12,
                      borderRadius: 17,
                      backgroundColor: '#0f172a',
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="share" size={15} color="#ffffff" />
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#ffffff' }}>PDF</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setPreviewVisible(false)}
                    disabled={printing}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      backgroundColor: '#f1f5f9',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="close" size={20} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Thermal Paper Canvas Container */}
              <ScrollView
                style={{ flex: 1, backgroundColor: '#f1f5f9', borderRadius: 16, padding: 12 }}
                contentContainerStyle={{ paddingBottom: 24 }}
                showsVerticalScrollIndicator={true}
              >
                <View
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: 12,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: '#e2e8f0',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.05,
                    shadowRadius: 2,
                    elevation: 1,
                  }}
                >
                  {/* Centered Company Logo */}
                  {(() => {
                    const logoUrl = getCompanyLogo(company);
                    if (logoUrl) {
                      return (
                        <View style={{ alignItems: 'center', marginBottom: 8 }}>
                          <Image
                            source={{ uri: logoUrl }}
                            style={{ width: paperWidth === '58mm' ? 140 : 180, height: 50 }}
                            contentFit="contain"
                          />
                        </View>
                      );
                    }
                    return null;
                  })()}

                  {/* Company Header */}
                  <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#0f172a', textAlign: 'center', letterSpacing: 0.2 }}>
                    {company?.company_name || 'SOFTAIR SOLUTIONS PVTLTD'}
                  </Text>
                  {company?.address ? (
                    <Text style={{ fontSize: 11, color: '#475569', textAlign: 'center', marginTop: 2 }}>
                      {company.address}
                    </Text>
                  ) : null}
                  {company?.phone ? (
                    <Text style={{ fontSize: 10.5, color: '#64748b', textAlign: 'center', marginTop: 1 }}>
                      Tel: {company.phone}
                    </Text>
                  ) : null}

                  {/* Report Title Badge */}
                  <View style={{ alignSelf: 'center', backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, marginVertical: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: '900', color: '#0f172a', textAlign: 'center' }}>
                      [ {printOptions.title} ]
                    </Text>
                  </View>

                  {printOptions.subtitle ? (
                    <Text style={{ fontSize: 10, color: '#64748b', textAlign: 'center', marginBottom: 6 }}>
                      {printOptions.subtitle}
                    </Text>
                  ) : null}

                  <Text style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>
                    ========================================
                  </Text>

                  {/* Meta info */}
                  <View style={{ marginVertical: 6, gap: 2 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 10.5, color: '#64748b', fontWeight: '600' }}>Date & Time:</Text>
                      <Text style={{ fontSize: 10.5, color: '#0f172a', fontWeight: '700' }}>{new Date().toLocaleString('en-IN')}</Text>
                    </View>
                    {printOptions.salesmanName ? (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 10.5, color: '#64748b', fontWeight: '600' }}>Sales Rep:</Text>
                        <Text style={{ fontSize: 10.5, color: '#0f172a', fontWeight: '700' }}>{printOptions.salesmanName}</Text>
                      </View>
                    ) : null}
                    {printOptions.vehicleRegNo || printOptions.routeName ? (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 10.5, color: '#64748b', fontWeight: '600' }}>Van / Beat:</Text>
                        <Text style={{ fontSize: 10.5, color: '#0f172a', fontWeight: '700' }}>
                          {[printOptions.vehicleRegNo, printOptions.routeName].filter(Boolean).join(' • ')}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <Text style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>
                    ----------------------------------------
                  </Text>

                  {/* KPI Summary Block */}
                  {printOptions.summaryCards && printOptions.summaryCards.length > 0 && (
                    <View style={{ marginVertical: 6 }}>
                      <Text style={{ fontSize: 11, fontWeight: '800', color: '#0f172a', marginBottom: 4 }}>
                        SUMMARY TOTALS
                      </Text>
                      <View style={{ backgroundColor: '#f8fafc', padding: 8, borderRadius: 8, gap: 4 }}>
                        {printOptions.summaryCards.map((c, idx) => (
                          <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ fontSize: 11, color: '#475569', fontWeight: '600' }}>{c.label}:</Text>
                            <Text style={{ fontSize: 11, fontWeight: '800', color: c.color || '#0f172a' }}>{c.value}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  <Text style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>
                    ----------------------------------------
                  </Text>

                  {/* Table Data Preview */}
                  {printOptions.rows && printOptions.rows.length > 0 ? (
                    <View style={{ marginVertical: 6 }}>
                      {printOptions.rows.map((row, rIdx) => {
                        const primaryCol = String(row[0] || '');
                        const secondaryCol = String(row[1] || '');
                        const amountCol = String(row[row.length - 1] || '');

                        return (
                          <View key={rIdx} style={{ paddingVertical: 4, borderBottomWidth: rIdx < printOptions.rows.length - 1 ? 0.5 : 0, borderBottomColor: '#f1f5f9' }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#0f172a', flex: 1, paddingRight: 4 }}>
                                {rIdx + 1}. {primaryCol}
                              </Text>
                              <Text style={{ fontSize: 11, fontWeight: '800', color: activeTab === 'outstanding' ? '#dc2626' : '#047857' }}>
                                {amountCol}
                              </Text>
                            </View>
                            {secondaryCol && secondaryCol !== primaryCol ? (
                              <Text style={{ fontSize: 9.5, color: '#64748b', marginLeft: 14, marginTop: 1 }}>
                                {secondaryCol}
                              </Text>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  ) : null}

                  {printOptions.footerNote ? (
                    <>
                      <Text style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', marginVertical: 4 }}>
                        ----------------------------------------
                      </Text>
                      <Text style={{ fontSize: 9.5, color: '#64748b', textAlign: 'center', fontStyle: 'italic' }}>
                        {printOptions.footerNote}
                      </Text>
                    </>
                  ) : null}

                  <Text style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', marginTop: 8 }}>
                    ========================================
                  </Text>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: '#94a3b8', textAlign: 'center', marginTop: 4 }}>
                    *** END OF REPORT ***
                  </Text>
                </View>
              </ScrollView>

              {/* Modal Action Footer */}
              <View style={{ marginTop: 12 }}>
                {printing ? (
                  <TouchableOpacity
                    onPress={handleStopReportPrint}
                    style={{
                      backgroundColor: '#ef4444',
                      borderRadius: 16,
                      paddingVertical: 14,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'row',
                      gap: 8,
                      shadowColor: '#ef4444',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.3,
                      shadowRadius: 4,
                      elevation: 3,
                    }}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="stop-circle" size={20} color="#ffffff" />
                    <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '900' }}>
                      Stop Printing
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      onPress={() => setPreviewVisible(false)}
                      style={{
                        flex: 1,
                        backgroundColor: '#f8fafc',
                        borderColor: '#cbd5e1',
                        borderWidth: 1.5,
                        borderRadius: 16,
                        paddingVertical: 14,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={{ color: '#0f172a', fontSize: 13, fontWeight: '800' }}>
                        Close
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={handleConfirmPrintReport}
                      style={{
                        flex: 1.6,
                        backgroundColor: '#2563eb',
                        borderRadius: 16,
                        paddingVertical: 14,
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'row',
                        gap: 6,
                        shadowColor: '#2563eb',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.25,
                        shadowRadius: 4,
                        elevation: 3,
                      }}
                      activeOpacity={0.85}
                    >
                      <MaterialIcons name="print" size={18} color="#ffffff" />
                      <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '900' }}>
                        Confirm & Print
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
