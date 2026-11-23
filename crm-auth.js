(() => {
  "use strict";

  const gate = document.getElementById("crmAuthGate");
  const form = document.getElementById("crmAuthForm");
  const passwordInput = document.getElementById("crmAuthPassword");
  const submitButton = document.getElementById("crmAuthSubmit");
  const status = document.getElementById("crmAuthStatus");
  const badge = document.getElementById("crmAuthBadge");
  const logoutButton = document.getElementById("crmLogoutButton");
  const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
  const loginUrl = String(
    window.CRM_AUTH_CONFIG?.loginUrl
      || window.CRM_AUTH_CONFIG?.apiBaseUrl
      || "https://champion-course-video-room.vercel.app/api/crm-session"
  );

  let firebaseApp = null;
  let auth = null;
  let appLoaded = false;
  let closingSession = false;
  let activeKind = "";
  let refreshingForServiceWorker = false;

  function registerSecureServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshingForServiceWorker) return;
      refreshingForServiceWorker = true;
      window.location.reload();
    });
    navigator.serviceWorker.register("./sw.js")
      .then(registration => registration.update())
      .catch(() => {});
  }

  function setStatus(message, progress = false) {
    status.textContent = message || "";
    status.classList.toggle("is-progress", progress);
  }

  function setBusy(busy) {
    submitButton.disabled = busy;
    passwordInput.disabled = busy;
    submitButton.textContent = busy ? "正在验证…" : "登入 CRM";
  }

  function waitForInitialUser(timeoutMs = 5000) {
    return new Promise(resolve => {
      let settled = false;
      let unsubscribe = () => {};
      const timeout = window.setTimeout(() => finish(auth.currentUser || null), timeoutMs);
      function finish(user) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        unsubscribe();
        resolve(user || null);
      }
      unsubscribe = auth.onAuthStateChanged(finish, () => finish(null));
    });
  }

  async function accessKind(user) {
    if (!user || user.isAnonymous) return "";
    try {
      const token = await user.getIdTokenResult(true);
      if (token.claims?.admin === true && token.claims?.role === "crm_shared_admin") {
        if (token.claims?.firebase?.sign_in_provider !== "custom") return "";
        const authTime = Number(token.claims?.auth_time);
        const now = Math.floor(Date.now() / 1000);
        if (!Number.isFinite(authTime) || authTime <= 0
          || now - authTime < -MAX_CLOCK_SKEW_SECONDS) return "";
        return "shared";
      }
      const provider = token.claims?.firebase?.sign_in_provider;
      const googleProvider = provider === "google.com"
        || (user.providerData || []).some(item => item?.providerId === "google.com");
      return googleProvider ? "google" : "";
    } catch {
      return "";
    }
  }

  function loadClassicScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", () => reject(new Error(`无法载入 ${src}`)), { once: true });
      document.body.appendChild(script);
    });
  }

  async function loadCrmApplication() {
    if (appLoaded) return;
    const scripts = window.CRM_APP_SCRIPTS || {};
    for (const src of scripts.classic || []) await loadClassicScript(src);
    await Promise.all((scripts.modules || []).map(src => import(src)));
    appLoaded = true;
  }

  function showAuthenticated(kind) {
    activeKind = kind;
    window.__CRM_AUTH_ACTIVE = true;
    window.__CRM_SHARED_ADMIN = kind === "shared";
    badge.hidden = false;
    badge.textContent = kind === "shared" ? "共享管理员" : "Google 管理员";
    logoutButton.hidden = false;
  }

  async function openCrm(user, kind) {
    showAuthenticated(kind);
    setStatus("正在安全载入 CRM…", true);
    await loadCrmApplication();
    document.body.classList.remove("crm-auth-pending", "crm-auth-locked");
    document.body.classList.add("crm-auth-ready");
    gate.setAttribute("aria-hidden", "true");
    setStatus("");
    window.crmAuth.user = user;
    window.crmAuth.kind = kind;
  }

  async function removeLegacyFirestoreCache() {
    try {
      // Do not create and terminate the Firestore singleton on the signed-out
      // login screen; the same page must still be able to initialize it after
      // a successful password exchange. Termination is only needed on logout.
      const firestore = appLoaded && firebaseApp && window.firebase?.firestore
        ? firebase.firestore(firebaseApp)
        : null;
      if (firestore) {
        await firestore.terminate().catch(() => {});
        await firestore.clearPersistence().catch(() => {});
      }
    } catch {}

    if (!window.indexedDB?.databases) return;
    try {
      const databases = await indexedDB.databases();
      await Promise.all(databases
        .map(item => item?.name || "")
        .filter(name => /firestore/i.test(name))
        .map(name => new Promise(resolve => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        })));
    } catch {}
  }

  async function clearSensitiveBrowserData() {
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
    await removeLegacyFirestoreCache();
  }

  async function endSession({ confirmFirst = true, message = "已退出，请重新输入密码。" } = {}) {
    if (confirmFirst && !window.confirm("确定退出 CRM？这台设备上的客户缓存也会一并清除。")) return;
    closingSession = true;
    document.body.classList.remove("crm-auth-ready", "crm-auth-pending");
    document.body.classList.add("crm-auth-locked");
    gate.removeAttribute("aria-hidden");
    setStatus(message, true);
    try { await auth?.signOut(); } catch {}
    await clearSensitiveBrowserData();
    window.location.reload();
  }

  async function lockCrm(message = "登录已失效，请重新输入密码。") {
    if (closingSession) return;
    await endSession({ confirmFirst: false, message });
  }

  window.crmAuth = {
    user: null,
    kind: "",
    getIdToken: async forceRefresh => {
      const user = auth?.currentUser;
      if (!user) throw new Error("未登录");
      return user.getIdToken(Boolean(forceRefresh));
    },
    logout: options => endSession(options),
    lock: message => lockCrm(message),
    isSharedAdmin: () => activeKind === "shared"
  };

  async function submitPassword(event) {
    event.preventDefault();
    const password = passwordInput.value;
    if (!password) {
      setStatus("请输入密码。");
      passwordInput.focus();
      return;
    }

    setBusy(true);
    setStatus("正在验证密码…", true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(loginUrl, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.customToken) {
        if (response.status === 429) throw new Error("尝试次数过多，请稍后再试。");
        if (response.status === 503) throw new Error("登入服务尚未启用，请联系负责人。");
        throw new Error("密码不正确，请重新输入。");
      }

      await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
      const credential = await auth.signInWithCustomToken(data.customToken);
      const kind = await accessKind(credential.user);
      if (kind !== "shared") throw new Error("管理员授权无效，请联系负责人。");
      passwordInput.value = "";
      await openCrm(credential.user, kind);
    } catch (error) {
      if (auth?.currentUser && !appLoaded) await auth.signOut().catch(() => {});
      const timedOut = error?.name === "AbortError";
      setStatus(timedOut ? "连接超时，请检查网络后重试。" : (error?.message || "暂时无法登入，请稍后再试。"));
      passwordInput.select();
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  }

  async function boot() {
    if (!gate || !form || !window.firebase?.auth || !window.FIREBASE_CONFIG) {
      setStatus("登入服务无法载入，请刷新页面。待解决前不会显示客户资料。");
      return;
    }
    try {
      firebaseApp = firebase.apps?.length ? firebase.app() : firebase.initializeApp(window.FIREBASE_CONFIG);
      auth = firebase.auth(firebaseApp);
      await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
      const user = await waitForInitialUser();
      const kind = await accessKind(user);
      if (kind) {
        await openCrm(user, kind);
      } else {
        if (user) await auth.signOut().catch(() => {});
        await clearSensitiveBrowserData();
        document.body.classList.remove("crm-auth-pending");
        document.body.classList.add("crm-auth-locked");
        setStatus("");
        passwordInput.focus();
      }

      auth.onIdTokenChanged(async nextUser => {
        if (!appLoaded || closingSession) return;
        const nextKind = await accessKind(nextUser);
        if (!nextKind) await lockCrm();
      });
      window.setInterval(async () => {
        if (!appLoaded || closingSession) return;
        const nextKind = await accessKind(auth.currentUser);
        if (!nextKind) await lockCrm();
      }, 15 * 60 * 1000);
    } catch {
      setStatus("登入服务暂时无法使用。待恢复前不会显示客户资料。");
      document.body.classList.remove("crm-auth-pending");
      document.body.classList.add("crm-auth-locked");
    }
  }

  form.addEventListener("submit", submitPassword);
  logoutButton.addEventListener("click", () => endSession());
  registerSecureServiceWorker();
  boot();
})();
