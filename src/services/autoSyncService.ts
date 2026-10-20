import { AppState, AppStateStatus } from 'react-native';
import { syncDatabase, getBackendBaseUrl } from '../database/sync';

export interface AutoSyncEvent {
  success: boolean;
  timestamp: number;
  pulledCount: number;
  pushedCount: number;
  error?: string;
  isOnline: boolean;
  reason?: string;
}

export type AutoSyncListener = (event: AutoSyncEvent) => void;

class AutoSyncManager {
  private syncTimer: any = null;
  private isRunning: boolean = false;
  private isSyncInProgress: boolean = false;
  private debounceTimer: any = null;
  private listeners: Set<AutoSyncListener> = new Set();
  private lastSyncTime: number = Date.now();
  private isOnline: boolean = true;
  private lastStatus: 'idle' | 'syncing' | 'synced' | 'offline' | 'error' = 'idle';
  private lastError: string | null = null;
  private lastPulledCount: number = 0;
  private lastPushedCount: number = 0;
  private appStateSubscription: any = null;

  /**
   * Start the automated background synchronization engine.
   * Runs continuously while user is logged in, syncing every intervalMs (default 15s).
   */
  public start(intervalMs: number = 15000): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Trigger initial sync immediately on start
    this.triggerImmediateSync('engine_start');

    // 2. Set up periodic timer for continuous live background sync
    this.syncTimer = setInterval(() => {
      this.triggerImmediateSync('interval_tick');
    }, intervalMs);

    // 3. Listen to AppState changes (Sync immediately when salesman brings app back to foreground)
    this.appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        this.triggerImmediateSync('app_foreground');
      }
    });

    console.log(`[AutoSync] Background live auto-sync engine started (Interval: ${intervalMs}ms)`);
  }

  /**
   * Stop the background auto-sync engine (e.g. on user logout).
   */
  public stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    this.isRunning = false;
    this.isSyncInProgress = false;
    this.lastStatus = 'idle';
    console.log('[AutoSync] Background auto-sync engine stopped');
  }

  /**
   * Add a listener to receive notifications when auto-sync completes.
   * Returns an unsubscribe function.
   */
  public addListener(listener: AutoSyncListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Check if backend server is reachable over internet.
   */
  public async checkConnectivity(): Promise<boolean> {
    try {
      const baseUrl = getBackendBaseUrl();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`${baseUrl}/api/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Trigger an immediate sync cycle (debounced by 300ms to batch rapid local writes).
   * Call this whenever a local SQLite write occurs (sales, orders, payments, expenses, etc.)
   */
  public triggerImmediateSync(reason: string = 'manual'): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.performSync(reason);
    }, 300);
  }

  /**
   * Perform the actual push and pull database synchronization.
   * Operates completely silently without throwing disruptive user alerts.
   */
  public async performSync(reason: string = 'unknown'): Promise<AutoSyncEvent> {
    if (this.isSyncInProgress) {
      // Return current in-flight state without duplicate overlapping calls
      return {
        success: true,
        timestamp: this.lastSyncTime,
        pulledCount: this.lastPulledCount,
        pushedCount: this.lastPushedCount,
        isOnline: this.isOnline,
        reason,
      };
    }

    this.isSyncInProgress = true;
    this.lastStatus = 'syncing';
    this.notifyListeners({
      success: true,
      timestamp: Date.now(),
      pulledCount: 0,
      pushedCount: 0,
      isOnline: this.isOnline,
      reason: 'sync_started',
    });

    try {
      // 1. Verify live internet & backend connectivity
      const isConnected = await this.checkConnectivity();
      if (!isConnected) {
        this.isOnline = false;
        this.lastStatus = 'offline';
        const offlineEvent: AutoSyncEvent = {
          success: false,
          timestamp: this.lastSyncTime,
          pulledCount: 0,
          pushedCount: 0,
          error: 'No internet connection or server unreachable',
          isOnline: false,
          reason,
        };
        this.notifyListeners(offlineEvent);
        return offlineEvent;
      }

      this.isOnline = true;

      // 2. Execute push and pull through core sync routine
      const result = await syncDatabase();
      this.lastSyncTime = Date.now();
      this.lastPulledCount = result.pulledCount || 0;
      this.lastPushedCount = result.pushedCount || 0;
      this.lastStatus = 'synced';
      this.lastError = null;

      const successEvent: AutoSyncEvent = {
        success: true,
        timestamp: this.lastSyncTime,
        pulledCount: this.lastPulledCount,
        pushedCount: this.lastPushedCount,
        isOnline: true,
        reason,
      };

      this.notifyListeners(successEvent);
      return successEvent;
    } catch (err: any) {
      this.lastError = err?.message || 'Sync failed';
      this.lastStatus = 'error';
      // If error indicates network failure, update isOnline status
      if (err?.message?.includes('Network request failed') || err?.name === 'AbortError') {
        this.isOnline = false;
        this.lastStatus = 'offline';
      }

      const errorEvent: AutoSyncEvent = {
        success: false,
        timestamp: this.lastSyncTime,
        pulledCount: 0,
        pushedCount: 0,
        error: this.lastError || undefined,
        isOnline: this.isOnline,
        reason,
      };

      this.notifyListeners(errorEvent);
      return errorEvent;
    } finally {
      this.isSyncInProgress = false;
    }
  }

  private notifyListeners(event: AutoSyncEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (e) {
        console.warn('[AutoSync] Error in sync listener callback:', e);
      }
    });
  }

  /**
   * Get current sync status snapshot for UI indicators
   */
  public getState() {
    return {
      isRunning: this.isRunning,
      isSyncing: this.isSyncInProgress,
      isOnline: this.isOnline,
      lastSyncTime: this.lastSyncTime,
      lastStatus: this.lastStatus,
      lastError: this.lastError,
      lastPulledCount: this.lastPulledCount,
      lastPushedCount: this.lastPushedCount,
    };
  }
}

// Global Singleton Instance
export const autoSyncService = new AutoSyncManager();

export function startAutoSyncEngine(intervalMs: number = 15000): void {
  autoSyncService.start(intervalMs);
}

export function stopAutoSyncEngine(): void {
  autoSyncService.stop();
}

export function triggerImmediateSync(reason: string = 'action'): void {
  autoSyncService.triggerImmediateSync(reason);
}

export function getAutoSyncState() {
  return autoSyncService.getState();
}

export function addAutoSyncListener(listener: AutoSyncListener): () => void {
  return autoSyncService.addListener(listener);
}
