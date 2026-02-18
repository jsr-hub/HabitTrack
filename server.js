const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.csv');
const HABITS_FILE = path.join(DATA_DIR, 'habits.csv');
const TRACKING_FILE = path.join(DATA_DIR, 'tracking.csv');

// Ensure data directory and CSV files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, 'id,username,passwordHash,createdAt\n');
if (!fs.existsSync(HABITS_FILE)) fs.writeFileSync(HABITS_FILE, 'id,userId,name,createdAt\n');
if (!fs.existsSync(TRACKING_FILE)) fs.writeFileSync(TRACKING_FILE, 'id,habitId,userId,date,status\n');

// --- CSV Helpers ---
function readCSV(file) {
    const content = fs.readFileSync(file, 'utf-8').trim();
    const lines = content.split('\n');
    if (lines.length <= 1) return [];
    const headers = lines[0].split(',');
    return lines.slice(1).map(line => {
        const vals = line.split(',');
        const obj = {};
        headers.forEach((h, i) => obj[h.trim()] = (vals[i] || '').trim());
        return obj;
    });
}

function appendCSV(file, obj) {
    const content = fs.readFileSync(file, 'utf-8').trim();
    const headers = content.split('\n')[0].split(',').map(h => h.trim());
    const row = headers.map(h => obj[h] || '').join(',');
    fs.appendFileSync(file, row + '\n');
}

function writeCSV(file, rows) {
    const content = fs.readFileSync(file, 'utf-8').trim();
    const headerLine = content.split('\n')[0];
    const headers = headerLine.split(',').map(h => h.trim());
    const lines = rows.map(r => headers.map(h => r[h] || '').join(','));
    fs.writeFileSync(file, headerLine + '\n' + lines.join('\n') + '\n');
}

function hashPassword(pw) {
    return crypto.createHash('sha256').update(pw).digest('hex');
}

function generateId() {
    return crypto.randomBytes(8).toString('hex');
}

// --- Simple session store (in-memory) ---
const sessions = {};

function createSession(userId) {
    const token = crypto.randomBytes(16).toString('hex');
    sessions[token] = { userId, created: Date.now() };
    return token;
}

function getSession(token) {
    return sessions[token] || null;
}

// --- Request helpers ---
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch { resolve({}); }
        });
    });
}

function sendJSON(res, code, data) {
    res.writeHead(code, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    res.end(JSON.stringify(data));
}

function serveStatic(res, filePath) {
    const ext = path.extname(filePath);
    const types = {
        '.html': 'text/html', '.css': 'text/css',
        '.js': 'application/javascript', '.png': 'image/png',
        '.ico': 'image/x-icon', '.svg': 'image/svg+xml'
    };
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
        res.end(data);
    });
}

function authenticate(req) {
    const auth = req.headers['authorization'];
    if (!auth) return null;
    const token = auth.replace('Bearer ', '');
    const session = getSession(token);
    return session ? session.userId : null;
}

// --- Server ---
const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
        });
        return res.end();
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // --- API Routes ---

    // Register
    if (pathname === '/api/register' && req.method === 'POST') {
        const { username, password } = await parseBody(req);
        if (!username || !password) return sendJSON(res, 400, { error: 'Username and password required' });
        if (password.length < 4) return sendJSON(res, 400, { error: 'Password must be at least 4 characters' });

        const users = readCSV(USERS_FILE);
        if (users.find(u => u.username === username)) {
            return sendJSON(res, 400, { error: 'Username already exists' });
        }
        const user = {
            id: generateId(),
            username,
            passwordHash: hashPassword(password),
            createdAt: new Date().toISOString()
        };
        appendCSV(USERS_FILE, user);
        const token = createSession(user.id);
        return sendJSON(res, 201, { token, username: user.username });
    }

    // Login
    if (pathname === '/api/login' && req.method === 'POST') {
        const { username, password } = await parseBody(req);
        const users = readCSV(USERS_FILE);
        const user = users.find(u => u.username === username && u.passwordHash === hashPassword(password));
        if (!user) return sendJSON(res, 401, { error: 'Invalid credentials' });
        const token = createSession(user.id);
        return sendJSON(res, 200, { token, username: user.username });
    }

    // Create Habit
    if (pathname === '/api/habits' && req.method === 'POST') {
        const userId = authenticate(req);
        if (!userId) return sendJSON(res, 401, { error: 'Unauthorized' });
        const { name } = await parseBody(req);
        if (!name) return sendJSON(res, 400, { error: 'Habit name required' });
        const habit = {
            id: generateId(),
            userId,
            name,
            createdAt: new Date().toISOString()
        };
        appendCSV(HABITS_FILE, habit);
        return sendJSON(res, 201, habit);
    }

    // Get Habits
    if (pathname === '/api/habits' && req.method === 'GET') {
        const userId = authenticate(req);
        if (!userId) return sendJSON(res, 401, { error: 'Unauthorized' });
        const habits = readCSV(HABITS_FILE).filter(h => h.userId === userId);
        return sendJSON(res, 200, habits);
    }

    // Delete Habit
    if (pathname.startsWith('/api/habits/') && req.method === 'DELETE') {
        const userId = authenticate(req);
        if (!userId) return sendJSON(res, 401, { error: 'Unauthorized' });
        const habitId = pathname.split('/')[3];
        let habits = readCSV(HABITS_FILE);
        const habit = habits.find(h => h.id === habitId && h.userId === userId);
        if (!habit) return sendJSON(res, 404, { error: 'Habit not found' });
        habits = habits.filter(h => !(h.id === habitId && h.userId === userId));
        writeCSV(HABITS_FILE, habits);
        // Also remove tracking entries
        let tracking = readCSV(TRACKING_FILE);
        tracking = tracking.filter(t => !(t.habitId === habitId && t.userId === userId));
        writeCSV(TRACKING_FILE, tracking);
        return sendJSON(res, 200, { success: true });
    }

    // Track habit (mark complete/incomplete for a date)
    if (pathname === '/api/track' && req.method === 'POST') {
        const userId = authenticate(req);
        if (!userId) return sendJSON(res, 401, { error: 'Unauthorized' });
        const { habitId, date, status } = await parseBody(req);
        if (!habitId || !date || !status) return sendJSON(res, 400, { error: 'habitId, date, status required' });

        let tracking = readCSV(TRACKING_FILE);
        const existing = tracking.findIndex(t => t.habitId === habitId && t.userId === userId && t.date === date);
        if (existing >= 0) {
            tracking[existing].status = status;
            writeCSV(TRACKING_FILE, tracking);
        } else {
            appendCSV(TRACKING_FILE, { id: generateId(), habitId, userId, date, status });
        }
        return sendJSON(res, 200, { success: true });
    }

    // Get tracking data
    if (pathname === '/api/tracking' && req.method === 'GET') {
        const userId = authenticate(req);
        if (!userId) return sendJSON(res, 401, { error: 'Unauthorized' });
        const tracking = readCSV(TRACKING_FILE).filter(t => t.userId === userId);
        return sendJSON(res, 200, tracking);
    }

    // Get analysis
    if (pathname === '/api/analysis' && req.method === 'GET') {
        const userId = authenticate(req);
        if (!userId) return sendJSON(res, 401, { error: 'Unauthorized' });
        const period = url.searchParams.get('period') || 'weekly';
        const habits = readCSV(HABITS_FILE).filter(h => h.userId === userId);
        const tracking = readCSV(TRACKING_FILE).filter(t => t.userId === userId);

        const today = new Date();
        let startDate;
        if (period === 'weekly') {
            startDate = new Date(today);
            startDate.setDate(today.getDate() - today.getDay()); // start of week (Sunday)
        } else {
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        }
        const startStr = startDate.toISOString().split('T')[0];

        const analysis = habits.map(habit => {
            const entries = tracking.filter(t => t.habitId === habit.id && t.date >= startStr);
            const completed = entries.filter(e => e.status === 'completed').length;
            const missed = entries.filter(e => e.status === 'missed').length;

            let totalDays;
            if (period === 'weekly') {
                totalDays = 7;
            } else {
                totalDays = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
            }
            const daysSoFar = Math.min(Math.floor((today - startDate) / (1000 * 60 * 60 * 24)) + 1, totalDays);

            return {
                habitId: habit.id,
                habitName: habit.name,
                completed,
                missed,
                unmarked: daysSoFar - completed - missed,
                totalDays,
                daysSoFar,
                rate: daysSoFar > 0 ? Math.round((completed / daysSoFar) * 100) : 0
            };
        });

        return sendJSON(res, 200, { period, startDate: startStr, analysis });
    }

    // --- Static Files ---
    if (pathname === '/' || pathname === '/index.html') {
        return serveStatic(res, path.join(__dirname, 'public', 'index.html'));
    }

    const staticFile = path.join(__dirname, 'public', pathname);
    if (fs.existsSync(staticFile) && fs.statSync(staticFile).isFile()) {
        return serveStatic(res, staticFile);
    }

    // Fallback
    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, () => {
    console.log(`\n  🚀 Habit Tracker running at http://localhost:${PORT}\n`);
});
