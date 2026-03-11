// playlist-fetcher.js — YouTube Playlist se videos fetch karo (FREE, no API key!)

const https = require('https');
const db = require('./database');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
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
      description: get('media:description').substring(0, 500),
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

  let added = 0;
  const insertMany = db.transaction((vids) => {
    for (const v of vids) {
      const r = insert.run(v.title, v.description || '', v.videoId, category, label || category, chapter || '', v.thumbnail, '0:00', v.published);
      if (r.changes > 0) added++;
    }
  });
  insertMany(videos);
  return added;
}

// Fetch single playlist
async function fetchPlaylist(playlistId, category, label, chapter) {
  console.log(`📡 Fetching playlist: ${playlistId} [${category}]`);
  try {
    const xml = await fetchUrl(getPlaylistRSSUrl(playlistId));
    if (!xml.includes('<feed')) throw new Error('Invalid RSS — check Playlist ID');

    const videos = parsePlaylistRSS(xml);
    console.log(`   ✅ Found ${videos.length} videos`);

    const added = saveVideos(videos, category, label, chapter);
    console.log(`   💾 Added ${added} new videos`);

    return { success: true, found: videos.length, added };
  } catch (err) {
    console.error(`   ❌ Error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Fetch all playlists
async function fetchAllPlaylists(playlists) {
  console.log(`\n🚀 Syncing ${playlists.length} playlists...\n`);
  const results = [];

  for (const { playlistId, category, label } of playlists) {
    const result = await fetchPlaylist(playlistId, category, label);
    results.push({ playlistId, category, label, ...result });
    await new Promise(r => setTimeout(r, 600)); // polite delay
  }

  const totalAdded = results.reduce((s, r) => s + (r.added || 0), 0);
  console.log(`\n✅ Sync complete! Total new videos: ${totalAdded}\n`);
  return results;
}

module.exports = { fetchPlaylist, fetchAllPlaylists };
