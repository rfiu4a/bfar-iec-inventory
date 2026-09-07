'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AppRole, IecMaterial, IecTransaction, Profile } from '@/lib/types';
import { downloadWorkbook, type Cell } from '@/lib/xlsx';

type Page = 'dashboard' | 'materials' | 'stock' | 'reports';

type MaterialForm = {
  id?: string;
  name: string;
  type: string;
  topic: string;
  opening_stock: number;
  minimum_stock: number;
  unit: string;
  location: string;
  language: string;
  version: string;
  description: string;
  image_path?: string | null;
};

const emptyMaterial: MaterialForm = {
  name: '', type: 'Brochure', topic: '', opening_stock: 0, minimum_stock: 10,
  unit: 'copies', location: '', language: '', version: '', description: '', image_path: null,
};

function ymd(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function ym(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function fmtDate(value: string) {
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

function roleLabel(role?: AppRole) {
  if (role === 'admin') return 'Administrator';
  if (role === 'inventory_staff') return 'Inventory Staff';
  return 'Viewer';
}

function stockStatus(item: IecMaterial) {
  if (item.current_stock <= 0) return { label: 'Out of Stock', cls: 'out' };
  if (item.current_stock <= item.minimum_stock) return { label: 'Low Stock', cls: 'low' };
  return { label: 'In Stock', cls: 'ok' };
}

export default function InventoryApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [materials, setMaterials] = useState<IecMaterial[]>([]);
  const [transactions, setTransactions] = useState<IecTransaction[]>([]);
  const [page, setPage] = useState<Page>('dashboard');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [materialForm, setMaterialForm] = useState<MaterialForm>(emptyMaterial);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [reportMonth, setReportMonth] = useState(ym());
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [txForm, setTxForm] = useState({
    iec_material_id: '', transaction_type: 'stock_in' as 'stock_in' | 'stock_out', quantity: 1,
    transaction_date: ymd(), recipient_source: '', reference_number: '', notes: '',
  });

  const canEdit = profile?.role === 'admin' || profile?.role === 'inventory_staff';
  const canAdmin = profile?.role === 'admin';

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setProfile(null); setMaterials([]); setTransactions([]); return;
    }
    void loadAll(session.user.id);
  }, [session?.user]);

  async function loadAll(userId?: string) {
    const uid = userId ?? user?.id;
    if (!uid) return;
    setLoading(true);
    setMessage(null);
    const [profileRes, materialsRes, txRes] = await Promise.all([
      supabase.from('profiles').select('id,full_name,role').eq('id', uid).single(),
      supabase.from('iec_materials').select('*').eq('is_archived', false).order('name'),
      supabase.from('iec_transactions').select('*').order('transaction_date', { ascending: false }).order('created_at', { ascending: false }),
    ]);
    if (profileRes.error) setMessage({ type: 'error', text: `Profile: ${profileRes.error.message}` });
    if (materialsRes.error) setMessage({ type: 'error', text: `Materials: ${materialsRes.error.message}` });
    if (txRes.error) setMessage({ type: 'error', text: `Transactions: ${txRes.error.message}` });
    setProfile((profileRes.data as Profile | null) ?? null);
    setMaterials((materialsRes.data as IecMaterial[] | null) ?? []);
    setTransactions((txRes.data as IecTransaction[] | null) ?? []);
    setLoading(false);
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword });
    setBusy(false);
    if (error) setMessage({ type: 'error', text: error.message });
  }

  async function signOut() {
    await supabase.auth.signOut();
    setPage('dashboard');
  }

  function imageUrl(path: string | null | undefined) {
    if (!path) return null;
    return supabase.storage.from('iec-images').getPublicUrl(path).data.publicUrl;
  }

  const filteredMaterials = useMemo(() => {
    const q = search.trim().toLowerCase();
    return materials.filter((m) => {
      const st = stockStatus(m).cls;
      const text = `${m.name} ${m.type} ${m.topic ?? ''} ${m.location ?? ''}`.toLowerCase();
      return (!q || text.includes(q)) && (!typeFilter || m.type === typeFilter) && (!stockFilter || st === stockFilter);
    });
  }, [materials, search, typeFilter, stockFilter]);

  const types = useMemo(() => [...new Set(materials.map((m) => m.type))].sort(), [materials]);
  const recentTransactions = transactions.slice(0, 7);
  const totalStock = materials.reduce((s, m) => s + m.current_stock, 0);
  const lowCount = materials.filter((m) => m.current_stock <= m.minimum_stock).length;
  const totalOut = transactions.filter((t) => t.transaction_type === 'stock_out').reduce((s, t) => s + t.quantity, 0);

  function resetMaterialForm() {
    setMaterialForm(emptyMaterial);
    setImageFile(null);
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
  }

  function startEdit(item: IecMaterial) {
    setMaterialForm({
      id: item.id, name: item.name, type: item.type, topic: item.topic ?? '', opening_stock: item.opening_stock,
      minimum_stock: item.minimum_stock, unit: item.unit, location: item.location ?? '', language: item.language ?? '',
      version: item.version ?? '', description: item.description ?? '', image_path: item.image_path,
    });
    setImageFile(null);
    setImagePreview(imageUrl(item.image_path));
    setPage('materials');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function onImageChange(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Please choose an IEC image smaller than 5 MB.' });
      return;
    }
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function saveMaterial(e: FormEvent) {
    e.preventDefault();
    if (!canEdit || !user) return;
    setBusy(true); setMessage(null);
    let newImagePath = materialForm.image_path ?? null;
    try {
      if (imageFile) {
        const safeName = imageFile.name.replace(/[^a-zA-Z0-9._-]/g, '-');
        const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
        const upload = await supabase.storage.from('iec-images').upload(path, imageFile, { cacheControl: '3600', upsert: false });
        if (upload.error) throw upload.error;
        newImagePath = upload.data.path;
      }

      if (materialForm.id) {
        const { error } = await supabase.from('iec_materials').update({
          name: materialForm.name.trim(), type: materialForm.type, topic: materialForm.topic.trim() || null,
          minimum_stock: Number(materialForm.minimum_stock), unit: materialForm.unit.trim() || 'copies',
          location: materialForm.location.trim() || null, language: materialForm.language.trim() || null,
          version: materialForm.version.trim() || null, description: materialForm.description.trim() || null,
          image_path: newImagePath,
        }).eq('id', materialForm.id);
        if (error) throw error;
        if (imageFile && materialForm.image_path && materialForm.image_path !== newImagePath) {
          await supabase.storage.from('iec-images').remove([materialForm.image_path]);
        }
        setMessage({ type: 'success', text: 'IEC material updated.' });
      } else {
        const opening = Number(materialForm.opening_stock) || 0;
        const { error } = await supabase.from('iec_materials').insert({
          name: materialForm.name.trim(), type: materialForm.type, topic: materialForm.topic.trim() || null,
          opening_stock: opening, current_stock: opening, minimum_stock: Number(materialForm.minimum_stock) || 0,
          unit: materialForm.unit.trim() || 'copies', location: materialForm.location.trim() || null,
          language: materialForm.language.trim() || null, version: materialForm.version.trim() || null,
          description: materialForm.description.trim() || null, image_path: newImagePath, created_by: user.id,
        });
        if (error) throw error;
        setMessage({ type: 'success', text: 'IEC material added.' });
      }
      resetMaterialForm();
      await loadAll();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to save IEC material.' });
    } finally {
      setBusy(false);
    }
  }

  async function archiveMaterial(item: IecMaterial) {
    if (!canAdmin || !confirm(`Archive "${item.name}"? Its transaction history will be retained.`)) return;
    setBusy(true);
    const { error } = await supabase.from('iec_materials').update({ is_archived: true }).eq('id', item.id);
    setBusy(false);
    if (error) setMessage({ type: 'error', text: error.message });
    else { setMessage({ type: 'success', text: 'IEC material archived.' }); await loadAll(); }
  }

  async function recordTransaction(e: FormEvent) {
    e.preventDefault();
    if (!canEdit || !user) return;
    setBusy(true); setMessage(null);
    const { error } = await supabase.from('iec_transactions').insert({
      iec_material_id: txForm.iec_material_id,
      transaction_type: txForm.transaction_type,
      quantity: Number(txForm.quantity),
      transaction_date: txForm.transaction_date,
      recipient_source: txForm.recipient_source.trim() || null,
      reference_number: txForm.reference_number.trim() || null,
      notes: txForm.notes.trim() || null,
      created_by: user.id,
    });
    setBusy(false);
    if (error) {
      setMessage({ type: 'error', text: error.message });
      return;
    }
    setTxForm((f) => ({ ...f, quantity: 1, recipient_source: '', reference_number: '', notes: '', transaction_date: ymd() }));
    setMessage({ type: 'success', text: 'Transaction recorded and stock balance updated.' });
    await loadAll();
  }

  const monthTransactions = useMemo(() => transactions
    .filter((t) => t.transaction_date.slice(0, 7) === reportMonth)
    .slice()
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date) || a.created_at.localeCompare(b.created_at)), [transactions, reportMonth]);

  function monthRange(month: string) {
    const [year, mon] = month.split('-').map(Number);
    const start = new Date(year, mon - 1, 1);
    const end = new Date(year, mon, 1);
    return { start, end };
  }

  function balanceBeforeMonth(item: IecMaterial) {
    const { start } = monthRange(reportMonth);
    const created = new Date(item.created_at);
    if (created >= start) return item.opening_stock;
    const priorNet = transactions
      .filter((t) => t.iec_material_id === item.id && new Date(`${t.transaction_date}T00:00:00`) < start)
      .reduce((sum, t) => sum + (t.transaction_type === 'stock_in' ? t.quantity : -t.quantity), 0);
    return item.opening_stock + priorNet;
  }

  function exportMonthlyExcel() {
    const movementHeaders = monthTransactions.map((t, i) => {
      const d = new Date(`${t.transaction_date}T00:00:00`);
      return `${d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })} ${t.transaction_type === 'stock_in' ? 'IN' : 'OUT'} #${i + 1}`;
    });
    const movement: Cell[][] = [['IEC Material', 'Type', ...movementHeaders, 'Beginning Balance', 'Total In', 'Total Out', 'Net', 'Ending Balance']];
    const summary: Cell[][] = [['IEC Material', 'Type', 'Beginning Balance', 'Stock In', 'Stock Out', 'Ending Balance', 'Minimum Stock', 'Status']];

    materials.forEach((m) => {
      const txs = monthTransactions.filter((t) => t.iec_material_id === m.id);
      const totalIn = txs.filter((t) => t.transaction_type === 'stock_in').reduce((s, t) => s + t.quantity, 0);
      const totalOutMonth = txs.filter((t) => t.transaction_type === 'stock_out').reduce((s, t) => s + t.quantity, 0);
      const begin = balanceBeforeMonth(m);
      const end = begin + totalIn - totalOutMonth;
      movement.push([
        m.name, m.type,
        ...monthTransactions.map((t) => t.iec_material_id === m.id ? (t.transaction_type === 'stock_in' ? t.quantity : -t.quantity) : ''),
        begin, totalIn, totalOutMonth, totalIn - totalOutMonth, end,
      ]);
      const status = end <= 0 ? 'Out of Stock' : end <= m.minimum_stock ? 'Low Stock' : 'In Stock';
      summary.push([m.name, m.type, begin, totalIn, totalOutMonth, end, m.minimum_stock, status]);
    });

    const details: Cell[][] = [['Date', 'IEC Material', 'Type', 'Movement', 'Quantity', 'Recipient / Source', 'Reference No.', 'Purpose / Notes']];
    monthTransactions.forEach((t) => {
      const m = materials.find((x) => x.id === t.iec_material_id);
      details.push([t.transaction_date, m?.name ?? 'Archived/Deleted item', m?.type ?? '', t.transaction_type === 'stock_in' ? 'Stock In' : 'Stock Out', t.quantity, t.recipient_source ?? '', t.reference_number ?? '', t.notes ?? '']);
    });

    downloadWorkbook(`BFAR_IEC_Monthly_Report_${reportMonth}.xlsx`, [
      { name: 'Monthly Movement', rows: movement, movementStartCol: 2, movementEndCol: 1 + monthTransactions.length },
      { name: 'Transaction Details', rows: details },
      { name: 'Inventory Summary', rows: summary },
    ]);
  }

  if (loading && !session) return <div className="loading-screen">Loading IEC Inventory…</div>;

  if (!session) {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={signIn}>
          <div className="auth-logo"><img src="/bfar-info-logo.png" alt="BFAR Region 4A" /></div>
          <h1>IEC Inventory</h1>
          <p>Sign in with an account created by the BFAR IEC Inventory administrator.</p>
          {message && <div className={message.type}>{message.text}</div>}
          <label>Email<input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="name@agency.gov.ph" /></label>
          <label style={{ marginTop: 12 }}>Password<input type="password" required value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} /></label>
          <button className="btn" style={{ width: '100%', marginTop: 16 }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/bfar-info-logo.png" alt="BFAR Region 4A" />
          <div><div className="brand-title">IEC Inventory</div><div className="brand-sub">BFAR Region 4A</div></div>
        </div>
        <nav className="nav">
          {(['dashboard', 'materials', 'stock', 'reports'] as Page[]).map((p) => (
            <button key={p} className={page === p ? 'active' : ''} onClick={() => setPage(p)}>{p === 'dashboard' ? 'Dashboard' : p === 'materials' ? 'IEC Materials' : p === 'stock' ? 'Stock In / Out' : 'Reports'}</button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="role">{roleLabel(profile?.role)}</div>
          <strong>{profile?.full_name || user?.email || 'User'}</strong>
          <button className="btn ghost" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <main className="main">
        {message && <div className={message.type}>{message.text}</div>}

        {page === 'dashboard' && <>
          <div className="topbar"><div><h1>Dashboard</h1><p>Live IEC inventory from the BFAR Supabase database.</p></div>{canEdit && <button className="btn" onClick={() => setPage('materials')}>+ Add IEC Material</button>}</div>
          <div className="cards">
            <div className="card"><div className="metric-label">IEC Titles</div><div className="metric-value">{materials.length}</div><div className="metric-foot">Active inventory records</div></div>
            <div className="card"><div className="metric-label">Total Stock</div><div className="metric-value">{totalStock}</div><div className="metric-foot">Current units on hand</div></div>
            <div className="card"><div className="metric-label">Low / Out of Stock</div><div className="metric-value">{lowCount}</div><div className="metric-foot">Requires attention</div></div>
            <div className="card"><div className="metric-label">Distributed</div><div className="metric-value">{totalOut}</div><div className="metric-foot">All recorded stock-out quantity</div></div>
          </div>
          <div className="grid">
            <div className="card"><div className="section-title"><h2>Inventory Overview</h2><button className="btn secondary" onClick={() => setPage('materials')}>View all</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Image</th><th>Material</th><th>Type</th><th>Stock</th><th>Minimum</th><th>Status</th></tr></thead><tbody>{materials.slice(0, 8).map((m) => { const st = stockStatus(m); const url = imageUrl(m.image_path); return <tr key={m.id}><td>{url ? <img className="thumb" src={url} alt="" /> : <div className="thumb image-empty">No image</div>}</td><td><strong>{m.name}</strong><div style={{ color: '#64748b', fontSize: 12 }}>{m.topic}</div></td><td>{m.type}</td><td>{m.current_stock} {m.unit}</td><td>{m.minimum_stock}</td><td><span className={`badge ${st.cls}`}>{st.label}</span></td></tr>; })}{materials.length === 0 && <tr><td colSpan={6} className="empty">No IEC materials yet.</td></tr>}</tbody></table></div></div>
            <div className="card"><div className="section-title"><h2>Recent Activity</h2></div><div className="activity">{recentTransactions.map((t) => { const m = materials.find((x) => x.id === t.iec_material_id); const signed = t.transaction_type === 'stock_in' ? `+${t.quantity}` : `−${t.quantity}`; return <div className="activity-item" key={t.id}><strong>{signed} — {m?.name ?? 'Archived item'}</strong><span>{fmtDate(t.transaction_date)} · {t.transaction_type === 'stock_in' ? 'Stock In' : 'Stock Out'}{t.recipient_source ? ` · ${t.recipient_source}` : ''}</span></div>; })}{recentTransactions.length === 0 && <div className="empty">No transactions yet.</div>}</div></div>
          </div>
        </>}

        {page === 'materials' && <>
          <div className="topbar"><div><h1>IEC Materials</h1><p>Photos, quantities, locations, topics, and material details.</p></div></div>
          <div className="grid">
            <div className="card"><div className="section-title"><h2>Inventory List</h2></div><div className="toolbar"><input placeholder="Search material, topic, location…" value={search} onChange={(e) => setSearch(e.target.value)} /><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="">All Types</option>{types.map((t) => <option key={t}>{t}</option>)}</select><select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}><option value="">All Stock</option><option value="ok">In Stock</option><option value="low">Low Stock</option><option value="out">Out of Stock</option></select></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Image</th><th>Name</th><th>Type</th><th>Quantity</th><th>Location</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filteredMaterials.map((m) => { const st = stockStatus(m); const url = imageUrl(m.image_path); return <tr key={m.id}><td>{url ? <img className="thumb" src={url} alt="" /> : <div className="thumb image-empty">No image</div>}</td><td><strong>{m.name}</strong><div style={{ color: '#64748b', fontSize: 12 }}>{m.topic}</div></td><td>{m.type}</td><td>{m.current_stock} {m.unit}</td><td>{m.location || '—'}</td><td><span className={`badge ${st.cls}`}>{st.label}</span></td><td><div className="row-actions">{canEdit && <button className="btn secondary" onClick={() => startEdit(m)}>Edit</button>}{canAdmin && <button className="btn danger" onClick={() => archiveMaterial(m)}>Archive</button>}</div></td></tr>; })}{filteredMaterials.length === 0 && <tr><td colSpan={7} className="empty">No matching IEC materials.</td></tr>}</tbody></table></div></div>

            <div className="card">
              <div className="section-title"><h2>{materialForm.id ? 'Edit IEC Material' : 'Add IEC Material'}</h2></div>
              {!canEdit ? <div className="notice">Your account is read-only. An administrator can change your role to Inventory Staff if you need to encode inventory.</div> : <form onSubmit={saveMaterial}>
                <div className="preview">{imagePreview ? <img src={imagePreview} alt="IEC preview" /> : <span>No IEC photo selected</span>}</div>
                <label>IEC Photo<input type="file" accept="image/*" onChange={(e) => onImageChange(e.target.files?.[0])} /></label>
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <label>Material Name<input required value={materialForm.name} onChange={(e) => setMaterialForm({ ...materialForm, name: e.target.value })} /></label>
                  <label>Type<select value={materialForm.type} onChange={(e) => setMaterialForm({ ...materialForm, type: e.target.value })}><option>Brochure</option><option>Flyer</option><option>Poster</option><option>Booklet</option><option>Manual</option><option>Tarpaulin</option><option>Sticker</option><option>Infographic</option><option>Other</option></select></label>
                  <label>Topic / Program<input value={materialForm.topic} onChange={(e) => setMaterialForm({ ...materialForm, topic: e.target.value })} /></label>
                  {!materialForm.id && <label>Initial Quantity<input type="number" min="0" value={materialForm.opening_stock} onChange={(e) => setMaterialForm({ ...materialForm, opening_stock: Number(e.target.value) })} /></label>}
                  <label>Minimum Stock<input type="number" min="0" value={materialForm.minimum_stock} onChange={(e) => setMaterialForm({ ...materialForm, minimum_stock: Number(e.target.value) })} /></label>
                  <label>Unit<input value={materialForm.unit} onChange={(e) => setMaterialForm({ ...materialForm, unit: e.target.value })} /></label>
                  <label>Location<input value={materialForm.location} onChange={(e) => setMaterialForm({ ...materialForm, location: e.target.value })} /></label>
                  <label>Language<input value={materialForm.language} onChange={(e) => setMaterialForm({ ...materialForm, language: e.target.value })} /></label>
                  <label>Year / Version<input value={materialForm.version} onChange={(e) => setMaterialForm({ ...materialForm, version: e.target.value })} /></label>
                </div>
                <label style={{ marginTop: 12 }}>Description<textarea value={materialForm.description} onChange={(e) => setMaterialForm({ ...materialForm, description: e.target.value })} /></label>
                <div className="actions"><button className="btn" disabled={busy}>{busy ? 'Saving…' : materialForm.id ? 'Update Material' : 'Save Material'}</button><button type="button" className="btn secondary" onClick={resetMaterialForm}>Clear</button></div>
              </form>}
            </div>
          </div>
        </>}

        {page === 'stock' && <>
          <div className="topbar"><div><h1>Stock In / Out</h1><p>Every movement is recorded in the audit trail and updates the balance automatically.</p></div></div>
          <div className="grid">
            <div className="card"><div className="section-title"><h2>Record Transaction</h2></div>{!canEdit ? <div className="notice">Your account is read-only.</div> : <form onSubmit={recordTransaction}><div className="form-grid"><label>IEC Material<select required value={txForm.iec_material_id} onChange={(e) => setTxForm({ ...txForm, iec_material_id: e.target.value })}><option value="">Select IEC material</option>{materials.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.current_stock} {m.unit}</option>)}</select></label><label>Transaction Type<select value={txForm.transaction_type} onChange={(e) => setTxForm({ ...txForm, transaction_type: e.target.value as 'stock_in' | 'stock_out' })}><option value="stock_in">Stock In</option><option value="stock_out">Stock Out / Distribution</option></select></label><label>Quantity<input type="number" min="1" required value={txForm.quantity} onChange={(e) => setTxForm({ ...txForm, quantity: Number(e.target.value) })} /></label><label>Date<input type="date" required value={txForm.transaction_date} onChange={(e) => setTxForm({ ...txForm, transaction_date: e.target.value })} /></label><label>Recipient / Source<input value={txForm.recipient_source} onChange={(e) => setTxForm({ ...txForm, recipient_source: e.target.value })} /></label><label>Reference No.<input value={txForm.reference_number} onChange={(e) => setTxForm({ ...txForm, reference_number: e.target.value })} /></label></div><label style={{ marginTop: 12 }}>Purpose / Notes<textarea value={txForm.notes} onChange={(e) => setTxForm({ ...txForm, notes: e.target.value })} /></label><div className="actions"><button className="btn" disabled={busy || !txForm.iec_material_id}>{busy ? 'Recording…' : 'Record Transaction'}</button></div></form>}</div>
            <div className="card"><div className="section-title"><h2>Transaction History</h2></div><div className="activity">{transactions.slice(0, 30).map((t) => { const m = materials.find((x) => x.id === t.iec_material_id); return <div className="activity-item" key={t.id}><strong>{t.transaction_type === 'stock_in' ? 'Stock In' : 'Stock Out'}: {t.quantity} — {m?.name ?? 'Archived item'}</strong><span>{fmtDate(t.transaction_date)}{t.recipient_source ? ` · ${t.recipient_source}` : ''}{t.reference_number ? ` · Ref: ${t.reference_number}` : ''}{t.notes ? ` · ${t.notes}` : ''}</span></div>; })}{transactions.length === 0 && <div className="empty">No transactions yet.</div>}</div></div>
          </div>
        </>}

        {page === 'reports' && <>
          <div className="topbar"><div><h1>Reports</h1><p>Generate a monthly Excel workbook with horizontal transaction-date columns.</p></div><button className="btn" onClick={exportMonthlyExcel}>Export Monthly Excel (.xlsx)</button></div>
          <div className="card page-card-spacer"><div className="section-title"><h2>Monthly Transaction Report</h2></div><div className="notice">Each transaction is a separate horizontal column. Positive values are Stock In; negative values are Stock Out.</div><div className="toolbar"><label style={{ minWidth: 220 }}>Report Month<input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} /></label></div><div className="table-wrap"><table className="data-table"><thead><tr><th>IEC Material</th><th>Type</th>{monthTransactions.map((t, i) => <th key={t.id}>{new Date(`${t.transaction_date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: '2-digit' })} {t.transaction_type === 'stock_in' ? 'IN' : 'OUT'} #{i + 1}</th>)}<th>Total In</th><th>Total Out</th><th>Net</th></tr></thead><tbody>{materials.map((m) => { const txs = monthTransactions.filter((t) => t.iec_material_id === m.id); const tin = txs.filter((t) => t.transaction_type === 'stock_in').reduce((s, t) => s + t.quantity, 0); const tout = txs.filter((t) => t.transaction_type === 'stock_out').reduce((s, t) => s + t.quantity, 0); return <tr key={m.id}><td><strong>{m.name}</strong></td><td>{m.type}</td>{monthTransactions.map((t) => <td key={t.id} className="signed-move">{t.iec_material_id === m.id ? (t.transaction_type === 'stock_in' ? `+${t.quantity}` : `−${t.quantity}`) : ''}</td>)}<td>{tin || ''}</td><td>{tout || ''}</td><td>{tin - tout}</td></tr>; })}{materials.length === 0 && <tr><td className="empty" colSpan={6 + monthTransactions.length}>No inventory records.</td></tr>}</tbody></table></div><div className="report-summary">{monthTransactions.length} transaction{monthTransactions.length === 1 ? '' : 's'} in {reportMonth}.</div></div>
          <div className="card"><div className="section-title"><h2>Current Inventory</h2></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Material</th><th>Type</th><th>Topic</th><th>Current Stock</th><th>Minimum</th><th>Location</th><th>Status</th></tr></thead><tbody>{materials.map((m) => { const st = stockStatus(m); return <tr key={m.id}><td>{m.name}</td><td>{m.type}</td><td>{m.topic || '—'}</td><td>{m.current_stock} {m.unit}</td><td>{m.minimum_stock}</td><td>{m.location || '—'}</td><td><span className={`badge ${st.cls}`}>{st.label}</span></td></tr>; })}</tbody></table></div></div>
        </>}
      </main>
    </div>
  );
}
