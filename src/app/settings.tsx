import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Modal,
  TextInput,
  Switch,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  getPrinterSettings,
  savePrinterSettings,
  disconnectPrinter,
  pairDirectPrinter,
  printDiagnosticTestSlip,
  isDirectBluetoothSupported,
  scanBluetoothPrinters,
  setDirectBluetoothPrinter,
  testPrinterConnection,
  normalizeBluetoothAddress,
  formatDisplayMacAddress,
  PRECONFIGURED_BLUETOOTH_PRINTERS,
  MobilePrinterSettings,
  PaperSize,
} from '../services/printerSettingsService';
import { printInvoice, MobileInvoiceData } from '../services/invoiceService';
import { getCompanyProfile } from '../database/db';

type BillType = 'sale' | 'order' | 'return';

export default function SettingsScreen() {
  const [settings, setSettings] = useState<MobilePrinterSettings>(getPrinterSettings());
  const [activeBillType, setActiveBillType] = useState<BillType>('sale');
  const [isPrintingBill, setIsPrintingBill] = useState(false);
  const [isPrintingDiag, setIsPrintingDiag] = useState(false);
  const [isPairing, setIsPairing] = useState(false);

  // Bluetooth Device Discovery Modal State
  const [isPickerVisible, setIsPickerVisible] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isTestingConn, setIsTestingConn] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<any[]>([]);
  const [foundDevices, setFoundDevices] = useState<any[]>([]);
  const [manualAddress, setManualAddress] = useState('');
  const [manualName, setManualName] = useState('');

  const company = getCompanyProfile();

  useEffect(() => {
    setSettings(getPrinterSettings());
  }, []);

  const handleStartScan = async () => {
    setIsScanning(true);
    try {
      if (isDirectBluetoothSupported()) {
        const res = await scanBluetoothPrinters();
        setPairedDevices(res.paired || []);
        setFoundDevices(res.found || []);
      } else {
        setPairedDevices([]);
        setFoundDevices([]);
      }
    } catch (err: any) {
      console.warn('Bluetooth scan error:', err);
      setPairedDevices([]);
      Alert.alert(
        'Bluetooth Scan Note',
        (err?.message || 'Could not scan devices automatically.') +
          '\n\nPlease make sure Bluetooth is ON and your printer is paired in your phone Bluetooth settings (default PIN: 0000 or 1234).'
      );
    } finally {
      setIsScanning(false);
    }
  };

  const handleOpenPicker = async () => {
    if (Platform.OS === 'ios') {
      setIsPairing(true);
      try {
        const selected = await pairDirectPrinter();
        if (selected) {
          const updated = getPrinterSettings();
          setSettings(updated);
          Alert.alert(
            'AirPrint / Thermal Connected',
            `Connected to: ${selected.name || 'Printer'}\nAll invoices will print directly.`
          );
        }
      } catch (e: any) {
        // ignore cancel
      } finally {
        setIsPairing(false);
      }
      return;
    }

    // Android / Direct Bluetooth
    setIsPickerVisible(true);
    handleStartScan();
  };

  const handleSelectDevice = async (device: { name: string; address?: string; deviceType?: string }) => {
    try {
      const normalizedAddress = normalizeBluetoothAddress(device.address || '', device.deviceType);
      const displayMac = formatDisplayMacAddress(normalizedAddress);
      const devNameLower = (device.name || '').toLowerCase();
      const detectedSize: PaperSize = devNameLower.includes('58') ? '58mm' : '80mm';

      const updated = savePrinterSettings({
        printerName: device.name || 'Bluetooth Printer',
        printerAddress: normalizedAddress,
        isConnected: true,
        directPrint: true,
        paperSize: detectedSize,
      });
      setSettings(updated);
      setIsPickerVisible(false);
      Alert.alert(
        'Printer Connected!',
        `Successfully connected to ${device.name || 'Bluetooth Printer'}${displayMac ? ` (${displayMac})` : ''}.\n\nDirect In-App ESC/POS printing is ready with zero RawBT watermarks.`
      );
    } catch (err: any) {
      Alert.alert('Connection Error', err?.message || 'Could not connect to printer.');
    }
  };

  const handleSaveManualAddress = () => {
    let addr = manualAddress.trim();
    if (!addr) {
      Alert.alert('Required', 'Please enter your printer Bluetooth MAC address (e.g. 00:11:22:33:44:55 or 86-67-7a-63-8e-df)');
      return;
    }
    const normalized = normalizeBluetoothAddress(addr);
    handleSelectDevice({
      name: manualName.trim() || 'Bluetooth Thermal Printer',
      address: normalized,
    });
  };

  const handleTestConnection = async () => {
    if (!settings.printerAddress) {
      Alert.alert('No Printer Connected', 'Please connect your Bluetooth printer in Settings first.');
      return;
    }
    setIsTestingConn(true);
    const displayMac = formatDisplayMacAddress(settings.printerAddress);
    try {
      const ok = await testPrinterConnection(settings.printerAddress);
      if (ok) {
        Alert.alert(
          'Connection Active',
          `Successfully verified Bluetooth link to ${settings.printerName} (${displayMac})!\n\nDirect ESC/POS printing is ready.`
        );
      } else {
        Alert.alert(
          'Printer Not Responding',
          `Could not reach ${settings.printerName} (${displayMac}).\n\nPlease ensure:\n1. Printer is powered ON.\n2. Paired in Android Settings -> Bluetooth.\n3. Printer is within range.`
        );
      }
    } catch (err: any) {
      Alert.alert('Connection Test', err?.message || 'Test failed');
    } finally {
      setIsTestingConn(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnectPrinter();
    const updated = getPrinterSettings();
    setSettings(updated);
    Alert.alert('Printer Disconnected', 'Bluetooth printer has been disconnected.');
  };

  const updateSetting = <K extends keyof MobilePrinterSettings>(key: K, value: MobilePrinterSettings[K]) => {
    const updated = savePrinterSettings({ [key]: value });
    setSettings(updated);
  };
  const handleDiagnosticTest = async () => {
    setIsPrintingDiag(true);
    try {
      await printDiagnosticTestSlip();
      Alert.alert('Diagnostic Test Sent', 'Hardware alignment & calibration slip sent directly to printer.');
    } catch (e: any) {
      const msg = (e?.message || '').toLowerCase();
      if (!msg.includes('cancel')) {
        Alert.alert('Diagnostic Test Error', e.message || 'Failed to execute diagnostic test.');
      }
    } finally {
      setIsPrintingDiag(false);
    }
  };

  const isConnected = settings.isConnected && Boolean(settings.printerName);

  return (
    <View style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {/* ================= 1. BLUETOOTH PRINTER SECTION ================= */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.headerLeft}>
            <View style={[styles.iconBadge, { backgroundColor: isConnected ? '#ecfdf5' : '#f1f5f9' }]}>
              <MaterialIcons name="bluetooth" size={20} color={isConnected ? '#059669' : '#64748b'} />
            </View>
            <View>
              <Text style={styles.cardTitle}>Bluetooth Thermal Printer</Text>
              <Text style={styles.cardSubtitle}>Direct ESC/POS • Posiflow PSF310 & Van Printers</Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: isConnected ? '#dcfce7' : '#f1f5f9' }]}>
            <View style={[styles.statusDot, { backgroundColor: isConnected ? '#16a34a' : '#94a3b8' }]} />
            <Text style={[styles.statusText, { color: isConnected ? '#15803d' : '#64748b' }]}>
              {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
            </Text>
          </View>
        </View>

        {isConnected ? (
          <View style={styles.connectedCard}>
            <View style={styles.deviceInfoRow}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={styles.deviceName} numberOfLines={1}>{settings.printerName}</Text>
                  <View style={styles.directPill}>
                    <Text style={styles.directPillText}>⚡ Direct ESC/POS</Text>
                  </View>
                </View>
                <Text style={styles.deviceMeta}>
                  {settings.printerAddress ? `MAC: ${formatDisplayMacAddress(settings.printerAddress)}` : 'Paired Device'} • Roll: {settings.paperSize || '80mm'}
                </Text>
                <Text style={styles.watermarkFreeText}>
                  ✓ 100% Watermark-Free • No RawBT or external apps required
                </Text>
              </View>
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                onPress={handleTestConnection}
                disabled={isTestingConn}
                style={styles.testLinkButton}
                activeOpacity={0.7}
              >
                {isTestingConn ? (
                  <ActivityIndicator size="small" color="#059669" />
                ) : (
                  <>
                    <MaterialIcons name="network-check" size={16} color="#059669" />
                    <Text style={styles.testLinkButtonText}>Test Link</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleOpenPicker}
                disabled={isPairing || isScanning}
                style={styles.changeButton}
                activeOpacity={0.7}
              >
                <MaterialIcons name="sync" size={16} color="#2563eb" />
                <Text style={styles.changeButtonText}>Change</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDisconnect}
                style={styles.disconnectButton}
                activeOpacity={0.7}
              >
                <MaterialIcons name="bluetooth-disabled" size={16} color="#e11d48" />
                <Text style={styles.disconnectButtonText}>Disconnect</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.disconnectedCard}>
            <Text style={styles.disconnectedNotice}>No Bluetooth printer currently connected.</Text>
            <Text style={styles.disconnectedSubnotice}>
              Connect any Bluetooth thermal receipt printer (58mm or 80mm) to print orders, invoices, and vouchers directly.
            </Text>
            <TouchableOpacity
              onPress={handleOpenPicker}
              disabled={isPairing || isScanning}
              style={styles.connectButton}
              activeOpacity={0.8}
            >
              {isScanning || isPairing ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <MaterialIcons name="bluetooth-searching" size={18} color="#ffffff" />
                  <Text style={styles.connectButtonText}>Connect Bluetooth Printer</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
        </View>
         {/* ================= 4. COPYRIGHT FOOTER ================= */}
      <View style={styles.copyrightContainer}>
        <Text style={styles.copyrightText}>Copyright @ 2026 | www.softair.co.in</Text>
      </View>
    </ScrollView>
      {/* ================= BLUETOOTH PRINTER SELECTION MODAL ================= */}
      <Modal
        visible={isPickerVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsPickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Connect Bluetooth Printer</Text>
                <Text style={styles.modalSubtitle}>Search & connect any 80mm or 58mm thermal printer</Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsPickerVisible(false)}
                style={styles.modalCloseBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialIcons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
              {/* Scan Action Bar */}
              <View style={styles.scanActionBar}>
                <TouchableOpacity
                  onPress={handleStartScan}
                  disabled={isScanning}
                  style={styles.scanButton}
                  activeOpacity={0.8}
                >
                  {isScanning ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <>
                      <MaterialIcons name="refresh" size={18} color="#ffffff" />
                      <Text style={styles.scanButtonText}>Scan Devices</Text>
                    </>
                  )}
                </TouchableOpacity>
                <Text style={styles.scanStatusText}>
                  {isScanning ? 'Scanning Bluetooth devices...' : 'Tap scan to refresh nearby devices'}
                </Text>
              </View>

              {/* Paired Devices List */}
              <View style={styles.deviceSection}>
                <Text style={styles.deviceSectionTitle}>PAIRED PRINTERS & DEVICES</Text>
                {pairedDevices.length === 0 && !isScanning ? (
                  <View style={styles.emptyDeviceBox}>
                    <Text style={styles.emptyDeviceText}>No paired Bluetooth devices detected.</Text>
                  </View>
                ) : (
                  pairedDevices.map((dev, index) => {
                    const devName = dev.name || 'Unnamed Device';
                    const isThermal =
                      devName.toLowerCase().includes('pos') ||
                      devName.toLowerCase().includes('print') ||
                      devName.toLowerCase().includes('thermal') ||
                      devName.toLowerCase().includes('receipt') ||
                      devName.toLowerCase().includes('mpt') ||
                      devName.toLowerCase().includes('rpp') ||
                      devName.toLowerCase().includes('rp-') ||
                      devName.toLowerCase().includes('psf') ||
                      devName.toLowerCase().includes('amigos') ||
                      devName.toLowerCase().includes('everycom') ||
                      devName.toLowerCase().includes('tvs') ||
                      devName.toLowerCase().includes('epson') ||
                      devName.toLowerCase().includes('star') ||
                      devName.toLowerCase().includes('rongta') ||
                      devName.toLowerCase().includes('xprinter');
                    const isCurrent = settings.printerAddress && normalizeBluetoothAddress(settings.printerAddress) === normalizeBluetoothAddress(dev.address);

                    return (
                      <TouchableOpacity
                        key={dev.address || dev.id || `paired_${index}`}
                        onPress={() => handleSelectDevice(dev)}
                        style={[styles.deviceCard, isCurrent && styles.deviceCardActive]}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.deviceIconBox, isThermal && { backgroundColor: '#dcfce7' }]}>
                          <MaterialIcons
                            name="print"
                            size={20}
                            color={isThermal ? '#16a34a' : '#2563eb'}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={styles.deviceCardName}>{devName}</Text>
                            {isThermal && (
                              <View style={styles.recBadge}>
                                <Text style={styles.recBadgeText}>Thermal POS</Text>
                              </View>
                            )}
                            {isCurrent && (
                              <View style={styles.currentBadge}>
                                <Text style={styles.currentBadgeText}>Connected</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.deviceCardAddress}>{formatDisplayMacAddress(dev.address) || 'Paired Device'}</Text>
                        </View>
                        <View style={[styles.connectPill, isCurrent && { backgroundColor: '#10b981' }]}>
                          <Text style={styles.connectPillText}>{isCurrent ? 'Active' : 'Connect'}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>

              {/* Nearby Discovered Devices */}
              {foundDevices.length > 0 && (
                <View style={styles.deviceSection}>
                  <Text style={styles.deviceSectionTitle}>NEARBY DISCOVERED DEVICES</Text>
                  {foundDevices.map((dev, index) => (
                    <TouchableOpacity
                      key={dev.address || `found_${index}`}
                      onPress={() => handleSelectDevice(dev)}
                      style={styles.deviceCard}
                      activeOpacity={0.7}
                    >
                      <View style={styles.deviceIconBox}>
                        <MaterialIcons name="bluetooth-searching" size={20} color="#2563eb" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.deviceCardName}>{dev.name || 'Nearby Device'}</Text>
                        <Text style={styles.deviceCardAddress}>{formatDisplayMacAddress(dev.address)}</Text>
                      </View>
                      <View style={styles.connectPill}>
                        <Text style={styles.connectPillText}>Link</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Manual MAC Address Input */}
              <View style={styles.manualSection}>
                <Text style={styles.deviceSectionTitle}>MANUAL BLUETOOTH MAC ADDRESS</Text>
                <Text style={styles.manualDesc}>
                  If your printer is paired in phone settings but doesn't show in the scan, enter its MAC address manually (e.g. 00:11:22:33:44:55):
                </Text>
                <TextInput
                  value={manualName}
                  onChangeText={setManualName}
                  placeholder="Printer Name (e.g. My Thermal Printer)"
                  placeholderTextColor="#94a3b8"
                  style={[styles.manualInput, { marginBottom: 8 }]}
                />
                <TextInput
                  value={manualAddress}
                  onChangeText={setManualAddress}
                  placeholder="MAC Address (e.g. 00:11:22:33:44:55)"
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="characters"
                  style={styles.manualInput}
                />
                <TouchableOpacity
                  onPress={handleSaveManualAddress}
                  style={styles.manualSaveBtn}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="save" size={16} color="#ffffff" />
                  <Text style={styles.manualSaveBtnText}>Save & Connect Printer</Text>
                </TouchableOpacity>
              </View>

              {/* Universal Quick Setup Tips */}
              <View style={styles.tipBox}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <MaterialIcons name="lightbulb" size={16} color="#d97706" />
                  <Text style={styles.tipTitle}>Universal Bluetooth Printer Setup Guide</Text>
                </View>
                <Text style={styles.tipText}>
                  1. Turn ON your Bluetooth thermal printer.{'\n'}
                  2. Open phone Settings → Bluetooth → Pair New Device.{'\n'}
                  3. Select your printer and enter PIN (default is usually 0000 or 1234).{'\n'}
                  4. Return to this screen, tap 'Scan Devices', and tap 'Connect' next to your printer.{'\n'}
                  5. Invoices, orders, and vouchers will print directly with 1 tap and ZERO RawBT watermark!
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 36,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  connectedCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  deviceInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  deviceName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  deviceMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  disconnectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    paddingVertical: 10,
    borderRadius: 10,
  },
  disconnectButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e11d48',
  },
  changeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingVertical: 10,
    borderRadius: 10,
  },
  changeButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  disconnectedCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  disconnectedNotice: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 12,
  },
  connectButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 12,
  },
  connectButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 4,
    gap: 4,
    marginBottom: 14,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: '#2563eb',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  tabTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  receiptWrapper: {
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
    padding: 10,
    marginBottom: 14,
  },
  receiptCard: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  receiptCompany: {
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
    color: '#0f172a',
    letterSpacing: 0.5,
  },
  receiptSubtext: {
    fontSize: 9.5,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 1,
  },
  receiptTitleBox: {
    marginVertical: 6,
    paddingVertical: 3,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#0f172a',
  },
  receiptTitleText: {
    fontSize: 10.5,
    fontWeight: '900',
    textAlign: 'center',
    color: '#0f172a',
    letterSpacing: 0.5,
  },
  receiptMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 1,
  },
  receiptMetaText: {
    fontSize: 9.5,
    color: '#334155',
  },
  receiptBold: {
    fontWeight: 'bold',
    color: '#0f172a',
  },
  receiptDotted: {
    fontSize: 8.5,
    textAlign: 'center',
    color: '#94a3b8',
    marginVertical: 3,
    letterSpacing: -0.5,
  },
  receiptTableRow: {
    flexDirection: 'row',
    paddingVertical: 2,
  },
  receiptTableHead: {
    fontSize: 9,
    fontWeight: '900',
    color: '#0f172a',
  },
  receiptItemRow: {
    flexDirection: 'row',
    marginVertical: 2,
    alignItems: 'flex-start',
  },
  receiptItemName: {
    fontSize: 9.5,
    fontWeight: '600',
    color: '#1e293b',
  },
  receiptItemSub: {
    fontSize: 8,
    color: '#64748b',
  },
  receiptItemCell: {
    fontSize: 9.5,
    color: '#0f172a',
  },
  receiptSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 1,
  },
  receiptSummaryLabel: {
    fontSize: 9.5,
    color: '#475569',
  },
  receiptSummaryVal: {
    fontSize: 9.5,
    fontWeight: '600',
    color: '#0f172a',
  },
  receiptTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 3,
  },
  receiptTotalLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#0f172a',
  },
  receiptTotalAmount: {
    fontSize: 12,
    fontWeight: '900',
    color: '#059669',
  },
  receiptFooter: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    alignItems: 'center',
  },
  receiptFooterText: {
    fontSize: 8.5,
    fontWeight: 'bold',
    color: '#64748b',
    letterSpacing: 0.5,
  },
  receiptFooterSub: {
    fontSize: 7.5,
    color: '#94a3b8',
    marginTop: 2,
  },
  actionButtonsContainer: {
    gap: 10,
  },
  printBillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#059669',
    paddingVertical: 13,
    borderRadius: 14,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  printBillButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  diagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 12,
    borderRadius: 14,
  },
  diagButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  copyrightContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginTop: 4,
  },
  copyrightText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#64748b',
  },
  directPill: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  directPillText: {
    color: '#15803d',
    fontSize: 10,
    fontWeight: '700',
  },
  watermarkFreeText: {
    color: '#059669',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  testLinkButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingVertical: 10,
    borderRadius: 10,
  },
  testLinkButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  disconnectedSubnotice: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 16,
    paddingHorizontal: 8,
  },
  configSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  configSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  paperSizeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  paperSizeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 9,
    borderRadius: 8,
  },
  paperSizeOptionActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#2563eb',
  },
  paperSizeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  paperSizeTextActive: {
    color: '#1d4ed8',
    fontWeight: '700',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  toggleDesc: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
    lineHeight: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  modalContent: {
    padding: 16,
  },
  scanActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  scanButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  scanStatusText: {
    flex: 1,
    fontSize: 11,
    color: '#64748b',
  },
  deviceSection: {
    marginBottom: 16,
  },
  deviceSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  emptyDeviceBox: {
    backgroundColor: '#f8fafc',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emptyDeviceText: {
    fontSize: 12,
    color: '#64748b',
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    gap: 10,
  },
  deviceCardActive: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  deviceIconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceCardName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  deviceCardAddress: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  recBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  recBadgeText: {
    color: '#15803d',
    fontSize: 9,
    fontWeight: '700',
  },
  currentBadge: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  currentBadgeText: {
    color: '#1d4ed8',
    fontSize: 9,
    fontWeight: '700',
  },
  connectPill: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  connectPillText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  manualSection: {
    backgroundColor: '#f8fafc',
    padding: 14,
    borderRadius: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  manualDesc: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 8,
    lineHeight: 15,
  },
  manualInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0f172a',
    marginBottom: 8,
  },
  manualSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#059669',
    paddingVertical: 10,
    borderRadius: 8,
  },
  manualSaveBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  tipBox: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fef3c7',
    padding: 12,
    borderRadius: 12,
    marginBottom: 24,
  },
  tipTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#b45309',
  },
  tipText: {
    fontSize: 11,
    color: '#92400e',
    lineHeight: 16,
  },
});
