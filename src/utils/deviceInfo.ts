import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { getSyncMeta, setSyncMeta, getDatabase } from '../database/db';

/**
 * Retrieves or initializes a unique, permanent Device ID for this phone.
 * Stored persistently in SQLite sync_meta so it remains consistent across app restarts.
 */
export function getOrCreateDeviceId(): string {
  try {
    let devId = getSyncMeta('device_id');
    if (!devId || devId.trim() === '') {
      const timePart = Date.now().toString(36);
      const randomPart = Math.random().toString(36).substring(2, 10);
      const osPrefix = Platform.OS === 'ios' ? 'ios' : 'and';
      devId = `dev_${osPrefix}_${timePart}_${randomPart}`;
      setSyncMeta('device_id', devId);
    }
    return devId;
  } catch (err) {
    console.warn('Error reading device_id from SQLite:', err);
    return 'dev_mobile_default';
  }
}

/**
 * Returns a human-readable display name of the device (e.g. "Samsung Galaxy S23", "Redmi Note 12").
 */
export function getDeviceDisplayName(): string {
  try {
    const brand = Device.brand || '';
    const model = Device.modelName || Device.productName || Device.designName || '';
    const parts = [brand, model].filter(Boolean);
    const fullName = parts.join(' ').trim();
    if (fullName) return fullName;
    return Platform.OS === 'android' ? 'Android Device' : 'iOS Device';
  } catch {
    return 'Mobile Phone';
  }
}

/**
 * Returns the device model string if available.
 */
export function getDeviceModel(): string {
  try {
    return Device.modelName || Device.modelId || Platform.OS;
  } catch {
    return Platform.OS;
  }
}

/**
 * Checks whether this phone currently has active van stock synced.
 * Stock is considered synced if:
 * 1. sync_meta has 'stock_synced' === 'true'
 * 2. OR van_stocks table has 1 or more items with total_qty > 0.
 */
export function isStockSyncedWithPhone(): boolean {
  try {
    const metaSynced = getSyncMeta('stock_synced');
    if (metaSynced === 'true') {
      return true;
    }

    const db = getDatabase();
    const row = db.getFirstSync<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM van_stocks WHERE status = 'Loaded' AND total_qty > 0`
    );
    return Boolean(row && row.cnt > 0);
  } catch (err) {
    console.warn('Error checking if stock is synced with phone:', err);
    return false;
  }
}

/**
 * Returns the salesman bound to this device with active synced stock (if any).
 */
export function getSyncedSalesmanOnPhone(): { id: string; username: string; name: string } | null {
  try {
    const syncedId = getSyncMeta('synced_salesman_id');
    const syncedUser = getSyncMeta('synced_salesman_username');
    const syncedName = getSyncMeta('synced_salesman_name');

    if (syncedId || syncedUser) {
      return {
        id: syncedId || '',
        username: syncedUser || '',
        name: syncedName || ''
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sets the phone's stock-synced status and binds the current salesman.
 */
export function setPhoneStockSynced(
  salesman: { id?: string; username?: string; name?: string } | null,
  isSynced: boolean
): void {
  try {
    if (isSynced && salesman) {
      setSyncMeta('stock_synced', 'true');
      if (salesman.id) setSyncMeta('synced_salesman_id', salesman.id);
      if (salesman.username) setSyncMeta('synced_salesman_username', salesman.username);
      if (salesman.name) setSyncMeta('synced_salesman_name', salesman.name);
      setSyncMeta('stock_synced_at', String(Date.now()));
    } else {
      setSyncMeta('stock_synced', 'false');
      setSyncMeta('synced_salesman_id', '');
      setSyncMeta('synced_salesman_username', '');
      setSyncMeta('synced_salesman_name', '');
      setSyncMeta('stock_synced_at', '');
    }
  } catch (err) {
    console.warn('Error setting phone stock synced meta:', err);
  }
}

/**
 * Resets/clears the phone's stock-sync lock.
 * Called when End of Sale is completed or stock is transferred back to warehouse.
 */
export function clearPhoneStockSync(): void {
  setPhoneStockSynced(null, false);
}
