/**
 * 아산 교통약자 이동지원센터 노동조합 — 아이폰용 웹앱(PWA)
 * 안드로이드 앱(v3.27)과 같은 Firebase(Auth·Firestore)를 그대로 쓴다.
 * 화면은 안드로이드 앱의 1·2·3페이지 구성을 아이폰 화면에 맞춰 옮겼다.
 */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const $ = (sel, root) => (root || document).querySelector(sel);
  const view = $('#view');
  const topbar = $('#topbar');
  const tabbar = $('#tabbar');

  /* ------------------------------------------------------------------ 상태 */
  const S = {
    uid: null,
    name: '',
    email: '',
    isAdmin: false,
    ready: false,
    data: {},
    media: new Map(),
    mediaPending: new Map(),
    route: '',
    homePage: 0,
    unsubMessages: null,
    unsubThreads: null,
    zoom: { scale: 1, x: 0, y: 0, startDist: 0, startScale: 1, startX: 0, startY: 0, startPX: 0, startPY: 0, items: [], index: 0 }
  };

  const RECIPIENTS = [
    { code: 'DISPATCH', label: '배차·근무표', emoji: '🚌' },
    { code: 'SAFETY', label: '차량·정비', emoji: '🛠️' },
    { code: 'WELFARE', label: '근무환경·복지', emoji: '🍊' },
    { code: 'OFFICE', label: '규정·기타', emoji: '🗂️' },
    { code: 'CHAIR', label: '기타', emoji: '🙌' }
  ];
  const STATUS = {
    RECEIVED: { label: '접수', cls: 'received' },
    IN_REVIEW: { label: '검토 중', cls: 'review' },
    ANSWERED: { label: '답변 완료', cls: 'answered' }
  };
  const NEWS_CATEGORY = {
    NOTICE: { label: '공지', cls: 'notice' },
    EVENT: { label: '행사·일정', cls: '' },
    BENEFIT: { label: '복지·혜택', cls: 'benefit' }
  };

  /* --------------------------------------------------------------- 공통 도구 */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value === 'object' && typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    if (typeof value === 'string') { const d = new Date(value); return isNaN(d) ? null : d; }
    return null;
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dayLabel(value) {
    const d = toDate(value);
    if (!d) return '';
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
  }
  function dateLabel(value) {
    const d = toDate(value);
    if (!d) return '';
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return `${sameYear ? '' : d.getFullYear() + '년 '}${d.getMonth() + 1}월 ${d.getDate()}일`;
  }
  function timeAgo(value) {
    const d = toDate(value);
    if (!d) return '';
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return '방금';
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
    return dateLabel(d);
  }
  function clockLabel(value) {
    const d = toDate(value);
    if (!d) return '';
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function toast(message, ms) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.hidden = true; }, ms || 2400);
  }
  function spinner() { return '<div class="center"><div class="spinner"></div></div>'; }
  function go(hash) { location.hash = hash; }

  /* ------------------------------------------------------------- 파이어베이스 */
  let app, auth, db;
  function initFirebase() {
    app = firebase.initializeApp(CFG.firebase);
    auth = firebase.auth();
    auth.languageCode = 'ko';
    try { auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {}); } catch (e) {}
    db = firebase.firestore();
    try { db.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch (e) {}
  }

  /* --------------------------------------------------------------- 데이터 읽기 */
  function docData(snap) {
    if (!snap || !snap.exists) return null;
    return Object.assign({ id: snap.id }, snap.data());
  }
  async function getDoc(path) {
    try {
      const snap = await db.doc(path).get({ source: 'default' });
      return docData(snap);
    } catch (error) {
      return null;
    }
  }
  async function getCollection(path) {
    try {
      const snap = await db.collection(path).get();
      return snap.docs.map((doc) => Object.assign({ id: doc.id }, doc.data()));
    } catch (error) {
      return [];
    }
  }

  async function loadAll() {
    if (!S.uid) return;
    const jobs = [
      getDoc('notices/home').then((v) => { S.data.notice = v; }),
      getDoc('app_config/schedules').then((v) => { S.data.schedules = v; }),
      getDoc('app_config/home_media').then((v) => { S.data.shortcuts = v; }),
      getDoc('app_config/member_stats').then((v) => { S.data.memberStats = v; }),
      getDoc('app_config/release').then((v) => { S.data.release = v; }),
      getCollection('news').then((v) => { S.data.news = sortNews(v); }),
      getCollection('industry_news').then((v) => { S.data.industry = sortIndustry(v); }),
      getCollection('system_notices').then((v) => { S.data.systemNotices = sortSystem(v); }),
      getCollection('union_guides').then((v) => { S.data.guides = v.sort((a, b) => (a.order || 0) - (b.order || 0)); }),
      getCollection('name_claims').then((v) => { S.data.claims = v; }),
      getCollection('presence').then((v) => { S.data.presence = v; }),
      loadSuggestions(),
      loadThreads()
    ];
    await Promise.allSettled(jobs);
  }

  function sortNews(items) {
    return items.slice().sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
  }
  function sortIndustry(items) {
    return items.slice().sort((a, b) => {
      const da = toDate(a.publishedAt) || toDate(a.createdAt) || 0;
      const dbb = toDate(b.publishedAt) || toDate(b.createdAt) || 0;
      return new Date(dbb) - new Date(da);
    });
  }
  function sortSystem(items) {
    return items.slice().sort((a, b) => new Date(toDate(b.publishedAt) || 0) - new Date(toDate(a.publishedAt) || 0));
  }

  async function loadSuggestions() {
    try {
      const query = S.isAdmin ? db.collection('suggestions') : db.collection('suggestions').where('authorUid', '==', S.uid);
      const snap = await query.get();
      S.data.suggestions = snap.docs
        .map((doc) => Object.assign({ id: doc.id }, doc.data()))
        .sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
    } catch (error) {
      S.data.suggestions = [];
      S.data.suggestionsError = error;
    }
  }

  async function loadThreads() {
    try {
      const snap = await db.collection('dm_threads').where('participants', 'array-contains', S.uid).get();
      S.data.threads = snap.docs
        .map((doc) => Object.assign({ id: doc.id }, doc.data()))
        .sort((a, b) => (toDate(b.lastMessageAt) || 0) - (toDate(a.lastMessageAt) || 0));
    } catch (error) {
      S.data.threads = [];
    }
  }

  /* ------------------------------------------------------------------ 사진 */
  function thumbSrc(item) {
    const list = (item && item.photoThumbs) || [];
    const one = list[0] || (item && item.photoThumb);
    if (one) return String(one).startsWith('data:') ? one : 'data:image/jpeg;base64,' + one;
    const url = item && item.imageUrl;
    if (url) return String(url).replace(/^http:\/\//i, 'https://');
    return '';
  }
  function thumbsSrc(item) {
    const out = [];
    const list = (item && item.photoThumbs) || [];
    list.forEach((t) => out.push(String(t).startsWith('data:') ? t : 'data:image/jpeg;base64,' + t));
    if (!out.length && item && item.photoThumb) {
      const t = String(item.photoThumb);
      out.push(t.startsWith('data:') ? t : 'data:image/jpeg;base64,' + t);
    }
    const url = item && item.imageUrl;
    if (!out.length && url) out.push(String(url).replace(/^http:\/\//i, 'https://'));
    return out;
  }
  function mediaIdsOf(item) {
    const ids = (item && item.photoMediaIds) || [];
    if (ids.length) return ids.slice();
    if (item && item.photoMediaId) return [item.photoMediaId];
    return [];
  }

  /** media 문서(사진 바이트)를 화면용 주소로. 읽은 사본은 앱이 살아 있는 동안 재사용한다. */
  async function mediaUrl(id) {
    if (!id) return '';
    if (S.media.has(id)) return S.media.get(id);
    if (S.mediaPending.has(id)) return S.mediaPending.get(id);
    const promise = (async () => {
      try {
        const snap = await db.collection('media').doc(id).get();
        const blob = snap.get('photo');
        if (!blob) return '';
        const bytes = typeof blob.toUint8Array === 'function' ? blob.toUint8Array() : blob;
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        S.media.set(id, url);
        return url;
      } catch (error) {
        return '';
      } finally {
        S.mediaPending.delete(id);
      }
    })();
    S.mediaPending.set(id, promise);
    return promise;
  }

  /* ------------------------------------------------------------------ 로그인 */
  /* ------------------------------------------------------------------ 로그인 */
  /* 광준님 지시(2026-11-26): "아이폰은 그냥 이름만 쓰고 로그인하게" — 카카오 콘솔 설정 없이
     이름 → 커스텀 토큰(중계 서버) → 같은 조합원 계정(uid)으로 입장한다. */
  const LOCK_KEY = 'union.web.lock';

  function readLock() {
    try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); } catch (error) { return null; }
  }
  function writeLock(session) {
    const payload = { uid: session.uid, name: session.name, role: session.role, at: Date.now() };
    try { localStorage.setItem(LOCK_KEY, JSON.stringify(payload)); } catch (error) {}
    idbPut('session', payload);
  }
  function clearLock() {
    try { localStorage.removeItem(LOCK_KEY); } catch (error) {}
    idbDelete('session');
  }

  function renderLogin(message) {
    topbar.classList.remove('hidden');
    tabbar.classList.add('hidden');
    view.classList.add('no-tab');
    $('#btnShare').classList.add('hidden');
    $('#btnRefresh').classList.add('hidden');
    const lock = readLock();
    view.innerHTML = `
      <section class="login">
        <div class="login-hero">
          <div class="car"><img src="icons/icon-192.png" alt=""></div>
          <div class="eyebrow">ASAN UNION BOX</div>
          <h1>조합원 앱에<br>오신 것을 환영합니다</h1>
          <p>건의 접수부터 답변 확인까지, 한 곳에서.</p>
        </div>

        <div class="card login-card">
          <h2>이름만 적으면<br>바로 입장</h2>
          <p class="lead">조합원 명단에 있는 실명을 적으면 끝나요. 비밀번호를 만들 필요가 없습니다.</p>
          <div class="field">
            <label for="loginName">이름</label>
            <input id="loginName" type="text" autocomplete="name" enterkeyhint="go"
                   placeholder="예) 홍길동" value="${esc(lock ? lock.name : '')}" ${lock ? 'readonly' : ''}>
            <p class="hint">${lock ? '이 기기에 잠긴 이름이에요 · 바꾸려면 잠금을 풀어 주세요' : '조합원 명단에 있는 실명을 적어 주세요.'}</p>
          </div>
          <div id="pinField" class="field" hidden>
            <label for="loginPin">휴대폰 뒷 4자리</label>
            <input id="loginPin" type="tel" inputmode="numeric" maxlength="4" placeholder="0000">
          </div>
          <div style="margin-top:14px">
            <button class="btn" id="btnNameLogin">입장하기</button>
          </div>
          <div class="form-error" id="loginError">${message ? esc(message) : ''}</div>

          ${lock ? `
            <div class="notice-soft" style="display:flex;align-items:center;gap:8px">
              <span style="font-size:15px">🔒</span>
              <span style="flex:1">이 기기에서는 <b>${esc(lock.name)}</b>님으로 잠겨 있어요.</span>
              <button class="btn ghost small" id="btnUnlock">잠금 풀기</button>
            </div>` : ''}

          <div class="steps">
            <div class="s"><b>1</b>이름 적기</div>
            <div class="s"><b>2</b>입장하기</div>
            <div class="s"><b>3</b>홈 화면에 추가</div>
          </div>

          <div style="text-align:center;margin-top:14px">
            <button class="hint" id="btnToggleEmail" style="color:#2E6BE0;font-weight:700">이메일 계정으로 로그인</button>
          </div>

          <div id="emailLogin" hidden>
            <div class="field">
              <label for="emailId">이메일</label>
              <input id="emailId" type="email" inputmode="email" autocomplete="username" placeholder="name@example.com">
            </div>
            <div class="field">
              <label for="emailPw">비밀번호</label>
              <input id="emailPw" type="password" autocomplete="current-password" placeholder="6자 이상">
            </div>
            <div style="margin-top:12px"><button class="btn ghost" id="btnEmailLogin">이메일로 로그인</button></div>
            <button class="hint" id="btnReset" style="margin-top:10px;color:#2E6BE0;font-weight:700">비밀번호 찾기</button>
          </div>
        </div>

        <p class="hint" style="text-align:center;margin:16px 0 0;line-height:1.7">
          모든 건의는 익명으로 접수됩니다.<br>작성자는 관리자에게도 공개되지 않아요.
        </p>
      </section>`;

    const err = (msg) => {
      const box = $('#loginError');
      box.textContent = msg;
      if (msg) box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };

    $('#btnNameLogin').addEventListener('click', async () => {
      const name = $('#loginName').value.trim();
      const pin = $('#loginPin') ? $('#loginPin').value.trim() : '';
      if (!name) { err('이름을 적어 주세요.'); return; }
      const button = $('#btnNameLogin');
      button.disabled = true; button.textContent = '들어가는 중…';
      try {
        await nameLogin(name, pin);
      } catch (error) {
        if (error && error.code === 'PIN') {
          $('#pinField').hidden = false;
          err(error.message);
        } else {
          err((error && error.message) || '입장하지 못했어요. 다시 시도해 주세요.');
        }
      } finally {
        button.disabled = false; button.textContent = '입장하기';
      }
    });
    $('#loginName').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') $('#btnNameLogin').click();
    });

    const unlock = $('#btnUnlock');
    if (unlock) {
      unlock.addEventListener('click', async () => {
        const lock = readLock();
        openSheet(`
          <div class="grabber"></div>
          <h2>이 기기의 잠금을 풀까요?</h2>
          <p>${esc(lock ? lock.name : '')}님으로 잠긴 이 기기를 풀고, 다른 이름으로 들어갈 수 있게 됩니다.</p>
          <div class="sheet-actions">
            <button class="btn ghost" data-cancel>그대로 두기</button>
            <button class="btn danger" data-confirm>잠금 풀기</button>
          </div>`, (sheet) => {
          sheet.querySelector('[data-cancel]').addEventListener('click', closeSheet);
          sheet.querySelector('[data-confirm]').addEventListener('click', async () => {
            closeSheet();
            clearLock();
            await auth.signOut().catch(() => {});
            toast('잠금을 풀었어요.');
            renderLogin();
          });
        });
      });
    }

    $('#btnToggleEmail').addEventListener('click', () => {
      const box = $('#emailLogin');
      box.hidden = !box.hidden;
    });
    $('#btnEmailLogin').addEventListener('click', async () => {
      const email = $('#emailId').value.trim();
      const password = $('#emailPw').value;
      if (!email || !password) { err('이메일과 비밀번호를 모두 적어 주세요.'); return; }
      const button = $('#btnEmailLogin');
      button.disabled = true; button.textContent = '들어가는 중…';
      try {
        await auth.signInWithEmailAndPassword(email, password);
      } catch (error) {
        err(authMessage(error));
      } finally {
        button.disabled = false; button.textContent = '이메일로 로그인';
      }
    });
    $('#btnReset').addEventListener('click', async () => {
      const email = ($('#emailId').value || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { err('비밀번호를 찾을 이메일을 먼저 적어 주세요.'); return; }
      try {
        await auth.sendPasswordResetEmail(email);
        err('');
        toast('비밀번호 재설정 메일을 보냈어요. 메일함을 확인해 주세요.', 3600);
      } catch (error) {
        err(authMessage(error));
      }
    });
  }

  /** 이름 → 중계 서버가 서명한 커스텀 토큰 → 그 조합원 계정으로 입장. */
  async function nameLogin(name, pin) {
    const url = CFG.nameAuthUrl || CFG.relayUrl;
    let data;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'nameAuth', name: name, pin: pin || '' })
      });
      const raw = await response.text();
      try { data = JSON.parse(raw); } catch (error) { throw new Error('로그인 서버 응답을 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.'); }
    } catch (error) {
      if (error && error.message && error.message.indexOf('로그인 서버 응답') >= 0) throw error;
      throw new Error('로그인 서버에 연결하지 못했어요. 인터넷을 확인하고 다시 시도해 주세요.');
    }
    if (!data || !data.ok) {
      const code = data && data.code;
      const message = code === 'NO_ACTION' || code === 'ACTION'
        ? '이름 로그인 서버가 아직 준비 중이에요. 사무국에서 조금만 기다려 주세요.'
        : (data && data.message) || '이름을 확인하지 못했어요.';
      const failure = new Error(message);
      failure.code = code;
      throw failure;
    }
    try {
      await auth.signInWithCustomToken(data.customToken);
    } catch (error) {
      throw new Error('입장을 마치지 못했어요. 다시 시도해 주세요.');
    }
  }

  function authMessage(error) {
    const code = (error && error.code) || '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') return '비밀번호가 맞지 않아요.';
    if (code === 'auth/user-not-found') return '이 이메일로 가입된 계정이 없어요.';
    if (code === 'auth/invalid-email') return '이메일 형식을 확인해 주세요.';
    if (code === 'auth/too-many-requests') return '잠시 뒤 다시 시도해 주세요.';
    if (code === 'auth/network-request-failed') return '서버에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.';
    if (code === 'auth/operation-not-allowed') return '이 로그인 방식이 아직 열려 있지 않아요. 사무국에 문의해 주세요.';
    return '로그인하지 못했어요. 다시 시도해 주세요.';
  }
  /* --------------------------------------------- 기기 잠금 저장소(localStorage + IndexedDB) */
  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('no-idb')); return; }
      const request = indexedDB.open('asan-union-web', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('session')) database.createObjectStore('session');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function idbPut(key, value) {
    try {
      const database = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = database.transaction('session', 'readwrite');
        tx.objectStore('session').put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) { /* 잠금은 localStorage 로도 남는다 */ }
  }
  async function idbGet(key) {
    try {
      const database = await idbOpen();
      return await new Promise((resolve) => {
        const tx = database.transaction('session', 'readonly');
        const request = tx.objectStore('session').get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      });
    } catch (error) { return null; }
  }
  async function idbDelete(key) {
    try {
      const database = await idbOpen();
      await new Promise((resolve) => {
        const tx = database.transaction('session', 'readwrite');
        tx.objectStore('session').delete(key);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch (error) { /* 지울 것이 없으면 그만 */ }
  }
  /** 사파리가 localStorage 를 비워도 IndexedDB 사본으로 잠금을 되살린다. */
  async function restoreLock() {
    if (readLock()) return;
    const saved = await idbGet('session');
    if (saved && saved.name) {
      try { localStorage.setItem(LOCK_KEY, JSON.stringify(saved)); } catch (error) {}
    }
  }

  /* ------------------------------------------------------------- 로그인 후 시작 */
  async function startSession(user) {
    const member = await getDoc('members/' + user.uid);
    if (!member) {
      await auth.signOut().catch(() => {});
      S.uid = null; S.ready = false;
      renderLogin('조합원 명단에서 계정을 찾지 못했어요. 사무국(041-546-1503)에 문의해 주세요.');
      return;
    }
    S.uid = user.uid;
    S.name = member.name || (user.displayName || '조합원');
    S.email = member.email || user.email || '';
    S.isAdmin = member.role === 'ADMIN' && (S.name === '최광준' || S.name === '최준호');
    S.ready = true;
    // 한 번 들어온 이름은 이 기기에 잠근다(광준님 지시 2026-11-26).
    writeLock({ uid: S.uid, name: S.name, role: S.isAdmin ? 'ADMIN' : 'MEMBER' });
    document.body.classList.remove('logged-out');
    topbar.classList.remove('hidden');
    tabbar.classList.remove('hidden');
    view.classList.remove('no-tab');
    $('#btnShare').classList.remove('hidden');
    $('#btnRefresh').classList.remove('hidden');
    $('#btnMe').textContent = S.name.slice(-1) || '조';
    await loadAll();
    logAccess('login');
    startPresence();
    if (!location.hash || location.hash === '#/' || location.hash === '#') renderRoute();
    else renderRoute();
  }

  async function logAccess(action) {
    try {
      const now = new Date();
      const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      await db.collection('access_logs').doc(`${S.uid}_${action}_${day}`).set({
        uid: S.uid, name: S.name, action: action, at: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) { /* 기록은 실패해도 앱을 막지 않는다 */ }
  }

  let presenceTimer = null;
  function startPresence() {
    const beat = () => {
      if (!S.uid) return;
      db.collection('presence').doc(S.uid).set({
        online: document.visibilityState === 'visible',
        lastSeenAt: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});
    };
    beat();
    clearInterval(presenceTimer);
    presenceTimer = setInterval(beat, 60 * 1000);
    document.addEventListener('visibilitychange', beat);
  }

  /* ------------------------------------------------------------------- 라우터 */
  function renderRoute() {
    if (!S.ready) {
      if (!auth || !auth.currentUser) return;
      return;
    }
    const hash = location.hash.replace(/^#\/?/, '');
    const [path, param] = hash.split('/');
    S.route = path || 'home';
    document.querySelectorAll('.tabbar a').forEach((link) => link.classList.remove('on'));
    $('#view').scrollTop = 0;
    window.scrollTo(0, 0);

    const tabOf = { home: 'home', news: 'home', industry: 'home', system: 'home', board: 'home', s: 'home', guides: 'home', members: 'home', chat: 'home', admin: 'home', payroll: 'payroll', write: 'write', account: 'account' };
    const tab = tabOf[S.route] || 'home';
    const link = document.querySelector(`.tabbar a[data-tab="${tab}"]`);
    if (link) link.classList.add('on');

    switch (S.route) {
      case 'home': return renderHome();
      case 'news': return param ? renderNewsDetail(param) : renderNewsList();
      case 'industry': return param ? renderIndustryDetail(param) : renderIndustryList();
      case 'system': return param ? renderSystemDetail(param) : renderSystemList();
      case 'board': return renderBoard();
      case 's': return renderSuggestion(param);
      case 'write': return renderWrite(param);
      case 'payroll': return renderPayroll();
      case 'members': return renderMembers();
      case 'chat': return renderChat(param);
      case 'guides': return renderGuides();
      case 'account': return renderAccount();
      case 'admin': return renderAdmin();
      default: return renderHome();
    }
  }

  /* --------------------------------------------------------------------- 홈 */
  function activeNotice() {
    const notice = S.data.notice;
    return notice && notice.active ? notice : null;
  }

  function renderHome() {
    const pages = S.isAdmin ? ['오늘·소식', '건의·시스템', '관리자 처리함'] : ['오늘·소식', '건의·시스템'];
    if (S.homePage >= pages.length) S.homePage = 0;
    view.innerHTML = `
      <section class="greet">
        <div class="greet-row">
          <div>
            <h1>${esc(S.name)}님,<br>안녕하세요</h1>
            <p>오늘도 안전 운행하세요 · ${dayLabel(new Date())}</p>
            <p style="margin-top:8px"><span class="pill mine" style="font-size:10.5px">🔒 이름 잠금</span> <span style="font-size:11px;color:#7C8CA6">이 기기에서는 이름을 바꿀 수 없어요</span></p>
          </div>
          <div class="weather" id="weatherChip" hidden></div>
        </div>
      </section>
      ${pages.length > 1 ? `<div class="page-tabs" id="pageTabs">${pages.map((label, index) => `<button data-page="${index}" class="${index === S.homePage ? 'on' : ''}">${label}</button>`).join('')}</div>` : ''}
      <div id="homeBody">${S.homePage === 0 ? homePageOne() : S.homePage === 1 ? homePageTwo() : homePageAdmin()}</div>
      <div class="dots" id="homeDots">${pages.map((_, index) => `<i class="${index === S.homePage ? 'on' : ''}"></i>`).join('')}</div>`;

    const tabs = $('#pageTabs');
    if (tabs) {
      tabs.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-page]');
        if (!button) return;
        S.homePage = Number(button.dataset.page);
        renderHome();
      });
    }
    bindHome();
    loadWeather();
  }

  function homePageOne() {
    const notice = activeNotice();
    const news = (S.data.news || []).slice(0, 8);
    const industry = (S.data.industry || []).slice(0, 3);
    const months = scheduleMonths();
    const shortcuts = shortcutItems();

    return `
      ${notice ? `
      <button class="notice-pill" data-go="#/system" style="margin-bottom:14px">
        <span class="bar"></span>
        <span class="tag">최신 공지</span>
        <span class="txt">${esc(notice.title || '공지')}</span>
        <span class="arrow">›</span>
      </button>` : ''}

      <div class="card card-pad">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div>
            <div style="font-size:16px;font-weight:780;letter-spacing:-.03em">배차표 · 근무표</div>
            <div style="font-size:11.5px;color:#6C7B95;margin-top:2px">${months.length ? '손가락 두 개로 벌려 크게 보기' : '이번 달 표'}</div>
          </div>
          ${months.length > 1 ? '<span style="font-size:11px;color:#7C8CA6">◀ 달 넘김 ▶</span>' : ''}
        </div>
        ${months.length ? `
          <div class="month-chips" id="monthChips">
            ${months.map((m, index) => `<button class="chip ${index === months.length - 1 ? 'on' : ''}" data-month="${esc(m.month)}">${esc(m.label || m.month)}</button>`).join('')}
          </div>
          <div class="board-grid" id="boardGrid">${boardTiles(months[months.length - 1])}</div>
        ` : '<div class="empty-note">이번 달 배차표·근무표가 아직 올라오지 않았어요</div>'}
      </div>

      <div class="sec-head">
        <span class="badge"><svg viewBox="0 0 24 24"><path d="M4 9.5V19a1 1 0 0 0 1 1h3v-6h8v6h3a1 1 0 0 0 1-1V9.5L12 3.5z"/></svg></span>
        <span class="t"><h2>우리 조합 소식</h2><p>사진으로 보는 조합 소식</p></span>
        <a class="more" href="#/news">소식 전체</a>
      </div>
      ${news.length ? `
        <div class="carousel" id="newsCarousel">
          ${news.map((item) => newsCard(item)).join('')}
        </div>` : '<div class="card card-pad empty-note">아직 올라온 소식이 없어요</div>'}

      <div class="sec-head">
        <span class="badge"><svg viewBox="0 0 24 24"><path d="M4 6h11v9H8l-4 4z"/><path d="M9 3h11v9h-2"/></svg></span>
        <span class="t"><h2>업계·정책 뉴스</h2><p>이동지원·이동권 소식</p></span>
        <a class="more" href="#/industry">전체 보기</a>
      </div>
      ${industry.length ? industry.map((item) => industryRow(item)).join('') : '<div class="card card-pad empty-note">아직 올라온 뉴스가 없어요</div>'}

      <div class="sec-head">
        <span class="badge"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.4"/><path d="M10 9l5 3-5 3z"/></svg></span>
        <span class="t"><h2>바로 시청·정책</h2><p>로그인 없이 앱에서 바로 열려요</p></span>
      </div>
      <div class="shortcuts">
        ${shortcuts.map((item) => `
          <button class="shortcut" data-shortcut="${esc(item.id)}">
            <span class="ic" style="background:${esc(item.badge || '#3B82F6')}">${shortcutGlyph(item.icon)}</span>
            <b>${esc(item.label)}</b>
          </button>`).join('')}
      </div>
      <p class="hint" style="text-align:center;margin-top:14px">아산시 교통약자이동지원센터 · 노동조합 공식 앱</p>
    `;
  }

  function homePageTwo() {
    const mine = S.data.suggestions || [];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = mine.filter((item) => { const d = toDate(item.createdAt); return d && d >= monthStart; });
    const answered = mine.filter((item) => item.status === 'ANSWERED');
    const notices = (S.data.systemNotices || []).slice(0, 5);
    const online = onlineCount();

    return `
      <div class="stat-row">
        <div class="stat"><b>${thisMonth.length}</b><small>이번 달 내 건의</small></div>
        <div class="stat"><b>${answered.length}</b><small>답변 완료</small></div>
        <div class="stat"><b>${online}</b><small>지금 접속</small></div>
      </div>

      <div class="card card-pad">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:16px;font-weight:780;letter-spacing:-.03em">익명 건의함</div>
            <div style="font-size:11.5px;color:#6C7B95;margin-top:2px">작성자는 관리자에게도 공개되지 않아요</div>
          </div>
          <a class="more" href="#/write" style="padding:8px 13px;border-radius:999px;font-size:12px;font-weight:700;color:#1B5BDF;background:rgba(255,255,255,.9);border:1px solid #fff">건의하기</a>
        </div>
        <div class="list-card" style="margin-top:8px">
          ${mine.length ? mine.slice(0, 6).map((item) => suggestionRow(item)).join('') : '<div class="empty-note">아직 남긴 건의가 없어요</div>'}
        </div>
        <a class="btn ghost small" href="#/board" style="margin-top:10px;width:100%">내 건의 전체 보기</a>
      </div>

      <div class="sec-head">
        <span class="badge"><svg viewBox="0 0 24 24"><path d="M6 4h9l3 3v13H6z"/><path d="M9 9h6M9 13h6M9 17h4"/></svg></span>
        <span class="t"><h2>시스템 공지</h2><p>앱 업데이트·점검 안내</p></span>
        <a class="more" href="#/system">전체</a>
      </div>
      <div class="card list-card">
        ${notices.length ? notices.map((item) => `
          <a class="row" href="#/system/${esc(item.id)}">
            <span class="left"><h3>${esc(item.title)}</h3><p>${esc(dateLabel(item.publishedAt))} · ${esc(item.category === 'UPDATE' ? '업데이트' : item.category === 'MAINTENANCE' ? '점검' : '안내')}</p></span>
            <span class="arrow">›</span>
          </a>`).join('') : '<div class="empty-note">아직 올라온 공지가 없어요</div>'}
      </div>

      <div class="sec-head">
        <span class="badge"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/></svg></span>
        <span class="t"><h2>조합 규정·안내</h2><p>한 번에 확인하는 조합 안내</p></span>
        <a class="more" href="#/guides">열기</a>
      </div>
    `;
  }

  function homePageAdmin() {
    const all = S.data.suggestions || [];
    const counts = { RECEIVED: 0, IN_REVIEW: 0, ANSWERED: 0 };
    all.forEach((item) => { counts[item.status] = (counts[item.status] || 0) + 1; });
    const open = all.filter((item) => item.status !== 'ANSWERED');
    return `
      <div class="stat-row">
        <div class="stat"><b>${counts.RECEIVED || 0}</b><small>접수</small></div>
        <div class="stat"><b>${counts.IN_REVIEW || 0}</b><small>검토 중</small></div>
        <div class="stat"><b>${counts.ANSWERED || 0}</b><small>답변 완료</small></div>
      </div>
      <div class="card card-pad">
        <div style="font-size:16px;font-weight:780;letter-spacing:-.03em">관리자 처리함</div>
        <p style="margin:4px 0 0;font-size:11.5px;color:#6C7B95;line-height:1.6">답변·상태 변경은 안드로이드 앱에서 하시면 됩니다. 여기서는 접수 현황과 내용을 바로 확인할 수 있어요.</p>
        <div class="list-card" style="margin-top:8px">
          ${open.length ? open.slice(0, 8).map((item) => suggestionRow(item)).join('') : '<div class="empty-note">처리할 건의가 없어요</div>'}
        </div>
        <a class="btn ghost small" href="#/admin" style="margin-top:10px;width:100%">처리함 전체 보기</a>
      </div>
      <div class="sec-head">
        <span class="badge"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg></span>
        <span class="t"><h2>관리자 페이지</h2><p>소식·공지·근무표 관리</p></span>
      </div>
      <div class="card card-pad" style="font-size:12.5px;color:#5C6C86;line-height:1.75">
        소식·사진·근무표 올리기와 수정은 <b>안드로이드 앱 &gt; 관리자 페이지</b>에서 하시면 됩니다.
        여기 아이폰 앱은 조합원이 보는 화면과 급여 계산기를 그대로 담았어요.
      </div>`;
  }

  function newsCard(item) {
    const src = thumbSrc(item);
    const cat = NEWS_CATEGORY[item.category] || NEWS_CATEGORY.NOTICE;
    return `
      <a class="news-card" href="#/news/${esc(item.id)}">
        <div class="photo">
          ${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : ''}
          <span class="badge ${cat.cls}">${esc(cat.label)}</span>
        </div>
        <div class="body">
          <h3>${esc(item.title)}</h3>
          <p>${esc(item.summary || '')}</p>
          <div class="meta"><span>${esc(item.schedule || dateLabel(item.createdAt))}</span><span class="go">자세히 보기 →</span></div>
        </div>
      </a>`;
  }

  function industryRow(item) {
    const src = thumbSrc(item);
    const date = item.publishedLabel || dateLabel(item.publishedAt || item.createdAt);
    return `
      <a class="news-row" href="#/industry/${esc(item.id)}">
        ${src ? `<span class="thumb"><img src="${esc(src)}" alt="" loading="lazy"></span>` : ''}
        <span class="txt">
          <span class="src">${esc(item.sourceName || (item.guide ? '이동지원 안내' : '업계 뉴스'))}</span>
          <h3>${esc(item.title)}</h3>
          <span class="date">${esc(date)}</span>
        </span>
      </a>`;
  }

  function suggestionRow(item) {
    const status = STATUS[item.status] || STATUS.RECEIVED;
    const recipient = RECIPIENTS.find((r) => r.code === item.recipient);
    return `
      <a class="row" href="#/s/${esc(item.id)}">
        <span class="left">
          <h3>${esc(item.title)}</h3>
          <p>${esc(recipient ? recipient.emoji + ' ' + recipient.label : '건의')} · ${esc(timeAgo(item.createdAt))}</p>
        </span>
        <span class="right"><span class="pill ${status.cls}">${status.label}</span><span class="arrow">›</span></span>
      </a>`;
  }

  function scheduleMonths() {
    const doc = S.data.schedules;
    const months = (doc && Array.isArray(doc.months)) ? doc.months : [];
    return months
      .filter((m) => m && m.month && (m.scheduleUrl || m.dispatchUrl || m.scheduleMedia || m.dispatchMedia || m.scheduleThumb || m.dispatchThumb))
      .sort((a, b) => String(a.month).localeCompare(String(b.month)));
  }

  function boardTiles(month) {
    if (!month) return '';
    const tiles = [
      { doc: 'schedule', label: '근무표', thumb: month.scheduleThumb, url: month.scheduleUrl, media: month.scheduleMedia },
      { doc: 'dispatch', label: '배차표', thumb: month.dispatchThumb, url: month.dispatchUrl, media: month.dispatchMedia }
    ];
    return tiles.map((tile) => {
      const src = tile.thumb
        ? (String(tile.thumb).startsWith('data:') ? tile.thumb : 'data:image/jpeg;base64,' + tile.thumb)
        : (tile.url ? String(tile.url).replace(/^http:\/\//i, 'https://') : '');
      return `
        <button class="board-tile" data-board="${tile.doc}" data-month="${esc(month.month)}">
          <span class="thumb">${src ? `<img src="${esc(src)}" alt="${esc(tile.label)}" loading="lazy">` : `<span class="empty">${esc(tile.label)}가<br>아직 없어요</span>`}</span>
          <span class="cap"><span><b>${esc(tile.label)}</b><small>${esc(month.label || month.month)}</small></span><span class="zoom-in">⤢</span></span>
        </button>`;
    }).join('');
  }

  function shortcutItems() {
    const doc = S.data.shortcuts;
    const items = (doc && Array.isArray(doc.items)) ? doc.items : [];
    const fallback = [
      { id: 'youtube', label: '유튜브', url: 'https://m.youtube.com', badge: '#FF2E3E', icon: 'video' },
      { id: 'naver', label: '네이버', url: 'https://m.naver.com', badge: '#03C75A', icon: 'play' },
      { id: 'kakao', label: '카카오톡', url: 'app://com.kakao.talk', badge: '#FEE500', icon: 'kakao' },
      { id: 'asan', label: '아산시', url: 'https://www.asan.go.kr', badge: '#1B64F2', icon: 'doc' }
    ];
    return (items.length ? items : fallback).slice(0, 8);
  }

  function shortcutGlyph(icon) {
    const glyphs = {
      video: '▶', music: '♪', equalizer: '≋', play: '▶', kakao: '💬', carrot: '🥕', doc: '📄', link: '↗'
    };
    return glyphs[icon] || '↗';
  }

  function onlineCount() {
    const list = S.data.presence || [];
    const now = Date.now();
    return list.filter((item) => {
      const at = toDate(item.lastSeenAt);
      return item.online === true && at && now - at.getTime() < 3 * 60 * 1000;
    }).length;
  }

  function bindHome() {
    const chips = $('#monthChips');
    if (chips) {
      chips.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-month]');
        if (!button) return;
        chips.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('on', chip === button));
        const month = scheduleMonths().find((m) => m.month === button.dataset.month);
        const grid = $('#boardGrid');
        if (grid && month) grid.innerHTML = boardTiles(month);
        if (chips.scrollWidth > chips.clientWidth) {
          button.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        }
      });
    }
    const grid = $('#boardGrid');
    if (grid) {
      grid.addEventListener('click', (event) => {
        const tile = event.target.closest('button[data-board]');
        if (!tile) return;
        openBoard(tile.dataset.month, tile.dataset.board);
      });
    }
    view.querySelectorAll('[data-shortcut]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.shortcut;
        const item = shortcutItems().find((x) => x.id === id);
        if (item) openShortcut(item);
      });
    });
  }

  function openShortcut(item) {
    let url = String(item.url || '');
    if (/^app:\/\//i.test(url)) {
      const appUrl = url;
      const map = {
        'app://com.kakao.talk': 'kakaotalk://',
        'app://com.towneers.www': 'carrotmarket://'
      };
      const scheme = map[appUrl];
      if (scheme) {
        location.href = scheme;
        setTimeout(() => {
          toast(`${item.label} 앱이 없으면 아래 주소로 열어 주세요`, 2600);
        }, 900);
        return;
      }
      toast('이 기기에서는 바로 열 수 없어요');
      return;
    }
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    window.open(url, '_blank', 'noopener');
  }

  /* 실제 날씨(Open-Meteo) — 아산 온양동 기준, 실패하면 칩을 숨긴다 */
  async function loadWeather() {
    const chip = $('#weatherChip');
    if (!chip) return;
    const cached = sessionStorage.getItem('union-weather');
    if (cached) {
      try {
        const data = JSON.parse(cached);
        if (Date.now() - data.at < 30 * 60 * 1000) {
          chip.innerHTML = `${data.icon} ${data.temp}° ${data.label}`;
          chip.hidden = false;
          return;
        }
      } catch (error) {}
    }
    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=36.78&longitude=127.01&current=temperature_2m,weather_code&timezone=Asia%2FSeoul';
      const response = await fetch(url);
      if (!response.ok) return;
      const json = await response.json();
      const temp = Math.round(json.current.temperature_2m);
      const code = json.current.weather_code;
      const label = weatherLabel(code);
      const icon = weatherIcon(code);
      chip.innerHTML = `${icon} ${temp}° ${label}`;
      chip.hidden = false;
      sessionStorage.setItem('union-weather', JSON.stringify({ at: Date.now(), temp: temp, label: label, icon: icon }));
    } catch (error) { /* 날씨는 없어도 된다 */ }
  }
  function weatherLabel(code) {
    if (code === 0) return '맑음';
    if (code <= 3) return '구름 조금';
    if (code <= 48) return '흐림';
    if (code <= 67) return '비';
    if (code <= 77) return '눈';
    if (code <= 82) return '소나기';
    return '흐림';
  }
  function weatherIcon(code) {
    if (code === 0) return '☀️';
    if (code <= 3) return '🌤️';
    if (code <= 48) return '☁️';
    if (code <= 67) return '🌧️';
    if (code <= 77) return '❄️';
    return '🌦️';
  }

  /* -------------------------------------------------------------- 소식 목록·상세 */
  function renderNewsList() {
    const items = S.data.news || [];
    view.innerHTML = `
      <div class="sec-head" style="margin-top:6px">
        <span class="badge"><svg viewBox="0 0 24 24"><path d="M4 9.5V19a1 1 0 0 0 1 1h3v-6h8v6h3a1 1 0 0 0 1-1V9.5L12 3.5z"/></svg></span>
        <span class="t"><h2>우리 조합 소식</h2><p>사진과 함께 보는 조합 소식</p></span>
      </div>
      ${items.length ? items.map((item) => `
        <a class="news-row" href="#/news/${esc(item.id)}" style="margin-bottom:10px">
          ${thumbSrc(item) ? `<span class="thumb" style="width:92px;height:78px"><img src="${esc(thumbSrc(item))}" alt="" loading="lazy"></span>` : ''}
          <span class="txt">
            <span class="src">${esc((NEWS_CATEGORY[item.category] || NEWS_CATEGORY.NOTICE).label)}</span>
            <h3>${esc(item.title)}</h3>
            <span class="date">${esc(item.schedule || dateLabel(item.createdAt))}</span>
          </span>
        </a>`).join('') : '<div class="card card-pad empty-note">아직 올라온 소식이 없어요</div>'}
      <div style="height:8px"></div>`;
  }

  async function renderNewsDetail(id) {
    const item = (S.data.news || []).find((x) => x.id === id);
    if (!item) { view.innerHTML = '<div class="center">소식을 찾지 못했어요</div>'; return; }
    const gallery = thumbsSrc(item);
    const mediaIds = mediaIdsOf(item);
    view.innerHTML = `
      <article class="card article" style="margin-top:6px">
        ${gallery.length ? `<div class="hero"><img id="articlePhoto" src="${esc(gallery[0])}" alt=""></div>` : ''}
        <div class="inner">
          <div class="meta">
            <span class="pill ${(NEWS_CATEGORY[item.category] || NEWS_CATEGORY.NOTICE).cls}">${esc((NEWS_CATEGORY[item.category] || NEWS_CATEGORY.NOTICE).label)}</span>
            ${item.schedule ? `<span>${esc(item.schedule)}</span>` : ''}
            ${item.place ? `<span>· ${esc(item.place)}</span>` : ''}
          </div>
          <h1>${esc(item.title)}</h1>
          ${item.summary ? `<p style="margin:0;font-size:13.5px;color:#54658A;line-height:1.7">${esc(item.summary)}</p>` : ''}
          <div class="body">${esc(item.body || item.summary)}</div>
          ${mediaIds.length ? '<div id="articleExtra"></div>' : ''}
          <p class="hint" style="margin-top:16px">${esc(item.authorName || '노동조합')} · ${esc(dateLabel(item.createdAt))}</p>
        </div>
      </article>`;
    if (mediaIds.length) {
      const url = await mediaUrl(mediaIds[0]);
      if (url) {
        const photo = $('#articlePhoto');
        if (photo) photo.src = url;
        const extra = $('#articleExtra');
        if (extra && mediaIds.length > 1) {
          const rest = await Promise.all(mediaIds.slice(1).map((mid) => mediaUrl(mid)));
          extra.innerHTML = rest.filter(Boolean).map((src) => `<div class="hero" style="margin:14px -17px 0"><img src="${esc(src)}" alt=""></div>`).join('');
        }
      }
    }
  }

  function renderIndustryList() {
    const items = S.data.industry || [];
    view.innerHTML = `
      <div class="sec-head" style="margin-top:6px">
        <span class="badge"><svg viewBox="0 0 24 24"><path d="M4 6h11v9H8l-4 4z"/><path d="M9 3h11v9h-2"/></svg></span>
        <span class="t"><h2>업계·정책 뉴스</h2><p>이동지원·이동권·정책 브리핑</p></span>
      </div>
      ${items.length ? items.map((item) => industryRow(item)).join('') : '<div class="card card-pad empty-note">아직 올라온 뉴스가 없어요</div>'}
      <div style="height:8px"></div>`;
  }

  async function renderIndustryDetail(id) {
    const item = (S.data.industry || []).find((x) => x.id === id);
    if (!item) { view.innerHTML = '<div class="center">뉴스를 찾지 못했어요</div>'; return; }
    const gallery = thumbsSrc(item);
    const mediaIds = mediaIdsOf(item);
    view.innerHTML = `
      <article class="card article" style="margin-top:6px">
        ${gallery.length ? `<div class="hero"><img id="articlePhoto" src="${esc(gallery[0])}" alt=""></div>` : ''}
        <div class="inner">
          <div class="meta"><span class="src" style="font-weight:750;color:#2E6BE0">${esc(item.sourceName || (item.guide ? '이동지원 안내' : '업계 뉴스'))}</span>${item.publishedLabel ? `<span>· ${esc(item.publishedLabel)}</span>` : ''}</div>
          <h1>${esc(item.title)}</h1>
          ${item.summary ? `<p style="margin:0;font-size:13.5px;color:#54658A;line-height:1.7">${esc(item.summary)}</p>` : ''}
          <div class="body">${esc(item.body || item.summary)}</div>
          ${item.articleUrl ? `<a class="link" href="${esc(String(item.articleUrl).replace(/^http:\/\//i, 'https://'))}" target="_blank" rel="noopener">원문 기사 보기 ↗</a>` : ''}
        </div>
      </article>`;
    if (mediaIds.length) {
      const url = await mediaUrl(mediaIds[0]);
      const photo = $('#articlePhoto');
      if (url && photo) photo.src = url;
    }
  }

  /* ------------------------------------------------------------- 시스템 공지 */
  function renderSystemList() {
    const items = S.data.systemNotices || [];
    view.innerHTML = `
      <div class="sec-head" style="margin-top:6px">
        <span class="badge"><svg viewBox="0 0 24 24"><path d="M6 4h9l3 3v13H6z"/><path d="M9 9h6M9 13h6M9 17h4"/></svg></span>
        <span class="t"><h2>시스템 공지</h2><p>앱 업데이트·점검 안내</p></span>
      </div>
      <div class="card list-card">
        ${items.length ? items.map((item) => `
          <a class="row" href="#/system/${esc(item.id)}">
            <span class="left"><h3>${esc(item.title)}</h3><p>${esc(dateLabel(item.publishedAt))} · v${esc(item.versionName || '')}</p></span>
            <span class="arrow">›</span>
          </a>`).join('') : '<div class="empty-note">아직 올라온 공지가 없어요</div>'}
      </div>`;
  }

  function renderSystemDetail(id) {
    const item = (S.data.systemNotices || []).find((x) => x.id === id);
    if (!item) { view.innerHTML = '<div class="center">공지를 찾지 못했어요</div>'; return; }
    view.innerHTML = `
      <article class="card article" style="margin-top:6px">
        <div class="inner">
          <div class="meta"><span class="pill received">${esc(item.category === 'UPDATE' ? '업데이트' : item.category === 'MAINTENANCE' ? '점검' : '안내')}</span><span>${esc(dateLabel(item.publishedAt))}</span></div>
          <h1>${esc(item.title)}</h1>
          ${item.summary ? `<p style="margin:0;font-size:13.5px;color:#54658A;line-height:1.7">${esc(item.summary)}</p>` : ''}
          <div class="body">${esc(item.body || item.summary)}</div>
          ${item.versionName ? `<p class="hint" style="margin-top:14px">앱 버전 v${esc(item.versionName)}</p>` : ''}
        </div>
      </article>
      <div class="card card-pad" style="margin-top:12px;font-size:12.5px;color:#5C6C86;line-height:1.7">
        안드로이드 앱은 <a href="${esc(CFG.androiddownloadUrl || '#')}" target="_blank" rel="noopener" style="color:#1B5BDF;font-weight:700">다운로드 페이지</a>에서 받으실 수 있어요.
      </div>`;
  }

  /* --------------------------------------------------------------- 건의함 */
  function renderBoard() {
    const items = S.data.suggestions || [];
    const counts = { RECEIVED: 0, IN_REVIEW: 0, ANSWERED: 0 };
    items.forEach((item) => { counts[item.status] = (counts[item.status] || 0) + 1; });
    view.innerHTML = `
      <div class="sec-head" style="margin-top:6px">
        <span class="badge"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg></span>
        <span class="t"><h2>${S.isAdmin ? '처리함' : '내 건의'}</h2><p>${S.isAdmin ? '조합원이 남긴 모든 건의' : '내가 남긴 건의와 답변'}</p></span>
        <a class="more" href="#/write">건의하기</a>
      </div>
      <div class="stat-row">
        <div class="stat"><b>${counts.RECEIVED || 0}</b><small>접수</small></div>
        <div class="stat"><b>${counts.IN_REVIEW || 0}</b><small>검토 중</small></div>
        <div class="stat"><b>${counts.ANSWERED || 0}</b><small>답변 완료</small></div>
      </div>
      <div class="card list-card">
        ${items.length ? items.map((item) => suggestionRow(item)).join('') : '<div class="empty-note">아직 남긴 건의가 없어요</div>'}
      </div>`;
  }

  function renderWrite() {
    view.innerHTML = `
      <div class="sec-head" style="margin-top:6px">
        <span class="badge"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z"/></svg></span>
        <span class="t"><h2>건의 남기기</h2><p>보내신 건의는 노조 회의 안건으로 검토됩니다</p></span>
      </div>
      <div class="card card-pad">
        <div class="field">
          <label>이야기 주제</label>
          <div id="topics" style="display:flex;flex-wrap:wrap;gap:7px">
            ${RECIPIENTS.filter((r) => r.code !== 'CHAIR').map((r) => `<button class="chip" data-topic="${r.code}">${r.emoji} ${r.label}</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <label for="writeTitle">한 줄 요약</label>
          <input id="writeTitle" maxlength="60" placeholder="개선이 필요한 점을 한 줄로">
          <p class="hint"><span id="titleCount">0</span> / 60자</p>
        </div>
        <div class="field">
          <label for="writeBody">자세한 내용</label>
          <textarea id="writeBody" maxlength="1500" placeholder="상황과 원하는 조치를 적어 주세요"></textarea>
          <p class="hint"><span id="bodyCount">0</span> / 1500자</p>
        </div>
        <div class="notice-soft">
          작성자 이름과 호차는 <b>어디에도 저장되지 않아요.</b> 목록에는 「익명 조합원」으로만 보이고, 내가 쓴 글은 이 계정으로 로그인하면 언제든 다시 열 수 있습니다.
        </div>
        <div class="form-error" id="writeError"></div>
        <div style="margin-top:14px"><button class="btn" id="btnSubmit">건의 등록하기</button></div>
      </div>`;

    let topic = '';
    $('#topics').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-topic]');
      if (!button) return;
      topic = button.dataset.topic;
      $('#topics').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === button));
    });
    $('#writeTitle').addEventListener('input', (event) => { $('#titleCount').textContent = event.target.value.length; });
    $('#writeBody').addEventListener('input', (event) => { $('#bodyCount').textContent = event.target.value.length; });

    $('#btnSubmit').addEventListener('click', async () => {
      const title = $('#writeTitle').value.trim();
      const body = $('#writeBody').value.trim();
      const error = $('#writeError');
      error.textContent = '';
      if (!topic) { error.textContent = '이야기 주제를 골라 주세요.'; return; }
      if (!title) { error.textContent = '한 줄 요약을 적어 주세요.'; return; }
      if (!body) { error.textContent = '자세한 내용을 적어 주세요.'; return; }
      const button = $('#btnSubmit');
      button.disabled = true; button.textContent = '등록하는 중…';
      try {
        await createSuggestion(topic, title, body);
        toast('건의를 접수했어요.');
        go('#/board');
      } catch (error2) {
        console.error('건의 등록 실패', error2);
        $('#writeError').textContent = '등록하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
      } finally {
        button.disabled = false; button.textContent = '건의 등록하기';
      }
    });
  }

  async function createSuggestion(topic, title, body) {
    const ref = db.collection('suggestions').doc();
    const now = firebase.firestore.FieldValue.serverTimestamp();
    await ref.set({
      authorUid: S.uid,
      authorName: '',
      authorVehicle: -1,
      anonymous: true,
      recipient: topic,
      title: title,
      status: 'RECEIVED',
      adminAnswer: null,
      replyBy: '',
      createdAt: now,
      updatedAt: now,
      revision: 1,
      demo: false,
      // history 배열 안에는 serverTimestamp() 를 넣을 수 없다(Firestore 제한) — 그 자리 시각으로 남긴다.
      history: [{ action: 'CREATED', actorName: '익명 조합원', at: firebase.firestore.Timestamp.now() }]
    });
    await ref.collection('private').doc('content').set({
      body: body,
      authorUid: S.uid,
      revision: 1,
      updatedAt: now
    });
    await loadSuggestions();
  }

  async function renderSuggestion(id) {
    if (!id) { go('#/board'); return; }
    view.innerHTML = spinner();
    let head;
    try {
      const snap = await db.collection('suggestions').doc(id).get();
      if (!snap.exists) throw new Error('not found');
      head = Object.assign({ id: snap.id }, snap.data());
    } catch (error) {
      view.innerHTML = '<div class="center">건의를 찾을 수 없어요</div>';
      return;
    }
    let content = null;
    try {
      const snap = await db.collection('suggestions').doc(id).collection('private').doc('content').get();
      content = snap.exists ? snap.data() : null;
    } catch (error) {
      content = null;
    }
    const status = STATUS[head.status] || STATUS.RECEIVED;
    const recipient = RECIPIENTS.find((r) => r.code === head.recipient);
    const mine = head.authorUid === S.uid;

    view.innerHTML = `
      <div class="card card-pad" style="margin-top:6px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="pill ${status.cls}">${status.label}</span>
          <span class="pill mine">${esc(recipient ? recipient.emoji + ' ' + recipient.label : '건의')}</span>
          ${mine ? '<span class="pill mine">내 글</span>' : ''}
        </div>
        <h1 style="margin:10px 0 6px;font-size:20px;line-height:1.36;letter-spacing:-.04em;font-weight:800">${esc(head.title)}</h1>
        <p class="hint">익명 조합원 · ${esc(dateLabel(head.createdAt))}</p>
        <div class="body" style="margin-top:12px;font-size:14.5px;line-height:1.85;color:#22304A;white-space:pre-wrap">${content ? esc(content.body) : '<span style="color:#8994A8">내용은 작성자 본인과 관리자만 볼 수 있어요.</span>'}</div>

        ${head.adminAnswer ? `
          <div class="answer">
            <div class="who">사무국 답변 · ${esc(head.replyBy || '노동조합')}</div>
            <div class="what">${esc(head.adminAnswer)}</div>
          </div>` : `
          <div class="answer" style="background:rgba(255,255,255,.72)">
            <div class="who" style="color:#7C8CA6">답변 준비 중</div>
            <div class="what" style="color:#5C6C86">담당 관리자가 확인하면 여기에 답변이 도착해요.</div>
          </div>`}

        ${Array.isArray(head.history) && head.history.length ? `
          <div class="history">
            ${head.history.slice().reverse().map((entry) => `<div>· ${esc(historyLabel(entry.action))} · ${esc(entry.actorName || '익명 조합원')} · ${esc(dateLabel(entry.at))}</div>`).join('')}
          </div>` : ''}
      </div>
      ${mine && head.status !== 'ANSWERED' ? '<div style="margin-top:12px"><button class="btn danger" id="btnDelete">건의 삭제</button></div>' : ''}
      <div style="height:10px"></div>`;

    const del = $('#btnDelete');
    if (del) {
      let armed = false;
      del.addEventListener('click', async () => {
        if (!armed) { armed = true; del.textContent = '한 번 더 누르면 삭제됩니다'; setTimeout(() => { armed = false; del.textContent = '건의 삭제'; }, 3000); return; }
        del.disabled = true;
        try {
          await db.collection('suggestions').doc(id).collection('private').doc('content').delete().catch(() => {});
          await db.collection('suggestions').doc(id).delete();
          await loadSuggestions();
          toast('건의를 삭제했어요.');
          go('#/board');
        } catch (error) {
          toast('삭제하지 못했어요.');
          del.disabled = false;
        }
      });
    }
  }

  function historyLabel(action) {
    return ({ CREATED: '건의 접수', CONTENT_UPDATED: '본문 수정', STATUS_CHANGED: '처리 상태 변경', ANSWER_UPDATED: '답변 등록' })[action] || action;
  }

  /* --------------------------------------------------------------- 관리자 처리함 */
  function renderAdmin() {
    const all = S.data.suggestions || [];
    view.innerHTML = `
      <div class="sec-head" style="margin-top:6px">
        <span class="badge"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg></span>
        <span class="t"><h2>관리자 처리함</h2><p>${esc(S.name)} · 전체 ${all.length}건</p></span>
      </div>
      <div class="card list-card">
        ${all.length ? all.map((item) => suggestionRow(item)).join('') : '<div class="empty-note">접수된 건의가 없어요</div>'}
      </div>
      <div class="card card-pad" style="margin-top:12px;font-size:12px;color:#5C6C86;line-height:1.75">
        답변 작성·상태 변경·PDF 인쇄는 <b>안드로이드 앱</b>의 관리자 처리함에서 하실 수 있어요.
      </div>`;
  }

  /* --------------------------------------------------------------- 급여 계산기 */
  function renderPayroll() {
    view.innerHTML = `
      <div class="sec-head" style="margin-top:6px">
        <span class="badge"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2"/><path d="M8.4 9.2h7.2M8.4 12h7.2M12 12v5.2m-2.2 0h4.4"/></svg></span>
        <span class="t"><h2>급여 계산기</h2><p>2026년 확정 기준 · 안드로이드 앱과 같은 계산기</p></span>
      </div>
      <div class="payroll-wrap">
        <iframe id="payrollFrame" src="payroll_calculator_2026.html" title="2026 급여 계산기" loading="lazy"></iframe>
      </div>
      <div class="payroll-note">
        <span>인쇄·PDF 저장이 안 되면 <a href="payroll_calculator_2026.html" target="_blank" rel="noopener" style="color:#12489A;font-weight:700">계산기를 새 창으로 열기</a>를 눌러 주세요.</span>
      </div>`;
  }

  /* ------------------------------------------------------------------ 조합원 명단 */
  function renderMembers() {
    const claims = (S.data.claims || [])
      .filter((item) => item.uid && item.name && item.uid !== S.uid)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
    view.innerHTML = `
      <div class="sec-head" style="margin-top:6px">
        <span class="badge"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.5-3.4 2.9-5.2 5.5-5.2s5 1.8 5.5 5.2"/><path d="M16 8.2a3 3 0 0 1 0 5.6M17.5 19c-.2-1.6-.7-2.9-1.5-3.9"/></svg></span>
        <span class="t"><h2>조합원 명단</h2><p>${claims.length + 1}명 · 눌러서 1:1 톡</p></span>
      </div>
      <div class="card list-card">
        <div class="row"><span class="left"><h3>${esc(S.name)} <span class="pill mine">나</span></h3><p>${esc(S.email || '')}</p></span></div>
        ${claims.map((item) => `
          <button class="row" data-chat="${esc(item.uid)}" data-name="${esc(item.name)}">
            <span class="left"><h3>${esc(item.name)}</h3><p>1:1 톡 보내기</p></span>
            <span class="right"><span class="arrow">›</span></span>
          </button>`).join('')}
      </div>`;
    view.querySelectorAll('[data-chat]').forEach((button) => {
      button.addEventListener('click', () => openThreadWith(button.dataset.chat, button.dataset.name));
    });
  }

  /* -------------------------------------------------------------------- 1:1 톡 */
  function threadTitle(thread) {
    const names = thread.participantNames || {};
    const otherUid = (thread.participants || []).find((uid) => uid !== S.uid);
    return names[otherUid] || '조합원';
  }
  function isUnread(thread) {
    const reads = thread.reads || {};
    const myRead = toDate(reads[S.uid]);
    const last = toDate(thread.lastMessageAt);
    if (!thread.lastMessage || !last) return false;
    if (thread.lastSenderUid === S.uid) return false;
    if (!myRead) return true;
    return last.getTime() > myRead.getTime() + 1000;
  }

  function renderChat(threadId) {
    if (threadId) return renderChatRoom(threadId);
    const threads = S.data.threads || [];
    view.innerHTML = `
      <div class="sec-head" style="margin-top:6px">
        <span class="badge"><svg viewBox="0 0 24 24"><path d="M4 6h11v9H8l-4 4z"/><path d="M9 3h11v9h-2"/></svg></span>
        <span class="t"><h2>1:1 톡</h2><p>조합원끼리 나누는 대화</p></span>
        <a class="more" href="#/members">명단</a>
      </div>
      <div class="card list-card">
        ${threads.length ? threads.map((thread) => `
          <a class="row" href="#/chat/${esc(thread.id)}">
            <span class="left">
              <h3>${esc(threadTitle(thread))} ${isUnread(thread) ? '<span class="pill received">새 톡</span>' : ''}</h3>
              <p>${esc(thread.lastMessage || '대화를 시작해 보세요')}</p>
            </span>
            <span class="right"><span class="arrow">›</span></span>
          </a>`).join('') : '<div class="empty-note">아직 대화가 없어요. 조합원 명단에서 1:1 톡을 보내 보세요.</div>'}
      </div>`;
  }

  async function openThreadWith(uid, name) {
    if (!uid || uid === S.uid) return;
    const participants = [S.uid, uid].sort();
    const id = participants[0] + '__' + participants[1];
    // 규칙이 '방의 두 사람만 읽기'라서, 없는 방은 get 이 거절된다(그게 곧 '아직 없음'이다).
    let exists = false;
    try {
      const snap = await db.collection('dm_threads').doc(id).get();
      exists = snap.exists;
    } catch (error) {
      exists = false;
    }
    if (!exists) {
      try {
        await db.collection('dm_threads').doc(id).set({
          participants: participants,
          participantNames: { [S.uid]: S.name, [uid]: name || '조합원' },
          lastMessage: '',
          lastSenderUid: '',
          lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
          reads: {},
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await loadThreads();
      } catch (error) {
        // 이미 있던 방이면(생성 규칙 거절) 그대로 열면 된다.
        if (error && error.code !== 'permission-denied' && error.code !== 'already-exists') {
          console.error('대화방 만들기 실패', error);
          toast('대화방을 열지 못했어요.');
          return;
        }
      }
    }
    go('#/chat/' + id);
  }

  async function renderChatRoom(threadId) {
    const known = (S.data.threads || []).find((t) => t.id === threadId);
    view.innerHTML = `
      <div class="sec-head" style="margin-top:6px">
        <span class="badge"><svg viewBox="0 0 24 24"><circle cx="12" cy="8.2" r="3.6"/><path d="M4.8 20c.6-3.9 3.6-6 7.2-6s6.6 2.1 7.2 6"/></svg></span>
        <span class="t"><h2>${esc(known ? threadTitle(known) : '1:1 톡')}</h2><p>대화는 두 사람만 볼 수 있어요</p></span>
      </div>
      <div class="chat-room" id="chatRoom"><div class="center"><div class="spinner"></div></div></div>
      <div class="chat-input">
        <input id="chatText" placeholder="메시지를 적어 주세요" maxlength="1000" enterkeyhint="send">
        <button id="chatSend" aria-label="보내기"><svg viewBox="0 0 24 24"><path d="M4 12 20 5l-6 15-3-6z"/></svg></button>
      </div>`;

    if (S.unsubMessages) { try { S.unsubMessages(); } catch (e) {} S.unsubMessages = null; }

    let thread = known;
    const room = $('#chatRoom');
    const title = view.querySelector('.sec-head h2');
    const unsubscribe = db.collection('dm_threads').doc(threadId).collection('messages')
      .orderBy('createdAt', 'desc').limit(60)
      .onSnapshot((snap) => {
        const messages = snap.docs.map((doc) => Object.assign({ id: doc.id }, doc.data())).reverse();
        if (!messages.length) {
          room.innerHTML = '<div class="empty-note">첫 인사를 건네 보세요.</div>';
          return;
        }
        room.innerHTML = messages.map((message) => {
          const mine = message.senderUid === S.uid;
          return `<div class="bubble ${mine ? 'me' : 'you'}">${esc(message.text)}<time>${esc(clockLabel(message.createdAt))}</time></div>`;
        }).join('');
        window.scrollTo(0, document.body.scrollHeight);
      });
    S.unsubMessages = unsubscribe;

    try {
      await db.collection('dm_threads').doc(threadId).update(new firebase.firestore.FieldPath('reads', S.uid), firebase.firestore.FieldValue.serverTimestamp());
    } catch (error) {}
    if (!thread) {
      try {
        const snap = await db.collection('dm_threads').doc(threadId).get();
        if (snap.exists) { thread = Object.assign({ id: snap.id }, snap.data()); if (title) title.textContent = threadTitle(thread); }
      } catch (error) {}
    } else if (title) {
      title.textContent = threadTitle(thread);
    }

    const input = $('#chatText');
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        const batch = db.batch();
        const now = firebase.firestore.FieldValue.serverTimestamp();
        const messageRef = db.collection('dm_threads').doc(threadId).collection('messages').doc();
        batch.set(messageRef, { senderUid: S.uid, senderName: S.name, text: text, createdAt: now });
        const threadRef = db.collection('dm_threads').doc(threadId);
        batch.set(threadRef, {
          lastMessage: text,
          lastSenderUid: S.uid,
          lastMessageAt: now,
          reads: { [S.uid]: now }
        }, { merge: true });
        await batch.commit();
        loadThreads();
      } catch (error) {
        toast('메시지를 보내지 못했어요.');
        input.value = text;
      }
    };
    $('#chatSend').addEventListener('click', send);
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); send(); } });
  }

  /* ------------------------------------------------------------- 조합 규정·안내 */
  function renderGuides() {
    const guides = S.data.guides || [];
    view.innerHTML = `
      <div class="sec-head" style="margin-top:6px">
        <span class="badge"><svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><path d="M9 8h7M9 12h7M9 16h4"/></svg></span>
        <span class="t"><h2>조합 규정·안내</h2><p>관리자가 직접 고치는 조합 안내</p></span>
      </div>
      ${guides.length ? guides.map((item) => `
        <div class="guide-item">
          <h3>${esc(item.title)}</h3>
          <p>${esc(item.body)}</p>
        </div>`).join('') : '<div class="card card-pad empty-note">아직 올라온 안내가 없어요</div>'}
      <div style="height:10px"></div>`;
  }

  /* ------------------------------------------------------------------ 내 정보 */
  function renderAccount() {
    const installed = isStandalone();
    view.innerHTML = `
      <div class="sec-head" style="margin-top:6px">
        <span class="badge"><svg viewBox="0 0 24 24"><circle cx="12" cy="8.2" r="3.6"/><path d="M4.8 20c.6-3.9 3.6-6 7.2-6s6.6 2.1 7.2 6"/></svg></span>
        <span class="t"><h2>내 정보</h2><p>${esc(S.name)} · ${S.isAdmin ? '관리자' : '조합원'}</p></span>
      </div>
      <div class="card card-pad">
        <div class="account-row"><span>이름</span><b>${esc(S.name)}</b></div>
        <div class="account-row"><span>역할</span><b>${S.isAdmin ? '관리자' : '조합원'}</b></div>
        <div class="account-row"><span>이메일</span><b>${esc(S.email || '-')}</b></div>
        <div class="account-row"><span>이름 잠금</span><b>🔒 잠김 · 변경 불가</b></div>
        <div class="account-row"><span>설치 상태</span><b>${installed ? '홈 화면 앱으로 실행 중' : '사파리 브라우저'}</b></div>
        <div class="account-row"><span>버전</span><b>v${esc(CFG.version || '1.0')} (웹앱)</b></div>
      </div>

      <div class="card card-pad" style="margin-top:12px">
        <div style="font-size:14px;font-weight:750;letter-spacing:-.03em">조합원과 함께 쓰기</div>
        <p class="hint" style="margin:6px 0 12px">링크 하나만 카카오톡으로 보내면, 아이폰에서 홈 화면에 추가해 앱처럼 쓸 수 있어요.</p>
        <button class="btn" id="btnShare2">카카오톡·메시지로 링크 보내기</button>
        <button class="btn ghost" id="btnCopy" style="margin-top:8px">설치 주소 복사</button>
      </div>

      <div class="card card-pad" style="margin-top:12px">
        <div style="font-size:14px;font-weight:750;letter-spacing:-.03em">안드로이드 앱</div>
        <p class="hint" style="margin:6px 0 12px">안드로이드 폰은 설치 파일(APK)로 받으시는 게 더 편해요.</p>
        <a class="btn ghost" href="${esc(CFG.androiddownloadUrl)}" target="_blank" rel="noopener">안드로이드 설치 안내 열기</a>
      </div>

      ${S.isAdmin ? '<a class="btn ghost" href="#/admin" style="margin-top:12px">관리자 처리함 열기</a>' : ''}
      <button class="btn danger" id="btnLogout" style="margin-top:12px">로그아웃</button>
      <p class="hint" style="text-align:center;margin-top:14px">다시 들어오려면 카카오톡 또는 이메일로 로그인해 주세요.</p>`;

    const share = () => shareApp();
    $('#btnShare2').addEventListener('click', share);
    $('#btnCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(CFG.shareUrl); toast('설치 주소를 복사했어요.'); }
      catch (error) { toast(CFG.shareUrl, 4000); }
    });
    $('#btnLogout').addEventListener('click', () => {
      openSheet(`
        <div class="grabber"></div>
        <h2>이 기기의 잠금을 풀까요?</h2>
        <p>${esc(S.name)}님으로 잠근 이 기기를 풀고 나갑니다. 다시 들어오려면 이름을 적어 주세요.</p>
        <div class="sheet-actions">
          <button class="btn ghost" data-cancel>그대로 두기</button>
          <button class="btn danger" data-confirm>잠금 풀고 나가기</button>
        </div>`, (sheet) => {
        sheet.querySelector('[data-cancel]').addEventListener('click', closeSheet);
        sheet.querySelector('[data-confirm]').addEventListener('click', async () => {
          closeSheet();
          if (S.unsubMessages) { try { S.unsubMessages(); } catch (e) {} }
          if (presenceTimer) clearInterval(presenceTimer);
          if (S.uid) db.collection('presence').doc(S.uid).set({ online: false, lastSeenAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
          if (S.uid) logAccess('logout');
          await auth.signOut().catch(() => {});
          clearLock();
          S.uid = null; S.ready = false; S.data = {};
          renderLogin();
          toast('잠금을 풀었어요.');
        });
      });
    });
  }

  /* ------------------------------------------------------------------ 시트·토스트 */
  function openSheet(html, after) {
    const wrap = $('#sheetWrap');
    const sheet = $('#sheet');
    sheet.innerHTML = html;
    wrap.hidden = false;
    $('#sheetBackdrop').onclick = closeSheet;
    if (after) after(sheet);
  }
  function closeSheet() { $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; }

  /* --------------------------------------------------------------- 확대 보기 */
  const zoom = {
    stage: null, img: null,
    state: { scale: 1, min: 1, max: 6, x: 0, y: 0 },
    items: [], index: 0, label: ''
  };

  function initZoom() {
    zoom.stage = $('#zoomStage');
    zoom.img = $('#zoomImg');
    const stage = zoom.stage;

    stage.addEventListener('touchstart', (event) => {
      if (event.touches.length === 2) {
        zoom.state.startDist = distance(event.touches[0], event.touches[1]);
        zoom.state.startScale = zoom.state.scale;
        const mid = midpoint(event.touches[0], event.touches[1]);
        zoom.state.startX = zoom.state.x;
        zoom.state.startY = zoom.state.y;
        zoom.state.startPX = mid.x;
        zoom.state.startPY = mid.y;
      } else if (event.touches.length === 1) {
        zoom.state.startX = zoom.state.x;
        zoom.state.startY = zoom.state.y;
        zoom.state.startPX = event.touches[0].clientX;
        zoom.state.startPY = event.touches[0].clientY;
        zoom.state.startDist = 0;
      }
    }, { passive: true });

    stage.addEventListener('touchmove', (event) => {
      event.preventDefault();
      if (event.touches.length === 2) {
        const dist = distance(event.touches[0], event.touches[1]);
        if (zoom.state.startDist > 0) {
          const next = Math.min(zoom.state.max, Math.max(zoom.state.min, zoom.state.startScale * (dist / zoom.state.startDist)));
          zoom.state.scale = next;
          clampPan();
          applyZoom();
        }
      } else if (event.touches.length === 1 && zoom.state.scale > 1) {
        zoom.state.x = zoom.state.startX + (event.touches[0].clientX - zoom.state.startPX);
        zoom.state.y = zoom.state.startY + (event.touches[0].clientY - zoom.state.startPY);
        clampPan();
        applyZoom();
      }
    }, { passive: false });

    let lastTap = 0;
    stage.addEventListener('touchend', (event) => {
      const now = Date.now();
      if (event.touches.length === 0 && now - lastTap < 280 && zoom.state.startDist === 0) {
        zoom.state.scale = zoom.state.scale > 1.4 ? 1 : 2.6;
        zoom.state.x = 0; zoom.state.y = 0;
        applyPanBounds();
        applyZoom();
        lastTap = 0;
        return;
      }
      lastTap = now;
    }, { passive: true });

    stage.addEventListener('wheel', (event) => {
      event.preventDefault();
      const next = Math.min(zoom.state.max, Math.max(zoom.state.min, zoom.state.scale * (event.deltaY < 0 ? 1.12 : 0.89)));
      zoom.state.scale = next;
      clampPan();
      applyZoom();
    }, { passive: false });

    $('#zoomClose').addEventListener('click', closeZoom);
    $('#zoomPrev').addEventListener('click', () => stepZoom(-1));
    $('#zoomNext').addEventListener('click', () => stepZoom(1));
  }

  function distance(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  function midpoint(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }

  function applyPanBounds() {
    const rect = zoom.stage.getBoundingClientRect();
    const maxX = Math.max(0, (zoom.img.naturalWidth * zoom.state.scale - rect.width) / 2);
    const maxY = Math.max(0, (zoom.img.naturalHeight * zoom.state.scale - rect.height) / 2);
    zoom.state.maxX = maxX; zoom.state.maxY = maxY;
  }
  function clampPan() {
    applyPanBounds();
    zoom.state.x = Math.max(-zoom.state.maxX, Math.min(zoom.state.maxX, zoom.state.x));
    zoom.state.y = Math.max(-zoom.state.maxY, Math.min(zoom.state.maxY, zoom.state.y));
  }
  function applyZoom() {
    zoom.img.style.transform = `translate(-50%,-50%) translate(${zoom.state.x}px, ${zoom.state.y}px) scale(${zoom.state.scale})`;
  }
  function fitZoomImage(src) {
    zoom.img.onload = () => {
      const rect = zoom.stage.getBoundingClientRect();
      const ratio = Math.min(rect.width / zoom.img.naturalWidth, rect.height / zoom.img.naturalHeight);
      zoom.img.style.width = (zoom.img.naturalWidth * ratio) + 'px';
      zoom.img.style.height = (zoom.img.naturalHeight * ratio) + 'px';
      zoom.state.scale = 1; zoom.state.x = 0; zoom.state.y = 0;
      applyPanBounds();
      applyZoom();
    };
    zoom.img.src = src;
  }
  function openZoom(items, index, label) {
    zoom.items = items;
    zoom.index = index;
    $('#zoom').hidden = false;
    document.body.style.overflow = 'hidden';
    showZoomItem();
    $('#zoomLabel').textContent = label || `${index + 1} / ${items.length}`;
  }
  function showZoomItem() {
    const item = zoom.items[zoom.index];
    if (!item) return;
    fitZoomImage(item.src);
    $('#zoomLabel').textContent = item.label || `${zoom.index + 1} / ${zoom.items.length}`;
  }
  function stepZoom(direction) {
    if (zoom.items.length < 2) return;
    zoom.index = (zoom.index + direction + zoom.items.length) % zoom.items.length;
    showZoomItem();
  }
  function closeZoom() {
    $('#zoom').hidden = true;
    document.body.style.overflow = '';
    zoom.img.removeAttribute('src');
  }

  async function openBoard(month, doc) {
    const item = scheduleMonths().find((m) => m.month === month);
    if (!item) return;
    openZoom([{ src: '', label: '불러오는 중…' }], 0, '불러오는 중…');
    const scheduleSrc = await scheduleSource(item, 'schedule');
    const dispatchSrc = await scheduleSource(item, 'dispatch');
    const list = [];
    if (scheduleSrc) list.push({ src: scheduleSrc, label: `근무표 · ${item.label || month}` });
    if (dispatchSrc) list.push({ src: dispatchSrc, label: `배차표 · ${item.label || month}` });
    if (!list.length) { closeZoom(); toast('표 사진을 불러오지 못했어요.'); return; }
    const start = doc === 'dispatch' ? Math.max(0, list.findIndex((x) => x.label.startsWith('배차표'))) : 0;
    openZoom(list, start, list[start].label);
  }

  async function scheduleSource(item, kind) {
    if (kind === 'schedule') {
      const media = item.scheduleMedia ? await mediaUrl(item.scheduleMedia) : '';
      if (media) return media;
      return item.scheduleUrl ? String(item.scheduleUrl).replace(/^http:\/\//i, 'https://') : '';
    }
    const media = item.dispatchMedia ? await mediaUrl(item.dispatchMedia) : '';
    if (media) return media;
    return item.dispatchUrl ? String(item.dispatchUrl).replace(/^http:\/\//i, 'https://') : '';
  }

  /* --------------------------------------------------------------- 설치·공유 */
  function isStandalone() {
    return (window.navigator.standalone === true) ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches);
  }
  function isIOS() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isAndroid() { return /Android/i.test(navigator.userAgent || ''); }
  function isKakaoTalk() { return /KAKAOTALK/i.test(navigator.userAgent || ''); }

  function setupInstall() {
    const banner = $('#installBanner');
    const text = $('#installText');

    if (isKakaoTalk()) {
      $('#ktNotice').hidden = false;
      $('#ktCopy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(CFG.shareUrl); toast('주소를 복사했어요. Safari 주소창에 붙여 넣어 주세요.'); }
        catch (error) { toast(CFG.shareUrl, 5000); }
      });
      $('#ktOpen').addEventListener('click', () => {
        // 카카오톡 인앱브라우저에서 사파리로 넘기는 표준 우회
        location.href = CFG.shareUrl.replace(/^https?:\/\//, 'x-web-search://?') || CFG.shareUrl;
        setTimeout(() => { toast('안 열리면 오른쪽 위 ⋯ → 다른 브라우저로 열기를 눌러 주세요.', 4200); }, 600);
      });
      return;
    }

    if (isStandalone() || localStorage.getItem('union-install-dismissed') === '1') return;

    if (isIOS()) {
      text.innerHTML = '사파리 아래 <b>공유 단추(□↑)</b>를 누르고 <b>「홈 화면에 추가」</b>를 고르면 앱처럼 설치돼요.';
      banner.hidden = false;
      document.body.classList.add('has-install-banner');
    } else if (isAndroid()) {
      text.innerHTML = '크롬 오른쪽 위 <b>⋮</b> → <b>「앱 설치」</b>를 누르면 홈 화면에 앱으로 설치돼요.';
      banner.hidden = false;
      document.body.classList.add('has-install-banner');
    }
    $('#installClose').addEventListener('click', () => {
      banner.hidden = true;
      document.body.classList.remove('has-install-banner');
      localStorage.setItem('union-install-dismissed', '1');
    });
  }

  async function shareApp() {
    const text = '아산 교통약자 이동지원센터 노동조합 공식 앱\n사파리로 열고 「홈 화면에 추가」를 누르면 앱처럼 설치됩니다.';
    try {
      if (navigator.share) {
        await navigator.share({ title: '아산 교통약자 이동지원센터 노동조합', text: text, url: CFG.shareUrl });
        return;
      }
    } catch (error) { /* 사용자가 취소 */ return; }
    try {
      await navigator.clipboard.writeText(CFG.shareUrl);
      toast('설치 주소를 복사했어요. 카카오톡에 붙여 넣어 보내 주세요.');
    } catch (error) {
      toast(CFG.shareUrl, 5000);
    }
  }

  /* ------------------------------------------------------------------ 시작 */
  function bindChrome() {
    $('#btnRefresh').addEventListener('click', async () => {
      const button = $('#btnRefresh');
      button.style.transform = 'rotate(320deg)';
      button.style.transition = 'transform .5s';
      await loadAll();
      renderRoute();
      setTimeout(() => { button.style.transform = ''; }, 520);
      toast('새로고침했어요.');
    });
    $('#btnMe').addEventListener('click', () => go('#/account'));
    $('#btnShare').addEventListener('click', shareApp);

    document.addEventListener('click', (event) => {
      const target = event.target.closest('[data-go]');
      if (target) { event.preventDefault(); go(target.dataset.go); }
    });

    window.addEventListener('hashchange', renderRoute);
  }

  function boot() {
    initFirebase();
    initZoom();
    bindChrome();
    setupInstall();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
      });
    }

    const params = new URLSearchParams(location.search);
    if (params.get('go') === 'payroll') location.hash = '#/payroll';
    if (params.get('go') === 'write') location.hash = '#/write';

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        S.uid = null; S.ready = false;
        renderLogin();
        return;
      }
      if (S.uid === user.uid) return;
      try {
        await startSession(user);
      } catch (error) {
        toast('앱을 여는 중 문제가 생겼어요. 새로고침해 주세요.');
      }
    });

    // 저장된 세션으로 곧바로 여는 동안 잠깐 보여 주는 화면(잠금 사본을 먼저 되살린다)
    if (!auth.currentUser) restoreLock().then(() => { if (!S.ready) renderLogin(); });
  }

  boot();
})();
