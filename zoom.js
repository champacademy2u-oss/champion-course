(() => {
  "use strict";

  document.documentElement.classList.add("motion-ready");

  const config = window.ZOOM_PUBLIC_CONFIG || {};
  const localApiOverride = ["localhost", "127.0.0.1"].includes(location.hostname)
    ? new URLSearchParams(location.search).get("api_base")
    : "";
  const baseUrl = String(localApiOverride || config.functionsBaseUrl || "").replace(/\/$/, "");
  const modal = document.getElementById("registrationModal");
  const form = document.getElementById("registrationForm");
  const formPanel = document.getElementById("registrationFormPanel");
  const successPanel = document.getElementById("registrationSuccess");
  const errorElement = document.getElementById("registrationError");
  const submitButton = document.getElementById("submitRegistration");
  const openButtons = [...document.querySelectorAll("[data-open-registration]")];
  let activeEvent = null;
  let lastFocused = null;
  let appCheck = null;

  function setupMotion() {
    const revealSelectors = [
      ".strategy-heading",
      ".strategy-card",
      ".profit-banner",
      ".speaker-photo",
      ".speaker-intro",
      ".speaker-proof li",
      ".process-section .section-heading",
      ".steps li",
      ".process-section .primary-cta",
      ".faq-section .section-heading",
      ".faq-list details",
      ".final-cta > *"
    ];
    const items = [...document.querySelectorAll(revealSelectors.join(","))];
    items.forEach((item, index) => {
      item.classList.add("reveal-item");
      item.style.setProperty("--reveal-delay", `${Math.min(index % 5, 4) * 65}ms`);
    });

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => document.documentElement.classList.add("motion-loaded"));
    });

    if (!("IntersectionObserver" in window)) {
      items.forEach(item => item.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8%", threshold: 0.12 });
    items.forEach(item => observer.observe(item));
  }

  document.getElementById("year").textContent = new Date().getFullYear();

  function endpoint(name) {
    if (!baseUrl) throw new Error("报名服务尚未设置完成");
    return !localApiOverride && config.singleEndpoint === true
      ? `${baseUrl}?action=${encodeURIComponent(name)}`
      : `${baseUrl}/${name}`;
  }

  function dateText(value) {
    if (!value) return "—";
    const date = new Date(`${value}T12:00:00+08:00`);
    return new Intl.DateTimeFormat("zh-MY", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(date);
  }

  function eventDisplay(event) {
    const isMoneyMachineSession = event.eventDate === "2026-08-28" && event.eventTime === "20:30";
    if (isMoneyMachineSession) {
      return {
        title: "「打造企业赚钱机器」线上 Zoom 分享",
        date: "28/08/2026",
        time: "8:30pm till Late （ 8pm入场 ）"
      };
    }
    return {
      title: event.title,
      date: dateText(event.eventDate),
      time: `${event.eventTime}（GMT+8）`
    };
  }

  function setRegistrationEnabled(enabled) {
    openButtons.forEach(button => { button.disabled = !enabled; });
  }

  function renderEvent(event) {
    activeEvent = event;
    const display = eventDisplay(event);
    document.getElementById("eventTitle").textContent = display.title;
    document.getElementById("finalEventTitle").textContent = `保留「${display.title}」线上名额`;
    document.getElementById("modalEventName").textContent = `报名：${display.title}。完成后将同时发送到 WhatsApp 与 Email。`;
    document.getElementById("eventSubtitle").textContent = event.subtitle || "建立你的赚钱系统，让企业自动化运转，业绩与利润持续增长。";
    document.getElementById("eventDate").textContent = display.date;
    document.getElementById("eventTime").textContent = display.time;
    document.getElementById("eventStatus").textContent = event.registrationOpen ? "报名开放中" : "报名已结束";
    if (event.speakerName) {
      document.getElementById("speakerRow").hidden = false;
      document.getElementById("speakerName").textContent = event.speakerName;
    }
    const seatNote = document.getElementById("seatNote");
    if (Number.isFinite(event.remainingSeats)) {
      seatNote.hidden = false;
      seatNote.textContent = event.remainingSeats > 0 ? `本场剩余 ${event.remainingSeats} 个名额` : "本场名额已满";
    }
    setRegistrationEnabled(Boolean(event.registrationOpen));
  }

  async function loadEvent() {
    const eventError = document.getElementById("eventError");
    try {
      const response = await fetch(endpoint("getActiveZoomEvent"), { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "暂时无法读取活动资料");
      renderEvent(data.event);
    } catch (error) {
      setRegistrationEnabled(false);
      document.getElementById("eventStatus").textContent = "报名尚未开放";
      document.getElementById("eventSubtitle").textContent = "最新活动资料准备好后，报名按钮会在这里开放。";
      eventError.textContent = error.message === "Failed to fetch" ? "报名服务尚未开放" : error.message;
    }
  }

  function openModal(event) {
    if (!activeEvent?.registrationOpen) return;
    lastFocused = event?.currentTarget || document.activeElement;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    window.setTimeout(() => document.getElementById("registrationName").focus(), 20);
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    lastFocused?.focus?.();
  }

  function internationalPhone() {
    const input = document.getElementById("registrationPhone").value.trim();
    if (input.startsWith("+")) return `+${input.slice(1).replace(/\D/g, "")}`;
    return document.getElementById("phonePrefix").value + input.replace(/\D/g, "").replace(/^0+/, "");
  }

  function maskEmail(value) {
    const [name, domain] = String(value).split("@");
    return domain ? `${name.slice(0, 2)}***@${domain}` : "Email";
  }

  function maskPhone(value) {
    const phone = String(value);
    return phone.length > 6 ? `${phone.slice(0, 4)}••••${phone.slice(-3)}` : "WhatsApp";
  }

  async function appCheckToken() {
    if (!config.appCheckSiteKey || !window.firebase?.appCheck) return "";
    if (!appCheck) {
      const firebaseApp = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.FIREBASE_CONFIG);
      appCheck = firebase.appCheck(firebaseApp);
      appCheck.activate(config.appCheckSiteKey, true);
    }
    const result = await appCheck.getToken(false);
    return result?.token || "";
  }

  function sourceData() {
    const params = new URLSearchParams(location.search);
    return {
      source: params.get("source") || (document.referrer.includes("facebook.com") ? "facebook" : "direct"),
      utmSource: params.get("utm_source") || "",
      utmMedium: params.get("utm_medium") || "",
      utmCampaign: params.get("utm_campaign") || "",
      utmContent: params.get("utm_content") || "",
      keyword: params.get("keyword") || ""
    };
  }

  function deliveryLabel(channel, status) {
    const label = channel === "whatsapp" ? "WhatsApp" : "Email";
    if (status === "sent") return `${label}：已发送`;
    if (status === "disabled") return `${label}：本场未启用`;
    if (status === "failed") return `${label}：发送遇到问题，管理员可在后台重发`;
    return `${label}：处理中`;
  }

  async function submitRegistration(event) {
    event.preventDefault();
    errorElement.textContent = "";
    const name = document.getElementById("registrationName").value.trim();
    const email = document.getElementById("registrationEmail").value.trim();
    const phone = internationalPhone();
    const consent = document.getElementById("registrationConsent").checked;
    if (name.length < 2) return void (errorElement.textContent = "请填写完整姓名");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void (errorElement.textContent = "请填写正确的 Email");
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) return void (errorElement.textContent = "请填写包含国际区号的 WhatsApp 手机号码");
    if (!consent) return void (errorElement.textContent = "请勾选同意接收本次活动通知");

    submitButton.disabled = true;
    submitButton.querySelector("span").textContent = "正在处理报名…";
    try {
      const token = await appCheckToken();
      const response = await fetch(endpoint("registerForZoom"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "X-Firebase-AppCheck": token } : {}) },
        body: JSON.stringify({
          name, email, phone, consent,
          website: document.getElementById("registrationWebsite").value,
          ...sourceData()
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "暂时无法完成报名，请稍后再试");
      formPanel.hidden = true;
      successPanel.hidden = false;
      document.getElementById("successMessage").textContent = data.duplicate
        ? data.message
        : `活动资料会发送至 ${maskPhone(phone)} 与 ${maskEmail(email)}。`;
      const delivery = data.delivery || {};
      document.getElementById("deliveryResult").innerHTML = "";
      ["whatsapp", "email"].forEach(channel => {
        const item = document.createElement("span");
        item.textContent = deliveryLabel(channel, delivery[channel]);
        document.getElementById("deliveryResult").appendChild(item);
      });
    } catch (error) {
      errorElement.textContent = error.message;
    } finally {
      submitButton.disabled = false;
      submitButton.querySelector("span").textContent = "确认报名并发送 Zoom 资料";
    }
  }

  openButtons.forEach(button => button.addEventListener("click", openModal));
  document.querySelectorAll("[data-close-registration]").forEach(button => button.addEventListener("click", closeModal));
  form.addEventListener("submit", submitRegistration);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });

  setupMotion();
  loadEvent();
})();
