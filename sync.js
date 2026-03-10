const { fetchAllPlaylists } = require('./playlist-fetcher');
const playlists = require('./playlists');

console.log('Starting manual sync...');
fetchAllPlaylists(playlists).then(results => {
  console.log('Sync complete!', results);
  process.exit(0);
}).catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
