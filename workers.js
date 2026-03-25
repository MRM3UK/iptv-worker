addEventListener('fetch', function(event) {
  event.respondWith(handleRequest(event.request));
});

var playlistCache = null;
var mappingCache = null;
var cacheTime = 0;
var CACHE_TTL = 300000;

var XTREAM_URL = 'http://pro.prince4k.com:7355/get.php?username=PR8403648115437&password=6503646257446&type=m3u_plus&output=m3u8';

var DEFAULT_LOGO = 'https://via.placeholder.com/150x150.png?text=TV';

function handleRequest(request) {
  var url = new URL(request.url);
  var path = url.pathname;

  if (path === '/playlist.m3u' || path === '/playlist.m3u8') {
    return handlePlaylist(request);
  }

  if (path.startsWith('/ch/')) {
    var id = parseInt(path.split('/')[2]);
    return handleChannel(request, id);
  }

  return new Response('IPTV Worker Running ✅', {
    headers: { 'Content-Type': 'text/plain' }
  });
}

// ================= PLAYLIST =================
function handlePlaylist(request) {
  var workerUrl = new URL(request.url);
  var baseUrl = workerUrl.origin;

  return fetchAndParsePlaylist(baseUrl).then(function(result) {
    return new Response(result.playlist, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      }
    });
  }).catch(function(err) {
    return new Response('Playlist Error: ' + err.message, { status: 500 });
  });
}

// ================= CHANNEL =================
function handleChannel(request, id) {
  if (isNaN(id)) {
    return new Response('Invalid ID', { status: 400 });
  }

  var workerUrl = new URL(request.url);
  var baseUrl = workerUrl.origin;

  return fetchAndParsePlaylist(baseUrl).then(function(result) {
    var mapping = result.mapping;

    if (!mapping[id]) {
      return new Response('Channel not found', { status: 404 });
    }

    var realUrl = mapping[id];

    return fetch(realUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    }).then(function(res) {

      var contentType = res.headers.get('content-type') || '';

      // 🔥 Handle M3U8 properly
      if (contentType.includes('mpegurl') || realUrl.includes('.m3u8')) {
        return res.text().then(function(text) {
          var rewritten = rewriteM3U8(text, realUrl);

          return new Response(rewritten, {
            headers: {
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Access-Control-Allow-Origin': '*'
            }
          });
        });
      }

      return new Response(res.body, {
        status: res.status,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*'
        }
      });

    });
  });
}

// ================= FETCH + CACHE =================
function fetchAndParsePlaylist(baseUrl) {
  var now = Date.now();

  if (playlistCache && mappingCache && (now - cacheTime < CACHE_TTL)) {
    return Promise.resolve({
      playlist: playlistCache,
      mapping: mappingCache
    });
  }

  return fetch(XTREAM_URL).then(res => res.text()).then(raw => {
    var result = parsePlaylist(raw, baseUrl);

    playlistCache = result.playlist;
    mappingCache = result.mapping;
    cacheTime = now;

    return result;
  });
}

// ================= PARSE =================
function parsePlaylist(raw, baseUrl) {
  var lines = raw.split('\n');
  var output = ['#EXTM3U'];
  var mapping = {};
  var index = 0;

  for (var i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXTINF')) {

      var extinf = lines[i];
      var stream = lines[i + 1];

      if (!stream || !stream.startsWith('http')) continue;

      mapping[index] = stream;

      output.push(extinf);
      output.push(baseUrl + '/ch/' + index);

      index++;
    }
  }

  return {
    playlist: output.join('\n'),
    mapping: mapping
  };
}

// ================= REWRITE =================
function rewriteM3U8(content, originalUrl) {
  var base = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);

  return content.split('\n').map(line => {
    line = line.trim();

    if (!line || line.startsWith('#')) return line;

    if (line.startsWith('http')) return line;

    return base + line;
  }).join('\n');
}
