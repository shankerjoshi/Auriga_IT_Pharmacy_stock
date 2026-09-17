import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
};

function navigate(path) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return path;
}

function formatDate(value) {
  if (!value) return 'None';
  return new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function daysUntil(value, today = new Date().toISOString().slice(0, 10)) {
  return Math.round((new Date(`${value}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
}

function statusForBatch(batch, today) {
  const days = daysUntil(batch.expiry_date, today);
  if (batch.status === 'QUARANTINED') return { label: 'Quarantined', tone: 'danger' };
  if (batch.quantity <= 0) return { label: 'Depleted', tone: 'healthy' };
  if (days <= 0) return { label: 'Expired', tone: 'danger' };
  if (days <= 7) return { label: 'Expires in 7 days', tone: 'warning' };
  if (days <= 30) return { label: 'Expires in 30 days', tone: 'warning' };
  return { label: 'Healthy', tone: 'healthy' };
}

function Status({ label, tone }) {
  return <span className={`status ${tone}`}>{label}</span>;
}

function Brand() {
  return <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate('/'); }}><span className="brand-mark">P</span><span>PharmaFlow</span></a>;
}

function Topbar({ user, onLogout }) {
  const displayName = user?.name || user?.email || 'Account';
  return <header className="topbar"><Brand /><div className="topbar-actions">{user ? <div className="user-chip" aria-live="polite"><span className="user-label">Signed in as:</span><strong>{displayName}</strong></div> : null}{user ? <button className="button secondary small" onClick={onLogout}>Logout</button> : <><button className="button secondary small" onClick={() => navigate('/login')}>Log in</button><button className="button small" onClick={() => navigate('/register')}>Register</button></>}</div></header>;
}

function Landing() {
  return <>
    <Topbar />
    <main className="page hero-page">
      <section className="hero-copy">
        <p className="kicker">Inventory clarity for pharmacy teams</p>
        <h1>Dispense the right stock, every time.</h1>
        <p>PharmaFlow keeps batch-level inventory clear, protects against expired stock, and enforces first-expiry-first-out dispensing at the source.</p>
        <div className="hero-actions"><button className="button" onClick={() => navigate('/register')}>Create pharmacy account</button><button className="button secondary" onClick={() => navigate('/login')}>Log in</button></div>
      </section>
      <aside className="hero-panel" aria-label="PharmaFlow workflow">
        <p className="kicker">Built around the safe path</p>
        <h2>One live view of stock health</h2>
        <div className="workflow"><div className="workflow-item"><span className="workflow-number">1</span><div><strong>See what is sellable</strong><p>Expired and depleted batches stay out of the available total.</p></div></div><div className="workflow-item"><span className="workflow-number">2</span><div><strong>Follow expiry signals</strong><p>Upcoming batches are grouped into clear warning windows.</p></div></div><div className="workflow-item"><span className="workflow-number">3</span><div><strong>Dispense with confidence</strong><p>The backend selects the earliest valid batch and records each deduction.</p></div></div></div>
      </aside>
    </main>
  </>;
}

function AuthPage({ mode, onAuthenticated }) {
  const register = mode === 'register';
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = register ? form : { email: form.email, password: form.password };
      const result = await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) });
      onAuthenticated(result.user);
      navigate('/dashboard');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return <><Topbar /><main className="auth-layout"><section className="auth-card"><p className="kicker">PharmaFlow access</p><h1>{register ? 'Create your account' : 'Welcome back'}</h1><p className="muted">{register ? 'Set up secure access to your pharmacy inventory.' : 'Sign in to manage batches and dispensing.'}</p>{error && <div className="form-error" role="alert">{error}</div>}<form className="form-stack" onSubmit={submit}>{register && <label className="field">Full name<input required autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>}<label className="field">Email<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label className="field">Password<input required minLength="8" type="password" autoComplete={register ? 'new-password' : 'current-password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label><button className="button" disabled={saving}>{saving ? 'Working...' : register ? 'Create account' : 'Log in'}</button></form><p className="form-footer">{register ? 'Already registered?' : 'New to PharmaFlow?'} <a className="text-link" href={register ? '/login' : '/register'} onClick={(event) => { event.preventDefault(); navigate(register ? '/login' : '/register'); }}>{register ? 'Log in' : 'Create an account'}</a></p></section></main></>;
}

function Loading({ label = 'Loading...' }) {
  return <div className="loading-state" role="status">{label}</div>;
}

function Dashboard({ user, onLogout }) {
  const [inventory, setInventory] = useState({ items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } });
  const [summary, setSummary] = useState([]);
  const [alerts, setAlerts] = useState({ expiring: [], expired: [], summary: {} });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [order, setOrder] = useState('asc');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadDashboard(nextPage = page) {
    setLoading(true);
    setError('');
    try {
      const [inventoryData, summaryData, alertData] = await Promise.all([
        api(`/api/medicines?search=${encodeURIComponent(search)}&page=${nextPage}&limit=10&sort=${sort}&order=${order}`),
        api('/api/alerts/summary'),
        api('/api/alerts/expiring?days=30')
      ]);
      setInventory(inventoryData);
      setSummary(summaryData);
      setAlerts(alertData);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { const timer = setTimeout(() => loadDashboard(page), 220); return () => clearTimeout(timer); }, [search, sort, order, page]);
  const totalSellable = summary.reduce((total, medicine) => total + Number(medicine.sellable_stock || 0), 0);
  const expiredBatchCount = alerts.summary?.expired?.batch_count || 0;
  const expiringBatchCount = alerts.expiring?.length || 0;

  return <><Topbar user={user} onLogout={onLogout} /><main className="page"><div className="dashboard-header"><div><p className="kicker">Protected workspace</p><h1>Inventory dashboard</h1><p className="muted">A current view of stock you can safely dispense.</p></div><div className="header-controls"><button className="button secondary small" onClick={() => loadDashboard(page)}>Refresh data</button></div></div>{error && <div className="notice error" role="alert">{error}</div>}<section className="stats-grid" aria-label="Inventory summary"><div className="stat-card"><span className="stat-label">Total medicines</span><strong className="stat-value">{inventory.pagination.total}</strong></div><div className="stat-card"><span className="stat-label">Sellable units</span><strong className="stat-value">{totalSellable}</strong></div><div className="stat-card warning"><span className="stat-label">Expiring within 30 days</span><strong className="stat-value">{expiringBatchCount}</strong></div><div className="stat-card danger"><span className="stat-label">Expired batches</span><strong className="stat-value">{expiredBatchCount}</strong></div></section><section className="panel"><div className="panel-heading"><h2>Medicines</h2><span className="muted">{inventory.pagination.total} records</span></div><div className="table-toolbar"><input className="search-input" aria-label="Search medicines" placeholder="Search by medicine or generic name" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /><label className="field"><span className="sr-only">Sort by</span><select aria-label="Sort medicines" value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">Name</option><option value="category">Category</option><option value="next_expiry">Next expiry</option><option value="created_at">Recently added</option></select></label><button className="button secondary small" onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}>Order: {order === 'asc' ? 'A-Z' : 'Z-A'}</button></div>{loading ? <Loading label="Loading inventory..." /> : inventory.items.length === 0 ? <div className="empty-state">No medicines match this search.</div> : <><div className="table-wrap"><table><thead><tr><th>Medicine</th><th>Sellable stock</th><th>Next expiry</th><th>Batches</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{inventory.items.map((medicine) => <MedicineRow key={medicine.id} medicine={medicine} onOpen={() => navigate(`/medicines/${medicine.id}`)} />)}</tbody></table></div><div className="pagination"><span className="muted">Page {inventory.pagination.page} of {inventory.pagination.totalPages}</span><div className="pagination-actions"><button className="button secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="button secondary small" disabled={page >= inventory.pagination.totalPages} onClick={() => setPage(page + 1)}>Next</button></div></div></>}</section></main></>;
}

function MedicineRow({ medicine, onOpen }) {
  const status = medicine.sellable_stock > 0 ? (medicine.next_expiry && daysUntil(medicine.next_expiry) <= 7 ? { label: 'Expiring soon', tone: 'warning' } : { label: 'Sellable', tone: 'healthy' }) : { label: 'No sellable stock', tone: 'danger' };
  return <tr><td><strong>{medicine.name}</strong><br /><span className="muted">{medicine.generic_name || medicine.category || 'General'}</span></td><td>{medicine.sellable_stock}</td><td>{formatDate(medicine.next_expiry)}</td><td>{medicine.batch_count}</td><td><Status {...status} /></td><td><button className="button secondary small" onClick={onOpen}>View details</button></td></tr>;
}

function MedicineDetails({ id, user, onLogout }) {
  const [medicine, setMedicine] = useState(null);
  const [batches, setBatches] = useState([]);
  const [today, setToday] = useState(new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dispensing, setDispensing] = useState(false);
  const [error, setError] = useState('');

  async function loadDetails() {
    setLoading(true);
    setError('');
    try {
      const [medicineData, batchData, alertData] = await Promise.all([api(`/api/medicines/${id}`), api(`/api/medicines/${id}/batches`), api('/api/alerts/expiring?days=30')]);
      setMedicine(medicineData);
      setBatches(batchData);
      setToday(alertData.today);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadDetails(); }, [id]);

  async function dispense(event) {
    event.preventDefault();
    setDispensing(true);
    setError('');
    setResult(null);
    try {
      const response = await api(`/api/medicines/${id}/dispense`, { method: 'POST', body: JSON.stringify({ quantity: Number(quantity) }) });
      setResult(response);
      setQuantity('');
      await loadDetails();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDispensing(false);
    }
  }

  if (loading) return <><Topbar onLogout={onLogout} /><main className="page"><Loading label="Loading medicine details..." /></main></>;
  if (error && !medicine) return <><Topbar onLogout={onLogout} /><main className="page"><div className="notice error" role="alert">{error}</div></main></>;
  const sellable = Number(medicine?.sellable_stock || 0);
  return <><Topbar onLogout={onLogout} /><main className="page"><a className="back-link" href="/dashboard" onClick={(event) => { event.preventDefault(); navigate('/dashboard'); }}>Back to dashboard</a>{error && <div className="notice error" role="alert">{error}</div>}<div className="details-grid"><section className="details-card"><p className="kicker">Medicine details</p><h1>{medicine.name}</h1><p className="muted">{medicine.generic_name || 'Generic information not provided'}{medicine.category ? ` / ${medicine.category}` : ''}</p><p>{medicine.description || 'Batch-level inventory and expiry information.'}</p><div className="detail-meta"><div className="meta-item"><small>Sellable stock</small><strong>{sellable} units</strong></div><div className="meta-item"><small>Total batches</small><strong>{medicine.batch_count}</strong></div><div className="meta-item"><small>Next expiry</small><strong>{formatDate(medicine.next_expiry)}</strong></div></div><h2>All batches</h2>{batches.length === 0 ? <div className="empty-state">No batches have been added.</div> : <div className="table-wrap"><table><thead><tr><th>Batch</th><th>Expiry</th><th>Quantity</th><th>Status</th></tr></thead><tbody>{batches.map((batch) => { const status = statusForBatch(batch, today); return <tr key={batch.id}><td>{batch.batch_number}</td><td>{formatDate(batch.expiry_date)}</td><td>{batch.quantity}</td><td><Status {...status} /></td></tr>; })}</tbody></table></div>}</section><aside className="details-card dispense-card"><p className="kicker">Safe dispensing</p><h2>Dispense this medicine</h2><p className="muted">The server selects eligible batches by earliest expiry. Expired and same-day stock is never available.</p><form className="form-stack" onSubmit={dispense}><label className="field">Quantity to dispense<input required min="1" step="1" type="number" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={sellable === 0 || dispensing} /><span className="muted">{sellable} units currently sellable</span></label><button className="button" disabled={sellable === 0 || dispensing || !quantity}>{dispensing ? 'Dispensing...' : sellable === 0 ? 'No sellable stock' : 'Dispense safely'}</button></form>{result && <DispenseResult result={result} />}</aside></div></main></>;
}

function DispenseResult({ result }) {
  return <section className="result-card" aria-live="polite"><h3>Dispense confirmed</h3><p><strong>{result.dispensed_quantity}</strong> of {result.requested_quantity} requested units dispensed.</p>{result.batches_used.map((batch) => <div className="result-line" key={batch.batch_id}><span>{batch.batch_number}<br /><small className="muted">Expires {formatDate(batch.expiry_date)}</small></span><strong>-{batch.deducted}</strong></div>)}<p className="muted">Inventory has been refreshed. The displayed deductions were recorded by the server.</p></section>;
}

function App() {
  const path = usePath();
  const [user, setUser] = useState(undefined);
  useEffect(() => { api('/api/auth/me').then(setUser).catch(() => setUser(null)); }, []);

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } finally { setUser(null); navigate('/'); }
  }
  if (user === undefined) return <Loading label="Starting PharmaFlow..." />;
  if (path === '/' && !user) return <Landing />;
  if (path === '/login' && !user) return <AuthPage mode="login" onAuthenticated={setUser} />;
  if (path === '/register' && !user) return <AuthPage mode="register" onAuthenticated={setUser} />;
  if (!user) return <AuthPage mode="login" onAuthenticated={setUser} />;
  if (path.startsWith('/medicines/')) return <MedicineDetails id={path.split('/')[2]} user={user} onLogout={logout} />;
  return <Dashboard user={user} onLogout={logout} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
