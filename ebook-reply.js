(function exposeEbookReplyUI(scope) {
  "use strict";
  const core = scope.EbookReplyCore;
  if (!core) return;
  const leads = new Map();
  const uncertainIds = new Set();
  let dialog, activeId = "", saved, busy = false, prepared = "", returnFocus;
  let currentStep = 1, draftEdited = false, draftBasis = "";
  let adapters = {};
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const options = values => Object.entries(values).map(([value, label]) => `<option value="${value}">${escape(label)}</option>`).join("");
  const PROFILE_FIELDS = ["sector", "topic", "pain", "route", "permission", "stage", "consentSource", "nextDate"];
  const STEP_LABELS = ["看表单与许可", "确认领域与痛点", "选切入方向", "Ryan课程与CTA", "审核发送与记录"];
  function formState() {
    return core.readState({ ...saved, ...Object.fromEntries(PROFILE_FIELDS.map(key => [key, $("er-" + key).value])) });
  }
  function dirty() { const state = formState(); return PROFILE_FIELDS.some(key => state[key] !== saved[key]); }
  function signature() { return JSON.stringify([activeId, formState(), $("er-template").value, $("er-message").value]); }
  function contextSignature() { const s = formState(); return JSON.stringify([activeId, s.sector, s.topic, s.pain, s.route, $("er-template").value]); }
  function showStep(value, focus = true) {
    currentStep = Math.max(1, Math.min(5, value));
    dialog.querySelectorAll("[data-er-panel]").forEach(e => { e.hidden = Number(e.dataset.erPanel) !== currentStep; });
    dialog.querySelectorAll("[data-er-step]").forEach(e => {
      const active = Number(e.dataset.erStep) === currentStep;
      e.classList.toggle("is-active", active);
      if (active) e.setAttribute("aria-current", "step"); else e.removeAttribute("aria-current");
    });
    $("er-progress").textContent = `Step ${currentStep} / 5 · ${STEP_LABELS[currentStep - 1]}`;
    $("er-prev").hidden = currentStep === 1;
    $("er-next").hidden = currentStep === 5;
    if (focus) { $("er-step-title-" + currentStep).focus(); $("er-progress").scrollIntoView({ block: "nearest" }); }
  }
  function status(text, error = false) {
    $("er-status").textContent = text;
    $("er-status").classList.toggle("is-error", error);
  }
  function guard() {
    if (busy) return "正在保存，请稍候。";
    if (uncertainIds.has(activeId)) return "上次保存尚未确认，请关闭并刷新 Ebook Leads 后再操作。";
    if (dirty()) return "跟进资料尚未保存：请先核实并保存工作领域、痛点、联系许可和阶段。";
    if (draftBasis !== contextSignature()) return "领域／痛点／课程已改变，编辑草稿已保留；请重新生成，或核对后确认保留这份编辑。";
    return core.contactGuard(formState(), $("er-template").value, $("er-message").value, leads.get(activeId)?.phone, $("er-reviewed").checked);
  }
  function updateControls() {
    if (!dialog?.open) return;
    const reason = guard();
    $("er-guard").textContent = reason || "可以复制／打开聊天；仍需你在 WhatsApp 人工检查并发送。";
    $("er-copy").disabled = !!reason;
    $("er-open").disabled = !!reason;
    $("er-sent").disabled = !!reason || prepared !== signature() || !$("er-sent-confirm").checked;
    $("er-save").disabled = busy || uncertainIds.has(activeId);
    const verified = core.VERIFIED_STAGES.has(formState().stage) && formState().stage !== saved.stage;
    $("er-event-wrap").hidden = !verified;
    $("er-restore-wrap").hidden = !((saved.permission === "opted_out" || saved.stage === "opted_out") && formState().permission !== "opted_out" && formState().stage !== "opted_out");
    $("er-last").textContent = saved.lastContactAt ? `上次人工发送：${new Intl.DateTimeFormat("zh-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short" }).format(new Date(saved.lastContactAt))} MYT` : "尚未记录人工发送；打开聊天／复制不会更新发送状态。";
    const loading = busy;
    dialog.querySelectorAll("select,input,textarea").forEach(e => { e.disabled = loading; });
    dialog.querySelectorAll("[data-er-step],#er-prev,#er-next,#er-regenerate,#er-keep-draft").forEach(e => { e.disabled = loading; });
    $("er-close").disabled = loading;
    const state = formState();
    $("er-focus").textContent = `${core.SECTORS[state.sector]} · ${core.PAINS[state.pain].label}`;
    $("er-angle").textContent = core.angleText(state);
    $("er-course").textContent = core.courseText(state);
    $("er-draft-warning").hidden = draftBasis === contextSignature();
  }
  function invalidate() {
    prepared = "";
    $("er-reviewed").checked = false;
    $("er-sent-confirm").checked = false;
    updateControls();
  }
  function regenerate() {
    $("er-message").value = core.buildMessage($("er-template").value, leads.get(activeId), formState());
    draftEdited = false; draftBasis = contextSignature();
    invalidate();
  }
  function contextChanged() { if (draftEdited) invalidate(); else regenerate(); }
  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement("dialog");
    dialog.id = "ebookReplyDialog";
    dialog.className = "ebook-reply-dialog";
    dialog.setAttribute("aria-labelledby", "er-title");
    dialog.innerHTML = `
      <header class="er-header"><div><p class="er-eyebrow">CHAMP ACADEMY · EBOOK LEADS</p><h2 id="er-title">领域 × 痛点 · 五步 Reply</h2></div><button id="er-close" type="button" class="er-button" aria-label="关闭跟进面板">关闭</button></header>
      <div class="er-body">
        <p class="er-notice">RM4,997 All in 1 · RM388 三天线上孙子兵法。下一期日期、付款入口及抵扣政策尚未确认，话术不承诺旧日期、名额或保证解封。</p>
        <nav class="er-steps" aria-label="五步跟进">${STEP_LABELS.map((label, i) => `<button type="button" class="er-step" data-er-step="${i + 1}" aria-controls="er-panel-${i + 1}"><b>Step ${i + 1}</b><span>${label}</span></button>`).join("")}</nav>
        <p id="er-progress" class="er-progress" role="status" aria-live="polite"></p>
          <section id="er-panel-1" data-er-panel="1" class="er-card"><h3 id="er-step-title-1" tabindex="-1">Step 1 · 先看已填资料，不重新问一遍</h3>
            <section class="er-context" aria-label="当前客户表单（仅内部）"><strong id="er-name"></strong><span id="er-phone"></span><span id="er-book"></span><p id="er-industry"></p><p id="er-challenge"></p><small>原始资料只用于内部判断。已填明确的问题不要再问；模糊或多重问题只补问一个必要问题。关键词建议不是已确认诊断。</small></section>
            <label for="er-permission">联系许可</label><select id="er-permission">${options(core.PERMISSIONS)}</select>
            <label for="er-consentSource">许可来源／日期</label><input id="er-consentSource" maxlength="180" placeholder="例如：客户主动询问课程；已核实的表单同意及日期" autocomplete="off">
            <small>领取 Ebook 不等于课程营销同意。不要粘贴聊天原文、电话或身份证资料。</small>
            <label for="er-stage">当前阶段</label><select id="er-stage">${options(core.STAGES)}</select>
            <label for="er-nextDate">下次人工跟进日期（MYT）</label><input id="er-nextDate" type="date">
            <label id="er-event-wrap" class="er-check" hidden><input id="er-eventVerified" type="checkbox"><span>我已核实对应付款或实际出席，不以已读或付款截图代替对账。</span></label>
            <label id="er-restore-wrap" class="er-check" hidden><input id="er-reoptinVerified" type="checkbox"><span>退订后客户已给出新的明确同意；我已更新许可来源，再恢复相应联系范围。</span></label>
            <small id="er-last"></small>
          </section>
          <section id="er-panel-2" data-er-panel="2" class="er-card" hidden><h3 id="er-step-title-2" tabindex="-1">Step 2 · 确认领域与主痛点</h3>
            <p class="er-guide">先用客户已填的领域和问题。下面是关键词建议，须人工确认；不要把员工当老板，也不要猜营收。无行业资料可选「未填写／不提行业」。</p>
            <label for="er-sector">工作领域（人工确认分类）</label><select id="er-sector">${options(core.SECTORS)}</select>
            <label for="er-topic">问题类别</label><select id="er-topic">${options(core.TOPICS)}</select>
            <label for="er-pain">这次重点跟进的痛点</label><select id="er-pain">${options(Object.fromEntries(Object.entries(core.PAINS).map(([id, p]) => [id, p.label])))}</select>
            <small>选择具体痛点会同步问题类别。分类不吻合时不要发送，先用一个必要问题澄清。</small>
          </section>
          <section id="er-panel-3" data-er-panel="3" class="er-card" hidden><h3 id="er-step-title-3" tabindex="-1">Step 3 · 用痛点给一个相关切入方向</h3>
            <p id="er-focus" class="er-focus"></p><p id="er-angle" class="er-preview"></p>
            <p class="er-guide">这是一个可检查的方向，不是问题原因或解决效果保证。明确客户需求后再邀请课程；账号封禁和下载问题先服务。</p>
          </section>
          <section id="er-panel-4" data-er-panel="4" class="er-card" hidden><h3 id="er-step-title-4" tabindex="-1">Step 4 · 选 Ryan 课程，并给一个小 CTA</h3>
            <label for="er-route">当前课程路径</label><select id="er-route">${options(core.ROUTES)}</select>
            <p id="er-course" class="er-preview"></p>
            <p class="er-guide">主路径：匹配需求 → RM4,997 All in 1。若客户想先体验，且已确认战略／团队／系统需求，可选 RM388；不是自动降价路径、订金或默认抵扣。</p>
            <p class="er-cta">CTA：要我把与你这个问题相关的课程内容、上课安排和报名资料发给你吗？</p>
            <small>这是待人工确认的草稿。下一期日期、实际大纲、付款和条款须核实后才发，不沿用已过期海报。</small>
          </section>
          <section id="er-panel-5" data-er-panel="5" class="er-card" hidden><h3 id="er-step-title-5" tabindex="-1">Step 5 · 审核草稿，人工发送，再记录</h3>
            <p class="er-guide">Step 2–4 会组成一条短回复，不是一次连续发五条。没有回复时用第 2 天的小检查和第 5 天暂停话术；不要自动群发。</p>
            <button id="er-save" type="button" class="er-button er-primary">保存已核实的跟进资料</button>
            <label for="er-template">Reply SOP 话术</label><select id="er-template">${core.TEMPLATES.map(t => `<option value="${t.id}">${escape(t.label)}</option>`).join("")}</select>
            <label for="er-message">准备发送的内容（可修改，最多 3000 字）</label><textarea id="er-message" maxlength="3000" rows="12" spellcheck="false"></textarea>
            <p id="er-draft-warning" class="er-notice" hidden>领域／痛点／课程变了，已保留你的编辑。请重新生成，或逐句核对后确认保留；不会静默覆盖编辑。</p>
            <div class="er-actions"><button id="er-regenerate" type="button" class="er-button">重新生成（替换草稿）</button><button id="er-keep-draft" type="button" class="er-button">已核对当前资料，保留编辑</button></div>
            <p class="er-help">账号急救先服务；RM388 是战略与系统主题，不是解封课。课程宣传须有匹配需求和许可。使用 Cloud API 时还须核实服务窗口及核准模板。</p>
            <label class="er-check"><input id="er-reviewed" type="checkbox"><span>我已逐条核对问题、联系许可、课程适合度及文案事实；没有占位符、虚假优惠或效果保证。</span></label>
            <p id="er-guard" class="er-guard" role="status" aria-live="polite"></p>
            <div class="er-actions"><button id="er-copy" type="button" class="er-button">复制话术</button><button id="er-open" type="button" class="er-button er-whatsapp">打开 WhatsApp（预填）</button></div>
            <small>这里只准备内容，不会自动按发送。复制／打开聊天也不会标记已联系。</small>
            <section class="er-confirm"><h3>发完后再记录</h3><label class="er-check"><input id="er-sent-confirm" type="checkbox"><span>我已经在 WhatsApp 人工按发送，确认发给正确客户。</span></label><button id="er-sent" type="button" class="er-button er-primary">记录本次人工发送</button><p>首联记录后建议第 2 天跟进；第 2 天记录后建议第 5 天；第 5 天记录后自动暂停。本工具不会自动发提醒或客户消息。客户已回复、拒绝或退订时请及时更新阶段。</p></section>
          </section>
        <div class="er-navigation"><button id="er-prev" type="button" class="er-button">上一步</button><button id="er-next" type="button" class="er-button er-primary">下一步</button></div>
        <p id="er-status" role="status" aria-live="polite" class="er-status"></p>
      </div>`;
    document.body.appendChild(dialog);
    $("er-close").addEventListener("click", close);
    dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
    dialog.addEventListener("close", () => { prepared = ""; returnFocus?.focus(); });
    dialog.querySelectorAll("[data-er-step]").forEach(e => e.addEventListener("click", () => showStep(Number(e.dataset.erStep))));
    $("er-prev").addEventListener("click", () => showStep(currentStep - 1));
    $("er-next").addEventListener("click", () => showStep(currentStep + 1));
    PROFILE_FIELDS.forEach(key => $("er-" + key).addEventListener(key === "consentSource" ? "input" : "change", () => {
      if (key === "topic") $("er-pain").value = core.painForTopic($("er-topic").value);
      if (key === "pain") $("er-topic").value = core.PAINS[$("er-pain").value].topic;
      if (["topic", "pain", "sector", "route"].includes(key)) contextChanged(); else invalidate();
      $("er-eventVerified").checked = false;
      $("er-reoptinVerified").checked = false;
      if (key === "stage" && $("er-stage").value !== "contacted") { $("er-nextDate").value = ""; updateControls(); }
    }));
    $("er-template").addEventListener("change", () => {
      if ($("er-template").value === "all_in" || $("er-template").value === "upgrade") $("er-route").value = "all_in";
      if ($("er-template").value === "experience") $("er-route").value = "experience";
      contextChanged();
    });
    $("er-message").addEventListener("input", () => { draftEdited = true; invalidate(); });
    $("er-regenerate").addEventListener("click", () => { regenerate(); status("已按当前领域、痛点和课程重新生成；请逐句核对。"); });
    $("er-keep-draft").addEventListener("click", () => { draftBasis = contextSignature(); invalidate(); status("已保留编辑。仍需保存资料并逐条审核后才能打开聊天。"); });
    $("er-reviewed").addEventListener("change", updateControls);
    $("er-sent-confirm").addEventListener("change", updateControls);
    $("er-eventVerified").addEventListener("change", updateControls);
    $("er-reoptinVerified").addEventListener("change", updateControls);
    $("er-save").addEventListener("click", () => persist(false));
    $("er-sent").addEventListener("click", () => persist(true));
    $("er-copy").addEventListener("click", async () => {
      const reason = guard(); if (reason) return status(reason, true);
      try {
        const body = $("er-message").value;
        const copiedSignature = signature(), copiedId = activeId;
        await (adapters.copyText || (text => navigator.clipboard.writeText(text)))(body);
        if (!dialog.open || activeId !== copiedId || signature() !== copiedSignature) return;
        prepared = copiedSignature;
        status("话术已复制，尚未发送。请在 WhatsApp 检查后人工发送，再回来记录。");
        updateControls();
      } catch { status("未能复制。可在文本框手动复制；本工具没有发送消息。", true); }
    });
    $("er-open").addEventListener("click", () => {
      const reason = guard(); if (reason) return status(reason, true);
      const number = core.inspectPhone(leads.get(activeId)?.phone);
      const url = scope.WhatsappBulkCore.whatsappUrl(number.phone, $("er-message").value);
      try {
        (adapters.openChat || (href => scope.open(href, "_blank", "noopener,noreferrer")))(url);
        prepared = signature();
        status("已请求打开 WhatsApp；若浏览器阻挡，请检查弹窗设置。本工具未发送，发送后才勾选并记录。");
        updateControls();
      } catch { status("未能打开聊天，请检查浏览器；本工具未发送消息。", true); }
    });
  }
  function open(id) {
    const lead = leads.get(String(id));
    if (!lead || busy) return;
    ensureDialog();
    activeId = String(id); saved = core.readState(lead.replyFollowup); prepared = "";
    returnFocus = document.activeElement;
    $("er-name").textContent = String(lead.name || "未填写姓名");
    const number = core.inspectPhone(lead.phone);
    $("er-phone").textContent = number.valid ? scope.WhatsappBulkCore.maskPhone(number.phone) : "号码需核对";
    $("er-book").textContent = core.bookTitle(lead);
    $("er-industry").textContent = `工作领域：${String(lead.industry || "未填写")}`;
    $("er-challenge").textContent = `面对的挑战：${String(lead.challenge || "尚未填写问题，请先确认。")}`;
    PROFILE_FIELDS.forEach(key => { $("er-" + key).value = saved[key]; });
    if (saved.sector === "unknown") $("er-sector").value = core.inferSector(lead);
    if (saved.topic === "unknown") {
      $("er-pain").value = core.inferPain(lead); $("er-topic").value = core.PAINS[$("er-pain").value].topic;
    } else if (!Object.hasOwn(lead.replyFollowup || {}, "pain")) {
      const suggestedPain = core.inferPain(lead);
      if (core.PAINS[suggestedPain].topic === saved.topic) $("er-pain").value = suggestedPain;
    }
    if (["account", "ebook"].includes($("er-topic").value) && saved.route === "undecided") $("er-route").value = "service";
    $("er-reviewed").checked = false; $("er-sent-confirm").checked = false; $("er-eventVerified").checked = false; $("er-reoptinVerified").checked = false;
    $("er-template").value = $("er-topic").value === "account" ? "account" : $("er-topic").value === "ebook" ? "ebook" : saved.stage === "contacted" && saved.firstContactAt ? (saved.followupRound === 0 ? "follow2" : "follow5") : saved.stage === "experience_attended" ? "after388" : "personalized";
    regenerate();
    status("从 Step 1 开始核对已有资料；草稿不会自动存云端或发送。");
    dialog.showModal(); showStep(1, false); updateControls();
    $("er-step-title-1").focus();
  }
  function close() { if (!busy) dialog.close(); }
  async function persist(manualSent) {
    if (busy || uncertainIds.has(activeId)) return;
    if (manualSent && (guard() || prepared !== signature() || !$("er-sent-confirm").checked)) return status("请确认已实际人工发送；仅打开聊天／复制不能记作已发送。", true);
    let next;
    try {
      next = core.saveState(saved, formState(), {
        manualSent, templateId: $("er-template").value, message: $("er-message").value,
        phone: leads.get(activeId)?.phone, reviewed: $("er-reviewed").checked,
        eventVerified: $("er-eventVerified").checked,
        reoptinVerified: $("er-reoptinVerified").checked,
        actorId: typeof firebase !== "undefined" ? firebase.auth().currentUser?.uid : "",
      });
    } catch (error) { return status(error.message, true); }
    busy = true; updateControls(); status("正在等待云端确认保存…不会自动发送消息。");
    let timer;
    const id = activeId, revision = saved.revision;
    try {
      const save = adapters.saveFollowup || ((leadId, data, expected) => core.persistTransaction(typeof _db !== "undefined" ? _db : null, leadId, data, expected));
      await Promise.race([
        save(id, next, revision),
        new Promise((_, reject) => { timer = setTimeout(() => reject({ code: "save-timeout" }), 20000); }),
      ]);
      leads.get(id).replyFollowup = next; saved = next;
      PROFILE_FIELDS.forEach(key => { $("er-" + key).value = saved[key]; });
      prepared = ""; $("er-reviewed").checked = false; $("er-sent-confirm").checked = false; $("er-eventVerified").checked = false; $("er-reoptinVerified").checked = false;
      renderSummary(); refreshBadges();
      status(manualSent ? "人工发送记录已获云端确认；下次跟进日期已更新。本工具没有自动发送消息。" : "跟进资料已获云端确认；没有发送消息或标记人工发送。");
    } catch (error) {
      const code = String(error?.code || "save-unavailable").replace(/[^a-z0-9_/-]/gi, "").slice(0, 80);
      const messages = { "stale-followup": "另一位管理员已更新记录，请关闭并刷新后再处理。", "record-missing": "该记录已不存在，请关闭并刷新名单。", "save-timeout": "保存超时，结果尚未确认。请关闭并刷新名单，确认后再操作；不要重复记录发送。" };
      if (["save-timeout", "stale-followup", "record-missing"].includes(code)) uncertainIds.add(id);
      status(messages[code] || `云端保存未成功确认（代码：${code}）。没有改成本机成功记录；请核对管理员连接与权限。`, true);
    } finally { clearTimeout(timer); busy = false; updateControls(); }
  }
  function renderAction(lead) {
    return `<button type="button" class="mini-button er-row-button" data-ebook-reply-id="${escape(lead.id || "")}">WA · Reply</button><span class="er-row-state" data-ebook-reply-state="${escape(lead.id || "")}">${renderState(lead.replyFollowup)}</span>`;
  }
  function renderState(input) {
    const s = core.readState(input);
    return `${escape(core.STAGES[s.stage])}${s.nextDate ? `<small${core.isDue(s) ? ' class="er-due"' : ""}>${escape(s.nextDate)} MYT</small>` : ""}`;
  }
  function refreshBadges() {
    document.querySelectorAll("[data-ebook-reply-state]").forEach(e => { e.innerHTML = renderState(leads.get(e.dataset.ebookReplyState)?.replyFollowup); });
  }
  function renderSummary() {
    const box = $("ebookReplySummary"); if (!box) return;
    const states = [...leads.values()].map(l => core.readState(l.replyFollowup));
    box.textContent = `Reply SOP · 今天待人工跟进 ${states.filter(s => core.isDue(s)).length} · 联系许可待核实 ${states.filter(s => s.permission === "unknown").length} · All in 1 意向 ${states.filter(s => s.stage === "all_in_interested").length} · RM388 意向 ${states.filter(s => s.stage === "experience_interested").length}。点击每行 WA · Reply；不会自动发送。`;
  }
  function setLeads(items) {
    if (busy) return;
    leads.clear(); uncertainIds.clear();
    (items || []).forEach(l => leads.set(String(l.id), { ...l }));
    renderSummary();
  }
  document.addEventListener("click", event => {
    const button = event.target.closest?.("[data-ebook-reply-id]");
    if (button) open(button.dataset.ebookReplyId);
  });
  scope.EbookReplyUI = Object.freeze({ renderAction, setLeads, open, configure: value => { adapters = { ...value }; } });
})(globalThis);
