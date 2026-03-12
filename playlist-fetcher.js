// playlist-fetcher.js — YouTube Playlist se videos fetch karo (FREE, no API key!)

const https = require('https');
const db = require('./database');

function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
  });
}

// YouTube playlist RSS URL
function getPlaylistRSSUrl(playlistId) {
  return `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
}

// Parse RSS XML
function parsePlaylistRSS(xml) {
  const videos = [];
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];

  for (const entry of entries) {
    const get = (tag) => {
      const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return match ? match[1].trim().replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'") : '';
    };
    const getAttr = (tag, attr) => {
      const match = entry.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`));
      return match ? match[1] : '';
    };

    const videoId = get('yt:videoId');
    if (!videoId) continue;

    videos.push({
      videoId,
      title: get('title'),
      published: get('published'),
      description: (get('media:description') || '').substring(0, 500),
      thumbnail: getAttr('media:thumbnail', 'url') || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      channelName: get('name'),
    });
  }

  return videos;
}

// Save to DB
function saveVideos(videos, category, label, chapter) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO videos (title, description, youtube_id, category, label, chapter, thumbnail, duration, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  // Update existing videos with new category/label/chapter/title
  const update = db.prepare(`
    UPDATE videos SET title=?, category=?, label=?, chapter=?, thumbnail=?, updated_at=CURRENT_TIMESTAMP
    WHERE youtube_id=?
  `);

  let added = 0;
  const insertMany = db.transaction((vids) => {
    for (const v of vids) {
      try {
        const r = insert.run(v.title, v.description || '', v.videoId, category, label || category, chapter || '', v.thumbnail, '0:00', v.published);
        if (r.changes > 0) {
          added++;
        } else {
          // Already exists - update category/label/chapter/updated_at
          update.run(v.title, category, label || category, chapter || '', v.thumbnail, v.videoId);
        }
      } catch(e) {
        console.error('   ⚠️  Skipping video ' + v.videoId + ':', e.message);
      }
    }
  });
  try { insertMany(videos); } catch(e) { console.error('Transaction error:', e.message); }
  return added;
}

// Fetch single playlist
async function fetchPlaylist(playlistId, category, label, chapter) {
  // Clean ID in case full URL was passed
  const cleanId = (playlistId || '').replace(/.*[?&]list=/, '').split('&')[0].trim();
  if (!cleanId) return { success: false, error: 'Playlist ID is empty!' };
  console.log(`📡 Fetching playlist: ${cleanId} [${category}]`);
  try {
    const xml = await fetchUrl(getPlaylistRSSUrl(cleanId));
    if (!xml.includes('<feed')) throw new Error('Invalid RSS — check Playlist ID');

    const videos = parsePlaylistRSS(xml);
    console.log(`   ✅ Found ${videos.length} videos (RSS max: 15)`);

    const added = saveVideos(videos, category, label, chapter);
    console.log(`   💾 Added ${added} new videos`);

    return { success: true, found: videos.length, added, note: videos.length >= 15 ? 'RSS limit: only 15 videos fetched. Split playlist into smaller ones for more.' : '' };
  } catch (err) {
    console.error(`   ❌ Error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Fetch all playlists
async function fetchAllPlaylists(playlists) {
  console.log(`\n🚀 Syncing ${playlists.length} playlists...\n`);
  const results = [];

  for (const { playlistId, category, label, chapter } of playlists) {
    const result = await fetchPlaylist(playlistId, category, label, chapter || '');
    results.push({ playlistId, category, label, ...result });
    await new Promise(r => setTimeout(r, 600)); // polite delay
  }

  const totalAdded = results.reduce((s, r) => s + (r.added || 0), 0);
  console.log(`\n✅ Sync complete! Total new videos: ${totalAdded}\n`);
  return results;
}

module.exports = { fetchPlaylist, fetchAllPlaylists };
