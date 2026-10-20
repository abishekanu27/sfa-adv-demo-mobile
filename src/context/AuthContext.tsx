import React, { createContext, useContext, useState, useEffect } from 'react';
import { getSyncMeta, setSyncMeta, clearSalesmanLocalData, getCompanyProfile } from '../database/db';
import { getBackendBaseUrl, syncDatabase, syncCompanyProfile } from '../database/sync';
import { stopAutoSyncEngine } from '../services/autoSyncService';
import {
  getOrCreateDeviceId,
  getDeviceDisplayName,
  getDeviceModel,
  isStockSyncedWithPhone,
  getSyncedSalesmanOnPhone,
} from '../utils/deviceInfo';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  role_code?: string;
  role_name?: string;
  can_login_mobile?: boolean;
  phone?: string;
  avatar?: string;
  branch_id?: number;
  branch_name?: string;
  assigned_warehouse_id?: number;
  assigned_location?: string;
  assigned_beats?: string[];
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (usernameOrEmail: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isLoading: true,
  login: async () => ({ success: false }),
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session from SQLite on startup
  useEffect(() => {
    try {
      const savedToken = getSyncMeta('auth_token');
      const savedUserStr = getSyncMeta('auth_user');

      if (savedToken && savedUserStr) {
        const parsedUser = JSON.parse(savedUserStr);
        const role = (parsedUser.role || parsedUser.role_code || '').toUpperCase();
        const isSales = [
          'SALESMAN',
          'SALES_EXECUTIVE',
          'FIELD_SALES',
          'SLMN',
          'SALES',
          'FIELD_REP',
          'SALES_REP',
          'DRIVER',
          'VAN_SALES'
        ].includes(role) || parsedUser.can_login_mobile === true;

        if (!isSales) {
          // Clear any unauthorized web role session on mobile startup
          console.warn('Clearing invalid session for web role on mobile:', role);
          setSyncMeta('auth_token', '');
          setSyncMeta('auth_user', '');
          setUser(null);
          setToken(null);
        } else {
          setUser(parsedUser);
          setToken(savedToken);
          // Auto-fetch company details and sales requirements from Web in background
          syncCompanyProfile().catch(() => {});
          syncDatabase().catch(() => {});
        }
      }
    } catch (e) {
      console.warn('Failed to restore auth session from SQLite:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = async (
    usernameOrEmail: string,
    password: string
  ): Promise<{ success: boolean; message?: string }> => {
    const trimmedIdentifier = usernameOrEmail.trim();
    if (!trimmedIdentifier || !password) {
      return { success: false, message: 'Please enter username and password.' };
    }

    const deviceId = getOrCreateDeviceId();
    const deviceName = getDeviceDisplayName();
    const deviceModel = getDeviceModel();

    // 1. Local Pre-check: If stock has been synced with this phone, ensure it is the same salesman
    if (isStockSyncedWithPhone()) {
      const syncedSalesman = getSyncedSalesmanOnPhone();
      const normInput = trimmedIdentifier.toLowerCase();
      const isMatch =
        syncedSalesman &&
        ((syncedSalesman.id && syncedSalesman.id.toLowerCase() === normInput) ||
         (syncedSalesman.username && syncedSalesman.username.toLowerCase() === normInput));

      if (syncedSalesman && !isMatch) {
        return {
          success: false,
          message: 'A salesman already synced and cannot login with another account',
        };
      }
    }

    const baseUrl = getBackendBaseUrl();

    try {
      // 2. Attempt API login with device identification
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-type': 'mobile',
          'x-device-id': deviceId,
          'x-device-name': deviceName,
          'x-device-model': deviceModel,
        },
        body: JSON.stringify({
          usernameOrEmail: trimmedIdentifier,
          password,
          client_type: 'mobile',
          device_id: deviceId,
          device_name: deviceName,
          device_model: deviceModel,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Enforce role permission check for mobile app
        if (data.user?.can_login_mobile === false) {
          return {
            success: false,
            message: `Access Restricted: Your account (${data.user.role_name || data.user.role}) is configured for Web Portal access only. Only Field Sales representatives are authorized to log into the Mobile App.`,
          };
        }

        const authUser: AuthUser = {
          id: data.user.id,
          username: data.user.username,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role || data.user.role_name || 'SALES_EXECUTIVE',
          role_code: data.user.role_code || data.user.role,
          role_name: data.user.role_name,
          can_login_mobile: data.user.can_login_mobile,
          phone: data.user.phone,
          avatar: data.user.avatar,
          branch_id: data.user.branch_id,
          branch_name: data.user.branch_name,
          assigned_warehouse_id: data.user.assigned_warehouse_id,
          assigned_location: data.user.assigned_location,
          assigned_beats: data.user.assigned_beats,
        };

        // If logging in as a different user AND stock is not synced, clear previous salesman's local van stocks and bookings
        try {
          const lastUserId = getSyncMeta('last_logged_in_user_id');
          const lastBranchId = getSyncMeta('last_logged_in_branch_id');
          const previousSavedUserStr = getSyncMeta('auth_user');
          let prevId = lastUserId;
          let prevBranch = lastBranchId;
          if ((!prevId || !prevBranch) && previousSavedUserStr) {
            try {
              const parsed = JSON.parse(previousSavedUserStr);
              if (!prevId) prevId = parsed?.id;
              if (!prevBranch) prevBranch = String(parsed?.branch_id || '');
            } catch {}
          }
          const currentBranchStr = String(authUser.branch_id || '');
          if ((prevId && prevId !== authUser.id) || (prevBranch && prevBranch !== currentBranchStr)) {
            // Only clear data if stock has NOT been synced with this phone
            if (!isStockSyncedWithPhone()) {
              clearSalesmanLocalData();
            }
          }
          setSyncMeta('last_logged_in_user_id', authUser.id);
          setSyncMeta('last_logged_in_branch_id', currentBranchStr);
        } catch {}

        setUser(authUser);
        setToken(data.token);

        // Persist session to local SQLite
        setSyncMeta('auth_token', data.token);
        setSyncMeta('auth_user', JSON.stringify(authUser));
        setSyncMeta('user_session_pwd', password);

        // Await synchronization so assigned vehicle, routes, customers, and clean shift stats are populated before Dashboard renders
        try {
          await Promise.all([
            syncCompanyProfile().catch(e => console.warn('Company sync warning on login:', e)),
            syncDatabase().catch(e => console.warn('Database sync warning on login:', e)),
          ]);
        } catch (syncErr) {
          console.warn('Post-login sync error:', syncErr);
        }

        return { success: true };
      } else {
        return { success: false, message: data.message || 'Invalid credentials' };
      }
    } catch (networkError: any) {
      console.log('Network login attempt failed, checking offline demo / cached credentials...');

      // 3. Offline Fallback strictly for field sales (if device has no network connection)
      const cachedCompany = getCompanyProfile();
      if (cachedCompany?.mobile_access_enabled === false) {
        return {
          success: false,
          message: 'Access Restricted: Mobile Application access is currently disabled by Super Administrator. Login with existing credentials is not permitted.',
        };
      }

      // Check again if phone has active synced stock for another salesman
      if (isStockSyncedWithPhone()) {
        const syncedSalesman = getSyncedSalesmanOnPhone();
        const normInput = trimmedIdentifier.toLowerCase();
        const isMatch =
          syncedSalesman &&
          ((syncedSalesman.id && syncedSalesman.id.toLowerCase() === normInput) ||
           (syncedSalesman.username && syncedSalesman.username.toLowerCase() === normInput));

        if (syncedSalesman && !isMatch) {
          return {
            success: false,
            message: 'A salesman already synced and cannot login with another account',
          };
        }
      }

      const lower = trimmedIdentifier.toLowerCase();
      if (
        (lower === 'abi' && password === '12345678') ||
        (lower === '7012751254' && password === '12345678') ||
        (lower === 'sales' && password === 'Sales123')
      ) {
        const isAbi = lower === 'abi' || lower === '7012751254';
        const offlineUser: AuthUser = {
          id: isAbi ? 'usr_abi_5604' : 'usr_sales_04',
          username: isAbi ? 'abi' : 'sales',
          name: isAbi ? 'Abishek' : 'David Rodriguez (Field Sales)',
          email: isAbi ? 'abi@123.com' : 'sales@salesforce.com',
          role: isAbi ? 'SALESMAN' : 'SALES_EXECUTIVE',
          phone: isAbi ? '7012751254' : '+91 98765 43210',
        };
        const offlineToken = `offline_token_${Date.now()}`;

        // If switching user in offline mode and stock is not synced, clear previous salesman data
        try {
          const lastUserId = getSyncMeta('last_logged_in_user_id');
          const lastBranchId = getSyncMeta('last_logged_in_branch_id');
          const previousSavedUserStr = getSyncMeta('auth_user');
          let prevId = lastUserId;
          let prevBranch = lastBranchId;
          if ((!prevId || !prevBranch) && previousSavedUserStr) {
            try {
              const parsed = JSON.parse(previousSavedUserStr);
              if (!prevId) prevId = parsed?.id;
              if (!prevBranch) prevBranch = String(parsed?.branch_id || '');
            } catch {}
          }
          const currentBranchStr = String(offlineUser.branch_id || '');
          if ((prevId && prevId !== offlineUser.id) || (prevBranch && prevBranch !== currentBranchStr)) {
            if (!isStockSyncedWithPhone()) {
              clearSalesmanLocalData();
            }
          }
          setSyncMeta('last_logged_in_user_id', offlineUser.id);
          setSyncMeta('last_logged_in_branch_id', currentBranchStr);
        } catch {}

        setUser(offlineUser);
        setToken(offlineToken);

        setSyncMeta('auth_token', offlineToken);
        setSyncMeta('auth_user', JSON.stringify(offlineUser));
        setSyncMeta('user_session_pwd', password);

        return { success: true, message: 'Logged in using offline mode.' };
      }

      return {
        success: false,
        message: `Could not connect to backend server (${baseUrl}). Please check Wi-Fi or contact administrator.`,
      };
    }
  };

  const logout = async () => {
    stopAutoSyncEngine();
    setUser(null);
    setToken(null);
    try {
      setSyncMeta('auth_token', '');
      setSyncMeta('auth_user', '');
      setSyncMeta('user_session_pwd', '');
      // If stock is NOT synced, clean up salesman data for fresh login.
      // If stock IS synced, preserve local van stocks & device binding until End of Sale is submitted.
      if (!isStockSyncedWithPhone()) {
        setSyncMeta('last_logged_in_user_id', '');
        clearSalesmanLocalData(false);
      }
    } catch (e) {
      console.warn('Failed to clear SQLite auth tokens:', e);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
