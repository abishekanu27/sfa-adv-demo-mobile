import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  RefreshControl,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import {
  getVanStocks,
  getWarehouseStocks,
  formatStockQty,
  VanStockRecord,
  WarehouseStockRecord,
  StockRequestRecord,
  VanTransferRecord,
  AvailableSalesman,
  getAvailableSalesmen,
  setAvailableSalesmen,
  updateVanTransferStatus,
  deductVanStock,
  addVanStock,
  getStockRequests,
  createStockRequest,
  getVanTransfers,
  createVanTransfer,
  getAssignedRoute,
  getReturns,
  getMasterProducts,
  BookingRecord,
  upsertVanTransfers,
} from '../database/db';
import { getBackendBaseUrl, syncDatabase } from '../database/sync';
import { useAuth } from '../context/AuthContext';

export default function StocksScreen() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'current' | 'request' | 'transfer' | 'return'>('current');
  const [loading, setLoading] = useState(false);

  // 1. Current Stocks State
  const [vanStocks, setVanStocks] = useState<VanStockRecord[]>([]);
  const [warehouseStocks, setWarehouseStocks] = useState<WarehouseStockRecord[]>([]);
  const [stockSearch, setStockSearch] = useState('');
  const [currentStockSubTab, setCurrentStockSubTab] = useState<'van' | 'warehouse'>('van');

  // 2. Stock Requests State
  const [requests, setRequests] = useState<StockRequestRecord[]>([]);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [reqProductId, setReqProductId] = useState<number | null>(null);
  const [reqProductName, setReqProductName] = useState('');
  const [reqSearchQuery, setReqSearchQuery] = useState('');
  const [reqQty, setReqQty] = useState('');
  const [reqWarehouse, setReqWarehouse] = useState('Central Warehouse');
  const [reqUrgency, setReqUrgency] = useState<'Normal' | 'High' | 'Urgent'>('Normal');
  const [reqNotes, setReqNotes] = useState('');
  const [reqUnitMode, setReqUnitMode] = useState<'loose' | 'box'>('loose');
  const [submittingReq, setSubmittingReq] = useState(false);

  // 3. Van to Van Transfer State
  const [transfers, setTransfers] = useState<VanTransferRecord[]>([]);
  const [transferSubTab, setTransferSubTab] = useState<'incoming' | 'requisitions'>('incoming');
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [availableSalesmen, setAvailableSalesmenState] = useState<AvailableSalesman[]>([]);
  const [selectedTargetSalesman, setSelectedTargetSalesman] = useState<AvailableSalesman | null>(null);
  const [transferSearchQuery, setTransferSearchQuery] = useState('');
  const [transferProductId, setTransferProductId] = useState<number | null>(null);
  const [transferProductName, setTransferProductName] = useState('');
  const [transferQty, setTransferQty] = useState('');
  const [transferLocation, setTransferLocation] = useState('Kerala Corridor Beat');
  const [transferReason, setTransferReason] = useState('Stock balancing between beats');
  const [submittingTransfer, setSubmittingTransfer] = useState(false);
  const [completingTransferId, setCompletingTransferId] = useState<string | null>(null);

  // 4. Returns State (Returned items restocked to van)
  const [returnsList, setReturnsList] = useState<BookingRecord[]>([]);
  const [returnSearch, setReturnSearch] = useState('');
  const [selectedReturn, setSelectedReturn] = useState<BookingRecord | null>(null);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);

  const loadStockData = useCallback(() => {
    try {
      const vs = getVanStocks();
      const ws = getWarehouseStocks();
      const reqs = getStockRequests();
      const txs = getVanTransfers();
      const rets = getReturns();
      setVanStocks(vs);
      setWarehouseStocks(ws);
      setRequests(reqs);
      setTransfers(txs);
      setReturnsList(rets);

      // Load available salesmen from Web (excluding current user)
      const localSm = getAvailableSalesmen();
      setAvailableSalesmenState(localSm);
      if (localSm.length > 0) {
        setSelectedTargetSalesman(prev => prev || localSm[0]);
      } else {
        setSelectedTargetSalesman(null);
      }

      // Live fetch fresh salesmen mappings from server
      try {
        const baseUrl = getBackendBaseUrl();
        const curId = user?.id || '';
        const curName = user?.name || '';
        fetch(`${baseUrl}/api/sales/peer-salesmen?exclude_salesman_id=${encodeURIComponent(curId)}&exclude_name=${encodeURIComponent(curName)}`)
          .then(res => res.json())
          .then(data => {
            if (data?.success && Array.isArray(data.salesmen)) {
              setAvailableSalesmenState(data.salesmen);
              setAvailableSalesmen(data.salesmen);
              if (data.salesmen.length > 0) {
                setSelectedTargetSalesman(prev => {
                  const match = data.salesmen.find((s: AvailableSalesman) => s.salesman_id === prev?.salesman_id);
                  return match || data.salesmen[0];
                });
              } else {
                setSelectedTargetSalesman(null);
              }
            }
          })
          .catch(() => {});

        // Live fetch van-to-van transfers to immediately reflect Web approvals and completed handovers
        fetch(`${baseUrl}/api/sales/v2v-transfers`)
          .then(res => res.json())
          .then(data => {
            if (data?.success && Array.isArray(data.transfers)) {
              upsertVanTransfers(data.transfers);
              setTransfers(getVanTransfers());
            }
          })
          .catch(() => {});
      } catch {}
    } catch (err) {
      console.warn('Error loading stocks data:', err);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadStockData();
    }, [loadStockData])
  );

  const [syncing, setSyncing] = useState(false);

  const handleSync = useCallback(
    async (showAlert: boolean = true) => {
      if (syncing) return;
      setSyncing(true);
      try {
        const result = await syncDatabase();
        loadStockData();
        if (showAlert) {
          Alert.alert(
            'Stocks Synchronized',
            `Van Stock: ${result.vanStocksCount ?? vanStocks.length} items\nWarehouse Stock: ${
              result.warehouseStocksCount ?? warehouseStocks.length
            } items\nPulled: ${result.pulledCount} updates\nPushed: ${result.pushedCount} changes`
          );
        }
      } catch (e: any) {
        loadStockData();
        if (showAlert) {
          Alert.alert(
            'Sync Notice',
            e.message || 'Stocks refreshed from local database. Could not connect to server.'
          );
        }
      } finally {
        setSyncing(false);
      }
    },
    [syncing, loadStockData, vanStocks.length, warehouseStocks.length]
  );

  // Current Stock KPI calculations
  const totalVanUnits = vanStocks.reduce((sum, s) => sum + (Number(s.total_qty) || 0), 0);
  const totalVanValuation = vanStocks.reduce(
    (sum, s) => sum + (Number(s.total_qty) || 0) * (Number(s.unit_price || s.unit_cost) || 0),
    0
  );

  // Filtered current stocks
  const filteredVanStocks = vanStocks.filter(s => {
    const q = stockSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      s.product_name.toLowerCase().includes(q) ||
      (s.product_sku || '').toLowerCase().includes(q) ||
      (s.category_name || '').toLowerCase().includes(q)
    );
  });

  const filteredWarehouseStocks = warehouseStocks.filter(s => {
    const q = stockSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      s.product_name.toLowerCase().includes(q) ||
      (s.product_sku || '').toLowerCase().includes(q) ||
      (s.warehouse_name || '').toLowerCase().includes(q)
    );
  });

  // Returns KPI calculations & filter
  const totalReturnedUnits = returnsList.reduce((sum, r) => sum + (Number(r.total_qty) || 0), 0);
  const totalRefundAmount = returnsList.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0);
  const filteredReturns = returnsList.filter(r => {
    const q = returnSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      r.customer_name.toLowerCase().includes(q) ||
      (r.booking_code || '').toLowerCase().includes(q) ||
      (r.product_name || '').toLowerCase().includes(q) ||
      (r.notes || '').toLowerCase().includes(q)
    );
  });

  // Searchable Items for Stock Requisitions
  const uniqueRequestProducts = useMemo(() => {
    const map = new Map<string, {
      product_id: number;
      product_name: string;
      product_sku?: string;
      category_name?: string;
      available_quantity: number;
      package_type?: string;
      items_per_package?: number;
      unit?: string;
      unit_price?: number;
      box_price?: number;
    }>();

    // 1. Authoritative Master Products catalog
    try {
      const masterProds = getMasterProducts();
      for (const mp of masterProds) {
        const key = (mp.name || '').trim();
        if (!key) continue;
        const ipp = Math.max(1, Number(mp.items_per_package) || 10);
        const up = Number(mp.selling_price) || 0;
        const bp = Number(mp.box_price) || (up * ipp);
        map.set(key.toLowerCase(), {
          product_id: mp.product_id,
          product_name: mp.name,
          product_sku: mp.sku || '',
          category_name: mp.category_name || '',
          available_quantity: Number(mp.current_stock) || 0,
          package_type: mp.package_type || 'Bag',
          items_per_package: ipp,
          unit: mp.unit || 'Pcs',
          unit_price: up,
          box_price: bp,
        });
      }
    } catch {}

    // 2. Incorporate warehouse stocks
    for (const ws of warehouseStocks) {
      const key = (ws.product_name || '').trim();
      if (!key) continue;
      const avail = Number(ws.available_quantity || ws.quantity) || 0;
      const ipp = Math.max(1, Number(ws.items_per_package) || 10);
      const up = Number(ws.unit_price) || 0;
      const bp = Number(ws.box_price) || (up * ipp);

      if (!map.has(key.toLowerCase())) {
        map.set(key.toLowerCase(), {
          product_id: ws.product_id,
          product_name: ws.product_name,
          product_sku: ws.product_sku || '',
          category_name: ws.category_name || '',
          available_quantity: avail,
          package_type: ws.package_type || 'Bag',
          items_per_package: ipp,
          unit: ws.unit || 'Pcs',
          unit_price: up,
          box_price: bp,
        });
      } else {
        const existing = map.get(key.toLowerCase())!;
        existing.available_quantity = Math.max(existing.available_quantity, avail);
        if (ws.package_type) existing.package_type = ws.package_type;
        if (ws.items_per_package && ws.items_per_package > 1) existing.items_per_package = ws.items_per_package;
        if (up > 0) existing.unit_price = up;
        if (bp > 0) existing.box_price = bp;
      }
    }

    // 3. Fallback for loaded van stocks
    for (const vs of vanStocks) {
      const key = (vs.product_name || '').trim();
      if (!key) continue;
      const ipp = Math.max(1, Number(vs.items_per_package) || 10);
      const up = Number(vs.unit_price || vs.unit_cost) || 0;
      const bp = Number(vs.box_price) || (up * ipp);

      if (!map.has(key.toLowerCase())) {
        map.set(key.toLowerCase(), {
          product_id: vs.product_id,
          product_name: vs.product_name,
          product_sku: vs.product_sku || '',
          category_name: vs.category_name || '',
          available_quantity: 0,
          package_type: vs.package_type || 'Bag',
          items_per_package: ipp,
          unit: vs.unit || 'Pcs',
          unit_price: up,
          box_price: bp,
        });
      } else {
        const existing = map.get(key.toLowerCase())!;
        if ((existing.items_per_package || 1) <= 1 && ipp > 1) existing.items_per_package = ipp;
        if (!existing.unit_price && up > 0) existing.unit_price = up;
        if (!existing.box_price && bp > 0) existing.box_price = bp;
      }
    }

    return Array.from(map.values()).sort((a, b) => a.product_name.localeCompare(b.product_name));
  }, [warehouseStocks, vanStocks]);

  const filteredRequestProducts = useMemo(() => {
    if (!reqSearchQuery.trim()) return uniqueRequestProducts;
    const q = reqSearchQuery.toLowerCase().trim();
    return uniqueRequestProducts.filter(
      p =>
        p.product_name.toLowerCase().includes(q) ||
        (p.product_sku && p.product_sku.toLowerCase().includes(q)) ||
        (p.category_name && p.category_name.toLowerCase().includes(q))
    );
  }, [uniqueRequestProducts, reqSearchQuery]);

  const availableWarehouseNames = useMemo(() => {
    const names = Array.from(new Set(warehouseStocks.map(ws => ws.warehouse_name).filter(Boolean)));
    return names.length > 0 ? names : ['Central Warehouse', 'Palakkad Depot'];
  }, [warehouseStocks]);

  // Submit Stock Requisition
  const handleSubmitStockRequest = async () => {
    const rawQty = parseFloat(reqQty);
    if (!reqProductName || isNaN(rawQty) || rawQty <= 0) {
      Alert.alert('Invalid Details', 'Please select a product and enter a valid quantity.');
      return;
    }

    const selectedReqProd = uniqueRequestProducts.find(p => p.product_name === reqProductName || p.product_id === reqProductId);
    const isBox = reqUnitMode === 'box';
    const itemsPerPkg = Math.max(1, selectedReqProd?.items_per_package || 10);
    const totalUnits = isBox ? rawQty * itemsPerPkg : rawQty;
    const pkgType = selectedReqProd?.package_type || 'Bag';
    const unitPrice = Number(selectedReqProd?.unit_price) || 0;
    const boxPrice = Number(selectedReqProd?.box_price) || (unitPrice * itemsPerPkg);

    const effectiveQty = rawQty; // If 1 Bag, quantity is 1 Bag!
    const effectiveRate = isBox ? boxPrice : unitPrice;
    const estimatedValue = effectiveQty * effectiveRate;

    const reqNote = isBox
      ? `${rawQty} ${pkgType}(s) [${totalUnits} units @ ₹${boxPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}/${pkgType}]${reqNotes.trim() ? ` - ${reqNotes.trim()}` : ''}`
      : `${rawQty} units [@ ₹${unitPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}/unit]${reqNotes.trim() ? ` - ${reqNotes.trim()}` : ''}`;

    setSubmittingReq(true);
    try {
      const created = createStockRequest({
        salesman_id: user?.id || '',
        salesman_name: user?.name || 'Sales Representative',
        warehouse_name: reqWarehouse,
        product_id: reqProductId || undefined,
        product_name: reqProductName,
        package_type: isBox ? pkgType : 'Loose',
        requested_qty: effectiveQty,
        urgency: reqUrgency,
        status: 'Pending',
        notes: reqNote,
      });

      // Attempt background push to backend API
      try {
        const baseUrl = getBackendBaseUrl();
        await fetch(`${baseUrl}/api/sales/stock-requests`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_code: created.request_code,
            salesman_id: user?.id || 'usr_sales_01',
            salesman_name: user?.name || 'Sales Representative',
            warehouse_name: reqWarehouse,
            product_id: reqProductId,
            product_name: reqProductName,
            package_type: isBox ? pkgType : 'Loose',
            requested_qty: effectiveQty,
            urgency: reqUrgency,
            notes: reqNote,
          }),
        });
      } catch (pushErr) {
        console.log('Stock request saved locally in offline queue.');
      }

      Alert.alert(
        'Stock Request Sent',
        isBox 
          ? `Requisition for ${rawQty} ${pkgType}(s) (${totalUnits} units @ ₹${boxPrice.toLocaleString('en-IN')}/${pkgType} = ₹${estimatedValue.toLocaleString('en-IN')}) of ${reqProductName} has been submitted to ${reqWarehouse}.`
          : `Requisition for ${totalUnits} unit(s) (@ ₹${unitPrice.toLocaleString('en-IN')}/unit = ₹${estimatedValue.toLocaleString('en-IN')}) of ${reqProductName} has been submitted to ${reqWarehouse}.`
      );
      setIsRequestModalOpen(false);
      setReqProductName('');
      setReqProductId(null);
      setReqSearchQuery('');
      setReqQty('');
      setReqNotes('');
      setReqUnitMode('loose');
      loadStockData();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to submit stock request.');
    } finally {
      setSubmittingReq(false);
    }
  };

  // Van Transfers filtering:
  // 1. Incoming Requests: Requests from peer salesmen asking for stock from MY van (I am source)
  // 2. My Requisitions: Requests I sent asking for stock from peer salesman's van (I am target receiver)
  const currentSalesmanName = (user?.name || '').toLowerCase().trim();
  const currentSalesmanId = (user?.id || '').toLowerCase().trim();

  const incomingTransfers = useMemo(() => {
    return transfers.filter(t => {
      const isSource = (
        (t.source_salesman_id && t.source_salesman_id.toLowerCase() === currentSalesmanId) ||
        (t.source_salesman_name && currentSalesmanName && t.source_salesman_name.toLowerCase().includes(currentSalesmanName))
      );
      const isTarget = (
        (t.target_salesman_id && t.target_salesman_id.toLowerCase() === currentSalesmanId) ||
        (t.target_salesman_name && currentSalesmanName && t.target_salesman_name.toLowerCase().includes(currentSalesmanName))
      );
      // Show if I am the source, or if orphan/admin transfer that is approved/pending
      return isSource || (!isTarget && !isSource && (t.status === 'Approved' || t.status === 'Pending'));
    });
  }, [transfers, currentSalesmanId, currentSalesmanName]);

  const myRequisitions = useMemo(() => {
    return transfers.filter(t => {
      const isTarget = (
        (t.target_salesman_id && t.target_salesman_id.toLowerCase() === currentSalesmanId) ||
        (t.target_salesman_name && currentSalesmanName && t.target_salesman_name.toLowerCase().includes(currentSalesmanName))
      );
      return isTarget;
    });
  }, [transfers, currentSalesmanId, currentSalesmanName]);

  // Search items from master catalog / warehouse for Transfer Requisition Modal
  const filteredTransferProducts = useMemo(() => {
    if (!transferSearchQuery.trim()) return uniqueRequestProducts;
    const q = transferSearchQuery.toLowerCase().trim();
    return uniqueRequestProducts.filter(
      p =>
        p.product_name.toLowerCase().includes(q) ||
        (p.product_sku && p.product_sku.toLowerCase().includes(q)) ||
        (p.category_name && p.category_name.toLowerCase().includes(q))
    );
  }, [uniqueRequestProducts, transferSearchQuery]);

  // Handover execution: Salesman 2 (Source) transfers stock to Salesman 1 (Target) after Web approval
  const handleCompleteTransfer = async (transfer: VanTransferRecord) => {
    const qty = Number(transfer.quantity) || 0;
    const sourceStock = vanStocks.find(
      s => s.product_id === transfer.product_id || s.product_name.toLowerCase() === transfer.product_name.toLowerCase()
    );

    if (sourceStock && Number(sourceStock.total_qty) < qty) {
      Alert.alert(
        'Warning: Low Van Stock',
        `You currently only have ${sourceStock.total_qty} units of ${transfer.product_name} in your van, but ${qty} units are requested. Proceed anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Proceed & Transfer', style: 'destructive', onPress: () => executeTransfer(transfer, sourceStock, qty) }
        ]
      );
      return;
    }

    Alert.alert(
      'Confirm Stock Transfer',
      `Transfer ${qty} unit(s) of ${transfer.product_name} to ${transfer.target_salesman_name}'s Van (${transfer.target_vehicle_reg || 'Peer Van'})?\n\nThis will deduct ${qty} unit(s) from your van inventory.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm & Transfer',
          style: 'default',
          onPress: () => executeTransfer(transfer, sourceStock, qty)
        }
      ]
    );
  };

  const executeTransfer = async (transfer: VanTransferRecord, sourceStock: any, qty: number) => {
    try {
      setCompletingTransferId(transfer.id);

      // 1. Deduct from local van stock of source salesman (Salesman 2)
      if (sourceStock) {
        deductVanStock(sourceStock.allocation_id, qty);
      } else {
        deductVanStock(transfer.product_id || transfer.product_name, qty);
      }

      // 2. Mark local transfer as Completed
      updateVanTransferStatus(
        transfer.id,
        'Completed',
        `Transferred to ${transfer.target_salesman_name}'s Van by ${user?.name || 'Sales Representative'}`
      );

      // 3. Push status to backend API (which automatically deducts from source and credits to target in PostgreSQL)
      try {
        const baseUrl = getBackendBaseUrl();
        await fetch(`${baseUrl}/api/sales/v2v-transfers/${encodeURIComponent(transfer.transfer_code || transfer.id)}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'Completed',
            notes: `Field handover completed by ${user?.name || 'Sales Representative'} to ${transfer.target_salesman_name}`
          }),
        });
      } catch (e) {
        console.log('Transfer status updated offline.');
      }

      Alert.alert(
        'Stock Transferred Successfully',
        `${qty} unit(s) of ${transfer.product_name} transferred to ${transfer.target_salesman_name}'s Van.`
      );
      loadStockData();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to complete handover.');
    } finally {
      setCompletingTransferId(null);
    }
  };

  // Submit Van to Van Requisition: Salesman 1 requests stock from Salesman 2
  const handleSubmitVanTransfer = async () => {
    if (!selectedTargetSalesman) {
      Alert.alert(
        'No Salesman Available',
        'Currently no other salesman or van is registered on Web. Please register salesmen and vans on the Web portal first.'
      );
      return;
    }

    const qty = parseFloat(transferQty);
    if (!transferProductName || isNaN(qty) || qty <= 0) {
      Alert.alert('Invalid Details', 'Please select a product and enter a valid quantity.');
      return;
    }

    setSubmittingTransfer(true);
    try {
      const assigned = getAssignedRoute();
      // SOURCE = Selected salesman from whom stock is requested (Salesman 2)
      // TARGET = Current salesman requesting the stock (Salesman 1)
      const created = createVanTransfer({
        source_salesman_id: selectedTargetSalesman.salesman_id,
        source_salesman_name: selectedTargetSalesman.salesman_name,
        source_vehicle_reg: selectedTargetSalesman.vehicle_reg_no || 'N/A',
        target_salesman_id: assigned?.salesman_id || user?.id || 'usr_salesman',
        target_salesman_name: assigned?.salesman_name || user?.name || 'Sales Representative',
        target_vehicle_reg: assigned?.vehicle_reg_no || 'N/A',
        product_id: transferProductId || undefined,
        product_name: transferProductName,
        quantity: qty,
        reason: transferReason,
        location_of_exchange: transferLocation,
        status: 'Pending',
        notes: transferReason,
      });

      // No stock deduction here! Stock is only deducted when Salesman 2 transfers it after Web approval!

      // Push to backend API
      try {
        const baseUrl = getBackendBaseUrl();
        await fetch(`${baseUrl}/api/sales/v2v-transfers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transfer_code: created.transfer_code,
            source_salesman_id: selectedTargetSalesman.salesman_id,
            source_salesman_name: selectedTargetSalesman.salesman_name,
            source_vehicle_reg: selectedTargetSalesman.vehicle_reg_no || 'N/A',
            target_salesman_id: assigned?.salesman_id || user?.id || 'usr_salesman',
            target_salesman_name: assigned?.salesman_name || user?.name || 'Sales Representative',
            target_vehicle_reg: assigned?.vehicle_reg_no || 'N/A',
            product_id: transferProductId,
            quantity: qty,
            reason: transferReason,
            location_of_exchange: transferLocation,
            notes: `Field stock request from mobile app`,
          }),
        });
      } catch (pushErr) {
        console.log('Transfer logged offline in SQLite.');
      }

      Alert.alert(
        'Stock Request Sent for Approval',
        `Your request for ${qty} unit(s) of ${transferProductName} from ${selectedTargetSalesman.salesman_name}'s van has been submitted to Web Application for approval.`
      );
      setIsTransferModalOpen(false);
      setTransferProductName('');
      setTransferProductId(null);
      setTransferQty('');
      setTransferSearchQuery('');
      loadStockData();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to submit van transfer request.');
    } finally {
      setSubmittingTransfer(false);
    }
  };

  return (
    <View className="flex-1 bg-slate-50">
      {/* 1. Header Bar */}
      <View className="bg-white px-4 pt-3 pb-2 border-b border-slate-200 shadow-2xs">
        <View className="flex-row justify-between items-center mb-3">
          <View className="flex-1 pr-2">
            <Text className="text-base font-bold text-slate-800 leading-tight">Inventory & Stocks</Text>
            <Text className="text-xs font-medium text-slate-500 mt-0.5 leading-tight">
              Live Field Allocation & Warehouse Supply
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => handleSync(true)}
            disabled={syncing}
            className={`flex-row items-center gap-1.5 px-3 py-1.5 rounded-xl border ${
              syncing
                ? 'bg-blue-50 border-blue-200'
                : 'bg-blue-600 border-blue-600 active:bg-blue-700 shadow-xs'
            }`}
            activeOpacity={0.8}
          >
            {syncing ? (
              <ActivityIndicator size="small" color="#2563eb" />
            ) : (
              <MaterialIcons name="sync" size={17} color="#ffffff" />
            )}
            <Text className={`text-xs font-bold ${syncing ? 'text-blue-700' : 'text-white'}`}>
              {syncing ? 'Syncing...' : 'Sync'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 2. Top Segmented Tabs: Current Stock | Stock Request | Van Transfer | Returns */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="flex-row py-0.5"
          contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}
        >
          <TouchableOpacity
            onPress={() => setActiveTab('current')}
            className={`px-3 py-2 rounded-xl flex-row items-center gap-1.5 ${
              activeTab === 'current' ? 'bg-blue-600 shadow-xs' : 'bg-slate-100'
            }`}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name="inventory-2"
              size={15}
              color={activeTab === 'current' ? '#ffffff' : '#64748b'}
            />
            <Text
              className={`text-xs font-bold ${
                activeTab === 'current' ? 'text-white' : 'text-slate-600'
              }`}
            >
              Current Stock
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setActiveTab('request')}
            className={`px-3 py-2 rounded-xl flex-row items-center gap-1.5 ${
              activeTab === 'request' ? 'bg-emerald-600 shadow-xs' : 'bg-slate-100'
            }`}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name="add-business"
              size={15}
              color={activeTab === 'request' ? '#ffffff' : '#64748b'}
            />
            <Text
              className={`text-xs font-bold ${
                activeTab === 'request' ? 'text-white' : 'text-slate-600'
              }`}
            >
              Requests ({requests.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setActiveTab('transfer')}
            className={`px-3 py-2 rounded-xl flex-row items-center gap-1.5 ${
              activeTab === 'transfer' ? 'bg-amber-600 shadow-xs' : 'bg-slate-100'
            }`}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name="swap-horiz"
              size={17}
              color={activeTab === 'transfer' ? '#ffffff' : '#64748b'}
            />
            <Text
              className={`text-xs font-bold ${
                activeTab === 'transfer' ? 'text-white' : 'text-slate-600'
              }`}
            >
              Transfers ({transfers.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setActiveTab('return')}
            className={`px-3 py-2 rounded-xl flex-row items-center gap-1.5 ${
              activeTab === 'return' ? 'bg-red-600 shadow-xs' : 'bg-slate-100'
            }`}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name="assignment-return"
              size={15}
              color={activeTab === 'return' ? '#ffffff' : '#64748b'}
            />
            <Text
              className={`text-xs font-bold ${
                activeTab === 'return' ? 'text-white' : 'text-slate-600'
              }`}
            >
              Returns ({returnsList.length})
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* 3. Tab Contents */}
      <View className="flex-1 p-4">
        {/* ===================== TAB 1: CURRENT STOCK ===================== */}
        {activeTab === 'current' && (
          <View className="flex-1">
            {/* KPI Summary Cards */}
            <View className="flex-row gap-2 mb-3">
              <View className="flex-1 bg-white p-2.5 rounded-2xl border border-slate-100 shadow-2xs">
                <Text className="text-[10px] font-bold text-slate-400 uppercase">Van Items</Text>
                <Text className="text-base font-bold text-slate-800 mt-0.5 leading-tight">{vanStocks.length}</Text>
                <Text className="text-[10px] text-slate-500 font-medium">SKUs Loaded</Text>
              </View>

              <View className="flex-1 bg-white p-2.5 rounded-2xl border border-slate-100 shadow-2xs">
                <Text className="text-[10px] font-bold text-slate-400 uppercase">Available Units</Text>
                <Text className="text-base font-bold text-emerald-700 mt-0.5 leading-tight">{totalVanUnits}</Text>
                <Text className="text-[10px] text-emerald-600 font-semibold">Total Stock</Text>
              </View>

              <View className="flex-1 bg-white p-2.5 rounded-2xl border border-slate-100 shadow-2xs">
                <Text className="text-[10px] font-bold text-slate-400 uppercase">Valuation</Text>
                <Text className="text-sm font-bold text-blue-700 mt-0.5 leading-tight" numberOfLines={1} adjustsFontSizeToFit>
                  ₹{Math.round(totalVanValuation).toLocaleString('en-IN')}
                </Text>
                <Text className="text-[10px] text-slate-500 font-medium">In Van</Text>
              </View>
            </View>

            {/* Van Stock vs Warehouse Stock Switcher */}
            <View className="flex-row gap-2 mb-3">
              <TouchableOpacity
                onPress={() => setCurrentStockSubTab('van')}
                className={`px-3 py-1.5 rounded-xl border flex-row items-center gap-1.5 ${
                  currentStockSubTab === 'van'
                    ? 'bg-blue-600 border-blue-600'
                    : 'bg-white border-slate-200'
                }`}
              >
                <MaterialIcons
                  name="local-shipping"
                  size={14}
                  color={currentStockSubTab === 'van' ? '#ffffff' : '#64748b'}
                />
                <Text
                  className={`text-xs font-bold ${
                    currentStockSubTab === 'van' ? 'text-white' : 'text-slate-700'
                  }`}
                >
                  Van Stocks ({vanStocks.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setCurrentStockSubTab('warehouse')}
                className={`px-3 py-1.5 rounded-xl border flex-row items-center gap-1.5 ${
                  currentStockSubTab === 'warehouse'
                    ? 'bg-blue-600 border-blue-600'
                    : 'bg-white border-slate-200'
                }`}
              >
                <MaterialIcons
                  name="warehouse"
                  size={14}
                  color={currentStockSubTab === 'warehouse' ? '#ffffff' : '#64748b'}
                />
                <Text
                  className={`text-xs font-bold ${
                    currentStockSubTab === 'warehouse' ? 'text-white' : 'text-slate-700'
                  }`}
                >
                  Warehouse Catalog ({warehouseStocks.length})
                </Text>
              </TouchableOpacity>
            </View>

            {/* Stock Search Input */}
            <View className="bg-white rounded-2xl px-3.5 py-2 mb-3 flex-row items-center border border-slate-200">
              <MaterialIcons name="search" size={18} color="#94a3b8" />
              <TextInput
                value={stockSearch}
                onChangeText={setStockSearch}
                placeholder="Search stocks by name, SKU or category..."
                placeholderTextColor="#94a3b8"
                className="flex-1 ml-2 text-xs text-slate-800"
              />
              {stockSearch.length > 0 && (
                <TouchableOpacity onPress={() => setStockSearch('')}>
                  <MaterialIcons name="close" size={16} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>

            {/* Stocks List */}
            {currentStockSubTab === 'van' ? (
              <FlatList
                data={filteredVanStocks}
                keyExtractor={item => String(item.allocation_id || item.product_id)}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 24 }}
                refreshControl={
                  <RefreshControl
                    refreshing={syncing}
                    onRefresh={() => handleSync(false)}
                    colors={['#2563eb']}
                    tintColor="#2563eb"
                  />
                }
                ListEmptyComponent={
                  <View className="bg-white rounded-3xl p-6 items-center justify-center my-4 border border-slate-100">
                    <MaterialIcons name="inventory" size={36} color="#94a3b8" />
                    <Text className="text-sm font-bold text-slate-700 mt-2">No Van Stocks Found</Text>
                    <Text className="text-xs text-slate-400 mt-1 text-center">
                      Tap 'Sync' on Dashboard or request new stock from warehouse.
                    </Text>
                  </View>
                }
                renderItem={({ item }) => {
                  const qtyInfo = formatStockQty(item);
                  const totalUnits = Number(item.total_qty) || 0;
                  const isOutOfStock = totalUnits <= 0;
                  const unitPrice = Number(item.unit_price || item.unit_cost || 0);
                  const totalVal = totalUnits * unitPrice;

                  return (
                    <View
                      style={{
                        backgroundColor: isOutOfStock ? '#fef2f2' : '#ffffff',
                        borderColor: isOutOfStock ? '#f87171' : '#e2e8f0',
                        borderWidth: 1.5,
                      }}
                      className="p-3.5 rounded-2xl mb-2.5 shadow-2xs"
                    >
                      <View className="flex-row justify-between items-start">
                        <View className="flex-1 pr-2">
                          <Text
                            className={`text-sm font-extrabold ${
                              isOutOfStock ? 'text-red-900' : 'text-slate-800'
                            }`}
                          >
                            {item.product_name}
                          </Text>
                          <View className="flex-row items-center gap-1.5 mt-1 flex-wrap">
                            {item.category_name ? (
                              <View className="bg-blue-50 px-1.5 py-0.5 rounded-md border border-blue-100">
                                <Text className="text-[10px] font-bold text-blue-700">
                                  {item.category_name}
                                </Text>
                              </View>
                            ) : null}
                            <Text className="text-xs text-slate-500">
                              SKU: <Text className="font-semibold text-slate-700">{item.product_sku || 'N/A'}</Text>
                              {item.batch_no ? ` • ${item.batch_no}` : ''}
                            </Text>
                          </View>
                        </View>

                        <View className="items-end">
                          {isOutOfStock ? (
                            <View className="bg-red-100 border border-red-300 px-2 py-0.5 rounded-full flex-row items-center gap-1">
                              <MaterialIcons name="error-outline" size={11} color="#b91c1c" />
                              <Text className="text-[11px] font-bold text-red-800 leading-tight">Out of Stock (0)</Text>
                            </View>
                          ) : (
                            <View className="bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full flex-row items-center gap-1">
                              <MaterialIcons name="check-circle" size={11} color="#065f46" />
                              <Text className="text-[11px] font-bold text-emerald-800 leading-tight">
                                {totalUnits} Units Available
                              </Text>
                            </View>
                          )}
                          <Text className="text-[10px] font-semibold text-slate-600 mt-1 leading-tight">
                            ₹{unitPrice.toFixed(2)}/unit • ₹{totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </Text>
                        </View>
                      </View>

                      <View className="mt-2.5 pt-2 border-t border-slate-100 flex-row justify-between items-center">
                        <Text className="text-xs text-slate-600">
                          Pack: <Text className="font-bold text-slate-800">{qtyInfo.packBreakdown}</Text>
                        </Text>
                        <Text className="text-[10px] text-slate-400 font-medium">
                          Allocated to Van
                        </Text>
                      </View>
                    </View>
                  );
                }}
              />
            ) : (
              <FlatList
                data={filteredWarehouseStocks}
                keyExtractor={item => String(item.id)}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 24 }}
                refreshControl={
                  <RefreshControl
                    refreshing={syncing}
                    onRefresh={() => handleSync(false)}
                    colors={['#2563eb']}
                    tintColor="#2563eb"
                  />
                }
                renderItem={({ item }) => {
                  const avail = Number(item.available_quantity || item.quantity || 0);
                  const isOutOfStock = avail <= 0;

                  return (
                    <View
                      style={{
                        backgroundColor: isOutOfStock ? '#fef2f2' : '#ffffff',
                        borderColor: isOutOfStock ? '#f87171' : '#e2e8f0',
                        borderWidth: 1.5,
                      }}
                      className="p-3.5 rounded-2xl mb-2.5 shadow-2xs"
                    >
                      <View className="flex-row justify-between items-start">
                        <View className="flex-1 pr-2">
                          <Text
                            className={`text-sm font-extrabold ${
                              isOutOfStock ? 'text-red-900' : 'text-slate-800'
                            }`}
                          >
                            {item.product_name}
                          </Text>
                          <View className="flex-row items-center gap-1.5 mt-1 flex-wrap">
                            <View className="bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100 flex-row items-center gap-1">
                              <MaterialIcons name="warehouse" size={11} color="#059669" />
                              <Text className="text-[10px] font-bold text-emerald-800">
                                {item.warehouse_name}
                              </Text>
                            </View>
                            {item.product_sku ? (
                              <Text className="text-xs text-slate-500">
                                SKU: <Text className="font-semibold text-slate-700">{item.product_sku}</Text>
                              </Text>
                            ) : null}
                          </View>
                        </View>

                        <View className="items-end">
                          <View
                            className={`px-2.5 py-1 rounded-full flex-row items-center gap-1 ${
                              isOutOfStock ? 'bg-red-100 border border-red-300' : 'bg-blue-100 border border-blue-200'
                            }`}
                          >
                            <MaterialIcons
                              name={isOutOfStock ? 'error-outline' : 'inventory'}
                              size={12}
                              color={isOutOfStock ? '#b91c1c' : '#1d4ed8'}
                            />
                            <Text
                              className={`text-xs font-black ${
                                isOutOfStock ? 'text-red-800' : 'text-blue-800'
                              }`}
                            >
                              {avail} Units Available
                            </Text>
                          </View>
                          <Text className="text-[11px] font-bold text-slate-600 mt-1">
                            Rate: ₹{Number(item.unit_price || 0).toFixed(2)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                }}
              />
            )}
          </View>
        )}

        {/* ===================== TAB 2: STOCK REQUEST ===================== */}
        {activeTab === 'request' && (
          <View className="flex-1">
            <View className="flex-row justify-between items-center mb-3">
              <View className="flex-1 pr-2">
                <Text className="text-sm font-bold text-slate-800" numberOfLines={1}>
                  Warehouse Requisitions
                </Text>
                <Text className="text-[11px] text-slate-500" numberOfLines={1}>
                  Request van stock refill
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setReqProductName('');
                  setReqProductId(null);
                  setReqSearchQuery('');
                  setReqQty('');
                  setReqNotes('');
                  setIsRequestModalOpen(true);
                }}
                className="bg-emerald-600 active:bg-emerald-700 px-3 py-2 rounded-xl flex-row items-center gap-1.5 shadow-sm shrink-0"
                activeOpacity={0.8}
              >
                <MaterialIcons name="add" size={16} color="#ffffff" />
                <Text className="text-xs font-bold text-white">New Request</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={requests}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
              refreshControl={
                <RefreshControl
                  refreshing={syncing}
                  onRefresh={() => handleSync(false)}
                  colors={['#2563eb']}
                  tintColor="#2563eb"
                />
              }
              ListEmptyComponent={
                <View className="bg-white rounded-3xl p-6 items-center justify-center my-4 border border-slate-100 shadow-2xs">
                  <MaterialIcons name="add-business" size={36} color="#94a3b8" />
                  <Text className="text-sm font-bold text-slate-700 mt-2">No Stock Requests</Text>
                  <Text className="text-xs text-slate-400 mt-1 text-center">
                    Running low on stock? Tap '+ New Request' to order allocation from the warehouse.
                  </Text>
                </View>
              }
              renderItem={({ item }) => {
                const isApproved = (item.status || '').toLowerCase() === 'approved' || (item.status || '').toLowerCase() === 'dispatched';
                const isRejected = (item.status || '').toLowerCase() === 'rejected';
                const displayUnit = item.package_type && item.package_type !== 'Loose' && item.package_type !== 'Units'
                  ? `${item.package_type}${Number(item.requested_qty) > 1 ? 's' : ''}`
                  : 'Units';

                return (
                  <View className="bg-white rounded-2xl p-3.5 mb-2.5 border border-slate-100 shadow-2xs">
                    <View className="flex-row justify-between items-start">
                      <View className="flex-1 pr-2">
                        <View className="flex-row items-center gap-2 flex-wrap mb-1">
                          <Text className="text-sm font-bold text-slate-800">{item.product_name}</Text>
                          {item.request_code && (
                            <View className="bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                              <Text className="text-[10px] font-bold text-slate-700">
                                {item.request_code}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text className="text-xs text-slate-500">
                          Warehouse: <Text className="font-semibold text-slate-700">{item.warehouse_name || 'Central'}</Text>
                        </Text>
                        {item.notes ? (
                          <Text className="text-[11px] text-slate-400 mt-1 italic">
                            "{item.notes}"
                          </Text>
                        ) : null}
                      </View>

                      <View className="items-end">
                        <View className="bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                          <Text className="text-xs font-black text-emerald-800">
                            {item.requested_qty} {displayUnit}
                          </Text>
                        </View>
                        <View className={`mt-1 px-2.5 py-0.5 rounded-md border ${
                          isApproved ? 'bg-emerald-100 border-emerald-300' :
                          isRejected ? 'bg-rose-100 border-rose-300' :
                          'bg-amber-100 border-amber-300'
                        }`}>
                          <Text className={`text-[10px] font-extrabold uppercase ${
                            isApproved ? 'text-emerald-800' :
                            isRejected ? 'text-rose-800' :
                            'text-amber-800'
                          }`}>
                            {item.status || 'Pending'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              }}
            />
          </View>
        )}

        {/* ===================== TAB 3: VAN TO VAN TRANSFER ===================== */}
        {activeTab === 'transfer' && (
          <View className="flex-1">
            <View className="flex-row justify-between items-center mb-3">
              <View className="flex-1 pr-2">
                <Text className="text-sm font-bold text-slate-800" numberOfLines={1}>
                  Van-to-Van Transfers
                </Text>
                <Text className="text-[11px] text-slate-500" numberOfLines={1}>
                  Peer Stock Requisitions
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setTransferProductName('');
                  setTransferProductId(null);
                  setTransferQty('');
                  setTransferSearchQuery('');
                  setIsTransferModalOpen(true);
                }}
                className="bg-blue-600 active:bg-blue-700 px-2.5 py-2 rounded-xl flex-row items-center gap-1 shadow-sm shrink-0"
                activeOpacity={0.8}
              >
                <MaterialIcons name="add" size={16} color="#ffffff" />
                <Text className="text-xs font-bold text-white">Request from Van</Text>
              </TouchableOpacity>
            </View>

            {/* Sub-tab segmented control */}
            <View className="flex-row bg-slate-200/80 p-1 rounded-2xl mb-3">
              <TouchableOpacity
                onPress={() => setTransferSubTab('incoming')}
                className={`flex-1 py-2 px-1 rounded-xl items-center flex-row justify-center gap-1 ${
                  transferSubTab === 'incoming' ? 'bg-white shadow-xs' : ''
                }`}
              >
                <MaterialIcons
                  name="inbox"
                  size={15}
                  color={transferSubTab === 'incoming' ? '#059669' : '#64748b'}
                />
                <Text
                  numberOfLines={1}
                  className={`text-[11px] font-bold ${
                    transferSubTab === 'incoming' ? 'text-emerald-900' : 'text-slate-600'
                  }`}
                >
                  Incoming ({incomingTransfers.length})
                </Text>
                {incomingTransfers.filter(r => (r.status || '').toLowerCase() === 'approved').length > 0 && (
                  <View className="bg-emerald-600 px-1.5 py-0.2 rounded-full ml-0.5">
                    <Text className="text-[10px] font-black text-white">
                      {incomingTransfers.filter(r => (r.status || '').toLowerCase() === 'approved').length}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setTransferSubTab('requisitions')}
                className={`flex-1 py-2 px-1 rounded-xl items-center flex-row justify-center gap-1 ${
                  transferSubTab === 'requisitions' ? 'bg-white shadow-xs' : ''
                }`}
              >
                <MaterialIcons
                  name="outbox"
                  size={15}
                  color={transferSubTab === 'requisitions' ? '#2563eb' : '#64748b'}
                />
                <Text
                  numberOfLines={1}
                  className={`text-[11px] font-bold ${
                    transferSubTab === 'requisitions' ? 'text-blue-900' : 'text-slate-600'
                  }`}
                >
                  My Requests ({myRequisitions.length})
                </Text>
              </TouchableOpacity>
            </View>

            {/* Sub-tab 1: Incoming Requests (Salesman 2 receives request from Salesman 1) */}
            {transferSubTab === 'incoming' && (
              <FlatList
                data={incomingTransfers}
                keyExtractor={item => item.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 24 }}
                refreshControl={
                  <RefreshControl
                    refreshing={syncing}
                    onRefresh={() => handleSync(false)}
                    colors={['#2563eb']}
                    tintColor="#2563eb"
                  />
                }
                ListEmptyComponent={
                  <View className="bg-white rounded-3xl p-6 items-center justify-center my-4 border border-slate-100 shadow-2xs">
                    <MaterialIcons name="move-to-inbox" size={38} color="#94a3b8" />
                    <Text className="text-sm font-bold text-slate-700 mt-2">No Incoming Van Requests</Text>
                    <Text className="text-xs text-slate-400 mt-1 text-center max-w-[280px]">
                      When another salesman requests stock from your van and it is approved on the Web portal, it will appear here for physical field handover.
                    </Text>
                  </View>
                }
                renderItem={({ item }) => {
                  const isApproved = (item.status || '').toLowerCase() === 'approved';
                  const isCompleted = (item.status || '').toLowerCase() === 'completed';

                  return (
                    <View className="bg-white rounded-2xl p-4 mb-3 border border-slate-100 shadow-2xs">
                      {/* Top Header */}
                      <View className="flex-row justify-between items-center pb-2 mb-2 border-b border-slate-100">
                        <View className="flex-row items-center gap-1.5">
                          <View className="bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">
                            <Text className="text-[11px] font-black text-slate-800">
                              #{item.transfer_code || 'V2V-REQ'}
                            </Text>
                          </View>
                          <Text className="text-[11px] text-slate-400">
                            {item.created_at
                              ? new Date(item.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                              : 'Recent'}
                          </Text>
                        </View>

                        {/* Status Badge */}
                        {isApproved ? (
                          <View className="bg-emerald-50 border border-emerald-300 px-2.5 py-0.5 rounded-full flex-row items-center gap-1">
                            <MaterialIcons name="verified" size={12} color="#059669" />
                            <Text className="text-[10px] font-black text-emerald-800 uppercase">
                              Approved by Admin
                            </Text>
                          </View>
                        ) : isCompleted ? (
                          <View className="bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full flex-row items-center gap-1">
                            <MaterialIcons name="check-circle" size={12} color="#2563eb" />
                            <Text className="text-[10px] font-bold text-blue-800 uppercase">
                              Completed / Transferred
                            </Text>
                          </View>
                        ) : (
                          <View className="bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                            <Text className="text-[10px] font-bold text-amber-800 uppercase">
                              {item.status || 'Pending Approval'}
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* Route Strip: My Van (Sender) -> Requester Van (Receiver) */}
                      <View className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 mb-2.5">
                        <View className="flex-row items-center justify-between">
                          <View className="flex-1 pr-1">
                            <Text className="text-[10px] font-bold text-slate-400 uppercase">Source Van (My Van)</Text>
                            <Text className="text-xs font-extrabold text-slate-800" numberOfLines={1}>
                              {item.source_salesman_name || 'My Van'}
                            </Text>
                            <Text className="text-[10px] text-slate-500 font-medium">
                              Van: {item.source_vehicle_reg || 'N/A'}
                            </Text>
                          </View>

                          <View className="px-2">
                            <MaterialIcons name="arrow-forward" size={16} color="#94a3b8" />
                          </View>

                          <View className="flex-1 pl-1 items-end">
                            <Text className="text-[10px] font-bold text-slate-400 uppercase">Target Van (Receiver)</Text>
                            <Text className="text-xs font-extrabold text-blue-800" numberOfLines={1}>
                              {item.target_salesman_name}
                            </Text>
                            <Text className="text-[10px] text-slate-500 font-medium">
                              Van: {item.target_vehicle_reg || 'N/A'}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Product Details & Qty */}
                      <View className="flex-row justify-between items-center mb-2">
                        <View className="flex-1 pr-2">
                          <Text className="text-sm font-extrabold text-slate-800">{item.product_name}</Text>
                          {item.product_sku ? (
                            <Text className="text-[10px] text-slate-400 font-mono">SKU: {item.product_sku}</Text>
                          ) : null}
                        </View>
                        <View className="items-end">
                          <View className="bg-purple-50 border border-purple-200 px-3 py-1 rounded-xl">
                            <Text className="text-sm font-black text-purple-900">
                              {item.quantity} {item.package_type || 'Units'}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Location of Exchange */}
                      {item.location_of_exchange ? (
                        <View className="flex-row items-center gap-1 mb-1">
                          <MaterialIcons name="place" size={13} color="#64748b" />
                          <Text className="text-xs text-slate-600 font-medium">
                            Exchange: <Text className="font-semibold text-slate-800">{item.location_of_exchange}</Text>
                          </Text>
                        </View>
                      ) : null}

                      {/* Reason / Notes */}
                      {item.reason || item.notes ? (
                        <Text className="text-[11px] text-slate-500 italic mt-0.5">
                          "{item.notes || item.reason}"
                        </Text>
                      ) : null}

                      {/* Action: Transfer to Salesman 1's Van (when Approved) */}
                      {isApproved && (
                        <TouchableOpacity
                          onPress={() => handleCompleteTransfer(item)}
                          disabled={completingTransferId === item.id}
                          className="mt-3 bg-emerald-600 active:bg-emerald-700 py-2.5 px-4 rounded-xl flex-row items-center justify-center gap-2 shadow-sm"
                        >
                          {completingTransferId === item.id ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                          ) : (
                            <>
                              <MaterialIcons name="local-shipping" size={16} color="#ffffff" />
                              <Text className="text-xs font-bold text-white">
                                Transfer to {item.target_salesman_name}'s Van
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                }}
              />
            )}

            {/* Sub-tab 2: My Requisitions (Salesman 1 requesting from Salesman 2) */}
            {transferSubTab === 'requisitions' && (
              <FlatList
                data={myRequisitions}
                keyExtractor={item => item.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 24 }}
                refreshControl={
                  <RefreshControl
                    refreshing={syncing}
                    onRefresh={() => handleSync(false)}
                    colors={['#2563eb']}
                    tintColor="#2563eb"
                  />
                }
                ListEmptyComponent={
                  <View className="bg-white rounded-3xl p-6 items-center justify-center my-4 border border-slate-100 shadow-2xs">
                    <MaterialIcons name="outbox" size={36} color="#94a3b8" />
                    <Text className="text-sm font-bold text-slate-700 mt-2">No Requisitions Sent</Text>
                    <Text className="text-xs text-slate-400 mt-1 text-center max-w-[280px]">
                      Need stock from another van? Tap '+ Request from Van' above to request stock with Web approval.
                    </Text>
                  </View>
                }
                renderItem={({ item }) => {
                  const isApproved = (item.status || '').toLowerCase() === 'approved';
                  const isCompleted = (item.status || '').toLowerCase() === 'completed';

                  return (
                    <View className="bg-white rounded-2xl p-4 mb-3 border border-slate-100 shadow-2xs">
                      {/* Top Header */}
                      <View className="flex-row justify-between items-center pb-2 mb-2 border-b border-slate-100">
                        <View className="flex-row items-center gap-1.5">
                          <View className="bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">
                            <Text className="text-[11px] font-black text-slate-800">
                              #{item.transfer_code || 'V2V-REQ'}
                            </Text>
                          </View>
                          <Text className="text-[11px] text-slate-400">
                            {item.created_at
                              ? new Date(item.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                              : 'Recent'}
                          </Text>
                        </View>

                        {/* Status Badge */}
                        {isCompleted ? (
                          <View className="bg-emerald-50 border border-emerald-300 px-2.5 py-0.5 rounded-full flex-row items-center gap-1">
                            <MaterialIcons name="check-circle" size={12} color="#059669" />
                            <Text className="text-[10px] font-black text-emerald-800 uppercase">
                              Stock Received in Van
                            </Text>
                          </View>
                        ) : isApproved ? (
                          <View className="bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full flex-row items-center gap-1">
                            <MaterialIcons name="verified" size={12} color="#059669" />
                            <Text className="text-[10px] font-bold text-emerald-800 uppercase">
                              Approved by Admin
                            </Text>
                          </View>
                        ) : (
                          <View className="bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                            <Text className="text-[10px] font-bold text-amber-800 uppercase">
                              Awaiting Web Approval
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* Route Strip */}
                      <View className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 mb-2.5">
                        <View className="flex-row items-center justify-between">
                          <View className="flex-1 pr-1">
                            <Text className="text-[10px] font-bold text-slate-400 uppercase">Requested From</Text>
                            <Text className="text-xs font-extrabold text-slate-800" numberOfLines={1}>
                              {item.source_salesman_name}
                            </Text>
                            <Text className="text-[10px] text-slate-500 font-medium">
                              Van: {item.source_vehicle_reg || 'N/A'}
                            </Text>
                          </View>

                          <View className="px-2">
                            <MaterialIcons name="arrow-forward" size={16} color="#94a3b8" />
                          </View>

                          <View className="flex-1 pl-1 items-end">
                            <Text className="text-[10px] font-bold text-slate-400 uppercase">Receiving Van (My Van)</Text>
                            <Text className="text-xs font-extrabold text-blue-800" numberOfLines={1}>
                              {item.target_salesman_name || 'My Van'}
                            </Text>
                            <Text className="text-[10px] text-slate-500 font-medium">
                              Van: {item.target_vehicle_reg || 'N/A'}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Product Details */}
                      <View className="flex-row justify-between items-center mb-2">
                        <View className="flex-1 pr-2">
                          <Text className="text-sm font-extrabold text-slate-800">{item.product_name}</Text>
                          {item.product_sku ? (
                            <Text className="text-[10px] text-slate-400 font-mono">SKU: {item.product_sku}</Text>
                          ) : null}
                        </View>
                        <View className="items-end">
                          <View className="bg-blue-50 border border-blue-200 px-3 py-1 rounded-xl">
                            <Text className="text-sm font-black text-blue-900">
                              {item.quantity} {item.package_type || 'Units'}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Explanation note based on status */}
                      <View className="bg-slate-100/70 p-2 rounded-xl border border-slate-200/50 mt-1">
                        <Text className="text-[11px] text-slate-600 font-medium">
                          {isCompleted
                            ? `✓ ${item.quantity} units of ${item.product_name} transferred from ${item.source_salesman_name}'s van.`
                            : isApproved
                            ? `✓ Approved by Web Admin. Waiting for ${item.source_salesman_name} to transfer stock to your van.`
                            : `⏳ Request submitted. Waiting for Web Admin approval.`}
                        </Text>
                      </View>
                    </View>
                  );
                }}
              />
            )}
          </View>
        )}

        {/* ===================== TAB 4: CUSTOMER RETURNS ===================== */}
        {activeTab === 'return' && (
          <View className="flex-1">
            {/* Header & Subtitle */}
            <View className="flex-row justify-between items-center mb-3">
              <View>
                <Text className="text-sm font-bold text-slate-800">Customer Returns & Restocks</Text>
                <Text className="text-[11px] text-slate-500">Field Goods Returned & Restocked to Van</Text>
              </View>
              <View className="bg-red-50 border border-red-200 px-2.5 py-1 rounded-full flex-row items-center gap-1">
                <MaterialIcons name="restore" size={14} color="#dc2626" />
                <Text className="text-xs font-black text-red-700">{returnsList.length} Batches</Text>
              </View>
            </View>

            {/* KPI Summary Cards */}
            <View className="flex-row gap-2 mb-3">
              <View className="flex-1 bg-white p-2.5 rounded-2xl border border-slate-100 shadow-2xs">
                <Text className="text-[10px] font-bold text-slate-400 uppercase">Total Returns</Text>
                <Text className="text-base font-bold text-slate-800 mt-0.5 leading-tight">{returnsList.length}</Text>
                <Text className="text-[10px] text-slate-500 font-medium">Batches</Text>
              </View>

              <View className="flex-1 bg-white p-2.5 rounded-2xl border border-slate-100 shadow-2xs">
                <Text className="text-[10px] font-bold text-slate-400 uppercase">Restocked</Text>
                <Text className="text-base font-bold text-emerald-700 mt-0.5 leading-tight">{totalReturnedUnits}</Text>
                <Text className="text-[10px] text-emerald-600 font-semibold">Units In Van</Text>
              </View>

              <View className="flex-1 bg-white p-2.5 rounded-2xl border border-slate-100 shadow-2xs">
                <Text className="text-[10px] font-bold text-slate-400 uppercase">Refund Value</Text>
                <Text className="text-sm font-bold text-red-600 mt-0.5 leading-tight" numberOfLines={1} adjustsFontSizeToFit>
                  ₹{Math.round(totalRefundAmount).toLocaleString('en-IN')}
                </Text>
                <Text className="text-[10px] text-slate-500 font-medium">Refunded</Text>
              </View>
            </View>

            {/* Search Bar */}
            <View className="bg-white rounded-2xl px-3.5 py-2 mb-3 flex-row items-center border border-slate-200 shadow-2xs">
              <MaterialIcons name="search" size={18} color="#94a3b8" />
              <TextInput
                value={returnSearch}
                onChangeText={setReturnSearch}
                placeholder="Search returns by customer, voucher #, SKU or reason..."
                placeholderTextColor="#94a3b8"
                className="flex-1 ml-2 text-xs text-slate-800"
              />
              {returnSearch.length > 0 && (
                <TouchableOpacity onPress={() => setReturnSearch('')}>
                  <MaterialIcons name="close" size={16} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>

            {/* Returns FlatList */}
            <FlatList
              data={filteredReturns}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
              refreshControl={
                <RefreshControl
                  refreshing={syncing}
                  onRefresh={() => handleSync(false)}
                  colors={['#2563eb']}
                  tintColor="#2563eb"
                />
              }
              ListEmptyComponent={
                <View className="bg-white rounded-3xl p-6 items-center justify-center my-4 border border-slate-100 shadow-2xs">
                  <MaterialIcons name="assignment-return" size={38} color="#94a3b8" />
                  <Text className="text-sm font-bold text-slate-700 mt-2">No Returned Items Recorded</Text>
                  <Text className="text-xs text-slate-400 mt-1 text-center max-w-[280px]">
                    Customer returns processed in the Sales screen will automatically appear here and restock into your live van inventory.
                  </Text>
                </View>
              }
              renderItem={({ item }) => {
                let parsedItems: any[] = [];
                if (item.items) {
                  try {
                    parsedItems = typeof item.items === 'string' ? JSON.parse(item.items) : item.items;
                  } catch (e) {
                    parsedItems = [];
                  }
                }
                const hasDetailedItems = Array.isArray(parsedItems) && parsedItems.length > 0;
                const formattedDate = item.created_at
                  ? new Date(item.created_at).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Recent';

                return (
                  <View className="bg-white rounded-2xl p-4 mb-3 border border-slate-100 shadow-2xs">
                    {/* Top Row: Code + Restock Badge */}
                    <View className="flex-row justify-between items-center mb-2.5 pb-2 border-b border-slate-100">
                      <View className="flex-row items-center gap-1.5">
                        <View className="bg-amber-100 px-2 py-0.5 rounded-lg border border-amber-200 flex-row items-center gap-1">
                          <MaterialIcons name="assignment-return" size={12} color="#b45309" />
                          <Text className="text-[11px] font-extrabold text-amber-900">
                            {item.booking_code || 'RET-2026'}
                          </Text>
                        </View>
                        <Text className="text-[11px] text-slate-400">• {formattedDate}</Text>
                      </View>

                      <View className="bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full flex-row items-center gap-1">
                        <MaterialIcons name="check-circle" size={12} color="#059669" />
                        <Text className="text-[10px] font-bold text-emerald-800">Van Restocked</Text>
                      </View>
                    </View>

                    {/* Customer & Total Units */}
                    <View className="flex-row justify-between items-start mb-2">
                      <View className="flex-1 pr-2">
                        <Text className="text-sm font-extrabold text-slate-800">{item.customer_name}</Text>
                        <Text className="text-xs text-slate-500 mt-0.5 font-medium">
                          Returned {item.total_qty} {Number(item.total_qty) === 1 ? 'unit' : 'units'} of merchandise
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-sm font-black text-red-600">
                          ₹{Number(item.total_amount || 0).toFixed(2)}
                        </Text>
                        <Text className="text-[10px] font-bold text-slate-400">Refund Value</Text>
                      </View>
                    </View>

                    {/* Returned Goods Breakdown */}
                    <View className="bg-slate-50 rounded-xl p-2.5 mb-2.5 border border-slate-100">
                      <Text className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">
                        Restocked Product Details
                      </Text>
                      {hasDetailedItems ? (
                        parsedItems.map((prod: any, idx: number) => (
                          <View
                            key={idx}
                            className={`flex-row justify-between items-center py-1 ${
                              idx < parsedItems.length - 1 ? 'border-b border-slate-200/60' : ''
                            }`}
                          >
                            <View className="flex-1 pr-2">
                              <Text className="text-xs font-bold text-slate-800" numberOfLines={1}>
                                {prod.product_name}
                              </Text>
                              {prod.warehouse_name ? (
                                <Text className="text-[10px] text-slate-400">
                                  Src: {prod.warehouse_name}
                                </Text>
                              ) : null}
                            </View>
                            <View className="items-end">
                              <Text className="text-xs font-bold text-slate-700">
                                {prod.qty} {prod.unit || 'units'}
                              </Text>
                              <Text className="text-[10px] text-slate-400">
                                @ ₹{Number(prod.unit_price || 0).toFixed(2)}
                              </Text>
                            </View>
                          </View>
                        ))
                      ) : (
                        <View className="flex-row justify-between items-center py-0.5">
                          <Text className="text-xs font-bold text-slate-800">{item.product_name}</Text>
                          <Text className="text-xs font-bold text-slate-700">{item.total_qty} units</Text>
                        </View>
                      )}
                    </View>

                    {/* Return Reason Box */}
                    {item.notes ? (
                      <View className="bg-amber-50/70 border border-amber-200/60 rounded-xl p-2.5 mb-3 flex-row items-start gap-2">
                        <MaterialIcons name="info-outline" size={15} color="#d97706" style={{ marginTop: 1 }} />
                        <View className="flex-1">
                          <Text className="text-[10px] font-bold text-amber-800 uppercase">Return Reason & Settlement</Text>
                          <Text className="text-xs text-amber-900 mt-0.5 font-medium">"{item.notes}"</Text>
                        </View>
                      </View>
                    ) : null}

                    {/* Footer Action: View Return Voucher */}
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedReturn(item);
                        setIsReturnModalOpen(true);
                      }}
                      className="bg-slate-100 active:bg-slate-200 py-2.5 rounded-xl flex-row items-center justify-center gap-1.5"
                    >
                      <MaterialIcons name="receipt-long" size={16} color="#334155" />
                      <Text className="text-xs font-bold text-slate-700">View Return Voucher</Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
            />
          </View>
        )}
      </View>

      {/* ===================== MODAL: NEW STOCK REQUEST ===================== */}
      <Modal visible={isRequestModalOpen} animationType="slide" transparent={true}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 bg-black/50 justify-end"
        >
          <View className="bg-white rounded-t-3xl p-5 max-h-[90%]">
            <View className="flex-row justify-between items-center mb-3">
              <View>
                <Text className="text-lg font-black text-slate-800">New Stock Request</Text>
                <Text className="text-xs text-slate-400">Warehouse stock requisition refill</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setIsRequestModalOpen(false);
                  setReqSearchQuery('');
                }}
                className="w-8 h-8 rounded-full bg-slate-100 items-center justify-center"
              >
                <MaterialIcons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Target Warehouse Selection */}
              <Text className="text-xs font-bold text-slate-700 mb-1">Target Warehouse</Text>
              <View className="flex-row flex-wrap gap-2 mb-3">
                {(availableWarehouseNames.length > 0 ? availableWarehouseNames : ['Central Warehouse', 'Palakkad Depot']).map(wh => (
                  <TouchableOpacity
                    key={wh}
                    onPress={() => setReqWarehouse(wh)}
                    className={`px-3 py-2 rounded-xl border flex-1 min-w-[140px] items-center ${
                      reqWarehouse === wh ? 'bg-blue-600 border-blue-600' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <Text className={`text-xs font-bold ${reqWarehouse === wh ? 'text-white' : 'text-slate-700'}`}>
                      {wh}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Search Option for Items */}
              <View className="mb-3">
                <View className="flex-row justify-between items-center mb-1">
                  <Text className="text-xs font-bold text-slate-700">Search Items</Text>
                  {reqProductName ? (
                    <TouchableOpacity
                      onPress={() => {
                        setReqProductName('');
                        setReqProductId(null);
                        setReqSearchQuery('');
                      }}
                    >
                      <Text className="text-[11px] font-bold text-emerald-600">Change Item</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* If an item is already selected, show selected item pill / card */}
                {reqProductName ? (
                  <View className="bg-emerald-50 border border-emerald-300 rounded-2xl p-3 flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2.5 flex-1 pr-2">
                      <View className="w-8 h-8 rounded-xl bg-emerald-600 items-center justify-center">
                        <MaterialIcons name="check" size={18} color="#ffffff" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm font-black text-slate-800" numberOfLines={1}>
                          {reqProductName}
                        </Text>
                        <Text className="text-[11px] font-semibold text-emerald-700">
                          ✓ Selected for Requisition
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        setReqProductName('');
                        setReqProductId(null);
                        setReqSearchQuery('');
                      }}
                      className="w-7 h-7 rounded-full bg-emerald-100 items-center justify-center"
                    >
                      <MaterialIcons name="close" size={16} color="#047857" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  /* Search Input & Item Selection List */
                  <View>
                    <View className="bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 flex-row items-center mb-2">
                      <MaterialIcons name="search" size={18} color="#64748b" />
                      <TextInput
                        value={reqSearchQuery}
                        onChangeText={setReqSearchQuery}
                        placeholder="Search item by name, SKU, or category..."
                        placeholderTextColor="#94a3b8"
                        className="flex-1 ml-2 text-xs font-semibold text-slate-800"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {reqSearchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setReqSearchQuery('')}>
                          <MaterialIcons name="close" size={16} color="#94a3b8" />
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Filtered Items Dropdown / Scroll list */}
                    <View className="bg-slate-50 border border-slate-200 rounded-2xl p-2 max-h-48">
                      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={true} keyboardShouldPersistTaps="handled">
                        {filteredRequestProducts.length === 0 ? (
                          <View className="py-4 items-center justify-center">
                            <MaterialIcons name="search-off" size={24} color="#94a3b8" />
                            <Text className="text-xs font-medium text-slate-400 mt-1">
                              No items match "{reqSearchQuery}"
                            </Text>
                          </View>
                        ) : (
                          filteredRequestProducts.map(p => {
                            const isSelected = reqProductName === p.product_name;
                            return (
                              <TouchableOpacity
                                key={`${p.product_id}-${p.product_name}`}
                                onPress={() => {
                                  setReqProductName(p.product_name);
                                  setReqProductId(p.product_id);
                                  setReqSearchQuery('');
                                }}
                                className={`p-2.5 rounded-xl mb-1 flex-row items-center justify-between border ${
                                  isSelected
                                    ? 'bg-emerald-600 border-emerald-600'
                                    : 'bg-white border-slate-100 active:bg-slate-100'
                                }`}
                                activeOpacity={0.7}
                              >
                                <View className="flex-1 pr-2">
                                  <Text
                                    className={`text-xs font-bold ${
                                      isSelected ? 'text-white' : 'text-slate-800'
                                    }`}
                                    numberOfLines={1}
                                  >
                                    {p.product_name}
                                  </Text>
                                  <View className="flex-row items-center gap-2 mt-0.5">
                                    {p.category_name ? (
                                      <Text
                                        className={`text-[10px] ${
                                          isSelected ? 'text-emerald-100' : 'text-slate-500'
                                        }`}
                                      >
                                        {p.category_name}
                                      </Text>
                                    ) : null}
                                    {p.product_sku ? (
                                      <Text
                                        className={`text-[10px] ${
                                          isSelected ? 'text-emerald-100' : 'text-slate-400'
                                        }`}
                                      >
                                        SKU: {p.product_sku}
                                      </Text>
                                    ) : null}
                                  </View>
                                </View>

                                <View className="items-end">
                                  <Text
                                    className={`text-[10px] font-bold ${
                                      isSelected ? 'text-white' : 'text-slate-500'
                                    }`}
                                  >
                                    {p.available_quantity > 0
                                      ? `${p.available_quantity} Avail`
                                      : 'Stock: 0'}
                                  </Text>
                                  {isSelected ? (
                                    <MaterialIcons name="check" size={14} color="#ffffff" />
                                  ) : (
                                    <MaterialIcons name="chevron-right" size={16} color="#94a3b8" />
                                  )}
                                </View>
                              </TouchableOpacity>
                            );
                          })
                        )}
                      </ScrollView>
                    </View>
                  </View>
                )}
              </View>

              {/* Unit Mode Selector (Loose vs Box) */}
              {reqProductName ? (
                <View className="mb-3">
                  <Text className="text-xs font-bold text-slate-700 mb-1">Requisition Unit</Text>
                  {(() => {
                    const selP = uniqueRequestProducts.find(p => p.product_name === reqProductName || p.product_id === reqProductId);
                    const pkgType = selP?.package_type || 'Box';
                    const itemsPerPkg = selP?.items_per_package || 10;
                    const unitLabel = selP?.unit || 'Units';
                    const isBox = reqUnitMode === 'box';

                    return (
                      <View style={{ flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 12, padding: 3, borderWidth: 1, borderColor: '#e2e8f0' }}>
                        <TouchableOpacity
                          onPress={() => setReqUnitMode('loose')}
                          style={{
                            flex: 1,
                            paddingVertical: 7,
                            alignItems: 'center',
                            borderRadius: 9,
                            backgroundColor: !isBox ? '#ffffff' : 'transparent',
                            shadowColor: !isBox ? '#000' : 'transparent',
                            shadowOffset: { width: 0, height: 1 },
                            shadowOpacity: !isBox ? 0.08 : 0,
                            shadowRadius: 2,
                            elevation: !isBox ? 1 : 0,
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={{ fontSize: 11, fontWeight: !isBox ? '900' : '700', color: !isBox ? '#0f172a' : '#64748b' }}>
                            Loose ({unitLabel})
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => setReqUnitMode('box')}
                          style={{
                            flex: 1,
                            paddingVertical: 7,
                            alignItems: 'center',
                            borderRadius: 9,
                            backgroundColor: isBox ? '#2563eb' : 'transparent',
                            shadowColor: isBox ? '#2563eb' : 'transparent',
                            shadowOffset: { width: 0, height: 1 },
                            shadowOpacity: isBox ? 0.25 : 0,
                            shadowRadius: 3,
                            elevation: isBox ? 2 : 0,
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={{ fontSize: 11, fontWeight: isBox ? '900' : '700', color: isBox ? '#ffffff' : '#64748b' }}>
                            {pkgType} ({itemsPerPkg} {unitLabel}/pkg)
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })()}
                </View>
              ) : null}

              {/* Quantity Input */}
              {(() => {
                const selP = uniqueRequestProducts.find(p => p.product_name === reqProductName || p.product_id === reqProductId);
                const pkgType = selP?.package_type || 'Box';
                const itemsPerPkg = Math.max(1, selP?.items_per_package || 10);
                const unitLabel = selP?.unit || 'Units';
                const isBox = reqUnitMode === 'box';
                const parsedNum = parseFloat(reqQty) || 0;
                const totalUnits = isBox ? parsedNum * itemsPerPkg : parsedNum;
                const unitPrice = Number(selP?.unit_price) || 0;
                const boxPrice = Number(selP?.box_price) || (unitPrice * itemsPerPkg);
                const effectiveRate = isBox ? boxPrice : unitPrice;
                const estimatedTotal = parsedNum * effectiveRate;

                return (
                  <View className="mb-3">
                    <View className="flex-row justify-between items-center mb-1">
                      <Text className="text-xs font-bold text-slate-700">
                        {isBox ? `Requested Quantity (${pkgType}s)` : `Requested Quantity (${unitLabel})`}
                      </Text>
                      {isBox && parsedNum > 0 && (
                        <Text className="text-[11px] font-extrabold text-blue-700">
                          = {totalUnits} {unitLabel} Total
                        </Text>
                      )}
                    </View>
                    <TextInput
                      value={reqQty}
                      onChangeText={setReqQty}
                      keyboardType="numeric"
                      placeholder={isBox ? `e.g. 1 ${pkgType}` : `e.g. 10 ${unitLabel}`}
                      style={{ textAlignVertical: 'center', includeFontPadding: false }}
                      className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800"
                    />

                    {/* Rate & Estimated Price Card */}
                    {selP && (
                      <View className="mt-2.5 bg-blue-50 border border-blue-200 rounded-xl p-2.5">
                        <View className="flex-row justify-between items-center">
                          <Text className="text-xs font-semibold text-blue-800">
                            Rate ({isBox ? pkgType : unitLabel}):
                          </Text>
                          <Text className="text-xs font-black text-blue-900">
                            ₹{effectiveRate.toLocaleString('en-IN', { minimumFractionDigits: 2 })} / {isBox ? pkgType : unitLabel}
                          </Text>
                        </View>
                        {isBox && itemsPerPkg > 1 && (
                          <Text className="text-[10px] text-blue-600 mt-0.5">
                            (1 {pkgType} = {itemsPerPkg} {unitLabel} × ₹{unitPrice.toLocaleString('en-IN')})
                          </Text>
                        )}
                        {parsedNum > 0 && (
                          <View className="flex-row justify-between items-center mt-2 pt-2 border-t border-blue-200">
                            <Text className="text-xs font-bold text-blue-900">Total Valuation:</Text>
                            <Text className="text-sm font-black text-emerald-700">
                              ₹{estimatedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })()}

              {/* Urgency */}
              <Text className="text-xs font-bold text-slate-700 mb-1">Priority</Text>
              <View className="flex-row gap-2 mb-3">
                {(['Normal', 'High', 'Urgent'] as const).map(u => (
                  <TouchableOpacity
                    key={u}
                    onPress={() => setReqUrgency(u)}
                    className={`flex-1 py-2 rounded-xl border items-center ${
                      reqUrgency === u ? 'bg-amber-600 border-amber-600' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <Text className={`text-xs font-bold ${reqUrgency === u ? 'text-white' : 'text-slate-700'}`}>
                      {u}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Notes */}
              <Text className="text-xs font-bold text-slate-700 mb-1">Notes / Reason</Text>
              <TextInput
                value={reqNotes}
                onChangeText={setReqNotes}
                placeholder="e.g. High demand on upcoming festival weekend"
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 mb-4"
              />

              <TouchableOpacity
                onPress={handleSubmitStockRequest}
                disabled={submittingReq}
                className="bg-emerald-600 active:bg-emerald-700 py-3.5 rounded-2xl items-center shadow-md mb-4"
              >
                {submittingReq ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text className="text-white text-sm font-bold">Submit Stock Requisition</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ===================== MODAL: REQUEST STOCK FROM PEER VAN ===================== */}
      <Modal visible={isTransferModalOpen} animationType="slide" transparent={true}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 bg-black/50 justify-end"
        >
          <View className="bg-white rounded-t-3xl p-5 max-h-[88%]">
            <View className="flex-row justify-between items-center mb-3 pb-2 border-b border-slate-100">
              <View>
                <Text className="text-base font-black text-slate-800">Request Stock from Peer Van</Text>
                <Text className="text-[11px] text-slate-500">Request stock from another salesman's van with Web approval</Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsTransferModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 items-center justify-center"
              >
                <MaterialIcons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Select Salesman to Request From */}
              <Text className="text-xs font-bold text-slate-700 mb-1">Select Salesman to Request From (Source Van)</Text>
              {availableSalesmen.length === 0 ? (
                <View className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200/80 mb-3">
                  <View className="flex-row items-center gap-2 mb-1">
                    <MaterialIcons name="info-outline" size={16} color="#d97706" />
                    <Text className="text-xs font-bold text-amber-900">No Other Salesmen Available on Web</Text>
                  </View>
                  <Text className="text-[11px] text-amber-800 leading-4">
                    Currently no other salesman or van is registered in the system. When an administrator registers salesmen and assigns vans on the Web portal, they will automatically appear here.
                  </Text>
                </View>
              ) : (
                <View className="gap-2 mb-3">
                  {availableSalesmen.map(sm => {
                    const isSelected = selectedTargetSalesman?.salesman_id === sm.salesman_id;
                    return (
                      <TouchableOpacity
                        key={sm.salesman_id}
                        onPress={() => setSelectedTargetSalesman(sm)}
                        className={`p-3 rounded-xl border flex-row items-center justify-between ${
                          isSelected ? 'bg-blue-50 border-blue-500' : 'bg-slate-50 border-slate-200'
                        }`}
                        activeOpacity={0.7}
                      >
                        <View className="flex-1 pr-2">
                          <View className="flex-row items-center gap-2">
                            <MaterialIcons
                              name="local-shipping"
                              size={16}
                              color={isSelected ? '#2563eb' : '#64748b'}
                            />
                            <Text className={`text-xs font-bold ${isSelected ? 'text-blue-900' : 'text-slate-800'}`}>
                              {sm.salesman_name}
                            </Text>
                          </View>
                          <View className="flex-row items-center gap-2 mt-1 ml-6 flex-wrap">
                            <Text className="text-[11px] font-semibold text-slate-600">
                              Van: {sm.vehicle_reg_no || 'Assigned Van'}
                              {sm.vehicle_model ? ` (${sm.vehicle_model})` : ''}
                            </Text>
                            {sm.route_name ? (
                              <Text className="text-[10px] text-slate-400" numberOfLines={1}>
                                • {sm.route_name}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                        <View
                          className={`w-5 h-5 rounded-full border items-center justify-center ${
                            isSelected ? 'border-blue-600 bg-blue-600' : 'border-slate-300'
                          }`}
                        >
                          {isSelected && <MaterialIcons name="check" size={13} color="#ffffff" />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Product Selection via Search */}
              <Text className="text-xs font-bold text-slate-700 mb-1">Select Product to Request</Text>
              {transferProductName ? (
                /* Selected Product Card */
                <View className="bg-emerald-50 border border-emerald-300 rounded-2xl p-3 mb-3 flex-row justify-between items-center">
                  <View className="flex-1 pr-2">
                    <View className="flex-row items-center gap-1.5 mb-0.5">
                      <MaterialIcons name="check-circle" size={15} color="#059669" />
                      <Text className="text-xs font-bold text-slate-800" numberOfLines={1}>
                        {transferProductName}
                      </Text>
                    </View>
                    <Text className="text-[11px] text-emerald-700 font-semibold">
                      ✓ Selected for Requisition
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setTransferProductName('');
                      setTransferProductId(null);
                    }}
                    className="bg-white border border-emerald-300 px-3 py-1.5 rounded-xl shadow-2xs"
                  >
                    <Text className="text-[11px] font-bold text-emerald-700">Change Item</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                /* Search Box & Item List */
                <View className="mb-3">
                  <View className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 flex-row items-center mb-2">
                    <MaterialIcons name="search" size={16} color="#64748b" />
                    <TextInput
                      value={transferSearchQuery}
                      onChangeText={setTransferSearchQuery}
                      placeholder="Search product by name, SKU, or category..."
                      placeholderTextColor="#94a3b8"
                      className="flex-1 ml-2 text-xs font-semibold text-slate-800"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {transferSearchQuery.length > 0 && (
                      <TouchableOpacity onPress={() => setTransferSearchQuery('')}>
                        <MaterialIcons name="close" size={14} color="#94a3b8" />
                      </TouchableOpacity>
                    )}
                  </View>

                  <View className="bg-slate-50 border border-slate-200 rounded-2xl p-2 max-h-44">
                    <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={true} keyboardShouldPersistTaps="handled">
                      {filteredTransferProducts.length === 0 ? (
                        <View className="py-4 items-center justify-center">
                          <MaterialIcons name="search-off" size={24} color="#94a3b8" />
                          <Text className="text-xs font-medium text-slate-400 mt-1">
                            No products match "{transferSearchQuery}"
                          </Text>
                        </View>
                      ) : (
                        filteredTransferProducts.map(p => (
                          <TouchableOpacity
                            key={`${p.product_id}-${p.product_name}`}
                            onPress={() => {
                              setTransferProductName(p.product_name);
                              setTransferProductId(p.product_id);
                              setTransferSearchQuery('');
                            }}
                            className="p-2.5 rounded-xl mb-1 flex-row items-center justify-between border bg-white border-slate-100 active:bg-blue-50"
                            activeOpacity={0.7}
                          >
                            <View className="flex-1 pr-2">
                              <Text className="text-xs font-bold text-slate-800" numberOfLines={1}>
                                {p.product_name}
                              </Text>
                              <View className="flex-row items-center gap-2 mt-0.5">
                                {p.product_sku ? (
                                  <Text className="text-[10px] text-slate-400">
                                    SKU: {p.product_sku}
                                  </Text>
                                ) : null}
                                {p.category_name ? (
                                  <Text className="text-[10px] text-slate-400">
                                    • {p.category_name}
                                  </Text>
                                ) : null}
                              </View>
                            </View>

                            <MaterialIcons name="chevron-right" size={18} color="#94a3b8" />
                          </TouchableOpacity>
                        ))
                      )}
                    </ScrollView>
                  </View>
                </View>
              )}

              {/* Transfer Quantity */}
              <Text className="text-xs font-bold text-slate-700 mb-1">Requested Quantity (Units)</Text>
              <TextInput
                value={transferQty}
                onChangeText={setTransferQty}
                keyboardType="numeric"
                placeholder="e.g. 10"
                style={{ textAlignVertical: 'center', includeFontPadding: false }}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 mb-3"
              />

              {/* Location of Exchange */}
              <Text className="text-xs font-bold text-slate-700 mb-1">Location of Exchange / Handover Point</Text>
              <TextInput
                value={transferLocation}
                onChangeText={setTransferLocation}
                placeholder="e.g. Alathur Bypass Petrol Pump"
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 mb-3"
              />

              {/* Reason */}
              <Text className="text-xs font-bold text-slate-700 mb-1">Reason / Notes for Approval</Text>
              <TextInput
                value={transferReason}
                onChangeText={setTransferReason}
                placeholder="e.g. Urgent stock replenishment for afternoon delivery"
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 mb-4"
              />

              <TouchableOpacity
                onPress={handleSubmitVanTransfer}
                disabled={submittingTransfer || availableSalesmen.length === 0}
                className={`py-3.5 rounded-2xl items-center shadow-md mb-4 ${
                  availableSalesmen.length === 0
                    ? 'bg-slate-300'
                    : 'bg-blue-600 active:bg-blue-700'
                }`}
              >
                {submittingTransfer ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text className="text-white text-sm font-bold">
                    {availableSalesmen.length === 0
                      ? 'No Salesman Available on Web'
                      : 'Submit Request for Web Approval'}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ===================== MODAL: RETURN VOUCHER DETAILS ===================== */}
      <Modal
        visible={isReturnModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsReturnModalOpen(false)}
      >
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-3xl p-5 max-h-[88%]">
            <View className="flex-row justify-between items-center pb-3 border-b border-slate-100 mb-3">
              <View className="flex-row items-center gap-2">
                <View className="p-2 rounded-xl bg-amber-100">
                  <MaterialIcons name="assignment-return" size={20} color="#b45309" />
                </View>
                <View>
                  <Text className="text-base font-black text-slate-800">Goods Return Voucher</Text>
                  <Text className="text-xs font-bold text-amber-800">
                    {selectedReturn?.booking_code || 'RET-2026'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setIsReturnModalOpen(false)}
                className="p-1 rounded-full bg-slate-100"
              >
                <MaterialIcons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            {selectedReturn && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Voucher Meta Strip */}
                <View className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 mb-3">
                  <View className="flex-row justify-between mb-1.5">
                    <Text className="text-xs text-slate-500">Customer / Shop:</Text>
                    <Text className="text-xs font-extrabold text-slate-800">
                      {selectedReturn.customer_name}
                    </Text>
                  </View>
                  <View className="flex-row justify-between mb-1.5">
                    <Text className="text-xs text-slate-500">Return Date:</Text>
                    <Text className="text-xs font-bold text-slate-700">
                      {selectedReturn.created_at
                        ? new Date(selectedReturn.created_at).toLocaleString('en-IN')
                        : 'Recent'}
                    </Text>
                  </View>
                  <View className="flex-row justify-between mb-1.5">
                    <Text className="text-xs text-slate-500">Restock Destination:</Text>
                    <Text className="text-xs font-bold text-emerald-700">
                      {getAssignedRoute()?.vehicle_reg_no
                        ? `Salesman Van Stock (${getAssignedRoute()?.vehicle_reg_no})`
                        : 'Salesman Van Stock'}
                    </Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-xs text-slate-500">Salesman:</Text>
                    <Text className="text-xs font-bold text-slate-700">
                      {user?.name || 'Sales Representative'}
                    </Text>
                  </View>
                </View>

                {/* Return Items Table */}
                <Text className="text-xs font-bold text-slate-700 uppercase mb-2">Restocked Items List</Text>
                <View className="border border-slate-200 rounded-2xl overflow-hidden mb-3">
                  <View className="bg-slate-100 flex-row px-3 py-2 border-b border-slate-200">
                    <Text className="flex-1 text-[11px] font-bold text-slate-600">Product</Text>
                    <Text className="w-16 text-center text-[11px] font-bold text-slate-600">Qty</Text>
                    <Text className="w-16 text-right text-[11px] font-bold text-slate-600">Rate</Text>
                    <Text className="w-20 text-right text-[11px] font-bold text-slate-600">Total</Text>
                  </View>

                  {(() => {
                    let items: any[] = [];
                    if (selectedReturn.items) {
                      try {
                        items = typeof selectedReturn.items === 'string' ? JSON.parse(selectedReturn.items) : selectedReturn.items;
                      } catch (e) {
                        items = [];
                      }
                    }
                    if (items.length > 0) {
                      return items.map((itm, i) => (
                        <View
                          key={i}
                          className={`flex-row px-3 py-2.5 items-center ${
                            i < items.length - 1 ? 'border-b border-slate-100' : ''
                          }`}
                        >
                          <View className="flex-1 pr-1">
                            <Text className="text-xs font-bold text-slate-800">{itm.product_name}</Text>
                            {itm.warehouse_name ? (
                              <Text className="text-[10px] text-slate-400">[{itm.warehouse_name}]</Text>
                            ) : null}
                          </View>
                          <Text className="w-16 text-center text-xs font-extrabold text-slate-700">
                            {itm.qty} {itm.unit || ''}
                          </Text>
                          <Text className="w-16 text-right text-xs text-slate-600">
                            ₹{Number(itm.unit_price || 0).toFixed(2)}
                          </Text>
                          <Text className="w-20 text-right text-xs font-black text-slate-900">
                            ₹{Number(itm.total || 0).toFixed(2)}
                          </Text>
                        </View>
                      ));
                    }
                    return (
                      <View className="flex-row px-3 py-2.5 items-center">
                        <Text className="flex-1 text-xs font-bold text-slate-800">{selectedReturn.product_name}</Text>
                        <Text className="w-16 text-center text-xs font-extrabold text-slate-700">{selectedReturn.total_qty}</Text>
                        <Text className="w-16 text-right text-xs text-slate-600">₹{Number(selectedReturn.unit_price || 0).toFixed(2)}</Text>
                        <Text className="w-20 text-right text-xs font-black text-slate-900">₹{Number(selectedReturn.total_amount || 0).toFixed(2)}</Text>
                      </View>
                    );
                  })()}

                  <View className="bg-slate-50 px-3 py-2.5 flex-row justify-between border-t border-slate-200">
                    <Text className="text-xs font-bold text-slate-700">Total Returned Units:</Text>
                    <Text className="text-xs font-black text-slate-900">{selectedReturn.total_qty} Units</Text>
                  </View>
                  <View className="bg-red-50/70 px-3 py-2.5 flex-row justify-between border-t border-red-100">
                    <Text className="text-xs font-bold text-red-800">Total Refund / Restock Value:</Text>
                    <Text className="text-sm font-black text-red-600">
                      ₹{Number(selectedReturn.total_amount || 0).toFixed(2)}
                    </Text>
                  </View>
                </View>

                {/* Return Reason Box */}
                {selectedReturn.notes ? (
                  <View className="bg-amber-50 rounded-2xl p-3 border border-amber-200 mb-4">
                    <Text className="text-[10px] font-bold text-amber-800 uppercase mb-1">
                      Reason for Return & Remarks
                    </Text>
                    <Text className="text-xs text-amber-950 font-medium">{selectedReturn.notes}</Text>
                  </View>
                ) : null}

                {/* Close Button */}
                <TouchableOpacity
                  onPress={() => setIsReturnModalOpen(false)}
                  className="bg-slate-800 active:bg-slate-900 py-3 rounded-2xl items-center mb-4"
                >
                  <Text className="text-white text-xs font-bold">Close Voucher</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
