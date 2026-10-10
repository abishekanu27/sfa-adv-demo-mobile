import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
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
  getExpenses,
  addExpense,
  getInHandCashStats,
  ExpenseRecord,
  getAssignedRoute,
} from '../database/db';
import { syncDatabase } from '../database/sync';
import { useAuth } from '../context/AuthContext';
import {
  printExpenseDirectBluetooth,
  abortActivePrint,
} from '../services/printerSettingsService';

const EXPENSE_CATEGORIES = [
  { label: 'Fuel / Diesel', icon: 'local-gas-station', color: '#f59e0b', bg: '#fef3c7' },
  { label: 'Food & Meals', icon: 'restaurant', color: '#10b981', bg: '#d1fae5' },
  { label: 'Toll & Parking', icon: 'toll', color: '#6366f1', bg: '#e0e7ff' },
  { label: 'Vehicle Repair', icon: 'build', color: '#ef4444', bg: '#fee2e2' },
  { label: 'Loading / Porterage', icon: 'local-shipping', color: '#8b5cf6', bg: '#ede9fe' },
  { label: 'Miscellaneous', icon: 'receipt-long', color: '#64748b', bg: '#f1f5f9' },
];

export default function ExpensesScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Cash and Expense data
  const [cashStats, setCashStats] = useState({
    totalCashCollected: 0,
    totalExpenses: 0,
    netInHandCash: 0,
  });
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilterCategory, setSelectedFilterCategory] = useState<string>('All');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [category, setCategory] = useState('Fuel / Diesel');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'Online'>('Cash');
  const [submitting, setSubmitting] = useState(false);
  const [isPrintingVoucher, setIsPrintingVoucher] = useState(false);
  const [printingExpenseId, setPrintingExpenseId] = useState<string | null>(null);

  const assignedRoute = getAssignedRoute();

  const loadData = useCallback(() => {
    try {
      const stats = getInHandCashStats();
      setCashStats(stats);
      const list = getExpenses();
      setExpenses(list);
    } catch (e) {
      console.warn('Failed to load expenses data:', e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await syncDatabase();
    } catch (e) {
      console.warn('Silent sync error on refresh:', e);
    }
    loadData();
    setRefreshing(false);
  };

  const handleManualSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await syncDatabase();
      loadData();
      Alert.alert(
        'Synced Successfully',
        `Expenses and data reconciled with server.\nPushed: ${res.pushedCount} | Pulled: ${res.pulledCount}`
      );
    } catch (e: any) {
      Alert.alert('Sync Offline', e.message || 'Saved locally. Will sync when server is reachable.');
    } finally {
      setSyncing(false);
    }
  };

  const handleOpenAddModal = () => {
    setCategory('Fuel / Diesel');
    setAmount('');
    setReason('');
    setPaymentMode('Cash');
    setIsModalOpen(true);
  };

  const handleStopExpensePrint = () => {
    abortActivePrint();
    setIsPrintingVoucher(false);
    setPrintingExpenseId(null);
    Alert.alert('Printing Stopped', 'Voucher printing was stopped. The expense remains safely recorded.');
  };

  const handlePrintHistoricalExpense = async (exp: ExpenseRecord) => {
    if (isPrintingVoucher) return;
    setIsPrintingVoucher(true);
    setPrintingExpenseId(exp.id);
    try {
      await printExpenseDirectBluetooth(exp);
      Alert.alert('Printed', 'Expense voucher printed successfully.');
    } catch (e: any) {
      if (!e?.message?.includes('cancelled') && !e?.message?.includes('stopped')) {
        Alert.alert('Print Error', e.message || 'Could not print voucher. Please check Bluetooth printer.');
      }
    } finally {
      setIsPrintingVoucher(false);
      setPrintingExpenseId(null);
    }
  };

  const handleSubmitExpense = async (shouldPrint = false) => {
    const numAmount = parseFloat(amount.trim());
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid expense amount greater than 0.');
      return;
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      Alert.alert('Reason Required', 'Please enter a reason or description for this expense.');
      return;
    }

    if (paymentMode === 'Cash' && numAmount > cashStats.netInHandCash) {
      Alert.alert(
        'Cash Warning',
        `The expense amount (₹${numAmount.toLocaleString('en-IN')}) exceeds your current in-hand cash (₹${cashStats.netInHandCash.toLocaleString('en-IN')}). Do you still want to proceed?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Proceed', onPress: () => processExpenseSubmission(numAmount, trimmedReason, shouldPrint) },
        ]
      );
      return;
    }

    processExpenseSubmission(numAmount, trimmedReason, shouldPrint);
  };

  const processExpenseSubmission = async (numAmount: number, trimmedReason: string, shouldPrint = false) => {
    setSubmitting(true);
    try {
      // 1. Add to SQLite DB immediately deducting inhand cash
      const savedExp = addExpense({
        category,
        amount: numAmount,
        reason: trimmedReason,
        payment_mode: paymentMode,
        salesman_id: user?.id ? String(user.id) : undefined,
        salesman_name: user?.name || user?.username || undefined,
      });

      // 2. Refresh local in-hand cash display immediately
      loadData();
      setIsModalOpen(false);

      // 3. Proactively trigger background sync to backend DB
      syncDatabase().catch(err => {
        console.warn('Background sync after expense failed (will retry):', err);
      });

      if (shouldPrint) {
        setIsPrintingVoucher(true);
        setPrintingExpenseId(savedExp.id);
        try {
          await printExpenseDirectBluetooth(savedExp);
          Alert.alert(
            'Expense Recorded & Printed',
            `₹${numAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} deducted and voucher printed.`
          );
        } catch (printErr: any) {
          if (!printErr?.message?.includes('cancelled') && !printErr?.message?.includes('stopped')) {
            Alert.alert(
              'Expense Recorded (Print Notice)',
              `Expense was saved, but voucher could not be printed: ${printErr.message || 'Check printer connection'}`
            );
          }
        } finally {
          setIsPrintingVoucher(false);
          setPrintingExpenseId(null);
        }
      } else {
        Alert.alert(
          'Expense Recorded',
          `₹${numAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} has been deducted from your In-Hand Cash.`
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to record expense.');
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered expenses
  const filteredExpenses = useMemo(() => {
    return expenses.filter(exp => {
      const matchCat =
        selectedFilterCategory === 'All' || exp.category.toLowerCase().includes(selectedFilterCategory.toLowerCase());
      const matchQuery =
        !searchQuery ||
        exp.reason?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        exp.expense_code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        exp.category?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchQuery;
    });
  }, [expenses, selectedFilterCategory, searchQuery]);

  const parsedEnteredAmount = parseFloat(amount.trim()) || 0;
  const simulatedRemainingCash = paymentMode === 'Cash'
    ? Math.max(0, cashStats.netInHandCash - parsedEnteredAmount)
    : cashStats.netInHandCash;

  return (
    <View className="flex-1 bg-slate-50">
      {/* Top Header */}
      <View className="bg-white border-b border-slate-200 px-4 pt-3 pb-3">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-lg font-bold text-slate-900 leading-tight">Expenses & In-Hand Cash</Text>
            <View className="flex-row items-center gap-1.5 mt-0.5">
              <View className="w-2 h-2 rounded-full bg-emerald-500" />
              <Text className="text-xs font-semibold text-slate-500">
                {user?.name || 'Sales Representative'}
                {assignedRoute?.vehicle_reg_no ? ` • ${assignedRoute.vehicle_reg_no}` : ''}
              </Text>
            </View>
          </View>

          {/* Sync Action */}
          <TouchableOpacity
            onPress={handleManualSync}
            disabled={syncing}
            className={`flex-row items-center gap-1 px-3 py-1.5 rounded-xl border ${
              syncing ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200 active:bg-slate-100'
            }`}
          >
            {syncing ? (
              <ActivityIndicator size="small" color="#2563eb" />
            ) : (
              <MaterialIcons name="sync" size={16} color="#475569" />
            )}
            <Text className="text-xs font-semibold text-slate-700">
              {syncing ? 'Syncing...' : 'Sync'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* HERO CARD: In-Hand Cash */}
        <View className="bg-white rounded-3xl p-5 mb-5 border border-slate-100 shadow-sm overflow-hidden">
          <View className="flex-row items-center justify-between mb-2">
            <View className="flex-row items-center gap-2 flex-1 mr-2">
              <View className="w-10 h-10 rounded-2xl bg-emerald-100 items-center justify-center">
                <MaterialIcons name="account-balance-wallet" size={22} color="#059669" />
              </View>
              <View className="flex-1">
                <Text className="text-xs font-bold text-slate-500 uppercase tracking-wider" numberOfLines={1}>
                  Net In-Hand Cash
                </Text>
                <Text className="text-[11px] text-slate-400" numberOfLines={1}>Available cash to deposit</Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={handleOpenAddModal}
              className="bg-emerald-600 active:bg-emerald-700 px-3.5 py-2 rounded-2xl flex-row items-center gap-1 shadow-xs"
              style={{ flexShrink: 0 }}
              activeOpacity={0.85}
            >
              <MaterialIcons name="add" size={18} color="#ffffff" />
              <Text className="text-xs font-bold text-white">Add Expense</Text>
            </TouchableOpacity>
          </View>

          {/* Primary In-Hand Cash Value */}
          <View className="my-2">
            <Text className="text-3xl font-extrabold text-slate-900 tracking-tight">
              ₹{cashStats.netInHandCash.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          </View>

          {/* Breakdown Row */}
          <View className="flex-row items-center justify-between pt-3 mt-1 border-t border-slate-100 bg-slate-50/60 -mx-5 -mb-5 px-5 py-3">
            <View className="flex-1 pr-2">
              <Text className="text-[11px] font-semibold text-slate-500">Gross Cash Collected</Text>
              <Text className="text-sm font-bold text-emerald-700 mt-0.5">
                +₹{cashStats.totalCashCollected.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </Text>
            </View>

            <View className="w-px h-8 bg-slate-200" />

            <View className="flex-1 pl-4">
              <Text className="text-[11px] font-semibold text-slate-500">Total Expenses Deducted</Text>
              <Text className="text-sm font-bold text-rose-600 mt-0.5">
                -₹{cashStats.totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </Text>
            </View>
          </View>
        </View>

        {/* Search & Category Filter Section */}
        <View className="mb-3">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Expense History ({filteredExpenses.length})
            </Text>
          </View>

          {/* Search Box */}
          <View className="bg-white rounded-2xl px-3.5 py-2.5 flex-row items-center gap-2 border border-slate-200 mb-2.5 shadow-xs">
            <MaterialIcons name="search" size={20} color="#94a3b8" />
            <TextInput
              placeholder="Search expenses by reason, category, code..."
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

          {/* Category Chips Scroll */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-1.5 py-1">
            <TouchableOpacity
              onPress={() => setSelectedFilterCategory('All')}
              className={`px-3 py-1.5 rounded-full border mr-1.5 ${
                selectedFilterCategory === 'All'
                  ? 'bg-slate-900 border-slate-900'
                  : 'bg-white border-slate-200'
              }`}
            >
              <Text
                className={`text-xs font-bold ${
                  selectedFilterCategory === 'All' ? 'text-white' : 'text-slate-600'
                }`}
              >
                All Categories
              </Text>
            </TouchableOpacity>

            {EXPENSE_CATEGORIES.map(cat => {
              const isSelected = selectedFilterCategory === cat.label;
              return (
                <TouchableOpacity
                  key={cat.label}
                  onPress={() => setSelectedFilterCategory(cat.label)}
                  className={`px-3 py-1.5 rounded-full border mr-1.5 flex-row items-center gap-1 ${
                    isSelected ? 'bg-slate-900 border-slate-900' : 'bg-white border-slate-200'
                  }`}
                >
                  <MaterialIcons
                    name={cat.icon as any}
                    size={14}
                    color={isSelected ? '#ffffff' : cat.color}
                  />
                  <Text
                    className={`text-xs font-bold ${
                      isSelected ? 'text-white' : 'text-slate-600'
                    }`}
                  >
                    {cat.label.split('/')[0].trim()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Expenses List */}
        {filteredExpenses.length > 0 ? (
          <View className="gap-2.5">
            {filteredExpenses.map(exp => {
              const catMeta = EXPENSE_CATEGORIES.find(c =>
                exp.category?.toLowerCase().includes(c.label.toLowerCase()) ||
                c.label.toLowerCase().includes(exp.category?.toLowerCase() || '')
              ) || EXPENSE_CATEGORIES[5];

              const expDateStr = exp.expense_date
                ? new Date(exp.expense_date).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : new Date(exp.created_at || Date.now()).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                  });

              const isSynced = exp._status === 'synced';

              return (
                <View
                  key={exp.id}
                  className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs"
                >
                  <View className="flex-row items-start justify-between mb-2">
                    <View className="flex-row items-center gap-2.5 flex-1 pr-2">
                      <View
                        style={{ backgroundColor: catMeta.bg }}
                        className="w-9 h-9 rounded-xl items-center justify-center"
                      >
                        <MaterialIcons name={catMeta.icon as any} size={18} color={catMeta.color} />
                      </View>
                      <View className="flex-1">
                        <Text className="text-xs font-bold text-slate-800 leading-tight">
                          {exp.category}
                        </Text>
                        <Text className="text-[10px] text-slate-400 mt-0.5">
                          {exp.expense_code || 'EXP-MANUAL'} • {expDateStr}
                        </Text>
                      </View>
                    </View>

                    {/* Amount */}
                    <View className="items-end">
                      <Text className="text-sm font-extrabold text-rose-600">
                        -₹{Number(exp.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </Text>
                      <View className="flex-row items-center gap-1 mt-0.5">
                        <View
                          className={`w-1.5 h-1.5 rounded-full ${
                            isSynced ? 'bg-emerald-500' : 'bg-amber-500'
                          }`}
                        />
                        <Text className="text-[9px] font-semibold text-slate-400">
                          {isSynced ? 'Synced to DB' : 'Saved Locally'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Reason Box */}
                  <View className="bg-slate-50 rounded-xl p-2.5 border border-slate-100">
                    <Text className="text-[11px] font-semibold text-slate-700 leading-relaxed">
                      {exp.reason}
                    </Text>
                  </View>

                  {/* Payment Mode & Print Voucher Footer */}
                  <View className="flex-row items-center justify-between mt-2 pt-1.5 border-t border-slate-100">
                    <View className="flex-row items-center gap-1">
                      <MaterialIcons name="payment" size={12} color="#64748b" />
                      <Text className="text-[10px] text-slate-500 font-medium">
                        Paid via {exp.payment_mode || 'Cash'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handlePrintHistoricalExpense(exp)}
                      disabled={isPrintingVoucher}
                      className="flex-row items-center gap-1 bg-slate-50 px-2 py-0.5 rounded border border-slate-200 active:bg-slate-100"
                    >
                      <MaterialIcons name="print" size={11} color="#2563eb" />
                      <Text className="text-[10px] font-bold text-blue-700">
                        {printingExpenseId === exp.id ? 'Printing...' : 'Print Voucher'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View className="bg-white rounded-3xl p-8 items-center border border-slate-200 mt-2">
            <View className="w-16 h-16 rounded-full bg-slate-100 items-center justify-center mb-3">
              <MaterialIcons name="receipt-long" size={32} color="#94a3b8" />
            </View>
            <Text className="text-sm font-bold text-slate-800 text-center">
              No Expenses Recorded Yet
            </Text>
            <Text className="text-xs text-slate-500 text-center mt-1 max-w-[240px]">
              Tap 'Add Expense' above to log fuel, food, vehicle repairs, or other field expenditures.
            </Text>
            <TouchableOpacity
              onPress={handleOpenAddModal}
              className="mt-4 bg-emerald-600 px-4 py-2 rounded-xl flex-row items-center gap-1.5"
            >
              <MaterialIcons name="add" size={16} color="#ffffff" />
              <Text className="text-xs font-bold text-white">Record First Expense</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* RECORD EXPENSE MODAL */}
      <Modal
        visible={isModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-end bg-black/50"
        >
          <View className="bg-white rounded-t-3xl p-5 max-h-[90%] border-t border-slate-200">
            {/* Header */}
            <View className="flex-row items-center justify-between pb-3 border-b border-slate-100">
              <View className="flex-row items-center gap-2">
                <View className="w-8 h-8 rounded-xl bg-emerald-100 items-center justify-center">
                  <MaterialIcons name="receipt" size={18} color="#059669" />
                </View>
                <View>
                  <Text className="text-base font-bold text-slate-900 leading-tight">
                    Record Field Expense
                  </Text>
                  <Text className="text-[11px] text-slate-500">
                    Reduces physical in-hand cash immediately
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 items-center justify-center"
              >
                <MaterialIcons name="close" size={18} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} className="pt-3">
              {/* Category Selection */}
              <Text className="text-xs font-bold text-slate-700 mb-2">
                Select Expense Category <Text className="text-red-500">*</Text>
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-4">
                {EXPENSE_CATEGORIES.map(cat => {
                  const isSelected = category === cat.label;
                  return (
                    <TouchableOpacity
                      key={cat.label}
                      onPress={() => setCategory(cat.label)}
                      style={{
                        borderColor: isSelected ? '#059669' : '#e2e8f0',
                        backgroundColor: isSelected ? '#ecfdf5' : '#ffffff',
                      }}
                      className="border rounded-2xl px-3 py-2 flex-row items-center gap-1.5 shadow-2xs"
                    >
                      <MaterialIcons
                        name={cat.icon as any}
                        size={15}
                        color={isSelected ? '#059669' : cat.color}
                      />
                      <Text
                        className={`text-xs font-semibold ${
                          isSelected ? 'text-emerald-900 font-bold' : 'text-slate-700'
                        }`}
                      >
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Amount Input */}
              <View className="mb-4">
                <Text className="text-xs font-bold text-slate-700 mb-1.5">
                  Expense Amount (₹) <Text className="text-red-500">*</Text>
                </Text>
                <View className="flex-row items-center bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2">
                  <Text className="text-lg font-bold text-slate-400 mr-1.5">₹</Text>
                  <TextInput
                    placeholder="0.00"
                    placeholderTextColor="#94a3b8"
                    keyboardType="numeric"
                    value={amount}
                    onChangeText={setAmount}
                    style={{ textAlignVertical: 'center', includeFontPadding: false }}
                    className="flex-1 text-lg font-extrabold text-slate-900 p-0"
                  />
                  {parsedEnteredAmount > 0 ? (
                    <Text className="text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded">
                      -₹{parsedEnteredAmount.toLocaleString('en-IN')}
                    </Text>
                  ) : null}
                </View>
              </View>

              {/* Reason Input (MANDATORY) */}
              <View className="mb-4">
                <View className="flex-row items-center justify-between mb-1.5">
                  <Text className="text-xs font-bold text-slate-700">
                    Reason / Description <Text className="text-red-500">*</Text>
                  </Text>
                  <Text className="text-[10px] text-slate-400">Required</Text>
                </View>
                <TextInput
                  placeholder="e.g. Diesel 15L filled at Indian Oil pump, Toll at Paliyekkara plaza..."
                  placeholderTextColor="#94a3b8"
                  multiline
                  numberOfLines={3}
                  value={reason}
                  onChangeText={setReason}
                  style={{ textAlignVertical: 'top' }}
                  className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-xs text-slate-800 min-h-[75px]"
                />
              </View>

              {/* Payment Mode Selector */}
              <View className="mb-4">
                <Text className="text-xs font-bold text-slate-700 mb-1.5">
                  Payment Mode
                </Text>
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => setPaymentMode('Cash')}
                    className={`flex-1 flex-row items-center justify-center gap-1.5 py-2.5 rounded-2xl border ${
                      paymentMode === 'Cash'
                        ? 'bg-emerald-50 border-emerald-500'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <MaterialIcons
                      name="payments"
                      size={16}
                      color={paymentMode === 'Cash' ? '#059669' : '#64748b'}
                    />
                    <Text
                      className={`text-xs font-bold ${
                        paymentMode === 'Cash' ? 'text-emerald-800' : 'text-slate-600'
                      }`}
                    >
                      Cash (Deducts In-Hand)
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setPaymentMode('Online')}
                    className={`flex-1 flex-row items-center justify-center gap-1.5 py-2.5 rounded-2xl border ${
                      paymentMode === 'Online'
                        ? 'bg-blue-50 border-blue-500'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <MaterialIcons
                      name="credit-card"
                      size={16}
                      color={paymentMode === 'Online' ? '#2563eb' : '#64748b'}
                    />
                    <Text
                      className={`text-xs font-bold ${
                        paymentMode === 'Online' ? 'text-blue-800' : 'text-slate-600'
                      }`}
                    >
                      Online / UPI
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Dynamic In-Hand Cash Impact Preview */}
              <View className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200 mb-4">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-xs text-slate-600 font-medium">Current In-Hand Cash:</Text>
                  <Text className="text-xs font-bold text-slate-800">
                    ₹{cashStats.netInHandCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-xs text-rose-600 font-medium">This Expense:</Text>
                  <Text className="text-xs font-bold text-rose-600">
                    -₹{parsedEnteredAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
                <View className="h-px bg-slate-200 my-1.5" />
                <View className="flex-row items-center justify-between">
                  <Text className="text-xs font-bold text-slate-900">New In-Hand Cash Balance:</Text>
                  <Text className="text-sm font-extrabold text-emerald-700">
                    ₹{simulatedRemainingCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
              </View>

              {/* Action Buttons */}
              <View className="gap-2.5 pb-6">
                <View className="flex-row gap-2.5">
                  <TouchableOpacity
                    onPress={() => setIsModalOpen(false)}
                    disabled={submitting || isPrintingVoucher}
                    className="flex-1 bg-slate-100 py-3 rounded-2xl items-center active:bg-slate-200"
                  >
                    <Text className="text-xs font-bold text-slate-700">Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => handleSubmitExpense(false)}
                    disabled={submitting || isPrintingVoucher}
                    className="flex-1.2 bg-slate-800 py-3 rounded-2xl items-center flex-row justify-center gap-1.5 shadow-sm active:bg-slate-900"
                  >
                    {submitting && !isPrintingVoucher ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <MaterialIcons name="save" size={17} color="#ffffff" />
                    )}
                    <Text className="text-xs font-bold text-white">
                      Save (No Print)
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Save & Print Voucher */}
                <TouchableOpacity
                  onPress={() => handleSubmitExpense(true)}
                  disabled={submitting || isPrintingVoucher}
                  className="bg-emerald-600 py-3.5 rounded-2xl items-center flex-row justify-center gap-2 shadow-sm active:bg-emerald-700"
                >
                  <MaterialIcons name="print" size={18} color="#ffffff" />
                  <Text className="text-xs font-extrabold text-white">
                    Save & Print Voucher Slip
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Floating Active Print Banner with Stop Option */}
      {isPrintingVoucher && (
        <View className="absolute bottom-5 left-4 right-4 bg-slate-900/95 border border-slate-700 rounded-2xl p-3.5 flex-row items-center justify-between shadow-lg">
          <View className="flex-row items-center gap-2.5">
            <ActivityIndicator size="small" color="#10b981" />
            <Text className="text-xs font-bold text-white">Printing Expense Voucher...</Text>
          </View>
          <TouchableOpacity
            onPress={handleStopExpensePrint}
            className="bg-rose-600 px-3 py-1.5 rounded-xl flex-row items-center gap-1 active:bg-rose-700"
          >
            <MaterialIcons name="stop-circle" size={16} color="#ffffff" />
            <Text className="text-xs font-bold text-white">Stop Printing</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
