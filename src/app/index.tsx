import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import {
  getDashboardStats,
  getVanStocks,
  getSelectedRoute,
  getCompanyProfile,
  formatStockQty,
  getSyncMeta,
  clearSalesmanLocalData,
  setAssignedRoute,
  setSelectedRoute,
  VanStockRecord,
  RouteInfo,
  CompanyProfile,
} from '../database/db';
import { syncDatabase, syncCompanyProfile, getBackendBaseUrl } from '../database/sync';
import { useAuth } from '../context/AuthContext';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { getCompanyLogo } from '../utils/companyBranding';
import {
  sendImmediateLocationPing,
} from '../services/gpsTrackingService';
import { triggerImmediateSync, addAutoSyncListener, getAutoSyncState } from '../services/autoSyncService';
import { getOrCreateDeviceId, clearPhoneStockSync } from '../utils/deviceInfo';

export default function Dashboard() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [vanStocks, setVanStocks] = useState<VanStockRecord[]>([]);
  const [selectedRoute, setSelectedRouteState] = useState<string>(getSelectedRoute());
  const [company, setCompany] = useState<CompanyProfile>(getCompanyProfile());

  const [stats, setStats] = useState({
    customerCount: 0,
    bookingCount: 0,
    directSalesCount: 0,
    directSalesAmount: 0,
    directSalesCash: 0,
    ordersCount: 0,
    ordersAmount: 0,
    ordersAdvance: 0,
    totalSalesAmount: 0,
    totalOrdersAmount: 0,
    totalAdvanceCollected: 0,
    totalCashCollected: 0,
    totalExpenses: 0,
    netInHandCash: 0,
    pendingPayments: 0,
    vanStockItems: 0,
    vanStockUnits: 0,
    vanStockValue: 0,
    pendingSyncCount: 0,
    route: null as RouteInfo | null,
  });

  // End of Sale State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [reversePasswordInput, setReversePasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [isSubmittingEndOfSale, setIsSubmittingEndOfSale] = useState(false);


  const loadData = useCallback(() => {
    try {
      const currentCompany = getCompanyProfile();
      setCompany(currentCompany);
      syncCompanyProfile().then(fresh => {
        if (fresh) setCompany(fresh);
      }).catch(() => {});

      const currentRoute = getSelectedRoute();
      setSelectedRouteState(currentRoute);
      const data = getDashboardStats(currentRoute);
      const stocks = getVanStocks();
      setStats(data);
      setVanStocks(stocks);
    } catch (e: any) {
      console.error('Failed to load dashboard data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshGps = useCallback(async () => {
    try {
      await sendImmediateLocationPing();
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
      refreshGps();
    }, [loadData, refreshGps])
  );

  const [syncState, setSyncState] = useState(() => getAutoSyncState());

  useEffect(() => {
    const unsubscribe = addAutoSyncListener((event) => {
      setSyncState({
        isRunning: true,
        isSyncing: event.reason === 'sync_started',
        isOnline: event.isOnline,
        lastSyncTime: event.timestamp,
        lastStatus: event.success ? 'synced' : (event.isOnline ? 'error' : 'offline'),
        lastError: event.error || null,
        lastPulledCount: event.pulledCount,
        lastPushedCount: event.pushedCount,
      });
      if (event.success) {
        loadData();
        refreshGps();
      }
    });
    return unsubscribe;
  }, [loadData, refreshGps]);

  const handleSync = async (showAlert: boolean = false) => {
    setSyncing(true);
    triggerImmediateSync('manual_user_tap');
    setTimeout(() => {
      setSyncing(false);
      loadData();
      refreshGps();
    }, 800);
  };

  useEffect(() => {
    if (vanStocks.length === 0) {
      handleSync(false);
    }
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    triggerImmediateSync('pull_to_refresh');
    await refreshGps();
    setTimeout(() => {
      loadData();
      setRefreshing(false);
    }, 600);
  };

  const handleInitiateEndOfSale = () => {
    Alert.alert(
      'Confirm End of Sale',
      'All stocks will be transfer to Warehouse. Are you sure you want to end today\'s sale and return all inventory?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm & Proceed',
          style: 'destructive',
          onPress: () => {
            setReversePasswordInput('');
            setPasswordError('');
            setShowPassword(false);
            setShowPasswordModal(true);
          },
        },
      ]
    );
  };

  const handleSubmitEndOfSale = async () => {
    const trimmedInput = reversePasswordInput.trim();
    if (!trimmedInput) {
      setPasswordError('Please enter your password in reverse.');
      return;
    }

    setIsSubmittingEndOfSale(true);
    setPasswordError('');

    try {
      // 1. Sync any pending sales/collections to DB & Web first
      try {
        await syncDatabase();
      } catch (syncErr) {
        console.warn('Pre-end-of-sale sync warning:', syncErr);
      }

      // 2. Call backend End of Sale API to transfer all van stocks to warehouse in DB & verify reverse password
      const baseUrl = getBackendBaseUrl();
      const deviceId = getOrCreateDeviceId();
      const response = await fetch(`${baseUrl}/api/sales/end-of-sale`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': deviceId,
        },
        body: JSON.stringify({
          salesman_id: user?.id,
          salesman_name: user?.name,
          username: user?.username,
          reverse_password: trimmedInput,
          device_id: deviceId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setPasswordError(data.message || 'Incorrect reverse password. Verification failed.');
        setIsSubmittingEndOfSale(false);
        return;
      }

      // 3. Clear local van stocks, bookings, invoices, expenses and checked out vehicle in SQLite
      clearSalesmanLocalData(false);
      clearPhoneStockSync();
      setAssignedRoute(null);
      setSelectedRoute('');

      // Reset dashboard stats and van stocks in React state immediately
      setStats(getDashboardStats(''));
      setVanStocks(getVanStocks());

      setIsSubmittingEndOfSale(false);
      setShowPasswordModal(false);

      const checkedOutMsg = data.checked_out_vehicle
        ? ` Vehicle ${data.checked_out_vehicle} has been checked out successfully.`
        : '';

      Alert.alert(
        'End of Sale Completed',
        `All stocks have been transferred to the Warehouse. Shift sales and cash settled.${checkedOutMsg} Exiting session.`,
        [
          {
            text: 'OK',
            onPress: async () => {
              await logout();
              router.replace('/login');
            },
          },
        ]
      );
    } catch (err: any) {
      // Offline fallback verification
      const savedPwd = getSyncMeta('user_session_pwd');
      if (savedPwd) {
        const expectedRev = savedPwd.split('').reverse().join('');
        if (trimmedInput === expectedRev) {
          clearSalesmanLocalData(false);
          clearPhoneStockSync();
          setAssignedRoute(null);
          setSelectedRoute('');
          setStats(getDashboardStats(''));
          setVanStocks(getVanStocks());
          setIsSubmittingEndOfSale(false);
          setShowPasswordModal(false);
          Alert.alert(
            'End of Sale Completed (Offline)',
            'All stocks marked for transfer to Warehouse. Mobile database cleared and vehicle checked out. Exiting session.',
            [
              {
                text: 'OK',
                onPress: async () => {
                  await logout();
                  router.replace('/login');
                },
              },
            ]
          );
          return;
        }
      }

      setPasswordError(err.message || 'Failed to submit End of Sale. Please check network connection.');
      setIsSubmittingEndOfSale(false);
    }
  };

  const assignedRoute = stats.route;

  if (loading) {
    return (
      <View className="flex-1 bg-slate-50 justify-center items-center">
        <LoadingIndicator
          message="Loading Dashboard"
          subtext="Calculating van inventory and route metrics..."
          iconName="dashboard"
        />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ paddingBottom: 36 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View className="p-5">
        {/* Official Company Branding Banner (Fetched from Web API) */}
        <View className="bg-white rounded-2xl p-3.5 mb-4 border border-slate-200 shadow-xs flex-row items-center gap-3">
          <View className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200/80 items-center justify-center overflow-hidden p-1">
            <Image
              source={{ uri: getCompanyLogo(company) }}
              style={{ width: '100%', height: '100%' }}
              contentFit="contain"
            />
          </View>
          <View className="flex-1 pr-1">
            <View className="flex-row items-center justify-between gap-1.5">
              <Text className="text-sm font-bold text-slate-800 flex-1 leading-normal" numberOfLines={1}>
                {company.company_name}
              </Text>
              <View className="bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded flex-row items-center gap-1 shrink-0">
                <View className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <Text className="text-[9px] font-bold text-emerald-700 leading-none">Connected</Text>
              </View>
            </View>
            <Text className="text-xs font-medium text-slate-500 mt-0.5" numberOfLines={1}>
              {[company.city, company.state].filter(Boolean).join(', ') || company.address || 'Enterprise ERP'}
            </Text>
            {company.gstin ? (
              <Text className="text-[10px] font-semibold text-slate-400 mt-0.5">
                GSTIN: {company.gstin}
              </Text>
            ) : null}
          </View>
        </View>

        {/* 1. Salesman & Shift Header with Vehicle Number */}
        <View className="flex-row justify-between items-start mb-5">
          <View className="flex-1 pr-3">
           <Text className="text-lg font-bold text-slate-800 mt-0.5 leading-tight">
              {user?.name || 'Sales Representative'}
            </Text>

            {/* Vehicle Number directly below Salesman name (Assigned from Web ERP only) */}
            {assignedRoute?.vehicle_reg_no ? (
              <View className="flex-row items-center gap-2 mt-1">
                <View className="bg-amber-100 border border-amber-300 px-2.5 py-0.5 rounded-lg flex-row items-center gap-1.5">
                  <MaterialIcons name="local-shipping" size={13} color="#b45309" />
                  <Text className="text-xs font-extrabold text-amber-900 tracking-wider">
                    {assignedRoute.vehicle_reg_no}
                  </Text>
                </View>
                {assignedRoute?.vehicle_model ? (
                  <Text className="text-xs font-semibold text-slate-500">
                    ({assignedRoute.vehicle_model})
                  </Text>
                ) : null}
              </View>
            ) : (
              <View className="flex-row items-center gap-1.5 mt-1.5">
                <View className="bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-lg flex-row items-center gap-1.5">
                  <MaterialIcons name="directions-bus" size={13} color="#64748b" />
                  <Text className="text-xs font-semibold text-slate-500">
                    No Vehicle Assigned
                  </Text>
                </View>
              </View>
            )}

            <View className="flex-row items-center gap-1.5 mt-1.5">
              <View className="w-2 h-2 rounded-full bg-emerald-500" />
              <Text className="text-xs font-bold text-emerald-600">On Duty • Active Shift</Text>
            </View>
          </View>

          {/* Live Sync Status Indicator Pill */}
          <TouchableOpacity
            onPress={() => handleSync(false)}
            disabled={syncState.isSyncing || syncing}
            className={`flex-row items-center gap-1.5 py-1.5 px-3 rounded-full border ${
              syncState.isSyncing || syncing
                ? 'bg-blue-50 border-blue-200'
                : syncState.isOnline
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-amber-50 border-amber-200'
            }`}
            activeOpacity={0.7}
          >
            {syncState.isSyncing || syncing ? (
              <ActivityIndicator size="small" color="#2563eb" style={{ transform: [{ scale: 0.75 }] }} />
            ) : (
              <View
                className={`w-2 h-2 rounded-full ${
                  syncState.isOnline ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
            )}
            <Text
              className={`text-xs font-bold ${
                syncState.isSyncing || syncing
                  ? 'text-blue-700'
                  : syncState.isOnline
                  ? 'text-emerald-700'
                  : 'text-amber-700'
              }`}
            >
              {syncState.isSyncing || syncing
                ? 'Syncing...'
                : syncState.isOnline
                ? 'Live Synced'
                : 'Offline (Local)'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 2. Loaded Van Stock Card (Highlighting Ponny) */}
        <View className="bg-white rounded-3xl p-4 mb-4 shadow-sm border border-slate-100">
          <View className="flex-row justify-between items-center mb-3">
            <View className="flex-row items-center gap-2">
              <View className="w-8 h-8 rounded-xl bg-amber-100 items-center justify-center">
                <MaterialIcons name="inventory-2" size={18} color="#d97706" />
              </View>
              <View>
                <Text className="text-sm font-bold text-slate-800 leading-tight">Van Inventory</Text>
                <Text className="text-[11px] text-slate-500 font-medium leading-tight">Live Stock in Van</Text>
              </View>
            </View>

            <View className="items-end">
              <Text className="text-xs text-slate-600 font-bold leading-tight">
                {stats.vanStockItems} Items • {stats.vanStockUnits} Units
              </Text>
              <Text className="text-xs font-bold text-emerald-700 leading-tight mt-0.5">
                ₹{stats.vanStockValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </Text>
            </View>
          </View>

          {/* Van Stock Items List - Scrollable Box */}
          {vanStocks.length > 0 ? (
            <ScrollView
              style={{ maxHeight: 280 }}
              nestedScrollEnabled={true}
              showsVerticalScrollIndicator={true}
              className="mt-1 pr-1"
            >
              {vanStocks.map(stock => {
                const stockQtyInfo = formatStockQty(stock);
                const totalUnits = Number(stock.total_qty) || 0;
                const itemsPerPkg = Number(stock.items_per_package) || 1;
                const unitPrice = Number(stock.unit_price || stock.unit_cost || 0);
                const itemValuation = totalUnits * unitPrice;
                const isOutOfStock = totalUnits <= 0;

                // Loaded quantity reference
                const loadedUnits = Number(stock.loaded_qty) || (Number(stock.package_qty) * itemsPerPkg) || totalUnits;
                const soldUnits = Math.max(0, loadedUnits - totalUnits);

                return (
                  <View
                    key={stock.allocation_id}
                    style={{
                      backgroundColor: isOutOfStock ? '#fef2f2' : '#f8fafc',
                      borderColor: isOutOfStock ? '#f87171' : '#e2e8f0',
                      borderWidth: 1.5,
                    }}
                    className="rounded-2xl p-3 mb-2"
                  >
                    <View className="flex-row justify-between items-start">
                      <View className="flex-1 pr-2">
                        <View className="flex-row items-center gap-1.5 flex-wrap">
                          <Text className={`text-xs font-bold leading-tight ${isOutOfStock ? 'text-red-900' : 'text-slate-800'}`}>
                            {stock.product_name}
                          </Text>
                          {stock.category_name ? (
                            <View className="bg-blue-100 px-1.5 py-0.5 rounded-md">
                              <Text className="text-[9px] font-bold text-blue-700 leading-tight">
                                {stock.category_name}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                          SKU: <Text className="font-semibold text-slate-700">{stock.product_sku || 'N/A'}</Text>
                          {stock.batch_no ? ` • ${stock.batch_no}` : ''}
                        </Text>
                      </View>

                      <View className="items-end">
                        {isOutOfStock ? (
                          <View className="bg-red-100 border border-red-300 px-2 py-0.5 rounded-full flex-row items-center gap-1">
                            <MaterialIcons name="error-outline" size={11} color="#b91c1c" />
                            <Text className="text-[11px] font-bold text-red-800 leading-tight">
                              0 Units Available
                            </Text>
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
                          ₹{unitPrice.toFixed(2)}/unit • ₹{itemValuation.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </Text>
                      </View>
                    </View>

                    {/* Accurate Packaging & Tracking Breakdown */}
                    <View className="mt-2 pt-1.5 border-t border-slate-200/60 flex-row justify-between items-center">
                      <View className="flex-row items-center gap-1.5">
                        <MaterialIcons name="all-inbox" size={12} color="#64748b" />
                        <Text className="text-[11px] text-slate-600 leading-tight">
                          Pack: <Text className="font-bold text-slate-800">{stockQtyInfo.packBreakdown}</Text>
                        </Text>
                      </View>

                      {loadedUnits > totalUnits && (
                        <View className="flex-row items-center gap-1">
                          <Text className="text-[10px] text-slate-400 font-medium leading-tight">
                            Loaded: {loadedUnits} •
                          </Text>
                          <Text className="text-[10px] text-amber-700 font-bold leading-tight">
                            Sold: {soldUnits}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <View className="bg-amber-50 border border-amber-200/60 rounded-2xl p-4 items-center">
              <MaterialIcons name="info-outline" size={24} color="#d97706" />
              <Text className="text-xs font-bold text-amber-800 mt-1.5 text-center">
                No Van Stock Loaded Locally
              </Text>
              <Text className="text-[11px] text-amber-700 mt-1 text-center">
                Tap 'Sync' to refresh your assigned van inventory from the server.
              </Text>
            </View>
          )}
        </View>

        {/* 3. Today's Route Performance */}
        <Text className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5 ml-1">
          Today's Field Performance
        </Text>

        {/* Row 1: Direct Van Sales vs Advance Orders */}
        <View className="flex-row gap-3 mb-3">
          {/* Direct Van Sales */}
          <TouchableOpacity
            onPress={() => router.push('/sales')}
            className="flex-1 bg-white rounded-2xl p-3.5 shadow-sm border border-emerald-100"
            activeOpacity={0.8}
          >
            <View className="flex-row items-center justify-between mb-2">
              <View className="w-8 h-8 rounded-xl bg-emerald-50 items-center justify-center">
                <MaterialIcons name="point-of-sale" size={17} color="#059669" />
              </View>
              <View className="bg-emerald-100 px-2 py-0.5 rounded-full">
                <Text className="text-[10px] font-bold text-emerald-800">
                  {stats.directSalesCount || 0} Sales
                </Text>
              </View>
            </View>
            <Text className="text-base font-bold text-slate-800 leading-tight" numberOfLines={1} adjustsFontSizeToFit>
              ₹{(stats.directSalesAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </Text>
            <Text className="text-xs text-slate-600 font-bold mt-1">Direct Van Sales</Text>
            <Text className="text-[10px] text-emerald-600 font-medium mt-0.5">Spot delivered from van</Text>
          </TouchableOpacity>

          {/* Booked Advance Orders */}
          <TouchableOpacity
            onPress={() => router.push('/sales')}
            className="flex-1 bg-white rounded-2xl p-3.5 shadow-sm border border-blue-100"
            activeOpacity={0.8}
          >
            <View className="flex-row items-center justify-between mb-2">
              <View className="w-8 h-8 rounded-xl bg-blue-50 items-center justify-center">
                <MaterialIcons name="add-shopping-cart" size={17} color="#2563eb" />
              </View>
              <View className="bg-blue-100 px-2 py-0.5 rounded-full">
                <Text className="text-[10px] font-bold text-blue-800">
                  {stats.ordersCount || 0} Orders
                </Text>
              </View>
            </View>
            <Text className="text-base font-bold text-slate-800 leading-tight" numberOfLines={1} adjustsFontSizeToFit>
              ₹{(stats.ordersAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </Text>
            <Text className="text-xs text-slate-600 font-bold mt-1">Booked Orders</Text>
            <Text className="text-[10px] text-blue-600 font-medium mt-0.5">Subsequent delivery</Text>
          </TouchableOpacity>
        </View>

        {/* Row 2: Cash in Hand vs Customer Credit */}
        <View className="flex-row gap-3 mb-5">
          {/* Net Cash in Hand (Deducting Expenses) */}
          <TouchableOpacity
            onPress={() => router.push('/expenses')}
            className="flex-1 bg-white rounded-2xl p-3.5 shadow-sm border border-slate-100"
            activeOpacity={0.8}
          >
            <View className="flex-row items-center justify-between mb-1.5">
              <View className="flex-row items-center gap-1.5">
                <MaterialIcons name="account-balance-wallet" size={14} color="#059669" />
                <Text className="text-[10px] text-slate-400 font-bold uppercase">Cash in Hand</Text>
              </View>
              {(stats.totalExpenses || 0) > 0 ? (
                <View className="bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200/50">
                  <Text className="text-[9px] font-bold text-rose-600">-₹{(stats.totalExpenses || 0).toLocaleString('en-IN')}</Text>
                </View>
              ) : null}
            </View>
            <Text className="text-base font-bold text-emerald-600 leading-tight" numberOfLines={1} adjustsFontSizeToFit>
              ₹{((stats.netInHandCash != null ? stats.netInHandCash : stats.totalCashCollected) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </Text>
            <Text className="text-[10px] text-slate-500 mt-1 font-medium">Net of expenses • Tap to manage</Text>
          </TouchableOpacity>

          {/* Pending Credit / Balance */}
          <TouchableOpacity
            onPress={() => router.push('/sales')}
            className="flex-1 bg-white rounded-2xl p-3.5 shadow-sm border border-slate-100"
            activeOpacity={0.8}
          >
            <View className="flex-row items-center gap-1.5 mb-1.5">
              <MaterialIcons name="pending-actions" size={14} color="#e11d48" />
              <Text className="text-[10px] text-slate-400 font-bold uppercase">Customer Credit</Text>
            </View>
            <Text className="text-base font-bold text-rose-600 leading-tight" numberOfLines={1} adjustsFontSizeToFit>
              ₹{(stats.pendingPayments || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </Text>
            <Text className="text-[10px] text-rose-500 mt-1 font-medium">Uncollected balance</Text>
          </TouchableOpacity>
        </View>

        {/* Trade Schemes & Promotional Offers Card */}
        <TouchableOpacity
          onPress={() => router.push('/schemes')}
          className="bg-white rounded-2xl p-3.5 mb-3 shadow-sm border border-indigo-200 flex-row items-center justify-between active:bg-indigo-50/60"
          activeOpacity={0.8}
        >
          <View className="flex-row items-center gap-3 flex-1 mr-2">
            <View className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 items-center justify-center">
              <MaterialIcons name="local-offer" size={22} color="#4f46e5" />
            </View>
            <View className="flex-1">
              <Text className="text-xs font-bold text-slate-800">Trade Schemes & Offers</Text>
              <Text className="text-[10px] text-slate-500">View active BOGO deals, free rewards & discounts</Text>
            </View>
          </View>
          <View className="flex-row items-center gap-1 bg-indigo-600 px-3 py-1.5 rounded-xl shadow-xs">
            <MaterialIcons name="card-giftcard" size={14} color="#ffffff" />
            <Text className="text-[10px] font-bold text-white">View Offers</Text>
          </View>
        </TouchableOpacity>

        {/* End of Sale Submit Menu */}
        <TouchableOpacity
          onPress={handleInitiateEndOfSale}
          className="bg-white rounded-2xl p-3.5 mb-3 shadow-sm border border-rose-200 flex-row items-center justify-between active:bg-rose-50/60"
          activeOpacity={0.8}
        >
          <View className="flex-row items-center gap-3 flex-1 mr-2">
            <View className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-100 items-center justify-center">
              <MaterialIcons name="exit-to-app" size={22} color="#e11d48" />
            </View>
            <View className="flex-1">
              <Text className="text-xs font-bold text-slate-800">End of Sale Submit</Text>
              <Text className="text-[10px] text-slate-500">Transfer all stocks to Warehouse & exit sale</Text>
            </View>
          </View>
          <View className="flex-row items-center gap-1 bg-rose-600 px-3 py-1.5 rounded-xl shadow-xs">
            <MaterialIcons name="assignment-turned-in" size={14} color="#ffffff" />
            <Text className="text-[10px] font-bold text-white">End Sale</Text>
          </View>
        </TouchableOpacity>


        {/* Offline sync banner */}
        <View className="bg-slate-100 rounded-2xl p-3 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <MaterialIcons name="cloud-done" size={16} color="#64748b" />
            <Text className="text-xs text-slate-600">
              {stats.pendingSyncCount > 0
                ? `${stats.pendingSyncCount} changes waiting to upload`
                : 'Offline SQLite active • Database synchronized'}
            </Text>
          </View>
        </View>
      </View>

      {/* Reverse Password Confirmation Modal */}
      <Modal
        visible={showPasswordModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isSubmittingEndOfSale) setShowPasswordModal(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 }}
        >
          <View style={{ backgroundColor: '#ffffff', width: '100%', maxWidth: 360, borderRadius: 24, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 20, elevation: 15 }}>
            {/* Modal Icon & Header */}
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: '#ffe4e6', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                <MaterialIcons name="lock-reset" size={28} color="#e11d48" />
              </View>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f172a', textAlign: 'center' }}>
                End of Sale Confirmation
              </Text>
              <Text style={{ fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: 4 }}>
                Please enter your account password in reverse order to authorize return of stocks and exit.
              </Text>
            </View>

            {/* Warehouse Stock Transfer Warning Card */}
            <View style={{ backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fef3c7', borderRadius: 12, padding: 10, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <MaterialIcons name="warehouse" size={20} color="#d97706" />
              <Text style={{ fontSize: 11, color: '#92400e', fontWeight: '600', flex: 1, lineHeight: 16 }}>
                All remaining van stocks will be transferred to Warehouse immediately.
              </Text>
            </View>

            {/* Password in Reverse Input */}
            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Password in Reverse *
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: passwordError ? '#f87171' : '#cbd5e1', borderRadius: 12, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 6, backgroundColor: '#f8fafc' }}>
                <MaterialIcons name="vpn-key" size={18} color="#94a3b8" />
                <TextInput
                  value={reversePasswordInput}
                  onChangeText={(val) => {
                    setReversePasswordInput(val);
                    setPasswordError('');
                  }}
                  placeholder="Type password backwards..."
                  placeholderTextColor="#94a3b8"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ flex: 1, marginLeft: 8, fontSize: 14, color: '#1e293b' }}
                  editable={!isSubmittingEndOfSale}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <MaterialIcons
                    name={showPassword ? 'visibility-off' : 'visibility'}
                    size={20}
                    color="#64748b"
                  />
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 10, color: '#64748b', marginTop: 5, fontStyle: 'italic' }}>
                Example: If your password is "12345678", enter "87654321"
              </Text>
            </View>

            {/* Error Message */}
            {passwordError ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 10, padding: 8, marginBottom: 12 }}>
                <MaterialIcons name="error-outline" size={16} color="#dc2626" />
                <Text style={{ fontSize: 11, color: '#b91c1c', fontWeight: '500', flex: 1 }}>
                  {passwordError}
                </Text>
              </View>
            ) : null}

            {/* Modal Buttons */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                onPress={() => {
                  setShowPasswordModal(false);
                  setReversePasswordInput('');
                  setPasswordError('');
                }}
                disabled={isSubmittingEndOfSale}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#64748b' }}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSubmitEndOfSale}
                disabled={isSubmittingEndOfSale || !reversePasswordInput.trim()}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 6,
                  backgroundColor: (isSubmittingEndOfSale || !reversePasswordInput.trim()) ? '#fda4af' : '#e11d48',
                  shadowColor: '#e11d48',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.25,
                  shadowRadius: 4,
                  elevation: 3
                }}
              >
                {isSubmittingEndOfSale ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <MaterialIcons name="check-circle" size={16} color="#ffffff" />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#ffffff' }}>Confirm & Exit</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </ScrollView>
  );
}
