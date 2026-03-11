// === StreamVault - EKC TV V4 ===
// Dual DNS: Marble (pradahype.com) + Premium (pinkponyclub.online)
// + Stremio Panel

const DNS = {
    marble: { name: 'Marble', url: 'https://pradahype.com', color: 'marble' },
    pony:   { name: 'Premium', url: 'https://pinkponyclub.online', color: 'pony' }
};

const App = {
    session: null,
    servers: {},       // { marble: { connected, userInfo, serverInfo }, pony: { ... } }
    currentPage: 'live',
    currentSource: 'all',  // 'all', 'marble', 'pony'
    categories: [],
    streams: [],
    favorites: JSON.parse(localStorage.getItem('sv_favorites') || '[]'),
    stremioAddons: [],
    premiumizeKey: localStorage.getItem('sv_premiumize') || 'esx99bfad8pr88bk',

    // Default Stremio addons (always available)
    defaultStremioAddons: [
        {
            url: 'https://v3-cinemeta.strem.io',
            name: 'Cinemeta',
            manifest: {
                id: 'com.linvo.cinemeta',
                name: 'Cinemeta',
                types: ['movie', 'series'],
                catalogs: [
                    { type: 'movie', id: 'top', name: 'Popular Movies', extra: [{ name: 'search' }, { name: 'genre' }, { name: 'skip' }] },
                    { type: 'series', id: 'top', name: 'Popular Series', extra: [{ name: 'search' }, { name: 'genre' }, { name: 'skip' }] },
                    { type: 'movie', id: 'year', name: 'New Movies' },
                    { type: 'series', id: 'year', name: 'New Series' }
                ]
            }
        },
        {
            url: 'https://torrentio.strem.fun',
            name: 'Torrentio',
            manifest: {
                id: 'com.strem.torrentio',
                name: 'Torrentio',
                types: ['movie', 'series'],
                catalogs: [],
                resources: ['stream']
            }
        },
        {
            url: 'https://comet.elfhosted.com',
            name: 'Comet',
            manifest: {
                id: 'com.elfhosted.comet',
                name: 'Comet',
                types: ['movie', 'series'],
                catalogs: [],
                resources: ['stream']
            }
        }
    ],

    epgChannels: [],
    epgAllChannels: [],
    epgCategories: [],
    epgData: {},
    epgDateOffset: 0,
    epgStartHour: 0,
    epgSource: 'all',
    epgCategory: 'all',
    EPG_HOURS: 24,
    PX_PER_MIN: 3.33, // pixels per minute (200px per 60min)

    init() {
        // Merge default + user-saved addons (deduplicate by url)
        try {
            const saved = JSON.parse(localStorage.getItem('sv_addons') || '[]');
            const allAddons = [...this.defaultStremioAddons];
            saved.forEach(a => {
                if (!allAddons.some(d => d.url === a.url)) allAddons.push(a);
            });
            this.stremioAddons = allAddons;
        } catch(e) {
            console.error('[Init] Failed to load addons:', e);
            this.stremioAddons = [...this.defaultStremioAddons];
        }

        this.bindEvents();

        // Pre-fill login if we have a saved session, but always show login screen
        try {
            const savedSession = JSON.parse(localStorage.getItem('sv_session'));
            if (savedSession) {
                document.getElementById('loginUser').value = savedSession.username || '';
                document.getElementById('loginPass').value = savedSession.token || '';
                console.log('[Init] Pre-filled saved credentials for:', savedSession.username);
            }
        } catch(e) {
            console.error('[Init] Failed to read saved session:', e);
        }
        // Clear stale server data - user must click Connect
        localStorage.removeItem('sv_servers');
    },

    bindEvents() {
        document.getElementById('btnConnect').addEventListener('click', () => this.handleLogin());
        document.querySelectorAll('.login-form input').forEach(input => {
            input.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.handleLogin(); });
        });

        // Home screen tiles
        document.querySelectorAll('.home-tile').forEach(tile => {
            tile.addEventListener('click', () => {
                this.openSection(tile.dataset.page);
            });
        });

        // Home button (logo in top nav)
        document.getElementById('btnHome').addEventListener('click', () => this.showHome());

        // Top nav tabs
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.navigateTo(btn.dataset.page);
            });
        });

        // Source toggle
        document.querySelectorAll('.source-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentSource = btn.dataset.source;
                this.filterBySource();
            });
        });

        document.getElementById('btnBack').addEventListener('click', () => this.goBack());
        document.getElementById('btnClosePlayer').addEventListener('click', () => this.closePlayer());
        document.getElementById('btnFullscreen').addEventListener('click', () => {
            const v = document.getElementById('videoPlayer');
            if (v.requestFullscreen) v.requestFullscreen();
        });
        document.getElementById('btnFavorite').addEventListener('click', () => this.toggleCurrentFavorite());
        document.getElementById('searchInput').addEventListener('input', (e) => this.handleSearch(e.target.value));
        // Stremio tab navigation
        document.querySelectorAll('.stremio-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.stremio-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.switchStremioTab(tab.dataset.stab);
            });
        });
        document.getElementById('btnStremioDetailClose').addEventListener('click', () => this.closeStremioDetail());
        document.getElementById('stremioSearch').addEventListener('input', (e) => this.handleStremioSearch(e.target.value));

        // EPG controls
        document.getElementById('btnEpgPrev').addEventListener('click', () => { this.epgDateOffset--; this.loadEpg(); });
        document.getElementById('btnEpgNext').addEventListener('click', () => { this.epgDateOffset++; this.loadEpg(); });
        document.getElementById('btnEpgNow').addEventListener('click', () => { this.epgDateOffset = 0; this.loadEpg(); this.scrollEpgToNow(); });

        // EPG category chips (delegated)
        document.getElementById('epgCatBar').addEventListener('click', (e) => {
            const chip = e.target.closest('.epg-cat-chip');
            if (!chip) return;
            document.querySelectorAll('.epg-cat-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            this.epgCategory = chip.dataset.cat;
            this.renderEpgFiltered();
        });

        document.querySelectorAll('.epg-src-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.epg-src-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.epgSource = btn.dataset.epgSource;
                this.renderEpgFiltered();
            });
        });

        // === Keyboard / Remote Control Navigation ===
        this._focusedIdx = -1;
        document.addEventListener('keydown', (e) => this.handleRemoteKey(e));

        // When exiting fullscreen (back button on remote/browser), close the player
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                const playerOpen = !document.getElementById('playerOverlay').classList.contains('hidden');
                if (playerOpen) {
                    this.closePlayer();
                }
            }
        });

        // Browser back button → go to home screen
        window.addEventListener('popstate', (e) => {
            const playerOpen = !document.getElementById('playerOverlay').classList.contains('hidden');
            if (playerOpen) {
                this.closePlayer();
            } else if (document.getElementById('mainScreen').classList.contains('active')) {
                this.showHome();
            }
        });
    },

    // Remote control & keyboard handler (Onn 4K Pro / Android TV remote)
    handleRemoteKey(e) {
        const key = e.key;
        const playerOpen = !document.getElementById('playerOverlay').classList.contains('hidden');

        // Player controls
        if (playerOpen) {
            switch(key) {
                case 'Escape':
                case 'Backspace':
                case 'GoBack':
                    e.preventDefault();
                    this.closePlayer();
                    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
                    return;
                case 'MediaPlayPause':
                case ' ':
                    e.preventDefault();
                    const v = document.getElementById('videoPlayer');
                    v.paused ? v.play() : v.pause();
                    return;
                case 'ArrowLeft':
                    e.preventDefault();
                    document.getElementById('videoPlayer').currentTime -= 10;
                    return;
                case 'ArrowRight':
                    e.preventDefault();
                    document.getElementById('videoPlayer').currentTime += 10;
                    return;
                case 'f':
                case 'Enter':
                    e.preventDefault();
                    const overlay = document.getElementById('playerOverlay');
                    if (!document.fullscreenElement) {
                        overlay.requestFullscreen?.() || overlay.webkitRequestFullscreen?.();
                    } else {
                        document.exitFullscreen?.() || document.webkitExitFullscreen?.();
                    }
                    return;
            }
            return;
        }

        // Navigation in lists
        // Guide has special 2D navigation (left=channels, right=programs, up/down=scroll channels)
        if (this.currentPage === 'guide') {
            this.handleGuideKey(e);
            return;
        }

        const focusable = this.getFocusableItems();
        if (!focusable.length) return;

        switch(key) {
            case 'ArrowUp':
                e.preventDefault();
                this._focusedIdx = Math.max(0, this._focusedIdx - 1);
                this.focusItem(focusable);
                break;
            case 'ArrowDown':
                e.preventDefault();
                this._focusedIdx = Math.min(focusable.length - 1, this._focusedIdx + 1);
                this.focusItem(focusable);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this.navigateTab(-1);
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.navigateTab(1);
                break;
            case 'Enter':
                e.preventDefault();
                if (this._focusedIdx >= 0 && focusable[this._focusedIdx]) {
                    focusable[this._focusedIdx].click();
                }
                break;
            case 'Escape':
            case 'Backspace':
            case 'GoBack':
                e.preventDefault();
                const backBtn = document.getElementById('btnBack');
                if (!backBtn.classList.contains('hidden')) {
                    backBtn.click();
                } else {
                    this.showHome();
                }
                break;
        }
    },

    // Guide-specific 2D keyboard navigation
    _guideFocusSide: 'channels', // 'channels' or 'programs'
    _guideFocusRow: 0,

    handleGuideKey(e) {
        const key = e.key;
        const channels = [...document.querySelectorAll('#epgChannelList .epg-channel-row')];
        const progRows = [...document.querySelectorAll('#epgPrograms .epg-program-row')];
        if (!channels.length) return;

        switch(key) {
            case 'ArrowUp':
                e.preventDefault();
                this._guideFocusRow = Math.max(0, this._guideFocusRow - 1);
                this.focusGuideRow(channels, progRows);
                break;
            case 'ArrowDown':
                e.preventDefault();
                this._guideFocusRow = Math.min(channels.length - 1, this._guideFocusRow + 1);
                this.focusGuideRow(channels, progRows);
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (this._guideFocusSide === 'channels') {
                    this._guideFocusSide = 'programs';
                    this.focusGuideRow(channels, progRows);
                } else {
                    // Scroll programs right
                    document.getElementById('epgScrollArea').scrollLeft += 200;
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (this._guideFocusSide === 'programs') {
                    this._guideFocusSide = 'channels';
                    this.focusGuideRow(channels, progRows);
                } else {
                    // Go to prev nav tab
                    this.navigateTab(-1);
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (channels[this._guideFocusRow]) {
                    channels[this._guideFocusRow].click();
                }
                break;
            case 'Escape':
            case 'Backspace':
            case 'GoBack':
                e.preventDefault();
                this.showHome();
                break;
        }
    },

    focusGuideRow(channels, progRows) {
        // Clear all focus
        document.querySelectorAll('.remote-focus').forEach(el => el.classList.remove('remote-focus'));

        const idx = this._guideFocusRow;
        if (this._guideFocusSide === 'channels' && channels[idx]) {
            channels[idx].classList.add('remote-focus');
            channels[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else if (this._guideFocusSide === 'programs' && progRows[idx]) {
            progRows[idx].classList.add('remote-focus');
            // Also scroll the whole container so the row is visible
            const scrollArea = document.getElementById('epgScrollArea');
            const rowTop = progRows[idx].offsetTop;
            const visible = scrollArea.scrollTop + scrollArea.clientHeight;
            if (rowTop < scrollArea.scrollTop + 40) {
                scrollArea.scrollTop = rowTop - 40;
            } else if (rowTop + 52 > visible) {
                scrollArea.scrollTop = rowTop + 52 - scrollArea.clientHeight;
            }
        }

        // Update now bar
        this._epgSelectedIdx = idx;
        this.updateEpgNowBar();
    },

    getFocusableItems() {
        const cards = [...document.querySelectorAll('#contentGrid .stream-card')];
        return cards.filter(c => c.style.display !== 'none');
    },

    focusItem(items) {
        document.querySelectorAll('.remote-focus').forEach(el => el.classList.remove('remote-focus'));
        if (this._focusedIdx >= 0 && items[this._focusedIdx]) {
            const el = items[this._focusedIdx];
            el.classList.add('remote-focus');
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    },

    navigateTab(direction) {
        const navBtns = [...document.querySelectorAll('.nav-btn')];
        const activeIdx = navBtns.findIndex(b => b.classList.contains('active'));
        const newIdx = Math.max(0, Math.min(navBtns.length - 1, activeIdx + direction));
        if (newIdx !== activeIdx) {
            navBtns[newIdx].click();
            this._focusedIdx = -1;
            this._guideFocusRow = 0;
            this._guideFocusSide = 'channels';
        }
    },

    // === Login: Connect to BOTH servers with one username/password ===
    async handleLogin() {
        const user = document.getElementById('loginUser').value.trim();
        const pass = document.getElementById('loginPass').value.trim();
        const errorEl = document.getElementById('loginError');
        const statusEl = document.getElementById('loginStatus');
        const btn = document.getElementById('btnConnect');

        if (!user || !pass) { errorEl.textContent = 'Enter username and password'; return; }

        errorEl.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Connecting...';

        try {
            statusEl.innerHTML = `
                <div class="status-line"><span class="status-dot connecting"></span> Marble (pradahype.com)...</div>
                <div class="status-line"><span class="status-dot connecting"></span> Premium (pinkponyclub.online)...</div>
            `;

            const results = {};
            const dots = statusEl.querySelectorAll('.status-dot');

            // Connect both in parallel
            const [marbleResult, ponyResult] = await Promise.allSettled([
                this.connectServer('marble', user, pass),
                this.connectServer('pony', user, pass)
            ]);

            // Update marble status
            if (marbleResult.status === 'fulfilled' && marbleResult.value?.success) {
                dots[0].className = 'status-dot success';
                dots[0].parentElement.innerHTML = '<span class="status-dot success"></span> Marble - Connected';
                results.marble = marbleResult.value;
            } else {
                dots[0].className = 'status-dot failed';
                const err = marbleResult.value?.error || marbleResult.reason?.message || 'Unknown error';
                dots[0].parentElement.innerHTML = `<span class="status-dot failed"></span> Marble - Failed (${err})`;
                console.error('[Login] Marble failed:', marbleResult);
            }

            // Update pony status
            if (ponyResult.status === 'fulfilled' && ponyResult.value?.success) {
                dots[1].className = 'status-dot success';
                dots[1].parentElement.innerHTML = '<span class="status-dot success"></span> Premium - Connected';
                results.pony = ponyResult.value;
            } else {
                dots[1].className = 'status-dot failed';
                const err = ponyResult.value?.error || ponyResult.reason?.message || 'Unknown error';
                dots[1].parentElement.innerHTML = `<span class="status-dot failed"></span> Premium - Failed (${err})`;
                console.error('[Login] Premium failed:', ponyResult);
            }

            btn.disabled = false;
            btn.textContent = 'Connect';

            // Need at least one successful connection
            if (results.marble || results.pony) {
                this.session = { username: user, token: pass };
                this.servers = results;
                localStorage.setItem('sv_session', JSON.stringify(this.session));
                localStorage.setItem('sv_servers', JSON.stringify(results));

                setTimeout(() => this.showHome(), 800);
            } else {
                errorEl.textContent = 'Failed to connect to both servers. Check your credentials.';
            }
        } catch(e) {
            console.error('[Login] Unexpected error:', e);
            errorEl.textContent = 'Connection error: ' + e.message;
            btn.disabled = false;
            btn.textContent = 'Connect';
        }
    },

    async revalidateSession(savedSession) {
        const statusEl = document.getElementById('loginStatus');
        statusEl.innerHTML = '<div class="status-line"><span class="status-dot connecting"></span> Reconnecting...</div>';

        try {
            const [marbleResult, ponyResult] = await Promise.allSettled([
                this.connectServer('marble', savedSession.username, savedSession.token),
                this.connectServer('pony', savedSession.username, savedSession.token)
            ]);

            const results = {};
            if (marbleResult.status === 'fulfilled' && marbleResult.value?.success) results.marble = marbleResult.value;
            if (ponyResult.status === 'fulfilled' && ponyResult.value?.success) results.pony = ponyResult.value;

            if (results.marble || results.pony) {
                this.session = savedSession;
                this.servers = results;
                localStorage.setItem('sv_session', JSON.stringify(this.session));
                localStorage.setItem('sv_servers', JSON.stringify(results));
                console.log('[Init] Session re-validated successfully');
                this.showHome();
            } else {
                console.warn('[Init] Session expired or invalid, showing login');
                localStorage.removeItem('sv_session');
                localStorage.removeItem('sv_servers');
                statusEl.innerHTML = '<div class="status-line" style="color:#ff8844">Session expired. Please log in again.</div>';
            }
        } catch(e) {
            console.error('[Init] Re-validation failed:', e);
            localStorage.removeItem('sv_session');
            localStorage.removeItem('sv_servers');
            statusEl.innerHTML = '';
        }
    },

    async connectServer(key, user, pass) {
        try {
            const baseUrl = DNS[key].url;
            const resp = await this.fetchWithTimeout(`${baseUrl}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`, 15000);
            const data = await resp.json();

            if (data.user_info && data.user_info.status === 'Active') {
                return {
                    success: true,
                    key,
                    baseUrl,
                    userInfo: data.user_info,
                    serverInfo: data.server_info
                };
            }
            return { success: false, key };
        } catch (e) {
            return { success: false, key, error: e.message };
        }
    },

    // === Navigation ===
    showHome() {
        document.getElementById('loginScreen').classList.remove('active');
        document.getElementById('mainScreen').classList.remove('active');
        document.getElementById('homeScreen').classList.add('active');
        // Stop any playing video
        const video = document.getElementById('videoPlayer');
        if (video && !video.paused) {
            video.pause();
            video.src = '';
        }
        if (this.hls) { this.hls.destroy(); this.hls = null; }
        document.getElementById('playerOverlay')?.classList.add('hidden');
        history.pushState({ screen: 'home' }, '', '#home');
    },

    openSection(page) {
        document.getElementById('homeScreen').classList.remove('active');
        document.getElementById('mainScreen').classList.add('active');
        history.pushState({ screen: page }, '', '#' + page);
        // Highlight the correct tab
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const tab = document.querySelector(`.top-nav .nav-btn[data-page="${page}"]`);
        if (tab) tab.classList.add('active');
        this.navigateTo(page);
    },

    showMain() {
        document.getElementById('loginScreen').classList.remove('active');
        document.getElementById('homeScreen').classList.remove('active');
        document.getElementById('mainScreen').classList.add('active');
        this.navigateTo('guide');
    },

    navigateTo(page) {
        this.currentPage = page;
        const sidebar = document.getElementById('categorySidebar');
        const stremioPanel = document.getElementById('stremioPanel');
        const contentArea = document.querySelector('.content-area');
        const grid = document.getElementById('contentGrid');
        const emptyState = document.getElementById('emptyState');
        const backBtn = document.getElementById('btnBack');
        const sourceToggle = document.querySelector('.source-toggle');

        sidebar.classList.remove('hidden');
        stremioPanel.classList.add('hidden');
        contentArea.style.display = 'flex';
        grid.innerHTML = '';
        grid.style.display = '';
        backBtn.classList.add('hidden');
        emptyState.classList.remove('hidden');
        sourceToggle.style.display = 'flex';

        const epgPanel = document.getElementById('epgPanel');
        epgPanel.classList.add('hidden');

        switch (page) {
            case 'live':
                this.loadCategories('live');
                break;
            case 'guide':
                contentArea.style.display = 'flex';
                epgPanel.classList.remove('hidden');
                emptyState.classList.add('hidden');
                grid.style.display = 'none';
                sourceToggle.style.display = 'none';
                this.loadCategories('live');
                this.epgDateOffset = 0;
                this.loadEpg();
                break;
            case 'vod':
                this.loadCategories('vod');
                break;
            case 'series':
                this.loadCategories('series');
                break;
            case 'stremio':
                sidebar.classList.add('hidden');
                contentArea.style.display = 'none';
                stremioPanel.classList.remove('hidden');
                sourceToggle.style.display = 'none';
                this.initStremio();
                break;
            case 'favorites':
                sidebar.classList.add('hidden');
                emptyState.classList.add('hidden');
                sourceToggle.style.display = 'none';
                this.renderFavorites();
                break;
            case 'settings':
                sidebar.classList.add('hidden');
                emptyState.classList.add('hidden');
                sourceToggle.style.display = 'none';
                this.renderSettings();
                break;
        }
    },

    goBack() {
        document.getElementById('btnBack').classList.add('hidden');
        this.navigateTo(this.currentPage);
    },

    // === Xtream API (dual server) ===
    async xtreamGet(serverKey, action, extra = '') {
        const s = this.servers[serverKey];
        if (!s || !s.success) { console.warn(`[API] Server ${serverKey} not connected`); return null; }
        const url = `${s.baseUrl}/player_api.php?username=${encodeURIComponent(this.session.username)}&password=${encodeURIComponent(this.session.token)}&action=${action}${extra}`;
        console.log(`[API] ${serverKey} -> ${action}`);
        try {
            const resp = await this.fetchWithTimeout(url, 30000);
            const data = await resp.json();
            console.log(`[API] ${serverKey} ${action}: got ${Array.isArray(data) ? data.length + ' items' : typeof data}`);
            return data;
        } catch(e) {
            console.error(`[API] ${serverKey} ${action} FAILED:`, e.message);
            return null;
        }
    },

    getActiveServers() {
        const keys = [];
        if (this.currentSource === 'all' || this.currentSource === 'marble') {
            if (this.servers.marble?.success) keys.push('marble');
        }
        if (this.currentSource === 'all' || this.currentSource === 'pony') {
            if (this.servers.pony?.success) keys.push('pony');
        }
        return keys;
    },

    async loadCategories(type) {
        const categoryList = document.getElementById('categoryList');
        categoryList.innerHTML = '<div class="ekc-loader"><img src="img/ekc-logo.png" class="ekc-spin"></div>';

        try {
            let action;
            if (type === 'live') action = 'get_live_categories';
            else if (type === 'vod') action = 'get_vod_categories';
            else action = 'get_series_categories';

            const servers = this.getActiveServers();
            console.log(`[Categories] Loading ${type}, active servers:`, servers, 'servers obj:', JSON.stringify(Object.keys(this.servers)));
            const allCats = new Map();

            const results = await Promise.allSettled(
                servers.map(key => this.xtreamGet(key, action))
            );

            results.forEach((r, i) => {
                if (r.status === 'fulfilled' && r.value) {
                    (r.value || []).forEach(cat => {
                        if (!allCats.has(cat.category_name)) {
                            allCats.set(cat.category_name, { ...cat, sources: [servers[i]] });
                        } else {
                            allCats.get(cat.category_name).sources.push(servers[i]);
                        }
                    });
                }
            });

            this.categories = [...allCats.values()].sort((a, b) => a.category_name.localeCompare(b.category_name));
            console.log(`[Categories] Found ${this.categories.length} categories from ${servers.length} servers`);
            categoryList.innerHTML = '';

            if (servers.length === 0) {
                categoryList.innerHTML = '<div style="padding:16px;color:#ff4444">No servers connected. Try logging out and back in.</div>';
                return;
            }

            const allEl = document.createElement('div');
            allEl.className = 'category-item';
            allEl.innerHTML = '<span class="material-icons">folder</span> All';
            allEl.addEventListener('click', () => this.loadStreams(type, null));
            categoryList.appendChild(allEl);

            this.categories.forEach(cat => {
                const el = document.createElement('div');
                el.className = 'category-item';
                el.innerHTML = `<span class="material-icons">folder</span> ${cat.category_name}`;
                el.addEventListener('click', () => {
                    document.querySelectorAll('.category-item').forEach(c => c.classList.remove('active'));
                    el.classList.add('active');
                    this.loadStreams(type, cat.category_id);
                });
                categoryList.appendChild(el);
            });
        } catch (e) {
            console.error('[Categories] Error:', e);
            categoryList.innerHTML = `<div style="padding:16px;color:#ff4444">Failed to load: ${e.message}</div>`;
        }
    },

    async loadStreams(type, categoryId) {
        const grid = document.getElementById('contentGrid');
        const emptyState = document.getElementById('emptyState');
        const spinner = document.getElementById('contentSpinner');

        grid.innerHTML = '';
        emptyState.classList.add('hidden');
        spinner.classList.remove('hidden');

        try {
            let action;
            if (type === 'live') action = 'get_live_streams';
            else if (type === 'vod') action = 'get_vod_streams';
            else action = 'get_series';

            const extra = categoryId ? `&category_id=${categoryId}` : '';
            const servers = this.getActiveServers();
            const allItems = [];

            const results = await Promise.allSettled(
                servers.map(key => this.xtreamGet(key, action, extra))
            );

            results.forEach((r, i) => {
                if (r.status === 'fulfilled' && r.value) {
                    (r.value || []).forEach(item => {
                        allItems.push({ ...item, _source: servers[i] });
                    });
                }
            });

            // Deduplicate by name, prefer marble
            const seen = new Map();
            allItems.forEach(item => {
                const name = (item.name || '').toLowerCase().trim();
                if (!seen.has(name)) {
                    seen.set(name, item);
                } else if (item._source === 'marble') {
                    seen.set(name, item); // Marble takes priority
                }
            });

            this.streams = [...seen.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            spinner.classList.add('hidden');

            if (type === 'live') {
                grid.className = 'content-grid list-view';
                this.streams.forEach(item => this.renderLiveCard(grid, item));
            } else {
                grid.className = 'content-grid';
                this.streams.forEach(item => this.renderPosterCard(grid, item, type));
            }
        } catch (e) {
            spinner.classList.add('hidden');
            grid.innerHTML = `<div style="padding:16px;color:#ff4444">Failed: ${e.message}</div>`;
        }
    },

    renderLiveCard(grid, item) {
        const card = document.createElement('div');
        card.className = 'stream-card live-item';
        card.dataset.source = item._source;
        const srcColor = DNS[item._source]?.color || 'marble';
        card.innerHTML = `
            <div class="live-icon">
                ${item.stream_icon ? `<img src="${item.stream_icon}" onerror="this.parentElement.innerHTML='<span class=\\'material-icons\\'>live_tv</span>'">` : '<span class="material-icons">live_tv</span>'}
            </div>
            <div class="card-info">
                <div class="card-title">${item.name || 'Unknown'}</div>
                <div class="card-meta">${item.tv_archive ? 'Catchup' : 'Live'}</div>
            </div>
            <span class="source-tag ${srcColor}">${DNS[item._source]?.name || item._source}</span>
        `;
        card.addEventListener('click', () => {
            const baseUrl = DNS[item._source].url;
            const url = `${baseUrl}/live/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${item.stream_id}.m3u8`;
            this.openPlayer(url, item.name, { id: String(item.stream_id), type: 'live', icon: item.stream_icon, source: item._source });
        });
        grid.appendChild(card);
    },

    renderPosterCard(grid, item, type) {
        const card = document.createElement('div');
        card.className = 'stream-card';
        card.dataset.source = item._source;
        const icon = item.stream_icon || item.cover || '';
        const name = item.name || 'Unknown';
        const srcColor = DNS[item._source]?.color || 'marble';
        card.innerHTML = `
            <div class="poster">
                ${icon ? `<img src="${icon}" onerror="this.parentElement.innerHTML='<span class=\\'material-icons placeholder-icon\\'>movie</span>'">` : '<span class="material-icons placeholder-icon">movie</span>'}
            </div>
            <span class="source-tag ${srcColor}">${DNS[item._source]?.name || ''}</span>
            <div class="card-info">
                <div class="card-title">${name}</div>
                <div class="card-meta">${item.rating || ''}</div>
            </div>
        `;
        card.addEventListener('click', () => {
            if (type === 'vod') {
                const ext = item.container_extension || 'mp4';
                const baseUrl = DNS[item._source].url;
                const url = `${baseUrl}/movie/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${item.stream_id}.${ext}`;
                this.openPlayer(url, name, { id: String(item.stream_id), type: 'vod', icon, source: item._source });
            } else {
                this.loadSeriesDetail(item.series_id, name, item._source);
            }
        });
        grid.appendChild(card);
    },

    async loadSeriesDetail(seriesId, seriesName, source) {
        const grid = document.getElementById('contentGrid');
        const spinner = document.getElementById('contentSpinner');
        const backBtn = document.getElementById('btnBack');

        grid.innerHTML = '';
        spinner.classList.remove('hidden');
        backBtn.classList.remove('hidden');
        // Series detail - title shown via back button context

        try {
            const data = await this.xtreamGet(source, 'get_series_info', `&series_id=${seriesId}`);
            spinner.classList.add('hidden');
            grid.className = 'content-grid list-view';

            if (data?.episodes) {
                Object.keys(data.episodes).forEach(season => {
                    const header = document.createElement('div');
                    header.style.cssText = 'padding:12px 0;font-size:16px;font-weight:600;color:#00D4FF;';
                    header.textContent = `Season ${season}`;
                    grid.appendChild(header);

                    data.episodes[season].forEach(ep => {
                        const card = document.createElement('div');
                        card.className = 'stream-card live-item';
                        card.innerHTML = `
                            <div class="live-icon"><span class="material-icons">play_circle</span></div>
                            <div class="card-info">
                                <div class="card-title">E${ep.episode_num}: ${ep.title || 'Episode ' + ep.episode_num}</div>
                                <div class="card-meta">${ep.info?.duration || ''}</div>
                            </div>
                        `;
                        card.addEventListener('click', () => {
                            const ext = ep.container_extension || 'mp4';
                            const baseUrl = DNS[source].url;
                            const url = `${baseUrl}/series/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${ep.id}.${ext}`;
                            this.openPlayer(url, `${seriesName} - S${season}E${ep.episode_num}`, { id: ep.id, type: 'series', source });
                        });
                        grid.appendChild(card);
                    });
                });
            }
        } catch (e) {
            spinner.classList.add('hidden');
            grid.innerHTML = `<div style="padding:16px;color:#ff4444">Failed: ${e.message}</div>`;
        }
    },

    filterBySource() {
        document.querySelectorAll('.stream-card').forEach(card => {
            const src = card.dataset.source;
            if (this.currentSource === 'all' || src === this.currentSource) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });
        // Reload categories for the current page
        if (['live', 'vod', 'series'].includes(this.currentPage)) {
            this.loadCategories(this.currentPage);
        }
    },

    // === Player ===
    currentPlaying: null,

    hls: null,

    openPlayer(url, title, meta) {
        const overlay = document.getElementById('playerOverlay');
        const video = document.getElementById('videoPlayer');
        const titleEl = document.getElementById('playerTitle');
        const errorEl = document.getElementById('playerError');
        const favBtn = document.getElementById('btnFavorite');
        const sourceBadge = document.getElementById('playerSource');

        // Clean up previous HLS instance
        if (this.hls) { this.hls.destroy(); this.hls = null; }

        overlay.classList.remove('hidden');
        titleEl.textContent = title;
        errorEl.classList.add('hidden');
        this.currentPlaying = { url, title, ...meta };

        if (meta?.source && DNS[meta.source]) {
            sourceBadge.textContent = DNS[meta.source].name;
            sourceBadge.className = `player-source-badge source-tag ${DNS[meta.source].color}`;
        } else {
            sourceBadge.textContent = '';
        }

        const isFav = this.favorites.some(f => f.id === meta?.id);
        favBtn.querySelector('.material-icons').textContent = isFav ? 'favorite' : 'favorite_border';
        favBtn.querySelector('.material-icons').classList.toggle('fav-active', isFav);

        this._retryCount = 0;
        this._tryPlay(url, video, errorEl, meta);

        // Auto-fullscreen on play
        video.addEventListener('playing', () => {
            try {
                if (overlay.requestFullscreen && !document.fullscreenElement) {
                    overlay.requestFullscreen().catch(() => {});
                } else if (video.webkitEnterFullscreen) {
                    video.webkitEnterFullscreen();
                }
            } catch(e) {}
        }, { once: true });

        video.onerror = () => {
            console.error('[Player] video.onerror', video.error);
            document.getElementById('playerSpinner').classList.add('hidden');
            errorEl.textContent = 'Playback error. Stream may be unavailable.';
            errorEl.classList.remove('hidden');
        };
    },

    closePlayer() {
        const video = document.getElementById('videoPlayer');
        video.pause();
        video.src = '';
        if (this.hls) { this.hls.destroy(); this.hls = null; }
        this._retryCount = 0;
        // Exit fullscreen first
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
        document.getElementById('playerOverlay').classList.add('hidden');
        this.currentPlaying = null;
        // Return to guide if that's where we came from
        if (this.currentPage === 'guide') {
            // Already on guide, just make sure it's visible
            document.getElementById('epgPanel').classList.remove('hidden');
        }
    },

    _tryPlay(url, video, errorEl, meta) {
        console.log(`[Player] Trying: ${url}`);

        if (this.hls) { this.hls.destroy(); this.hls = null; }

        const spinner = document.getElementById('playerSpinner');
        spinner.classList.remove('hidden');

        // Hide spinner when video starts playing
        const onPlaying = () => {
            spinner.classList.add('hidden');
            video.removeEventListener('playing', onPlaying);
        };
        video.addEventListener('playing', onPlaying);

        // Detect if this is a direct video file (not HLS)
        const isDirectVideo = /\.(mp4|mkv|avi|mov|webm|flv|wmv)(\?|$)/i.test(url)
            || url.includes('premiumize.me')
            || url.includes('download')
            || url.includes('dl.');

        // Detect if this is an HLS stream
        const isHLS = /\.(m3u8|m3u)(\?|$)/i.test(url) || url.includes('player_api');

        if (isDirectVideo) {
            // Direct video file — just set src, no HLS needed
            console.log('[Player] Direct video playback');
            video.src = url;
            video.play().catch(e => {
                console.error('[Player] Direct play failed:', e);
                spinner.classList.add('hidden');
                errorEl.textContent = 'Playback failed: ' + e.message;
                errorEl.classList.remove('hidden');
            });
            return;
        }

        // HLS stream handling
        const baseStreamUrl = url.replace(/\.(m3u8|ts|m3u)$/, '');
        const formats = ['.m3u8', '.ts', ''];
        const currentExt = url.match(/\.(m3u8|ts|m3u)$/)?.[0] || '.m3u8';

        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            this.hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                maxBufferLength: 30,
                maxMaxBufferLength: 60,
                xhrSetup: (xhr) => {
                    xhr.withCredentials = false;
                }
            });
            this.hls.loadSource(url);
            this.hls.attachMedia(video);
            this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log('[Player] Manifest parsed, playing');
                video.play().catch(() => {});
            });
            this.hls.on(Hls.Events.ERROR, (event, data) => {
                console.warn('[Player] HLS error:', data.type, data.details, data.fatal);
                if (data.fatal) {
                    this._retryCount++;
                    // Try next format
                    const nextFormat = formats.find(f => f !== currentExt && !url.endsWith(f));
                    if (this._retryCount <= 3 && nextFormat !== undefined) {
                        const altUrl = baseStreamUrl + nextFormat;
                        console.log(`[Player] Retry #${this._retryCount} with: ${altUrl}`);
                        this.hls.destroy();
                        this.hls = null;
                        this._tryPlay(altUrl, video, errorEl, meta);
                        return;
                    }
                    // Try other server if available
                    if (this._retryCount <= 4 && meta?.source && meta?.id) {
                        const otherKey = meta.source === 'marble' ? 'pony' : 'marble';
                        if (this.servers[otherKey]?.success) {
                            const otherUrl = `${DNS[otherKey].url}/live/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${meta.id}.m3u8`;
                            console.log(`[Player] Trying other server (${otherKey}): ${otherUrl}`);
                            this.hls.destroy();
                            this.hls = null;
                            this._tryPlay(otherUrl, video, errorEl, { ...meta, source: otherKey });
                            return;
                        }
                    }
                    spinner.classList.add('hidden');
                    errorEl.textContent = 'Stream unavailable. Try a different channel.';
                    errorEl.classList.remove('hidden');
                    this._retryCount = 0;
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.play().catch(() => {});
        } else {
            // Fallback: try direct play
            video.src = url;
            video.play().catch(() => {
                spinner.classList.add('hidden');
                errorEl.textContent = 'Unable to play this stream format.';
                errorEl.classList.remove('hidden');
            });
        }
    },

    toggleCurrentFavorite() {
        if (!this.currentPlaying) return;
        const btn = document.getElementById('btnFavorite');
        const icon = btn.querySelector('.material-icons');
        const id = this.currentPlaying.id;

        const idx = this.favorites.findIndex(f => f.id === id);
        if (idx >= 0) {
            this.favorites.splice(idx, 1);
            icon.textContent = 'favorite_border';
            icon.classList.remove('fav-active');
        } else {
            this.favorites.push({
                id, name: this.currentPlaying.title, url: this.currentPlaying.url,
                icon: this.currentPlaying.icon || null, type: this.currentPlaying.type || 'live',
                source: this.currentPlaying.source, addedAt: Date.now()
            });
            icon.textContent = 'favorite';
            icon.classList.add('fav-active');
        }
        localStorage.setItem('sv_favorites', JSON.stringify(this.favorites));
    },

    // === Favorites ===
    renderFavorites() {
        const grid = document.getElementById('contentGrid');
        grid.className = 'content-grid list-view';
        grid.innerHTML = '';

        if (this.favorites.length === 0) {
            grid.innerHTML = '<div class="empty-state"><span class="material-icons">favorite_border</span><p>No favorites yet</p></div>';
            return;
        }

        this.favorites.forEach(fav => {
            const card = document.createElement('div');
            card.className = 'stream-card live-item';
            const srcColor = fav.source && DNS[fav.source] ? DNS[fav.source].color : '';
            card.innerHTML = `
                <div class="live-icon">
                    ${fav.icon ? `<img src="${fav.icon}" onerror="this.parentElement.innerHTML='<span class=\\'material-icons\\'>star</span>'">` : '<span class="material-icons">star</span>'}
                </div>
                <div class="card-info">
                    <div class="card-title">${fav.name}</div>
                    <div class="card-meta">${fav.type}</div>
                </div>
                ${srcColor ? `<span class="source-tag ${srcColor}">${DNS[fav.source]?.name}</span>` : ''}
            `;
            card.addEventListener('click', () => {
                this.openPlayer(fav.url, fav.name, { id: fav.id, type: fav.type, icon: fav.icon, source: fav.source });
            });
            grid.appendChild(card);
        });
    },

    // === Stremio Panel ===
    _stremioTab: 'board',
    _stremioSearchQuery: '',
    _stremioSearchTimeout: null,

    initStremio() {
        // Reset to board tab on entry
        document.querySelectorAll('.stremio-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.stremio-tab[data-stab="board"]').classList.add('active');
        this.switchStremioTab('board');
    },

    switchStremioTab(tab) {
        this._stremioTab = tab;
        const searchInput = document.getElementById('stremioSearch');
        searchInput.style.display = tab === 'search' ? '' : 'none';
        if (tab === 'search') searchInput.focus();

        switch(tab) {
            case 'board': this.renderStremioBoard(); break;
            case 'discover': this.renderStremioDiscover(); break;
            case 'search': this.renderStremioSearchPage(); break;
        }
    },

    // Board: horizontal scrolling catalog rows from all installed addons
    async renderStremioBoard() {
        const content = document.getElementById('stremioContent');
        content.innerHTML = '<div class="ekc-loader"><img src="img/ekc-logo.png" class="ekc-spin"></div>';

        if (this.stremioAddons.length === 0) {
            content.innerHTML = `
                <div class="stremio-empty">
                    <span class="material-icons" style="font-size:64px;color:#8B5CF6;margin-bottom:16px">extension</span>
                    <h3 style="margin:0 0 8px">No addons installed</h3>
                    <p style="color:#8b949e">Go to the Addons tab to install Stremio addons and start browsing.</p>
                </div>
            `;
            return;
        }

        const rows = [];
        // Load first catalog from each addon in parallel
        const catalogPromises = this.stremioAddons.map(async (addon) => {
            const catalogs = addon.manifest?.catalogs || [];
            const results = [];
            for (const catalog of catalogs.slice(0, 3)) {
                try {
                    const url = `${addon.url}/catalog/${catalog.type}/${catalog.id}.json`;
                    const resp = await this.fetchWithTimeout(url, 10000);
                    const data = await resp.json();
                    if (data.metas?.length > 0) {
                        results.push({
                            title: `${addon.name} - ${catalog.name || catalog.id}`,
                            type: catalog.type,
                            metas: data.metas.slice(0, 30),
                            addon
                        });
                    }
                } catch(e) {
                    console.warn(`[Stremio] Failed to load catalog ${catalog.id} from ${addon.name}:`, e.message);
                }
            }
            return results;
        });

        const allResults = await Promise.allSettled(catalogPromises);
        allResults.forEach(r => {
            if (r.status === 'fulfilled') rows.push(...r.value);
        });

        content.innerHTML = '';
        if (rows.length === 0) {
            content.innerHTML = '<div class="stremio-empty"><p style="color:#8b949e">No catalogs available. Try adding more addons.</p></div>';
            return;
        }

        rows.forEach(row => {
            const section = document.createElement('div');
            section.className = 'stremio-catalog-row';
            section.innerHTML = `<h3 class="stremio-row-title">${row.title}</h3>`;

            const scroller = document.createElement('div');
            scroller.className = 'stremio-row-scroller';

            row.metas.forEach(meta => {
                const card = this._createStremioCard(meta, row.addon);
                scroller.appendChild(card);
            });

            section.appendChild(scroller);
            content.appendChild(section);
        });
    },

    // Discover: filterable grid of content from all addons
    async renderStremioDiscover() {
        const content = document.getElementById('stremioContent');
        content.innerHTML = '<div class="ekc-loader"><img src="img/ekc-logo.png" class="ekc-spin"></div>';

        if (this.stremioAddons.length === 0) {
            content.innerHTML = '<div class="stremio-empty"><p style="color:#8b949e">Install addons to discover content.</p></div>';
            return;
        }

        // Build type filter bar + load first addon's catalogs
        const types = new Set();
        this.stremioAddons.forEach(addon => {
            (addon.manifest?.catalogs || []).forEach(c => types.add(c.type));
        });

        const filterBar = document.createElement('div');
        filterBar.className = 'stremio-filter-bar';
        ['all', ...types].forEach(type => {
            const btn = document.createElement('button');
            btn.className = 'stremio-filter-btn' + (type === 'all' ? ' active' : '');
            btn.textContent = type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1);
            btn.addEventListener('click', () => {
                filterBar.querySelectorAll('.stremio-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._loadDiscoverGrid(type === 'all' ? null : type);
            });
            filterBar.appendChild(btn);
        });

        content.innerHTML = '';
        content.appendChild(filterBar);

        const grid = document.createElement('div');
        grid.className = 'stremio-discover-grid';
        grid.id = 'stremioDiscoverGrid';
        content.appendChild(grid);

        await this._loadDiscoverGrid(null);
    },

    async _loadDiscoverGrid(typeFilter) {
        const grid = document.getElementById('stremioDiscoverGrid');
        if (!grid) return;
        grid.innerHTML = '<div class="ekc-loader"><img src="img/ekc-logo.png" class="ekc-spin"></div>';

        const allMetas = [];
        const promises = [];

        this.stremioAddons.forEach(addon => {
            (addon.manifest?.catalogs || []).forEach(catalog => {
                if (typeFilter && catalog.type !== typeFilter) return;
                promises.push(
                    this.fetchWithTimeout(`${addon.url}/catalog/${catalog.type}/${catalog.id}.json`, 10000)
                        .then(r => r.json())
                        .then(data => {
                            (data.metas || []).forEach(m => allMetas.push({ ...m, _addon: addon }));
                        })
                        .catch(() => {})
                );
            });
        });

        await Promise.allSettled(promises);

        // Deduplicate by imdb_id or name
        const seen = new Set();
        const unique = allMetas.filter(m => {
            const key = m.imdb_id || m.id || m.name;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        grid.innerHTML = '';
        if (unique.length === 0) {
            grid.innerHTML = '<p style="color:#8b949e;padding:20px">No content found.</p>';
            return;
        }

        unique.slice(0, 100).forEach(meta => {
            const card = this._createStremioCard(meta, meta._addon);
            grid.appendChild(card);
        });
    },

    // Search page
    renderStremioSearchPage() {
        const content = document.getElementById('stremioContent');
        content.innerHTML = '';

        const grid = document.createElement('div');
        grid.className = 'stremio-discover-grid';
        grid.id = 'stremioSearchGrid';
        grid.innerHTML = '<div class="stremio-empty"><span class="material-icons" style="font-size:48px;color:#484f58">search</span><p style="color:#8b949e;margin-top:12px">Type to search across all addons</p></div>';
        content.appendChild(grid);
    },

    handleStremioSearch(query) {
        this._stremioSearchQuery = query;
        clearTimeout(this._stremioSearchTimeout);
        if (!query || query.length < 2) return;

        this._stremioSearchTimeout = setTimeout(() => this._executeStremioSearch(query), 400);
    },

    async _executeStremioSearch(query) {
        const grid = document.getElementById('stremioSearchGrid');
        if (!grid) return;
        grid.innerHTML = '<div class="ekc-loader"><img src="img/ekc-logo.png" class="ekc-spin"></div>';

        const allMetas = [];
        const promises = [];

        this.stremioAddons.forEach(addon => {
            const catalogs = addon.manifest?.catalogs || [];
            // Search catalogs that support search
            catalogs.forEach(catalog => {
                const hasSearch = catalog.extra?.some(e => e.name === 'search');
                if (hasSearch) {
                    const url = `${addon.url}/catalog/${catalog.type}/${catalog.id}/search=${encodeURIComponent(query)}.json`;
                    promises.push(
                        this.fetchWithTimeout(url, 10000)
                            .then(r => r.json())
                            .then(data => {
                                (data.metas || []).forEach(m => allMetas.push({ ...m, _addon: addon }));
                            })
                            .catch(() => {})
                    );
                }
            });
        });

        await Promise.allSettled(promises);

        // If still on the same query
        if (this._stremioSearchQuery !== query) return;

        const seen = new Set();
        const unique = allMetas.filter(m => {
            const key = m.imdb_id || m.id || m.name;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        grid.innerHTML = '';
        if (unique.length === 0) {
            grid.innerHTML = `<div class="stremio-empty"><p style="color:#8b949e">No results for "${query}"</p></div>`;
            return;
        }

        unique.forEach(meta => {
            const card = this._createStremioCard(meta, meta._addon);
            grid.appendChild(card);
        });
    },

    // Create a stremio poster card
    _createStremioCard(meta, addon) {
        const card = document.createElement('div');
        card.className = 'stremio-poster-card';
        card.innerHTML = `
            <div class="stremio-poster-img">
                ${meta.poster ? `<img src="${meta.poster}" loading="lazy" onerror="this.parentElement.innerHTML='<span class=\\'material-icons\\' style=\\'font-size:40px;color:#484f58\\'>movie</span>'">` : '<span class="material-icons" style="font-size:40px;color:#484f58">movie</span>'}
            </div>
            <div class="stremio-poster-title">${meta.name || 'Unknown'}</div>
        `;
        card.addEventListener('click', () => this.openStremioDetail(meta, addon));
        return card;
    },

    // Detail view
    async openStremioDetail(meta, addon) {
        const detail = document.getElementById('stremioDetail');
        const bg = document.getElementById('stremioDetailBg');
        const body = document.getElementById('stremioDetailBody');

        // Set background
        const bgImg = meta.background || meta.poster || '';
        bg.style.backgroundImage = bgImg ? `url(${bgImg})` : 'none';

        detail.classList.remove('hidden');

        const year = meta.releaseInfo || meta.year || '';
        const rating = meta.imdbRating ? `<span class="stremio-rating"><span class="material-icons" style="font-size:16px;color:#f5c518;vertical-align:middle">star</span> ${meta.imdbRating}</span>` : '';
        const genres = meta.genres?.join(', ') || '';
        const desc = meta.description || '';
        const type = meta.type || 'movie';

        body.innerHTML = `
            <div class="stremio-detail-header">
                <div class="stremio-detail-poster">
                    ${meta.poster ? `<img src="${meta.poster}">` : '<span class="material-icons" style="font-size:64px;color:#484f58">movie</span>'}
                </div>
                <div class="stremio-detail-info">
                    <h2 class="stremio-detail-title">${meta.name || 'Unknown'}</h2>
                    <div class="stremio-detail-meta">
                        ${year ? `<span>${year}</span>` : ''}
                        ${rating}
                        ${type ? `<span class="stremio-type-badge">${type}</span>` : ''}
                    </div>
                    ${genres ? `<div class="stremio-detail-genres">${genres}</div>` : ''}
                    ${desc ? `<p class="stremio-detail-desc">${desc}</p>` : ''}
                    <div class="stremio-play-actions" id="stremioPlayActions" style="display:none">
                        <button class="stremio-autoplay-btn" id="btnAutoPlay">
                            <span class="material-icons">play_arrow</span> Auto Play
                        </button>
                        <button class="stremio-selectstream-btn" id="btnSelectStream">
                            <span class="material-icons">list</span> Select Stream
                        </button>
                    </div>
                </div>
            </div>
            <div class="stremio-streams-section">
                <h3><span class="material-icons" style="font-size:20px;vertical-align:middle;margin-right:6px">play_circle</span>Streams</h3>
                <div id="stremioStreamList" class="stremio-stream-list">
                    <div class="ekc-loader"><img src="img/ekc-logo.png" class="ekc-spin"></div>
                </div>
            </div>
        `;

        // If series, also try to show seasons/episodes
        if (type === 'series' && meta.videos?.length > 0) {
            this._renderSeriesStreams(meta, addon);
        } else {
            this._loadStreamsForMeta(meta, addon);
        }
    },

    // Parse stream quality/seeders from Torrentio/Comet stream title/description
    _parseStreamInfo(stream) {
        const text = `${stream.name || ''} ${stream.title || ''} ${stream.description || ''}`.toLowerCase();

        // Parse resolution
        let resolution = 'unknown';
        if (text.includes('2160p') || text.includes('4k') || text.includes('uhd')) resolution = '2160p';
        else if (text.includes('1080p') || text.includes('1080')) resolution = '1080p';
        else if (text.includes('720p') || text.includes('720')) resolution = '720p';
        else if (text.includes('480p') || text.includes('480')) resolution = '480p';

        // Parse seeders - look for patterns like "👤 123" or "S:123" or "seeders: 123" or just "123" after seed-related text
        let seeders = 0;
        const seederPatterns = [
            /👤\s*(\d+)/,
            /seeders?[:\s]+(\d+)/i,
            /\bS[:\s]*(\d+)/,
            /⬆️\s*(\d+)/,
        ];
        for (const pat of seederPatterns) {
            const m = text.match(pat);
            if (m) { seeders = parseInt(m[1]); break; }
        }
        // Also check the behaviorHints or other fields
        if (!seeders && stream.behaviorHints?.seeders) seeders = stream.behaviorHints.seeders;

        // Parse size
        let size = '';
        const sizeMatch = text.match(/(\d+(?:\.\d+)?\s*(?:gb|mb|tb))/i);
        if (sizeMatch) size = sizeMatch[1].toUpperCase();

        return { resolution, seeders, size };
    },

    // Auto-select best stream: prefer 1080p with highest seeders
    _pickBestStream(streams) {
        // Filter to 1080p streams first
        const parsed = streams.map(s => ({ stream: s, ...this._parseStreamInfo(s) }));
        const hd1080 = parsed.filter(s => s.resolution === '1080p');

        // If we have 1080p streams, pick the one with most seeders
        if (hd1080.length > 0) {
            hd1080.sort((a, b) => b.seeders - a.seeders);
            return hd1080[0].stream;
        }

        // Fallback: pick best available by resolution priority then seeders
        const resPriority = { '2160p': 3, '1080p': 2, '720p': 1, '480p': 0, 'unknown': -1 };
        parsed.sort((a, b) => {
            const resDiff = (resPriority[b.resolution] || 0) - (resPriority[a.resolution] || 0);
            if (resDiff !== 0) return resDiff;
            return b.seeders - a.seeders;
        });
        return parsed[0]?.stream || null;
    },

    async _loadStreamsForMeta(meta, addon) {
        const list = document.getElementById('stremioStreamList');
        if (!list) return;

        const allStreams = [];

        // Query all addons that support this type for streams
        const promises = this.stremioAddons.map(async (a) => {
            const types = a.manifest?.types || [];
            if (!types.includes(meta.type)) return;

            try {
                const url = `${a.url}/stream/${meta.type}/${encodeURIComponent(meta.id)}.json`;
                console.log(`[Stremio] Fetching streams from ${a.name}: ${url}`);
                const resp = await this.fetchWithTimeout(url, 15000);
                const data = await resp.json();
                console.log(`[Stremio] ${a.name}: got ${(data.streams || []).length} streams`);
                (data.streams || []).forEach(s => {
                    allStreams.push({ ...s, _addonName: a.name });
                });
            } catch(e) {
                console.warn(`[Stremio] Stream fetch failed from ${a.name}:`, e.message);
            }
        });

        await Promise.allSettled(promises);

        // Store streams for auto-play
        this._currentStreams = allStreams;
        this._currentStreamMeta = meta;

        list.innerHTML = '';
        if (allStreams.length === 0) {
            list.innerHTML = '<div class="stremio-empty" style="padding:16px"><p style="color:#8b949e">No streams found for this title.</p></div>';
            return;
        }

        // Show auto-play / select buttons
        const actions = document.getElementById('stremioPlayActions');
        if (actions) {
            actions.style.display = 'flex';
            document.getElementById('btnAutoPlay').onclick = () => this._autoPlay(allStreams, meta);
            document.getElementById('btnSelectStream').onclick = () => this._showStreamList(allStreams, meta);
        }

        // Show stream list by default
        this._showStreamList(allStreams, meta);
    },

    async _autoPlay(streams, meta) {
        const list = document.getElementById('stremioStreamList');
        const best = this._pickBestStream(streams);
        if (!best) {
            if (list) list.innerHTML = '<div class="stremio-empty" style="padding:16px"><p style="color:#ff4444">No playable streams found.</p></div>';
            return;
        }

        const info = this._parseStreamInfo(best);
        if (list) {
            list.innerHTML = `<div style="padding:16px;color:#00D4FF;text-align:center">
                <div class="ekc-loader"><img src="img/ekc-logo.png" class="ekc-spin"></div>
                <div style="margin-top:12px">Auto-playing ${info.resolution} stream${info.seeders ? ` (${info.seeders} seeders)` : ''}...</div>
            </div>`;
        }

        await this._playStream(best, meta);
    },

    async _playStream(stream, meta) {
        const hasUrl = !!stream.url;
        const needsDebrid = stream.infoHash && !stream.url;

        if (hasUrl) {
            this.closeStremioDetail();
            this.openPlayer(stream.url, meta.name || 'Stream', { id: meta.id, type: meta.type, icon: meta.poster });
        } else if (needsDebrid && this.premiumizeKey) {
            await this._resolveDebrid(stream, meta);
        } else if (needsDebrid) {
            const list = document.getElementById('stremioStreamList');
            if (list) list.innerHTML = '<div style="padding:16px;color:#ff4444;text-align:center">Premiumize API key required to play torrent streams.</div>';
        }
    },

    _showStreamList(streams, meta) {
        const list = document.getElementById('stremioStreamList');
        if (!list) return;
        list.innerHTML = '';

        streams.forEach(stream => {
            const item = document.createElement('div');
            item.className = 'stremio-stream-item';

            const info = this._parseStreamInfo(stream);
            let title = stream.name || stream.title || 'Stream';
            let desc = stream.description || '';
            const badge = stream._addonName;
            const needsDebrid = stream.infoHash && !stream.url;
            const hasUrl = !!stream.url;

            // Build quality/seeder badges
            let badges = `<span class="stremio-stream-addon">${badge}</span>`;
            if (info.resolution !== 'unknown') {
                const resColor = info.resolution === '2160p' ? '#f5c518' : info.resolution === '1080p' ? '#22c55e' : info.resolution === '720p' ? '#00D4FF' : '#888';
                badges += ` <span class="stremio-stream-res" style="color:${resColor}">${info.resolution}</span>`;
            }
            if (info.seeders > 0) {
                badges += ` <span class="stremio-stream-seeders">👤 ${info.seeders}</span>`;
            }
            if (info.size) {
                badges += ` <span class="stremio-stream-size">${info.size}</span>`;
            }
            if (needsDebrid) {
                badges += ` <span class="stremio-stream-debrid" title="Premiumize">⚡ Debrid</span>`;
            }

            item.innerHTML = `
                <div class="stremio-stream-info">
                    <div class="stremio-stream-title">${title}</div>
                    ${desc ? `<div class="stremio-stream-desc">${desc}</div>` : ''}
                </div>
                <div class="stremio-stream-badges">${badges}</div>
                <span class="material-icons stremio-stream-play">play_circle</span>
            `;

            item.addEventListener('click', () => this._playStream(stream, meta));
            list.appendChild(item);
        });
    },

    _renderSeriesStreams(meta, addon) {
        const list = document.getElementById('stremioStreamList');
        if (!list) return;

        // Group videos by season
        const seasons = {};
        (meta.videos || []).forEach(v => {
            const s = v.season || 1;
            if (!seasons[s]) seasons[s] = [];
            seasons[s].push(v);
        });

        list.innerHTML = '';
        Object.keys(seasons).sort((a,b) => a - b).forEach(season => {
            const header = document.createElement('div');
            header.className = 'stremio-season-header';
            header.textContent = `Season ${season}`;
            list.appendChild(header);

            seasons[season].sort((a,b) => (a.episode||0) - (b.episode||0)).forEach(ep => {
                const item = document.createElement('div');
                item.className = 'stremio-stream-item';
                item.innerHTML = `
                    <div class="stremio-stream-info">
                        <div class="stremio-stream-title">E${ep.episode}: ${ep.title || ep.name || 'Episode ' + ep.episode}</div>
                        <div class="stremio-stream-desc">${ep.overview || ''}</div>
                    </div>
                    <span class="material-icons stremio-stream-play">play_circle</span>
                `;
                item.addEventListener('click', () => {
                    const videoId = `${meta.id}:${ep.season}:${ep.episode}`;
                    this._loadEpisodeStreams(videoId, meta, ep);
                });
                list.appendChild(item);
            });
        });
    },

    async _loadEpisodeStreams(videoId, meta, episode) {
        const list = document.getElementById('stremioStreamList');
        if (!list) return;

        list.innerHTML = '<div class="ekc-loader"><img src="img/ekc-logo.png" class="ekc-spin"></div>';

        const allStreams = [];
        const promises = this.stremioAddons.map(async (a) => {
            const types = a.manifest?.types || [];
            if (!types.includes('series')) return;
            try {
                const url = `${a.url}/stream/series/${encodeURIComponent(videoId)}.json`;
                const resp = await this.fetchWithTimeout(url, 10000);
                const data = await resp.json();
                (data.streams || []).forEach(s => allStreams.push({ ...s, _addonName: a.name }));
            } catch(e) {}
        });

        await Promise.allSettled(promises);

        list.innerHTML = '';
        const backBtn = document.createElement('button');
        backBtn.className = 'stremio-stream-back';
        backBtn.innerHTML = '<span class="material-icons">arrow_back</span> Back to episodes';
        backBtn.addEventListener('click', () => this._renderSeriesStreams(meta));
        list.appendChild(backBtn);

        const epMeta = { ...meta, name: `${meta.name} S${episode.season}E${episode.episode}` };

        if (allStreams.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'stremio-empty';
            empty.innerHTML = '<p style="color:#8b949e;padding:16px">No streams for this episode.</p>';
            list.appendChild(empty);
            return;
        }

        // Auto play / select buttons for episodes
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'stremio-play-actions';
        actionsDiv.style.display = 'flex';
        actionsDiv.innerHTML = `
            <button class="stremio-autoplay-btn" id="btnEpAutoPlay">
                <span class="material-icons">play_arrow</span> Auto Play
            </button>
            <button class="stremio-selectstream-btn" id="btnEpSelectStream">
                <span class="material-icons">list</span> Select Stream
            </button>
        `;
        list.appendChild(actionsDiv);

        const streamContainer = document.createElement('div');
        streamContainer.id = 'epStreamContainer';
        list.appendChild(streamContainer);

        const showEpStreams = () => {
            streamContainer.innerHTML = '';
            allStreams.forEach(stream => {
                const item = document.createElement('div');
                item.className = 'stremio-stream-item';
                const info = this._parseStreamInfo(stream);
                const badge = stream._addonName;
                const needsDebrid = stream.infoHash && !stream.url;

                let badges = `<span class="stremio-stream-addon">${badge}</span>`;
                if (info.resolution !== 'unknown') {
                    const resColor = info.resolution === '2160p' ? '#f5c518' : info.resolution === '1080p' ? '#22c55e' : '#00D4FF';
                    badges += ` <span class="stremio-stream-res" style="color:${resColor}">${info.resolution}</span>`;
                }
                if (info.seeders > 0) badges += ` <span class="stremio-stream-seeders">👤 ${info.seeders}</span>`;
                if (info.size) badges += ` <span class="stremio-stream-size">${info.size}</span>`;
                if (needsDebrid) badges += ` <span class="stremio-stream-debrid">⚡ Debrid</span>`;

                item.innerHTML = `
                    <div class="stremio-stream-info">
                        <div class="stremio-stream-title">${stream.name || stream.title || 'Stream'}</div>
                        <div class="stremio-stream-desc">${stream.description || ''}</div>
                    </div>
                    <div class="stremio-stream-badges">${badges}</div>
                    <span class="material-icons stremio-stream-play">play_circle</span>
                `;
                item.addEventListener('click', () => this._playStream(stream, epMeta));
                streamContainer.appendChild(item);
            });
        };

        document.getElementById('btnEpAutoPlay').addEventListener('click', () => this._autoPlay(allStreams, epMeta));
        document.getElementById('btnEpSelectStream').addEventListener('click', showEpStreams);
        showEpStreams();
    },

    async _resolveDebrid(stream, meta) {
        if (!this.premiumizeKey || !stream.infoHash) {
            console.error('[Debrid] No API key or infoHash');
            return;
        }

        const list = document.getElementById('stremioStreamList');

        try {
            console.log(`[Debrid] Resolving ${stream.infoHash} via Premiumize...`);

            // Build magnet link with trackers if available
            let magnet = `magnet:?xt=urn:btih:${stream.infoHash}`;
            if (stream.sources) {
                stream.sources.forEach(s => {
                    if (s.startsWith('tracker:')) magnet += `&tr=${encodeURIComponent(s.replace('tracker:', ''))}`;
                });
            }

            // Try cache check first (instant if cached)
            const cacheResp = await this.fetchWithTimeout(
                `https://www.premiumize.me/api/cache/check?apikey=${encodeURIComponent(this.premiumizeKey)}&items[]=${encodeURIComponent(stream.infoHash)}`,
                10000
            );
            const cacheData = await cacheResp.json();
            console.log('[Debrid] Cache check:', cacheData);

            // Direct download (works for both cached and uncached)
            const formData = new FormData();
            formData.append('src', magnet);

            const dlResp = await fetch(`https://www.premiumize.me/api/transfer/directdl?apikey=${encodeURIComponent(this.premiumizeKey)}`, {
                method: 'POST',
                body: formData
            });
            const dlData = await dlResp.json();
            console.log('[Debrid] DirectDL response:', dlData);

            if (dlData.status === 'success' && dlData.content?.length > 0) {
                // Find the largest video file
                const videoExts = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
                let videoFiles = dlData.content.filter(f => {
                    const name = (f.path || f.link || '').toLowerCase();
                    return videoExts.some(ext => name.includes(ext)) || f.mime_type?.startsWith('video/');
                });

                // If no video ext match, just sort by size
                if (videoFiles.length === 0) videoFiles = dlData.content;
                videoFiles.sort((a, b) => (b.size || 0) - (a.size || 0));

                if (videoFiles[0]?.link) {
                    console.log('[Debrid] Playing:', videoFiles[0].link);
                    this.closeStremioDetail();
                    this.openPlayer(videoFiles[0].link, meta.name || 'Stream', { id: meta.id, type: meta.type, icon: meta.poster });
                    return;
                }
            }

            // If directdl failed, show error
            const errMsg = dlData.message || 'Could not resolve stream';
            console.warn('[Debrid] Failed:', dlData);
            if (list) {
                const errDiv = document.createElement('div');
                errDiv.style.cssText = 'padding:12px;color:#ff4444;text-align:center;';
                errDiv.textContent = `Debrid error: ${errMsg}`;
                list.prepend(errDiv);
            }
        } catch(e) {
            console.error('[Debrid] Error:', e);
            if (list) {
                const errDiv = document.createElement('div');
                errDiv.style.cssText = 'padding:12px;color:#ff4444;text-align:center;';
                errDiv.textContent = `Debrid error: ${e.message}`;
                list.prepend(errDiv);
            }
        }
    },

    closeStremioDetail() {
        document.getElementById('stremioDetail').classList.add('hidden');
    },

    // === EPG / TV Guide ===
    epgCache: {}, // Cache: serverKey -> { streamId -> [programs] }

    async loadEpg() {
        const channelList = document.getElementById('epgChannelList');
        const dateLabel = document.getElementById('epgDate');

        // Calculate target date
        const now = new Date();
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + this.epgDateOffset);

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        if (this.epgDateOffset === 0) {
            dateLabel.textContent = 'Today - ' + monthNames[targetDate.getMonth()] + ' ' + targetDate.getDate();
        } else {
            dateLabel.textContent = dayNames[targetDate.getDay()] + ', ' + monthNames[targetDate.getMonth()] + ' ' + targetDate.getDate();
        }

        channelList.innerHTML = '<div class="ekc-loader"><img src="img/ekc-logo.png" class="ekc-spin"><div style="margin-top:10px;color:#8b949e;font-size:12px">Connecting...</div></div>';

        try {
            const allServers = [];
            if (this.servers.marble?.success) allServers.push('marble');
            if (this.servers.pony?.success) allServers.push('pony');

            const allChannels = [];
            const catSet = new Map();

            // Load channels, categories, and bulk XMLTV EPG in parallel
            const [channelResults, catResults] = await Promise.all([
                Promise.allSettled(allServers.map(key => this.xtreamGet(key, 'get_live_streams'))),
                Promise.allSettled(allServers.map(key => this.xtreamGet(key, 'get_live_categories')))
            ]);

            // Start loading bulk EPG in background (don't block channel loading)
            console.log('[EPG] Loading bulk EPG for servers:', allServers);
            Promise.allSettled(allServers.map(key => this.loadBulkEpg(key))).catch(() => {});

            // Collect categories
            catResults.forEach((r) => {
                if (r.status === 'fulfilled' && r.value) {
                    (r.value || []).forEach(cat => {
                        if (!catSet.has(cat.category_id)) {
                            catSet.set(cat.category_id, cat.category_name);
                        }
                    });
                }
            });

            // Build category chip bar
            const catBar = document.getElementById('epgCatBar');
            const prevCat = this.epgCategory || 'all';
            catBar.innerHTML = '';

            // "All" chip always first
            const allChip = document.createElement('button');
            allChip.className = 'epg-cat-chip' + (prevCat === 'all' ? ' active' : '');
            allChip.dataset.cat = 'all';
            allChip.textContent = 'All';
            catBar.appendChild(allChip);

            // Sort categories, put USA-related ones first
            const sortedCats = [...catSet.entries()].sort((a, b) => {
                const aUSA = a[1].toLowerCase().includes('usa');
                const bUSA = b[1].toLowerCase().includes('usa');
                if (aUSA && !bUSA) return -1;
                if (bUSA && !aUSA) return 1;
                return a[1].localeCompare(b[1]);
            });

            sortedCats.forEach(([id, name]) => {
                const chip = document.createElement('button');
                chip.className = 'epg-cat-chip' + (String(prevCat) === String(id) ? ' active' : '');
                chip.dataset.cat = id;
                chip.textContent = name;
                catBar.appendChild(chip);
            });

            this.epgCategory = prevCat;
            this.epgCategories = catSet;

            // Collect channels and enrich with category names
            channelResults.forEach((r, i) => {
                if (r.status === 'fulfilled' && r.value) {
                    console.log(`[EPG] ${allServers[i]}: loaded ${r.value.length} channels`);
                    (r.value || []).forEach(ch => {
                        const catName = catSet.get(ch.category_id) || catSet.get(String(ch.category_id)) || '';
                        allChannels.push({ ...ch, _source: allServers[i], category_name: catName });
                    });
                } else {
                    console.error(`[EPG] ${allServers[i]} channels FAILED:`, r.status, r.reason?.message || r.value);
                }
            });

            if (allChannels.length === 0 && allServers.length > 0) {
                channelList.innerHTML = `<div style="padding:16px;color:#ff8844">Servers connected but no channels loaded. Check console (F12) for errors.<br>Servers tried: ${allServers.join(', ')}</div>`;
                return;
            }

            this.epgAllChannels = allChannels;
            await this.renderEpgFiltered();

        } catch (e) {
            console.error('[EPG] loadEpg error:', e);
            channelList.innerHTML = `<div style="padding:16px;color:#ff4444">Failed to load: ${e.message}</div>`;
        }
    },

    // Helper: fetch with timeout (compatible with all browsers)
    async fetchWithTimeout(url, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const resp = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);
            return resp;
        } catch(e) {
            clearTimeout(timer);
            throw e;
        }
    },

    // Load the full XMLTV EPG data for a server and cache it by epg_channel_id
    async loadBulkEpg(serverKey) {
        if (this.epgCache[serverKey] && Object.keys(this.epgCache[serverKey]).length > 0) {
            console.log(`[EPG] Using cached EPG for ${serverKey}`);
            return;
        }

        const s = this.servers[serverKey];
        if (!s || !s.success) return;

        this.epgCache[serverKey] = {};

        // Try the Xtream get_simple_data_table for all streams
        try {
            const url = `${s.baseUrl}/player_api.php?username=${encodeURIComponent(this.session.username)}&password=${encodeURIComponent(this.session.token)}&action=get_simple_data_table&stream_id=all`;
            console.log(`[EPG] Trying bulk get_simple_data_table for ${serverKey}...`);
            const resp = await this.fetchWithTimeout(url, 15000);
            const data = await resp.json();

            if (data?.epg_listings && data.epg_listings.length > 0) {
                console.log(`[EPG] Bulk EPG for ${serverKey}: ${data.epg_listings.length} listings`);
                data.epg_listings.forEach(item => {
                    const chId = item.stream_id || item.channel_id || item.epg_id;
                    if (!chId) return;
                    if (!this.epgCache[serverKey][chId]) this.epgCache[serverKey][chId] = [];
                    const parsed = this.parseEpgItem(item);
                    if (parsed) this.epgCache[serverKey][chId].push(parsed);
                });
                return;
            }
        } catch(e) {
            console.warn(`[EPG] Bulk get_simple_data_table failed for ${serverKey}:`, e.message);
        }

        // Fallback: try XMLTV endpoint
        try {
            const xmlUrl = `${s.baseUrl}/xmltv.php?username=${encodeURIComponent(this.session.username)}&password=${encodeURIComponent(this.session.token)}`;
            console.log(`[EPG] Trying XMLTV for ${serverKey}...`);
            const resp = await this.fetchWithTimeout(xmlUrl, 30000);
            const xmlText = await resp.text();

            if (xmlText && xmlText.includes('<programme')) {
                console.log(`[EPG] XMLTV loaded for ${serverKey}, parsing...`);
                this.parseXmltvEpg(serverKey, xmlText);
                return;
            }
        } catch(e) {
            console.warn(`[EPG] XMLTV failed for ${serverKey}:`, e.message);
        }

        console.log(`[EPG] No bulk EPG available for ${serverKey}, will try per-channel`);
    },

    parseEpgItem(item) {
        let start, end;

        if (item.start_timestamp) {
            start = new Date(Number(item.start_timestamp) * 1000);
        } else if (item.start) {
            start = new Date(item.start.replace(' ', 'T'));
            if (isNaN(start)) start = new Date(item.start);
        }

        if (item.stop_timestamp) {
            end = new Date(Number(item.stop_timestamp) * 1000);
        } else if (item.end) {
            end = new Date(item.end.replace(' ', 'T'));
            if (isNaN(end)) end = new Date(item.end);
        } else if (item.stop) {
            end = new Date(item.stop.replace(' ', 'T'));
            if (isNaN(end)) end = new Date(item.stop);
        }

        if (!start || isNaN(start)) return null;
        if (!end || isNaN(end)) end = new Date(start.getTime() + 30 * 60000);

        let title = item.title || item.name || '';
        try {
            const decoded = atob(title);
            if (decoded && decoded.length > 0 && /[\x20-\x7E]/.test(decoded.charAt(0))) title = decoded;
        } catch(e) {}

        let desc = item.description || item.desc || '';
        try {
            const decoded = atob(desc);
            if (decoded && decoded.length > 0 && /[\x20-\x7E]/.test(decoded.charAt(0))) desc = decoded;
        } catch(e) {}

        return { title, start, end, description: desc };
    },

    parseXmltvEpg(serverKey, xmlText) {
        try {
            const parser = new DOMParser();
            const xml = parser.parseFromString(xmlText, 'text/xml');
            const programmes = xml.querySelectorAll('programme');
            let count = 0;

            programmes.forEach(prog => {
                const chId = prog.getAttribute('channel');
                const startStr = prog.getAttribute('start');
                const stopStr = prog.getAttribute('stop');
                const titleEl = prog.querySelector('title');

                if (!chId || !startStr) return;

                const start = this.parseXmltvDate(startStr);
                const end = stopStr ? this.parseXmltvDate(stopStr) : new Date(start.getTime() + 30 * 60000);
                const title = titleEl?.textContent || '';
                const descEl = prog.querySelector('desc');
                const desc = descEl?.textContent || '';

                if (!this.epgCache[serverKey][chId]) this.epgCache[serverKey][chId] = [];
                this.epgCache[serverKey][chId].push({ title, start, end, description: desc });
                count++;
            });

            console.log(`[EPG] XMLTV parsed ${count} programmes for ${serverKey}`);
        } catch(e) {
            console.warn('[EPG] XMLTV parse error:', e);
        }
    },

    parseXmltvDate(str) {
        // XMLTV format: 20240101120000 +0000
        const match = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
        if (match) {
            const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7] ? match[7].replace(/(\d{2})(\d{2})/, '$1:$2') : ''}`;
            return new Date(iso);
        }
        return new Date(str);
    },

    async renderEpgFiltered() {
        const channelList = document.getElementById('epgChannelList');
        const timeline = document.getElementById('epgTimeline');
        const programs = document.getElementById('epgPrograms');

        console.log('[EPG] renderEpgFiltered, allChannels:', this.epgAllChannels?.length);

        channelList.innerHTML = '<div class="ekc-loader"><img src="img/ekc-logo.png" class="ekc-spin"><div style="margin-top:10px;color:#8b949e;font-size:12px">Loading channels...</div></div>';
        programs.innerHTML = '<div class="epg-now-line" id="epgNowLine"></div>';
        timeline.innerHTML = '';

      try {
        const now = new Date();
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + this.epgDateOffset);
        const dayStart = new Date(targetDate);
        dayStart.setHours(0, 0, 0, 0);

        // Build timeline
        for (let h = 0; h < 24; h++) {
            const slot = document.createElement('div');
            slot.className = 'epg-time-slot' + (this.epgDateOffset === 0 && h === now.getHours() ? ' now' : '');
            const hour = h % 12 || 12;
            slot.textContent = `${hour}:00 ${h < 12 ? 'AM' : 'PM'}`;
            timeline.appendChild(slot);
        }
        const totalWidth = 24 * 200;
        programs.style.width = totalWidth + 'px';
        timeline.style.width = totalWidth + 'px';

        // Filter + deduplicate
        let filtered = this.epgAllChannels || [];
        if (this.epgSource !== 'all') filtered = filtered.filter(ch => ch._source === this.epgSource);
        if (this.epgCategory !== 'all') filtered = filtered.filter(ch => String(ch.category_id) === String(this.epgCategory));

        const seen = new Map();
        filtered.forEach(ch => { const k = (ch.name||'').toLowerCase().trim(); if (!seen.has(k)) seen.set(k, ch); });
        filtered = [...seen.values()];

        // Sort: USA Full HD Marble first
        const getCatName = (ch) => (ch.category_name || '').toLowerCase();
        filtered.sort((a, b) => {
            const aTop = getCatName(a).includes('usa') && getCatName(a).includes('full hd') && a._source === 'marble';
            const bTop = getCatName(b).includes('usa') && getCatName(b).includes('full hd') && b._source === 'marble';
            if (aTop && !bTop) return -1;
            if (bTop && !aTop) return 1;
            return (a.name || '').localeCompare(b.name || '');
        });
        filtered = filtered.slice(0, 200);

        this.epgChannels = filtered;
        this._epgEpgResults = {};

        if (filtered.length === 0) {
            channelList.innerHTML = '<div class="epg-empty-row">No channels found</div>';
            return;
        }

        // STEP 1: Render channels + empty program rows IMMEDIATELY (no waiting for EPG)
        channelList.innerHTML = '';
        const progFragment = document.createDocumentFragment();
        const channelFragment = document.createDocumentFragment();

        filtered.forEach((ch, idx) => {
            const srcColor = DNS[ch._source]?.color || 'marble';
            const srcName = DNS[ch._source]?.name || ch._source;

            // Channel row
            const row = document.createElement('div');
            row.className = 'epg-channel-row';
            row.dataset.idx = idx;
            row.innerHTML = `
                <span class="epg-channel-num">${ch.num || (idx + 1)}</span>
                ${ch.stream_icon ? `<img class="epg-channel-icon" src="${ch.stream_icon}" loading="lazy" onerror="this.style.background='#21262d';this.removeAttribute('src')">` : '<div class="epg-channel-icon" style="display:flex;align-items:center;justify-content:center"><span class="material-icons" style="font-size:16px;color:#484f58">tv</span></div>'}
                <div class="epg-channel-info">
                    <span class="epg-channel-name">${ch.name}</span>
                    <span class="epg-channel-now" id="epgChNow${idx}"></span>
                </div>
                <span class="epg-channel-source ${srcColor}">${srcName}</span>
            `;
            row.addEventListener('click', () => {
                this._epgSelectedIdx = idx;
                this.updateEpgNowBar();
                const baseUrl = DNS[ch._source].url;
                const url = `${baseUrl}/live/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${ch.stream_id}.m3u8`;
                this.openPlayer(url, ch.name, { id: String(ch.stream_id), type: 'live', icon: ch.stream_icon, source: ch._source });
            });
            channelFragment.appendChild(row);

            // Empty program row (will be filled by EPG later)
            const progRow = document.createElement('div');
            progRow.className = 'epg-program-row';
            progRow.id = `epgProg${idx}`;
            progRow.style.cursor = 'pointer';
            progRow.addEventListener('click', () => {
                const baseUrl = DNS[ch._source].url;
                const url = `${baseUrl}/live/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${ch.stream_id}.m3u8`;
                this.openPlayer(url, ch.name, { id: String(ch.stream_id), type: 'live', icon: ch.stream_icon, source: ch._source });
            });
            // Show "loading" placeholder
            const ph = document.createElement('div');
            ph.className = 'epg-program';
            ph.style.cssText = `left:0;width:${totalWidth}px`;
            ph.innerHTML = '<span class="prog-title" style="color:#484f58">Loading...</span>';
            progRow.appendChild(ph);
            progFragment.appendChild(progRow);
        });

        channelList.appendChild(channelFragment);
        programs.appendChild(progFragment);

        // Position now line + scroll
        if (this.epgDateOffset === 0) { this.updateNowLine(); this.scrollEpgToNow(); }
        else { document.getElementById('epgNowLine').style.display = 'none'; }

        // STEP 2: Load EPG in batches of 10 in background, fill in as they arrive
        const BATCH = 10;
        for (let i = 0; i < filtered.length; i += BATCH) {
            const batch = filtered.slice(i, i + BATCH);
            const batchIdxStart = i;

            // Fire batch in parallel
            const results = await Promise.allSettled(
                batch.map(ch => this.loadChannelEpg(ch, dayStart))
            );

            // Fill in each channel's program row as results come in
            results.forEach((r, j) => {
                const idx = batchIdxStart + j;
                const ch = filtered[idx];
                const epg = r.status === 'fulfilled' ? r.value : [];
                const progRow = document.getElementById(`epgProg${idx}`);
                if (!progRow) return;

                let nowPlaying = '';
                if (epg.length > 0 && this.epgDateOffset === 0) {
                    const np = epg.find(p => now >= new Date(p.start) && now <= new Date(p.end));
                    if (np) nowPlaying = np.title || '';
                }
                this._epgEpgResults[idx] = { channel: ch, epg, nowPlaying };

                // Update "now playing" text under channel name
                const nowEl = document.getElementById(`epgChNow${idx}`);
                if (nowEl) nowEl.textContent = nowPlaying;

                // Clear placeholder and render programs
                progRow.innerHTML = '';

                if (epg.length > 0) {
                    epg.forEach(prog => {
                        const start = new Date(prog.start);
                        const end = new Date(prog.end);
                        const startMin = (start - dayStart) / 60000;
                        const duration = (end - start) / 60000;
                        if (startMin + duration < 0 || startMin > 24 * 60) return;

                        const left = Math.max(0, startMin) * this.PX_PER_MIN;
                        const width = Math.max(30, Math.min(duration, 24*60 - Math.max(0, startMin)) * this.PX_PER_MIN - 2);
                        const isNow = now >= start && now <= end && this.epgDateOffset === 0;

                        const el = document.createElement('div');
                        el.className = 'epg-program' + (isNow ? ' live-now' : '');
                        el.style.left = left + 'px';
                        el.style.width = width + 'px';

                        const startStr = start.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
                        const endStr = end.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
                        let progressHtml = '';
                        if (isNow) {
                            progressHtml = `<div class="prog-progress" style="width:${Math.min(100,(now-start)/(end-start)*100)}%"></div>`;
                        }
                        el.innerHTML = `<span class="prog-title">${prog.title||'No Info'}</span><span class="prog-time">${startStr} - ${endStr}</span>${progressHtml}`;
                        el.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const baseUrl = DNS[ch._source].url;
                            const url = `${baseUrl}/live/${encodeURIComponent(this.session.username)}/${encodeURIComponent(this.session.token)}/${ch.stream_id}.m3u8`;
                            this.openPlayer(url, ch.name+' - '+(prog.title||''), {id:String(ch.stream_id),type:'live',icon:ch.stream_icon,source:ch._source});
                        });
                        progRow.appendChild(el);
                    });
                } else {
                    const el = document.createElement('div');
                    el.className = 'epg-program';
                    el.style.cssText = `left:0;width:${totalWidth}px`;
                    el.innerHTML = '<span class="prog-title" style="color:#484f58">No guide data</span>';
                    progRow.appendChild(el);
                }
            });
        }

        this.updateEpgNowBar();

      } catch(e) {
        console.error('[EPG] renderEpgFiltered error:', e);
        channelList.innerHTML = `<div style="padding:20px;color:#ff4444;text-align:center">Error: ${e.message}</div>`;
      }
    },

    _epgSelectedIdx: null,

    updateEpgNowBar() {
        const bar = document.getElementById('epgNowBar');
        const text = document.getElementById('epgNowBarText');
        if (!bar || !text) return;

        const idx = this._epgSelectedIdx;
        if (idx === null || !this._epgEpgResults?.[idx]) {
            // If no channel selected, show first channel or hide
            if (this.currentPlaying?.type === 'live' && this._epgEpgResults) {
                // Find channel matching current playing
                const found = Object.values(this._epgEpgResults).find(r =>
                    String(r.channel.stream_id) === String(this.currentPlaying.id)
                );
                if (found) {
                    bar.classList.remove('hidden');
                    text.innerHTML = `<span class="now-channel">${found.channel.name}</span><span class="now-program"> — ${found.nowPlaying || 'No info'}</span>`;
                    return;
                }
            }
            bar.classList.add('hidden');
            return;
        }

        const data = this._epgEpgResults[idx];
        bar.classList.remove('hidden');
        const srcBadge = `<span class="epg-channel-source ${DNS[data.channel._source]?.color}" style="margin-left:6px">${DNS[data.channel._source]?.name}</span>`;
        text.innerHTML = `<span class="now-channel">${data.channel.name}</span>${srcBadge}<span class="now-program"> — ${data.nowPlaying || 'No info'}</span>`;
    },

    async loadChannelEpg(channel, dayStart) {
        const source = channel._source;
        const sid = channel.stream_id;
        const epgId = channel.epg_channel_id || '';

        // Check bulk cache first (by stream_id, then epg_channel_id)
        const cache = this.epgCache[source];
        if (cache) {
            if (cache[sid] && cache[sid].length > 0) return cache[sid];
            if (epgId && cache[epgId] && cache[epgId].length > 0) return cache[epgId];
        }

        // Fallback: per-channel API calls
        const methods = [
            { action: 'get_simple_data_table', extra: `&stream_id=${sid}` },
            { action: 'get_short_epg', extra: `&stream_id=${sid}&limit=100` }
        ];

        for (const method of methods) {
            try {
                const data = await this.xtreamGet(source, method.action, method.extra);
                if (!data) continue;

                const listings = data.epg_listings || data.items || [];
                if (!listings || listings.length === 0) continue;

                const parsed = listings.map(item => this.parseEpgItem(item)).filter(Boolean);
                if (parsed.length > 0) {
                    console.log(`[EPG] ${method.action} for "${channel.name}": ${parsed.length} items`);
                    return parsed;
                }
            } catch (e) {
                // silent fail, try next method
            }
        }

        return [];
    },

    updateNowLine() {
        const line = document.getElementById('epgNowLine');
        if (!line) return;
        const now = new Date();
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);
        const minSinceMidnight = (now - dayStart) / 60000;
        line.style.left = (minSinceMidnight * this.PX_PER_MIN) + 'px';
        line.style.display = '';
    },

    scrollEpgToNow() {
        const scrollArea = document.getElementById('epgScrollArea');
        if (!scrollArea) return;
        const now = new Date();
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);
        const minSinceMidnight = (now - dayStart) / 60000;
        const px = minSinceMidnight * this.PX_PER_MIN;
        // Offset by channel col width (220px) and center a bit
        scrollArea.scrollLeft = Math.max(0, px - 200);
    },

    // === Search ===
    handleSearch(query) {
        if (!query) {
            document.querySelectorAll('.stream-card').forEach(c => c.style.display = '');
            return;
        }
        const q = query.toLowerCase();
        document.querySelectorAll('.stream-card').forEach(card => {
            const title = card.querySelector('.card-title')?.textContent?.toLowerCase() || '';
            card.style.display = title.includes(q) ? '' : 'none';
        });
    },

    // === Settings ===
    renderSettings() {
        const grid = document.getElementById('contentGrid');
        grid.className = 'content-grid';

        const marbleStatus = this.servers.marble?.success ? '<span style="color:#22c55e">Connected</span>' : '<span style="color:#ef4444">Not connected</span>';
        const ponyStatus = this.servers.pony?.success ? '<span style="color:#22c55e">Connected</span>' : '<span style="color:#ef4444">Not connected</span>';

        grid.innerHTML = `
            <div class="settings-container">
                <div class="settings-item">
                    <label>Username</label>
                    <div class="value">${this.session?.username || 'N/A'}</div>
                </div>
                <div class="settings-item">
                    <label>DNS 1 - Marble (pradahype.com)</label>
                    <div class="value">${marbleStatus}</div>
                </div>
                <div class="settings-item">
                    <label>DNS 2 - Premium (pinkponyclub.online)</label>
                    <div class="value">${ponyStatus}</div>
                </div>
                ${this.servers.marble?.userInfo ? `
                <div class="settings-item">
                    <label>Max Connections</label>
                    <div class="value">${this.servers.marble.userInfo.max_connections || 'N/A'}</div>
                </div>
                <div class="settings-item">
                    <label>Expires</label>
                    <div class="value">${this.servers.marble.userInfo.exp_date ? new Date(this.servers.marble.userInfo.exp_date * 1000).toLocaleDateString() : 'N/A'}</div>
                </div>
                ` : ''}
                <div class="settings-item">
                    <label>Stremio Addons</label>
                    <div class="value">${this.stremioAddons.length} installed</div>
                </div>
                <div class="settings-item">
                    <label>Premiumize</label>
                    <div class="value">${this.premiumizeKey ? 'Key configured' : 'Not configured'}</div>
                </div>
                <button class="btn-logout" onclick="App.logout()">Logout</button>
            </div>
        `;
    },

    logout() {
        localStorage.removeItem('sv_session');
        localStorage.removeItem('sv_servers');
        this.session = null;
        this.servers = {};
        document.getElementById('mainScreen').classList.remove('active');
        document.getElementById('loginScreen').classList.add('active');
        document.getElementById('loginStatus').innerHTML = '';
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
