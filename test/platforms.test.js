const test = require('node:test');
const assert = require('node:assert');
const { detectPlatform } = require('../src/platforms');

test('detects supported platforms', () => {
  const cases = {
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ': 'YouTube',
    'https://youtu.be/dQw4w9WgXcQ': 'YouTube',
    'https://vm.tiktok.com/abc/': 'TikTok',
    'https://pin.it/xyz': 'Pinterest',
    'https://fb.watch/abc/': 'Facebook',
    'https://www.instagram.com/reel/abc/': 'Instagram',
    'https://old.reddit.com/r/x/comments/1/': 'Reddit',
    'https://vimeo.com/12345': 'Vimeo',
    'https://x.com/user/status/1': 'X',
    'https://www.twitch.tv/videos/1': 'Twitch',
  };
  for (const [url, name] of Object.entries(cases)) assert.strictEqual(detectPlatform(url).platform, name, url);
});

test('rejects unsupported / dangerous URLs', () => {
  const bad = [
    'http://localhost:3000/secret',
    'http://169.254.169.254/latest/meta-data',
    'https://evilyoutube.com/x',
    'https://youtube.com.evil.com/x',
    'file:///etc/passwd',
    'https://user:pw@youtube.com/x',
    'not a url',
    '',
    null,
  ];
  for (const b of bad) assert.strictEqual(detectPlatform(b), null, String(b));
});
