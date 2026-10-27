import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { DEFAULT_COMPANY_LOGO } from '../utils/companyBranding';

/**
 * Web In-Memory & LocalStorage SQLite Mock Proxy
 * Used when running on Web without SharedArrayBuffer / cross-origin isolation.
 * Prevents "ReferenceError: SharedArrayBuffer is not defined" crashes while
 * maintaining state for auth session, routes, and local metadata.
 */
class WebFallbackDatabase {
  private metaStore: Record<string, string> = {};

  constructor() {
    console.warn(
      '💡 Running in Web SQLite Fallback mode. LocalStorage will be used for session and metadata.'
    );
  }

  execSync(_sql: string): void {
    // Schema creation and migrations are safely ignored on web fallback
  }

  runSync(sql: string, ...params: any[]): { changes: number; lastInsertRowId: number } {
    const trimmed = sql.trim();
    if (trimmed.toLowerCase().includes('sync_meta')) {
      const flatParams = params.flat();
      if (flatParams.length >= 2) {
        const key = String(flatParams[0]);
        const val = String(flatParams[1]);
        this.metaStore[key] = val;
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('sf_meta_' + key, val);
          }
        } catch {}
      }
    }
    return { changes: 1, lastInsertRowId: 1 };
  }

  getFirstSync<T>(sql: string, ...params: any[]): T | null {
    const trimmed = sql.trim();
    if (trimmed.toLowerCase().includes('sync_meta')) {
      const flatParams = params.flat();
      const key = String(flatParams[0]);
      let val: string | null = null;
      try {
        if (typeof localStorage !== 'undefined') {
          val = localStorage.getItem('sf_meta_' + key);
        }
      } catch {}
      if (val === null && this.metaStore[key] !== undefined) {
        val = this.metaStore[key];
      }
      if (val !== null) {
        return { value: val } as unknown as T;
      }
      return null;
    }
    return null;
  }

  getAllSync<T>(_sql: string, ..._params: any[]): T[] {
    return [];
  }

  prepareSync(): any {
    return {
      executeSync: () => ({ getFirstSync: () => null, getAllSync: () => [] }),
      finalizeSync: () => {},
    };
  }

  withTransactionSync(task: () => void): void {
    task();
  }

  closeSync(): void {}
}

let dbInstance: SQLite.SQLiteDatabase | null = null;

export function getDatabase(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    if (Platform.OS === 'web' && typeof SharedArrayBuffer === 'undefined') {
      dbInstance = new WebFallbackDatabase() as unknown as SQLite.SQLiteDatabase;
      initTables(dbInstance);
      return dbInstance;
    }

    try {
      dbInstance = SQLite.openDatabaseSync('salesforce.db');
      initTables(dbInstance);
    } catch (err: any) {
      console.warn('⚠️ SQLite.openDatabaseSync failed on Web, using fallback proxy:', err.message);
      dbInstance = new WebFallbackDatabase() as unknown as SQLite.SQLiteDatabase;
      initTables(dbInstance);
    }
  }
  return dbInstance;
}

function initTables(db: SQLite.SQLiteDatabase) {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY NOT NULL,
      backend_id INTEGER,
      customer_code TEXT,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      place TEXT,
      address TEXT,
      route_area TEXT,
      district TEXT,
      state TEXT,
      gst_in TEXT,
      credit_limit REAL DEFAULT 0,
      credit_days INTEGER DEFAULT 30,
      outstanding_balance REAL DEFAULT 0,
      price_group_id INTEGER,
      price_group_name TEXT,
      local_area TEXT,
      status TEXT DEFAULT 'Active',
      latitude REAL,
      longitude REAL,
      _status TEXT DEFAULT 'synced',
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS advance_bookings (
      id TEXT PRIMARY KEY NOT NULL,
      backend_id INTEGER,
      booking_code TEXT,
      customer_id TEXT,
      customer_name TEXT NOT NULL,
      product_id TEXT,
      product_name TEXT NOT NULL,
      package_qty REAL DEFAULT 1,
      total_qty REAL NOT NULL,
      unit_price REAL NOT NULL,
      total_amount REAL NOT NULL,
      discount_amount REAL DEFAULT 0,
      round_off REAL DEFAULT 0,
      advance_amount REAL DEFAULT 0,
      balance_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'Confirmed',
      notes TEXT,
      items TEXT,
      sale_type TEXT DEFAULT 'order',
      _status TEXT DEFAULT 'synced',
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS van_stocks (
      allocation_id INTEGER PRIMARY KEY NOT NULL,
      allocation_code TEXT,
      salesman_id TEXT,
      salesman_name TEXT,
      vehicle_id INTEGER,
      vehicle_reg_no TEXT,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      product_sku TEXT,
      hsn_code TEXT,
      category_name TEXT,
      package_type TEXT,
      unit TEXT DEFAULT 'Pcs',
      gst_rate TEXT DEFAULT '18%',
      package_qty REAL,
      items_per_package REAL,
      total_qty REAL NOT NULL,
      loaded_qty REAL,
      unit_cost REAL,
      unit_price REAL,
      box_price REAL DEFAULT 0,
      mrp REAL DEFAULT 0,
      box_mrp REAL DEFAULT 0,
      total_value REAL,
      batch_no TEXT,
      status TEXT DEFAULT 'Loaded',
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS warehouse_stocks (
      id INTEGER PRIMARY KEY NOT NULL,
      warehouse_id INTEGER,
      warehouse_name TEXT NOT NULL,
      warehouse_code TEXT,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      product_sku TEXT,
      hsn_code TEXT,
      category_name TEXT,
      package_type TEXT,
      unit TEXT DEFAULT 'Pcs',
      gst_rate TEXT DEFAULT '18%',
      quantity REAL NOT NULL,
      available_quantity REAL NOT NULL,
      unit_price REAL,
      box_price REAL DEFAULT 0,
      mrp REAL DEFAULT 0,
      box_mrp REAL DEFAULT 0,
      items_per_package REAL DEFAULT 1,
      unit_cost REAL,
      batch_no TEXT,
      expiry_date TEXT,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS products (
      product_id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      sku TEXT,
      category_id INTEGER,
      category_name TEXT,
      hsn_code TEXT,
      unit TEXT DEFAULT 'Pcs',
      gst_rate TEXT DEFAULT '18%',
      selling_price REAL DEFAULT 0,
      cost_price REAL DEFAULT 0,
      mrp REAL DEFAULT 0,
      box_mrp REAL DEFAULT 0,
      current_stock REAL DEFAULT 0,
      reorder_level REAL DEFAULT 0,
      status TEXT DEFAULT 'Active',
      package_type TEXT DEFAULT 'Box',
      items_per_package REAL DEFAULT 1,
      box_price REAL DEFAULT 0,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS selling_price_groups (
      group_id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'Active'
    );

    CREATE TABLE IF NOT EXISTS product_selling_prices (
      id INTEGER PRIMARY KEY NOT NULL,
      product_id INTEGER NOT NULL,
      group_id INTEGER,
      price REAL NOT NULL,
      box_price REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS stock_requests (
      id TEXT PRIMARY KEY NOT NULL,
      request_code TEXT,
      salesman_id TEXT,
      salesman_name TEXT,
      warehouse_name TEXT,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      product_sku TEXT,
      package_type TEXT,
      requested_qty REAL NOT NULL,
      urgency TEXT DEFAULT 'Normal',
      status TEXT DEFAULT 'Pending',
      notes TEXT,
      _status TEXT DEFAULT 'created',
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS van_transfers (
      id TEXT PRIMARY KEY NOT NULL,
      transfer_code TEXT,
      source_salesman_id TEXT,
      source_salesman_name TEXT,
      source_vehicle_reg TEXT,
      target_salesman_id TEXT,
      target_salesman_name TEXT,
      target_vehicle_reg TEXT,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      product_sku TEXT,
      package_type TEXT,
      quantity REAL NOT NULL,
      reason TEXT,
      location_of_exchange TEXT,
      status TEXT DEFAULT 'Pending Handover',
      notes TEXT,
      _status TEXT DEFAULT 'created',
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY NOT NULL,
      expense_code TEXT,
      salesman_id TEXT,
      salesman_name TEXT,
      category TEXT NOT NULL DEFAULT 'General',
      amount REAL NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      payment_mode TEXT DEFAULT 'Cash',
      expense_date TEXT,
      _status TEXT DEFAULT 'created',
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS schemes (
      scheme_id INTEGER PRIMARY KEY NOT NULL,
      scheme_code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      scheme_type TEXT NOT NULL,
      trigger_product_id INTEGER,
      trigger_product_name TEXT,
      trigger_product_sku TEXT,
      trigger_min_qty REAL DEFAULT 1,
      trigger_unit TEXT DEFAULT 'Pcs',
      trigger_units_per_pkg INTEGER DEFAULT 1,
      min_order_amount REAL DEFAULT 0,
      eligible_product_mode TEXT DEFAULT 'ALL_PRODUCTS',
      eligible_product_ids TEXT DEFAULT '[]',
      reward_type TEXT DEFAULT 'FREE_PRODUCT',
      reward_product_id INTEGER,
      reward_product_name TEXT,
      reward_product_sku TEXT,
      reward_qty REAL DEFAULT 1,
      reward_unit TEXT DEFAULT 'Pcs',
      discount_type TEXT DEFAULT 'PERCENTAGE',
      discount_value REAL DEFAULT 0,
      discount_percentage REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      allow_multiple_slabs INTEGER DEFAULT 1,
      applicable_customer_type TEXT DEFAULT 'ALL',
      start_date TEXT,
      end_date TEXT,
      is_active INTEGER DEFAULT 1,
      branch_id INTEGER,
      branch_name TEXT,
      updated_at INTEGER
    );
  `);

  // Migrate existing schemes table if branch_name column is missing
  try {
    db.execSync(`ALTER TABLE schemes ADD COLUMN branch_name TEXT;`);
  } catch {}

  // Migrate existing customers table if district/state or credit columns are missing
  try {
    db.execSync(`ALTER TABLE customers ADD COLUMN district TEXT;`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE customers ADD COLUMN state TEXT;`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE customers ADD COLUMN credit_limit REAL DEFAULT 0;`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE customers ADD COLUMN credit_days INTEGER DEFAULT 30;`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE customers ADD COLUMN outstanding_balance REAL DEFAULT 0;`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE customers ADD COLUMN price_group_id INTEGER;`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE customers ADD COLUMN price_group_name TEXT;`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE customers ADD COLUMN local_area TEXT;`);
  } catch {}

  // Migrate advance_bookings to support sale_type, items, and salesman identity
  try {
    db.execSync(`ALTER TABLE advance_bookings ADD COLUMN sale_type TEXT DEFAULT 'order';`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE advance_bookings ADD COLUMN items TEXT;`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE advance_bookings ADD COLUMN salesman_id TEXT;`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE advance_bookings ADD COLUMN salesman_name TEXT;`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE advance_bookings ADD COLUMN discount_amount REAL DEFAULT 0;`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE advance_bookings ADD COLUMN round_off REAL DEFAULT 0;`);
  } catch {}

  try {
    db.execSync(`UPDATE advance_bookings SET sale_type = 'sale' WHERE status = 'Delivered' AND (sale_type IS NULL OR sale_type = 'order');`);
  } catch {}

  // Migrate van_stocks to include loaded_qty & unit
  try {
    db.execSync(`ALTER TABLE van_stocks ADD COLUMN loaded_qty REAL;`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE van_stocks ADD COLUMN unit TEXT DEFAULT 'Pcs';`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE warehouse_stocks ADD COLUMN unit TEXT DEFAULT 'Pcs';`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE van_stocks ADD COLUMN gst_rate TEXT DEFAULT '18%';`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE warehouse_stocks ADD COLUMN gst_rate TEXT DEFAULT '18%';`);
  } catch {}

  // Migrate van_stocks and warehouse_stocks to include hsn_code
  try {
    db.execSync(`ALTER TABLE van_stocks ADD COLUMN hsn_code TEXT;`);
  } catch {}

  try {
    db.execSync(`ALTER TABLE warehouse_stocks ADD COLUMN hsn_code TEXT;`);
  } catch {}

  // Migrate products to include package_type, items_per_package, box_price
  try {
    db.execSync(`ALTER TABLE products ADD COLUMN package_type TEXT DEFAULT 'Box';`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE products ADD COLUMN items_per_package REAL DEFAULT 1;`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE products ADD COLUMN box_price REAL DEFAULT 0;`);
  } catch {}

  // Migrate van_stocks to include box_price
  try {
    db.execSync(`ALTER TABLE van_stocks ADD COLUMN box_price REAL DEFAULT 0;`);
  } catch {}

  // Migrate warehouse_stocks to include box_price & items_per_package
  try {
    db.execSync(`ALTER TABLE warehouse_stocks ADD COLUMN box_price REAL DEFAULT 0;`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE warehouse_stocks ADD COLUMN items_per_package REAL DEFAULT 1;`);
  } catch {}

  // Migrate product_selling_prices to include box_price
  try {
    db.execSync(`ALTER TABLE product_selling_prices ADD COLUMN box_price REAL DEFAULT 0;`);
  } catch {}

  // Migrate van_transfers to include source_salesman_id & target_salesman_id
  try {
    db.execSync(`ALTER TABLE van_transfers ADD COLUMN source_salesman_id TEXT;`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE van_transfers ADD COLUMN target_salesman_id TEXT;`);
  } catch {}

  // Migrate product_selling_prices to ensure group_id is nullable (prevents NOT NULL constraint rejections)
  try {
    const tableInfo = db.getAllSync<{ name: string; notnull: number }>(`PRAGMA table_info(product_selling_prices)`);
    const groupIdCol = tableInfo.find(c => c.name === 'group_id');
    if (groupIdCol && groupIdCol.notnull === 1) {
      db.execSync(`
        CREATE TABLE IF NOT EXISTS product_selling_prices_migrated (
          id INTEGER PRIMARY KEY NOT NULL,
          product_id INTEGER NOT NULL,
          group_id INTEGER,
          price REAL NOT NULL
        );
        INSERT OR IGNORE INTO product_selling_prices_migrated SELECT id, product_id, group_id, price FROM product_selling_prices;
        DROP TABLE IF EXISTS product_selling_prices;
        ALTER TABLE product_selling_prices_migrated RENAME TO product_selling_prices;
      `);
    }
  } catch (e) {
    // Fallback recreation if needed
    try {
      db.execSync(`
        DROP TABLE IF EXISTS product_selling_prices;
        CREATE TABLE IF NOT EXISTS product_selling_prices (
          id INTEGER PRIMARY KEY NOT NULL,
          product_id INTEGER NOT NULL,
          group_id INTEGER,
          price REAL NOT NULL
        );
      `);
    } catch {}
  }

  // Automatic deduplication of advance_bookings on startup
  try {
    const duplicateCodes = db.getAllSync<{ booking_code: string }>(
      `SELECT booking_code FROM advance_bookings 
       WHERE booking_code IS NOT NULL AND booking_code != '' 
       GROUP BY booking_code HAVING COUNT(*) > 1`
    );
    for (const dup of duplicateCodes) {
      const rows = db.getAllSync<{ id: string; backend_id: number | null }>(
        `SELECT id, backend_id FROM advance_bookings 
         WHERE booking_code = ? 
         ORDER BY (CASE WHEN backend_id IS NOT NULL THEN 0 ELSE 1 END) ASC, created_at DESC`,
        [dup.booking_code]
      );
      // Keep the most authoritative record (rows[0]), delete duplicate copies
      for (let i = 1; i < rows.length; i++) {
        db.runSync(`DELETE FROM advance_bookings WHERE id = ?`, [rows[i].id]);
      }
    }
  } catch (cleanErr) {
    console.warn('Booking deduplication error:', cleanErr);
  }

  try {
    db.execSync(`UPDATE van_stocks SET loaded_qty = CASE WHEN package_qty * items_per_package > 0 THEN package_qty * items_per_package ELSE total_qty END WHERE loaded_qty IS NULL OR loaded_qty = 0;`);
  } catch {}

  // Van stocks are strictly populated dynamically per logged-in salesman via backend sync
  // (No hardcoded salesman van stock seeds)

  // Purge any old hardcoded dummy warehouse stocks (Peenya, Electronic City, Ponny, Coconut oil)
  try {
    db.execSync(`DELETE FROM warehouse_stocks WHERE warehouse_name LIKE '%Peenya%' OR warehouse_name LIKE '%Electronic City%' OR warehouse_name LIKE '%Yeshwanthpur%' OR product_sku = '1233' OR product_sku = 'COCO-1L';`);
  } catch {}

  // Customer GPS coordinates migration
  try {
    db.execSync(`ALTER TABLE customers ADD COLUMN latitude REAL;`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE customers ADD COLUMN longitude REAL;`);
  } catch {}

  // MRP & Box/Bag MRP migrations for products, van_stocks, warehouse_stocks
  try {
    db.execSync(`ALTER TABLE products ADD COLUMN mrp REAL DEFAULT 0;`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE products ADD COLUMN box_mrp REAL DEFAULT 0;`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE van_stocks ADD COLUMN mrp REAL DEFAULT 0;`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE van_stocks ADD COLUMN box_mrp REAL DEFAULT 0;`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE warehouse_stocks ADD COLUMN mrp REAL DEFAULT 0;`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE warehouse_stocks ADD COLUMN box_mrp REAL DEFAULT 0;`);
  } catch {}

  // Multi-branch migrations
  try {
    db.execSync(`ALTER TABLE customers ADD COLUMN branch_id INTEGER DEFAULT 1;`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE customers ADD COLUMN branch_name TEXT;`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE customers ADD COLUMN assigned_salesman_id INTEGER;`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE customers ADD COLUMN assigned_salesman_name TEXT;`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE advance_bookings ADD COLUMN branch_id INTEGER DEFAULT 1;`);
  } catch {}
  try {
    db.execSync(`ALTER TABLE advance_bookings ADD COLUMN branch_name TEXT;`);
  } catch {}
}

export interface CustomerRecord {
  id: string;
  backend_id?: number | null;
  customer_code?: string | null;
  name: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  place?: string | null;
  address?: string | null;
  route_area?: string | null;
  district?: string | null;
  state?: string | null;
  gst_in?: string | null;
  credit_limit?: number;
  credit_days?: number;
  outstanding_balance?: number;
  price_group_id?: number | null;
  price_group_name?: string | null;
  local_area?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status?: string;
  branch_id?: number | null;
  branch_name?: string | null;
  assigned_salesman_id?: number | null;
  assigned_salesman_name?: string | null;
  _status?: 'synced' | 'created' | 'updated' | 'deleted';
  created_at: number;
  updated_at: number;
}

export interface ProductRecord {
  product_id: number;
  name: string;
  sku?: string | null;
  category_id?: number | null;
  category_name?: string | null;
  hsn_code?: string | null;
  unit?: string | null;
  package_type?: string | null;
  items_per_package?: number | null;
  box_price?: number | null;
  gst_rate?: string | null;
  selling_price: number;
  cost_price: number;
  mrp?: number;
  box_mrp?: number;
  current_stock: number;
  reorder_level: number;
  status: string;
  updated_at?: number;
}

export interface SellingPriceGroupRecord {
  group_id: number;
  price_group_id?: number;
  name: string;
  description?: string | null;
  status?: string;
}

export interface ProductSellingPriceRecord {
  id?: number;
  price_id?: number;
  product_id: number;
  group_id?: number;
  price_group_id?: number;
  price?: number;
  selling_price?: number;
  box_price?: number;
}

export interface BookingRecord {
  id: string;
  backend_id?: number | null;
  booking_code?: string | null;
  salesman_id?: string | null;
  salesman_name?: string | null;
  customer_id?: string | null;
  customer_name: string;
  product_id?: string | null;
  product_name: string;
  package_qty?: number;
  total_qty: number;
  unit_price: number;
  total_amount: number;
  discount_amount?: number;
  round_off?: number;
  advance_amount?: number;
  balance_amount?: number;
  status?: string;
  notes?: string;
  items?: string | null;
  sale_type?: 'sale' | 'order' | 'return' | 'payment';
  branch_id?: number | null;
  branch_name?: string | null;
  _status?: 'synced' | 'created' | 'updated' | 'deleted';
  created_at: number;
  updated_at: number;
}

export interface SchemeRecord {
  scheme_id: number;
  scheme_code: string;
  name: string;
  description?: string | null;
  scheme_type: 'PRODUCT_BASED' | 'AMOUNT_BASED' | string;
  trigger_product_id?: number | null;
  trigger_product_name?: string | null;
  trigger_product_sku?: string | null;
  trigger_min_qty?: number;
  trigger_unit?: string | null;
  trigger_units_per_pkg?: number | null;
  min_order_amount?: number;
  eligible_product_mode?: string | null;
  eligible_product_ids?: string | number[] | null;
  reward_type: 'FREE_PRODUCT' | 'DISCOUNT' | string;
  reward_product_id?: number | null;
  reward_product_name?: string | null;
  reward_product_sku?: string | null;
  reward_qty?: number;
  reward_unit?: string | null;
  discount_type?: 'PERCENTAGE' | 'FIXED' | string;
  discount_value?: number;
  discount_percentage?: number;
  discount_amount?: number;
  allow_multiple_slabs?: boolean | number;
  applicable_customer_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_active: boolean | number;
  branch_id?: number | null;
  branch_name?: string | null;
  updated_at?: number;
}

export interface FreeSchemeItem {
  product_id: number | null;
  product_name: string;
  product_sku: string;
  qty: number;
  unit: string;
  package_type: string;
  unit_price: number;
  total: number;
  is_free: boolean;
  is_scheme_free: boolean;
  scheme_id: number;
  scheme_name: string;
}

export interface QualifiedSchemeItem {
  scheme_id: number;
  scheme_code: string;
  name: string;
  type: string;
  reward_type: string;
  trigger_summary: string;
  reward_summary: string;
  reward_qty?: number;
  reward_unit?: string;
  discount_amount?: number;
  freeItem?: FreeSchemeItem;
}

export interface SchemeEvaluationResult {
  qualifiedSchemes: QualifiedSchemeItem[];
  totalDiscount: number;
  freeItems: FreeSchemeItem[];
}

export interface VanStockRecord {
  allocation_id: number;
  allocation_code?: string;
  salesman_id?: string;
  salesman_name?: string;
  vehicle_id?: number;
  vehicle_reg_no?: string;
  product_id: number;
  product_name: string;
  product_sku?: string;
  hsn_code?: string;
  category_name?: string;
  package_type?: string;
  items_per_package?: number;
  unit?: string;
  gst_rate?: string;
  package_qty?: number;
  total_qty: number;
  loaded_qty?: number;
  unit_cost?: number;
  unit_price?: number;
  box_price?: number;
  mrp?: number;
  box_mrp?: number;
  total_value?: number;
  batch_no?: string;
  status?: string;
}

export interface WarehouseStockRecord {
  id: number;
  warehouse_id?: number;
  warehouse_name: string;
  warehouse_code?: string;
  product_id: number;
  product_name: string;
  product_sku?: string;
  hsn_code?: string;
  category_name?: string;
  package_type?: string;
  items_per_package?: number;
  unit?: string;
  gst_rate?: string;
  quantity: number;
  available_quantity: number;
  unit_price?: number;
  box_price?: number;
  mrp?: number;
  box_mrp?: number;
  unit_cost?: number;
  batch_no?: string;
  expiry_date?: string;
  updated_at?: number;
}

export interface StockRequestRecord {
  id: string;
  request_code?: string;
  salesman_id?: string;
  salesman_name?: string;
  warehouse_name?: string;
  product_id?: number;
  product_name: string;
  product_sku?: string;
  package_type?: string;
  requested_qty: number;
  urgency?: string;
  status?: string;
  notes?: string;
  _status?: 'synced' | 'created' | 'updated';
  created_at: number;
  updated_at: number;
}

export interface VanTransferRecord {
  id: string;
  transfer_code?: string;
  source_salesman_id?: string;
  source_salesman_name?: string;
  source_vehicle_reg?: string;
  target_salesman_id?: string;
  target_salesman_name: string;
  target_vehicle_reg?: string;
  product_id?: number;
  product_name: string;
  product_sku?: string;
  package_type?: string;
  quantity: number;
  reason?: string;
  location_of_exchange?: string;
  status?: string;
  notes?: string;
  _status?: 'synced' | 'created' | 'updated';
  created_at: number;
  updated_at: number;
}

export interface ExpenseRecord {
  id: string;
  expense_code?: string;
  salesman_id?: string;
  salesman_name?: string;
  category: string;
  amount: number;
  reason: string;
  payment_mode?: string;
  expense_date: string;
  _status?: 'synced' | 'created' | 'updated' | 'deleted';
  created_at?: number;
  updated_at?: number;
}

export interface AvailableSalesman {
  salesman_id: string;
  salesman_name: string;
  salesman_phone?: string;
  vehicle_reg_no: string;
  vehicle_model?: string;
  route_name?: string;
}

export interface RouteInfo {
  mapping_id?: number;
  salesman_id: string;
  salesman_name: string;
  salesman_phone?: string;
  vehicle_id?: number;
  vehicle_reg_no?: string;
  vehicle_model?: string;
  state?: string;
  district?: string;
  route_name: string;
  local_areas?: string[];
  schedule_days?: string[];
  branch_id?: number;
  branch_name?: string;
}

// ---------------------- Customer DAO ----------------------

export function getCustomers(search: string = '', routeFilter: string = ''): CustomerRecord[] {
  const db = getDatabase();
  const assigned = getAssignedRoute();
  const assignedDistrict = (assigned?.district || '').trim();
  const assignedRouteName = (assigned?.route_name || '').trim();

  // Determine authorized branch context from active user session
  let userBranchId: number | null = null;
  let isGlobalUser = false;
  try {
    const savedBranchId = getSyncMeta('authorized_branch_id');
    if (savedBranchId && !isNaN(Number(savedBranchId))) {
      userBranchId = Number(savedBranchId);
    }
    const rawUser = getSyncMeta('auth_user');
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      if (
        parsed.role === 'ADMIN' ||
        parsed.role === 'SUPER_ADMIN' ||
        parsed.role_code === 'ADMIN' ||
        parsed.allowed_modules?.includes('all_access') ||
        (Array.isArray(parsed.assigned_branches) && (parsed.assigned_branches.includes('all') || parsed.assigned_branches.includes('*')))
      ) {
        isGlobalUser = true;
      }
      if (userBranchId == null) {
        if (parsed.branch_id != null && !isNaN(Number(parsed.branch_id))) {
          userBranchId = Number(parsed.branch_id);
        } else if (parsed.branch?.branch_id != null && !isNaN(Number(parsed.branch.branch_id))) {
          userBranchId = Number(parsed.branch.branch_id);
        }
      }
    }
    if (userBranchId == null && assigned?.branch_id != null && !isNaN(Number(assigned.branch_id))) {
      userBranchId = Number(assigned.branch_id);
    }
  } catch {}

  try {
    let query = `SELECT * FROM customers WHERE _status != 'deleted'`;
    const params: any[] = [];

    // Branch Isolation: Sub-branch salesmen only see their assigned branch customers
    if (!isGlobalUser) {
      if (userBranchId != null) {
        query += ` AND (branch_id = ? OR branch_id = CAST(? AS INTEGER))`;
        params.push(userBranchId, userBranchId);
      } else {
        query += ` AND 1=0`;
      }
    }

    if (routeFilter && routeFilter.trim() && routeFilter !== 'All Routes') {
      const trimmedFilter = routeFilter.trim().toLowerCase();
      const cleanFilter = routeFilter
        .replace(/\(.*?\)/g, '')
        .replace(/Beat/gi, '')
        .trim();

      // Determine if routeFilter is the salesman's primary beat / territory / route
      const isPrimaryBeat =
        routeFilter.includes('(All Areas)') ||
        (assignedDistrict && (
          trimmedFilter === `${assignedDistrict.toLowerCase()} beat` ||
          trimmedFilter === `${assignedDistrict.toLowerCase()} territory` ||
          trimmedFilter === assignedDistrict.toLowerCase() ||
          cleanFilter.toLowerCase() === assignedDistrict.toLowerCase()
        )) ||
        (assignedRouteName && (
          trimmedFilter === `${assignedRouteName.toLowerCase()} beat` ||
          trimmedFilter === assignedRouteName.toLowerCase() ||
          cleanFilter.toLowerCase() === assignedRouteName.toLowerCase()
        ));

      if (isPrimaryBeat) {
        // Business rule: All customers belonging to salesman's branch are visible on primary beat
        if (assignedDistrict && userBranchId != null) {
          query += ` AND (branch_id = ? OR district LIKE ? OR route_area LIKE ? OR place LIKE ?)`;
          const f = `%${assignedDistrict}%`;
          params.push(userBranchId, f, f, f);
        }
      } else {
        // Specific local area / sub-beat filter (e.g. "Big Bazaar", "Malampuzha")
        const searchTerm = cleanFilter.split(',')[0].trim() || routeFilter.trim();
        const f = `%${searchTerm}%`;

        query += ` AND (route_area LIKE ? OR local_area LIKE ? OR place LIKE ? OR address LIKE ?)`;
        params.push(f, f, f, f);
      }
    }

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query += ` AND (name LIKE ? OR phone LIKE ? OR place LIKE ? OR customer_code LIKE ?)`;
      params.push(term, term, term, term);
    }

    query += ` ORDER BY name ASC`;
    return db.getAllSync<CustomerRecord>(query, params);
  } catch {
    let query = `SELECT * FROM customers WHERE _status != 'deleted'`;
    const params: any[] = [];

    if (!isGlobalUser) {
      if (userBranchId != null) {
        query += ` AND (branch_id = ? OR branch_id = CAST(? AS INTEGER))`;
        params.push(userBranchId, userBranchId);
      } else {
        query += ` AND 1=0`;
      }
    }

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query += ` AND (name LIKE ? OR phone LIKE ? OR place LIKE ? OR customer_code LIKE ?)`;
      params.push(term, term, term, term);
    }
    query += ` ORDER BY name ASC`;
    return db.getAllSync<CustomerRecord>(query, params);
  }
}

export function getCustomerById(id: string): { customer: CustomerRecord | null; isAuthorized: boolean } {
  const db = getDatabase();
  let userBranchId: number | null = null;
  let isGlobalUser = false;
  try {
    const rawUser = getSyncMeta('auth_user');
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      if (
        parsed.role === 'ADMIN' ||
        parsed.role === 'SUPER_ADMIN' ||
        parsed.role_code === 'ADMIN' ||
        parsed.allowed_modules?.includes('all_access') ||
        (Array.isArray(parsed.assigned_branches) && (parsed.assigned_branches.includes('all') || parsed.assigned_branches.includes('*')))
      ) {
        isGlobalUser = true;
      }
      if (parsed.branch_id != null && !isNaN(Number(parsed.branch_id))) {
        userBranchId = Number(parsed.branch_id);
      }
    }
  } catch {}

  const cleanNum = parseInt(id.replace(/\D/g, ''), 10);
  const rows = db.getAllSync<CustomerRecord>(
    `SELECT * FROM customers 
     WHERE id = ? OR customer_code = ? OR (backend_id = ? AND ? > 0)
     LIMIT 1`,
    [id, id, !isNaN(cleanNum) ? cleanNum : -1, !isNaN(cleanNum) ? cleanNum : -1]
  );

  if (rows.length === 0) {
    return { customer: null, isAuthorized: false };
  }

  const cust = rows[0];
  const custBranch = cust.branch_id != null ? Number(cust.branch_id) : null;
  const isAuthorized = isGlobalUser || (custBranch != null && userBranchId != null && custBranch === userBranchId);

  return { customer: cust, isAuthorized };
}

export function generateRandomCustomerCode(): string {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  try {
    const db = getDatabase();
    for (let attempt = 0; attempt < 10; attempt++) {
      let randomPart = '';
      for (let i = 0; i < 7; i++) {
        randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const code = `CI${randomPart}`;
      const exists = db.getFirstSync<{ c: number }>(
        `SELECT COUNT(*) as c FROM customers WHERE customer_code = ?`,
        [code]
      )?.c;
      if (!exists) return code;
    }
  } catch {}
  // High-entropy fallback
  let randomFallback = '';
  for (let i = 0; i < 7; i++) {
    randomFallback += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `CI${randomFallback}`;
}

export function getNextCustomerCode(): string {
  return generateRandomCustomerCode();
}

export function createCustomer(
  data: Omit<CustomerRecord, 'id' | 'created_at' | 'updated_at' | '_status'>
): CustomerRecord {
  const db = getDatabase();
  const now = Date.now();
  const id = `c_${now}_${Math.random().toString(36).substring(2, 7)}`;

  // Auto-determine authorized branch and assigned salesman from logged-in user session
  let userBranchId = 1;
  let userBranchName = 'Main Branch & Central Depot';
  let curSalesmanId: number | null = null;
  let curSalesmanName: string | null = null;
  try {
    const rawUser = getSyncMeta('auth_user');
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      if (parsed.branch_id) userBranchId = Number(parsed.branch_id);
      if (parsed.branch_name) userBranchName = parsed.branch_name;
      curSalesmanId = parsed.id ? parseInt(parsed.id, 10) : null;
      curSalesmanName = parsed.name || parsed.username || null;
    }
  } catch {}

  const record: CustomerRecord = {
    ...data,
    id,
    branch_id: data.branch_id ?? userBranchId,
    branch_name: data.branch_name ?? userBranchName,
    assigned_salesman_id: data.assigned_salesman_id ?? curSalesmanId,
    assigned_salesman_name: data.assigned_salesman_name ?? curSalesmanName,
    created_at: now,
    updated_at: now,
    _status: 'created',
    status: data.status || 'Active',
  };

  if (!record.customer_code) {
    record.customer_code = getNextCustomerCode();
  }

  db.runSync(
    `INSERT INTO customers (
      id, backend_id, customer_code, name, contact_person, phone, email, place, address, route_area, district, state, gst_in, status, latitude, longitude, branch_id, branch_name, assigned_salesman_id, assigned_salesman_name, _status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.backend_id ?? null,
      record.customer_code ?? null,
      record.name,
      record.contact_person ?? null,
      record.phone ?? null,
      record.email ?? null,
      record.place ?? null,
      record.address ?? null,
      record.route_area ?? null,
      record.district ?? 'Palakkad',
      record.state ?? 'Kerala',
      record.gst_in ?? null,
      record.status ?? 'Active',
      record.latitude ?? null,
      record.longitude ?? null,
      record.branch_id ?? userBranchId,
      record.branch_name ?? userBranchName,
      record.assigned_salesman_id ?? curSalesmanId,
      record.assigned_salesman_name ?? curSalesmanName,
      record._status ?? 'created',
      record.created_at,
      record.updated_at,
    ]
  );

  return record;
}

// ---------------------- Bookings / Sales DAO ----------------------

export function getCurrentSalesman(): { id: string; name: string } | null {
  try {
    const rawUser = getSyncMeta('auth_user');
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      return {
        id: parsed.id || '',
        name: parsed.name || parsed.username || '',
      };
    }
  } catch {}
  return null;
}

export function getBookings(): BookingRecord[] {
  const db = getDatabase();
  const cur = getCurrentSalesman();
  if (cur?.id || cur?.name) {
    return db.getAllSync<BookingRecord>(
      `SELECT * FROM advance_bookings 
       WHERE _status != 'deleted' 
         AND (
           salesman_id = ? 
           OR (salesman_id IS NULL AND (salesman_name LIKE ? OR salesman_name = ?))
         ) 
       ORDER BY created_at DESC`,
      [cur.id, `%${cur.name}%`, cur.name]
    );
  }
  return db.getAllSync<BookingRecord>(
    `SELECT * FROM advance_bookings WHERE _status != 'deleted' ORDER BY created_at DESC`
  );
}

export function getSales(): BookingRecord[] {
  const db = getDatabase();
  const cur = getCurrentSalesman();
  if (cur?.id || cur?.name) {
    return db.getAllSync<BookingRecord>(
      `SELECT * FROM advance_bookings 
       WHERE _status != 'deleted' 
         AND (sale_type = 'sale' OR status = 'Delivered')
         AND (
           salesman_id = ? 
           OR (salesman_id IS NULL AND (salesman_name LIKE ? OR salesman_name = ?))
         )
       ORDER BY created_at DESC`,
      [cur.id, `%${cur.name}%`, cur.name]
    );
  }
  return db.getAllSync<BookingRecord>(
    `SELECT * FROM advance_bookings WHERE _status != 'deleted' AND (sale_type = 'sale' OR status = 'Delivered') ORDER BY created_at DESC`
  );
}

export function getOrders(): BookingRecord[] {
  const db = getDatabase();
  const cur = getCurrentSalesman();
  if (cur?.id || cur?.name) {
    return db.getAllSync<BookingRecord>(
      `SELECT * FROM advance_bookings 
       WHERE _status != 'deleted' 
         AND (sale_type = 'order' OR sale_type IS NULL) 
         AND status != 'Delivered' 
         AND status != 'Returned' 
         AND status != 'Collected' 
         AND (product_name IS NULL OR product_name != 'Balance Payment Collection')
         AND (
           salesman_id = ? 
           OR (salesman_id IS NULL AND (salesman_name LIKE ? OR salesman_name = ?))
         )
       ORDER BY created_at DESC`,
      [cur.id, `%${cur.name}%`, cur.name]
    );
  }
  return db.getAllSync<BookingRecord>(
    `SELECT * FROM advance_bookings 
     WHERE _status != 'deleted' 
       AND (sale_type = 'order' OR sale_type IS NULL) 
       AND status != 'Delivered' 
       AND status != 'Returned' 
       AND status != 'Collected' 
       AND (product_name IS NULL OR product_name != 'Balance Payment Collection') 
     ORDER BY created_at DESC`
  );
}

export function getReturns(): BookingRecord[] {
  const db = getDatabase();
  const cur = getCurrentSalesman();
  if (cur?.id || cur?.name) {
    return db.getAllSync<BookingRecord>(
      `SELECT * FROM advance_bookings 
       WHERE _status != 'deleted' 
         AND (sale_type = 'return' OR status = 'Returned')
         AND (
           salesman_id = ? 
           OR (salesman_id IS NULL AND (salesman_name LIKE ? OR salesman_name = ?))
         )
       ORDER BY created_at DESC`,
      [cur.id, `%${cur.name}%`, cur.name]
    );
  }
  return db.getAllSync<BookingRecord>(
    `SELECT * FROM advance_bookings 
     WHERE _status != 'deleted' 
       AND (sale_type = 'return' OR status = 'Returned') 
     ORDER BY created_at DESC`
  );
}

export function getSalesmanCode(salesmanNameOrId?: string): string {
  let target = salesmanNameOrId;
  if (!target) {
    try {
      const rawUser = getSyncMeta('auth_user');
      if (rawUser) {
        const parsed = JSON.parse(rawUser);
        target = parsed.username || parsed.name || parsed.id || '';
      }
    } catch {}
  }
  if (!target) return 'SM1';

  const val = String(target).trim().toUpperCase();
  if (val.includes('ARJUN') || val.includes('ARJ')) return 'ARJ';
  if (val.includes('RAHUL') || val.includes('RAH')) return 'RAH';
  if (val.includes('DAVID') || val.includes('DAV')) return 'DAV';
  if (val.includes('VISHNU') || val.includes('VIS')) return 'VIS';
  if (val.includes('ABISHEK') || val === 'ABI') return 'ABI';

  const numMatch = val.match(/\d+/);
  const trailingNum = numMatch ? numMatch[0] : '';
  const lettersOnly = val.replace(/[^A-Z]/g, '');
  if (trailingNum) {
    const prefixLetters = lettersOnly.slice(0, Math.max(1, 4 - trailingNum.length));
    return `${prefixLetters}${trailingNum}` || `SM${trailingNum}`;
  }

  const clean = lettersOnly.slice(0, 3);
  return clean || 'SM1';
}

/**
 * Generate sequential document number:
 * GST Invoice: SalesmanID - INV - serialno (e.g. ABI-INV-0008)
 * Non-GST Retail Bill: SalesmanID - RET - serialno (e.g. ABI-RET-0013)
 * Orders: SalesmanID - ORD - serialno (e.g. ABI-ORD-0001)
 * Returns: RET - 2026 - serialno (e.g. RET-2026-0017)
 */
export function getNextDocumentCode(
  docType: 'sale' | 'order' | 'return' = 'sale',
  options?: { isGst?: boolean; salesman?: string }
): string {
  const db = getDatabase();
  const smCode = getSalesmanCode(options?.salesman);

  let prefix = '';
  if (docType === 'order') {
    prefix = `${smCode}-ORD-`;
  } else if (docType === 'return') {
    prefix = `RET-${new Date().getFullYear()}-`;
  } else {
    // sale / retail bill
    const isGst = options?.isGst !== undefined ? options.isGst : false;
    prefix = isGst ? `${smCode}-INV-` : `${smCode}-RET-`;
  }

  let maxSeq = 0;
  try {
    const rows = db.getAllSync<{ booking_code: string | null }>(
      `SELECT booking_code FROM advance_bookings WHERE booking_code LIKE ?`,
      [`${prefix}%`]
    );
    for (const r of rows) {
      if (r.booking_code && r.booking_code.startsWith(prefix)) {
        const numPart = parseInt(r.booking_code.substring(prefix.length), 10);
        if (!isNaN(numPart) && numPart > maxSeq) {
          maxSeq = numPart;
        }
      }
    }
  } catch (err) {
    console.warn('Error reading next document sequence:', err);
  }

  const nextSeq = maxSeq + 1;
  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

export function createBooking(
  data: Omit<BookingRecord, 'id' | 'created_at' | 'updated_at' | '_status'>
): BookingRecord {
  const db = getDatabase();
  const now = Date.now();
  const id = `b_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const saleType = data.sale_type || (data.status === 'Delivered' ? 'sale' : 'order');

  let sId = data.salesman_id;
  let sName = data.salesman_name;
  if (!sId || !sName) {
    const cur = getCurrentSalesman();
    if (cur) {
      if (!sId) sId = cur.id;
      if (!sName) sName = cur.name;
    }
  }

  // Auto-determine authorized branch from current user session
  let userBranchId = 1;
  let userBranchName = 'Main Branch & Central Depot';
  try {
    const rawUser = getSyncMeta('auth_user');
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      if (parsed.branch_id) userBranchId = Number(parsed.branch_id);
      if (parsed.branch_name) userBranchName = parsed.branch_name;
    }
  } catch {}

  const bookingCode = data.booking_code || getNextDocumentCode(saleType as any, { salesman: (sName || sId || undefined) });
  const record: BookingRecord = {
    ...data,
    id,
    salesman_id: sId,
    salesman_name: sName,
    branch_id: data.branch_id ?? userBranchId,
    branch_name: data.branch_name ?? userBranchName,
    booking_code: bookingCode,
    sale_type: saleType,
    created_at: now,
    updated_at: now,
    _status: 'created',
    status: data.status || (saleType === 'sale' ? 'Delivered' : 'Confirmed'),
  };

  db.runSync(
    `INSERT INTO advance_bookings (
      id, backend_id, booking_code, salesman_id, salesman_name, customer_id, customer_name, product_id, product_name, package_qty, total_qty, unit_price, total_amount, discount_amount, round_off, advance_amount, balance_amount, status, notes, items, sale_type, branch_id, branch_name, _status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.backend_id ?? null,
      record.booking_code ?? null,
      record.salesman_id ?? null,
      record.salesman_name ?? null,
      record.customer_id ?? null,
      record.customer_name,
      record.product_id ?? null,
      record.product_name,
      record.package_qty ?? 1,
      record.total_qty,
      record.unit_price,
      record.total_amount,
      record.discount_amount ?? 0,
      record.round_off ?? 0,
      record.advance_amount ?? 0,
      record.balance_amount ?? 0,
      record.status ?? 'Confirmed',
      record.notes ?? null,
      record.items ?? null,
      record.sale_type ?? 'order',
      record.branch_id ?? userBranchId,
      record.branch_name ?? userBranchName,
      record._status ?? 'created',
      record.created_at,
      record.updated_at,
    ]
  );

  return record;
}

// ---------------------- Van Stock DAO ----------------------

export function getVanStocks(): VanStockRecord[] {
  const db = getDatabase();
  return db.getAllSync<VanStockRecord>(
    `SELECT * FROM van_stocks WHERE status = 'Loaded' ORDER BY product_name ASC`
  );
}

export function replaceVanStocks(stocks: VanStockRecord[]): void {
  const db = getDatabase();
  db.runSync(`DELETE FROM van_stocks`);

  // Consolidate stocks by product_id / product_name so that each item appears as ONE unified stock entry!
  const consolidated = new Map<string, VanStockRecord>();

  for (const s of stocks) {
    const key = String(s.product_id || s.product_name).trim().toLowerCase();
    const totalQty = Number(s.total_qty) || 0;
    const itemsPerPkg = Math.max(1, Number(s.items_per_package) || 1);
    const loadedQty = Number(s.loaded_qty) || (Number(s.package_qty) * itemsPerPkg) || totalQty;
    const unitPrice = Number(s.unit_price || s.unit_cost || 0);
    const totalVal = Number(s.total_value) || (totalQty * unitPrice);

    if (consolidated.has(key)) {
      const prev = consolidated.get(key)!;
      const combinedTotalQty = Number(prev.total_qty) + totalQty;
      const combinedLoadedQty = (Number(prev.loaded_qty) || Number(prev.total_qty)) + loadedQty;
      const prevIpp = Math.max(1, Number(prev.items_per_package) || 1);
      const newIpp = Math.max(prevIpp, itemsPerPkg);
      const combinedPkgQty = Number((combinedTotalQty / newIpp).toFixed(2));
      const combinedVal = Number(prev.total_value) + totalVal;

      const prevIsLoose = !prev.package_type || ['loose', 'unit', 'pcs'].includes(prev.package_type.toLowerCase());
      const currIsLoose = !s.package_type || ['loose', 'unit', 'pcs'].includes(s.package_type.toLowerCase());
      const resolvedPkgType = (!currIsLoose ? s.package_type : (!prevIsLoose ? prev.package_type : 'Bag')) || 'Bag';

      consolidated.set(key, {
        ...prev,
        package_type: resolvedPkgType,
        total_qty: combinedTotalQty,
        loaded_qty: combinedLoadedQty,
        package_qty: combinedPkgQty,
        items_per_package: newIpp,
        total_value: combinedVal,
        batch_no: prev.batch_no || s.batch_no,
      });
    } else {
      const isLoose = !s.package_type || ['loose', 'unit', 'pcs'].includes(s.package_type.toLowerCase());
      const resolvedPkgType = (!isLoose ? s.package_type : 'Bag') || 'Bag';
      const pkgQty = Number((totalQty / itemsPerPkg).toFixed(2));
      consolidated.set(key, {
        ...s,
        package_type: resolvedPkgType,
        total_qty: totalQty,
        loaded_qty: loadedQty,
        package_qty: pkgQty,
        items_per_package: itemsPerPkg,
        total_value: totalVal,
      });
    }
  }

  for (const s of consolidated.values()) {
    const itemsPerPkg = Math.max(1, Number(s.items_per_package) || 1);
    const unitPrice = Number(s.unit_price || s.unit_cost || 0);
    const boxPrice = Number(s.box_price) || (unitPrice * itemsPerPkg);

    db.runSync(
      `INSERT INTO van_stocks (
        allocation_id, allocation_code, salesman_id, salesman_name, vehicle_id, vehicle_reg_no, product_id, product_name, product_sku, hsn_code, category_name, package_type, unit, gst_rate, package_qty, items_per_package, total_qty, loaded_qty, unit_cost, unit_price, box_price, mrp, box_mrp, total_value, batch_no, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.allocation_id,
        s.allocation_code ?? null,
        s.salesman_id ?? null,
        s.salesman_name ?? null,
        s.vehicle_id ?? null,
        s.vehicle_reg_no ?? null,
        s.product_id,
        s.product_name,
        s.product_sku ?? null,
        s.hsn_code ?? null,
        s.category_name ?? null,
        s.package_type ?? 'Carton',
        s.unit ?? 'Pcs',
        s.gst_rate ?? '18%',
        Number(s.package_qty) || 0,
        itemsPerPkg,
        Number(s.total_qty) || 0,
        Number(s.loaded_qty) || Number(s.total_qty) || 0,
        s.unit_cost ?? 0,
        unitPrice,
        boxPrice,
        Number((s as any).mrp) > 0 ? Number((s as any).mrp) : unitPrice,
        Number((s as any).box_mrp) > 0 ? Number((s as any).box_mrp) : ((Number((s as any).mrp) || unitPrice) * itemsPerPkg),
        Number(s.total_value) || 0,
        s.batch_no ?? null,
        s.status ?? 'Loaded',
        Date.now(),
      ]
    );
  }
}

export function deductVanStock(productIdentifier: string | number, qty: number): void {
  const db = getDatabase();
  const stock = db.getFirstSync<VanStockRecord>(
    `SELECT * FROM van_stocks WHERE allocation_id = ? OR product_id = ? OR LOWER(product_name) = LOWER(?) LIMIT 1`,
    [productIdentifier, productIdentifier, String(productIdentifier)]
  );
  if (stock) {
    const newQty = Math.max(0, stock.total_qty - qty);
    const unitPrice = stock.unit_price || stock.unit_cost || 0;
    const newTotalValue = Math.max(0, newQty * unitPrice);
    const itemsPerPkg = Number(stock.items_per_package) || 1;
    const newPackageQty = itemsPerPkg > 0 ? Number((newQty / itemsPerPkg).toFixed(2)) : newQty;
    db.runSync(
      `UPDATE van_stocks SET total_qty = ?, package_qty = ?, total_value = ?, updated_at = ? WHERE allocation_id = ?`,
      [newQty, newPackageQty, newTotalValue, Date.now(), stock.allocation_id]
    );
  }
}

export function addVanStock(productIdentifier: string | number, qty: number, fallbackProductName?: string): void {
  const db = getDatabase();
  const stock = db.getFirstSync<VanStockRecord>(
    `SELECT * FROM van_stocks WHERE allocation_id = ? OR product_id = ? OR LOWER(product_name) = LOWER(?) LIMIT 1`,
    [productIdentifier, productIdentifier, String(fallbackProductName || productIdentifier)]
  );
  if (stock) {
    const newQty = stock.total_qty + qty;
    const unitPrice = stock.unit_price || stock.unit_cost || 0;
    const newTotalValue = newQty * unitPrice;
    const itemsPerPkg = Number(stock.items_per_package) || 1;
    const newPackageQty = itemsPerPkg > 0 ? Number((newQty / itemsPerPkg).toFixed(2)) : newQty;
    db.runSync(
      `UPDATE van_stocks SET total_qty = ?, package_qty = ?, total_value = ?, updated_at = ? WHERE allocation_id = ?`,
      [newQty, newPackageQty, newTotalValue, Date.now(), stock.allocation_id]
    );
  } else {
    // Look up product from master_products to create an initial van_stocks row
    let prod: any = null;
    try {
      prod = db.getFirstSync<any>(
        `SELECT * FROM master_products WHERE product_id = ? OR name = ? LIMIT 1`,
        [productIdentifier, fallbackProductName || productIdentifier]
      );
    } catch {}

    const allocId = Date.now();
    const unitPrice = Number(prod?.selling_price) || 0;
    const unitCost = Number(prod?.cost_price) || 0;
    const prodName = prod?.name || fallbackProductName || String(productIdentifier);
    const prodSku = prod?.sku || '';
    const catName = prod?.category_name || '';
    const unit = prod?.unit || 'Pcs';
    db.runSync(
      `INSERT INTO van_stocks (
        allocation_id, product_id, product_name, product_sku, category_name, unit, unit_cost, unit_price, package_qty, total_qty, total_value, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Loaded', ?, ?)`,
      [
        allocId,
        typeof productIdentifier === 'number' ? productIdentifier : (prod?.product_id || null),
        prodName,
        prodSku,
        catName,
        unit,
        unitCost,
        unitPrice,
        qty,
        qty,
        qty * (unitPrice || unitCost),
        Date.now(),
        Date.now()
      ]
    );
  }
}

// ---------------------- Warehouse Stock DAO ----------------------

export function getWarehouseStocks(search: string = '', warehouseFilter: string = ''): WarehouseStockRecord[] {
  const db = getDatabase();
  try {
    let query = `SELECT * FROM warehouse_stocks WHERE quantity > 0`;
    const params: any[] = [];

    if (warehouseFilter && warehouseFilter.trim() && warehouseFilter !== 'All Warehouses') {
      query += ` AND (warehouse_name LIKE ? OR warehouse_code LIKE ?)`;
      const wf = `%${warehouseFilter.trim()}%`;
      params.push(wf, wf);
    }

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query += ` AND (product_name LIKE ? OR product_sku LIKE ? OR category_name LIKE ? OR warehouse_name LIKE ?)`;
      params.push(term, term, term, term);
    }

    query += ` ORDER BY product_name ASC, warehouse_name ASC`;
    return db.getAllSync<WarehouseStockRecord>(query, params);
  } catch (e) {
    console.warn('Could not query warehouse_stocks:', e);
    return [];
  }
}

export function replaceWarehouseStocks(stocks: WarehouseStockRecord[]): void {
  const db = getDatabase();
  try {
    db.runSync(`DELETE FROM warehouse_stocks`);
    for (const ws of stocks) {
      db.runSync(
        `INSERT INTO warehouse_stocks (
          id, warehouse_id, warehouse_name, warehouse_code, product_id, product_name, product_sku, hsn_code, category_name, package_type, unit, gst_rate, quantity, available_quantity, unit_price, box_price, mrp, box_mrp, items_per_package, unit_cost, batch_no, expiry_date, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ws.id,
          ws.warehouse_id ?? null,
          ws.warehouse_name,
          ws.warehouse_code ?? null,
          ws.product_id,
          ws.product_name,
          ws.product_sku ?? null,
          ws.hsn_code ?? null,
          ws.category_name ?? null,
          ws.package_type ?? 'Unit',
          ws.unit ?? 'Pcs',
          ws.gst_rate ?? '18%',
          Number(ws.quantity) || 0,
          Number(ws.available_quantity) || Number(ws.quantity) || 0,
          Number(ws.unit_price) || 0,
          Number(ws.box_price) || (Number(ws.unit_price || 0) * (Number(ws.items_per_package) || 1)),
          Number((ws as any).mrp) > 0 ? Number((ws as any).mrp) : (Number(ws.unit_price) || 0),
          Number((ws as any).box_mrp) > 0 ? Number((ws as any).box_mrp) : ((Number((ws as any).mrp) || Number(ws.unit_price) || 0) * (Number(ws.items_per_package) || 1)),
          Number(ws.items_per_package) || 1,
          Number(ws.unit_cost) || 0,
          ws.batch_no ?? null,
          ws.expiry_date ?? null,
          ws.updated_at || Date.now(),
        ]
      );
    }
  } catch (e) {
    console.error('Error replacing warehouse_stocks:', e);
  }
}

export function getWarehouseNames(): string[] {
  const db = getDatabase();
  try {
    const rows = db.getAllSync<{ warehouse_name: string }>(
      `SELECT DISTINCT warehouse_name FROM warehouse_stocks WHERE warehouse_name IS NOT NULL AND warehouse_name != '' ORDER BY warehouse_name ASC`
    );
    return rows.map(r => r.warehouse_name);
  } catch {
    return [];
  }
}

// ---------------------- Master Products & Selling Prices DAO ----------------------

export function replaceProducts(products: ProductRecord[]): void {
  const db = getDatabase();
  try {
    db.runSync(`DELETE FROM products`);
    const now = Date.now();
    for (const p of products) {
      db.runSync(
        `INSERT INTO products (
          product_id, name, sku, category_id, category_name, hsn_code, unit, gst_rate, selling_price, cost_price, mrp, box_mrp, current_stock, reorder_level, status, package_type, items_per_package, box_price, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.product_id,
          p.name,
          p.sku || '',
          p.category_id ?? null,
          p.category_name || '',
          p.hsn_code || '',
          p.unit || 'Pcs',
          p.gst_rate || '18%',
          Number(p.selling_price) || 0,
          Number(p.cost_price) || 0,
          Number((p as any).mrp) > 0 ? Number((p as any).mrp) : (Number(p.selling_price) || 0),
          Number((p as any).box_mrp) > 0 ? Number((p as any).box_mrp) : ((Number((p as any).mrp) || Number(p.selling_price) || 0) * (Number(p.items_per_package) || 1)),
          Number(p.current_stock) || 0,
          Number(p.reorder_level) || 0,
          p.status || 'Active',
          p.package_type || 'Box',
          Number(p.items_per_package) || 1,
          Number(p.box_price) || (Number(p.selling_price || 0) * (Number(p.items_per_package) || 1)),
          now,
        ]
      );
    }
  } catch (e) {
    console.error('Error replacing products in SQLite:', e);
  }
}

export function getMasterProducts(search: string = ''): ProductRecord[] {
  const db = getDatabase();
  try {
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      return db.getAllSync<ProductRecord>(
        `SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? OR hsn_code LIKE ? ORDER BY name ASC`,
        [q, q, q]
      );
    }
    return db.getAllSync<ProductRecord>(`SELECT * FROM products ORDER BY name ASC`);
  } catch (e) {
    console.error('Error fetching master products from SQLite:', e);
    return [];
  }
}

export function replacePriceGroups(
  groups: SellingPriceGroupRecord[],
  prices: ProductSellingPriceRecord[]
): void {
  const db = getDatabase();
  try {
    // Delete child table product_selling_prices first to avoid foreign key / constraint conflicts
    try {
      db.runSync(`DELETE FROM product_selling_prices`);
    } catch {}

    // Delete parent table selling_price_groups second
    try {
      db.runSync(`DELETE FROM selling_price_groups`);
    } catch {}

    if (Array.isArray(groups)) {
      for (const g of groups) {
        const gid = g.group_id ?? g.price_group_id ?? (g as any).id;
        if (gid !== undefined && gid !== null) {
          try {
            db.runSync(
              `INSERT OR REPLACE INTO selling_price_groups (group_id, name, description, status) VALUES (?, ?, ?, ?)`,
              [Number(gid), g.name || '', g.description || '', g.status || 'Active']
            );
          } catch {}
        }
      }
    }

    if (Array.isArray(prices)) {
      for (const pr of prices) {
        const pid = pr.product_id ? Number(pr.product_id) : 0;
        const gid = pr.group_id ?? pr.price_group_id;
        const numericGid = gid !== undefined && gid !== null && !isNaN(Number(gid)) ? Number(gid) : null;
        const id = pr.id ?? pr.price_id ?? (pid && numericGid ? Number(`${pid}${numericGid}`) : Math.floor(Math.random() * 1000000));
        const price = Number(pr.price ?? pr.selling_price) || 0;

        if (pid > 0) {
          try {
            db.runSync(
              `INSERT OR REPLACE INTO product_selling_prices (id, product_id, group_id, price, box_price) VALUES (?, ?, ?, ?, ?)`,
              [Number(id), pid, numericGid, price, Number(pr.box_price) || 0]
            );
          } catch {}
        }
      }
    }
  } catch (e) {
    console.warn('Warning replacing price groups in SQLite:', e);
  }
}

export function getSellingPriceGroups(): SellingPriceGroupRecord[] {
  const db = getDatabase();
  try {
    return db.getAllSync<SellingPriceGroupRecord>(`SELECT * FROM selling_price_groups WHERE status = 'Active' ORDER BY name ASC`);
  } catch {
    return [];
  }
}

export function getProductSellingPrices(): ProductSellingPriceRecord[] {
  const db = getDatabase();
  try {
    return db.getAllSync<ProductSellingPriceRecord>(`SELECT * FROM product_selling_prices`);
  } catch {
    return [];
  }
}

export function formatStockQty(stock: {
  total_qty: number;
  package_type?: string;
  package_qty?: number;
  items_per_package?: number;
  unit?: string;
}): {
  unitText: string;
  packBreakdown: string;
  fullDisplay: string;
} {
  const total = Number(stock.total_qty) || 0;
  const itemsPerPkg = Number(stock.items_per_package) || 1;
  const pkgType = stock.package_type || 'Unit';
  const unitLabel = stock.unit || 'Units';

  if (itemsPerPkg > 1 && pkgType.toLowerCase() !== 'loose') {
    const fullPacks = Math.floor(total / itemsPerPkg);
    const loose = Math.round((total % itemsPerPkg) * 100) / 100;
    let packBreakdown = '';
    if (fullPacks > 0 && loose > 0) {
      packBreakdown = `${fullPacks} ${pkgType}${fullPacks > 1 ? 's' : ''} + ${loose} ${unitLabel}`;
    } else if (fullPacks > 0) {
      packBreakdown = `${fullPacks} ${pkgType}${fullPacks > 1 ? 's' : ''}`;
    } else {
      packBreakdown = `${loose} ${unitLabel}`;
    }
    return {
      unitText: `${total} ${unitLabel}`,
      packBreakdown: `${packBreakdown} (${itemsPerPkg}/pkg)`,
      fullDisplay: `${total} ${unitLabel} (${packBreakdown})`,
    };
  }

  const looseLabel = pkgType === 'Loose' ? unitLabel : `${pkgType}s`;
  return {
    unitText: `${total} ${unitLabel}`,
    packBreakdown: `${total} ${looseLabel}`,
    fullDisplay: `${total} ${unitLabel}`,
  };
}

export function getCustomerBalance(cust: CustomerRecord): number {
  const db = getDatabase();
  try {
    const identifiers: (string | number)[] = [cust.id];
    if (cust.customer_code) identifiers.push(cust.customer_code);
    if (cust.backend_id != null) {
      identifiers.push(cust.backend_id);
      identifiers.push(`cust-${cust.backend_id}`);
      identifiers.push(String(cust.backend_id));
    }
    const cleanName = (cust.name || '').trim().toLowerCase();
    const placeholders = identifiers.map(() => '?').join(',');

    const row = db.getFirstSync<{ balance: number }>(`
      SELECT COALESCE(SUM(
        CASE 
          WHEN sale_type = 'payment' OR status = 'Collected' THEN 0
          WHEN sale_type = 'return' OR status = 'Returned' THEN 0
          WHEN balance_amount IS NOT NULL THEN MAX(0, balance_amount) 
          ELSE MAX(0, total_amount - advance_amount) 
        END
      ), 0) as balance
      FROM advance_bookings
      WHERE _status != 'deleted' 
        AND status != 'Cancelled'
        AND (
          customer_id IN (${placeholders})
          OR LOWER(TRIM(customer_name)) = ?
        )
    `, [...identifiers, cleanName]);

    const bookingsBal = Math.max(0, row?.balance ?? 0);
    const staticBal = Math.max(0, Number(cust.outstanding_balance) || 0);

    return Math.max(bookingsBal, staticBal);
  } catch (e) {
    console.error('Error getting customer balance:', e);
    return Math.max(0, Number(cust.outstanding_balance) || 0);
  }
}

export function getCustomerBalances(): Record<string, number> {
  const db = getDatabase();
  try {
    const rows = db.getAllSync<{ customer_id: string; customer_name: string; balance: number }>(`
      SELECT 
        customer_id,
        customer_name,
        COALESCE(SUM(
          CASE 
            WHEN sale_type = 'payment' OR status = 'Collected' THEN 0
            WHEN sale_type = 'return' OR status = 'Returned' THEN 0
            WHEN balance_amount IS NOT NULL THEN MAX(0, balance_amount) 
            ELSE MAX(0, total_amount - advance_amount) 
          END
        ), 0) as balance
      FROM advance_bookings
      WHERE _status != 'deleted' AND status != 'Cancelled'
      GROUP BY customer_id, customer_name
    `);
    const map: Record<string, number> = {};
    for (const r of rows) {
      const b = Math.max(0, Number(r.balance) || 0);
      if (r.customer_id) {
        map[r.customer_id] = (map[r.customer_id] || 0) + b;
      }
      if (r.customer_name) {
        const nameKey = r.customer_name.trim().toLowerCase();
        map[nameKey] = (map[nameKey] || 0) + b;
      }
    }

    // Merge with static outstanding_balance from customers table
    const custRows = db.getAllSync<{ id: string; customer_code?: string; backend_id?: number; name?: string; outstanding_balance: number }>(`
      SELECT id, customer_code, backend_id, name, COALESCE(outstanding_balance, 0) as outstanding_balance
      FROM customers
      WHERE _status != 'deleted' AND outstanding_balance > 0
    `);
    for (const c of custRows) {
      const ob = Math.max(0, Number(c.outstanding_balance) || 0);
      if (ob > 0) {
        if (c.id && (map[c.id] === undefined || map[c.id] < ob)) map[c.id] = ob;
        if (c.customer_code && (map[c.customer_code] === undefined || map[c.customer_code] < ob)) map[c.customer_code] = ob;
        if (c.backend_id != null) {
          const bidKey = String(c.backend_id);
          const bidCustKey = `cust-${c.backend_id}`;
          if (map[bidKey] === undefined || map[bidKey] < ob) map[bidKey] = ob;
          if (map[bidCustKey] === undefined || map[bidCustKey] < ob) map[bidCustKey] = ob;
        }
        if (c.name) {
          const nameKey = c.name.trim().toLowerCase();
          if (map[nameKey] === undefined || map[nameKey] < ob) map[nameKey] = ob;
        }
      }
    }

    return map;
  } catch {
    return {};
  }
}

export function recordCustomerPayment(
  customerIdentifier: string,
  customerName: string,
  amount: number,
  paymentMethod: string = 'Cash',
  notes: string = '',
  salesmanIdParam?: string,
  salesmanNameParam?: string
): void {
  const db = getDatabase();
  const now = Date.now();
  let remainingToCredit = amount;

  let sId = salesmanIdParam;
  let sName = salesmanNameParam;
  if (!sId || !sName) {
    const cur = getCurrentSalesman();
    if (cur) {
      if (!sId) sId = cur.id;
      if (!sName) sName = cur.name;
    }
  }

  // 1. Reduce balance on open unpaid bookings for this customer (FIFO order)
  const openBookings = db.getAllSync<BookingRecord>(
    `SELECT * FROM advance_bookings 
     WHERE _status != 'deleted' AND status != 'Cancelled' 
       AND (
         customer_id = ? 
         OR customer_id = ? 
         OR LOWER(TRIM(customer_name)) = LOWER(TRIM(?))
       )
       AND (balance_amount > 0 OR (total_amount > advance_amount AND balance_amount IS NULL))
     ORDER BY created_at ASC`,
    [customerIdentifier, `cust-${customerIdentifier}`, customerName]
  );

  for (const b of openBookings) {
    if (remainingToCredit <= 0) break;
    const currentDue = b.balance_amount !== undefined && b.balance_amount !== null
      ? Number(b.balance_amount)
      : Math.max(0, Number(b.total_amount || 0) - Number(b.advance_amount || 0));

    if (currentDue > 0) {
      const deduction = Math.min(remainingToCredit, currentDue);
      const newBalance = Math.max(0, currentDue - deduction);
      const newAdvance = (Number(b.advance_amount) || 0) + deduction;
      const nextStatus = b._status === 'created' ? 'created' : 'updated';
      db.runSync(
        `UPDATE advance_bookings 
         SET balance_amount = ?, advance_amount = ?, _status = ?, updated_at = ? 
         WHERE id = ?`,
        [newBalance, newAdvance, nextStatus, now, b.id]
      );
      remainingToCredit -= deduction;
    }
  }

  // Also reduce outstanding_balance in SQLite customers table
  try {
    db.runSync(
      `UPDATE customers
       SET outstanding_balance = MAX(0, COALESCE(outstanding_balance, 0) - ?),
           _status = CASE WHEN _status = 'created' THEN 'created' ELSE 'updated' END,
           updated_at = ?
       WHERE id = ? 
          OR customer_code = ? 
          OR backend_id = ?
          OR LOWER(TRIM(name)) = LOWER(TRIM(?))`,
      [amount, now, customerIdentifier, customerIdentifier, customerIdentifier, customerName]
    );
  } catch (custUpErr) {
    console.warn('Could not update customer outstanding_balance in recordCustomerPayment:', custUpErr);
  }

  // 2. Insert payment receipt record for audit trail & sync
  const id = `pay_${now}_${Math.random().toString(36).substring(2, 7)}`;
  db.runSync(
    `INSERT INTO advance_bookings (
      id, salesman_id, salesman_name, customer_id, customer_name, product_id, product_name, package_qty, total_qty, unit_price, total_amount, advance_amount, balance_amount, status, sale_type, notes, _status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'PAY', 'Balance Payment Collection', 1, 1, ?, ?, ?, 0, 'Collected', 'payment', ?, 'created', ?, ?)`,
    [
      id,
      sId || null,
      sName || null,
      customerIdentifier,
      customerName,
      amount,
      amount,
      amount,
      notes ? `[PAYMENT_COLLECTION] ${notes}` : `[PAYMENT_COLLECTION] Payment received via ${paymentMethod}`,
      now,
      now,
    ]
  );
}

// ---------------------- Route Info DAO ----------------------

export function getAssignedRoute(): RouteInfo | null {
  const data = getSyncMeta('route_info');
  if (data) {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

export function setAssignedRoute(route: RouteInfo | null): void {
  if (route) {
    setSyncMeta('route_info', JSON.stringify(route));
  } else {
    setSyncMeta('route_info', '');
  }
}

export function clearSalesmanLocalData(keepRouteInfo: boolean = false): void {
  try {
    const db = getDatabase();
    db.runSync(`DELETE FROM customers`);
    db.runSync(`DELETE FROM van_stocks`);
    db.runSync(`DELETE FROM advance_bookings`);
    db.runSync(`DELETE FROM van_transfers`);
    db.runSync(`DELETE FROM stock_requests`);
    db.runSync(`DELETE FROM expenses`);
    if (!keepRouteInfo) {
      setSyncMeta('route_info', '');
      setSyncMeta('selected_route', '');
    }
    setSyncMeta('lastPulledAt', '0');
  } catch (e) {
    console.warn('Failed to clear local salesman data:', e);
  }
}

export function getSelectedRoute(): string {
  const available = getAvailableRoutes();
  const chosen = getSyncMeta('selected_route');
  if (chosen && available.includes(chosen)) {
    return chosen;
  }
  const assigned = getAssignedRoute();
  const defaultRoute = available[0] || (assigned?.district ? `${assigned.district} Beat (All Areas)` : 'All Routes');
  setSyncMeta('selected_route', defaultRoute);
  return defaultRoute;
}

export function setSelectedRoute(route: string): void {
  setSyncMeta('selected_route', route);
}

export function getAvailableRoutes(): string[] {
  const assigned = getAssignedRoute();
  const routes: string[] = [];

  if (assigned?.district) {
    const district = assigned.district;
    const primaryBeat = `${district} Beat (All Areas)`;
    routes.push(primaryBeat);
  }

  if (assigned?.route_name && !routes.includes(assigned.route_name)) {
    routes.push(assigned.route_name);
  }

  // 2. All individual local areas mapped on Web
  if (assigned?.local_areas) {
    let areas: string[] = [];
    if (Array.isArray(assigned.local_areas)) {
      areas = assigned.local_areas;
    } else if (typeof assigned.local_areas === 'string') {
      try {
        areas = JSON.parse(assigned.local_areas);
      } catch {}
    }
    for (const area of areas) {
      if (area && typeof area === 'string' && !routes.includes(area)) {
        routes.push(area);
      }
    }
  }

  // 3. Customer route areas and places matching this district
  try {
    const db = getDatabase();
    const rows = db.getAllSync<{ route_area?: string; place?: string }>(
      `SELECT DISTINCT route_area, place FROM customers 
       WHERE _status != 'deleted' AND ((route_area IS NOT NULL AND route_area != '') OR (place IS NOT NULL AND place != ''))`
    );
    for (const r of rows) {
      if (r.route_area) {
        const cleanArea = r.route_area.replace(/\(.*?\)/g, '').replace(/Beat/gi, '').trim();
        if (cleanArea && !routes.includes(cleanArea)) {
          routes.push(cleanArea);
        }
        if (!routes.includes(r.route_area)) {
          routes.push(r.route_area);
        }
      }
      if (r.place) {
        const firstPlace = r.place.split(',')[0].trim();
        if (firstPlace && !routes.includes(firstPlace)) {
          routes.push(firstPlace);
        }
      }
    }
  } catch {}

  if (!routes.includes('All Routes')) {
    routes.push('All Routes');
  }

  return routes;
}

/**
 * Returns strictly the salesman's assigned beat routes and local areas (e.g. Big Bazaar, Malampuzha, etc.)
 * Used exclusively when adding new customers in the field to restrict to the salesman's assigned territory.
 */
export function getSalesmanRouteAreas(): string[] {
  const assigned = getAssignedRoute();
  const areas: string[] = [];

  if (assigned?.local_areas) {
    let raw = assigned.local_areas;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {}
    }
    if (Array.isArray(raw)) {
      for (const a of raw) {
        if (a && typeof a === 'string') {
          const trimmed = a.trim();
          if (trimmed && !areas.includes(trimmed)) {
            areas.push(trimmed);
          }
        }
      }
    }
  }

  return areas;
}

// ---------------------- Dashboard Stats DAO ----------------------

export function getDashboardStats(selectedRouteParam?: string) {
  const db = getDatabase();
  const assigned = getAssignedRoute();
  const currentRoute = selectedRouteParam || getSelectedRoute();
  const assignedDistrict = assigned?.district || '';

  // Filter customers by selected route unless 'All Routes'
  let custCount = { count: 0 };
  try {
    let custQuery = `SELECT COUNT(*) as count FROM customers WHERE _status != 'deleted'`;
    const custParams: any[] = [];
    if (currentRoute && currentRoute !== 'All Routes') {
      const isAllDistrict =
        assignedDistrict &&
        (currentRoute.includes('(All Areas)') ||
          currentRoute.trim().toLowerCase() === `${assignedDistrict.toLowerCase()} beat` ||
          currentRoute.trim().toLowerCase() === `${assignedDistrict.toLowerCase()} territory`);

      if (isAllDistrict) {
        custQuery += ` AND (district LIKE ? OR route_area LIKE ? OR place LIKE ?)`;
        const f = `%${assignedDistrict}%`;
        custParams.push(f, f, f);
      } else {
        const cleanFilter = currentRoute
          .replace(/\(.*?\)/g, '')
          .replace(/Beat/gi, '')
          .trim();
        const searchTerm = cleanFilter.split(',')[0].trim() || currentRoute.trim();
        custQuery += ` AND (route_area LIKE ? OR place LIKE ? OR address LIKE ?)`;
        const f = `%${searchTerm}%`;
        custParams.push(f, f, f);
      }
    }
    const res = db.getFirstSync<{ count: number }>(custQuery, custParams);
    if (res) custCount = res;
  } catch {
    try {
      const fallbackRes = db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) as count FROM customers WHERE _status != 'deleted'`
      );
      if (fallbackRes) custCount = fallbackRes;
    } catch {}
  }

  // Filter by currently logged in salesman
  const curSalesman = getCurrentSalesman();
  const smFilter = curSalesman?.id
    ? ` AND (salesman_id = ? OR (salesman_id IS NULL AND (salesman_name LIKE ? OR salesman_name = ?)))`
    : '';
  const smParams: any[] = curSalesman?.id ? [curSalesman.id, `%${curSalesman.name}%`, curSalesman.name] : [];

  // 1. Direct Van Sales (Delivered / Spot Sales)
  const directSalesStats = db.getFirstSync<{
    count: number;
    total: number;
    cash: number;
  }>(
    `SELECT 
      COUNT(*) as count, 
      COALESCE(SUM(total_amount), 0) as total, 
      COALESCE(SUM(advance_amount), 0) as cash 
     FROM advance_bookings 
     WHERE _status != 'deleted' AND (sale_type = 'sale' OR status = 'Delivered')${smFilter}`,
    smParams
  );

  // 2. Advance Bookings / Future Orders
  const orderStats = db.getFirstSync<{
    count: number;
    total: number;
    advance: number;
  }>(
    `SELECT 
      COUNT(*) as count, 
      COALESCE(SUM(total_amount), 0) as total, 
      COALESCE(SUM(advance_amount), 0) as advance 
     FROM advance_bookings 
     WHERE _status != 'deleted' AND (sale_type = 'order' OR sale_type IS NULL) AND status != 'Delivered'${smFilter}`,
    smParams
  );

  // 3. Combined Balance Due / Credit Pending
  const balanceStats = db.getFirstSync<{ balance: number }>(
    `SELECT 
      COALESCE(SUM(CASE WHEN balance_amount > 0 THEN balance_amount ELSE MAX(0, total_amount - advance_amount) END), 0) as balance 
     FROM advance_bookings 
     WHERE _status != 'deleted'${smFilter}`,
    smParams
  );

  // Van Stock
  const vanStockStats = db.getFirstSync<{ count: number; total_qty: number; total_val: number }>(
    `SELECT 
       COUNT(*) as count, 
       COALESCE(SUM(total_qty), 0) as total_qty, 
       COALESCE(SUM(total_qty * COALESCE(unit_price, unit_cost, 0)), 0) as total_val 
     FROM van_stocks 
     WHERE status = 'Loaded'`
  );

  // Pending sync
  const pendingSync = db.getFirstSync<{ count: number }>(
    `SELECT (
      (SELECT COUNT(*) FROM customers WHERE _status != 'synced') +
      (SELECT COUNT(*) FROM advance_bookings WHERE _status != 'synced'${smFilter})
    ) as count`,
    smParams
  );

  const directSalesAmount = directSalesStats?.total ?? 0;
  const directSalesCount = directSalesStats?.count ?? 0;
  const directSalesCash = directSalesStats?.cash ?? 0;

  const ordersAmount = orderStats?.total ?? 0;
  const ordersCount = orderStats?.count ?? 0;
  const ordersAdvance = orderStats?.advance ?? 0;

  const totalCashCollected = directSalesCash + ordersAdvance;
  const pendingPayments = balanceStats?.balance ?? 0;

  // 4. Calculate Total Expenses for this salesman
  let totalExpenses = 0;
  try {
    const expStats = db.getFirstSync<{ total_exp: number }>(
      `SELECT COALESCE(SUM(amount), 0) as total_exp 
       FROM expenses 
       WHERE _status != 'deleted'${smFilter}`,
      smParams
    );
    totalExpenses = expStats?.total_exp ?? 0;
  } catch {}

  const netInHandCash = Math.max(0, totalCashCollected - totalExpenses);

  return {
    customerCount: custCount?.count ?? 0,
    bookingCount: directSalesCount + ordersCount,
    // Direct Van Sales
    directSalesCount,
    directSalesAmount,
    directSalesCash,
    // Advance Orders
    ordersCount,
    ordersAmount,
    ordersAdvance,
    // Overall Totals
    totalSalesAmount: directSalesAmount,
    totalOrdersAmount: ordersAmount,
    totalAdvanceCollected: ordersAdvance,
    totalCashCollected,
    totalExpenses,
    netInHandCash,
    pendingPayments,
    // Van Stock & Sync
    vanStockItems: vanStockStats?.count ?? 0,
    vanStockUnits: vanStockStats?.total_qty ?? 0,
    vanStockValue: vanStockStats?.total_val ?? 0,
    pendingSyncCount: pendingSync?.count ?? 0,
    route: assigned,
  };
}

// ---------------------- Sync Meta DAO ----------------------

export function getSyncMeta(key: string): string | null {
  const db = getDatabase();
  const res = db.getFirstSync<{ value: string }>(`SELECT value FROM sync_meta WHERE key = ?`, [key]);
  return res?.value ?? null;
}

export function setSyncMeta(key: string, value: string): void {
  const db = getDatabase();
  db.runSync(
    `INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

// ---------------------- Company Profile & Print Settings ----------------------

export interface CompanyProfile {
  id?: string;
  company_name?: string;
  legal_name?: string;
  tagline?: string;
  logo_url?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  state_code?: string;
  pincode?: string;
  tax_id?: string;
  gstin?: string;
  pan_number?: string;
  currency?: string;
  bank_name?: string;
  account_holder?: string;
  account_number?: string;
  ifsc_code?: string;
  bank_branch?: string;
  upi_id?: string;
  terms_and_conditions?: string;
  invoice_settings?: {
    active_template?: 'thermal' | 'mobile' | 'gst' | 'normal' | 'dotmatrix' | string;
    invoice_title?: string;
    invoice_prefix?: string;
    thermal_width?: '80mm' | '58mm' | string;
    show_logo?: boolean;
    show_hsn?: boolean;
    show_gst_breakdown?: boolean;
    show_bank_details?: boolean;
    show_upi_qr?: boolean;
    show_signature?: boolean;
    show_terms?: boolean;
    dot_matrix_columns?: string;
    signature_label?: string;
    mobile_receipt_header?: string;
    mobile_receipt_footer?: string;
    mobile_receipt_tagline?: string;
  };
  print_templates?: {
    thermalWidth?: string;
    activeTemplate?: string;
    paperSize?: string;
    showLogo?: boolean;
    showGstin?: boolean;
    showTerms?: boolean;
    showUpiQr?: boolean;
    showSignature?: boolean;
    showBankDetails?: boolean;
    showTaxBreakdown?: boolean;
  };
  web_access_enabled?: boolean;
  mobile_access_enabled?: boolean;
}

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  id: 'default_company',
  company_name: 'ABC',
  legal_name: 'ABC Company',
  tagline: 'Premium FMCG & Wholesale Distribution',
  logo_url: DEFAULT_COMPANY_LOGO,
  phone: '+917012751254',
  email: 'abc@mail.com',
  website: '',
  address: 'Malampuzha, Palakkad, KERALA',
  address_line1: 'Malampuzha',
  city: 'Palakkad',
  state: 'KERALA',
  state_code: '32',
  gstin: '32HJ4NNJ4NJ55',
  bank_name: '',
  account_holder: '',
  account_number: '',
  ifsc_code: '',
  bank_branch: '',
  upi_id: '',
  terms_and_conditions: '1. Goods once sold will not be taken back or exchanged.\n2. Payment due within agreed credit terms.',
  invoice_settings: {
    active_template: 'thermal',
    invoice_title: 'INVOICE',
    invoice_prefix: 'INV-2026-',
    thermal_width: '80mm',
    show_logo: true,
    show_hsn: true,
    show_gst_breakdown: true,
    show_bank_details: true,
    show_upi_qr: true,
    show_signature: true,
    show_terms: true,
    signature_label: 'Authorized Signatory',
    mobile_receipt_header: '',
    mobile_receipt_footer: 'Thank you for your business!',
    mobile_receipt_tagline: 'Powered by SoftAir SFA',
  },
  print_templates: {
    thermalWidth: '80mm',
    activeTemplate: 'thermal',
    paperSize: 'A4',
    showLogo: true,
    showGstin: true,
    showTerms: true,
    showUpiQr: true,
    showSignature: true,
    showBankDetails: true,
    showTaxBreakdown: true,
  },
};

export function getCompanyProfile(): CompanyProfile {
  const raw = getSyncMeta('company_profile');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          ...DEFAULT_COMPANY_PROFILE,
          ...parsed,
          logo_url: (parsed.logo_url && parsed.logo_url.trim().length > 0)
            ? parsed.logo_url.trim()
            : DEFAULT_COMPANY_PROFILE.logo_url,
          invoice_settings: {
            ...DEFAULT_COMPANY_PROFILE.invoice_settings,
            ...(parsed.invoice_settings || {}),
          },
          print_templates: {
            ...DEFAULT_COMPANY_PROFILE.print_templates,
            ...(parsed.print_templates || {}),
          },
        };
      }
    } catch {}
  }
  return DEFAULT_COMPANY_PROFILE;
}

export function setCompanyProfile(profile: Partial<CompanyProfile>): void {
  const current = getCompanyProfile();
  const merged: CompanyProfile = {
    ...current,
    ...profile,
    logo_url: (profile.logo_url && profile.logo_url.trim().length > 0)
      ? profile.logo_url.trim()
      : current.logo_url,
    invoice_settings: {
      ...(current.invoice_settings || {}),
      ...(profile.invoice_settings || {}),
    },
    print_templates: {
      ...(current.print_templates || {}),
      ...(profile.print_templates || {}),
    },
  };
  setSyncMeta('company_profile', JSON.stringify(merged));
}

// ---------------------- Stock Requests & Van Transfers DAO ----------------------

export function getStockRequests(): StockRequestRecord[] {
  const db = getDatabase();
  try {
    return db.getAllSync<StockRequestRecord>(
      `SELECT * FROM stock_requests WHERE _status != 'deleted' ORDER BY created_at DESC`
    );
  } catch {
    return [];
  }
}

export function createStockRequest(req: Omit<StockRequestRecord, 'id' | 'created_at' | 'updated_at'>): StockRequestRecord {
  const db = getDatabase();
  const now = Date.now();
  const id = `sr_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const currentYear = new Date().getFullYear();
  let maxSeq = 0;
  try {
    const rows = db.getAllSync<{ request_code: string | null }>(`SELECT request_code FROM stock_requests WHERE request_code LIKE 'REQ-${currentYear}-%'`);
    for (const r of rows) {
      if (r.request_code) {
        const parts = r.request_code.split('-');
        const n = parseInt(parts[parts.length - 1] || '0', 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    }
  } catch {}
  const requestCode = req.request_code || `REQ-${currentYear}-${String(maxSeq + 1).padStart(4, '0')}`;

  const record: StockRequestRecord = {
    ...req,
    id,
    request_code: requestCode,
    status: req.status || 'Pending',
    urgency: req.urgency || 'Normal',
    _status: 'created',
    created_at: now,
    updated_at: now,
  };

  db.runSync(
    `INSERT INTO stock_requests (
      id, request_code, salesman_id, salesman_name, warehouse_name, product_id, product_name, product_sku, package_type, requested_qty, urgency, status, notes, _status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.request_code ?? null,
      record.salesman_id || 'usr_sales_01',
      record.salesman_name || 'Arjun Nair',
      record.warehouse_name || 'Central Warehouse',
      record.product_id ?? null,
      record.product_name,
      record.product_sku ?? '',
      record.package_type ?? 'Loose',
      record.requested_qty,
      record.urgency ?? 'Normal',
      record.status ?? 'Pending',
      record.notes ?? '',
      record._status ?? 'created',
      record.created_at,
      record.updated_at,
    ]
  );
  return record;
}

export function getVanTransfers(): VanTransferRecord[] {
  const db = getDatabase();
  try {
    return db.getAllSync<VanTransferRecord>(
      `SELECT * FROM van_transfers WHERE _status != 'deleted' ORDER BY created_at DESC`
    );
  } catch {
    return [];
  }
}

export function createVanTransfer(transfer: Omit<VanTransferRecord, 'id' | 'created_at' | 'updated_at'>): VanTransferRecord {
  const db = getDatabase();
  const now = Date.now();
  const id = `vt_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const currentYear = new Date().getFullYear();
  let maxSeq = 0;
  try {
    const rows = db.getAllSync<{ transfer_code: string | null }>(`SELECT transfer_code FROM van_transfers WHERE transfer_code LIKE 'V2V-${currentYear}-%'`);
    for (const r of rows) {
      if (r.transfer_code) {
        const parts = r.transfer_code.split('-');
        const n = parseInt(parts[parts.length - 1] || '0', 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    }
  } catch {}
  const transferCode = transfer.transfer_code || `V2V-${currentYear}-${String(maxSeq + 1).padStart(4, '0')}`;

  const record: VanTransferRecord = {
    ...transfer,
    id,
    transfer_code: transferCode,
    status: transfer.status || 'Pending Handover',
    _status: 'created',
    created_at: now,
    updated_at: now,
  };

  db.runSync(
    `INSERT INTO van_transfers (
      id, transfer_code, source_salesman_id, source_salesman_name, source_vehicle_reg, target_salesman_id, target_salesman_name, target_vehicle_reg, product_id, product_name, product_sku, package_type, quantity, reason, location_of_exchange, status, notes, _status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.transfer_code ?? null,
      record.source_salesman_id ?? null,
      record.source_salesman_name || 'Sales Representative',
      record.source_vehicle_reg || 'N/A',
      record.target_salesman_id ?? null,
      record.target_salesman_name,
      record.target_vehicle_reg ?? '',
      record.product_id ?? null,
      record.product_name,
      record.product_sku ?? '',
      record.package_type ?? 'Loose',
      record.quantity,
      record.reason ?? 'Beat stock balance',
      record.location_of_exchange ?? 'Kerala Corridor',
      record.status ?? 'Pending Handover',
      record.notes ?? '',
      record._status ?? 'created',
      record.created_at,
      record.updated_at,
    ]
  );
  return record;
}

export function updateVanTransferStatus(idOrCode: string, status: string, notes?: string): void {
  const db = getDatabase();
  db.runSync(
    `UPDATE van_transfers SET status = ?, notes = COALESCE(?, notes), _status = 'updated', updated_at = ? WHERE id = ? OR transfer_code = ?`,
    [status, notes ?? null, Date.now(), idOrCode, idOrCode]
  );
}

export function getAvailableSalesmen(): AvailableSalesman[] {
  try {
    const raw = getSyncMeta('available_salesmen');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function setAvailableSalesmen(list: AvailableSalesman[]): void {
  setSyncMeta('available_salesmen', JSON.stringify(list));
}

export function upsertVanTransfers(serverTransfers: any[]): void {
  if (!Array.isArray(serverTransfers) || serverTransfers.length === 0) return;
  const db = getDatabase();
  for (const t of serverTransfers) {
    try {
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
    } catch (err) {
      console.warn('Error upserting van transfer in SQLite:', err);
    }
  }
}

// ---------------------- Expense Management DAO ----------------------

export function addExpense(data: {
  amount: number;
  reason: string;
  category?: string;
  payment_mode?: string;
  expense_date?: string;
  salesman_id?: string;
  salesman_name?: string;
}): ExpenseRecord {
  const db = getDatabase();
  const cur = getCurrentSalesman();
  const id = `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const dateStr = data.expense_date || new Date().toISOString();
  const dateNum = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randNum = Math.floor(1000 + Math.random() * 9000);
  const expense_code = `EXP-${dateNum}-${randNum}`;
  const category = data.category || 'General';
  const payment_mode = data.payment_mode || 'Cash';
  const now = Date.now();
  const sid = data.salesman_id || cur?.id || '';
  const sname = data.salesman_name || cur?.name || 'Field Salesman';

  db.runSync(
    `INSERT INTO expenses (
      id, expense_code, salesman_id, salesman_name, category, amount, reason, payment_mode, expense_date, _status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?)`,
    [
      id,
      expense_code,
      sid,
      sname,
      category,
      Number(data.amount) || 0,
      data.reason.trim(),
      payment_mode,
      dateStr,
      now,
      now,
    ]
  );

  return {
    id,
    expense_code,
    salesman_id: cur?.id || '',
    salesman_name: cur?.name || 'Field Salesman',
    category,
    amount: Number(data.amount) || 0,
    reason: data.reason.trim(),
    payment_mode,
    expense_date: dateStr,
    _status: 'created',
    created_at: now,
    updated_at: now,
  };
}

export function getExpenses(salesmanId?: string): ExpenseRecord[] {
  const db = getDatabase();
  const cur = getCurrentSalesman();
  const targetId = salesmanId || cur?.id;
  const targetName = cur?.name;

  try {
    if (targetId || targetName) {
      return db.getAllSync<ExpenseRecord>(
        `SELECT * FROM expenses 
         WHERE _status != 'deleted' 
           AND (salesman_id = ? OR (salesman_id = '' AND salesman_name LIKE ?))
         ORDER BY created_at DESC, expense_date DESC`,
        [targetId || '', targetName ? `%${targetName}%` : '']
      );
    }

    return db.getAllSync<ExpenseRecord>(
      `SELECT * FROM expenses WHERE _status != 'deleted' ORDER BY created_at DESC, expense_date DESC`
    );
  } catch (err) {
    console.warn('Error reading expenses from SQLite:', err);
    return [];
  }
}

export function getInHandCashStats(): {
  totalCashCollected: number;
  totalExpenses: number;
  netInHandCash: number;
} {
  const stats = getDashboardStats();
  return {
    totalCashCollected: stats.totalCashCollected,
    totalExpenses: stats.totalExpenses ?? 0,
    netInHandCash: stats.netInHandCash ?? stats.totalCashCollected,
  };
}

export function upsertExpenses(expenses: ExpenseRecord[]) {
  if (!Array.isArray(expenses) || expenses.length === 0) return;
  const db = getDatabase();
  for (const exp of expenses) {
    try {
      const createdAt = exp.created_at
        ? (typeof exp.created_at === 'number' && !isNaN(exp.created_at)
            ? exp.created_at
            : (!isNaN(new Date(exp.created_at).getTime()) ? new Date(exp.created_at).getTime() : Date.now()))
        : Date.now();
      const updatedAt = exp.updated_at
        ? (typeof exp.updated_at === 'number' && !isNaN(exp.updated_at)
            ? exp.updated_at
            : (!isNaN(new Date(exp.updated_at).getTime()) ? new Date(exp.updated_at).getTime() : Date.now()))
        : Date.now();

      db.runSync(
        `INSERT INTO expenses (
          id, expense_code, salesman_id, salesman_name, category, amount, reason, payment_mode, expense_date, _status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          category = excluded.category,
          amount = excluded.amount,
          reason = excluded.reason,
          payment_mode = excluded.payment_mode,
          expense_date = excluded.expense_date,
          updated_at = excluded.updated_at`,
        [
          exp.id,
          exp.expense_code || '',
          exp.salesman_id || '',
          exp.salesman_name || '',
          exp.category || 'General',
          Number(exp.amount) || 0,
          exp.reason || '',
          exp.payment_mode || 'Cash',
          exp.expense_date || new Date().toISOString(),
          createdAt,
          updatedAt,
        ]
      );
    } catch (e) {
      console.warn('Error upserting expense record in SQLite:', e);
    }
  }
}

// ============================================================================
// MOBILE REPORTS DAO: 8 Specialized Reports for Field Sales
// ============================================================================

export interface CollectionReportItem {
  id: string;
  booking_code: string;
  date: string;
  customer_name: string;
  sale_type: string;
  amount_collected: number;
  total_amount: number;
  balance_amount: number;
  payment_mode: string;
  status: string;
}

export interface RouteWiseSaleItem {
  route_name: string;
  orders_count: number;
  total_sales: number;
  cash_collected: number;
  balance_due: number;
}

export interface PaymentReportItem {
  id: string;
  receipt_number: string;
  date: string;
  customer_name: string;
  customer_place: string;
  amount: number;
  payment_mode: string;
  payment_type: string;
  status: string;
}

export interface OutstandingReportItem {
  id: string;
  customer_code: string;
  customer_name: string;
  phone: string;
  route_area: string;
  credit_limit: number;
  credit_days: number;
  outstanding_balance: number;
  risk_level: 'Healthy' | 'Medium' | 'High';
}

export interface ExpenseReportItem {
  id: string;
  expense_code: string;
  date: string;
  category: string;
  reason: string;
  amount: number;
  payment_mode: string;
  status: string;
}

export interface OrderReportItem {
  id: string;
  booking_code: string;
  date: string;
  customer_name: string;
  product_summary: string;
  package_qty: number;
  total_qty: number;
  total_amount: number;
  advance_amount: number;
  balance_amount: number;
  status: string;
}

export interface ItemWiseSaleItem {
  product_name: string;
  category_name: string;
  package_qty: number;
  total_units: number;
  total_revenue: number;
  avg_price: number;
}

export interface CustomerWiseSaleItem {
  customer_name: string;
  customer_id: string;
  sales_count: number;
  total_purchase: number;
  total_paid: number;
  balance_due: number;
}

export interface ClosingStockReportItem {
  allocation_id: number;
  product_id: number;
  product_name: string;
  product_sku: string;
  category_name: string;
  unit: string;
  package_type: string;
  items_per_package: number;
  loaded_qty: number;
  sold_qty: number;
  closing_qty: number;
  closing_packs: number;
  closing_display: string;
  unit_price: number;
  unit_cost: number;
  total_value: number;
  batch_no: string;
  status: 'In Stock' | 'Low Stock' | 'Out of Stock';
}

/**
 * 1. Collections Report: Direct van sales cash, order advance payments, and customer balance collections
 */
export function getCollectionsReportData(): {
  items: CollectionReportItem[];
  totals: {
    totalCollected: number;
    cashCollected: number;
    onlineCollected: number;
    totalTransactions: number;
  };
} {
  const db = getDatabase();
  const cur = getCurrentSalesman();
  const sid = cur?.id || '';
  const sname = cur?.name || '';

  try {
    const rows = db.getAllSync<any>(
      `SELECT * FROM advance_bookings 
       WHERE _status != 'deleted' 
         AND (
           salesman_id = ? OR 
           (salesman_name IS NOT NULL AND salesman_name LIKE ?) OR
           (? = '' AND ? = '')
         )
         AND (advance_amount > 0 OR sale_type = 'payment' OR status = 'Delivered')
       ORDER BY created_at DESC`,
      [sid, sname ? `%${sname}%` : '', sid, sname]
    );

    let totalCollected = 0;
    let cashCollected = 0;
    let onlineCollected = 0;

    const items: CollectionReportItem[] = rows.map((r) => {
      let collected = Number(r.advance_amount) || 0;
      if (collected <= 0 && r.sale_type === 'sale') {
        collected = Number(r.total_amount) || 0;
      }
      if (r.sale_type === 'payment') {
        collected = Number(r.total_amount) || Number(r.advance_amount) || 0;
      }

      const isOnline = (r.notes && (r.notes.includes('UPI') || r.notes.includes('Online') || r.notes.includes('NEFT'))) || false;
      const payment_mode = isOnline ? 'Online / UPI' : 'Cash';

      totalCollected += collected;
      if (isOnline) {
        onlineCollected += collected;
      } else {
        cashCollected += collected;
      }

      const dateStr = r.created_at
        ? new Date(Number(r.created_at)).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : 'Today';

      const typeLabel =
        r.sale_type === 'payment'
          ? 'Due Clearance'
          : r.sale_type === 'sale'
          ? 'Direct Van Sale'
          : 'Advance Booking';

      const bal = Number(r.balance_amount) || Math.max(0, (Number(r.total_amount) || 0) - collected);

      return {
        id: r.id,
        booking_code: r.booking_code || r.id,
        date: dateStr,
        customer_name: r.customer_name || 'Walk-in Customer',
        sale_type: typeLabel,
        amount_collected: collected,
        total_amount: Number(r.total_amount) || 0,
        balance_amount: bal,
        payment_mode,
        status: r.status || 'Confirmed',
      };
    });

    return {
      items,
      totals: {
        totalCollected,
        cashCollected,
        onlineCollected,
        totalTransactions: items.length,
      },
    };
  } catch (err) {
    console.warn('Error generating collections report from SQLite:', err);
    return {
      items: [],
      totals: { totalCollected: 0, cashCollected: 0, onlineCollected: 0, totalTransactions: 0 },
    };
  }
}

/**
 * 2. Route Wise Sales Report: Grouping sales and collections by Beat / Territory
 */
export function getRouteWiseSalesReportData(): {
  items: RouteWiseSaleItem[];
  totals: {
    totalSales: number;
    cashCollected: number;
    balanceDue: number;
    totalOrders: number;
  };
} {
  const db = getDatabase();
  const cur = getCurrentSalesman();
  const sid = cur?.id || '';
  const sname = cur?.name || '';
  const assigned = getAssignedRoute();

  try {
    const rows = db.getAllSync<any>(
      `SELECT 
         b.id,
         b.total_amount,
         b.advance_amount,
         b.balance_amount,
         COALESCE(NULLIF(c.route_area, ''), NULLIF(c.local_area, ''), NULLIF(c.place, ''), 'Central Route') as computed_route
       FROM advance_bookings b
       LEFT JOIN customers c ON b.customer_id = c.id OR b.customer_name = c.name
       WHERE b._status != 'deleted'
         AND (
           b.salesman_id = ? OR 
           (b.salesman_name IS NOT NULL AND b.salesman_name LIKE ?) OR
           (? = '' AND ? = '')
         )
       ORDER BY b.created_at DESC`,
      [sid, sname ? `%${sname}%` : '', sid, sname]
    );

    const routeMap: Record<string, RouteWiseSaleItem> = {};
    const defaultRoute = assigned?.route_name || 'Assigned Territory';
    routeMap[defaultRoute] = {
      route_name: defaultRoute,
      orders_count: 0,
      total_sales: 0,
      cash_collected: 0,
      balance_due: 0,
    };

    rows.forEach((r) => {
      const rName = r.computed_route || defaultRoute;
      if (!routeMap[rName]) {
        routeMap[rName] = {
          route_name: rName,
          orders_count: 0,
          total_sales: 0,
          cash_collected: 0,
          balance_due: 0,
        };
      }
      routeMap[rName].orders_count += 1;
      routeMap[rName].total_sales += Number(r.total_amount) || 0;
      routeMap[rName].cash_collected += Number(r.advance_amount) || 0;
      let bal = Number(r.balance_amount) || 0;
      if (bal <= 0 && Number(r.total_amount) > Number(r.advance_amount)) {
        bal = Math.max(0, Number(r.total_amount) - Number(r.advance_amount));
      }
      routeMap[rName].balance_due += bal;
    });

    const items = Object.values(routeMap).filter(
      (item) => item.orders_count > 0 || item.route_name === defaultRoute
    );

    const totals = items.reduce(
      (acc, curr) => ({
        totalSales: acc.totalSales + curr.total_sales,
        cashCollected: acc.cashCollected + curr.cash_collected,
        balanceDue: acc.balanceDue + curr.balance_due,
        totalOrders: acc.totalOrders + curr.orders_count,
      }),
      { totalSales: 0, cashCollected: 0, balanceDue: 0, totalOrders: 0 }
    );

    return { items, totals };
  } catch (err) {
    console.warn('Error generating route wise sales report:', err);
    return {
      items: [],
      totals: { totalSales: 0, cashCollected: 0, balanceDue: 0, totalOrders: 0 },
    };
  }
}

/**
 * 3. Payments Report: Customer Payment Receipts Log
 */
export function getPaymentsReportData(): {
  items: PaymentReportItem[];
  totals: {
    totalPayments: number;
    cashTotal: number;
    onlineTotal: number;
    receiptsCount: number;
  };
} {
  const db = getDatabase();
  const cur = getCurrentSalesman();
  const sid = cur?.id || '';
  const sname = cur?.name || '';

  try {
    const rows = db.getAllSync<any>(
      `SELECT 
         b.id,
         b.booking_code,
         b.customer_name,
         b.created_at,
         b.advance_amount,
         b.total_amount,
         b.sale_type,
         b.notes,
         b.status,
         c.place,
         c.route_area
       FROM advance_bookings b
       LEFT JOIN customers c ON b.customer_id = c.id OR b.customer_name = c.name
       WHERE b._status != 'deleted'
         AND (b.advance_amount > 0 OR b.sale_type = 'payment' OR b.status = 'Delivered')
         AND (
           (? != '' AND b.salesman_id = ?) OR
           (? != '' AND b.salesman_name LIKE ?) OR
           (? = '' AND ? = '')
         )
       ORDER BY b.created_at DESC`,
      [sid, sid, sname, sname ? `%${sname}%` : '', sid, sname]
    );

    let totalPayments = 0;
    let cashTotal = 0;
    let onlineTotal = 0;

    const items: PaymentReportItem[] = rows.map((r) => {
      let paidAmt = Number(r.advance_amount) || 0;
      if (paidAmt <= 0 && r.sale_type === 'sale') {
        paidAmt = Number(r.total_amount) || 0;
      }
      if (r.sale_type === 'payment') {
        paidAmt = Number(r.total_amount) || Number(r.advance_amount) || 0;
      }

      const isOnline = r.notes && (r.notes.includes('UPI') || r.notes.includes('Online'));
      const payment_mode = isOnline ? 'Online / UPI' : 'Cash';

      totalPayments += paidAmt;
      if (isOnline) onlineTotal += paidAmt;
      else cashTotal += paidAmt;

      const dateStr = r.created_at
        ? new Date(Number(r.created_at)).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : 'Today';

      const type =
        r.sale_type === 'payment'
          ? 'Due Clearance'
          : r.sale_type === 'sale'
          ? 'Spot Sale'
          : 'Advance Receipt';

      return {
        id: r.id,
        receipt_number: r.booking_code || r.id,
        date: dateStr,
        customer_name: r.customer_name || 'Customer',
        customer_place: r.place || r.route_area || 'Market Beat',
        amount: paidAmt,
        payment_mode,
        payment_type: type,
        status: r.status || 'Received',
      };
    });

    return {
      items,
      totals: {
        totalPayments,
        cashTotal,
        onlineTotal,
        receiptsCount: items.length,
      },
    };
  } catch (err) {
    console.warn('Error generating payments report:', err);
    return {
      items: [],
      totals: { totalPayments: 0, cashTotal: 0, onlineTotal: 0, receiptsCount: 0 },
    };
  }
}

/**
 * 4. Outstanding Report: Customer Receivables & Credit Ledger
 */
export function getOutstandingReportData(): {
  items: OutstandingReportItem[];
  totals: {
    totalOutstanding: number;
    debtorsCount: number;
    totalCreditLimit: number;
  };
} {
  const db = getDatabase();

  try {
    // 1. Calculate live unpaid balances directly from advance_bookings
    const bookingRows = db.getAllSync<any>(
      `SELECT customer_id, customer_name, total_amount, advance_amount, balance_amount
       FROM advance_bookings
       WHERE _status != 'deleted' AND status != 'Cancelled'`
    );

    const bookingDueMap: Record<string, number> = {};
    bookingRows.forEach((b) => {
      const tot = Number(b.total_amount) || 0;
      const adv = Number(b.advance_amount) || 0;
      let bal = Number(b.balance_amount) || 0;
      if (bal <= 0 && tot > adv) {
        bal = tot - adv;
      }
      if (bal > 0) {
        if (b.customer_id) {
          bookingDueMap[String(b.customer_id)] = (bookingDueMap[String(b.customer_id)] || 0) + bal;
        }
        if (b.customer_name) {
          const key = String(b.customer_name).trim().toLowerCase();
          bookingDueMap[key] = (bookingDueMap[key] || 0) + bal;
        }
      }
    });

    const rows = db.getAllSync<any>(
      `SELECT * FROM customers 
       WHERE _status != 'deleted' 
       ORDER BY outstanding_balance DESC, name ASC`
    );

    let totalOutstanding = 0;
    let totalCreditLimit = 0;
    let debtorsCount = 0;

    const items: OutstandingReportItem[] = rows.map((c) => {
      const rawBalance = Number(c.outstanding_balance) || 0;
      const liveDue = bookingDueMap[String(c.id)] || bookingDueMap[String(c.name || '').trim().toLowerCase()] || 0;
      const balance = Math.max(rawBalance, liveDue);
      const limit = Number(c.credit_limit) || 0;

      totalOutstanding += balance;
      totalCreditLimit += limit;
      if (balance > 0) debtorsCount += 1;

      let risk_level: 'Healthy' | 'Medium' | 'High' = 'Healthy';
      if (limit > 0 && balance >= limit * 0.85) {
        risk_level = 'High';
      } else if (balance > 0) {
        risk_level = 'Medium';
      }

      return {
        id: c.id,
        customer_code: c.customer_code || `CUST-${c.id.slice(0, 6)}`,
        customer_name: c.name,
        phone: c.phone || 'N/A',
        route_area: c.route_area || c.local_area || c.place || 'Field Beat',
        credit_limit: limit,
        credit_days: Number(c.credit_days) || 30,
        outstanding_balance: balance,
        risk_level,
      };
    });

    items.sort((a, b) => b.outstanding_balance - a.outstanding_balance);

    return {
      items,
      totals: {
        totalOutstanding,
        debtorsCount,
        totalCreditLimit,
      },
    };
  } catch (err) {
    console.warn('Error generating outstanding report:', err);
    return {
      items: [],
      totals: { totalOutstanding: 0, debtorsCount: 0, totalCreditLimit: 0 },
    };
  }
}

/**
 * 5. Expenses Report: Field expenditures and live net in-hand cash
 */
export function getExpensesReportData(): {
  items: ExpenseReportItem[];
  totals: {
    totalExpenses: number;
    fuelTotal: number;
    foodTotal: number;
    maintenanceTotal: number;
    netInHandCash: number;
  };
} {
  const db = getDatabase();
  const cur = getCurrentSalesman();
  const sid = cur?.id || '';
  const sname = cur?.name || '';
  const inHandStats = getInHandCashStats();

  try {
    const rows = db.getAllSync<any>(
      `SELECT * FROM expenses 
       WHERE _status != 'deleted' 
         AND (
           (? != '' AND salesman_id = ?) OR 
           (? != '' AND salesman_name LIKE ?) OR
           (? = '' AND ? = '')
         )
       ORDER BY created_at DESC, expense_date DESC`,
      [sid, sid, sname, sname ? `%${sname}%` : '', sid, sname]
    );

    let totalExpenses = 0;
    let fuelTotal = 0;
    let foodTotal = 0;
    let maintenanceTotal = 0;

    const items: ExpenseReportItem[] = rows.map((e) => {
      const amt = Number(e.amount) || 0;
      totalExpenses += amt;

      const catLower = (e.category || '').toLowerCase();
      if (catLower.includes('fuel') || catLower.includes('diesel')) fuelTotal += amt;
      else if (catLower.includes('food') || catLower.includes('meal')) foodTotal += amt;
      else if (catLower.includes('toll') || catLower.includes('repair')) maintenanceTotal += amt;

      const dateStr = e.expense_date
        ? new Date(e.expense_date).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : 'Today';

      return {
        id: e.id,
        expense_code: e.expense_code || e.id,
        date: dateStr,
        category: e.category || 'General',
        reason: e.reason || 'Operational expense',
        amount: amt,
        payment_mode: e.payment_mode || 'Cash',
        status: e._status === 'synced' ? 'Synced to DB' : 'Local Draft',
      };
    });

    return {
      items,
      totals: {
        totalExpenses,
        fuelTotal,
        foodTotal,
        maintenanceTotal,
        netInHandCash: inHandStats.netInHandCash,
      },
    };
  } catch (err) {
    console.warn('Error generating expenses report:', err);
    return {
      items: [],
      totals: { totalExpenses: 0, fuelTotal: 0, foodTotal: 0, maintenanceTotal: 0, netInHandCash: 0 },
    };
  }
}

/**
 * 6. Orders Report: Advance Orders and spot deliveries
 */
export function getOrdersReportData(): {
  items: OrderReportItem[];
  totals: {
    totalOrdersCount: number;
    totalOrdersValue: number;
    totalAdvanceReceived: number;
    totalBalanceDue: number;
  };
} {
  const db = getDatabase();
  const cur = getCurrentSalesman();
  const sid = cur?.id || '';
  const sname = cur?.name || '';

  try {
    const rows = db.getAllSync<any>(
      `SELECT * FROM advance_bookings 
       WHERE _status != 'deleted' 
         AND (
           sale_type = 'order' 
           OR (sale_type IS NULL AND status NOT IN ('Delivered', 'Returned', 'Collected'))
         )
         AND (product_name IS NULL OR product_name != 'Balance Payment Collection')
         AND (booking_code IS NULL OR (booking_code NOT LIKE '%-INV-%' AND booking_code NOT LIKE '%-RET-%'))
         AND (
           (? != '' AND salesman_id = ?) OR 
           (? != '' AND salesman_name LIKE ?) OR
           (? = '' AND ? = '')
         )
       ORDER BY created_at DESC`,
      [sid, sid, sname, sname ? `%${sname}%` : '', sid, sname]
    );

    let totalOrdersValue = 0;
    let totalAdvanceReceived = 0;
    let totalBalanceDue = 0;

    const items: OrderReportItem[] = rows.map((r) => {
      const tot = Number(r.total_amount) || 0;
      const adv = Number(r.advance_amount) || 0;
      let bal = Number(r.balance_amount) || 0;
      if (bal <= 0 && tot > adv) {
        bal = tot - adv;
      }

      totalOrdersValue += tot;
      totalAdvanceReceived += adv;
      totalBalanceDue += bal;

      let summary = r.product_name || 'Standard Product';
      if (r.items) {
        try {
          const parsed = typeof r.items === 'string' ? JSON.parse(r.items) : r.items;
          if (Array.isArray(parsed) && parsed.length > 0) {
            summary = parsed.map((it: any) => `${it.product_name || it.name} (${it.qty || it.total_qty})`).join(', ');
          }
        } catch {}
      }

      const dateStr = r.created_at
        ? new Date(Number(r.created_at)).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : 'Today';

      return {
        id: r.id,
        booking_code: r.booking_code || r.id,
        date: dateStr,
        customer_name: r.customer_name || 'Walk-in',
        product_summary: summary,
        package_qty: Number(r.package_qty) || 1,
        total_qty: Number(r.total_qty) || 1,
        total_amount: tot,
        advance_amount: adv,
        balance_amount: bal,
        status: r.status || 'Confirmed',
      };
    });

    return {
      items,
      totals: {
        totalOrdersCount: items.length,
        totalOrdersValue,
        totalAdvanceReceived,
        totalBalanceDue,
      },
    };
  } catch (err) {
    console.warn('Error generating orders report:', err);
    return {
      items: [],
      totals: { totalOrdersCount: 0, totalOrdersValue: 0, totalAdvanceReceived: 0, totalBalanceDue: 0 },
    };
  }
}

/**
 * 7. Items Wise Sales Report: Quantity and Revenue grouped by Product
 */
export function getItemsWiseSalesReportData(): {
  items: ItemWiseSaleItem[];
  totals: {
    totalUnitsSold: number;
    totalPackagesSold: number;
    totalRevenue: number;
    productsCount: number;
  };
} {
  const db = getDatabase();
  const cur = getCurrentSalesman();
  const sid = cur?.id || '';
  const sname = cur?.name || '';

  try {
    const rows = db.getAllSync<any>(
      `SELECT * FROM advance_bookings 
       WHERE _status != 'deleted' 
         AND (
           (? != '' AND salesman_id = ?) OR 
           (? != '' AND salesman_name LIKE ?) OR
           (? = '' AND ? = '')
         )`,
      [sid, sid, sname, sname ? `%${sname}%` : '', sid, sname]
    );

    const itemMap: Record<string, ItemWiseSaleItem> = {};

    rows.forEach((r) => {
      if (r.items) {
        try {
          const parsed = typeof r.items === 'string' ? JSON.parse(r.items) : r.items;
          if (Array.isArray(parsed) && parsed.length > 0) {
            parsed.forEach((it: any) => {
              const pName = it.product_name || it.name || 'Product';
              const pQty = Number(it.package_qty || 1);
              const uQty = Number(it.qty || it.total_qty || 1);
              const rev = Number(it.total || it.total_amount || (uQty * Number(it.unit_price || 0)));

              if (!itemMap[pName]) {
                itemMap[pName] = {
                  product_name: pName,
                  category_name: it.category_name || 'Standard Pack',
                  package_qty: 0,
                  total_units: 0,
                  total_revenue: 0,
                  avg_price: 0,
                };
              }
              itemMap[pName].package_qty += pQty;
              itemMap[pName].total_units += uQty;
              itemMap[pName].total_revenue += rev;
            });
            return;
          }
        } catch {}
      }

      const pName = r.product_name || 'Standard Product';
      const pQty = Number(r.package_qty || 1);
      const uQty = Number(r.total_qty || 1);
      const rev = Number(r.total_amount || 0);

      if (!itemMap[pName]) {
        itemMap[pName] = {
          product_name: pName,
          category_name: 'FMCG Pack',
          package_qty: 0,
          total_units: 0,
          total_revenue: 0,
          avg_price: 0,
        };
      }
      itemMap[pName].package_qty += pQty;
      itemMap[pName].total_units += uQty;
      itemMap[pName].total_revenue += rev;
    });

    const items = Object.values(itemMap).map((it) => ({
      ...it,
      avg_price: it.total_units > 0 ? it.total_revenue / it.total_units : 0,
    })).sort((a, b) => b.total_revenue - a.total_revenue);

    const totals = items.reduce(
      (acc, curr) => ({
        totalUnitsSold: acc.totalUnitsSold + curr.total_units,
        totalPackagesSold: acc.totalPackagesSold + curr.package_qty,
        totalRevenue: acc.totalRevenue + curr.total_revenue,
        productsCount: items.length,
      }),
      { totalUnitsSold: 0, totalPackagesSold: 0, totalRevenue: 0, productsCount: 0 }
    );

    return { items, totals };
  } catch (err) {
    console.warn('Error generating items wise sales report:', err);
    return {
      items: [],
      totals: { totalUnitsSold: 0, totalPackagesSold: 0, totalRevenue: 0, productsCount: 0 },
    };
  }
}

/**
 * 8. Customers Wise Sales Report: Sales breakdown per customer
 */
export function getCustomersWiseSalesReportData(): {
  items: CustomerWiseSaleItem[];
  totals: {
    totalRevenue: number;
    totalCollected: number;
    totalBalanceDue: number;
    customersCount: number;
  };
} {
  const db = getDatabase();
  const cur = getCurrentSalesman();
  const sid = cur?.id || '';
  const sname = cur?.name || '';

  try {
    const rows = db.getAllSync<any>(
      `SELECT 
         b.customer_name,
         b.customer_id,
         b.total_amount,
         b.advance_amount,
         b.balance_amount
       FROM advance_bookings b
       WHERE b._status != 'deleted'
         AND (
           (? != '' AND b.salesman_id = ?) OR 
           (? != '' AND b.salesman_name LIKE ?) OR
           (? = '' AND ? = '')
         )
       ORDER BY b.created_at DESC`,
      [sid, sid, sname, sname ? `%${sname}%` : '', sid, sname]
    );

    const custMap: Record<string, CustomerWiseSaleItem> = {};

    rows.forEach((r) => {
      const cName = r.customer_name || 'Walk-in Customer';
      if (!custMap[cName]) {
        custMap[cName] = {
          customer_name: cName,
          customer_id: r.customer_id || '',
          sales_count: 0,
          total_purchase: 0,
          total_paid: 0,
          balance_due: 0,
        };
      }
      const tot = Number(r.total_amount) || 0;
      const adv = Number(r.advance_amount) || 0;
      let bal = Number(r.balance_amount) || 0;
      if (bal <= 0 && tot > adv) {
        bal = tot - adv;
      }
      custMap[cName].sales_count += 1;
      custMap[cName].total_purchase += tot;
      custMap[cName].total_paid += adv;
      custMap[cName].balance_due += bal;
    });

    const items = Object.values(custMap).sort((a, b) => b.total_purchase - a.total_purchase);

    const totals = items.reduce(
      (acc, curr) => ({
        totalRevenue: acc.totalRevenue + curr.total_purchase,
        totalCollected: acc.totalCollected + curr.total_paid,
        totalBalanceDue: acc.totalBalanceDue + curr.balance_due,
        customersCount: items.length,
      }),
      { totalRevenue: 0, totalCollected: 0, totalBalanceDue: 0, customersCount: 0 }
    );

    return { items, totals };
  } catch (err) {
    console.warn('Error generating customers wise sales report:', err);
    return {
      items: [],
      totals: { totalRevenue: 0, totalCollected: 0, totalBalanceDue: 0, customersCount: 0 },
    };
  }
}

/**
 * 9. Closing Stock Report: Physical van stock verification, loaded vs sold vs closing reconciliation
 */
export function getClosingStockReportData(): {
  items: ClosingStockReportItem[];
  totals: {
    totalClosingValue: number;
    totalClosingUnits: number;
    totalClosingPacks: number;
    totalLoadedUnits: number;
    totalSoldUnits: number;
    productsCount: number;
  };
} {
  const db = getDatabase();
  const cur = getCurrentSalesman();
  const sid = cur?.id || '';
  const sname = cur?.name || '';

  try {
    // 1. Gather units sold from advance_bookings for this salesman
    const bookingRows = db.getAllSync<any>(
      `SELECT * FROM advance_bookings 
       WHERE _status != 'deleted' 
         AND (
           (? != '' AND salesman_id = ?) OR 
           (? != '' AND salesman_name LIKE ?) OR
           (? = '' AND ? = '')
         )`,
      [sid, sid, sname, sname ? `%${sname}%` : '', sid, sname]
    );

    const soldQtyByProdId: Record<number, number> = {};
    const soldQtyByProdName: Record<string, number> = {};

    bookingRows.forEach((r) => {
      if (r.items) {
        try {
          const parsed = typeof r.items === 'string' ? JSON.parse(r.items) : r.items;
          if (Array.isArray(parsed) && parsed.length > 0) {
            parsed.forEach((it: any) => {
              const pid = Number(it.product_id) || 0;
              const pName = String(it.product_name || it.name || '').trim().toLowerCase();
              const uQty = Number(it.qty || it.total_qty || 1);
              if (pid > 0) {
                soldQtyByProdId[pid] = (soldQtyByProdId[pid] || 0) + uQty;
              }
              if (pName) {
                soldQtyByProdName[pName] = (soldQtyByProdName[pName] || 0) + uQty;
              }
            });
            return;
          }
        } catch {}
      }
      const pName = String(r.product_name || '').trim().toLowerCase();
      const uQty = Number(r.total_qty || 1);
      if (pName) {
        soldQtyByProdName[pName] = (soldQtyByProdName[pName] || 0) + uQty;
      }
    });

    // 2. Fetch van stocks strictly for current salesman van (closing stock is strictly from van, never warehouse)
    const vanRows = db.getAllSync<VanStockRecord>(
      `SELECT * FROM van_stocks WHERE status != 'Deleted' ORDER BY product_name ASC`
    );

    const sourceRows = vanRows;

    const items: ClosingStockReportItem[] = sourceRows.map((s: any, idx: number) => {
      const closingQty = Math.max(0, Number(s.total_qty ?? s.available_quantity ?? s.quantity ?? s.current_stock) || 0);
      const itemsPerPkg = Number(s.items_per_package) || 1;
      const pkgType = s.package_type || 'Carton';
      const unit = s.unit || 'Pcs';
      const unitPrice = Number(s.unit_price) || Number(s.selling_price) || Number(s.unit_cost) || 0;
      const unitCost = Number(s.unit_cost) || Number(s.cost_price) || 0;

      const pNameKey = (s.product_name || s.name || '').trim().toLowerCase();
      const soldFromOrders = (s.product_id ? soldQtyByProdId[s.product_id] : 0) || soldQtyByProdName[pNameKey] || 0;

      let loadedQty = Number(s.loaded_qty ?? s.quantity) || 0;
      let soldQty = 0;

      if (loadedQty > 0) {
        const calculatedSold = Math.max(0, loadedQty - closingQty);
        soldQty = Math.max(soldFromOrders, calculatedSold);
        if (closingQty + soldQty > loadedQty) {
          loadedQty = closingQty + soldQty;
        }
      } else {
        soldQty = soldFromOrders;
        loadedQty = closingQty + soldQty;
      }

      const closingPacks = itemsPerPkg > 0 ? Number((closingQty / itemsPerPkg).toFixed(2)) : (Number(s.package_qty) || closingQty);
      const formatted = formatStockQty({
        total_qty: closingQty,
        package_type: pkgType,
        items_per_package: itemsPerPkg,
        unit,
      });

      let status: 'In Stock' | 'Low Stock' | 'Out of Stock' = 'In Stock';
      if (closingQty <= 0) {
        status = 'Out of Stock';
      } else if (closingQty <= 5 || (itemsPerPkg > 1 && closingQty < itemsPerPkg)) {
        status = 'Low Stock';
      }

      const totalVal = Number((closingQty * unitPrice).toFixed(2));

      return {
        allocation_id: s.allocation_id || s.id || (idx + 1),
        product_id: s.product_id || 0,
        product_name: s.product_name || s.name || 'Unnamed Product',
        product_sku: s.product_sku || s.sku || '',
        category_name: s.category_name || 'General FMCG',
        unit,
        package_type: pkgType,
        items_per_package: itemsPerPkg,
        loaded_qty: loadedQty,
        sold_qty: soldQty,
        closing_qty: closingQty,
        closing_packs: closingPacks,
        closing_display: formatted.fullDisplay,
        unit_price: unitPrice,
        unit_cost: unitCost,
        total_value: totalVal,
        batch_no: s.batch_no || '',
        status,
      };
    });

    const totals = items.reduce(
      (acc, curr) => ({
        totalClosingValue: acc.totalClosingValue + curr.total_value,
        totalClosingUnits: acc.totalClosingUnits + curr.closing_qty,
        totalClosingPacks: acc.totalClosingPacks + curr.closing_packs,
        totalLoadedUnits: acc.totalLoadedUnits + curr.loaded_qty,
        totalSoldUnits: acc.totalSoldUnits + curr.sold_qty,
        productsCount: items.length,
      }),
      {
        totalClosingValue: 0,
        totalClosingUnits: 0,
        totalClosingPacks: 0,
        totalLoadedUnits: 0,
        totalSoldUnits: 0,
        productsCount: 0,
      }
    );

    return { items, totals };
  } catch (err) {
    console.warn('Error generating closing stock report:', err);
    return {
      items: [],
      totals: {
        totalClosingValue: 0,
        totalClosingUnits: 0,
        totalClosingPacks: 0,
        totalLoadedUnits: 0,
        totalSoldUnits: 0,
        productsCount: 0,
      },
    };
  }
}

// ---------------------- Schemes & Promotional Offers DAO ----------------------

export function getSchemes(search?: string, type?: string): SchemeRecord[] {
  const db = getDatabase();
  let userBranchId: number | null = null;
  let isGlobalUser = false;
  try {
    const savedBranchId = getSyncMeta('authorized_branch_id');
    if (savedBranchId && !isNaN(Number(savedBranchId))) {
      userBranchId = Number(savedBranchId);
    }
    const rawUser = getSyncMeta('auth_user');
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      if (
        parsed.role === 'ADMIN' ||
        parsed.role === 'SUPER_ADMIN' ||
        parsed.role_code === 'ADMIN' ||
        parsed.allowed_modules?.includes('all_access') ||
        (Array.isArray(parsed.assigned_branches) && (parsed.assigned_branches.includes('all') || parsed.assigned_branches.includes('*')))
      ) {
        isGlobalUser = true;
      }
      if (userBranchId == null) {
        if (parsed.branch_id != null && !isNaN(Number(parsed.branch_id))) {
          userBranchId = Number(parsed.branch_id);
        } else if (parsed.branch?.branch_id != null && !isNaN(Number(parsed.branch.branch_id))) {
          userBranchId = Number(parsed.branch.branch_id);
        }
      }
    }
  } catch {}

  let query = `SELECT * FROM schemes WHERE 1=1`;
  const params: any[] = [];

  if (!isGlobalUser && userBranchId != null) {
    query += ` AND (branch_id IS NULL OR branch_id = 0 OR branch_id = ?)`;
    params.push(userBranchId);
  }

  if (type && type !== 'ALL') {
    if (type === 'PRODUCT_BASED') {
      query += ` AND (scheme_type = 'PRODUCT_BASED' OR scheme_type = 'BOGO_QTY')`;
    } else if (type === 'AMOUNT_BASED') {
      query += ` AND (scheme_type = 'AMOUNT_BASED' OR scheme_type = 'MIN_ORDER_VALUE' OR scheme_type = 'FLAT_DISCOUNT')`;
    } else {
      query += ` AND scheme_type = ?`;
      params.push(type);
    }
  }

  if (search && search.trim()) {
    const s = `%${search.trim().toLowerCase()}%`;
    query += ` AND (LOWER(name) LIKE ? OR LOWER(scheme_code) LIKE ? OR LOWER(trigger_product_name) LIKE ? OR LOWER(reward_product_name) LIKE ?)`;
    params.push(s, s, s, s);
  }

  query += ` ORDER BY is_active DESC, scheme_id DESC`;
  return db.getAllSync<SchemeRecord>(query, params);
}

export function getActiveSchemes(): SchemeRecord[] {
  const db = getDatabase();
  const todayStr = new Date().toISOString().split('T')[0];
  let userBranchId: number | null = null;
  let isGlobalUser = false;
  try {
    const savedBranchId = getSyncMeta('authorized_branch_id');
    if (savedBranchId && !isNaN(Number(savedBranchId))) {
      userBranchId = Number(savedBranchId);
    }
    const rawUser = getSyncMeta('auth_user');
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      if (
        parsed.role === 'ADMIN' ||
        parsed.role === 'SUPER_ADMIN' ||
        parsed.role_code === 'ADMIN' ||
        parsed.allowed_modules?.includes('all_access') ||
        (Array.isArray(parsed.assigned_branches) && (parsed.assigned_branches.includes('all') || parsed.assigned_branches.includes('*')))
      ) {
        isGlobalUser = true;
      }
      if (userBranchId == null) {
        if (parsed.branch_id != null && !isNaN(Number(parsed.branch_id))) {
          userBranchId = Number(parsed.branch_id);
        } else if (parsed.branch?.branch_id != null && !isNaN(Number(parsed.branch.branch_id))) {
          userBranchId = Number(parsed.branch.branch_id);
        }
      }
    }
  } catch {}

  let query = `SELECT * FROM schemes 
     WHERE (is_active = 1 OR is_active = 'true')
       AND (start_date IS NULL OR start_date = '' OR start_date <= ?)
       AND (end_date IS NULL OR end_date = '' OR end_date >= ?)`;
  const params: any[] = [todayStr, todayStr];

  if (!isGlobalUser && userBranchId != null) {
    query += ` AND (branch_id IS NULL OR branch_id = 0 OR branch_id = ?)`;
    params.push(userBranchId);
  }

  query += ` ORDER BY scheme_id ASC`;
  return db.getAllSync<SchemeRecord>(query, params);
}

export function replaceSchemes(schemes: any[]): void {
  if (!Array.isArray(schemes)) return;
  const db = getDatabase();
  db.runSync(`DELETE FROM schemes`);

  for (const s of schemes) {
    const schemeId = Number(s.scheme_id || s.id) || Date.now();
    const schemeCode = s.scheme_code || `SCH-${schemeId}`;
    const name = s.name || 'Promotional Trade Scheme';
    const description = s.description || '';
    const schemeType = s.scheme_type || 'PRODUCT_BASED';

    const triggerProdId = s.trigger_product_id != null ? Number(s.trigger_product_id) : null;
    const triggerProdName = s.trigger_product_name || null;
    const triggerProdSku = s.trigger_product_sku || null;
    const triggerMinQty = Number(s.trigger_min_qty) || 1;
    const triggerUnit = s.trigger_unit || 'Pcs';
    const triggerUnitsPerPkg = Number(s.trigger_units_per_pkg) || 1;

    const minOrderAmount = Number(s.min_order_amount) || 0;
    const eligibleProdMode = s.eligible_product_mode || 'ALL_PRODUCTS';
    const eligibleProdIds = typeof s.eligible_product_ids === 'string' 
      ? s.eligible_product_ids 
      : JSON.stringify(s.eligible_product_ids || []);

    const rewardType = s.reward_type || 'FREE_PRODUCT';
    const rewardProdId = s.reward_product_id != null ? Number(s.reward_product_id) : null;
    const rewardProdName = s.reward_product_name || null;
    const rewardProdSku = s.reward_product_sku || null;
    const rewardQty = Number(s.reward_qty) || 1;
    const rewardUnit = s.reward_unit || 'Pcs';

    const discountType = s.discount_type || 'PERCENTAGE';
    const discountVal = Number(s.discount_value != null ? s.discount_value : (s.discount_percentage || s.discount_amount)) || 0;
    const discountPct = Number(s.discount_percentage) || (discountType === 'PERCENTAGE' ? discountVal : 0);
    const discountAmt = Number(s.discount_amount) || (discountType !== 'PERCENTAGE' ? discountVal : 0);

    const allowMultiple = s.allow_multiple_slabs !== false && s.allow_multiple_slabs !== 0 ? 1 : 0;
    const applicableCustType = s.applicable_customer_type || 'ALL';
    const startDate = s.start_date ? String(s.start_date).split('T')[0] : null;
    const endDate = s.end_date ? String(s.end_date).split('T')[0] : null;
    const isActive = s.is_active !== false && s.is_active !== 0 ? 1 : 0;
    const branchId = s.branch_id != null ? Number(s.branch_id) : null;
    const branchName = s.branch_name || (branchId ? `Branch #${branchId}` : 'All Branches');

    db.runSync(
      `INSERT INTO schemes (
        scheme_id, scheme_code, name, description, scheme_type,
        trigger_product_id, trigger_product_name, trigger_product_sku,
        trigger_min_qty, trigger_unit, trigger_units_per_pkg,
        min_order_amount, eligible_product_mode, eligible_product_ids,
        reward_type, reward_product_id, reward_product_name, reward_product_sku,
        reward_qty, reward_unit, discount_type, discount_value, discount_percentage, discount_amount,
        allow_multiple_slabs, applicable_customer_type, start_date, end_date,
        is_active, branch_id, branch_name, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schemeId, schemeCode, name, description, schemeType,
        triggerProdId, triggerProdName, triggerProdSku,
        triggerMinQty, triggerUnit, triggerUnitsPerPkg,
        minOrderAmount, eligibleProdMode, eligibleProdIds,
        rewardType, rewardProdId, rewardProdName, rewardProdSku,
        rewardQty, rewardUnit, discountType, discountVal, discountPct, discountAmt,
        allowMultiple, applicableCustType, startDate, endDate,
        isActive, branchId, branchName, Date.now()
      ]
    );
  }
}

export function evaluateLocalSchemes(
  items: Array<{
    product_id: string | number;
    product_name?: string;
    name?: string;
    sku?: string;
    qty: number;
    bag_qty?: number;
    loose_qty?: number;
    package_type?: string;
    unit?: string;
    unit_price?: number;
    rate?: number;
    total?: number;
    items_per_package?: number;
    is_free?: boolean;
    is_scheme_free?: boolean;
  }>,
  totalAmount: number = 0
): SchemeEvaluationResult {
  const activeSchemes = getActiveSchemes();
  const qualifiedSchemes: QualifiedSchemeItem[] = [];
  const freeItems: FreeSchemeItem[] = [];
  let totalDiscount = 0;

  const paidItems = (items || []).filter(it => !it.is_free && !it.is_scheme_free && Number(it.qty) > 0);
  const cartGross = Number(totalAmount) > 0 
    ? Number(totalAmount) 
    : paidItems.reduce((acc, it) => acc + (Number(it.total) || (Number(it.qty) * (Number(it.unit_price || it.rate) || 0))), 0);

  for (const sc of activeSchemes) {
    const isProductBased = sc.scheme_type === 'PRODUCT_BASED' || sc.scheme_type === 'BOGO_QTY';
    const isAmountBased = sc.scheme_type === 'AMOUNT_BASED' || sc.scheme_type === 'MIN_ORDER_VALUE' || sc.scheme_type === 'FLAT_DISCOUNT';

    if (isProductBased) {
      const trigProdId = sc.trigger_product_id ? Number(sc.trigger_product_id) : null;
      const trigProdName = (sc.trigger_product_name || '').toLowerCase().trim();

      const matched = paidItems.filter(it => {
        const pId = Number(it.product_id);
        const pName = (it.product_name || it.name || '').toLowerCase().trim();
        if (trigProdId) {
          return pId === trigProdId;
        }
        if (trigProdName && !['qualifying product', 'any product', 'any'].includes(trigProdName)) {
          return pName === trigProdName || pName.includes(trigProdName);
        }
        return false;
      });

      if (matched.length === 0) continue;

      // Pack size of the product
      const stockPackSize = Number(matched[0].items_per_package) || 1;
      const schemePackSize = Number(sc.trigger_units_per_pkg) || 1;
      const itemsPerPkg = Math.max(1, stockPackSize > 1 ? stockPackSize : schemePackSize);

      const triggerUnit = (sc.trigger_unit || 'Pcs').toLowerCase().trim();
      const isPackageTrigger = ['bag', 'box', 'carton', 'case'].includes(triggerUnit);
      const minQty = Math.max(1, Number(sc.trigger_min_qty) || 1);

      let totalPieces = 0;
      let totalBagsPurchased = 0;
      let totalLoosePurchased = 0;
      let totalItemGross = 0;

      for (const it of matched) {
        const itBag = Number(it.bag_qty) || 0;
        const itLoose = Number(it.loose_qty) || 0;
        const itPack = Number(it.items_per_package) || itemsPerPkg;

        if (itBag > 0 || itLoose > 0) {
          totalBagsPurchased += itBag;
          totalLoosePurchased += itLoose;
          totalPieces += (itBag * itPack) + itLoose;
        } else {
          const q = Number(it.qty) || 0;
          const pType = (it.package_type || it.unit || 'Loose').toLowerCase();
          const isPackItem = ['bag', 'box', 'carton', 'case'].includes(pType);
          if (isPackItem) {
            totalBagsPurchased += q;
            totalPieces += (q * itPack);
          } else {
            totalLoosePurchased += q;
            totalPieces += q;
          }
        }
        totalItemGross += (Number(it.total) || (Number(it.qty) * (Number(it.unit_price || it.rate) || 0)));
      }

      let qualifies = false;
      let sets = 0;

      if (isPackageTrigger) {
        // Scheme explicitly requires BAGS/BOXES (e.g. "Buy 1 Bag" or "Buy 2 Boxes")
        // Qualifying quantity is the number of full bags/boxes purchased
        if (totalBagsPurchased >= minQty && minQty > 0) {
          qualifies = true;
          const allowMultiple = sc.allow_multiple_slabs !== false && sc.allow_multiple_slabs !== 0;
          sets = allowMultiple ? Math.floor(totalBagsPurchased / minQty) : 1;
        }
      } else {
        // Scheme requires PIECES/UNITS (e.g. "Buy 2 Units", "Buy 5 Pieces", "Buy 10 Pieces")
        // Loose pieces purchased must satisfy minQty (or totalPieces if item has no bag packaging)
        const qualifyingPieces = (totalLoosePurchased > 0 || totalBagsPurchased === 0)
          ? totalLoosePurchased
          : 0;
        if (qualifyingPieces >= minQty && minQty > 0) {
          qualifies = true;
          const allowMultiple = sc.allow_multiple_slabs !== false && sc.allow_multiple_slabs !== 0;
          sets = allowMultiple ? Math.floor(qualifyingPieces / minQty) : 1;
        }
      }

      if (qualifies && sets >= 1) {
        const trigDispName = matched[0].product_name || matched[0].name || sc.trigger_product_name || 'Qualifying Product';

        if (sc.reward_type === 'FREE_PRODUCT') {
          const freeQty = sets * (Number(sc.reward_qty) || 1);
          const rewardName = sc.reward_product_name || trigDispName;
          const rewardUnit = sc.reward_unit || 'Pcs';

          const freeItemObj: FreeSchemeItem = {
            product_id: sc.reward_product_id ? Number(sc.reward_product_id) : (matched[0].product_id ? Number(matched[0].product_id) : null),
            product_name: rewardName,
            product_sku: sc.reward_product_sku || (matched[0] as any).product_sku || (matched[0] as any).sku || 'SCH-FREE',
            qty: freeQty,
            unit: rewardUnit,
            package_type: ['bag', 'box'].includes(rewardUnit.toLowerCase()) ? rewardUnit : 'Loose',
            unit_price: 0,
            total: 0,
            is_free: true,
            is_scheme_free: true,
            scheme_id: sc.scheme_id,
            scheme_name: sc.name,
          };

          qualifiedSchemes.push({
            scheme_id: sc.scheme_id,
            scheme_code: sc.scheme_code,
            name: sc.name,
            type: 'PRODUCT_BASED',
            reward_type: 'FREE_PRODUCT',
            trigger_summary: isPackageTrigger 
              ? `Purchased ${(totalPieces / itemsPerPkg).toFixed(1)} ${sc.trigger_unit || 'Bag'} (${totalPieces} pcs) of ${trigDispName}`
              : `Purchased ${totalPieces} ${sc.trigger_unit || 'Pcs'} of ${trigDispName}`,
            reward_summary: `Eligible for ${freeQty}x ${rewardName} FREE`,
            reward_qty: freeQty,
            reward_unit: rewardUnit,
            freeItem: freeItemObj,
          });

          freeItems.push(freeItemObj);
        } else if (sc.reward_type === 'DISCOUNT') {
          const discType = sc.discount_type || 'PERCENTAGE';
          const discVal = Number(sc.discount_value || sc.discount_percentage || sc.discount_amount) || 0;
          let discAmt = 0;
          const allowMultiple = sc.allow_multiple_slabs !== false && sc.allow_multiple_slabs !== 0;
          if (discType === 'PERCENTAGE') {
            discAmt = Math.round((totalItemGross * (discVal / 100)) * 100) / 100;
          } else {
            discAmt = allowMultiple ? (sets * discVal) : discVal;
          }

          if (discAmt > 0) {
            totalDiscount += discAmt;
            qualifiedSchemes.push({
              scheme_id: sc.scheme_id,
              scheme_code: sc.scheme_code,
              name: sc.name,
              type: 'PRODUCT_BASED',
              reward_type: 'DISCOUNT',
              trigger_summary: isPackageTrigger
                ? `Purchased qualifying quantity of ${trigDispName} (${(totalPieces / itemsPerPkg).toFixed(1)} ${sc.trigger_unit})`
                : `Purchased ${totalPieces} ${sc.trigger_unit || 'Pcs'} of ${trigDispName}`,
              reward_summary: `Discount: ${discType === 'PERCENTAGE' ? `${discVal}%` : `₹${discVal}`} (-₹${discAmt.toFixed(2)})`,
              discount_amount: discAmt,
            });
          }
        }
      }
    } else if (isAmountBased) {
      const minAmount = Number(sc.min_order_amount) || 0;
      if (minAmount <= 0) continue;

      let eligibleGross = cartGross;
      if (sc.eligible_product_mode === 'SELECTED_PRODUCTS') {
        let eligibleIds: number[] = [];
        try {
          if (Array.isArray(sc.eligible_product_ids)) {
            eligibleIds = sc.eligible_product_ids.map(Number);
          } else if (typeof sc.eligible_product_ids === 'string') {
            eligibleIds = JSON.parse(sc.eligible_product_ids).map(Number);
          }
        } catch {}

        if (eligibleIds.length > 0) {
          const eligibleItems = paidItems.filter(it => eligibleIds.includes(Number(it.product_id)));
          eligibleGross = eligibleItems.reduce((acc, it) => acc + (Number(it.total) || (Number(it.qty) * (Number(it.unit_price || it.rate) || 0))), 0);
        }
      }

      if (eligibleGross >= minAmount) {
        const allowMultiple = sc.allow_multiple_slabs !== false && sc.allow_multiple_slabs !== 0;
        const sets = allowMultiple ? Math.floor(eligibleGross / minAmount) : 1;

        if (sets >= 1) {
          if (sc.reward_type === 'FREE_PRODUCT') {
            const freeQty = sets * (Number(sc.reward_qty) || 1);
            const rewardName = sc.reward_product_name || 'Retailer Eco Carry Bag';
            const rewardUnit = sc.reward_unit || 'Pcs';

            const freeItemObj: FreeSchemeItem = {
              product_id: sc.reward_product_id ? Number(sc.reward_product_id) : null,
              product_name: rewardName,
              product_sku: sc.reward_product_sku || 'PROMO-FREE',
              qty: freeQty,
              unit: rewardUnit,
              package_type: ['bag', 'box'].includes(rewardUnit.toLowerCase()) ? rewardUnit : 'Unit',
              unit_price: 0,
              total: 0,
              is_free: true,
              is_scheme_free: true,
              scheme_id: sc.scheme_id,
              scheme_name: sc.name,
            };

            qualifiedSchemes.push({
              scheme_id: sc.scheme_id,
              scheme_code: sc.scheme_code,
              name: sc.name,
              type: 'AMOUNT_BASED',
              reward_type: 'FREE_PRODUCT',
              trigger_summary: `Order Total reached ₹${eligibleGross.toFixed(2)} (Min: ₹${minAmount.toFixed(2)})`,
              reward_summary: `Eligible for ${freeQty}x ${rewardName} FREE`,
              reward_qty: freeQty,
              reward_unit: rewardUnit,
              freeItem: freeItemObj,
            });

            freeItems.push(freeItemObj);
          } else if (sc.reward_type === 'DISCOUNT') {
            const discType = sc.discount_type || 'PERCENTAGE';
            const discVal = Number(sc.discount_value || sc.discount_percentage || sc.discount_amount) || 0;
            let discAmt = 0;
            if (discType === 'PERCENTAGE') {
              discAmt = Math.round((eligibleGross * (discVal / 100)) * 100) / 100;
            } else {
              discAmt = allowMultiple ? (sets * discVal) : discVal;
            }

            if (discAmt > 0) {
              totalDiscount += discAmt;
              qualifiedSchemes.push({
                scheme_id: sc.scheme_id,
                scheme_code: sc.scheme_code,
                name: sc.name,
                type: 'AMOUNT_BASED',
                reward_type: 'DISCOUNT',
                trigger_summary: `Order Total reached ₹${eligibleGross.toFixed(2)} (Min: ₹${minAmount.toFixed(2)})`,
                reward_summary: `Discount: ${discType === 'PERCENTAGE' ? `${discVal}%` : `₹${discVal}`} (-₹${discAmt.toFixed(2)})`,
                discount_amount: discAmt,
              });
            }
          }
        }
      }
    }
  }

  return { qualifiedSchemes, totalDiscount, freeItems };
}





