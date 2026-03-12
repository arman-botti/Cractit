// playlist-fetcher.js — YouTube API v3 (Unlimited) + RSS fallback

const https = require('https');
const db = require('./database');

const YT_API_KEY = process.env.YOUTUBE_API_KEY || '';

// ── HTTP fetch helper ──────────────────────────────────
function fetchUrl(url, redirectCount) {
  redirectCount = redirectCount || 0;
  return new Promise(function(resolve, reject) {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    var req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/xml'
      }
    }, function(res) {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
        var location = res.headers.location;
        res.resume();
        return fetchUrl(location, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      var data = '';
      res.setEncoding('utf8');
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() { resolve(data); });
      res.on('error', reject);
    });
    req.on('error', reject);
    // FIX: use destroy() instead of deprecated abort()
    req.setTimeout(20000, function() {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// ── Clean playlist ID ──────────────────────────────────
function cleanPlaylistId(playlistId) {
  return (playlistId || '').trim().replace(/.*[?&]list=/, '').split('&')[0].trim();
}

// ── YouTube API v3 — fetch ALL videos ─────────────────
async function fetchPlaylistViaAPI(playlistId) {
  if (!YT_API_KEY) throw new Error('YOUTUBE_API_KEY not set in environment!');

  var videos = [];
  var pageToken = '';

  do {
    var url = 'https://www.googleapis.com/youtube/v3/playlistItems'
      + '?part=snippet'
      + '&playlistId=' + encodeURIComponent(playlistId)
      + '&maxResults=50'
      + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '')
      + '&key=' + encodeURIComponent(YT_API_KEY);

    var raw = await fetchUrl(url);

    // FIX: try/catch around JSON.parse
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch(e) {
      throw new Error('Invalid JSON response from YouTube API: ' + raw.substring(0, 100));
    }

    if (parsed.error) {
      throw new Error('YouTube API error: ' + parsed.error.message);
    }

    var items = parsed.items || [];
    for (var i = 0; i < items.length; i++) {
      var snippet = items[i].snippet;
      if (!snippet) continue;
      var videoId = snippet.resourceId && snippet.resourceId.videoId;
      if (!videoId) continue;
      if (snippet.title === 'Deleted video' || snippet.title === 'Private video') continue;

      var thumb = '';
      if (snippet.thumbnails) {
        thumb = (snippet.thumbnails.maxres && snippet.thumbnails.maxres.url)
          || (snippet.thumbnails.high && snippet.thumbnails.high.url)
          || (snippet.thumbnails.medium && snippet.thumbnails.medium.url)
          || (snippet.thumbnails.default && snippet.thumbnails.default.url)
          || '';
      }
      if (!thumb) thumb = 'https://img.youtube.com/vi/' + videoId + '/mqdefault.jpg';

      videos.push({
        videoId: videoId,
        title: snippet.title || '',
        published: snippet.publishedAt || new Date().toISOString(),
        description: (snippet.description || '').substring(0, 500),
        thumbnail: thumb,
        position: typeof snippet.position === 'number' ? snippet.position : videos.length
      });
    }

    pageToken = parsed.nextPageToken || '';
    if (videos.length >= 500) break; // safety limit

  } while (pageToken);

  // Sort by position so Class 1 comes before Class 2
  videos.sort(function(a, b) { return a.position - b.position; });
  return videos;
}

// ── RSS fallback (max 15) ─────────────────────────────
async function fetchPlaylistViaRSS(playlistId) {
  var url = 'https://www.youtube.com/feeds/videos.xml?playlist_id=' + playlistId;
  var xml = await fetchUrl(url);
  if (!xml || !xml.includes('<feed')) {
    throw new Error('Invalid RSS — check Playlist ID and make sure playlist is Public');
  }

  var videos = [];
  var entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];

  for (var i = 0; i < entries.length; i++) {
    // FIX: use immediately invoked functions to avoid closure bug with var in loop
    var entry = entries[i];
    var videoId = extractTag(entry, 'yt:videoId');
    if (!videoId) continue;
    var thumb = extractAttr(entry, 'media:thumbnail', 'url')
      || 'https://img.youtube.com/vi/' + videoId + '/mqdefault.jpg';
    videos.push({
      videoId: videoId,
      title: extractTag(entry, 'title'),
      published: extractTag(entry, 'published'),
      description: (extractTag(entry, 'media:description') || '').substring(0, 500),
      thumbnail: thumb,
      position: i
    });
  }
  return videos;
}

// FIX: standalone helper functions (not inside loop — no closure bug!)
function extractTag(text, tag) {
  var re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>');
  var match = text.match(re);
  if (!match) return '';
  return match[1].trim()
    .replace(/<!\[CDATA\[|\]\]>/g, '')  // FIX: correct CDATA regex
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function extractAttr(text, tag, attr) {
  var re = new RegExp('<' + tag + '[^>]*\\s' + attr + '="([^"]*)"');
  var match = text.match(re);
  return match ? match[1] : '';
}

// ── Save to DB ─────────────────────────────────────────
function saveVideos(videos, category, label, chapter) {
  var insert = db.prepare(
    'INSERT OR IGNORE INTO videos (title, description, youtube_id, category, label, chapter, thumbnail, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  var update = db.prepare(
    'UPDATE videos SET title=?, category=?, label=?, chapter=?, thumbnail=?, updated_at=CURRENT_TIMESTAMP WHERE youtube_id=?'
  );

  var added = 0;
  var updated = 0;

  var insertMany = db.transaction(function(vids) {
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      try {
        var r = insert.run(
          v.title, v.description || '', v.videoId,
          category, label || category, chapter || '',
          v.thumbnail, '0:00', v.published
        );
        if (r.changes > 0) {
          added++;
        } else {
          // FIX: count updates too
          var u = update.run(v.title, category, label || category, chapter || '', v.thumbnail, v.videoId);
          if (u.changes > 0) updated++;
        }
      } catch(e) {
        console.error('Skipping video ' + v.videoId + ': ' + e.message);
      }
    }
  });

  try { insertMany(videos); } catch(e) { console.error('Transaction error: ' + e.message); }
  return { added: added, updated: updated };
}

// ── Main fetch function ────────────────────────────────
async function fetchPlaylist(playlistId, category, label, chapter) {
  var cleanId = cleanPlaylistId(playlistId);
  if (!cleanId) return { success: false, error: 'Playlist ID is empty!' };

  console.log('Fetching: ' + cleanId + ' [' + category + ' > ' + (label||'') + ' > ' + (chapter||'none') + ']');

  try {
    var videos, method;

    if (YT_API_KEY) {
      videos = await fetchPlaylistViaAPI(cleanId);
      method = 'YouTube API v3';
    } else {
      videos = await fetchPlaylistViaRSS(cleanId);
      method = 'RSS (max 15)';
    }

    console.log('Found ' + videos.length + ' videos via ' + method);
    var counts = saveVideos(videos, category, label, chapter);
    console.log('Added: ' + counts.added + ', Updated: ' + counts.updated);

    return {
      success: true,
      found: videos.length,
      added: counts.added,
      updated: counts.updated,
      method: method
    };
  } catch(err) {
    console.error('Error: ' + err.message);
    return { success: false, error: err.message };
  }
}

// ── Fetch all playlists ────────────────────────────────
async function fetchAllPlaylists(playlists) {
  console.log('Syncing ' + playlists.length + ' playlists...');
  var results = [];
  for (var i = 0; i < playlists.length; i++) {
    var p = playlists[i];
    var result = await fetchPlaylist(p.playlistId, p.category, p.label, p.chapter || '');
    results.push(Object.assign({ playlistId: p.playlistId, category: p.category, label: p.label }, result));
    await new Promise(function(r) { setTimeout(r, 300); });
  }
  var totalAdded = results.reduce(function(s, r) { return s + (r.added || 0); }, 0);
  console.log('Sync complete! Total new: ' + totalAdded);
  return results;
}

module.exports = { fetchPlaylist: fetchPlaylist, fetchAllPlaylists: fetchAllPlaylists };
