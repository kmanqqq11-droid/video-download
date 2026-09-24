(() => {
  const $ = (id) => document.getElementById(id);
  const urlEl = $('url'), getBtn = $('get'), pasteBtn = $('paste'), msg = $('message');
  const result = $('result'), dlBtn = $('download'), qualityEl = $('quality');
  const progWrap = $('progressWrap'), bar = $('bar');
  const appEl = $('app'), loginEl = $('login'), pinEl = $('pin'), unlockBtn = $('unlock'), loginMsg = $('loginMsg');

  let current = null; // { url, platform }
  let pollTimer = null;

  // ---- API + auth ----
  const base = () => (window.VD_API_BASE || '').replace(/\/+$/, '');
  const tokenKey = () => 'vd_token:' + (base() || location.origin);
  const getToken = () => { try { return localStorage.getItem(tokenKey()) || ''; } catch { return ''; } };
  const setToken = (t) => { try { t ? localStorage.setItem(tokenKey(), t) : localStorage.removeItem(tokenKey()); } catch { /* ignore */ } };

  function showLogin() { appEl.hidden = true; loginEl.hidden = false; pinEl.focus(); }
  function showApp() { loginEl.hidden = true; appEl.hidden = false; }

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const t = getToken();
    if (t) headers.Authorization = 'Bearer ' + t;
    const res = await fetch(base() + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.code === 'auth') {
      setToken('');
      stopPolling();
      showLogin();
      throw new Error('Please enter your PIN');
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function init() {
    try {
      const a = await api('/api/auth');
      if (a.required && !a.authenticated) showLogin(); else showApp();
    } catch {
      showApp(); // server unreachable: show the app; requests will report the error
    }
  }
  window.VD_init = init;

  async function unlock() {
    const pin = pinEl.value.trim();
    if (!pin) return;
    unlockBtn.disabled = true;
    loginMsg.textContent = '';
    try {
      const { token } = await api('/api/login', { method: 'POST', body: JSON.stringify({ pin }) });
      setToken(token);
      pinEl.value = '';
      showApp();
    } catch (e) {
      loginMsg.textContent = e.message;
      loginMsg.className = 'message error';
      pinEl.value = '';
    } finally {
      unlockBtn.disabled = false;
    }
  }
  unlockBtn.addEventListener('click', unlock);
  pinEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });

  // ---- UI ----
  function say(text, kind = '') {
    msg.textContent = text;
    msg.className = 'message ' + kind;
  }

  const fmtDuration = (s) => {
    if (!s) return '';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  };

  pasteBtn.addEventListener('click', async () => {
    try {
      urlEl.value = (await navigator.clipboard.readText()).trim();
      urlEl.focus();
    } catch {
      say('Clipboard access was blocked. Long-press the field to paste.', 'error');
    }
  });

  urlEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') getBtn.click(); });

  getBtn.addEventListener('click', async () => {
    const url = urlEl.value.trim();
    if (!url) return say('Paste a video URL first.', 'error');
    stopPolling();
    result.hidden = true;
    progWrap.hidden = true;
    getBtn.disabled = true;
    say('Fetching video info…');
    try {
      const info = await api('/api/info', { method: 'POST', body: JSON.stringify({ url }) });
      current = { url: info.url, platform: info.platform };
      $('platform').textContent = info.platform;
      $('title').textContent = info.title;
      $('meta').textContent = [info.uploader, fmtDuration(info.duration)].filter(Boolean).join(' · ');
      const img = $('thumb');
      if (info.thumbnail) { img.src = info.thumbnail; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
      qualityEl.innerHTML = '';
      for (const q of info.qualities) {
        const o = document.createElement('option');
        o.value = q.id; o.textContent = q.label;
        qualityEl.appendChild(o);
      }
      result.hidden = false;
      say('');
    } catch (e) {
      say(e.message, 'error');
    } finally {
      getBtn.disabled = false;
    }
  });

  dlBtn.addEventListener('click', async () => {
    if (!current) return;
    dlBtn.disabled = true;
    setProgress(0, true);
    say('Starting…');
    try {
      const { id } = await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ url: current.url, quality: qualityEl.value }),
      });
      poll(id);
    } catch (e) {
      failed(e.message);
    }
  });

  function setProgress(fraction, indeterminate = false) {
    progWrap.hidden = false;
    progWrap.classList.toggle('indeterminate', indeterminate);
    bar.style.width = indeterminate ? '' : Math.round(fraction * 100) + '%';
  }

  function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }

  function failed(text) {
    stopPolling();
    progWrap.hidden = true;
    dlBtn.disabled = false;
    say(text, 'error');
  }

  function poll(id) {
    pollTimer = setTimeout(async () => {
      try {
        const j = await api('/api/jobs/' + id);
        if (j.status === 'error') return failed(j.error || 'Download failed');
        if (j.status === 'done') {
          setProgress(1);
          say('Ready! Saving to your device…', 'ok');
          const { ticket } = await api(`/api/jobs/${id}/ticket`, { method: 'POST' });
          const a = document.createElement('a');
          a.href = `${base()}/api/jobs/${id}/file?ticket=${encodeURIComponent(ticket)}`;
          a.download = j.filename || '';
          document.body.appendChild(a);
          a.click();
          a.remove();
          dlBtn.disabled = false;
          return stopPolling();
        }
        if (j.status === 'processing') { setProgress(1, true); say('Processing…'); }
        else { setProgress(j.progress, j.progress === 0); say(`Downloading… ${Math.round(j.progress * 100)}%`); }
        poll(id);
      } catch (e) {
        failed(e.message);
      }
    }, 800);
  }

  // ---- Settings Panel ----
  const settingsBtn = $('settingsBtn');
  const settingsEl = $('settings');
  const closeSettingsBtn = $('closeSettings');
  const cookieDrop = $('cookieDrop');
  const cookieFileInput = $('cookieFile');
  const cookieDropLabel = $('cookieDropLabel');
  const uploadCookieBtn = $('uploadCookieBtn');
  const clearCookieBtn = $('clearCookieBtn');
  const cookieStatus = $('cookieStatus');

  let pendingCookieFile = null;

  settingsBtn.addEventListener('click', () => { settingsEl.hidden = !settingsEl.hidden; });
  closeSettingsBtn.addEventListener('click', () => { settingsEl.hidden = true; });

  // Click to open file picker
  cookieDrop.addEventListener('click', () => cookieFileInput.click());
  cookieFileInput.addEventListener('change', () => {
    if (cookieFileInput.files[0]) selectCookieFile(cookieFileInput.files[0]);
  });

  // Drag & drop
  cookieDrop.addEventListener('dragover', (e) => { e.preventDefault(); cookieDrop.classList.add('drag-over'); });
  cookieDrop.addEventListener('dragleave', () => cookieDrop.classList.remove('drag-over'));
  cookieDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    cookieDrop.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) selectCookieFile(f);
  });

  function selectCookieFile(file) {
    pendingCookieFile = file;
    cookieDrop.classList.add('has-file');
    cookieDropLabel.textContent = `✅ ${file.name} selected`;
    cookieStatus.textContent = '';
    cookieStatus.className = 'cookie-status';
  }

  uploadCookieBtn.addEventListener('click', async () => {
    if (!pendingCookieFile) { cookieStatus.textContent = 'Please select a cookies.txt file first.'; cookieStatus.className = 'cookie-status error'; return; }
    uploadCookieBtn.disabled = true;
    cookieStatus.textContent = 'Uploading…';
    cookieStatus.className = 'cookie-status';
    try {
      const text = await pendingCookieFile.text();
      const b64 = btoa(unescape(encodeURIComponent(text)));
      await api('/api/admin/cookies', { method: 'POST', body: JSON.stringify({ cookies: b64 }) });
      cookieStatus.textContent = '✅ Cookies uploaded! YouTube downloads should work now.';
      cookieStatus.className = 'cookie-status ok';
    } catch (e) {
      cookieStatus.textContent = '❌ ' + e.message;
      cookieStatus.className = 'cookie-status error';
    } finally {
      uploadCookieBtn.disabled = false;
    }
  });

  clearCookieBtn.addEventListener('click', async () => {
    clearCookieBtn.disabled = true;
    try {
      await api('/api/admin/cookies', { method: 'DELETE' });
      pendingCookieFile = null;
      cookieDrop.classList.remove('has-file');
      cookieDropLabel.innerHTML = '📂 Click or drag & drop <code>cookies.txt</code> here';
      cookieFileInput.value = '';
      cookieStatus.textContent = 'Cookies cleared.';
      cookieStatus.className = 'cookie-status ok';
    } catch (e) {
      cookieStatus.textContent = '❌ ' + e.message;
      cookieStatus.className = 'cookie-status error';
    } finally {
      clearCookieBtn.disabled = false;
    }
  });

  init();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
