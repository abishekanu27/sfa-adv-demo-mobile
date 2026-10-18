import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, router } from 'expo-router';
import { getSchemes, SchemeRecord, getSyncMeta } from '../database/db';
import { syncSchemes } from '../database/sync';

export default function SchemesScreen() {
  const [schemes, setSchemes] = useState<SchemeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<'ALL' | 'PRODUCT_BASED' | 'AMOUNT_BASED'>('ALL');
  const [branchName, setBranchName] = useState<string>('');

  const loadData = useCallback(() => {
    try {
      const data = getSchemes();
      setSchemes(data);
      const bName = getSyncMeta('authorized_branch_name') || 'All Branches';
      setBranchName(bName);
    } catch (e) {
      console.warn('Failed to load local schemes:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
      // Background sync to ensure fresh active schemes
      syncSchemes().then(() => loadData()).catch(() => {});
    }, [loadData])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await syncSchemes();
      loadData();
    } catch (e) {
      console.warn('Refresh schemes failed:', e);
    } finally {
      setRefreshing(false);
    }
  };

  const filteredSchemes = useMemo(() => {
    let result = schemes;

    if (selectedType !== 'ALL') {
      result = result.filter(s => {
        if (selectedType === 'PRODUCT_BASED') {
          return s.scheme_type === 'PRODUCT_BASED' || s.scheme_type === 'BOGO_QTY';
        }
        if (selectedType === 'AMOUNT_BASED') {
          return s.scheme_type === 'AMOUNT_BASED' || s.scheme_type === 'MIN_ORDER_VALUE' || s.scheme_type === 'FLAT_DISCOUNT';
        }
        return true;
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(s =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.scheme_code || '').toLowerCase().includes(q) ||
        (s.trigger_product_name || '').toLowerCase().includes(q) ||
        (s.reward_product_name || '').toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q) ||
        (s.branch_name || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [schemes, selectedType, searchQuery]);

  const stats = useMemo(() => {
    const total = schemes.length;
    const productBased = schemes.filter(s => s.scheme_type === 'PRODUCT_BASED' || s.scheme_type === 'BOGO_QTY').length;
    const amountBased = schemes.filter(s => s.scheme_type === 'AMOUNT_BASED' || s.scheme_type === 'MIN_ORDER_VALUE' || s.scheme_type === 'FLAT_DISCOUNT').length;
    return { total, productBased, amountBased };
  }, [schemes]);

  const renderSchemeCard = ({ item }: { item: SchemeRecord }) => {
    const isProductBased = item.scheme_type === 'PRODUCT_BASED' || item.scheme_type === 'BOGO_QTY';
    const isAmountBased = item.scheme_type === 'AMOUNT_BASED' || item.scheme_type === 'MIN_ORDER_VALUE' || item.scheme_type === 'FLAT_DISCOUNT';
    const isFreeProduct = item.reward_type === 'FREE_PRODUCT';

    const triggerQty = Number(item.trigger_min_qty) || 1;
    const triggerUnit = item.trigger_unit || 'Pcs';
    const triggerProduct = item.trigger_product_name || 'Qualifying Product';

    const minAmount = Number(item.min_order_amount) || 0;
    const rewardQty = Number(item.reward_qty) || 1;
    const rewardUnit = item.reward_unit || 'Pcs';
    const rewardName = item.reward_product_name || (isProductBased ? triggerProduct : 'Retailer Eco Carry Bag');

    const discountType = item.discount_type || 'PERCENTAGE';
    const discountVal = Number(item.discount_value != null ? item.discount_value : (item.discount_percentage || item.discount_amount)) || 0;

    return (
      <View className="bg-white rounded-2xl p-4 mb-3.5 shadow-sm border border-slate-200">
        {/* Top Badges Header */}
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center gap-1.5 flex-wrap flex-1 mr-2">
            <View
              className={`px-2.5 py-1 rounded-full flex-row items-center gap-1 ${
                isProductBased ? 'bg-indigo-50 border border-indigo-200' : 'bg-amber-50 border border-amber-200'
              }`}
            >
              <MaterialIcons
                name={isProductBased ? 'inventory' : 'payments'}
                size={13}
                color={isProductBased ? '#4f46e5' : '#d97706'}
              />
              <Text
                className={`text-[10px] font-bold uppercase tracking-wider ${
                  isProductBased ? 'text-indigo-700' : 'text-amber-800'
                }`}
              >
                {isProductBased ? 'Product-Based Offer' : 'Total Amount Offer'}
              </Text>
            </View>

            <View className="bg-slate-100 px-2 py-0.5 rounded-md">
              <Text className="text-[10px] font-bold text-slate-600">
                {item.scheme_code}
              </Text>
            </View>

            {/* Branch Badge */}
            {item.branch_id ? (
              <View className="bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-md flex-row items-center gap-1">
                <MaterialIcons name="business" size={11} color="#0284c7" />
                <Text className="text-[10px] font-bold text-sky-800">
                  {item.branch_name || `Branch #${item.branch_id}`}
                </Text>
              </View>
            ) : (
              <View className="bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md flex-row items-center gap-1">
                <MaterialIcons name="public" size={11} color="#059669" />
                <Text className="text-[10px] font-bold text-emerald-800">
                  All Branches
                </Text>
              </View>
            )}
          </View>

          <View className="bg-emerald-100 px-2.5 py-0.5 rounded-full flex-row items-center gap-1">
            <View className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
            <Text className="text-[10px] font-bold text-emerald-800">Active</Text>
          </View>
        </View>

        {/* Scheme Name & Description */}
        <Text className="text-base font-bold text-slate-900 leading-snug mb-1">
          {item.name}
        </Text>
        {item.description ? (
          <Text className="text-xs text-slate-500 mb-2 leading-relaxed">
            {item.description}
          </Text>
        ) : null}

        {/* Offer Details Box */}
        <View className="bg-slate-50 rounded-xl p-3 my-2 border border-slate-100">
          {/* Qualifying Trigger Condition */}
          <View className="flex-row items-start gap-2 mb-2.5">
            <View className="w-6 h-6 rounded-lg bg-blue-100 items-center justify-center mt-0.5">
              <MaterialIcons name="check-circle" size={14} color="#2563eb" />
            </View>
            <View className="flex-1">
              <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Qualifying Condition
              </Text>
              {isProductBased ? (
                <Text className="text-xs font-semibold text-slate-800 mt-0.5">
                  Order min <Text className="font-bold text-blue-700">{triggerQty} {triggerUnit}</Text> of{' '}
                  <Text className="font-bold text-slate-900">{triggerProduct}</Text>
                </Text>
              ) : (
                <Text className="text-xs font-semibold text-slate-800 mt-0.5">
                  Order Total reaches{' '}
                  <Text className="font-bold text-blue-700">₹{minAmount.toLocaleString('en-IN')}+</Text>{' '}
                  {item.eligible_product_mode === 'SELECTED_PRODUCTS' ? '(on selected items)' : '(across all items)'}
                </Text>
              )}
            </View>
          </View>

          {/* Reward Offer Banner */}
          <View className="flex-row items-start gap-2 pt-2 border-t border-slate-200/60">
            <View className="w-6 h-6 rounded-lg bg-emerald-100 items-center justify-center mt-0.5">
              <MaterialIcons name="card-giftcard" size={14} color="#059669" />
            </View>
            <View className="flex-1">
              <Text className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">
                Scheme Reward
              </Text>
              {isFreeProduct ? (
                <View className="mt-0.5">
                  <Text className="text-xs font-bold text-emerald-700">
                    🎉 Free Item: {rewardQty} {rewardUnit} of {rewardName} FREE
                  </Text>
                  <Text className="text-[10px] text-emerald-600 mt-0.5">
                    Automatically added to cart with ₹0 cost and deducted from van inventory.
                  </Text>
                </View>
              ) : (
                <View className="mt-0.5">
                  <Text className="text-xs font-bold text-emerald-700">
                    🏷️ Instant Discount: {discountType === 'PERCENTAGE' ? `${discountVal}%` : `₹${discountVal}`} OFF
                  </Text>
                  <Text className="text-[10px] text-emerald-600 mt-0.5">
                    Directly deducted from the qualifying bill total.
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Footer Meta & Action */}
        <View className="flex-row items-center justify-between pt-2 mt-1 border-t border-slate-100">
          <View className="flex-row items-center gap-1.5">
            <MaterialIcons name="date-range" size={13} color="#94a3b8" />
            <Text className="text-[11px] text-slate-500 font-medium">
              {item.start_date ? `Valid from ${item.start_date}` : 'Active Ongoing'}
              {item.end_date ? ` to ${item.end_date}` : ''}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => router.push('/sales')}
            className="flex-row items-center gap-1 bg-blue-600 active:bg-blue-700 px-3 py-1.5 rounded-xl shadow-xs"
            activeOpacity={0.8}
          >
            <MaterialIcons name="shopping-cart-checkout" size={14} color="#ffffff" />
            <Text className="text-xs font-bold text-white">Create Sale</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-slate-50">
      {/* Header Bar */}
      <View className="bg-white pt-3 pb-3 px-4 border-b border-slate-200">
        <View className="flex-row items-center justify-between mb-2">
          <View>
            <Text className="text-lg font-bold text-slate-900 leading-tight">
              Trade Schemes & Offers
            </Text>
            <View className="flex-row items-center gap-1.5 mt-0.5">
              <View className="bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded flex-row items-center gap-1">
                <MaterialIcons name="business" size={11} color="#0284c7" />
                <Text className="text-[10px] font-bold text-sky-800">{branchName || 'Palakkad Hub'}</Text>
              </View>
              <Text className="text-xs text-slate-500 font-medium">
                Active promotional offers
              </Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={handleRefresh}
            disabled={refreshing}
            className="bg-blue-50 border border-blue-200 p-2 rounded-xl"
            activeOpacity={0.7}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color="#2563eb" />
            ) : (
              <MaterialIcons name="sync" size={18} color="#2563eb" />
            )}
          </TouchableOpacity>
        </View>

        {/* Stats KPI Ribbon */}
        <View className="flex-row gap-2 mt-1 mb-2.5">
          <View className="flex-1 bg-blue-50/70 border border-blue-100 rounded-xl p-2 items-center">
            <Text className="text-[10px] font-bold text-blue-700 uppercase">Active Schemes</Text>
            <Text className="text-base font-extrabold text-blue-900 mt-0.5">{stats.total}</Text>
          </View>

          <View className="flex-1 bg-indigo-50/70 border border-indigo-100 rounded-xl p-2 items-center">
            <Text className="text-[10px] font-bold text-indigo-700 uppercase">Product-Based</Text>
            <Text className="text-base font-extrabold text-indigo-900 mt-0.5">{stats.productBased}</Text>
          </View>

          <View className="flex-1 bg-amber-50/70 border border-amber-100 rounded-xl p-2 items-center">
            <Text className="text-[10px] font-bold text-amber-800 uppercase">Amount-Based</Text>
            <Text className="text-base font-extrabold text-amber-950 mt-0.5">{stats.amountBased}</Text>
          </View>
        </View>

        {/* Search Input */}
        <View className="flex-row items-center bg-slate-100 rounded-xl px-3 py-2 border border-slate-200/70 mb-2">
          <MaterialIcons name="search" size={18} color="#64748b" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search schemes, products or rewards..."
            placeholderTextColor="#94a3b8"
            className="flex-1 ml-2 text-xs text-slate-800 font-medium py-0"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <MaterialIcons name="close" size={16} color="#64748b" />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Filter Chips */}
        <View className="flex-row gap-2">
          <TouchableOpacity
            onPress={() => setSelectedType('ALL')}
            className={`px-3 py-1.5 rounded-full border ${
              selectedType === 'ALL'
                ? 'bg-blue-600 border-blue-600'
                : 'bg-white border-slate-200'
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                selectedType === 'ALL' ? 'text-white' : 'text-slate-600'
              }`}
            >
              All ({stats.total})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setSelectedType('PRODUCT_BASED')}
            className={`px-3 py-1.5 rounded-full border ${
              selectedType === 'PRODUCT_BASED'
                ? 'bg-indigo-600 border-indigo-600'
                : 'bg-white border-slate-200'
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                selectedType === 'PRODUCT_BASED' ? 'text-white' : 'text-slate-600'
              }`}
            >
              Product-Based ({stats.productBased})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setSelectedType('AMOUNT_BASED')}
            className={`px-3 py-1.5 rounded-full border ${
              selectedType === 'AMOUNT_BASED'
                ? 'bg-amber-600 border-amber-600'
                : 'bg-white border-slate-200'
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                selectedType === 'AMOUNT_BASED' ? 'text-white' : 'text-slate-600'
              }`}
            >
              Amount-Based ({stats.amountBased})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Schemes List */}
      {loading ? (
        <View className="flex-1 items-center justify-center p-6">
          <ActivityIndicator size="large" color="#2563eb" />
          <Text className="text-xs text-slate-500 font-semibold mt-2">
            Loading promotional schemes...
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredSchemes}
          keyExtractor={(item) => String(item.scheme_id || item.scheme_code)}
          renderItem={renderSchemeCard}
          contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#2563eb']} />
          }
          ListEmptyComponent={
            <View className="bg-white rounded-2xl p-6 items-center justify-center border border-slate-200 my-6">
              <MaterialIcons name="local-offer" size={40} color="#cbd5e1" />
              <Text className="text-sm font-bold text-slate-700 mt-2">
                No Schemes Found
              </Text>
              <Text className="text-xs text-slate-500 text-center mt-1">
                {searchQuery
                  ? 'No promotional schemes match your search criteria.'
                  : 'No active promotional schemes currently configured.'}
              </Text>
              <TouchableOpacity
                onPress={handleRefresh}
                className="mt-3 bg-blue-50 border border-blue-200 px-3.5 py-1.5 rounded-xl flex-row items-center gap-1.5"
              >
                <MaterialIcons name="refresh" size={14} color="#2563eb" />
                <Text className="text-xs font-bold text-blue-700">Refresh from Server</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </View>
  );
}
