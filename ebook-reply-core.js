(function exposeEbookReplyCore(scope) {
  "use strict";
  const TOPICS = Object.freeze({ unknown: "待确认问题", account: "WhatsApp 账号受限／安全", traffic: "获客引流", closing: "跟进成交", growth: "业绩增长", strategy: "竞争与经营方向", team: "团队与企业系统", ebook: "电子书领取问题" });
  const SECTORS = Object.freeze({ unknown: "待确认工作领域", unspecified: "未填写／不提行业", beauty: "美容／美业", wellness: "保健／Wellness", food: "餐饮", property: "房产", training: "培训／咨询", ecommerce: "电商", retail: "零售", service: "专业服务", insurance: "保险／代理", marketing_role: "营销工作领域" });
  const PAINS = Object.freeze(Object.fromEntries(Object.entries({
    unknown: ["unknown", "待确认具体痛点", "表单描述太笼统时，只补问一个必要问题，不重新问行业和整份挑战。"],
    traffic_low: ["traffic", "新询问／客户来源少", "可以先区分新客户来源与进来后的成交环节，确定先看哪一个入口，不直接把原因归结为广告预算。"],
    traffic_quality: ["traffic", "询问多，但不精准", "可以先看询问对象、真实需求和下一步是否匹配，不把增加询问数量当作唯一目标。"],
    closing_no_reply: ["closing", "客户不回复／已读不回", "可以先把完全没回复和有回复但未决定分开，两组下一句跟进不同，不是连续多发几条消息。"],
    closing_quote: ["closing", "报价／咨询后成交少", "可以先检查需求确认、方案说明与下一步是否清楚，再看报价后的跟进，不一定先增加广告。"],
    growth: ["growth", "想提升业绩／增长", "可以先把获客、成交和团队执行分开，找最影响增长的一环；目标本身还不足以证明问题原因。"],
    price_war: ["strategy", "价格战／竞争压力", "可以先看客户是否理解适合对象、服务范围和区别，再判断经营重点，不急着靠降价解决。"],
    strategy: ["strategy", "经营方向／定位不清", "可以先选一个最影响生意的经营判断，把现有优势、竞争情况和下一动作分清。"],
    team: ["team", "团队执行／企业系统", "可以先对照一个任务是否有负责人、清楚步骤和完成标准，不把所有责任都归到员工态度。"],
    account: ["account", "账号被封／限制／安全", "先处理账号问题；审核结果由平台决定，不保证解封、不索要密码或 OTP，课程介绍与账号处理分开。"],
    ebook: ["ebook", "电子书领取／下载问题", "先处理资料领取，截图遮住个人资料；免费电子书不以购买课程为条件。"],
  }).map(([id, [topic, label, angle]]) => [id, Object.freeze({ topic, label, angle })])));
  const ROUTES = Object.freeze({ undecided: "待确认适合度", all_in: "RM4,997 All in 1", experience: "RM388 企业孙子兵法", service: "先处理资料／账号问题" });
  const PERMISSIONS = Object.freeze({ unknown: "未核实联系许可", inbound: "客户主动咨询：只回复当次问题", marketing: "已核实 WhatsApp 课程营销同意", opted_out: "已退订／拒绝联系" });
  const STAGES = Object.freeze({ new: "未开始", contacted: "已人工首联", replied: "客户已回复", qualified: "需求已确认", all_in_interested: "All in 1 意向", experience_interested: "RM388 意向", payment_pending: "待付款核实", all_in_paid: "All in 1 已核实付款", experience_paid: "RM388 已核实付款", experience_attended: "RM388 已核实出席", paused: "暂停跟进", unsuitable: "暂不适合", opted_out: "已退订" });
  const STOP_STAGES = new Set(["all_in_paid", "experience_paid", "paused", "unsuitable", "opted_out"]);
  const VERIFIED_STAGES = new Set(["all_in_paid", "experience_paid", "experience_attended"]);
  const TEMPLATES = Object.freeze([
    { id: "personalized", label: "五步个性化：领域＋痛点＋Ryan课程 CTA", marketing: true, course: true, personalized: true, first: true },
    { id: "first", label: "首联：确认目前问题", marketing: true },
    { id: "diagnose", label: "诊断：客户少还是不成交", marketing: false },
    { id: "account", label: "服务：账号限制／官方审核", marketing: false },
    { id: "ebook", label: "服务：下载问题", marketing: false },
    { id: "all_in", label: "推荐 RM4,997 All in 1", marketing: true, course: true },
    { id: "experience", label: "推荐 RM388 三天孙子兵法", marketing: true, course: true },
    { id: "price", label: "回应：直接说明两种价格", marketing: true, course: true },
    { id: "budget", label: "异议：预算还是适合度", marketing: true },
    { id: "terms", label: "回应：分期／抵扣待负责人确认", marketing: false },
    { id: "follow2", label: "未回复：第 2 天跟进", marketing: true, course: true },
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
    const topic = choice(s.topic, TOPICS, "unknown");
    const pain = choice(s.pain, PAINS, painForTopic(topic));
    return {
      version: 1, revision: Math.max(0, Math.floor(Number(s.revision) || 0)),
      topic, pain: PAINS[pain].topic === topic ? pain : painForTopic(topic),
      sector: choice(s.sector, SECTORS, "unknown"), route: choice(s.route, ROUTES, "undecided"),
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
  function painForTopic(topic) {
    return { unknown: "unknown", account: "account", ebook: "ebook", traffic: "traffic_low", closing: "closing_quote", growth: "growth", strategy: "strategy", team: "team" }[topic] || "unknown";
  }
  function inferSector(lead = {}) {
    const value = String(lead.industry || "").trim();
    if (!value) return "unspecified";
    const patterns = {
      beauty: /美容|美业|beauty|facial|salon/i, wellness: /保健|健康|养生|wellness|health/i,
      food: /餐饮|餐厅|饮食|restaurant|cafe|café|f&b|food/i,
      property: /房产|房地产|地产|property|real.?estate/i,
      training: /培训|教育|讲师|教练|咨询|training|education|coach|consult/i,
      ecommerce: /电商|电子商务|e.?commerce|online.?shop/i,
      retail: /零售|retail/i, service: /专业服务|法律|会计|设计|维修|accounting|legal|design|repair/i,
      insurance: /保险|insurance|takaful/i, marketing_role: /营销|市场推广|marketing/i,
    };
    const found = Object.entries(patterns).filter(([, pattern]) => pattern.test(value)).map(([key]) => key);
    return found.length === 1 ? found[0] : "unknown";
  }
  function inferPain(lead = {}) {
    const text = String(lead.challenge || "");
    const topic = inferTopic(lead);
    if (topic === "account" || topic === "ebook") return topic;
    if (/(?:询问|客户|线索|流量).*(?:不精准|不精确|质量|不合适)|(?:不精准|不精确).*(?:客户|询问|线索)|(?:lead|inquir).*(?:low.?quality|unqualified|not.?qualified)|(?:low.?quality|unqualified|not.?qualified).*(?:lead|inquir)/i.test(text)) return "traffic_quality";
    if (/不回复|不回|已读|\b(?:no.?reply|not.?reply(?:ing)?|unread)\b|left.?on.?seen/i.test(text)) return "closing_no_reply";
    if (/比价|价格战|price.?war|compare.?price/i.test(text)) return "price_war";
    return painForTopic(topic);
  }
  function inferTopic(lead = {}) {
    const text = String(lead.challenge || "");
    if (/\b(?:ban(?:ned)?|block(?:ed)?|hacked)\b|被封|封禁|封号|被盗|账号受限/i.test(text)) return "account";
    if (/下载|领取|download/i.test(text)) return "ebook";
    if (/不回复|不回|已读|成交|closing|conversion|follow.?up|报价/i.test(text)) return "closing";
    if (/团队|员工|管理|staff|team|系统|sop/i.test(text)) return "team";
    if (/竞争|定位|策略|战略|方向|比价|价格战|strategy|competition|price.?war/i.test(text)) return "strategy";
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
  function angleText(input = {}) {
    const s = readState(input);
    const extras = {
      beauty: "美容业务可对照从询问、方案说明到预约／购买的阶段；这是检查方向，不是已确认的原因。",
      wellness: "保健业务先对照客户需求与沟通环节，不推测产品、营收或健康状况。",
      food: "餐饮可分开看新客来源、到店与回头客，选一个主要环节。",
      property: "房产咨询可先对照购买意向与时间计划，不索取银行资料或身份证。",
      training: "培训／咨询可检查是否讲清适合对象、内容、学习要求和报名下一步。",
      ecommerce: "电商可分开看入口、询问／浏览和购买阶段，避免把全部问题当作流量少。",
      retail: "零售可分开看新客、咨询／到店和购买阶段，先选一个卡点。",
      service: "专业服务可对照服务范围、适合对象和差异，避免只剩下价格比较。",
      insurance: "保险／代理可先看需求沟通和跟进环节，不索取客户财务或健康资料。",
      marketing_role: "营销工作领域不能直接推定为企业老板；先对照本人负责的环节。",
    };
    return `${PAINS[s.pain].angle}${!["unknown", "account", "ebook"].includes(s.topic) && extras[s.sector] ? `\n${extras[s.sector]}` : ""}`;
  }
  function courseText(input = {}) {
    const s = readState(input);
    if (s.route === "experience") return "如果你想先体验 Ryan 大神的教学，也对经营策略、团队或企业系统有兴趣，我想邀请你参加 RM388《企业孙子兵法》3 天线上课程。它不是完整 All in 1，也不是解封服务。";
    if (s.route !== "all_in") return "先确认匹配的学习需要与课程路径，再邀请参加；资料领取或账号急救先服务。";
    const modules = { traffic: "无限引流", closing: "收网系统", growth: "获客、成交与执行相关内容", strategy: "企业孙子兵法", team: "企业孙子兵法与无限杠杆" }[s.topic] || "相关内容";
    return `如果你想系统学习，我想邀请你参加 Ryan 大神的 All in 1，RM4,997。\n先把「${modules}」的实际大纲与你的需要对照；完整组合包括无限杠杆、企业孙子兵法、无限引流和收网系统，不承诺业绩结果。`;
  }
  function followupAngle(input = {}) {
    const s = readState(input);
    return {
      traffic_low: "可以用一张简表记录：客户从哪里来、是否询问、是否走到下一步，先观察哪一段需要检查。",
      traffic_quality: "下次有新询问时，可先核对适合对象、想解决的事和下一步；不用向客户索取私人文件。",
      closing_no_reply: "可把未回复与有回复但未决定的客户分组，分别准备一条有新信息的跟进；对方拒绝就停止。",
      closing_quote: "可检查一次报价后的回复有没有讲清服务范围、适合对象和下一步，不只再次追问付款。",
      growth: "可先写一个当前目标，再分别记录获客、成交、执行三个环节的现况，避免一次改变所有环节。",
      price_war: "可试着用三句话讲清：适合谁、服务包含什么、与你目前竞争对象有何可核实的区别。",
      strategy: "可先写下一个要决定的经营问题、已有事实及可执行的下一动作，分清事实与猜测。",
      team: "可先选一个重复任务，写清负责人、步骤、完成标准和检查时间，再观察执行情况。",
    }[s.pain] || "先对照一个具体环节和下一动作；若资料领取或账号问题仍未解决，应先处理服务。";
  }
  function buildMessage(id, lead = {}, input = {}) {
    const s = readState(input), topic = TOPICS[s.topic];
    const problem = s.topic === "unknown" ? "你目前的生意问题" : `「${topic}」`;
    const book = bookTitle(lead);
    const sector = !["unknown", "unspecified"].includes(s.sector) ? `根据你填写的资料，你的工作涉及「${SECTORS[s.sector]}」，` : "";
    const focus = PAINS[s.pain].label;
    const messages = {
      personalized: `Hi，你好 😊 我是 Champ Academy 的课程顾问。\n你之前申请过${book.includes("未标记") ? "学习资料" : `《${book}》`}。${sector}也提到「${focus}」。\n\n${angleText(s)}\n\n${courseText(s)}\n\n要我把与你这个问题相关的课程内容、上课安排和报名资料发给你吗？\n如不想接收课程信息，回复「停止」即可。`,
      first: `Hi，你好 😊 我是 Champ Academy 的课程顾问。\n你之前向我们索取过${book.includes("未标记") ? "学习资料" : `《${book}》`}，也同意我们通过 WhatsApp 跟进。\n想确认一下，${problem}现在还有影响你的生意吗？\n如果不想继续接收课程信息，回复「停止」即可。`,
      diagnose: "明白，我们先分开看：你目前是没有人来询问，还是有人询问但没有成交？\n先分清卡点，再看下一步。",
      account: "明白，账号受限会影响跟客户沟通。\n你看到的是封禁提示，还是某个功能被限制？如果 app 有「Request a review／申请审核」，先按 WhatsApp 官方流程申请；结果由 WhatsApp 决定，我们不能保证解封。\n不要提供验证码或密码给任何人。",
      ebook: "没问题，我们先处理资料领取。\n你是填写后出现错误，还是看到下载按钮但下载没有开始？\n如需发截图，请先遮住个人资料，只发错误提示部分。你不需要报名付费课程才能领取免费电子书。",
      all_in: `根据你已确认想改善的${problem}，我建议你先了解 All in 1，RM4,997。\n它组合了无限杠杆、企业孙子兵法、无限引流、收网系统四个部分。\n我会帮你对照大纲，确认哪些内容与你的需求相关。\n我先发本期课程内容和上课安排给你，好吗？`,
      experience: "如果你想先体验 Ryan 老师的教学，也对经营策略和团队系统有兴趣，可以先了解 RM388《企业孙子兵法》3 天线上课程。\n主题包括知彼知己、练兵与企业系统化、风林火山的行动节奏。它不是 WhatsApp 解封服务，也不是 All in 1 全部内容。\n要我发下一期三天安排给你吗？",
      price: "All in 1 是 RM4,997。\n如果想先体验 Ryan 老师的教学，并有经营策略、团队或企业系统的学习需要，可以了解 RM388 的三天线上《企业孙子兵法》；两者内容不同，不默认抵扣。\n我先帮你对照课程内容与安排，好吗？",
      budget: "明白，RM4,997 需要认真考虑。\n你比较担心当前预算，还是还不确定内容值不值得、适不适合？\n我先把你最需要确认的那一点讲清楚。",
      terms: "付款、升级抵扣和退款／转期以本期官方条款为准。\n我先向负责人确认，再回复你，避免给你错误信息。",
      follow2: `Hi，你好。之前你提到想改善${problem}，补充一个小检查：\n${followupAngle(s)}\n如果你想学习 Ryan 大神课程的相关内容，需要我发大纲与安排给你吗？如暂时不需要，我先暂停跟进。`,
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
    if ((id === "first" || t.first) && s.firstContactAt) return "首联已经记录，请使用对应跟进或问题回复，避免重复首联。";
    if (!s.consentSource) return "请记下联系许可来源／日期（不要粘贴聊天原文）。";
    if (t.marketing && s.permission !== "marketing") return "当前仅有当次咨询许可；这条课程话术还需要明确营销同意。";
    if (t.marketing && STOP_STAGES.has(s.stage)) return "当前阶段应停止课程追踪；核实新的咨询或意向后再调整阶段。";
    if (t.attended && s.stage !== "experience_attended") return "只有已核实 RM388 出席后，才使用课后／升级话术。";
    if (t.course && s.topic === "account") return "账号抢救与课程学习需分开；先确认客户另有匹配的学习需求并调整问题类别。";
    if (t.course && s.topic === "ebook") return "先处理免费电子书领取；另有匹配学习需求才介绍课程。";
    if ((id === "experience" || (t.personalized && s.route === "experience")) && !["strategy", "team"].includes(s.topic)) return "RM388 是战略、团队与企业系统主题；请先确认这类学习需要，不因低价自动推荐。";
    if (t.personalized) {
      if (s.sector === "unknown" || s.pain === "unknown") return "请先确认表单工作领域和主痛点；没有领域资料时选「未填写／不提行业」，不要猜测。";
      if (!["all_in", "experience"].includes(s.route)) return "请先选择匹配的 Ryan 课程路径；仅服务问题不使用课程邀请草稿。";
    }
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
      if (options.templateId === "first" || template(options.templateId)?.first) {
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
  scope.EbookReplyCore = Object.freeze({ TOPICS, SECTORS, PAINS, ROUTES, PERMISSIONS, STAGES, TEMPLATES, VERIFIED_STAGES, readState, painForTopic, inferTopic, inferSector, inferPain, angleText, courseText, followupAngle, bookTitle, buildMessage, inspectPhone, contactGuard, saveState, isDue, mytDate, addDays, persistTransaction });
})(globalThis);
