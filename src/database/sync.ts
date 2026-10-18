import Constants from 'expo-constants';
import {
  getDatabase,
  getSyncMeta,
  setSyncMeta,
  setAssignedRoute,
  getSelectedRoute,
  setSelectedRoute,
  getAvailableRoutes,
  replaceVanStocks,
  replaceWarehouseStocks,
  replaceProducts,
  replacePriceGroups,
  setCompanyProfile,
  getCompanyProfile,
  setAvailableSalesmen,
  CompanyProfile,
  CustomerRecord,
  BookingRecord,
  ExpenseRecord,
  VanStockRecord,
  WarehouseStockRecord,
  ProductRecord,
  RouteInfo,
  upsertExpenses,
  replaceSchemes,
  SchemeRecord,
} from './db';
import { getOrCreateDeviceId, setPhoneStockSynced } from '../utils/deviceInfo';

export function getBackendBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl && envUrl.trim() !== '') {
    // Strip trailing slash and trailing /api so baseUrl is always the clean domain root
    return envUrl.trim().replace(/\/api\/?$/i, '').replace(/\/+$/, '');
  }

  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:5000`;
  }

  return 'https://sfa-demo-api.onrender.com';
}

export async function syncDatabase(): Promise<{
  success: boolean;
  pulledCount: number;
  pushedCount: number;
  routeInfo?: RouteInfo | null;
  vanStocksCount?: number;
  warehouseStocksCount?: number;
  productsCount?: number;
}> {
  const db = getDatabase();
  const baseUrl = getBackendBaseUrl();
  const lastPulledAt = parseInt(getSyncMeta('lastPulledAt') || '0', 10);

  // 1. PUSH LOCAL CHANGES
  const localCreatedCustomers = db.getAllSync<CustomerRecord>(
    `SELECT * FROM customers WHERE _status = 'created'`
  );
  const localUpdatedCustomers = db.getAllSync<CustomerRecord>(
    `SELECT * FROM customers WHERE _status = 'updated'`
  );
  const localCreatedBookings = db.getAllSync<BookingRecord>(
    `SELECT * FROM advance_bookings WHERE _status = 'created'`
  );
  const localUpdatedBookings = db.getAllSync<BookingRecord>(
    `SELECT * FROM advance_bookings WHERE _status = 'updated'`
  );

  const localCreatedTransfers = db.getAllSync<any>(
    `SELECT * FROM van_transfers WHERE _status = 'created'`
  );
  const localUpdatedTransfers = db.getAllSync<any>(
    `SELECT * FROM van_transfers WHERE _status = 'updated'`
  );

  const localCreatedExpenses = db.getAllSync<ExpenseRecord>(
    `SELECT * FROM expenses WHERE _status = 'created'`
  );
  const localUpdatedExpenses = db.getAllSync<ExpenseRecord>(
    `SELECT * FROM expenses WHERE _status = 'updated'`
  );

  const localCreatedStockRequests = db.getAllSync<any>(
    `SELECT * FROM stock_requests WHERE _status = 'created'`
  );
  const localUpdatedStockRequests = db.getAllSync<any>(
    `SELECT * FROM stock_requests WHERE _status = 'updated'`
  );

  const hasPushChanges =
    localCreatedCustomers.length > 0 ||
    localUpdatedCustomers.length > 0 ||
    localCreatedBookings.length > 0 ||
    localUpdatedBookings.length > 0 ||
    localCreatedTransfers.length > 0 ||
    localUpdatedTransfers.length > 0 ||
    localCreatedExpenses.length > 0 ||
    localUpdatedExpenses.length > 0 ||
    localCreatedStockRequests.length > 0 ||
    localUpdatedStockRequests.length > 0;

  let pushedCount = 0;

  if (hasPushChanges) {
    let authUserPush: any = null;
    try {
      const rawUser = getSyncMeta('auth_user');
      if (rawUser) authUserPush = JSON.parse(rawUser);
    } catch {}

    const pushPayload = {
      salesman_id: authUserPush?.id || '',
      salesman_name: authUserPush?.name || authUserPush?.username || '',
      branch_id: authUserPush?.branch_id || 1,
      branch_name: authUserPush?.branch_name || 'Main Branch & Central Depot',
      changes: {
        customers: {
          created: localCreatedCustomers,
          updated: localUpdatedCustomers,
          deleted: [],
        },
        advance_bookings: {
          created: localCreatedBookings,
          updated: localUpdatedBookings,
          deleted: [],
        },
        van_transfers: {
          created: localCreatedTransfers,
          updated: localUpdatedTransfers,
          deleted: [],
        },
        expenses: {
          created: localCreatedExpenses,
          updated: localUpdatedExpenses,
          deleted: [],
        },
        stock_requests: {
          created: localCreatedStockRequests,
          updated: localUpdatedStockRequests,
          deleted: [],
        },
      },
      lastPulledAt,
    };

    const pushRes = await fetch(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pushPayload),
    });

    if (!pushRes.ok) {
      const errText = await pushRes.text();
      throw new Error(`Push failed (${pushRes.status}): ${errText}`);
    }

    db.runSync(`UPDATE customers SET _status = 'synced' WHERE _status IN ('created', 'updated')`);
    db.runSync(`UPDATE advance_bookings SET _status = 'synced' WHERE _status IN ('created', 'updated')`);
    db.runSync(`UPDATE van_transfers SET _status = 'synced' WHERE _status IN ('created', 'updated')`);
    db.runSync(`UPDATE expenses SET _status = 'synced' WHERE _status IN ('created', 'updated')`);
    db.runSync(`UPDATE stock_requests SET _status = 'synced' WHERE _status IN ('created', 'updated')`);

    pushedCount =
      localCreatedCustomers.length +
      localUpdatedCustomers.length +
      localCreatedBookings.length +
      localUpdatedBookings.length +
      localCreatedTransfers.length +
      localUpdatedTransfers.length +
      localCreatedExpenses.length +
      localUpdatedExpenses.length +
      localCreatedStockRequests.length +
      localUpdatedStockRequests.length;
  }

  // 2. PULL SERVER CHANGES WITH SALESMAN & ROUTE IDENTITY
  let authUser: any = null;
  try {
    const rawUser = getSyncMeta('auth_user');
    if (rawUser) authUser = JSON.parse(rawUser);
  } catch {}

  const salesmanId = authUser?.id || '';
  const username = authUser?.username || '';
  const phone = authUser?.phone || '';

  // Cleanse any residual bookings from previous salesmen
  if (salesmanId) {
    try {
      db.runSync(
        `DELETE FROM advance_bookings WHERE salesman_id IS NOT NULL AND salesman_id != '' AND salesman_id != ?`,
        [salesmanId]
      );
    } catch {}
  }

  const localBookingCount = db.getFirstSync<{ c: number }>(`SELECT COUNT(*) as c FROM advance_bookings`)?.c || 0;
  const effectiveLastPulledAt = localBookingCount === 0 ? 0 : lastPulledAt;

  const deviceId = getOrCreateDeviceId();
  const pullUrl = `${baseUrl}/api/sync/pull?lastPulledAt=${effectiveLastPulledAt}&salesman_id=${encodeURIComponent(
    salesmanId
  )}&username=${encodeURIComponent(username)}&phone=${encodeURIComponent(phone)}&device_id=${encodeURIComponent(deviceId)}`;

  const pullRes = await fetch(pullUrl, {
    headers: {
      'x-device-id': deviceId,
    },
  });
  if (!pullRes.ok) {
    const errText = await pullRes.text();
    throw new Error(`Pull failed (${pullRes.status}): ${errText}`);
  }

  const pullData = await pullRes.json();
  const {
    changes,
    route_info,
    van_stocks,
    warehouse_stocks,
    company_settings,
    products,
    price_groups,
    product_prices,
    schemes,
    all_server_booking_ids,
    all_server_customer_ids,
    available_salesmen,
    timestamp,
  } = pullData;
  let pulledCount = 0;

  // Save Promotional Schemes & Offers from Web
  if (Array.isArray(schemes)) {
    replaceSchemes(schemes);
  }

  // Save Available Peer Salesmen (from Web route mappings)
  if (Array.isArray(available_salesmen)) {
    setAvailableSalesmen(available_salesmen);
  }

  // Save Company Profile & Print Settings (From Web App settings)
  if (company_settings) {
    setCompanyProfile(company_settings);
  }

  // Save Master Products Catalog from Web
  if (Array.isArray(products)) {
    replaceProducts(products);
  }

  // Save Selling Price Groups and Custom Pricing from Web
  if (Array.isArray(price_groups) && Array.isArray(product_prices)) {
    replacePriceGroups(price_groups, product_prices);
  }

  // Persist authorized branch info from server
  if (pullData.authorized_branch_id) {
    setSyncMeta('authorized_branch_id', String(pullData.authorized_branch_id));
  } else if (pullData.branch?.branch_id) {
    setSyncMeta('authorized_branch_id', String(pullData.branch.branch_id));
  }
  if (pullData.authorized_branch_name) {
    setSyncMeta('authorized_branch_name', String(pullData.authorized_branch_name));
  } else if (pullData.branch?.branch_name) {
    setSyncMeta('authorized_branch_name', String(pullData.branch.branch_name));
  }

  // Save Route Info (Assigned Beat & Vehicle)
  if (route_info) {
    setAssignedRoute(route_info);
    const available = getAvailableRoutes();
    const currentSelected = getSyncMeta('selected_route');
    if (!currentSelected || !available.includes(currentSelected)) {
      if (available.length > 0) {
        setSelectedRoute(available[0]);
      }
    }
  } else {
    // Explicitly clear assigned route and vehicle if salesman has no active vehicle/route assigned on Web
    setAssignedRoute(null);
    setSelectedRoute('');
  }

  // Save Van Stock (Ponny, etc.)
  if (Array.isArray(van_stocks)) {
    replaceVanStocks(van_stocks);
    const totalLoadedQty = van_stocks.reduce(
      (acc: number, item: any) => acc + (parseFloat(item.total_qty || item.quantity || 0) || 0),
      0
    );
    if (totalLoadedQty > 0 && authUser) {
      setPhoneStockSynced(authUser, true);
    }
  }

  // Save Central Warehouse Stocks across all warehouses
  if (Array.isArray(warehouse_stocks)) {
    replaceWarehouseStocks(warehouse_stocks);
  }

  // 1. Reconcile deleted customers from server (Web deletions)
  if (Array.isArray(all_server_customer_ids)) {
    const serverCustSet = new Set(all_server_customer_ids.map(String));
    const localSyncedCustomers = db.getAllSync<{
      id: string;
      backend_id?: number | null;
      customer_code?: string | null;
    }>(`SELECT id, backend_id, customer_code FROM customers WHERE _status = 'synced'`);

    for (const localC of localSyncedCustomers) {
      const isPresent =
        serverCustSet.has(String(localC.id)) ||
        (localC.backend_id != null && serverCustSet.has(String(localC.backend_id))) ||
        (localC.customer_code && serverCustSet.has(String(localC.customer_code)));
      if (!isPresent) {
        db.runSync(`DELETE FROM customers WHERE id = ?`, [localC.id]);
      }
    }
  }

  // 2. Reconcile deleted / settled advance bookings from server (synced records)
  // Any record marked '_status = synced' that is confirmed saved to backend and now settled/deleted is removed locally.
  if (Array.isArray(all_server_booking_ids)) {
    const serverBookingSet = new Set(all_server_booking_ids.map(String));
    const localSyncedBookings = db.getAllSync<{
      id: string;
      backend_id?: number | null;
      booking_code?: string | null;
    }>(`SELECT id, backend_id, booking_code FROM advance_bookings WHERE _status = 'synced'`);

    for (const localB of localSyncedBookings) {
      const isPresent =
        serverBookingSet.has(String(localB.id)) ||
        (localB.backend_id != null && serverBookingSet.has(String(localB.backend_id))) ||
        (localB.booking_code && serverBookingSet.has(String(localB.booking_code)));
      if (!isPresent) {
        db.runSync(`DELETE FROM advance_bookings WHERE id = ?`, [localB.id]);
      }
    }
  }

  if (changes) {
    // Upsert Customers
    const serverCustomers = [
      ...(changes.customers?.created || []),
      ...(changes.customers?.updated || []),
    ];
    for (const c of serverCustomers) {
      if (c.backend_id != null || c.customer_code || c.name) {
        db.runSync(
          `DELETE FROM customers WHERE id != ? AND (
            (backend_id IS NOT NULL AND backend_id = ?) OR
            (customer_code IS NOT NULL AND customer_code = ?) OR
            LOWER(name) = LOWER(?)
          )`,
          [c.id, c.backend_id ?? -1, c.customer_code ?? '', c.name]
        );
      }
      db.runSync(
        `INSERT INTO customers (
          id, backend_id, customer_code, name, contact_person, phone, email, place, address, route_area, district, state, gst_in, credit_limit, credit_days, outstanding_balance, price_group_id, price_group_name, local_area, status, latitude, longitude, branch_id, branch_name, assigned_salesman_id, assigned_salesman_name, _status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          backend_id = excluded.backend_id,
          customer_code = excluded.customer_code,
          name = excluded.name,
          contact_person = excluded.contact_person,
          phone = excluded.phone,
          email = excluded.email,
          place = excluded.place,
          address = excluded.address,
          route_area = excluded.route_area,
          district = excluded.district,
          state = excluded.state,
          gst_in = excluded.gst_in,
          credit_limit = excluded.credit_limit,
          credit_days = excluded.credit_days,
          outstanding_balance = excluded.outstanding_balance,
          price_group_id = excluded.price_group_id,
          price_group_name = excluded.price_group_name,
          local_area = excluded.local_area,
          status = excluded.status,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          branch_id = excluded.branch_id,
          branch_name = excluded.branch_name,
          assigned_salesman_id = excluded.assigned_salesman_id,
          assigned_salesman_name = excluded.assigned_salesman_name,
          _status = 'synced',
          updated_at = excluded.updated_at`,
        [
          c.id,
          c.backend_id ?? null,
          c.customer_code ?? null,
          c.name,
          c.contact_person ?? null,
          c.phone ?? null,
          c.email ?? null,
          c.place ?? null,
          c.address ?? null,
          c.route_area ?? null,
          c.district ?? 'Palakkad',
          c.state ?? 'Kerala',
          c.gst_in ?? null,
          Number(c.credit_limit) || 0,
          Number(c.credit_days) || 30,
          Number(c.outstanding_balance) || 0,
          c.price_group_id ?? null,
          c.price_group_name ?? null,
          c.local_area ?? null,
          c.status ?? 'Active',
          c.latitude != null ? Number(c.latitude) : null,
          c.longitude != null ? Number(c.longitude) : null,
          c.branch_id ?? 1,
          c.branch_name ?? 'Main Branch & Central Depot',
          c.assigned_salesman_id ?? null,
          c.assigned_salesman_name ?? null,
          c.created_at || Date.now(),
          c.updated_at || Date.now(),
        ]
      );
      pulledCount++;
    }

    // Upsert Bookings
    const serverBookings = [
      ...(changes.advance_bookings?.created || []),
      ...(changes.advance_bookings?.updated || []),
    ];
    for (const b of serverBookings) {
      // Find if we already have this record locally either by booking_code, backend_id, or id
      let existingLocal = null;
      if (b.booking_code) {
        existingLocal = db.getFirstSync<{ id: string }>(
          `SELECT id FROM advance_bookings WHERE booking_code = ? LIMIT 1`,
          [b.booking_code]
        );
      }
      if (!existingLocal && b.backend_id != null) {
        existingLocal = db.getFirstSync<{ id: string }>(
          `SELECT id FROM advance_bookings WHERE backend_id = ? LIMIT 1`,
          [b.backend_id]
        );
      }
      const targetId = existingLocal?.id || b.id;

      // Ensure no duplicate records remain with the same booking_code or backend_id
      if (b.booking_code || b.backend_id != null) {
        db.runSync(
          `DELETE FROM advance_bookings WHERE id != ? AND (
            (booking_code IS NOT NULL AND booking_code != '' AND booking_code = ?) OR
            (backend_id IS NOT NULL AND backend_id = ?)
          )`,
          [targetId, b.booking_code ?? '', b.backend_id ?? -1]
        );
      }

      const saleType = b.sale_type || (b.status === 'Delivered' ? 'sale' : 'order');
      const itemsVal = b.items ? (typeof b.items === 'object' ? JSON.stringify(b.items) : String(b.items)) : null;
      db.runSync(
        `INSERT INTO advance_bookings (
          id, backend_id, booking_code, salesman_id, salesman_name, customer_id, customer_name, product_id, product_name, package_qty, total_qty, unit_price, total_amount, advance_amount, balance_amount, status, notes, sale_type, items, discount_amount, round_off, branch_id, branch_name, _status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          backend_id = excluded.backend_id,
          booking_code = excluded.booking_code,
          salesman_id = excluded.salesman_id,
          salesman_name = excluded.salesman_name,
          customer_id = excluded.customer_id,
          customer_name = excluded.customer_name,
          product_id = excluded.product_id,
          product_name = excluded.product_name,
          package_qty = excluded.package_qty,
          total_qty = excluded.total_qty,
          unit_price = excluded.unit_price,
          total_amount = excluded.total_amount,
          advance_amount = excluded.advance_amount,
          balance_amount = excluded.balance_amount,
          status = excluded.status,
          notes = excluded.notes,
          sale_type = excluded.sale_type,
          items = excluded.items,
          discount_amount = excluded.discount_amount,
          round_off = excluded.round_off,
          branch_id = excluded.branch_id,
          branch_name = excluded.branch_name,
          _status = 'synced',
          updated_at = excluded.updated_at`,
        [
          targetId,
          b.backend_id ?? null,
          b.booking_code ?? null,
          b.salesman_id ?? null,
          b.salesman_name ?? null,
          b.customer_id ?? null,
          b.customer_name,
          b.product_id ?? null,
          b.product_name,
          b.package_qty ?? 1,
          b.total_qty,
          b.unit_price,
          b.total_amount,
          b.advance_amount ?? 0,
          b.balance_amount ?? 0,
          b.status ?? 'Confirmed',
          b.notes ?? null,
          saleType,
          itemsVal,
          b.discount_amount != null ? Number(b.discount_amount) : 0,
          b.round_off != null ? Number(b.round_off) : 0,
          b.branch_id ?? 1,
          b.branch_name ?? 'Main Branch & Central Depot',
          b.created_at || Date.now(),
          b.updated_at || Date.now(),
        ]
      );
      pulledCount++;
    }

    // Upsert Van Transfers (incoming from server)
    const serverTransfers = [
      ...(changes?.van_transfers?.created || []),
      ...(changes?.van_transfers?.updated || []),
      ...(pullData.van_transfers || []),
    ];
    const seenTransferCodes = new Set<string>();
    for (const t of serverTransfers) {
      const codeKey = t.transfer_code || String(t.transfer_id || t.id);
      if (seenTransferCodes.has(codeKey)) continue;
      seenTransferCodes.add(codeKey);

      let localId: string | null = null;
      if (t.transfer_code) {
        const match = db.getFirstSync<{ id: string }>(`SELECT id FROM van_transfers WHERE transfer_code = ? LIMIT 1`, [t.transfer_code]);
        if (match) localId = match.id;
      }
      if (!localId && t.transfer_id) {
        const match = db.getFirstSync<{ id: string }>(`SELECT id FROM van_transfers WHERE id = ? LIMIT 1`, [`vt_srv_${t.transfer_id}`]);
        if (match) localId = match.id;
      }
      const targetId = localId || (t.transfer_id ? `vt_srv_${t.transfer_id}` : (t.id || `vt_srv_${t.transfer_code}`));
      const createdAt = t.requested_at ? new Date(t.requested_at).getTime() : (Number(t.created_at) || Date.now());
      const updatedAt = t.completed_at ? new Date(t.completed_at).getTime() : (Number(t.updated_at) || Date.now());

      db.runSync(
        `INSERT INTO van_transfers (
          id, transfer_code, source_salesman_id, source_salesman_name, source_vehicle_reg, target_salesman_id, target_salesman_name, target_vehicle_reg, product_id, product_name, product_sku, package_type, quantity, reason, location_of_exchange, status, notes, _status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          transfer_code = excluded.transfer_code,
          source_salesman_id = excluded.source_salesman_id,
          source_salesman_name = excluded.source_salesman_name,
          source_vehicle_reg = excluded.source_vehicle_reg,
          target_salesman_id = excluded.target_salesman_id,
          target_salesman_name = excluded.target_salesman_name,
          target_vehicle_reg = excluded.target_vehicle_reg,
          product_id = excluded.product_id,
          product_name = excluded.product_name,
          product_sku = excluded.product_sku,
          package_type = excluded.package_type,
          quantity = excluded.quantity,
          reason = excluded.reason,
          location_of_exchange = excluded.location_of_exchange,
          status = excluded.status,
          notes = excluded.notes,
          _status = 'synced',
          updated_at = excluded.updated_at`,
        [
          targetId,
          t.transfer_code ?? null,
          t.source_salesman_id ?? null,
          t.source_salesman_name || 'Sales Representative',
          t.source_vehicle_reg || 'N/A',
          t.target_salesman_id ?? null,
          t.target_salesman_name,
          t.target_vehicle_reg ?? '',
          t.product_id ?? null,
          t.product_name,
          t.product_sku ?? '',
          t.package_type ?? 'Loose',
          Number(t.quantity) || 0,
          t.reason ?? 'Beat stock balance',
          t.location_of_exchange ?? 'Kerala Corridor',
          t.status ?? 'Pending',
          t.notes ?? '',
          createdAt,
          updatedAt,
        ]
      );
      pulledCount++;
    }

    // Upsert Expenses (incoming from server)
    const serverExpenses = [
      ...(changes?.expenses?.created || []),
      ...(changes?.expenses?.updated || []),
      ...(pullData.expenses || []),
    ];
    if (serverExpenses.length > 0) {
      upsertExpenses(serverExpenses);
      pulledCount += serverExpenses.length;
    }

    // Reconcile settled/deleted expenses from server (synced records)
    const serverExpenseIds = new Set(serverExpenses.map((e: any) => String(e.id || e.expense_code)));
    const localSyncedExpenses = db.getAllSync<{ id: string; expense_code?: string }>(
      `SELECT id, expense_code FROM expenses WHERE _status = 'synced'`
    );
    for (const localExp of localSyncedExpenses) {
      const isPresent =
        serverExpenseIds.has(String(localExp.id)) ||
        (localExp.expense_code && serverExpenseIds.has(String(localExp.expense_code)));
      if (!isPresent) {
        db.runSync(`DELETE FROM expenses WHERE id = ?`, [localExp.id]);
      }
    }

    // Upsert Stock Requests (incoming from server)
    const serverStockRequests = [
      ...(changes?.stock_requests?.created || []),
      ...(changes?.stock_requests?.updated || []),
      ...(pullData.stock_requests || []),
    ];
    const seenStockReqCodes = new Set<string>();
    for (const sr of serverStockRequests) {
      const codeKey = sr.request_code || String(sr.request_id || sr.id);
      if (seenStockReqCodes.has(codeKey)) continue;
      seenStockReqCodes.add(codeKey);

      let localId: string | null = null;
      if (sr.request_code) {
        const match = db.getFirstSync<{ id: string }>(`SELECT id FROM stock_requests WHERE request_code = ? LIMIT 1`, [sr.request_code]);
        if (match) localId = match.id;
      }
      if (!localId && sr.request_id) {
        const match = db.getFirstSync<{ id: string }>(`SELECT id FROM stock_requests WHERE id = ? LIMIT 1`, [`sr_srv_${sr.request_id}`]);
        if (match) localId = match.id;
      }
      if (!localId && sr.product_name) {
        const match = db.getFirstSync<{ id: string }>(
          `SELECT id FROM stock_requests WHERE LOWER(product_name) = LOWER(?) LIMIT 1`,
          [sr.product_name]
        );
        if (match) localId = match.id;
      }
      const targetId = localId || (sr.request_id ? `sr_srv_${sr.request_id}` : (sr.id || `sr_srv_${sr.request_code}`));
      if (sr.request_code) {
        db.runSync(`DELETE FROM stock_requests WHERE id != ? AND request_code = ?`, [targetId, sr.request_code]);
      }
      const createdAt = sr.created_at ? new Date(sr.created_at).getTime() : Date.now();
      const updatedAt = sr.updated_at ? new Date(sr.updated_at).getTime() : Date.now();

      db.runSync(
        `INSERT INTO stock_requests (
          id, request_code, salesman_id, salesman_name, warehouse_name, product_id, product_name, product_sku, package_type, requested_qty, urgency, status, notes, _status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          request_code = excluded.request_code,
          salesman_id = excluded.salesman_id,
          salesman_name = excluded.salesman_name,
          warehouse_name = excluded.warehouse_name,
          product_id = excluded.product_id,
          product_name = excluded.product_name,
          product_sku = excluded.product_sku,
          package_type = excluded.package_type,
          requested_qty = excluded.requested_qty,
          urgency = excluded.urgency,
          status = excluded.status,
          notes = excluded.notes,
          _status = 'synced',
          updated_at = excluded.updated_at`,
        [
          targetId,
          sr.request_code ?? null,
          sr.salesman_id ?? null,
          sr.salesman_name || 'Sales Representative',
          sr.warehouse_name || 'Central Warehouse',
          sr.product_id ?? null,
          sr.product_name,
          sr.product_sku ?? '',
          sr.package_type ?? 'Loose',
          Number(sr.requested_qty) || 0,
          sr.urgency ?? 'Normal',
          sr.status ?? 'Pending',
          sr.notes ?? '',
          createdAt,
          updatedAt,
        ]
      );
      pulledCount++;
    }
  }

  if (timestamp) {
    setSyncMeta('lastPulledAt', String(timestamp));
  }

  return {
    success: true,
    pulledCount,
    pushedCount,
    routeInfo: route_info,
    vanStocksCount: Array.isArray(van_stocks) ? van_stocks.length : 0,
    warehouseStocksCount: Array.isArray(warehouse_stocks) ? warehouse_stocks.length : 0,
    productsCount: Array.isArray(products) ? products.length : 0,
  };
}

export async function syncCompanyProfile(): Promise<CompanyProfile> {
  try {
    const baseUrl = getBackendBaseUrl();
    const res = await fetch(`${baseUrl}/api/settings/company`);
    if (res.ok) {
      const data = await res.json();
      if (data?.settings) {
        setCompanyProfile(data.settings);
        return getCompanyProfile();
      }
    }
  } catch (e) {
    console.warn('Direct company settings fetch skipped (offline or server unreachable):', e);
  }
  return getCompanyProfile();
}

export async function syncSchemes(): Promise<SchemeRecord[]> {
  try {
    const baseUrl = getBackendBaseUrl();
    const userBranchId = getSyncMeta('authorized_branch_id');
    const branchParam = userBranchId && userBranchId !== 'undefined' ? `&branch_id=${userBranchId}` : '';
    const res = await fetch(`${baseUrl}/api/schemes?status=active${branchParam}`);
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.data)) {
        replaceSchemes(json.data);
        return json.data;
      }
    }
  } catch (e) {
    console.warn('Direct schemes fetch skipped (offline or server unreachable):', e);
  }
  return [];
}

