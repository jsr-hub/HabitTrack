// === API Helper ===
const API = 'https://habittrack-kprt.onrender.com';

function getToken() { return localStorage.getItem('habit_token'); }
function setToken(t) { localStorage.setItem('habit_token', t); }
function removeToken() { localStorage.removeItem('habit_token'); }
function getUsername() { return localStorage.getItem('habit_username'); }
function setUsername(u) { localStorage.setItem('habit_username', u); }

async function api(path, method = 'GET', body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    const token = getToken();
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
}

// === State ===
let currentDate = new Date();
let habits = [];
let tracking = [];
let currentPeriod = 'weekly';

// === DOM Elements ===
const $ = id => document.getElementById(id);

const authScreen = $('auth-screen');
const appScreen = $('app-screen');
const authError = $('auth-error');

// Auth tabs
document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        $('login-form').classList.toggle('hidden', tab.dataset.tab !== 'login');
        $('register-form').classList.toggle('hidden', tab.dataset.tab !== 'register');
        authError.classList.add('hidden');
    });
});

// Login
$('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.classList.add('hidden');
    try {
        const data = await api('/api/login', 'POST', {
            username: $('login-username').value.trim(),
            password: $('login-password').value
        });
        setToken(data.token);
        setUsername(data.username);
        showApp();
    } catch (err) {
        authError.textContent = err.message;
        authError.classList.remove('hidden');
    }
});

// Register
$('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.classList.add('hidden');
    const pw = $('reg-password').value;
    const confirm = $('reg-confirm').value;
    if (pw !== confirm) {
        authError.textContent = 'Passwords do not match';
        authError.classList.remove('hidden');
        return;
    }
    try {
        const data = await api('/api/register', 'POST', {
            username: $('reg-username').value.trim(),
            password: pw
        });
        setToken(data.token);
        setUsername(data.username);
        showApp();
    } catch (err) {
        authError.textContent = err.message;
        authError.classList.remove('hidden');
    }
});

// Logout
$('logout-btn').addEventListener('click', () => {
    removeToken();
    localStorage.removeItem('habit_username');
    authScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
});

// === Navigation ===
document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        $(tab.dataset.view + '-view').classList.remove('hidden');

        if (tab.dataset.view === 'analysis') loadAnalysis();
        if (tab.dataset.view === 'manage') renderManageList();
        if (tab.dataset.view === 'tracker') renderTracker();
    });
});

// === Date Navigation ===
function formatDate(d) {
    return d.toISOString().split('T')[0];
}

function formatDateDisplay(d) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return d.toLocaleDateString('en-US', options);
}

$('prev-day').addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() - 1);
    renderTracker();
});

$('next-day').addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() + 1);
    renderTracker();
});

// === Period Toggle ===
document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPeriod = btn.dataset.period;
        loadAnalysis();
    });
});

// === Show App ===
async function showApp() {
    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    $('welcome-user').textContent = `Hello, ${getUsername()}`;
    await loadData();
    renderTracker();
}

async function loadData() {
    try {
        habits = await api('/api/habits');
        tracking = await api('/api/tracking');
    } catch (err) {
        console.error('Failed to load data:', err);
    }
}

// === Tracker View ===
function renderTracker() {
    const dateStr = formatDate(currentDate);
    $('current-date').textContent = formatDateDisplay(currentDate);

    const list = $('habit-list');
    if (habits.length === 0) {
        list.innerHTML = `<div class="empty-state"><p>No habits yet! Go to <strong>Manage Habits</strong> to create your first habit.</p></div>`;
        return;
    }

    list.innerHTML = habits.map(habit => {
        const entry = tracking.find(t => t.habitId === habit.id && t.date === dateStr);
        const status = entry ? entry.status : 'none';

        const completedClass = status === 'completed' ? 'btn-completed-active' : 'btn-success';
        const missedClass = status === 'missed' ? 'btn-missed-active' : 'btn-missed';

        return `
            <div class="habit-card">
                <span class="habit-name">${escapeHtml(habit.name)}</span>
                <div class="habit-actions">
                    <button class="btn btn-sm ${completedClass}"
                        onclick="trackHabit('${habit.id}', '${dateStr}', 'completed')">
                        ✓ Completed
                    </button>
                    <button class="btn btn-sm ${missedClass}"
                        onclick="trackHabit('${habit.id}', '${dateStr}', 'missed')">
                        ✗ Missed
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function trackHabit(habitId, date, status) {
    try {
        await api('/api/track', 'POST', { habitId, date, status });
        // Update local tracking data
        const existing = tracking.findIndex(t => t.habitId === habitId && t.date === date);
        if (existing >= 0) {
            tracking[existing].status = status;
        } else {
            tracking.push({ habitId, date, status });
        }
        renderTracker();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// === Manage Habits ===
$('add-habit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('habit-name').value.trim();
    if (!name) return;
    try {
        const habit = await api('/api/habits', 'POST', { name });
        habits.push(habit);
        $('habit-name').value = '';
        renderManageList();
    } catch (err) {
        alert('Error: ' + err.message);
    }
});

function renderManageList() {
    const list = $('manage-habit-list');
    if (habits.length === 0) {
        list.innerHTML = `<div class="empty-state"><p>No habits created yet. Add one above!</p></div>`;
        return;
    }
    list.innerHTML = habits.map(habit => `
        <div class="manage-item">
            <div class="habit-info">
                <span class="habit-name">${escapeHtml(habit.name)}</span>
                <span class="habit-date">Created: ${new Date(habit.createdAt).toLocaleDateString()}</span>
            </div>
            <button class="btn btn-danger btn-sm" onclick="deleteHabit('${habit.id}')">Delete</button>
        </div>
    `).join('');
}

async function deleteHabit(id) {
    if (!confirm('Delete this habit? All tracking data will be lost.')) return;
    try {
        await api(`/api/habits/${id}`, 'DELETE');
        habits = habits.filter(h => h.id !== id);
        tracking = tracking.filter(t => t.habitId !== id);
        renderManageList();
        renderTracker();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// === Analysis View ===
async function loadAnalysis() {
    const content = $('analysis-content');
    content.innerHTML = '<div class="empty-state"><p>Loading analysis...</p></div>';

    try {
        const data = await api(`/api/analysis?period=${currentPeriod}`);
        renderAnalysis(data);
    } catch (err) {
        content.innerHTML = `<div class="empty-state"><p>Error loading analysis: ${err.message}</p></div>`;
    }
}

function renderAnalysis(data) {
    const content = $('analysis-content');
    const { period, analysis } = data;

    if (analysis.length === 0) {
        content.innerHTML = '<div class="empty-state"><p>No habits to analyze. Create some habits first!</p></div>';
        return;
    }

    // Overall summary
    const totalCompleted = analysis.reduce((s, a) => s + a.completed, 0);
    const totalDaysSoFar = analysis.reduce((s, a) => s + a.daysSoFar, 0);
    const overallRate = totalDaysSoFar > 0 ? Math.round((totalCompleted / totalDaysSoFar) * 100) : 0;
    const periodLabel = period === 'weekly' ? 'This Week' : 'This Month';

    let html = `
        <div class="overall-summary">
            <div class="overall-circle">${overallRate}%</div>
            <div class="overall-info">
                <h4>Overall Completion Rate — ${periodLabel}</h4>
                <p>${totalCompleted} out of ${totalDaysSoFar} total habit-days completed across ${analysis.length} habit${analysis.length > 1 ? 's' : ''}</p>
            </div>
        </div>
    `;

    html += analysis.map(a => `
        <div class="analysis-card">
            <div class="habit-name">${escapeHtml(a.habitName)}</div>
            <div class="stats-row">
                <div class="stat-box completed">
                    <div class="stat-value">${a.completed}</div>
                    <div class="stat-label">Completed</div>
                </div>
                <div class="stat-box missed">
                    <div class="stat-value">${a.missed}</div>
                    <div class="stat-label">Missed</div>
                </div>
                <div class="stat-box unmarked">
                    <div class="stat-value">${a.unmarked}</div>
                    <div class="stat-label">Unmarked</div>
                </div>
                <div class="stat-box rate">
                    <div class="stat-value">${a.rate}%</div>
                    <div class="stat-label">Success</div>
                </div>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: ${a.rate}%"></div>
            </div>
        </div>
    `).join('');

    content.innerHTML = html;
}

// === Utility ===
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// === Init ===
(function init() {
    if (getToken()) {
        showApp();
    }
})();
