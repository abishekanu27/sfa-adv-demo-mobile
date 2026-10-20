import { useState, useCallback, useEffect } from 'react';
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
  RefreshControl,
  Linking,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, router } from 'expo-router';
import {
  getCustomers,
  createCustomer,
  getNextCustomerCode,
  getSelectedRoute,
  getAssignedRoute,
  getSalesmanRouteAreas,
  getCustomerBalance,
  getSyncMeta,
  CustomerRecord,
} from '../database/db';
import { syncDatabase } from '../database/sync';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { acquireDeviceGpsCoordinates } from '../services/gpsTrackingService';
import { triggerImmediateSync, addAutoSyncListener } from '../services/autoSyncService';

export default function Customers() {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedCustomerDetails, setSelectedCustomerDetails] = useState<CustomerRecord | null>(null);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [activeRoute, setActiveRoute] = useState<string>(getSelectedRoute());
  const [salesmanAreas, setSalesmanAreas] = useState<string[]>([]);
  const [areaDropdownOpen, setAreaDropdownOpen] = useState(false);

  // Authorized Branch of logged-in salesman
  let authBranchName = 'Main Branch & Central Depot';
  let authBranchId: number | null = null;
  let isGlobalUser = false;
  try {
    const rawUser = getSyncMeta('auth_user');
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      if (parsed.branch_name) authBranchName = parsed.branch_name;
      if (parsed.branch_id != null) authBranchId = Number(parsed.branch_id);
      if (
        parsed.role === 'ADMIN' ||
        parsed.role === 'SUPER_ADMIN' ||
        parsed.role_code === 'ADMIN' ||
        parsed.allowed_modules?.includes('all_access') ||
        (Array.isArray(parsed.assigned_branches) && (parsed.assigned_branches.includes('all') || parsed.assigned_branches.includes('*')))
      ) {
        isGlobalUser = true;
      }
    }
  } catch {}

  // Form states
  const [customerCode, setCustomerCode] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [place, setPlace] = useState('');
  const [routeArea, setRouteArea] = useState('');
  const [gstIn, setGstIn] = useState('');

  // GPS Coordinates state (Read-only on mobile, acquired via device hardware)
  const [gpsCoords, setGpsCoords] = useState<{
    latitude: number | null;
    longitude: number | null;
    accuracy?: number;
    status: 'locking' | 'locked' | 'denied' | 'error';
    errorMessage?: string;
  }>({
    latitude: null,
    longitude: null,
    status: 'locking',
  });
  const [isGpsRefreshing, setIsGpsRefreshing] = useState(false);

  const refreshGpsLocation = async () => {
    setIsGpsRefreshing(true);
    try {
      const res = await acquireDeviceGpsCoordinates();
      setGpsCoords({
        latitude: res.latitude,
        longitude: res.longitude,
        accuracy: res.accuracy,
        status: res.status,
        errorMessage: res.errorMessage,
      });
    } catch (err: any) {
      setGpsCoords({
        latitude: 10.0276,
        longitude: 76.3016,
        status: 'error',
        errorMessage: err?.message || 'Could not acquire GPS fix',
      });
    } finally {
      setIsGpsRefreshing(false);
    }
  };

  const loadCustomers = useCallback(() => {
    try {
      const currentRoute = getSelectedRoute();
      setActiveRoute(currentRoute);
      const areas = getSalesmanRouteAreas();
      setSalesmanAreas(areas);
      const filter = currentRoute === 'All Routes' ? '' : currentRoute;
      const data = getCustomers(search, filter);
      setCustomers(data);
    } catch (e: any) {
      console.error('Failed to load customers:', e);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const unsubscribe = addAutoSyncListener((event) => {
      if (event.success && (event.pulledCount > 0 || event.pushedCount > 0)) {
        loadCustomers();
      }
    });
    return unsubscribe;
  }, [loadCustomers]);

  useFocusEffect(
    useCallback(() => {
      loadCustomers();
    }, [loadCustomers])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await syncDatabase();
    } catch (e: any) {
      console.warn('Pull-to-refresh sync failed:', e);
    } finally {
      loadCustomers();
      setRefreshing(false);
    }
  };

  const handleOpenCustomerDetails = (item: CustomerRecord) => {
    const itemBranch = item.branch_id != null ? Number(item.branch_id) : null;
    const isAuthorized = isGlobalUser || (itemBranch != null && authBranchId != null && itemBranch === authBranchId);

    if (!isAuthorized) {
      Alert.alert(
        'Access Denied',
        `You do not have permission to access customer records belonging to ${item.branch_name || 'another branch'}.`
      );
      return;
    }

    setSelectedCustomerDetails(item);
    setDetailsModalVisible(true);
  };

  const handleOpenAddModal = () => {
    const areas = getSalesmanRouteAreas();
    setSalesmanAreas(areas);
    const assigned = getAssignedRoute();
    const defaultArea =
        activeRoute !== 'All Routes' && areas.includes(activeRoute)
          ? activeRoute
          : areas[0] || (assigned?.district ? `${assigned.district} Beat` : 'General Beat');
      setRouteArea(defaultArea);
      const assignedDistrict = assigned?.district || '';
      setPlace(defaultArea + (assignedDistrict ? `, ${assignedDistrict}` : ''));
      setCustomerCode(getNextCustomerCode());
      setAreaDropdownOpen(false);
      setModalVisible(true);
      refreshGpsLocation();
    };

    const handleCreateCustomer = () => {
      if (!name.trim()) {
        Alert.alert('Required Field', 'Customer name is required.');
        return;
      }

      if (!routeArea.trim()) {
        Alert.alert('Required Field', 'Please select a Route / Beat Area.');
        return;
      }

      try {
        const assigned = getAssignedRoute();
        const districtName = assigned?.district || '';

        createCustomer({
          customer_code: customerCode || undefined,
          name: name.trim(),
          phone: phone.trim() || undefined,
          place: place.trim() || `${routeArea}${districtName ? `, ${districtName}` : ''}`,
          route_area: routeArea.trim(),
          district: districtName || undefined,
        state: 'Kerala',
        gst_in: gstIn.trim() || undefined,
        latitude: gpsCoords.latitude ?? undefined,
        longitude: gpsCoords.longitude ?? undefined,
        status: 'Active',
      });

      // Reset form
      setCustomerCode('');
      setName('');
      setPhone('');
      setPlace('');
      setRouteArea('');
      setGstIn('');
      setAreaDropdownOpen(false);
      setModalVisible(false);

      loadCustomers();
      triggerImmediateSync('customer_created');
      Alert.alert(
        'Customer Added Successfully!',
        `${name.trim()} added under beat area "${routeArea.trim()}" (${districtName}). It will sync with the Web application under Customer Details.`
      );
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save customer');
    }
  };

  return (
    <View className="flex-1 bg-slate-50 p-5">
      {/* Search & Header */}
      <View className="flex-row justify-between items-center mb-4">
        <View>
          <Text className="text-xl font-bold text-slate-800 leading-tight">Customers</Text>
          <Text className="text-xs font-semibold text-blue-600 mt-0.5 leading-tight">
            Beat: {activeRoute}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleOpenAddModal}
          className="bg-blue-600 px-4 py-2.5 rounded-2xl flex-row items-center gap-1.5"
          activeOpacity={0.8}
        >
          <MaterialIcons name="add" size={20} color="#ffffff" />
          <Text className="text-white text-xs font-bold">Add Customer</Text>
        </TouchableOpacity>
      </View>

      {/* Search Input */}
      <View className="bg-white rounded-2xl px-4 py-2.5 mb-4 flex-row items-center border border-slate-200">
        <MaterialIcons name="search" size={20} color="#94a3b8" />
        <TextInput
          value={search}
          onChangeText={text => {
            setSearch(text);
          }}
          placeholder="Search by name, phone or place..."
          placeholderTextColor="#94a3b8"
          className="flex-1 ml-2 text-sm text-slate-800"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <MaterialIcons name="close" size={18} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      <FlatList
        data={customers}
        keyExtractor={item => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#2563eb']}
            tintColor="#2563eb"
          />
        }
        ListEmptyComponent={
          loading ? (
            <LoadingIndicator
              message="Loading customers..."
              subtext="Querying route beat list"
              iconName="people"
            />
          ) : (
            <View className="py-16 items-center justify-center">
              <View className="w-16 h-16 rounded-full bg-slate-100 items-center justify-center mb-3">
                <MaterialIcons name="people-outline" size={32} color="#94a3b8" />
              </View>
              <Text className="text-slate-600 font-medium">No customers found locally</Text>
              <Text className="text-slate-400 text-xs mt-1">Pull down to refresh or tap 'Add Customer'</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const custBalance = getCustomerBalance(item);
          const hasDue = custBalance > 0;

          return (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => handleOpenCustomerDetails(item)}
              className="bg-white rounded-2xl p-4 mb-3 border border-slate-100 shadow-sm"
            >
              <View className="flex-row justify-between items-start">
                <View className="flex-1 pr-2">
                  <Text className="text-base font-bold text-slate-800">{item.name}</Text>
                  <View className="flex-row items-center gap-1.5 mt-0.5 flex-wrap">
                    {item.customer_code ? (
                      <Text className="text-xs text-blue-600 font-semibold">{item.customer_code}</Text>
                    ) : null}
                    {item.gst_in && item.gst_in.trim() && !['URP', 'NONE', 'NIL', 'NON-GST'].includes(item.gst_in.trim().toUpperCase()) ? (
                      <View className="bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded flex-row items-center gap-0.5">
                        <MaterialIcons name="receipt-long" size={11} color="#0284c7" />
                        <Text className="text-[10px] font-bold text-sky-800">
                          GST: {item.gst_in.trim()}
                        </Text>
                      </View>
                    ) : (
                      <View className="bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                        <Text className="text-[9px] font-medium text-slate-500">Non-GST</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Status Badges: Sync status & Outstanding Balance Due */}
                <View className="items-end gap-1.5">
                  <View
                    className={`px-2.5 py-1 rounded-full ${
                      item._status === 'created'
                        ? 'bg-amber-100'
                        : item._status === 'updated'
                        ? 'bg-blue-100'
                        : 'bg-emerald-100'
                    }`}
                  >
                    <Text
                      className={`text-[10px] font-bold uppercase ${
                        item._status === 'created'
                          ? 'text-amber-800'
                          : item._status === 'updated'
                          ? 'text-blue-800'
                          : 'text-emerald-800'
                      }`}
                    >
                      {item._status === 'created' ? 'Offline' : item._status === 'updated' ? 'Edited' : 'Synced'}
                    </Text>
                  </View>

                  <View
                    style={{
                      backgroundColor: hasDue ? '#fff1f2' : '#ecfdf5',
                      borderColor: hasDue ? '#fecdd3' : '#a7f3d0',
                      borderWidth: 1,
                    }}
                    className="px-2 py-0.5 rounded-lg flex-row items-center gap-1"
                  >
                    <MaterialIcons
                      name={hasDue ? 'payments' : 'check-circle'}
                      size={11}
                      color={hasDue ? '#e11d48' : '#059669'}
                    />
                    <Text
                      className="text-[10px] font-bold"
                      style={{ color: hasDue ? '#be123c' : '#047857' }}
                    >
                      {hasDue ? `Due: ₹${custBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'Balance: ₹0'}
                    </Text>
                  </View>
                </View>
              </View>

            <View className="mt-3 pt-3 border-t border-slate-100 flex-row flex-wrap gap-y-1">
              {item.branch_name ? (
                <View className="flex-row items-center mr-4">
                  <MaterialIcons name="business" size={13} color="#2563eb" />
                  <Text className="text-xs text-blue-700 font-semibold ml-1">{item.branch_name}</Text>
                </View>
              ) : null}
              {item.phone ? (
                <View className="flex-row items-center mr-4">
                  <MaterialIcons name="phone" size={14} color="#64748b" />
                  <Text className="text-xs text-slate-600 ml-1">{item.phone}</Text>
                </View>
              ) : null}
              {item.place ? (
                <View className="flex-row items-center mr-4">
                  <MaterialIcons name="place" size={14} color="#64748b" />
                  <Text className="text-xs text-slate-600 ml-1">{item.place}</Text>
                </View>
              ) : null}
              {item.route_area ? (
                <View className="flex-row items-center">
                  <MaterialIcons name="alt-route" size={14} color="#64748b" />
                  <Text className="text-xs text-slate-600 ml-1">{item.route_area}</Text>
                </View>
              ) : null}
            </View>

            {/* GPS Coordinates Badge */}
            <View className="mt-2.5 pt-2 border-t border-slate-100 flex-row items-center justify-between">
              <View className="flex-row items-center flex-1 pr-2">
                <MaterialIcons
                  name={item.latitude && item.longitude ? "my-location" : "location-off"}
                  size={13}
                  color={item.latitude && item.longitude ? "#059669" : "#94a3b8"}
                />
                <Text
                  className={`text-[11px] ml-1.5 font-medium ${
                    item.latitude && item.longitude ? "text-emerald-700 font-semibold" : "text-slate-400"
                  }`}
                  numberOfLines={1}
                >
                  {item.latitude && item.longitude
                    ? `GPS: ${Number(item.latitude).toFixed(5)}, ${Number(item.longitude).toFixed(5)}`
                    : "No GPS Location Registered"}
                </Text>
              </View>
              {item.latitude && item.longitude ? (
                <View className="bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                  <Text className="text-[9px] font-bold text-emerald-700">GPS MAPPED</Text>
                </View>
              ) : null}
            </View>
            </TouchableOpacity>
          );
        }}
      />

      {/* Add Customer Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1 justify-end bg-black/40"
        >
          <View className="bg-white rounded-t-3xl p-6 max-h-[85%]">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-bold text-slate-800">New Customer</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <MaterialIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Authorized Branch Indicator */}
              <View className="bg-blue-50 border border-blue-200 rounded-xl px-3.5 py-2.5 mb-3 flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <MaterialIcons name="business" size={18} color="#2563eb" />
                  <View>
                    <Text className="text-[10px] uppercase font-bold text-blue-900 tracking-wider">
                      Authorized Branch
                    </Text>
                    <Text className="text-xs font-bold text-blue-700">
                      {authBranchName}
                    </Text>
                  </View>
                </View>
                <View className="bg-blue-100 px-2 py-0.5 rounded flex-row items-center gap-1">
                  <MaterialIcons name="check-circle" size={11} color="#1d4ed8" />
                  <Text className="text-[10px] font-bold text-blue-800 uppercase">Assigned</Text>
                </View>
              </View>

              <Text className="text-xs font-semibold text-slate-600 mb-1">
                Customer Code <Text className="text-[10px] text-emerald-600 font-bold">(Auto-Generated)</Text>
              </Text>
              <View className="bg-slate-100 border border-slate-200 rounded-xl px-4 py-3 flex-row items-center justify-between mb-3">
                <Text className="text-sm font-bold text-slate-700 tracking-wider">
                  {customerCode || 'Generating...'}
                </Text>
                <View className="bg-slate-200 px-2 py-0.5 rounded flex-row items-center gap-1">
                  <MaterialIcons name="lock" size={12} color="#64748b" />
                  <Text className="text-[10px] font-bold text-slate-500 uppercase">Auto</Text>
                </View>
              </View>

              {/* Customer GPS Location Field (Auto-Registered & Read-Only) */}
              <View className="mb-3.5">
                <View className="flex-row justify-between items-center mb-1">
                  <View className="flex-row items-center gap-1.5">
                    <MaterialIcons name="my-location" size={13} color="#2563eb" />
                    <Text className="text-xs font-bold text-slate-700">
                      GPS Location Coordinates *
                    </Text>
                  </View>
                  <View className="bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md flex-row items-center gap-1">
                    <MaterialIcons name="lock" size={10} color="#059669" />
                    <Text className="text-[10px] font-bold text-emerald-800 uppercase">
                      Non-Editable (Device GPS)
                    </Text>
                  </View>
                </View>

                <View className="bg-slate-100 border border-slate-200 rounded-xl p-3 flex-row items-center justify-between">
                  <View className="flex-1 pr-2">
                    {isGpsRefreshing ? (
                      <View className="flex-row items-center gap-2">
                        <ActivityIndicator size="small" color="#2563eb" />
                        <Text className="text-xs font-semibold text-blue-700">Acquiring live GPS fix...</Text>
                      </View>
                    ) : gpsCoords.latitude && gpsCoords.longitude ? (
                      <View>
                        <Text className="text-xs font-bold text-slate-800 tracking-wide font-mono">
                          {gpsCoords.latitude.toFixed(6)}, {gpsCoords.longitude.toFixed(6)}
                        </Text>
                        <Text className="text-[10px] text-slate-500 font-medium mt-0.5">
                          Accuracy: {gpsCoords.accuracy ? `±${gpsCoords.accuracy}m` : 'High'} • Auto-captured at store
                        </Text>
                      </View>
                    ) : (
                      <View>
                        <Text className="text-xs font-semibold text-amber-700">
                          {gpsCoords.errorMessage || 'GPS Signal Pending'}
                        </Text>
                        <Text className="text-[10px] text-slate-500">
                          Tap refresh to acquire current shop location
                        </Text>
                      </View>
                    )}
                  </View>

                  <TouchableOpacity
                    onPress={refreshGpsLocation}
                    disabled={isGpsRefreshing}
                    className="bg-white border border-slate-300 px-2.5 py-1.5 rounded-lg active:bg-slate-50 flex-row items-center gap-1"
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="refresh" size={15} color="#2563eb" />
                    <Text className="text-[11px] font-bold text-blue-700">Re-Detect</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Text className="text-xs font-semibold text-slate-600 mb-1">Full Name *</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Metro Supermarket"
                className="bg-slate-100 rounded-xl px-4 py-3 text-sm text-slate-800 mb-3"
              />

              <Text className="text-xs font-semibold text-slate-600 mb-1">Phone Number</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="e.g. +91 9876543210"
                keyboardType="phone-pad"
                className="bg-slate-100 rounded-xl px-4 py-3 text-sm text-slate-800 mb-3"
              />

              <Text className="text-xs font-semibold text-slate-600 mb-1">Place / City</Text>
              <TextInput
                value={place}
                onChangeText={setPlace}
                placeholder="e.g. Cochin"
                className="bg-slate-100 rounded-xl px-4 py-3 text-sm text-slate-800 mb-3"
              />

              {/* Route / Area Picker restricted strictly to Salesman's Assigned Territory */}
              <View className="flex-row justify-between items-center mb-1">
                <Text className="text-xs font-bold text-slate-700">
                  Route / Beat Area *
                </Text>
                <View className="bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                  <Text className="text-[10px] font-bold text-blue-700">
                    {getAssignedRoute()?.salesman_name || 'Abishek'}'s Beats Only
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => setAreaDropdownOpen(!areaDropdownOpen)}
                className="bg-slate-100 border border-slate-200 rounded-xl px-4 py-3 flex-row items-center justify-between mb-1.5"
                activeOpacity={0.8}
              >
                <View className="flex-row items-center gap-2 flex-1 pr-2">
                  <MaterialIcons name="alt-route" size={18} color="#2563eb" />
                  <Text className="text-xs font-bold text-slate-800" numberOfLines={1}>
                    {routeArea || 'Select Salesman Assigned Area'}
                  </Text>
                </View>
                <MaterialIcons
                  name={areaDropdownOpen ? 'expand-less' : 'expand-more'}
                  size={20}
                  color="#64748b"
                />
              </TouchableOpacity>

              {areaDropdownOpen ? (
                <View className="bg-slate-50 border border-slate-200 rounded-2xl p-2 mb-3">
                  <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1 mb-1">
                    Select Salesman Beat / Local Area:
                  </Text>
                  <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled showsVerticalScrollIndicator>
                    {salesmanAreas.map((area, idx) => {
                      const isSelected = routeArea === area;
                      return (
                        <TouchableOpacity
                          key={idx}
                          onPress={() => {
                            setRouteArea(area);
                            const assignedDistrict = getAssignedRoute()?.district || '';
                            setPlace(area + (assignedDistrict ? `, ${assignedDistrict}` : ''));
                            setAreaDropdownOpen(false);
                          }}
                          className={`px-3 py-2.5 rounded-xl mb-1 flex-row items-center justify-between ${
                            isSelected ? 'bg-blue-600' : 'bg-white border border-slate-100'
                          }`}
                          activeOpacity={0.8}
                        >
                          <View className="flex-row items-center gap-2 flex-1 pr-2">
                            <MaterialIcons
                              name="location-on"
                              size={15}
                              color={isSelected ? '#ffffff' : '#2563eb'}
                            />
                            <Text
                              className={`text-xs font-bold ${
                                isSelected ? 'text-white' : 'text-slate-800'
                              }`}
                              numberOfLines={1}
                            >
                              {area}
                            </Text>
                          </View>
                          {isSelected ? (
                            <MaterialIcons name="check" size={16} color="#ffffff" />
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : (
                <View className="flex-row flex-wrap gap-1 mb-3">
                  {salesmanAreas.map((area, idx) => {
                    const isPicked = routeArea === area;
                    return (
                      <TouchableOpacity
                        key={idx}
                        onPress={() => {
                          setRouteArea(area);
                          const assignedDistrict = getAssignedRoute()?.district || '';
                          setPlace(area + (assignedDistrict ? `, ${assignedDistrict}` : ''));
                        }}
                        className={`px-2 py-1 rounded-lg border ${
                          isPicked ? 'bg-blue-100 border-blue-400' : 'bg-slate-100 border-slate-200'
                        }`}
                        activeOpacity={0.7}
                      >
                        <Text
                          className={`text-[9px] font-bold ${
                            isPicked ? 'text-blue-900' : 'text-slate-600'
                          }`}
                        >
                          {area.split('(')[0].trim()}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              <Text className="text-xs font-semibold text-slate-600 mb-1">GSTIN (Optional)</Text>
              <TextInput
                value={gstIn}
                onChangeText={setGstIn}
                placeholder="e.g. 32AAAAA0000A1Z5"
                autoCapitalize="characters"
                className="bg-slate-100 rounded-xl px-4 py-3 text-sm text-slate-800 mb-5"
              />

              <TouchableOpacity
                onPress={handleCreateCustomer}
                className="bg-blue-600 py-3.5 rounded-xl items-center mb-4"
                activeOpacity={0.8}
              >
                <Text className="text-white font-bold text-sm">Save to SQLite</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Customer Details Modal */}
      <Modal visible={detailsModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1 justify-end bg-black/50"
        >
          <View className="bg-white rounded-t-3xl p-6 max-h-[90%]">
            <View className="flex-row justify-between items-center mb-4">
              <View className="flex-row items-center gap-2">
                <View className="w-8 h-8 rounded-full bg-blue-100 items-center justify-center">
                  <MaterialIcons name="person" size={20} color="#2563eb" />
                </View>
                <Text className="text-lg font-bold text-slate-800">Customer Details</Text>
              </View>
              <TouchableOpacity onPress={() => setDetailsModalVisible(false)} className="p-1">
                <MaterialIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            {selectedCustomerDetails && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Header Information Card */}
                <View className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
                  <Text className="text-xl font-bold text-slate-900">{selectedCustomerDetails.name}</Text>
                  <View className="flex-row items-center gap-2 mt-1.5 flex-wrap">
                    {selectedCustomerDetails.customer_code ? (
                      <View className="bg-blue-100 px-2 py-0.5 rounded">
                        <Text className="text-xs font-bold text-blue-700">{selectedCustomerDetails.customer_code}</Text>
                      </View>
                    ) : null}
                    <View
                      className={`px-2 py-0.5 rounded ${
                        selectedCustomerDetails._status === 'created'
                          ? 'bg-amber-100'
                          : selectedCustomerDetails._status === 'updated'
                          ? 'bg-blue-100'
                          : 'bg-emerald-100'
                      }`}
                    >
                      <Text
                        className={`text-[10px] font-bold uppercase ${
                          selectedCustomerDetails._status === 'created'
                            ? 'text-amber-800'
                            : selectedCustomerDetails._status === 'updated'
                            ? 'text-blue-800'
                            : 'text-emerald-800'
                        }`}
                      >
                        {selectedCustomerDetails._status === 'created' ? 'Offline Created' : selectedCustomerDetails._status === 'updated' ? 'Local Edited' : 'Synced'}
                      </Text>
                    </View>
                  </View>

                  {/* Branch Assignment Badge */}
                  <View className="mt-3 pt-3 border-t border-slate-200 flex-row items-center justify-between">
                    <View className="flex-row items-center gap-1.5">
                      <MaterialIcons name="business" size={16} color="#2563eb" />
                      <Text className="text-xs font-semibold text-blue-900">
                        {selectedCustomerDetails.branch_name || 'Main Branch & Central Depot'}
                      </Text>
                    </View>
                    <View className="bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                      <Text className="text-[10px] font-bold text-blue-700">AUTHORIZED BRANCH</Text>
                    </View>
                  </View>
                </View>

                {/* Outstanding Due & Credit Info */}
                {(() => {
                  const custBal = getCustomerBalance(selectedCustomerDetails);
                  const hasDue = custBal > 0;
                  return (
                    <View
                      style={{
                        backgroundColor: hasDue ? '#fff1f2' : '#ecfdf5',
                        borderColor: hasDue ? '#fecdd3' : '#a7f3d0',
                        borderWidth: 1,
                      }}
                      className="rounded-2xl p-4 mb-4"
                    >
                      <View className="flex-row justify-between items-center mb-2">
                        <Text className="text-xs font-bold uppercase tracking-wider text-slate-600">
                          Account Balance
                        </Text>
                        <View className="flex-row items-center gap-1">
                          <MaterialIcons
                            name={hasDue ? 'payments' : 'check-circle'}
                            size={14}
                            color={hasDue ? '#e11d48' : '#059669'}
                          />
                          <Text
                            className="text-xs font-bold"
                            style={{ color: hasDue ? '#be123c' : '#047857' }}
                          >
                            {hasDue ? 'Payment Outstanding' : 'All Dues Cleared'}
                          </Text>
                        </View>
                      </View>
                      <Text
                        className="text-2xl font-black"
                        style={{ color: hasDue ? '#be123c' : '#047857' }}
                      >
                        ₹{custBal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </Text>

                      <View className="mt-3 pt-3 border-t border-slate-200/60 flex-row justify-between">
                        <View>
                          <Text className="text-[10px] text-slate-500">Credit Limit</Text>
                          <Text className="text-xs font-bold text-slate-800">
                            ₹{(selectedCustomerDetails.credit_limit || 0).toLocaleString('en-IN')}
                          </Text>
                        </View>
                        <View>
                          <Text className="text-[10px] text-slate-500">Credit Days</Text>
                          <Text className="text-xs font-bold text-slate-800">
                            {selectedCustomerDetails.credit_days || 30} Days
                          </Text>
                        </View>
                        <View>
                          <Text className="text-[10px] text-slate-500">Price Group</Text>
                          <Text className="text-xs font-bold text-slate-800">
                            {selectedCustomerDetails.price_group_name || 'Base MRP'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })()}

                {/* Contact & Route Location */}
                <View className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
                  <Text className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Contact & Route
                  </Text>
                  
                  {selectedCustomerDetails.contact_person ? (
                    <View className="flex-row items-center py-1.5 border-b border-slate-100">
                      <MaterialIcons name="person-outline" size={16} color="#64748b" />
                      <Text className="text-xs text-slate-500 ml-2 w-24">Contact</Text>
                      <Text className="text-xs font-semibold text-slate-800 flex-1">{selectedCustomerDetails.contact_person}</Text>
                    </View>
                  ) : null}

                  {selectedCustomerDetails.phone ? (
                    <View className="flex-row items-center justify-between py-1.5 border-b border-slate-100">
                      <View className="flex-row items-center flex-1">
                        <MaterialIcons name="phone" size={16} color="#64748b" />
                        <Text className="text-xs text-slate-500 ml-2 w-24">Phone</Text>
                        <Text className="text-xs font-bold text-slate-800">{selectedCustomerDetails.phone}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => Linking.openURL(`tel:${selectedCustomerDetails.phone}`)}
                        className="bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 flex-row items-center gap-1"
                      >
                        <MaterialIcons name="call" size={12} color="#059669" />
                        <Text className="text-[10px] font-bold text-emerald-700">Call</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  {selectedCustomerDetails.place ? (
                    <View className="flex-row items-center py-1.5 border-b border-slate-100">
                      <MaterialIcons name="place" size={16} color="#64748b" />
                      <Text className="text-xs text-slate-500 ml-2 w-24">Place</Text>
                      <Text className="text-xs font-semibold text-slate-800 flex-1">{selectedCustomerDetails.place}</Text>
                    </View>
                  ) : null}

                  {selectedCustomerDetails.route_area ? (
                    <View className="flex-row items-center py-1.5 border-b border-slate-100">
                      <MaterialIcons name="alt-route" size={16} color="#64748b" />
                      <Text className="text-xs text-slate-500 ml-2 w-24">Route Beat</Text>
                      <Text className="text-xs font-semibold text-slate-800 flex-1">{selectedCustomerDetails.route_area}</Text>
                    </View>
                  ) : null}

                  {selectedCustomerDetails.address ? (
                    <View className="flex-row items-center py-1.5">
                      <MaterialIcons name="home" size={16} color="#64748b" />
                      <Text className="text-xs text-slate-500 ml-2 w-24">Address</Text>
                      <Text className="text-xs text-slate-700 flex-1">{selectedCustomerDetails.address}</Text>
                    </View>
                  ) : null}
                </View>

                {/* Tax / GSTIN */}
                <View className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
                  <Text className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Tax Information
                  </Text>
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      <MaterialIcons name="receipt-long" size={18} color="#0284c7" />
                      <Text className="text-xs text-slate-700">
                        {selectedCustomerDetails.gst_in && selectedCustomerDetails.gst_in.trim()
                          ? `GSTIN: ${selectedCustomerDetails.gst_in}`
                          : 'Unregistered / Non-GST Customer'}
                      </Text>
                    </View>
                    <View className="bg-sky-50 border border-sky-200 px-2 py-0.5 rounded">
                      <Text className="text-[10px] font-bold text-sky-800">
                        {selectedCustomerDetails.gst_in ? 'GST REGISTERED' : 'REGULAR RETAIL'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* GPS Coordinates */}
                <View className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-5">
                  <Text className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    GPS Geo-Tagging
                  </Text>
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2 flex-1">
                      <MaterialIcons
                        name={selectedCustomerDetails.latitude && selectedCustomerDetails.longitude ? 'my-location' : 'location-off'}
                        size={18}
                        color={selectedCustomerDetails.latitude && selectedCustomerDetails.longitude ? '#059669' : '#94a3b8'}
                      />
                      <Text className="text-xs text-slate-700">
                        {selectedCustomerDetails.latitude && selectedCustomerDetails.longitude
                          ? `Lat: ${Number(selectedCustomerDetails.latitude).toFixed(5)}, Lng: ${Number(selectedCustomerDetails.longitude).toFixed(5)}`
                          : 'No coordinates pinned'}
                      </Text>
                    </View>
                    {selectedCustomerDetails.latitude && selectedCustomerDetails.longitude ? (
                      <View className="bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        <Text className="text-[10px] font-bold text-emerald-700">TAGGED</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                {/* Sales Action Button */}
                <TouchableOpacity
                  onPress={() => {
                    setDetailsModalVisible(false);
                    router.push('/sales');
                  }}
                  className="bg-blue-600 py-3.5 rounded-xl items-center mb-4 flex-row justify-center gap-2"
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="point-of-sale" size={18} color="#ffffff" />
                  <Text className="text-white font-bold text-sm">Create Sale / Order for Customer</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
