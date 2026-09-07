export type AppRole = 'admin' | 'inventory_staff' | 'viewer';

export type Profile = {
  id: string;
  full_name: string | null;
  role: AppRole;
};

export type IecMaterial = {
  id: string;
  name: string;
  type: string;
  topic: string | null;
  source: string | null;
  opening_stock: number;
  current_stock: number;
  minimum_stock: number;
  unit: string;
  location: string | null;
  language: string | null;
  version: string | null;
  description: string | null;
  image_path: string | null;
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type IecTransaction = {
  id: string;
  iec_material_id: string;
  transaction_type: 'stock_in' | 'stock_out';
  quantity: number;
  transaction_date: string;
  recipient_source: string | null;
  reference_number: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};
