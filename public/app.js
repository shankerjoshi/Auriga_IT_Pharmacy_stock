const state = {
  user: null,
  medicines: [],
  pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
  sort: { field: 'name', order: 'asc' },
  search: '',
  alerts: []
};

const loginCard = document.getElementById('loginCard');
const signupCard = document.getElementById('signupCard');
const logoutBtn = document.getElementById('logoutBtn');
const authStatus = document.getElementById('authStatus');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const showSignup = document.getElementById('showSignup');
const showLogin = document.getElementById('showLogin');
const medicineTable = document.getElementById('medicineTableBody');
const summaryGrid = document.getElementById('summaryGrid');
const pager = document.getElementById('pager');
const searchInput = document.getElementById('searchInput');
const sortField = document.getElementById('sortField');
const sortDirection = document.getElementById('sortDirection');
const batchForm = document.getElementById('batchForm');
const batchMedicineSelect = document.getElementById('batchMedicineSelect');
const dispenseForm = document.getElementById('dispenseForm');
const dispenseMedicineSelect = document.getElementById('dispenseMedicineSelect');
const alertList = document.getElementById('alertList');

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof data === 'string' ? data : data.error || 'Request failed';
    throw new Error(message);
  }

  return data;
}

function setStatus(message, isError = false) {
  authStatus.textContent = message;
  authStatus.classList.remove('hidden');
  authStatus.style.background = isError ? '#fef2f2' : '#eafaf1';
  authStatus.style.borderColor = isError ? '#fecaca' : '#bedfca';
  authStatus.style.color = isError ? '#7f1d1d' : '#14532d';
}

function setAuthViews() {
  if (state.user) {
    logoutBtn.classList.remove('hidden');
    dashboard.classList.remove('hidden');
    loginCard.classList.add('hidden');
    signupCard.classList.add('hidden');
  } else {
    logoutBtn.classList.add('hidden');
    dashboard.classList.add('hidden');
    loginCard.classList.remove('hidden');
    signupCard.classList.add('hidden');
  }
}

function renderSummary(rows) {
  const cards = [
    { label: 'Total medicines', value: rows.length },
    { label: 'In-date units', value: rows.reduce((sum, row) => sum + Number(row.in_date_stock || 0), 0) },
    { label: 'Expired units', value: rows.reduce((sum, row) => sum + Number(row.expired_stock || 0), 0) },
    { label: 'Soonest expiry', value: rows.some((row) => row.next_expiry) ? rows.filter((row) => row.next_expiry).sort((a, b) => new Date(a.next_expiry) - new Date(b.next_expiry))[0].next_expiry : '—' }
  ];

  summaryGrid.innerHTML = cards.map(card => `
    <div class="summary-card">
      <h4>${card.label}</h4>
      <strong>${card.value}</strong>
    </div>
  `).join('');
}

function renderTable() {
  if (!state.medicines.length) {
    medicineTable.innerHTML = '<tr><td colspan="5">No medicines found.</td></tr>';
    return;
  }

  medicineTable.innerHTML = state.medicines.map((medicine) => `
    <tr>
      <td>${medicine.name}</td>
      <td>${medicine.in_date_stock}</td>
      <td>${medicine.expired_stock}</td>
      <td>${medicine.next_expiry || '—'}</td>
      <td>
        <button type="button" class="secondary" data-id="${medicine.id}" data-name="${medicine.name}" data-action="select">
          Use
        </button>
      </td>
    </tr>
  `).join('');

  medicineTable.querySelectorAll('button[data-action="select"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const selected = btn.getAttribute('data-name');
      dispenseMedicineSelect.value = btn.getAttribute('data-id');
      batchMedicineSelect.value = btn.getAttribute('data-id');
      setStatus(`Selected ${selected} for quick dispensing.`);
    });
  });
}

function renderPager() {
  const buttons = [];
  for (let page = 1; page <= state.pagination.totalPages; page += 1) {
    buttons.push(`<button type="button" class="${page === state.pagination.page ? '' : 'secondary'}" data-page="${page}">${page}</button>`);
  }
  pager.innerHTML = buttons.join('');

  pager.querySelectorAll('button[data-page]').forEach((button) => {
    button.addEventListener('click', () => {
      state.pagination.page = Number(button.dataset.page);
      fetchMedicines();
    });
  });
}

function renderAlerts() {
  if (!state.alerts.length) {
    alertList.innerHTML = '<li>No batches expiring in the next 30 days.</li>';
    return;
  }

  alertList.innerHTML = state.alerts.map((alert) => `
    <li><strong>${alert.name}</strong> — ${alert.batch_code} expires ${alert.expiry_date} (${alert.quantity} units)</li>
  `).join('');
}

function populateMedicineSelects(medicines) {
  const options = medicines.map((med) => `<option value="${med.id}">${med.name}</option>`).join('');
  batchMedicineSelect.innerHTML = options;
  dispenseMedicineSelect.innerHTML = options;
}

async function fetchMedicines() {
  try {
    const data = await apiFetch(`/api/medicines?search=${encodeURIComponent(state.search)}&page=${state.pagination.page}&limit=${state.pagination.limit}&sort=${state.sort.field}&order=${state.sort.order}`);
    state.medicines = data.data;
    state.pagination = data.pagination;
    renderTable();
    renderPager();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function fetchSummary() {
  try {
    const rows = await apiFetch('/api/stock/summary');
    renderSummary(rows);
    populateMedicineSelects(rows);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function fetchAlerts() {
  try {
    const rows = await apiFetch('/api/alerts/expiring?days=30');
    state.alerts = rows;
    renderAlerts();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function refreshData() {
  await Promise.all([fetchSummary(), fetchMedicines(), fetchAlerts()]);
}

async function checkSession() {
  try {
    const user = await apiFetch('/api/me', { method: 'GET' });
    state.user = user;
    setAuthViews();
    if (user) {
      await refreshData();
    }
  } catch (error) {
    state.user = null;
    setAuthViews();
  }
}

showSignup.addEventListener('click', () => {
  signupCard.classList.remove('hidden');
  loginCard.classList.add('hidden');
});

showLogin.addEventListener('click', () => {
  loginCard.classList.remove('hidden');
  signupCard.classList.add('hidden');
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  try {
    const user = await apiFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        email: formData.get('email'),
        password: formData.get('password')
      })
    });
    state.user = user.user;
    setAuthViews();
    setStatus('Logged in successfully.');
    await refreshData();
    loginForm.reset();
  } catch (error) {
    setStatus(error.message, true);
  }
});

signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(signupForm);
  try {
    const user = await apiFetch('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name'),
        email: formData.get('email'),
        password: formData.get('password')
      })
    });
    state.user = user.user;
    setAuthViews();
    setStatus('Account created.');
    await refreshData();
    signupForm.reset();
  } catch (error) {
    setStatus(error.message, true);
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await apiFetch('/api/logout', { method: 'POST' });
    state.user = null;
    setAuthViews();
    setStatus('You are logged out.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

searchInput.addEventListener('input', (event) => {
  state.search = event.target.value.trim();
  state.pagination.page = 1;
  fetchMedicines();
});

sortField.addEventListener('change', (event) => {
  state.sort.field = event.target.value;
  fetchMedicines();
});

sortDirection.addEventListener('change', (event) => {
  state.sort.order = event.target.value;
  fetchMedicines();
});

batchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const medicineId = batchMedicineSelect.value;
  const batchCode = document.getElementById('batchCode').value;
  const expiryDate = document.getElementById('batchExpiry').value;
  const quantity = document.getElementById('batchQuantity').value;

  try {
    await apiFetch(`/api/medicines/${medicineId}/batches`, {
      method: 'POST',
      body: JSON.stringify({ batch_code: batchCode, expiry_date: expiryDate, quantity })
    });
    batchForm.reset();
    setStatus('Batch saved successfully.');
    await refreshData();
  } catch (error) {
    setStatus(error.message, true);
  }
});

dispenseForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const medicineId = dispenseMedicineSelect.value;
  const quantity = document.getElementById('dispenseQty').value;

  try {
    await apiFetch(`/api/medicines/${medicineId}/dispense`, {
      method: 'POST',
      body: JSON.stringify({ quantity })
    });
    dispenseForm.reset();
    setStatus('Dispense recorded using FEFO logic.');
    await refreshData();
  } catch (error) {
    setStatus(error.message, true);
  }
});

checkSession();
