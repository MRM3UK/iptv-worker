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

  if (path.indexOf('/ch/') === 0) {
    var idStr = path.replace('/ch/', '').replace(/\/$/, '');
    var id = parseInt(idStr, 10);
    return handleChannel(request, id);
  }

  return new Response('IPTV Proxy\n\nEndpoints:\n- /playlist.m3u\n- /ch/{id}', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' }
  });
}

function handlePlaylist(request) {
  var workerUrl = new URL(request.url);
  var baseUrl = workerUrl.protocol + '//' + workerUrl.host;

  return fetchAndParsePlaylist(baseUrl).then(function(result) {
    return new Response(result.playlist, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-mpegurl; charset=utf-8',
        'Content-Disposition': 'attachment; filename="playlist.m3u"',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }).catch(function(error) {
    return new Response('Error fetching playlist: ' + error.message, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  });
}

function handleChannel(request, id) {
  if (isNaN(id) || id < 0) {
    return Promise.resolve(new Response('Invalid channel ID', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    }));
  }

  var workerUrl = new URL(request.url);
  var baseUrl = workerUrl.protocol + '//' + workerUrl.host;

  return fetchAndParsePlaylist(baseUrl).then(function(result) {
    var mapping = result.mapping;

    if (!mapping || !mapping[id]) {
      return new Response('Channel not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    var realUrl = mapping[id];

    return fetch(realUrl, {
      method: request.method,
      headers: {
        'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
        'Accept': '*/*'
      },
      redirect: 'follow'
    }).then(function(streamResponse) {
      if (!streamResponse.ok) {
        return new Response('Stream error: ' + streamResponse.status, {
          status: streamResponse.status,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      var contentType = streamResponse.headers.get('Content-Type') || 'application/octet-stream';

      if (contentType.indexOf('mpegurl') !== -1 || contentType.indexOf('m3u') !== -1 || realUrl.indexOf('.m3u8') !== -1) {
        return streamResponse.text().then(function(text) {
          var rewritten = rewriteM3U8(text, realUrl);
          return new Response(rewritten, {
            status: 200,
            headers: {
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache'
            }
          });
        });
      }

      var respHeaders = new Headers();
      respHeaders.set('Access-Control-Allow-Origin', '*');
      respHeaders.set('Content-Type', contentType);

      var cl = streamResponse.headers.get('Content-Length');
      if (cl) {
        respHeaders.set('Content-Length', cl);
      }

      return new Response(streamResponse.body, {
        status: streamResponse.status,
        headers: respHeaders
      });
    });
  }).catch(function(error) {
    return new Response('Error: ' + error.message, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  });
}

function fetchAndParsePlaylist(baseUrl) {
  var now = Date.now();

  if (playlistCache && mappingCache && (now - cacheTime) < CACHE_TTL) {
    return Promise.resolve({ playlist: playlistCache, mapping: mappingCache });
  }

  return fetch(XTREAM_URL, {
    headers: {
      'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
      'Accept': '*/*'
    }
  }).then(function(response) {
    if (!response.ok) {
      throw new Error('Failed to fetch: ' + response.status);
    }
    return response.text();
  }).then(function(raw) {
    var result = parsePlaylist(raw, baseUrl);
    playlistCache = result.playlist;
    mappingCache = result.mapping;
    cacheTime = now;
    return result;
  });
}

function parsePlaylist(raw, baseUrl) {
  var lines = raw.split('\n');
  var output = ['#EXTM3U'];
  var mapping = {};
  var idx = 0;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    if (line.indexOf('#EXTINF:') === 0) {
      var extinf = line;
      var streamUrl = '';

      for (var j = i + 1; j < lines.length; j++) {
        var next = lines[j].trim();
        if (next && next.indexOf('#') !== 0) {
          streamUrl = next;
          i = j;
          break;
        } else if (next.indexOf('#EXTINF:') === 0) {
          break;
        }
      }

      if (!streamUrl) continue;

      var parsed = parseExtinf(extinf);
      var newLine = buildExtinf(parsed);
      var proxyUrl = baseUrl + '/ch/' + idx;

      mapping[idx] = streamUrl;
      output.push(newLine);
      output.push(proxyUrl);
      idx++;
    }
  }

  return { playlist: output.join('\n'), mapping: mapping };
}

function parseExtinf(line) {
  var result = {
    duration: '-1',
    tvgId: '',
    tvgName: '',
    tvgLogo: DEFAULT_LOGO,
    groupTitle: '',
    channelName: ''
  };

  var durMatch = line.match(/#EXTINF:(-?\d+)/);
  if (durMatch) result.duration = durMatch[1];

  var idMatch = line.match(/tvg-id="([^"]*)"/i);
  if (idMatch) result.tvgId = idMatch[1];

  var nameMatch = line.match(/tvg-name="([^"]*)"/i);
  if (nameMatch) result.tvgName = nameMatch[1];

  var logoMatch = line.match(/tvg-logo="([^"]*)"/i);
  if (logoMatch && logoMatch[1]) result.tvgLogo = logoMatch[1];

  var groupMatch = line.match(/group-title="([^"]*)"/i);
  if (groupMatch) result.groupTitle = groupMatch[1];

  var commaIdx = line.lastIndexOf(',');
  if (commaIdx !== -1) {
    result.channelName = line.substring(commaIdx + 1).trim();
  }

  if (!result.channelName && result.tvgName) {
    result.channelName = result.tvgName;
  }

  return result;
}

function buildExtinf(p) {
  var attrs = [];

  if (p.tvgId) attrs.push('tvg-id="' + p.tvgId.replace(/"/g, "'") + '"');
  if (p.tvgName) attrs.push('tvg-name="' + p.tvgName.replace(/"/g, "'") + '"');
  if (p.tvgLogo) attrs.push('tvg-logo="' + p.tvgLogo.replace(/"/g, "'") + '"');
  if (p.groupTitle) attrs.push('group-title="' + p.groupTitle.replace(/"/g, "'") + '"');

  var attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  return '#EXTINF:' + p.duration + attrStr + ',' + p.channelName;
}

function rewriteM3U8(content, originalUrl) {
  var lastSlash = originalUrl.lastIndexOf('/');
  var baseUrl = originalUrl.substring(0, lastSlash + 1);
  var lines = content.split('\n');
  var output = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();

    if (!trimmed) {
      output.push(line);
      continue;
    }

    if (trimmed.indexOf('#') === 0) {
      if (trimmed.indexOf('URI="') !== -1) {
        var rewritten = trimmed.replace(/URI="([^"]+)"/g, function(match, uri) {
          if (uri.indexOf('http://') === 0 || uri.indexOf('https://') === 0) {
            return match;
          }
          return 'URI="' + baseUrl + uri + '"';
        });
        output.push(rewritten);
      } else {
        output.push(line);
      }
    } else if (trimmed.indexOf('http://') === 0 || trimmed.indexOf('https://') === 0) {
      output.push(trimmed);
    } else {
      output.push(baseUrl + trimmed);
    }
  }

  return output.join('\n');
}function fetchAndParsePlaylist(baseUrl) {
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
