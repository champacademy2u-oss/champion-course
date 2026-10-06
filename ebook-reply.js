(function exposeEbookReplyUI(scope) {
  "use strict";
  const core = scope.EbookReplyCore;
  if (!core) return;
  const leads = new Map();
  const uncertainIds = new Set();
  let dialog, activeId = "", saved, busy = false, prepared = "", returnFocus;
  let adapters = {};
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const options = values => Object.entries(values).map(([value, label]) => `<option value="${value}">${escape(label)}</option>`).join("");
  const PROFILE_FIELDS = ["topic", "route", "permission", "stage", "consentSource", "nextDate"];
  function formState() {
    return core.readState({ ...saved, ...Object.fromEntries(PROFILE_FIELDS.map(key => [key, $("er-" + key).value])) });
  }
  function dirty() { const state = formState(); return PROFILE_FIELDS.some(key => state[key] !== saved[key]); }
  function signature() { return JSON.stringify([activeId, formState(), $("er-template").value, $("er-message").value]); }
  function status(text, error = false) {
    $("er-status").textContent = text;
    $("er-status").classList.toggle("is-error", error);
  }
  function guard() {
    if (busy) return "正在保存，请稍候。";
    if (uncertainIds.has(activeId)) return "上次保存尚未确认，请关闭并刷新 Ebook Leads 后再操作。";
    if (dirty()) return "跟进资料尚未保存：请先核实并保存联系许可、问题类别和阶段。";
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
    $("er-close").disabled = loading;
  }
  function invalidate() {
    prepared = "";
    $("er-reviewed").checked = false;
    $("er-sent-confirm").checked = false;
    updateControls();
  }
  function regenerate() {
    $("er-message").value = core.buildMessage($("er-template").value, leads.get(activeId), formState());
    invalidate();
  }
  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement("dialog");
    dialog.id = "ebookReplyDialog";
    dialog.className = "ebook-reply-dialog";
    dialog.setAttribute("aria-labelledby", "er-title");
    dialog.innerHTML = `
      <header class="er-header"><div><p class="er-eyebrow">CHAMP ACADEMY · EBOOK LEADS</p><h2 id="er-title">Reply SOP / WhatsApp 跟进</h2></div><button id="er-close" type="button" class="er-button" aria-label="关闭跟进面板">关闭</button></header>
      <div class="er-body">
        <p class="er-notice">RM4,997 All in 1 · RM388 三天线上孙子兵法。下一期日期、付款入口及抵扣政策尚未确认，话术不承诺旧日期、名额或保证解封。</p>
        <section class="er-context" aria-label="当前客户问题"><strong id="er-name"></strong><span id="er-phone"></span><span id="er-book"></span><p id="er-challenge"></p><small>客户原始问题只用于内部判断；系统建议仅为关键词归类，请人工确认。</small></section>
        <div class="er-grid">
          <section class="er-card"><h3>1. 确认问题与联系许可</h3>
            <label for="er-topic">问题类别</label><select id="er-topic">${options(core.TOPICS)}</select>
            <label for="er-route">当前课程路径</label><select id="er-route">${options(core.ROUTES)}</select>
            <label for="er-permission">联系许可</label><select id="er-permission">${options(core.PERMISSIONS)}</select>
            <label for="er-consentSource">许可来源／日期</label><input id="er-consentSource" maxlength="180" placeholder="例如：客户主动询问课程；已核实的表单同意及日期" autocomplete="off">
            <small>领取 Ebook 不等于课程营销同意。不要粘贴聊天原文、电话或身份证资料。</small>
            <label for="er-stage">当前阶段</label><select id="er-stage">${options(core.STAGES)}</select>
            <label for="er-nextDate">下次人工跟进日期（MYT）</label><input id="er-nextDate" type="date">
            <label id="er-event-wrap" class="er-check" hidden><input id="er-eventVerified" type="checkbox"><span>我已核实对应付款或实际出席，不以已读或付款截图代替对账。</span></label>
            <label id="er-restore-wrap" class="er-check" hidden><input id="er-reoptinVerified" type="checkbox"><span>退订后客户已给出新的明确同意；我已更新许可来源，再恢复相应联系范围。</span></label>
            <button id="er-save" type="button" class="er-button er-primary">保存跟进资料</button>
            <small id="er-last"></small>
          </section>
          <section class="er-card"><h3>2. 预览并修改回复</h3>
            <label for="er-template">Reply SOP 话术</label><select id="er-template">${core.TEMPLATES.map(t => `<option value="${t.id}">${escape(t.label)}</option>`).join("")}</select>
            <label for="er-message">准备发送的内容（可修改，最多 3000 字）</label><textarea id="er-message" maxlength="3000" rows="12" spellcheck="false"></textarea>
            <p class="er-help">账号急救先服务；RM388 是战略与系统主题，不是解封课。课程宣传须有匹配需求和许可。使用 Cloud API 时还须核实服务窗口及核准模板。</p>
            <label class="er-check"><input id="er-reviewed" type="checkbox"><span>我已逐条核对问题、联系许可、课程适合度及文案事实；没有占位符、虚假优惠或效果保证。</span></label>
            <p id="er-guard" class="er-guard" role="status" aria-live="polite"></p>
            <div class="er-actions"><button id="er-copy" type="button" class="er-button">复制话术</button><button id="er-open" type="button" class="er-button er-whatsapp">打开 WhatsApp（预填）</button></div>
            <small>这里只准备内容，不会自动按发送。复制／打开聊天也不会标记已联系。</small>
          </section>
        </div>
        <section class="er-confirm"><h3>3. 发完后再记录</h3><label class="er-check"><input id="er-sent-confirm" type="checkbox"><span>我已经在 WhatsApp 人工按发送，确认发给正确客户。</span></label><button id="er-sent" type="button" class="er-button er-primary">记录本次人工发送</button><p>首联记录后建议第 2 天跟进；第 2 天记录后建议第 5 天；第 5 天记录后自动暂停。本工具不会自动发提醒或客户消息。客户已回复、拒绝或退订时请及时更新阶段。</p></section>
        <p id="er-status" role="status" aria-live="polite" class="er-status"></p>
      </div>`;
    document.body.appendChild(dialog);
    $("er-close").addEventListener("click", close);
    dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
    dialog.addEventListener("close", () => { prepared = ""; returnFocus?.focus(); });
    PROFILE_FIELDS.forEach(key => $("er-" + key).addEventListener(key === "consentSource" ? "input" : "change", () => {
      if (key === "topic") regenerate(); else invalidate();
      $("er-eventVerified").checked = false;
      $("er-reoptinVerified").checked = false;
      if (key === "stage" && $("er-stage").value !== "contacted") { $("er-nextDate").value = ""; updateControls(); }
    }));
    $("er-template").addEventListener("change", () => {
      if ($("er-template").value === "all_in" || $("er-template").value === "upgrade") $("er-route").value = "all_in";
      if ($("er-template").value === "experience") $("er-route").value = "experience";
      regenerate();
    });
    $("er-message").addEventListener("input", invalidate);
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
    $("er-challenge").textContent = String(lead.challenge || "尚未填写问题，请先确认。");
    PROFILE_FIELDS.forEach(key => { $("er-" + key).value = saved[key]; });
    if (saved.topic === "unknown") $("er-topic").value = core.inferTopic(lead);
    $("er-reviewed").checked = false; $("er-sent-confirm").checked = false; $("er-eventVerified").checked = false; $("er-reoptinVerified").checked = false;
    $("er-template").value = saved.topic === "account" || core.inferTopic(lead) === "account" ? "account" : saved.topic === "ebook" ? "ebook" : saved.stage === "contacted" && saved.firstContactAt ? (saved.followupRound === 0 ? "follow2" : "follow5") : saved.stage === "experience_attended" ? "after388" : "first";
    $("er-message").value = core.buildMessage($("er-template").value, lead, formState());
    status("先确认问题和联系许可，再保存跟进资料。草稿内容不会自动存入云端或发送。");
    dialog.showModal(); updateControls();
    $("er-topic").focus();
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
