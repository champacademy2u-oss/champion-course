(function exposeEbookReplyCore(scope) {
  "use strict";
  const TOPICS = Object.freeze({ unknown: "待确认问题", account: "WhatsApp 账号受限／安全", traffic: "获客引流", closing: "跟进成交", growth: "业绩增长", strategy: "竞争与经营方向", team: "团队与企业系统", ebook: "电子书领取问题" });
  const ROUTES = Object.freeze({ undecided: "待确认适合度", all_in: "RM4,997 All in 1", experience: "RM388 企业孙子兵法", service: "先处理资料／账号问题" });
  const PERMISSIONS = Object.freeze({ unknown: "未核实联系许可", inbound: "客户主动咨询：只回复当次问题", marketing: "已核实 WhatsApp 课程营销同意", opted_out: "已退订／拒绝联系" });
  const STAGES = Object.freeze({ new: "未开始", contacted: "已人工首联", replied: "客户已回复", qualified: "需求已确认", all_in_interested: "All in 1 意向", experience_interested: "RM388 意向", payment_pending: "待付款核实", all_in_paid: "All in 1 已核实付款", experience_paid: "RM388 已核实付款", experience_attended: "RM388 已核实出席", paused: "暂停跟进", unsuitable: "暂不适合", opted_out: "已退订" });
  const STOP_STAGES = new Set(["all_in_paid", "experience_paid", "paused", "unsuitable", "opted_out"]);
  const VERIFIED_STAGES = new Set(["all_in_paid", "experience_paid", "experience_attended"]);
  const TEMPLATES = Object.freeze([
    { id: "first", label: "首联：确认目前问题", marketing: true },
    { id: "diagnose", label: "诊断：客户少还是不成交", marketing: false },
    { id: "account", label: "服务：账号限制／官方审核", marketing: false },
    { id: "ebook", label: "服务：下载问题", marketing: false },
    { id: "all_in", label: "推荐 RM4,997 All in 1", marketing: true, course: true },
    { id: "experience", label: "推荐 RM388 三天孙子兵法", marketing: true, course: true },
    { id: "price", label: "回应：直接说明两种价格", marketing: true, course: true },
    { id: "budget", label: "异议：预算还是适合度", marketing: true },
    { id: "terms", label: "回应：分期／抵扣待负责人确认", marketing: false },
    { id: "follow2", label: "未回复：第 2 天跟进", marketing: true },
    { id: "follow5", label: "未回复：第 5 天最后一次", marketing: true },
    { id: "after388", label: "出席后：先问学习应用", marketing: false, attended: true },
    { id: "upgrade", label: "出席后：介绍 All in 1", marketing: true, course: true, attended: true },
  ]);
  const clean = (value, max = 180) => String(value || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max);
  const choice = (value, options, fallback) => Object.hasOwn(options, value) ? value : fallback;
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  function mytDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  function addDays(value, days) {
    if (!validDate(value)) return "";
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
  function readState(raw = {}) {
    const s = raw && typeof raw === "object" ? raw : {};
    return {
      version: 1, revision: Math.max(0, Math.floor(Number(s.revision) || 0)),
      topic: choice(s.topic, TOPICS, "unknown"), route: choice(s.route, ROUTES, "undecided"),
      permission: choice(s.permission, PERMISSIONS, "unknown"), stage: choice(s.stage, STAGES, "new"),
      consentSource: clean(s.consentSource), nextDate: validDate(s.nextDate) ? s.nextDate : "",
      firstContactAt: Number.isNaN(Date.parse(s.firstContactAt)) ? "" : clean(s.firstContactAt, 35),
      lastContactAt: Number.isNaN(Date.parse(s.lastContactAt)) ? "" : clean(s.lastContactAt, 35),
      followupRound: Math.min(2, Math.max(0, Math.floor(Number(s.followupRound) || 0))),
      lastTemplate: TEMPLATES.some(t => t.id === s.lastTemplate) ? s.lastTemplate : "",
      optedOutAt: clean(s.optedOutAt, 35), restoredAt: clean(s.restoredAt, 35),
      updatedAt: clean(s.updatedAt, 35), updatedBy: clean(s.updatedBy, 128),
    };
  }
  function inferTopic(lead = {}) {
    const text = String(lead.challenge || "");
    if (/\bban(?:ned)?\b|被封|封禁|封号|被盗|hacked|账号受限|block/i.test(text)) return "account";
    if (/下载|领取|download/i.test(text)) return "ebook";
    if (/不回复|不回|已读|成交|closing|conversion|follow.?up|报价/i.test(text)) return "closing";
    if (/团队|员工|管理|staff|team|系统|sop/i.test(text)) return "team";
    if (/竞争|定位|策略|战略|方向|strategy|competition/i.test(text)) return "strategy";
    if (/流量|获客|客源|引流|广告|推广|advert|lead|traffic|marketing/i.test(text)) return "traffic";
    if (/业绩|营业额|增长|利润|revenue|growth|100mil|提升/i.test(text)) return "growth";
    return "unknown";
  }
  function bookTitle(lead = {}) {
    if (lead.ebookId === "whatsapp-account-safety") return "WhatsApp Ebook";
    if (lead.ebookId === "world-class-marketing-100") return "世界级营销100招";
    return "学习资料（来源未标记）";
  }
  function template(id) { return TEMPLATES.find(t => t.id === id); }
  function buildMessage(id, lead = {}, input = {}) {
    const s = readState(input), topic = TOPICS[s.topic];
    const problem = s.topic === "unknown" ? "你目前的生意问题" : `「${topic}」`;
    const book = bookTitle(lead);
    const messages = {
      first: `Hi，你好 😊 我是 Champ Academy 的课程顾问。\n你之前向我们索取过${book.includes("未标记") ? "学习资料" : `《${book}》`}，也同意我们通过 WhatsApp 跟进。\n想确认一下，${problem}现在还有影响你的生意吗？\n如果不想继续接收课程信息，回复「停止」即可。`,
      diagnose: "明白，我们先分开看：你目前是没有人来询问，还是有人询问但没有成交？\n先分清卡点，再看下一步。",
      account: "明白，账号受限会影响跟客户沟通。\n你看到的是封禁提示，还是某个功能被限制？如果 app 有「Request a review／申请审核」，先按 WhatsApp 官方流程申请；结果由 WhatsApp 决定，我们不能保证解封。\n不要提供验证码或密码给任何人。",
      ebook: "没问题，我们先处理资料领取。\n你是填写后出现错误，还是看到下载按钮但下载没有开始？\n如需发截图，请先遮住个人资料，只发错误提示部分。你不需要报名付费课程才能领取免费电子书。",
      all_in: `根据你已确认想改善的${problem}，我建议你先了解 All in 1，RM4,997。\n它组合了无限杠杆、企业孙子兵法、无限引流、收网系统四个部分。\n我会帮你对照大纲，确认哪些内容与你的需求相关。\n我先发本期课程内容和上课安排给你，好吗？`,
      experience: "如果你想先体验 Ryan 老师的教学，也对经营策略和团队系统有兴趣，可以先了解 RM388《企业孙子兵法》3 天线上课程。\n主题包括知彼知己、练兵与企业系统化、风林火山的行动节奏。它不是 WhatsApp 解封服务，也不是 All in 1 全部内容。\n要我发下一期三天安排给你吗？",
      price: "All in 1 是 RM4,997。\n如果想先体验教学，可以了解 RM388 的三天线上《企业孙子兵法》。\n你想先看哪一项的内容和安排？",
      budget: "明白，RM4,997 需要认真考虑。\n你比较担心当前预算，还是还不确定内容值不值得、适不适合？\n我先把你最需要确认的那一点讲清楚。",
      terms: "付款、升级抵扣和退款／转期以本期官方条款为准。\n我先向负责人确认，再回复你，避免给你错误信息。",
      follow2: `Hi，你好。之前你提到想改善${problem}，目前还需要我帮你对照课程内容吗？\n如果暂时不需要，我先暂停跟进。`,
      follow5: "我先暂停这次课程跟进，不再连续打扰。\n以后想了解 All in 1 或孙子兵法，随时回复我就可以；不想接收课程信息也可以回复「停止」。",
      after388: "谢谢你参加《企业孙子兵法》😊\n这次你觉得最有用的是哪个部分？你准备先用在生意的哪一步？",
      upgrade: `你提到还想进一步学习${problem}。\nAll in 1 除了企业孙子兵法，还组合了无限杠杆、无限引流和收网系统，价格是 RM4,997。\n我先把相关内容与本期安排整理给你，再判断是否适合。你要继续了解吗？`,
    };
    return messages[id] || "";
  }
  function inspectPhone(value) {
    const normal = scope.WhatsappBulkCore?.normalizeMalaysiaPhone(value);
    if (!normal?.valid) return { valid: false, phone: "", reason: "号码格式异常，请先核对；不要猜测或换号联系。" };
    const phone = normal.phone;
    if (phone.startsWith("60") && !/^60(?:1\d{8,9}|[3-9]\d{7,8})$/.test(phone)) return { valid: false, phone: "", reason: "马来西亚号码长度或区号异常，请核对是否重复添加 +60。" };
    const subscriber = phone.startsWith("60") ? phone.slice(2) : phone;
    if (/^0+$/.test(subscriber) || /0{7,}$/.test(subscriber)) return { valid: false, phone: "", reason: "号码明显无效，请先核对。" };
    return { valid: true, phone, reason: "" };
  }
  function contactGuard(input, id, message, phone, reviewed, options = {}) {
    const s = readState(input), t = template(id);
    if (!t) return "请选择有效话术。";
    if (s.permission === "opted_out" || s.stage === "opted_out") return "客户已拒绝／退订，不再打开营销聊天。";
    if (s.permission === "unknown") return "尚未核实联系许可；领取 Ebook 不等于同意课程营销。";
    if (id === "first" && s.firstContactAt) return "首联已经记录，请使用对应跟进或问题回复，避免重复首联。";
    if (!s.consentSource) return "请记下联系许可来源／日期（不要粘贴聊天原文）。";
    if (t.marketing && s.permission !== "marketing") return "当前仅有当次咨询许可；这条课程话术还需要明确营销同意。";
    if (t.marketing && STOP_STAGES.has(s.stage)) return "当前阶段应停止课程追踪；核实新的咨询或意向后再调整阶段。";
    if (t.attended && s.stage !== "experience_attended") return "只有已核实 RM388 出席后，才使用课后／升级话术。";
    if (t.course && s.topic === "account") return "账号抢救与课程学习需分开；先确认客户另有匹配的学习需求并调整问题类别。";
    if (id === "follow2" || id === "follow5") {
      if (!s.firstContactAt || s.stage !== "contacted") return "仅用于已人工首联且仍未回复的客户。";
      if (id === "follow2" && s.followupRound !== 0) return "第 2 天跟进已记录，不重复发送。";
      if (id === "follow5" && s.followupRound !== 1) return "请按首联 → 第 2 天 → 第 5 天顺序记录，避免重复追踪。";
      const due = addDays(mytDate(s.firstContactAt), id === "follow2" ? 2 : 5);
      const today = options.today || mytDate();
      if (today < due || (s.nextDate && today < s.nextDate)) return "尚未到已约定的跟进日期；不要提前连续追踪。";
    }
    const body = String(message || "").trim();
    if (!body || body.length > 3000) return "话术须为 1–3000 字，请人工检查。";
    if (/\uFFFD|\{\{[^}]*\}\}/.test(body)) return "话术有损坏字符或未替换占位符，请先修改。";
    const number = inspectPhone(phone);
    if (!number.valid) return number.reason;
    if (!reviewed) return "请逐条确认问题、许可、课程事实及文案；打开聊天不会自动发送。";
    return "";
  }
  function saveState(previous, draft, options = {}) {
    const old = readState(previous), next = readState(draft);
    const now = new Date(options.now || Date.now()).toISOString();
    for (const field of ["firstContactAt", "lastContactAt", "followupRound", "lastTemplate", "optedOutAt", "restoredAt"]) next[field] = old[field];
    if ((old.permission === "opted_out" || old.stage === "opted_out") && next.permission !== "opted_out" && next.stage !== "opted_out") {
      if (!options.reoptinVerified || !next.consentSource || next.consentSource === old.consentSource) throw new Error("退订后须核实新的明确同意、更新来源并确认恢复，不能直接重新推销。 ");
      next.restoredAt = now;
    }
    if (next.permission === "marketing" && !next.consentSource) throw new Error("营销同意需要记录来源／日期，不能仅因为领过 Ebook 就勾选。 ");
    if (VERIFIED_STAGES.has(next.stage) && next.stage !== old.stage && !options.eventVerified) throw new Error("付款／出席阶段须先人工核实，再勾选确认。 ");
    if (next.permission === "opted_out" || next.stage === "opted_out") { next.permission = "opted_out"; next.stage = "opted_out"; next.optedOutAt = old.optedOutAt || now; }
    if (next.stage !== old.stage && next.stage !== "contacted" && next.nextDate === old.nextDate) next.nextDate = "";
    if (options.manualSent) {
      const reason = contactGuard(next, options.templateId, options.message, options.phone, options.reviewed, { today: mytDate(now) });
      if (reason) throw new Error(reason);
      next.firstContactAt = old.firstContactAt || now;
      next.lastContactAt = now;
      next.lastTemplate = options.templateId;
      if (next.stage === "new") next.stage = "contacted";
      if (options.templateId === "first") {
        if (old.firstContactAt) throw new Error("首联已经记录，请使用跟进或其他对应话术。 ");
        next.followupRound = 0;
        next.nextDate = next.permission === "marketing" ? addDays(mytDate(now), 2) : "";
      } else if (options.templateId === "follow2") {
        next.followupRound = 1;
        next.nextDate = addDays(mytDate(next.firstContactAt), 5);
        if (next.nextDate < mytDate(now)) next.nextDate = addDays(mytDate(now), 1);
      } else if (options.templateId === "follow5") {
        next.followupRound = 2;
        next.stage = "paused";
        next.nextDate = "";
      }
    }
    if (STOP_STAGES.has(next.stage) || next.permission !== "marketing") next.nextDate = "";
    next.revision = old.revision + 1;
    next.updatedAt = now;
    next.updatedBy = clean(options.actorId, 128);
    return next;
  }
  function isDue(input, today = mytDate()) {
    const s = readState(input);
    return s.permission === "marketing" && !STOP_STAGES.has(s.stage) && !!s.nextDate && s.nextDate <= today;
  }
  async function persistTransaction(db, leadId, next, expectedRevision) {
    if (!db?.runTransaction || !leadId || String(leadId).includes("/")) throw new Error("管理员云端连接不可用；未保存，也不会自动改成本机记录。 ");
    const ref = db.collection("landing_leads").doc(String(leadId));
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw Object.assign(new Error("记录已不存在，请刷新名单。"), { code: "record-missing" });
      if (readState(snapshot.data().replyFollowup).revision !== expectedRevision) throw Object.assign(new Error("其他管理员已更新这条跟进，请刷新后再处理。"), { code: "stale-followup" });
      transaction.update(ref, { replyFollowup: next });
    });
    return next;
  }
  scope.EbookReplyCore = Object.freeze({ TOPICS, ROUTES, PERMISSIONS, STAGES, TEMPLATES, VERIFIED_STAGES, readState, inferTopic, bookTitle, buildMessage, inspectPhone, contactGuard, saveState, isDue, mytDate, addDays, persistTransaction });
})(globalThis);
