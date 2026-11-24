(function (root) {
  'use strict';

  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const WINDOWS = [7, 14, 30];
  const SECTION_LABELS = Object.freeze({
    hero: '首页主视觉', video: '大会视频', agenda: '大会主题与议程', speaker: '讲师介绍',
    testimonials: '学员故事', faq: '常见问题', registration: '报名表', other: '其他／未识别'
  });
  const SOURCE_LABELS = Object.freeze({
    direct: '直接访问／无来源', facebook: 'Facebook', instagram: 'Instagram',
    whatsapp: 'WhatsApp', google: 'Google', other: '其他／未识别'
  });
  const DEVICE_LABELS = Object.freeze({ mobile: '手机端', desktop: '桌面端', other: '其他／未识别' });
  const number = new Intl.NumberFormat('zh-MY');
  const percent = new Intl.NumberFormat('zh-MY', { style: 'percent', maximumFractionDigits: 1 });
  const mounts = new WeakMap();

  function timestamp(value) {
    const result = typeof value === 'number' ? value
      : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value)
      : value instanceof Date ? value.getTime() : NaN;
    return Number.isFinite(result) && Math.abs(result) <= 8.64e15 - DAY ? result : null;
  }

  function formatMYTDay(value = Date.now()) {
    const time = timestamp(value);
    return time === null ? '' : new Date(time + 8 * HOUR).toISOString().slice(0, 10);
  }

  const COUNT_FIELDS = ['total', 'registered', 'notRegistered', 'provisional', 'formNotRegistered',
    'active30NotRegistered', 'active60NotRegistered', 'excludedUndated'];
  const countOk = value => Number.isSafeInteger(value) && value >= 0 && value <= 3000;
  const invalidReport = () => Object.assign(new Error('Invalid report.'), { status: 503 });

  function exactFields(value, fields) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
  }

  function checkGroups(groups, labels, withTime) {
    if (!Array.isArray(groups) || groups.length > Object.keys(labels).length) throw invalidReport();
    const keys = new Set();
    const fields = withTime ? ['key', 'label', 'count', 'provisional', 'averageActiveSeconds'] : ['key', 'label', 'count'];
    let count = 0, provisional = 0;
    for (const group of groups) {
      if (!exactFields(group, fields) || !Object.hasOwn(labels, group.key) || keys.has(group.key)
        || group.label !== labels[group.key] || !countOk(group.count) || group.count === 0) throw invalidReport();
      if (withTime) {
        if (!countOk(group.provisional) || group.provisional > group.count
          || (group.averageActiveSeconds !== null && (!countOk(group.averageActiveSeconds) || group.averageActiveSeconds > 1800))) throw invalidReport();
        provisional += group.provisional;
      }
      keys.add(group.key);
      count += group.count;
    }
    return { count, provisional };
  }

  function checkReport(value, days) {
    if (!exactFields(value, ['windowDays', 'truncated', 'report']) || value.windowDays !== days
      || typeof value.truncated !== 'boolean') throw invalidReport();
    const stats = value.report;
    if (!exactFields(stats, ['startDay', 'endDay', ...COUNT_FIELDS, 'conversionRate', 'sections', 'sources', 'devices'])
      || !COUNT_FIELDS.every(field => countOk(stats[field]))) throw invalidReport();
    const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && formatMYTDay(value + 'T00:00:00Z') === value ? Date.parse(value + 'T00:00:00Z') : NaN;
    if (day(stats.endDay) - day(stats.startDay) !== (days - 1) * DAY
      || stats.total !== stats.registered + stats.notRegistered || stats.provisional > stats.notRegistered
      || stats.formNotRegistered > stats.notRegistered || stats.active30NotRegistered > stats.notRegistered
      || stats.active60NotRegistered > stats.active30NotRegistered
      || stats.conversionRate !== (stats.total ? stats.registered / stats.total : null)) throw invalidReport();
    const sections = checkGroups(stats.sections, SECTION_LABELS, true);
    if (sections.count !== stats.notRegistered || sections.provisional !== stats.provisional
      || checkGroups(stats.sources, SOURCE_LABELS, false).count !== stats.total
      || checkGroups(stats.devices, DEVICE_LABELS, false).count !== stats.total) throw invalidReport();
    return stats;
  }

  function mount(container, { load, title, scope } = {}) {
    if (!container?.ownerDocument || typeof load !== 'function') {
      throw new TypeError('Visitor analytics needs a host element and a loader.');
    }
    mounts.get(container)?.destroy();
    const doc = container.ownerDocument;
    function element(tag, className, value) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (value !== undefined) node.textContent = value;
      return node;
    }
    function button(label) {
      const node = element('button', 'pva-button', label);
      node.type = 'button';
      return node;
    }

    let windowDays = 7, generation = 0, destroyed = false, pending;
    const view = element('div', 'pva');
    const controls = element('div', 'pva-controls');
    const rangeGroup = element('fieldset', 'pva-range-group');
    const rangeOptions = element('div', 'pva-range-options');
    const buttons = new Map();
    rangeGroup.append(element('legend', 'pva-range-label', '统计时段（马来西亚时间）'), rangeOptions);
    for (const days of WINDOWS) {
      const node = button(`近 ${days} 天`);
      node.addEventListener('click', () => {
        if (windowDays !== days) {
          windowDays = days;
          refresh();
        }
      });
      buttons.set(days, node);
      rangeOptions.append(node);
    }
    const refreshButton = button('刷新');
    refreshButton.setAttribute('aria-label', '刷新访客分析');
    refreshButton.addEventListener('click', refresh);
    controls.append(rangeGroup, refreshButton);

    const dateRange = element('p', 'pva-note');
    const status = element('p', 'pva-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-atomic', 'true');
    const report = element('div', 'pva-report');
    const heading = element('header', 'pva-intro');
    heading.append(element('h4', 'pva-title', title),
      element('p', 'pva-note', '只统计已自动记录的' + scope + '匿名会话及报名转化，不显示个人联络资料。使用随机会话编号，记录最长保留 30 天；免费额度有限，数据可能延迟或不完整。'));
    view.append(heading, controls, dateRange, status, report);
    container.replaceChildren(view);

    function metrics(stats) {
      const grid = element('dl', 'pva-metrics');
      const definition = [
        ['匿名访客会话', number.format(stats.total), '不是独立访客人数'],
        ['截至统计尚未报名', number.format(stats.notRegistered), `其中 ${number.format(stats.provisional)} 个仍待观察`],
        ['会话报名转化率', stats.conversionRate === null ? '—' : percent.format(stats.conversionRate), `${number.format(stats.registered)} 个会话已成功报名`],
        ['已开始填表', number.format(stats.formNotRegistered), '截至统计尚未报名'],
        ['有效活跃 ≥ 30 秒', number.format(stats.active30NotRegistered), '截至统计尚未报名'],
        ['有效活跃 ≥ 60 秒', number.format(stats.active60NotRegistered), '截至统计尚未报名']
      ];
      for (const [label, amount, note] of definition) {
        const card = element('div', 'pva-metric');
        card.append(element('dt', 'pva-metric-label', label), element('dd', 'pva-metric-value', amount),
          element('dd', 'pva-metric-note', note));
        grid.append(card);
      }
      return grid;
    }

    function sectionTable(groups) {
      const block = element('section', 'pva-block');
      block.append(element('h5', 'pva-heading', '截至统计尚未报名：最后可见区块'),
        element('p', 'pva-note', '每个会话只计入一个区块；平均活跃为整个会话的有效活跃时间，不是该区块的停留时间，也不代表离开原因。'));
      if (!groups.length) {
        block.append(element('p', 'pva-empty', '暂无尚未报名的会话。'));
        return block;
      }
      const table = element('table', 'pva-table');
      table.setAttribute('aria-label', '尚未报名会话最后可见区块与平均活跃');
      const head = element('thead');
      const header = element('tr');
      for (const label of ['最后可见区块', '会话（含待观察）', '平均活跃']) {
        const cell = element('th', '', label);
        cell.scope = 'col';
        header.append(cell);
      }
      head.append(header);
      const body = element('tbody');
      for (const group of groups) {
        const row = element('tr');
        const label = element('th', '', group.label);
        label.scope = 'row';
        const count = element('td', '', number.format(group.count));
        if (group.provisional) {
          count.append(element('span', 'pva-table-note', `${number.format(group.provisional)} 待观察`));
        }
        const average = element('td', '', group.averageActiveSeconds === null ? '未记录' : `${number.format(group.averageActiveSeconds)} 秒`);
        row.append(label, count, average);
        body.append(row);
      }
      table.append(head, body);
      block.append(table);
      return block;
    }

    function breakdown(label, groups) {
      const block = element('section', 'pva-block');
      block.append(element('h5', 'pva-heading', label));
      const list = element('dl', 'pva-breakdown-list');
      for (const group of groups) {
        const pair = element('div', 'pva-breakdown-pair');
        pair.append(element('dt', '', group.label), element('dd', '', `${number.format(group.count)} 个会话`));
        list.append(pair);
      }
      block.append(list);
      return block;
    }

    async function refresh() {
      if (destroyed) return;
      const request = ++generation;
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      const deadline = setTimeout(() => controller.abort(), 12_000);
      const days = windowDays;
      for (const [optionDays, node] of buttons) node.setAttribute('aria-pressed', String(optionDays === days));
      dateRange.textContent = '马来西亚时间 · 以会话首次记录计入日期';
      status.className = 'pva-status';
      status.textContent = '正在读取匿名访客分析…';
      report.setAttribute('aria-busy', 'true');
      report.replaceChildren();
      refreshButton.disabled = true;
      refreshButton.textContent = '刷新';
      refreshButton.setAttribute('aria-label', '刷新访客分析');

      try {
        const response = await load(days, { signal: controller.signal });
        if (request !== generation) return;
        if (controller.signal.aborted) throw invalidReport();
        const stats = checkReport(response, days);
        dateRange.textContent = stats.startDay + ' 至 ' + stats.endDay + '（含今天） · 马来西亚时间';
        if (response.truncated) {
          report.append(element('p', 'pva-warning', '已达到读取上限：只显示已读取的会话，数量及转化率不代表完整时段。可缩短时段再查看。'));
        }
        if (stats.excludedUndated) {
          report.append(element('p', 'pva-warning', '有 ' + number.format(stats.excludedUndated) + ' 个会话因缺少可识别日期未纳入统计。'));
        }
        if (!stats.total) {
          status.textContent = response.truncated ? '当前样本不足以判断此时段是否有会话。'
            : '此时段没有可统计的匿名访客会话。追踪启用前的访问不会补计。';
          return;
        }
        status.textContent = '已载入 ' + number.format(stats.total) + ' 个匿名访客会话。';
        const breakdowns = element('div', 'pva-breakdowns');
        breakdowns.append(breakdown('访问来源（全部会话）', stats.sources), breakdown('设备类型（全部会话）', stats.devices));
        report.append(metrics(stats),
          element('p', 'pva-note', '「仍待观察」指最近一次记录距今不足 24 小时或记录时间不完整。所有「尚未报名」均为当前状态；访客之后仍可报名。30 秒与 60 秒两组有重叠，不应相加。'),
          sectionTable(stats.sections), breakdowns,
          element('p', 'pva-note', '只统计' + scope + '同意后的匿名会话。转化率 = 已关联成功报名的会话 ÷ 已记录的会话；不会计入无法关联的报名，也不会显示访客身份。'));
      } catch (error) {
        if (request !== generation) return;
        status.className = 'pva-status pva-warning';
        status.textContent = error?.status === 401 ? '访客分析授权已失效。请退出后重新输入 CRM 密码，或使用获授权的 Google 管理员账号。'
          : error?.status === 429 ? '已达到统计读取限额，请稍后再试。'
          : '统计服务尚未开启或暂时无法核对数据。请稍后重试。';
        refreshButton.textContent = '重试';
        refreshButton.setAttribute('aria-label', '重试读取访客分析');
      } finally {
        clearTimeout(deadline);
        if (pending === controller) pending = undefined;
        if (request === generation) {
          report.setAttribute('aria-busy', 'false');
          refreshButton.disabled = false;
        }
      }
    }

    const controller = Object.freeze({
      refresh,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        generation += 1;
        pending?.abort();
        view.remove();
        if (mounts.get(container) === controller) mounts.delete(container);
      }
    });
    mounts.set(container, controller);
    refresh();
    return controller;
  }

  root.CrmVisitorDashboard = Object.freeze({ mount });
})(globalThis);

(() => {
  'use strict';
  const reportOrigin = 'https://champacademy.asia';
  const maxResponseBytes = 8_192;
  const maxTokenLength = 16_377;
  const tabConfig = [
    { view: 'previewLeadsView', list: 'previewLeadListPanel', panel: 'previewVisitorStagePanel',
      listButton: 'previewLeadListButton', reportButton: 'previewVisitorStageButton',
      endpoint: '/api/summit-visitor-report', title: '2027 大会访客分析', scope: '大会报名页' },
    { view: 'landingLeadsView', list: 'landingLeadListPanel', panel: 'landingVisitorPanel',
      listButton: 'landingLeadListButton', reportButton: 'landingVisitorButton',
      endpoint: '/api/home-visitor-report', title: '首页访客分析', scope: '首页' },
  ];
  const authFailures = new Set(['auth/invalid-user-token', 'auth/user-token-expired', 'auth/user-disabled',
    'auth/user-not-found', 'auth/user-signed-out']);

  function failure(status) {
    return Object.assign(new Error('Visitor report unavailable.'), { status });
  }

  function activeAuth() {
    try { return globalThis.firebase?.auth?.(); } catch { return undefined; }
  }

  function awaitSignal(value, signal) {
    return new Promise((resolve, reject) => {
      const cancel = () => reject(failure(503));
      if (signal.aborted) cancel();
      else signal.addEventListener('abort', cancel, { once: true });
      Promise.resolve(value).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
    });
  }

  async function readReport(response, signal) {
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')) throw failure(503);
    const size = response.headers.get('Content-Length');
    if (size !== null && (!/^\d+$/.test(size) || Number(size) > maxResponseBytes)) throw failure(503);
    const reader = response.body?.getReader();
    if (!reader) throw failure(503);
    const bytes = new Uint8Array(maxResponseBytes);
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await awaitSignal(reader.read(), signal);
        if (done) break;
        if (length + value.byteLength > bytes.length) throw failure(503);
        bytes.set(value, length);
        length += value.byteLength;
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  function setupTab(config, closeOthers) {
    const view = document.getElementById(config.view);
    const list = document.getElementById(config.list);
    const panel = document.getElementById(config.panel);
    const listButton = document.getElementById(config.listButton);
    const reportButton = document.getElementById(config.reportButton);
    if (!view || !list || !panel || !listButton || !reportButton) return undefined;
    let session;

    function select(report) {
      list.hidden = report;
      panel.hidden = !report;
      listButton.setAttribute('aria-pressed', String(!report));
      reportButton.setAttribute('aria-pressed', String(report));
    }

    function close() {
      select(false);
      const old = session;
      session = undefined;
      if (!old) return;
      old.dashboard?.destroy();
      old.stopWatch?.();
      panel.replaceChildren();
    }

    function current(next) {
      return session === next && view.classList.contains('active')
        && next.auth?.currentUser === next.user && next.user?.uid === next.uid
        && next.user?.isAnonymous !== true;
    }

    async function load(next, days, signal) {
      if (!next.uid || !current(next) || typeof next.user?.getIdToken !== 'function') throw failure(401);
      if (![7, 14, 30].includes(days)) throw failure(503);
      let token;
      try { token = await awaitSignal(next.user.getIdToken(), signal); }
      catch (error) { throw failure(authFailures.has(error?.code) ? 401 : 503); }
      if (signal.aborted) throw failure(503);
      if (!current(next)) throw failure(401);
      if (typeof token !== 'string' || token.length > maxTokenLength
        || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) || /[^A-Za-z0-9_.-]/.test(token)) throw failure(401);

      const url = `${reportOrigin}${config.endpoint}?days=${days}`;
      const response = await awaitSignal(fetch(url, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal,
        cache: 'no-store', credentials: 'omit', mode: 'cors', redirect: 'error', referrerPolicy: 'no-referrer',
      }), signal);
      if (response.status === 401 || response.status === 403) throw failure(401);
      if (response.status === 429) throw failure(429);
      if (response.status !== 200 || response.redirected || (response.url && response.url !== url)) throw failure(503);
      const aggregate = await readReport(response, signal);
      if (signal.aborted) throw failure(503);
      if (!current(next)) throw failure(401);
      return aggregate;
    }

    function open() {
      if (session || !view.classList.contains('active')) return;
      closeOthers(view);
      select(true);
      const auth = activeAuth();
      const user = auth?.currentUser;
      const next = { auth, user, uid: user?.uid, wasAnonymous: user?.isAnonymous };
      session = next;
      if (typeof auth?.onAuthStateChanged === 'function') {
        try {
          const stop = auth.onAuthStateChanged(changed => {
            if (session === next && (changed !== user || changed?.uid !== next.uid || changed?.isAnonymous !== next.wasAnonymous)) close();
          }, () => { if (session === next) close(); });
          if (session !== next) { if (typeof stop === 'function') stop(); return; }
          if (typeof stop === 'function') next.stopWatch = stop;
        } catch { close(); return; }
      } else if (user) { close(); return; }
      const mount = globalThis.CrmVisitorDashboard?.mount;
      if (typeof mount !== 'function') { panel.textContent = '访客分析暂时无法加载，请稍后重试。'; return; }
      next.dashboard = mount(panel, { title: config.title, scope: config.scope,
        load: (days, { signal }) => load(next, days, signal) });
    }

    function hideIfInactive() {
      const active = activeAuth()?.currentUser;
      if (session && (!view.classList.contains('active') || active !== session.user
        || active?.uid !== session.uid || active?.isAnonymous !== session.wasAnonymous)) close();
    }

    listButton.addEventListener('click', close);
    reportButton.addEventListener('click', open);
    select(false);
    return { view, close, hideIfInactive };
  }

  const tabs = [];
  for (const config of tabConfig) {
    const tab = setupTab(config, keep => tabs.forEach(other => { if (other.view !== keep) other.close(); }));
    if (tab) tabs.push(tab);
  }
  if (!tabs.length) return;
  const closeAll = () => tabs.forEach(tab => tab.close());
  // Direct listeners run before the legacy sidebar delegate switches the view.
  document.querySelectorAll('.nav-item[data-view]').forEach(button => button.addEventListener('click', closeAll));
  const observer = new MutationObserver(() => tabs.forEach(tab => tab.hideIfInactive()));
  for (const tab of tabs) observer.observe(tab.view, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tabs.forEach(tab => tab.hideIfInactive());
  });
  window.addEventListener('pagehide', closeAll);
})();
