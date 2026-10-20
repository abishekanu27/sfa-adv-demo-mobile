import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  Keyboard,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, router } from 'expo-router';
import {
  getBookings,
  createBooking,
  getNextDocumentCode,
  getCustomers,
  getSelectedRoute,
  setSelectedRoute,
  getAvailableRoutes,
  getAssignedRoute,
  getVanStocks,
  deductVanStock,
  addVanStock,
  getWarehouseStocks,
  replaceWarehouseStocks,
  getWarehouseNames,
  getCustomerBalances,
  getCustomerBalance,
  formatStockQty,
  recordCustomerPayment,
  BookingRecord,
  CustomerRecord,
  VanStockRecord,
  WarehouseStockRecord,
  RouteInfo,
  getCompanyProfile,
  CompanyProfile,
  getProductSellingPrices,
  ProductSellingPriceRecord,
  evaluateLocalSchemes,
  FreeSchemeItem,
  QualifiedSchemeItem,
  SchemeEvaluationResult,
} from '../database/db';
import { syncCompanyProfile } from '../database/sync';
import InvoicePreviewContent from '../components/InvoicePreviewContent';
import { LoadingIndicator } from '../components/LoadingIndicator';
import {
  MobileInvoiceData,
  InvoiceItem,
  printInvoice,
  shareInvoicePdf,
} from '../services/invoiceService';
import { abortActivePrint } from '../services/printerSettingsService';
import { sendImmediateLocationPing } from '../services/gpsTrackingService';
import { triggerImmediateSync, addAutoSyncListener } from '../services/autoSyncService';
import { useAuth } from '../context/AuthContext';


export default function Sales() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [customerBalances, setCustomerBalances] = useState<Record<string, number>>({});
  const [vanStocks, setVanStocks] = useState<VanStockRecord[]>([]);
  const [warehouseStocks, setWarehouseStocks] = useState<WarehouseStockRecord[]>([]);
  const [stockSearch, setStockSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('All Warehouses');
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedRoute, setSelectedRouteState] = useState<string>(getSelectedRoute());
  const [availableRoutes, setAvailableRoutes] = useState<string[]>([]);
  const [assignedRoute, setAssignedRoute] = useState<RouteInfo | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'sales' | 'orders'>('sales');
  const [customerSearch, setCustomerSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [customerSelectorVisible, setCustomerSelectorVisible] = useState(false);
  const [selectorTargetType, setSelectorTargetType] = useState<'sale' | 'order'>('sale');
  const [saleType, setSaleType] = useState<'sale' | 'order' | 'return'>('sale');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'sales' | 'orders' | 'returns'>('all');

  // Receive Payment Modal state
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentCustomer, setPaymentCustomer] = useState<CustomerRecord | null>(null);
  const [paymentTotalDue, setPaymentTotalDue] = useState(0);
  const [paymentAmountInput, setPaymentAmountInput] = useState('');
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'UPI' | 'Cheque'>('Cash');
  const [paymentNotes, setPaymentNotes] = useState('');

  // Sale & stock selection state
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPlace, setCustomerPlace] = useState('');
  const [itemLooseQuantities, setItemLooseQuantities] = useState<{ [key: string]: number }>({});
  const [itemBagQuantities, setItemBagQuantities] = useState<{ [key: string]: number }>({});
  const [productSellingPrices, setProductSellingPrices] = useState<ProductSellingPriceRecord[]>([]);
  const [customLooseRates, setCustomLooseRates] = useState<{ [key: string]: string }>({});
  const [customBagRates, setCustomBagRates] = useState<{ [key: string]: string }>({});
  const [itemDiscounts, setItemDiscounts] = useState<{ [key: string]: string }>({});
  const [itemDiscountTypes, setItemDiscountTypes] = useState<{ [key: string]: 'amount' | 'percent' }>({});
  const [customAdvance, setCustomAdvance] = useState('');
  const [notes, setNotes] = useState('');
  const [acceptedFreeRewards, setAcceptedFreeRewards] = useState<{ [schemeId: number]: FreeSchemeItem }>({});
  const [acceptedDiscountSchemes, setAcceptedDiscountSchemes] = useState<{ [schemeId: number]: boolean }>({});
  const [isSchemeBannerMinimized, setIsSchemeBannerMinimized] = useState(false);

  // Invoice Preview / Print modal state
  const [companyProfile, setCompanyProfileState] = useState<CompanyProfile>(getCompanyProfile());
  const [previewInvoice, setPreviewInvoice] = useState<MobileInvoiceData | null>(null);
  const [modalStep, setModalStep] = useState<'form' | 'preview' | 'return_review'>('form');
  const [isHistoryPreview, setIsHistoryPreview] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  // Product Return workflow state
  const [returnReason, setReturnReason] = useState('');
  const [isRefundable, setIsRefundable] = useState(true);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMode, setRefundMode] = useState<'Cash' | 'UPI' | 'Credit'>('Cash');

  const loadData = useCallback(() => {
    try {
      const currentCompany = getCompanyProfile();
      setCompanyProfileState(currentCompany);

      // Refresh company profile in background from Web application settings
      syncCompanyProfile().then((fresh) => {
        if (fresh) setCompanyProfileState(fresh);
      }).catch(() => {});
      const currentRoute = getSelectedRoute();
      setSelectedRouteState(currentRoute);
      const routes = getAvailableRoutes();
      setAvailableRoutes(routes);
      const assigned = getAssignedRoute();
      setAssignedRoute(assigned);

      const bList = getBookings();
      setBookings(bList);
      const balances = getCustomerBalances();
      setCustomerBalances(balances);
      const filter = currentRoute === 'All Routes' ? '' : currentRoute;
      const cList = getCustomers('', filter);
      setCustomers(cList);

      const vList = getVanStocks();
      setVanStocks(vList);

      const wList = getWarehouseStocks();
      setWarehouseStocks(wList);

      const pPrices = getProductSellingPrices();
      setProductSellingPrices(pPrices);
    } catch (e: any) {
      console.error('Failed to load bookings:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = addAutoSyncListener((event) => {
      if (event.success && (event.pulledCount > 0 || event.pushedCount > 0)) {
        loadData();
      }
    });
    return unsubscribe;
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const getBalanceForCustomer = (cust: CustomerRecord): number => {
    return getCustomerBalance(cust);
  };

  const handleSelectRoute = (route: string) => {
    setSelectedRoute(route);
    setSelectedRouteState(route);
    setDropdownOpen(false);
    const filter = route === 'All Routes' ? '' : route;
    const cList = getCustomers('', filter);
    setCustomers(cList);
  };

  const openSaleModal = (customer: CustomerRecord, type: 'sale' | 'order' | 'return') => {
    Keyboard.dismiss();

    // If salesman attempts a Direct Van Sale, verify van has active loaded stock
    if (type === 'sale') {
      const freshV = getVanStocks();
      const totalUnits = freshV.reduce((sum, s) => sum + (Number(s.total_qty) || 0), 0);
      if (freshV.length === 0 || totalUnits <= 0) {
        Alert.alert(
          'No Stock in Van',
          'Your van currently has no stock loaded. Direct sales cannot be recorded until stock is loaded from the Warehouse. Please load van inventory first.',
          [{ text: 'OK' }]
        );
        return;
      }
    }

    setSelectedCustomer(customer);
    setSelectedCustomerId(customer.id);
    setCustomerName(customer.name);
    setCustomerPlace(customer.place || customer.route_area || customer.address || '');
    setSaleType(type);
    setItemLooseQuantities({});
    setItemBagQuantities({});
    setCustomLooseRates({});
    setCustomBagRates({});
    setItemDiscounts({});
    setItemDiscountTypes({});
    setCustomAdvance('');
    setNotes('');
    setAcceptedFreeRewards({});
    setAcceptedDiscountSchemes({});
    setIsSchemeBannerMinimized(false);
    setStockSearch('');
    setWarehouseFilter('All Warehouses');
    setModalStep('form');
    setIsHistoryPreview(false);
    setPreviewInvoice(null);
    setReturnReason('');
    setIsRefundable(true);
    setRefundAmount('');
    setRefundMode('Cash');
    setModalVisible(true);

    try {
      const freshW = getWarehouseStocks();
      setWarehouseStocks(freshW);
      const freshV = getVanStocks();
      setVanStocks(freshV);
    } catch {}
  };

  const handleStartDirectSale = () => {
    const freshV = getVanStocks();
    const totalUnits = freshV.reduce((sum, s) => sum + (Number(s.total_qty) || 0), 0);
    if (freshV.length === 0 || totalUnits <= 0) {
      Alert.alert(
        'No Stock in Van',
        'Your van currently has no stock loaded. Direct sales cannot be recorded until stock is loaded from the Warehouse. Please load van inventory first.',
        [{ text: 'OK' }]
      );
      return;
    }
    const currentRoute = getSelectedRoute();
    const filter = currentRoute === 'All Routes' ? '' : currentRoute;
    const freshC = getCustomers('', filter);
    setCustomers(freshC);
    setCustomerSearch('');
    setSelectorTargetType('sale');
    setCustomerSelectorVisible(true);
  };

  const openPaymentModal = (customer: CustomerRecord, due: number) => {
    setPaymentCustomer(customer);
    setPaymentTotalDue(due);
    setPaymentAmountInput(String(due));
    setPaymentMode('Cash');
    setPaymentNotes('');
    setPaymentModalVisible(true);
  };

  const handleConfirmPayment = () => {
    const amount = parseFloat(paymentAmountInput);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than 0.');
      return;
    }
    if (!paymentCustomer) return;

    try {
      recordCustomerPayment(
        paymentCustomer.id,
        paymentCustomer.name,
        amount,
        paymentMode,
        paymentNotes.trim(),
        user?.id || assignedRoute?.salesman_id || undefined,
        user?.name || assignedRoute?.salesman_name || 'Sales Representative'
      );
      setPaymentModalVisible(false);
      loadData();
      sendImmediateLocationPing().catch(() => {});
      triggerImmediateSync('customer_payment');
      Alert.alert(
        'Payment Received!',
        `Successfully collected ₹${amount.toFixed(2)} via ${paymentMode} from ${paymentCustomer.name}. Outstanding balance updated.`
      );
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to record payment receipt');
    }
  };

  const effectiveWarehouseStocks = warehouseStocks;
  const effectiveVanStocks = vanStocks;

  // Consolidate warehouse stocks for Orders into unique catalog products without duplicate warehouse rows
  const consolidatedOrderStocks = (() => {
    const map = new Map<string, any>();
    for (const ws of effectiveWarehouseStocks) {
      const pid = String(ws.product_id || ws.product_name);
      if (!map.has(pid)) {
        map.set(pid, {
          ...ws,
          id: `ord_prod_${ws.product_id}`,
          available_quantity: Number(ws.available_quantity) || Number(ws.quantity) || 0,
          quantity: Number(ws.quantity) || 0,
        });
      } else {
        const item = map.get(pid);
        item.available_quantity += Number(ws.available_quantity) || Number(ws.quantity) || 0;
        item.quantity += Number(ws.quantity) || 0;
      }
    }
    return Array.from(map.values());
  })();

  const activeStockList = saleType === 'order'
    ? consolidatedOrderStocks
    : saleType === 'return'
    ? effectiveWarehouseStocks
    : effectiveVanStocks;

  const getStockKey = (stock: any): string => {
    if (saleType === 'order') {
      return `ord_${stock.product_id || stock.id}`;
    }
    if (stock.warehouse_name !== undefined || stock.warehouse_id !== undefined) {
      return `ws_${stock.id}`;
    }
    return String(stock.allocation_id || stock.product_id);
  };

  const resolveStockPackageType = (stock: any): string => {
    const raw = stock?.package_type;
    if (!raw || ['loose', 'unit', 'pcs', 'piece', 'pieces'].includes(String(raw).trim().toLowerCase())) {
      return (stock as any)?.product_package_type || (stock as any)?.packaging_type || 'Bag';
    }
    return String(raw);
  };

  const resolveStockUnitLabel = (stock: any): string => {
    const raw = (stock as any)?.unit;
    if (!raw || ['bag', 'box', 'carton', 'loose'].includes(String(raw).trim().toLowerCase())) {
      return 'Pcs';
    }
    return String(raw);
  };

  const availableWarehouses = Array.from(
    new Set(effectiveWarehouseStocks.map(s => s.warehouse_name).filter(Boolean))
  );

  const filteredModalStocks = activeStockList.filter(stock => {
    const s = stock as any;
    if (saleType === 'return' && warehouseFilter !== 'All Warehouses') {
      if (s.warehouse_name !== warehouseFilter) return false;
    }
    if (!stockSearch.trim()) return true;
    const term = stockSearch.toLowerCase().trim();
    const nameMatch = (stock.product_name || '').toLowerCase().includes(term);
    const skuMatch = (stock.product_sku || '').toLowerCase().includes(term);
    const catMatch = (stock.category_name || '').toLowerCase().includes(term);
    const whMatch = (s.warehouse_name || '').toLowerCase().includes(term);
    return nameMatch || skuMatch || catMatch || whMatch;
  });

  const getProductDefaultRate = (stock: any, mode?: 'loose' | 'box'): number => {
    const unitMode = mode || 'loose';
    const itemsPerPkg = Math.max(1, Number(stock.items_per_package) || 1);
    const pid = Number(stock.product_id);
    const custGroupId = selectedCustomer?.price_group_id;

    let groupPiecePrice: number | null = null;
    let groupBoxPrice: number | null = null;
    if (custGroupId && pid && productSellingPrices.length > 0) {
      const match = productSellingPrices.find(p => Number(p.product_id) === pid && Number(p.group_id) === Number(custGroupId));
      if (match) {
        if (Number(match.price) > 0) groupPiecePrice = Number(match.price);
        if (Number(match.box_price) > 0) groupBoxPrice = Number(match.box_price);
      }
    }

    const basePiecePrice = groupPiecePrice !== null 
      ? groupPiecePrice 
      : Number(stock.unit_price || stock.selling_price || stock.unit_cost || 0);

    const baseBoxPrice = groupBoxPrice !== null
      ? groupBoxPrice
      : (Number(stock.box_price) > 0 ? Number(stock.box_price) : (basePiecePrice * itemsPerPkg));

    return unitMode === 'box' ? baseBoxPrice : basePiecePrice;
  };

  const getProductLooseRate = (stock: any): number => {
    const key = getStockKey(stock);
    const defaultRate = getProductDefaultRate(stock, 'loose');
    if (customLooseRates[key] !== undefined && customLooseRates[key].trim() !== '') {
      const parsed = parseFloat(customLooseRates[key]);
      return isNaN(parsed) ? defaultRate : parsed;
    }
    return defaultRate;
  };

  const getProductBagRate = (stock: any): number => {
    const key = getStockKey(stock);
    const defaultRate = getProductDefaultRate(stock, 'box');
    if (customBagRates[key] !== undefined && customBagRates[key].trim() !== '') {
      const parsed = parseFloat(customBagRates[key]);
      return isNaN(parsed) ? defaultRate : parsed;
    }
    return defaultRate;
  };

  const updateCustomLooseRate = (key: string, val: string) => {
    setCustomLooseRates(prev => ({
      ...prev,
      [key]: val,
    }));
  };

  const updateCustomBagRate = (key: string, val: string) => {
    setCustomBagRates(prev => ({
      ...prev,
      [key]: val,
    }));
  };

  const updateLooseQuantity = (key: string, delta: number) => {
    const stock = activeStockList.find(s => getStockKey(s) === key) as any;
    const availableStockCount = stock
      ? (stock.available_quantity !== undefined ? Number(stock.available_quantity) : Number(stock.quantity || stock.total_qty || 0))
      : 0;

    if (saleType === 'sale' && availableStockCount <= 0 && delta > 0) {
      Alert.alert('Out of Stock', 'This item is out of stock in your van and cannot be added to Sales.');
      return;
    }

    const itemsPerPkg = Math.max(1, Number(stock?.items_per_package) || 1);
    const currentLoose = itemLooseQuantities[key] || 0;
    const currentBag = itemBagQuantities[key] || 0;
    const currentUsedPieces = (currentBag * itemsPerPkg) + currentLoose;

    if (saleType === 'sale' && delta > 0 && currentUsedPieces + delta > availableStockCount) {
      const remainingPieces = Math.max(0, availableStockCount - currentUsedPieces);
      Alert.alert(
        'Stock Limit Reached',
        `You cannot add more loose units. Available remaining stock in your van is ${remainingPieces} ${stock?.unit || 'Pcs'}.`
      );
      return;
    }

    const maxStock = saleType === 'return' || saleType === 'order'
      ? 99999
      : Math.max(0, availableStockCount - (currentBag * itemsPerPkg));

    setItemLooseQuantities(prev => {
      const next = Math.max(0, Math.min(maxStock, (prev[key] || 0) + delta));
      return { ...prev, [key]: next };
    });
  };

  const setDirectLooseQuantity = (key: string, val: string) => {
    const num = parseInt(val, 10);
    const stock = activeStockList.find(s => getStockKey(s) === key) as any;
    const availableStockCount = stock
      ? (stock.available_quantity !== undefined ? Number(stock.available_quantity) : Number(stock.quantity || stock.total_qty || 0))
      : 0;

    if (saleType === 'sale' && availableStockCount <= 0 && num > 0) {
      Alert.alert('Out of Stock', 'This item is out of stock in your van and cannot be added to Sales.');
      return;
    }

    const itemsPerPkg = Math.max(1, Number(stock?.items_per_package) || 1);
    const currentBag = itemBagQuantities[key] || 0;
    const maxStock = saleType === 'return' || saleType === 'order'
      ? 99999
      : Math.max(0, availableStockCount - (currentBag * itemsPerPkg));

    setItemLooseQuantities(prev => ({
      ...prev,
      [key]: isNaN(num) ? 0 : Math.max(0, Math.min(maxStock, num)),
    }));
  };

  const updateBagQuantity = (key: string, delta: number) => {
    const stock = activeStockList.find(s => getStockKey(s) === key) as any;
    const availableStockCount = stock
      ? (stock.available_quantity !== undefined ? Number(stock.available_quantity) : Number(stock.quantity || stock.total_qty || 0))
      : 0;

    if (saleType === 'sale' && availableStockCount <= 0 && delta > 0) {
      Alert.alert('Out of Stock', 'This item is out of stock in your van and cannot be added to Sales.');
      return;
    }

    const itemsPerPkg = Math.max(1, Number(stock?.items_per_package) || 1);
    const currentLoose = itemLooseQuantities[key] || 0;
    const currentBag = itemBagQuantities[key] || 0;
    const currentUsedPieces = (currentBag * itemsPerPkg) + currentLoose;

    if (saleType === 'sale' && delta > 0 && currentUsedPieces + (delta * itemsPerPkg) > availableStockCount) {
      const remainingPieces = Math.max(0, availableStockCount - currentUsedPieces);
      const pkgName = stock?.package_type || 'Bag';
      Alert.alert(
        'Insufficient Bag Stock',
        `You have ${remainingPieces} ${stock?.unit || 'Pcs'} remaining, which is less than 1 full ${pkgName} (${itemsPerPkg} ${stock?.unit || 'Pcs'}). You can enter the remaining stock under Loose Quantity.`
      );
      return;
    }

    const maxBags = saleType === 'return' || saleType === 'order'
      ? 99999
      : Math.max(0, Math.floor((availableStockCount - currentLoose) / itemsPerPkg));

    setItemBagQuantities(prev => {
      const next = Math.max(0, Math.min(maxBags, (prev[key] || 0) + delta));
      return { ...prev, [key]: next };
    });
  };

  const setDirectBagQuantity = (key: string, val: string) => {
    const num = parseInt(val, 10);
    const stock = activeStockList.find(s => getStockKey(s) === key) as any;
    const availableStockCount = stock
      ? (stock.available_quantity !== undefined ? Number(stock.available_quantity) : Number(stock.quantity || stock.total_qty || 0))
      : 0;

    if (saleType === 'sale' && availableStockCount <= 0 && num > 0) {
      Alert.alert('Out of Stock', 'This item is out of stock in your van and cannot be added to Sales.');
      return;
    }

    const itemsPerPkg = Math.max(1, Number(stock?.items_per_package) || 1);
    const currentLoose = itemLooseQuantities[key] || 0;
    const maxBags = saleType === 'return' || saleType === 'order'
      ? 99999
      : Math.max(0, Math.floor((availableStockCount - currentLoose) / itemsPerPkg));

    setItemBagQuantities(prev => ({
      ...prev,
      [key]: isNaN(num) ? 0 : Math.max(0, Math.min(maxBags, num)),
    }));
  };

  const getItemDiscountInfo = (stock: any, lineGross: number) => {
    const key = getStockKey(stock);
    const rawVal = itemDiscounts[key];
    const type = itemDiscountTypes[key] || 'amount';
    if (!rawVal || rawVal.trim() === '' || lineGross <= 0) {
      return { discVal: 0, discType: type, discAmt: 0, percent: 0, isDiscounted: false };
    }
    const parsed = parseFloat(rawVal);
    if (isNaN(parsed) || parsed <= 0) {
      return { discVal: 0, discType: type, discAmt: 0, percent: 0, isDiscounted: false };
    }

    let discAmt = 0;
    let percent = 0;

    if (type === 'percent') {
      percent = Math.min(100, Math.max(0, parsed));
      discAmt = Math.round((lineGross * (percent / 100)) * 100) / 100;
    } else {
      discAmt = Math.min(lineGross, Math.max(0, parsed));
      percent = lineGross > 0 ? Math.round((discAmt / lineGross) * 10000) / 100 : 0;
    }

    return {
      discVal: parsed,
      discType: type,
      discAmt,
      percent,
      isDiscounted: discAmt > 0,
    };
  };

  const updateItemDiscount = (key: string, val: string) => {
    setItemDiscounts(prev => ({
      ...prev,
      [key]: val,
    }));
  };

  const toggleItemDiscountType = (key: string) => {
    setItemDiscountTypes(prev => {
      const current = prev[key] || 'amount';
      return {
        ...prev,
        [key]: current === 'amount' ? 'percent' : 'amount',
      };
    });
  };

  const calculateBill = () => {
    let totalUnits = 0;
    let totalBags = 0;
    let totalLoose = 0;
    let subtotalGross = 0;
    let totalDiscount = 0;
    const cartItemsForScheme: Array<{
      product_id: string | number;
      product_name: string;
      qty: number;
      bag_qty: number;
      loose_qty: number;
      package_type: string;
      unit: string;
      unit_price: number;
      rate: number;
      total: number;
      items_per_package: number;
    }> = [];

    for (const stock of activeStockList) {
      const key = getStockKey(stock);
      const looseQty = itemLooseQuantities[key] || 0;
      const bagQty = itemBagQuantities[key] || 0;
      if (looseQty > 0 || bagQty > 0) {
        const looseRate = getProductLooseRate(stock);
        const bagRate = getProductBagRate(stock);
        const lineGross = (looseQty * looseRate) + (bagQty * bagRate);
        const discInfo = getItemDiscountInfo(stock, lineGross);
        const itemsPerPkg = Math.max(1, Number(stock.items_per_package) || 1);
        const totalPieces = (bagQty * itemsPerPkg) + looseQty;

        totalUnits += (looseQty + bagQty);
        totalBags += bagQty;
        totalLoose += looseQty;
        subtotalGross += lineGross;
        totalDiscount += discInfo.discAmt;

        cartItemsForScheme.push({
          product_id: stock.product_id != null && String(stock.product_id).trim() !== '' ? stock.product_id : (stock.id ? String(stock.id).replace('ord_prod_', '') : ''),
          product_name: stock.product_name,
          qty: totalPieces,
          bag_qty: bagQty,
          loose_qty: looseQty,
          package_type: resolveStockPackageType(stock),
          unit: resolveStockUnitLabel(stock),
          unit_price: looseRate,
          rate: looseRate,
          total: lineGross,
          items_per_package: itemsPerPkg,
        });
      }
    }

    const rawSchemeEval = evaluateLocalSchemes(cartItemsForScheme, subtotalGross);
    const qualifiedSchemes = rawSchemeEval?.qualifiedSchemes || [];
    const qualifiedSchemeIdSet = new Set(qualifiedSchemes.map(qs => qs.scheme_id));

    // Calculate scheme discount only for schemes that the user has explicitly activated
    const schemeDiscount = qualifiedSchemes.reduce((sum, qs) => {
      if (qs.reward_type === 'DISCOUNT' && acceptedDiscountSchemes[qs.scheme_id]) {
        return sum + (Number(qs.discount_amount) || 0);
      }
      return sum;
    }, 0);

    const activeFreeItems = (rawSchemeEval?.freeItems || []).filter(
      fi => fi.scheme_id != null && Boolean(acceptedFreeRewards[fi.scheme_id]) && qualifiedSchemeIdSet.has(fi.scheme_id)
    );

    const schemeEval: SchemeEvaluationResult = {
      ...rawSchemeEval,
      qualifiedSchemes,
      freeItems: activeFreeItems,
      totalDiscount: schemeDiscount,
    };
    const combinedDiscount = totalDiscount + schemeDiscount;

    const netBeforeRound = Math.max(0, subtotalGross - combinedDiscount);
    // Automatic, non-editable round off
    const totalAmount = Math.round(netBeforeRound);
    const roundOff = Math.round((totalAmount - netBeforeRound) * 100) / 100;

    return {
      totalUnits,
      totalBags,
      totalLoose,
      subtotalGross,
      totalDiscount: combinedDiscount,
      manualDiscount: totalDiscount,
      schemeDiscount,
      schemeEval,
      netBeforeRound,
      roundOff,
      totalAmount,
    };
  };

  const {
    totalUnits,
    totalBags,
    totalLoose,
    subtotalGross,
    totalDiscount,
    manualDiscount,
    schemeDiscount,
    schemeEval,
    netBeforeRound,
    roundOff,
    totalAmount,
  } = calculateBill();

  const handleAddFreeReward = (scheme: QualifiedSchemeItem) => {
    if (scheme.freeItem) {
      setAcceptedFreeRewards(prev => ({
        ...prev,
        [scheme.scheme_id]: scheme.freeItem!,
      }));
    }
  };

  const handleRemoveFreeReward = (schemeId: number) => {
    setAcceptedFreeRewards(prev => {
      const copy = { ...prev };
      delete copy[schemeId];
      return copy;
    });
  };

  const handleApplyDiscountScheme = (schemeId: number) => {
    setAcceptedDiscountSchemes(prev => ({
      ...prev,
      [schemeId]: true,
    }));
  };

  const handleRemoveDiscountScheme = (schemeId: number) => {
    setAcceptedDiscountSchemes(prev => {
      const copy = { ...prev };
      delete copy[schemeId];
      return copy;
    });
  };

  const selectedProductCount = activeStockList.filter(s => {
    const k = getStockKey(s);
    return (itemLooseQuantities[k] || 0) > 0 || (itemBagQuantities[k] || 0) > 0;
  }).length;

  const summaryQtyText = (() => {
    if (totalBags > 0 && totalLoose > 0) {
      return `${totalBags} Bag${totalBags > 1 ? 's' : ''} + ${totalLoose} Loose`;
    }
    if (totalBags > 0) {
      return `${totalBags} Bag${totalBags > 1 ? 's' : ''}`;
    }
    if (totalLoose > 0) {
      return `${totalLoose} Loose Unit${totalLoose > 1 ? 's' : ''}`;
    }
    return '0 Units';
  })();
  const parsedAdvance = customAdvance.trim() !== ''
    ? parseFloat(customAdvance) || 0
    : (saleType === 'sale' || saleType === 'return' ? totalAmount : 0);
  const balanceAmount = Math.max(0, totalAmount - parsedAdvance);

  const parseGstRate = (raw: any): number => {
    if (raw == null) return 18;
    if (typeof raw === 'number') return raw;
    const str = String(raw).trim();
    const match = str.match(/(\d+(\.\d+)?)\s*%/);
    if (match) return parseFloat(match[1]);
    const parsed = parseFloat(str);
    return isNaN(parsed) || parsed < 0 ? 18 : parsed;
  };

  const buildInvoiceData = (isDraft: boolean): MobileInvoiceData | null => {
    const currentCustomer =
      selectedCustomer ||
      customers.find(c => c.id === selectedCustomerId) ||
      customers.find(c => c.name.toLowerCase() === customerName.toLowerCase());

    const rawGst = (
      selectedCustomer?.gst_in ||
      currentCustomer?.gst_in ||
      (currentCustomer as any)?.gst_number ||
      (currentCustomer as any)?.customer_gst ||
      ''
    ).trim();

    const hasCustomerGst = Boolean(
      rawGst &&
      rawGst.length >= 3 &&
      !['URP', 'NON-GST', 'NIL', 'NONE', 'UNDEFINED', 'NULL'].includes(rawGst.toUpperCase())
    );

    const itemsToInvoice: InvoiceItem[] = [];
    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalGst = 0;

    for (const stock of activeStockList) {
      const key = getStockKey(stock);
      const looseQty = itemLooseQuantities[key] || 0;
      const bagQty = itemBagQuantities[key] || 0;
      if (looseQty > 0 || bagQty > 0) {
        const looseRate = getProductLooseRate(stock);
        const bagRate = getProductBagRate(stock);
        const whName = (stock as any).warehouse_name;
        const lineGross = (looseQty * looseRate) + (bagQty * bagRate);
        const discInfo = getItemDiscountInfo(stock, lineGross);
        const pkgType = resolveStockPackageType(stock);
        const unitLabel = resolveStockUnitLabel(stock);
        const itemsPerPkg = Math.max(1, Number(stock.items_per_package) || 1);
        const gstRate = parseGstRate((stock as any).gst_rate);
        const cgstRate = gstRate / 2;
        const sgstRate = gstRate / 2;

        let bagDiscAmt = 0;
        let looseDiscAmt = 0;
        if (bagQty > 0 && looseQty > 0) {
          bagDiscAmt = lineGross > 0 ? Math.round((discInfo.discAmt * ((bagQty * bagRate) / lineGross)) * 100) / 100 : 0;
          looseDiscAmt = Math.max(0, Math.round((discInfo.discAmt - bagDiscAmt) * 100) / 100);
        } else if (bagQty > 0) {
          bagDiscAmt = discInfo.discAmt;
        } else {
          looseDiscAmt = discInfo.discAmt;
        }

        const pushItem = (
          qty: number,
          rate: number,
          pkgT: string,
          uLabel: string,
          discAmt: number,
          gross: number,
          itemMrp?: number
        ) => {
          const itemTotal = Math.max(0, gross - discAmt);
          let taxable = itemTotal;
          let cgstAmt = 0;
          let sgstAmt = 0;
          let itmGst = 0;

          if (hasCustomerGst && gstRate > 0) {
            taxable = Math.round((itemTotal / (1 + (gstRate / 100))) * 100) / 100;
            itmGst = Math.round((itemTotal - taxable) * 100) / 100;
            cgstAmt = Math.round((itmGst / 2) * 100) / 100;
            sgstAmt = Math.round((itmGst - cgstAmt) * 100) / 100;

            totalTaxable += taxable;
            totalCgst += cgstAmt;
            totalSgst += sgstAmt;
            totalGst += itmGst;
          } else {
            totalTaxable += itemTotal;
          }

          itemsToInvoice.push({
            product_id: stock.product_id,
            product_name: stock.product_name,
            product_sku: stock.product_sku,
            hsn_code: (stock as any).hsn_code || '',
            package_type: pkgT,
            unit: uLabel,
            qty,
            unit_price: rate,
            mrp: (itemMrp != null && itemMrp > 0) ? itemMrp : rate,
            discount: discInfo.percent,
            discount_amount: discAmt,
            total: itemTotal,
            gst_rate: gstRate,
            cgst_rate: cgstRate,
            sgst_rate: sgstRate,
            cgst_amount: cgstAmt,
            sgst_amount: sgstAmt,
            total_gst: itmGst,
            taxable_amount: taxable,
            items_per_package: itemsPerPkg,
          });
        };

        const pieceMrp = Number((stock as any).mrp) > 0 ? Number((stock as any).mrp) : looseRate;
        const bagMrp = Number((stock as any).box_mrp) > 0 
          ? Number((stock as any).box_mrp) 
          : (pieceMrp * itemsPerPkg || bagRate);

        if (bagQty > 0) {
          pushItem(bagQty, bagRate, pkgType, pkgType, bagDiscAmt, bagQty * bagRate, bagMrp);
        }
        if (looseQty > 0) {
          pushItem(looseQty, looseRate, 'Loose', unitLabel, looseDiscAmt, looseQty * looseRate, pieceMrp);
        }
      }
    }

    // Include accepted free scheme rewards in invoice preview & print
    const qualifiedSchemeIdSet = new Set(schemeEval?.qualifiedSchemes.map(qs => qs.scheme_id) || []);
    Object.entries(acceptedFreeRewards).forEach(([sIdStr, freeItem]) => {
      if (!qualifiedSchemeIdSet.has(Number(sIdStr))) return;
      itemsToInvoice.push({
        product_id: freeItem.product_id ? String(freeItem.product_id) : '',
        product_name: `${freeItem.product_name} (Free Scheme Reward)`,
        product_sku: freeItem.product_sku || '',
        hsn_code: '',
        package_type: freeItem.package_type || 'Loose',
        unit: freeItem.unit || 'Pcs',
        qty: freeItem.qty,
        unit_price: 0,
        mrp: 0,
        discount: 0,
        discount_amount: 0,
        total: 0,
        gst_rate: 0,
        cgst_rate: 0,
        sgst_rate: 0,
        cgst_amount: 0,
        sgst_amount: 0,
        total_gst: 0,
        taxable_amount: 0,
        items_per_package: 1,
      });
    });

    if (itemsToInvoice.length === 0) {
      return null;
    }

    const netGross = Math.max(0, subtotalGross - totalDiscount);
    const discFactor = subtotalGross > 0 ? (netGross / subtotalGross) : 1;
    let finalTaxable = 0;
    let finalCgst = 0;
    let finalSgst = 0;
    let finalGst = 0;

    if (hasCustomerGst) {
      itemsToInvoice.forEach(it => {
        const discountedTotal = it.total * discFactor;
        const gRate = it.gst_rate || 0;
        if (gRate > 0) {
          const itTaxable = Math.round((discountedTotal / (1 + gRate / 100)) * 100) / 100;
          const itGst = Math.round((discountedTotal - itTaxable) * 100) / 100;
          const itCgst = Math.round((itGst / 2) * 100) / 100;
          const itSgst = Math.round((itGst - itCgst) * 100) / 100;
          finalTaxable += itTaxable;
          finalCgst += itCgst;
          finalSgst += itSgst;
          finalGst += itGst;
        } else {
          finalTaxable += discountedTotal;
        }
      });
      finalTaxable = Math.round(finalTaxable * 100) / 100;
      finalCgst = Math.round(finalCgst * 100) / 100;
      finalSgst = Math.round(finalSgst * 100) / 100;
      finalGst = Math.round(finalGst * 100) / 100;
    } else {
      finalTaxable = netGross;
    }

    const dateStr = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const salesman = assignedRoute?.salesman_name || user?.name || 'Sales Representative';

    // Document number generation:
    // GST: SalesmanID-INV-XXXX, Non-GST: SalesmanID-RET-XXXX, Orders: SalesmanID-ORD-XXXX, Returns: RET-2026-XXXX
    const invNo = previewInvoice?.invoice_number || getNextDocumentCode(saleType, { isGst: hasCustomerGst, salesman });

    return {
      invoice_number: invNo,
      invoice_date: dateStr,
      customer_name: customerName || 'Retail Customer',
      customer_code: currentCustomer?.customer_code || undefined,
      customer_place: customerPlace || currentCustomer?.place || undefined,
      customer_phone: currentCustomer?.phone || selectedCustomer?.phone || (currentCustomer as any)?.mobile || undefined,
      customer_gst: hasCustomerGst ? rawGst : undefined,
      salesman_name: salesman,
      salesman_phone: assignedRoute?.salesman_phone || (user as any)?.phone || '',
      vehicle_reg_no: assignedRoute?.vehicle_reg_no || '',
      route_name: selectedRoute,
      items: itemsToInvoice,
      subtotal: subtotalGross,
      subtotal_gross: subtotalGross,
      discount_amount: totalDiscount,
      round_off: roundOff,
      grand_total: totalAmount,
      paid_amount: parsedAdvance,
      balance_due: balanceAmount,
      payment_mode: 'Cash',
      notes: notes.trim() || undefined,
      is_draft: isDraft,
      order_type: saleType,
      company: companyProfile,
      has_gst: hasCustomerGst,
      total_taxable: finalTaxable,
      total_cgst: finalCgst,
      total_sgst: finalSgst,
      total_gst: finalGst,
    };
  };

  const handleOpenInvoicePreview = () => {
    Keyboard.dismiss();
    if (totalUnits <= 0) {
      Alert.alert('No Items Selected', 'Please select at least 1 unit using the + button on a product to preview or print invoice.');
      return;
    }
    const inv = buildInvoiceData(true);
    if (!inv) return;
    setPreviewInvoice(inv);
    setIsHistoryPreview(false);
    setModalStep('preview');
  };

  const handleConfirmPrint = async () => {
    if (!previewInvoice) return;
    const inv = previewInvoice;
    const isHistory = isHistoryPreview;
    try {
      setIsPrinting(true);
      await printInvoice(inv);
      if (!isHistory) {
        executeDirectSalePersist();
      }
    } catch (e: any) {
      const errStr = (e?.message || e?.reason || e?.toString() || '').toLowerCase();
      const errName = (e?.name || '').toLowerCase();
      const isCancelled =
        errName.includes('printcancelled') ||
        errName.includes('cancel') ||
        errStr.includes('cancel') ||
        errStr.includes('complete') ||
        errStr.includes('incomplete') ||
        errStr.includes('dismiss') ||
        errStr.includes('abort') ||
        errStr.includes('back') ||
        errStr.includes('picker') ||
        e?.code === 'E_PRINT_CANCELLED' ||
        e?.code === 'PRINT_CANCELLED';

      const isSetupNeeded =
        errStr.includes('printer setup') ||
        errStr.includes('bluetooth') ||
        errStr.includes('connect your printer');

      if (!isHistory) {
        const buttons: any[] = [
          { text: 'Keep in Cart', style: 'cancel' },
        ];
        if (isSetupNeeded) {
          buttons.push({
            text: 'Printer Setup',
            onPress: () => router.push('/settings'),
          });
        }
        buttons.push({
          text: 'Save Without Printing',
          onPress: () => executeDirectSalePersist(),
        });

        Alert.alert(
          'Invoice Not Printed',
          isCancelled
            ? 'Print operation was canceled. Would you like to record and save this transaction anyway?'
            : `${e.message || 'Printer not connected'}. Would you like to save this transaction anyway?`,
          buttons
        );
      } else {
        if (!isCancelled) {
          const buttons: any[] = [{ text: 'OK' }];
          if (isSetupNeeded) {
            buttons.unshift({
              text: 'Printer Setup',
              onPress: () => router.push('/settings'),
            });
          }
          Alert.alert('Print Error', e.message || 'Could not print invoice. Please check printer connection.', buttons);
        }
      }
    } finally {
      setIsPrinting(false);
    }
  };

  const handleStopPrinting = () => {
    abortActivePrint();
    setIsPrinting(false);
    if (!isHistoryPreview) {
      Alert.alert(
        'Printing Stopped',
        'Print operation was stopped. Would you like to record and save this transaction without printing?',
        [
          { text: 'Keep in Cart', style: 'cancel' },
          {
            text: 'Save Without Printing',
            onPress: () => executeDirectSalePersist(),
          },
        ]
      );
    } else {
      Alert.alert('Print Stopped', 'The print operation was stopped.');
    }
  };

  const handleSharePdf = async () => {
    if (!previewInvoice) return;
    try {
      setIsSharing(true);
      await shareInvoicePdf(previewInvoice);
    } catch (e: any) {
      Alert.alert('Share Error', e.message || 'Could not generate or share PDF.');
    } finally {
      setIsSharing(false);
    }
  };

  const handleConfirmWithoutPrint = () => {
    executeDirectSalePersist();
  };

  const executeDirectSalePersist = () => {
    try {
      const currentCustomer =
        selectedCustomer ||
        customers.find(c => c.id === selectedCustomerId) ||
        customers.find(c => c.name.toLowerCase() === customerName.toLowerCase());

      const rawGst = (
        selectedCustomer?.gst_in ||
        currentCustomer?.gst_in ||
        (currentCustomer as any)?.gst_number ||
        (currentCustomer as any)?.customer_gst ||
        ''
      ).trim();

      const hasCustomerGst = Boolean(
        rawGst &&
        rawGst.length >= 3 &&
        !['URP', 'NON-GST', 'NIL', 'NONE', 'UNDEFINED', 'NULL'].includes(rawGst.toUpperCase())
      );

      const selectedItems: Array<{
        product_id: string | number;
        product_name: string;
        product_sku?: string;
        hsn_code?: string;
        warehouse_name?: string;
        warehouse_id?: string | number;
        package_type?: string;
        unit?: string;
        gst_rate?: string | number;
        cgst_rate?: number;
        sgst_rate?: number;
        cgst_amount?: number;
        sgst_amount?: number;
        total_gst?: number;
        taxable_amount?: number;
        qty: number;
        unit_price: number;
        mrp?: number;
        discount?: number;
        discount_amount?: number;
        total: number;
        items_per_package?: number;
        total_pieces?: number;
      }> = [];

      for (const stock of activeStockList) {
        const key = getStockKey(stock);
        const looseQty = itemLooseQuantities[key] || 0;
        const bagQty = itemBagQuantities[key] || 0;
        if (looseQty > 0 || bagQty > 0) {
          const looseRate = getProductLooseRate(stock);
          const bagRate = getProductBagRate(stock);
          const whName = (stock as any).warehouse_name;
          const whId = (stock as any).warehouse_id;
          const lineGross = (looseQty * looseRate) + (bagQty * bagRate);
          const discInfo = getItemDiscountInfo(stock, lineGross);
          const pkgType = resolveStockPackageType(stock);
          const unitLabel = resolveStockUnitLabel(stock);
          const itemsPerPkg = Math.max(1, Number(stock.items_per_package) || 1);

          let bagDiscAmt = 0;
          let looseDiscAmt = 0;
          if (bagQty > 0 && looseQty > 0) {
            bagDiscAmt = lineGross > 0 ? Math.round((discInfo.discAmt * ((bagQty * bagRate) / lineGross)) * 100) / 100 : 0;
            looseDiscAmt = Math.max(0, Math.round((discInfo.discAmt - bagDiscAmt) * 100) / 100);
          } else if (bagQty > 0) {
            bagDiscAmt = discInfo.discAmt;
          } else {
            looseDiscAmt = discInfo.discAmt;
          }

          const pieceMrp = Number((stock as any).mrp) > 0 ? Number((stock as any).mrp) : looseRate;
          const bagMrp = Number((stock as any).box_mrp) > 0 
            ? Number((stock as any).box_mrp) 
            : (pieceMrp * itemsPerPkg || bagRate);

          if (bagQty > 0) {
            const bagTotal = Math.max(0, (bagQty * bagRate) - bagDiscAmt);
            const bagGstRate = parseGstRate((stock as any).gst_rate);
            const bagTaxable = (hasCustomerGst && bagGstRate > 0)
              ? Math.round((bagTotal / (1 + (bagGstRate / 100))) * 100) / 100
              : bagTotal;
            const bagGstAmt = (hasCustomerGst && bagGstRate > 0)
              ? Math.round((bagTotal - bagTaxable) * 100) / 100
              : 0;
            const bagCgst = Math.round((bagGstAmt / 2) * 100) / 100;
            const bagSgst = Math.round((bagGstAmt - bagCgst) * 100) / 100;

            selectedItems.push({
              product_id: stock.product_id || '',
              product_name: stock.product_name,
              product_sku: stock.product_sku || '',
              hsn_code: (stock as any).hsn_code || '',
              warehouse_name: whName || '',
              warehouse_id: whId || '',
              package_type: pkgType,
              unit: pkgType,
              gst_rate: (stock as any).gst_rate || '18%',
              cgst_rate: bagGstRate / 2,
              sgst_rate: bagGstRate / 2,
              cgst_amount: bagCgst,
              sgst_amount: bagSgst,
              total_gst: bagGstAmt,
              taxable_amount: bagTaxable,
              qty: bagQty,
              unit_price: bagRate,
              mrp: bagMrp,
              discount: discInfo.percent,
              discount_amount: bagDiscAmt,
              total: bagTotal,
              items_per_package: itemsPerPkg,
              total_pieces: bagQty * itemsPerPkg,
            });
          }

          if (looseQty > 0) {
            const looseTotal = Math.max(0, (looseQty * looseRate) - looseDiscAmt);
            const looseGstRate = parseGstRate((stock as any).gst_rate);
            const looseTaxable = (hasCustomerGst && looseGstRate > 0)
              ? Math.round((looseTotal / (1 + (looseGstRate / 100))) * 100) / 100
              : looseTotal;
            const looseGstAmt = (hasCustomerGst && looseGstRate > 0)
              ? Math.round((looseTotal - looseTaxable) * 100) / 100
              : 0;
            const looseCgst = Math.round((looseGstAmt / 2) * 100) / 100;
            const looseSgst = Math.round((looseGstAmt - looseCgst) * 100) / 100;

            selectedItems.push({
              product_id: stock.product_id || '',
              product_name: stock.product_name,
              product_sku: stock.product_sku || '',
              hsn_code: (stock as any).hsn_code || '',
              warehouse_name: whName || '',
              warehouse_id: whId || '',
              package_type: 'Loose',
              unit: unitLabel,
              gst_rate: (stock as any).gst_rate || '18%',
              cgst_rate: looseGstRate / 2,
              sgst_rate: looseGstRate / 2,
              cgst_amount: looseCgst,
              sgst_amount: looseSgst,
              total_gst: looseGstAmt,
              taxable_amount: looseTaxable,
              qty: looseQty,
              unit_price: looseRate,
              mrp: pieceMrp,
              discount: discInfo.percent,
              discount_amount: looseDiscAmt,
              total: looseTotal,
              items_per_package: 1,
              total_pieces: looseQty,
            });
          }

          const totalPieces = (bagQty * itemsPerPkg) + looseQty;
          if (saleType === 'sale') {
            deductVanStock((stock as any).allocation_id || stock.product_id, totalPieces);
          } else if (saleType === 'return') {
            addVanStock((stock as any).allocation_id || stock.product_id, totalPieces);
          }
        }
      }

      // Append any accepted promotional scheme free reward items that are currently qualified
      const qualifiedSchemeIdSet = new Set(schemeEval?.qualifiedSchemes.map(qs => qs.scheme_id) || []);
      Object.entries(acceptedFreeRewards).forEach(([sIdStr, freeItem]) => {
        if (!qualifiedSchemeIdSet.has(Number(sIdStr))) return;
        selectedItems.push({
          product_id: freeItem.product_id ? String(freeItem.product_id) : '',
          product_name: `${freeItem.product_name} (Free Scheme Reward)`,
          product_sku: freeItem.product_sku || '',
          hsn_code: '',
          warehouse_name: (activeStockList[0] as any)?.warehouse_name || '',
          warehouse_id: (activeStockList[0] as any)?.warehouse_id || '',
          package_type: freeItem.package_type || 'Loose',
          unit: freeItem.unit || 'Pcs',
          gst_rate: '0%',
          cgst_rate: 0,
          sgst_rate: 0,
          cgst_amount: 0,
          sgst_amount: 0,
          total_gst: 0,
          taxable_amount: 0,
          qty: freeItem.qty,
          unit_price: 0,
          mrp: 0,
          discount: 0,
          discount_amount: 0,
          total: 0,
          items_per_package: 1,
          total_pieces: freeItem.qty,
        });

        // "and the stock from Van need to reduced."
        if (saleType === 'sale') {
          deductVanStock(freeItem.product_id || freeItem.product_name, freeItem.qty);
        }
      });

      if (selectedItems.length === 0) {
        Alert.alert('No Items Selected', 'Please select at least 1 item.');
        return;
      }

      const summaryProdName =
        selectedItems.length === 1
          ? selectedItems[0].product_name
          : `${selectedItems.length} Items: ${selectedItems.map(i => `${i.product_name} (${i.qty} ${i.unit || ''})`).join(', ')}`;

      const firstStock = selectedItems[0];
      const avgUnitPrice = totalUnits > 0 ? Math.round((totalAmount / totalUnits) * 100) / 100 : firstStock.unit_price;
      const salesman = assignedRoute?.salesman_name || user?.name || 'Sales Representative';

      // Determine booking receipt code (Unique sequential number)
      const finalBookingCode = previewInvoice?.invoice_number || getNextDocumentCode(saleType, { isGst: hasCustomerGst, salesman });

      createBooking({
        booking_code: finalBookingCode,
        salesman_id: user?.id || assignedRoute?.salesman_id || undefined,
        salesman_name: salesman,
        customer_id: selectedCustomerId || undefined,
        customer_name: customerName,
        product_name: summaryProdName,
        product_id: String(firstStock.product_id || ''),
        total_qty: totalUnits,
        unit_price: selectedItems.length === 1 ? firstStock.unit_price : avgUnitPrice,
        total_amount: totalAmount,
        discount_amount: totalDiscount,
        round_off: roundOff,
        advance_amount: parsedAdvance || 0,
        balance_amount: Math.max(0, totalAmount - (parsedAdvance || 0)),
        sale_type: saleType,
        items: JSON.stringify(selectedItems),
        status: saleType === 'sale' ? 'Delivered' : saleType === 'order' ? 'Confirmed' : 'Returned',
        notes: notes.trim() || (saleType === 'sale' ? 'Direct Van Sale' : saleType === 'order' ? `Advance Booking Order (${selectedItems.length} items)` : 'Customer Product Return Restocked'),
      });

      setModalVisible(false);
      setModalStep('form');
      setPreviewInvoice(null);
      setSelectedCustomer(null);
      setItemLooseQuantities({});
      setItemBagQuantities({});
      setCustomLooseRates({});
      setCustomBagRates({});
      setItemDiscounts({});
      setItemDiscountTypes({});
      setCustomAdvance('');
      setAcceptedFreeRewards({});
      setAcceptedDiscountSchemes({});
      setIsSchemeBannerMinimized(false);
      setStockSearch('');
      loadData();
      sendImmediateLocationPing().catch(() => {});
      triggerImmediateSync('sale_order_created');

      if (saleType === 'order') {
        Alert.alert(
          'Advance Order Confirmed!',
          `Advance Order #${finalBookingCode} (${summaryQtyText} across ${selectedItems.length} items) booked for ${customerName}!`
        );
      } else if (saleType === 'return') {
        Alert.alert(
          'Product Return Recorded!',
          `Product Return of ₹${totalAmount.toFixed(2)} (${summaryQtyText}) recorded from ${customerName}. Van stock has been restocked.`
        );
      } else {
        Alert.alert(
          'Direct Sale Completed!',
          `Direct Sale #${finalBookingCode} of ₹${totalAmount.toFixed(2)} (${summaryQtyText}) recorded for ${customerName}.`
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to record transaction');
    }
  };

  const handlePrintHistoricalBooking = (b: BookingRecord) => {
    Keyboard.dismiss();
    const currentCustomer = customers.find(c => c.id === b.customer_id || c.name === b.customer_name);
    const dateStr = b.created_at ? new Date(b.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Today';

    const custGst = (currentCustomer?.gst_in || (currentCustomer as any)?.gst_number || '').trim();
    const hasCustomerGst = Boolean(
      custGst &&
      custGst.length >= 3 &&
      !['URP', 'NON-GST', 'NIL', 'NONE'].includes(custGst.toUpperCase())
    );

    const due = b.balance_amount !== undefined && b.balance_amount !== null
      ? Number(b.balance_amount)
      : Math.max(0, Number(b.total_amount || 0) - Number(b.advance_amount || 0));

    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalGst = 0;

    let invoiceItems: InvoiceItem[] = [];
    if (b.items) {
      try {
        const parsed = typeof b.items === 'string' ? JSON.parse(b.items) : b.items;
        if (Array.isArray(parsed) && parsed.length > 0) {
          invoiceItems = parsed.map((item: any) => {
            const qty = Number(item.qty) || 1;
            const unitPrice = Number(item.unit_price) || 0;
            const itemTotal = Number(item.total) || (qty * unitPrice);
            const gstRate = parseGstRate(item.gst_rate);
            const cgstRate = gstRate / 2;
            const sgstRate = gstRate / 2;

            let taxable = itemTotal;
            let cgstAmt = 0;
            let sgstAmt = 0;
            let itmGst = 0;

            if (hasCustomerGst && gstRate > 0) {
              taxable = Math.round((itemTotal / (1 + (gstRate / 100))) * 100) / 100;
              itmGst = Math.round((itemTotal - taxable) * 100) / 100;
              cgstAmt = Math.round((itmGst / 2) * 100) / 100;
              sgstAmt = Math.round((itmGst - cgstAmt) * 100) / 100;

              totalTaxable += taxable;
              totalCgst += cgstAmt;
              totalSgst += sgstAmt;
              totalGst += itmGst;
            } else {
              totalTaxable += itemTotal;
            }

            const matchedStock = [...vanStocks, ...warehouseStocks].find(
              s => String(s.product_id) === String(item.product_id) || s.product_name === item.product_name
            );
            const itemHsn = item.hsn_code || (matchedStock as any)?.hsn_code || '';

            const discPercent = Number(item.discount) || 0;
            const discAmount = item.discount_amount != null ? Number(item.discount_amount) : (qty * unitPrice * (discPercent / 100));

            const cleanHistName = (item.product_name || '')
              .replace(/\s*[\(\[][^\)\]]*(?:warehouse|wh|godown|depot)[^\)\]]*[\)\]]/gi, '')
              .trim();
            const itemsPerPkg = Number(item.items_per_package) || Number((matchedStock as any)?.items_per_package) || 1;

            const isBagItem = item.unit === 'Bag' || item.package_type === 'Bag' || item.package_type === (matchedStock as any)?.package_type;
            const fallbackMrp = isBagItem
              ? (Number((matchedStock as any)?.box_mrp) > 0 ? Number((matchedStock as any)?.box_mrp) : (Number((matchedStock as any)?.mrp || 0) * itemsPerPkg || unitPrice))
              : (Number((matchedStock as any)?.mrp) > 0 ? Number((matchedStock as any)?.mrp) : unitPrice);
            const itemMrp = Number(item.mrp) > 0 ? Number(item.mrp) : fallbackMrp;

            return {
              product_id: item.product_id,
              product_name: cleanHistName,
              product_sku: item.product_sku,
              hsn_code: itemHsn,
              package_type: item.package_type || 'Loose Units',
              unit: item.unit || item.package_type || 'Pcs',
              qty,
              unit_price: unitPrice,
              mrp: itemMrp,
              discount: discPercent,
              discount_amount: discAmount,
              total: itemTotal,
              gst_rate: gstRate,
              cgst_rate: cgstRate,
              sgst_rate: sgstRate,
              cgst_amount: cgstAmt,
              sgst_amount: sgstAmt,
              total_gst: itmGst,
              taxable_amount: taxable,
              items_per_package: itemsPerPkg,
            };
          });
        }
      } catch (e) {
        console.warn('Failed to parse historical booking items', e);
      }
    }

    if (invoiceItems.length === 0) {
      const itemTotal = Number(b.total_amount) || 0;
      const gstRate = 18;
      const taxable = hasCustomerGst ? Math.round((itemTotal / 1.18) * 100) / 100 : itemTotal;
      const itmGst = hasCustomerGst ? Math.round((itemTotal - taxable) * 100) / 100 : 0;
      totalTaxable = taxable;
      totalGst = itmGst;
      totalCgst = Math.round((itmGst / 2) * 100) / 100;
      totalSgst = Math.round((itmGst - totalCgst) * 100) / 100;

      invoiceItems = [
        {
          product_name: b.product_name,
          qty: Number(b.total_qty) || 1,
          unit_price: Number(b.unit_price) || 0,
          mrp: Number(b.unit_price) || 0,
          total: itemTotal,
          gst_rate: gstRate,
          cgst_rate: 9,
          sgst_rate: 9,
          cgst_amount: totalCgst,
          sgst_amount: totalSgst,
          total_gst: totalGst,
          taxable_amount: taxable,
        },
      ];
    }

    const histTotal = Number(b.total_amount) || 0;
    const histDisc = Number(b.discount_amount) || 0;
    const histGross = histTotal + histDisc;
    const histNet = Math.max(0, histGross - histDisc);
    const histDiscFactor = histGross > 0 ? (histNet / histGross) : 1;

    let histFinalTaxable = 0;
    let histFinalCgst = 0;
    let histFinalSgst = 0;
    let histFinalGst = 0;

    if (hasCustomerGst) {
      invoiceItems.forEach(it => {
        const discountedTotal = it.total * histDiscFactor;
        const gRate = it.gst_rate || 0;
        if (gRate > 0) {
          const itTaxable = Math.round((discountedTotal / (1 + gRate / 100)) * 100) / 100;
          const itGst = Math.round((discountedTotal - itTaxable) * 100) / 100;
          const itCgst = Math.round((itGst / 2) * 100) / 100;
          const itSgst = Math.round((itGst - itCgst) * 100) / 100;
          histFinalTaxable += itTaxable;
          histFinalCgst += itCgst;
          histFinalSgst += itSgst;
          histFinalGst += itGst;
        } else {
          histFinalTaxable += discountedTotal;
        }
      });
      histFinalTaxable = Math.round(histFinalTaxable * 100) / 100;
      histFinalCgst = Math.round(histFinalCgst * 100) / 100;
      histFinalSgst = Math.round(histFinalSgst * 100) / 100;
      histFinalGst = Math.round(histFinalGst * 100) / 100;
    } else {
      histFinalTaxable = histNet;
    }

    setPreviewInvoice({
      invoice_number: b.booking_code || `INV-${b.id.slice(0, 8).toUpperCase()}`,
      invoice_date: dateStr,
      customer_name: b.customer_name,
      customer_code: currentCustomer?.customer_code || undefined,
      customer_place: currentCustomer?.place || undefined,
      customer_phone: currentCustomer?.phone || undefined,
      customer_gst: hasCustomerGst ? custGst : undefined,
      salesman_name: b.salesman_name || assignedRoute?.salesman_name || user?.name || 'Sales Representative',
      salesman_phone: assignedRoute?.salesman_phone || (user as any)?.phone || '',
      vehicle_reg_no: assignedRoute?.vehicle_reg_no || '',
      route_name: selectedRoute,
      items: invoiceItems,
      subtotal: histGross,
      subtotal_gross: histGross,
      discount_amount: histDisc,
      round_off: Number(b.round_off || 0),
      grand_total: histTotal,
      paid_amount: Number(b.advance_amount) || 0,
      balance_due: due,
      payment_mode: 'Cash',
      notes: b.notes || undefined,
      is_draft: false,
      order_type: (b.sale_type as any) || (b.status === 'Delivered' ? 'sale' : 'order'),
      company: companyProfile,
      has_gst: hasCustomerGst,
      total_taxable: histFinalTaxable,
      total_cgst: histFinalCgst,
      total_sgst: histFinalSgst,
      total_gst: histFinalGst,
    });
    setIsHistoryPreview(true);
    setModalStep('preview');
    setModalVisible(true);
  };

  const handleSaveSale = () => {
    if (totalUnits <= 0) {
      Alert.alert('No Items Selected', 'Please select at least 1 unit using the + button on a product.');
      return;
    }

    if (saleType === 'order') {
      executeDirectSalePersist();
      return;
    }

    if (saleType === 'sale') {
      handleOpenInvoicePreview();
      return;
    }

    if (saleType === 'return') {
      setRefundAmount(String(totalAmount.toFixed(2)));
      setIsRefundable(true);
      setRefundMode('Cash');
      setModalStep('return_review');
      return;
    }
  };

  const handleFinalizeReturn = () => {
    Keyboard.dismiss();
    if (!returnReason.trim()) {
      Alert.alert('Return Reason Required', 'Please enter a note explaining why this product is being returned.');
      return;
    }

    let finalRefund = 0;
    if (isRefundable) {
      const parsed = parseFloat(refundAmount);
      if (isNaN(parsed) || parsed < 0) {
        Alert.alert('Invalid Refund Amount', 'Please enter a valid refund amount (0 or greater).');
        return;
      }
      finalRefund = parsed;
    }

    try {
      const selectedItems: Array<{
        product_id: string | number;
        product_name: string;
        product_sku?: string;
        hsn_code?: string;
        warehouse_name?: string;
        warehouse_id?: string | number;
        package_type?: string;
        unit?: string;
        qty: number;
        unit_price: number;
        total: number;
        total_pieces?: number;
      }> = [];

      for (const stock of activeStockList) {
        const key = getStockKey(stock);
        const looseQty = itemLooseQuantities[key] || 0;
        const bagQty = itemBagQuantities[key] || 0;
        if (looseQty > 0 || bagQty > 0) {
          const looseRate = getProductLooseRate(stock);
          const bagRate = getProductBagRate(stock);
          const whName = (stock as any).warehouse_name;
          const whId = (stock as any).warehouse_id;
          const pkgType = resolveStockPackageType(stock);
          const unitLabel = resolveStockUnitLabel(stock);
          const itemsPerPkg = Math.max(1, Number(stock.items_per_package) || 1);

          if (bagQty > 0) {
            selectedItems.push({
              product_id: stock.product_id || '',
              product_name: stock.product_name,
              product_sku: stock.product_sku || '',
              hsn_code: (stock as any).hsn_code || '',
              warehouse_name: whName || '',
              warehouse_id: whId || '',
              package_type: pkgType,
              unit: pkgType,
              qty: bagQty,
              unit_price: bagRate,
              total: bagQty * bagRate,
              total_pieces: bagQty * itemsPerPkg,
            });
          }

          if (looseQty > 0) {
            selectedItems.push({
              product_id: stock.product_id || '',
              product_name: stock.product_name,
              product_sku: stock.product_sku || '',
              hsn_code: (stock as any).hsn_code || '',
              warehouse_name: whName || '',
              warehouse_id: whId || '',
              package_type: 'Loose',
              unit: unitLabel,
              qty: looseQty,
              unit_price: looseRate,
              total: looseQty * looseRate,
              total_pieces: looseQty,
            });
          }

          // Restock inventory
          const totalPieces = (bagQty * itemsPerPkg) + looseQty;
          addVanStock((stock as any).allocation_id || stock.product_id, totalPieces);
        }
      }

      if (selectedItems.length === 0) {
        Alert.alert('No Items Selected', 'Please select at least 1 item.');
        return;
      }

      const summaryProdName =
        selectedItems.length === 1
          ? selectedItems[0].product_name
          : `${selectedItems.length} Items: ${selectedItems.map(i => `${i.product_name} (${i.qty} ${i.unit || ''})`).join(', ')}`;

      const firstStock = selectedItems[0];
      const avgUnitPrice = totalUnits > 0 ? Math.round((totalAmount / totalUnits) * 100) / 100 : firstStock.unit_price;

      // Determine return receipt code (Sequential RET-2026-XXXX)
      const returnCode = getNextDocumentCode('return');

      const formattedReason = returnReason.trim();
      const returnNotes = `[RETURN REASON]: ${formattedReason} | [REFUND]: ${
        isRefundable
          ? `Yes - ₹${finalRefund.toFixed(2)} (${refundMode === 'Credit' ? 'Adjust Customer Due' : refundMode})`
          : 'Non-Refundable (₹0.00)'
      }`;

      createBooking({
        booking_code: returnCode,
        salesman_id: user?.id || assignedRoute?.salesman_id || undefined,
        salesman_name: user?.name || assignedRoute?.salesman_name || 'Sales Representative',
        customer_id: selectedCustomerId || undefined,
        customer_name: customerName,
        product_name: summaryProdName,
        product_id: String(firstStock.product_id || ''),
        total_qty: totalUnits,
        unit_price: selectedItems.length === 1 ? firstStock.unit_price : avgUnitPrice,
        total_amount: totalAmount,
        advance_amount: finalRefund,
        balance_amount: isRefundable && refundMode === 'Credit' ? finalRefund : 0,
        sale_type: 'return',
        items: JSON.stringify(selectedItems),
        status: 'Returned',
        notes: returnNotes,
      });

      setModalVisible(false);
      setModalStep('form');
      setPreviewInvoice(null);
      setItemLooseQuantities({});
      setItemBagQuantities({});
      setCustomLooseRates({});
      setCustomBagRates({});
      setCustomAdvance('');
      setNotes('');
      setReturnReason('');
      setStockSearch('');
      loadData();
      sendImmediateLocationPing().catch(() => {});
      triggerImmediateSync('product_return_created');

      Alert.alert(
        'Product Return Recorded!',
        `Return #${returnCode} of ₹${totalAmount.toFixed(2)} (${summaryQtyText} across ${selectedItems.length} products) recorded from ${customerName}.\n\nReason: "${formattedReason}"\n\nRefund Status: ${
          isRefundable
            ? `₹${finalRefund.toFixed(2)} refunded via ${refundMode === 'Credit' ? 'Customer Balance Adjustment' : refundMode}`
            : 'Non-Refundable (₹0.00)'
        }`
      );
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to record return');
    }
  };

  const filteredCustomers = customers.filter(c => {
    if (!customerSearch.trim()) return true;
    const term = customerSearch.toLowerCase();
    return (
      c.name.toLowerCase().includes(term) ||
      (c.phone && c.phone.includes(term)) ||
      (c.place && c.place.toLowerCase().includes(term)) ||
      (c.customer_code && c.customer_code.toLowerCase().includes(term)) ||
      (c.gst_in && c.gst_in.toLowerCase().includes(term))
    );
  });

  const directSalesList = useMemo(() => {
    const seen = new Set<string>();
    return (bookings || []).filter(b => {
      if (!b) return false;
      if ((b.sale_type as string) === 'payment' || b.product_name === 'Balance Payment Collection') return false;
      const isSale = b.sale_type === 'sale' || 
                     (b.status === 'Delivered' && b.sale_type !== 'return') ||
                     (b.booking_code && (b.booking_code.includes('-INV-') || b.booking_code.includes('-RET-')));
      if (!isSale) return false;

      const key = b.booking_code || b.id;
      if (key) {
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    });
  }, [bookings]);

  const advanceOrdersList = useMemo(() => {
    const seen = new Set<string>();
    return (bookings || []).filter(b => {
      if (!b) return false;
      if ((b.sale_type as string) === 'payment' || b.product_name === 'Balance Payment Collection') return false;
      if (b.sale_type === 'sale' || b.status === 'Delivered' || b.status === 'Returned' || b.status === 'Collected') return false;
      if (b.booking_code && (b.booking_code.includes('-INV-') || b.booking_code.includes('-RET-'))) return false;

      const isOrder = b.sale_type === 'order' || (!b.sale_type && b.status !== 'Delivered' && b.status !== 'Returned' && b.status !== 'Collected');
      if (!isOrder) return false;

      const key = b.booking_code || b.id;
      if (key) {
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    });
  }, [bookings]);

  const filteredSales = useMemo(() => {
    if (!historySearch?.trim()) return directSalesList;
    const term = historySearch.toLowerCase().trim();
    return directSalesList.filter(
      b =>
        (b?.customer_name || '').toLowerCase().includes(term) ||
        (b?.booking_code || '').toLowerCase().includes(term) ||
        (b?.product_name || '').toLowerCase().includes(term)
    );
  }, [directSalesList, historySearch]);

  const filteredOrders = useMemo(() => {
    if (!historySearch?.trim()) return advanceOrdersList;
    const term = historySearch.toLowerCase().trim();
    return advanceOrdersList.filter(
      b =>
        (b?.customer_name || '').toLowerCase().includes(term) ||
        (b?.booking_code || '').toLowerCase().includes(term) ||
        (b?.product_name || '').toLowerCase().includes(term)
    );
  }, [advanceOrdersList, historySearch]);

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 }}>
      {/* 1. Route Dropdown Selector (Top of Sales and Orders) */}
      <View
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 20,
          padding: 14,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: '#f1f5f9',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 2,
          elevation: 1,
          overflow: 'hidden',
        }}
      >
        {/* Top Header Row with Route Label and Territory Badge - Constrained within card */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: '#eff6ff',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialIcons name="alt-route" size={15} color="#2563eb" />
            </View>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '800',
                color: '#475569',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
              numberOfLines={1}
            >
              Active Delivery Route / Beat
            </Text>
          </View>

          <View
            style={{
              backgroundColor: '#eff6ff',
              borderColor: '#bfdbfe',
              borderWidth: 1,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 8,
              flexShrink: 0,
            }}
          >
            <Text
              style={{
                fontSize: 10,
                fontWeight: '800',
                color: '#1d4ed8',
              }}
              numberOfLines={1}
            >
              {assignedRoute?.district ? `${assignedRoute.district} Territory` : 'General Territory'}
            </Text>
          </View>
        </View>

        {/* Dropdown Input Box Trigger */}
        <TouchableOpacity
          onPress={() => setDropdownOpen(!dropdownOpen)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 14,
            backgroundColor: dropdownOpen ? '#eff6ff' : '#f8fafc',
            borderWidth: 1.5,
            borderColor: dropdownOpen ? '#3b82f6' : '#e2e8f0',
          }}
          activeOpacity={0.8}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, paddingRight: 8 }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                backgroundColor: '#dbeafe',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialIcons name="directions" size={20} color="#2563eb" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{
                  fontSize: 9.5,
                  color: '#94a3b8',
                  fontWeight: '800',
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                }}
              >
                Selected Beat
              </Text>
              <Text
                style={{
                  fontSize: 13.5,
                  fontWeight: '900',
                  color: '#0f172a',
                }}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {selectedRoute}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <View
              style={{
                backgroundColor: '#e2e8f0',
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 6,
              }}
            >
              <Text style={{ fontSize: 10, fontWeight: '800', color: '#475569' }}>
                {availableRoutes.length} Beats
              </Text>
            </View>
            <MaterialIcons
              name={dropdownOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
              size={22}
              color="#475569"
            />
          </View>
        </TouchableOpacity>

        {/* Dropdown Options Menu (Expands when open) */}
        {dropdownOpen && (
          <View className="mt-3 pt-3 border-t border-slate-100">
            <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 ml-1">
              Choose Beat / Local Area:
            </Text>
            <ScrollView
              style={{ maxHeight: 220 }}
              nestedScrollEnabled={true}
              showsVerticalScrollIndicator={true}
            >
              {availableRoutes.map((route, idx) => {
                const isSelected = selectedRoute === route;
                const isPrimary = route.includes('(All Areas)');
                const isAll = route === 'All Routes';

                return (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => handleSelectRoute(route)}
                    className={`px-3.5 py-3 rounded-xl mb-1.5 flex-row items-center justify-between border ${
                      isSelected
                        ? 'bg-blue-600 border-blue-600'
                        : 'bg-slate-50 border-slate-100 active:bg-slate-100'
                    }`}
                    activeOpacity={0.8}
                  >
                    <View className="flex-row items-center gap-2.5 flex-1 pr-2">
                      <MaterialIcons
                        name={isPrimary ? 'stars' : isAll ? 'public' : 'location-on'}
                        size={18}
                        color={isSelected ? '#ffffff' : isPrimary ? '#2563eb' : '#64748b'}
                      />
                      <View className="flex-1">
                        <Text
                          className={`text-xs font-bold ${
                            isSelected ? 'text-white' : 'text-slate-800'
                          }`}
                          numberOfLines={1}
                        >
                          {route}
                        </Text>
                        <Text
                          className={`text-[10px] ${
                            isSelected ? 'text-blue-100' : 'text-slate-400'
                          }`}
                        >
                          {isPrimary
                            ? 'Full District Beat (All Areas)'
                            : isAll
                            ? 'District-wide Combined Outlets'
                            : 'Commercial Market / Beat'}
                        </Text>
                      </View>
                    </View>

                    {isSelected ? (
                      <MaterialIcons name="check-circle" size={18} color="#ffffff" />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>

      {/* 2. Mode Segmented Switcher (Sales vs Orders) */}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: '#e2e8f0',
          padding: 4,
          borderRadius: 16,
          marginBottom: 12,
        }}
      >
        {/* Option 1: Sales */}
        <TouchableOpacity
          onPress={() => {
            setActiveTab('sales');
            setHistorySearch('');
          }}
          style={{
            flex: 1,
            paddingVertical: 10,
            borderRadius: 12,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            backgroundColor: activeTab === 'sales' ? '#ffffff' : 'transparent',
            elevation: activeTab === 'sales' ? 2 : 0,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: activeTab === 'sales' ? 0.08 : 0,
            shadowRadius: 2,
          }}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name="point-of-sale"
            size={18}
            color={activeTab === 'sales' ? '#059669' : '#64748b'}
          />
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              color: activeTab === 'sales' ? '#047857' : '#475569',
            }}
          >
            Invoices ({directSalesList.length})
          </Text>
        </TouchableOpacity>

        {/* Option 2: Orders */}
        <TouchableOpacity
          onPress={() => {
            setActiveTab('orders');
            setHistorySearch('');
          }}
          style={{
            flex: 1,
            paddingVertical: 10,
            borderRadius: 12,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            backgroundColor: activeTab === 'orders' ? '#ffffff' : 'transparent',
            elevation: activeTab === 'orders' ? 2 : 0,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: activeTab === 'orders' ? 0.08 : 0,
            shadowRadius: 2,
          }}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name="receipt-long"
            size={18}
            color={activeTab === 'orders' ? '#2563eb' : '#64748b'}
          />
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              color: activeTab === 'orders' ? '#2563eb' : '#475569',
            }}
          >
            Customer Orders ({advanceOrdersList.length})
          </Text>
        </TouchableOpacity>
      </View>

            {loading ? (
              <View className="flex-1 justify-center items-center py-16">
                <LoadingIndicator
                  message="Loading Sales & Orders..."
                  subtext="Syncing van stock inventory and customer accounts..."
                  iconName="receipt"
                />
              </View>
            ) : (
              <>
                {/* TAB 1: ALL SALES DETAILS */}
                {activeTab === 'sales' && (
                  <View key="sales-tab" className="flex-1">
                {/* Header & New Sale Action */}
                <View className="flex-row justify-between items-center mb-2.5">
                  <View className="flex-1 pr-2">
                    <Text className="text-base font-bold text-slate-800 leading-tight">Sales Invoices & Direct Bills</Text>
                    <Text className="text-xs font-semibold text-emerald-700 mt-0.5 leading-tight">
                      {directSalesList.length} spot sale(s) delivered • Beat: {selectedRoute.split('(')[0].trim()}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleStartDirectSale}
                    className="bg-emerald-600 active:bg-emerald-700 px-3.5 py-2 rounded-xl flex-row items-center gap-1.5 shadow-sm"
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="add" size={16} color="#ffffff" />
                    <Text className="text-white text-xs font-bold">New Direct Sale</Text>
                  </TouchableOpacity>
                </View>

                {/* Sales Search Bar */}
                <View className="bg-white rounded-2xl px-3.5 py-2 mb-3 flex-row items-center border border-slate-200">
                  <MaterialIcons name="search" size={18} color="#94a3b8" />
                  <TextInput
                    value={historySearch}
                    onChangeText={setHistorySearch}
                    placeholder="Search sales by customer, invoice #, or item..."
                    placeholderTextColor="#94a3b8"
                    className="flex-1 ml-2 text-xs text-slate-800"
                  />
                  {historySearch.length > 0 && (
                    <TouchableOpacity onPress={() => setHistorySearch('')}>
                      <MaterialIcons name="close" size={16} color="#94a3b8" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Sales List */}
                <FlatList
                  data={filteredSales}
                  keyExtractor={item => item.id}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 24 }}
                  ListEmptyComponent={
                    <View className="py-14 items-center justify-center bg-white rounded-3xl p-6 border border-slate-100 shadow-sm mt-1">
                      <View className="w-14 h-14 rounded-full bg-emerald-50 items-center justify-center mb-3">
                        <MaterialIcons name="point-of-sale" size={28} color="#059669" />
                      </View>
                      <Text className="text-slate-800 font-bold text-base">
                        {historySearch ? 'No matching sales found' : 'No Direct Sales Recorded Yet'}
                      </Text>
                      <Text className="text-slate-400 text-xs mt-1.5 text-center max-w-xs leading-relaxed">
                        {historySearch
                          ? `No spot sales match "${historySearch}".`
                          : "Tap '+ New Direct Sale' above to pick a customer and issue an on-the-spot van sale invoice."}
                      </Text>
                      {!historySearch && (
                        <TouchableOpacity
                          onPress={handleStartDirectSale}
                          className="mt-4 px-4 py-2 bg-emerald-600 rounded-xl flex-row items-center gap-1.5 shadow-sm"
                          activeOpacity={0.8}
                        >
                          <MaterialIcons name="add" size={16} color="#ffffff" />
                          <Text className="text-white text-xs font-bold">+ New Direct Sale</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  }
                  renderItem={({ item }) => {
                    let parsedItems: any[] = [];
                    if (item.items) {
                      try {
                        parsedItems = typeof item.items === 'string' ? JSON.parse(item.items) : item.items;
                      } catch {
                        parsedItems = [];
                      }
                    }
                    const hasMulti = Array.isArray(parsedItems) && parsedItems.length > 0;
                    const dateFormatted = item.created_at
                      ? new Date(item.created_at).toLocaleString('en-IN', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : 'Today';

                    return (
                      <View style={{ backgroundColor: '#ffffff', borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1, overflow: 'hidden' }}>
                        {/* Header: Customer and Invoice Number */}
                        <View className="flex-row justify-between items-start">
                          <View className="flex-1 pr-2">
                            <View className="flex-row items-center gap-2 flex-wrap mb-1">
                              <Text className="text-sm font-bold text-slate-800 leading-tight">
                                {item.customer_name}
                              </Text>
                              {item.booking_code && (
                                <View className="bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                                  <Text className="text-[10px] font-bold text-emerald-800">
                                    {item.booking_code}
                                  </Text>
                                </View>
                              )}
                              <View className="bg-emerald-100 px-2 py-0.5 rounded-md flex-row items-center gap-1">
                                <MaterialIcons name="check-circle" size={11} color="#047857" />
                                <Text className="text-[10px] font-bold text-emerald-800">
                                  SPOT SALE
                                </Text>
                              </View>
                            </View>

                            <View className="flex-row items-center gap-2 mt-0.5">
                              <Text className="text-[11px] text-slate-400 font-medium leading-tight">
                                📅 {dateFormatted}
                              </Text>
                            </View>
                          </View>

                          {/* Total Bill Badge & Status */}
                          <View className="items-end">
                            <Text className="text-sm font-bold text-emerald-700 leading-tight">
                              ₹{item.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </Text>
                            <View
                              className={`mt-1 px-2 py-0.5 rounded-full ${
                                item._status === 'created' ? 'bg-amber-100' : 'bg-emerald-100'
                              }`}
                            >
                              <Text
                                className={`text-[9px] font-bold uppercase ${
                                  item._status === 'created' ? 'text-amber-800' : 'text-emerald-800'
                                }`}
                              >
                                {item._status === 'created' ? 'Offline' : 'Synced'}
                              </Text>
                            </View>
                          </View>
                        </View>

                        {/* All Sales Item Details */}
                        <View className="mt-2.5 pt-2 border-t border-slate-100">
                          <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                            Sold Items Breakdown ({parsedItems.length || 1} item{parsedItems.length !== 1 ? 's' : ''}):
                          </Text>
                          {hasMulti ? (
                            <View className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 gap-1.5">
                              {parsedItems.map((subItem: any, idx: number) => (
                                <View key={idx} className="flex-row items-center justify-between">
                                  <View className="flex-1 pr-2">
                                    <Text className="text-xs font-bold text-slate-700" numberOfLines={1}>
                                      • {subItem.product_name}
                                    </Text>
                                    <Text className="text-[10px] text-slate-400">
                                      {subItem.package_type || 'Loose Units'} {subItem.product_sku ? `(SKU: ${subItem.product_sku})` : ''}
                                    </Text>
                                  </View>
                                  <View className="items-end">
                                    <Text className="text-xs font-bold text-slate-800">
                                      {subItem.qty} {subItem.unit || 'Pcs'} × ₹{Number(subItem.unit_price || 0).toFixed(2)}
                                    </Text>
                                    <Text className="text-[10px] font-extrabold text-emerald-700">
                                      = ₹{Number(subItem.total || (subItem.qty * subItem.unit_price) || 0).toFixed(2)}
                                    </Text>
                                  </View>
                                </View>
                              ))}
                            </View>
                          ) : (
                            <View className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex-row justify-between items-center">
                              <Text className="text-xs font-bold text-slate-700">{item.product_name}</Text>
                              <Text className="text-xs font-bold text-slate-800">
                                {item.total_qty} units × ₹{item.unit_price.toFixed(2)}
                              </Text>
                            </View>
                          )}
                        </View>

                        {/* Financial Breakdown (Paid / Balance) & Action - Cleanly inside the card */}
                        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <Text style={{ fontSize: 12, fontWeight: '700', color: '#065f46' }}>
                              Paid: ₹{Number(item.advance_amount || 0).toFixed(2)}
                            </Text>
                            {item.balance_amount && item.balance_amount > 0 ? (
                              <View style={{ backgroundColor: '#fff1f2', borderColor: '#fecdd3', borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                                <Text style={{ fontSize: 10, fontWeight: '800', color: '#be123c' }}>
                                  Due: ₹{Number(item.balance_amount).toFixed(2)}
                                </Text>
                              </View>
                            ) : (
                              <View style={{ backgroundColor: '#ecfdf5', borderColor: '#a7f3d0', borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                                <Text style={{ fontSize: 10, fontWeight: '800', color: '#047857' }}>
                                  Paid in Full
                                </Text>
                              </View>
                            )}
                          </View>

                          {/* Print Invoice Button - Guaranteed 100% inside card */}
                          <TouchableOpacity
                            onPress={() => handlePrintHistoricalBooking(item)}
                            style={{
                              backgroundColor: '#f0fdf4',
                              borderColor: '#86efac',
                              borderWidth: 1,
                              paddingVertical: 9,
                              paddingHorizontal: 12,
                              borderRadius: 12,
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 6,
                            }}
                            activeOpacity={0.75}
                          >
                            <MaterialIcons name="print" size={16} color="#059669" />
                            <Text style={{ fontSize: 12, fontWeight: '800', color: '#047857' }}>Print Mobile Invoice</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  }}
                />
              </View>
            )}

            {/* TAB 2: ALL ORDERS DETAILS */}
            {activeTab === 'orders' && (
              <View key="orders-tab" className="flex-1">
                {/* Header & Take Order Action */}
                <View className="flex-row justify-between items-center mb-2.5">
                  <View className="flex-1 pr-2">
                    <Text className="text-base font-bold text-slate-800 leading-tight">Customer Booking Orders</Text>
                    <Text className="text-xs font-semibold text-blue-600 mt-0.5 leading-tight">
                      {advanceOrdersList.length} order(s) booked • Beat: {selectedRoute.split('(')[0].trim()}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      const currentRoute = getSelectedRoute();
                      const filter = currentRoute === 'All Routes' ? '' : currentRoute;
                      const freshC = getCustomers('', filter);
                      setCustomers(freshC);
                      setCustomerSearch('');
                      setSelectorTargetType('order');
                      setCustomerSelectorVisible(true);
                    }}
                    className="bg-blue-600 active:bg-blue-700 px-3.5 py-2 rounded-xl flex-row items-center gap-1.5 shadow-sm"
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="add-shopping-cart" size={16} color="#ffffff" />
                    <Text className="text-white text-xs font-bold">+ Take New Order</Text>
                  </TouchableOpacity>
                </View>

                {/* Orders Search Bar */}
                <View className="bg-white rounded-2xl px-3.5 py-2 mb-3 flex-row items-center border border-slate-200">
                  <MaterialIcons name="search" size={18} color="#94a3b8" />
                  <TextInput
                    value={historySearch}
                    onChangeText={setHistorySearch}
                    placeholder="Search orders by customer, order #, or item..."
                    placeholderTextColor="#94a3b8"
                    className="flex-1 ml-2 text-xs text-slate-800"
                  />
                  {historySearch.length > 0 && (
                    <TouchableOpacity onPress={() => setHistorySearch('')}>
                      <MaterialIcons name="close" size={16} color="#94a3b8" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Orders List */}
                <FlatList
                  data={filteredOrders}
                  keyExtractor={item => item.id}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 24 }}
                  ListEmptyComponent={
                    <View className="py-14 items-center justify-center bg-white rounded-3xl p-6 border border-slate-100 shadow-sm mt-1">
                      <View className="w-14 h-14 rounded-full bg-blue-50 items-center justify-center mb-3">
                        <MaterialIcons name="receipt-long" size={28} color="#2563eb" />
                      </View>
                      <Text className="text-slate-800 font-bold text-base">
                        {historySearch ? 'No matching orders found' : 'No Advance Orders Booked Yet'}
                      </Text>
                      <Text className="text-slate-400 text-xs mt-1.5 text-center max-w-xs leading-relaxed">
                        {historySearch
                          ? `No booked orders match "${historySearch}".`
                          : "Tap '+ Take New Order' above to pick a customer and record advance order booking."}
                      </Text>
                      {!historySearch && (
                        <TouchableOpacity
                          onPress={() => {
                            const currentRoute = getSelectedRoute();
                            const filter = currentRoute === 'All Routes' ? '' : currentRoute;
                            const freshC = getCustomers('', filter);
                            setCustomers(freshC);
                            setCustomerSearch('');
                            setSelectorTargetType('order');
                            setCustomerSelectorVisible(true);
                          }}
                          className="mt-4 px-4 py-2 bg-blue-600 rounded-xl flex-row items-center gap-1.5 shadow-sm"
                          activeOpacity={0.8}
                        >
                          <MaterialIcons name="add-shopping-cart" size={16} color="#ffffff" />
                          <Text className="text-white text-xs font-bold">+ Take New Order</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  }
                  renderItem={({ item }) => {
                    let parsedItems: any[] = [];
                    if (item.items) {
                      try {
                        parsedItems = typeof item.items === 'string' ? JSON.parse(item.items) : item.items;
                      } catch {
                        parsedItems = [];
                      }
                    }
                    const hasMulti = Array.isArray(parsedItems) && parsedItems.length > 0;
                    const dateFormatted = item.created_at
                      ? new Date(item.created_at).toLocaleString('en-IN', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : 'Today';

                    return (
                      <View style={{ backgroundColor: '#ffffff', borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1, overflow: 'hidden' }}>
                        {/* Header: Customer and Order Code */}
                        <View className="flex-row justify-between items-start">
                          <View className="flex-1 pr-2">
                            <View className="flex-row items-center gap-2 flex-wrap mb-1">
                              <Text className="text-sm font-bold text-slate-800 leading-tight">
                                {item.customer_name}
                              </Text>
                              {item.booking_code && (
                                <View className="bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                                  <Text className="text-[10px] font-bold text-blue-800">
                                    {item.booking_code}
                                  </Text>
                                </View>
                              )}
                              <View className="bg-blue-100 px-2 py-0.5 rounded-md flex-row items-center gap-1">
                                <MaterialIcons name="shopping-bag" size={11} color="#1d4ed8" />
                                <Text className="text-[10px] font-bold text-blue-800">
                                  ADVANCE ORDER
                                </Text>
                              </View>
                            </View>

                            <View className="flex-row items-center gap-2 mt-0.5">
                              <Text className="text-[11px] text-slate-400 font-medium leading-tight">
                                📅 {dateFormatted}
                              </Text>
                            </View>
                          </View>

                          {/* Total Ordered Units Badge & Sync status (NO PRICE) */}
                          <View className="items-end">
                            <View className="bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-xl">
                              <Text className="text-xs font-bold text-blue-700 leading-tight">
                                {item.total_qty} Total Units
                              </Text>
                            </View>
                            <View
                              className={`mt-1 px-2 py-0.5 rounded-full ${
                                item._status === 'created' ? 'bg-amber-100' : 'bg-emerald-100'
                              }`}
                            >
                              <Text
                                className={`text-[9px] font-bold uppercase ${
                                  item._status === 'created' ? 'text-amber-800' : 'text-emerald-800'
                                }`}
                              >
                                {item._status === 'created' ? 'Offline' : 'Synced'}
                              </Text>
                            </View>
                          </View>
                        </View>

                        {/* All Orders Item Details: Products & Quantities ONLY (NO PRICE) */}
                        <View className="mt-2.5 pt-2 border-t border-slate-100">
                          <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                            Ordered Products ({parsedItems.length || 1} product{parsedItems.length !== 1 ? 's' : ''}):
                          </Text>
                          {hasMulti ? (
                            <View className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 gap-1.5">
                              {parsedItems.map((subItem: any, idx: number) => (
                                <View key={idx} className="flex-row items-center justify-between py-0.5">
                                  <View className="flex-1 pr-2">
                                    <View className="flex-row items-center gap-1 flex-wrap">
                                      <Text className="text-xs font-bold text-slate-700" numberOfLines={1}>
                                        • {subItem.product_name}
                                      </Text>
                                      {subItem.package_type && (
                                        <View className="bg-blue-50 border border-blue-200 px-1.5 py-0.2 rounded">
                                          <Text className="text-[9px] font-bold text-blue-700">
                                            {subItem.package_type}
                                          </Text>
                                        </View>
                                      )}
                                    </View>
                                    {subItem.product_sku ? (
                                      <Text className="text-[10px] text-slate-400">
                                        SKU: {subItem.product_sku}
                                      </Text>
                                    ) : null}
                                  </View>
                                  <View className="bg-blue-100 px-2 py-0.5 rounded-md">
                                    <Text className="text-xs font-black text-blue-900">
                                      {subItem.qty} {subItem.unit || 'Units'}
                                    </Text>
                                  </View>
                                </View>
                              ))}
                            </View>
                          ) : (
                            <View className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex-row justify-between items-center">
                              <Text className="text-xs font-bold text-slate-700">{item.product_name}</Text>
                              <View className="bg-blue-100 px-2 py-0.5 rounded-md">
                                <Text className="text-xs font-black text-blue-900">
                                  {item.total_qty} Units
                                </Text>
                              </View>
                            </View>
                          )}
                        </View>

                        {/* Order Footer & Action - Cleanly inside the card */}
                        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                              <MaterialIcons name="schedule" size={14} color="#64748b" />
                              <Text style={{ fontSize: 11.5, fontWeight: '600', color: '#64748b' }}>
                                Status: {item.status || 'Confirmed'} • For Delivery
                              </Text>
                            </View>
                            <View style={{ backgroundColor: '#eff6ff', borderColor: '#bfdbfe', borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
                              <Text style={{ fontSize: 10, fontWeight: '800', color: '#1d4ed8' }}>
                                BOOKED ORDER
                              </Text>
                            </View>
                          </View>

                          {/* Print Receipt Button - Guaranteed 100% inside card */}
                          <TouchableOpacity
                            onPress={() => handlePrintHistoricalBooking(item)}
                            style={{
                              backgroundColor: '#eff6ff',
                              borderColor: '#93c5fd',
                              borderWidth: 1,
                              paddingVertical: 9,
                              paddingHorizontal: 12,
                              borderRadius: 12,
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 6,
                            }}
                            activeOpacity={0.75}
                          >
                            <MaterialIcons name="print" size={16} color="#2563eb" />
                            <Text style={{ fontSize: 12, fontWeight: '800', color: '#1d4ed8' }}>Print Order Receipt</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  }}
                />
              </View>
            )}
        </>
      )}

      {/* Sales / Order / Invoice Preview Modal (Single Modal Architecture) */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          Keyboard.dismiss();
          if (isPrinting) {
            Alert.alert('Print Canceled', 'The print operation was canceled.');
            setIsPrinting(false);
            return;
          }
          if (modalStep === 'preview' && !isHistoryPreview) {
            setModalStep('form');
          } else if (modalStep === 'return_review') {
            setModalStep('form');
          } else {
            setModalVisible(false);
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
            {modalStep === 'preview' && previewInvoice ? (
              <View style={{ flex: 1, paddingTop: 16, paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 36 : 28 }}>
                {/* Modal Top Bar */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 8 }}>
                    {!isHistoryPreview && (
                      <TouchableOpacity
                        onPress={() => {
                          Keyboard.dismiss();
                          setModalStep('form');
                        }}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          backgroundColor: '#f1f5f9',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginRight: 10,
                        }}
                        activeOpacity={0.7}
                      >
                        <MaterialIcons name="arrow-back" size={20} color="#0f172a" />
                      </TouchableOpacity>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: '900', color: '#0f172a' }}>
                        {isHistoryPreview
                          ? previewInvoice.order_type === 'order' ? 'Order Receipt Details' : 'Invoice Details'
                          : previewInvoice.order_type === 'order' ? 'Order Booking Receipt Preview' : 'Mobile Invoice Preview'}
                      </Text>
                      <Text style={{ fontSize: 11, color: '#64748b', marginTop: 1 }} numberOfLines={1}>
                        {previewInvoice.invoice_number} • {previewInvoice.customer_name}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TouchableOpacity
                      onPress={handleSharePdf}
                      disabled={isSharing}
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
                      {isSharing ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <>
                          <MaterialIcons name="share" size={14} color="#38bdf8" />
                          <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '800' }}>Share</Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => {
                        Keyboard.dismiss();
                        setModalVisible(false);
                      }}
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
                      <MaterialIcons name="close" size={18} color="#64748b" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Printable Receipt Preview ScrollView with soft thermal backing */}
                <ScrollView
                  style={{ flex: 1, backgroundColor: '#f4f4f5', borderRadius: 14 }}
                  showsVerticalScrollIndicator={true}
                  contentContainerStyle={{ paddingVertical: 14, alignItems: 'center' }}
                >
                  <InvoicePreviewContent invoice={previewInvoice} />
                </ScrollView>

                {/* Bottom Sticky Action Footer */}
                <View style={{ paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 18 : 14, borderTopWidth: 1, borderTopColor: '#e2e8f0', marginTop: 4 }}>
                  {!isHistoryPreview ? (
                    isPrinting ? (
                      <View style={{ gap: 10, width: '100%' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 2 }}>
                          <ActivityIndicator size="small" color="#059669" />
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>
                            Sending to Bluetooth Thermal POS...
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={handleStopPrinting}
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
                      </View>
                    ) : (
                      <View style={{ gap: 8 }}>
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                          {/* 1. Edit Items Button */}
                          <TouchableOpacity
                            onPress={() => setModalStep('form')}
                            style={{
                              flex: 1,
                              backgroundColor: '#f8fafc',
                              borderColor: '#cbd5e1',
                              borderWidth: 1.5,
                              borderRadius: 16,
                              paddingVertical: 14,
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexDirection: 'row',
                              gap: 6,
                            }}
                            activeOpacity={0.8}
                          >
                            <MaterialIcons name="edit" size={18} color="#0f172a" />
                            <Text style={{ color: '#0f172a', fontSize: 13, fontWeight: '800' }}>
                              Edit Items
                            </Text>
                          </TouchableOpacity>

                          {/* 2. Confirm & Print Button */}
                          <TouchableOpacity
                            onPress={handleConfirmPrint}
                            style={{
                              flex: 1.4,
                              backgroundColor: previewInvoice.order_type === 'order' ? '#2563eb' : '#059669',
                              borderRadius: 16,
                              paddingVertical: 14,
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexDirection: 'row',
                              gap: 6,
                              shadowColor: previewInvoice.order_type === 'order' ? '#2563eb' : '#059669',
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.25,
                              shadowRadius: 4,
                              elevation: 3,
                            }}
                            activeOpacity={0.85}
                          >
                            <MaterialIcons name="print" size={18} color="#ffffff" />
                            <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '900' }}>
                              {previewInvoice.order_type === 'order' ? 'Confirm & Print Receipt' : 'Confirm & Print'}
                            </Text>
                          </TouchableOpacity>
                        </View>

                        {/* Optional Save Without Print */}
                        <TouchableOpacity
                          onPress={handleConfirmWithoutPrint}
                          style={{
                            backgroundColor: '#f1f5f9',
                            borderRadius: 12,
                            paddingVertical: 9,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={{ color: '#475569', fontSize: 11, fontWeight: '700' }}>
                            {previewInvoice.order_type === 'order'
                              ? 'Save Order Booking without Printing'
                              : 'Save Direct Sale without Printing'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      {isPrinting ? (
                        <TouchableOpacity
                          onPress={handleStopPrinting}
                          style={{
                            flex: 1,
                            backgroundColor: '#ef4444',
                            borderRadius: 16,
                            paddingVertical: 14,
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexDirection: 'row',
                            gap: 8,
                          }}
                          activeOpacity={0.85}
                        >
                          <MaterialIcons name="stop-circle" size={20} color="#ffffff" />
                          <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '900' }}>
                            Stop Printing
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          onPress={handleConfirmPrint}
                          style={{
                            flex: 1,
                            backgroundColor: '#2563eb',
                            borderRadius: 16,
                            paddingVertical: 14,
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexDirection: 'row',
                            gap: 8,
                          }}
                          activeOpacity={0.85}
                        >
                          <MaterialIcons name="print" size={18} color="#ffffff" />
                          <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '900' }}>
                            {previewInvoice?.order_type === 'order' ? 'Print Receipt' : 'Print via Printer'}
                          </Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity
                        onPress={() => setModalVisible(false)}
                        style={{
                          backgroundColor: '#f1f5f9',
                          borderRadius: 16,
                          paddingHorizontal: 20,
                          paddingVertical: 14,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: '#334155', fontSize: 13, fontWeight: '800' }}>Close</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            ) : modalStep === 'return_review' ? (
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
                style={{ flex: 1, paddingTop: 16, paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 36 : 28 }}
              >
                <View style={{ flex: 1 }}>
                  {/* Return Review Header */}
                  <View className="flex-row justify-between items-center mb-3">
                    <TouchableOpacity
                      onPress={() => {
                        Keyboard.dismiss();
                        setModalStep('form');
                      }}
                      className="flex-row items-center gap-1 bg-slate-100 px-3 py-1.5 rounded-xl active:bg-slate-200"
                    >
                      <MaterialIcons name="arrow-back" size={16} color="#334155" />
                      <Text className="text-xs font-bold text-slate-700">Back to Items</Text>
                    </TouchableOpacity>

                    <View className="items-center flex-1 px-2">
                      <Text className="text-base font-black text-slate-800">Return Details</Text>
                      <Text className="text-[11px] text-slate-500" numberOfLines={1}>
                        {customerName}
                      </Text>
                    </View>

                    <TouchableOpacity
                      onPress={() => setModalVisible(false)}
                      className="w-8 h-8 rounded-full bg-slate-100 items-center justify-center"
                    >
                      <MaterialIcons name="close" size={18} color="#64748b" />
                    </TouchableOpacity>
                  </View>

                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingBottom: 16 }}
                  >
                    {/* 1. Returned Items Summary Card */}
                    <View className="bg-amber-50/70 border border-amber-200 rounded-2xl p-3.5 mb-3">
                      <View className="flex-row justify-between items-center mb-2">
                        <View className="flex-row items-center gap-1.5">
                          <MaterialIcons name="assignment-return" size={16} color="#b45309" />
                          <Text className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                            Returning {totalUnits} Unit(s)
                          </Text>
                        </View>
                        <Text className="text-xs font-black text-amber-900">
                          Total Value: ₹{totalAmount.toFixed(2)}
                        </Text>
                      </View>

                      {activeStockList
                        .filter(stock => {
                          const key = getStockKey(stock);
                          return (itemLooseQuantities[key] || 0) > 0 || (itemBagQuantities[key] || 0) > 0;
                        })
                        .map(stock => {
                          const key = getStockKey(stock);
                          const looseQty = itemLooseQuantities[key] || 0;
                          const bagQty = itemBagQuantities[key] || 0;
                          const looseRate = getProductLooseRate(stock);
                          const bagRate = getProductBagRate(stock);
                          const sub = (looseQty * looseRate) + (bagQty * bagRate);
                          const whName = (stock as any).warehouse_name;
                          const pkgType = resolveStockPackageType(stock);
                          const unitLabel = resolveStockUnitLabel(stock);
                          return (
                            <View
                              key={key}
                              className="bg-white/90 rounded-xl p-2.5 mb-1.5 flex-row justify-between items-center border border-amber-100 shadow-2xs"
                            >
                              <View className="flex-1 pr-2">
                                <Text className="text-xs font-bold text-slate-800" numberOfLines={1}>
                                  {stock.product_name}
                                </Text>
                                <View className="flex-row items-center gap-1.5 mt-0.5 flex-wrap">
                                  {whName ? (
                                    <Text className="text-[10px] text-blue-700 font-bold">
                                      🏢 {whName}
                                    </Text>
                                  ) : null}
                                  {stock.product_sku ? (
                                    <Text className="text-[10px] text-slate-500 font-medium">
                                      SKU: {stock.product_sku}
                                    </Text>
                                  ) : null}
                                </View>
                              </View>
                              <View className="items-end">
                                {bagQty > 0 && (
                                  <Text className="text-xs font-black text-slate-700">
                                    {bagQty} {pkgType}{bagQty > 1 ? 's' : ''} × ₹{bagRate.toFixed(2)}
                                  </Text>
                                )}
                                {looseQty > 0 && (
                                  <Text className="text-xs font-black text-slate-700">
                                    {looseQty} {unitLabel} × ₹{looseRate.toFixed(2)}
                                  </Text>
                                )}
                                <Text className="text-xs font-black text-amber-800 mt-0.5">
                                  ₹{sub.toFixed(2)}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                    </View>

                    {/* 2. Reason for Return (Note Space) */}
                    <View className="bg-white rounded-2xl p-3.5 mb-3 border border-slate-200 shadow-xs">
                      <View className="flex-row justify-between items-center mb-1.5">
                        <View className="flex-row items-center gap-1">
                          <MaterialIcons name="edit-note" size={18} color="#d97706" />
                          <Text className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                            Reason for Return <Text className="text-rose-500">*</Text>
                          </Text>
                        </View>
                        <Text className="text-[10px] text-slate-400 font-medium">Required Note</Text>
                      </View>

                      <Text className="text-[11px] text-slate-500 mb-2.5">
                        Why is this product being returned by the customer?
                      </Text>

                      {/* Quick Reason Chips */}
                      <View className="flex-row flex-wrap gap-1.5 mb-2.5">
                        {[
                          'Damaged Goods',
                          'Expired / Near Expiry',
                          'Defective Packaging',
                          'Customer Overstock',
                          'Wrong Item Delivered',
                          'Quality Issue',
                        ].map((reasonChip, idx) => {
                          const isPicked = returnReason.includes(reasonChip);
                          return (
                            <TouchableOpacity
                              key={idx}
                              onPress={() => {
                                if (!isPicked) {
                                  setReturnReason(prev => (prev.trim() ? `${prev.trim()}, ${reasonChip}` : reasonChip));
                                }
                              }}
                              className={`px-2.5 py-1 rounded-lg border ${
                                isPicked
                                  ? 'bg-amber-100 border-amber-300'
                                  : 'bg-slate-50 border-slate-200'
                              }`}
                              activeOpacity={0.7}
                            >
                              <Text
                                className={`text-[10px] font-bold ${
                                  isPicked ? 'text-amber-900' : 'text-slate-600'
                                }`}
                              >
                                + {reasonChip}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Multiline Note Space */}
                      <TextInput
                        value={returnReason}
                        onChangeText={setReturnReason}
                        multiline
                        numberOfLines={3}
                        placeholder="Enter return notes here (e.g., carton torn on arrival, package seal broken, customer requested exchange)..."
                        placeholderTextColor="#94a3b8"
                        textAlignVertical="top"
                        style={{
                          backgroundColor: '#f8fafc',
                          borderColor: returnReason.trim() ? '#d97706' : '#cbd5e1',
                          borderWidth: 1.5,
                          minHeight: 76,
                        }}
                        className="rounded-xl p-3 text-xs text-slate-800 leading-relaxed font-medium"
                      />
                    </View>

                    {/* 3. Refundable Question */}
                    <View className="bg-white rounded-2xl p-3.5 mb-3 border border-slate-200 shadow-xs">
                      <View className="flex-row items-center gap-1.5 mb-1">
                        <MaterialIcons name="help-outline" size={17} color="#2563eb" />
                        <Text className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                          Is this price refundable? <Text className="text-rose-500">*</Text>
                        </Text>
                      </View>
                      <Text className="text-[11px] text-slate-500 mb-3">
                        Ask salesman: Is this customer entitled to a price refund for returned goods?
                      </Text>

                      {/* Yes / No Selection Cards */}
                      <View className="flex-row gap-2.5 mb-3">
                        {/* YES OPTION */}
                        <TouchableOpacity
                          onPress={() => {
                            setIsRefundable(true);
                            if (!refundAmount || refundAmount === '0' || refundAmount === '0.00') {
                              setRefundAmount(String(totalAmount.toFixed(2)));
                            }
                          }}
                          style={{
                            backgroundColor: isRefundable ? '#ecfdf5' : '#f8fafc',
                            borderColor: isRefundable ? '#059669' : '#e2e8f0',
                            borderWidth: 2,
                          }}
                          className="flex-1 p-3 rounded-2xl items-center justify-center"
                          activeOpacity={0.8}
                        >
                          <View className="flex-row items-center gap-1.5 mb-1">
                            <MaterialIcons
                              name={isRefundable ? 'check-circle' : 'radio-button-unchecked'}
                              size={18}
                              color={isRefundable ? '#059669' : '#94a3b8'}
                            />
                            <Text
                              className={`text-sm font-black ${
                                isRefundable ? 'text-emerald-800' : 'text-slate-600'
                              }`}
                            >
                              YES, Refundable
                            </Text>
                          </View>
                          <Text className="text-[10px] text-center font-medium text-slate-500">
                            Issue cash payout or credit adjustment
                          </Text>
                        </TouchableOpacity>

                        {/* NO OPTION */}
                        <TouchableOpacity
                          onPress={() => {
                            setIsRefundable(false);
                            setRefundAmount('0');
                          }}
                          style={{
                            backgroundColor: !isRefundable ? '#fff1f2' : '#f8fafc',
                            borderColor: !isRefundable ? '#e11d48' : '#e2e8f0',
                            borderWidth: 2,
                          }}
                          className="flex-1 p-3 rounded-2xl items-center justify-center"
                          activeOpacity={0.8}
                        >
                          <View className="flex-row items-center gap-1.5 mb-1">
                            <MaterialIcons
                              name={!isRefundable ? 'cancel' : 'radio-button-unchecked'}
                              size={18}
                              color={!isRefundable ? '#e11d48' : '#94a3b8'}
                            />
                            <Text
                              className={`text-sm font-black ${
                                !isRefundable ? 'text-rose-800' : 'text-slate-600'
                              }`}
                            >
                              NO, Non-Refundable
                            </Text>
                          </View>
                          <Text className="text-[10px] text-center font-medium text-slate-500">
                            Replacement / write-off (₹0.00)
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {/* Conditional: If YES -> Enter Refund Amount & Payment Mode */}
                      {isRefundable ? (
                        <View style={{ backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', borderWidth: 1 }} className="p-3 rounded-2xl">
                          <View className="flex-row justify-between items-center mb-1">
                            <Text className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider">
                              Enter Refund Amount (₹) <Text className="text-rose-500">*</Text>
                            </Text>
                            <View className="flex-row gap-1">
                              <TouchableOpacity
                                onPress={() => setRefundAmount(String(totalAmount.toFixed(2)))}
                                style={{ backgroundColor: '#dcfce7' }}
                                className="px-2 py-0.5 rounded-md"
                                activeOpacity={0.7}
                              >
                                <Text className="text-[9px] font-bold text-emerald-800">
                                  Full (₹{totalAmount.toFixed(0)})
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => setRefundAmount(String((totalAmount * 0.5).toFixed(2)))}
                                style={{ backgroundColor: '#e2e8f0' }}
                                className="px-2 py-0.5 rounded-md"
                                activeOpacity={0.7}
                              >
                                <Text className="text-[9px] font-bold text-slate-700">50%</Text>
                              </TouchableOpacity>
                            </View>
                          </View>

                          <View
                            style={{ backgroundColor: '#ffffff', borderColor: '#059669', borderWidth: 1.5 }}
                            className="flex-row items-center rounded-xl px-3 py-2 mt-1 mb-2.5"
                          >
                            <Text className="text-base font-black text-emerald-700 mr-1.5">₹</Text>
                            <TextInput
                              value={refundAmount}
                              onChangeText={setRefundAmount}
                              keyboardType="numeric"
                              selectTextOnFocus
                              placeholder={String(totalAmount.toFixed(2))}
                              placeholderTextColor="#94a3b8"
                              className="flex-1 font-black text-base text-slate-800 p-0"
                            />
                          </View>

                          {/* Refund Payment Mode Selector */}
                          <Text className="text-[10px] font-bold text-emerald-900 uppercase tracking-wider mb-1.5">
                            Refund Payment Method:
                          </Text>
                          <View className="flex-row gap-1.5">
                            {[
                              { id: 'Cash', label: 'Cash Out', icon: 'payments' },
                              { id: 'UPI', label: 'UPI / Online', icon: 'smartphone' },
                              { id: 'Credit', label: 'Adjust Due', icon: 'account-balance-wallet' },
                            ].map(m => {
                              const isChosen = refundMode === m.id;
                              return (
                                <TouchableOpacity
                                  key={m.id}
                                  onPress={() => setRefundMode(m.id as any)}
                                  style={{
                                    backgroundColor: isChosen ? '#059669' : '#ffffff',
                                    borderColor: isChosen ? '#059669' : '#cbd5e1',
                                    borderWidth: 1,
                                  }}
                                  className="flex-1 py-2 px-1 rounded-xl items-center flex-row justify-center gap-1"
                                  activeOpacity={0.7}
                                >
                                  <MaterialIcons
                                    name={m.icon as any}
                                    size={13}
                                    color={isChosen ? '#ffffff' : '#64748b'}
                                  />
                                  <Text
                                    className={`text-[10px] font-bold ${
                                      isChosen ? 'text-white' : 'text-slate-700'
                                    }`}
                                  >
                                    {m.label}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>

                          <Text className="text-[10px] text-emerald-800 mt-2 font-medium">
                            {refundMode === 'Credit'
                              ? `ℹ️ ₹${parseFloat(refundAmount || '0').toFixed(2)} will be credited to reduce ${customerName}'s balance due.`
                              : `ℹ️ Salesman will disburse ₹${parseFloat(refundAmount || '0').toFixed(2)} directly to customer via ${refundMode}.`}
                          </Text>
                        </View>
                      ) : (
                        <View style={{ backgroundColor: '#fff1f2', borderColor: '#fecdd3', borderWidth: 1 }} className="p-3 rounded-2xl flex-row items-center gap-2">
                          <MaterialIcons name="info" size={18} color="#e11d48" />
                          <View className="flex-1">
                            <Text className="text-xs font-bold text-rose-900">
                              Non-Refundable Return (₹0.00)
                            </Text>
                            <Text className="text-[10px] text-rose-700 mt-0.5">
                              No cash or balance credit will be disbursed to customer. The items will be restocked to inventory.
                            </Text>
                          </View>
                        </View>
                      )}
                    </View>
                  </ScrollView>

                  {/* Bottom Confirm Return Button */}
                  <View style={{ paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 20 : 16, borderTopWidth: 1, borderTopColor: '#e2e8f0', backgroundColor: '#ffffff' }}>
                    <TouchableOpacity
                      onPress={handleFinalizeReturn}
                      disabled={!returnReason.trim()}
                      style={{
                        backgroundColor: returnReason.trim() ? '#d97706' : '#cbd5e1',
                      }}
                      className="py-3.5 rounded-2xl items-center flex-row justify-center gap-2 shadow-sm"
                      activeOpacity={0.8}
                    >
                      <MaterialIcons name="check-circle" size={18} color="#ffffff" />
                      <Text className="text-white font-black text-sm">
                        {returnReason.trim()
                          ? `Confirm & Record Return • ${isRefundable ? `Refund ₹${parseFloat(refundAmount || '0').toFixed(2)}` : 'No Refund'}`
                          : 'Enter Return Reason to Confirm'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </KeyboardAvoidingView>
            ) : (
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
                style={{ flex: 1, paddingTop: 16, paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 36 : 28 }}
              >
                <View style={{ flex: 1 }}>
                  {/* Modal Top Bar */}
                  <View className="flex-row justify-between items-center mb-3">
              <View className="flex-1 pr-2">
                <Text className="text-lg font-black text-slate-800">
                  {saleType === 'sale'
                    ? 'Direct Van Sale'
                    : saleType === 'order'
                    ? 'Advance Booking Order'
                    : 'Product Return'}
                </Text>
                <Text className="text-xs text-slate-500">
                  {saleType === 'sale'
                    ? 'Spot delivery & cash sale from loaded van'
                    : saleType === 'order'
                    ? 'Book advance order for subsequent delivery'
                    : 'Record return of goods & enter refund details'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                className="w-8 h-8 rounded-full bg-slate-100 items-center justify-center"
              >
                <MaterialIcons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Top Static Info: Customer Badge */}
            <View className="bg-blue-50/80 border border-blue-100 rounded-2xl px-3.5 py-2 mb-2 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2 flex-1 pr-2">
                <View className="w-8 h-8 rounded-xl bg-blue-600 items-center justify-center">
                  <MaterialIcons name="storefront" size={17} color="#ffffff" />
                </View>
                <View className="flex-1">
                  <Text className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                    Customer / Outlet
                  </Text>
                  <Text className="text-sm font-black text-slate-800" numberOfLines={1}>
                    {customerName || 'Customer'}
                  </Text>
                  <View className="flex-row items-center gap-2 mt-0.5 flex-wrap">
                    {customerPlace ? (
                      <Text className="text-[10px] text-slate-500 font-medium" numberOfLines={1}>
                        📍 {customerPlace}
                      </Text>
                    ) : null}
                    {selectedCustomer?.gst_in && selectedCustomer.gst_in.trim() && !['URP', 'NONE', 'NIL', 'NON-GST'].includes(selectedCustomer.gst_in.trim().toUpperCase()) ? (
                      <View className="bg-sky-100 border border-sky-300 px-1.5 py-0.5 rounded flex-row items-center gap-0.5">
                        <MaterialIcons name="receipt-long" size={10} color="#0369a1" />
                        <Text className="text-[9px] font-black text-sky-900">
                          GST: {selectedCustomer.gst_in}
                        </Text>
                      </View>
                    ) : (
                      <View className="bg-slate-200/80 px-1.5 py-0.5 rounded">
                        <Text className="text-[9px] font-semibold text-slate-500">
                          Non-GST
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
              <View
                className={`px-2 py-0.5 rounded-lg ${
                  saleType === 'sale'
                    ? 'bg-emerald-100'
                    : saleType === 'order'
                    ? 'bg-blue-100'
                    : 'bg-amber-100'
                }`}
              >
                <Text
                  className={`text-[10px] font-bold ${
                    saleType === 'sale'
                      ? 'text-emerald-800'
                      : saleType === 'order'
                      ? 'text-blue-800'
                      : 'text-amber-800'
                  }`}
                >
                  {saleType === 'sale'
                    ? 'Spot Sale'
                    : saleType === 'order'
                    ? 'Advance'
                    : 'Return'}
                </Text>
              </View>
            </View>

            {/* Top Static Info: Search Bar for Stocks */}
            <View className="bg-white rounded-2xl px-3.5 py-2 mb-2 flex-row items-center border border-slate-200 shadow-xs">
              <MaterialIcons name="search" size={18} color="#64748b" />
              <TextInput
                value={stockSearch}
                onChangeText={setStockSearch}
                placeholder={
                  saleType === 'order' || saleType === 'return'
                    ? 'Search all warehouse stocks, SKU, or depot...'
                    : 'Search van stock products or SKU...'
                }
                placeholderTextColor="#94a3b8"
                className="flex-1 ml-2 text-xs text-slate-800"
                returnKeyType="search"
              />
              {stockSearch.length > 0 && (
                <TouchableOpacity onPress={() => setStockSearch('')} className="p-1">
                  <MaterialIcons name="cancel" size={16} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>

            {/* Top Static Info: Warehouse Filter Chips for Returns */}
            {saleType === 'return' && availableWarehouses.length > 0 && (
              <View className="mb-2">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 6, paddingVertical: 1 }}
                >
                  <TouchableOpacity
                    onPress={() => setWarehouseFilter('All Warehouses')}
                    className={`px-3 py-1.5 rounded-xl border flex-row items-center gap-1.5 ${
                      warehouseFilter === 'All Warehouses'
                        ? 'bg-blue-600 border-blue-600'
                        : 'bg-white border-slate-200'
                    }`}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons
                      name="warehouse"
                      size={13}
                      color={warehouseFilter === 'All Warehouses' ? '#ffffff' : '#64748b'}
                    />
                    <Text
                      className={`text-[11px] font-bold ${
                        warehouseFilter === 'All Warehouses' ? 'text-white' : 'text-slate-700'
                      }`}
                    >
                      All Warehouses ({effectiveWarehouseStocks.length})
                    </Text>
                  </TouchableOpacity>

                  {availableWarehouses.map((whName, idx) => {
                    const count = effectiveWarehouseStocks.filter(s => s.warehouse_name === whName).length;
                    const isSelected = warehouseFilter === whName;
                    return (
                      <TouchableOpacity
                        key={idx}
                        onPress={() => setWarehouseFilter(whName)}
                        className={`px-3 py-1.5 rounded-xl border flex-row items-center gap-1.5 ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600'
                            : 'bg-white border-slate-200'
                        }`}
                        activeOpacity={0.7}
                      >
                        <MaterialIcons
                          name="domain"
                          size={13}
                          color={isSelected ? '#ffffff' : '#64748b'}
                        />
                        <Text
                          className={`text-[11px] font-bold ${
                            isSelected ? 'text-white' : 'text-slate-700'
                          }`}
                        >
                          {whName} ({count})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Top Static Info: Section Header */}
            <View className="flex-row justify-between items-center mb-2 px-1">
              <Text 
                className="text-xs font-bold text-slate-700 uppercase tracking-wider flex-1 mr-2"
                numberOfLines={1}
              >
                {saleType === 'order'
                  ? `Order Products (${filteredModalStocks.length})`
                  : saleType === 'return'
                  ? `Return Stocks (${filteredModalStocks.length})`
                  : `Van Stocks (${filteredModalStocks.length})`}
              </Text>
              <Text className="text-[10px] font-medium text-slate-400 shrink-0">
                Tap + / - to add qty
              </Text>
            </View>

            {/* Middle Scrollable Section: ONLY the Stock List moves */}
            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 12 }}
            >
              {/* Empty state when no stocks match filter/search */}
              {filteredModalStocks.length === 0 && (
                <View className="bg-white rounded-2xl p-6 items-center justify-center my-4 border border-dashed border-slate-200">
                  <MaterialIcons name="inventory" size={36} color="#94a3b8" />
                  <Text className="text-sm font-bold text-slate-700 mt-2 text-center">
                    {saleType === 'sale' ? 'No Van Stock Loaded' : 'No stocks found'}
                  </Text>
                  <Text className="text-xs text-slate-400 mt-0.5 text-center">
                    {stockSearch
                      ? `No items match "${stockSearch}"`
                      : saleType === 'sale'
                      ? 'No stocks loaded in the van. Stocks must be loaded from Warehouse to sell.'
                      : 'No stock available for this selection'}
                  </Text>
                  {(stockSearch.length > 0 || warehouseFilter !== 'All Warehouses') && (
                    <TouchableOpacity
                      onPress={() => {
                        setStockSearch('');
                        setWarehouseFilter('All Warehouses');
                      }}
                      className="mt-3 px-4 py-2 bg-blue-50 border border-blue-200 rounded-xl flex-row items-center gap-1.5"
                    >
                      <MaterialIcons name="refresh" size={14} color="#2563eb" />
                      <Text className="text-xs font-bold text-blue-600">Reset Filters</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* 1-by-1 Products Down List */}
              {filteredModalStocks.map(stock => {
                const key = getStockKey(stock);
                const looseQty = itemLooseQuantities[key] || 0;
                const bagQty = itemBagQuantities[key] || 0;
                const pkgType = resolveStockPackageType(stock);
                const unitLabel = resolveStockUnitLabel(stock);
                const itemsPerPkg = Math.max(1, Number(stock.items_per_package) || 1);

                const piecePrice = getProductDefaultRate(stock, 'loose');
                const boxPrice = getProductDefaultRate(stock, 'box');

                const looseRate = getProductLooseRate(stock);
                const bagRate = getProductBagRate(stock);

                const looseGross = looseQty * looseRate;
                const bagGross = bagQty * bagRate;
                const lineGross = looseGross + bagGross;

                const discInfo = getItemDiscountInfo(stock, lineGross);
                const discType = itemDiscountTypes[key] || 'amount';
                const lineTotal = Math.max(0, lineGross - discInfo.discAmt);
                const isSelected = looseQty > 0 || bagQty > 0;

                const isCustomLoose =
                  customLooseRates[key] !== undefined &&
                  customLooseRates[key].trim() !== '' &&
                  parseFloat(customLooseRates[key]) !== piecePrice;

                const isCustomBag =
                  customBagRates[key] !== undefined &&
                  customBagRates[key].trim() !== '' &&
                  parseFloat(customBagRates[key]) !== boxPrice;

                const isWarehouseStock = (stock as any).warehouse_name !== undefined;
                const availableStockCount = (stock as any).available_quantity !== undefined
                  ? Number((stock as any).available_quantity)
                  : Number((stock as any).quantity || (stock as any).total_qty || 0);
                const isOutOfStock = availableStockCount <= 0;
                const maxBoxesAvailable = Math.floor(availableStockCount / itemsPerPkg);

                return (
                  <View
                    key={key}
                    style={{
                      backgroundColor: isSelected ? '#f0fdf4' : isOutOfStock ? '#fef2f2' : '#ffffff',
                      borderColor: isSelected ? '#10b981' : isOutOfStock ? '#f87171' : '#e2e8f0',
                      borderWidth: 1.5,
                    }}
                    className="p-3.5 rounded-2xl mb-3"
                  >
                    {/* Product Name, SKU, Category, Warehouse and Stock */}
                    <View className="flex-row justify-between items-start mb-1.5">
                      <View className="flex-1 pr-2">
                        <Text className={`text-sm font-bold ${isOutOfStock ? 'text-red-900' : 'text-slate-800'} leading-snug`}>
                          {stock.product_name}
                        </Text>
                        <View className="flex-row items-center gap-1.5 mt-1 flex-wrap">
                          {saleType !== 'order' && isWarehouseStock && (stock as any).warehouse_name ? (
                            <View
                              style={{ backgroundColor: '#eff6ff', borderColor: '#bfdbfe', borderWidth: 1 }}
                              className="px-2 py-0.5 rounded-md flex-row items-center gap-1"
                            >
                              <MaterialIcons name="domain" size={11} color="#2563eb" />
                              <Text className="text-[10px] font-bold text-blue-700">
                                {(stock as any).warehouse_name}
                              </Text>
                            </View>
                          ) : null}

                          {stock.category_name ? (
                            <View
                              style={{ backgroundColor: '#e2e8f0' }}
                              className="px-2 py-0.5 rounded-md"
                            >
                              <Text className="text-[10px] font-semibold text-slate-700">
                                {stock.category_name}
                              </Text>
                            </View>
                          ) : null}

                          {stock.product_sku ? (
                            <View
                              style={{ backgroundColor: '#f1f5f9' }}
                              className="px-1.5 py-0.5 rounded-md"
                            >
                              <Text className="text-[9px] font-medium text-slate-500">
                                SKU: {stock.product_sku}
                              </Text>
                            </View>
                          ) : null}

                          <View
                            style={{
                              backgroundColor: isOutOfStock ? '#fee2e2' : (isWarehouseStock ? '#f0fdf4' : '#eff6ff'),
                              borderColor: isOutOfStock ? '#fca5a5' : (isWarehouseStock ? '#bbf7d0' : '#dbeafe'),
                              borderWidth: 1,
                            }}
                            className="px-2 py-0.5 rounded-md flex-row items-center gap-1"
                          >
                            <MaterialIcons
                              name={isOutOfStock ? 'error-outline' : (isWarehouseStock ? 'inventory-2' : 'inventory')}
                              size={11}
                              color={isOutOfStock ? '#dc2626' : (isWarehouseStock ? '#16a34a' : '#2563eb')}
                            />
                            <Text
                              className={`text-[10px] font-bold ${
                                isOutOfStock
                                  ? 'text-red-700'
                                  : isWarehouseStock
                                  ? 'text-emerald-800'
                                  : 'text-blue-700'
                              }`}
                            >
                              {isOutOfStock
                                ? (saleType === 'order' ? 'Out of Stock (0)' : (isWarehouseStock ? 'Warehouse Out of Stock (0)' : 'Van Out of Stock (0 Units)'))
                                : (isWarehouseStock
                                    ? (saleType === 'order'
                                        ? `Available: ${availableStockCount} ${unitLabel}${itemsPerPkg > 1 ? ` (${maxBoxesAvailable} ${pkgType}s)` : ''}`
                                        : `Warehouse Stock: ${availableStockCount} ${unitLabel}`)
                                    : `Van Stock: ${formatStockQty(stock as any).fullDisplay}`)}
                            </Text>
                          </View>

                          {isSelected && (
                            <View className="bg-emerald-100 px-2 py-0.5 rounded-md flex-row items-center gap-1 border border-emerald-300">
                              <MaterialIcons name="check-circle" size={11} color="#065f46" />
                              <Text className="text-[10px] font-bold text-emerald-800">
                                In Cart: {bagQty > 0 ? `${bagQty} ${pkgType}${bagQty > 1 ? 's' : ''}` : ''}
                                {bagQty > 0 && looseQty > 0 ? ' + ' : ''}
                                {looseQty > 0 ? `${looseQty} ${unitLabel}` : ''}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>

                      {/* Default Selling Rates Badge (Hidden in Orders) */}
                      {saleType !== 'order' && (
                        <View className="items-end">
                          <Text className="text-[10px] text-slate-400 font-medium">Standard Rates</Text>
                          <Text className="text-[11px] font-bold text-slate-700">
                            ₹{piecePrice.toFixed(2)}/{unitLabel}
                          </Text>
                          <Text className="text-[10px] font-bold text-slate-500">
                            ₹{boxPrice.toFixed(2)}/{pkgType}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Quantity Selectors or Disabled Out of Stock Banner */}
                    {saleType === 'sale' && isOutOfStock ? (
                      <View
                        style={{ backgroundColor: '#fee2e2', borderColor: '#fca5a5', borderWidth: 1 }}
                        className="flex-row items-center justify-between p-2.5 rounded-xl mt-1.5"
                      >
                        <View className="flex-row items-center gap-1.5 flex-1 pr-2">
                          <MaterialIcons name="block" size={16} color="#dc2626" />
                          <Text className="text-xs font-bold text-red-700">
                            Out of Stock • Cannot Add to Sales
                          </Text>
                        </View>
                        <View className="bg-red-200 px-2 py-0.5 rounded-md">
                          <Text className="text-[10px] font-black text-red-800">0 IN VAN</Text>
                        </View>
                      </View>
                    ) : (
                      <View style={{ marginTop: 6 }} className="gap-2">
                        {/* 1. Loose Quantity Option */}
                        <View
                          style={{
                            backgroundColor: looseQty > 0 ? '#eff6ff' : '#ffffff',
                            borderColor: looseQty > 0 ? '#3b82f6' : '#e2e8f0',
                            borderWidth: 1.5,
                            borderRadius: 14,
                            padding: 10,
                          }}
                        >
                          <View className="flex-row justify-between items-center">
                            <View className="flex-1 pr-2">
                              <View className="flex-row items-center gap-1.5">
                                <MaterialIcons
                                  name="grain"
                                  size={15}
                                  color={looseQty > 0 ? '#2563eb' : '#64748b'}
                                />
                                <Text
                                  style={{
                                    fontSize: 12,
                                    fontWeight: '800',
                                    color: looseQty > 0 ? '#1e40af' : '#1e293b',
                                  }}
                                >
                                  1. Loose Quantity
                                </Text>
                                {looseQty > 0 && (
                                  <View style={{ backgroundColor: '#dbeafe' }} className="px-1.5 py-0.5 rounded">
                                    <Text className="text-[9px] font-black text-blue-800">
                                      {looseQty} {unitLabel}
                                    </Text>
                                  </View>
                                )}
                              </View>
                              <Text className="text-[10px] text-slate-500 mt-0.5 font-medium">
                                Individual {unitLabel} • ₹{looseRate.toFixed(2)} / {unitLabel}
                              </Text>
                            </View>

                            {/* Loose Stepper */}
                            <View className="flex-row items-center gap-1.5">
                              <TouchableOpacity
                                onPress={() => updateLooseQuantity(key, -1)}
                                disabled={looseQty <= 0}
                                style={{
                                  backgroundColor: looseQty > 0 ? '#ffffff' : '#f1f5f9',
                                  borderColor: '#cbd5e1',
                                  borderWidth: 1.5,
                                  width: 36,
                                  height: 36,
                                }}
                                className="rounded-xl items-center justify-center"
                                activeOpacity={0.7}
                              >
                                <MaterialIcons
                                  name="remove"
                                  size={16}
                                  color={looseQty > 0 ? '#1e293b' : '#94a3b8'}
                                />
                              </TouchableOpacity>

                              <TextInput
                                value={String(looseQty || 0)}
                                onChangeText={val => setDirectLooseQuantity(key, val)}
                                keyboardType="numeric"
                                selectTextOnFocus
                                style={{
                                  backgroundColor: '#ffffff',
                                  borderColor: looseQty > 0 ? '#3b82f6' : '#cbd5e1',
                                  borderWidth: 1.5,
                                  height: 36,
                                  minHeight: 36,
                                  width: 48,
                                  paddingVertical: 0,
                                  paddingTop: 0,
                                  paddingBottom: 0,
                                  paddingHorizontal: 0,
                                  textAlign: 'center',
                                  textAlignVertical: 'center',
                                  includeFontPadding: false,
                                  fontSize: 14,
                                  fontWeight: '800',
                                  color: '#0f172a',
                                }}
                                className="rounded-xl"
                              />

                              <TouchableOpacity
                                onPress={() => updateLooseQuantity(key, 1)}
                                style={{
                                  backgroundColor: '#2563eb',
                                  width: 36,
                                  height: 36,
                                }}
                                className="rounded-xl items-center justify-center"
                                activeOpacity={0.8}
                              >
                                <MaterialIcons name="add" size={16} color="#ffffff" />
                              </TouchableOpacity>
                            </View>
                          </View>

                          {/* Loose Rate Edit (Hidden in Orders) */}
                          {saleType !== 'order' && (
                            <View className="flex-row items-center justify-between mt-2 pt-2 border-t border-slate-100">
                              <View className="flex-row items-center gap-1">
                                <Text className="text-[10px] text-slate-500 font-medium">
                                  Rate / {unitLabel}:
                                </Text>
                                {isCustomLoose && (
                                  <View style={{ backgroundColor: '#dcfce7' }} className="px-1 py-0.2 rounded">
                                    <Text className="text-[8px] font-extrabold text-emerald-800">Custom</Text>
                                  </View>
                                )}
                              </View>
                              <View className="flex-row items-center gap-1.5">
                                {isCustomLoose && (
                                  <TouchableOpacity
                                    onPress={() => updateCustomLooseRate(key, String(piecePrice))}
                                    className="px-1.5 py-0.5 bg-slate-100 rounded"
                                    activeOpacity={0.7}
                                  >
                                    <Text className="text-[9px] font-bold text-slate-600">Reset</Text>
                                  </TouchableOpacity>
                                )}
                                <View className="flex-row items-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-0.5">
                                  <Text className="text-[10px] font-bold text-slate-500 mr-0.5">₹</Text>
                                  <TextInput
                                    value={customLooseRates[key] !== undefined ? customLooseRates[key] : String(piecePrice)}
                                    onChangeText={val => updateCustomLooseRate(key, val)}
                                    keyboardType="numeric"
                                    selectTextOnFocus
                                    placeholder={String(piecePrice)}
                                    style={{
                                      paddingVertical: 0,
                                      paddingHorizontal: 0,
                                      textAlignVertical: 'center',
                                      includeFontPadding: false,
                                      height: 22,
                                    }}
                                    className="w-14 text-right font-black text-xs text-slate-800"
                                  />
                                </View>
                              </View>
                            </View>
                          )}

                          {/* Loose Line Subtotal (Hidden in Orders) */}
                          {saleType !== 'order' && looseQty > 0 && (
                            <View className="flex-row justify-between items-center mt-1.5 pt-1.5 border-t border-blue-100">
                              <Text className="text-[10px] text-blue-700 font-medium">Loose Subtotal</Text>
                              <Text className="text-xs font-black text-blue-900">₹{looseGross.toFixed(2)}</Text>
                            </View>
                          )}
                        </View>

                        {/* 2. Bag Quantity Option */}
                        <View
                          style={{
                            backgroundColor: bagQty > 0 ? '#ecfdf5' : '#ffffff',
                            borderColor: bagQty > 0 ? '#10b981' : '#e2e8f0',
                            borderWidth: 1.5,
                            borderRadius: 14,
                            padding: 10,
                          }}
                        >
                          <View className="flex-row justify-between items-center">
                            <View className="flex-1 pr-2">
                              <View className="flex-row items-center gap-1.5 flex-wrap">
                                <MaterialIcons
                                  name="shopping-bag"
                                  size={15}
                                  color={bagQty > 0 ? '#059669' : '#64748b'}
                                />
                                <Text
                                  style={{
                                    fontSize: 12,
                                    fontWeight: '800',
                                    color: bagQty > 0 ? '#065f46' : '#1e293b',
                                  }}
                                >
                                  2. Bag Quantity
                                </Text>
                                {itemsPerPkg > 1 && (
                                  <View style={{ backgroundColor: '#f1f5f9' }} className="px-1.5 py-0.5 rounded">
                                    <Text className="text-[9px] font-bold text-slate-600">
                                      1 {pkgType} = {itemsPerPkg} {unitLabel}
                                    </Text>
                                  </View>
                                )}
                                {bagQty > 0 && (
                                  <View style={{ backgroundColor: '#d1fae5' }} className="px-1.5 py-0.5 rounded">
                                    <Text className="text-[9px] font-black text-emerald-800">
                                      {bagQty} {pkgType}{bagQty > 1 ? 's' : ''}
                                    </Text>
                                  </View>
                                )}
                              </View>
                              <Text className="text-[10px] text-slate-500 mt-0.5 font-medium">
                                Full {pkgType} packaging • ₹{bagRate.toFixed(2)} / {pkgType}
                              </Text>
                            </View>

                            {/* Bag Stepper */}
                            <View className="flex-row items-center gap-1.5">
                              <TouchableOpacity
                                onPress={() => updateBagQuantity(key, -1)}
                                disabled={bagQty <= 0}
                                style={{
                                  backgroundColor: bagQty > 0 ? '#ffffff' : '#f1f5f9',
                                  borderColor: '#cbd5e1',
                                  borderWidth: 1.5,
                                  width: 36,
                                  height: 36,
                                }}
                                className="rounded-xl items-center justify-center"
                                activeOpacity={0.7}
                              >
                                <MaterialIcons
                                  name="remove"
                                  size={16}
                                  color={bagQty > 0 ? '#1e293b' : '#94a3b8'}
                                />
                              </TouchableOpacity>

                              <TextInput
                                value={String(bagQty || 0)}
                                onChangeText={val => setDirectBagQuantity(key, val)}
                                keyboardType="numeric"
                                selectTextOnFocus
                                style={{
                                  backgroundColor: '#ffffff',
                                  borderColor: bagQty > 0 ? '#10b981' : '#cbd5e1',
                                  borderWidth: 1.5,
                                  height: 36,
                                  minHeight: 36,
                                  width: 48,
                                  paddingVertical: 0,
                                  paddingTop: 0,
                                  paddingBottom: 0,
                                  paddingHorizontal: 0,
                                  textAlign: 'center',
                                  textAlignVertical: 'center',
                                  includeFontPadding: false,
                                  fontSize: 14,
                                  fontWeight: '800',
                                  color: '#0f172a',
                                }}
                                className="rounded-xl"
                              />

                              <TouchableOpacity
                                onPress={() => updateBagQuantity(key, 1)}
                                style={{
                                  backgroundColor: '#059669',
                                  width: 36,
                                  height: 36,
                                }}
                                className="rounded-xl items-center justify-center"
                                activeOpacity={0.8}
                              >
                                <MaterialIcons name="add" size={16} color="#ffffff" />
                              </TouchableOpacity>
                            </View>
                          </View>

                          {/* Bag Rate Edit (Hidden in Orders) */}
                          {saleType !== 'order' && (
                            <View className="flex-row items-center justify-between mt-2 pt-2 border-t border-slate-100">
                              <View className="flex-row items-center gap-1">
                                <Text className="text-[10px] text-slate-500 font-medium">
                                  Rate / {pkgType}:
                                </Text>
                                {isCustomBag && (
                                  <View style={{ backgroundColor: '#dcfce7' }} className="px-1 py-0.2 rounded">
                                    <Text className="text-[8px] font-extrabold text-emerald-800">Custom</Text>
                                  </View>
                                )}
                              </View>
                              <View className="flex-row items-center gap-1.5">
                                {isCustomBag && (
                                  <TouchableOpacity
                                    onPress={() => updateCustomBagRate(key, String(boxPrice))}
                                    className="px-1.5 py-0.5 bg-slate-100 rounded"
                                    activeOpacity={0.7}
                                  >
                                    <Text className="text-[9px] font-bold text-slate-600">Reset</Text>
                                  </TouchableOpacity>
                                )}
                                <View className="flex-row items-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-0.5">
                                  <Text className="text-[10px] font-bold text-slate-500 mr-0.5">₹</Text>
                                  <TextInput
                                    value={customBagRates[key] !== undefined ? customBagRates[key] : String(boxPrice)}
                                    onChangeText={val => updateCustomBagRate(key, val)}
                                    keyboardType="numeric"
                                    selectTextOnFocus
                                    placeholder={String(boxPrice)}
                                    style={{
                                      paddingVertical: 0,
                                      paddingHorizontal: 0,
                                      textAlignVertical: 'center',
                                      includeFontPadding: false,
                                      height: 22,
                                    }}
                                    className="w-14 text-right font-black text-xs text-slate-800"
                                  />
                                </View>
                              </View>
                            </View>
                          )}

                          {/* Bag Line Subtotal (Hidden in Orders) */}
                          {saleType !== 'order' && bagQty > 0 && (
                            <View className="flex-row justify-between items-center mt-1.5 pt-1.5 border-t border-emerald-100">
                              <Text className="text-[10px] text-emerald-700 font-medium">Bag Subtotal</Text>
                              <Text className="text-xs font-black text-emerald-900">₹{bagGross.toFixed(2)}</Text>
                            </View>
                          )}
                        </View>

                        {/* Option to Add / Edit Manual Item Discount (Hidden in Orders) */}
                        {saleType !== 'order' && isSelected && (
                          <View
                            style={{
                              backgroundColor: discInfo.isDiscounted ? '#fff1f2' : '#ffffff',
                              borderColor: discInfo.isDiscounted ? '#f43f5e' : '#e2e8f0',
                              borderWidth: 1,
                            }}
                            className="rounded-xl px-3 py-2 mt-0.5 flex-row items-center justify-between"
                          >
                            <View className="flex-1 pr-2">
                              <View className="flex-row items-center gap-1.5">
                                <MaterialIcons
                                  name="local-offer"
                                  size={13}
                                  color={discInfo.isDiscounted ? '#e11d48' : '#64748b'}
                                />
                                <Text className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                                  Item Discount
                                </Text>
                                {discInfo.isDiscounted && (
                                  <View style={{ backgroundColor: '#ffe4e6' }} className="px-1.5 py-0.5 rounded">
                                    <Text className="text-[9px] font-extrabold text-rose-700">
                                      -₹{discInfo.discAmt.toFixed(2)}
                                    </Text>
                                  </View>
                                )}
                              </View>
                              <Text className="text-[10px] text-slate-400 mt-0.5">
                                {discInfo.isDiscounted
                                  ? (discType === 'percent'
                                      ? `${discInfo.percent}% off • Saved ₹${discInfo.discAmt.toFixed(2)}`
                                      : `Flat ₹${discInfo.discAmt.toFixed(2)} off line total`)
                                  : 'Enter manual line discount (₹ / %)'}
                              </Text>
                            </View>

                            <View className="flex-row items-center gap-1.5">
                              {/* ₹ / % Mode Selector Toggle */}
                              <View
                                style={{
                                  backgroundColor: '#f1f5f9',
                                  borderColor: '#cbd5e1',
                                  borderWidth: 1,
                                  borderRadius: 8,
                                  flexDirection: 'row',
                                  overflow: 'hidden',
                                }}
                              >
                                <TouchableOpacity
                                  onPress={() => {
                                    if (discType !== 'amount') toggleItemDiscountType(key);
                                  }}
                                  style={{
                                    backgroundColor: discType === 'amount' ? '#2563eb' : 'transparent',
                                    paddingHorizontal: 7,
                                    paddingVertical: 4,
                                  }}
                                  activeOpacity={0.7}
                                >
                                  <Text style={{ color: discType === 'amount' ? '#ffffff' : '#64748b', fontSize: 11, fontWeight: '800' }}>
                                    ₹
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => {
                                    if (discType !== 'percent') toggleItemDiscountType(key);
                                  }}
                                  style={{
                                    backgroundColor: discType === 'percent' ? '#2563eb' : 'transparent',
                                    paddingHorizontal: 7,
                                    paddingVertical: 4,
                                  }}
                                  activeOpacity={0.7}
                                >
                                  <Text style={{ color: discType === 'percent' ? '#ffffff' : '#64748b', fontSize: 11, fontWeight: '800' }}>
                                    %
                                  </Text>
                                </TouchableOpacity>
                              </View>

                              {/* Clear Button */}
                              {discInfo.isDiscounted && (
                                <TouchableOpacity
                                  onPress={() => updateItemDiscount(key, '')}
                                  style={{ backgroundColor: '#f1f5f9' }}
                                  className="px-1.5 py-1 rounded-md"
                                  activeOpacity={0.7}
                                >
                                  <MaterialIcons name="close" size={14} color="#64748b" />
                                </TouchableOpacity>
                              )}

                              {/* Manual Discount Input */}
                              <View
                                style={{
                                  backgroundColor: '#f8fafc',
                                  borderColor: discInfo.isDiscounted ? '#f43f5e' : '#cbd5e1',
                                  borderWidth: 1.5,
                                }}
                                className="flex-row items-center rounded-lg px-2 py-1"
                              >
                                <Text className="text-xs font-bold text-slate-500 mr-0.5">
                                  {discType === 'amount' ? '₹' : '%'}
                                </Text>
                                <TextInput
                                  value={itemDiscounts[key] || ''}
                                  onChangeText={val => updateItemDiscount(key, val)}
                                  keyboardType="numeric"
                                  selectTextOnFocus
                                  placeholder="0"
                                  placeholderTextColor="#94a3b8"
                                  style={{
                                    paddingVertical: 0,
                                    paddingHorizontal: 0,
                                    textAlignVertical: 'center',
                                    includeFontPadding: false,
                                    height: 32,
                                  }}
                                  className="w-14 text-right font-black text-sm text-slate-800"
                                />
                              </View>
                            </View>
                          </View>
                        )}

                        {/* Combined Subtotal Summary */}
                        {isSelected && (
                          <View
                            style={{ borderTopColor: '#e2e8f0', borderTopWidth: 1 }}
                            className="flex-row justify-between items-center pt-2 mt-0.5"
                          >
                            <View>
                              <Text className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                                Combined Selected Qty
                              </Text>
                              <Text className="text-xs font-black text-slate-800 mt-0.5">
                                {bagQty > 0 ? `${bagQty} ${pkgType}${bagQty > 1 ? 's' : ''}` : ''}
                                {bagQty > 0 && looseQty > 0 ? ' + ' : ''}
                                {looseQty > 0 ? `${looseQty} Loose ${unitLabel}` : ''}
                                {itemsPerPkg > 1 ? ` (${(bagQty * itemsPerPkg) + looseQty} total ${unitLabel})` : ''}
                              </Text>
                            </View>

                            {saleType !== 'order' ? (
                              <View className="items-end">
                                <View className="flex-row items-center gap-1">
                                  {discInfo.isDiscounted && (
                                    <Text className="text-[10px] text-slate-400 line-through">
                                      ₹{lineGross.toFixed(2)}
                                    </Text>
                                  )}
                                  <Text className="text-[10px] text-slate-400 font-medium">Item Total</Text>
                                </View>
                                <View className="flex-row items-center gap-1">
                                  {discInfo.isDiscounted && (
                                    <Text className="text-[10px] font-bold text-rose-600">
                                      (-₹{discInfo.discAmt.toFixed(2)})
                                    </Text>
                                  )}
                                  <Text className="text-sm font-black text-emerald-700">
                                    ₹{lineTotal.toFixed(2)}
                                  </Text>
                                </View>
                              </View>
                            ) : (
                              <View className="bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-xl">
                                <Text className="text-xs font-black text-blue-700">
                                  {(bagQty * itemsPerPkg) + looseQty} Total Units
                                </Text>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            {/* Bottom Static Area: Selected Quantity Box and Confirm Button (Elevated slightly upward) */}
            <View style={{ paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 20 : 16, borderTopWidth: 1, borderTopColor: '#e2e8f0', backgroundColor: '#ffffff' }}>
              {/* Trade Offer Qualified Highlight Banner (Collapsible to prevent covering stock list) */}
              {schemeEval?.qualifiedSchemes && schemeEval.qualifiedSchemes.length > 0 && (
                <View className="mb-2">
                  {isSchemeBannerMinimized ? (
                    /* Minimized Pill Bar - Takes minimal height (~32px), keeps all active schemes intact */
                    <TouchableOpacity
                      onPress={() => setIsSchemeBannerMinimized(false)}
                      activeOpacity={0.8}
                      style={{
                        backgroundColor: '#ecfdf5',
                        borderColor: '#10b981',
                        borderWidth: 1,
                      }}
                      className="rounded-xl px-3 py-1.5 flex-row items-center justify-between shadow-xs"
                    >
                      <View className="flex-row items-center gap-1.5 flex-1 pr-2">
                        <Text className="text-xs">🎉</Text>
                        <Text className="text-[11px] font-bold text-emerald-950" numberOfLines={1}>
                          {schemeDiscount > 0 || Object.keys(acceptedFreeRewards).length > 0
                            ? `Trade Offer Active${schemeDiscount > 0 ? ` (-₹${schemeDiscount.toFixed(2)})` : ''}${Object.keys(acceptedFreeRewards).length > 0 ? ' + Free Gift' : ''}`
                            : `${schemeEval.qualifiedSchemes.length} Trade Offer(s) Qualified • Tap to Activate`}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-1 bg-emerald-600 px-2 py-0.5 rounded-lg">
                        <Text className="text-[10px] font-bold text-white">
                          {schemeDiscount > 0 || Object.keys(acceptedFreeRewards).length > 0 ? 'Active Offers' : 'View Offers'}
                        </Text>
                        <MaterialIcons name="keyboard-arrow-up" size={14} color="#ffffff" />
                      </View>
                    </TouchableOpacity>
                  ) : (
                    /* Expanded Banner - Compact & with Minimize button */
                    <View
                      style={{
                        backgroundColor: '#f0fdf4',
                        borderColor: '#10b981',
                        borderWidth: 1.5,
                      }}
                      className="rounded-2xl p-2.5 shadow-xs"
                    >
                      {/* Banner Header with Minimize Toggle */}
                      <View className="flex-row items-center justify-between mb-1.5 pb-1 border-b border-emerald-200">
                        <View className="flex-row items-center gap-1.5 flex-1 pr-2">
                          <Text className="text-xs">🎉</Text>
                          <Text className="text-xs font-black text-emerald-950 leading-tight">
                            Trade Offers Qualified ({schemeEval.qualifiedSchemes.length})
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => setIsSchemeBannerMinimized(true)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          className="flex-row items-center gap-0.5 bg-emerald-200 active:bg-emerald-300 px-2.5 py-0.5 rounded-full"
                          accessibilityLabel="Minimize banner"
                        >
                          <Text className="text-[10px] font-bold text-emerald-900">Minimize</Text>
                          <MaterialIcons name="keyboard-arrow-down" size={13} color="#065f46" />
                        </TouchableOpacity>
                      </View>

                      {/* Schemes List with Max Height to keep items list visible */}
                      <ScrollView style={{ maxHeight: 155 }} nestedScrollEnabled showsVerticalScrollIndicator={true}>
                        {schemeEval.qualifiedSchemes.map(qs => {
                          const isFreeAdded = Boolean(acceptedFreeRewards[qs.scheme_id]);
                          const isDiscountApplied = Boolean(acceptedDiscountSchemes[qs.scheme_id]);

                          return (
                            <View
                              key={qs.scheme_id}
                              style={{
                                backgroundColor: '#ffffff',
                                borderColor: (isFreeAdded || isDiscountApplied) ? '#059669' : '#a7f3d0',
                                borderWidth: 1,
                              }}
                              className="rounded-xl p-2 mb-1.5 shadow-xs"
                            >
                              <View className="flex-row items-center justify-between mb-0.5">
                                <Text className="text-xs font-bold text-emerald-950 flex-1 pr-2" numberOfLines={1}>
                                  {qs.name}
                                </Text>
                                <View className={`px-1.5 py-0.5 rounded-md ${(isFreeAdded || isDiscountApplied) ? 'bg-emerald-600' : 'bg-emerald-100'}`}>
                                  <Text className={`text-[8.5px] font-black uppercase tracking-wider ${(isFreeAdded || isDiscountApplied) ? 'text-white' : 'text-emerald-800'}`}>
                                    {(isFreeAdded || isDiscountApplied) ? 'Active ✓' : 'Qualified'}
                                  </Text>
                                </View>
                              </View>

                              <Text className="text-[11px] font-semibold text-emerald-800 mb-1.5 leading-tight">
                                {qs.reward_summary}
                              </Text>

                              {/* FREE PRODUCT ACTION */}
                              {qs.freeItem && (
                                <View className="flex-row items-center justify-between pt-1 border-t border-emerald-100">
                                  <View className="flex-row items-center gap-1 flex-1 pr-2">
                                    <MaterialIcons name="inventory-2" size={12} color="#047857" />
                                    <Text className="text-[9.5px] text-emerald-800 font-medium" numberOfLines={1}>
                                      {isFreeAdded ? '✓ Added (Deducts Van stock)' : 'Stock reduces from Van'}
                                    </Text>
                                  </View>

                                  {isFreeAdded ? (
                                    <TouchableOpacity
                                      onPress={() => handleRemoveFreeReward(qs.scheme_id)}
                                      className="bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded-lg flex-row items-center gap-1 active:bg-emerald-100"
                                      activeOpacity={0.7}
                                    >
                                      <MaterialIcons name="check" size={11} color="#065f46" />
                                      <Text className="text-[9.5px] font-bold text-emerald-800">Added</Text>
                                      <Text className="text-[9.5px] text-red-600 font-bold ml-0.5">Remove</Text>
                                    </TouchableOpacity>
                                  ) : (
                                    <TouchableOpacity
                                      onPress={() => handleAddFreeReward(qs)}
                                      className="bg-emerald-600 active:bg-emerald-700 px-2.5 py-1 rounded-lg shadow-xs flex-row items-center gap-1"
                                      activeOpacity={0.8}
                                    >
                                      <MaterialIcons name="add-circle" size={12} color="#ffffff" />
                                      <Text className="text-[10.5px] font-extrabold text-white">
                                        + Add Free Reward Item
                                      </Text>
                                    </TouchableOpacity>
                                  )}
                                </View>
                              )}

                              {/* DISCOUNT ACTION */}
                              {qs.reward_type === 'DISCOUNT' && (
                                <View className="flex-row items-center justify-between pt-1 border-t border-emerald-100">
                                  <View className="flex-row items-center gap-1 flex-1 pr-2">
                                    <MaterialIcons name="local-offer" size={12} color="#047857" />
                                    <Text className="text-[9.5px] text-emerald-800 font-medium" numberOfLines={1}>
                                      {isDiscountApplied
                                        ? `✓ Applied (-₹${(Number(qs.discount_amount) || 0).toFixed(2)})`
                                        : `Save ₹${(Number(qs.discount_amount) || 0).toFixed(2)} on bill`}
                                    </Text>
                                  </View>

                                  {isDiscountApplied ? (
                                    <TouchableOpacity
                                      onPress={() => handleRemoveDiscountScheme(qs.scheme_id)}
                                      className="bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded-lg flex-row items-center gap-1 active:bg-emerald-100"
                                      activeOpacity={0.7}
                                    >
                                      <MaterialIcons name="check" size={11} color="#065f46" />
                                      <Text className="text-[9.5px] font-bold text-emerald-800">Applied</Text>
                                      <Text className="text-[9.5px] text-red-600 font-bold ml-0.5">Remove</Text>
                                    </TouchableOpacity>
                                  ) : (
                                    <TouchableOpacity
                                      onPress={() => handleApplyDiscountScheme(qs.scheme_id)}
                                      className="bg-emerald-600 active:bg-emerald-700 px-2.5 py-1 rounded-lg shadow-xs flex-row items-center gap-1"
                                      activeOpacity={0.8}
                                    >
                                      <MaterialIcons name="percent" size={12} color="#ffffff" />
                                      <Text className="text-[10.5px] font-extrabold text-white">
                                        + Apply Scheme Discount (-₹{(Number(qs.discount_amount) || 0).toFixed(2)})
                                      </Text>
                                    </TouchableOpacity>
                                  )}
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </ScrollView>
                    </View>
                  )}
                </View>
              )}

              {/* Bill Summary & Cash Collection Box */}
              <View
                style={{ backgroundColor: '#f8fafc', borderColor: '#e2e8f0', borderWidth: 1 }}
                className="p-2.5 rounded-2xl mb-2.5"
              >
                {saleType === 'order' ? (
                  <View className="flex-row justify-between items-center mb-1.5">
                    <View>
                      <Text className="text-[10px] text-slate-500 font-medium leading-tight">Selected Quantity</Text>
                      <Text className="text-xs font-bold text-slate-800 leading-tight">
                        {summaryQtyText} • {selectedProductCount} product(s)
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-[10px] text-slate-500 font-medium leading-tight">Order Total</Text>
                      <Text className="text-sm font-bold text-blue-700 leading-tight">
                        {summaryQtyText}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View className="gap-1 mb-1.5">
                    {/* Selected Quantity and Subtotal Gross */}
                    <View className="flex-row justify-between items-center">
                      <View>
                        <Text className="text-[10px] text-slate-500 font-medium leading-tight">Selected Quantity</Text>
                        <Text className="text-xs font-bold text-slate-800 leading-tight">
                          {summaryQtyText} • {selectedProductCount} product(s)
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-[10px] text-slate-500 font-medium leading-tight">Subtotal (Gross)</Text>
                        <Text className="text-xs font-bold text-slate-700 leading-tight">
                          ₹{subtotalGross.toFixed(2)}
                        </Text>
                      </View>
                    </View>

                    {/* Item Discount Row (highlighted if manualDiscount > 0) */}
                    {manualDiscount > 0 && (
                      <View className="flex-row justify-between items-center bg-rose-50 px-2 py-1 rounded-lg border border-rose-100">
                        <View className="flex-row items-center gap-1">
                          <MaterialIcons name="local-offer" size={12} color="#e11d48" />
                          <Text className="text-[10px] font-bold text-rose-800">
                            Item Discount:
                          </Text>
                        </View>
                        <Text className="text-xs font-black text-rose-700">
                          - ₹{manualDiscount.toFixed(2)}
                        </Text>
                      </View>
                    )}

                    {/* Scheme Trade Discount Row (highlighted if schemeDiscount > 0) */}
                    {schemeDiscount > 0 && (
                      <View className="flex-row justify-between items-center bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200">
                        <View className="flex-row items-center gap-1">
                          <MaterialIcons name="card-giftcard" size={12} color="#059669" />
                          <Text className="text-[10px] font-bold text-emerald-800">
                            Scheme Trade Discount:
                          </Text>
                        </View>
                        <Text className="text-xs font-black text-emerald-700">
                          - ₹{schemeDiscount.toFixed(2)}
                        </Text>
                      </View>
                    )}

                    {/* Automatic Round Off (Non-editable) Row */}
                    <View className="flex-row justify-between items-center px-1">
                      <View className="flex-row items-center gap-1">
                        <MaterialIcons name="lock" size={11} color="#64748b" />
                        <Text className="text-[10px] font-medium text-slate-500">
                          Round Off:
                        </Text>
                        <View className="bg-slate-200 px-1.5 py-0.5 rounded">
                          <Text className="text-[8.5px] font-bold text-slate-600">Auto (Non-editable)</Text>
                        </View>
                      </View>
                      <Text
                        style={{
                          color: roundOff > 0 ? '#047857' : roundOff < 0 ? '#b91c1c' : '#64748b',
                          fontWeight: '700',
                          fontSize: 11,
                        }}
                      >
                        {roundOff > 0 ? `+ ₹${roundOff.toFixed(2)}` : roundOff < 0 ? `- ₹${Math.abs(roundOff).toFixed(2)}` : '₹0.00'}
                      </Text>
                    </View>

                    {/* Net Total Bill Amount Row */}
                    <View className="flex-row justify-between items-center pt-1 border-t border-slate-200 mt-0.5">
                      <Text className="text-xs font-black text-slate-800">
                        Total Bill Amount:
                      </Text>
                      <Text className="text-base font-black text-emerald-700">
                        ₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Cash Collection Input (ONLY for Direct Sales; Hidden for Orders) */}
                {saleType === 'return' ? (
                  <View style={{ borderTopColor: '#e2e8f0', borderTopWidth: 1 }} className="pt-2 flex-row items-center justify-between">
                    <View className="flex-row items-center gap-1.5 flex-1 pr-2">
                      <MaterialIcons name="info-outline" size={14} color="#d97706" />
                      <Text className="text-[11px] text-amber-800 font-medium">
                        Return reason & refund options are configured next.
                      </Text>
                    </View>
                    <View className="bg-amber-100 px-2 py-0.5 rounded-md">
                      <Text className="text-[10px] font-bold text-amber-900">{totalUnits} Unit(s)</Text>
                    </View>
                  </View>
                ) : saleType === 'sale' ? (
                  <View style={{ borderTopColor: '#e2e8f0', borderTopWidth: 1 }} className="pt-1.5">
                    <View className="flex-row justify-between items-center mb-1">
                      <Text className="text-[10px] font-bold text-slate-700">
                        Cash Received (₹)
                      </Text>
                      <View className="flex-row gap-1">
                        <TouchableOpacity
                          onPress={() => setCustomAdvance(String(totalAmount))}
                          style={{ backgroundColor: '#dcfce7' }}
                          className="px-2 py-0.5 rounded-md"
                          activeOpacity={0.7}
                        >
                          <Text className="text-[9px] font-bold text-emerald-800">Full Cash</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setCustomAdvance('0')}
                          style={{ backgroundColor: '#e2e8f0' }}
                          className="px-2 py-0.5 rounded-md"
                          activeOpacity={0.7}
                        >
                          <Text className="text-[9px] font-bold text-slate-700">Credit (₹0)</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <TextInput
                      value={
                        customAdvance !== ''
                          ? customAdvance
                          : totalAmount > 0
                          ? String(totalAmount)
                          : ''
                      }
                      onChangeText={setCustomAdvance}
                      placeholder={`₹${totalAmount.toFixed(2)}`}
                      placeholderTextColor="#94a3b8"
                      keyboardType="numeric"
                      style={{ backgroundColor: '#ffffff', borderColor: '#cbd5e1', borderWidth: 1 }}
                      className="rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800"
                    />

                    {balanceAmount > 0 && (
                      <View className="flex-row justify-between items-center mt-1">
                        <Text className="text-[10px] font-semibold text-amber-700">
                          Balance Pending (Credit):
                        </Text>
                        <Text className="text-[11px] font-black text-amber-700">
                          ₹{balanceAmount.toFixed(2)}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : null}
              </View>

              {/* Bottom Action Button */}
              {saleType === 'sale' ? (
                <View className="flex-row items-center gap-2">
                  <TouchableOpacity
                    onPress={handleSaveSale}
                    disabled={totalUnits <= 0}
                    style={{
                      backgroundColor: totalUnits > 0 ? '#f8fafc' : '#f1f5f9',
                      borderColor: totalUnits > 0 ? '#cbd5e1' : '#e2e8f0',
                      borderWidth: 1.5,
                    }}
                    className="py-3 px-3.5 rounded-2xl items-center flex-row justify-center gap-1.5"
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="save" size={18} color={totalUnits > 0 ? "#334155" : "#94a3b8"} />
                    <Text style={{ color: totalUnits > 0 ? "#1e293b" : "#94a3b8", fontWeight: '700', fontSize: 13 }}>
                      Save Only
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleOpenInvoicePreview}
                    disabled={totalUnits <= 0}
                    style={{
                      backgroundColor: totalUnits > 0 ? '#059669' : '#cbd5e1',
                    }}
                    className="flex-1 py-3 rounded-2xl items-center flex-row justify-center gap-2 shadow-sm"
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="print" size={18} color="#ffffff" />
                    <Text className="text-white font-bold text-sm">
                      {totalUnits > 0
                        ? `Print Invoice • ₹${totalAmount.toFixed(2)}`
                        : 'Select Items Above'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : saleType === 'order' ? (
                <View className="flex-row items-center gap-2">
                  <TouchableOpacity
                    onPress={handleOpenInvoicePreview}
                    disabled={totalUnits <= 0}
                    className="p-3 rounded-2xl items-center justify-center bg-blue-50 border border-blue-200"
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="receipt-long" size={20} color={totalUnits > 0 ? "#2563eb" : "#94a3b8"} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSaveSale}
                    disabled={totalUnits <= 0}
                    style={{
                      backgroundColor: totalUnits > 0 ? '#2563eb' : '#cbd5e1',
                    }}
                    className="flex-1 py-3 rounded-2xl items-center flex-row justify-center gap-2 shadow-sm"
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="check-circle" size={18} color="#ffffff" />
                    <Text className="text-white font-bold text-sm">
                      {totalUnits > 0
                        ? `Confirm & Book Order (${totalUnits} Units)`
                        : 'Select Items Above'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={handleSaveSale}
                  disabled={totalUnits <= 0}
                  style={{
                    backgroundColor: totalUnits > 0 ? '#d97706' : '#cbd5e1',
                  }}
                  className="py-3 rounded-2xl items-center flex-row justify-center gap-2 shadow-sm"
                  activeOpacity={0.8}
                >
                  <MaterialIcons
                    name="assignment-return"
                    size={18}
                    color="#ffffff"
                  />
                  <Text className="text-white font-bold text-sm">
                    {totalUnits > 0
                      ? `Set Return Reason & Refund • ₹${totalAmount.toFixed(2)}`
                      : 'Select Items Above'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
                </View>
              </KeyboardAvoidingView>
            )}
          </View>
        </View>
      </Modal>

      {/* 5. Receive Payment / Balance Settlement Modal */}
      <Modal
        visible={paymentModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setPaymentModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-end bg-black/50"
        >
          <View className="bg-white rounded-t-3xl pt-5 px-5 pb-6" style={{ maxHeight: '90%' }}>
            {/* Modal Header */}
            <View className="flex-row justify-between items-center mb-3">
              <View className="flex-1 pr-2">
                <Text className="text-base font-bold text-slate-800 leading-tight">
                  Receive Customer Payment
                </Text>
                <Text className="text-xs text-slate-500 mt-0.5 leading-tight">
                  Collect and settle outstanding balance due
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setPaymentModalVisible(false)}
                className="w-8 h-8 rounded-full bg-slate-100 items-center justify-center"
              >
                <MaterialIcons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 20 }}
            >
              {/* Customer Due Info Card */}
              {paymentCustomer && (
                <View className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 mb-3 flex-row items-center justify-between">
                  <View className="flex-1 pr-2">
                    <Text className="text-[10px] font-bold text-rose-600 uppercase tracking-wider">
                      Customer
                    </Text>
                    <Text className="text-sm font-bold text-slate-800 leading-tight" numberOfLines={1}>
                      {paymentCustomer.name}
                    </Text>
                    {paymentCustomer.place ? (
                      <Text className="text-xs text-slate-500 mt-0.5 leading-tight">
                        📍 {paymentCustomer.place}
                      </Text>
                    ) : null}
                  </View>
                  <View className="items-end bg-white px-3 py-1.5 rounded-xl border border-rose-200 shadow-xs">
                    <Text className="text-[10px] font-bold text-rose-600 uppercase leading-tight">
                      Total Due
                    </Text>
                    <Text className="text-xs font-bold text-rose-700 leading-tight">
                      ₹{paymentTotalDue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                </View>
              )}

              {/* Amount to Receive Input */}
              <View className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-3">
                <View className="flex-row justify-between items-center mb-2">
                  <Text className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Amount to Receive (₹)
                  </Text>
                  <View className="flex-row gap-1.5">
                    <TouchableOpacity
                      onPress={() => setPaymentAmountInput(String(paymentTotalDue))}
                      style={{ backgroundColor: '#dcfce7' }}
                      className="px-2 py-0.5 rounded-md"
                      activeOpacity={0.7}
                    >
                      <Text className="text-[10px] font-bold text-emerald-800">
                        Full Due (₹{paymentTotalDue})
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setPaymentAmountInput('')}
                      style={{ backgroundColor: '#e2e8f0' }}
                      className="px-2 py-0.5 rounded-md"
                      activeOpacity={0.7}
                    >
                      <Text className="text-[10px] font-bold text-slate-600">Clear</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View className="bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 flex-row items-center">
                  <Text className="text-base font-extrabold text-slate-400 mr-2">₹</Text>
                  <TextInput
                    value={paymentAmountInput}
                    onChangeText={setPaymentAmountInput}
                    placeholder="0.00"
                    placeholderTextColor="#94a3b8"
                    keyboardType="numeric"
                    autoFocus={true}
                    className="flex-1 text-lg font-black text-slate-800 p-0"
                  />
                </View>

                {/* Remaining Due Preview */}
                {(() => {
                  const entered = parseFloat(paymentAmountInput) || 0;
                  const remaining = Math.max(0, paymentTotalDue - entered);
                  return (
                    <View className="flex-row justify-between items-center mt-2 pt-2 border-t border-slate-200">
                      <Text className="text-xs text-slate-500">Remaining Balance Due:</Text>
                      <Text
                        className={`text-xs font-bold ${
                          remaining === 0 ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {remaining === 0 ? 'Fully Cleared (₹0.00)' : `₹${remaining.toFixed(2)}`}
                      </Text>
                    </View>
                  );
                })()}
              </View>

              {/* Payment Mode Selector */}
              <View className="mb-3">
                <Text className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 ml-1">
                  Payment Method
                </Text>
                <View className="flex-row gap-2">
                  {(['Cash', 'UPI', 'Cheque'] as const).map(mode => {
                    const isSelected = paymentMode === mode;
                    return (
                      <TouchableOpacity
                        key={mode}
                        onPress={() => setPaymentMode(mode)}
                        style={{
                          backgroundColor: isSelected ? '#059669' : '#f8fafc',
                          borderColor: isSelected ? '#059669' : '#e2e8f0',
                          borderWidth: 1.5,
                        }}
                        className="flex-1 py-2.5 rounded-xl items-center flex-row justify-center gap-1.5"
                        activeOpacity={0.8}
                      >
                        <MaterialIcons
                          name={
                            mode === 'Cash'
                              ? 'money'
                              : mode === 'UPI'
                              ? 'qr-code-scanner'
                              : 'receipt'
                          }
                          size={16}
                          color={isSelected ? '#ffffff' : '#64748b'}
                        />
                        <Text
                          className={`text-xs font-bold ${
                            isSelected ? 'text-white' : 'text-slate-700'
                          }`}
                        >
                          {mode}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Optional Reference / Notes */}
              <View className="mb-4">
                <Text className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 ml-1">
                  Notes / Reference (Optional)
                </Text>
                <TextInput
                  value={paymentNotes}
                  onChangeText={setPaymentNotes}
                  placeholder="e.g. GPay Ref ID, Cheque #, or Receipt details"
                  placeholderTextColor="#94a3b8"
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-800"
                />
              </View>

              {/* Confirm Receipt Button */}
              <TouchableOpacity
                onPress={handleConfirmPayment}
                style={{
                  backgroundColor:
                    (parseFloat(paymentAmountInput) || 0) > 0 ? '#059669' : '#cbd5e1',
                }}
                disabled={(parseFloat(paymentAmountInput) || 0) <= 0}
                className="py-3.5 rounded-2xl items-center flex-row justify-center gap-2 shadow-sm"
                activeOpacity={0.8}
              >
                <MaterialIcons name="check-circle" size={18} color="#ffffff" />
                <Text className="text-white font-bold text-sm">
                  {(parseFloat(paymentAmountInput) || 0) > 0
                    ? `Confirm Payment Receipt • ₹${(parseFloat(paymentAmountInput) || 0).toFixed(2)}`
                    : 'Enter Amount to Confirm'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 6. Customer Picker Modal (For New Direct Sale and Taking New Order) */}
      <Modal
        visible={customerSelectorVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setCustomerSelectorVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-end bg-black/50"
        >
          <View
            style={{
              height: Platform.OS === 'ios' ? '88%' : '90%',
              backgroundColor: '#ffffff',
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              overflow: 'hidden',
              paddingTop: 18,
              paddingHorizontal: 16,
              paddingBottom: Platform.OS === 'ios' ? 24 : 16,
            }}
          >
            {/* Modal Header */}
            <View className="flex-row justify-between items-center mb-3">
              <View className="flex-1 pr-2">
                <Text className="text-base font-bold text-slate-800 leading-tight">
                  {selectorTargetType === 'sale'
                    ? 'Select Customer for Direct Sale'
                    : 'Select Customer for Advance Order'}
                </Text>
                <Text className="text-xs text-slate-500 mt-0.5 leading-tight">
                  Showing {filteredCustomers.length} shops in {selectedRoute.split('(')[0].trim()}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setCustomerSelectorVisible(false)}
                className="w-8 h-8 rounded-full bg-slate-100 items-center justify-center"
              >
                <MaterialIcons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Customer Search Bar */}
            <View className="bg-slate-50 rounded-2xl px-3.5 py-2 mb-3 flex-row items-center border border-slate-200">
              <MaterialIcons name="search" size={18} color="#94a3b8" />
              <TextInput
                value={customerSearch}
                onChangeText={setCustomerSearch}
                placeholder="Search shops by name, code, or area..."
                placeholderTextColor="#94a3b8"
                className="flex-1 ml-2 text-xs text-slate-800"
              />
              {customerSearch.length > 0 && (
                <TouchableOpacity onPress={() => setCustomerSearch('')}>
                  <MaterialIcons name="close" size={16} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>

            {/* Customers FlatList */}
            <FlatList
              data={filteredCustomers}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 20 }}
              ListEmptyComponent={
                <View className="py-14 items-center justify-center bg-white rounded-3xl p-6 border border-slate-100 shadow-sm mt-1">
                  <View className="w-14 h-14 rounded-full bg-blue-50 items-center justify-center mb-3">
                    <MaterialIcons name="storefront" size={28} color="#2563eb" />
                  </View>
                  <Text className="text-slate-800 font-bold text-base">No Customers Found</Text>
                  <Text className="text-slate-400 text-xs mt-1.5 text-center max-w-xs leading-relaxed">
                    No shops match "{customerSearch}" in {selectedRoute.split('(')[0].trim()}.
                  </Text>
                </View>
              }
              renderItem={({ item }) => {
                const custBalance = getBalanceForCustomer(item);
                const hasDue = custBalance > 0;

                return (
                  <View className="bg-white rounded-2xl p-3.5 mb-2.5 border border-slate-200 shadow-xs">
                    <View className="flex-row justify-between items-start">
                      <View className="flex-1 pr-2">
                        <View className="flex-row items-center gap-1.5 flex-wrap">
                          <Text className="text-sm font-bold text-slate-800">{item.name}</Text>
                          {item.customer_code ? (
                            <View className="bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded">
                              <Text className="text-[9px] font-bold text-blue-700">
                                {item.customer_code}
                              </Text>
                            </View>
                          ) : null}
                          {item.gst_in && item.gst_in.trim() && !['URP', 'NONE', 'NIL', 'NON-GST'].includes(item.gst_in.trim().toUpperCase()) ? (
                            <View className="bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded flex-row items-center gap-0.5">
                              <MaterialIcons name="verified" size={10} color="#059669" />
                              <Text className="text-[9px] font-black text-emerald-800">
                                GST
                              </Text>
                            </View>
                          ) : (
                            <View className="bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                              <Text className="text-[9px] font-medium text-slate-500">
                                Non-GST
                              </Text>
                            </View>
                          )}
                        </View>

                        {/* GST Number full line for quick visual identification */}
                        {item.gst_in && item.gst_in.trim() && !['URP', 'NONE', 'NIL', 'NON-GST'].includes(item.gst_in.trim().toUpperCase()) ? (
                          <View className="flex-row items-center gap-1 mt-1">
                            <MaterialIcons name="receipt-long" size={13} color="#0284c7" />
                            <Text className="text-[11px] font-bold text-sky-800">
                              GST No: <Text className="font-semibold text-slate-700">{item.gst_in.trim()}</Text>
                            </Text>
                          </View>
                        ) : null}

                        {item.place || item.route_area || item.address ? (
                          <View className="flex-row items-center gap-1 mt-1">
                            <MaterialIcons name="location-on" size={13} color="#64748b" />
                            <Text className="text-[11px] text-slate-500" numberOfLines={1}>
                              {item.place || item.route_area || item.address}
                            </Text>
                          </View>
                        ) : null}

                        {item.phone ? (
                          <View className="flex-row items-center gap-1 mt-0.5">
                            <MaterialIcons name="phone" size={12} color="#64748b" />
                            <Text className="text-[11px] text-slate-500">{item.phone}</Text>
                          </View>
                        ) : null}

                        {item.credit_limit || item.price_group_name ? (
                          <View className="flex-row items-center gap-1.5 mt-1 flex-wrap">
                            {item.credit_limit ? (
                              <View className="bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                <Text className="text-[9px] font-bold text-amber-800">
                                  Limit: ₹{Number(item.credit_limit).toLocaleString('en-IN')} ({item.credit_days || 30}d)
                                </Text>
                              </View>
                            ) : null}
                            {item.price_group_name ? (
                              <View className="bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded">
                                <Text className="text-[9px] font-bold text-purple-700">
                                  Tier: {item.price_group_name}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        ) : null}
                      </View>

                      {/* Outstanding Balance Due Box with Receive Due Button */}
                      <TouchableOpacity
                        onPress={() => {
                          setCustomerSelectorVisible(false);
                          openPaymentModal(item, custBalance);
                        }}
                        disabled={!hasDue}
                        activeOpacity={0.7}
                        style={{
                          backgroundColor: hasDue ? '#fff1f2' : '#ecfdf5',
                          borderColor: hasDue ? '#fecdd3' : '#a7f3d0',
                          borderWidth: 1,
                        }}
                        className="px-2.5 py-1 rounded-xl items-end shadow-xs flex-row items-center gap-1.5"
                      >
                        <MaterialIcons
                          name={hasDue ? 'payments' : 'check-circle'}
                          size={14}
                          color={hasDue ? '#e11d48' : '#059669'}
                        />
                        <View className="items-end">
                          <Text
                            className="text-[8px] font-black uppercase tracking-wider"
                            style={{ color: hasDue ? '#e11d48' : '#059669' }}
                          >
                            {hasDue ? 'Receive Due ›' : 'Balance'}
                          </Text>
                          <Text
                            className="text-[11px] font-black"
                            style={{ color: hasDue ? '#be123c' : '#047857' }}
                          >
                            {hasDue
                              ? `₹${custBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                              : '₹0'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>

                    {/* Action Buttons inside Customer Card */}
                    <View className="flex-row items-center justify-end gap-2 mt-2.5 pt-2 border-t border-slate-100">
                      {selectorTargetType === 'sale' ? (
                        <TouchableOpacity
                          onPress={() => {
                            setCustomerSelectorVisible(false);
                            openSaleModal(item, 'sale');
                          }}
                          className="bg-emerald-600 active:bg-emerald-700 px-3.5 py-1.5 rounded-xl flex-row items-center gap-1.5 shadow-xs"
                          activeOpacity={0.8}
                        >
                          <MaterialIcons name="point-of-sale" size={14} color="#ffffff" />
                          <Text className="text-white text-xs font-bold">Start Direct Sale ›</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          onPress={() => {
                            setCustomerSelectorVisible(false);
                            openSaleModal(item, 'order');
                          }}
                          className="bg-blue-600 active:bg-blue-700 px-3.5 py-1.5 rounded-xl flex-row items-center gap-1.5 shadow-xs"
                          activeOpacity={0.8}
                        >
                          <MaterialIcons name="add-shopping-cart" size={14} color="#ffffff" />
                          <Text className="text-white text-xs font-bold">Take Advance Order ›</Text>
                        </TouchableOpacity>
                      )}

                      {/* Return Goods Button */}
                      <TouchableOpacity
                        onPress={() => {
                          setCustomerSelectorVisible(false);
                          openSaleModal(item, 'return');
                        }}
                        className="bg-slate-100 active:bg-slate-200 px-2.5 py-1.5 rounded-xl flex-row items-center gap-1"
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="assignment-return" size={13} color="#475569" />
                        <Text className="text-slate-700 text-xs font-semibold">Return</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}
