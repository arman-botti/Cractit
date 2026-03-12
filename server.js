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
app.use(express.urlencoded({ extended: true }));

// ─── ADMIN PROTECTION ───────────────────────────────────
const ADMIN_SECRET = 'Ruchika0830';

function adminAuth(req, res, next) {
  const token = req.query.token || req.headers['x-admin-token'];
  if(token === ADMIN_SECRET) return next();
  res.status(403).send(`<!DOCTYPE html>
<html>
<head>
  <title>Admin Login</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#080b14;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif}
    .box{background:#0d1120;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:40px;width:340px;text-align:center}
    h2{color:#fff;font-size:24px;font-weight:800;margin-bottom:6px}
    p{color:#6b7280;font-size:13px;margin-bottom:24px}
    input{width:100%;background:#111827;border:1.5px solid rgba(255,255,255,0.1);color:#fff;padding:13px;border-radius:10px;font-size:15px;outline:none;margin-bottom:12px}
    button{width:100%;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border:none;padding:13px;border-radius:10px;cursor:pointer;font-size:15px;font-weight:700}
    .err{color:#f43f5e;font-size:13px;margin-top:10px;display:none}
  </style>
</head>
<body>
  <div class="box">
    <div style="font-size:48px;margin-bottom:16px">🎯</div>
    <h2>CrackIt Admin</h2>
    <p>Enter password to continue</p>
    <input type="password" id="pw" placeholder="Admin password" autofocus onkeydown="if(event.key==='Enter')go()">
    <button onclick="go()">Login →</button>
    <div class="err" id="err">❌ Wrong password!</div>
  </div>
  <script>
    function go(){
      const pw=document.getElementById('pw').value.trim();
      if(!pw)return;
      window.location.href='/manage-crackit-x9z2026?token='+encodeURIComponent(pw);
    }
  </script>
</body>
</html>`);
}

// Admin routes
app.get('/manage-crackit-x9z2026', adminAuth, (req, res) => {
  const fs = require('fs');
  const p1 = require('path').join(__dirname, 'admin.html');
  const p2 = require('path').join(__dirname, 'public', 'admin.html');
  res.sendFile(fs.existsSync(p1) ? p1 : p2);
});

app.get('/admin.html', (req, res) => { res.redirect('/'); });

app.get('/server-admin.html', (req, res) => { res.redirect('/'); });

// Serve from both root AND public folder
const fs = require('fs');
// Block direct access to admin files
app.use((req, res, next) => {
  if(req.path === '/server-admin.html' || req.path === '/admin.html') return res.redirect('/');
  next();
});
app.use(express.static(__dirname));
const publicPath = path.join(__dirname, 'public');
if(fs.existsSync(publicPath)) app.use(express.static(publicPath));


// ── LIKES ──
app.post('/api/videos/:id/like', (req, res) => {
  const { id } = req.params;
  const video = db.prepare('SELECT id, likes FROM videos WHERE id = ?').get(id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  db.prepare('UPDATE videos SET likes = likes + 1 WHERE id = ?').run(id);
  const updated = db.prepare('SELECT likes FROM videos WHERE id = ?').get(id);
  res.json({ success: true, likes: updated.likes });
});

app.get('/api/videos/:id/likes', (req, res) => {
  const video = db.prepare('SELECT likes FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ likes: 0 });
  res.json({ likes: video.likes || 0 });
});

// ─── AUTH ROUTES ───────────────────────────────────────

function hashPass(pass) {
  return crypto.createHash('sha256').update(pass + 'crackit_salt_2026').digest('hex');
}

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── Brevo Email ──
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const SENDER_EMAIL  = 'crackithelpss@gmail.com';
const SENDER_NAME   = 'CrackIt';

async function sendWelcomeEmail(toEmail, toName) {
  try {
    const https = require('https');
    const body = JSON.stringify({
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email: toEmail, name: toName }],
      replyTo: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject: 'Welcome to CrackIt — Start Cracking Exams!',
      htmlContent: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#f7f8fc;border-radius:16px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px;text-align:center;">
            <div style="font-size:36px;margin-bottom:8px;">🎯</div>
            <h1 style="color:#fff;font-size:26px;margin:0;">Welcome to CrackIt!</h1>
            <p style="color:rgba(255,255,255,0.8);margin-top:8px;">Your FREE exam preparation platform</p>
          </div>
          <div style="padding:32px;">
            <h2 style="color:#1a1d2e;font-size:20px;">Hey ${toName}! 👋</h2>
            <p style="color:#6b7280;line-height:1.7;">You've successfully joined CrackIt — India ka sabse free aur best exam prep platform!</p>
            <div style="background:#eef2ff;border-radius:12px;padding:20px;margin:20px 0;">
              <p style="color:#4f46e5;font-weight:700;margin:0 0 12px;">🚀 Aap inhe access kar sakte ho:</p>
              <ul style="color:#4f46e5;margin:0;padding-left:20px;line-height:2;">
                <li>🏛️ UPSC — History, Geography, Polity, Economy</li>
                <li>⚗️ JEE — Maths, Physics, Chemistry</li>
                <li>🧬 NEET — Biology, Physics, Chemistry</li>
                <li>📋 SSC — Maths, English, GK, Reasoning</li>
                <li>🏦 IBPS — Maths, English, Reasoning, GA</li>
              </ul>
            </div>
            <div style="text-align:center;margin-top:24px;">
              <a href="https://crackit-1t0b.onrender.com" style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;">
                Start Learning Now →
              </a>
            </div>
            <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:24px;">
              CrackIt — Crack Every Exam 🎯<br>100% Free • No Purchase Required
            </p>
          </div>
        </div>
      `
    });
    
    const options = {
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    
    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        resolve(res.statusCode);
      });
      req.on('error', () => resolve(null));
      req.write(body);
      req.end();
    });
  } catch(e) { return null; }
}

// Sign Up
app.post('/api/auth/signup', async (req, res) => {
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
  
  // Send welcome email (non-blocking)
  sendWelcomeEmail(email, name).catch(() => {});
  
  res.status(201).json({ success: true, token, user });
});

// Google OAuth
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'No credential!' });
  
  try {
    // Decode JWT payload (Google ID token)
    const payload = JSON.parse(Buffer.from(credential.split('.')[1], 'base64').toString());
    const { email, name, sub: googleId } = payload;
    
    if (!email) return res.status(400).json({ error: 'Could not get email from Google!' });
    
    // Check if user exists
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const isNew = !user;
    
    if (!user) {
      // Create new user
      const token = genToken();
      db.prepare('INSERT INTO users (name, email, password, token) VALUES (?, ?, ?, ?)')
        .run(name, email, hashPass(googleId + '_google'), token);
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      // Send welcome email
      sendWelcomeEmail(email, name).catch(() => {});
    } else {
      // Update token
      const token = genToken();
      db.prepare('UPDATE users SET token = ? WHERE id = ?').run(token, user.id);
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    }
    
    res.json({ success: true, token: user.token, user: { id: user.id, name: user.name, email: user.email }, isNew });
  } catch(e) {
    res.status(400).json({ error: 'Google login failed!' });
  }
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
  try {
    const { search, category, label, chapter, limit = 24, offset = 0 } = req.query;
    let query = 'SELECT * FROM videos WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (title LIKE ? OR description LIKE ?)';
      params.push('%' + search + '%', '%' + search + '%');
    }
    if (category && category !== 'All') {
      query += ' AND category = ? COLLATE NOCASE';
      params.push(category);
    }
    if (label) {
      query += ' AND label = ? COLLATE NOCASE';
      params.push(label);
    }
    if (chapter) {
      query += ' AND chapter = ? COLLATE NOCASE';
      params.push(chapter);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const videos = db.prepare(query).all(...params);
    const total = db.prepare('SELECT COUNT(*) as c FROM videos').get().c;
    res.json({ videos, total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/videos/trending', (req, res) => {
  try {
    const { category } = req.query;
    let query = 'SELECT * FROM videos';
    const params = [];
    if (category && category !== 'All') {
      query += ' WHERE category = ?';
      params.push(category);
    }
    query += ' ORDER BY views DESC LIMIT 8';
    res.json(db.prepare(query).all(...params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/videos/:id', (req, res) => {
  try {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
    if (!video) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE videos SET views = views + 1 WHERE id = ?').run(req.params.id);
    res.json({ ...video, views: video.views + 1 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/videos/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM videos WHERE id = ?').run(req.params.id);
    res.json({ message: 'Deleted' });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
  const { playlistId, category, label, chapter } = req.body;
  if (!playlistId) return res.status(400).json({ error: 'playlistId required' });
  try {
    // Clean playlistId - remove any URL parts if user pasted full URL
    const cleanId = (playlistId || '').replace(/.*[?&]list=/, '').split('&')[0].trim();
    const result = await fetchPlaylist(cleanId, category || 'General', label || category || 'General', chapter || '');
    res.json(result);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
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
  try {
    const total = db.prepare('SELECT COUNT(*) as c FROM videos').get().c || 0;
    const views = db.prepare('SELECT SUM(views) as v FROM videos').get().v || 0;
    const cats = db.prepare('SELECT COUNT(DISTINCT category) as c FROM videos').get().c || 0;
    const plCount = playlists.filter(p => !p.playlistId.startsWith('REPLACE_')).length;
    res.json({ total, views, cats, plCount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── AUTO SYNC ─────────────────────────────────────────

function startAutoSync() {
  const realPlaylists = playlists.filter(p => p.playlistId && !p.playlistId.startsWith('REPLACE_'));
  
  setTimeout(async () => {
    if (realPlaylists.length > 0) {
      console.log('🔄 Initial sync starting (' + realPlaylists.length + ' playlists)...');
      await fetchAllPlaylists(realPlaylists);
    } else {
      console.log('⚠️  No real playlists configured yet — skipping auto-sync.');
    }
  }, 3000);

  setInterval(async () => {
    if (realPlaylists.length > 0) {
      console.log('🔄 Scheduled sync...');
      await fetchAllPlaylists(realPlaylists);
    }
  }, 6 * 60 * 60 * 1000); // every 6 hours
}

app.listen(PORT, () => {
  console.log(`\n🎯 CrackIt running at http://localhost:${PORT}`);
  console.log(`⚙️  Admin: http://localhost:${PORT}/manage-crackit-x9z2026\n`);
  startAutoSync();
});
