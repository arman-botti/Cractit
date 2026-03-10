const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./database');
const { fetchAllPlaylists, fetchPlaylist } = require('./playlist-fetcher');
const playlists = require('./playlists');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─── ADMIN PROTECTION ───────────────────────────────────
const ADMIN_SECRET = 'Ruchika0830';

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if(token === ADMIN_SECRET) return next();
  res.status(403).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Admin Login — CrackIt</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:#080b14;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif}
        .box{background:#0d1120;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:40px;width:320px;text-align:center}
        .icon{font-size:40px;margin-bottom:16px}
        h2{color:#fff;font-size:22px;margin-bottom:6px}
        p{color:#6b7280;font-size:13px;margin-bottom:24px}
        input{width:100%;background:#111827;border:1.5px solid rgba(255,255,255,0.1);color:#fff;padding:12px;border-radius:10px;font-size:14px;outline:none;margin-bottom:12px}
        button{width:100%;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border:none;padding:12px;border-radius:10px;cursor:pointer;font-size:15px;font-weight:700}
        .err{color:#f43f5e;font-size:12px;margin-bottom:12px;display:none}
      </style>
    </head>
    <body>
      <div class="box">
        <div class="icon">🔐</div>
        <h2>Admin Access</h2>
        <p>Enter password to continue</p>
        <input type="password" id="pw" placeholder="Enter admin password" onkeydown="if(event.key==='Enter')login()">
        <div class="err" id="err">Wrong password!</div>
        <button onclick="login()">Enter →</button>
      </div>
      <script>
        function login(){
          const pw=document.getElementById('pw').value;
          fetch(window.location.pathname+'?token='+encodeURIComponent(pw))
            .then(r=>{if(r.ok){window.location.href=window.location.pathname+'?token='+encodeURIComponent(pw)}else{document.getElementById('err').style.display='block';document.getElementById('pw').value=''}})
        }
      </script>
    </body>
    </html>
  `);
}

// Protect admin pages
app.get('/admin.html', adminAuth, (req, res) => {
  const fs = require('fs');
  const adminPath = require('path').join(__dirname, 'admin.html');
  const adminPath2 = require('path').join(__dirname, 'public', 'admin.html');
  const file = fs.existsSync(adminPath) ? adminPath : adminPath2;
  res.sendFile(file);
});

app.get('/server-admin.html', adminAuth, (req, res) => {
  const fs = require('fs');
  const p1 = require('path').join(__dirname, 'server-admin.html');
  const p2 = require('path').join(__dirname, 'public', 'server-admin.html');
  const file = fs.existsSync(p1) ? p1 : p2;
  res.sendFile(file);
});

// Serve from both root AND public folder
const fs = require('fs');
app.use(express.static(__dirname));
const publicPath = path.join(__dirname, 'public');
if(fs.existsSync(publicPath)) app.use(express.static(publicPath));

// ─── AUTH ROUTES ───────────────────────────────────────

function hashPass(pass) {
  return crypto.createHash('sha256').update(pass + 'crackit_salt_2026').digest('hex');
}

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Sign Up
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required!' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters!' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing)
    return res.status(400).json({ error: 'This email is already registered!' });

  const token = genToken();
  db.prepare('INSERT INTO users (name, email, password, token) VALUES (?, ?, ?, ?)')
    .run(name, email, hashPass(password), token);

  const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
  res.status(201).json({ success: true, token, user });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Please enter email and password!' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND password = ?')
    .get(email, hashPass(password));
  if (!user)
    return res.status(401).json({ error: 'Invalid email or password!' });

  const token = genToken();
  db.prepare('UPDATE users SET token = ? WHERE id = ?').run(token, user.id);
  res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email } });
});

// Verify token (check login status)
app.get('/api/auth/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  const user = db.prepare('SELECT id, name, email FROM users WHERE token = ?').get(token);
  if (!user) return res.status(401).json({ error: 'Invalid token' });
  res.json({ user });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) db.prepare('UPDATE users SET token = NULL WHERE token = ?').run(token);
  res.json({ success: true });
});

// ─── VIDEO ROUTES ──────────────────────────────────────

app.get('/api/videos', (req, res) => {
  const { search, category, label, limit = 24, offset = 0 } = req.query;
  let query = 'SELECT * FROM videos WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (title LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category && category !== 'All') {
    query += ' AND category = ?';
    params.push(category);
  }
  if (label) {
    query += ' AND label = ?';
    params.push(label);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const videos = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM videos').get().c;
  res.json({ videos, total });
});

app.get('/api/videos/trending', (req, res) => {
  const { category } = req.query;
  let query = 'SELECT * FROM videos';
  const params = [];
  if (category && category !== 'All') {
    query += ' WHERE category = ?';
    params.push(category);
  }
  query += ' ORDER BY views DESC LIMIT 8';
  res.json(db.prepare(query).all(...params));
});

app.get('/api/videos/:id', (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE videos SET views = views + 1 WHERE id = ?').run(req.params.id);
  res.json({ ...video, views: video.views + 1 });
});

app.delete('/api/videos/:id', (req, res) => {
  db.prepare('DELETE FROM videos WHERE id = ?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

// ─── CATEGORY & LABEL ROUTES ───────────────────────────

app.get('/api/categories', (req, res) => {
  const cats = db.prepare('SELECT DISTINCT category FROM videos ORDER BY category').all();
  res.json(['All', ...cats.map(c => c.category)]);
});

app.get('/api/labels', (req, res) => {
  const { category } = req.query;
  let query = 'SELECT DISTINCT label FROM videos WHERE label != ""';
  const params = [];
  if (category && category !== 'All') {
    query += ' AND category = ?';
    params.push(category);
  }
  const labels = db.prepare(query).all(...params);
  res.json(labels.map(l => l.label));
});

// ─── SYNC ROUTES ───────────────────────────────────────

app.post('/api/sync/all', async (req, res) => {
  try {
    const results = await fetchAllPlaylists(playlists);
    const totalAdded = results.reduce((s, r) => s + (r.added || 0), 0);
    res.json({ success: true, results, totalAdded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/playlist', async (req, res) => {
  const { playlistId, category, label } = req.body;
  if (!playlistId) return res.status(400).json({ error: 'playlistId required' });
  const result = await fetchPlaylist(playlistId, category || 'General', label || category || 'General');
  res.json(result);
});

app.get('/api/playlists', (req, res) => res.json(playlists));

// ─── USERS ROUTES (Admin) ──────────────────────────────
app.get('/api/users', (req, res) => {
  const users = db.prepare('SELECT id, name, email, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

app.get('/api/users/count', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  res.json({ count });
});

app.delete('/api/users/:id', (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── STATS ─────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as c FROM videos').get().c;
  const views = db.prepare('SELECT SUM(views) as v FROM videos').get().v || 0;
  const cats = db.prepare('SELECT COUNT(DISTINCT category) as c FROM videos').get().c;
  const plCount = playlists.length;
  res.json({ total, views, cats, plCount });
});

// ─── AUTO SYNC ─────────────────────────────────────────

function startAutoSync() {
  setTimeout(async () => {
    if (playlists.length > 0) {
      console.log('🔄 Initial sync starting...');
      await fetchAllPlaylists(playlists);
    }
  }, 3000);

  setInterval(async () => {
    console.log('🔄 Scheduled sync...');
    await fetchAllPlaylists(playlists);
  }, 6 * 60 * 60 * 1000); // every 6 hours
}

app.listen(PORT, () => {
  console.log(`\n🎓 StudyVibe running at http://localhost:${PORT}`);
  console.log(`⚙️  Admin: http://localhost:${PORT}/admin.html\n`);
  startAutoSync();
});
