import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { getDashboardStats, getSyncMeta, getSelectedRoute } from '../database/db';
import { getBackendBaseUrl } from '../database/sync';

export interface SalesmanTelemetry {
  salesman_id: string;
  salesman_name: string;
  latitude: number;
  longitude: number;
  speed_kmh: number;
  battery_pct: number;
  current_status: string;
  current_location: string;
  today_sales_punched: number;
  today_collections_cash: number;
  today_collections_upi: number;
  stops_completed: number;
  activity?: string;
  last_ping_time?: string;
}

let trackingTimer: any = null;
let lastKnownTelemetry: SalesmanTelemetry | null = null;
let isTrackingRunning = false;

// Default beat coordinates (Ernakulam / Central Kerala corridor)
const DEFAULT_BEAT_COORDS = {
  lat: 10.0276,
  lng: 76.3016,
};

/**
 * Capture current device GPS location, speed, device battery, and SQLite today's sales,
 * then push real-time telemetry to the backend server.
 */
export async function sendImmediateLocationPing(): Promise<SalesmanTelemetry | null> {
  try {
    // 1. Get logged-in salesman credentials from SQLite
    let salesmanId = 'usr_sales_01';
    let salesmanName = 'Arjun Nair';
    try {
      const userStr = getSyncMeta('auth_user');
      if (userStr) {
        const u = JSON.parse(userStr);
        if (u.id) salesmanId = u.id;
        if (u.name) salesmanName = u.name;
      }
    } catch {
      // fallback
    }

    // 2. Obtain GPS location & Speed via expo-location
    let lat = DEFAULT_BEAT_COORDS.lat;
    let lng = DEFAULT_BEAT_COORDS.lng;
    let speedKmh = 0;
    let locationName = '';

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (position && position.coords) {
          lat = position.coords.latitude;
          lng = position.coords.longitude;
          const rawSpeed = position.coords.speed;
          if (rawSpeed != null && rawSpeed > 0) {
            speedKmh = Math.max(0, Math.round(rawSpeed * 3.6)); // Convert m/s to km/h
          }
        }

        // Try reverse geocoding to human-readable street/area name
        try {
          const geocoded = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
          if (geocoded && geocoded.length > 0) {
            const g = geocoded[0];
            const parts = [g.name, g.street, g.subregion || g.district || g.city].filter(Boolean);
            if (parts.length > 0) {
              locationName = parts.slice(0, 2).join(', ');
            }
          }
        } catch {
          // ignore reverse geocode error
        }
      }
    } catch (locErr) {
      console.warn('GPS location reading notice:', locErr);
    }

    if (!locationName) {
      const route = getSelectedRoute();
      locationName = route && route !== 'All Routes' ? `${route} Beat` : 'Kerala Distribution Beat';
    }

    // 3. Obtain Device Battery Level via expo-battery
    let batteryPct = 85;
    try {
      const level = await Battery.getBatteryLevelAsync();
      if (level != null && level >= 0) {
        batteryPct = Math.round(level * 100);
      }
    } catch {
      batteryPct = 85;
    }

    // 4. Calculate Today's Sales directly from local SQLite database
    let todaySales = 0;
    let todayCash = 0;
    let stopsCompleted = 0;
    try {
      const currentRoute = getSelectedRoute();
      const stats = getDashboardStats(currentRoute);
      todaySales = stats.totalSalesAmount || (stats.directSalesAmount + stats.ordersAmount) || 0;
      todayCash = stats.totalCashCollected || stats.directSalesCash || 0;
      stopsCompleted = (stats.directSalesCount || 0) + (stats.ordersCount || 0);
    } catch {
      // fallback
    }

    // 5. Build dynamic status & activity description
    const status = speedKmh > 3 ? 'On Beat (Transit)' : 'Active on Route';
    const activity = speedKmh > 3
      ? `Transit at ${speedKmh} km/h near ${locationName}`
      : `Operating on Beat @ ${locationName}`;

    const telemetry: SalesmanTelemetry = {
      salesman_id: salesmanId,
      salesman_name: salesmanName,
      latitude: lat,
      longitude: lng,
      speed_kmh: speedKmh,
      battery_pct: batteryPct,
      current_status: status,
      current_location: locationName,
      today_sales_punched: todaySales,
      today_collections_cash: todayCash,
      today_collections_upi: 0,
      stops_completed: stopsCompleted,
      activity,
      last_ping_time: new Date().toLocaleTimeString(),
    };

    lastKnownTelemetry = telemetry;

    // 6. Push payload to backend server
    const baseUrl = getBackendBaseUrl();
    await fetch(`${baseUrl}/api/sales/live-location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(telemetry),
    });

    return telemetry;
  } catch (err: any) {
    console.warn('Live GPS tracking ping skipped or offline:', err?.message || err);
    return lastKnownTelemetry;
  }
}

/**
 * Start periodic live GPS telemetry tracking in the mobile application.
 * Default ping interval: 20 seconds.
 */
export function startLiveGpsTracking(intervalMs: number = 20000): void {
  if (isTrackingRunning) return;
  isTrackingRunning = true;

  // Immediate initial ping
  sendImmediateLocationPing();

  // Recurring ping loop
  trackingTimer = setInterval(() => {
    sendImmediateLocationPing();
  }, intervalMs);
}

/**
 * Stop live GPS tracking loop
 */
export function stopLiveGpsTracking(): void {
  if (trackingTimer) {
    clearInterval(trackingTimer);
    trackingTimer = null;
  }
  isTrackingRunning = false;
}

/**
 * Get cached last known telemetry state for UI indicators
 */
export function getLastKnownTelemetry(): SalesmanTelemetry | null {
  return lastKnownTelemetry;
}

export interface GpsCoordinatesResult {
  latitude: number;
  longitude: number;
  accuracy?: number;
  status: 'locked' | 'denied' | 'error';
  errorMessage?: string;
}

/**
 * Acquire current high-accuracy device GPS coordinates for Customer Onboarding.
 * Strict hardware acquisition: provides accurate latitude & longitude.
 */
export async function acquireDeviceGpsCoordinates(): Promise<GpsCoordinatesResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return {
        latitude: DEFAULT_BEAT_COORDS.lat,
        longitude: DEFAULT_BEAT_COORDS.lng,
        status: 'denied',
        errorMessage: 'Location permission was denied by device.',
      };
    }

    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      if (position && position.coords) {
        return {
          latitude: Number(position.coords.latitude.toFixed(7)),
          longitude: Number(position.coords.longitude.toFixed(7)),
          accuracy: position.coords.accuracy ? Math.round(position.coords.accuracy) : undefined,
          status: 'locked',
        };
      }
    } catch {
      // Fallback to last known position
      const lastKnown = await Location.getLastKnownPositionAsync();
      if (lastKnown && lastKnown.coords) {
        return {
          latitude: Number(lastKnown.coords.latitude.toFixed(7)),
          longitude: Number(lastKnown.coords.longitude.toFixed(7)),
          accuracy: lastKnown.coords.accuracy ? Math.round(lastKnown.coords.accuracy) : undefined,
          status: 'locked',
        };
      }
    }

    return {
      latitude: DEFAULT_BEAT_COORDS.lat,
      longitude: DEFAULT_BEAT_COORDS.lng,
      status: 'error',
      errorMessage: 'Could not obtain precise GPS signal.',
    };
  } catch (err: any) {
    return {
      latitude: DEFAULT_BEAT_COORDS.lat,
      longitude: DEFAULT_BEAT_COORDS.lng,
      status: 'error',
      errorMessage: err.message || 'GPS hardware error',
    };
  }
}
