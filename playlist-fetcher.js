// playlist-fetcher.js — YouTube Playlist se videos fetch karo (FREE, no API key!)

const https = require('https');
const db = require('./database');

function fetchUrl(url, redirectCount) {
  redirectCount = redirectCount || 0;
  return new Promise(function(resolve, reject) {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    
    var options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity'
      }
    };
    
    var req = https.get(url, options, function(res) {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
        var location = res.headers.location;
        res.resume(); // consume response to free memory
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
    
    // Timeout
    req.setTimeout(20000, function() {
      req.abort();
      reject(new Error('Request timeout after 20s'));
    });
  });
}

// YouTube playlist RSS URL
function getPlaylistRSSUrl(playlistId) {
  return 'https://www.youtube.com/feeds/videos.xml?playlist_id=' + playlistId;
}

// Parse RSS XML
function parsePlaylistRSS(xml) {
  var videos = [];
  var entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    
    function get(tag) {
      var re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\/' + tag + '>');
      var match = entry.match(re);
      if (!match) return '';
      return match[1].trim()
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
    }
    
    function getAttr(tag, attr) {
      var re = new RegExp('<' + tag + '[^>]*\\s' + attr + '="([^"]*)"');
      var match = entry.match(re);
      return match ? match[1] : '';
    }

    var videoId = get('yt:videoId');
    if (!videoId) continue;

    var thumbnail = getAttr('media:thumbnail', 'url');
    if (!thumbnail) thumbnail = 'https://img.youtube.com/vi/' + videoId + '/mqdefault.jpg';

    videos.push({
      videoId: videoId,
      title: get('title'),
      published: get('published'),
      description: (get('media:description') || '').substring(0, 500),
      thumbnail: thumbnail,
      channelName: get('name')
    });
  }

  return videos;
}

// Save to DB
function saveVideos(videos, category, label, chapter) {
  var insert = db.prepare(
    'INSERT OR IGNORE INTO videos (title, description, youtube_id, category, label, chapter, thumbnail, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  
  var update = db.prepare(
    'UPDATE videos SET title=?, category=?, label=?, chapter=?, thumbnail=?, updated_at=CURRENT_TIMESTAMP WHERE youtube_id=?'
  );

  var added = 0;
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
          update.run(v.title, category, label || category, chapter || '', v.thumbnail, v.videoId);
        }
      } catch(e) {
        console.error('   Skipping video ' + v.videoId + ': ' + e.message);
      }
    }
  });
  
  try { insertMany(videos); } catch(e) { console.error('Transaction error: ' + e.message); }
  return added;
}

// Fetch single playlist
async function fetchPlaylist(playlistId, category, label, chapter) {
  // Clean ID - strip full URL if pasted
  var cleanId = (playlistId || '').trim();
  cleanId = cleanId.replace(/.*[?&]list=/, '').split('&')[0].trim();
  
  if (!cleanId) return { success: false, error: 'Playlist ID is empty!' };
  
  console.log('Fetching playlist: ' + cleanId + ' [' + category + ']');
  try {
    var xml = await fetchUrl(getPlaylistRSSUrl(cleanId));
    if (!xml || !xml.includes('<feed')) {
      throw new Error('Invalid RSS — check Playlist ID and make sure playlist is Public');
    }

    var videos = parsePlaylistRSS(xml);
    console.log('   Found ' + videos.length + ' videos');

    var added = saveVideos(videos, category, label, chapter);
    console.log('   Added ' + added + ' new videos');

    return { success: true, found: videos.length, added: added };
  } catch (err) {
    console.error('   Error: ' + err.message);
    return { success: false, error: err.message };
  }
}

// Fetch all playlists
async function fetchAllPlaylists(playlists) {
  console.log('Syncing ' + playlists.length + ' playlists...');
  var results = [];

  for (var i = 0; i < playlists.length; i++) {
    var p = playlists[i];
    var result = await fetchPlaylist(p.playlistId, p.category, p.label, p.chapter || '');
    results.push(Object.assign({ playlistId: p.playlistId, category: p.category, label: p.label }, result));
    await new Promise(function(r) { setTimeout(r, 800); });
  }

  var totalAdded = results.reduce(function(s, r) { return s + (r.added || 0); }, 0);
  console.log('Sync complete! Total new videos: ' + totalAdded);
  return results;
}

module.exports = { fetchPlaylist: fetchPlaylist, fetchAllPlaylists: fetchAllPlaylists };
