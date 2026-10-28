/**
 * app.js — UI 状态、渲染、事件、持久化、CSV 导出
 *
 * 依赖（按 index.html 中的加载顺序）：
 *   data.js  -> window.AJ.data
 *   nlp.js   -> window.AJ.nlp
 *   engine.js-> window.AJ.engine
 *   coach.js -> window.AJ.coach（理财专家模式）
 *   analysis.js -> window.AJ.analysis（CSV 账单解析）
 *   xlsx.js -> window.AJ.xlsx（Excel 工作表转 CSV）
 */
(function (global) {
  'use strict';

  var DOC = global.document;
  var DATA = global.AJ.data;
  var NLP = global.AJ.nlp;
  var ENG = global.AJ.engine;
  var ANA = global.AJ.analysis;
  var XLSX = global.AJ.xlsx;
  var OCR = global.AJ.ocr;
  var COACH = global.AJ.coach;
  var INTENT = global.AJ.intent;
  var DEALS = global.AJ.deals;
  var SAV = global.AJ.savings;
  var BF = global.AJ.billFilter;

  /** 账单列表共享筛选状态（完整版 / 简洁版共用同一抽屉）。重置时整体替换为 normalize(DEFAULTS) 的新对象。 */
  var billFilter = BF.normalize(BF.DEFAULTS);

  /**
   * 说话风格模块（tone.js）。
   * 只提供「一句话」，缺文件时统一返回空串 —— 调用方拿到空串就不显示那句话，
   * 不会因为少一条文案把卡片弄坏。
   */
  var TONE = (function () {
    var m = (global.AJ && global.AJ.tone) || null;
    if (m && typeof m.t === 'function' && typeof m.set === 'function') { return m; }
    return {
      missing: true,
      TONES: [
        { key: 'gentle', name: '温柔学姐', desc: '先接住情绪，再给建议' },
        { key: 'strict', name: '铁面教练', desc: '不哄你，只说问题' },
        { key: 'rational', name: '理性分析官', desc: '只讲数据和结论' }
      ],
      DEFAULT_TONE: 'gentle',
      normalize: function () { return 'gentle'; },
      set: function () { return 'gentle'; },
      get: function () { return 'gentle'; },
      t: function () { return ''; },
      has: function () { return false; }
    };
  })();

  /**
   * 心愿单模块（wishlist.js）。
   * 独立存储键，主账本对它的依赖只有「省下的钱」一个数。缺文件时入口自动隐藏。
   */
  var WISH = (function () {
    var m = (global.AJ && global.AJ.wishlist) || null;
    if (m && typeof m.add === 'function' && typeof m.dueItems === 'function') { return m; }
    var emptyStats = {
      cooling: 0, bought: 0, dropped: 0,
      coolingAmount: 0, droppedAmount: 0, boughtAmount: 0, savedAmount: 0
    };
    return {
      missing: true,
      MAX_ITEMS: 0,
      COOL_DAYS_DEFAULT: 2,
      EXTEND_MAX: 2,
      EXTEND_DAYS: 3,
      isReady: function () { return false; },
      load: function () {},
      reset: function () { return false; },
      add: function () { return { ok: false, item: null, reason: 'store' }; },
      list: function () { return []; },
      listCooling: function () { return []; },
      get: function () { return null; },
      progress: function () { return { remainingDays: 0, elapsedDays: 0, pct: 0, overdue: false }; },
      dueItems: function () { return []; },
      decide: function () { return { ok: false, item: null, reason: 'store' }; },
      extend: function () { return { ok: false, item: null, reason: 'store' }; },
      remove: function () { return { ok: false, item: null, reason: 'store' }; },
      stats: function () { return emptyStats; },
      dateKey: function () { return ENG.formatDate(new Date()); },
      addDays: function (k) { return k; }
    };
  })();

  /**
   * 消费诊断模块（diagnose.js）。
   * 纯函数：给账单和设置，回「哪里花得不对」+「期末会怎样」。缺文件时诊断卡整块隐藏。
   */
  var DIAG = (function () {
    var m = (global.AJ && global.AJ.diagnose) || null;
    if (m && typeof m.build === 'function' && typeof m.forecast === 'function') { return m; }
    return {
      missing: true,
      MAX_ITEMS: 3,
      build: function () { return []; },
      forecast: function () {
        return { projected: 0, remainingAtEnd: 0, overBudgetBy: 0, level: 'safe', dailyAvg: 0 };
      },
      maxSeverity: function () { return ''; }
    };
  })();

  /**
   * IP 形象「阿账」模块（mascot.js）。
   * 纯函数状态机 + 话术池：resolveMood / onEvent / poke / line / moodSvg。
   * 缺文件时头像退回「账」文字圆标、戳一戳与对话条整体静默，全站零影响。
   */
  var MOOD = (function () {
    var m = (global.AJ && global.AJ.mascot) || null;
    if (m && typeof m.resolveMood === 'function' && typeof m.onEvent === 'function') {
      return m;
    }
    return {
      missing: true,
      KEYS: [],
      MOOD_META: {},
      resolveMood: function () { return 'chill'; },
      onEvent: function () {},
      getActiveEvent: function () { return null; },
      tick: function () {},
      onMoodChange: function () {},
      moodSvg: function () { return ''; },
      poke: function () { return null; },
      line: function () { return ''; },
      fillVars: function (t) { return String(t || ''); }
    };
  })();

  /**
   * 存钱罐模块（piggy.js）。
   * 主账本对它的依赖只有一个数：getBalance()（罐内余额，元）。
   * 这里做了一个「空罐子」替身：piggy.js 缺失 / 加载失败时全部返回空值，
   * 存钱罐入口自动隐藏，其它功能一行都不受影响。
   */
  var PIGGY = (function () {
    var p = (global.AJ && global.AJ.piggy) || null;
    if (p && typeof p.getBalance === 'function' && typeof p.deposit === 'function') { return p; }
    var emptyStats = {
      balanceCents: 0, count: 0, depositCount: 0, days: 0,
      streak: 0, todayCents: 0, biggestCents: 0, firstDate: '', lastDate: ''
    };
    return {
      missing: true,
      isReady: function () { return false; },
      isRecovered: function () { return false; },
      load: function () {},
      reset: function () { return false; },
      getBalanceCents: function () { return 0; },
      getBalance: function () { return 0; },
      deposit: function () { return { ok: false, log: null, balanceCents: 0, reason: 'store' }; },
      withdraw: function () { return { ok: false, log: null, balanceCents: 0, reason: 'store' }; },
      listLogs: function () { return []; },
      stats: function () { return emptyStats; },
      cheer: function () { return { emoji: '', title: '', text: '' }; },
      parseAmount: function () { return null; },
      fmtCents: function (c) { return money((c || 0) / 100); },
      nextStepCents: function () { return 0; },
      dateKey: function () { return ''; },
      MAX_CENTS: 0
    };
  })();

  /* 让 ocr.js 的云端识别走 WorkBuddy 云服务（视觉大模型），而非本地 detectCloud（浏览器直连腾讯云）。
     由 server.py 托管页面时 AJ_BACKEND_OCR 为真，ocr.js 的 detectBackend 会改调云服务。 */
  global.AJ_BACKEND_OCR = true;

  /* 「理财课」聊天卡片最多直接列几条资源：2 个视频 + 1 门课程，正好 3 条，
     再多会把聊天气泡撑得过长，其余统一引导到理财学院看。
     learningResources() 已固定 video → course → up 排序，所以这 3 条永远是
     视频 / 课程，UP 主主页只出现在理财学院与看板卡里。 */
  var LEARN_INLINE_MAX = 3;

  /* WorkBuddy 云服务客户端与能力（由 initCloud() 异步填充）。免密钥，无需任何外部 Key。 */
  var cloudClient = null;        // WorkBuddyCloud 客户端实例
  var cloudModels = [];          // 模型列表
  var cloudChatModel = null;     // 对话用模型
  var cloudVisionModel = null;   // 截图识别（视觉）用模型
  var cloudReady = false;        // SDK 已初始化且已取到模型
  var visionAvailable = false;   // 是否存在标记支持图片输入的模型

  /* 截图识别是否可尝试：云端已连上即可尝试（模型不支持看图时调用会优雅失败并提示手动录入） */
  function cloudOcrAvailable() { return cloudReady; }

  /* 本应用的线上版本地址（云服务认可的来源，AI 功能必须用它打开）。来源 publicConfig.endpoint。 */
  var CLOUD_APP_URL = 'https://ai-expense-tracker-91800.app.workbuddy.host/?sharecode=YKQPM3GMYK';

  /** 把模型可能带回的 ```json 围栏 / 前后缀剥掉，尽量解析成对象；失败返回 null */
  function parseCloudJson(s) {
    if (!s) { return null; }
    var t = String(s).trim();
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) { t = fence[1].trim(); }
    var a = t.indexOf('{'); var b = t.lastIndexOf('}');
    if (a !== -1 && b !== -1 && b > a) { t = t.slice(a, b + 1); }
    try { return JSON.parse(t); } catch (e) { return null; }
  }

  /**
   * 调用 WorkBuddy 云服务对话模型：把用户消息 + 精简上下文发给大模型，
   * 以流式方式收集返回的 JSON（{reply, actions}），解析后回传。
   * 任何失败都返回 {fallback:true}，上层据此回退到本地 routeCommand。
   * @param {string} messageText
   * @param {Object|null} context
   * @return {Promise<{reply:?string, actions:Array, fallback:boolean, reason:string}>}
   */
  function cloudAsk(messageText, context) {
    return new Promise(function (resolve) {
      if (!cloudReady || !cloudChatModel || !cloudClient) {
        resolve({ reply: null, actions: [], fallback: true, reason: '云服务未就绪' });
        return;
      }
      /* C11：system prompt 增加「intent」输出字段与「clarify」动作，
         口径与 intent.js 的 7 个枚举完全一致，便于本地直接合并（mergeVerdict）。
         关键约束：疑问句不是 record；record 缺金额必须 clarify，禁止编造金额。 */
      var system = '你是"' + petDisplayName() + '"，面向大学生的校园记账 AI 助手。' +
        '先判断用户这句话的意图，再决定动作。意图只能是这 7 个之一：' +
        'record(记账) / query(查询) / howto(问怎么做) / advice(求建议) / dataop(改删撤) / chitchat(闲聊) / unknown。' +
        '关键规则：① 疑问句（怎么办 / 怎么 / 吗 / 多少）一律不是 record；' +
        '② 只有 record 且已知金额才返回 add_bill；record 缺金额必须返回 clarify 问金额，禁止编造金额；' +
        '③ 未来计划（明天 / 打算 / 约）属于 record，可在 reply 里提醒"还没发生"；' +
        '④ 如果给了【本地分类器初判】，只允许在其 candidates 之内裁决，越界视为无效。' +
        '用简洁、口语化、带一点鼓励的中文回复。只返回一个 JSON 对象、不要其它文字：' +
        '{"intent":"<7选1>","confidence":<0~1>,"reply":"<中文回复>","actions":[' +
        '{"type":"add_bill","amount":<number>,"category":<"餐饮"|"交通"|"购物"|"娱乐"|"学习"|"居住"|"医疗"|"社交"|"其他">,"note":<string>,"date":<"YYYY-MM-DD"|null>,"motivation":<"刚需"|"情绪">,"want":<bool>},' +
        '{"type":"command","name":<"balance"|"pie"|"income"|"ocr"|"analysis"|"goals"|"settings"|"undo">},' +
        '{"type":"clarify","missing":<"amount"|"queryKind"|"target">,"hint":<string>}]}';
      var userContent = String(messageText || '');
      if (context && typeof context === 'object') {
        userContent = '【用户当前情况】\n' + JSON.stringify(context) + '\n\n【用户消息】\n' + userContent;
      }
      var messages = [
        { role: 'system', content: system },
        { role: 'user', content: userContent }
      ];
      var full = '';
      var done = false;
      var timeoutTimer = setTimeout(function () {
        if (done) { return; }
        done = true;
        resolve({ reply: null, actions: [], fallback: true, reason: '云服务响应超时' });
      }, 10000);
      function finish() {
        if (done) { return; }
        done = true;
        clearTimeout(timeoutTimer);
        var parsed = parseCloudJson(full);
        if (!parsed) {
          resolve({ reply: full || null, actions: [], intent: null, clarify: null, fallback: false, reason: '' });
          return;
        }
        /* C11：把 intent / clarify 一并回传，供 intent.js 的 mergeVerdict 在本地 top2 内裁决 */
        var clarify = null;
        var acts = Array.isArray(parsed.actions) ? parsed.actions : [];
        var i;
        for (i = 0; i < acts.length; i++) {
          if (acts[i] && acts[i].type === 'clarify') {
            clarify = acts[i].missing || null;
            break;
          }
        }
        resolve({
          reply: parsed.reply || null,
          actions: acts,
          intent: parsed.intent || null,
          confidence: (typeof parsed.confidence === 'number') ? parsed.confidence : null,
          clarify: clarify,
          fallback: false,
          reason: ''
        });
      }
      try {
        var stream = cloudClient.llm.chat.completions.create({
          model: cloudChatModel.id,
          messages: messages,
          stream: true,
          response_format: { type: 'json_object' }
        });
        (async function () {
          try {
            for await (var chunk of stream) {
              var c = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
              if (c) { full += c; }
            }
            finish();
          } catch (e) {
            resolve({ reply: null, actions: [], fallback: true, reason: '云服务返回异常：' + (e && e.message ? e.message : e) });
          }
        })();
      } catch (e) {
        resolve({ reply: null, actions: [], fallback: true, reason: '云服务调用失败：' + (e && e.message ? e.message : e) });
      }
    });
  }

  /**
   * 调用 WorkBuddy 云服务视觉模型，把截图原样转录成文字。
   * 返回与 ocr.js detectBackend 一致的结构 {ok, source, text, reason}。
   * @param {string} dataUrl 'data:image/png;base64,...'
   * @return {Promise<{ok:boolean, source:string, text:string, reason:string}>}
   */
  function cloudVisionOcr(dataUrl) {
    return new Promise(function (resolve) {
      if (!cloudReady || !cloudClient) {
        resolve({ ok: false, source: 'cloud', text: '', reason: 'WorkBuddy 云服务未连接（请用线上版本打开本应用：' + CLOUD_APP_URL + '）' });
        return;
      }
      var model = cloudVisionModel || cloudChatModel;
      if (!model) {
        resolve({ ok: false, source: 'cloud', text: '', reason: '没有可用的视觉模型' });
        return;
      }
      var system = '你是一个票据/截图文字识别助手。只把图片里的文字原样转录出来，' +
        '按阅读顺序逐行输出，不要解释、不要翻译、不要编造。如果图片里没有任何文字，就只回复"无文字"。';
      var messages = [
        { role: 'system', content: system },
        { role: 'user', content: [
          { type: 'text', text: '请识别这张截图里的全部文字：' },
          { type: 'image_url', image_url: { url: dataUrl } }
        ] }
      ];
      var full = '';
      var done = false;
      function finish() {
        if (done) { return; }
        done = true;
        var text = full.trim();
        if (!text || text === '无文字') {
          resolve({ ok: false, source: 'cloud', text: '', reason: '云端没有识别到文字' });
          return;
        }
        resolve({ ok: true, source: 'cloud', text: text, reason: '' });
      }
      try {
        var stream = cloudClient.llm.chat.completions.create({
          model: model.id,
          messages: messages,
          stream: true
        });
        (async function () {
          try {
            for await (var chunk of stream) {
              var c = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
              if (c) { full += c; }
            }
            finish();
          } catch (e) {
            resolve({ ok: false, source: 'cloud', text: '', reason: '云端识别失败：' + (e && e.message ? e.message : e) });
          }
        })();
      } catch (e) {
        resolve({ ok: false, source: 'cloud', text: '', reason: '云端识别调用失败：' + (e && e.message ? e.message : e) });
      }
    });
  }

  /** 初始化 WorkBuddy 云服务客户端并拉取模型列表，确定对话/视觉模型。 */
  function initCloud() {
    if (typeof window.WorkBuddyCloud === 'undefined' || !window.AJ_CLOUD_CONFIG) {
      cloudReady = false;
      return;
    }
    try {
      cloudClient = window.WorkBuddyCloud.createWorkBuddyCloud({
        endpoint: window.AJ_CLOUD_CONFIG.endpoint,
        oauthRelayBaseUrl: window.AJ_CLOUD_CONFIG.oauthRelayBaseUrl,
        publishableKey: window.AJ_CLOUD_CONFIG.publishableKey
      });
    } catch (e) {
      cloudClient = null;
      cloudReady = false;
      return;
    }
    /* 把接口挂到全局，供 ocr.js 的 detectBackend 调用 */
    if (global.AJ && typeof global.AJ === 'object') {
      global.AJ.ask = cloudAsk;
      global.AJ.visionOcr = cloudVisionOcr;
    }
    loadCloudModels();
  }

  /** 拉取模型列表：选第一个启用模型做对话，选第一个支持图片的模型做截图识别。 */
  function loadCloudModels() {
    if (!cloudClient) { return; }
    cloudClient.llm.models.list().then(function (list) {
      cloudModels = Array.isArray(list) ? list : [];
      var enabled = cloudModels.filter(function (m) { return m.disabled !== true; });
      cloudChatModel = enabled[0] || null;
      cloudVisionModel = enabled.filter(function (m) { return m.supportsImages === true; })[0] || null;
      cloudReady = !!cloudChatModel;
      visionAvailable = !!cloudVisionModel;
      if ($('ocrMask') && !$('ocrMask').hidden) {
        $('ocrStatus').className = ocrCapabilityClass();
        $('ocrStatus').textContent = ocrCapabilityText();
      }
    }).catch(function () {
      cloudReady = false;
      visionAvailable = false;
    });
  }

  var STORAGE_KEY = DATA.STORAGE_KEY;
  var RING_R = 58;
  var RING_C = 2 * Math.PI * RING_R;

  var storageOK = true;
  var state = null;
  var highlightCategory = null;
  var flow = { queue: [], committed: [] };
  var pendingBill = null;
  /** 撤回栈：按记账顺序记录每笔账单 id（仅内存，不持久化）。供「撤回上一步」使用 */
  var undoStack = [];
  /** 纠错待补金额：上一轮问「要改成多少」后置位，下一句纯数字直接改这一笔（不新增账单） */
  var correctionPending = null;
  /** 轻量视图历史：记录进入子视图（专家/目标/看板）前的视图（仅内存，不持久化）。供「返回」按钮使用 */
  var viewHistory = [];
  /** 双 UI 视图集：完整版四视图 / 简洁版八屏（含 AI 对话记账屏 sai、省钱屏 ssave） */
  var FULL_VIEWS = { chat: 1, dash: 1, goals: 1, coach: 1 };
  var SIMPLE_VIEWS = { shome: 1, slist: 1, sbudget: 1, sprofile: 1, sai: 1, scoach: 1, sgoals: 1, ssave: 1, spiggy: 1 };

  /** 账单分析：最近一次导入的原始结果（默认不写入账本） */
  var analysisData = null;
  /** 分析模式：'current' 直接分析当前账本；'imported' 分析导入的 CSV */
  var analysisMode = 'current';

  /** 截屏记账：当前图片 dataURL / 当前待确认结果 */
  var ocrImageDataUrl = '';
  var ocrDraft = null;

  /* ================================================================== */
  /* 通用工具                                                            */
  /* ================================================================== */

  function $(id) {
    return DOC.getElementById(id);
  }

  /** 行内小图标简写：ic('bulb') → <svg class="bico">…#i-bulb</svg>（替代 emoji） */
  function ic(name, cls, label) {
    return DATA.inlineIcon('i-' + name, cls, label);
  }

  /** 条目小图标：优先线性 svg（it.icon），没有才用 emoji（商户 / 品类插画，如 🍗 肯德基） */
  /** 条目图标：品牌商户走品牌瓦片（真实 logo / 字母章），否则退回 emoji / 线性 svg */
  function itemIcon(it, size) {
    if (it && DEALS && typeof DEALS.brandTile === 'function' && DEALS.BRANDS &&
        (DEALS.BRANDS[it.id] || (DEALS.LOGOS && DEALS.LOGOS[it.id]))) {
      return DEALS.brandTile(it.id, size || 'md');
    }
    return it && it.icon ? ic(it.icon, size, null) : esc(it && it.emoji ? it.emoji : '');
  }

  function esc(text) {
    return String(text === undefined || text === null ? '' : text).replace(/[&<>"']/g, function (c) {
      if (c === '&') { return '&amp;'; }
      if (c === '<') { return '&lt;'; }
      if (c === '>') { return '&gt;'; }
      if (c === '"') { return '&quot;'; }
      return '&#39;';
    });
  }

  function money(n) {
    return ENG.fmtMoney(n);
  }

  function nowHM() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 100000).toString(36);
  }

  function clampNumber(v, min, max, fallback) {
    var n = Number(v);
    if (!isFinite(n)) { return fallback; }
    if (n < min) { return min; }
    if (n > max) { return max; }
    return n;
  }

  function categoryColor(key) {
    return DATA.getCategoryColor(key);
  }

  /** 分类"深墨色"：淡底方块里的图标描边色，与 categoryColor 同色系但更深 */
  function categoryInk(key) {
    return DATA.getCategoryInk(key);
  }

  /** 淡底小方块的内联样式：底色用 12% 淡色，图标色用深墨色（对比度 ≥4.5:1） */
  function spCatTileStyle(key) {
    return '--sc:' + categoryColor(key) + ';--sc-ink:' + categoryInk(key) +
      ';background:' + categoryColor(key) + '1f';
  }

  /* ================================================================== */
  /* 持久化                                                              */
  /* ================================================================== */

  function normalizeBill(b) {
    if (!b || typeof b !== 'object') { return null; }
    var amount = Number(b.amount);
    if (!isFinite(amount) || amount <= 0) { return null; }
    var isIncome = b.type === 'income';
    var category;
    if (isIncome) {
      category = DATA.INCOME_CATEGORY;
    } else {
      category = (b.category && DATA.CATEGORY_KEYS.indexOf(b.category) !== -1) ? b.category : '其他';
    }
    var date = (typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) ? b.date : ENG.formatDate(new Date());
    return {
      id: b.id ? String(b.id) : uid('b'),
      date: date,
      amount: ENG.round2(amount),
      category: category,
      note: b.note ? String(b.note) : category,
      motivation: b.motivation === '情绪' ? '情绪' : '刚需',
      want: !!b.want,
      type: isIncome ? 'income' : 'expense',
      source: isIncome ? String(b.source || '') : '',
      askedCycle: !!b.askedCycle,
      imported: !!b.imported,
      worth: (b.worth === 'worth' || b.worth === 'mid' || b.worth === 'waste') ? b.worth : '',
      createdAt: isFinite(Number(b.createdAt)) ? Number(b.createdAt) : Date.now()
    };
  }

  function normalizeGoal(g) {
    if (!g || typeof g !== 'object') { return null; }
    var target = Number(g.target);
    if (!isFinite(target) || target <= 0) { return null; }
    var saved = Number(g.saved);
    return {
      id: g.id ? String(g.id) : uid('goal'),
      name: g.name ? String(g.name) : '未命名目标',
      target: ENG.round2(target),
      saved: isFinite(saved) && saved >= 0 ? ENG.round2(saved) : 0,
      deadline: (typeof g.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g.deadline)) ? g.deadline : ''
    };
  }

  /**
   * 设置项归一化：任何一项缺失或非法都回退到默认值，
   * 保证旧版本存档（没有 settings 字段）读进来也能正常用。
   * @param {Object} raw 存档里的 settings 字段
   * @return {Object} 归一化后的设置对象
   */
  function normalizeSettings(raw) {
    var s = (raw && typeof raw === 'object') ? raw : {};
    var profile = (s.profile && typeof s.profile === 'object') ? s.profile : {};
    var notify = (s.notify && typeof s.notify === 'object') ? s.notify : {};
    var privacy = (s.privacy && typeof s.privacy === 'object') ? s.privacy : {};
    return {
      profile: {
        nickname: (typeof profile.nickname === 'string' && profile.nickname.trim())
          ? profile.nickname.trim().slice(0, 12) : '同学',
        avatar: (typeof profile.avatar === 'string' && profile.avatar.trim())
          ? profile.avatar.trim().slice(0, 4) : '🙂'
      },
      notify: {
        push: notify.push !== false,
        remind: notify.remind !== false,
        overspend: notify.overspend !== false
      },
      theme: (s.theme === 'light' || s.theme === 'dark') ? s.theme : 'system',
      fontScale: (s.fontScale === 'sm' || s.fontScale === 'lg' || s.fontScale === 'xl') ? s.fontScale : 'md',
      lang: s.lang === 'en' ? 'en' : 'zh',
      privacy: {
        album: privacy.album !== false,
        clipboard: privacy.clipboard !== false
      },
      /* ---- 本轮新增（每项都在这里兜底，否则 persistSettings 会把它们抹掉） ---- */
      // 单日支出上限（元）；0 = 关闭「单日超支」这条诊断规则
      dailyCap: clampNumber(s.dailyCap, 0, 99999, 60),
      // 非必需消费占比阈值（本轮不做 UI，固定默认 0.8；保留字段是为了以后调参不用改结构）
      alertRatio: clampNumber(s.alertRatio, 0.3, 1, 0.8),
      // 说话风格：温柔学姐 / 铁面教练 / 理性分析官
      tone: (s.tone === 'strict' || s.tone === 'rational') ? s.tone : 'gentle',
      // 诊断卡主动提示去重：存「已提示过的周期起点」，一个周期只提示一次
      hintCycle: (typeof s.hintCycle === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.hintCycle))
        ? s.hintCycle : '',
      // 心愿单到期回访去重：存「已回访过的日期」，同一天只提醒一次
      wishReviewDate: (typeof s.wishReviewDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.wishReviewDate))
        ? s.wishReviewDate : '',
      // 阿账戳一戳开关（默认开）：关闭后点阿账头像完全静默（主理人决策 #7）
      // pet：右下角宠物总开关，关掉后三个形象都不出现（默认开）
      // skin：宠物形象 'azhang' 阿账 / 'sprite' 存钱罐精灵 / 'pro' 记账小管家
      //       / null 还没选过 → 首次进入弹窗
      //       ⚠ 这里是白名单：新增形象必须同步加进来，否则 persistSettings 时
      //       会被兜底成 null，刷新后静默退回阿账（只改 petSkin() 是不够的）。
      mascot: {
        poke: !((s.mascot && s.mascot.poke === false)),
        pet: !((s.mascot && s.mascot.pet === false)),
        skin: (s.mascot && (s.mascot.skin === 'azhang' || s.mascot.skin === 'sprite' ||
          s.mascot.skin === 'pro')) ? s.mascot.skin : null
      },
      // 互动反馈（音效 + 震动）：三个形象共用一套声效，实际开关同步给 AJ.sfx
      fx: !(s.fx === false)
    };
  }

  function normalizeState(obj) {
    var s = obj || {};
    var budget = (s.budget && typeof s.budget === 'object') ? s.budget : {};
    var bills = [];
    var goals = [];
    var i;
    if (Array.isArray(s.bills)) {
      for (i = 0; i < s.bills.length; i++) {
        var nb = normalizeBill(s.bills[i]);
        if (nb) { bills.push(nb); }
      }
    }
    if (Array.isArray(s.goals)) {
      for (i = 0; i < s.goals.length; i++) {
        var ng = normalizeGoal(s.goals[i]);
        if (ng) { goals.push(ng); }
      }
    }
    return {
      bills: bills,
      budget: {
        total: clampNumber(budget.total, 0, 9999999, DATA.DEFAULT_BUDGET.total),
        payday: Math.round(clampNumber(budget.payday, 1, 28, DATA.DEFAULT_BUDGET.payday)),
        cooldownThreshold: clampNumber(budget.cooldownThreshold, 0, 9999999, DATA.DEFAULT_BUDGET.cooldownThreshold),
        cycleStart: (typeof budget.cycleStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(budget.cycleStart))
          ? budget.cycleStart : ''
      },
      goals: goals,
      savedMoney: clampNumber(s.savedMoney, 0, 99999999, 0),
      blockedCount: Math.round(clampNumber(s.blockedCount, 0, 999999, 0)),
      uiMode: (s.uiMode === 'simple') ? 'simple' : 'full',
      settings: normalizeSettings(s.settings)
    };
  }

  function seedState() {
    var today = new Date();
    var budget = {
      total: DATA.DEFAULT_BUDGET.total,
      payday: DATA.DEFAULT_BUDGET.payday,
      cooldownThreshold: DATA.DEFAULT_BUDGET.cooldownThreshold,
      cycleStart: ''
    };
    var cycle = ENG.getCycle(today, budget.payday);
    var bills = [];
    var i;

    for (i = 0; i < DATA.SEED_BILLS.length; i++) {
      var seed = DATA.SEED_BILLS[i];
      var d = new Date(today.getTime());
      d.setDate(d.getDate() - seed.offset);
      var ds = ENG.formatDate(d);
      if (ds < cycle.start) { ds = cycle.start; }
      bills.push({
        id: 'seed_b' + i,
        date: ds,
        amount: ENG.round2(seed.amount),
        category: seed.category,
        note: seed.note,
        motivation: seed.motivation,
        want: !!seed.want,
        type: 'expense',
        createdAt: d.getTime() + i * 1000
      });
    }

    var inc = DATA.SEED_INCOME;
    var di = new Date(today.getTime());
    di.setDate(di.getDate() - inc.offset);
    var dis = ENG.formatDate(di);
    if (dis < cycle.start) { dis = cycle.start; }
    bills.push({
      id: 'seed_income',
      date: dis,
      amount: ENG.round2(inc.amount),
      category: DATA.INCOME_CATEGORY,
      note: inc.note,
      motivation: inc.motivation,
      want: false,
      type: 'income',
      source: inc.source || '生活费',
      askedCycle: true,
      imported: false,
      createdAt: di.getTime() + 900000
    });

    var goals = [];
    for (i = 0; i < DATA.DEFAULT_GOALS.length; i++) {
      goals.push({
        id: DATA.DEFAULT_GOALS[i].id,
        name: DATA.DEFAULT_GOALS[i].name,
        target: DATA.DEFAULT_GOALS[i].target,
        saved: DATA.DEFAULT_GOALS[i].saved,
        deadline: DATA.DEFAULT_GOALS[i].deadline
      });
    }

    return {
      bills: bills,
      budget: budget,
      goals: goals,
      savedMoney: 0,
      blockedCount: 0,
      uiMode: 'full',
      settings: normalizeSettings(null)
    };
  }

  function loadState() {
    var raw = null;
    try {
      raw = global.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      storageOK = false;
      raw = null;
    }
    if (!raw) {
      state = seedState();
      saveState();
      return;
    }
    try {
      state = normalizeState(JSON.parse(raw));
    } catch (e2) {
      state = seedState();
    }
  }

  function saveState() {
    if (!storageOK) { return; }
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      storageOK = false;
      showStorageTip();
    }
  }

  function showStorageTip() {
    var tip = $('storageTip');
    if (tip) { tip.hidden = false; }
  }

  /* ------------------------------------------------------------------ */
  /* 省钱图谱的打卡记录：独立存储键，绝不混进主账本                         */
  /* ------------------------------------------------------------------ */

  /**
   * 为什么要单独一个键（而不是塞进 state）：
   *   ① state 一动 normalizeState() 就要重跑全套账本回归，风险大；
   *   ② 省钱记录损坏时只应重置自己，不能让用户丢掉真实账单；
   *   ③ 省钱账是「动作打卡」，与「账单流水」语义不同，合并会让「买对省 X」
   *      和冷静期「拦下 Y」混为一谈（两个数必须分开显示）。
   */
  var SAVINGS_KEY = 'ai_jizhang_savings_v1';
  var SAVINGS_LOG_MAX = 2000;
  /** 当前打卡库：{ v, logs:[{id,date,saved,manual,at}], updatedAt } */
  var savingsDb = { v: 1, logs: [], updatedAt: 0 };
  var savingsStorageOK = true;
  /** 存档解析失败时置真，首次打开面板提示一次（只重置自己） */
  var savingsRecovered = false;

  /**
   * 打卡记录归一化：任何一条不合法就丢弃那一条，而不是整个库作废。
   * 规则：id 必须是非空字符串；date 必须是 YYYY-MM-DD；同一 (id,date) 只保留一条；
   *      saved 非法按 0 处理（`none` 型条目本来就不计金额）。
   */
  function normalizeSavingsDb(obj) {
    var o = (obj && typeof obj === 'object') ? obj : {};
    var src = Array.isArray(o.logs) ? o.logs : [];
    var out = [], seen = {}, i;
    for (i = 0; i < src.length; i++) {
      var r = src[i];
      if (!r || typeof r !== 'object') { continue; }
      var id = (typeof r.id === 'string') ? r.id : '';
      if (!id) { continue; }
      var date = (typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) ? r.date : '';
      if (!date) { continue; }
      var key = id + '@' + date;
      if (seen[key]) { continue; }
      seen[key] = 1;
      var saved = Number(r.saved);
      if (!isFinite(saved) || saved < 0) { saved = 0; }
      out.push({
        id: id,
        date: date,
        saved: ENG.round2(saved),
        manual: !!r.manual,
        at: isFinite(Number(r.at)) ? Number(r.at) : 0
      });
    }
    if (out.length > SAVINGS_LOG_MAX) { out = out.slice(out.length - SAVINGS_LOG_MAX); }
    return {
      v: isFinite(Number(o.v)) ? Number(o.v) : 0,
      logs: out,
      updatedAt: isFinite(Number(o.updatedAt)) ? Number(o.updatedAt) : 0
    };
  }

  function loadSavingsDb() {
    var raw = null;
    try {
      raw = global.localStorage.getItem(SAVINGS_KEY);
    } catch (e) {
      savingsStorageOK = false;
      raw = null;
    }
    if (!raw) { savingsDb = { v: 1, logs: [], updatedAt: 0 }; return; }

    try {
      savingsDb = normalizeSavingsDb(JSON.parse(raw));
    } catch (e2) {
      savingsDb = { v: 1, logs: [], updatedAt: 0 };
      savingsRecovered = true;
      return;
    }
    /* 数据版本变了（条目 id 可能重排）：只保留仍存在的 id，不做整库清空 */
    var ver = (SAV && SAV.DATA && SAV.DATA.DATA_VERSION) || 1;
    if (savingsDb.v !== ver) {
      savingsDb.logs = savingsDb.logs.filter(function (r) { return !!(SAV && SAV.byId && SAV.byId(r.id)); });
      savingsDb.v = ver;
      saveSavingsDb();
    }
  }

  function saveSavingsDb() {
    savingsDb.updatedAt = Date.now();
    if (!savingsStorageOK) { return false; }
    try {
      global.localStorage.setItem(SAVINGS_KEY, JSON.stringify(savingsDb));
      return true;
    } catch (e) {
      savingsStorageOK = false;
      showStorageTip();
      return false;
    }
  }

  /* ================================================================== */
  /* 聊天渲染                                                            */
  /* ================================================================== */

  function chatListEl() {
    return $('chatList');
  }

  function scrollChat() {
    var list = chatListEl();
    if (list) { list.scrollTop = list.scrollHeight; }
  }

  function timeHtml() {
    return '<div class="msg-time">' + nowHM() + '</div>';
  }

  /** 给头像 / 对话条取概览用的防抛封装（appendRow 高频路径，绝不让它抛异常） */
  function safeOverview() {
    try { return getOverview(); } catch (eOv) { return null; }
  }

  function appendRow(role, innerHtml) {
    var list = chatListEl();
    var row = DOC.createElement('div');
    row.className = 'msg-row' + (role === 'me' ? ' me' : '');
    var av = DOC.createElement('div');
    av.className = 'avatar ' + (role === 'me' ? 'me' : 'ai');
    if (role === 'me') {
      av.textContent = '我';
    } else if (!MOOD.missing) {
      /* AI 头像：按发消息当时的 mood 定格表情底色 —— 同一会话不同行可以是不同表情
         （「情绪时间线」，PRD §5.1 交互①），后续不回刷历史行。
         图案跟随当前宠物形象（2026-10 用户反馈：聊天页头像也要跟着换）：
         azhang 用九情绪原画，sprite / pro 复用播报条头像（pro 含照片脸）。 */
      var mk = MOOD.resolveMood(safeOverview());
      var meta = MOOD.MOOD_META[mk] || {};
      var skinAv = petSkin();
      av.className = 'avatar ai mood-' + mk;
      av.setAttribute('data-mood', mk);
      av.setAttribute('tabindex', '0');
      av.setAttribute('role', 'img');
      av.setAttribute('aria-label', petDisplayName(skinAv) + '，表情：' + (meta.name || mk) + '，点击可和它聊聊');
      if (skinAv === 'sprite') {
        av.innerHTML = mascotBarSpriteHead();
      } else if (skinAv === 'pro') {
        var ppAv = global.AJ && global.AJ.petPro;
        var profAv = (ppAv && typeof ppAv._profile === 'function') ? ppAv._profile() : null;
        av.innerHTML = mascotBarProHead(profAv);
      } else {
        av.innerHTML = MOOD.moodSvg(mk, 'mico', meta.name || mk);
      }
    } else {
      av.textContent = '账';
    }
    var body = DOC.createElement('div');
    body.className = 'msg-body';
    body.innerHTML = innerHtml;
    row.appendChild(av);
    row.appendChild(body);
    list.appendChild(row);
    scrollChat();
    return body;
  }

  function addAIMessage(innerHtml) {
    return appendRow('ai', innerHtml + timeHtml());
  }

  /**
   * 回刷聊天页已有 AI 头像的「图案」到当前形象（情绪底色 data-mood 保留，
   * 不破坏情绪时间线）。切形象 / 工坊换装时调用 —— 否则历史消息里还是旧
   * 形象的头像，用户会以为没生效。
   */
  function repaintChatAvatars(skin) {
    var list = chatListEl();
    if (!list) { return; }
    var avs = list.querySelectorAll('.avatar.ai');
    for (var i = 0; i < avs.length; i++) {
      var el = avs[i];
      /* 名字也跟着形象走：换成精灵后 aria 里不该还叫「阿账」 */
      var mkAria = el.getAttribute('data-mood') || 'chill';
      var metaAria = MOOD.MOOD_META[mkAria] || {};
      el.setAttribute('aria-label', petDisplayName(skin) + '，表情：' + (metaAria.name || mkAria) + '，点击可和它聊聊');
      if (skin === 'sprite') {
        el.innerHTML = mascotBarSpriteHead();
      } else if (skin === 'pro') {
        var pp = global.AJ && global.AJ.petPro;
        var prof = (pp && typeof pp._profile === 'function') ? pp._profile() : null;
        el.innerHTML = mascotBarProHead(prof);
      } else {
        var mk = el.getAttribute('data-mood') || 'chill';
        var meta = MOOD.MOOD_META[mk] || {};
        el.innerHTML = MOOD.moodSvg(mk, 'mico', meta.name || mk);
      }
    }
  }

  function addUserMessage(text) {
    var body = appendRow('me', timeHtml());
    var bubble = DOC.createElement('div');
    bubble.className = 'bubble me';
    bubble.textContent = text;
    body.insertBefore(bubble, body.firstChild);
  }

  function aiBubble(text) {
    return '<div class="bubble ai">' + text + '</div>';
  }

  /** 戳一戳动作按钮文案（PRD §3.5：mood → data-cmd → 按钮标签） */
  function pokeActionLabel(cmd) {
    var map = {
      '本月花销饼图': '看看本月花销',
      '怎么省钱': '帮我看下怎么省',
      '存一笔': '再存一笔',
      '加心愿单': '放进冷静期',
      '查余额': '查余额',
      '记一笔': '记一笔'
    };
    return map[cmd] || cmd || '查余额';
  }

  /**
   * 戳一戳总入口（聊天头像与对话条头像共用）。
   * 开关关闭 → 头像点击完全静默（主理人决策 #7：不弹提示，避免「关了还吵」）；
   * 3s 防刷窗口内 mascot.poke 返回 null → 只重放 ≤600ms 的一次性弹跳动画；
   * 命中话术 → 在当前会话末尾追加一条吐槽气泡（role="status" aria-live="polite"）
   * + 动作按钮（data-cmd，走既有 data-cmd 委托路由，零新路由代码）。
   */
  function pokeMascot(el) {
    if (MOOD.missing) { return; }
    var st = getSettings();
    if (st.mascot && st.mascot.poke === false) { return; }
    if (el && el.classList) {
      el.classList.remove('mascot-bounce');
      void el.offsetWidth; /* 重置 CSS 动画 */
      el.classList.add('mascot-bounce');
    }
    var hit = MOOD.poke({ ov: safeOverview(), state: state, money: money });
    if (!hit || !hit.text) { return; }
    addAIMessage('<div class="bubble ai" role="status" aria-live="polite">' + esc(hit.text) + '</div>' +
      actionsWrap('<button type="button" class="btn-mini primary" data-cmd="' + esc(hit.cmd) + '">' +
        esc(pokeActionLabel(hit.cmd)) + '</button>'));
  }

  function tagHtml(text, cls) {
    return '<span class="tag' + (cls ? ' ' + cls : '') + '">' + esc(text) + '</span>';
  }

  /**
   * 「💡 理财专家说」卡片（理财专家模式 · 核心格式）。
   * 记账结果之后触发：娱乐 / 冲动消费 / 高溢价品牌，一条 ≤50 字的建议。
   */
  function coachSayHtml(text) {
    return '<div class="coach-say">' +
      '<div class="coach-say-head">' + ic('bulb', 'bico-brand', '理财专家说') + '<b>理财专家说</b></div>' +
      '<div class="coach-say-body">' + esc(text) + '</div>' +
      '</div>';
  }

  /** 单笔账单卡片 HTML（success=true 时按业务规则 5 显示「【记账成功】」） */
  function billCardHtml(bill, success) {
    var isIncome = bill.type === 'income';
    var sign = isIncome ? '+' : '-';
    var cls = isIncome ? 'income' : 'expense';
    var tags = '';
    tags += tagHtml(bill.category, isIncome ? 'green' : '');
    if (isIncome) {
      tags += tagHtml('收入', 'green');
    } else {
      tags += tagHtml(bill.motivation, bill.motivation === '情绪' ? 'orange' : '');
      tags += tagHtml(bill.want ? '想要' : '需要', bill.want ? 'orange' : '');
    }
    // 业务规则 1：账单卡片上必须能看到提取出来的「商家」
    if (bill.merchant) { tags += tagHtml(bill.merchant, 'gray'); }
    tags += '<span class="tag">' + esc(bill.date) + '</span>';

    return '' +
      '<div class="bill-card" data-bill="' + esc(bill.id) + '">' +
      '  <div class="bill-card-head"><span>' + (isIncome ? '收入入账' : '【记账成功】支出记账') + '</span>' +
      '<span>' + esc(bill.date) + '</span></div>' +
      '  <div class="bill-card-main">' +
      '    <span class="bill-card-note">' + esc(bill.note) + '</span>' +
      '    <span class="bill-card-amount ' + cls + '">' + sign + money(bill.amount) + '</span>' +
      '  </div>' +
      '  <div class="bill-card-tags">' + tags + '</div>' +
      '  <div class="bill-card-actions">' +
      (isIncome ? '' : '<span class="worth-q">值不值？</span>' + worthBtns(bill)) +
      '    <button type="button" class="undo-btn" data-act="edit-bill" data-bill="' + esc(bill.id) + '">修改</button>' +
      '    <button type="button" class="undo-btn" data-act="undo" data-bill="' + esc(bill.id) + '">撤回</button>' +
      '  </div>' +
      '</div>';
  }

  /* ================================================================== */
  /* 业务动作                                                            */
  /* ================================================================== */

  function isImpulse(draft) {
    if (!draft || draft.type !== 'expense') { return false; }
    // 业务规则：单笔非刚需支出（游戏充值 / 盲盒 / 潮玩 / 超出日常预算的聚会）
    if (ENG.hitsCooldownKeyword(draft)) { return true; }
    return draft.motivation === '情绪' || draft.want === true;
  }

  function needsCooldown(draft) {
    if (!isImpulse(draft)) { return false; }
    var threshold = Number(state.budget.cooldownThreshold);
    if (!isFinite(threshold) || threshold <= 0) { return false; }
    return Number(draft.amount) >= threshold;
  }

  function commitBill(draft, skipUndo) {
    var isIncome = draft.type === 'income';
    var bill = {
      id: uid('b'),
      date: draft.date || ENG.formatDate(new Date()),
      amount: ENG.round2(draft.amount),
      category: isIncome ? DATA.INCOME_CATEGORY
        : (DATA.CATEGORY_KEYS.indexOf(draft.category) !== -1 ? draft.category : '其他'),
      note: draft.note || draft.category || '未命名',
      motivation: draft.motivation === '情绪' ? '情绪' : '刚需',
      want: !!draft.want,
      // 业务规则 1：必须从用户话语中提取「商家」
      merchant: draft.merchant || ENG.extractMerchant((draft.note || '') + ' ' + (draft.raw || '')),
      type: isIncome ? 'income' : 'expense',
      source: isIncome ? String(draft.source || '') : '',
      askedCycle: !!draft.askedCycle,
      imported: !!draft.imported,
      createdAt: Date.now()
    };
    state.bills.push(bill);
    // 批量导入的账单不进单步撤回栈（撤回只针对手动记错的那一笔），避免一次导入污染撤回
    if (!skipUndo) { undoStack.push(bill.id); }
    saveState();
    /* 阿账事件源①：记账成功（所有入账路径唯一汇聚点）→ cheer，2.5s 后自动回落 */
    MOOD.onEvent('bill_logged');
    /* 浮层宠物：针对这一笔说话（批量导入不打扰） */
    if (!skipUndo) {
      var tstr = ENG.formatDate(new Date());
      var cnt = 0, bi;
      for (bi = 0; bi < state.bills.length; bi++) {
        if (state.bills[bi].date === tstr && state.bills[bi].type === 'expense') { cnt++; }
      }
      petReact(isIncome ? 'income_logged' : 'bill_logged',
        { amount: bill.amount, cat: bill.category, note: bill.note, count: cnt });
    }
    return bill;
  }

  /** 按 id 查找账单 */
  function findBill(id) {
    if (!id) { return null; }
    for (var i = 0; i < state.bills.length; i++) {
      if (state.bills[i].id === id) { return state.bills[i]; }
    }
    return null;
  }

  /** 撤回（删除）某笔账单，并刷新看板 */
  function deleteBill(id) {
    var b = findBill(id);
    if (!b) { return; }
    state.bills = state.bills.filter(function (x) { return x.id !== id; });
    // 同步从撤回栈移除，避免「撤回上一步」误删已删记录
    undoStack = undoStack.filter(function (x) { return x !== id; });
    saveState();
    // 从聊天流里移除这张账单卡片所在的整条消息
    var chatCards = DOC.querySelectorAll('#chatList .bill-card[data-bill="' + id + '"]');
    for (var ci = 0; ci < chatCards.length; ci++) {
      var row = chatCards[ci].closest ? chatCards[ci].closest('.msg-row') : null;
      if (row && row.parentNode) { row.parentNode.removeChild(row); }
    }
    renderAll();
    addAIMessage(aiBubble(ic('update', 'bico-mute', '撤回') + '已撤回「' + esc(b.note) + '」' +
      (b.type === 'income' ? '（收入 ' : '（支出 ') + money(b.amount) + '），已恢复。'));
  }

  /** 给某笔支出打「值不值」标签（再次点击同一项可取消） */
  function setBillWorth(id, val) {
    var b = findBill(id);
    if (!b || b.type === 'income') { return; }
    b.worth = (b.worth === val) ? '' : val;
    saveState();
    // 只刷新这张卡片，避免整段聊天被重绘
    var cards = DOC.querySelectorAll('.bill-card');
    for (var k = 0; k < cards.length; k++) {
      if (cards[k].getAttribute('data-bill') === id) {
        var tmp = DOC.createElement('div');
        tmp.innerHTML = billCardHtml(b);
        var fresh = tmp.firstChild;
        if (fresh && fresh.nodeType === 1 && cards[k].parentNode) {
          cards[k].parentNode.replaceChild(fresh, cards[k]);
        }
        break;
      }
    }
  }

  /** 撤回上一步：删除最近一次记入的账单 */
  function undoLast() {
    if (!state.bills.length) {
      addAIMessage(aiBubble('现在没有可撤回的记录啦～'));
      return;
    }
    if (!undoStack.length) {
      addAIMessage(aiBubble('这一步没法自动撤回（比如是导入 / 重置产生的）。你可以直接点账单卡片上的「撤回」按钮删掉它。'));
      return;
    }
    var id = undoStack.pop();
    deleteBill(id);
  }

  /** 值不值 三选一按钮 */
  function worthBtns(bill) {
    var opts = [['worth', '值'], ['mid', '一般'], ['waste', '不值']];
    var html = '';
    for (var i = 0; i < opts.length; i++) {
      var v = opts[i];
      var active = bill.worth === v[0] ? ' active' : '';
      html += '<button type="button" class="worth-btn' + active + '" data-act="worth" data-bill="' +
        esc(bill.id) + '" data-val="' + v[0] + '">' + v[1] + '</button>';
    }
    return html;
  }

  /** 开始处理一批解析结果 */
  function startFlow(drafts) {
    flow.queue = drafts.slice();
    flow.committed = [];
    stepFlow();
  }

  /** 逐笔入账，遇到需要冷静期的就暂停 */
  function stepFlow() {
    while (flow.queue.length > 0) {
      var draft = flow.queue.shift();
      if (needsCooldown(draft)) {
        pendingBill = draft;
        showCooldownCard(draft);
        renderAll();
        return;
      }
      flow.committed.push(commitBill(draft));
    }
    /* 上一笔还在冷静期待决时，先不汇总：否则 finishFlow 会把 pendingBill 静默清空，那笔钱就丢了 */
    if (pendingBill) { return; }
    finishFlow();
  }

  function finishFlow() {
    var list = flow.committed;
    flow.committed = [];
    pendingBill = null;
    renderAll();
    if (list.length === 0) { return; }
    reportCommitted(list);
  }

  /** 汇报本次记账结果 */
  function reportCommitted(list) {
    var i;
    var totalExpense = 0;
    for (i = 0; i < list.length; i++) {
      if (list[i].type === 'expense') { totalExpense += list[i].amount; }
    }

    var overview = getOverview();
    // 业务规则 5：每笔都要给到【记账成功】卡片 + 【余额概览】+【理财专家一句话建议】
    for (i = 0; i < list.length; i++) {
      var bill = list[i];
      var head;
      if (bill.type === 'income') {
        head = aiBubble(ic('receipt', 'bico-brand', '记账成功') + '<b>【记账成功】</b>这是一笔收入（' + esc(bill.source || '其他') + '），已经加进本周期，不计入支出统计。');
      } else {
        head = aiBubble('<b>【记账成功】</b>记好啦～归到 <span class="hl">' + esc(bill.category) + '</span>' +
          (bill.merchant ? '，商家 <span class="hl">' + esc(bill.merchant) + '</span>' : '') + '。' +
          (bill.motivation === '情绪' ? '<br>今天是不是有点累？偶尔买点开心没事，别让它变成习惯就行。' : ''));
      }
      var html = head + billCardHtml(bill, true);
      html += balanceOverviewHtml(overview);
      html += coachSayHtml(COACH.oneLineAdvice(bill, overview));
      /* 大额支出劝阻：命中时在余额概览 / 一句话建议之后追加「大额冷静」卡（收入不触发） */
      if (bill.type !== 'income') {
        var bigSpend = COACH.bigSpendAdvice(bill, overview);
        if (bigSpend && bigSpend.hit) { html += bigSpend.html; }
      }
      addAIMessage(html);
      /* 账本联动：购物 + 备注/商家含谷 → 弹正版确认提示（防买到祖国版） */
      if (bill.type !== 'income' && bill.category === '购物' &&
          /谷|吧唧|立牌|流麻|谷子|盲盒|抽赏|周边|痛包|海景/.test(bill.note || bill.merchant || '')) {
        addAIMessage(guBuyNoteHtml());
      }
      if (bill.type === 'income') {
        maybeAskCycleReset(bill);
      }
    }
  }

  /* ============ 买谷指南 / 二次元触发词（省钱图谱第11类联动） ============ */
  var GU_KEYWORDS = /买谷|吃谷|谷子|吧唧|立牌|流麻|拍立得|镭射票|棉花娃娃|盲抽|抽赏|抽盒|拼团|痛包|二次元|周边|海景谷|出谷|回血|卖谷|闲置/;
  var GU_GUIDE_CMDS = /买谷指南|吃谷注意|吃谷攻略|怎么买谷|谷子怎么|吃谷指南/;
  /** 二次元词命中但明显是记账句 → 不拦截，交给正常记账流 */
  function guIsBookkeeping(raw) {
    return /^\d/.test(raw) ||
      /(记|花|付|支出|买了|开销|消费)\s*[\d¥]/.test(raw) ||
      /记一笔|记一笔记|支出|花了|付了/.test(raw);
  }
  /** 返回 true 表示已本地处理（拦截），调用方应 return */
  function guIntercept(raw) {
    if (GU_GUIDE_CMDS.test(raw)) { addAIMessage(buyGuideAnswer()); return true; }
    if (GU_KEYWORDS.test(raw) && !guIsBookkeeping(raw)) { addAIMessage(guQuickNote(raw)); return true; }
    return false;
  }
  /** 结构化买谷指南问答（模块6）：5 问一句话结论 + 展开 */
  function buyGuideAnswer() {
    var items = [
      ['怎么判断正版？', '有授权/中文标识、能出示授权书才放心；标「祖国版/工作室出品/尾单/散货」一律按盗版。'],
      ['拼团怎么不被跑路？', '只走平台担保、团长≥3次成功开团、公开凭证物流、规模≤50人预售≤6月；说「未成年不能闲鱼所以私转」的直接拉黑。'],
      ['盲盒能抽吗？', '抽前过3问：热冷查了吗/概率公示了吗/二手出掉意愿？两问答不上就先别抽，去闲鱼收确认款。'],
      ['闲鱼收二手注意什么？', '只走平台担保、要实物图+对光视频、看评价、先验货再确认收货。'],
      ['热谷冷谷怎么查？', '买前搜「角色名+谷」看闲鱼近期成交均价，热谷加价、冷谷常低于发行价。']
    ];
    var html = aiBubble(ic('bulb', 'bico-brand', '买谷指南') + '<b>买谷避坑指南</b>（消协/监管口径，防损不省钱）') +
      '<div class="gu-guide">';
    for (var i = 0; i < items.length; i++) {
      html += '<div class="gu-q"><div class="gu-q-title">' + esc(items[i][0]) + '</div>' +
        '<div class="gu-q-body">' + esc(items[i][1]) + '</div></div>';
    }
    html += '<div class="gu-foot">想系统看 → 打开 <b>省钱图谱 → 吃谷避坑</b>，可打卡防坑清单。说「买谷指南」随时调出本速览。</div>';
    html += '</div>';
    return html;
  }
  /** 二次元词轻提示：按关键词给盲抽/拼团/出谷/通用对应劝导 */
  function guQuickNote(raw) {
    var tip;
    if (/盲抽|抽赏|抽盒|盲盒/.test(raw)) {
      tip = '想抽盲盒/抽赏前先过3问：这个角色热冷查了吗？隐藏款概率公示了吗？抽到不想要的款愿花精力出二手吗？两问答不上就先别抽——去闲鱼直接收确认款更划算。';
    } else if (/拼团|跟团/.test(raw)) {
      tip = '拼团是跑路重灾区：只走平台担保（闲鱼链接），不接受微信/支付宝私转；团长要有≥3次成功开团记录。任何「未成年不能闲鱼所以私转」的都是话术，直接拉黑。';
    } else if (/出谷|回血|卖谷|卖了|闲置/.test(raw)) {
      tip = '把不想要的谷卖掉叫「出谷/回血」，是正向现金流，值得鼓励！卖出后在记账里选「收入 → 其他/闲置回血」，金额填实际到手；回血的钱建议进吃谷罐或存钱罐，形成买谷-回血闭环。';
    } else {
      tip = '买谷前先对渠道：官方旗舰店/授权谷店闭眼入，闲鱼只走平台担保，私转和「祖国版/尾单/散货」一律按盗版处理。想系统学 → 说「买谷指南」或打开省钱图谱→吃谷避坑。';
    }
    return aiBubble(ic('alert', 'bico-warn', '吃谷提醒') + tip);
  }
  /** 账本联动：购物 + 备注/商家含谷 → 正版确认提示卡 */
  function guBuyNoteHtml() {
    return '<div class="gu-buynote">' + ic('alert', 'bico-warn', '买谷确认') +
      '<span>这笔买谷的？确认一下是不是<b>官方渠道</b>，别买到「祖国版 / 尾单 / 散货」——这些一律按盗版处理，质量无保障还难售后。渠道分级见 <b>省钱图谱 → 吃谷避坑</b>。</span></div>';
  }

  /** 【余额概览】卡片：本周期收入 / 支出 / 余额 + 日月馒头额度 */
  function balanceOverviewHtml(overview) {
    var st = overview.cycleAgg;
    var bs = overview.budgetState;
    var sentence = overview.sentence || '';
    return '' +
      '<div class="balance-card">' +
      '  <div class="bc-title">' + ic('wallet', 'bico-brand', '余额概览') + '【余额概览】</div>' +
      '  <div class="bc-grid">' +
      '    <div><b>' + money(st.income) + '</b><small>本周期收入</small></div>' +
      '    <div><b>' + money(st.expense) + '</b><small>本周期支出</small></div>' +
      '    <div><b class="' + (bs.remaining < 0 ? 'expense' : 'income') + '">' + money(bs.remaining) + '</b><small>剩余额度</small></div>' +
      '    <div><b>' + money(Math.max(0, bs.dailyAllowance)) + '</b><small>剩余每天可花</small></div>' +
      '  </div>' +
      /* sentence 内含行内图标 html（内部生成，不含用户输入），不能再 esc，否则会把
         <svg> 当纯文本画出来 */
      '  <div class="bc-sentence">' + sentence + '</div>' +
      '</div>';
  }

  /** 冷静期决策卡（设计稿 P4：聚焦 + 单一主决策 + 校园平替） */
  function showCooldownCard(draft) {
    /* 阿账事件源②：冷静期卡弹出 → 当场质问（mad），主理人决策 #1 */
    MOOD.onEvent('impulse_flag');
    petReact('impulse_flag', { amount: draft.amount, note: draft.note || draft.category });
    var overview = getOverview();
    var sim = ENG.simulatePurchase({
      amount: draft.amount,
      state: overview.budgetState,
      remainingDays: overview.cycle.remainingDays
    });
    var alt = ENG.getAlternative({ note: draft.note, category: draft.category, amount: draft.amount });

    // 业务规则：冷静期提醒必须说清「占生活费的比例」+「24 小时」+「对食堂伙食预算的影响」
    var ratioText = '';
    var totalBudget = Number(state.budget.total) || 0;
    if (totalBudget > 0) {
      ratioText = '这笔占你南海北区生活费的 ' + Math.round(draft.amount / totalBudget * 1000) / 10 + '%。';
    }
    var cooldownNotice = ratioText +
      '先别急着下单，把它丢进购物车晾 24 小时，明天还想要我再帮你记上。不过说真的，这几天食堂伙食预算会被它吃掉不少，你心里得有数。';

    var rows = '' +
      dcRow('商品', esc(draft.note || draft.category || '未命名')) +
      dcRow('金额', '<b class="mono">' + money(draft.amount) + '</b>') +
      dcRow('分类', esc(draft.category) + ' · 非必需');

    var html = '' +
      '<div class="decision-card">' +
      '  <div class="dc-icon">!</div>' +
      '  <div class="dc-title">冷静期提醒</div>' +
      '  <div class="dc-sub">停一下！' + money(draft.amount) + ' 块，够吃好几顿食堂了</div>' +
      '  <div class="dc-detail">' + rows + '</div>' +
      '  <div class="dc-alert"><span class="dc-dot"></span><span>' + esc(cooldownNotice) + ' ' + esc(sim.message) + '</span></div>' +
      (alt
        ? '  <div class="dc-suggest"><span class="dc-dot"></span><span>校园平替：' + esc(alt.altName) +
          ' 约 ' + money(alt.altPrice) + '，可省 ' + money(alt.save) + '</span></div>'
        : '') +
      '  <div class="dc-actions">' +
      '    <button type="button" class="dc-primary" data-act="cooldown-skip">先不买，省下 ' + money(draft.amount) + '</button>' +
      '    <button type="button" class="dc-secondary" data-act="cooldown-buy">仍然记下这笔</button>' +
      '  </div>' +
      '</div>';
    addAIMessage(html);
  }

  function dcRow(label, valueHtml) {
    return '<div class="dc-row"><span>' + label + '</span><span>' + valueHtml + '</span></div>';
  }

  var PUSH_BACK_LINES = [
    '好的，那这笔就记上了～下不为例哦。',
    '行吧，快乐也是刚需，但我先记在小本本上了。',
    '记好了。下次看到「限时」两个字，先深呼吸三次。'
  ];

  function resolveCooldown(keep) {
    var draft = pendingBill;
    if (!draft) { return; }
    pendingBill = null;

    if (keep) {
      var bill = commitBill(draft);
      flow.committed.push(bill);
      var line = PUSH_BACK_LINES[Math.floor(Math.random() * PUSH_BACK_LINES.length)];
      addAIMessage(aiBubble(esc(line) + '<br>这笔 ' + money(bill.amount) + ' 我按「情绪消费」记下了。今天是不是压力有点大？偶尔买点开心没关系，但别让它变成习惯哦～'));
      showToast('已记下这笔，并标记为冲动消费', 'warn');
    } else {
      state.savedMoney = ENG.round2(state.savedMoney + draft.amount);
      state.blockedCount = ENG.round2(state.blockedCount + 1);
      saveState();
      /* 阿账事件源③：用户选「先不买」拦截成功 → 举 STOP 牌（stop），主理人决策 #1 */
      MOOD.onEvent('cooldown_block');
      petReact('cooldown_block', { amount: draft.amount });
      addAIMessage(aiBubble('这波省下 ' + money(draft.amount) + '，已记进你的「省下的钱」成就（累计 ' +
        money(state.savedMoney) + '）。'));
      showToast('已为你省下 ' + money(draft.amount), 'ok');
      renderAll();
    }
    stepFlow();
  }

  /* ================================================================== */
  /* 理财专家 · 剁手冷静法                                                */
  /* ================================================================== */

  /** 剁手冷静法会话状态：{item, price, step, answers}；step 为 0 基索引 */
  var cooling = null;

  /** 启动剁手冷静法（用户表达「想买 XX」时由 sendToAssistant 调用） */
  function startCoolingFlow(item, price) {
    /* coolDays = 默认冷静期天数；wishId = 本条若走「放进心愿单」后拿到的条目 id，
       结论卡选「还是要买」时用它把心愿单条目翻成 bought（含 savedMoney 精确回退）。 */
    cooling = {
      item: String(item || '想买的东西'),
      price: Number(price) || 0,
      step: 0,
      answers: [],
      coolDays: 2,
      wishId: ''
    };
    renderCoolingIntro();
  }

  function renderCoolingIntro() {
    var html =
      '<div class="decision-card cool-card">' +
      '  <div class="dc-icon cool"><svg viewBox="0 0 24 24"><use href="#i-stop"/></svg></div>' +
      '  <div class="dc-title">剁手冷静法</div>' +
      '  <div class="dc-sub">想买：' + esc(cooling.item) + '</div>' +
      '  <div class="dc-detail">' + dcRow('方法', '回答 3 个问题，30 秒看清该不该买') + '</div>' +
      '  <div class="dc-actions">' +
      '    <button type="button" class="dc-primary" data-act="cool-next">开始冷静问答</button>' +
      '  </div>' +
      '</div>';
    addAIMessage(html);
  }

  function renderCoolingQuestion() {
    var stepDef = COACH.COOLING_STEPS[cooling.step];
    if (!stepDef) { renderCoolingVerdict(); return; }
    var opts = '';
    for (var i = 0; i < stepDef.options.length; i++) {
      opts += '<button type="button" class="cool-opt" data-act="cool-answer" data-val="' +
        esc(stepDef.options[i].val) + '">' + esc(stepDef.options[i].label) + '</button>';
    }
    var html =
      '<div class="decision-card cool-card">' +
      '  <div class="dc-icon cool"><svg viewBox="0 0 24 24"><use href="#i-think"/></svg></div>' +
      '  <div class="dc-title">' + esc(stepDef.q) + '</div>' +
      '  <div class="dc-sub">想买：' + esc(cooling.item) + ' · 第 ' + (cooling.step + 1) + ' / 3 问</div>' +
      '  <div class="cool-opts">' + opts + '</div>' +
      '</div>';
    addAIMessage(html);
  }

  function renderCoolingVerdict() {
    var v = COACH.coolingVerdict(cooling.answers);
    var actions = '';
    if (cooling.price > 0) {
      actions += '<button type="button" class="dc-primary" data-act="cool-record">还是要买，帮我记下 ' +
        money(cooling.price) + '</button>';
      /* 有价格分支：这句话现在同时承担「省下钱 + 进心愿单」两件事，
         所以按钮字改成「放进心愿单」——只说「省下」会让用户以为东西丢了。 */
      actions += '<button type="button" class="dc-secondary" data-act="cool-skip">先不买了，放进心愿单</button>';
    } else {
      actions += '<div class="cool-note">告诉我它的价格，我帮你记上这笔。</div>';
      actions += '<button type="button" class="dc-secondary" data-act="cool-skip">先不买了</button>';
    }
    var html =
      '<div class="decision-card cool-card verdict-' + v.level + '">' +
      '  <div class="dc-icon cool">' + ic(v.icon, null, v.level === 'ok' ? '可以买' : '提醒') + '</div>' +
      '  <div class="dc-title">' + esc(v.title) + '</div>' +
      '  <div class="dc-sub">想买：' + esc(cooling.item) + '</div>' +
      '  <div class="dc-detail">' + dcRow('专家判断', esc(v.text)) + '</div>' +
      '  <div class="dc-actions">' + actions + '</div>' +
      '</div>';
    addAIMessage(html);
  }

  /** 三步问答中的一步作答（btnEl 用于把问题卡标记为已作答，防重复点击） */
  function coolingAnswer(val, btnEl) {
    if (!cooling) { return; }
    var card = btnEl && btnEl.closest ? btnEl.closest('.cool-card') : null;
    if (card) {
      if (card.getAttribute('data-done') === '1') { return; }
      card.setAttribute('data-done', '1');
      var stepDef = COACH.COOLING_STEPS[cooling.step];
      var label = val;
      if (stepDef) {
        for (var i = 0; i < stepDef.options.length; i++) {
          if (stepDef.options[i].val === val) { label = stepDef.options[i].label; }
        }
      }
      var optsBox = card.querySelector('.cool-opts');
      if (optsBox) { optsBox.innerHTML = '<span class="tag green">已选：' + esc(label) + '</span>'; }
    }
    cooling.answers.push(val);
    cooling.step++;
    if (cooling.step >= COACH.COOLING_STEPS.length) {
      renderCoolingVerdict();
    } else {
      renderCoolingQuestion();
    }
  }

  /**
   * 用三步问答的选项文案拼一句「为什么想买」，作为心愿单备注。
   * 目的：48 小时后回访时，让用户看到当时的自己是怎么想的。
   * @return {string} 不超过 60 字（wishlist.note 的上限，超了会被截断）
   */
  function coolingReason() {
    if (!cooling || !Array.isArray(cooling.answers) || !cooling.answers.length) { return ''; }
    var parts = [];
    var steps = COACH.COOLING_STEPS || [];
    for (var i = 0; i < cooling.answers.length; i++) {
      var step = steps[i];
      if (!step || !step.options) { continue; }
      for (var j = 0; j < step.options.length; j++) {
        if (step.options[j].val === cooling.answers[i]) {
          parts.push(step.options[j].label);
          break;
        }
      }
    }
    return parts.join(' · ').slice(0, 60);
  }

  /** 结论后选择「仍然购买」：直接入账（已走完冷静流程，不再二次弹冷静期） */
  function coolingRecord() {
    if (!cooling) { return; }
    var draft = {
      amount: cooling.price,
      category: '购物',
      note: cooling.item,
      date: ENG.formatDate(new Date()),
      motivation: '情绪',
      want: true,
      type: 'expense'
    };
    var bill = commitBill(draft);
    /* 这笔当初可能是从心愿单里点「还是要买」进来的：
       ① 把心愿单条目翻成 bought 并记下账单 id（对账用）；
       ② 入清单时已把金额计入 savedMoney，现在真买了就必须精确回退，
          blockedCount 同步减 1（且不小于 0），否则「省下的钱」会凭空多一笔。 */
    if (cooling.wishId) {
      var it = WISH.get(cooling.wishId);
      var counted = !!(it && it.savedCounted);
      WISH.decide(cooling.wishId, 'bought', { billId: bill.id });
      if (counted) {
        state.savedMoney = ENG.round2(Math.max(0, state.savedMoney - it.amount));
        state.blockedCount = Math.max(0, Math.round(state.blockedCount) - 1);
        saveState();
      }
      var boughtLine = toneLine('cool.bought', { title: cooling.item, amount: money(bill.amount) });
      if (boughtLine) { addAIMessage(aiBubble(esc(boughtLine))); }
    }
    cooling = null;
    renderAll();
    reportCommitted([bill]);
  }

  /** 结论后选择「先不买」：金额计入「省下的钱」成就，并落一条心愿单 */
  function coolingSkip() {
    if (!cooling) { return; }
    var amount = cooling.price;
    if (amount > 0) {
      state.savedMoney = ENG.round2(state.savedMoney + amount);
      state.blockedCount = ENG.round2(state.blockedCount + 1);
      saveState();
      /* 入清单失败（写盘满 / 存储不可用）不能连累「省下的钱」：
         钱已经省下来了这件事仍然成立，只是这次没留下清单条目。 */
      var added = WISH.add({
        title: cooling.item,
        amount: amount,
        note: coolingReason(),
        coolDays: 2,
        source: 'cooling'
      });
      if (added && added.ok) { cooling.wishId = added.item.id; }
      var coolLine = toneLine('cool.added', { title: cooling.item });
      var savedLine = '这波省下 ' + money(amount) + '，已记进「省下的钱」（累计 ' +
        money(state.savedMoney) + '）。';
      addAIMessage(aiBubble((coolLine ? esc(coolLine) + '<br>' : '') + savedLine));
      showToast(added && added.ok
        ? '已放进心愿单，48 小时后我再来问你'
        : '已为你省下 ' + money(amount), 'ok');
      renderAll();
    } else {
      addAIMessage(aiBubble('好，那先不买。把它加进购物车晾 48 小时，还想要再来找我。'));
    }
    cooling = null;
  }

  /* ================================================================== */
  /* 概览计算                                                            */
  /* ================================================================== */

  function getOverview() {
    var today = new Date();
    var todayStr = ENG.formatDate(today);
    var cycle = ENG.getCycle(today, state.budget.payday, null, state.budget.cycleStart);
    var cycleAgg = ENG.aggregate(state.bills, cycle.start, cycle.end);
    var allAgg = ENG.aggregate(state.bills, null, null);
    var todaySpent = ENG.round2(cycleAgg.dailyMap[todayStr] || 0);
    /* 存钱罐占用：钱挪进罐子后就不在「可花的钱」里了，所以计入已占用额度。
       注意只影响预算口径（剩余额度 / 日均可用），不写账单、不动消费统计，
       因此分类占比、恩格尔系数、近 7 日趋势全部保持原样。 */
    var piggyBalance = ENG.round2(PIGGY.getBalance() || 0);
    var budgetState = ENG.getBudgetState({
      total: state.budget.total,
      spent: ENG.round2(cycleAgg.expense + piggyBalance),
      remainingDays: cycle.remainingDays,
      todaySpent: todaySpent
    });
    var engel = ENG.getEngel(cycleAgg.byCategory, cycleAgg.expense);
    var incomeStats = ENG.getIncomeStats(state.bills, cycle);
    var monthlySurplus = cycle.remainingDays > 0
      ? Math.max(0, ENG.round2(budgetState.remaining / cycle.remainingDays * 30))
      : 0;
    var sentence;
    if (budgetState.isOver) {
      sentence = ic('alert', 'bico-bad', '超支') + '本周期已经超支 ' + money(budgetState.overBy) + '，接下来 ' +
        cycle.remainingDays + ' 天建议只吃食堂，先把窟窿补上。';
    } else if (budgetState.status === 'danger') {
      sentence = ic('alert', 'bico-bad', '吃土预警') + '本周期还剩 ' + money(budgetState.remaining) + '，日均可用只有 ' +
        money(budgetState.dailyAllowance) + '，进入吃土预警状态。';
    } else if (budgetState.status === 'tight') {
      sentence = ic('bar', 'bico-warn', '预算偏紧') + '本周期还剩 ' + money(budgetState.remaining) + '，日均可用 ' +
        money(budgetState.dailyAllowance) + '，稍微收着点花。';
    } else {
      sentence = ic('wallet', 'bico-brand', '预算正常') + '本周期还剩 ' + money(budgetState.remaining) + '，日均可用 ' +
        money(budgetState.dailyAllowance) + '，节奏还不错，继续保持。';
    }
    return {
      today: today,
      todayStr: todayStr,
      cycle: cycle,
      cycleAgg: cycleAgg,
      allAgg: allAgg,
      piggyBalance: piggyBalance,
      budgetState: budgetState,
      engel: engel,
      incomeStats: incomeStats,
      monthlySurplus: monthlySurplus,
      sentence: sentence
    };
  }

  /* ================================================================== */
  /* 看板渲染                                                            */
  /* ================================================================== */

  function renderAll() {
    renderDashboard();
    renderGoals();
    renderCoachPanel();
    renderSimple();
  }

  /* ================================================================== */
  /* 理财专家面板渲染                                                     */
  /* ================================================================== */

  /** 渲染「理财专家」Tab：专属建议 + 团购省钱 + 理财学院 */
  function renderCoachPanel() {
    renderCoachTips();
    renderCoachGroupBuy();
    renderCoachAcademy();
    renderPersona();
  }

  /**
   * 团购省钱：校外吃玩先搜券再下单（静态指导，文案由 coach.js 统一生成，
   * 保证与聊天气泡里的团购答案同源，不在 HTML 里硬编码规则文字）。
   */
  function renderCoachGroupBuy() {
    var box = $('groupBuyBody');
    if (!box) { return; }
    if (!COACH || typeof COACH.groupBuyPanelHtml !== 'function') { return; }
    box.innerHTML = COACH.groupBuyPanelHtml();
  }

  /** 专属建议：基于本周期账单数据动态生成（COACH.personalTips） */
  function renderCoachTips() {
    var box = $('coachTips');
    if (!box) { return; }
    var ov = getOverview();
    var tips = COACH.personalTips(state, ov);
    var html = '';
    for (var i = 0; i < tips.length; i++) {
      var t = tips[i];
      html += '<div class="coach-tip level-' + esc(t.level) + '">' +
        '<div class="coach-tip-head"><span class="coach-tip-ico">' + ic(t.icon, null, null) + '</span>' +
        '<b>' + esc(t.title) + '</b></div>' +
        '<div class="coach-tip-text">' + esc(t.text) + '</div>' +
        '</div>';
    }
    box.innerHTML = html;
  }

  /**
   * 校验外链协议：只放行 http / https。
   * 用于知识卡资源区，避免 javascript: / data: 之类可执行协议进入 href。
   * @param {string} url 待校验地址
   * @return {string} 合法时返回原地址，否则返回空串
   */
  function safeHttpUrl(url) {
    if (typeof url !== 'string') { return ''; }
    var v = url.replace(/^\s+|\s+$/g, '');
    return /^https?:\/\//i.test(v) ? v : '';
  }

  /**
   * 渲染单张知识卡的学习资源区（可选字段 resources）。
   * 无 resources 或全部条目非法时返回空串，保证未挂资源的卡不报错。
   * @param {Object} lesson 知识卡数据
   * @return {string} 资源区 HTML 片段
   */
  function coachResHtml(lesson) {
    if (!lesson || !lesson.resources || !lesson.resources.length) { return ''; }
    var rows = '';
    for (var i = 0; i < lesson.resources.length; i++) {
      var r = lesson.resources[i];
      if (!r || !r.label) { continue; }
      var label = esc(r.label);
      var desc = r.desc ? esc(r.desc) : '';
      if (r.type === 'copy') {
        var copyText = typeof r.copy === 'string' ? r.copy : '';
        if (copyText === '') { continue; }
        rows += '<div class="coach-res-item">' +
          '<span class="coach-res-main">' +
          '<span class="coach-res-label">' + label + '</span>' +
          (desc ? '<span class="coach-res-desc">' + desc + '</span>' : '') +
          '</span>' +
          '<button type="button" class="coach-res-copy" data-copy="' + esc(copyText) + '">复制</button>' +
          '</div>';
        continue;
      }
      var href = safeHttpUrl(r.url);
      if (href === '') { continue; }
      rows += '<a class="coach-res-item" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="coach-res-main">' +
        '<span class="coach-res-label">' + label + '</span>' +
        (desc ? '<span class="coach-res-desc">' + desc + '</span>' : '') +
        '</span>' +
        '<span class="coach-res-go" aria-hidden="true">↗</span>' +
        '</a>';
    }
    var note = lesson.resNote ? esc(lesson.resNote) : '';
    if (rows === '' && note === '') { return ''; }
    return '<div class="coach-res">' +
      (rows !== '' ? '<div class="coach-res-title">学习资源</div>' + rows : '') +
      (note !== '' ? '<div class="coach-res-note">' + note + '</div>' : '') +
      '</div>';
  }

  /**
   * 理财学院：知识卡列表（COACH.ACADEMY）。
   * 列表只渲染标题行；点击整行弹详情弹窗（openAcademyLessonModal），
   * 详细内容（原理 / 步骤 / 清单）全部收进弹窗，列表保持一屏多行。
   */
  function renderCoachAcademy() {
    var box = $('coachAcademy');
    if (!box) { return; }
    var html = '';
    for (var i = 0; i < COACH.ACADEMY.length; i++) {
      var l = COACH.ACADEMY[i];
      html += '<div class="coach-lesson" data-lesson="' + esc(l.id) + '">' +
        '<button type="button" class="coach-lesson-head">' +
        '<span class="coach-lesson-ico">' + ic(l.icon, null, null) + '</span>' +
        '<span class="coach-lesson-title">' + esc(l.title) + '</span>' +
        '<span class="coach-lesson-tag">' + esc(l.tag) + '</span>' +
        '<span class="coach-lesson-arrow">›</span>' +
        '</button>' +
        '</div>';
    }
    box.innerHTML = html;
  }

  /**
   * 降级复制：临时 textarea + document.execCommand('copy')。
   * 用于非 https 环境或浏览器不支持 Clipboard API 的情况。
   * @param {string} text 要复制的文本
   * @return {boolean} 是否复制成功
   */
  function coachLegacyCopy(text) {
    if (!DOC || !DOC.body || typeof DOC.execCommand !== 'function') { return false; }
    var ta = DOC.createElement('textarea');
    var ok = false;
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    DOC.body.appendChild(ta);
    try {
      ta.focus();
      ta.select();
      if (typeof ta.setSelectionRange === 'function') { ta.setSelectionRange(0, text.length); }
      ok = DOC.execCommand('copy') === true;
    } catch (err) {
      ok = false;
    }
    if (ta.parentNode) { ta.parentNode.removeChild(ta); }
    return ok;
  }

  /**
   * 复制文本：优先 Clipboard API，失败或不可用时降级。
   * @param {string} text 要复制的文本
   * @param {Function} done 回调，参数为是否成功（boolean）
   */
  function coachClipboardWrite(text, done) {
    var nav = global.navigator;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      try {
        var p = nav.clipboard.writeText(text);
        if (p && typeof p.then === 'function') {
          p.then(function () { done(true); }, function () { done(coachLegacyCopy(text)); });
          return;
        }
        done(true);
        return;
      } catch (err) {
        /* 少数浏览器会同步抛错（非安全上下文），继续走降级 */
      }
    }
    done(coachLegacyCopy(text));
  }

  /**
   * 知识卡资源区「复制」按钮：复制 data-copy 文本并给出反馈。
   * 成功后按钮文案短暂变为「已复制」，1.5s 后恢复；重复点击重新计时。
   * @param {Element} btn 触发复制的按钮
   */
  function coachCopyResource(btn) {
    var text = btn && btn.getAttribute ? (btn.getAttribute('data-copy') || '') : '';
    if (text === '') { return; }
    coachClipboardWrite(text, function (ok) {
      if (!ok) {
        showToast('复制失败，请手动记下「' + text + '」再去抖音搜索', 'warn');
        return;
      }
      if (btn.__copyTimer) { clearTimeout(btn.__copyTimer); }
      btn.textContent = '已复制';
      btn.classList.add('is-done');
      showToast('已复制「' + text + '」，打开抖音搜索即可', 'ok');
      btn.__copyTimer = setTimeout(function () {
        btn.textContent = '复制';
        btn.classList.remove('is-done');
        btn.__copyTimer = null;
      }, 1500);
    });
  }

  /**
   * 知识卡详情弹窗：把 detail 结构化段落渲染成 弹窗正文。
   * 段落三种形态：{h, p} 一段话；{h, list:[...]} 圆点清单；{h, steps:[...]} 编号步骤。
   * @param {Object} lesson 知识卡数据
   * @return {string} 正文 HTML
   */
  function academyDetailHtml(lesson) {
    if (!lesson || !lesson.detail || !lesson.detail.length) { return ''; }
    var html = '';
    for (var i = 0; i < lesson.detail.length; i++) {
      var sec = lesson.detail[i];
      if (!sec || !sec.h) { continue; }
      html += '<div class="am-sec"><h5>' + esc(sec.h) + '</h5>';
      if (sec.p) { html += '<p class="am-p">' + esc(sec.p) + '</p>'; }
      if (sec.list && sec.list.length) {
        html += '<ul class="am-list">';
        for (var j = 0; j < sec.list.length; j++) { html += '<li>' + esc(sec.list[j]) + '</li>'; }
        html += '</ul>';
      }
      if (sec.steps && sec.steps.length) {
        html += '<ol class="am-steps">';
        for (var k = 0; k < sec.steps.length; k++) { html += '<li>' + esc(sec.steps[k]) + '</li>'; }
        html += '</ol>';
      }
      html += '</div>';
    }
    return html;
  }

  /**
   * 打开知识卡详情弹窗（理财学院条目点击的统一出口）。
   * 结构：图标 + 标题 + 标签 → 一句话导语（body 首行）→ detail 分节 → 学习资源 → 关闭按钮。
   * 弹窗内的「复制」按钮需要单独绑定：coachAcademy 上的事件委托够不到 #modalBox。
   * @param {string} id 知识卡 id（data-lesson）
   */
  function openAcademyLessonModal(id) {
    var lesson = null;
    for (var i = 0; i < COACH.ACADEMY.length; i++) {
      if (COACH.ACADEMY[i].id === id) { lesson = COACH.ACADEMY[i]; break; }
    }
    if (!lesson) { return; }
    var intro = String(lesson.body || '').split('\n')[0];
    var html =
      '<div class="academy-modal-head">' +
      '<span class="academy-modal-ico">' + ic(lesson.icon, null, null) + '</span>' +
      '<div class="academy-modal-tt">' +
      '<h4>' + esc(lesson.title) + '</h4>' +
      '<span class="coach-lesson-tag">' + esc(lesson.tag || '') + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="academy-modal-body">' +
      (intro ? '<p class="am-intro">' + esc(intro) + '</p>' : '') +
      academyDetailHtml(lesson) +
      coachResHtml(lesson) +
      '</div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-ok" data-act="modal-cancel">我知道了</button>' +
      '</div>';
    var box = openModal(html);
    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
    /* 弹窗里的资源复制按钮（copy 型资源），与列表区共用 coachCopyResource */
    var copies = box.querySelectorAll('[data-copy]');
    for (var c = 0; c < copies.length; c++) {
      copies[c].addEventListener('click', function (ev) {
        ev.preventDefault();
        coachCopyResource(ev.currentTarget);
      });
    }
  }

  /* ================================================================== */
  /* 看板「详细信息」弹窗族（学习资源 / 消费诊断 / 恩格尔 / 成就）           */
  /* ================================================================== */

  /**
   * 详情弹窗正文的「还有内容」提示。
   * 正文超过可视高度时在底部加一层渐隐，滚到底自动去掉——
   * 否则内容被硬切断，用户会以为弹窗就这么长。
   * @param {HTMLElement} box #modalBox
   */
  function bindDocScroll(box) {
    var body = box ? box.querySelector('.doc-body') : null;
    if (!body) { return; }
    var update = function () {
      var more = body.scrollHeight - body.clientHeight - body.scrollTop > 6;
      body.classList.toggle('is-more', more);
    };
    body.addEventListener('scroll', update, { passive: true });
    update();
  }

  /** 弹窗骨架：图标 + 标题 + 标签 + 可滚动正文（.doc-* 与 .am-* 共用一套排版） */
  function docModalHtml(opts) {
    var o = opts || {};
    return '<div class="doc-head">' +
      '<span class="doc-ico">' + (o.icon || '') + '</span>' +
      '<div class="doc-tt"><h4>' + esc(o.title || '') + '</h4>' +
      (o.tag ? '<span class="coach-lesson-tag">' + esc(o.tag) + '</span>' : '') +
      '</div></div>' +
      '<div class="doc-body">' + (o.body || '') + '</div>';
  }

  /** 分节正文：与理财学院知识卡共用 .am-* 组件，避免两套排版 */
  function docSectionsHtml(sections) {
    return academyDetailHtml({ detail: sections || [] });
  }

  /** 小标签行（视频课 / 免费 / 建议 40 分钟…） */
  function docChipsHtml(list) {
    if (!list || !list.length) { return ''; }
    var out = '';
    for (var i = 0; i < list.length; i++) {
      out += '<span class="doc-chip">' + esc(list[i]) + '</span>';
    }
    return '<div class="doc-chips">' + out + '</div>';
  }

  /**
   * 学习资源详情弹窗。
   * 整行点击进这里看「是什么 / 为什么推给你 / 怎么看 / 看哪几集」，
   * 弹窗底部再给一次「打开原页面」，避免详情变成绕路。
   * @param {number} idx learnResourceCache 下标（渲染顺序）
   */
  function openLearnResourceModal(idx) {
    var r = learnResourceCache[idx];
    if (!r) { return; }
    var iconName = r.type === 'up' ? 'user' : (r.type === 'course' ? 'cap' : 'play');
    var href = safeHttpUrl(r.url);
    var body = (r.desc ? '<p class="am-intro">' + esc(r.desc) + '</p>' : '') +
      docChipsHtml(r.meta) +
      docSectionsHtml(r.detail);
    var box = openModal(docModalHtml({
      icon: ic(iconName, null, null),
      title: r.label,
      tag: r.tag,
      body: body
    }) + '<div class="modal-actions">' +
      (href ? '<button type="button" class="btn-ok" data-act="learn-open">打开原页面</button>' : '') +
      '<button type="button" class="btn-cancel" data-act="modal-cancel">' +
      (href ? '先不看' : '我知道了') + '</button>' +
      '</div>');
    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
    var openBtn = box.querySelector('[data-act="learn-open"]');
    if (openBtn && href) {
      openBtn.addEventListener('click', function () {
        global.open(href, '_blank', 'noopener');
        closeModal();
      });
    }
  }

  /**
   * 消费诊断的 4 条规则口径。
   * build() 只返回「已触发」的规则，这里把没触发的也列出来并讲清阈值——
   * 「为什么没报」和「为什么报了」同样重要，否则用户只会觉得在瞎猜。
   */
  function diagRuleRows() {
    var st = getSettings();
    var ov = getOverview();
    var input = diagInput(ov);
    var hit = {};
    var list = diagList(ov);
    var i;
    for (i = 0; i < list.length; i++) { hit[list[i].code] = list[i]; }

    var dailyCap = Number(st.dailyCap) || 0;
    var alertRatio = Number(st.alertRatio);
    if (!(alertRatio > 0 && alertRatio <= 1)) { alertRatio = 0.8; }
    var passedDays = Math.max(1, ov.cycle.passedDays);
    var expense = Number(ov.cycleAgg.expense) || 0;
    var dailyAvg = passedDays > 0 ? expense / passedDays : 0;
    var smallThr = Math.max(10, Math.min(dailyAvg * 0.5, 100));

    var rows = [];

    rows.push({
      code: 'dailyOver',
      title: '单日超支',
      on: !!hit.dailyOver,
      level: hit.dailyOver ? hit.dailyOver.level : '',
      rule: dailyCap > 0
        ? '一天花超 ' + money(dailyCap) + ' 记一条；超 3 天以上算「需要注意」——偶发一笔可能是买教材，连着超就是习惯问题。'
        : '你还没设单日上限，所以这条规则不生效。在「设置 · 预算」里填一个数就能开。',
      fact: hit.dailyOver
        ? '本周期有 ' + hit.dailyOver.days + ' 天超过单日上限，最多的一天花了 ' + money(hit.dailyOver.amount) + '。'
        : (dailyCap > 0 ? '本周期没有单日超过 ' + money(dailyCap) + ' 的记录。' : '单日上限未设置，暂不统计。'),
      action: hit.dailyOver ? DIAG_META.dailyOver.action : ''
    });

    rows.push({
      code: 'wantRatio',
      title: '非必需占比偏高',
      on: !!hit.wantRatio,
      level: hit.wantRatio ? hit.wantRatio.level : '',
      rule: '「想要」类开销占总支出达到 ' + Math.round(alertRatio * 100) + '%，且金额超过 100 元才提示——几十块的非必需不值得专门提醒。',
      fact: hit.wantRatio
        ? '本周期非必需花了 ' + money(hit.wantRatio.amount) + '，占总支出 ' + hit.wantRatio.ratio + '%。'
        : '本周期非必需消费没有同时满足「≥ ' + Math.round(alertRatio * 100) + '%」和「> 100 元」。',
      action: hit.wantRatio ? DIAG_META.wantRatio.action : ''
    });

    rows.push({
      code: 'cycleUp',
      title: '环比涨太快',
      on: !!hit.cycleUp,
      level: hit.cycleUp ? hit.cycleUp.level : '',
      rule: '和上一个同长度周期比，总支出涨过 30% 提示，涨过 80% 升级为「需要注意」。',
      fact: hit.cycleUp
        ? '这周期比上周期多花 ' + hit.cycleUp.ratio + '%，共 ' + money(hit.cycleUp.amount) + '。'
        : (input.prevExpense > 0
          ? '上周期花了 ' + money(input.prevExpense) + '，这周期没超过它的 1.3 倍。'
          : '上周期没有支出记录，没法比较，本条不判定。'),
      action: hit.cycleUp ? DIAG_META.cycleUp.action : ''
    });

    rows.push({
      code: 'smallFreq',
      title: '小额高频',
      on: !!hit.smallFreq,
      level: hit.smallFreq ? hit.smallFreq.level : '',
      rule: '单笔不超过 ' + money(Math.round(smallThr)) + '（日均的一半，10-100 元之间）的支出，累计到 5 笔就提示——奶茶零食这类，单笔不起眼、加起来最贵。',
      fact: hit.smallFreq
        ? hit.smallFreq.count + ' 笔小额加起来 ' + money(hit.smallFreq.amount) + '。'
        : '本周期没有累计到 5 笔的「小额」支出。',
      action: hit.smallFreq ? DIAG_META.smallFreq.action : ''
    });

    return rows;
  }

  /** 消费诊断弹窗：4 条规则全列出来，触发/正常都要给依据 */
  function openDiagAllModal() {
    var rows = diagRuleRows();
    var onCount = 0;
    var i;
    for (i = 0; i < rows.length; i++) { if (rows[i].on) { onCount++; } }

    var body = '<p class="am-intro">诊断只用你的账本数据算，不联网、不猜。下面 4 条规则是全部判定口径：' +
      (onCount ? '本期触发 ' + onCount + ' 条。' : '本期一条都没触发。') + '</p>';

    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var badge = r.on
        ? '<span class="doc-state is-' + esc(r.level) + '">' + (r.level === 'high' ? '需要注意' : '留意') + '</span>'
        : '<span class="doc-state">正常</span>';
      body += '<div class="doc-rule' + (r.on ? ' is-on is-' + esc(r.level) : '') + '">' +
        '<div class="doc-rule-head"><b>' + (i + 1) + '. ' + esc(r.title) + '</b>' + badge + '</div>' +
        '<p class="doc-rule-fact">' + esc(r.fact) + '</p>' +
        '<p class="doc-rule-rule"><span>判定口径</span>' + esc(r.rule) + '</p>' +
        (r.action ? '<p class="doc-rule-act"><span>建议</span>' + esc(r.action) + '</p>' : '') +
        '</div>';
    }

    var box = openModal(docModalHtml({
      icon: ic('abacus', null, null),
      title: '消费诊断 · 全部 ' + rows.length + ' 项',
      tag: onCount ? onCount + ' 项需要留意' : '本期正常',
      body: body
    }) + '<div class="modal-actions">' +
      '<button type="button" class="btn-ok" data-act="modal-cancel">我知道了</button>' +
      '</div>');
    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
  }

  /** 恩格尔系数弹窗：讲清阈值、你落在哪、怎么压下去 */
  function openEngelModal() {
    var ov = getOverview();
    var pct = Math.round(ov.engel.percent);
    var food = ENG.round2(ov.cycleAgg.byCategory['餐饮'] || 0);
    var expense = ENG.round2(ov.cycleAgg.expense);
    var passedDays = Math.max(1, ov.cycle.passedDays);

    var bands = [
      { lo: 0, hi: 30, name: '最富裕', note: '吃只占很小一块，选择空间大' },
      { lo: 30, hi: 40, name: '富裕', note: '常见于食堂为主、开销分散的学生账本' },
      { lo: 40, hi: 50, name: '小康', note: '正常区间，留意别往外卖倾斜' },
      { lo: 50, hi: 60, name: '温饱', note: '吃占一半，其他开销被挤压' },
      { lo: 60, hi: 999, name: '贫困', note: '吃占大头，抗风险能力弱' }
    ];
    var bandRows = '';
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      var inBand = pct >= b.lo && pct < b.hi;
      bandRows += '<div class="doc-band' + (inBand ? ' is-now' : '') + '">' +
        '<span class="doc-band-range">' + (b.hi > 100 ? '≥ ' + b.lo : b.lo + '-' + b.hi) + '%</span>' +
        '<span class="doc-band-name">' + esc(b.name) + '</span>' +
        '<span class="doc-band-note">' + esc(b.note) + '</span>' +
        (inBand ? '<span class="doc-band-you">你在这</span>' : '') +
        '</div>';
    }

    var body = '<p class="am-intro">恩格尔系数 = 餐饮支出 ÷ 总支出。它衡量的是「吃的钱占了多大比例」，' +
      '比例越低，可自由支配的空间越大。</p>' +
      '<div class="doc-stat">' +
      '<div><b>' + pct + '%</b><small>本期餐饮占比</small></div>' +
      '<div><b>' + money(food) + '</b><small>餐饮支出</small></div>' +
      '<div><b>' + money(expense) + '</b><small>总支出</small></div>' +
      '</div>' +
      '<div class="am-sec"><h5>国际通用分档</h5>' +
      '<div class="doc-bands">' + bandRows + '</div>' +
      '<p class="am-p">这套分档是 19 世纪的家计标准，按家庭收入算的。学生食堂便宜、开销种类少，' +
      '数字天然偏低——所以只看趋势，别拿它给自己贴标签。</p></div>' +
      docSectionsHtml([
        { h: '为什么这条要提醒你', p: '餐饮是唯一「每天都在发生」的支出，也是最容易被外卖和小额高频抬起来的一项。' +
          '它一旦超过一半，其他开销（学习、社交、储蓄）就会被挤掉，而单笔金额都不大，很难自己察觉。' },
        { h: '三步把它压下去', steps: [
          '先分清「吃饭」和「吃爽」：食堂两荤一素算前者，外卖加奶茶算后者；',
          '把「吃爽」控制在每周 2 次以内，其余时间去食堂（一餐差 10 元以上）；',
          '充值式的早餐券 / 食堂储值卡能锁定消费，比每次扫码更容易压住冲动。'
        ] },
        { h: '算给你看', p: '外卖一餐 28 元，食堂两荤一素 12 元，一顿差 16 元。' +
          '一周 5 顿外卖换成食堂，省 80 元；一个月 320 元，一学期就是 1280 元——够一台入门平板。' },
        { h: '口径说明', p: '本周期已过 ' + passedDays + ' 天，占比按「餐饮支出 ÷ 本期总支出」实时计算，' +
          '不含收入、不含存钱罐转入。换周期或记账后数字会立刻变。' }
      ]);

    var box = openModal(docModalHtml({
      icon: ic('pie', null, null),
      title: '恩格尔系数 · ' + pct + '%',
      tag: pct >= 60 ? '偏高' : (pct >= 50 ? '留意' : '健康区间'),
      body: body
    }) + '<div class="modal-actions">' +
      '<button type="button" class="btn-ok" data-act="modal-cancel">我知道了</button>' +
      '</div>');
    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
  }

  /** 成就弹窗：把三个数字拆成可追的里程碑，而不是三个孤零零的数 */
  function openAchieveModal() {
    var bills = state.bills.length;
    var blocked = Number(state.blockedCount) || 0;
    var saved = Number(state.savedMoney) || 0;

    var groups = [
      { title: '累计记账笔数', icon: 'receipt', cur: bills, marks: [10, 50, 100, 300, 500], unit: '笔' },
      { title: '冷静期拦下', icon: 'clock', cur: blocked, marks: [1, 3, 5, 10, 20], unit: '次' },
      { title: '省下的钱', icon: 'piggy', cur: saved, marks: [50, 200, 500, 1000, 2000], unit: '元', money: true }
    ];

    var html = '<p class="am-intro">这三个数字不是评分，是你自己攒出来的记录：笔数代表习惯，' +
      '冷静期代表克制，省下的钱是结果。</p>';

    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g];
      var next = null;
      var reached = 0;
      var marks = '';
      for (var m = 0; m < grp.marks.length; m++) {
        var mk = grp.marks[m];
        var got = grp.cur >= mk;
        if (got) { reached++; } else if (next === null) { next = mk; }
        marks += '<span class="doc-mark' + (got ? ' is-got' : '') + '">' +
          (got ? '✓ ' : '') + (grp.money ? '¥' + mk : mk) + '</span>';
      }
      var prev = reached > 0 ? grp.marks[reached - 1] : 0;
      var ratio = next === null ? 1 : Math.max(0, Math.min(1, (grp.cur - prev) / (next - prev)));
      var fmt = function (v) { return grp.money ? '¥' + v : v + ' ' + grp.unit; };
      var nextLine = next === null
        ? '里程碑全部达成 · 共 ' + reached + ' 项'
        : '下一档 ' + fmt(next) + ' · 还差 ' + (grp.money ? '¥' + (next - grp.cur) : (next - grp.cur) + ' ' + grp.unit) +
          ' · 已达成 ' + reached + '/' + grp.marks.length;

      html += '<div class="doc-ach">' +
        '<div class="doc-ach-head"><span class="doc-ach-ico">' + ic(grp.icon, null, null) + '</span>' +
        '<b>' + esc(grp.title) + '</b>' +
        '<span class="doc-ach-val">' + (grp.money ? money(grp.cur) : grp.cur + ' ' + grp.unit) + '</span></div>' +
        '<div class="doc-ach-bar"><i style="width:' + (ratio * 100).toFixed(1) + '%"></i></div>' +
        '<div class="doc-ach-next">' + esc(nextLine) + '</div>' +
        '<div class="doc-marks">' + marks + '</div>' +
        '</div>';
    }

    html += '<div class="am-sec"><h5>怎么攒得快一点</h5>' +
      '<ul class="am-list">' +
      '<li>每天睡前补记一笔：笔数里程碑最容易推进，也最能暴露漏记；</li>' +
      '<li>想买的东西先丢进「心愿单」，48 小时后还想要再买——拦下的每一笔都记进「冷静期」；</li>' +
      '<li>打卡省钱动作时填真实金额，省下的钱才会准。</li>' +
      '</ul></div>';

    var box = openModal(docModalHtml({
      icon: ic('medal', null, null),
      title: '我的成就',
      tag: '已解锁 ' + (function () {
        var n = 0;
        for (var i = 0; i < groups.length; i++) {
          for (var j = 0; j < groups[i].marks.length; j++) {
            if (groups[i].cur >= groups[i].marks[j]) { n++; }
          }
        }
        return n;
      })() + ' 项',
      body: html
    }) + '<div class="modal-actions">' +
      '<button type="button" class="btn-ok" data-act="modal-cancel">我知道了</button>' +
      '</div>');
    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
  }

  /** 专家问答入口：「怎么省钱」 */
  function showSaveMoneyGuide() {
    addAIMessage('<div class="bubble ai coach-bubble">' + COACH.saveMoneyAnswer() + '</div>');
    /* 团购指导：校外餐饮 / 娱乐先搜券再下单（独立卡片，两条气泡并列更好读） */
    if (COACH && typeof COACH.groupBuyAnswer === 'function') {
      addAIMessage('<div class="bubble ai coach-bubble">' + COACH.groupBuyAnswer() + '</div>');
    }
  }

  /** 专家问答入口：「怎么赚钱」 */
  function showMakeMoneyGuide() {
    addAIMessage('<div class="bubble ai coach-bubble">' + COACH.makeMoneyAnswer() + '</div>');
  }

  /** 专家问答入口：「剁手冷静法」——方法说明 + 立即测试 */
  function showCoolingGuide() {
    var lesson = null;
    for (var i = 0; i < COACH.ACADEMY.length; i++) {
      if (COACH.ACADEMY[i].id === 'cooldown') { lesson = COACH.ACADEMY[i]; break; }
    }
    var html = '<div class="coach-qa-title"><svg class="cq-ico" viewBox="0 0 24 24"><use href="#i-stop"/></svg>剁手冷静法 · 48 小时法则</div>';
    if (lesson) {
      html += '<div class="coach-qa-body">' + lesson.body.split('\n').map(esc).join('<br>') + '</div>';
    }
    html += '<div class="coach-qa-actions">' +
      '<button type="button" class="btn-mini primary" data-act="cool-start">测一测：我现在想买…</button>' +
      '</div>';
    addAIMessage('<div class="bubble ai coach-bubble">' + html + '</div>');
  }

  /**
   * 把「理财学院」区块滚到专家面板可视区顶部。
   * 优先滚动专家面板自己的滚动容器（.coach-scroll），避免整页跳动；
   * 找不到容器时降级为 scrollIntoView({block:'start'})，再降级到 scrollIntoView(true)。
   */
  function scrollAcademyIntoView() {
    var box = $('coachAcademy');
    if (!box) { return; }
    var scroller = box.parentNode;
    while (scroller && scroller !== DOC.body &&
      !(scroller.classList && scroller.classList.contains('coach-scroll'))) {
      scroller = scroller.parentNode;
    }
    var hasScroller = !!(scroller && scroller.classList &&
      scroller.classList.contains('coach-scroll'));
    if (hasScroller && typeof box.getBoundingClientRect === 'function' &&
      typeof scroller.getBoundingClientRect === 'function') {
      var delta = box.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      var top = scroller.scrollTop + delta - 8;
      scroller.scrollTop = top > 0 ? top : 0;
      return;
    }
    if (typeof box.scrollIntoView === 'function') {
      try {
        box.scrollIntoView({ block: 'start' });
      } catch (err) {
        box.scrollIntoView(true);
      }
    }
  }

  /**
   * 进入理财学院并定位到学院区。
   * 视图映射交给 switchView（简洁版自动映射到 scoach），此处不硬编码视图名。
   */
  function openAcademy() {
    switchView('coach');
    scrollAcademyIntoView();
  }

  /**
   * 聊天入口：「理财课」——直接列 3 条视频 / 课程资源 + 一键跳理财学院。
   * 学习资源里排在后面的 UP 主主页不进气泡（LEARN_INLINE_MAX 上限不变），
   * 只在底部小字里提示「另有 2 位省钱博主」，避免气泡被撑长。
   * 不切视图，避免打断正在看聊天记录的用户；链接统一过 safeHttpUrl。
   */
  function showLearnGuide() {
    var list = (COACH && typeof COACH.learningResources === 'function')
      ? COACH.learningResources()
      : [];
    var rows = '';
    var shown = 0;
    for (var i = 0; i < list.length && shown < LEARN_INLINE_MAX; i++) {
      var href = safeHttpUrl(list[i].url);
      if (href === '') { continue; }
      rows += '<a class="coach-res-item" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="coach-res-main">' +
        '<span class="coach-res-label">' + esc(list[i].label) + '</span>' +
        (list[i].desc ? '<span class="coach-res-desc">' + esc(list[i].desc) + '</span>' : '') +
        '</span>' +
        '<span class="coach-res-go" aria-hidden="true">↗</span>' +
        '</a>';
      shown++;
    }

    var html = '<div class="coach-qa-title">' +
      '<svg class="cq-ico" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-cap"/></svg>' +
      '理财课 · 视频学习</div>';
    if (rows === '') {
      html += '<div class="coach-qa-body">学习资源暂时没加载出来，刷新页面再试，' +
        '或者去「理财学院」翻知识卡。</div>';
    } else {
      html += '<div class="coach-qa-body"><div class="coach-res">' + rows + '</div></div>';
    }
    html += '<div class="coach-qa-foot">' +
      '视频源为公开 B 站内容、经镜像站转发（打不开就去 B 站搜同名标题）；课程为中国大学 MOOC 官方页面。' +
      '另有 2 位 B 站省钱博主主页，在理财学院查看。</div>';
    html += '<div class="coach-qa-actions">' +
      '<button type="button" class="btn-mini primary" data-act="learn-all">去理财学院看全部（含 2 位省钱博主）›</button>' +
      '</div>';
    addAIMessage('<div class="bubble ai coach-bubble">' + html + '</div>');
  }

  /** 专家面板「问专家」按钮：切回聊天，给出专家能回答的问题入口 */
  function showAskCoachIntro() {
    switchView('chat');
    addAIMessage(
      '<div class="bubble ai coach-bubble">' +
      '<div class="coach-qa-title"><svg class="cq-ico" viewBox="0 0 24 24"><use href="#i-cap"/></svg>理财专家 · 可以这样问我</div>' +
      '<div class="coach-qa-chips">' +
      '<button type="button" class="chip" data-cmd="怎么省钱">怎么省钱</button>' +
      '<button type="button" class="chip" data-cmd="怎么赚钱">怎么赚钱</button>' +
      '<button type="button" class="chip" data-cmd="剁手冷静法">剁手冷静法</button>' +
      '</div>' +
      '<div class="coach-qa-foot">或者直接说「我想买个 XX」，我陪你走冷静法。</div>' +
      '</div>'
    );
  }

  /**
   * 看板「收支概览」卡：本周期 收入 / 支出 / 结余 / 储蓄率。
   * 收入为 0 时储蓄率显示「—」，避免 NaN / Infinity。
   * @param {Object} ov getOverview() 结果
   */
  function renderIncomeCard(ov) {
    var stats = ov.incomeStats || { income: 0, expense: 0, balance: 0, savingsRate: null };
    var incomeEl = $('incIncome');
    var expenseEl = $('incExpense');
    var balanceEl = $('incBalance');
    var rateEl = $('incRate');
    if (!incomeEl || !expenseEl || !balanceEl || !rateEl) { return; }

    incomeEl.textContent = money(stats.income);
    expenseEl.textContent = money(stats.expense);
    balanceEl.textContent = money(stats.balance);
    balanceEl.className = stats.balance < 0 ? 'neg' : '';
    rateEl.textContent = stats.savingsRate === null ? '—' : stats.savingsRate.toFixed(1) + '%';
    rateEl.className = (stats.savingsRate !== null && stats.savingsRate < 0) ? 'neg' : '';

    var hint = $('incomeHint');
    if (hint) {
      hint.textContent = stats.hasIncome
        ? '收入 ' + stats.incomeCount + ' 笔'
        : '还没记收入';
    }
  }

  /**
   * 看板「理财课 · 视频与博主」卡：把理财学院里的视频 / 课程 / B 站 UP 主主页
   * 直接摊在看板上（不再截断，当前 3 条视频课程 + 2 位博主共 5 条）。
   * 数据来自 COACH.learningResources()（单一数据源，不复制链接）；
   * 一旦所有地址都不合法（safeHttpUrl 返回空串）就整卡隐藏，不留空壳。
   */
  /** 看板「理财课」卡里可点开的资源（与渲染时同一份顺序，供弹窗按索引取用） */
  var learnResourceCache = [];

  function renderLearnCard() {
    var card = $('learnCard');
    var box = $('learnMini');
    if (!card || !box) { return; }
    var all = (COACH && typeof COACH.learningResources === 'function')
      ? COACH.learningResources()
      : [];
    var list = [];
    var rows = '';
    var i;
    for (i = 0; i < all.length; i++) {
      var r = all[i];
      var href = safeHttpUrl(r.url);
      if (href === '') { continue; }
      list.push(r);
      var idx = list.length - 1;
      /* 整行是「详情」入口：点开看完整讲解，弹窗里再给「打开原页面」 */
      rows += '<div class="learn-item" role="button" tabindex="0" data-learn="' + idx + '">' +
        '<span class="learn-main">' +
        '<span class="learn-label">' + esc(r.label) + '</span>' +
        (r.desc ? '<span class="learn-desc">' + esc(r.desc) + '</span>' : '') +
        '</span>' +
        (r.type === 'up' ? '<span class="learn-badge">主页</span>' : '') +
        '<span class="learn-go" aria-hidden="true">›</span>' +
        '</div>';
    }
    learnResourceCache = list;
    box.innerHTML = rows;
    card.hidden = (rows === '');
  }

  /**
   * 常驻预算状态条 + 看板预算卡状态芯片。
   * 与看板共用 getOverview()，任何视图（聊天/看板/目标）下都保持最新，
   * 解决原设计「聊天时看不到核心预算」的问题。
   */
  function renderBudgetBar(ov) {
    var bar = $('budgetBar');
    if (!bar) { return; }
    var bs = ov.budgetState;
    var total = state.budget.total;
    var ratio = total > 0 ? Math.max(0, Math.min(1, bs.remaining / total)) : 0;
    var label = bs.isOver ? '已超支' : (bs.status === 'tight' ? '紧张' : '安全');

    bar.className = 'budget-bar state-' + bs.status;
    $('bbAmount').textContent = money(bs.remaining);
    $('bbDaily').textContent = money(bs.dailyAllowance);
    $('bbDays').textContent = ov.cycle.remainingDays + ' 天';
    $('bbFill').style.width = (ratio * 100).toFixed(1) + '%';

    var chip = $('bbStatus');
    if (chip) { chip.textContent = label; }
    var stateChip = $('budgetStateChip');
    if (stateChip) {
      stateChip.textContent = label;
      stateChip.className = 'badge state-' + bs.status;
    }
  }

  function renderDashboard() {
    var ov = getOverview();
    var bs = ov.budgetState;
    var total = state.budget.total;

    renderBudgetBar(ov);
    renderForecastKpi(ov);
    renderDealsMini();
    renderSavingsMini(ov);
    /* 心愿单卡：放在「今天怎么省」之后、「分类占比」之前，属于 L3 消费洞察区 */
    renderWishCard(ov);

    /* ---- 预算环 ---- */
    var ring = $('ringBar');
    var ratio = total > 0 ? Math.max(0, Math.min(1, bs.remaining / total)) : 0;
    if (ring) {
      ring.style.strokeDasharray = RING_C + ' ' + RING_C;
      ring.style.strokeDashoffset = String(RING_C * (1 - ratio));
      ring.style.stroke = bs.status === 'danger' ? '#EF5350' : (bs.status === 'tight' ? '#FF8A3D' : '#07C160');
    }
    $('ringRemaining').textContent = money(bs.remaining);
    $('ringPercent').textContent = '剩余 ' + Math.round(ratio * 100) + '%';

    var badge = $('cycleBadge');
    badge.textContent = '第 ' + ov.cycle.passedDays + ' / ' + ov.cycle.totalDays + ' 天';
    badge.className = 'badge' + (bs.status === 'danger' ? ' danger' : (bs.status === 'tight' ? ' warn' : ''));

    $('statDaily').textContent = money(bs.dailyAllowance);
    $('statToday').textContent = money(bs.todaySpent);
    $('statDays').textContent = ov.cycle.remainingDays + ' 天';
    $('budgetCycle').textContent = '周期 ' + ov.cycle.start + ' ~ ' + ov.cycle.end +
      (ov.cycle.isCustom ? '（自定义起点）' : '') +
      ' · 总预算 ' + money(total) + ' · 已花 ' + money(ov.cycleAgg.expense) +
      (Number(ov.piggyBalance) > 0 ? ' · 存钱罐 ' + money(ov.piggyBalance) : '');
    $('cycleBadge').title = ov.cycle.isCustom
      ? '当前周期从 ' + ov.cycle.start + ' 起算（生活费到账日）'
      : '按发钱日 ' + state.budget.payday + ' 号计算的周期';

    /* ---- 收支概览 ---- */
    renderIncomeCard(ov);

    /* ---- 存钱罐（独立模块，看板只显示一个入口卡） ---- */
    renderPiggyCard(ov);

    /* ---- 理财课 · 视频（看板常驻入口） ---- */
    renderLearnCard();

    /* ---- 恩格尔 ---- */
    var engelCard = $('engelCard');
    var engelPercent = Math.round(ov.engel.percent);
    $('engelBadge').textContent = '餐饮占比 ' + engelPercent + '%';
    $('engelFill').style.width = Math.min(100, engelPercent) + '%';
    if (ov.engel.alert) {
      engelCard.className = 'card card-engel alert';
      $('engelBadge').className = 'badge badge-soft warn';
      var food = ENG.round2(ov.cycleAgg.byCategory['餐饮'] || 0);
      // 业务规则 3：餐饮占比 > 60% 时提示，文案按《记账与预算业务规则》
      $('engelText').textContent = '本月餐饮占比过高，建议多去南海北区食堂少点外卖。本月餐饮已花 ' +
        money(food) + '，把外卖和奶茶压掉两成，还能省回约 ' + money(food * 0.2) + '。';
    } else {
      engelCard.className = 'card card-engel';
      $('engelBadge').className = 'badge badge-soft';
      $('engelText').textContent = ov.cycleAgg.expense > 0
        ? '餐饮占比 ' + engelPercent + '%，还在健康区间。囤一点食堂早餐券，能把这个数字再压下去。'
        : '本周期还没有支出记录，先记一笔试试？';
    }

    /* ---- 消费诊断（基于 CATEGORIES.essential + 设置里的单日上限） ---- */
    renderDiagCard(ov);

    /* ---- 分类占比 ---- */
    renderDonut(ov);

    /* ---- 近 7 日趋势 ---- */
    renderTrend(ov);

    /* ---- 支出统计（类目排行 / 月趋势 / 明细排行） ---- */
    renderStatSection();

    /* ---- 流水 ---- */
    renderBillList();

    /* ---- 成就 ---- */
    renderAchievement();
  }

  function donutSvgHtml(slices, size, strokeWidth, viewBoxSize) {
    var vb = viewBoxSize || 100;
    var cx = vb / 2;
    var cy = vb / 2;
    var r = (vb - strokeWidth) / 2;
    var c = 2 * Math.PI * r;
    var total = 0;
    var i;
    for (i = 0; i < slices.length; i++) { total += slices[i].value; }
    if (total <= 0) { return ''; }
    var parts = [];
    var offset = 0;
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#EEF1F4" stroke-width="' + strokeWidth + '"></circle>');
    for (i = 0; i < slices.length; i++) {
      var len = slices[i].value / total * c;
      if (len <= 0) { continue; }
      var opacity = 1;
      if (highlightCategory && slices[i].key && slices[i].key !== highlightCategory) { opacity = 0.22; }
      parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + slices[i].color +
        '" stroke-width="' + strokeWidth + '" stroke-dasharray="' + len + ' ' + (c - len) +
        '" stroke-dashoffset="' + (-offset) + '" opacity="' + opacity + '"></circle>');
      offset += len;
    }
    return parts.join('');
  }

  function getCategorySlices(byCategory) {
    var slices = [];
    var i;
    for (i = 0; i < DATA.CATEGORIES.length; i++) {
      var key = DATA.CATEGORIES[i].key;
      var value = ENG.round2(byCategory[key] || 0);
      if (value > 0) {
        slices.push({ key: key, value: value, color: DATA.CATEGORIES[i].color });
      }
    }
    slices.sort(function (a, b) { return b.value - a.value; });
    return slices;
  }

  function renderDonut(ov) {
    var svg = $('donutChart');
    var legend = $('legendList');
    var slices = getCategorySlices(ov.cycleAgg.byCategory);
    var totalValue = ov.cycleAgg.expense;

    if (slices.length === 0) {
      svg.innerHTML = '<circle cx="80" cy="80" r="70" stroke="#EEF1F4" stroke-width="20"></circle>';
      $('donutTotal').textContent = money(0);
      legend.innerHTML = '<li class="empty">本周期还没有支出记录</li>';
      return;
    }

    svg.innerHTML = donutSvgHtml(slices, 160, 20, 160);
    $('donutTotal').textContent = money(totalValue);

    var html = '';
    var i;
    for (i = 0; i < slices.length; i++) {
      var pct = totalValue > 0 ? (slices[i].value / totalValue * 100) : 0;
      html += '<li data-cat="' + esc(slices[i].key) + '"' +
        (highlightCategory === slices[i].key ? ' class="active"' : '') + '>' +
        '<span class="dot" style="background:' + slices[i].color + '"></span>' +
        '<span class="lg-name">' + esc(slices[i].key) + '</span>' +
        '<span class="lg-amount">' + money(slices[i].value) + '</span>' +
        '<span class="lg-percent">' + pct.toFixed(0) + '%</span>' +
        '</li>';
    }
    legend.innerHTML = html;
  }

  function renderTrend(ov) {
    var svg = $('trendChart');
    var days = [];
    var i;
    var sum = 0;
    var max = 1;
    for (i = 6; i >= 0; i--) {
      var d = ENG.addDays(ov.today, -i);
      var ds = ENG.formatDate(d);
      var value = ENG.round2(ov.allAgg.dailyMap[ds] || 0);
      days.push({ date: ds, label: ds.slice(5), value: value, isToday: i === 0 });
      sum += value;
      if (value > max) { max = value; }
    }
    $('trendSum').textContent = '合计 ' + money(sum);

    var W = 320;
    var H = 150;
    var padL = 6;
    var padR = 6;
    var padT = 18;
    var padB = 24;
    var chartW = W - padL - padR;
    var chartH = H - padT - padB;
    var step = chartW / days.length;
    var barW = Math.min(20, step * 0.46);
    var scaleMax = max * 1.15;

    var parts = [];
    parts.push('<line x1="' + padL + '" y1="' + (padT + chartH) + '" x2="' + (W - padR) + '" y2="' + (padT + chartH) +
      '" stroke="#EEF1F4" stroke-width="1"></line>');

    for (i = 0; i < days.length; i++) {
      var day = days[i];
      var cx = padL + step * i + step / 2;
      var h = day.value > 0 ? Math.max(3, day.value / scaleMax * chartH) : 2;
      var y = padT + chartH - h;
      var color = day.isToday ? '#07C160' : '#D7DDE5';
      if (day.isToday && day.value > max * 0.6) { color = '#FF8A3D'; }
      parts.push('<rect x="' + (cx - barW / 2) + '" y="' + y + '" width="' + barW + '" height="' + h +
        '" rx="4" fill="' + color + '"></rect>');
      if (day.value > 0) {
        parts.push('<text x="' + cx + '" y="' + (y - 5) + '" text-anchor="middle" font-size="8.5" fill="#8A93A0">' +
          (day.value >= 1000 ? Math.round(day.value / 100) / 10 + 'k' : Math.round(day.value)) + '</text>');
      }
      parts.push('<text x="' + cx + '" y="' + (H - 7) + '" text-anchor="middle" font-size="9" fill="' +
        (day.isToday ? '#07C160' : '#A9B1BC') + '"' + (day.isToday ? ' font-weight="600"' : '') + '>' +
        (day.isToday ? '今天' : day.label) + '</text>');
    }
    svg.innerHTML = parts.join('');
  }

  /** 完整版「本月账单流水」：与简洁版明细页一致，按日期分组（今天 / 昨天 / M月D日） */
  function renderBillList() {
    var list = $('billList');
    var sorted = state.bills.slice().sort(function (a, b) {
      if (a.date !== b.date) { return a.date < b.date ? 1 : -1; }
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    /* 取消「最近 8 条」限制：应用筛选后渲染全部账单（仍按日期分组，今天/昨天/M月D日 组头） */
    var bills = BF.filter(sorted, billFilter);
    renderBillFilterBar('billFilterBar', bills.length);
    if (bills.length === 0) {
      list.innerHTML = '<li class="empty">还没有符合条件的账单，换个筛选试试</li>';
      return;
    }
    var todayStr = ENG.formatDate(new Date());
    var yestStr = ENG.formatDate(new Date(Date.now() - 86400000));
    var thisYear = String(new Date().getFullYear());
    /* 日期 → 组头文案：今天 / 昨天 / 10月26日（跨年时带上年份） */
    function dayLabel(ds) {
      if (ds === todayStr) { return '今天'; }
      if (ds === yestStr) { return '昨天'; }
      if (ds.slice(0, 4) !== thisYear) { return ds; }
      var md = ds.slice(5).split('-');
      return parseInt(md[0], 10) + '月' + parseInt(md[1], 10) + '日';
    }
    var html = '';
    var i = 0;
    while (i < bills.length) {
      var ds = bills[i].date;
      html += '<li class="bill-day">' + esc(dayLabel(ds)) + '</li>';
      while (i < bills.length && bills[i].date === ds) {
        var b = bills[i];
        var isIncome = b.type === 'income';
        var time = spTimeOf(b);
        html += '<li class="bill-item">' +
          '<span class="bill-dot" style="background:' + (isIncome ? '#07C160' : categoryColor(b.category)) + '"></span>' +
          '<span class="bill-main">' +
          '<span class="bill-note">' + esc(b.note) + '</span>' +
          '<span class="bill-meta">' + esc(time ? time + ' · ' : '') + esc(isIncome ? '收入' : b.category) + '</span>' +
          '</span>' +
          '<span class="bill-amount' + (isIncome ? ' income' : '') + '">' +
          (isIncome ? '+' : '-') + money(b.amount) + '</span>' +
          '</li>';
        i++;
      }
    }
    list.innerHTML = html;
  }

  /* ================================================================== */
  /* 看板 · 支出统计（参考钱迹：类目排行 / 月支出趋势 / 明细排行）          */
  /* ================================================================== */

  /* 三张统计图共用一个月份；默认本月，只能往回翻（不允许翻到未来） */
  var statMonth = null;
  var catRankOpen = false;      /* 类目排行是否展开全部 */
  var topSpendOpen = false;     /* 明细排行是否展开全部 */
  var STAT_COLLAPSE = 5;        /* 默认展示条数，其余藏进「展开」 */

  function currentYM() {
    var d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  }

  function ensureStatMonth() {
    if (!statMonth) { statMonth = currentYM(); }
    return statMonth;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /** @return {{start:string,end:string,days:number,prefix:string,label:string,isThisMonth:boolean}} */
  function statMonthRange() {
    var ym = ensureStatMonth();
    var last = new Date(ym.y, ym.m + 1, 0).getDate();
    var mm = pad2(ym.m + 1);
    var nowYM = currentYM();
    return {
      start: ym.y + '-' + mm + '-01',
      end: ym.y + '-' + mm + '-' + pad2(last),
      prefix: ym.y + '-' + mm + '-',
      days: last,
      isThisMonth: ym.y === nowYM.y && ym.m === nowYM.m
    };
  }

  function statMonthBills(r) {
    return state.bills.filter(function (b) { return b.date.indexOf(r.prefix) === 0; });
  }

  /** 支出类目排行：横向占比条 + 本月共支出 + 笔数，默认 5 条，点「展开」看全部 */
  function renderCatRank(agg, total, bills) {
    var list = $('catRankList');
    var rows = [];
    var counts = {};
    var i;
    var j;
    for (j = 0; j < bills.length; j++) {
      if (bills[j].type === 'income') { continue; }
      counts[bills[j].category] = (counts[bills[j].category] || 0) + 1;
    }
    for (i = 0; i < DATA.CATEGORIES.length; i++) {
      var key = DATA.CATEGORIES[i].key;
      var val = ENG.round2(agg.byCategory[key] || 0);
      if (val > 0) {
        rows.push({ key: key, value: val, count: counts[key] || 0, color: categoryColor(key) });
      }
    }
    rows.sort(function (a, b) { return b.value - a.value; });

    if (rows.length === 0) {
      list.innerHTML = '<li class="sp-empty">这个月还没有支出记录</li>';
      $('catRankMore').hidden = true;
      $('catRankHint').textContent = '本月';
      return;
    }
    var shown = catRankOpen ? rows.length : Math.min(STAT_COLLAPSE, rows.length);
    var html = '';
    for (i = 0; i < shown; i++) {
      var r = rows[i];
      var pct = total > 0 ? (r.value / total * 100) : 0;
      /* 横条长度 = 占本月总支出的百分比，和右侧「n%」对得上（不是相对最高项，
         否则第一名永远是满条、与 36% 这样的数字自相矛盾） */
      var w = Math.max(3, pct);
      html += '<li class="rank-row" data-cat="' + esc(r.key) + '" role="button" tabindex="0"' +
        ' title="点一下在上方环形图里高亮这个类目">' +
        '<span class="rank-ico" style="' + spCatTileStyle(r.key) + '">' + spCatIcon(r.key) + '</span>' +
        '<span class="rank-main">' +
        '<span class="rank-line"><b>' + esc(r.key) + '</b><em class="rank-amt">' + money(r.value) + '</em></span>' +
        '<span class="rank-bar"><i style="width:' + w.toFixed(1) + '%;background:' + r.color + '"></i></span>' +
        '<span class="rank-sub"><span>本月共支出 ' + money(r.value) + ' · ' + pct.toFixed(0) + '%</span>' +
        '<span>支出 ' + r.count + ' 笔</span></span>' +
        '</span></li>';
    }
    list.innerHTML = html;
    $('catRankMore').hidden = rows.length <= STAT_COLLAPSE;
    var more = $('catRankMore');
    if (!more.hidden) {
      more.innerHTML = (catRankOpen ? '收起 ' : '展开 ') +
        '<svg class="rank-caret' + (catRankOpen ? ' is-open' : '') + '" aria-hidden="true"><use href="#i-caret"/></svg>';
    }
    $('catRankHint').textContent = rows.length + ' 个类目';
  }

  /** 支出趋势：月度折线（支出 / 收入 / 结余）+ 单日峰值气泡 + 日均与笔数 */
  function renderMonthTrend(agg, bills, r) {
    var svg = $('monthTrendChart');
    var peakEl = $('trendPeak');
    var expMap = {};
    var incMap = {};
    var i;
    for (i = 0; i < bills.length; i++) {
      var b = bills[i];
      if (b.type === 'income') { incMap[b.date] = ENG.round2((incMap[b.date] || 0) + b.amount); }
      else { expMap[b.date] = ENG.round2((expMap[b.date] || 0) + b.amount); }
    }
    var expSeries = [];
    var incSeries = [];
    var balSeries = [];
    var accInc = 0;
    var accExp = 0;
    var peak = { day: 0, value: 0 };
    for (i = 1; i <= r.days; i++) {
      var ds = r.prefix + pad2(i);
      var e = ENG.round2(expMap[ds] || 0);
      var inc = ENG.round2(incMap[ds] || 0);
      accExp = ENG.round2(accExp + e);
      accInc = ENG.round2(accInc + inc);
      expSeries.push(e);
      incSeries.push(inc);
      balSeries.push(ENG.round2(accInc - accExp));
      if (e > peak.value) { peak = { day: i, value: e }; }
    }
    var avg = ENG.round2(agg.expense / r.days);
    $('trendAvg').textContent = money(avg);
    $('trendCount').textContent = agg.count + ' 笔';
    $('trendMonthHint').textContent = (r.isThisMonth ? '本月' : (ensureStatMonth().m + 1) + '月');

    if (agg.expense <= 0 && agg.income <= 0) {
      peakEl.innerHTML = ic('info', 'bico-mute', '提示') +
        (r.isThisMonth ? '本月还没有支出记录，趋势图先空着。' : '这个月没有记账记录。');
      svg.innerHTML = '<line class="stat-base" x1="16" y1="146" x2="302" y2="146"></line>';
      return;
    }

    peakEl.innerHTML = ic('spark', 'bico-warn', '峰值') + '本月单日最高支出 —— 在 <b>' +
      esc((ensureStatMonth().m + 1) + '.' + pad2(peak.day)) + '</b> 这一天，你支出了 <b class="trend-peak-amt">' +
      money(peak.value) + '</b>';

    var W = 320, H = 170, padL = 36, padR = 18, padT = 32, padB = 24;
    var chartW = W - padL - padR;
    var chartH = H - padT - padB;
    var scaleMax = 0;
    var k;
    for (k = 0; k < expSeries.length; k++) {
      if (expSeries[k] > scaleMax) { scaleMax = expSeries[k]; }
      if (Math.abs(balSeries[k]) > scaleMax) { scaleMax = Math.abs(balSeries[k]); }
    }
    if (scaleMax <= 0) { scaleMax = 1; }
    scaleMax = scaleMax * 1.15;
    function px(idx) { return padL + chartW * (idx / Math.max(1, r.days - 1)); }
    function py(v) { return padT + chartH - (Math.max(0, v) / scaleMax * chartH); }
    function pathOf(series) {
      var d = '';
      var j;
      for (j = 0; j < series.length; j++) { d += (j === 0 ? 'M' : 'L') + px(j).toFixed(1) + ' ' + py(series[j]).toFixed(1); }
      return d;
    }

    var parts = [];
    /* 基线 + 横向淡网格 + 左侧刻度值（颜色交给 CSS 类，深色模式才能跟着变） */
    function short(v) {
      return v >= 1000 ? '¥' + (Math.round(v / 100) / 10) + 'k' : '¥' + Math.round(v);
    }
    parts.push('<line class="stat-base" x1="' + padL + '" y1="' + (padT + chartH) + '" x2="' + (W - padR) +
      '" y2="' + (padT + chartH) + '"></line>');
    for (k = 1; k <= 3; k++) {
      var lv = scaleMax * k / 3;
      var ly = padT + chartH - (lv / scaleMax * chartH);
      if (k < 3) {
        parts.push('<line class="stat-grid" x1="' + padL + '" y1="' + ly.toFixed(1) + '" x2="' + (W - padR) +
          '" y2="' + ly.toFixed(1) + '"></line>');
      }
      parts.push('<text class="stat-ax" x="2" y="' + (ly + 3).toFixed(1) + '" font-size="8.5">' +
        esc(short(lv)) + '</text>');
    }
    /* 结余（灰虚线，累计口径，画在最底层当背景参考） */
    parts.push('<path class="stat-line-bal" d="' + pathOf(balSeries) + '"></path>');
    /* 收入（绿） */
    if (agg.income > 0) {
      parts.push('<path class="stat-line-inc" d="' + pathOf(incSeries) + '"></path>');
    }
    /* 支出（珊瑚红，主线，最后画压在最上面） */
    parts.push('<path class="stat-line-exp" d="' + pathOf(expSeries) + '"></path>');

    /* 峰值：虚线 + 圆点 + 气泡 */
    if (peak.value > 0) {
      var pxPeak = px(peak.day - 1);
      var pyPeak = py(peak.value);
      parts.push('<line class="stat-peak-v" x1="' + pxPeak.toFixed(1) + '" y1="' + pyPeak.toFixed(1) +
        '" x2="' + pxPeak.toFixed(1) + '" y2="' + (padT + chartH) + '"></line>');
      parts.push('<circle class="stat-peak-dot" cx="' + pxPeak.toFixed(1) + '" cy="' + pyPeak.toFixed(1) + '" r="3"></circle>');
      var boxW = 74;
      var boxX = Math.min(W - padR - boxW, Math.max(padL, pxPeak - boxW / 2));
      var boxY = Math.max(2, pyPeak - 34);
      parts.push('<g><rect class="stat-tip-bg" x="' + boxX.toFixed(1) + '" y="' + boxY.toFixed(1) + '" width="' + boxW +
        '" height="26" rx="7"></rect>' +
        '<text class="stat-tip-t" x="' + (boxX + boxW / 2).toFixed(1) + '" y="' + (boxY + 11).toFixed(1) +
        '" text-anchor="middle" font-size="9">' +
        esc((ensureStatMonth().m + 1) + '月' + peak.day + '日') + '</text>' +
        '<text class="stat-tip-t" x="' + (boxX + boxW / 2).toFixed(1) + '" y="' + (boxY + 21).toFixed(1) +
        '" text-anchor="middle" font-size="9.5" font-weight="600">支出 ' +
        esc(String(ENG.round2(peak.value))) + '</text></g>');
    }

    /* X 轴：1 / 5 / 10 / 15 / 20 / 25 / 月末 */
    var ticks = [1, 5, 10, 15, 20, 25, r.days];
    var seen = {};
    for (k = 0; k < ticks.length; k++) {
      if (ticks[k] > r.days || seen[ticks[k]]) { continue; }
      seen[ticks[k]] = 1;
      parts.push('<text class="stat-ax" x="' + px(ticks[k] - 1).toFixed(1) + '" y="' + (H - 7) +
        '" text-anchor="middle" font-size="9">' + ticks[k] + '</text>');
    }
    svg.innerHTML = parts.join('');
  }

  /** 支出明细排行：本月单笔 Top N（图标 + 日期·分类 + 金额） */
  function renderTopSpend(bills) {
    var list = $('topSpendList');
    var tops = bills.filter(function (b) { return b.type !== 'income'; })
      .slice()
      .sort(function (a, b) { return b.amount - a.amount; });
    if (tops.length === 0) {
      list.innerHTML = '<li class="sp-empty">这个月还没有支出记录</li>';
      $('topSpendMore').hidden = true;
      $('topSpendHint').textContent = 'Top 5';
      return;
    }
    var shown = topSpendOpen ? tops.length : Math.min(STAT_COLLAPSE, tops.length);
    var html = '';
    var i;
    for (i = 0; i < shown; i++) {
      var b = tops[i];
      var title = b.note || b.category;
      html += '<li class="top-item">' +
        '<span class="rank-ico" style="' + spCatTileStyle(b.category) + '">' + spCatIcon(b.category) + '</span>' +
        '<span class="top-main"><b>' + esc(title) + '</b>' +
        '<small>' + esc(b.date.slice(5).replace('-', '.')) + ' · ' + esc(b.category) + '</small></span>' +
        '<span class="top-amt">-' + money(b.amount) + '</span>' +
        '</li>';
    }
    list.innerHTML = html;
    $('topSpendMore').hidden = tops.length <= STAT_COLLAPSE;
    var more = $('topSpendMore');
    if (!more.hidden) {
      more.innerHTML = (topSpendOpen ? '收起 ' : '展开 ') +
        '<svg class="rank-caret' + (topSpendOpen ? ' is-open' : '') + '" aria-hidden="true"><use href="#i-caret"/></svg>';
    }
    $('topSpendHint').textContent = 'Top ' + shown + ' / ' + tops.length;
  }

  /** 三张统计图的统一入口（含月度汇总卡） */
  function renderStatSection() {
    if (!$('catRankList')) { return; }
    var ym = ensureStatMonth();
    var r = statMonthRange();
    var bills = statMonthBills(r);
    var agg = ENG.aggregate(bills, r.start, r.end);

    $('statMonthLabel').textContent = ym.y + ' 年 ' + (ym.m + 1) + ' 月统计';
    $('statMonthExpense').textContent = money(agg.expense);
    $('statMonthIncome').textContent = money(agg.income);
    /* 不允许翻到未来：到本月就把下一月按钮禁用 */
    var nowYM = currentYM();
    $('statNext').disabled = (ym.y > nowYM.y) || (ym.y === nowYM.y && ym.m >= nowYM.m);

    renderCatRank(agg, agg.expense, bills);
    renderMonthTrend(agg, bills, r);
    renderTopSpend(bills);
  }

  function shiftStatMonth(delta) {
    var ym = ensureStatMonth();
    ym.m += delta;
    if (ym.m < 0) { ym.m = 11; ym.y--; }
    if (ym.m > 11) { ym.m = 0; ym.y++; }
    renderStatSection();
  }

  function bindStatSection() {
    if (!$('statPrev')) { return; }
    $('statPrev').addEventListener('click', function () { shiftStatMonth(-1); });
    $('statNext').addEventListener('click', function () {
      var ym = ensureStatMonth();
      var nowYM = currentYM();
      /* 不允许翻到未来几个月（没有数据，只会看到空图） */
      if (ym.y > nowYM.y || (ym.y === nowYM.y && ym.m >= nowYM.m)) { return; }
      shiftStatMonth(1);
    });
    $('catRankMore').addEventListener('click', function () {
      catRankOpen = !catRankOpen;
      renderStatSection();
    });
    $('topSpendMore').addEventListener('click', function () {
      topSpendOpen = !topSpendOpen;
      renderStatSection();
    });
    /* 点类目行 → 高亮上方环形图（复用既有的 highlightCategory 机制） */
    $('catRankList').addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('.rank-row') : null;
      if (!row) { return; }
      var cat = row.getAttribute('data-cat');
      highlightCategory = (highlightCategory === cat) ? null : cat;
      renderDonut(getOverview());
    });
    $('catRankList').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        var row = e.target.closest ? e.target.closest('.rank-row') : null;
        if (row) { e.preventDefault(); row.click(); }
      }
    });
  }

  function renderAchievement() {
    var box = $('achieveCard');
    box.innerHTML = '' +
      '<div class="card-head"><h3>我的成就<span class="card-more" aria-hidden="true">›</span></h3>' +
      '<span class="hint">里程碑</span></div>' +
      '<div class="achieve-grid">' +
      '  <div><b>' + state.bills.length + '</b><small>累计记账笔数</small></div>' +
      '  <div><b>' + state.blockedCount + '</b><small>冷静期拦下</small></div>' +
      '  <div><b>' + money(state.savedMoney) + '</b><small>省下的钱</small></div>' +
      '</div>';
  }

  /* ================================================================== */
  /* 简洁版 · 日常型（单功能单屏）渲染                                     */
  /* ================================================================== */

  var SP_QUICK_CATS = ['餐饮', '交通', '购物', '其他'];
  var SP_CAT_ICON = {
    '餐饮': 'i-cat-food', '社交': 'i-cat-social', '购物': 'i-cat-shop', '学习': 'i-cat-study', '交通': 'i-cat-transit',
    '娱乐': 'i-cat-fun', '居住': 'i-cat-home', '电费': 'i-cat-elec', '燃气费': 'i-cat-gas', '医疗': 'i-cat-med', '其他': 'i-cat-other', '收入': 'i-cat-income'
  };
  var simpleListYM = null; /* {y, m} 明细页当前月份 */

  function spIsIncome(b) { return b.type === 'income'; }
  function spCatIcon(cat) {
    var k = SP_CAT_ICON[cat] || 'i-cat-other';
    return '<svg class="cat-ico" viewBox="0 0 24 24"><use href="#' + k + '"/></svg>';
  }
  function spTimeOf(b) {
    if (!b.createdAt) { return ''; }
    var d = new Date(b.createdAt);
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /** 简洁版四屏统一渲染入口（与完整版共用同一套账单/预算数据） */
  function renderSimple() {
    renderSimpleHome();
    renderSimpleList();
    renderSimpleBudget();
    renderSimpleProfile();
    renderSimplePiggy();
    checkRadioGroup('spUiMode', getUiMode());
    /* 停在「省钱」屏时，账本变化（入账 / 打卡）也要同步到面板，避免看到旧数字 */
    if (DOC.body && DOC.body.getAttribute('data-view') === 'ssave') { renderSaveHubPanel(); }
  }

  function spBillListHtml(bills, emptyText) {
    if (!bills.length) { return '<li class="sp-empty">' + esc(emptyText || '暂无记录') + '</li>'; }
    var html = '';
    var i;
    for (i = 0; i < bills.length; i++) {
      var b = bills[i];
      var inc = spIsIncome(b);
      var cat = inc ? '收入' : b.category;
      var title = inc ? (b.source || b.note || '收入') : (b.note || b.category);
      var time = spTimeOf(b);
      html += '<li class="sp-bill">' +
        '<span class="sp-bill-ico" style="' + (inc ? ('--sc:#07C160;--sc-ink:#047A3E;background:#07C1601f') : spCatTileStyle(b.category)) + '">' + spCatIcon(cat) + '</span>' +
        '<span class="sp-bill-main"><b>' + esc(title) + '</b><small>' +
        (time ? esc(time) + ' · ' : '') + esc(cat) + '</small></span>' +
        '<span class="sp-bill-amt' + (inc ? ' inc' : '') + '">' + (inc ? '+' : '-') + money(b.amount) + '</span>' +
        '</li>';
    }
    return html;
  }

  /** 记账（首页）：剩余金额 + 快捷分类 + 今日流水 */
  function renderSimpleHome() {
    var ov = getOverview();
    var bs = ov.budgetState;
    $('spRemain').textContent = money(bs.remaining);
    $('spDaily').textContent = money(bs.dailyAllowance);
    var d = ov.today;
    var week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    $('spDateLine').textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + week + ' · 今天想记点什么？';
    var q = '';
    var i;
    for (i = 0; i < SP_QUICK_CATS.length; i++) {
      var c = SP_QUICK_CATS[i];
      q += '<button type="button" class="sp-q" data-cat="' + esc(c) + '">' +
        '<span class="sp-q-ico" style="' + spCatTileStyle(c) + '">' + spCatIcon(c) + '</span>' +
        esc(c) + '</button>';
    }
    $('spQuick').innerHTML = q;
    var today = ov.todayStr;
    var todays = state.bills.filter(function (b) { return b.date === today; })
      .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    $('spTodayBills').innerHTML = spBillListHtml(todays, '今天还没有记账，点「记一笔」开始吧');
    renderSimpleWish(ov);
  }

  /** 明细：按月分组流水 + 收支汇总 */
  function renderSimpleList() {
    var now = new Date();
    if (!simpleListYM) { simpleListYM = { y: now.getFullYear(), m: now.getMonth() }; }
    var y = simpleListYM.y, m = simpleListYM.m;
    $('spMonthLabel').textContent = y + '年' + (m + 1) + '月';
    var prefix = y + '-' + (m + 1 < 10 ? '0' : '') + (m + 1) + '-';
    /* 在「按月分组」基础上叠加筛选条件（类型 / 金额 / 备注） */
    var allMonth = state.bills.filter(function (b) { return b.date.indexOf(prefix) === 0; });
    var monthBills = BF.filter(allMonth, billFilter);
    /* 顶部「本月支出 / 收入」永远是全月真实值——筛选只影响下方列表，
       否则筛出「餐饮」后本月支出会缩水，容易被误读成真的只花了这么多 */
    var exp = 0, inc = 0, i;
    for (i = 0; i < allMonth.length; i++) {
      if (spIsIncome(allMonth[i])) { inc += allMonth[i].amount; } else { exp += allMonth[i].amount; }
    }
    $('spMExpense').textContent = money(ENG.round2(exp));
    $('spMIncome').textContent = money(ENG.round2(inc));
    renderBillFilterBar('spFilterBar', monthBills.length);
    var byDate = {};
    monthBills.forEach(function (b) { (byDate[b.date] = byDate[b.date] || []).push(b); });
    var dates = Object.keys(byDate).sort().reverse();
    if (!dates.length) {
      $('spListBody').innerHTML = '<div class="sp-empty sp-empty-block">本月还没有记账，记一笔就会出现在这里</div>';
      return;
    }
    var todayStr = ENG.formatDate(new Date());
    var yestStr = ENG.formatDate(new Date(Date.now() - 86400000));
    var html = '';
    for (i = 0; i < dates.length; i++) {
      var ds = dates[i];
      var label = ds === todayStr ? '今天' : (ds === yestStr ? '昨天' : ds);
      var de = 0, di = 0;
      byDate[ds].forEach(function (b) { if (spIsIncome(b)) { di += b.amount; } else { de += b.amount; } });
      var net = ENG.round2(di - de);
      var sumTxt = (net >= 0 ? '+' : '-') + money(Math.abs(net));
      html += '<div class="sp-day"><div class="sp-day-head"><b>' + esc(label) + '</b><span>' + sumTxt + '</span></div>' +
        '<ul class="sp-bills">' + spBillListHtml(byDate[ds].sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); })) + '</ul></div>';
    }
    $('spListBody').innerHTML = html;
  }

  /** 预算：环形图 + 分类占比 */
  function renderSimpleBudget() {
    var ov = getOverview();
    var bs = ov.budgetState;
    var total = state.budget.total;
    var spent = ov.cycleAgg.expense;
    /* 环图按「已占用 = 消费 + 存钱罐」算，才能和「剩余」对得上；
       分类占比仍用纯消费口径，存钱不该被算进餐饮 / 购物里。 */
    var used = ENG.round2(spent + (ov.piggyBalance || 0));
    var pct = total > 0 ? Math.min(100, Math.round(used / total * 100)) : 0;
    $('spRingPct').textContent = pct + '%';
    $('spSpent').textContent = money(spent);
    $('spTotal').textContent = money(total);
    $('spBRemain').textContent = money(bs.remaining);
    $('spBDaily').textContent = money(bs.dailyAllowance);
    $('spBDays').textContent = ov.cycle.remainingDays + ' 天';
    var ring = $('spRingBar');
    var C = 2 * Math.PI * 58;
    var ratio = total > 0 ? Math.max(0, Math.min(1, used / total)) : 0;
    if (ring) {
      ring.style.strokeDasharray = C + ' ' + C;
      ring.style.strokeDashoffset = String(C * (1 - ratio));
      ring.style.stroke = pct >= 90 ? '#EF5350' : (pct >= 70 ? '#FF8A3D' : '#07C160');
    }
    var slices = getCategorySlices(ov.cycleAgg.byCategory);
    var h = '';
    if (!slices.length) { h = '<li class="sp-empty">本周期还没有支出记录</li>'; }
    var i;
    for (i = 0; i < slices.length; i++) {
      var p = spent > 0 ? Math.round(slices[i].value / spent * 100) : 0;
      h += '<li><span class="sp-cb-name"><i class="sp-cb-dot" style="background:' + slices[i].color + '"></i>' + esc(slices[i].key) + '</span>' +
        '<span class="sp-cb-bar"><i style="width:' + p + '%;background:' + slices[i].color + '"></i></span>' +
        '<span class="sp-cb-pct">' + p + '%</span></li>';
    }
    $('spCatBars').innerHTML = h;
    var piggyNote = $('spPiggyNote');
    if (piggyNote) {
      if (Number(ov.piggyBalance) > 0) {
        piggyNote.hidden = false;
        piggyNote.textContent = ' · 存钱罐 ' + money(ov.piggyBalance);
      } else {
        piggyNote.hidden = true;
        piggyNote.textContent = '';
      }
    }
    renderSimpleForecast(ov);
    renderSimpleDiag(ov);
  }

  /** 我的：资料卡 + 统计 + 界面风格切换 + 菜单 */
  function renderSimpleProfile() {
    var pf = getSettings().profile || {};
    $('spPAva').textContent = pf.avatar || '我';
    $('spPName').textContent = pf.nickname || '记账小助手';
    var dates = {};
    var i;
    for (i = 0; i < state.bills.length; i++) { dates[state.bills[i].date] = 1; }
    $('spStatDays').textContent = Object.keys(dates).length;
    var now = new Date();
    var prefix = now.getFullYear() + '-' + (now.getMonth() + 1 < 10 ? '0' : '') + (now.getMonth() + 1) + '-';
    var cnt = 0;
    for (i = 0; i < state.bills.length; i++) { if (state.bills[i].date.indexOf(prefix) === 0) { cnt++; } }
    $('spStatCount').textContent = cnt;
    $('spStatSaved').textContent = money(state.savedMoney || 0);
  }

  /** 简洁版各屏事件绑定（在 init 里调用一次） */
  function bindSimpleEvents() {
    $('tabbarSimple').addEventListener('click', function (e) {
      /* 省钱已是普通视图（data-view="ssave"），这里只需处理 data-view，
         不再有弹层分支：切换与高亮统一由 switchView 负责。 */
      var tab = e.target.closest ? e.target.closest('.tab[data-view]') : null;
      if (tab) { switchView(tab.getAttribute('data-view')); }
    });
    $('spBtnAdd').addEventListener('click', function () { openQuickAddModal(); });
    $('spBtnAi').addEventListener('click', function () { switchView('sai'); });
    $('spBtnMe').addEventListener('click', function () { switchView('sprofile'); });
    $('spQuick').addEventListener('click', function (e) {
      var q = e.target.closest ? e.target.closest('.sp-q[data-cat]') : null;
      if (q) { openQuickAddModal(q.getAttribute('data-cat')); }
    });
    $('spMonthPrev').addEventListener('click', function () {
      simpleListYM.m--; if (simpleListYM.m < 0) { simpleListYM.m = 11; simpleListYM.y--; }
      renderSimpleList();
    });
    $('spMonthNext').addEventListener('click', function () {
      simpleListYM.m++; if (simpleListYM.m > 11) { simpleListYM.m = 0; simpleListYM.y++; }
      renderSimpleList();
    });
    $('spBtnBudget').addEventListener('click', openDrawer);
    $('spMenuBudget').addEventListener('click', openDrawer);
    /* 简洁版菜单里也挂一档消费性格测试：直接开弹窗，不必先切到理财专家页 */
    if ($('spMenuPersona')) {
      $('spMenuPersona').addEventListener('click', function () { openPersonaSheet(); });
    }
    $('spMenuCoach').addEventListener('click', function () { switchView('scoach'); });
    $('spMenuGoals').addEventListener('click', function () { switchView('sgoals'); });
    $('spGoalsBack').addEventListener('click', function () { goBackView(); });
    $('spMenuPiggy').addEventListener('click', function () { switchView('spiggy'); });
    $('spMenuWish').addEventListener('click', openWishSheet);
    $('spBtnPiggyQuick').addEventListener('click', function () { switchView('spiggy'); });
    $('spPiggyBack').addEventListener('click', function () { goBackView(); });
    /* 存钱罐面板：完整版弹层与简洁版整页共用同一套 data-act 分发 */
    ['piggyBody', 'spPiggyBody'].forEach(function (id) {
      var host = $(id);
      if (host) { host.addEventListener('click', piggyPanelClick); }
    });
    $('spMenuExport').addEventListener('click', function () { exportAllCsv(); });
    $('spMenuAi').addEventListener('click', function () { switchView('sai'); });
    $('spMenuSaveHub').addEventListener('click', function () { switchView('ssave'); });
    $('spMenuAbout').addEventListener('click', openTermsModal);
    $('btnAiBack').addEventListener('click', function () { goBackView(); });
    $('spUiSeg').addEventListener('change', function (e) {
      var input = (e.target && e.target.closest) ? e.target.closest('input[name="spUiMode"]') : null;
      if (!input) { return; }
      setUiMode(input.value);
    });
  }

  /* ================================================================== */
  /* 存钱罐（v1.1 新增 · 独立模块）                                       */
  /* ------------------------------------------------------------------ */
  /* 边界：只通过 PIGGY（piggy.js）存取自己的独立存储，不写 state.bills、   */
  /*      不改分类/恩格尔/趋势；对主账本的唯一影响是「可用余额少了一块」    */
  /*      （getOverview 里把罐内余额计入已占用额度）。                     */
  /* ================================================================== */

  /** 最近一次存入的鼓励话术（仅内存，刷新即消失） */
  var piggyCheer = null;
  /** 最近一次校验失败提示（仅内存） */
  var piggyError = '';
  /** 校验失败时保留的输入原文：重绘会重建输入框，不回填就把用户刚打的金额吃掉了 */
  var piggyDraft = '';
  /** 快捷金额（元） */
  var PIGGY_QUICK = [10, 20, 50, 100];

  /** 存钱罐是否可用：模块存在 + 存储可写 */
  function piggyReady() {
    return !!(PIGGY && !PIGGY.missing && PIGGY.isReady && PIGGY.isReady());
  }

  function piggyFmt(cents) {
    return ENG.fmtMoney((Number(cents) || 0) / 100);
  }

  /**
   * 取当前面板的金额输入框。
   * 完整版弹层（#piggyBody）与简洁版页面（#spPiggyBody）共用同一段 HTML，
   * 两处都会渲染出输入框；若用固定 id 查询，getElementById 只会返回 DOM 里
   * 靠前的那个（简洁版），于是桌面弹层里输入的金额会被读成空值。
   * 统一按「宿主作用域」取输入框，谁触发就取谁的。
   */
  function piggyInput(host) {
    var box = host || $('piggyBody');
    if (box && box.querySelector) {
      var el = box.querySelector('.piggy-amt-input');
      if (el) { return el; }
    }
    var list = DOC.querySelectorAll('.piggy-amt-input');
    for (var i = 0; i < list.length; i++) {
      if (list[i].offsetParent !== null) { return list[i]; }
    }
    return list[0] || null;
  }

  /** 看板小卡：罐内余额 + 「存一笔」入口 */
  function renderPiggyCard(ov) {
    var card = $('piggyCard');
    var box = $('piggyMini');
    if (!card || !box) { return; }
    if (!piggyReady()) { card.hidden = true; return; }
    card.hidden = false;
    var o = ov || getOverview();
    var st = PIGGY.stats();
    // 总预算在 state 上，不在 getOverview() 的返回值里（ov 只有 budgetState）
    var total = Number(state.budget.total) || 0;
    var pct = total > 0
      ? Math.min(100, Math.round((st.balanceCents / 100) / total * 100)) : 0;
    box.innerHTML =
      '<div class="piggy-mini-top">' +
      '  <span class="piggy-mini-amt">' + piggyFmt(st.balanceCents) + '</span>' +
      '  <span class="piggy-mini-meta">已存 ' + st.count + ' 笔' +
      (st.streak >= 2 ? ' · 连续 ' + st.streak + ' 天' : '') + '</span>' +
      '</div>' +
      '<div class="piggy-mini-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="piggy-mini-note">占本月生活费 ' + pct + '% · 点「存一笔」把钱锁进罐子</div>';
  }

  /** 面板主体 HTML：完整版弹层与简洁版整页共用同一段，保证两套 UI 行为一致 */
  function piggyPanelHtml() {
    var st = PIGGY.stats();
    var o = getOverview();
    // 可存上限 = 当前账面可用余额（分）；已经不含罐内余额（getOverview 已扣过）
    var remainCents = Math.round((o.budgetState.remaining || 0) * 100);
    var maxCents = Math.max(0, remainCents);

    var quick = '';
    var i;
    for (i = 0; i < PIGGY_QUICK.length; i++) {
      var q = PIGGY_QUICK[i] * 100;
      quick += '<button type="button" class="piggy-q" data-act="piggy-quick" data-cents="' + q + '"' +
        (q > maxCents ? ' disabled' : '') + '>' + PIGGY_QUICK[i] + '</button>';
    }

    var logs = PIGGY.listLogs(8);
    var logHtml = '';
    if (!logs.length) {
      logHtml = '<li class="piggy-empty">还没有存过钱，先存一笔试试～</li>';
    } else {
      for (i = 0; i < logs.length; i++) {
        var l = logs[i];
        var isIn = l.type === 'in';
        logHtml += '<li class="piggy-log">' +
          '<span class="pl-date">' + esc(l.date) + '</span>' +
          '<span class="pl-main"><b>' + esc(l.note || (isIn ? '存入' : '取出')) + '</b></span>' +
          '<span class="pl-amt ' + (isIn ? 'in' : 'out') + '">' + (isIn ? '+' : '-') + piggyFmt(l.cents) + '</span>' +
          '</li>';
      }
    }

    var cheerHtml = '';
    if (piggyCheer && piggyCheer.title) {
      cheerHtml = '<div class="piggy-cheer" role="status">' +
        '<div class="pc-emoji">' + ic(piggyCheer.emoji, 'bico-brand', '鼓励') + '</div>' +
        '<div class="pc-body"><b>' + esc(piggyCheer.title) + '</b><span>' + esc(piggyCheer.text) + '</span></div>' +
          '<button type="button" class="pc-close" data-act="piggy-cheer-close" aria-label="收起">' +
        ic('close', null, '收起') + '</button>' +
        '</div>';
    }

    var errHtml = piggyError
      ? '<div class="piggy-err" role="alert">' + esc(piggyError) + '</div>'
      : '';

    return '' +
      '<div class="piggy-hero">' +
      '  <div class="ph-ico"><svg><use href="#i-piggy"/></svg></div>' +
      '  <div class="ph-main">' +
      '    <div class="ph-amt">' + piggyFmt(st.balanceCents) + '</div>' +
      '    <div class="ph-sub">罐子里共有 · 已存 ' + st.count + ' 笔' +
      (st.streak >= 2 ? ' · 连续 ' + st.streak + ' 天' : '') + '</div>' +
      '  </div>' +
      '</div>' +
      '<div class="piggy-avail">账面可用余额 <b>' + money(o.budgetState.remaining) + '</b>' +
      '<span>最多可存 ' + piggyFmt(maxCents) + '</span></div>' +
      '<div class="piggy-input">' +
      '  <span class="pi-unit">¥</span>' +
      '  <input class="piggy-amt-input" type="text" inputmode="decimal" autocomplete="off" ' +
      '         value="' + esc(piggyDraft) + '" ' +
      '         placeholder="请输入金额" aria-label="金额" />' +
      '</div>' +
      '<div class="piggy-quick">' + quick + '<span class="pq-tip">快捷金额</span></div>' +
      errHtml +
      '<div class="piggy-actions">' +
      '  <button type="button" class="piggy-btn primary" data-act="piggy-deposit">存入存钱罐</button>' +
      '  <button type="button" class="piggy-btn" data-act="piggy-withdraw"' +
      (st.balanceCents <= 0 ? ' disabled' : '') + '>取出</button>' +
      '</div>' +
      (st.balanceCents > 0
        ? '<button type="button" class="piggy-btn-all" data-act="piggy-withdraw-all">全部取出</button>'
        : '') +
      cheerHtml +
      '<div class="piggy-sec">存取记录 <span class="piggy-sec-sub">最近 8 条</span></div>' +
      '<ul class="piggy-logs">' + logHtml + '</ul>' +
      '<p class="piggy-note">存进罐子的钱会从「账面可用余额」里挪走，不再算作可花的钱；' +
      '它不计入支出，所以分类占比、餐饮预警和趋势图都不会被这笔钱影响。随时可以取回。</p>';
  }

  /** 把面板重绘进两个宿主（完整版弹层 / 简洁版页面） */
  function renderPiggyPanels() {
    var a = $('piggyBody');
    var b = $('spPiggyBody');
    var html = piggyReady() ? piggyPanelHtml() : '';
    if (a) { a.innerHTML = html; }
    if (b) { b.innerHTML = html; }
  }

  /** 简洁版存钱罐屏 */
  function renderSimplePiggy() {
    var box = $('spPiggyBody');
    if (!box) { return; }
    box.innerHTML = piggyReady() ? piggyPanelHtml() : '<div class="sp-empty sp-empty-block">当前浏览器不能保存数据，存钱罐暂不可用</div>';
  }

  function openPiggySheet() {
    if (!piggyReady()) {
      showToast('当前浏览器不能保存数据，存钱罐暂不可用', 'warn');
      return;
    }
    piggyDraft = '';
    renderPiggyPanels();
    $('piggyMask').hidden = false;
    var input = piggyInput($('piggyBody'));
    if (input) { input.focus(); }
  }

  function closePiggySheet() {
    $('piggyMask').hidden = true;
    // 关掉就丢掉一次性的话术、报错与草稿，下次打开是干净的
    piggyCheer = null;
    piggyError = '';
    piggyDraft = '';
  }

  /**
   * 校验失败统一出口：先记住用户输入的原文，再重绘，最后把焦点还给输入框。
   * 直接 renderPiggyPanels() 会把 input 整个重建，导致刚打的金额消失。
   */
  function piggyFail(msg, host) {
    var input = piggyInput(host);
    piggyDraft = input ? String(input.value || '') : '';
    piggyError = msg;
    renderPiggyPanels();
    var again = piggyInput(host);
    if (again) { again.focus(); }
  }

  /** 读输入框 → 执行存入 */
  function piggyDoDeposit(host) {
    var input = piggyInput(host);
    var raw = input ? String(input.value || '').trim() : '';
    var cents = PIGGY.parseAmount(raw);
    if (cents === null) {
      if (raw === '') {
        piggyFail('请输入金额', host);
      } else {
        piggyFail('金额不合法，请输入大于 0 的数字（最多两位小数）。', host);
      }
      return;
    }
    if (cents > PIGGY.MAX_CENTS) {
      piggyFail('单笔最多 ' + piggyFmt(PIGGY.MAX_CENTS) + '，换个金额吧。', host);
      return;
    }
    var o = getOverview();
    var remainCents = Math.round((o.budgetState.remaining || 0) * 100);
    if (remainCents <= 0) {
      piggyFail('账面可用余额已经是 0 了，先记一笔收入再来存。', host);
      return;
    }
    if (cents > remainCents) {
      piggyFail('账面可用余额只剩 ' + piggyFmt(remainCents) + '，最多能存这么多。', host);
      return;
    }
    var before = PIGGY.stats();
    var res = PIGGY.deposit(cents, '存入存钱罐');
    if (!res.ok) {
      piggyFail((res.reason === 'store')
        ? '浏览器存储不可用，这次没能存进去。' : '金额不合法，换个数字试试。', host);
      return;
    }
    piggyError = '';
    piggyDraft = '';
    var after = getOverview();
    piggyCheer = PIGGY.cheer({
      amountCents: cents,
      balanceCents: res.balanceCents,
      countBefore: before.count,
      streak: PIGGY.stats().streak,
      remainingCents: Math.round((after.budgetState.remaining || 0) * 100),
      dailyCents: Math.round((after.budgetState.dailyAllowance || 0) * 100)
    });
    renderAll();
    renderPiggyPanels();
    /* 阿账事件源④：存钱罐主路径存款成功 → save */
    MOOD.onEvent('piggy_in');
    petReact('piggy_in', { amount: cents / 100 });
    showToast('已存入 ' + piggyFmt(cents) + '，账面可用余额 -' + piggyFmt(cents), 'ok');
  }

  /** 读输入框 → 执行取出（留空 = 全部取出） */
  function piggyDoWithdraw(host) {
    var st = PIGGY.stats();
    if (st.balanceCents <= 0) {
      piggyFail('罐子里还没有钱，先存一笔吧。', host);
      return;
    }
    var input = piggyInput(host);
    var raw = input ? String(input.value || '').trim() : '';
    if (raw === '') {
      piggyFail('请输入金额', host);
      return;
    }
    var cents = PIGGY.parseAmount(raw);
    if (cents === null) {
      piggyFail('金额不合法，请输入大于 0 的数字（最多两位小数）。', host);
      return;
    }
    var res = PIGGY.withdraw(cents, '从存钱罐取出');
    if (!res.ok) {
      piggyFail((res.reason === 'store')
        ? '浏览器存储不可用，这次没能取出。' : '罐子里没有这么多钱。', host);
      return;
    }
    piggyError = '';
    piggyDraft = '';
    piggyCheer = null;
    renderAll();
    renderPiggyPanels();
    showToast('已取出 ' + piggyFmt(res.log.cents) + '，账面可用余额已恢复', 'ok');
    petReact('piggy_out', { amount: res.log.cents / 100 });
  }

  /**
   * 一键全部取出：不直接扣款，而是把当前余额填进输入框并提示，
   * 由用户点「取出」做二次确认。避免「没填金额就点取出 = 取光全部」的误操作。
   */
  function piggyDoWithdrawAll(host) {
    var st = PIGGY.stats();
    if (st.balanceCents <= 0) {
      piggyFail('罐子里还没有钱，先存一笔吧。', host);
      return;
    }
    piggyDraft = (st.balanceCents / 100).toFixed(2);
    piggyError = '已填入全部金额（' + piggyFmt(st.balanceCents) + '），点「取出」即可取回。';
    renderPiggyPanels();
    var again = piggyInput(host);
    if (again) { again.focus(); if (again.select) { again.select(); } }
  }

  /** 面板内点击分发（两个宿主共用） */
  function piggyPanelClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) { return; }
    var host = e.currentTarget; // #piggyBody 或 #spPiggyBody，谁触发就取谁的输入框
    var act = btn.getAttribute('data-act');
    if (act === 'piggy-quick') {
      var input = piggyInput(host);
      if (input) {
        input.value = String((Number(btn.getAttribute('data-cents')) || 0) / 100);
        input.focus();
      }
      return;
    }
    if (act === 'piggy-deposit') { piggyDoDeposit(host); return; }
    if (act === 'piggy-withdraw') { piggyDoWithdraw(host); return; }
    if (act === 'piggy-withdraw-all') { piggyDoWithdrawAll(host); return; }
    if (act === 'piggy-cheer-close') {
      piggyCheer = null;
      renderPiggyPanels();
    }
  }

  /* ================================================================== */
  /* 说话风格（tone.js 接线）                                             */
  /* ------------------------------------------------------------------ */
  /* 所有新功能的句子都从这里出：先把当前语气灌进 TONE，再取文案。
     这样「设置页切语气 → 下一次渲染立刻生效」，且不需要在每个调用点写 set。 */
  /* ================================================================== */

  /**
   * 取一句当前语气的文案。
   * @param {string} key tone.js 的文案 key
   * @param {Object} [vars] 占位符
   * @return {string} 缺模块 / 缺 key 时返回空串（调用方自行降级）
   */
  function toneLine(key, vars) {
    if (!TONE || TONE.missing) { return ''; }
    TONE.set(getSettings().tone);
    return TONE.t(key, vars);
  }

  /** 语气元信息列表（设置页三张卡片用它渲染；tone.js 缺失时用替身自带的） */
  function toneList() {
    return (TONE && TONE.TONES && TONE.TONES.length) ? TONE.TONES : [];
  }

  /* ================================================================== */
  /* 心愿单（v1.2 新增 · 独立模块）                                       */
  /* ------------------------------------------------------------------ */
  /* 边界：只通过 WISH 读写自己的独立存储键，不写 state.bills、不动分类/   */
  /*      恩格尔/趋势；对主账本唯一的影响是「省下的钱」这一个数：          */
  /*      入清单即计入（沿用既有 coolingSkip 行为），成交时按 savedCounted */
  /*      精确回退，放弃时不动，避免双计。                               */
  /* ================================================================== */

  /** 弹层当前页签：cooling / bought / dropped */
  var wishTab = 'cooling';

  /** 心愿单是否可用：模块存在 + 存储可写 */
  function wishReady() {
    return !!(WISH && !WISH.missing && WISH.isReady && WISH.isReady());
  }

  /** 取「最近到期」的那条冷静中条目（用于看板/简洁版进度条） */
  function wishNextItem() {
    var arr = WISH.listCooling();
    if (!arr.length) { return null; }
    var best = arr[0];
    for (var i = 1; i < arr.length; i++) {
      if (arr[i].dueDate < best.dueDate) { best = arr[i]; }
    }
    return best;
  }

  /** 到期文案：还剩 3 天 / 今天到期 / 逾期 2 天 */
  function wishDueText(prog) {
    if (prog.remainingDays > 0) { return '还剩 ' + prog.remainingDays + ' 天'; }
    if (prog.remainingDays === 0) { return '今天到期'; }
    return '已逾期 ' + Math.abs(prog.remainingDays) + ' 天';
  }

  /** 看板小卡：冷静中件数 + 最近到期那条的进度 */
  function renderWishCard(ov) {
    var card = $('wishCard');
    var box = $('wishMini');
    if (!card || !box) { return; }
    if (!wishReady()) { card.hidden = true; return; }
    card.hidden = false;
    var o = ov || getOverview();
    var todayKey = o.todayStr || ENG.formatDate(new Date());
    var st = WISH.stats();
    var next = wishNextItem();
    var pct = next ? WISH.progress(next, todayKey).pct : 0;
    var due = WISH.dueItems(todayKey).length;
    var meta = st.cooling > 0
      ? ('冷静中 ' + st.cooling + ' 件' + (due > 0 ? ' · ' + due + ' 件已到期' : ''))
      : '清单是空的';
    box.innerHTML =
      '<div class="wish-mini-top">' +
      '  <span class="wish-mini-amt">' + money(st.coolingAmount) + '</span>' +
      '  <span class="wish-mini-meta">' + esc(meta) + '</span>' +
      '</div>' +
      '<div class="wish-mini-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="wish-mini-note">' +
      (st.savedAmount > 0
        ? '因为冷静期，你已经省下 ' + money(st.savedAmount) + '。'
        : (next
          ? '「' + esc(next.title) + '」' + esc(wishDueText(WISH.progress(next, todayKey))) + '再决定。'
          : '想买又下不了手的东西，先放进来晾 48 小时。')) +
      '</div>';
  }

  /** 单条心愿卡（弹层列表用） */
  function wishItemHtml(item, todayKey) {
    var isCooling = item.status === 'cooling';
    var prog = WISH.progress(item, todayKey);
    var meta = money(item.amount) + ' · 到期 ' + esc(item.dueDate);
    if (isCooling) {
      meta += ' · ' + esc(wishDueText(prog));
      if (item.extendCount > 0) { meta += ' · 已延长 ' + item.extendCount + ' 次'; }
    } else if (item.status === 'bought') {
      meta += ' · 已买下';
    } else {
      meta += ' · 已放弃';
    }
    var actions = '';
    if (isCooling) {
      var extDisabled = item.extendCount >= WISH.EXTEND_MAX;
      actions =
        '<div class="wish-actions">' +
        '  <button type="button" class="wish-btn wish-btn--primary" data-act="wish-buy" data-id="' +
        esc(item.id) + '">还想买</button>' +
        '  <button type="button" class="wish-btn wish-btn--ghost" data-act="wish-extend" data-id="' +
        esc(item.id) + '"' + (extDisabled ? ' disabled' : '') + '>再想 ' + WISH.EXTEND_DAYS + ' 天</button>' +
        '  <button type="button" class="wish-btn wish-btn--ghost" data-act="wish-drop" data-id="' +
        esc(item.id) + '">算了</button>' +
        '  <button type="button" class="wish-btn wish-btn--danger" data-act="wish-del" data-id="' +
        esc(item.id) + '" aria-label="删除这条心愿">删除</button>' +
        '</div>';
    } else {
      actions =
        '<div class="wish-actions">' +
        '  <button type="button" class="wish-btn wish-btn--danger" data-act="wish-del" data-id="' +
        esc(item.id) + '" aria-label="删除这条心愿">删除</button>' +
        '</div>';
    }
    var bar = isCooling
      ? '<div class="wish-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" ' +
        'aria-valuenow="' + prog.pct + '" aria-label="冷静期进度"><i style="width:' + prog.pct + '%"></i></div>'
      : '';
    return '<li class="wish-item">' +
      '<div class="wish-item-main">' +
      '  <div class="wish-item-title">' + esc(item.title) +
      (prog.overdue && isCooling ? '<span class="wish-overdue">已到期</span>' : '') + '</div>' +
      (item.note ? '<div class="wish-item-note">' + esc(item.note) + '</div>' : '') +
      '  <div class="wish-item-meta">' + meta + '</div>' +
      bar +
      '</div>' + actions +
      '</li>';
  }

  /** 弹层主体：三页签 + 列表 + 底部累计 */
  function wishSheetHtml() {
    var todayKey = ENG.formatDate(new Date());
    var st = WISH.stats();
    var tabs = [
      { key: 'cooling', label: '冷静中', count: st.cooling },
      { key: 'bought', label: '已买', count: st.bought },
      { key: 'dropped', label: '已放弃', count: st.dropped }
    ];
    var tabsHtml = '';
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      var active = (wishTab === t.key);
      tabsHtml += '<button type="button" role="tab" aria-selected="' + (active ? 'true' : 'false') +
        '" class="wish-tab' + (active ? ' active' : '') + '" data-act="wish-tab" data-val="' +
        esc(t.key) + '">' + esc(t.label) + ' ' + t.count + '</button>';
    }

    var items = WISH.list(wishTab);
    var listHtml;
    if (!items.length) {
      var emptyText = wishTab === 'cooling'
        ? '清单是空的。下次想买又拿不定主意，先放进这里晾 48 小时。'
        : (wishTab === 'bought' ? '还没有从心愿单里买下的东西。' : '还没有放弃过的心愿。');
      listHtml = '<li class="wish-empty">' + esc(emptyText) + '</li>';
    } else {
      listHtml = items.map(function (it) { return wishItemHtml(it, todayKey); }).join('');
    }

    return '' +
      '<div class="wish-tabs" role="tablist" aria-label="心愿单分类">' + tabsHtml + '</div>' +
      '<ul class="wish-list">' + listHtml + '</ul>' +
      '<div class="wish-sec">' +
      '  <span class="wish-stat">因为冷静期，累计省下 <b>' + money(st.savedAmount) + '</b></span>' +
      '</div>' +
      '<p class="wish-foot-note">放进心愿单不会产生账单；点「还想买」才会记一笔支出。' +
      '同一件东西最多再延长 ' + WISH.EXTEND_MAX + ' 次，' + WISH.EXTEND_DAYS + ' 天一次。</p>';
  }

  function renderWishSheet() {
    var body = $('wishBody');
    if (!body) { return; }
    body.innerHTML = wishReady() ? wishSheetHtml() : '';
  }

  function openWishSheet() {
    if (!wishReady()) {
      showToast('当前浏览器不能保存数据，心愿单暂不可用', 'warn');
      return;
    }
    if (!wishTab) { wishTab = 'cooling'; }
    // 打开时若「冷静中」是空的、但别的页签有内容，直接落到有内容的那一页
    if (!WISH.listCooling().length) {
      if (WISH.list('bought').length) { wishTab = 'bought'; }
      else if (WISH.list('dropped').length) { wishTab = 'dropped'; }
      else { wishTab = 'cooling'; }
    } else {
      wishTab = 'cooling';
    }
    renderWishSheet();
    var mask = $('wishMask');
    if (mask) { mask.hidden = false; }
  }

  function closeWishSheet() {
    var mask = $('wishMask');
    if (mask) { mask.hidden = true; }
  }

  /**
   * 心愿单三出口的统一入口：sheet 里的按钮与聊天回访卡共用。
   * @param {string} id 心愿条目 id
   * @param {string} act  bought（买了）/ dropped（放弃）/ extend（再冷静几天）
   */
  function wishReviewDecide(id, act) {
    if (!id) { return; }
    var item = WISH.get(id);
    if (!item) { return; }
    if (item.status !== 'cooling') {
      showToast('这条心愿已经做过决定了');
      renderAll();
      renderWishSheet();
      return;
    }
    var line;
    if (act === 'bought') {
      var bill = commitBill({
        amount: item.amount,
        category: '购物',
        note: item.title,
        date: ENG.formatDate(new Date()),
        motivation: '情绪',
        want: true,
        type: 'expense'
      });
      var res = WISH.decide(id, 'bought', { billId: bill.id });
      if (!res.ok) {
        // 清单写不进去也要保住账单：账单已入 state，清单这边只是没记上状态
        showToast('账单已记下，但心愿单状态没保存成功', 'warn');
      }
      if (item.savedCounted) {
        state.savedMoney = ENG.round2(Math.max(0, state.savedMoney - item.amount));
        state.blockedCount = Math.max(0, Math.round(state.blockedCount) - 1);
        saveState();
      }
      line = toneLine('cool.bought', { title: item.title, amount: money(item.amount) });
      addAIMessage(aiBubble(esc(line || ('已记一笔 ' + money(item.amount) + '：' + item.title))));
      showToast('已记一笔 ' + money(item.amount), 'ok');
    } else if (act === 'dropped') {
      /* 放弃时不碰 savedMoney：钱在入清单那一刻就已经计入了（design §8.2），
         这里再加一次就是双计。 */
      var r2 = WISH.decide(id, 'dropped');
      if (!r2.ok) { showToast('心愿单状态没保存成功', 'warn'); }
      line = toneLine('cool.dropped', { title: item.title, amount: money(item.amount) });
      addAIMessage(aiBubble(esc(line || ('放下的 ' + money(item.amount) + ' 会留在你兜里。'))));
      showToast('已标记为放弃', 'ok');
    } else if (act === 'extend') {
      var r3 = WISH.extend(id, WISH.EXTEND_DAYS);
      if (!r3.ok) {
        showToast(r3.reason === 'max' ? '最多只能再延长 ' + WISH.EXTEND_MAX + ' 次，这次做个决定吧'
          : '这条心愿已经做过决定了', 'warn');
        renderAll();
        renderWishSheet();
        return;
      }
      line = toneLine('cool.extend', { days: WISH.EXTEND_DAYS });
      addAIMessage(aiBubble(esc(line || ('再给自己 ' + WISH.EXTEND_DAYS + ' 天。'))));
      showToast('已延长 ' + WISH.EXTEND_DAYS + ' 天', 'ok');
    } else {
      return;
    }
    renderAll();
    renderWishSheet();
  }

  /** 弹层内点击分发 */
  function wishPanelClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) { return; }
    var act = btn.getAttribute('data-act');
    var id = btn.getAttribute('data-id');
    if (act === 'wish-tab') {
      wishTab = btn.getAttribute('data-val') || 'cooling';
      renderWishSheet();
      return;
    }
    if (act === 'wish-buy') { wishReviewDecide(id, 'bought'); return; }
    if (act === 'wish-drop') { wishReviewDecide(id, 'dropped'); return; }
    if (act === 'wish-extend') { wishReviewDecide(id, 'extend'); return; }
    if (act === 'wish-del') {
      var item = WISH.get(id);
      if (!item) { return; }
      /* 删除是「清理痕迹」，不是决策：仍在冷静中的条目删除时要把它当初计入的
         省下的钱退回，否则会出现「条目没了、省下的钱还在」的假账。 */
      var res = WISH.remove(id);
      if (!res.ok) {
        showToast('删除失败，浏览器存储不可用', 'warn');
        return;
      }
      if (item.status === 'cooling' && item.savedCounted) {
        state.savedMoney = ENG.round2(Math.max(0, state.savedMoney - item.amount));
        state.blockedCount = Math.max(0, Math.round(state.blockedCount) - 1);
        saveState();
      }
      showToast('已删除这条心愿', 'ok');
      renderAll();
      renderWishSheet();
    }
  }

  /** 简洁版首页小卡：冷静中件数 + 累计省下 */
  function renderSimpleWish(ov) {
    var box = $('spWishCard');
    if (!box) { return; }
    if (!wishReady()) { box.hidden = true; return; }
    box.hidden = false;
    var o = ov || getOverview();
    var todayKey = o.todayStr || ENG.formatDate(new Date());
    var st = WISH.stats();
    if (!st.cooling && !st.savedAmount) {
      box.innerHTML = '<div class="sp-wish-row">' +
        '<span class="sp-wish-label">心愿单</span>' +
        '<span class="sp-wish-count">空</span></div>' +
        '<div class="sp-wish-note">想买又拿不定主意？说出来，我先帮你放进清单晾 48 小时。</div>';
      return;
    }
    var next = wishNextItem();
    var pct = next ? WISH.progress(next, todayKey).pct : 100;
    var due = WISH.dueItems(todayKey).length;
    box.innerHTML = '<div class="sp-wish-row">' +
      '<span class="sp-wish-label">心愿单 · 冷静中</span>' +
      '<span class="sp-wish-count">' + st.cooling + ' 件</span></div>' +
      '<div class="sp-wish-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="sp-wish-note">' +
      (due > 0
        ? esc(due + ' 件到期了，点开做个决定')
        : (next ? esc('「' + next.title + '」' + wishDueText(WISH.progress(next, todayKey))) : '清单是空的')) +
      (st.savedAmount > 0 ? ' · 累计省下 ' + money(st.savedAmount) : '') +
      '</div>';
  }

  /** 到期回访卡：最多列 2 条，其余引导打开心愿单 */
  function reviewedWishHtml(items) {
    var arr = Array.isArray(items) ? items : [];
    var max = 2;
    var shown = arr.slice(0, max);
    var title = toneLine('cool.due', { title: shown.length ? shown[0].title : '' }) ||
      '心愿单里的东西到期了，还想买吗？';
    var body = '';
    for (var i = 0; i < shown.length; i++) {
      var it = shown[i];
      body += '<div class="wish-item">' +
        '<div class="wish-item-main">' +
        '  <div class="wish-item-title">' + esc(it.title) + '</div>' +
        (it.note ? '<div class="wish-item-note">' + esc(it.note) + '</div>' : '') +
        '  <div class="wish-item-meta">' + money(it.amount) + ' · 加入于 ' + esc(it.startDate) + '</div>' +
        '</div>' +
        '<div class="wish-actions">' +
        '  <button type="button" class="wish-btn wish-btn--primary" data-act="wish-review" data-id="' +
        esc(it.id) + '" data-val="bought">还想买</button>' +
        '  <button type="button" class="wish-btn wish-btn--ghost" data-act="wish-review" data-id="' +
        esc(it.id) + '" data-val="extend">再想 ' + WISH.EXTEND_DAYS + ' 天</button>' +
        '  <button type="button" class="wish-btn wish-btn--ghost" data-act="wish-review" data-id="' +
        esc(it.id) + '" data-val="dropped">算了</button>' +
        '</div>' +
        '</div>';
    }
    var more = arr.length > max
      ? '<div class="wish-extra"><button type="button" class="btn-mini" data-act="wish-open">还有 ' +
        (arr.length - max) + ' 件到期了，打开心愿单</button></div>'
      : '<div class="wish-extra"><button type="button" class="btn-mini" data-act="wish-open">打开心愿单</button></div>';
    return '<div class="decision-card cool-card verdict-warn">' +
      '<div class="dc-icon cool">⏰</div>' +
      '<div class="dc-title">' + esc(title) + '</div>' +
      '<div class="dc-sub">冷静期到了 · 共 ' + arr.length + ' 件</div>' +
      '<div class="wish-list">' + body + '</div>' +
      more +
      '</div>';
  }

  /**
   * 到期回访：打开 App（init 末尾）+ 每次切到 chat / sai 各查一次，
   * 同一天只提醒一次（settings.wishReviewDate）。
   */
  function maybeWishReview() {
    if (!wishReady()) { return; }
    var todayKey = ENG.formatDate(new Date());
    var items = WISH.dueItems(todayKey);
    if (!items.length) { return; }
    var st = getSettings();
    if (st.wishReviewDate === todayKey) { return; }
    // 先写回去重标记：即使后面气泡渲染失败，也不会同一天反复弹
    st.wishReviewDate = todayKey;
    persistSettings();
    addAIMessage(reviewedWishHtml(items));
  }

  /* ================================================================== */
  /* 消费诊断 + 周期末预测（diagnose.js 接线）                            */
  /* ================================================================== */

  /** 诊断卡里每条规则的短标题与行动建议（句子主体由 tone.js 出） */
  var DIAG_META = {
    dailyOver: { title: '单日超支', action: '大额支出拆到别的日子，或把单日上限调高' },
    wantRatio: { title: '非必需占比偏高', action: '把「想要」类的开销压两成，先保吃饭和通勤' },
    cycleUp: { title: '环比涨太快', action: '对照上个周期，找出多出来的那几笔' },
    smallFreq: { title: '小额高频', action: '奶茶零食这类零碎，一周先砍掉一半' }
  };

  /**
   * 组装诊断入参（看板与简洁版共用，避免两处口径漂移）。
   * prevExpense 取「上一个同长度周期」的支出：以本周期起点前推 totalDays 天。
   */
  function diagInput(ov) {
    var st = getSettings();
    var o = ov || getOverview();
    /* 必须格式化成 YYYY-MM-DD：ENG.addDays 返回 Date，而 aggregate 内部拿 b.date
       （字符串）跟起止日做字符串比较，传 Date 会让区间过滤失效、算出全账本总额 */
    var prevEnd = ENG.formatDate(ENG.addDays(o.cycle.start, -1));
    var prevStart = ENG.formatDate(ENG.addDays(o.cycle.start, -o.cycle.totalDays));
    var prevAgg = ENG.aggregate(state.bills, prevStart, prevEnd);
    return {
      bills: state.bills,
      cycle: o.cycle,
      prevExpense: ENG.round2(prevAgg.expense),
      settings: { dailyCap: st.dailyCap, alertRatio: st.alertRatio },
      todayKey: o.todayStr
    };
  }

  /** 当前周期的诊断结果（最多 3 条，已排序） */
  function diagList(ov) {
    if (!DIAG || DIAG.missing) { return []; }
    return DIAG.build(diagInput(ov));
  }

  /** 一条诊断事实 → 一句当前语气的话（缺 key 时用中性兜底句，不显示空白） */
  function diagSentence(item) {
    var vars = {
      amount: money(item.amount),
      days: item.days,
      ratio: item.ratio + '%',
      growth: item.ratio + '%',
      count: item.count,
      cat: item.category
    };
    var line = toneLine('diag.' + item.code, vars);
    if (line) { return line; }
    if (item.code === 'dailyOver') { return '有 ' + item.days + ' 天单日花超了，最多的一天 ' + money(item.amount) + '。'; }
    if (item.code === 'wantRatio') { return '非必需消费占了 ' + item.ratio + '%，一共 ' + money(item.amount) + '。'; }
    if (item.code === 'cycleUp') { return '比上个周期多花了 ' + item.ratio + '%，这周期 ' + money(item.amount) + '。'; }
    if (item.code === 'smallFreq') { return item.count + ' 笔小额加起来 ' + money(item.amount) + '。'; }
    return '';
  }

  /** 完整版诊断卡：左色条 + 软底（等级不用文字色表达） */
  function renderDiagCard(ov) {
    var card = $('diagCard');
    var box = $('diagList');
    var badge = $('diagBadge');
    if (!card || !box) { return; }
    if (!DIAG || DIAG.missing) { card.hidden = true; return; }
    card.hidden = false;
    var list = diagList(ov);
    box.setAttribute('aria-live', 'polite');
    if (!list.length) {
      if (badge) {
        badge.textContent = '无异常';
        badge.className = 'badge badge-soft';
      }
      box.innerHTML = '<div class="diag-empty">' +
        esc(toneLine('diag.empty') || '这周期没什么明显问题，保持就好。') + '</div>';
      return;
    }
    var sev = DIAG.maxSeverity(list);
    if (badge) {
      badge.textContent = sev === 'high' ? '需要注意' : '留意一下';
      badge.className = 'badge badge-soft' + (sev === 'high' ? ' warn' : '');
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var meta = DIAG_META[it.code] || { title: '消费提示', action: '' };
      html += '<div class="diag-item is-' + esc(it.level) + '">' +
        '<span class="diag-bar is-' + esc(it.level) + '" aria-hidden="true"></span>' +
        '<div class="diag-main">' +
        '  <div class="diag-head"><span class="diag-title">' + esc(meta.title) + '</span></div>' +
        '  <div class="diag-evidence">' + esc(diagSentence(it)) + '</div>' +
        (meta.action ? '<div class="diag-action">' + esc(meta.action) + '</div>' : '') +
        '</div>' +
        '</div>';
    }
    box.innerHTML = html;
  }

  /** 简洁版诊断列表 */
  function renderSimpleDiag(ov) {
    var box = $('spDiag');
    if (!box) { return; }
    if (!DIAG || DIAG.missing) { box.hidden = true; return; }
    box.hidden = false;
    var list = diagList(ov);
    if (!list.length) {
      box.innerHTML = '<div class="sp-diag-item is-low">' +
        '<div class="sp-diag-head"><b class="sp-diag-title">消费诊断</b></div>' +
        '<div class="sp-diag-text">' +
        esc(toneLine('diag.empty') || '这周期没什么明显问题，保持就好。') + '</div></div>';
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var meta = DIAG_META[it.code] || { title: '消费提示' };
      html += '<div class="sp-diag-item is-' + esc(it.level) + '">' +
        '<div class="sp-diag-head"><b class="sp-diag-title">' + esc(meta.title) + '</b></div>' +
        '<div class="sp-diag-text">' + esc(diagSentence(it)) + '</div>' +
        '</div>';
    }
    box.innerHTML = html;
  }

  /** 周期末预测（纯函数入参：本周期支出 / 已过天数 / 剩余天数 / 总预算） */
  function forecastData(ov) {
    var o = ov || getOverview();
    var total = Number(state.budget.total) || 0;
    return DIAG.forecast({
      spent: ENG.round2(o.cycleAgg.expense),
      passedDays: o.cycle.passedDays,
      remainingDays: o.cycle.remainingDays,
      total: total
    });
  }

  /** 完整版预算卡里的期末预测 KPI */
  function renderForecastKpi(ov) {
    var box = $('forecastKpi');
    if (!box) { return; }
    if (!DIAG || DIAG.missing) { box.hidden = true; return; }
    var total = Number(state.budget.total) || 0;
    if (total <= 0) { box.hidden = true; return; }   // 没设总预算时预测没有意义
    box.hidden = false;
    var f = forecastData(ov);
    var over = f.level === 'over';
    var line = over
      ? (toneLine('forecast.over', { amount: money(f.overBudgetBy) }) ||
        ('照这个节奏，期末会超 ' + money(f.overBudgetBy) + '。'))
      : (toneLine('forecast.safe', { amount: money(Math.max(0, f.remainingAtEnd)) }) ||
        ('照现在这样，期末还能剩 ' + money(Math.max(0, f.remainingAtEnd)) + '。'));
    box.innerHTML =
      '<div class="fk-label">期末预测</div>' +
      '<div class="fk-value' + (over ? ' is-over' : '') + '">' +
      (over ? '超支 ' : '结余 ') + money(over ? f.overBudgetBy : Math.max(0, f.remainingAtEnd)) + '</div>' +
      '<div class="fk-note">' + esc(line) + '</div>';
  }

  /** 简洁版预算页的期末预测一行 */
  function renderSimpleForecast(ov) {
    var box = $('spForecast');
    if (!box) { return; }
    if (!DIAG || DIAG.missing) { box.hidden = true; return; }
    var total = Number(state.budget.total) || 0;
    if (total <= 0) { box.hidden = true; return; }
    box.hidden = false;
    var f = forecastData(ov);
    var over = f.level === 'over';
    var line = over
      ? (toneLine('forecast.over', { amount: money(f.overBudgetBy) }) ||
        ('照这个节奏，期末会超 ' + money(f.overBudgetBy) + '。'))
      : (toneLine('forecast.safe', { amount: money(Math.max(0, f.remainingAtEnd)) }) ||
        ('照现在这样，期末还能剩 ' + money(Math.max(0, f.remainingAtEnd)) + '。'));
    box.innerHTML = '期末预测 <b' + (over ? ' class="is-over"' : '') + '>' +
      (over ? '超支 ' : '结余 ') + money(over ? f.overBudgetBy : Math.max(0, f.remainingAtEnd)) +
      '</b> <small>' + esc(line) + '</small>';
  }

  /* ================================================================== */
  /* 消费性格测试（persona.js）                                          */
  /* ================================================================== */

  /* persona.js 缺失 / 加载失败时置空：入口显示「模块未加载」，其余功能不受影响
     （与 PIGGY / DIAG 的替身策略同口径，只是这里逻辑简单，用判空就够了） */
  var PER = (global.AJ && global.AJ.persona && typeof global.AJ.persona.score === 'function')
    ? global.AJ.persona : null;

  /**
   * 答题记录为什么用独立存储键（ai_jizhang_persona_v1），不塞进主账本 state：
   *   ① 主账本一动 normalizeState() 就要重跑全套回归，风险大；
   *   ② 测试记录损坏时只应重置自己，不能牵连账单（与省钱图谱 / 存钱罐同理）；
   *   ③ 报告里的证据数字来自「交卷那一刻」的账单，属于快照，不属于账本。
   */
  var PERSONA_KEY = 'ai_jizhang_persona_v1';
  /** 答题进行中的临时状态：不落盘（刷新重来），交卷后才写记录。
      len = 本次题量（10 / 30 / 50），由用户在开始前的题量选择里定 */
  var personaQuiz = { active: false, choosing: false, step: 0, answers: [], len: 0 };
  /** 最近一次交卷的快照：{ answers, key, name, emoji, report, at } */
  var personaRecord = null;
  /** 懒加载标记：首次渲染时才读一次存储 */
  var personaLoaded = false;

  /** 读最近一次交卷记录；坏档只重置自己，绝不抛异常 */
  function loadPersonaRecord() {
    try {
      var raw = global.localStorage.getItem(PERSONA_KEY);
      var o = raw ? JSON.parse(raw) : null;
      if (o && typeof o === 'object' && typeof o.report === 'string' && o.report) {
        personaRecord = {
          answers: Array.isArray(o.answers) ? o.answers : [],
          key: typeof o.key === 'string' ? o.key : '',
          name: typeof o.name === 'string' ? o.name : '',
          emoji: typeof o.emoji === 'string' ? o.emoji : '',
          report: o.report,
          plan: typeof o.plan === 'string' ? o.plan : o.report,
          len: isFinite(Number(o.len)) ? Number(o.len) : 0,
          at: isFinite(Number(o.at)) ? Number(o.at) : 0
        };
      }
    } catch (e) {
      personaRecord = null;
    }
  }

  /** 写最近一次交卷记录；隐私模式写不进去也不拦展示（刷新不保留而已） */
  function savePersonaRecord() {
    try {
      global.localStorage.setItem(PERSONA_KEY, JSON.stringify(personaRecord));
    } catch (e) { /* 存储不可用时静默 */ }
  }

  /**
   * 组装 persona 五项账单指标（口径与 persona.js 注释一一对应，勿单改一处）：
   *   engelPercent  本周期恩格尔系数（ov.engel.percent）
   *   savingsRate   本周期储蓄率（ov.incomeStats.savingsRate，无收入为 null → 按 0）
   *   emotionCount  本周期情绪消费笔数（motivation==='情绪' 或 want===true，
   *                 与冷静期 / 专属建议的「冲动消费」同一判据）
   *   checkinCount  省钱图谱打卡总次数（savingsDb.logs 条数）
   *   piggyBalance  存钱罐余额（元）
   */
  function personaMetrics(ov) {
    var o = ov || getOverview();
    var cnt = 0;
    var bills = Array.isArray(state.bills) ? state.bills : [];
    var i;
    for (i = 0; i < bills.length; i++) {
      var b = bills[i];
      if (!b || typeof b !== 'object' || b.type === 'income') { continue; }
      if (o.cycle.start && b.date < o.cycle.start) { continue; }
      if (o.cycle.end && b.date > o.cycle.end) { continue; }
      if (b.motivation === '情绪' || b.want === true) { cnt++; }
    }
    var rate = (o.incomeStats && o.incomeStats.savingsRate !== null &&
      o.incomeStats.savingsRate !== undefined) ? o.incomeStats.savingsRate : null;
    return {
      engelPercent: (o.engel && isFinite(o.engel.percent)) ? o.engel.percent : 0,
      savingsRate: rate,
      emotionCount: cnt,
      checkinCount: (savingsDb && Array.isArray(savingsDb.logs)) ? savingsDb.logs.length : 0,
      piggyBalance: PIGGY.getBalance() || 0
    };
  }

  /**
   * 报告 Markdown → 卡片 HTML。
   * 格式是 persona.js 固定的四小节，只做三行规则转换，其余原样展示：
   *   '### x' → 标题；'**x**' 整行 → 小节名；其他行 → 正文。
   */
  function personaReportHtml(md) {
    var lines = String(md || '').split('\n');
    var html = '';
    var i;
    for (i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) { continue; }
      if (line.indexOf('### ') === 0) {
        html += '<div class="p-title">' + esc(line.slice(4)) + '</div>';
      } else if (/^\*\*.+\*\*$/.test(line)) {
        html += '<div class="p-sec">' + esc(line.slice(2, -2)) + '</div>';
      } else {
        html += '<div class="p-p">' + esc(line) + '</div>';
      }
    }
    return '<div class="persona-report">' + html + '</div>';
  }

  /** 交卷：打分 → 出完整方案 → 写快照 → 弹窗内展示结果 */
  function personaFinish() {
    var metrics = personaMetrics(getOverview());
    var res = PER.score(personaQuiz.answers, metrics, personaQuiz.len);
    personaRecord = {
      answers: personaQuiz.answers.slice(),
      key: res.key,
      name: res.name,
      emoji: res.emoji,
      /* report：≤200 字精简版，给教练面板的卡片摘要用 */
      report: PER.report(res, metrics),
      /* plan：完整版（含分点详细建议），弹窗里展示 */
      plan: PER.plan(res, metrics),
      len: personaQuiz.len,
      at: Date.now()
    };
    personaQuiz = { active: false, choosing: false, step: 0, answers: [], len: 0 };
    savePersonaRecord();
  }

  /* 彩色 emoji / 变体选择符 / 零宽连接符的匹配与剥离：
     只用在报告标题行，正文不动（正文可能含箭头等符号）。
     代理对区间覆盖 🐿️🦁🦊🐨🧬📊💡🎯，\u2190-\u2BFF 覆盖各类装饰符号，不含 CJK。 */
  var P_EMOJI_RE = /(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2190-\u2BFF\uFE0F\u200D])+/g;

  /** 小节标题里的彩色 emoji → 全站统一的线性 SVG 图标（功能图标一律不用 emoji，见 itemIcon 注释） */
  function personaSecIcon(text) {
    if (text.indexOf('\uD83D\uDCCA') >= 0) { return ic('bar', 'p-ico', null); }    /* 📊 */
    if (text.indexOf('\uD83D\uDCA1') >= 0) { return ic('bulb', 'p-ico', null); }   /* 💡 */
    if (text.indexOf('\uD83C\uDFAF') >= 0) { return ic('target', 'p-ico', null); } /* 🎯 */
    return '';
  }

  /**
   * 报告头行 → 性格徽章（大号动物形象 + 名字 + 线性基因图标）。
   * persona.js 产出的 Markdown 保持纯文本（便于复制分享 / Node 单测），
   * 图标与版式只在这一层渲染时加，职责不混。
   */
  function personaHeroHtml(raw) {
    var src = String(raw || '');
    var plain = src.replace(P_EMOJI_RE, '').trim();
    var label = '';
    var name = '';
    var at = plain.lastIndexOf('\uff1a');          /* 全角冒号 */
    if (at < 0) { at = plain.lastIndexOf(':'); }
    if (at >= 0) {
      label = plain.slice(0, at).trim();
      name = plain.slice(at + 1).trim();
    }
    /* 原文是「你的消费性格是：仓鼠型」，拆成两行后留个「是」读着别扭，去掉 */
    if (label.slice(-1) === '\u662F') { label = label.slice(0, -1).trim(); }
    /* 带变体选择符一起取，否则徽章显示 🐿 而卡片显示 🐿️，两个地方不一样 */
    var all = src.match(/(?:[\uD800-\uDBFF][\uDC00-\uDFFF])\uFE0F?/g) || [];
    var animal = all.length ? all[all.length - 1] : '';   /* 头行里 🧬 在前、动物在后，取最后一个 */
    if (!name || !animal) {
      /* 解析不出来就退回纯文本标题，绝不因格式变化而白屏 */
      return '<div class="p-title">' + ic('dna', 'p-ico', null) + esc(plain || src) + '</div>';
    }
    return '<div class="p-hero">' +
      '<span class="p-hero-badge">' + esc(animal) + '</span>' +
      '<div class="p-hero-main">' +
      '<span class="p-hero-label">' + ic('dna', 'p-ico', null) + esc(label) + '</span>' +
      '<b class="p-hero-name">' + esc(name) + '</b>' +
      '</div></div>';
  }

  /**
   * 完整方案 Markdown → 弹窗 HTML。
   * 比卡片多认一种行：'1. **标题**：怎么做' → 编号步骤（分点建议）。
   */
  function personaPlanHtml(md) {
    var lines = String(md || '').split('\n');
    var html = '';
    var inList = false;
    var i;
    function closeList() {
      if (inList) { html += '</ol>'; inList = false; }
    }
    for (i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) { continue; }
      if (line.indexOf('### ') === 0) {
        closeList();
        html += personaHeroHtml(line.slice(4));
        continue;
      }
      if (/^\*\*.+\*\*$/.test(line)) {
        closeList();
        var sec = line.slice(2, -2);
        html += '<div class="p-sec">' + personaSecIcon(sec) +
          '<span>' + esc(sec.replace(P_EMOJI_RE, '').trim()) + '</span></div>';
        continue;
      }
      var m = /^(\d+)\.\s*\*\*(.+?)\*\*[：:]([\s\S]*)$/.exec(line);
      if (m) {
        if (!inList) { html += '<ol class="persona-steps">'; inList = true; }
        html += '<li><b>' + esc(m[2]) + '</b>' + esc(m[3]) + '</li>';
        continue;
      }
      closeList();
      html += '<div class="p-p">' + esc(line) + '</div>';
    }
    closeList();
    return '<div class="persona-report">' + html + '</div>';
  }

  /** 本次这套题（按题量从题库等距抽，确定性，重进页面结果不变） */
  function personaSet() {
    return PER.pick(personaQuiz.len || PER.DEFAULT_LEN);
  }

  /** 题量选择行：10 / 30 / 50，点哪个直接开测 */
  function personaLenHtml() {
    var html = '<div class="persona-len">';
    var i;
    for (i = 0; i < PER.LENGTHS.length; i++) {
      var n = PER.LENGTHS[i];
      var min = Math.max(1, Math.round(n / 10));
      html += '<button type="button" class="btn-mini' + (n === PER.DEFAULT_LEN ? ' primary' : '') +
        '" data-pact="len" data-val="' + n + '">' + ic('clock', 'len-ico', null) +
        '<span>' + n + ' 题 · 约 ' + min + ' 分钟</span></button>';
    }
    return html + '</div>';
  }

  /** 弹窗里渲染答题区（进度 + 题干 + 四个选项） */
  function personaQuizHtml() {
    var set = personaSet();
    var q = set[personaQuiz.step];
    if (!q || !Array.isArray(q.opts)) {
      /* 数据异常兜底：直接结束答题，回到题量选择 */
      personaQuiz = { active: false, choosing: false, step: 0, answers: [], len: 0 };
      return '';
    }
    var total = set.length;
    var pct = Math.round(personaQuiz.step / total * 100);
    var optsHtml = '';
    var i;
    for (i = 0; i < q.opts.length; i++) {
      var opt = q.opts[i] || {};
      optsHtml += '<button type="button" class="persona-opt" data-pact="opt" data-val="' + i + '">' +
        '<span class="persona-opt-letter">' + String.fromCharCode(65 + i) + '</span>' +
        '<span>' + esc(opt.t || '') + '</span>' +
        '</button>';
    }
    return '<div class="persona-progress">' + ic('clipboard', 'p-ico', null) +
      '<span>第 ' + (personaQuiz.step + 1) + ' / ' + total + ' 题</span>' +
      '<span class="persona-progress-track"><i style="width:' + pct + '%"></i></span></div>' +
      '<div class="persona-q">' + esc(q.q || '') + '</div>' +
      '<div class="persona-opts">' + optsHtml + '</div>';
  }

  /**
   * 弹窗内容（三种状态：答题中 / 题量选择 / 结果 + 分点建议）。
   * 答题不再占教练面板的位置，卡片只留入口和上次结果。
   */
  function renderPersonaSheet() {
    var box = $('personaSheetBody');
    if (!box) { return; }
    if (!PER || !Array.isArray(PER.BANK) || !PER.BANK.length) {
      box.innerHTML = '<div class="persona-empty">性格测试模块没有加载成功，其他功能不受影响。</div>';
      return;
    }

    /* 状态一：答题中 */
    if (personaQuiz.active) {
      var html = personaQuizHtml();
      if (html) { box.innerHTML = html; }
      else { renderPersonaSheet(); }
      return;
    }

    /* 状态二：结果（完整方案：画像 + 证据 + 剖析 + 分点建议） */
    if (!personaQuiz.choosing && personaRecord && personaRecord.report) {
      var doneLen = isFinite(Number(personaRecord.len)) && Number(personaRecord.len) > 0
        ? Number(personaRecord.len) : (personaRecord.answers ? personaRecord.answers.length : 0);
      box.innerHTML = personaPlanHtml(personaRecord.plan || personaRecord.report) +
        (doneLen ? '<div class="persona-hint">本次测了 ' + doneLen + ' 题</div>' : '') +
        '<div class="persona-actions">' +
        '<button type="button" class="btn-mini" data-pact="retake">再测一次</button>' +
        '<button type="button" class="btn-mini primary" data-pact="close">知道了</button>' +
        '</div>';
      return;
    }

    /* 状态三：题量选择 */
    box.innerHTML =
      '<div class="persona-intro">' + ic('dna', 'p-ico', null) +
      '<span>我是<b>阿账</b>：先挑个题量，答完再结合你的真实账单，' +
      '看看你是 🐿️ 仓鼠、🦁 狮子、🦊 狐狸还是 🐨 考拉。' +
      '出结果时我会给你三条具体的做法，不是一句「少花点」。</span></div>' +
      personaLenHtml();
  }

  /** 打开答题弹窗（未测过 / 再测 → 题量选择；测过 → 直接看结果） */
  function openPersonaSheet() {
    if (!PER || !Array.isArray(PER.BANK) || !PER.BANK.length) {
      showToast('性格测试模块没有加载成功', 'warn');
      return;
    }
    if (!personaLoaded) {
      loadPersonaRecord();
      personaLoaded = true;
    }
    /* 从未测过，或刚点过「再测一次」：从题量选择开始；否则直接看上次结果 */
    if (!personaRecord || !personaRecord.report) {
      personaQuiz = { active: false, choosing: true, step: 0, answers: [], len: 0 };
    }
    renderPersonaSheet();
    $('personaMask').hidden = false;
  }

  /** 关闭弹窗：答题进行中的状态一并丢掉（刷新重来，不留半成品） */
  function closePersonaSheet() {
    personaQuiz = { active: false, choosing: false, step: 0, answers: [], len: 0 };
    if ($('personaMask')) { $('personaMask').hidden = true; }
  }

  /* ================================================================== */
  /* 账单筛选抽屉（完整版「本月账单流水」/ 简洁版「明细」共用同一抽屉）    */
  /* ================================================================== */

  /** 渲染一组分类胶囊（支出 / 收入），高亮已选中的；group ∈ {'cats','sources'} */
  function renderBillFilterCaps(hostId, selected, all, group) {
    var host = $(hostId);
    if (!host) { return; }
    var html = '';
    var i;
    for (i = 0; i < all.length; i++) {
      var k = all[i];
      var on = selected.indexOf(k) !== -1;
      html += '<button type="button" class="bf-cap' + (on ? ' on' : '') +
        '" data-bf-group="' + group + '" data-bf-val="' + esc(k) + '">' + esc(k) + '</button>';
    }
    host.innerHTML = html;
  }

  /** 把当前 billFilter 同步到抽屉里的控件（打开抽屉时调用） */
  function syncBillFilterUI() {
    var bf = BF.normalize(billFilter);
    if ($('bfMin')) { $('bfMin').value = (bf.min === '' ? '' : bf.min); }
    if ($('bfMax')) { $('bfMax').value = (bf.max === '' ? '' : bf.max); }
    if ($('bfNote')) { $('bfNote').value = bf.note; }
    renderBillFilterCaps('bfCats', bf.cats, BF.CATS, 'cats');
    renderBillFilterCaps('bfSources', bf.sources, BF.SOURCES, 'sources');
  }

  /** 从抽屉控件读回筛选条件（确认 / 重置时用） */
  function readBillFilterUI() {
    var cats = [];
    var sources = [];
    var catsBox = $('bfCats');
    if (catsBox) {
      var cs = catsBox.querySelectorAll('.bf-cap.on');
      var i;
      for (i = 0; i < cs.length; i++) { cats.push(cs[i].getAttribute('data-bf-val')); }
    }
    var srcBox = $('bfSources');
    if (srcBox) {
      var ss = srcBox.querySelectorAll('.bf-cap.on');
      var j;
      for (j = 0; j < ss.length; j++) { sources.push(ss[j].getAttribute('data-bf-val')); }
    }
    return BF.normalize({
      cats: cats,
      sources: sources,
      min: $('bfMin') ? $('bfMin').value : '',
      max: $('bfMax') ? $('bfMax').value : '',
      note: $('bfNote') ? $('bfNote').value : ''
    });
  }

  /** 刷新两版列表页的「筛选」按钮角标（激活时显示「筛选·N」） */
  /** 筛选条件的一句话摘要（列表上方那条筛选栏用） */
  function billFilterSummary(f) {
    var seg = [];
    var cats = f.cats || [];
    var sources = f.sources || [];
    function brief(list, unit) {
      if (list.length <= 2) { return list.join('、'); }
      return list.slice(0, 2).join('、') + ' 等 ' + list.length + ' 类' + unit;
    }
    if (cats.length) { seg.push(brief(cats, '支出')); }
    if (sources.length) { seg.push(brief(sources, '收入')); }
    var min = f.min === '' || f.min === null || typeof f.min === 'undefined' ? '' : f.min;
    var max = f.max === '' || f.max === null || typeof f.max === 'undefined' ? '' : f.max;
    if (min !== '' && max !== '') { seg.push('¥' + min + ' ~ ¥' + max); }
    else if (min !== '') { seg.push('≥ ¥' + min); }
    else if (max !== '') { seg.push('≤ ¥' + max); }
    if (f.note) { seg.push('含「' + f.note + '」'); }
    return seg.join(' · ');
  }

  /** 列表上方的筛选条：明确告诉用户「正在筛选什么、筛出多少笔」，可一键清除 */
  function renderBillFilterBar(barId, count) {
    var bar = $(barId);
    if (!bar) { return; }
    if (!BF.isActive(billFilter)) {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }
    bar.hidden = false;
    bar.innerHTML =
      '<svg class="bf-bar-ico" aria-hidden="true"><use href="#i-filter"/></svg>' +
      '<span class="bf-bar-txt">' + esc(billFilterSummary(billFilter)) + '</span>' +
      '<span class="bf-bar-num">' + count + ' 笔</span>' +
      '<button type="button" class="bf-bar-clear" data-bf-clear="1">清除</button>';
  }

  function refreshBillFilterBadge() {
    var active = BF.isActive(billFilter);
    var label = active ? ('筛选·' + BF.activeCount(billFilter)) : '筛选';
    /* 按钮内是「图标 + <span>文字</span>」结构，只改 span 才不会把图标冲掉 */
    var nodes = [$('btnBillFilter'), $('btnSpBillFilter')];
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (!nodes[i]) { continue; }
      nodes[i].classList.toggle('active', active);
      var span = nodes[i].querySelector('span');
      if (span) { span.textContent = label; } else { nodes[i].textContent = label; }
    }
  }

  /** 筛选条上的「清除」：等价于重置（事件委托） */
  function onBillFilterClear(e) {
    var el = e.target.closest ? e.target.closest('[data-bf-clear]') : null;
    if (!el) { return; }
    resetBillFilter();
  }

  function openBillFilterSheet() {
    syncBillFilterUI();
    var mask = $('billFilterMask');
    if (mask) { mask.hidden = false; }
  }

  function closeBillFilterSheet() {
    var mask = $('billFilterMask');
    if (mask) { mask.hidden = true; }
  }

  /** 确认：把抽屉里的条件写回 billFilter，关闭并刷新两版列表 */
  function confirmBillFilter() {
    billFilter = readBillFilterUI();
    closeBillFilterSheet();
    refreshBillFilterBadge();
    renderBillList();
    renderSimpleList();
  }

  /** 重置：清空筛选、刷新抽屉与两版列表、关闭抽屉 */
  function resetBillFilter() {
    billFilter = BF.normalize(BF.DEFAULTS);
    syncBillFilterUI();
    refreshBillFilterBadge();
    renderBillList();
    renderSimpleList();
    closeBillFilterSheet();
  }

  /** 胶囊点击：切换选中态（事件委托在静态宿主上） */
  function onBillFilterCap(e) {
    var el = e.target.closest ? e.target.closest('.bf-cap') : null;
    if (!el) { return; }
    el.classList.toggle('on');
  }

  /** 全选 / 取消全选：根据当前是否全亮决定（事件委托在 billFilterBody 上） */
  function onBillFilterSelectAll(e) {
    var btn = e.target.closest ? e.target.closest('[data-bf-all]') : null;
    if (!btn) { return; }
    var group = btn.getAttribute('data-bf-all');
    var hostId = group === 'cats' ? 'bfCats' : 'bfSources';
    var host = $(hostId);
    if (!host) { return; }
    var caps = host.querySelectorAll('.bf-cap');
    var allOn = caps.length > 0;
    var i;
    for (i = 0; i < caps.length; i++) {
      if (!caps[i].classList.contains('on')) { allOn = false; break; }
    }
    for (i = 0; i < caps.length; i++) { caps[i].classList.toggle('on', !allOn); }
  }

  /**
   * 渲染教练面板里的测试入口卡（只放「上次结果 + 进入测试」）。
   * 挂在理财专家面板，完整版与简洁版共用同一节点，无需双宿主。
   */
  function renderPersona() {
    var box = $('personaBody');
    if (!box) { return; }
    if (!PER || !Array.isArray(PER.BANK) || !PER.BANK.length) {
      box.innerHTML = '<div class="persona-empty">性格测试模块没有加载成功，其他功能不受影响。</div>';
      return;
    }
    if (!personaLoaded) {
      loadPersonaRecord();
      personaLoaded = true;
    }

    if (personaRecord && personaRecord.report) {
      var doneLen = isFinite(Number(personaRecord.len)) && Number(personaRecord.len) > 0
        ? Number(personaRecord.len) : (personaRecord.answers ? personaRecord.answers.length : 0);
      box.innerHTML =
        '<div class="persona-last">' + ic('dna', 'p-ico', null) +
        '<span class="pl-emoji">' + esc(personaRecord.emoji || '') + '</span>' +
        '<b>' + esc(personaRecord.name || '未测') + '</b>' +
        (doneLen ? '<span class="persona-hint">测了 ' + doneLen + ' 题</span>' : '') + '</div>' +
        '<div class="persona-actions">' +
        '<button type="button" class="btn-mini primary" data-pact="open">看结果与建议</button>' +
        '<button type="button" class="btn-mini" data-pact="retake">再测一次</button>' +
        '</div>';
      return;
    }

    box.innerHTML =
      '<div class="persona-intro">' + ic('dna', 'p-ico', null) +
      '<span>我是<b>阿账</b>：答一套小题，结合你的真实账单，' +
      '看看你是 🐿️ 仓鼠、🦁 狮子、🦊 狐狸还是 🐨 考拉，并给你三条具体做法。</span></div>' +
      '<div class="persona-actions">' +
      '<button type="button" class="btn-mini primary" data-pact="open">开始测试</button>' +
      '</div>';
  }

  /** 卡片 / 弹窗内的事件分发（都走 data-pact，绑定在静态宿主上做委托） */
  function personaAction(act, val) {
    if (!PER) { return; }
    if (act === 'open') {
      openPersonaSheet();
      return;
    }
    if (act === 'close') {
      closePersonaSheet();
      renderPersona();
      return;
    }
    if (act === 'start' || act === 'retake') {
      /* 再测 / 开始：弹窗内回到题量选择（10 / 30 / 50） */
      personaQuiz = { active: false, choosing: true, step: 0, answers: [], len: 0 };
      $('personaMask').hidden = false;
      renderPersonaSheet();
      return;
    }
    if (act === 'len') {
      var n = PER.normalizeLen(parseInt(val, 10));
      personaQuiz = { active: true, choosing: false, step: 0, answers: [], len: n };
      renderPersonaSheet();
      return;
    }
    if (act === 'opt') {
      if (!personaQuiz.active) { return; }
      var set = personaSet();
      var q = set[personaQuiz.step];
      var idx = parseInt(val, 10);
      if (!q || !Array.isArray(q.opts) || !(idx >= 0 && idx < q.opts.length)) { return; }
      personaQuiz.answers.push(String.fromCharCode(65 + idx));
      personaQuiz.step++;
      if (personaQuiz.step >= set.length) {
        personaFinish();
        renderPersona();     /* 卡片同步成「看结果与建议」 */
      }
      renderPersonaSheet();
    }
  }

  /** personaBody / personaSheetBody 的点击委托（在 bindEvents 里各绑一次） */
  function onPersonaClick(e) {
    var el = e.target.closest ? e.target.closest('[data-pact]') : null;
    if (!el) { return; }
    personaAction(el.getAttribute('data-pact'), el.getAttribute('data-val'));
  }

  /* ================================================================== */
  /* 目标池                                                              */
  /* ================================================================== */

  function renderGoals() {
    var list = $('goalList');
    var ov = getOverview();
    if (state.goals.length === 0) {
      list.innerHTML = '<div class="empty">还没有目标，点右上角「+ 新目标」加一个吧</div>';
      return;
    }
    var html = '';
    var i;
    for (i = 0; i < state.goals.length; i++) {
      var g = state.goals[i];
      var p = ENG.getGoalProjection(g, ov.monthlySurplus, ov.today);
      var tip;
      var warnCls = '';
      if (p.need <= 0) {
        tip = ic('target', 'bico-brand', '已达成') + '已达成目标，还多存了 ' + money(Math.max(0, g.saved - g.target)) + '。';
      } else if (p.monthsLeft === null) {
        tip = '当前月结余为负，先让结余转正，再谈攒钱。';
        warnCls = ' warn';
      } else {
        tip = '按当前速度还需约 ' + p.monthsLeft + ' 个月';
        if (p.monthsToDeadline !== null) {
          tip += '（距目标日还有 ' + p.monthsToDeadline + ' 个月）';
        }
        if (p.lateMonths !== null && p.lateMonths > 0) {
          tip += '，按当前速度会晚 ' + p.lateMonths + ' 个月，建议每月多存 ' + money(p.extraPerMonth) + '。';
          warnCls = ' warn';
        } else {
          tip += '，节奏刚好。';
        }
      }

      html += '<div class="goal-item">' +
        '<div class="goal-top">' +
        '<span class="goal-name">' + esc(g.name) + '</span>' +
        '<span class="goal-actions">' +
        '<button type="button" class="btn-mini" data-goal-add="' + esc(g.id) + '">+ 存钱</button>' +
        '<button type="button" class="goal-del" data-goal-del="' + esc(g.id) + '" title="删除目标"><svg viewBox="0 0 24 24"><use href="#i-trash"/></svg></button>' +
        '</span>' +
        '</div>' +
        '<div class="goal-bar"><i style="width:' + p.percent + '%"></i></div>' +
        '<div class="goal-meta">' +
        '<span><b>' + money(g.saved) + '</b> / ' + money(g.target) + '</span>' +
        '<span>' + p.percent.toFixed(1) + '%</span>' +
        '</div>' +
        '<div class="goal-tip' + warnCls + '">' + esc(tip) + '</div>' +
        '</div>';
    }
    list.innerHTML = html;
  }

  function findGoal(id) {
    var i;
    for (i = 0; i < state.goals.length; i++) {
      if (state.goals[i].id === id) { return state.goals[i]; }
    }
    return null;
  }

  /* ================================================================== */
  /* 弹窗                                                                */
  /* ================================================================== */

  function openModal(html) {
    var mask = $('modalMask');
    var box = $('modalBox');
    box.innerHTML = html;
    mask.hidden = false;
    bindDocScroll(box);
    return box;
  }

  function closeModal() {
    var mask = $('modalMask');
    var box = $('modalBox');
    mask.hidden = true;
    box.innerHTML = '';
  }

  /** 轻提示 Toast：2.4s 自动消失（设计稿三型：ok / warn / danger） */
  function showToast(text, type) {
    var root = $('toastRoot');
    if (!root) { return; }
    var el = DOC.createElement('div');
    el.className = 'toast ' + (type === 'warn' ? 'warn' : (type === 'danger' ? 'danger' : 'ok'));
    el.textContent = text;
    root.appendChild(el);
    setTimeout(function () {
      el.classList.add('leaving');
      setTimeout(function () {
        if (el.parentNode) { el.parentNode.removeChild(el); }
      }, 280);
    }, 2400);
  }

  /**
   * 分类选择器（自定义控件，替代原生 select）。
   * 原生下拉在移动端是系统蓝色高亮 + 系统滚动条，和这套绿色柔和皮肤完全两张脸，
   * 所以做成「触发器 = 淡底图标 + 分类名」，点开后原地展开 3 列分类网格：
   * 每个选项复用明细列表同一套「淡底方块 + 深墨图标」语言，选中有绿描边 + 勾。
   * 真实值放 hidden input（id 由调用方给），原本读 .value 的代码不用改。
   * @param {string} id hidden input 的 id
   * @param {string} selected 初始分类
   */
  function catPickerHtml(id, selected) {
    var cur = DATA.CATEGORY_KEYS.indexOf(selected) !== -1 ? selected : DATA.CATEGORIES[0].key;
    var opts = '';
    var i;
    for (i = 0; i < DATA.CATEGORIES.length; i++) {
      var key = DATA.CATEGORIES[i].key;
      var on = key === cur;
      opts += '<button type="button" class="catpick-opt' + (on ? ' on' : '') + '"' +
        ' data-cat="' + esc(key) + '" role="option" aria-selected="' + (on ? 'true' : 'false') + '">' +
        '<span class="catpick-tile" style="' + spCatTileStyle(key) + '">' + spCatIcon(key) +
        '<svg class="catpick-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' +
        '</span>' +
        '<span class="catpick-name">' + esc(key) + '</span>' +
        '</button>';
    }
    return '<div class="catpick" data-catpick>' +
      '<button type="button" class="catpick-btn" data-catpick-toggle aria-haspopup="listbox" aria-expanded="false">' +
      '<span class="catpick-val" style="' + spCatTileStyle(cur) + '">' + spCatIcon(cur) + '</span>' +
      '<span class="catpick-cur">' + esc(cur) + '</span>' +
      '<svg class="catpick-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>' +
      '</button>' +
      '<div class="catpick-panel" role="listbox" aria-label="选择分类" hidden>' + opts + '</div>' +
      '<input type="hidden" id="' + id + '" value="' + esc(cur) + '" />' +
      '</div>';
  }

  /** 当前展开着的分类选择器（同一时刻只可能有一个弹窗，用单例避免重复挂监听） */
  var catPickCtx = null;

  /** 给 catPickerHtml 生成的控件挂交互（展开 / 选中 / 收起 / 点外部关闭） */
  function bindCatPicker(box, id) {
    var wrap = box.querySelector('[data-catpick]');
    var hidden = box.querySelector('#' + id);
    if (!wrap || !hidden) { return; }
    var btn = wrap.querySelector('[data-catpick-toggle]');
    var panel = wrap.querySelector('.catpick-panel');
    var valTile = wrap.querySelector('.catpick-val');
    var curName = wrap.querySelector('.catpick-cur');

    function setOpen(open) {
      panel.hidden = !open;
      if (open) { wrap.classList.add('open'); } else { wrap.classList.remove('open'); }
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      catPickCtx = open ? { wrap: wrap, close: function () { setOpen(false); } } : null;
    }
    function close() { setOpen(false); }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(panel.hidden);
    });

    panel.addEventListener('click', function (e) {
      var opt = e.target.closest ? e.target.closest('.catpick-opt') : null;
      if (!opt) { return; }
      var key = opt.getAttribute('data-cat');
      var i;
      hidden.value = key;
      valTile.setAttribute('style', spCatTileStyle(key));
      valTile.innerHTML = spCatIcon(key);
      curName.textContent = key;
      var all = panel.querySelectorAll('.catpick-opt');
      for (i = 0; i < all.length; i++) {
        var on = all[i] === opt;
        if (on) { all[i].classList.add('on'); } else { all[i].classList.remove('on'); }
        all[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      close();
      btn.focus();
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
    });

    /* Esc：面板开着时只收起面板，不要连带把整个「记一笔」弹窗关掉 */
    wrap.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') { return; }
      if (panel.hidden) { return; }
      e.stopPropagation();
      close();
    });

    /* 点面板外部收起（全局监听只挂一次，见下） */
    if (!bindCatPicker.bound) {
      bindCatPicker.bound = true;
      DOC.addEventListener('click', function (e) {
        if (!catPickCtx) { return; }
        if (catPickCtx.wrap.contains(e.target)) { return; }
        catPickCtx.close();
      });
    }
  }

  /**
   * 快捷记账面板（顶栏「＋ 记一笔」）：金额 / 分类 / 备注 / 日期。
   * 直接走 commitBill 落账，提交后聊天空出回执、预算条即时刷新。
   * @param {?string} [presetCategory] 预填分类（意图层已知的品类）
   * @param {?string} [presetDate] 预填日期 'YYYY-MM-DD'（L3 表单只让用户填缺的那个）
   */
  function openQuickAddModal(presetCategory, presetDate) {
    var todayStr = ENG.formatDate(new Date());
    /* C10：日期预填；不合法一律回落到今天（按钮点击时首参会是事件对象，这里统一兜住） */
    var datePrefill = /^\d{4}-\d{2}-\d{2}$/.test(String(presetDate || '')) ? String(presetDate) : todayStr;
    /* 分类预填：只接受合法分类名，避免把事件对象/脏值塞进选择器 */
    var catPrefill = (typeof presetCategory === 'string' &&
      DATA.CATEGORY_KEYS.indexOf(presetCategory) !== -1) ? presetCategory : '';
    var box = openModal('' +
      '<h4>记一笔</h4>' +
      '<p>金额和分类必填，备注可选。记完预算条会立刻更新。</p>' +
      '<label class="field"><span>金额（¥）</span><input id="qaAmount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" /></label>' +
      '<div class="field"><span>分类</span>' + catPickerHtml('qaCategory', catPrefill) + '</div>' +
      /* 「这笔属于」：给账单卡的情绪/想要标签一个真实来源，也是冷静期判定的依据 */
      '<div class="field"><span>这笔属于</span><div class="radio-group" data-act="qa-kind">' +
      '<label class="radio-item"><input type="radio" name="qaKind" value="need" checked /><span>需要</span></label>' +
      '<label class="radio-item"><input type="radio" name="qaKind" value="want" /><span>想要</span></label>' +
      '<label class="radio-item"><input type="radio" name="qaKind" value="mood" /><span>情绪消费</span></label>' +
      '</div></div>' +
      '<label class="field"><span>备注</span><input id="qaNote" type="text" placeholder="例如：黄焖鸡米饭" maxlength="30" /></label>' +
      '<label class="field"><span>日期</span><input id="qaDate" type="date" value="' + datePrefill + '" /></label>' +
      /* 想记收入却被弹窗困成支出的出口（复用 .btn-mini，不新增 CSS） */
      '<p>要记生活费/兼职收入？<button type="button" class="btn-mini" data-act="qa-to-income">记收入 →</button></p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-cancel" data-act="modal-cancel">取消</button>' +
      '<button type="button" class="btn-ok" data-act="quick-add-save">记好了</button>' +
      '</div>');
    bindCatPicker(box, 'qaCategory');

    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
    /* 想记收入的出口：关掉本弹窗、直接进「记一笔收入」表单 */
    box.querySelector('[data-act="qa-to-income"]').addEventListener('click', function () {
      closeModal();
      openIncomeModal();
    });
    box.querySelector('[data-act="quick-add-save"]').addEventListener('click', function () {
      var amount = Number(box.querySelector('#qaAmount').value);
      if (!isFinite(amount) || amount <= 0) {
        showToast('请先填写有效金额', 'warn');
        box.querySelector('#qaAmount').focus();
        return;
      }
      var category = box.querySelector('#qaCategory').value;
      var note = box.querySelector('#qaNote').value.trim();
      var date = box.querySelector('#qaDate').value || todayStr;
      /* 与聊天记账对齐：走同一套情绪/想要推断，再被用户的三选覆盖 */
      var motive = NLP.detectMotivation(note + ' ' + category);
      var picked = box.querySelector('input[name="qaKind"]:checked');
      var kind = picked ? picked.value : '';
      if (kind === 'want') { motive = { motivation: '刚需', want: true }; }
      if (kind === 'mood') { motive = { motivation: '情绪', want: true }; }
      if (kind === 'need') { motive = { motivation: '刚需', want: false }; }
      var draft = {
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayStr,
        amount: ENG.round2(amount),
        category: DATA.CATEGORY_KEYS.indexOf(category) !== -1 ? category : '其他',
        note: note || category,
        motivation: motive.motivation,
        want: motive.want,
        type: 'expense'
      };
      closeModal();
      switchView('chat');   /* 否则在记账本/看板页保存后看不到回执 */
      /* startFlow 会自动给出：冷静期拦截 + 账单卡 + 余额概览 + 理财专家一句话 */
      startFlow([draft]);
      showToast('已记下 ' + money(draft.amount), 'ok');
    });
    setTimeout(function () {
      var amountInput = box.querySelector('#qaAmount');
      if (amountInput) { amountInput.focus(); }
    }, 50);
  }

  /**
   * 修改某笔账单（账单卡片上的「修改」按钮）。
   * 原地更新：保留 id / type / createdAt / source / worth / imported / askedCycle，
   * 不走 startFlow、不触发冷静期、不碰 undoStack、不删除重建。
   */
  function openEditBillModal(id) {
    var b = findBill(id);
    if (!b) { return; }
    var isIncome = b.type === 'income';
    /* 收入账单没有分类/情绪标签，只改 金额/备注/日期 */
    var catField = isIncome ? '' :
      '<div class="field"><span>分类</span>' + catPickerHtml('edCategory', b.category) + '</div>';
    var kindField = isIncome ? '' :
      '<div class="field"><span>这笔属于</span><div class="radio-group">' +
      '<label class="radio-item"><input type="radio" name="edKind" value="need"' + (!b.want && b.motivation !== '情绪' ? ' checked' : '') + ' /><span>需要</span></label>' +
      '<label class="radio-item"><input type="radio" name="edKind" value="want"' + (b.want && b.motivation !== '情绪' ? ' checked' : '') + ' /><span>想要</span></label>' +
      '<label class="radio-item"><input type="radio" name="edKind" value="mood"' + (b.motivation === '情绪' ? ' checked' : '') + ' /><span>情绪消费</span></label>' +
      '</div></div>';
    var box = openModal('' +
      '<h4>修改这笔账</h4>' +
      '<p>改完这张卡片原地更新，不会新增账单。</p>' +
      '<label class="field"><span>金额（¥）</span><input id="edAmount" type="number" min="0.01" step="0.01" inputmode="decimal" value="' + b.amount + '" /></label>' +
      catField +
      kindField +
      '<label class="field"><span>备注</span><input id="edNote" type="text" value="' + esc(b.note) + '" maxlength="30" /></label>' +
      '<label class="field"><span>日期</span><input id="edDate" type="date" value="' + esc(b.date) + '" /></label>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-cancel" data-act="modal-cancel">取消</button>' +
      '<button type="button" class="btn-ok" data-act="edit-bill-save">保存修改</button>' +
      '</div>');
    if (!isIncome) { bindCatPicker(box, 'edCategory'); }

    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
    box.querySelector('[data-act="edit-bill-save"]').addEventListener('click', function () {
      var amount = Number(box.querySelector('#edAmount').value);
      if (!isFinite(amount) || amount <= 0) {
        showToast('请先填写有效金额', 'warn');
        box.querySelector('#edAmount').focus();
        return;
      }
      var note = box.querySelector('#edNote').value.trim();
      var noteChanged = note !== '' && note !== b.note;
      b.amount = ENG.round2(amount);
      if (note) { b.note = note; }
      var date = box.querySelector('#edDate').value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) { b.date = date; }
      if (!isIncome) {
        var category = box.querySelector('#edCategory').value;
        if (DATA.CATEGORY_KEYS.indexOf(category) !== -1) { b.category = category; }
        var picked = box.querySelector('input[name="edKind"]:checked');
        var kind = picked ? picked.value : '';
        if (kind === 'want') { b.motivation = '刚需'; b.want = true; }
        if (kind === 'mood') { b.motivation = '情绪'; b.want = true; }
        if (kind === 'need') { b.motivation = '刚需'; b.want = false; }
        /* 备注变了才重算商家，避免把原本识别出的商家洗掉 */
        if (noteChanged) { b.merchant = ENG.extractMerchant(note); }
      }
      saveState();
      closeModal();
      /* 只刷新这一张卡片（照抄 setBillWorth 的局部替换写法），不重绘整段聊天 */
      var cards = DOC.querySelectorAll('.bill-card');
      for (var k = 0; k < cards.length; k++) {
        if (cards[k].getAttribute('data-bill') === id) {
          var tmp = DOC.createElement('div');
          tmp.innerHTML = billCardHtml(b);
          var fresh = tmp.firstChild;
          if (fresh && fresh.nodeType === 1 && cards[k].parentNode) {
            cards[k].parentNode.replaceChild(fresh, cards[k]);
          }
          break;
        }
      }
      renderAll();
      addAIMessage(aiBubble('改好了 ✏️ ' + esc(b.note) + ' → ' + money(b.amount) +
        (isIncome ? '' : '（' + esc(b.category) + '）')));
      showToast('已修改', 'ok');
    });
    setTimeout(function () {
      var amountInput = box.querySelector('#edAmount');
      if (amountInput) { amountInput.focus(); amountInput.select(); }
    }, 50);
  }

  /** 点击常驻预算条 → 切到看板并高亮「预算焦点卡」 */
  function focusBudgetCard() {
    switchView('dash');
    var card = DOC.querySelector('#panelDash .card-budget');
    if (!card) { return; }
    card.classList.remove('flash');
    void card.offsetWidth; /* 重置 CSS 动画 */
    card.classList.add('flash');
    if (typeof card.scrollIntoView === 'function') {
      try {
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (e) {
        card.scrollIntoView();
      }
    }
  }

  function openGoalModal() {
    var todayStr = ENG.formatDate(new Date());
    var box = openModal('' +
      '<h4>新的理财目标</h4>' +
      '<p>给它一个名字，设定金额和日期，我帮你算每月该存多少。</p>' +
      '<label class="field"><span>目标名称</span><input id="gName" type="text" placeholder="例如：相机 / 旅行 / iPad" /></label>' +
      '<label class="field"><span>目标金额（¥）</span><input id="gTarget" type="number" min="1" step="10" inputmode="decimal" /></label>' +
      '<label class="field"><span>已攒金额（¥）</span><input id="gSaved" type="number" min="0" step="10" inputmode="decimal" value="0" /></label>' +
      '<label class="field"><span>目标日期</span><input id="gDeadline" type="date" min="' + todayStr + '" value="' + todayStr + '" /></label>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-cancel" data-act="modal-cancel">取消</button>' +
      '<button type="button" class="btn-ok" data-act="goal-save">保存</button>' +
      '</div>');

    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
    box.querySelector('[data-act="goal-save"]').addEventListener('click', function () {
      var name = box.querySelector('#gName').value.trim();
      var target = Number(box.querySelector('#gTarget').value);
      var saved = Number(box.querySelector('#gSaved').value);
      var deadline = box.querySelector('#gDeadline').value;
      if (!name) {
        box.querySelector('#gName').focus();
        return;
      }
      if (!isFinite(target) || target <= 0) {
        box.querySelector('#gTarget').focus();
        return;
      }
      state.goals.push({
        id: uid('goal'),
        name: name,
        target: ENG.round2(target),
        saved: isFinite(saved) && saved > 0 ? ENG.round2(saved) : 0,
        deadline: /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : ''
      });
      saveState();
      closeModal();
      renderGoals();
      addAIMessage(aiBubble('目标「' + esc(name) + '」已建好，目标 ' + money(target) + '。我会在每个记账日帮你盯着进度。'));
    });
    var nameInput = box.querySelector('#gName');
    if (nameInput) { nameInput.focus(); }
  }

  function openDepositModal(goalId) {
    var goal = findGoal(goalId);
    if (!goal) { return; }
    var need = ENG.round2(Math.max(0, goal.target - goal.saved));
    var box = openModal('' +
      '<h4>给「' + esc(goal.name) + '」存一笔</h4>' +
      '<p>还差 ' + money(need) + ' 就能达成目标。</p>' +
      '<label class="field"><span>本次存入金额（¥）</span><input id="dAmount" type="number" min="1" step="10" inputmode="decimal" /></label>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-cancel" data-act="modal-cancel">取消</button>' +
      '<button type="button" class="btn-ok" data-act="deposit-save">存入</button>' +
      '</div>');

    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
    box.querySelector('[data-act="deposit-save"]').addEventListener('click', function () {
      var amount = Number(box.querySelector('#dAmount').value);
      if (!isFinite(amount) || amount <= 0) {
        box.querySelector('#dAmount').focus();
        return;
      }
      goal.saved = ENG.round2(goal.saved + amount);
      saveState();
      /* 阿账事件源⑤：目标存款也触发 save（PRD §2.1「储蓄目标 saved 增加」，onEvent 幂等） */
      MOOD.onEvent('piggy_in');
      var left = ENG.round2(Math.max(0, goal.target - goal.saved));
      petReact(left <= 0 ? 'goal_done' : 'goal_in', { amount: amount, goalSaved: goal.saved });
      closeModal();
      renderGoals();
      addAIMessage(aiBubble('已存入 ' + money(amount) + '，目标「' + esc(goal.name) + '」现在攒到 ' +
        money(goal.saved) + '，' + (left > 0 ? '还差 ' + money(left) + '。' : '已经达成啦')));
    });
    var input = box.querySelector('#dAmount');
    if (input) { input.focus(); }
  }

  function confirmReset() {
    var box = openModal('' +
      '<h4>重置演示数据？</h4>' +
      '<p>会清空当前所有账单、目标与成就，并重新灌入一套演示数据。此操作不可撤销。</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-cancel" data-act="modal-cancel">取消</button>' +
      '<button type="button" class="btn-danger" data-act="reset-ok">确认重置</button>' +
      '</div>');
    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
    box.querySelector('[data-act="reset-ok"]').addEventListener('click', function () {
      state = seedState();
      highlightCategory = null;
      undoStack = [];
      saveState();
      /* 存钱罐跟着一起清空：否则重置后账面余额仍被罐子占着，用户会以为没重置干净。
         只清罐子自己的键，不动其它任何存储。 */
      PIGGY.reset();
      piggyCheer = null;
      piggyError = '';
      /* 心愿单同理：重置后旧清单会指向一套已经不存在的账，一并清空；
         只清自己的键（ai_jizhang_wishlist_v1），不碰主账本。 */
      if (WISH && !WISH.missing) { WISH.reset(); }
      wishTab = 'cooling';
      /* 消费性格测试同理：报告里的证据数字来自旧账，重置后已失真，
         清掉自己的键（ai_jizhang_persona_v1）回到「未开始」状态。 */
      personaRecord = null;
      personaLoaded = true;
      try { global.localStorage.removeItem(PERSONA_KEY); } catch (eP) { /* 隐私模式下忽略 */ }
      closeModal();
      renderAll();
      addAIMessage(aiBubble('演示数据已经重置好了，账单、目标、成就都回到了初始状态。'));
    });
  }

  /* ================================================================== */
  /* 设置抽屉                                                            */
  /* ================================================================== */

  function openDrawer() {
    $('setTotal').value = String(state.budget.total);
    $('setPayday').value = String(state.budget.payday);
    $('setCooldown').value = String(state.budget.cooldownThreshold);
    renderCycleInfo();
    var cred = OCR.getCredentials();
    $('setOcrId').value = cred.secretId || '';
    $('setOcrKey').value = cred.secretKey || '';
    $('setOcrRegion').value = cred.region || 'ap-guangzhou';
    renderOcrState();
    var mask = $('drawerMask');
    mask.hidden = false;
    setTimeout(function () {
      mask.classList.add('show');
      $('settingsDrawer').classList.add('open');
      $('settingsDrawer').setAttribute('aria-hidden', 'false');
    }, 10);
  }

  /** 设置抽屉顶部的周期说明 */
  function renderCycleInfo() {
    var ov = getOverview();
    var el = $('cycleInfo');
    if (el) {
      el.textContent = '本周期：' + ov.cycle.start + ' ~ ' + ov.cycle.end +
        (ov.cycle.isCustom ? '（自定义起点）' : '（按发钱日 ' + state.budget.payday + ' 号）');
    }
    var resetBtn = $('btnCycleReset');
    if (resetBtn) {
      if (ov.cycle.isCustom) {
        resetBtn.removeAttribute('hidden');
      } else {
        resetBtn.setAttribute('hidden', 'hidden');
      }
    }
  }

  /** 云 OCR 凭据状态文案 */
  function renderOcrState() {
    var el = $('ocrState');
    if (!el) { return; }
    var cap = OCR.capabilities();
    el.textContent = cap.cloud
      ? '当前：已配置云 OCR（' + (OCR.getCredentials().region || 'ap-guangzhou') + '）'
      : '当前：未配置云 OCR（不会发网络请求）。不配置时，截屏识别只能用示例小票或手动录入。';
  }

  function saveOcrCredentials() {
    var id = String($('setOcrId').value || '').trim();
    var key = String($('setOcrKey').value || '').trim();
    var region = String($('setOcrRegion').value || '').trim() || 'ap-guangzhou';
    if (!id || !key) {
      $('ocrState').textContent = 'SecretId 与 SecretKey 都要填，否则云端识别不可用。';
      return;
    }
    var ok = OCR.saveCredentials({ secretId: id, secretKey: key, region: region });
    renderOcrState();
    if (!ok) {
      $('ocrState').textContent = '已存在内存里，但写入 localStorage 失败（可能是隐私模式），关掉页面就失效。';
    }
  }

  function clearOcrCredentials() {
    OCR.clearCredentials();
    $('setOcrId').value = '';
    $('setOcrKey').value = '';
    $('setOcrRegion').value = '';
    renderOcrState();
  }

  function closeDrawer() {
    var mask = $('drawerMask');
    mask.classList.remove('show');
    $('settingsDrawer').classList.remove('open');
    $('settingsDrawer').setAttribute('aria-hidden', 'true');
    setTimeout(function () { mask.hidden = true; }, 220);
  }

  function saveSettings() {
    var total = Number($('setTotal').value);
    var payday = Number($('setPayday').value);
    var cooldown = Number($('setCooldown').value);
    state.budget.total = clampNumber(total, 0, 9999999, state.budget.total);
    state.budget.payday = Math.round(clampNumber(payday, 1, 28, state.budget.payday));
    state.budget.cooldownThreshold = clampNumber(cooldown, 0, 9999999, state.budget.cooldownThreshold);
    saveState();
    closeDrawer();
    renderAll();
    var ov = getOverview();
    addAIMessage(aiBubble('设置已更新：生活费 ' + money(state.budget.total) + '，发钱日 ' +
      state.budget.payday + ' 号，冷静期阈值 ' + money(state.budget.cooldownThreshold) +
      '。当前周期 ' + esc(ov.cycle.start) + ' ~ ' + esc(ov.cycle.end) +
      (ov.cycle.isCustom ? '（自定义起点）' : '') + '，看板已重算。'));
    showToast('设置已保存，预算已重算', 'ok');
  }

  /* ================================================================== */
  /* 完整设置界面（setPage* / setGroup*，与预算抽屉相互独立）             */
  /* ================================================================== */

  /** 可选头像（emoji，演示用） */
  var PROFILE_AVATARS = ['🙂', '😎', '🐶', '🐱', '🐰', '🦊', '🐼', '🦉', '🌟', '💰'];
  /** 字体大小档位 -> body 上的 class（样式在 styles.css） */
  var FONT_SCALE_CLASS = { sm: 'font-scale-sm', md: '', lg: 'font-scale-lg', xl: 'font-scale-xl' };
  /** 应用版本号（关于页展示 & 检查更新提示） */
  var APP_VERSION = 'v1.0.0';
  /** 反馈本地存储 key */
  var FEEDBACK_KEY = 'ledger.feedback';

  /* 系统深色偏好监听（深色模式选「跟随系统」时用） */
  var themeMediaQuery = null;
  try {
    themeMediaQuery = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;
  } catch (e) {
    themeMediaQuery = null;
  }

  /** 取当前设置（带默认值兜底，旧存档没有 settings 也能用） */
  function getSettings() {
    if (!state || typeof state !== 'object') { return normalizeSettings(null); }
    if (!state.settings || typeof state.settings !== 'object') {
      state.settings = normalizeSettings(null);
    }
    return state.settings;
  }

  /** 归一化设置、持久化、应用外观并刷新设置页 */
  function persistSettings() {
    state.settings = normalizeSettings(state.settings);
    saveState();
    applyAppearance();
    renderSettingsPage();
  }

  /** 当前生效的主题：system 时跟随系统偏好 */
  function resolveTheme() {
    var mode = getSettings().theme;
    if (mode === 'dark') { return 'dark'; }
    if (mode === 'light') { return 'light'; }
    if (themeMediaQuery && typeof themeMediaQuery.matches === 'boolean') {
      return themeMediaQuery.matches ? 'dark' : 'light';
    }
    return 'light';
  }

  /** 把主题与字体档位应用到 <html data-theme> / body class 上 */
  function applyAppearance() {
    var root = DOC.documentElement;
    if (root) { root.setAttribute('data-theme', resolveTheme()); }
    var body = DOC.body;
    if (!body) { return; }
    body.classList.remove('font-scale-sm', 'font-scale-lg', 'font-scale-xl');
    var cls = FONT_SCALE_CLASS[getSettings().fontScale];
    if (cls) { body.classList.add(cls); }
  }

  /** 取当前 UI 类型（简洁版 / 完整版），缺省回退到完整版 */
  function getUiMode() {
    return (state && state.uiMode === 'simple') ? 'simple' : 'full';
  }

  /** 把 UI 类型应用到 <body data-ui-mode>，并在两套界面间切换到合法默认视图 */
  function applyUiMode() {
    var mode = getUiMode();
    DOC.body.setAttribute('data-ui-mode', mode);
    mountShellPanels();
    var v = DOC.body.getAttribute('data-view');
    var ok = (mode === 'simple') ? SIMPLE_VIEWS[v] : FULL_VIEWS[v];
    if (!ok) { switchView(mode === 'simple' ? 'shome' : 'chat'); }
    renderSimple();
  }

  /** 双 UI 挂载：简洁版把聊天面板、专家面板、省钱面板、目标卡移进简洁外壳
   *  （分别作为 AI 对话记账 / 理财专家 / 省钱 / 攒钱目标四屏）；完整版移回双栏布局原位与弹层里。
   *  节点移动不破坏其内部事件绑定与按 ID 的渲染。 */
  function mountShellPanels() {
    var simple = (getUiMode() === 'simple');
    var chat = $('panelChat');
    var coach = $('panelCoach');
    var goal = $('goalCard');
    var shell = $('simpleShell');
    var layout = $('panelDash') && $('panelDash').parentNode;
    var dashScroll = $('panelDash') && $('panelDash').querySelector('.dash-scroll');
    var goalsBody = $('spGoalsBody');
    var saveSheet = $('saveHubSheet');
    var saveBody = $('spSaveBody');
    var saveMask = $('saveHubMask');
    if (simple && shell) {
      if (chat && chat.parentNode !== shell) { shell.insertBefore(chat, $('tabbarSimple')); }
      if (coach && coach.parentNode !== shell) { shell.insertBefore(coach, $('tabbarSimple')); }
      if (goal && goalsBody && goal.parentNode !== goalsBody) { goalsBody.appendChild(goal); }
      /* 省钱面板：简洁版是独立页面，整块搬进 #spSaveBody（不再是弹层）。
         搬走后遮罩里就没有内容，必须强制收起，否则会留下空遮罩盖住页面。 */
      if (saveSheet && saveBody) {
        if (saveSheet.parentNode !== saveBody) { saveBody.appendChild(saveSheet); }
        /* 作为普通区块时它不是模态对话框，避免读屏软件报「模态」 */
        saveSheet.setAttribute('aria-modal', 'false');
        if (saveMask) { saveMask.hidden = true; }
      }
    } else if (layout) {
      if (chat && chat.parentNode !== layout) { layout.insertBefore(chat, $('panelDash')); }
      if (coach && coach.parentNode !== layout) { layout.appendChild(coach); }
      if (goal && dashScroll && goal.parentNode !== dashScroll) { dashScroll.appendChild(goal); }
      /* 完整版：省钱面板回到遮罩里，恢复弹层语义 */
      if (saveSheet) {
        if (saveMask && saveSheet.parentNode !== saveMask) { saveMask.appendChild(saveSheet); }
        saveSheet.setAttribute('aria-modal', 'true');
      }
    }
  }

  /** 切换 UI 类型并持久化（共用同一套账单数据，切换不丢数据） */
  function setUiMode(mode) {
    if (mode !== 'simple' && mode !== 'full') { return; }
    if (!state) { return; }
    state.uiMode = mode;
    // 两套界面的视图互不通用，清空历史避免「返回」落到另一套界面的视图上
    viewHistory.length = 0;
    saveState();
    applyUiMode();
    showToast(mode === 'simple' ? '已切换到简洁版（日常型）' : '已切换到完整版（报表型）', 'ok');
  }

  /** 系统深色偏好变化时，若设置为「跟随系统」则实时切换 */
  function onSystemThemeChange() {
    if (getSettings().theme === 'system') { applyAppearance(); }
  }

  function openSettingsPage() {
    renderSettingsPage();
    $('settingsMask').hidden = false;
  }

  function closeSettingsPage() {
    $('settingsMask').hidden = true;
  }

  /** 单选组（radio）按值勾选 */
  function checkRadioGroup(name, value) {
    var inputs = DOC.querySelectorAll('input[name="' + name + '"]');
    var i;
    for (i = 0; i < inputs.length; i++) {
      inputs[i].checked = (inputs[i].value === value);
    }
  }

  /** 按当前 state.settings 刷新设置页各控件的显示值 */
  function renderSettingsPage() {
    var st = getSettings();
    $('setProfileValue').textContent = st.profile.nickname;
    $('setProfileDesc').textContent = '当前头像 ' + st.profile.avatar + ' · 点击修改';
    $('setSwitchPush').checked = st.notify.push;
    $('setSwitchRemind').checked = st.notify.remind;
    $('setSwitchOverspend').checked = st.notify.overspend;
    var pokeSwitch = $('setSwitchPoke');
    if (pokeSwitch) { pokeSwitch.checked = !(st.mascot && st.mascot.poke === false); }
    var petSwitch = $('setSwitchPet');
    if (petSwitch) { petSwitch.checked = !(st.mascot && st.mascot.pet === false); }
    /* ---- 宠物形象（阿账 / 存钱罐精灵 / 记账小管家）与互动反馈开关 ---- */
    checkRadioGroup('setPetSkin', petSkin());
    /* 「自定义我的形象」入口常驻，不再按 skin 显隐 —— 用户选了阿账 / 精灵时
       在设置里看不到这一行，会以为根本没做自定义萌宠（实测反馈）。
       点击时由 bindSettingsEvents 自动切到 pro 再开面板，所以常驻是安全的。 */
    var fxSwitch = $('setSwitchFx');
    if (fxSwitch) { fxSwitch.checked = (st.fx !== false); }
    checkRadioGroup('setThemeMode', st.theme);
    checkRadioGroup('setFontScale', st.fontScale);
    checkRadioGroup('setLang', st.lang);
    checkRadioGroup('setUiMode', state.uiMode);
    $('setSwitchAlbum').checked = st.privacy.album;
    $('setSwitchClipboard').checked = st.privacy.clipboard;
    $('setCacheValue').textContent = estimateCacheSize();
    /* ---- 说话风格：3 张卡片按当前 tone 勾选（卡片本身由 HTML 静态渲染） ---- */
    checkRadioGroup('setTone', TONE.normalize(st.tone));
    /* ---- 单日支出上限：0 = 关闭「单日超支」诊断规则 ---- */
    var capInput = $('setDailyCap');
    if (capInput) { capInput.value = String(Math.round(Number(st.dailyCap) || 0)); }
    /* ---- 语气卡：高亮当前项 + 用 tone.js 现取一句试听（文案只维护一份） ---- */
    var toneCards = DOC.querySelectorAll('.set-tone-card');
    var curTone = TONE.normalize(st.tone);
    for (var ti = 0; ti < toneCards.length; ti++) {
      var toneInput = toneCards[ti].querySelector('input[name="setTone"]');
      var toneKey = toneInput ? toneInput.value : '';
      toneCards[ti].classList.toggle('active', toneKey === curTone);
      var sampleEl = toneCards[ti].querySelector('.stc-sample');
      if (sampleEl && toneKey && !TONE.missing) {
        var keepTone = TONE.get();
        TONE.set(toneKey);
        sampleEl.textContent = TONE.t('cool.added', { title: '降噪耳机' });
        TONE.set(keepTone);
      }
    }
  }

  /** 设置页所有事件绑定（在 bindEvents 里调用一次） */
  function bindSettingsEvents() {
    $('btnCloseSetPage').addEventListener('click', closeSettingsPage);
    $('settingsMask').addEventListener('click', function (e) {
      if (e.target === $('settingsMask')) { closeSettingsPage(); }
    });

    /* ---- 账号与安全 ---- */
    $('rowSetProfile').addEventListener('click', openProfileModal);
    $('rowSetBind').addEventListener('click', function () {
      showToast('演示版本暂不支持真实绑定');
    });
    $('rowSetPassword').addEventListener('click', function () {
      showToast('演示版本暂不支持修改密码');
    });

    /* ---- 通用与偏好：三个通知开关 ---- */
    $('setSwitchPush').addEventListener('change', function () {
      getSettings().notify.push = this.checked;
      persistSettings();
    });
    $('setSwitchRemind').addEventListener('change', function () {
      getSettings().notify.remind = this.checked;
      persistSettings();
    });
    $('setSwitchOverspend').addEventListener('change', function () {
      getSettings().notify.overspend = this.checked;
      persistSettings();
    });
    /* ---- 阿账戳一戳开关：关闭后头像点击静默（mascot-bar 文案照常，它是 mood 呈现） ---- */
    var pokeSwitch = $('setSwitchPoke');
    if (pokeSwitch) {
      pokeSwitch.addEventListener('change', function () {
        getSettings().mascot = getSettings().mascot || {};
        getSettings().mascot.poke = this.checked;
        persistSettings();
      });
    }
    /* ---- 阿账浮层桌面宠物开关：控制右下角可拖宠物是否显示 ---- */
    var petSwitch = $('setSwitchPet');
    if (petSwitch) {
      petSwitch.addEventListener('change', function () {
        getSettings().mascot = getSettings().mascot || {};
        getSettings().mascot.pet = this.checked;
        persistSettings();
        setupFloatingPet();
        applyPetVisibility();
      });
    }

    /* ---- 宠物形象：阿账 → 存钱罐精灵 → 记账小管家（三者互斥，切换即换角） ---- */
    var skinRadios = DOC.querySelectorAll('input[name="setPetSkin"]');
    for (var sk = 0; sk < skinRadios.length; sk++) {
      skinRadios[sk].addEventListener('change', function () {
        if (!this.checked) { return; }
        switchPetSkin(this.value);
      });
    }

    /* ---- 自定义形象：入口常驻，任何形象下都能点 ----
       点之前先确保切到记账小管家：工坊编辑的是 petpro 自己的 profile，
       别的形象下那份 DOM 连挂都没挂，直接开面板等于改一个看不见的东西。 */
    var studioRow = $('rowPetStudio');
    if (studioRow) {
      studioRow.addEventListener('click', function () {
        var pp = global.AJ && global.AJ.petPro;
        if (!pp || typeof pp.openStudio !== 'function') {
          showToast('形象工坊没加载出来，刷新页面试试', 'warn');
          return;
        }
        /* 桌面宠物总开关关着时，切过去也看不见 —— 说清楚，别让人点完一脸问号。
           这种情况下把 switchPetSkin 自带的「已换成 X」静音，只留这一条，
           否则两条 toast 叠在一起反而吵。 */
        var visible = petEnabled();
        var needSwitch = petSkin() !== 'pro';
        if (needSwitch) { switchPetSkin('pro', { quiet: !visible }); }
        var open = function () {
          if (typeof pp.openStudio === 'function') { pp.openStudio(); }
        };
        /* switchPetSkin 里的 applyPetVisibility() 是同步挂 DOM 的，
           但 build() 之后要等一帧才有布局；60ms 足够，用户也感知不到 */
        if (needSwitch) { global.setTimeout(open, 60); } else { open(); }
        if (!visible) {
          showToast('已切到记账小管家，请在「桌面宠物」里打开显示', 'warn');
        }
      });
    }

    /* ---- 互动反馈：音效 + 震动（两个宠物形象共用） ---- */
    var fxSwitch = $('setSwitchFx');
    if (fxSwitch) {
      fxSwitch.addEventListener('change', function () {
        getSettings().fx = this.checked;
        persistSettings();
        syncPetFx();
        if (this.checked) { petSfx('income'); }   // 打开时试听一声
      });
    }

    /* ---- 深色模式 / 字体大小 / 语言：分段单选（change 会冒泡） ---- */
    $('setThemeSeg').addEventListener('change', function (e) {
      var input = (e.target && e.target.closest) ? e.target.closest('input[name="setThemeMode"]') : null;
      if (!input) { return; }
      getSettings().theme = input.value;
      persistSettings();
      showToast(input.value === 'dark' ? '已切换到深色模式'
        : (input.value === 'light' ? '已切换到浅色模式' : '深色模式：跟随系统'));
    });
    $('setFontSeg').addEventListener('change', function (e) {
      var input = (e.target && e.target.closest) ? e.target.closest('input[name="setFontScale"]') : null;
      if (!input) { return; }
      getSettings().fontScale = input.value;
      persistSettings();
      showToast('字体大小已切换');
    });
    $('setLangSeg').addEventListener('change', function (e) {
      var input = (e.target && e.target.closest) ? e.target.closest('input[name="setLang"]') : null;
      if (!input) { return; }
      getSettings().lang = input.value;
      persistSettings();
      if (input.value === 'en') { showToast('演示版本暂仅支持简体中文'); }
    });
    $('setUiModeSeg').addEventListener('change', function (e) {
      var input = (e.target && e.target.closest) ? e.target.closest('input[name="setUiMode"]') : null;
      if (!input) { return; }
      setUiMode(input.value);
    });

    /* ---- 说话风格：三张卡片单选（change 会冒泡，委托到容器上） ---- */
    var toneGroup = $('setToneGroup');
    if (toneGroup) {
      toneGroup.addEventListener('change', function (e) {
        var input = (e.target && e.target.closest) ? e.target.closest('input[name="setTone"]') : null;
        if (!input) { return; }
        getSettings().tone = TONE.normalize(input.value);
        persistSettings();
        renderAll();
        showToast('说话风格已切换');
      });
    }

    /* ---- 单日支出上限：诊断卡规则①的旋钮，0 = 关闭该规则 ---- */
    var capInput = $('setDailyCap');
    if (capInput) {
      capInput.addEventListener('change', function () {
        var v = clampNumber(this.value, 0, 99999, 60);
        getSettings().dailyCap = v;
        this.value = String(Math.round(v));
        persistSettings();
        renderAll();
        showToast(v > 0 ? ('单日上限已设为 ' + money(v)) : '已关闭单日超支提醒');
      });
    }

    /* ---- 数据与隐私 ---- */
    $('rowSetCache').addEventListener('click', clearAppCache);
    $('setSwitchAlbum').addEventListener('change', function () {
      getSettings().privacy.album = this.checked;
      persistSettings();
      showToast(this.checked ? '已允许读取相册' : '已关闭读取相册，截屏记账将不可用');
    });
    $('setSwitchClipboard').addEventListener('change', function () {
      getSettings().privacy.clipboard = this.checked;
      persistSettings();
    });
    $('rowSetTerms').addEventListener('click', openTermsModal);
    $('rowSetExport').addEventListener('click', exportPersonalInfo);
    $('rowSetDeleteAccount').addEventListener('click', confirmDeleteAccount);

    /* ---- 帮助与反馈 / 关于 ---- */
    $('setFaqList').addEventListener('click', function (e) {
      var row = (e.target && e.target.closest) ? e.target.closest('[data-faq]') : null;
      if (!row) { return; }
      openFaqModal(row.getAttribute('data-faq'));
    });
    $('btnSetFeedback').addEventListener('click', submitSettingsFeedback);
    $('btnSetCheckUpdate').addEventListener('click', function () {
      showToast('已是最新版本（演示）· ' + APP_VERSION);
    });

    /* 系统深色偏好变化（兼容旧版 Safari 的 addListener） */
    if (themeMediaQuery) {
      if (typeof themeMediaQuery.addEventListener === 'function') {
        themeMediaQuery.addEventListener('change', onSystemThemeChange);
      } else if (typeof themeMediaQuery.addListener === 'function') {
        themeMediaQuery.addListener(onSystemThemeChange);
      }
    }
  }

  /** 头像与昵称编辑弹层 */
  function openProfileModal() {
    var st = getSettings();
    var avatars = PROFILE_AVATARS.map(function (a) {
      return '<button type="button" class="avatar-pick' + (a === st.profile.avatar ? ' active' : '') +
        '" data-avatar="' + a + '" aria-label="选择头像">' + a + '</button>';
    }).join('');
    var box = openModal('' +
      '<h4>头像与昵称</h4>' +
      '<p>选一个喜欢的头像，再取个昵称。</p>' +
      '<div class="avatar-picker" id="avatarPicker">' + avatars + '</div>' +
      '<label class="field"><span>昵称（最多 12 个字）</span>' +
      '<input id="setNickInput" type="text" maxlength="12" value="' + esc(st.profile.nickname) + '" /></label>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-cancel" data-act="modal-cancel">取消</button>' +
      '<button type="button" class="btn-ok" data-act="profile-save">保存</button>' +
      '</div>');
    var picked = st.profile.avatar;
    box.querySelector('#avatarPicker').addEventListener('click', function (e) {
      var btn = (e.target && e.target.closest) ? e.target.closest('[data-avatar]') : null;
      if (!btn) { return; }
      picked = btn.getAttribute('data-avatar');
      var all = box.querySelectorAll('.avatar-pick');
      var i;
      for (i = 0; i < all.length; i++) { all[i].classList.remove('active'); }
      btn.classList.add('active');
    });
    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
    box.querySelector('[data-act="profile-save"]').addEventListener('click', function () {
      var name = String(box.querySelector('#setNickInput').value || '').trim();
      if (!name) {
        box.querySelector('#setNickInput').focus();
        showToast('昵称不能为空');
        return;
      }
      st.profile.nickname = name.slice(0, 12);
      st.profile.avatar = picked;
      persistSettings();
      closeModal();
      showToast('资料已更新');
    });
    var input = box.querySelector('#setNickInput');
    if (input) { input.focus(); }
  }

  /** 用户协议与隐私政策（演示占位文本） */
  function openTermsModal() {
    openModal('' +
      '<h4>用户协议与隐私政策</h4>' +
      '<p>【演示占位文本】本应用为「AI 记账 · 创新应用大赛」参赛作品，仅用于功能演示。</p>' +
      '<p>1. 所有账单、目标与设置数据仅保存在你的浏览器 localStorage 中，不上传服务器。</p>' +
      '<p>2. 截屏识别功能会将图片发送至第三方云服务做文字识别，请勿上传含敏感信息的图片。</p>' +
      '<p>3. AI 给出的记账建议仅供参考，不构成专业理财或投资建议。</p>' +
      '<p>4. 正式版本的协议与隐私政策以线上页面为准。</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-ok" data-act="modal-cancel">我知道了</button>' +
      '</div>');
  }

  /* ================================================================== */
  /* 帮助与反馈：FAQ 详情弹窗                                              */
  /* ================================================================== */

  /**
   * FAQ 内容。每条 = 一句话结论 + 若干分节（步骤 / 清单 / 说明），
   * 与理财学院知识卡共用 .am-* 排版；答案写「怎么做」而不是「有这功能」。
   */
  var FAQ_DOCS = [
    {
      id: 'start',
      icon: 'spark',
      q: '新手怎么用？',
      tag: '上手',
      intro: '三种记账方式，按你手上有的东西选一种就行：说一句话、截个图、或者把整月账单导进来。',
      detail: [
        { h: '方式一：说一句话（最快）', steps: [
          '点底部输入框，直接打「中午食堂 15」「打车 23」，事由和金额一句话说完；',
          '商家名会被识别成分类：食堂 / 外卖 → 餐饮，地铁 / 打车 → 交通，打印 / 教材 → 学习；',
          '记错了点聊天顶部的「↩ 撤回上一步」，那笔会从账本里彻底移除。'
        ] },
        { h: '方式二：截屏记账', steps: [
          '点顶部相机图标，选图 / 拖进来 / 直接 Ctrl+V 粘贴；',
          '识别结果先给你确认，金额、分类、日期都能改；',
          '确认后才写入账本——识别错了不会直接污染数据。'
        ] },
        { h: '方式三：导入整月账单', p: '点顶部「导入账单」，支持微信 / 支付宝导出的 CSV 与 .xlsx。具体导出路径见下一条 FAQ。' },
        { h: '第一次用，建议先做这三件事', list: [
          '在「设置 · 预算」把总预算填成本期生活费，否则「日均可用」没有意义；',
          '确认发钱日（默认 1 号）——周期从这天起算，改它会影响所有统计；',
          '先记满 3 天再看板：只有 1-2 笔时图表基本是空的，容易误判成「没生效」。'
        ] },
        { h: '遇到问题先看这两点', list: [
          '记不上：检查金额是不是纯数字，别带「元」「块」以外的符号；',
          '看不到图表：空账本不画图，先记一笔再回看板。'
        ] }
      ]
    },
    {
      id: 'edit',
      icon: 'pencil',
      q: '怎么修改 / 删除账单？',
      tag: '数据',
      intro: '目前支持「撤回最近一笔」，不支持逐笔改金额——这是演示版本有意做的简化。',
      detail: [
        { h: '撤销误记', steps: [
          '在聊天页顶部点「↩ 撤回上一步」；',
          '每次撤掉最近的一笔，连点可以连续往回撤；',
          '撤回是彻底移除，不是标记删除，撤完那笔不会再出现在任何统计里。'
        ] },
        { h: '想改某一笔的具体做法', steps: [
          '如果是刚记错的：先撤回，再用正确金额重记一次；',
          '如果是很早以前的：直接补记一笔正确金额，把错的那笔留在账本里当记录（本版本不支持定点删除）；',
          '想彻底重来：设置 →「清空缓存」不会动账本，需要用「注销账号」清空全部数据——务必先导出。'
        ] },
        { h: '在哪里核对已有记录', list: [
          '完整版：看板「本月账单流水」，可按分类 / 关键词筛；',
          '简洁版：「明细」屏按月查看；',
          '账单分析：能看分类占比、Top10 大额、高频商户。'
        ] },
        { h: '为什么不做逐笔编辑', p: '逐笔编辑会牵动预算、诊断、图表三处口径，演示版本优先保证「记一笔」和「看趋势」两条主链路稳定。' +
          '真需要精细管理时，建议导出 CSV 在表格里改，再导入回来。' }
      ]
    },
    {
      id: 'import',
      icon: 'download',
      q: '怎么导入微信 / 支付宝账单？',
      tag: '导入',
      intro: '先从微信 / 支付宝把账单导出成 CSV，再回到应用里导入；导入前可以预览和按月份筛选。',
      detail: [
        { h: '第一步：导出原始账单', steps: [
          '微信：「我 · 服务 · 钱包 · 账单 · 常见问题 · 下载账单」，选「用于个人对账」，账单会发到邮箱（CSV，压缩包需解压）；',
          '支付宝：「我的 · 账单 · 右上角「…」· 开具交易流水证明」，选时间范围，同样发到邮箱；',
          '菜单名会随版本变化，找不到就在 App 内搜「账单 下载」。'
        ] },
        { h: '第二步：导入', steps: [
          '点顶部「导入账单」（或设置里的导入入口）；',
          '选 CSV 或 .xlsx；PDF 和老版 .xls 请先用 Excel 另存为 .xlsx 或 CSV；',
          '支持多选文件，导入前会先解析并预览，可以按月份筛选、剔除不需要的行；',
          '点确认后才写入账本——预览阶段随时可以退出，不会留下脏数据。'
        ] },
        { h: '重复导入会怎样', p: '应用不会自动去重：同一份账单导两次，就会有两份记录。' +
          '建议导入前在预览里按月份筛掉已经导入过的区间。' },
        { h: '导入失败的常见原因', list: [
          '编码不对：用 Excel「另存为 → CSV UTF-8」，否则中文会乱码；',
          '表头被删：第一行需要是列名（时间 / 金额 / 商户…）；',
          '金额列带符号：预览里会显示解析结果，带「¥」「,」的行可能需要手工修正。'
        ] }
      ]
    },
    {
      id: 'undo',
      icon: 'check',
      q: '「撤回」和「值不值」是什么？',
      tag: '概念',
      intro: '一个是删掉记错的账，一个是给花出去的钱打「事后评价」，两个功能各管一头。',
      detail: [
        { h: '撤回：删掉记错的那笔', list: [
          '入口在聊天页顶部「↩ 撤回上一步」；',
          '只作用于最近一笔，撤完即从账本和所有统计里消失；',
          '预算是实时的，撤回后「剩余 / 日均可用」会立刻回涨。'
        ] },
        { h: '值不值：给支出打个自评', steps: [
          '每笔记完后，气泡里会出现「值 / 一般 / 不值」三个小按钮；',
          '点一下打标，再点同一项可以取消；',
          '统计结果在「账单分析 · 值不值自评」里，会算出「不值」的笔数和金额占比。'
        ] },
        { h: '这个标签有什么用', p: '它回答的是「钱花得开不开心」，而不是「花得多不多」。' +
          '连续几周「不值」占比高，说明问题不在预算太少，而在下单太快——这时候该用的是「剁手冷静法」。' },
        { h: '两个功能的关系', p: '撤回管「记错了」，值不值管「花错了」。前者修数据，后者修习惯。' }
      ]
    }
  ];

  /** FAQ 详情弹窗：与看板详情弹窗共用 .doc-* 骨架 */
  function openFaqModal(id) {
    var doc = null;
    for (var i = 0; i < FAQ_DOCS.length; i++) {
      if (FAQ_DOCS[i].id === id) { doc = FAQ_DOCS[i]; break; }
    }
    if (!doc) { return; }
    var box = openModal(docModalHtml({
      icon: ic(doc.icon, null, null),
      title: doc.q,
      tag: doc.tag,
      body: '<p class="am-intro">' + esc(doc.intro) + '</p>' + docSectionsHtml(doc.detail)
    }) + '<div class="modal-actions">' +
      '<button type="button" class="btn-ok" data-act="modal-cancel">我知道了</button>' +
      '</div>');
    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
  }

  /** 估算非账本缓存占用（主账本 key 不计入；UTF-16 粗估 2 字节/字符） */
  function estimateCacheSize() {
    var total = 0;
    try {
      var keys = Object.keys(global.localStorage);
      var i;
      for (i = 0; i < keys.length; i++) {
        if (keys[i] === STORAGE_KEY) { continue; }
        var val = global.localStorage.getItem(keys[i]);
        total += (keys[i].length + (val ? val.length : 0)) * 2;
      }
    } catch (e) {
      return '—';
    }
    if (total < 1024) { return total + ' B'; }
    return (total / 1024).toFixed(1) + ' KB';
  }

  /** 清理缓存：只删账本主 key 之外的本地数据，账本绝不碰 */
  function clearAppCache() {
    var removed = 0;
    try {
      var keys = Object.keys(global.localStorage);
      var i;
      for (i = 0; i < keys.length; i++) {
        if (keys[i] === STORAGE_KEY) { continue; }
        global.localStorage.removeItem(keys[i]);
        removed++;
      }
    } catch (e) {
      showToast('清理失败：当前浏览器不允许操作本地存储');
      return;
    }
    $('setCacheValue').textContent = estimateCacheSize();
    showToast(removed > 0 ? '已清理 ' + removed + ' 项缓存，账本数据完好' : '当前没有可清理的缓存');
  }

  /** 意见反馈：存 localStorage（ledger.feedback 数组），仅本地演示 */
  function submitSettingsFeedback() {
    var input = $('setFeedbackInput');
    var text = String(input.value || '').trim();
    if (!text) {
      showToast('先写点建议再提交吧');
      input.focus();
      return;
    }
    var list = [];
    try {
      var raw = global.localStorage.getItem(FEEDBACK_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) { list = parsed; }
    } catch (e) {
      list = [];
    }
    list.push({ text: text.slice(0, 500), at: new Date().toISOString() });
    try {
      global.localStorage.setItem(FEEDBACK_KEY, JSON.stringify(list));
      input.value = '';
      $('setCacheValue').textContent = estimateCacheSize();
      showToast('已收到反馈（本地演示）');
    } catch (e2) {
      showToast('保存失败：当前浏览器不支持本地存储');
    }
  }

  /** 个人信息导出：账本统计概览 + 设置，不含账单明细与敏感信息 */
  function exportPersonalInfo() {
    var ov = getOverview();
    var st = getSettings();
    var payload = {
      app: 'AI 校园记账管家',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      overview: {
        billCount: state.bills.length,
        cycleStart: ov.cycle.start,
        cycleEnd: ov.cycle.end,
        budgetTotal: state.budget.total,
        cycleExpense: ov.cycleAgg.expense,
        cycleIncome: ov.cycleAgg.income,
        goalCount: state.goals.length
      },
      settings: {
        profile: st.profile,
        theme: st.theme,
        fontScale: st.fontScale,
        lang: st.lang,
        notify: st.notify,
        privacy: st.privacy
      }
    };
    downloadJson('personal-info.json', payload);
  }

  /** 注销账号：二次确认后清空 localStorage 全部数据并刷新 */
  function confirmDeleteAccount() {
    var box = openModal('' +
      '<h4>注销账号？</h4>' +
      '<p>将清空本机所有数据（账单、目标、设置、反馈），并刷新页面。此操作不可撤销。</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-cancel" data-act="modal-cancel">取消</button>' +
      '<button type="button" class="btn-danger" data-act="delete-ok">确认注销</button>' +
      '</div>');
    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
    box.querySelector('[data-act="delete-ok"]').addEventListener('click', function () {
      try {
        global.localStorage.clear();
      } catch (e) { /* 隐私模式下忽略，依旧执行刷新 */ }
      closeModal();
      closeSettingsPage();
      global.location.reload();
    });
  }

  /** 下载 JSON 文件 */
  function downloadJson(filename, obj) {
    try {
      var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      var url = global.URL.createObjectURL(blob);
      var a = DOC.createElement('a');
      a.href = url;
      a.download = filename;
      DOC.body.appendChild(a);
      a.click();
      DOC.body.removeChild(a);
      setTimeout(function () { global.URL.revokeObjectURL(url); }, 5000);
      showToast('已导出个人信息 JSON（不含账单明细与敏感信息）');
    } catch (e) {
      showToast('导出失败：当前浏览器不支持文件下载');
    }
  }

  /* 轻提示统一走 toastRoot 容器版 showToast（三型：ok / warn / danger） */

  /* ================================================================== */
  /* 快捷指令响应                                                        */
  /* ================================================================== */

  function showBalanceCard() {
    var ov = getOverview();
    var bs = ov.budgetState;
    var ratio = state.budget.total > 0 ? Math.max(0, Math.min(100, bs.remaining / state.budget.total * 100)) : 0;
    var barColor = bs.status === 'danger' ? '#EF5350' : (bs.status === 'tight' ? '#FF8A3D' : '#07C160');
    var html = '' +
      '<div class="bubble ai">帮你查了下这个周期（' + esc(ov.cycle.start) + ' ~ ' + esc(ov.cycle.end) + '）</div>' +
      '<div class="bill-card">' +
      '  <div class="bill-card-head"><span>周期剩余 / 总预算</span><span>还剩 ' + ov.cycle.remainingDays + ' 天</span></div>' +
      '  <div class="bill-card-main">' +
      '    <span class="bill-card-note">' + money(bs.remaining) + ' / ' + money(state.budget.total) + '</span>' +
      '  </div>' +
      '  <div class="engel-bar" style="margin-top:9px"><i style="width:' + ratio + '%;background:' + barColor + '"></i></div>' +
      '  <div class="bill-card-tags">' +
      '    <span class="tag green">日均可用 ' + money(bs.dailyAllowance) + '</span>' +
      '    <span class="tag">今日已花 ' + money(bs.todaySpent) + '</span>' +
      '    <span class="tag">今天还能花 ' + money(bs.todayRemain) + '</span>' +
      '  </div>' +
      '</div>';
    addAIMessage(html);
    addAIMessage(aiBubble(ov.sentence));
  }

  function showPieCard() {
    var ov = getOverview();
    var slices = getCategorySlices(ov.cycleAgg.byCategory);
    if (slices.length === 0) {
      addAIMessage(aiBubble('本周期还没记账呢，先记一笔我就能画饼图了。'));
      return;
    }
    var svg = '<svg viewBox="0 0 100 100">' +
      '<g transform="rotate(-90 50 50)">' + donutSvgHtml(slices, 100, 20, 100) + '</g>' +
      '<text x="50" y="48" text-anchor="middle" font-size="12" font-weight="600" fill="#2B313B">' + money(ov.cycleAgg.expense) + '</text>' +
      '<text x="50" y="59" text-anchor="middle" font-size="6" fill="#8A93A0">总支出</text>' +
      '</svg>';
    var legend = '';
    var i;
    for (i = 0; i < slices.length && i < 6; i++) {
      var pct = ov.cycleAgg.expense > 0 ? (slices[i].value / ov.cycleAgg.expense * 100) : 0;
      legend += '<div><i style="background:' + slices[i].color + '"></i>' + esc(slices[i].key) +
        ' ' + money(slices[i].value) + '（' + pct.toFixed(0) + '%）</div>';
    }
    addAIMessage(aiBubble('本周期支出构成：'));
    var html = '<div class="mini-pie">' + svg + '<div class="mini-pie-legend">' + legend + '</div></div>';
    addAIMessage(html);

    var top = slices[0];
    var topPct = ov.cycleAgg.expense > 0 ? (top.value / ov.cycleAgg.expense * 100) : 0;
    addAIMessage(aiBubble('本周期一共花了 ' + money(ov.cycleAgg.expense) + '，最大头是 <span class="hl">' +
      esc(top.key) + '</span>（' + money(top.value) + '，占 ' + topPct.toFixed(0) + '%）。' +
      (ov.engel.alert ? '餐饮占比偏高，注意别把社交预算吃掉。' : '结构还算健康。')));
  }

  function showEntryGuide() {
    var html = '' +
      '<div class="bubble ai">直接说一句话就行，比如这几句：</div>' +
      '<div class="msg-actions">' +
      '  <button type="button" class="btn-mini" data-cmd="午饭食堂 15">午饭食堂 15</button>' +
      '  <button type="button" class="btn-mini" data-cmd="昨天打车15，奶茶12">昨天打车15，奶茶12</button>' +
      '  <button type="button" class="btn-mini" data-cmd="买了杯星巴克32">买了杯星巴克32</button>' +
      '</div>';
    addAIMessage(html);
  }

  /* C5：旧的「整句否定 + 固定金额示例」兜底已退役（现由 answerGiveUp / intent.js 的
     giveUpHtml 承担 L5 出口）。旧文案在全库清零：缺金额时一律只问金额，并按反死循环
     规则逐级升级，绝不重复同一句提示。 */

  function showGoalGuide() {
    addAIMessage(aiBubble('想攒钱买点什么？点下面按钮填一下，我帮你算每月该存多少。'));
    openGoalModal();
  }

  /* ================================================================== */
  /* 收入录入 & 周期重置                                                 */
  /* ================================================================== */

  /** 按 id 找账单 */
  function billById(id) {
    var i;
    for (i = 0; i < state.bills.length; i++) {
      if (state.bills[i].id === id) { return state.bills[i]; }
    }
    return null;
  }

  /** 记收入表单 */
  function openIncomeModal() {
    var todayStr = ENG.formatDate(new Date());
    var radios = '';
    var i;
    for (i = 0; i < DATA.INCOME_SOURCES.length; i++) {
      var s = DATA.INCOME_SOURCES[i];
      radios += '<label class="radio-item">' +
        '<input type="radio" name="incomeSource" value="' + esc(s) + '"' + (i === 0 ? ' checked' : '') + ' />' +
        '<span>' + esc(s) + '</span>' +
        '</label>';
    }

    var box = openModal('' +
      '<h4>记一笔收入</h4>' +
      '<p>生活费、兼职、奖学金都记在这里，不会算进支出统计。</p>' +
      '<label class="field"><span>金额（¥）</span>' +
      '<input data-field="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="例如 2000" /></label>' +
      '<div class="field"><span>来源</span><div class="radio-group">' + radios + '</div></div>' +
      '<label class="field"><span>日期</span>' +
      '<input data-field="date" type="date" max="' + todayStr + '" value="' + todayStr + '" /></label>' +
      '<label class="field"><span>备注（可选）</span>' +
      '<input data-field="note" type="text" placeholder="例如 10 月生活费" /></label>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-cancel" data-act="modal-cancel">取消</button>' +
      '<button type="button" class="btn-ok" data-act="income-save">确认入账</button>' +
      '</div>');

    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
    box.querySelector('[data-act="income-save"]').addEventListener('click', function () {
      var amountInput = box.querySelector('[data-field="amount"]');
      var amount = Number(amountInput.value);
      if (!isFinite(amount) || amount <= 0) {
        amountInput.focus();
        return;
      }
      var checked = box.querySelector('input[name="incomeSource"]:checked');
      var source = checked ? checked.value : '其他';
      var date = box.querySelector('[data-field="date"]').value;
      var note = box.querySelector('[data-field="note"]').value.trim();
      closeModal();
      switchView('chat');
      startFlow([{
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayStr,
        amount: ENG.round2(amount),
        category: DATA.INCOME_CATEGORY,
        source: source,
        note: note || source,
        motivation: '刚需',
        want: false,
        type: 'income'
      }]);
    });

    var focusInput = box.querySelector('[data-field="amount"]');
    if (focusInput) { focusInput.focus(); }
  }

  /**
   * 是否要追问「这笔钱要不要算进本周期可用额度」。
   * 条件：收入 && 金额 ≥ 300，同一笔只问一次（askedCycle）。
   * 注意：不再限定「生活费 / 到账」措辞——那会让「入账2000」「兼职800」这类
   * 收入永远不触发追问，用户就看不到剩余额度有任何变化（2026-10-27 用户反馈「只问一遍」）。
   */
  function shouldAskCycleReset(bill) {
    if (!bill || bill.type !== 'income') { return false; }
    if (bill.askedCycle) { return false; }
    return Number(bill.amount) >= 300;
  }

  /**
   * 这笔收入是不是「新一轮生活费」：是 → 重置周期并结转上期余额；
   * 否（兼职 / 奖学金 / 退款 / 其他进账）→ 不重置周期，只把金额加进本周期预算。
   */
  function isLivingExpenseIncome(bill) {
    if (!bill) { return false; }
    if (bill.source === '生活费') { return true; }
    var note = String(bill.note || '') + ' ' + String(bill.title || '');
    return /生活费|这个月的钱|这个月|家用|爸妈给(?:的)?|打钱|给我转/.test(note);
  }

  /** 入账后追问（大白话），同一笔只问一次 */
  function maybeAskCycleReset(bill) {
    if (!shouldAskCycleReset(bill)) { return; }
    bill.askedCycle = true;
    saveState();

    var isLife = isLivingExpenseIncome(bill);
    var beforeOverview = getOverview();
    var beforeRemaining = ENG.round2(beforeOverview.budgetState.remaining);
    /* beforeRemaining 已经扣过一次存钱罐余额；life 重算时 getOverview 会再扣一次，
       必须把存钱罐加回来，否则存钱罐被扣两次 → 大额存钱罐 + 小额生活费入账时剩余额度会下降。
       rollover = 上期可结转的现金（含存钱罐），这样重算后剩余 = 入账 + 旧剩余 - 新周期支出 ≥ 旧剩余。 */
    var piggyRoll = ENG.round2(beforeOverview.piggyBalance || 0);
    var rollover = ENG.round2(Math.max(0, beforeRemaining + piggyRoll));
    var nextTotal = ENG.round2(ENG.round2(bill.amount) + rollover);
    var todayStr = ENG.formatDate(new Date());
    var nextCycle = ENG.getCycle(new Date(), state.budget.payday, null, todayStr);
    var nextDaily = ENG.round2(nextTotal / nextCycle.remainingDays);
    var title = isLife
      ? '这笔 ' + money(bill.amount) + ' 是新的生活费到账吗？'
      : '这笔 ' + money(bill.amount) + '（' + esc(bill.source || '其他') + '）要不要加进本周期的可用额度？';
    var text = isLife
      ? '要不要<b>从现在起重新算一个周期</b>？重算后 = ' + money(bill.amount) +
        ' + 上期结余 ' + money(rollover) + ' = ' + money(nextTotal) +
        '，日均 ' + money(nextDaily) + '。'
      : '加上后周期不动，剩余从 ' + money(beforeRemaining) + ' 变成 ' +
        money(ENG.round2(beforeRemaining + ENG.round2(bill.amount))) + '。';
    var yesText = isLife ? '要，从现在重新算' : '要，加进可用额度';

    var html = '' +
      '<div class="ask-card" data-bill="' + esc(bill.id) + '" data-kind="' + (isLife ? 'life' : 'extra') + '">' +
      '  <div class="ask-title">' + title + '</div>' +
      '  <div class="ask-text">' + text + '</div>' +
      '  <div class="ask-actions">' +
      '    <button type="button" class="btn-mini primary" data-act="cycle-yes" data-bill="' + esc(bill.id) + '">' + yesText + '</button>' +
      '    <button type="button" class="btn-mini" data-act="cycle-no" data-bill="' + esc(bill.id) + '">不用，只记这一笔</button>' +
      '  </div>' +
      '</div>';
    addAIMessage(aiBubble(ic('think', 'bico-brand', '提示') + '多问一句：') + html);
  }

  /**
   * 处理「重新算周期 / 只记流水」。
   * @param {string} billId
   * @param {boolean} yes
   */
  function resolveCycleReset(billId, yes) {
    var bill = billById(billId);
    if (!bill) { return; }
    if (!yes) {
      addAIMessage(aiBubble('行，这笔只当流水记着，预算没动。'));
      return;
    }
    var isLife = isLivingExpenseIncome(bill);
    var beforeOverview = getOverview();
    var beforeRemaining = ENG.round2(beforeOverview.budgetState.remaining);
    /* beforeRemaining 已经扣过一次存钱罐余额；life 重算时 getOverview 会再扣一次，
       必须把存钱罐加回来，否则存钱罐被扣两次 → 大额存钱罐 + 小额生活费入账时剩余额度会下降。
       rollover = 上期可结转的现金（含存钱罐），这样重算后剩余 = 入账 + 旧剩余 - 新周期支出 ≥ 旧剩余。 */
    var piggyRoll = ENG.round2(beforeOverview.piggyBalance || 0);
    var rollover = ENG.round2(Math.max(0, beforeRemaining + piggyRoll));
    var todayStr = ENG.formatDate(new Date());
    if (isLife) {
      /* 新一轮生活费：从今天起算，并把未花完的上期额度结转过来 */
      state.budget.cycleStart = todayStr;
      state.budget.total = ENG.round2(ENG.round2(bill.amount) + rollover);
    } else {
      /* 兼职 / 奖学金 / 退款这类额外进账：周期不动，预算加上这笔钱 */
      state.budget.total = ENG.round2(ENG.round2(state.budget.total) + ENG.round2(bill.amount));
    }
    saveState();
    var ov = getOverview();
    renderAll();
    addAIMessage(aiBubble(isLife
      ? '好，新一轮从今天开始，含上期结余 ' + money(rollover) + '，一共 ' +
        money(state.budget.total) + '，从 ' + esc(ov.cycle.start) + ' 用到 ' +
        esc(ov.cycle.end) + '，还有 ' + ov.cycle.remainingDays + ' 天，日均 ' +
        money(ov.budgetState.dailyAllowance) + '。'
      : '好，本周期预算加上这笔 ' + money(bill.amount) + '，现在是 ' + money(state.budget.total) +
        '，剩余从 ' + money(beforeRemaining) + ' 变成 ' + money(ov.budgetState.remaining) +
        '，日均可用 ' + money(ov.budgetState.dailyAllowance) + '。'));
    /* 重算后立刻补一张最新【余额概览】：聊天里那张旧卡是入账瞬间的快照，
       不会自己刷新——不补的话用户会以为「入账后其他数据没变化」（2026-10-27 用户反馈）。
       ov 是 saveState() 之后取的，已是重算后的数据。 */
    addAIMessage(balanceOverviewHtml(ov));
  }

  /** 恢复按发钱日推算 */
  function restorePaydayCycle() {
    state.budget.cycleStart = '';
    saveState();
    renderAll();
    renderCycleInfo();
    var ov = getOverview();
    addAIMessage(aiBubble('已经恢复按发钱日 ' + state.budget.payday + ' 号算周期：' +
      esc(ov.cycle.start) + ' ~ ' + esc(ov.cycle.end) + '，还剩 ' + ov.cycle.remainingDays + ' 天。'));
    /* 同上：补一张恢复后的最新概览，避免旧快照误导 */
    addAIMessage(balanceOverviewHtml(ov));
  }

  /* ================================================================== */
  /* 账单分析                                                            */
  /* ================================================================== */

  function openAnalysisSheet() {
    $('analysisMask').hidden = false;
    // 默认直接分析当前账本（无需导入）；没有记录时才停留在导入模式
    if (state.bills.length > 0) {
      analysisMode = 'current';
      analyzeCurrentBills();
    } else if (analysisData) {
      analysisMode = 'imported';
      renderAnalysis();
    } else {
      analysisMode = 'imported';
      renderAnalysis();
    }
    syncAnalysisTabs();
  }

  function closeAnalysisSheet() {
    $('analysisMask').hidden = true;
  }

  /** 把当前账本（state.bills）转成 analysis 模块可用的 rows，并触发分析 */
  function analyzeCurrentBills() {
    var bills = state.bills || [];
    var rows = bills.map(function (b) {
      var isIncome = b.type === 'income';
      return {
        date: b.date,
        amount: b.amount,
        category: isIncome ? DATA.INCOME_CATEGORY : b.category,
        type: isIncome ? 'income' : 'expense',
        counterparty: '',
        desc: b.note || '',
        note: b.note || '',
        worth: b.worth || '',
        month: (b.date || '').slice(0, 7)
      };
    });
    var monthSet = {};
    var i;
    for (i = 0; i < rows.length; i++) {
      if (rows[i].month) { monthSet[rows[i].month] = true; }
    }
    var monthList = Object.keys(monthSet).sort();
    var month = monthList.length ? monthList[monthList.length - 1] : ENG.formatDate(new Date()).slice(0, 7);
    analysisData = {
      rows: rows,
      files: [{
        name: '当前账本', ok: true, reason: '', encoding: '', headerRow: 0,
        totalRows: rows.length, skipped: 0, skippedBefore: 0, transferIncomeCount: 0,
        columns: {}, delimiter: ',', records: rows.length
      }],
      duplicates: [],
      months: monthList,
      month: month,
      source: 'current'
    };
    renderAnalysis();
  }

  /** 切换分析模式标签的选中态 */
  function syncAnalysisTabs() {
    var tabs = DOC.querySelectorAll('[data-act="an-mode"]');
    for (var i = 0; i < tabs.length; i++) {
      var m = tabs[i].getAttribute('data-mode');
      tabs[i].classList.toggle('active', m === analysisMode);
    }
  }

  /** 统计「值不值」自评 */
  function worthStats(bills) {
    var s = { worth: 0, mid: 0, waste: 0, none: 0, wasteAmount: 0, totalExpense: 0 };
    for (var i = 0; i < bills.length; i++) {
      var b = bills[i];
      if (b.type === 'income') { continue; }
      s.totalExpense += b.amount;
      if (b.worth === 'worth') { s.worth += 1; }
      else if (b.worth === 'mid') { s.mid += 1; }
      else if (b.worth === 'waste') { s.waste += 1; s.wasteAmount += b.amount; }
      else { s.none += 1; }
    }
    s.wasteRate = s.totalExpense > 0 ? (s.wasteAmount / s.totalExpense * 100) : 0;
    return s;
  }

  /** 「值不值」自评区块 HTML */
  function worthSectionHtml(s) {
    if (s.totalExpense <= 0 && s.none === 0) {
      return emptyLine('当前账本还没有支出记录');
    }
    var rated = s.worth + s.mid + s.waste;
    return '<div class="worth-stats">' +
      '<div class="worth-grid">' +
      '  <div class="wcell w-worth"><b>' + s.worth + '</b><small>' + ic('target', null, '值') + '值</small></div>' +
      '  <div class="wcell w-mid"><b>' + s.mid + '</b><small>一般</small></div>' +
      '  <div class="wcell w-waste"><b>' + s.waste + '</b><small>' + ic('stop', null, '不值') + '不值</small></div>' +
      '  <div class="wcell"><b>' + s.none + '</b><small>未评价</small></div>' +
      '</div>' +
      '<div class="worth-bar"><i style="width:' + s.wasteRate.toFixed(1) + '%"></i></div>' +
      '<p class="worth-text">在已评价的支出里，你给 <b>' + s.waste + '</b> 笔打了「不值」，合计 <b>' +
        money(s.wasteAmount) + '</b>，占支出 <b>' + s.wasteRate.toFixed(1) + '%</b>。' +
        (s.none > 0 ? '还有 ' + s.none + ' 笔没评价，回聊天里给它们打个分吧～' : '评价得很全面，继续保持！') +
      '</p>' +
      '</div>';
  }

  var XLS_OLD_REASON = '.xls 是老版 Excel 格式，暂不支持。请在 Excel 里「另存为」选择「Excel 工作簿(*.xlsx)」或「CSV UTF-8」再导入。';
  var XLSX_BROWSER_REASON = '当前浏览器不支持解压 Excel，请换用 Chrome / Edge，或把文件另存为 CSV 再导入。';
  var XLSX_DAMAGED_REASON = '这个 Excel 文件打不开（可能已损坏或加密），请在 Excel 里打开后另存为 CSV 再导入。';

  /** 统一构造 analysis.buildRows 能接受的失败文件元数据。 */
  function importParseFailure(name, reason) {
    return {
      name: name || '未命名文件',
      ok: false,
      reason: reason || '解析失败',
      records: [],
      skipped: 0
    };
  }

  /** 浏览器原生 raw DEFLATE；xlsx.js 只接收注入函数，不感知 DOM / Web API。 */
  function inflateRaw(u8) {
    if (typeof global.DecompressionStream === 'function') {
      try {
        var ds = new global.DecompressionStream('deflate-raw');
        var stream = new Blob([u8]).stream().pipeThrough(ds);
        return new Response(stream).arrayBuffer().then(function (buf) {
          return new Uint8Array(buf);
        });
      } catch (error) {
        return Promise.reject(new Error(XLSX_BROWSER_REASON));
      }
    }
    return Promise.reject(new Error(XLSX_BROWSER_REASON));
  }

  /** 把 xlsx.js 的内部原因收敛为三类可操作提示，避免把 ZIP 术语抛给普通用户。 */
  function xlsxUserReason(reason) {
    var text = String(reason || '');
    if (text.indexOf('当前浏览器不支持解压 Excel') !== -1) { return XLSX_BROWSER_REASON; }
    return XLSX_DAMAGED_REASON;
  }

  /**
   * 单文件解析入口：现代 Excel 先转 CSV 文本，其他文件仍走 analysis.js 原二进制路径。
   * 始终返回 Promise<文件元数据>，并把同步异常 / 异步解压失败都收敛为失败元数据。
   */
  function parseBillImportFile(file, bytes) {
    var name = file && file.name ? String(file.name) : '未命名文件';
    if (/\.xls$/i.test(name)) {
      return Promise.resolve(importParseFailure(name, XLS_OLD_REASON));
    }
    var isWorkbook = /\.(xlsx|xlsm)$/i.test(name) ||
      (XLSX && typeof XLSX.isXlsx === 'function' && XLSX.isXlsx(bytes, name));
    if (!isWorkbook) {
      try {
        return Promise.resolve(ANA.parseFile({ name: name, bytes: bytes }));
      } catch (error) {
        return Promise.resolve(importParseFailure(name,
          '解析失败：' + (error && error.message ? error.message : '未知错误')));
      }
    }
    if (!XLSX || typeof XLSX.toCsvText !== 'function') {
      return Promise.resolve(importParseFailure(name, XLSX_DAMAGED_REASON));
    }
    var converted;
    try {
      converted = XLSX.toCsvText(bytes, inflateRaw);
    } catch (error) {
      return Promise.resolve(importParseFailure(name, xlsxUserReason(error && error.message)));
    }
    return Promise.resolve(converted).then(function (result) {
      if (!result || !result.ok) {
        return importParseFailure(name, xlsxUserReason(result && result.reason));
      }
      try {
        return ANA.parseFile({ name: name, text: result.text });
      } catch (error) {
        return importParseFailure(name,
          'Excel 已读取，但账单内容解析失败：' + (error && error.message ? error.message : '未知错误'));
      }
    }).catch(function (error) {
      return importParseFailure(name, xlsxUserReason(error && error.message));
    });
  }

  /** 把 CSV / TXT / XLSX 文件读成 ArrayBuffer，再交给统一账单解析入口。 */
  function handleAnalysisFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (files.length === 0) { return; }
    var metas = [];
    var pending = files.length;
    var statusEl = $('analysisStatus');
    if (statusEl) { statusEl.textContent = '正在解析 ' + files.length + ' 个文件…'; }

    function done() {
      pending -= 1;
      if (pending > 0) { return; }
      var built = ANA.buildRows(metas);
      var monthCount = {};
      var i;
      for (i = 0; i < built.rows.length; i++) {
        var mk = built.rows[i].month || built.rows[i].date.slice(0, 7);
        monthCount[mk] = (monthCount[mk] || 0) + 1;
      }
      var monthList = Object.keys(monthCount).sort();
      // 默认看「记录最多的那个月」（平手取较新的月份），避免默认落到只有 1 条记录的月份
      var month = monthList.length > 0 ? monthList[monthList.length - 1] : ENG.formatDate(new Date()).slice(0, 7);
      var bestCount = -1;
      for (i = 0; i < monthList.length; i++) {
        if (monthCount[monthList[i]] >= bestCount) {
          bestCount = monthCount[monthList[i]];
          month = monthList[i];
        }
      }
      analysisData = {
        rows: built.rows,
        files: built.files,
        duplicates: built.duplicates,
        months: monthList,
        month: month,
        source: 'imported'
      };
      analysisMode = 'imported';
      renderAnalysis();
      syncAnalysisTabs();
    }

    files.forEach(function (file, index) {
      var reader = new FileReader();
      reader.onload = function () {
        parseBillImportFile(file, reader.result).then(function (parsed) {
          metas[index] = parsed;
          done();
        }, function (error) {
          metas[index] = importParseFailure(file.name,
            '解析失败：' + (error && error.message ? error.message : '未知错误'));
          done();
        });
      };
      reader.onerror = function () {
        metas[index] = { name: file.name, ok: false, reason: '读取文件失败', records: [], skipped: 0 };
        done();
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /** 折叠区块 */
  /** 报告分区。summary：折叠状态下也显示的一句话摘要（避免只剩干巴巴的标题） */
  function reportSection(title, inner, open, summary) {
    return '<details class="report-sec"' + (open ? ' open' : '') + '>' +
      '<summary><span class="rs-title">' + title + '</span>' +
      (summary ? '<span class="rs-chip">' + summary + '</span>' : '') +
      '</summary>' +
      '<div class="sec-body">' + inner + '</div>' +
      '</details>';
  }

  function emptyLine(text) {
    return '<div class="sec-empty">' + esc(text) + '</div>';
  }

  /** 解析失败时的诊断卡片：把「静默空白」变成明确的「为什么没识别」。
   *  未选择文件时不渲染任何卡片（拖拽区 + 状态行已有引导），只更新状态文字。 */
  function analysisFailCard(data, statusEl) {
    if (!data || !data.files || data.files.length === 0) {
      if (statusEl) {
        statusEl.textContent = '还没有导入文件。支持 CSV / Excel（.xlsx）；PDF 和老版 .xls 不支持，请先另存为 .xlsx 或 CSV。';
      }
      // 分析页（导入模式）与顶栏导入页的拖拽区、状态行已有引导，
      // 这里不再重复渲染「还没有可分析的账单文件」大卡片，避免整页冗余。
      return '';
    }
    var bad = data.files.filter(function (f) { return !f.ok; });
    var good = data.files.filter(function (f) { return f.ok; });
    var lines = '';
    if (bad.length > 0) {
      lines += '<div class="pf-sub">以下文件没能解析出记录：</div>';
      bad.forEach(function (f) {
        lines += '<div class="pf-item">' +
          '<div class="pf-name">' + ic('alert', 'bico-bad', '未识别') + esc(f.name) + '</div>' +
          '<div class="pf-reason">' + esc(f.reason || '解析失败') + '</div>';
        if (f.preview) {
          lines += '<pre class="pf-preview">' + esc(f.preview) + '</pre>';
        }
        lines += '</div>';
      });
    }
    if (good.length > 0 && data.rows.length === 0) {
      lines += '<div class="pf-sub">已识别文件但筛选后没有记录（可能都被月份筛选或去重过滤了）。</div>';
    }
    if (statusEl) {
      statusEl.textContent = bad.length > 0
        ? '有 ' + bad.length + ' 个文件未解析出记录，详见下方说明。'
        : '还没有解析出有效记录。';
    }
    return '<div class="parse-fail">' +
      '<div class="pf-emoji"><svg viewBox="0 0 24 24"><use href="#i-sad"/></svg></div>' +
      '<div class="pf-title">这份文件没能解析出账单记录</div>' +
      lines +
      '<p class="pf-tip">常见原因：① 文件是 <b>PDF / 老版 .xls</b>，请先另存为 <b>.xlsx 或 CSV UTF-8</b>；' +
      '② 微信/支付宝需选「用做个人对账」的明细；③ 文件已损坏、加密或编码异常。' +
      '如果还有问题，把文件前 2 行发给我，我帮你适配格式。</p>' +
      '</div>';
  }

  function barHtml(label, value, max, color) {
    var pct = max > 0 ? Math.max(2, value / max * 100) : 0;
    return '<div class="bar-row">' +
      '<span class="bar-label">' + esc(label) + '</span>' +
      '<span class="bar-track"><i style="width:' + pct.toFixed(1) + '%;background:' + color + '"></i></span>' +
      '<span class="bar-value">' + money(value) + '</span>' +
      '</div>';
  }

  /* ==================================================================
     账单分析 · 图表构件
     表格能回答"精确数字"，但看不出"谁大谁小、差多少"，所以每个分区都给
     一张图形：横向条形排行 / 竖向柱对比 / 堆叠占比条，全部用 CSS 变量取色，
     深色模式下由同套 class 的 dark 覆盖接管。
     ================================================================== */

  /** 日期统一显示成 MM.DD（YYYY-MM-DD / MM-DD 两种输入都接受） */
  function anaShortDate(d) {
    var s = String(d || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { return s.slice(5).replace('-', '.'); }
    return s;
  }

  /**
   * 横向条形排行。
   * items: [{label, value, text?, sub?, color?, pct?, mark?}]
   *   text 右侧显示文案（默认 money(value)）；mark 为 0-100 的刻度位置（画"均值线"）
   */
  function anaRankHtml(items, opts) {
    opts = opts || {};
    var max = opts.max || 0;
    var i;
    if (!max) {
      for (i = 0; i < items.length; i++) { if (items[i].value > max) { max = items[i].value; } }
    }
    if (!(max > 0)) { max = 1; }
    var html = '<div class="ana-rank">';
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var pct = Math.max(2.5, it.value / max * 100);
      html += '<div class="ana-row">' +
        '<div class="ana-row-top">' +
        '<span class="ana-row-lb">' + it.label + '</span>' +
        '<span class="ana-row-v">' + (it.text || money(it.value)) + '</span>' +
        '</div>' +
        '<div class="ana-bar"><i style="width:' + pct.toFixed(1) + '%;background:' +
        (it.color || 'var(--green)') + '"></i>' +
        (it.mark ? '<u class="ana-bar-mark" style="left:' + it.mark.toFixed(1) + '%"></u>' : '') +
        '</div>' +
        (it.sub ? '<div class="ana-row-sub">' + it.sub + '</div>' : '') +
        '</div>';
    }
    return html + '</div>';
  }

  /** 竖向柱状对比图（少量数据：周末 vs 工作日、收支对比等） */
  function anaColsHtml(cols, opts) {
    opts = opts || {};
    var W = 320;
    var H = opts.height || 128;
    var padT = 24;
    var padB = 30;
    var padL = 6;
    var chartH = H - padT - padB;
    var max = 0;
    var i;
    for (i = 0; i < cols.length; i++) { if (cols[i].value > max) { max = cols[i].value; } }
    if (!(max > 0)) { max = 1; }
    var slotAll = W - padL * 2;
    /* 图形区只占中间 66%，柱子不会被拉得太散 */
    var areaW = slotAll * 0.66;
    var areaX = padL + (slotAll - areaW) / 2;
    var slotW = areaW / cols.length;
    var barW = Math.min(52, slotW * 0.52);
    var parts = [];
    parts.push('<line class="stat-base" x1="' + padL + '" y1="' + (padT + chartH) + '" x2="' + (W - padL) +
      '" y2="' + (padT + chartH) + '"></line>');
    for (i = 0; i < cols.length; i++) {
      var c = cols[i];
      var h = Math.max(2, c.value / max * chartH);
      var cx = areaX + slotW * i + slotW / 2;
      var y = padT + chartH - h;
      parts.push('<rect class="ana-col" x="' + (cx - barW / 2).toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="6" fill="' +
        (c.color || 'var(--green)') + '"></rect>');
      parts.push('<text class="ana-col-v" x="' + cx.toFixed(1) + '" y="' + (y - 6).toFixed(1) +
        '" text-anchor="middle" font-size="10.5" font-weight="600">' + esc(c.top || money(c.value)) + '</text>');
      parts.push('<text class="stat-ax" x="' + cx.toFixed(1) + '" y="' + (H - 8) +
        '" text-anchor="middle" font-size="9.5">' + esc(c.label) + '</text>');
      if (c.sub) {
        parts.push('<text class="stat-ax" x="' + cx.toFixed(1) + '" y="' + (H - 8 - 11) +
          '" text-anchor="middle" font-size="8.5">' + esc(c.sub) + '</text>');
      }
    }
    return '<div class="ana-cols"><svg viewBox="0 0 ' + W + ' ' + H +
      '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + parts.join('') + '</svg></div>';
  }

  /**
   * 堆叠占比条（解析情况等"总数是 100% 的几个部分"）。
   * segs: [{label, value, color}]；返回条形 + 图例
   */
  function anaStackHtml(segs, opts) {
    opts = opts || {};
    var total = 0;
    var i;
    for (i = 0; i < segs.length; i++) { total += segs[i].value; }
    if (!(total > 0)) { return ''; }
    var track = '<div class="ana-stack">';
    for (i = 0; i < segs.length; i++) {
      if (segs[i].value <= 0) { continue; }
      track += '<i style="width:' + (segs[i].value / total * 100).toFixed(2) + '%;background:' + segs[i].color +
        '" title="' + esc(segs[i].label + ' ' + segs[i].value) + '"></i>';
    }
    track += '</div>';
    var legend = '<ul class="ana-legend">';
    for (i = 0; i < segs.length; i++) {
      if (segs[i].value <= 0) { continue; }
      legend += '<li><i style="background:' + segs[i].color + '"></i>' + esc(segs[i].label) +
        '<b>' + (opts.text ? esc(opts.text(segs[i])) : segs[i].value) + '</b></li>';
    }
    legend += '</ul>';
    return track + legend;
  }

  /** 一组小数字卡（替代窄表格） */
  function anaTilesHtml(tiles) {
    var html = '<div class="ana-tiles">';
    tiles.forEach(function (t) {
      html += '<div class="ana-tile' + (t.tone ? ' ' + t.tone : '') + '">' +
        '<b>' + t.value + '</b><small>' + t.label + '</small></div>';
    });
    return html + '</div>';
  }

  /** 「这一项是干净的」状态卡：比一行灰字更像个结论 */
  function emptyOk(text) {
    return '<div class="ana-empty">' + ic('check', 'bico-brand', '通过') + '<span>' + esc(text) + '</span></div>';
  }

  /** 渲染整个分析 sheet */
  function renderAnalysis() {
    var reportEl = $('analysisReport');
    var statusEl = $('analysisStatus');
    var toolbar = $('analysisToolbar');
    if (!reportEl) { return; }

    // 以「当前激活的标签」为准，而不是以数据残留判断：
    // 否则从「当前账本」切到「导入 CSV」时，analysisData 还是账本数据，会误显当前账本内容。
    var isCurrent = (analysisMode === 'current');
    var dropEl = $('analysisDrop');
    var bannerEl = $('analysisCurrentBanner');
    var importBtn = $('btnAnalysisImport');
    var clearBtn = $('btnAnalysisClear');
    if (dropEl) { dropEl.hidden = isCurrent; }
    if (bannerEl) {
      bannerEl.hidden = !isCurrent;
      if (isCurrent) {
        bannerEl.textContent = '正在分析你当前账本里已记的 ' + (state.bills || []).length +
          ' 笔记录（直接来自账本，无需导入）';
      }
    }
    if (importBtn) { importBtn.hidden = isCurrent; }
    if (clearBtn) { clearBtn.hidden = isCurrent; }

    if (!analysisData || !analysisData.rows || analysisData.rows.length === 0) {
      var failHtml;
      if (isCurrent) {
        if (statusEl) { statusEl.textContent = '当前账本还没有记录。'; }
        failHtml = '<div class="parse-fail"><div class="pf-emoji">' + ic('clipboard', null, '账本') + '</div>' +
          '<div class="pf-title">账本还是空的</div>' +
          '<p class="pf-tip">回到聊天说一句「中午黄焖鸡18」就能记账；也可以切到上方「导入 CSV」把微信 / 支付宝账单导进来。</p></div>';
      } else {
        failHtml = analysisFailCard(analysisData, statusEl);
      }
      reportEl.innerHTML = failHtml;
      if (toolbar) { toolbar.hidden = true; }
      return;
    }

    if (toolbar) { toolbar.hidden = isCurrent ? true : false; }
    var excludeDup = !!($('analysisExcludeDup') && $('analysisExcludeDup').checked);
    var rep = ANA.report(analysisData.rows, {
      month: analysisData.month,
      excludeDuplicates: excludeDup,
      files: analysisData.files
    });
    analysisData.report = rep;

    if (statusEl) {
      var okCount = analysisData.files.filter(function (f) { return f.ok; }).length;
      var extraNotes = [];
      if (rep.parseInfo.excludedTransfer > 0) {
        extraNotes.push(rep.parseInfo.excludedTransfer + ' 条转账/还款不计入统计');
      }
      if (rep.parseInfo.excludedDuplicate > 0) {
        extraNotes.push(rep.parseInfo.excludedDuplicate + ' 条疑似重复' +
          (excludeDup ? '已排除' : '仅标记未排除'));
      }
      var statusText = '已解析 ' + okCount + ' / ' + analysisData.files.length + ' 个文件，' +
        rep.meta.validCount + ' 条有效记录' +
        (extraNotes.length ? '（另有 ' + extraNotes.join('、') + '）' : '') +
        '。';
      if (rep.parseInfo.transferIncomeCount > 0) {
        statusText += '其中 ' + rep.parseInfo.transferIncomeCount +
          ' 条为转账型收入，已计入；若为本人账户互转请手动排除。';
      }
      statusEl.textContent = statusText + '数据只在本机，没有上传。';
    }
    if (isCurrent && statusEl) {
      statusEl.textContent = '数据来自你当前账本（' + analysisData.rows.length +
        ' 条记录），仅在本地分析，没有上传。';
    }

    var ov = rep.overview;
    var monthOptions = (analysisData.months || [ov.month]).map(function (m) {
      return '<option value="' + esc(m) + '"' + (m === ov.month ? ' selected' : '') + '>' + esc(m) + '</option>';
    }).join('');

    var hintEl = $('analysisMonthHint');
    if (hintEl) {
      hintEl.textContent = '统计月份 ' + ov.month + ' · 与上月 ' + ov.prevMonth + ' 对比';
    }

    var html = '<div class="report-top">' +
      '<label class="month-pick">统计月份 <select data-act="analysis-month">' + monthOptions + '</select></label>' +
      '<span class="hint">共 ' + rep.meta.rowCount + ' 条原始记录</span>' +
      '</div>';

    /* ---- 建议 ---- */
    var budgetState = ENG.getBudgetState({
      total: state.budget.total,
      spent: ov.expense,
      remainingDays: getOverview().cycle.remainingDays,
      todaySpent: 0
    });
    var insightList = ANA.insights(rep, budgetState);
    if (insightList.length > 0) {
      html += '<div class="insight-box"><div class="insight-title">给你的 ' + insightList.length + ' 条建议</div>';
      insightList.forEach(function (it) {
        html += '<div class="insight-item ' + (it.level === 'warn' ? 'warn' : 'tip') + '">' +
          '<div class="insight-head">' + (it.level === 'warn' ? ic('alert', 'bico-warn', '提醒') : ic('bulb', 'bico-brand', '建议')) + esc(it.title) + '</div>' +
          '<div class="insight-evidence">' + esc(it.evidence) + '</div>' +
          '<div class="insight-action">' + esc(it.action) + '</div>' +
          '</div>';
      });
      html += '</div>';
    }

    /* ---- 1. 总览 ---- */
    var prevText = '—';
    if (ov.hasPrev) {
      prevText = ov.expenseDeltaPercent === null
        ? '—'
        : (ov.expenseDeltaPercent >= 0 ? '+' : '') + ov.expenseDeltaPercent.toFixed(1) + '%';
    }
    html += reportSection('1. 总览', '' +
      '<div class="stat-grid">' +
      '  <div><b>' + money(ov.expense) + '</b><small>总支出</small></div>' +
      '  <div><b class="pos">' + money(ov.income) + '</b><small>总收入</small></div>' +
      '  <div><b class="' + (ov.balance < 0 ? 'neg' : '') + '">' + money(ov.balance) + '</b><small>结余</small></div>' +
      '  <div><b>' + ov.count + '</b><small>支出笔数</small></div>' +
      '</div>' +
      /* 收支对比：一眼看出这个月是「收大于支」还是「入不敷出」 */
      anaColsHtml([
        { label: '总支出', value: ov.expense, color: '#F2643C' },
        { label: '总收入', value: ov.income, color: '#07C160' }
      ], { height: 112 }) +
      '<div class="sec-note">' + (ov.balance >= 0
        ? '收入比支出多 ' + money(ov.balance) + '，这个月是攒下钱了的。'
        : '支出比收入多 ' + money(Math.abs(ov.balance)) + '，这个月在吃老本。') + '</div>' +
      '<div class="kv-list">' +
      '  <div class="kv"><span>笔均</span><b>' + money(ov.avgPerTx) + '</b></div>' +
      '  <div class="kv"><span>日均（' + ov.activeDays + ' 个有记录的天）</span><b>' + money(ov.avgPerDay) + '</b></div>' +
      '  <div class="kv"><span>与上月（' + ov.prevMonth + '）支出对比</span><b>' + prevText + '</b></div>' +
      '  <div class="kv"><span>储蓄率</span><b>' + (ov.savingsRate === null ? '—' : ov.savingsRate.toFixed(1) + '%') + '</b></div>' +
      '</div>', true);

    /* ---- 2. 分类占比与环比 ---- */
    var cats = rep.categories || [];
    var catBody = '';
    if (cats.length === 0) {
      catBody = emptyLine('本月没有支出记录');
    } else {
      /* 图形：长度 = 占本月支出的百分比，右侧显示金额 + 占比，小字给笔数/笔均/环比 */
      var catItems = cats.map(function (c) {
        var deltaTxt = c.deltaPercent === null ? '环比 —'
          : '环比 ' + (c.deltaPercent >= 0 ? '↑' : '↓') + Math.abs(c.deltaPercent).toFixed(1) + '%';
        return {
          label: '<span class="ana-cat-ico" style="' + spCatTileStyle(c.category) + '">' +
            spCatIcon(c.category) + '</span>' + esc(c.category),
          sub: c.count + ' 笔 · 笔均 ' + money(c.avg) + ' · ' + deltaTxt,
          value: c.amount,
          text: money(c.amount) + '　' + c.percent.toFixed(1) + '%',
          color: categoryColor(c.category)
        };
      });
      catBody = anaRankHtml(catItems) +
        '<div class="sec-note">条形长度 = 占本月支出的百分比。↑ 表示比上月多花了。</div>' +
        '<details class="ana-sub"><summary>完整数据表（金额 / 占比 / 笔数 / 笔均 / 环比）</summary>' +
        '<table class="report-table"><thead><tr>' +
        '<th>分类</th><th>金额</th><th>占比</th><th>笔数</th><th>笔均</th><th>环比</th>' +
        '</tr></thead><tbody>';
      var i;
      for (i = 0; i < cats.length; i++) {
        var cc = cats[i];
        catBody += '<tr><td>' + esc(cc.category) + '</td>' +
          '<td>' + money(cc.amount) + '</td>' +
          '<td>' + cc.percent.toFixed(1) + '%</td>' +
          '<td>' + cc.count + '</td>' +
          '<td>' + money(cc.avg) + '</td>' +
          '<td class="' + (cc.deltaPercent === null ? '' : (cc.deltaPercent > 0 ? 'neg' : 'pos')) + '">' +
          (cc.deltaPercent === null ? '—' : (cc.deltaPercent >= 0 ? '+' : '') + cc.deltaPercent.toFixed(1) + '%') +
          '</td></tr>';
      }
      catBody += '</tbody></table></details>';
    }
    html += reportSection('2. 分类占比与环比', catBody, true,
      cats.length ? (cats.length + ' 类 · 最大 ' + esc(cats[0].category) + ' ' + cats[0].percent.toFixed(1) + '%') : '无');

    /* ---- 3. Top 10 单笔大额 ---- */
    var topBody = '';
    if (rep.topExpenses.length === 0) {
      topBody = emptyLine('本月没有支出记录');
    } else {
      var topSum = 0;
      rep.topExpenses.forEach(function (x) { topSum += x.amount; });
      topSum = ENG.round2(topSum);
      var topItems = rep.topExpenses.map(function (x) {
        var who = x.counterparty || x.desc || '支出';
        var share = ov.expense > 0 ? Math.round(x.amount / ov.expense * 1000) / 10 : 0;
        return {
          label: esc(anaShortDate(x.date) + ' · ' + who),
          sub: esc(x.desc && x.desc !== who ? x.desc : '') + '　占本月支出 ' + share + '%',
          value: x.amount,
          text: money(x.amount),
          color: '#F2643C'
        };
      });
      topBody = anaRankHtml(topItems) +
        '<div class="sec-note">条形长度 = 单笔金额（最长的那笔为满格）。这 ' + rep.topExpenses.length +
        ' 笔合计 ' + money(topSum) + '，占本月支出 ' +
        (ov.expense > 0 ? (topSum / ov.expense * 100).toFixed(1) : '0.0') + '%。</div>';
    }
    html += reportSection('3. Top 10 单笔大额', topBody, false,
      rep.topExpenses.length ? (rep.topExpenses.length + ' 笔 · 最大 ' + money(rep.topExpenses[0].amount)) : '无');

    /* ---- 4. Top 10 高频商户 ---- */
    var merBody = '';
    if (rep.topMerchants.length === 0) {
      merBody = emptyOk('没有可统计的商户（多为转账或未记录对方名）');
    } else {
      var merItems = rep.topMerchants.map(function (x) {
        return {
          label: esc(x.name) + ' · ' + x.count + ' 笔',
          sub: '笔均 ' + money(x.avg),
          value: x.count,
          text: money(x.amount),
          color: '#07C160'
        };
      });
      merBody = anaRankHtml(merItems) +
        '<div class="sec-note">条形长度 = 出现笔数，右侧数字 = 总金额。次数多但金额高的商户最值得盯着。</div>';
    }
    html += reportSection('4. Top 10 高频商户', merBody, false,
      rep.topMerchants.length ? (rep.topMerchants.length + ' 家 · 榜首 ' + esc(rep.topMerchants[0].name)) : '无');

    /* ---- 5. 周末 vs 工作日 ---- */
    var wv = rep.weekendVsWeekday;
    html += reportSection('5. 周末 vs 工作日', '' +
      anaColsHtml([
        { label: '周末日均', value: wv.weekend.avg, color: '#F2643C', sub: wv.weekend.days + ' 天' },
        { label: '工作日日均', value: wv.weekday.avg, color: '#07C160', sub: wv.weekday.days + ' 天' }
      ]) +
      '<div class="ana-tiles">' +
      '<div class="ana-tile"><b>' + wv.weekend.count + ' 笔 / ' + money(wv.weekend.amount) + '</b>' +
      '<small>周末合计（日均 ' + money(wv.weekend.avg) + '）</small></div>' +
      '<div class="ana-tile"><b>' + wv.weekday.count + ' 笔 / ' + money(wv.weekday.amount) + '</b>' +
      '<small>工作日合计（日均 ' + money(wv.weekday.avg) + '）</small></div>' +
      '</div>' +
      '<div class="sec-note">周末日均 / 工作日日均 = ' +
      (wv.ratio === null ? '—' : wv.ratio.toFixed(2) + ' 倍') + '（比的是日均，不是总额）。' +
      (wv.ratio !== null && wv.ratio > 1.3 ? '周末明显更能花，试试给周末定一个出门预算。' : '') + '</div>', false,
      '日均 ' + money(wv.weekend.avg) + ' vs ' + money(wv.weekday.avg));

    /* ---- 6. 订阅型支出 ---- */
    var subBody = '';
    if (rep.subscriptions.length === 0) {
      subBody = emptyOk('没有发现订阅型支出：没有「连续 3 个月 + 同商户 + 同金额」的固定扣款');
    } else {
      var subMonthly = 0;
      var subAnnual = 0;
      rep.subscriptions.forEach(function (s) {
        subMonthly = ENG.round2(subMonthly + s.amount);
        subAnnual = ENG.round2(subAnnual + s.annual);
      });
      var subItems = rep.subscriptions.map(function (s) {
        return {
          label: esc(s.name) + (s.activeThisMonth ? '' : ' · 本月未再扣'),
          sub: '连续 ' + s.months + ' 个月 · 每月 ' + money(s.amount) + ' · 折合一年 ' + money(s.annual),
          value: s.annual,
          text: money(s.amount) + '/月',
          color: s.activeThisMonth ? '#F59E0B' : '#B9C0CA'
        };
      });
      subBody = anaTilesHtml([
        { value: rep.subscriptions.length + ' 个', label: '订阅数' },
        { value: money(subMonthly), label: '每月固定扣' },
        { value: money(subAnnual), label: '折合一年', tone: 'warn' }
      ]) + anaRankHtml(subItems) +
        '<div class="sec-note">条形长度 = 折合一年的花费。灰色表示本月已不再扣这笔，可以核对是不是忘了续订或已取消。</div>';
    }
    html += reportSection('6. 订阅型支出', subBody, false,
      rep.subscriptions.length ? (rep.subscriptions.length + ' 个 · 一年 ' + money(rep.subscriptions.reduce(function (a, s) { return a + s.annual; }, 0))) : '未发现');

    /* ---- 7. 异常大额 ---- */
    var anomBody = '';
    if (rep.anomalies.length === 0) {
      anomBody = emptyOk('没有异常大额：没有单笔超过该分类其余笔均 3 倍的支出');
    } else {
      var anomMax = 0;
      var anomExtra = 0;
      rep.anomalies.forEach(function (a) {
        if (a.amount > anomMax) { anomMax = a.amount; }
        anomExtra = ENG.round2(anomExtra + (a.amount - a.othersAvg));
      });
      var anomItems = rep.anomalies.map(function (a) {
        return {
          label: esc(anaShortDate(a.date) + ' · ' + (a.counterparty || a.category)),
          sub: esc(a.category) + ' · 其余笔均 ' + money(a.othersAvg) + ' · <b>' + a.times.toFixed(1) + '×</b>',
          value: a.amount,
          text: money(a.amount),
          color: '#EF4444',
          mark: anomMax > 0 ? Math.min(100, a.othersAvg / anomMax * 100) : 0
        };
      });
      anomBody = anaTilesHtml([
        { value: rep.anomalies.length + ' 笔', label: '异常笔数' },
        { value: money(anomExtra), label: '比平时多花的钱', tone: 'bad' }
      ]) + anaRankHtml(anomItems, { max: anomMax }) +
        '<div class="sec-note">条形里的<b>白色竖线</b>是该分类「其余笔均」的位置：红线超过它越多，这一笔越突兀。（阈值：单笔 ≥ 该分类其余笔均的 3 倍）</div>';
    }
    html += reportSection('7. 异常大额', anomBody, false,
      rep.anomalies.length ? (rep.anomalies.length + ' 笔 · 最高 ' + money(rep.anomalies[0].amount)) : '无');

    /* ---- 8. 疑似重复 ---- */
    var dupBody = '';
    if (rep.duplicates.length === 0) {
      dupBody = emptyOk('没有疑似重复：没有「同日期 + 同金额 + 同对方」的多条记录');
    } else {
      var dupExtra = 0;
      var dupRows = 0;
      var dupMax = 0;
      rep.duplicates.forEach(function (g) {
        dupExtra = ENG.round2(dupExtra + g.amount * (g.items.length - 1));
        dupRows += g.items.length;
        if (g.amount > dupMax) { dupMax = g.amount; }
      });
      dupBody = anaTilesHtml([
        { value: rep.duplicates.length + ' 组', label: '疑似重复' },
        { value: money(dupExtra), label: '重复计入的金额', tone: 'bad' },
        { value: dupRows + ' 条', label: '涉及记录' }
      ]) + '<div class="sec-note">默认只标记不删除；勾选上方开关可排除后重新统计。</div>';
      rep.duplicates.forEach(function (g) {
        dupBody += '<div class="dup-item">' +
          '<b>' + esc(g.date) + '　' + money(g.amount) + '　' + esc(g.counterparty || '—') + '</b>' +
          anaRankHtml([{
            label: '重复 ' + g.items.length + ' 次',
            sub: '多算 ' + money(ENG.round2(g.amount * (g.items.length - 1))),
            value: g.amount,
            text: money(g.amount),
            color: '#EF4444'
          }], { max: dupMax }) +
          '<ul>';
        g.items.forEach(function (it) {
          dupBody += '<li>' + esc(it.file) + ' 第 ' + it.row + ' 行：' + esc(it.desc || '—') + '</li>';
        });
        dupBody += '</ul></div>';
      });
    }
    html += reportSection('8. 疑似重复', dupBody, false,
      rep.duplicates.length ? (rep.duplicates.length + ' 组 · 涉及 ' + money(
        rep.duplicates.reduce(function (a, g) { return a + g.amount; }, 0))) : '无');

    /* ---- 9. 解析情况 ---- */
    var okFiles = rep.parseInfo.files.filter(function (f) { return f.ok; }).length;
    var validTotal = 0;
    var badTotal = 0;
    rep.parseInfo.files.forEach(function (f) {
      validTotal += f.records;
      badTotal += (f.skipped || 0) + (f.skippedBefore || 0);
    });
    var fileBody = anaTilesHtml([
      { value: okFiles + ' / ' + rep.parseInfo.files.length, label: '解析成功的文件' },
      { value: validTotal + ' 条', label: '有效记录' },
      { value: badTotal + ' 行', label: '被跳过的行', tone: badTotal > 0 ? 'warn' : '' }
    ]);
    rep.parseInfo.files.forEach(function (f) {
      fileBody += '<div class="ana-file">' +
        '<div class="ana-file-hd"><b>' + esc(f.name) + '</b>' +
        '<span class="rs-chip">' + (f.ok ? esc(f.encoding || '') + ' · 第 ' + f.headerRow + ' 行表头'
          : '解析失败') + '</span></div>' +
        anaStackHtml([
          { label: '有效记录', value: f.records, color: '#07C160' },
          { label: '前置说明行', value: f.skippedBefore || 0, color: '#C9CFD8' },
          { label: '无效数据行', value: f.skipped || 0, color: '#EF4444' }
        ], { text: function (s) { return s.value + ' 行'; } }) +
        '</div>';
    });
    fileBody += '<details class="ana-sub"><summary>列映射与技术细节</summary>' +
      '<table class="report-table"><thead><tr><th>文件</th><th>编码</th><th>表头行</th><th>有效</th>' +
      '<th>前置说明行</th><th>无效数据行</th><th>列映射</th></tr></thead><tbody>';
    rep.parseInfo.files.forEach(function (f) {
      fileBody += '<tr><td>' + esc(f.name) + '</td><td>' + esc(f.encoding || '—') + '</td>' +
        '<td>' + (f.headerRow || '—') + '</td><td>' + f.records + '</td>' +
        '<td>' + (f.skippedBefore || 0) + '</td><td>' + (f.skipped || 0) + '</td>' +
        '<td class="col-map">' + esc(ANA.columnMapText(f.columns, true)) + '</td></tr>';
    });
    fileBody += '</tbody></table></details>';
    if (rep.parseInfo.files.some(function (f) { return !f.ok; })) {
      fileBody += '<div class="sec-note warn-text">未解析成功的文件：' +
        rep.parseInfo.files.filter(function (f) { return !f.ok; })
          .map(function (f) { return esc(f.name + '（' + (f.reason || '未知原因') + '）'); }).join('、') + '</div>';
    }
    html += reportSection('9. 解析情况', fileBody, false,
      okFiles + '/' + rep.parseInfo.files.length + ' 个文件 · ' + validTotal + ' 条有效');

    /* ---- 值不值 · 我的自评（仅当前账本模式） ---- */
    if (isCurrent) {
      var ws = worthStats(state.bills);
      html += reportSection('值不值 · 我的自评', worthSectionHtml(ws), true);
    }

    reportEl.innerHTML = html;
  }

  /** 导出分析报告 Markdown */
  function exportAnalysisMarkdown() {
    if (!analysisData || !analysisData.report) {
      addAIMessage(aiBubble('还没有可以导出的分析结果，先导入一份账单 CSV 吧。'));
      return;
    }
    var text = ANA.toMarkdown(analysisData.report);
    downloadText('账单分析_' + (analysisData.report.overview.month || 'report') + '.md', text, 'text/markdown;charset=utf-8');
  }

  /** 把导入记录并入账本（二次确认） */
  function confirmImportAnalysis() {
    if (!analysisData || !analysisData.rows || analysisData.rows.length === 0) {
      addAIMessage(aiBubble('还没有可并入的导入记录。'));
      return;
    }
    var excludeDup = !!($('analysisExcludeDup') && $('analysisExcludeDup').checked);
    var drafts = ANA.rowsToBills(analysisData.rows, {
      month: analysisData.month,
      excludeDuplicates: excludeDup
    });
    if (drafts.length === 0) {
      addAIMessage(aiBubble('这个月没有可并入的支出/收入记录。'));
      return;
    }
    var box = openModal('' +
      '<h4>把 ' + drafts.length + ' 条记录并入账本？</h4>' +
      '<p><b>这会让本周期预算统计发生变化</b>：并入的支出会立刻占用预算额度，日均可用会重新计算。</p>' +
      '<p>只并入 ' + esc(analysisData.month) + ' 的记录，转账 / 还款类已在导入时排除。此操作不会自动去重，重复导入会产生重复账单。</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-cancel" data-act="modal-cancel">再想想</button>' +
      '<button type="button" class="btn-ok" data-act="import-ok">确认并入</button>' +
      '</div>');
    box.querySelector('[data-act="modal-cancel"]').addEventListener('click', closeModal);
    box.querySelector('[data-act="import-ok"]').addEventListener('click', function () {
      var i;
      var count = 0;
      for (i = 0; i < drafts.length; i++) {
        commitBill(drafts[i]);
        count += 1;
      }
      closeModal();
      renderAll();
      closeAnalysisSheet();
      addAIMessage(aiBubble('已把 ' + count + ' 条记录并入账本（' + esc(analysisData.month) +
        '），预算统计已重新计算。如果数字不对，可以用「重置演示数据」回到初始状态。'));
    });
  }

  /** 清空导入（只清分析缓存，不动账本） */
  function clearAnalysis() {
    analysisData = null;
    var statusEl = $('analysisStatus');
    if (statusEl) { statusEl.textContent = '还没有导入文件。支持 CSV / Excel（.xlsx）；PDF 和老版 .xls 不支持，请先另存为 .xlsx 或 CSV。'; }
    var fileInput = $('analysisFile');
    if (fileInput) { fileInput.value = ''; }
    var toolbar = $('analysisToolbar');
    if (toolbar) { toolbar.hidden = true; }
    var reportEl = $('analysisReport');
    if (reportEl) { reportEl.innerHTML = ''; }
  }

  /* ================================================================== */
  /* 导入账单（微信 / 支付宝 / 银行 CSV）→ 直接并入账本                    */
  /* ================================================================== */

  var importState = null;

  function openImportSheet() {
    $('importMask').hidden = false;
    renderImportPreview();
  }

  function closeImportSheet() {
    $('importMask').hidden = true;
  }

  /** 把用户选择的 CSV / TXT / XLSX 交给统一解析入口，再预览并入账本。 */
  function handleImportFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (files.length === 0) { return; }
    var metas = [];
    var pending = files.length;
    var statusEl = $('importStatus');
    if (statusEl) { statusEl.textContent = '正在解析 ' + files.length + ' 个文件…'; }

    function done() {
      pending -= 1;
      if (pending > 0) { return; }
      var built = ANA.buildRows(metas);
      var monthCount = {};
      var i;
      for (i = 0; i < built.rows.length; i++) {
        var mk = built.rows[i].month || built.rows[i].date.slice(0, 7);
        monthCount[mk] = (monthCount[mk] || 0) + 1;
      }
      var monthList = Object.keys(monthCount).sort();
      // 默认看「记录最多的那个月」（平手取较新月份）
      var month = monthList.length > 0 ? monthList[monthList.length - 1] : ENG.formatDate(new Date()).slice(0, 7);
      var bestCount = -1;
      for (i = 0; i < monthList.length; i++) {
        if (monthCount[monthList[i]] >= bestCount) {
          bestCount = monthCount[monthList[i]];
          month = monthList[i];
        }
      }
      importState = {
        rows: built.rows,
        files: built.files,
        duplicates: built.duplicates,
        months: monthList,
        month: month
      };
      renderImportPreview();
    }

    files.forEach(function (file, index) {
      var reader = new FileReader();
      reader.onload = function () {
        parseBillImportFile(file, reader.result).then(function (parsed) {
          metas[index] = parsed;
          done();
        }, function (error) {
          metas[index] = importParseFailure(file.name,
            '解析失败：' + (error && error.message ? error.message : '未知错误'));
          done();
        });
      };
      reader.onerror = function () {
        metas[index] = { name: file.name, ok: false, reason: '读取文件失败', records: [], skipped: 0 };
        done();
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /** 计算「将要导入」的账单草稿，并与账本已有记录按 日期+金额+备注 去重 */
  function computeImportDrafts() {
    if (!importState || !importState.rows) { return { toImport: [], skipDup: 0 }; }
    var excludeFileDup = !!($('importExcludeFileDup') && $('importExcludeFileDup').checked);
    var excludeLedgerDup = !!($('importExcludeDup') && $('importExcludeDup').checked);
    var month = importState.month;
    var drafts = ANA.rowsToBills(importState.rows, {
      month: month,
      excludeDuplicates: excludeFileDup
    });
    var ledgerKeys = {};
    state.bills.forEach(function (b) {
      ledgerKeys[b.date + '|' + ENG.round2(b.amount).toFixed(2) + '|' + String(b.note || '').trim()] = true;
    });
    var toImport = [];
    var skipDup = 0;
    drafts.forEach(function (d) {
      var key = d.date + '|' + ENG.round2(d.amount).toFixed(2) + '|' + String(d.note || '').trim();
      if (excludeLedgerDup && ledgerKeys[key]) { skipDup += 1; return; }
      toImport.push(d);
    });
    return { toImport: toImport, skipDup: skipDup };
  }

  /** 渲染导入预览：解析统计 + 月份/去重控件 + 预览列表 */
  function renderImportPreview() {
    var reportEl = $('importReport');
    var statusEl = $('importStatus');
    var controls = $('importControls');
    if (!reportEl) { return; }

    if (!importState || !importState.rows || importState.rows.length === 0) {
      if (controls) { controls.hidden = true; }
      reportEl.innerHTML = analysisFailCard(importState, statusEl);
      return;
    }

    var rows = importState.rows;
    var computed = computeImportDrafts();
    var toImport = computed.toImport;
    var skipDup = computed.skipDup;

    var inc = 0, exp = 0, excl = 0;
    rows.forEach(function (r) {
      if (r.excluded) { excl += 1; }
      else if (r.type === 'income') { inc += 1; }
      else { exp += 1; }
    });

    if (statusEl) {
      var okCount = importState.files.filter(function (f) { return f.ok; }).length;
      var badFiles = importState.files.filter(function (f) { return !f.ok; });
      var msg = '已解析 ' + okCount + ' / ' + importState.files.length + ' 个文件，共 ' + rows.length + ' 条记录。';
      if (badFiles.length > 0) {
        msg += '（' + badFiles.length + ' 个文件未识别：' +
          badFiles.map(function (f) { return esc(f.name) + (f.reason ? '(' + esc(f.reason) + ')' : ''); }).join('、') + '）';
      }
      statusEl.textContent = msg;
    }

    if (controls) {
      controls.hidden = false;
      var sel = $('importMonth');
      if (sel) {
        sel.innerHTML = (importState.months || []).map(function (m) {
          return '<option value="' + m + '"' + (m === importState.month ? ' selected' : '') + '>' + m + '</option>';
        }).join('');
      }
    }

    var html = '';
    html += '<div class="import-summary">';
    html += '  <div class="isum isum-inc"><b>' + inc + '</b><small>收入</small></div>';
    html += '  <div class="isum isum-exp"><b>' + exp + '</b><small>支出</small></div>';
    html += '  <div class="isum isum-excl"><b>' + excl + '</b><small>已排除(转账/还款)</small></div>';
    html += '  <div class="isum isum-imp"><b>' + toImport.length + '</b><small>将导入</small></div>';
    if (skipDup > 0) { html += '  <div class="isum isum-skip"><b>' + skipDup + '</b><small>与账本重复</small></div>'; }
    html += '</div>';
    html += '<p class="import-note">将导入 <b>' + toImport.length + '</b> 条到 <b>' + esc(importState.month) + '</b>' +
      (skipDup > 0 ? '（已跳过 ' + skipDup + ' 条与账本重复的）' : '') + '。转账 / 还款已自动排除，导入后预算统计立即重算。</p>';

    var preview = toImport.slice(0, 40);
    if (preview.length > 0) {
      html += '<div class="import-list">';
      preview.forEach(function (d) {
        var cls = d.type === 'income' ? 'in' : 'out';
        var sign = d.type === 'income' ? '+' : '-';
        html += '<div class="import-row ' + cls + '">' +
          '<span class="ir-date">' + esc(d.date) + '</span>' +
          '<span class="ir-note">' + esc(d.note || d.category) + '</span>' +
          '<span class="ir-cat">' + esc(d.category) + '</span>' +
          '<span class="ir-amt">' + sign + money(d.amount) + '</span>' +
          '</div>';
      });
      if (toImport.length > preview.length) {
        html += '<div class="import-more">…还有 ' + (toImport.length - preview.length) + ' 条</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="sec-empty">没有可导入的记录（可能都被月份筛选或去重过滤掉了）。</div>';
    }

    reportEl.innerHTML = html;
    importState._toImport = toImport;
    importState._skipDup = skipDup;
  }

  /** 确认把预览中的记录并入账本 */
  function confirmImportBills() {
    if (!importState || !importState.rows || importState.rows.length === 0) {
      addAIMessage(aiBubble('还没有可导入的记录。'));
      return;
    }
    var toImport = importState._toImport;
    if (!toImport || toImport.length === 0) {
      addAIMessage(aiBubble('没有可导入的记录（可能都和账本重复，或被月份筛选过滤掉了）。'));
      return;
    }
    var count = 0;
    toImport.forEach(function (d) {
      commitBill(d, true); // 导入批量账单不进单步撤回栈
      count += 1;
    });
    renderAll();
    closeImportSheet();
    addAIMessage(aiBubble('已导入 ' + count + ' 条账单（' + esc(importState.month) +
      '）。转账 / 还款已自动排除，预算统计已重新计算。回到聊天可以给每笔「值不值」打分～'));
    importState = null;
  }

  /** 清空导入（只清缓存，不动账本） */
  function clearImport() {
    importState = null;
    var statusEl = $('importStatus');
    if (statusEl) { statusEl.textContent = '还没有选择文件。'; }
    var fileInput = $('importFile');
    if (fileInput) { fileInput.value = ''; }
    var controls = $('importControls');
    if (controls) { controls.hidden = true; }
    var reportEl = $('importReport');
    if (reportEl) { reportEl.innerHTML = ''; }
  }

  /* ================================================================== */
  /* 截屏记账（三层降级）                                                */
  /* ================================================================== */

  var ocrPendingFile = null;
  var ocrDemoIndex = -1;
  /** 演示结果与用户图片并存时置 true：禁止预览图再被"读图完成"回调重新显示 */
  var ocrPreviewSuppressed = false;

  function ocrSourceText(source) {
    if (source === 'native') { return '本地识别（零网络）'; }
    if (source === 'cloud') { return '云端 OCR'; }
    if (source === 'demo') { return '演示样例'; }
    return '未知来源';
  }

  /**
   * 打开弹窗时就把「这台设备能做什么」说清楚，别让用户点了「开始识别」才发现不行。
   * @return {string}
   */
  /* 兼容旧调用点：刷新 OCR 弹窗里的能力提示（实际能力来自 WorkBuddy 云服务） */
  function refreshBackendCaps() {
    if ($('ocrMask') && !$('ocrMask').hidden) {
      $('ocrStatus').className = ocrCapabilityClass();
      $('ocrStatus').textContent = ocrCapabilityText();
    }
  }

  function ocrCapabilityText() {
    var cap = OCR.capabilities();
    if (cap.native) { return '可以离线识别：这台设备支持本地文字识别，截图不会离开这台设备。'; }
    if (cloudReady && visionAvailable) {
      return '将用 WorkBuddy 视觉大模型识别（需要联网）：截图会发给云端识别，金额/分类仍需你确认。';
    }
    if (cloudReady) {
      return '已连接 WorkBuddy 云服务，可以试试截图识别（若当前模型不支持看图，会提示你手动录入）。';
    }
    if (cap.cloud) { return '将用云端识别（需要联网）：会调用已配置的云 OCR，图片会上传。'; }
    return '正在连接 WorkBuddy 云服务…若长时间未连上，请用线上版本打开本应用：' + CLOUD_APP_URL;
  }

  /** 能力不足时状态行用警示色，避免用户以为"点一下就好" */
  function ocrCapabilityClass() {
    var cap = OCR.capabilities();
    var ok = cap.native || cap.cloud || cloudOcrAvailable();
    return ok ? 'ocr-status' : 'ocr-status warn';
  }

  /**
   * 把 detect() 内部（面向开发）的 reason 翻译成人话，只影响展示层。
   * 典型场景：显式 native / cloud 模式失败时会把底层 reason 直接冒到 UI 上。
   * @param {string} reason
   * @return {string}
   */
  function humanizeOcrReason(reason) {
    var s = String(reason === undefined || reason === null ? '' : reason);
    if (!s) { return '识别没有成功，可以直接手动录入。'; }
    var pairs = [
      [/当前浏览器不支持本地文字识别（TextDetector）/g, '这台设备的浏览器不支持离线识别文字'],
      [/当前浏览器不支持本地文字识别\(TextDetector\)/g, '这台设备的浏览器不支持离线识别文字'],
      [/无法读取图片（需要可用的图片文件）/g, '没能读到这张图片，请重新选一张截图'],
      [/本地识别没有读到文字/g, '这台设备的本地识别没有从图片里读到文字（图片可能太模糊、字太小）'],
      [/本地识别没有返回结果/g, '这台设备的本地识别没有返回结果'],
      [/还没有配置云 OCR 凭据/g, '还没有配置云 OCR'],
      [/当前浏览器不支持 Web Crypto，无法签名/g, '这台设备的浏览器缺少云 OCR 需要的加密能力'],
      [/当前环境不支持网络请求/g, '这台设备当前不允许发起网络请求']
    ];
    var i;
    for (i = 0; i < pairs.length; i++) {
      s = s.replace(pairs[i][0], pairs[i][1]);
    }
    return s;
  }

  function renderOcrSamples() {
    var host = $('ocrDemoList');
    if (!host) { return; }
    var html = '<span class="ocr-demo-label">演示样例：</span>';
    OCR.SAMPLES.forEach(function (s, i) {
      html += '<button type="button" class="chip" data-act="ocr-sample" data-index="' + i + '">' +
        esc(s.title) + '</button>';
    });
    host.innerHTML = html;
  }

  function openOcrModal() {
    /* 隐私开关：关闭「允许读取相册」时不允许进入截屏记账 */
    if (!getSettings().privacy.album) {
      showToast('已关闭「允许读取相册」，截屏记账不可用；可在 设置 → 数据与隐私 中打开');
      return;
    }
    ocrPendingFile = null;
    ocrImageDataUrl = '';
    ocrDraft = null;
    ocrDemoIndex = -1;
    ocrPreviewSuppressed = false;
    $('ocrMask').hidden = false;
    var preview = $('ocrPreview');
    preview.hidden = true;
    preview.removeAttribute('src');
    $('ocrResult').innerHTML = '';
    $('ocrStatus').className = ocrCapabilityClass();
    $('ocrStatus').textContent = ocrCapabilityText();
    var fileInput = $('ocrFile');
    if (fileInput) { fileInput.value = ''; }
    renderOcrSamples();
    var runBtn = $('btnOcrRun');
    if (runBtn) { runBtn.disabled = false; runBtn.textContent = '开始识别'; }
  }

  function closeOcrModal() {
    $('ocrMask').hidden = true;
    ocrPendingFile = null;
    ocrImageDataUrl = '';
    ocrDraft = null;
    ocrPreviewSuppressed = false;
  }

  function handleOcrFile(file) {
    if (!file) { return; }
    if (String(file.type || '').indexOf('image') === -1) {
      $('ocrStatus').textContent = '这个文件不是图片，请选择截图（png / jpg）。';
      return;
    }
    ocrPendingFile = file;
    ocrDemoIndex = -1;
    ocrPreviewSuppressed = false;
    /* 换了新图：清掉上一次的结果卡，避免"旧结果（可能是示例）"和新图片同时在场 */
    $('ocrResult').innerHTML = '';
    var reader = new FileReader();
    reader.onload = function () {
      ocrImageDataUrl = String(reader.result || '');
      var preview = $('ocrPreview');
      preview.src = ocrImageDataUrl;
      preview.hidden = ocrPreviewSuppressed;
      var cap = OCR.capabilities();
      var backendOk = cloudOcrAvailable();
      var canOcr = cap.native || cap.cloud || backendOk;
      $('ocrStatus').className = ocrCapabilityClass();
      $('ocrStatus').textContent = canOcr
        ? '图片已就绪，点「开始识别」。'
        : '图片已就绪，但这台设备/后端都没有可用的文字识别能力 —— 你可以直接用示例小票演示或手动录入。';
    };
    reader.onerror = function () {
      $('ocrStatus').textContent = '读取图片失败，请重新选择。';
    };
    reader.readAsDataURL(file);
  }

  /**
   * 失败原因归到哪一层：读不到图 / 云端失败 / 本地失败 / 设备没能力。
   * 文案不能写死 —— 已配置云 OCR、只是云端请求失败（跨域/断网）的用户，
   * 不该被告知"缺少本地识别能力"再被建议"去配置云 OCR"。
   * @param {Object} result detect() 的失败结果（含 reason / tried / details）
   * @return {{title:string, status:string}}
   */
  function ocrFailureAttribution(result) {
    var reason = String((result && result.reason) || '');
    var tried = (result && result.tried) ? result.tried : [];
    var cap = OCR.capabilities();
    /* 「云端被尝试过」判定：优先看 tried，退回看 reason 里是否带云端原因 */
    var cloudTried = tried.indexOf('cloud') !== -1 || tried.indexOf('backend') !== -1 ||
      reason.indexOf('云端') !== -1 || reason.indexOf('后端') !== -1 || reason.indexOf('视觉') !== -1 ||
      reason.indexOf('WorkBuddy') !== -1;

    if (reason.indexOf('没有可用的图片数据') !== -1 || reason.indexOf('重新选一张截图') !== -1) {
      return {
        title: '没能读到这张截图 —— 请重新选一张图片',
        status: '这张图没能读到，重新选一张截图再试，或者直接手动录入。'
      };
    }
    if (cap.cloud && cloudTried) {
      return {
        title: '云端识别没成功 —— 凭据已配置，但这次请求失败',
        status: '没识别成功。不是你操作错了：凭据已配置，但这次云端请求失败了 —— ' +
          '检查一下网络或跨域限制，也可以核对凭据是否正确，或直接手动录入。'
      };
    }
    /* 走的是 WorkBuddy 云服务（免密钥）但没连上 / 调用失败：引导用线上版本打开 */
    if (reason.indexOf('WorkBuddy 云服务') !== -1 || reason.indexOf('云端') !== -1 || reason.indexOf('Vision') !== -1) {
      return {
        title: 'WorkBuddy 云服务没能识别 —— 可能没连上，或当前模型不支持看图',
        status: '没识别成功。不是你操作错了：已尝试用 WorkBuddy 云服务识别，但连接或调用失败了 —— ' +
          '请用线上版本打开本应用（' + CLOUD_APP_URL + '），确认能联网，或直接手动录入。'
      };
    }
    if (cap.native) {
      return {
        title: '本地识别没成功 —— 不是你操作的问题，这张图可能太模糊',
        status: '没识别成功。不是你操作错了：这台设备的本地识别没从图片里读出文字，' +
          '换一张更清晰的截图，或直接手动录入。'
      };
    }
    return {
      title: '没识别成功 —— 不是你操作的问题，是这台设备缺少本地识别能力',
      status: '没识别成功。不是你操作错了：这台设备没有可用的文字识别能力，' +
        '请用线上版本打开本应用以启用 WorkBuddy 云服务视觉识别（' + CLOUD_APP_URL + '），' +
        '也可以看示例小票或手动录入。'
    };
  }

  /**
   * 失败态卡片：一定要给出「下一步能做什么」，且第一条动作就是示例演示。
   * @param {string} reason 失败原因（会自动翻译成人话）
   * @param {string} [title] 卡片标题
   */
  function showOcrError(reason, title) {
    var host = $('ocrResult');
    /* 现在截图识别走 WorkBuddy 云服务（免密钥），没有「腾讯云 OCR 设置」可配；
       失败时这条按钮改为「打开线上版本」，引导用户用被云服务认可的来源打开。 */
    var useCloudApp = !!global.AJ_BACKEND_OCR;
    var cloudLabel = OCR.hasCredentials() ? '检查云 OCR 设置' : (useCloudApp ? '打开线上版本' : '配置云 OCR');
    var cloudAct = useCloudApp ? 'ocr-cloud-app' : 'ocr-cloud-config';
    host.innerHTML = '<div class="ocr-error">' +
      '<div class="ocr-error-title">' + esc(title || '这次没成功') + '</div>' +
      '<div class="ocr-error-text">' + esc(humanizeOcrReason(reason || '识别失败')) + '</div>' +
      '<div class="ocr-actions">' +
      '<button type="button" class="btn-mini primary" data-act="ocr-sample" data-index="0">用示例小票演示</button>' +
      '<button type="button" class="btn-mini" data-act="' + cloudAct + '">' + esc(cloudLabel) + '</button>' +
      '<button type="button" class="btn-mini" data-act="ocr-manual">手动录入</button>' +
      '</div></div>';
  }

  /** 用被云服务认可的线上来源打开本应用（AI 功能必须用它）。 */
  function openCloudAppLink() {
    try {
      if (typeof window.open === 'function') { window.open(CLOUD_APP_URL, '_blank'); }
    } catch (e) { /* 忽略弹窗被拦截 */ }
  }

  /**
   * 失败态「配置云 OCR」：关掉识别弹窗，打开设置抽屉并滚到云 OCR 区。
   * 抽屉里输入框有 id，用 closest 找区块，避免为了锚点多加 DOM 结构。
   */
  function openOcrCloudSettings() {
    closeOcrModal();
    openDrawer();
    var idInput = $('setOcrId');
    var section = idInput && idInput.closest ? idInput.closest('.drawer-group') : null;
    var target = section || idInput;
    if (!target) { return; }
    setTimeout(function () {
      if (typeof target.scrollIntoView === 'function') {
        try {
          target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } catch (e) {
          target.scrollIntoView();
        }
      }
      if (section) {
        section.classList.add('flash');
        setTimeout(function () { section.classList.remove('flash'); }, 1400);
      }
      if (idInput) { idInput.focus(); }
    }, 180);
  }

  function ocrConfidenceText(c) {
    if (c === 'high') { return { text: '置信度 高', cls: 'conf-high' }; }
    if (c === 'medium') { return { text: '置信度 中', cls: 'conf-medium' }; }
    return { text: '置信度 低', cls: 'conf-low' };
  }

  function renderOcrConfirm(result, parsed) {
    var conf = ocrConfidenceText(parsed.confidence);
    var categoryGuess = NLP.classify((parsed.merchant || '') + ' ' + (parsed.raw || ''));
    if (DATA.CATEGORY_KEYS.indexOf(categoryGuess) === -1) { categoryGuess = '其他'; }
    var options = DATA.CATEGORIES.map(function (c) {
      return '<option value="' + esc(c.key) + '"' + (c.key === categoryGuess ? ' selected' : '') + '>' +
        esc(c.key) + '</option>';
    }).join('');
    var todayStr = ENG.formatDate(new Date());
    var minStr = ENG.formatDate(new Date(Date.now() - 365 * 24 * 3600 * 1000));
    var dateValue = parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : todayStr;

    var html = '<div class="ocr-card">';

    /* 双保险：演示结果绝不能和用户上传的图片并存，否则用户会以为
       "我这张图被识别成了示例里的金额"。真的出现这种组合时，
       收起预览图并明确告知这是内置示例。 */
    if (result.source === 'demo' && ocrImageDataUrl) {
      var previewEl = $('ocrPreview');
      ocrPreviewSuppressed = true;
      if (previewEl) { previewEl.hidden = true; }
      html += '<div class="ocr-warn ocr-warn-demo">' + ic('alert', 'bico-warn', '注意') + '这是内置示例，不是你上传的截图，仅用于演示流程</div>';
    }

    html += '<div class="ocr-card-head">' +
      '<span class="conf ' + conf.cls + '">' + conf.text + '</span>' +
      '<span class="hint">' + esc(ocrSourceText(result.source)) + '</span>' +
      '</div>';

    if (parsed.confidence === 'low') {
      html += '<div class="ocr-warn">识别可能不准，请核对金额再确认。</div>';
    }
    if (parsed.dateWarn) {
      html += '<div class="ocr-warn">' + esc(parsed.dateWarn) + '</div>';
    }

    html += '<div class="ocr-grid">' +
      '<label class="field"><span>金额（¥）</span>' +
      '<input data-field="amount" type="number" min="0.01" step="0.01" inputmode="decimal" value="' +
      parsed.amount.toFixed(2) + '" /></label>' +
      '<label class="field"><span>分类</span>' +
      '<select data-field="category">' + options + '</select></label>' +
      '<label class="field"><span>日期</span>' +
      '<input data-field="date" type="date" min="' + minStr + '" max="' + todayStr + '" value="' + dateValue + '" /></label>' +
      '<label class="field"><span>备注</span>' +
      '<input data-field="note" type="text" value="' + esc(parsed.merchant || '截图记账') + '" /></label>' +
      '</div>';

    if (parsed.payMethod) {
      html += '<div class="ocr-meta">支付方式：' + esc(parsed.payMethod) + '</div>';
    }

    html += '<details class="ocr-raw"><summary>识别原文</summary><pre>' + esc(parsed.raw) + '</pre></details>' +
      '<div class="ocr-actions">' +
      '<button type="button" class="btn-mini primary" data-act="ocr-confirm">确认记账</button>' +
      '<button type="button" class="btn-mini" data-act="ocr-retry">重新识别</button>' +
      '</div></div>';

    $('ocrResult').innerHTML = html;
    $('ocrStatus').textContent = '识别完成，核对下面的金额和分类，确认后会走正常入账流程。';
  }

  function handleOcrResult(result) {
    if (!result || !result.ok) {
      var attribution = ocrFailureAttribution(result);
      showOcrError(
        (result && result.reason) || '识别失败，可以直接手动录入。',
        attribution.title
      );
      $('ocrStatus').className = 'ocr-status warn';
      $('ocrStatus').textContent = attribution.status;
      return;
    }
    var parsed = OCR.parseReceipt(result.text, new Date());
    if (!parsed.ok) {
      showOcrError(parsed.reason + '。这张图可能是菜单、聊天记录或者太模糊了，建议手动录入。',
        '没读到金额 —— 这张图可能不是消费凭证');
      $('ocrStatus').className = 'ocr-status warn';
      $('ocrStatus').textContent = '没有读到金额。';
      return;
    }
    ocrDraft = parsed;
    renderOcrConfirm(result, parsed);
  }

  function runOcr() {
    if (!ocrPendingFile && !ocrImageDataUrl && ocrDemoIndex < 0) {
      $('ocrStatus').textContent = '先选一张截图（或点下面的示例小票）再识别。';
      return;
    }
    var runBtn = $('btnOcrRun');
    if (runBtn) { runBtn.disabled = true; }
    $('ocrResult').innerHTML = '';
    $('ocrStatus').className = 'ocr-status loading';
    $('ocrStatus').textContent = '识别中…';

    var task;
    if (ocrDemoIndex >= 0) {
      task = OCR.detect({ mode: 'demo', demoIndex: ocrDemoIndex });
    } else {
      /* auto 模式：没有可用识别能力时返回失败，由 UI 引导下一步；
         这里不再传 demoIndex —— 传了就给了"静默回落示例"的口子。 */
      task = OCR.detect({ mode: 'auto', file: ocrPendingFile, dataUrl: ocrImageDataUrl });
    }

    task.then(function (result) {
      if (runBtn) { runBtn.disabled = false; }
      $('ocrStatus').className = 'ocr-status';
      handleOcrResult(result);
    }).catch(function (err) {
      if (runBtn) { runBtn.disabled = false; }
      $('ocrStatus').className = 'ocr-status';
      showOcrError('识别流程异常：' + (err && err.message ? err.message : '未知错误'));
    });
  }

  /** 确认截图记账：金额/分类/备注可编辑，最终仍走既有入账 + 冷静期流程 */
  function confirmOcrBill() {
    var host = $('ocrResult');
    var amountInput = host.querySelector('[data-field="amount"]');
    var amount = Number(amountInput ? amountInput.value : 0);
    if (!isFinite(amount) || amount <= 0) {
      if (amountInput) {
        amountInput.focus();
        $('ocrStatus').textContent = '金额需要大于 0。';
      }
      return;
    }
    var category = host.querySelector('[data-field="category"]').value;
    var date = host.querySelector('[data-field="date"]').value;
    var note = host.querySelector('[data-field="note"]').value.trim();
    var motive = NLP.detectMotivation(note + ' ' + (ocrDraft ? ocrDraft.raw : ''));
    var draft = {
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ENG.formatDate(new Date()),
      amount: ENG.round2(amount),
      category: DATA.CATEGORY_KEYS.indexOf(category) !== -1 ? category : '其他',
      note: note || category,
      motivation: motive.motivation,
      want: motive.want,
      type: 'expense'
    };
    closeOcrModal();
    switchView('chat');
    startFlow([draft]);
  }

  /** 下载文本文件 */
  function downloadText(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var url = global.URL.createObjectURL(blob);
      var a = DOC.createElement('a');
      a.href = url;
      a.download = filename;
      DOC.body.appendChild(a);
      a.click();
      DOC.body.removeChild(a);
      setTimeout(function () { global.URL.revokeObjectURL(url); }, 5000);
      return true;
    } catch (e) {
      addAIMessage(aiBubble('导出失败了：当前浏览器可能不支持文件下载。'));
      return false;
    }
  }

  /* ================================================================== */
  /* 省钱雷达：活动日历 + 比价计算器                                      */
  /* ================================================================== */

  var dealsTab = 'today';
  var dealsLastResult = null;
  var dealsForm = {
    item: '充电宝',
    budget: '',
    rows: [
      { platform: '淘宝', price: '', spec: '10000mAh', ship: '', coupon: '', need: '' },
      { platform: '拼多多', price: '', spec: '10000mAh', ship: '', coupon: '', need: '' },
      { platform: '京东', price: '', spec: '10000mAh', ship: '', coupon: '', need: '' }
    ]
  };
  var DEAL_PLATFORMS = ['网易严选', '当当', '淘宝', '天猫', '京东', '拼多多', '抖音', '唯品会', '美团', '饿了么', '线下门店'];
  /** 真实搜索快照的排序状态：price=价格升序 / reviews=评价降序 */
  /* 抓取来源名 → 比价表里的平台名（统一叫法，也避免下拉框里没有这个值） */
  var PLAT_ALIAS = { '网易严选': '网易严选', '当当网': '当当', '当当': '当当' };

  /** 缓存年龄说人话：别丢个"170 秒"给用户猜 */
  function cacheAgeText(sec) {
    var s = Number(sec) || 0;
    if (s < 60) { return '刚刚抓的'; }
    if (s < 3600) { return Math.round(s / 60) + ' 分钟前的抓取'; }
    return Math.round(s / 3600) + ' 小时前的抓取';
  }
  var realSort = 'price';
  /* 在线抓取：用户搜什么就抓什么。realLive 有值就优先用它，没有才退回内置快照 */
  var realLive = null;
  var realBusy = false;
  var realStatus = '';
  var REAL_LIVE_KEY = 'ai_jizhang_real_search_v1';
  /* 在线抓取的后端地址：页面若由 deals_api.py 托管（http/https 打开），同源地址最优先；
     file:// 直接打开时只能走 127.0.0.1:8010（跨域已由后端 CORS 放行） */
  var REAL_API_BASES = (global.location && (global.location.protocol === 'http:' || global.location.protocol === 'https:'))
    ? ['', 'http://127.0.0.1:8010', 'http://localhost:8010']
    : ['http://127.0.0.1:8010', 'http://localhost:8010'];

  function dealsNow() { return new Date(); }
  function dealsReady() { return DEALS && typeof DEALS.compareOffers === 'function'; }

  /** 统一处理卡片/面板里的动作按钮 */
  function handleDealAct(act) {
    if (!act) { return; }
    if (act === 'open-today' || act === 'open-deals') { openDealsSheet('today'); return; }
    if (act === 'open-calendar') { openDealsSheet('calendar'); return; }
    if (act === 'open-compare') { openDealsSheet('compare'); return; }
    if (act === 'close') { closeDealsSheet(); return; }
    if (act === 'record') { recordDealBill(); return; }
  }

  /* 省钱雷达入口已并入「省钱」面板：这里只做薄封装，调用点全部保持不变 */
  function openDealsSheet(tab) { openSaveHub('radar', tab); }

  function closeDealsSheet() { closeSaveHub(); }

  function renderDealsSheet() {
    var d = dealsNow();
    $('dealsHeadDate').textContent = DEALS.dateKey(d) + ' ' + DEALS.weekdayCn(d);
    var tabs = DOC.querySelectorAll('#dealsTabs .atab');
    var i;
    for (i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-deal-tab') === dealsTab);
    }
    var pane = $('dealsPane');
    if (dealsTab === 'calendar') { pane.innerHTML = dealsCalendarHtml(d); }
    else if (dealsTab === 'compare') { pane.innerHTML = dealsCompareHtml(d); }
    else if (dealsTab === 'about') { pane.innerHTML = dealsAboutHtml(d); }
    else { pane.innerHTML = dealsTodayHtml(d); }
  }

  /** 今天：限时活动 + 未来 7 天 + 常驻活动 */
  function dealsTodayHtml(d) {
    var all = DEALS.dealsOn(d);
    var limited = all.filter(function (x) { return x.type !== 'always'; });
    var always = all.filter(function (x) { return x.type === 'always'; });
    var np = DEALS.nextPromo(d);
    var html = '';

    if (np) {
      html += '<div class="deals-promo-banner">' +
        '<b>' + esc(np.promo.name) + (np.days === 0 ? ' 就是今天' : ' 还有 ' + np.days + ' 天') + '</b>' +
        '<span>' + esc(np.promo.depth) + ' · 适合买：' + esc(np.promo.bestFor) + '</span>' +
        '</div>';
    }

    html += '<div class="deals-sec">今天的限时活动</div>';
    if (!limited.length) {
      html += '<div class="deals-empty">今天是' + esc(DEALS.weekdayCn(d)) +
        '，没有固定的限时活动。点上方「14 天日历」可以看最近哪天有品牌优惠。</div>';
    } else {
      limited.forEach(function (it) {
        html += '<div class="deal-item">' +
          '<div class="di-head"><span class="di-emoji">' + itemIcon(it, 'md') + '</span>' +
          '<b>' + esc(it.name) + ' · ' + esc(it.title) + '</b>' +
          '<span class="di-tag">' + esc(it.tag) + '</span></div>' +
          (it.place ? '<div class="di-place">' + ic('globe', 'bico-mute', '地点') + esc(it.place) + '</div>' : '') +
          '<p>' + esc(it.what) + '</p>' +
          '<p class="di-how">' + ic('bulb', 'bico-brand', '怎么做') + esc(it.how) + '</p>' +
          '<p class="di-tip">' + ic('alert', 'bico-warn', '提醒') + esc(it.tip) + '</p>' +
          (it.coach ? '<p class="di-coach">' + ic('cap', 'bico-brand', '理财专家') + esc(it.coach) + '</p>' : '') +
          '</div>';
      });
    }

    var up = DEALS.upcoming(8, d).filter(function (x) { return x.items.length && x.offset > 0; });
    if (up.length) {
      html += '<div class="deals-sec">接下来 7 天</div><div class="deals-up">';
      up.forEach(function (day) {
        var names = day.items.map(function (x) { return x.name + '·' + x.title; }).join('；');
        var tag = day.items.length > 1 ? day.items.length + ' 场' : day.items[0].tag;
        html += '<div class="deals-up-row">' +
          '<span class="du-date">' + esc(day.date.slice(5)) + '<small>' + esc(day.weekday) + '</small></span>' +
          '<span class="du-text">' + esc(names) + '</span>' +
          '<span class="du-tag">' + esc(tag) + '</span>' +
          '</div>';
      });
      html += '</div>';
    }

    if (always.length) {
      html += '<div class="deals-sec">常驻优惠（不用等）</div><div class="deals-pills">';
      always.forEach(function (it) {
        html += '<span class="deals-pill" title="' + esc(it.tip) + '">' + itemIcon(it, 'sm') + ' ' +
          esc(it.name) + '·' + esc(it.title) + (it.place ? '（' + esc(it.place) + '）' : '') + '</span>';
      });
      html += '</div>';
    }

    html += '<p class="deals-note">活动日期由本地日历按「每周几 / 每月几号」计算，真实有效不联网也不会过期；' +
      '具体单品、价格与参与门店以官方页面为准——这里不编价格。</p>';
    return html;
  }

  /** 14 天日历 */
  function dealsCalendarHtml(d) {
    var days = DEALS.upcoming(14, d);
    var html = '<div class="deals-cal">';
    days.forEach(function (day) {
      var isToday = day.offset === 0;
      html += '<div class="deals-cal-row' + (isToday ? ' is-today' : '') + '">' +
        '<div class="dc-day"><b>' + esc(day.date.slice(5)) + '</b><small>' + esc(day.weekday) +
        (isToday ? ' · 今天' : '') + '</small></div>' +
        '<div class="dc-items">';
      if (!day.items.length) {
        html += '<span class="dc-none">—</span>';
      } else {
        day.items.forEach(function (it) {
          html += '<span class="dc-chip ' + (it.type === 'promo' ? 'is-promo' : '') + '">' +
            itemIcon(it, 'sm') + ' ' + esc(it.name) + '·' + esc(it.title) + '</span>';
        });
      }
      html += '</div></div>';
    });
    html += '</div>';
    html += '<p class="deals-note">日历由日期算法生成：每周几 / 每月几号自动算出对应品牌活动，真实有效、不联网也不会过期；' +
      '大促只标「预热开始」和「当天」，不重复刷屏。</p>';
    return html;
  }

  /** 比价计算器 */
  function dealsCompareHtml(d) {
    var html = '';
    html += realSearchBlockHtml();
    html += '<div class="dc-grid">' +
      '<label class="dc-field"><span>买什么</span>' +
      '<input id="dcItem" type="text" value="' + esc(dealsForm.item) + '" placeholder="如 充电宝 10000mAh" /></label>' +
      '<label class="dc-field"><span>预算（¥，选填）</span>' +
      '<input id="dcBudget" type="number" inputmode="decimal" value="' + esc(dealsForm.budget) + '" placeholder="如 100" /></label>' +
      '</div>';

    html += '<div class="deals-sec">手动比价：把你看到的报价填进来（预填示例是充电宝）</div><div class="dc-offers" id="dcOffers">';
    dealsForm.rows.forEach(function (r, idx) {
      html += dealOfferRowHtml(r, idx);
    });
    html += '</div>';

    html += '<div class="dcz-actions">' +
      '<button class="btn-mini primary" id="btnDealCalc" type="button">算一算</button>' +
      '<button class="btn-mini" id="btnDealDemo" type="button">填示例（充电宝）</button>' +
      '<button class="btn-mini" id="btnDealAdd" type="button">+ 加一个平台</button>' +
      '</div>';

    html += '<div id="dealsResult">' + (dealsLastResult ? dealResultHtml(dealsLastResult) : '') + '</div>';

    var band = DEALS.findBand(dealsForm.item);
    if (band) {
      html += '<p class="deals-note">「' + esc(band.name) + '」价格带参考：入门 ' + band.low[0] + '-' + band.low[1] +
        ' 元 / 中档 ' + band.mid[0] + '-' + band.mid[1] + ' 元 / 高档 ' + band.high[0] + '-' + band.high[1] +
        ' 元，通常 ' + esc(band.channel) + ' 更便宜。</p>';
    }
    html += '<p class="deals-note">口径：到手价 = 标价 × 需买件数 + 运费 − 券；规格不同的只能比折合单价。' +
      '上面「真实搜索结果」是电商平台（网易严选 / 慢慢买聚合的京东·天猫·淘宝 / 当当）的真实搜索结果（抓取时间见卡片），价格随后变动，下单前请以站点实时价为准。</p>';
    return html;
  }

  /* ---------- 真实搜索快照（当当网，数据来自 deals_scrape.py） ---------- */
  function realSearchData() {
    if (realLive && realLive.items && realLive.items.length && realLive.meta) { return realLive; }
    return (DEALS && DEALS.REAL_SEARCH && DEALS.REAL_SEARCH.items && DEALS.REAL_SEARCH.items.length)
      ? DEALS.REAL_SEARCH : null;
  }

  /** 启动时恢复上一次在线抓取的结果（带抓取时间，诚实标注，不算过期数据造假） */
  function loadRealLive() {
    try {
      var raw = global.localStorage.getItem(REAL_LIVE_KEY);
      if (!raw) { return; }
      var d = JSON.parse(raw);
      if (d && d.meta && d.items && d.items.length) { realLive = d; }
    } catch (e) { /* 数据坏了就当没有 */ }
  }

  /** 同规格分组：有真实材质（304/316）才用材质参与分组，只有 ≥2 条的组才做「同规格最便宜」结论 */
  function realGroupList(items) {
    var map = {}, out = [];
    items.forEach(function (it) {
      var k = (it.material && it.material !== '材质未标注' ? it.material + ' · ' : '') + (it.target || '通用');
      if (!map[k]) { map[k] = []; out.push(k); }
      map[k].push(it);
    });
    return out.map(function (k) {
      var g = map[k].slice().sort(function (a, b) { return a.price - b.price; });
      return {
        label: k, count: g.length,
        low: g[0], high: g[g.length - 1],
        gap: Math.round((g[g.length - 1].price - g[0].price) * 100) / 100,
        pct: g[0].price > 0 ? Math.round((g[g.length - 1].price / g[0].price - 1) * 100) : 0
      };
    }).filter(function (g) { return g.count >= 2; });
  }

  function realSearchBlockHtml() {
    var d = realSearchData();
    var m = d ? d.meta : null;
    var isLive = !!(d && realLive && d === realLive);

    var html = '<div class="rs-wrap">';

    /* 搜什么比什么：输入关键词 → 本机后端真实抓当当 → 结果直接进这里 */
    html += '<div class="rs-search">' +
      '<input id="rsKw" type="text" inputmode="search" placeholder="搜什么比什么：输入商品关键词" value="' +
      esc(m ? m.keyword : '') + '" />' +
      '<button type="button" class="rs-go" id="btnRsSearch">' + (realBusy ? '抓取中…' : '搜同款') + '</button>' +
      '</div>';
    html += '<div class="rs-status' + (realStatus ? ' is-err' : '') + '" id="rsStatus">' +
      (realStatus ? esc(realStatus) :
        (d ? '' : '还没有数据。输入关键词点「搜同款」，或用下面的快照。')) +
      '</div>';

    if (!d) {
      html += '<div class="deals-empty">还没有真实搜索快照。输入关键词点「搜同款」' +
        '（需要本机跑 <code>python deals_api.py</code>），或在本机运行 ' +
        '<code>python deals_scrape.py 关键词</code> 抓一次进快照。</div></div>';
      return html;
    }
    var items = d.items.slice();
    if (realSort === 'reviews') {
      items.sort(function (a, b) { return (b.reviews || 0) - (a.reviews || 0) || a.price - b.price; });
    } else {
      items.sort(function (a, b) { return a.price - b.price || (b.reviews || 0) - (a.reviews || 0); });
    }

    html += '<div class="rs-src">' +
      '<span class="rs-badge">' + ic('check', null, '真实抓取') + '真实抓取</span>' +
      '<span class="rs-mode">' + (isLive ? '在线抓取' : '内置快照') + '</span>' +
      '<b>' + esc(m.source) + '</b>' +
      '<span class="rs-kw">关键词「' + esc(m.keyword) + '」</span>' +
      '<span class="rs-time">抓取于 ' + esc(m.scraped_at) + '</span>' +
      (m.page_urls && m.page_urls[0]
        ? '<a class="rs-link" href="' + esc(m.page_urls[0]) + '" target="_blank" rel="noopener noreferrer">原搜索页</a>'
        : '') +
      '</div>';

    var pages = (m.pages_scraped || []).length;
    html += '<div class="rs-stats">' +
      '<span>抓了 <b>' + pages + '</b> 个结果页</span>' +
      '<span>解析 <b>' + (m.total_parsed || 0) + '</b> 条</span>' +
      '<span>关键词相关 <b>' + (m.relevant || 0) + '</b> 条</span>' +
      (m.dropped ? '<span class="rs-drop">剔除 <b>' + m.dropped + '</b> 条不相关</span>' : '') +
      '<span>取前 <b>' + items.length + '</b> 条</span>' +
      (m.price_range ? '<span>价格带 <b>¥' + m.price_range[0] + '–' + m.price_range[1] + '</b></span>' : '') +
      (m.shop_count ? '<span><b>' + m.shop_count + '</b> 家店</span>' : '') +
      (m.from_cache ? '<span class="rs-cache">' + cacheAgeText(m.cache_age_sec) + '</span>' : '') +
      '</div>';

    /* 多源概览：用「实际展示出来的条目」统计，保证与下方列表、价格带口径一致 */
    var srcs = (m.sources || []).map(function (x) {
      var ps = items.filter(function (it) { return it.source === x.name; })
        .map(function (it) { return it.price; });
      return {
        name: x.name, host: x.host, note: x.note, count: ps.length,
        price_range: ps.length ? [Math.min.apply(null, ps), Math.max.apply(null, ps)] : null,
      };
    }).filter(function (x) { return x.count; });
    var multiSrc = srcs.length >= 2;
    if (multiSrc) {
      html += '<div class="rs-cross">' + ic('scale', null, '跨平台');
      srcs.forEach(function (x, xi) {
        html += (xi ? '<span class="rs-cross-sep">vs</span>' : '') +
          '<b>' + esc(x.name) + '</b> ' + x.count + '条' +
          (x.price_range ? ' ¥' + DEALS.fmt(x.price_range[0]) + '–' + DEALS.fmt(x.price_range[1]) : '');
      });
      html += '</div>';
    }
    /* 有平台没这个品类就直说，不拿配件/图书凑数 */
    (m.sources || []).forEach(function (x) {
      if (!x.count && x.note) {
        html += '<div class="rs-nomatch">' + ic('info', null, '说明') +
          '<b>' + esc(x.name) + '</b>：' + esc(x.note) + '</div>';
      }
    });

    var groups = realGroupList(d.items);
    if (groups.length) {
      html += '<div class="rs-verdict">' + ic('scale', null, '同规格比价');
      groups.forEach(function (g, gi) {
        html += (gi ? '<br/>' : '') +
          '<b>' + esc(g.label) + '</b> 共 ' + g.count + ' 个报价：最低 <b class="rs-low">¥' + DEALS.fmt(g.low.price) +
          '</b>（' + esc(g.low.shop) + '），最高 <b class="rs-high">¥' + DEALS.fmt(g.high.price) +
          '</b>（' + esc(g.high.shop) + '），相差 ¥' + DEALS.fmt(g.gap) +
          (g.pct > 0 ? '，最贵比最便宜贵 ' + g.pct + '%' : '') + '。';
      });
      html += '</div>';
    }

    html += '<div class="rs-sort">' +
      '<button type="button" class="rs-sort-btn' + (realSort === 'price' ? ' active' : '') + '" data-real-sort="price">价格从低到高</button>' +
      '<button type="button" class="rs-sort-btn' + (realSort === 'reviews' ? ' active' : '') + '" data-real-sort="reviews">销量/评价从多到少</button>' +
      '</div>';

    html += '<div class="rs-list">';
    /* 列表里只要有一条真标了材质，才给没标的显示「材质未标注」灰牌，避免满屏噪音 */
    var hasMat = d.items.some(function (x) { return x.material && x.material !== '材质未标注'; });
    items.forEach(function (it, i) {
      var chips = '';
      var plat = it.platform || it.source;
      if (multiSrc && plat) { chips += '<span class="rs-chip is-plat">' + esc(plat) + '</span>'; }
      if (it.material && it.material !== '材质未标注') { chips += '<span class="rs-chip">' + esc(it.material) + '</span>'; }
      else if (hasMat) { chips += '<span class="rs-chip is-mute">材质未标注</span>'; }
      if (it.target && it.target !== '通用') { chips += '<span class="rs-chip">' + esc(it.target) + '</span>'; }
      (it.feature || []).forEach(function (f) { chips += '<span class="rs-chip is-soft">' + esc(f) + '</span>'; });
      if (it.original && it.original > it.price) { chips += '<span class="rs-chip is-soft">原价 ¥' + DEALS.fmt(it.original) + '</span>'; }

      html += '<div class="rs-row">' +
        '<span class="rs-rank' + (i === 0 && realSort === 'price' ? ' is-first' : '') + '">' + (i + 1) + '</span>' +
        '<div class="rs-main">' +
        '<a class="rs-title" href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer nofollow">' +
        esc(it.title) + '</a>' +
        '<div class="rs-sub">' +
        '<span class="rs-shop">' + ic('cat-shop', 'rs-ico', '店铺') + esc(it.shop) + '</span>' +
        chips +
        '<span class="rs-rev">' + (it.reviews === null ? '无数据' : it.reviews + (it.reviews_label ? ' ' + it.reviews_label : ' 条评价')) + '</span>' +
        '<span class="rs-pg">第 ' + (it.page || 1) + ' 页</span>' +
        '</div></div>' +
        '<div class="rs-price"><b>¥' + DEALS.fmt(it.price) + '</b><small>' +
        (it.price_label || '标价') + '</small></div>' +
        '<button type="button" class="rs-fill" data-real-fill="' + esc(it.sku) + '">填入比价</button>' +
        '</div>';
    });
    html += '</div>';

    html += '<p class="deals-note">数据来源：' + esc(m.source) + '（' + esc(m.source_host) + '）公开搜索结果，' +
      '关键词「' + esc(m.keyword) + '」，抓取时间 ' + esc(m.scraped_at) + '，翻 ' + pages + ' 页共解析 ' +
      (m.total_parsed || 0) + ' 条' +
      (m.dropped ? '，其中 <b>' + m.dropped + '</b> 条因是图书/周边配件/蹭词被判定不相关已剔除' : '') +
      '，取相关且字段完整的前 ' + items.length + ' 条。' +
      '价格与销量/评价数为抓取当时的页面展示值，会随促销和库存变动，下单前以站点实时价为准。' +
      (hasMat ? '「材质未标注」表示标题里没写 304/316，不代表质量好坏。' : '') + '</p>';

    html += '<details class="rs-how"' + (isLive ? '' : ' open') + '><summary>数据怎么来的 · 想搜别的词怎么办</summary>' +
      (isLive
          ? '<p>这份结果是刚才在线抓的：你在上面输入关键词，页面请求本机后端 <code>/api/deals/search</code>，' +
          '后端<strong>并发</strong>真实请求三个源：<strong>网易严选</strong>搜索接口（<code>you.163.com</code>，综合电商，搜什么出什么品类）、' +
          '<strong>慢慢买比价</strong>（<code>s.manmanbuy.com</code>，比价聚合站，免登录直出<strong>京东/天猫/淘宝</strong>等平台的真实到手价）、' +
          '以及<strong>当当</strong>搜索页（百货/图书），逐条抓标题、价格、店铺、销量/评价数，没有任何人工填写或模拟数据，' +
          '实际来源见上方来源条。</p>' +
          '<p>三个源<strong>同时并发</strong>抓，结果合并去重后交替展示，所以每个平台都有代表出镜。' +
          '抓回来的原始结果会再过一遍<strong>提纯</strong>：出版物（ISBN/出版社/丛书等）、' +
          '周边配件（电脑包、支架、清洁工具、充电器这类"沾边但不是本体"）、蹭词结果都会被剔除，' +
          '剔除量如实写在上方统计条里。剔完不足 2 条的平台会直接说明"没这个品类"，不拿配件凑数。</p>' +
          '<p class="rs-how-note">京东、淘宝的搜索结果页需要登录或有风控校验直抓不到，所以京东/天猫/淘宝的报价经慢慢买比价聚合站中转获取——' +
          '同样是页面当时真实展示的到手价，下单前以站点实时价为准。</p>'
          : '<p>这条快照由 <code>deals_scrape.py</code> 直接请求电商平台搜索接口' +
          '（主源网易严选 <code>you.163.com</code>、比价聚合源慢慢买 <code>s.manmanbuy.com</code> 取京东/天猫/淘宝报价、备源当当搜索页）解析得到，逐条抓标题、价格、店铺、销量/评价数，' +
          '没有任何人工填写或模拟数据。想搜别的词，在上方输入关键词点「搜同款」；' +
          '浏览器直接抓电商接口会被跨域（CORS）拦住，需要本机先跑：</p>' +
          '<code class="rs-cmd" id="rsCmd">python deals_api.py</code>' +
          '<button type="button" class="rs-copy" data-real-copy="1">复制命令</button>' +
          '<p class="rs-how-note">后端起来后回这里输入关键词即可在线抓取；也可以不改代码直接' +
          '<code>python deals_scrape.py 关键词 deals_real.json && python rebundle.py</code> 更新内置快照。' +
          '京东/天猫/淘宝经慢慢买比价聚合站中转获取真实到手价（免登录、无风控）。</p>') +
      '</details>';

    html += '</div>';
    return html;
  }

  /** 在线抓取：按关键词真实抓电商接口（网易严选主/当当备，经本机后端代理，浏览器直连会被 CORS 拦） */
  function runRealSearch() {
    if (realBusy) { return; }
    var kwEl = $('rsKw');
    var kw = kwEl ? kwEl.value.trim() : '';
    if (!kw) {
      realStatus = '先输入要搜的商品关键词，比如 保温杯 / 机械键盘 / 数据线';
      var st0 = $('rsStatus');
      if (st0) { st0.textContent = realStatus; st0.classList.add('is-err'); }
      return;
    }
    realBusy = true;
    realStatus = '';
    var goBtn = $('btnRsSearch');
    if (goBtn) { goBtn.textContent = '抓取中…'; }
    var st = $('rsStatus');
    if (st) { st.textContent = '正在真实抓取电商平台「' + kw + '」…（网易严选，约 5–10 秒）'; st.classList.remove('is-err'); }
    tryFetchReal(kw).then(function (data) {
      realBusy = false;
      realLive = data;
      realSort = 'price';
      try { global.localStorage.setItem(REAL_LIVE_KEY, JSON.stringify(data)); } catch (e) { /* 隐私模式忽略 */ }
      renderDealsSheet();
      showToast('已抓到 ' + data.items.length + ' 条「' + kw + '」真实结果（' + data.meta.source + '）');
    }).catch(function (err) {
      realBusy = false;
      var msg = err && err.message ? err.message : '未知原因';
      realStatus = '这次没抓到：' + msg +
        (err && err.business ? '' :
          '。浏览器直接抓电商页面会被跨域拦截，需要本机后端代理：运行 python deals_api.py 后再点「搜同款」。');
      var goBtn2 = $('btnRsSearch');
      if (goBtn2) { goBtn2.textContent = '搜同款'; }
      var st2 = $('rsStatus');
      if (st2) { st2.textContent = realStatus; st2.classList.add('is-err'); }
    });
  }

  /** 依次尝试本机后端地址，拿到 /api/deals/search 的真实抓取结果 */
  function tryFetchReal(kw) {
    var bases = REAL_API_BASES.slice();
    try {
      var saved = global.localStorage.getItem('ai_jizhang_deals_api_base');
      if (saved && bases.indexOf(saved) !== -1) { bases.splice(bases.indexOf(saved), 1); bases.unshift(saved); }
    } catch (e) { /* 忽略 */ }
    var attempt = function (i) {
      if (i >= bases.length) {
        return Promise.reject(new Error('连不上本机后端（127.0.0.1:8010）'));
      }
      var url = bases[i] + '/api/deals/search?keyword=' + encodeURIComponent(kw) + '&pages=2&limit=8';
      return global.fetch(url).then(function (r) {
        /* 后端有响应：400/502 时也读出 JSON 里的原因，直接报给用户，不再换地址 */
        if (!r.ok) {
          return r.json().catch(function () { return null; }).then(function (j) {
            throw { message: (j && j.error) || ('HTTP ' + r.status), business: true };
          });
        }
        return r.json();
      }).then(function (d) {
        if (!d) { throw { message: '后端返回为空', business: true }; }
        if (!d.ok || !d.items || !d.items.length) {
          throw { message: d.error || '没抓到相关商品', business: true };
        }
        try { global.localStorage.setItem('ai_jizhang_deals_api_base', bases[i]); } catch (e) { /* 忽略 */ }
        return d;
      }, function (e) {
        if (e && e.business) { throw e; }   // 后端明确回复（比如真没抓到）→ 原因如实上报
        return attempt(i + 1);              // 连不上 → 试下一个地址
      });
    };
    return attempt(0);
  }

  /** 复制「重抓命令」，方便别人自己验证数据不是编的 */
  function copyRealCmd() {
    var el = $('rsCmd');
    var text = el ? el.textContent : '';
    if (!text) { return; }
    var fallback = function () {
      /* execCommand 兜底：本地 file:// 打开时 clipboard API 常被拒 */
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        DOC.body.appendChild(ta);
        ta.select();
        var ok = DOC.execCommand && DOC.execCommand('copy');
        DOC.body.removeChild(ta);
        if (ok) { showToast('命令已复制，粘贴到本机终端即可重抓'); return; }
      } catch (e) { /* 忽略，走最后的提示 */ }
      showToast('复制失败，手动选中那行命令复制');
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          showToast('命令已复制，粘贴到本机终端即可重抓');
        }, fallback);
        return;
      }
    } catch (e) { /* 老浏览器走兜底 */ }
    fallback();
  }

  /** 把某条真实报价填进下方比价表（平台记为当当，规格带上材质/人群） */
  function fillRealOffer(sku) {
    var d = realSearchData();
    if (!d) { return; }
    var it = null;
    for (var i = 0; i < d.items.length; i++) { if (String(d.items[i].sku) === String(sku)) { it = d.items[i]; break; } }
    if (!it) { return; }
    syncDealForm();
    var plat = PLAT_ALIAS[it.source] || it.source || (d.meta && d.meta.source) || '网易严选';
    var spec = (it.material && it.material !== '材质未标注' ? it.material + ' ' : '') +
      (it.target && it.target !== '通用' ? it.target + '款 ' : '') + d.meta.keyword;
    var row = null;
    for (var k = 0; k < dealsForm.rows.length; k++) {
      if (String(dealsForm.rows[k].price).trim() === '') { row = dealsForm.rows[k]; break; }
    }
    if (row) {
      row.platform = plat; row.price = String(it.price); row.spec = spec;
    } else {
      if (dealsForm.rows.length >= 6) { showToast('比价最多 6 个平台，先删一行再填'); return; }
      dealsForm.rows.push({ platform: plat, price: String(it.price), spec: spec, ship: '', coupon: '', need: '' });
    }
    dealsForm.item = d.meta.keyword;
    dealsForm.budget = dealsForm.budget || '';
    renderDealsSheet();
    showToast('已填入 ¥' + DEALS.fmt(it.price) + '（' + plat + ' · ' + it.shop + '）');
    runDealCompare();
  }

  function dealOfferRowHtml(r, idx) {
    var opts = '';
    DEAL_PLATFORMS.forEach(function (p) {
      opts += '<option value="' + esc(p) + '"' + (r.platform === p ? ' selected' : '') + '>' + esc(p) + '</option>';
    });
    return '<div class="dc-offer" data-offer>' +
      '<div class="dco-main">' +
      '<select class="dc-plat">' + opts + '</select>' +
      '<input class="dc-price" type="number" inputmode="decimal" placeholder="价格" value="' + esc(r.price) + '" />' +
      '<input class="dc-spec" type="text" placeholder="规格 10000mAh / 12包" value="' + esc(r.spec) + '" />' +
      '</div>' +
      '<div class="dco-extra">' +
      '<input class="dc-ship" type="number" inputmode="decimal" placeholder="运费" value="' + esc(r.ship) + '" />' +
      '<input class="dc-coupon" type="number" inputmode="decimal" placeholder="券" value="' + esc(r.coupon) + '" />' +
      '<input class="dc-need" type="number" inputmode="numeric" placeholder="需买N件" value="' + esc(r.need) + '" />' +
      (idx > 0 ? '<button class="dc-del" type="button" data-del-row="' + idx + '" aria-label="删除这行"><svg viewBox="0 0 24 24"><use href="#i-trash"/></svg></button>' : '<span class="dc-del-ph"></span>') +
      '</div></div>';
  }

  /** 把表单当前值读回 dealsForm，避免切 tab 丢输入 */
  function syncDealForm() {
    var itemEl = $('dcItem');
    if (itemEl) { dealsForm.item = itemEl.value.trim(); }
    var budgetEl = $('dcBudget');
    if (budgetEl) { dealsForm.budget = budgetEl.value.trim(); }
    var rows = DOC.querySelectorAll('#dcOffers [data-offer]');
    if (rows.length) {
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        out.push({
          platform: rows[i].querySelector('.dc-plat').value,
          price: rows[i].querySelector('.dc-price').value,
          spec: rows[i].querySelector('.dc-spec').value,
          ship: rows[i].querySelector('.dc-ship').value,
          coupon: rows[i].querySelector('.dc-coupon').value,
          need: rows[i].querySelector('.dc-need').value
        });
      }
      dealsForm.rows = out;
    }
  }

  function runDealCompare() {
    if (!dealsReady()) { return; }
    syncDealForm();
    var offers = [];
    dealsForm.rows.forEach(function (r) {
      if (String(r.price).trim() === '') { return; }
      offers.push({
        platform: r.platform,
        price: r.price,
        spec: r.spec,
        ship: r.ship || 0,
        coupon: r.coupon || 0,
        needQty: r.need || 1
      });
    });
    if (!offers.length) {
      $('dealsResult').innerHTML = '<div class="deals-empty">先填至少一个平台的价格，我才算得出来。' +
        '价格不用精确到分，看到多少填多少。</div>';
      return;
    }
    var res = DEALS.compareOffers(offers, {
      item: dealsForm.item || '这个商品',
      budget: dealsForm.budget
    });
    dealsLastResult = res;
    var box = $('dealsResult');
    box.innerHTML = dealResultHtml(res);
    if (box.scrollIntoView) {
      try { box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* 老浏览器忽略 */ }
    }
  }

  function dealResultHtml(r) {
    var html = '<div class="dc-result">';
    html += '<div class="dc-headline' + (r.comparable ? '' : ' is-warn') + '">' +
      (r.comparable ? ic('target', 'bico-brand', '可比') : ic('alert', 'bico-warn', '注意')) + esc(r.headline) + '</div>';

    if (r.rows && r.rows.length) {
      html += '<div class="dc-table">' +
        '<div class="dc-tr dc-th"><span>平台 / 商品</span><span>到手价</span><span>折合单价</span></div>';
      r.rows.forEach(function (row, i) {
        html += '<div class="dc-tr' + (i === 0 ? ' is-best' : '') + '">' +
          '<span class="dc-td-plat"><b>' + esc(row.platform) + '</b>' +
          (row.title ? '<small>' + esc(row.title) + '</small>' : '') +
          (row.needQty > 1 ? '<em class="dc-need-tag">需买 ' + row.needQty + ' 件</em>' : '') +
          '</span>' +
          '<span class="dc-td-eff">¥' + DEALS.fmt(row.eff) + '</span>' +
          '<span class="dc-td-per">' + esc(DEALS.perLabel(row)) + '</span>' +
          '</div>';
      });
      html += '</div>';
    }

    if (r.budget) {
      html += '<p class="dc-line ' + (r.budget.ok ? 'is-good' : 'is-bad') + '">' + ic('wallet', null, '预算') + esc(r.budget.text) + '</p>';
    }
    if (r.band) {
      html += '<p class="dc-line">' + ic('bar', 'bico-mute', '价格区间') + '这个价属于「' + esc(r.band.band) + '」的 <b>' + esc(r.band.label) + '</b> 档：' +
        esc(r.band.text) + '。</p>';
    }
    if (r.timing && r.timing.text) {
      html += '<p class="dc-line">⏰ ' + esc(r.timing.text) + '</p>';
    }
    if (r.sublines && r.sublines.length) {
      html += '<ul class="dc-list">';
      r.sublines.forEach(function (s) { html += '<li>' + esc(s) + '</li>'; });
      html += '</ul>';
    }
    if (r.warnings && r.warnings.length) {
      html += '<ul class="dc-list is-warn">';
      r.warnings.forEach(function (s) { html += '<li>' + ic('alert', 'bico-warn', '注意') + esc(s) + '</li>'; });
      html += '</ul>';
    }
    if (r.ok && r.best) {
      html += '<div class="dcz-actions">' +
        '<button class="btn-mini primary" type="button" data-deal-act="record">把这笔记进账本</button>' +
        '<button class="btn-mini" type="button" data-deal-act="open-today">今天还有什么优惠</button>' +
        '</div>' +
        '<p class="deals-note">「记进账本」按最低到手 ¥' + DEALS.fmt(r.best.eff) +
        ' 记一笔购物支出，记完可以给它打「值不值」。</p>';
    }
    html += '<p class="deals-note">以上价格来自你填写的报价；活动与折扣随时变动，请以下单页面为准。</p>';
    html += '</div>';
    return html;
  }

  function fillDealDemo() {
    dealsForm.item = '充电宝 10000mAh';
    dealsForm.budget = '100';
    dealsForm.rows = [
      { platform: '淘宝', price: '89', spec: '10000mAh', ship: '', coupon: '', need: '' },
      { platform: '拼多多', price: '79', spec: '10000mAh', ship: '', coupon: '5', need: '' },
      { platform: '京东', price: '99', spec: '10000mAh', ship: '', coupon: '', need: '2' }
    ];
    $('dealsPane').innerHTML = dealsCompareHtml(dealsNow());
    runDealCompare();
  }

  function recordDealBill() {
    if (!dealsLastResult || !dealsLastResult.ok || !dealsLastResult.best) { return; }
    var res = dealsLastResult;
    var amount = Math.round(res.best.eff * 100) / 100;
    closeDealsSheet();
    switchView('chat');
    startFlow([{
      date: ENG.formatDate(new Date()),
      amount: amount,
      category: '购物',
      note: res.item || '购物',
      motivation: '刚需',
      want: false,
      type: 'expense'
    }]);
  }

  function dealsAboutHtml() {
    return '<div class="deals-about">' +
      '<div class="deals-sec">数据从哪来（三条路径，各自标注）</div>' +
      '<div class="deal-item">' +
      '<div class="di-head"><svg class="di-emoji" viewBox="0 0 24 24"><use href="#i-abacus"/></svg><b>路径三 · 真实日期算法</b><span class="di-tag">已实现</span></div>' +
      '<p>疯狂星期四 = <code>weekday()==4</code>（周四）、麦当劳「13.9 元随心配」= 每周一、瑞幸 / 库迪 9.9 元 = 每周二；' +
      '海底捞大学生 69 折 = 工作日（<code>weekday</code> 在 [1..5]）；双11 = 11-11。' +
      '日期全部由代码算出，指定任意日期都能算出下一次是哪天，不依赖网络、不会过期。</p>' +
      '<p class="di-how">产出：14 天日历 + 「真实商家日历.csv」（可下载，Excel 直接打开）</p>' +
      '</div>' +
      '<div class="deal-item">' +
      '<div class="di-head"><svg class="di-emoji" viewBox="0 0 24 24"><use href="#i-plug"/></svg><b>路径二 · 比价 API</b><span class="di-tag">已实现</span></div>' +
      '<p>本机有一套同口径引擎（前端 deals.js / 后端 deals_engine.py + deals_api.py），' +
      '把「标价 + 运费 − 券 × 件数」算成到手价，再按规格折单价、判定可比性。' +
      '大模型可以通过 HTTP 直接调这些接口，不用自己算数。</p>' +
      '<p class="di-how">接口：<code>/api/deals/today</code> <code>/api/deals/calendar</code> ' +
      '<code>/api/deals/compare</code> <code>/api/deals/quote</code> <code>/api/deals/ask</code></p>' +
      '</div>' +
      '<div class="deal-item">' +
      '<div class="di-head"><svg class="di-emoji" viewBox="0 0 24 24"><use href="#i-robot"/></svg><b>路径一 · 大模型 + 工具调用</b><span class="di-tag">已实现</span></div>' +
      '<p>后端 <code>/api/deals/ask</code> 用 tool-calling 把「查日历、算比价」注册成工具，' +
      '模型先调工具拿真实日期与计算结果，再组织成一句话——不是让模型凭记忆瞎说。' +
      '没配大模型时自动降级为本地确定性回答。</p>' +
      '<p class="di-how">没配 LLM_API_KEY 也能用；配了则模型自己决定查日历还是算比价</p>' +
      '</div>' +
      '<div class="deals-sec">我刻意不做的事</div>' +
      '<ul class="dc-list">' +
      '<li>不抓电商页面、不绕反爬：价格会过期，抓取也不合规；</li>' +
      '<li>不编价格：没有真实报价时，只给价格带参考并告诉你还差什么；</li>' +
      '<li>不硬下结论：规格口径对不上（比如「12 包」vs「6 提」）就明说比不了；</li>' +
      '<li>不承诺最低价、不导流、不发店铺链接。</li>' +
      '</ul>' +
      '<p class="deals-note">想接真实价格？在 deals_api.py 的 .env 里配 PRICE_API_URL / PRICE_API_KEY / PRICE_FIELD_MAP，' +
      '把官方接口的返回字段映射进来即可，比价引擎不用改一行。</p>' +
      '</div>';
  }

  /** 看板上的省钱雷达小卡 */
  function renderDealsMini() {
    var box = $('dealsMini');
    if (!box || !dealsReady()) { return; }
    var d = dealsNow();
    var list = DEALS.dealsOn(d).filter(function (x) { return x.type !== 'always'; });
    var np = DEALS.nextPromo(d);
    var kfc = DEALS.nextOf('kfc', d);
    var html = '';
    if (list.length) {
      list.slice(0, 2).forEach(function (it) {
        html += '<div class="dm-line"><span class="dm-dot"></span><b>' + esc(it.name) + '</b> ' +
          esc(it.title) + '<em>' + esc(it.tag) + '</em></div>';
      });
    } else {
      html += '<div class="dm-line"><span class="dm-dot"></span>今天没有固定限时活动，下一场是 <b>肯德基疯狂星期四 ' +
        esc(DEALS.dateKey(kfc).slice(5)) + '</b>（' + DEALS.daysBetween(d, kfc) + ' 天后）</div>';
    }
    if (np) {
      html += '<div class="dm-line dm-promo"><span class="dm-dot"></span>' + esc(np.promo.name) +
        ' 还有 <b>' + np.days + '</b> 天 · ' + esc(np.promo.depth) + '</div>';
    }
    html += '<div class="dm-line dm-tip">' + ic('bulb', 'bico-brand', '提示') + esc(DEALS.timingAdvice(0, d).text) + '</div>';
    box.innerHTML = html;
  }

  /** 聊天入口：今天有什么优惠 */
  function showDealsTodayCard() {
    switchView('chat');
    if (!dealsReady()) { addAIMessage(aiBubble('省钱雷达没加载起来，刷新页面再试。')); return; }
    addAIMessage(aiBubble(DEALS.todayCardHtml(dealsNow())));
  }

  /** 聊天入口：疯狂星期四 */
  function showKfcDealsCard() {
    switchView('chat');
    if (!dealsReady()) { addAIMessage(aiBubble('省钱雷达没加载起来，刷新页面再试。')); return; }
    addAIMessage(aiBubble(DEALS.kfcCardHtml(dealsNow())));
  }

  /** 聊天入口：比价（先从话里抽商品名与预算，再让用户填报价） */
  function showDealCompareFromText(raw) {
    switchView('chat');
    if (!dealsReady()) { addAIMessage(aiBubble('省钱雷达没加载起来，刷新页面再试。')); return; }
    var text = String(raw || '');
    var budget = '';
    var mb = text.match(/(\d+(?:\.\d+)?)\s*(?:块|元|rmb|RMB)/);
    if (mb) { budget = mb[1]; }
    var item = text
      .replace(/我想买一个|我想买个|我想买|想买一个|想买个|想买|要买|打算买|准备买|入手/g, ' ')
      .replace(/比个价|帮我比价|比价|帮忙|帮我|查一下|看一下|多少钱划算|多少钱|划算吗|划算不划算|划算|哪家便宜|哪里便宜|便宜|买一个|买个|买|一个|的|吗|呢|？|\?/g, ' ')
      .replace(/\d+(?:\.\d+)?\s*(?:块|元|rmb|RMB)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (item.length < 2) { item = '这个商品'; }
    dealsForm.item = item;
    if (budget) { dealsForm.budget = budget; }
    addAIMessage(aiBubble(DEALS.compareIntroHtml(item, budget, dealsNow())));
  }

  /* ================================================================== */
  /* 省钱图谱：今日清单 / 100 条图谱 / 打卡省钱账                          */
  /* ================================================================== */

  var savingsTab = 'today';
  var savingsCat = '';
  var savingsQuery = '';
  /** 图谱里已展开详情的条目 id（仅内存，不持久化） */
  var savingsOpen = {};
  /** 省钱账是否展开全部记录（默认只显示最近 12 条） */
  var savingsBookAll = false;
  /** 正在手改金额的那条记录 { id, date } | null —— 只影响渲染，不持久化 */
  var savingsEdit = null;

  function savingsReady() { return !!(SAV && SAV.READY); }

  /**
   * 今日清单的上下文：把账本信息翻译成引擎需要的打分条件。
   * 这样「你 62% 的钱花在餐饮」才能反过来决定推哪几条动作。
   */
  function savingsCtx(ov) {
    ov = ov || getOverview();
    var byCat = ov.cycleAgg.byCategory || {};
    var topCat = '', topVal = 0, k;
    for (k in byCat) {
      if (!Object.prototype.hasOwnProperty.call(byCat, k)) { continue; }
      if (byCat[k] > topVal) { topVal = byCat[k]; topCat = k; }
    }
    return {
      now: new Date(),
      logs: savingsDb.logs,
      topCat: topCat,
      catSpend: byCat,
      budgetStatus: ov.budgetState.status,
      limit: 5
    };
  }

  function savingsDay() { return SAV.dateKey(new Date()); }

  /** 今天已打卡的记录（含条目对象，用于「今天已打卡」区和撤销） */
  function savingsTodayDone() {
    var day = savingsDay();
    var out = [];
    for (var i = 0; i < savingsDb.logs.length; i++) {
      var r = savingsDb.logs[i];
      if (r.date !== day) { continue; }
      var e = SAV.byId(r.id);
      if (e) { out.push({ entry: e, rec: r }); }
    }
    return out;
  }

  function savingsSumSummary() {
    var ov = getOverview();
    return SAV.summary(savingsDb.logs, { cycleStart: ov.cycle.start, cycleEnd: ov.cycle.end });
  }

  /* ---------------- 开关 ---------------- */

  /**
   * 省钱面板的一级视图：'radar'（省钱雷达）| 'graph'（省钱图谱）。
   * 两个功能原本各占一个全屏 sheet，顶栏和「我的」菜单各有入口，占地且重复；
   * 现在合并为一个面板，用一级分段控件（#saveHubSeg）切换，内部结构不变。
   */
  var saveHubView = 'radar';

  /**
   * 打开省钱面板，可直接指定落到哪一侧、以及该侧的二级 tab。
   * 完整版：面板在 #saveHubMask 里，按弹层显示。
   * 简洁版：面板已由 mountShellPanels 搬进 #spSaveBody（独立页面），
   *         没有遮罩可弹，改为切到 ssave 屏，由 renderSaveHubPanel 统一重绘。
   * @param {string} view 'radar' | 'graph'，非法值一律按 'radar'
   * @param {string=} tab 二级 tab（today / calendar / compare / about …）
   */
  function openSaveHub(view, tab) {
    var next = (view === 'graph') ? 'graph' : 'radar';
    /* 先做就绪校验再落状态：否则提前 return 后 saveHubView 与画面会不一致 */
    if (next === 'radar' && !dealsReady()) {
      addAIMessage(aiBubble('省钱雷达模块没加载起来，刷新一下页面再试。'));
      return;
    }
    if (next === 'graph' && !savingsReady()) {
      degradeSavingsUi();
      addAIMessage(aiBubble('省钱图谱模块没加载起来，刷新一下页面再试。'));
      return;
    }
    saveHubView = next;
    if (saveHubView === 'radar') { dealsTab = tab || dealsTab || 'today'; }
    else { savingsTab = tab || savingsTab || 'today'; }
    var sheet = $('saveHubSheet');
    if (sheet) { sheet.setAttribute('data-hub', saveHubView); }
    var segs = DOC.querySelectorAll('#saveHubSeg .shs');
    for (var i = 0; i < segs.length; i++) {
      var on = segs[i].getAttribute('data-hub') === saveHubView;
      segs[i].classList.toggle('active', on);
      segs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var radarView = $('saveHubViewRadar');
    var graphView = $('saveHubViewGraph');
    if (radarView) { radarView.hidden = (saveHubView !== 'radar'); }
    if (graphView) { graphView.hidden = (saveHubView !== 'graph'); }
    if (getUiMode() === 'simple') {
      /* 简洁版没有遮罩：切到「省钱」屏即可，内容由 switchView → renderSaveHubPanel 重绘。
         绝不能把 #saveHubMask 打开 —— 面板不在里面，只会留下空遮罩盖住整页。 */
      switchView('ssave');
    } else {
      $('saveHubMask').hidden = false;
      if (saveHubView === 'radar') { renderDealsSheet(); } else { renderSavingsSheet(); }
    }
    if (saveHubView === 'graph' && savingsRecovered) {
      savingsRecovered = false;
      showToast('省钱打卡记录格式异常，已重置（账单数据没受影响）');
    }
  }

  /**
   * 简洁版「省钱」屏的内容渲染。
   * 面板常驻在 #spSaveBody 内，这里只按当前一级视图（radar / graph）重绘，
   * 不碰遮罩、不弹层 —— 与完整版的 openSaveHub 分开，避免两套语义互相污染。
   */
  function renderSaveHubPanel() {
    if (saveHubView === 'graph') {
      if (savingsReady()) { renderSavingsSheet(); }
    } else if (dealsReady()) {
      renderDealsSheet();
    }
  }

  /**
   * 一级分段控件切换。点当前已激活的那一侧不重绘，避免无谓的 DOM 重建。
   * @param {string} view 'radar' | 'graph'
   */
  function switchSaveHub(view) {
    if (view === saveHubView) { return; }
    openSaveHub(view);
  }

  /** 关闭省钱面板（雷达/图谱共用同一个面板，关闭即整体收起） */
  function closeSaveHub() {
    $('saveHubMask').hidden = true;
    /* 关面板就丢掉未保存的改金额状态，下次打开是干净的 */
    savingsEdit = null;
  }

  /* 省钱图谱入口已并入「省钱」面板：同样只做薄封装，调用点保持不变 */
  function openSavingsSheet(tab) { openSaveHub('graph', tab); }

  function closeSavingsSheet() { closeSaveHub(); }

  /**
   * 降级：savings.js 没加载起来时，把纯图谱入口置灰，
   * 而不是留一个点了没反应（或报错）的按钮。账本功能完全不受影响。
   * 注意：#btnSaveHub / #spMenuSaveHub 同时承载省钱雷达，雷达模块正常时不该被拖死，故不在此列。
   */
  function degradeSavingsUi() {
    var ids = ['btnSavingsCard'];
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (!el) { continue; }
      el.disabled = true;
      el.title = '省钱图谱模块未加载';
      el.style.opacity = '0.45';
      el.style.pointerEvents = 'none';
    }
    var mini = $('savingsMini');
    if (mini) { mini.innerHTML = '<div class="dm-line">省钱图谱模块未加载，其他功能正常</div>'; }
  }

  function renderSavingsSheet() {
    if (!savingsReady()) { return; }
    var tabs = DOC.querySelectorAll('#savingsTabs .atab');
    var i;
    for (i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-sv-tab') === savingsTab);
    }
    var st = $('savingsHeadStat');
    if (st) { st.textContent = savingsHeadStatText(); }

    var pane = $('savingsPane');
    if (!pane) { return; }
    var body = pane.parentNode;
    var keepTop = body ? body.scrollTop : 0;

    if (savingsTab === 'map') { pane.innerHTML = savingsMapHtml(); }
    else if (savingsTab === 'index') { pane.innerHTML = savingsIndexHtml(); }
    else if (savingsTab === 'book') { pane.innerHTML = savingsBookHtml(); }
    else if (savingsTab === 'about') { pane.innerHTML = savingsAboutHtml(); }
    else { pane.innerHTML = savingsTodayHtml(); }

    if (body) { body.scrollTop = keepTop; }
  }

  function savingsHeadStatText() {
    var s = savingsSumSummary();
    return '累计省下 ' + money(s.totalSaved) + ' · 打卡 ' + s.count + ' 次';
  }

  /**
   * 单条记录的金额标签。
   * 大促 / 年卡型条目金额记 0（总额不是「今天省了多少」），这里用「大促」「全年」
   * 这种标签替代「—」，否则用户会以为打卡没生效。
   */
  function savingsAmountLabel(entry, saved) {
    if (saved > 0) { return '¥' + SAV.fmt(saved); }
    if (entry && entry.save && entry.save.once) {
      var label = entry.save.onceLabel || '一次性省';
      return label.replace(/可省$/, '').replace(/省$/, '') || '一次性';
    }
    return '—';
  }

  /* ---------------- 今天 ---------------- */

  function savingsTodayHtml() {
    var ctx = savingsCtx();
    var sum = savingsSumSummary();
    var done = savingsTodayDone();
    var html = '';

    html += '<div class="sv-hero">' +
      '<div class="sv-hero-num"><b>' + money(sum.monthSaved) + '</b><small>本周期省下</small></div>' +
      '<div class="sv-hero-num"><b>' + sum.monthCount + '</b><small>本周期打卡</small></div>' +
      '<div class="sv-hero-num"><b>' + money(sum.totalSaved) + '</b><small>累计省下</small></div>' +
      '</div>';

    html += SAV.todayCardHtml(ctx);

    if (done.length) {
      var dSum = 0, i;
      for (i = 0; i < done.length; i++) { dSum += (done[i].rec.saved || 0); }
      html += '<div class="sv-sec">今天已打卡 ' + done.length + ' 条 · 约省 ' + money(dSum) + '</div>';
      html += '<div class="sv-done-list">';
      for (i = 0; i < done.length; i++) {
        var m = SAV.catMeta(done[i].entry.cat);
        html += '<div class="sv-done-row">' +
          '<span class="sv-done-ico">' + SAV.entryIconHtml(done[i].entry, 'sm') + '</span>' +
          '<span class="sv-done-title">' + esc(done[i].entry.title) + '</span>' +
          '<span class="sv-done-save">' + savingsAmountLabel(done[i].entry, done[i].rec.saved) + '</span>' +
          '<button type="button" class="btn-mini" data-sv-act="toggle" data-sv-id="' + esc(done[i].entry.id) + '">撤销</button>' +
          '</div>';
      }
      html += '</div>';
    }

    return html;
  }

  /* ---------------- 图谱 ---------------- */

  function savingsFiltered() {
    var list = savingsCat ? SAV.byCat(savingsCat) : SAV.ENTRIES;
    if (savingsQuery) { return SAV.search(list, savingsQuery); }
    return list;
  }

  function savingsMapHtml() {
    var list = savingsFiltered();
    var html = '';

    html += '<div class="sv-filter">' +
      '<input type="search" id="svSearch" class="sv-search" placeholder="搜「奶茶」「打印」「周四」…" value="' +
      esc(savingsQuery) + '" autocomplete="off" />' +
      '<span class="sv-count" id="svCount">' + list.length + ' 条</span>' +
      '</div>';

    html += '<div class="sv-chips" id="svChips">';
    html += '<button type="button" class="sv-chip' + (savingsCat ? '' : ' active') + '" data-sv-cat="">全部 ' +
      SAV.ENTRIES.length + '</button>';
    SAV.CATS.forEach(function (c) {
      html += '<button type="button" class="sv-chip' + (savingsCat === c.key ? ' active' : '') +
        '" data-sv-cat="' + esc(c.key) + '">' + SAV.catIconHtml(c.key, 'sv-chip-ico') + '<span>' + esc(c.name) + '</span></button>';
    });
    html += '</div>';

    html += '<div class="sv-list" id="svList">' + savingsListHtml() + '</div>';
    return html;
  }

  function savingsListHtml() {
    var list = savingsFiltered();
    if (!list.length) {
      return '<div class="sv-empty">没找到「' + esc(savingsQuery || '该分类') + '」相关的动作。<br>' +
        '<span class="hint">换个说法试试，比如「奶茶」可以搜「茶饮」「瑞幸」「霸王茶姬」。</span></div>';
    }
    var day = savingsDay();
    var html = '', i;
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      var chk = SAV.isChecked(savingsDb.logs, e.id, day);
      html += SAV.entryCardHtml(e, { checked: chk, q: savingsQuery });
      if (savingsOpen[e.id]) { html += savingsDetailHtml(e); }
    }
    return html;
  }

  /** 详情：把「怎么操作」拆成可核对的字段，避免用户被一句口号忽悠 */
  function savingsDetailHtml(e) {
    var day = savingsDay();
    var hits = 0;
    for (var i = 0; i < savingsDb.logs.length; i++) {
      if (savingsDb.logs[i].id === e.id) { hits++; }
    }
    var rows = [
      ['完整做法', e.action],
      ['什么时候能用', SAV.triggerText(e)],
      ['用在哪', SAV.sceneText(e)],
      ['能省多少', SAV.saveRangeText(e)],
      ['门槛', e.gate],
      ['适合谁', e.who],
      ['坑在哪', e.risk],
      ['关联账本分类', (e.billCats || []).join(' / ') || '—'],
      ['数据来源', e.source || '—'],
      ['我的打卡', hits ? '共 ' + hits + ' 次' + (SAV.isChecked(savingsDb.logs, e.id, day) ? '（今天已打卡）' : '') : '还没打卡过']
    ];
    var html = '<div class="sv-detail">';
    for (var k = 0; k < rows.length; k++) {
      html += '<div class="sv-detail-row"><span class="sv-detail-k">' + esc(rows[k][0]) + '</span>' +
        '<span class="sv-detail-v">' + esc(rows[k][1]) + '</span></div>';
    }
    html += '</div>';
    return html;
  }

  /* ---------------- 所有省钱大全（速查索引） ---------------- */

  /**
   * 大全 = 100 条压成一张「一行一条」的速查表。
   * 与「图谱」的分工：图谱是卡片（做法 / 门槛 / 坑，一条占一屏），
   * 大全是索引（一眼扫完 100 条，点任意一条跳回图谱看详情）。
   */
  function savingsIndexHtml() {
    var sum = savingsSumSummary();
    var ctx = savingsCtx();
    var today = SAV.rankToday(SAV.ENTRIES, ctx);
    var day = savingsDay();
    var html = '';

    html += '<div class="sv-hero">' +
      '<div class="sv-hero-num"><b>' + SAV.ENTRIES.length + '</b><small>条动作 · ' + SAV.CATS.length + ' 类</small></div>' +
      '<div class="sv-hero-num"><b>' + today.length + '</b><small>今天能用</small></div>' +
      '<div class="sv-hero-num"><b>' + sum.count + '</b><small>累计打卡</small></div>' +
      '</div>';

    html += '<div class="sv-idx-tools">' +
      '<button type="button" class="btn-mini primary" data-sv-act="export-md">导出 Markdown</button>' +
      '<button type="button" class="btn-mini" data-sv-act="export-csv">导出打卡 CSV</button>' +
      '<span class="sv-count">点任意一条 → 跳到图谱看详情</span>' +
      '</div>';

    SAV.CATS.forEach(function (c) {
      var list = SAV.byCat(c.key);
      html += '<section class="sv-idx-cat">';
      html += '<div class="sv-idx-head"><b>' + SAV.catIconHtml(c.key, 'sv-ico') + ' ' + esc(c.name) + '</b>' +
        '<span class="sv-count">' + list.length + ' 条</span></div>';
      html += '<div class="sv-idx-list">';
      list.forEach(function (e) {
        var chk = SAV.isChecked(savingsDb.logs, e.id, day);
        html += '<button type="button" class="sv-idx-row' + (chk ? ' is-checked' : '') + '"' +
          ' data-sv-act="jump" data-sv-id="' + esc(e.id) + '">' +
          '<span class="sv-idx-t">' + esc(e.title) + '</span>' +
          '<span class="sv-idx-s">' + esc(SAV.saveText(e)) + '</span>' +
          '<span class="sv-idx-w">' + esc(SAV.triggerText(e)) + '</span>' +
          '</button>';
      });
      html += '</div></section>';
    });

    html += '<p class="sv-note">这就是全部 ' + SAV.ENTRIES.length + ' 条，按 10 类排。' +
      '「导出 Markdown」会带上你的打卡记录，可以直接贴进群聊或笔记。</p>';
    return html;
  }

  /* ---------------- 省钱账 ---------------- */

  function savingsBookHtml() {
    var sum = savingsSumSummary();
    if (!sum.count) {
      return '<div class="sv-empty">还没有打卡记录。<br>' +
        '<span class="hint">去「今天」点一条做过的动作，就开始记你的省钱账了。</span></div>';
    }
    var html = '';
    html += '<div class="sv-hero">' +
      '<div class="sv-hero-num"><b>' + money(sum.totalSaved) + '</b><small>累计省下（不清零）</small></div>' +
      '<div class="sv-hero-num"><b>' + sum.count + '</b><small>总打卡次数</small></div>' +
      '<div class="sv-hero-num"><b>' + sum.monthCount + '</b><small>本周期打卡</small></div>' +
      '</div>';

    /* 分类分布：只画有记录的，按金额降序（金额相同按条数） */
    var rows = [];
    for (var k in sum.byCat) {
      if (!Object.prototype.hasOwnProperty.call(sum.byCat, k)) { continue; }
      rows.push({ cat: k, count: sum.byCat[k].count, saved: sum.byCat[k].saved });
    }
    rows.sort(function (a, b) { return (b.saved - a.saved) || (b.count - a.count); });
    var maxSaved = rows.length ? Math.max(rows[0].saved, 1) : 1;

    html += '<div class="sv-sec">省在哪</div><div class="sv-bars">';
    rows.forEach(function (r) {
      var m = SAV.catMeta(r.cat);
      var w = Math.max(2, Math.round(r.saved / maxSaved * 100));
      html += '<div class="sv-bar-row">' +
        '<span class="sv-bar-name">' + SAV.catIconHtml(r.cat, 'sv-ico sm') + ' ' + esc(m.name) + '</span>' +
        '<span class="sv-bar-track"><i style="width:' + w + '%"></i></span>' +
        '<span class="sv-bar-val">' + money(r.saved) + '<small>' + r.count + ' 次</small></span>' +
        '</div>';
    });
    html += '</div>';

    /* 最近打卡：倒序；默认 12 条，可展开全部（全部时才可能翻到老记录改金额） */
    var all = savingsDb.logs.slice().reverse();
    var recent = savingsBookAll ? all : all.slice(0, 12);
    html += '<div class="sv-sec">最近打卡' + (savingsBookAll ? '' : '（最近 ' + recent.length + ' 条）') + '</div>';
    html += '<div class="sv-done-list">';
    recent.forEach(function (r) {
      var e = SAV.byId(r.id);
      if (!e) { return; }
      var m = SAV.catMeta(e.cat);
      if (savingsEdit && savingsEdit.id === r.id && savingsEdit.date === r.date) {
        html += savingsEditRowHtml(e, r);
        return;
      }
      html += '<div class="sv-done-row">' +
        '<span class="sv-done-ico">' + SAV.entryIconHtml(e, 'sm') + '</span>' +
        '<span class="sv-done-title">' + esc(e.title) +
        '<small class="sv-done-date">' + esc(r.date.slice(5)) + '</small></span>' +
        '<span class="sv-done-save">' + savingsAmountLabel(e, r.saved) + '</span>' +
        '<button type="button" class="btn-mini" data-sv-act="edit-amount" ' +
        'data-sv-id="' + esc(r.id) + '" data-sv-date="' + esc(r.date) + '">改</button>' +
        '</div>';
    });
    html += '</div>';

    if (all.length > 12) {
      html += '<button type="button" class="btn-mini sv-more" data-sv-act="toggle-all">' +
        (savingsBookAll ? '收起，只看最近 12 条' : '展开全部 ' + all.length + ' 条') + '</button>';
    }

    var zeroCnt = 0;
    savingsDb.logs.forEach(function (r) { if (!(r.saved > 0)) { zeroCnt++; } });
    if (zeroCnt) {
      html += '<p class="sv-note">其中 <b>' + zeroCnt + '</b> 条只计次数、不计金额：' +
        '大促 / 年卡型（双 11、健身房年卡）省的是「整场活动 / 全年的总额」，' +
        '记进来会让累计金额虚高；长期习惯型（保温杯、图书馆）本来就算不出钱数。</p>';
    }

    html += '<p class="sv-note">「累计省下」不会随预算周期清零；「本周期省下」跟着发钱日走。' +
      '这两个数和冷静期「拦下多少钱」是分开记的——一个是本来就要买、买对了省下的，一个是想买但没买省下的。</p>';
    return html;
  }

  /**
   * 行内改金额的编辑行。
   * 清空输入框 = 恢复引擎估算（不是「改成 0」），这样用户改错了能一键回到默认值。
   */
  function savingsEditRowHtml(e, r) {
    var m = SAV.catMeta(e.cat);
    var once = !!(e.save && e.save.once);
    var est = SAV.estimateSave(e);
    var hint;
    if (once) { hint = '这类是整场 / 全年总额，默认不计金额；想记就自己填'; }
    else if (est === null) { hint = '这条算不出金额，可以自己填一个'; }
    else { hint = '引擎估算 ¥' + SAV.fmt(est) + '，可改；清空恢复估算'; }

    return '<div class="sv-done-row sv-edit-row">' +
      '<span class="sv-done-ico">' + SAV.entryIconHtml(e, 'sm') + '</span>' +
      '<span class="sv-done-title">' + esc(e.title) +
      '<small class="sv-edit-hint">' + esc(hint) + '</small></span>' +
      '<input class="sv-edit-input" id="svEditInput" type="number" inputmode="decimal" min="0" step="0.5" placeholder="金额" ' +
      'value="' + (r.saved > 0 ? SAV.fmt(r.saved) : '') + '" ' +
      'data-sv-id="' + esc(r.id) + '" data-sv-date="' + esc(r.date) + '" />' +
      '<button type="button" class="btn-mini primary" data-sv-act="save-amount">存</button>' +
      '<button type="button" class="btn-mini" data-sv-act="cancel-amount">×</button>' +
      '</div>';
  }

  /**
   * 手改某条记录的金额。
   * 边界：非数字 / 负数 / 过大的数一律拒绝并提示，不写库；
   *      清空 = 恢复引擎估算（once 型回到 0 且 manual=false）。
   */
  function updateSavingsAmount(raw) {
    var input = $('svEditInput');
    var id = input ? input.getAttribute('data-sv-id') : '';
    var date = input ? input.getAttribute('data-sv-date') : '';
    var e = SAV.byId(id);
    if (!e) { return false; }

    var idx = -1, i;
    for (i = 0; i < savingsDb.logs.length; i++) {
      if (savingsDb.logs[i].id === id && savingsDb.logs[i].date === date) { idx = i; break; }
    }
    if (idx === -1) {
      savingsEdit = null;
      renderSavingsSheet();
      showToast('这条记录找不到了，刷新一下再试');
      return false;
    }

    var txt = String(raw === undefined || raw === null ? (input ? input.value : '') : raw).trim();
    var next, manual;

    if (txt === '') {
      /* 恢复引擎估算：金额回到估算值，manual 必须是 false —— 这不是「用户手填的数」，
         CSV 里要如实标「否」，否则统计会把估算当成手改过的数据。 */
      var once = !!(e.save && e.save.once);
      var est = SAV.estimateSave(e);
      next = (est !== null && !once) ? est : 0;
      manual = false;
    } else {
      var n = Number(txt.replace(/[^\d.]/g, ''));
      if (txt.replace(/[^\d.]/g, '') !== txt || !isFinite(n) || n < 0) {
        showToast('金额只能填 0 或正数');
        return false;
      }
      if (n > 99999) {
        showToast('金额太大了，是不是多打了个 0');
        return false;
      }
      next = Math.round(n * 100) / 100;
      manual = true;
    }

    savingsDb.logs[idx].saved = next;
    savingsDb.logs[idx].manual = manual;
    savingsDb.updatedAt = Date.now();
    saveSavingsDb();
    savingsEdit = null;
    renderSavingsSheet();
    renderSavingsMini();
    showToast(txt === '' ? '已恢复引擎估算' : '已改成 ' + money(next));
    return true;
  }

  /* ---------------- 口径说明 ---------------- */

  function savingsAboutHtml() {
    var sum = savingsSumSummary();
    var html = '';
    html += '<div class="sv-about">';
    html += '<p><b>这 100 条从哪来？</b>来自《大学生全网省钱与防割韭菜图谱》100 条实操，按「连锁快餐 / 简餐外卖 / 校园食堂 / 茶饮咖啡 / 零食夜市 / 商超日用 / 娱乐社交 / 交通出行 / 学习考证 / 促销节点」10 类各 10 条整理。</p>';
    html += '<p><b>金额怎么算的？</b>每条动作带一个估算方式：</p>' +
      '<ul class="sv-ul">' +
      '<li><b>固定省额</b>：原文给了明确差价，直接算。</li>' +
      '<li><b>折扣比</b>：原文说「打几折」且能给到原价基准，才乘出金额；给不出基准就只显示折扣，不硬凑钱数。</li>' +
      '<li><b>区间</b>：原文只说「省几十」这类，取区间中位数，界面上显示区间。</li>' +
      '<li><b>无法量化</b>：保温杯、图书馆这类长期习惯，照样能打卡，但不进金额累计——否则等于编数字。</li>' +
      '</ul>';
    html += '<p><b>三个标签什么意思？</b></p>' +
      '<ul class="sv-ul">' +
      '<li><span class="sv-tag sv-tag-varies">力度常变</span> 会员日折扣、百亿补贴这类，力度每期不同，别拿旧价当承诺。</li>' +
      '<li><span class="sv-tag sv-tag-local">以你学校为准</span> 依赖具体校区 / 门店（食堂档口、教师食堂、南城香），到店先确认。</li>' +
      '<li>无标签 = 规则稳定，按日期算就行。</li>' +
      '</ul>';
    html += '<p><b>红线：</b>所有金额都是估算区间，不承诺最低价，不写死平台实时价。真下单前以商家当期页面为准。</p>';
    html += '<p><b>活动日期</b>由本地日期算法推算（周几 / 每月几号 / 固定月日 / 时间区间），不联网抓取，所以离线也能用。</p>';
    html += '<p class="sv-note">你现在的打卡库：' + sum.count + ' 条记录，累计 ' + money(sum.totalSaved) +
      '；存放于浏览器本地，键名 <code>ai_jizhang_savings_v1</code>，与账单分开。清掉它不会影响你的账本。</p>';
    html += '</div>';
    return html;
  }

  /* ---------------- 打卡 ---------------- */

  /**
   * 打卡 / 撤销。同一条目同一自然日只保留一条记录，所以第二次点就是撤销（幂等）。
   *
   * ⚠️ 金额口径（踩过坑）：
   *   `once` 型条目（双 11 / 年卡 / 报班）的 save 是**整场活动 / 全年的总额**，
   *   不是「今天做这一下省了多少」。若直接拿 estimateSave 入库，点一次「双 11」
   *   就会往省钱账里加 ¥300，累计金额瞬间失真、分类条形也被促销类霸榜。
   *   所以 once 型只记打卡次数、金额记 0，并在提示里说清楚。
   *   `none` 型（保温杯 / 图书馆）本来就算不出金额，同样记 0。
   */
  function toggleSavings(id) {
    if (!savingsReady()) { return; }
    var e = SAV.byId(id);
    if (!e) { return; }
    var day = savingsDay();
    var est = SAV.estimateSave(e);
    var once = !!(e.save && e.save.once);
    /* 传 undefined 而不是 0：引擎估算不是「用户手动改的金额」，CSV 里要如实标「否」 */
    var savedArg = (once || est === null) ? undefined : est;
    var res = SAV.toggleCheck(savingsDb.logs, id, day, savedArg);
    savingsDb.logs = res.logs;
    saveSavingsDb();

    if (res.action === 'add') {
      if (once) {
        showToast('已打卡：' + e.title + '（大促 / 年卡总额不计入省钱账）');
      } else {
        showToast('已打卡：' + e.title + (est ? ' · 记下约省 ' + money(est) : ''));
      }
    } else {
      showToast('已撤销：' + e.title);
    }
    renderSavingsSheet();
    renderSavingsMini();
  }

  function savingsExportCsv() {
    if (!savingsDb.logs.length) { showToast('还没有打卡记录'); return; }
    var rows = [['日期', '动作', '分类', '估算省下', '是否手动改过']];
    savingsDb.logs.forEach(function (r) {
      var e = SAV.byId(r.id);
      rows.push([
        r.date,
        e ? e.title : r.id,
        e ? SAV.catMeta(e.cat).name : '未知',
        r.saved > 0 ? r.saved.toFixed(2) : '',
        r.manual ? '是' : '否'
      ]);
    });
    downloadCsv('我的省钱记录.csv', rows);
    showToast('已导出 ' + savingsDb.logs.length + ' 条打卡记录');
  }

  /**
   * 导出「所有省钱大全」Markdown：100 条全量 + 我的打卡次数。
   * 为什么用 .md 而不是 .txt：能直接贴进群聊 / 飞书 / Notion，标题层级不丢。
   */
  function savingsExportMarkdown() {
    if (!savingsReady()) { return; }
    var md = SAV.toMarkdown({ logs: savingsDb.logs, now: new Date() });
    var name = '所有省钱大全-' + SAV.dateKey(new Date()) + '.md';
    if (downloadText(name, md, 'text/markdown;charset=utf-8')) {
      showToast('已导出 ' + SAV.ENTRIES.length + ' 条 · ' + Math.round(md.length / 1024) + ' KB');
    }
  }

  /* ---------------- 看板小卡 / 聊天入口 ---------------- */

  function renderSavingsMini(ov) {
    var box = $('savingsMini');
    if (!box) { return; }
    if (!savingsReady()) {
      box.innerHTML = '<div class="dm-line">省钱图谱没加载起来，刷新页面再试</div>';
      return;
    }
    var ctx = savingsCtx(ov);
    var list = SAV.rankToday(SAV.ENTRIES, ctx);
    var sum = savingsSumSummary();
    var html = '', i;

    if (!list.length) {
      html += '<div class="dm-line">' + ic('target', 'bico-brand', '已完成') + '今天的动作都打完卡了</div>';
    } else {
      for (i = 0; i < list.length && i < 3; i++) {
        html += '<div class="dm-line"><span class="dm-dot"></span><b>' +
          esc(list[i].title) + '</b> <em>' + esc(SAV.saveText(list[i])) + '</em></div>';
      }
    }
    html += '<div class="dm-line dm-tip">' + ic('bulb', 'bico-brand', '提示') + '本周期省下 ' + money(sum.monthSaved) +
      ' · 累计打卡 ' + sum.count + ' 次</div>';
    box.innerHTML = html;
  }

  /** 聊天入口：今天怎么省（文字版，不塞按钮，避免聊天区还要单独绑事件） */
  function showSavingsTodayCard() {
    switchView('chat');
    if (!savingsReady()) {
      addAIMessage(aiBubble('省钱图谱没加载起来，刷新页面再试。'));
      return;
    }
    var ctx = savingsCtx();
    var list = SAV.rankToday(SAV.ENTRIES, ctx);
    if (!list.length) {
      addAIMessage(aiBubble(ic('target', 'bico-brand', '已完成') + '今天的动作都打完卡了<br>点顶部「省钱」→「省钱图谱」分段，翻翻别的分类，或者明天再来。'));
      return;
    }
    var hitN = 0, i;
    for (i = 0; i < list.length; i++) {
      if (list[i].trigger && SAV.matchTrigger(list[i], new Date())) { hitN++; }
    }
    var html = hitN
      ? '今天命中 <b>' + hitN + '</b> 条踩点优惠，先看这几条：'
      : '今天没有踩点的规则优惠，下面这几条随时都能用：';
    html += '<div class="sv-chat-list">';
    for (i = 0; i < list.length; i++) {
      html += '<div class="sv-chat-row"><b>' + esc(list[i].title) + '</b>' +
        '<span>' + esc(SAV.saveText(list[i])) + '</span>' +
        '<i>' + esc(list[i].action) + '</i></div>';
    }
    html += '</div>';
    html += '<span class="hint">点顶部「省钱」→「省钱图谱」，可以看全部 100 条，做过的动作点一下打卡，我帮你记省了多少。</span>';
    addAIMessage(aiBubble(html));
  }

  /** 聊天入口：按关键词搜图谱 */
  function showSavingsSearch(kw) {
    switchView('chat');
    if (!savingsReady()) {
      addAIMessage(aiBubble('省钱图谱没加载起来，刷新页面再试。'));
      return;
    }
    var q = String(kw || '').trim();
    var list = SAV.search(SAV.ENTRIES, q);
    if (!list.length) {
      addAIMessage(aiBubble('图谱里没搜到「' + esc(q) + '」。<br>换个说法试试：奶茶 / 打印 / 食堂 / 外卖 / 健身房 / 高铁。'));
      return;
    }
    var top = list.slice(0, 3);
    var html = '「' + esc(q) + '」相关动作，最值得先看这 ' + top.length + ' 条：<div class="sv-chat-list">';
    top.forEach(function (e) {
      html += '<div class="sv-chat-row"><b>' + esc(e.title) + '</b>' +
        '<span>' + esc(SAV.saveText(e)) + ' · ' + esc(SAV.triggerText(e)) + '</span>' +
        '<i>' + esc(e.action) + '</i></div>';
    });
    html += '</div>';
    if (list.length > top.length) {
      html += '<span class="hint">还有 ' + (list.length - top.length) + ' 条，点顶部「省钱」→「省钱图谱」搜「' + esc(q) + '」看全部。</span>';
    }
    addAIMessage(aiBubble(html));
  }

  function showSavingsGraph() { openSavingsSheet('map'); }
  function showSavingsIndex() { openSavingsSheet('index'); }
  function showSavingsBook() { openSavingsSheet('book'); }
  function showSavingsPanelToday() { openSavingsSheet('today'); }

  /* ================================================================== */
  /* 消息路由                                                            */
  /* ================================================================== */

  /**
   * 命令白名单（C3）：唯一事实来源是 COMMAND_SPECS；
   * EXACT_COMMANDS 由它生成，保持旧的「{命令文本: 处理函数}」结构与旧引用兼容。
   */
  var COMMAND_SPECS = [
    { key: 'balance', aliases: ['查余额', '余额', '还能花多少'], fn: showBalanceCard },
    { key: 'pie', aliases: ['本月花销饼图', '饼图'], fn: showPieCard },
    { key: 'entry-guide', aliases: ['记一笔'], fn: showEntryGuide },
    { key: 'income', aliases: ['记收入', '记一笔收入'], fn: openIncomeModal },
    { key: 'analysis', aliases: ['账单分析'], fn: openAnalysisSheet },
    { key: 'import', aliases: ['导入账单'], fn: openImportSheet },
    { key: 'ocr', aliases: ['截屏记账', '截图记账'], fn: openOcrModal },
    { key: 'goals', aliases: ['我想攒钱', '我想攒钱买'], fn: showGoalGuide },
    { key: 'savings-graph', aliases: ['省钱图谱'], fn: showSavingsGraph },
    { key: 'savings-today', aliases: ['省钱清单', '今天怎么省'], fn: showSavingsPanelToday },
    { key: 'savings-book', aliases: ['我的省钱账'], fn: showSavingsBook },
    { key: 'savings-index', aliases: ['所有省钱大全', '省钱大全'], fn: showSavingsIndex },
    { key: 'learn', aliases: ['理财课', '理财学院'], fn: showLearnGuide },
    { key: 'settings', aliases: ['设置'], fn: openSettingsPage },
    { key: 'budget', aliases: ['设置预算'], fn: openDrawer }
  ];

  /** 由 COMMAND_SPECS 生成的别名词典（保持旧结构，其他地方的引用零改动） */
  var EXACT_COMMANDS = (function () {
    var map = {};
    var i;
    var j;
    for (i = 0; i < COMMAND_SPECS.length; i++) {
      for (j = 0; j < COMMAND_SPECS[i].aliases.length; j++) {
        map[COMMAND_SPECS[i].aliases[j]] = COMMAND_SPECS[i].fn;
      }
    }
    return map;
  })();

  /**
   * 命令命中结构构造器。
   * @param {string} key 命令 key（埋点 / 分发用）
   * @param {Function} fn 处理函数
   * @param {string} [alias] 命中的别名
   * @return {{key:string, fn:Function, alias:string}}
   */
  function cmdHit(key, fn, alias) {
    return { key: key, fn: fn, alias: alias || '' };
  }

  /**
   * 判断一句话是否命中「本地命令」（无需云端即可处理的明确指令）。
   * 命中返回 {key, fn, alias}，否则返回 null（交给意图分类 / 云端裁决）。
   */
  function commandMatch(raw) {
    var text = String(raw || '').trim();
    if (!text) { return null; }
    if (Object.prototype.hasOwnProperty.call(EXACT_COMMANDS, text)) {
      return cmdHit(text, EXACT_COMMANDS[text], text);
    }
    var compact = text.replace(/\s+/g, '');
    if (compact === '查余额' || compact === '余额' || compact === '还能花多少' || compact === '还能花多少钱' ||
      compact === '我还剩多少' || compact === '看余额') { return cmdHit('balance', showBalanceCard, compact); }
    if (compact.indexOf('饼图') !== -1 || compact === '本月花销' || compact === '花销占比') {
      return cmdHit('pie', showPieCard, compact);
    }
    if (/(改|调|设置).{0,3}预算/.test(compact) || compact === '预算设置') { return cmdHit('budget', openDrawer, compact); }
    if (compact === '设置' || compact === '系统设置' || compact === '偏好设置' ||
      compact === '通用设置' || compact === '打开设置') { return cmdHit('settings', openSettingsPage, compact); }
    if (compact.indexOf('我想攒钱') !== -1 || compact.indexOf('攒钱买') !== -1) {
      return cmdHit('goals', showGoalGuide, compact);
    }
    if (compact.indexOf('记收入') !== -1 || compact.indexOf('记一笔收入') !== -1) {
      return cmdHit('income', openIncomeModal, compact);
    }
    if (compact.indexOf('账单分析') !== -1) { return cmdHit('analysis', openAnalysisSheet, compact); }
    if (compact.indexOf('导入') !== -1 && compact.indexOf('账单') !== -1) {
      return cmdHit('import', openImportSheet, compact);
    }
    if (compact.indexOf('截屏记账') !== -1 || compact.indexOf('截图记账') !== -1) {
      return cmdHit('ocr', openOcrModal, compact);
    }
    /* ---- 业务规则：句子里带金额的一律当成记账（= 意图层的 V4 规则） ----
       ⚠️ 禁止改动：这是「带金额优先记账」的唯一实现处，V4 与它保持同一判据。
       提到这里是因为下面每条「省钱 / 优惠」分支都必须先过它：
       例「肯德基疯狂星期四 25」要记一笔餐饮，不能被活动卡或图谱抢走。 */
    var hasAmount = /(\d+(\.\d+)?)\s*(元|块|块钱)?/.test(compact) &&
      !/(多少钱|贵吗|便宜吗|什么时候|哪天|几天|多久|划算吗|比价|哪家便宜)/.test(compact);
    /* ---- 省钱图谱：必须排在专家「省钱」分支之前，否则「省钱攻略 奶茶」会被专家抢走 ---- */
    if (!hasAmount) {
      var svIdx = compact.indexOf('省钱攻略');
      if (svIdx !== -1 && compact.length > svIdx + 4) {
        var svKw = compact.slice(svIdx + 4);
        return cmdHit('savings-search', function () { showSavingsSearch(svKw); }, compact);
      }
      if (compact.indexOf('所有省钱') !== -1 || compact.indexOf('省钱大全') !== -1 ||
        compact.indexOf('省钱宝典') !== -1) {
        return cmdHit('savings-index', showSavingsIndex, compact);
      }
      if (compact.indexOf('省钱图谱') !== -1) {
        return cmdHit('savings-graph', showSavingsGraph, compact);
      }
      if (compact.indexOf('省钱账') !== -1 || compact.indexOf('省了多少钱') !== -1 ||
        compact.indexOf('省下多少') !== -1) {
        return cmdHit('savings-book', showSavingsBook, compact);
      }
    }
    /* ---- 理财专家：省钱 / 赚钱 / 剁手冷静法 ---- */
    if (compact === '理财课' || compact === '理财学院' || compact === '看理财课' ||
      compact === '视频学习') { return cmdHit('learn', showLearnGuide, compact); }
    if (compact.indexOf('剁手冷静法') !== -1 || compact.indexOf('冷静期') !== -1) {
      return cmdHit('cooling-guide', showCoolingGuide, compact);
    }
    if (compact.indexOf('省钱') !== -1 && /(怎么|如何|怎样|方法|攻略|技巧|建议|教我)/.test(compact)) {
      return cmdHit('save-guide', showSaveMoneyGuide, compact);
    }
    if (compact.indexOf('赚钱') !== -1 && /(怎么|如何|怎样|方法|路子|攻略|建议|教我)/.test(compact)) {
      return cmdHit('make-guide', showMakeMoneyGuide, compact);
    }
    if (compact === '省钱' || compact === '省钱攻略' || compact === '省钱方法') {
      return cmdHit('save-guide', showSaveMoneyGuide, compact);
    }
    if (compact === '搞钱' || compact === '搞钱路子' || compact === '赚钱方法') {
      return cmdHit('make-guide', showMakeMoneyGuide, compact);
    }
    /* ---- 省钱雷达：活动日历 / 会员日 / 比价 ---- */
    if (hasAmount) { return null; }
    if (/省钱雷达|优惠提醒|打折日|会员日|今日优惠|今天.*(优惠|特价|打折)|有什么优惠|有啥优惠|优惠活动/.test(compact)) {
      return cmdHit('deals-today', showDealsTodayCard, compact);
    }
    if (compact.indexOf('疯狂星期四') !== -1 || compact.indexOf('肯德基') !== -1 ||
      compact.indexOf('周四吃') !== -1) {
      return cmdHit('deals-kfc', showKfcDealsCard, compact);
    }
    if (compact.indexOf('比价') !== -1 || compact.indexOf('哪家便宜') !== -1 ||
      compact.indexOf('哪里便宜') !== -1 || compact.indexOf('多少钱划算') !== -1 ||
      compact.indexOf('划算吗') !== -1 || compact.indexOf('划算不划算') !== -1) {
      return cmdHit('deals-compare', function () { showDealCompareFromText(text); }, compact);
    }
    return null;
  }

  /**
   * 兼容薄壳（C4）：保留旧函数名，让旧调用点零改动。
   * 说明：C7 重构后 sendToAssistant / routeCommand 都直接用 commandMatch（需要命令 key 做埋点），
   * 本壳**刻意保留**——设计稿 C4 明确要求「改名 + 留薄壳」，也方便回滚/外部脚本引用。
   * 【勿删】当前无内部调用点是已知状态（QA 已备案为偏离），删掉会直接让 C4 验收点失败。
   * @param {string} raw
   * @return {?Function}
   */
  function localCommandName(raw) {
    var hit = commandMatch(raw);
    return hit ? hit.fn : null;
  }

  /* ================================================================== */
  /* 意图路由 · pending 状态机 · 表驱动分发（C8）                        */
  /* ================================================================== */

  /** 云端二次裁决的总开关：置 false 立即回到纯本地（断网态即此状态） */
  var CLOUD_VERDICT_ENABLED = true;
  /** 裁决只需要一个短回答，3s 拿不到就用本地结果（用户感知延迟 12s -> 3s） */
  var VERDICT_TIMEOUT_MS = 3000;

  /**
   * 单轮待补全上下文。**刻意只放内存，不写 localStorage**（刷新即清空，避免跨会话串味）。
   * {id, intent, slots, missing, tries, level, formType, promptKey, lastText, ts}
   */
  var pendingCtx = null;
  var pendingSeq = 0;
  /** 最近 3 条已发 promptKey（反死循环第二道闸） */
  var pendingRecentKeys = [];
  /** 连续判不出（unknown）的次数：第 4 次才落到 L5 */
  var unknownTries = 0;

  function pendingNew(intent, slots, missing, lastText) {
    pendingSeq++;
    return {
      id: 'p' + pendingSeq,
      intent: intent || 'record',
      slots: slots || {},
      missing: missing || [],
      tries: 0,
      level: 2,
      formType: null,
      promptKey: null,
      lastText: String(lastText || ''),
      ts: Date.now()
    };
  }

  function pendingSet(p) { pendingCtx = p; }
  function pendingGet() { return pendingCtx; }
  function pendingClear() { pendingCtx = null; }

  /** pending 是否已过期（TTL 2 分钟） */
  function pendingExpired() {
    if (!pendingCtx) { return true; }
    return (Date.now() - pendingCtx.ts) > INTENT.CONST.PENDING_TTL_MS;
  }

  /** 记一条已发 promptKey（只留最近 3 条） */
  function pendingRememberKey(key) {
    if (!key) { return; }
    pendingRecentKeys.push(key);
    while (pendingRecentKeys.length > 3) { pendingRecentKeys.shift(); }
  }

  /* ---------------- 埋点（C13）：环形缓冲 <= 200 条，不落盘 ---------------- */

  var intentLog = [];

  /**
   * 记录一次意图判定（只在内存，便于评审现场演示与阈值校准）。
   * @param {string} text
   * @param {string} intent
   * @param {number} confidence
   * @param {string} tier
   * @param {Array<string>} missing
   * @param {string} [extra] 'L2' 这类层级，或命令 key
   */
  function logIntent(text, intent, confidence, tier, missing, extra) {
    var item = {
      ts: Date.now(),
      text: String(text || '').slice(0, 30),
      intent: intent,
      confidence: Math.round(Number(confidence || 0) * 100) / 100,
      tier: tier,
      missing: missing || [],
      level: (typeof extra === 'string' && extra.indexOf('L') === 0) ? Number(extra.slice(1)) : null,
      commandKey: (typeof extra === 'string' && extra.indexOf('L') !== 0) ? extra : null,
      promptKey: pendingCtx ? pendingCtx.promptKey : null,
      escalated: !!(pendingCtx && pendingCtx.tries > 0),
      source: 'local'
    };
    intentLog.push(item);
    while (intentLog.length > 200) { intentLog.shift(); }
  }

  /** 只读导出，便于控制台 `AJ_INTENT_LOG()` 现场查看 */
  global.AJ_INTENT_LOG = function () { return intentLog.slice(); };

  /** `?debug=intent` 开关：每条 AI 回复附带 intent · conf · 层级 */
  function intentDebugOn() {
    try {
      var search = String((global.location && global.location.search) || '');
      return /(?:^|[?&])debug=intent(?:[&=#]|$)/.test(search);
    } catch (e) {
      return false;
    }
  }

  /** debug 模式下追加一枚小标签，让现场评审「看得见判定」 */
  function attachIntentTag(res, source) {
    if (!intentDebugOn() || !res) { return; }
    var level = (typeof res.level === 'number') ? res.level : 0;
    addAIMessage('<div class="msg-actions">' +
      tagHtml(res.intent + ' · ' + res.confidence + ' · L' + level + ' · ' + (source || 'local'), 'gray') +
      '</div>');
  }

  /* ---------------- 视图上下文 / 时间范围 ---------------- */

  /**
   * 构造意图层需要的视图上下文（最近一笔 + 该品类 / 该餐段近 30 天均值）。
   * @param {Object} [slots]
   * @return {{now:Date, lastBill:?Object, categoryAvg:number, categoryCount:number, mealAvg:number, mealCount:number}}
   */
  function buildIntentViewCtx(slots) {
    var s = slots || {};
    var ctx = {
      now: new Date(), lastBill: null,
      categoryAvg: 0, categoryCount: 0, categoryAmounts: [],
      mealAvg: 0, mealCount: 0, mealAmounts: []
    };
    if (!state || !state.bills || !state.bills.length) { return ctx; }
    var sorted = state.bills.slice().sort(function (a, b) {
      if (a.date !== b.date) { return a.date < b.date ? 1 : -1; }
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    ctx.lastBill = sorted[0] || null;

    var now = new Date();
    var cutoff = ENG.formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
    var catSum = 0;
    var catN = 0;
    var mealSum = 0;
    var mealN = 0;
    var i;
    for (i = 0; i < state.bills.length; i++) {
      var b = state.bills[i];
      if (b.type === 'income') { continue; }
      if (b.date < cutoff) { continue; }
      if (s.category && b.category === s.category) {
        catSum += Number(b.amount) || 0;
        catN++;
        ctx.categoryAmounts.push(Number(b.amount) || 0);
      }
      if (s.meal && b.meal === s.meal) {
        mealSum += Number(b.amount) || 0;
        mealN++;
        ctx.mealAmounts.push(Number(b.amount) || 0);
      }
    }
    ctx.categoryCount = catN;
    ctx.categoryAvg = catN > 0 ? ENG.round2(catSum / catN) : 0;
    ctx.mealCount = mealN;
    ctx.mealAvg = mealN > 0 ? ENG.round2(mealSum / mealN) : 0;
    return ctx;
  }

  /**
   * 把 slots.period 翻译成日期区间。
   * @param {?string} kind today|week|month|lastMonth|all|cycle
   * @return {{start:string, end:string, label:string}}
   */
  function intentPeriodRange(kind) {
    var today = new Date();
    var todayStr = ENG.formatDate(today);
    var start = todayStr;
    var end = todayStr;
    var label = '今天';
    if (kind === 'week') {
      start = ENG.formatDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6));
      label = '最近 7 天';
    } else if (kind === 'month') {
      start = ENG.formatDate(new Date(today.getFullYear(), today.getMonth(), 1));
      label = '这个月';
    } else if (kind === 'lastMonth') {
      start = ENG.formatDate(new Date(today.getFullYear(), today.getMonth() - 1, 1));
      end = ENG.formatDate(new Date(today.getFullYear(), today.getMonth(), 0));
      label = '上个月';
    } else if (kind === 'all') {
      start = '0000-01-01';
      label = '累计';
    } else if (kind === 'cycle' && state && state.budget) {
      var cycle = ENG.getCycle(today, state.budget.payday, null, state.budget.cycleStart);
      start = cycle.start;
      end = cycle.end;
      label = '本周期';
    }
    return { start: start, end: end, label: label };
  }

  /** 月份位移：'2026-03-31' + (-1) -> '2026-02-28' 这类近似（用于环比） */
  function shiftMonth(dateStr, delta) {
    var p = String(dateStr || '').split('-');
    if (p.length !== 3) { return dateStr; }
    return ENG.formatDate(new Date(Number(p[0]), Number(p[1]) - 1 + delta, Number(p[2])));
  }

  /* ---------------- 小工具 ---------------- */

  /** 生成一枚 .btn-mini（复用既有样式，不新增组件） */
  function miniBtn(attrName, attrVal, label, primary) {
    return '<button type="button" class="btn-mini' + (primary ? ' primary' : '') + '" ' +
      attrName + '="' + esc(attrVal) + '">' + esc(label) + '</button>';
  }

  /** .msg-actions 容器 */
  function actionsWrap(inner) {
    return '<div class="msg-actions">' + inner + '</div>';
  }

  /** 兜底取出最近一笔（不依赖 undoStack） */
  function latestBill() {
    if (!state || !state.bills || !state.bills.length) { return null; }
    return state.bills.slice().sort(function (a, b) {
      if (a.date !== b.date) { return a.date < b.date ? 1 : -1; }
      return (b.createdAt || 0) - (a.createdAt || 0);
    })[0];
  }

  /** 从原句里擦掉数字与动词，得到一个能当备注的短语 */
  function cleanupDraftNote(raw, category) {
    var t = String(raw || '')
      .replace(/\d+(?:\.\d{1,2})?/g, ' ')
      .replace(/[，。；、,!！?？~～|]+/g, ' ')
      .replace(/[零〇一二两三四五六七八九十百千]+(?:元|块钱|块|毛|角)/g, ' ')
      .replace(/(花了|买了|付了|充了|一共|总共|大概|左右|差不多)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) { t = category || '其他'; }
    if (t.length > 20) { t = t.slice(0, 20); }
    return t;
  }

  /** 「明天 / 后天」这类未来日期（DATE_WORDS 只覆盖过去与今天） */
  function futureDateOf(text, now) {
    var t = String(text || '');
    var d = new Date(now.getTime());
    if (t.indexOf('大后天') !== -1) { d.setDate(d.getDate() + 3); return ENG.formatDate(d); }
    if (t.indexOf('后天') !== -1) { d.setDate(d.getDate() + 2); return ENG.formatDate(d); }
    if (t.indexOf('明天') !== -1) { d.setDate(d.getDate() + 1); return ENG.formatDate(d); }
    if (t.indexOf('周末') !== -1) {
      var delta = (6 - d.getDay() + 7) % 7;
      d.setDate(d.getDate() + (delta === 0 ? 7 : delta));
      return ENG.formatDate(d);
    }
    return '';
  }

  /* ---------------- 表驱动分发器 ---------------- */

  /** intent(+子槽位) -> 处理器。新增意图只需加一行，不改 if 分支。 */
  var DISPATCH = {
    record: function (res, raw) { return handleRecord(res, raw); },
    query: function (res, raw) {
      /* 查询子槽位缺失（判成 query 但不知道该查什么）绝不能兜到余额卡，
         否则会出现「答非所问」。给的是 L4 的三个入口。 */
      if (!res.queryKind || (res.missing && res.missing.indexOf('queryKind') !== -1)) {
        return answerQueryClarify(res);
      }
      return (QUERY_DISPATCH[res.queryKind] || QUERY_DISPATCH.detail)(res, raw);
    },
    howto: function (res, raw) { return answerHowto(res, raw); },
    advice: function (res, raw) { return handleAdvice(res, raw); },
    dataop: function (res, raw) { return handleDataOp(res, raw); },
    chitchat: function (res, raw) { return answerChitchat(res, raw); },
    unknown: function (res, raw) { return answerGiveUp(res, raw); }
  };

  var QUERY_DISPATCH = {
    balance: function () { showBalanceCard(); },
    pie: function () { showPieCard(); },
    category: function (res, raw) { answerCategoryQuery(res, raw); },
    detail: function (res, raw) { answerDetailQuery(res, raw); }
  };

  /**
   * 按意图分发（唯一出口）。任何处理器内部的追问都必须经 INTENT.buildPrompt，
   * 这是「同一提示语不得重复」的实现前提。
   * @param {Object} res classifyIntent 的结果
   * @param {string} raw 用户原句
   * @param {string} [source] local|cloud|merged
   */
  function dispatchByIntent(res, raw, source) {
    if (!res) { return; }
    /* 连续判不出的计数器：只要这一句判出了别的意图就归零 */
    if (res.intent !== 'unknown') { unknownTries = 0; }
    attachIntentTag(res, source || 'local');
    var fn = DISPATCH[res.intent] || DISPATCH.unknown;
    fn(res, raw);
  }

  /* ---------------- 记账 ---------------- */

  /**
   * 记账：有金额直接入账（保留 waitBuy 前置，与今天行为一致）；没金额走模糊阶梯。
   * @param {Object} res
   * @param {string} raw
   */
  function handleRecord(res, raw) {
    var parsed = NLP.parseBill(raw, { now: new Date() });
    if (parsed.items.length > 0) {
      /* ⚠️ 不回归：先问 isWantBuy（「我想买个耳机 500」仍走冷静法） */
      var wantBuy = COACH.isWantBuy(raw);
      if (wantBuy) {
        pendingClear();
        startCoolingFlow(wantBuy.item, wantBuy.price);
        return;
      }
      if (res.plan) {
        addAIMessage(aiBubble('这笔还没发生吧？我先记上，真花了再改也来得及。'));
      }
      /* F3 部分解析：金额数 > 解析笔数 -> 轻声提示漏了几笔 */
      var nAmt = NLP.findAmounts(raw).length;
      if (nAmt > parsed.items.length) {
        addAIMessage(aiBubble('这句里好像有 ' + nAmt + ' 个金额，我先记了 ' +
          parsed.items.length + ' 笔，剩下的你再补一句。'));
      }
      pendingClear();
      startFlow(parsed.items);
      return;
    }
    fuzzyAskAmount(res, raw);
  }

  /**
   * 判断两次输入是不是「同一件东西的重试」（只做字面判断，不做语义猜测）。
   * 相同 / 互为子串即视为同一件：此时才继续升级阶梯；
   * 换了一件新东西（比如上一条问「奶茶」，这条问「一双鞋」）必须重新从 L2 开始。
   * @param {string} a
   * @param {string} b
   * @return {boolean}
   */
  function sameItemText(a, b) {
    var x = String(a || '').replace(/\s+/g, '');
    var y = String(b || '').replace(/\s+/g, '');
    if (!x || !y) { return false; }
    if (x === y) { return true; }
    if (x.length >= 2 && y.indexOf(x) !== -1) { return true; }
    if (y.length >= 2 && x.indexOf(y) !== -1) { return true; }
    return false;
  }

  /**
   * 用模糊量词重画 L2 区间按钮（不升阶梯：这是「听懂了但不精确」，不是「没听懂」）。
   * promptKey 带上量词与尝试次数，避免和上一次的 L2 撞 key；
   * 若同一个量词连着给两次，则按反死循环规则升级到 L3。
   * @param {Object} pending
   * @param {Object} fuzzy {label, min, max, guess}
   */
  function reaskAmountRange(pending, fuzzy) {
    var key = 'record|amount|2#fuzzy:' + (fuzzy && fuzzy.label ? fuzzy.label : '?') + ':' + pending.tries;
    if (INTENT.mustEscalate(key, pendingRecentKeys)) {
      fuzzyAskAmount({ slots: pending.slots, confidence: 0.3, tier: 'low' }, pending.lastText);
      return;
    }
    var viewCtx = buildIntentViewCtx(pending.slots);
    var prompt = INTENT.buildPrompt({
      intent: 'record',
      slots: pending.slots,
      missing: ['amount'],
      level: 2,
      formType: 'chip_group',
      lastText: pending.lastText,
      hints: INTENT.amountHints(pending.slots, viewCtx),
      pendId: pending.id,
      promptKey: key
    }, viewCtx);
    addAIMessage(prompt.html);
    pending.promptKey = key;
    pending.level = 2;
    pending.formType = 'chip_group';
    pending.ts = Date.now();
    pendingSet(pending);
    pendingRememberKey(key);
  }

  /**
   * 记账缺金额的统一入口 —— 替代已退役的旧兜底（现由 answerGiveUp 承担 L5）。
   * 逐次调用会自动升级阶梯（tries 记在 pendingCtx 上，永不重复同一句提示）。
   * @param {Object} res
   * @param {string} raw
   */
  function fuzzyAskAmount(res, raw) {
    var slots = (res && res.slots) ? res.slots : {};
    var pending = pendingGet();
    var fresh = (!pending || pending.intent !== 'record' || pendingExpired() ||
      !sameItemText(raw, pending.lastText));
    if (fresh) {
      pending = pendingNew('record', slots, ['amount'], raw);
      /* 新的一件东西：去重闸门的记忆也只属于上一件，一并清掉 */
      pendingRecentKeys = [];
    } else {
      pending.lastText = raw;
      var keys = ['category', 'date', 'meal', 'plan'];
      var i;
      for (i = 0; i < keys.length; i++) {
        if (slots[keys[i]]) { pending.slots[keys[i]] = slots[keys[i]]; }
      }
      if (slots.amountFuzzy) { pending.slots.amountFuzzy = slots.amountFuzzy; }
      if (slots.drink) { pending.slots.drink = true; }
    }
    pending.missing = ['amount'];
    pending.ts = Date.now();

    var hint = INTENT.resolveLevel(pending, 'record', ['amount']);
    /* 反死循环第二道闸：最近 3 条已发 promptKey 命中即强制升级（只对「同一件东西的重试」生效） */
    var probe = { tries: pending.tries, level: hint.level, formType: hint.formType, promptKey: hint.promptKey };
    var guard = 0;
    while (!fresh && INTENT.mustEscalate(hint.promptKey, pendingRecentKeys) && hint.level < 5 && guard < 3) {
      probe.tries = probe.tries + 1;
      hint = INTENT.resolveLevel(probe, 'record', ['amount']);
      guard++;
    }

    pending.level = hint.level;
    pending.formType = hint.formType;
    pending.promptKey = hint.promptKey;
    pendingSet(pending);

    var viewCtx = buildIntentViewCtx(pending.slots);
    var prompt = INTENT.buildPrompt({
      intent: 'record',
      slots: pending.slots,
      missing: ['amount'],
      level: hint.level,
      formType: hint.formType,
      lastText: raw,
      hints: INTENT.amountHints(pending.slots, viewCtx),
      pendId: pending.id,
      promptKey: hint.promptKey
    }, viewCtx);

    addAIMessage(prompt.html);
    pendingRememberKey(hint.promptKey);
    pending.tries++;
    logIntent(raw, 'record', res ? res.confidence : 0, res ? res.tier : 'low', ['amount'], 'L' + hint.level);
  }

  /**
   * 把用户这一句里能填的槽位填进 pending；齐了就直接落账。
   * @param {Object} pending
   * @param {string} val 用户输入（可能是裸金额「12」，也可能是一句「奶茶 12」）
   * @return {boolean} 是否已提交
   */
  function applySlotValue(pending, val) {
    if (!pending) { return false; }
    var text = String(val || '').trim();
    var slots = pending.slots || {};
    var missing = pending.missing || [];
    var amounts = NLP.findAmounts(text);

    if (missing.indexOf('amount') !== -1) {
      var amount = amounts.length > 0 ? amounts[0].value : Number(text.replace(/[^\d.]/g, ''));
      if (!isFinite(amount) || amount <= 0) {
        /* 用户给的是模糊量词（「十几块」）：他听懂了问题，只是不精确，
           因此不升阶梯、也不瞎猜入账，而是用区间按钮再问一次（§3.2 F4）。 */
        var fuzzy = INTENT.fuzzyAmountOf(text);
        if (fuzzy) {
          slots.amountFuzzy = fuzzy;
          pending.slots = slots;
          reaskAmountRange(pending, fuzzy);
          return false;
        }
        /* 完全没数字 -> 继续阶梯（不重复同一句提示） */
        fuzzyAskAmount({ slots: slots, confidence: 0.3, tier: 'low' }, pending.lastText);
        return false;
      }
      slots.amount = ENG.round2(amount);
      /* 多轮上下文：用户只回了纯金额时，品类/餐段沿用上一句（如「我想去吃饭」），
         只在槽位为空时补，已有值不覆盖。 */
      var bareNum = String(text).replace(/[\d.]/g, '').replace(/[元块钱\s，。；、,!！?？~～|]+/g, '');
      if (bareNum.length === 0 && pending.lastText) {
        if (!slots.category) {
          var ctxCat = NLP.classify(pending.lastText);
          if (ctxCat && ctxCat !== '其他') { slots.category = ctxCat; }
        }
        if (!slots.meal) {
          var ctxTime = NLP.parseTime(pending.lastText, new Date());
          if (ctxTime && ctxTime.meal) { slots.meal = ctxTime.meal; }
        }
      }
    }
    if (missing.indexOf('category') !== -1) {
      var cat = NLP.classify(text);
      if (cat && cat !== '其他') { slots.category = cat; }
    }
    if (missing.indexOf('target') !== -1 && INTENT.detectSignals(text).SIG_ANAPHORA) {
      slots.target = 'last';
    }
    /* 用户这次说的是「打车 15」而不只是「15」时，以这一句为新的主语与品类：
       否则会把金额套到上一轮那句（比如上一轮是「红糖糍粑」）上，造成记错。 */
    var bareText = text.replace(/[\d.]+/g, '').replace(/[元块钱\s，。；、,!！?？~～|]+/g, '');
    if (bareText.length >= 2) {
      pending.lastText = text;
      var freshCat = NLP.classify(text);
      if (freshCat && freshCat !== '其他') { slots.category = freshCat; }
    }
    pending.slots = slots;

    var still = INTENT.missingSlots(pending.intent || 'record', slots);
    if (still.length > 0) {
      pending.missing = still;
      if (still.indexOf('amount') !== -1) {
        fuzzyAskAmount({ slots: slots, confidence: 0.3, tier: 'low' }, pending.lastText);
      } else {
        pendingClear();
        addAIMessage(aiBubble('还差一点信息，直接跟我说一句完整的就行，比如「奶茶 12」。'));
      }
      return false;
    }

    if ((pending.intent || 'record') !== 'record') {
      /* 非记账的 pending：清空后交给常规路由，避免卡在补槽位上 */
      var rawText = pending.lastText;
      pendingClear();
      routeByIntent(rawText);
      return false;
    }

    var draft = pendingDraft(pending, slots);
    pendingClear();
    startFlow([draft]);
    return true;
  }

  /**
   * 用 pending 里已确认的槽位组装一笔账单草稿。
   * @param {Object} pending
   * @param {Object} slots
   * @return {Object} BillDraft
   */
  function pendingDraft(pending, slots) {
    var raw = String((pending && pending.lastText) || '');
    var parsed = NLP.parseBill(raw, { now: new Date() });
    var base = parsed.items.length > 0 ? parsed.items[0] : null;
    var category = slots.category || (base ? base.category : '其他');
    var date = slots.date || futureDateOf(raw, new Date()) || (base ? base.date : ENG.formatDate(new Date()));
    var note = (base && base.note) ? base.note : cleanupDraftNote(raw, category);
    var motive = NLP.detectMotivation(raw);
    return {
      amount: slots.amount,
      category: category,
      note: note,
      date: date,
      motivation: motive.motivation,
      want: motive.want,
      type: (base && base.type === 'income') ? 'income' : 'expense',
      meal: slots.meal || (base ? base.meal : ''),
      raw: raw
    };
  }

  /**
   * 判断这句新输入是不是在回答上一轮的追问（只认「填得上缺的那个槽位」）。
   * @param {string} raw
   * @param {Object} pending
   * @return {boolean}
   */
  function isSlotAnswer(raw, pending) {
    if (!pending) { return false; }
    var text = String(raw || '').trim();
    if (!text) { return false; }
    var missing = pending.missing || [];
    var i;
    for (i = 0; i < missing.length; i++) {
      if (missing[i] === 'amount') {
        if (NLP.findAmounts(text).length > 0) { return true; }
        if (/^\s*\d+(\.\d+)?\s*(元|块|块钱)?\s*$/.test(text)) { return true; }
        /* 模糊金额（「十几块」）也是有效作答：回到 L2 的区间按钮，而不是被当成新话题 */
        if (INTENT.detectSignals(text).SIG_AMOUNT_FUZZY) { return true; }
      }
      if (missing[i] === 'category') {
        if (NLP.classify(text) !== '其他') { return true; }
      }
      if (missing[i] === 'target') {
        if (INTENT.detectSignals(text).SIG_ANAPHORA) { return true; }
      }
    }
    return false;
  }

  /**
   * 用户点了 L2 / L3 的待补全按钮。
   * @param {string} val 按钮值：金额数字 / 'form' / 'skip' / 'ask'
   * @param {string} [pendId] 按钮归属的 pending.id（不匹配即拒收，防串味）
   */
  function pendingAnswer(val, pendId) {
    var v = String(val === undefined || val === null ? '' : val);
    if (!pendingCtx) {
      addAIMessage(aiBubble('这张卡过期了，你再说一句我接着办。'));
      return;
    }
    if (pendId && pendingCtx.id !== pendId) {
      /* 点的是历史卡片：拒收，并提示过期 */
      addAIMessage(aiBubble('这张卡过期了，以最新的那条为准。'));
      return;
    }
    if (pendingExpired()) {
      pendingClear();
      addAIMessage(aiBubble('这张卡过期了，你再说一句我接着办。'));
      return;
    }
    var slots = pendingCtx.slots || {};
    if (v === 'form') {
      var presetCat = slots.category || null;
      var presetDate = slots.date || null;
      pendingClear();
      openQuickAddModal(presetCat, presetDate);
      return;
    }
    if (v === 'skip') {
      pendingClear();
      addAIMessage(aiBubble('好，等真花了再记。到时候直接说「' +
        esc(slots.category || '奶茶') + ' 15」就行。'));
      return;
    }
    if (v === 'ask') {
      pendingClear();
      answerHowto({ slots: { topic: 'where' }, confidence: 0.6 }, '');
      return;
    }
    applySlotValue(pendingCtx, v);
  }

  /* ---------------- 查询 ---------------- */

  /**
   * 品类 / 范围统计查询（新增）：复用 .bill-card 列最近 3 笔。
   * @param {Object} res
   * @param {string} raw
   */
  function answerCategoryQuery(res, raw) {
    var slots = (res && res.slots) ? res.slots : {};
    var cat = slots.category || '';
    if (!cat) { showPieCard(); return; }
    var range = intentPeriodRange(slots.period || 'month');
    var list = [];
    var total = 0;
    var i;
    for (i = 0; i < state.bills.length; i++) {
      var b = state.bills[i];
      if (b.type === 'income') { continue; }
      if (b.date < range.start || b.date > range.end) { continue; }
      if (b.category !== cat) { continue; }
      list.push(b);
      total += Number(b.amount) || 0;
    }
    total = ENG.round2(total);

    /* 环比：与上一个自然月同期比较（可解释，不编造） */
    var prevStart = shiftMonth(range.start, -1);
    var prevEnd = shiftMonth(range.end, -1);
    var prevTotal = 0;
    for (i = 0; i < state.bills.length; i++) {
      var pb = state.bills[i];
      if (pb.type === 'income' || pb.category !== cat) { continue; }
      if (pb.date < prevStart || pb.date > prevEnd) { continue; }
      prevTotal += Number(pb.amount) || 0;
    }
    prevTotal = ENG.round2(prevTotal);

    var head = range.label + esc(cat) + ' <b>' + money(total) + '</b>，共 ' + list.length + ' 笔';
    if (prevTotal > 0) {
      var diff = Math.round((total - prevTotal) / prevTotal * 100);
      if (diff > 0) { head += '，比上月同期多 ' + diff + '%'; }
      else if (diff < 0) { head += '，比上月同期少 ' + Math.abs(diff) + '%'; }
      else { head += '，和上月同期持平'; }
    }
    head += '。';
    addAIMessage(aiBubble(head));

    if (list.length === 0) {
      addAIMessage(aiBubble('这段时间没有「' + esc(cat) + '」的支出，换个月份再看也行。'));
      return;
    }
    var recent = list.slice().sort(function (a, b2) {
      if (a.date !== b2.date) { return a.date < b2.date ? 1 : -1; }
      return (b2.createdAt || 0) - (a.createdAt || 0);
    }).slice(0, 3);
    var rows = '';
    for (i = 0; i < recent.length; i++) {
      rows += '<div class="bill-card-main">' +
        '<span class="bill-card-note">' + esc(recent[i].note) + ' · ' + esc(recent[i].date) + '</span>' +
        '<span class="bill-card-amount expense">-' + money(recent[i].amount) + '</span>' +
        '</div>';
    }
    addAIMessage('<div class="bill-card">' +
      '<div class="bill-card-head"><span>' + esc(cat) + ' · ' + esc(range.label) + '</span>' +
      '<span>最近 ' + recent.length + ' 笔</span></div>' + rows + '</div>');
  }

  /** 把日期说人话：今天 / 昨天 / 前天 / 其余给日期本身 */
  function dayLabel(dateStr) {
    var today = new Date();
    var todayStr = ENG.formatDate(today);
    if (dateStr === todayStr) { return '今天'; }
    var d1 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (dateStr === ENG.formatDate(d1)) { return '昨天'; }
    var d2 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2);
    if (dateStr === ENG.formatDate(d2)) { return '前天'; }
    return String(dateStr || '');
  }

  /**
   * 明细查询（新增）：指代 / 某一天的账单，多笔时列候选（F5 指代模糊）。
   * 候选按钮是**非破坏性**的「看这一笔」，避免用户只想确认却被删单。
   * @param {Object} res
   * @param {string} raw
   */
  function answerDetailQuery(res, raw) {
    var slots = (res && res.slots) ? res.slots : {};
    var list = [];
    var i;
    var b;
    var label;
    if (slots.date) {
      for (i = 0; i < state.bills.length; i++) {
        b = state.bills[i];
        if (b.date === slots.date) { list.push(b); }
      }
      label = dayLabel(slots.date);
    } else {
      var range = intentPeriodRange(slots.period || 'today');
      for (i = 0; i < state.bills.length; i++) {
        b = state.bills[i];
        if (b.date < range.start || b.date > range.end) { continue; }
        list.push(b);
      }
      label = range.label;
    }

    if (list.length === 0) {
      addAIMessage('<div class="bubble ai">' + esc(label) + '没有账单记录。</div>' +
        actionsWrap('<button type="button" class="btn-mini primary" data-act="quick-add">记一笔</button>'));
      return;
    }
    if (list.length === 1) {
      b = list[0];
      addAIMessage('<div class="bubble ai">' + esc(label) + '就一笔：<b>' + esc(b.note) + '</b> ' +
        (b.type === 'income' ? '+' : '-') + money(b.amount) + '（' + esc(b.category) + '）。</div>' +
        actionsWrap('<button type="button" class="btn-mini" data-act="bill-open" data-bill="' + esc(b.id) + '">看详情</button>'));
      return;
    }
    /* F5：指代模糊 -> 列出候选，让用户点，不猜 */
    list.sort(function (a, b2) {
      return (b2.createdAt || 0) - (a.createdAt || 0);
    });
    var top = list.slice(0, 3);
    var btns = '';
    for (i = 0; i < top.length; i++) {
      btns += '<button type="button" class="btn-mini" data-act="bill-open" data-bill="' + esc(top[i].id) + '">' +
        esc(top[i].note) + ' ' + money(top[i].amount) + ' · ' + esc(top[i].category) + '</button>';
    }
    addAIMessage('<div class="bubble ai">' + esc(label) + '有 ' + list.length + ' 笔，你说哪个？</div>' +
      actionsWrap(btns));
  }

  /**
   * 看某一笔的详情（明细查询的候选点击）：只读，不改数据。
   * @param {string} id
   */
  function answerBillDetail(id) {
    var b = findBill(id);
    if (!b) {
      addAIMessage(aiBubble('这笔已经不在账本里了（可能被撤回）。'));
      return;
    }
    addAIMessage('<div class="bubble ai">' + esc(b.date) + ' · <b>' + esc(b.note) + '</b> ' +
      (b.type === 'income' ? '+' : '-') + money(b.amount) +
      '<br>分类 ' + esc(b.category) + ' · 动机 ' + esc(b.motivation) +
      (b.merchant ? ' · 商家 ' + esc(b.merchant) : '') + '</div>' +
      actionsWrap('<button type="button" class="btn-mini danger" data-act="undo" data-bill="' + esc(b.id) + '">撤回这笔</button>'));
  }

  /* ---------------- 求助 / 闲聊 / 出口 ---------------- */

  /**
   * 怎么办式求助（新增）：直接给方法 + 一键执行按钮。
   * @param {Object} res
   * @param {string} raw
   */
  function answerHowto(res, raw) {
    var topic = (res && res.slots && res.slots.topic) ? res.slots.topic : 'where';
    pendingClear();
    if (topic === 'backfill') {
      addAIMessage('<div class="bubble ai">能补，日期可以选到昨天。<br>' +
        '点下面直接开表单，金额填一下就行：</div>' +
        actionsWrap('<button type="button" class="btn-mini primary" data-act="howto-backfill">补记昨天的一笔</button>' +
          miniBtn('data-cmd', '昨天那笔是什么', '看昨天花了啥', false) +
          miniBtn('data-act', 'howto-edit', '怎么改已经记过的', false)));
      return;
    }
    if (topic === 'delete' || topic === 'edit') {
      addAIMessage('<div class="bubble ai">两个办法：① 账单卡片右下角「撤回」② 直接跟我说「撤销上一笔」。<br>' +
        '要我帮你删刚才那笔吗？</div>' +
        actionsWrap('<button type="button" class="btn-mini primary" data-act="howto-undo">删掉刚才那笔</button>' +
          miniBtn('data-act', 'howto-backfill', '补记昨天的一笔', false)));
      return;
    }
    addAIMessage('<div class="bubble ai">入口有三个：① 顶栏「＋ 记一笔」② 直接说「午饭食堂 15」③ 点下面按钮。<br>' +
      '截图记账在右上角的相机图标里。</div>' +
      actionsWrap('<button type="button" class="btn-mini primary" data-act="quick-add">手动记一笔</button>' +
        miniBtn('data-cmd', '截屏记账', '用截图记账', false)));
  }

  /**
   * 闲聊 / 情绪承接（新增）：必须给出口，且不再追问同一件事。
   * @param {Object} res
   * @param {string} raw
   */
  function answerChitchat(res, raw) {
    var mood = (res && res.slots && res.slots.mood) ? res.slots.mood : '';
    var head;
    if (mood === 'empty') {
      head = '我在～要记账就说「午饭食堂 15」，要查账就说「查余额」。';
    } else if (mood === 'greeting') {
      head = '在呢～想记一笔还是查查余额？';
    } else if (mood) {
      head = '「' + esc(mood) + '」的时候先别算钱了，记完就放松下。<br>顺手做一件？';
    } else {
      head = '收到～顺手做一件？';
    }
    addAIMessage('<div class="bubble ai">' + head + '</div>' +
      actionsWrap('<button type="button" class="btn-mini primary" data-act="quick-add">记今天花了啥</button>' +
        miniBtn('data-cmd', '查余额', '看这周还剩多少', false) +
        miniBtn('data-cmd', '怎么省钱', '怎么少花点', false)));
  }

  /**
   * 判成 query 但缺 queryKind（不知道该查什么）时的澄清卡。
   * 复用 unknown 的「三个最常用入口」，绝不兜到余额卡。
   * @param {Object} res
   */
  function answerQueryClarify(res) {
    pendingClear();
    var prompt = INTENT.buildPrompt({
      intent: 'unknown', slots: (res && res.slots) || {}, missing: ['queryKind'],
      level: 4, formType: 'choice', lastText: '', hints: []
    }, null);
    addAIMessage(prompt.html);
  }

  /**
   * 彻底放弃 + 人工出口（C5，取代旧兜底）。
   * 首次判不出（unknown）走 L4「三个最常用入口」，连续第 4 次才走 L5「不再猜」。
   * 文案不含问号，也不再要求用户重说 —— 死循环到此为止。
   * @param {Object} [res] classifyIntent 的结果（用 res.level 判断该给哪一层）
   */
  function answerGiveUp(res) {
    unknownTries++;
    var level = unknownTries >= 4 ? 5 : 4;
    if (res && typeof res.level === 'number' && res.level >= 5) { level = 5; }
    pendingClear();
    var prompt = INTENT.buildPrompt({
      intent: 'unknown', slots: {}, missing: ['intent'],
      level: level,
      formType: level >= 5 ? 'giveup' : 'choice',
      lastText: '',
      hints: []
    }, null);
    addAIMessage(prompt.html);
  }

  /* ---------------- 建议 / 数据操作 ---------------- */

  /**
   * 理财建议：先保留 isWantBuy 的完整语义（含负向规则），否则走省钱 / 赚钱。
   * @param {Object} res
   * @param {string} raw
   */
  function handleAdvice(res, raw) {
    var wantBuy = COACH.isWantBuy(raw);
    if (wantBuy) {
      pendingClear();
      startCoolingFlow(wantBuy.item, wantBuy.price);
      return;
    }
    var kind = (res && res.slots && res.slots.adviceKind) ? res.slots.adviceKind : 'save';
    if (kind === 'earn') { showMakeMoneyGuide(); return; }
    showSaveMoneyGuide();
  }

  /**
   * 改 / 删 / 撤：有明确指代就直接撤最近一笔；没有就列候选让用户点。
   * @param {Object} res
   * @param {string} raw
   */
  function handleDataOp(res, raw) {
    var slots = (res && res.slots) ? res.slots : {};
    var missing = (res && res.missing) ? res.missing : [];
    pendingClear();
    if (!state.bills.length) {
      addAIMessage(aiBubble('现在还没有账单可以改，先记一笔吧。'));
      return;
    }
    /* 纠错改金额：用户说「记错了，是18不是15」时，把刚才那笔金额改成 18（不新建、不删了重记） */
    var isCorrection = !!(slots.correction) && (typeof slots.amount === 'number');
    if (isCorrection) {
      var ct = (undoStack.length ? findBill(undoStack[undoStack.length - 1]) : null) || latestBill();
      if (!ct) {
        addAIMessage(aiBubble('没找到你刚记的那笔，直接说「奶茶 18」重新记一笔更快。'));
        return;
      }
      var newAmt = ENG.round2(slots.amount);
      if (Math.abs(newAmt - Number(ct.amount)) < 0.005) {
        addAIMessage(aiBubble('这笔本来就是 ' + money(ct.amount) + ' 呀，不用改。'));
        return;
      }
      addAIMessage('<div class="bubble ai">你是说刚才那笔 <b>' + esc(ct.note) + '</b> 应该是 <b>' + money(newAmt) +
        '</b>，不是 <b>' + money(ct.amount) + '</b>？</div>' +
        actionsWrap('<button type="button" class="btn-mini primary" data-act="fix-amount" data-bill="' + esc(ct.id) +
          '" data-val="' + newAmt + '">改成 ' + money(newAmt) + '</button>' +
          '<button type="button" class="btn-mini" data-act="undo" data-bill="' + esc(ct.id) + '">撤回重记</button>'));
      return;
    }
    /* 纠错但没说金额（如单独一句「记错了」）：建立纠错态 + 追问金额，下一句纯数字直接改这一笔（不新增账单） */
    if (slots.correction) {
      var cpT = (undoStack.length ? findBill(undoStack[undoStack.length - 1]) : null) || latestBill();
      if (cpT) { correctionPending = { billId: cpT.id, ts: Date.now() }; }
      addAIMessage(aiBubble('要改成多少？直接说个数字就行，比如 18。'));
      return;
    }
    /* 按备注/品类删除：用户说「把刚才吃黄焖鸡那笔删了」，用剩下的名词匹配账单 */
    var kw = String(raw || '').replace(/[\d.]+/g, '')
      .replace(/删除|删掉|删了|撤了|撤回|撤销|取消|改一下|修改|改成|记错|不对|应该是|把|帮|我|刚才|上次|那笔|这笔|这|一笔|了|的|吧|吃|喝|钱|元|块/g, '')
      .replace(/[\s，。；、,!！?？~～|]/g, '');
    if (kw.length >= 2) {
      var hitList = [];
      var hb;
      for (var hi = 0; hi < state.bills.length; hi++) {
        hb = state.bills[hi];
        if ((hb.note && hb.note.indexOf(kw) !== -1) || hb.category === kw) { hitList.push(hb); }
      }
      if (hitList.length) {
        hitList.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        var hbtn = '';
        for (var hj = 0; hj < hitList.length && hj < 4; hj++) {
          hbtn += '<button type="button" class="btn-mini" data-act="delete-bill" data-bill="' + esc(hitList[hj].id) + '">' +
            '删除 · ' + esc(hitList[hj].note) + ' ' + money(hitList[hj].amount) + ' · ' + esc(hitList[hj].date) + '</button>';
        }
        addAIMessage('<div class="bubble ai">你说的「' + esc(kw) + '」我找到 ' + hitList.length + ' 笔，删哪个？</div>' +
          actionsWrap(hbtn));
        return;
      }
    }
    var hasTarget = (slots.target === 'last') || missing.indexOf('target') === -1;
    if (!hasTarget) {
      var top = state.bills.slice().sort(function (a, b) {
        if (a.date !== b.date) { return a.date < b.date ? 1 : -1; }
        return (b.createdAt || 0) - (a.createdAt || 0);
      }).slice(0, 3);
      var btns = '';
      var i;
      for (i = 0; i < top.length; i++) {
        btns += '<button type="button" class="btn-mini" data-act="undo" data-bill="' + esc(top[i].id) + '">' +
          '撤回 · ' + esc(top[i].note) + ' ' + money(top[i].amount) + '</button>';
      }
      addAIMessage('<div class="bubble ai">你要改哪一笔？点一下就先撤掉（撤掉后能重记）。</div>' +
        actionsWrap(btns));
      return;
    }
    var target = null;
    if (undoStack.length) { target = findBill(undoStack[undoStack.length - 1]); }
    if (!target) { target = latestBill(); }
    if (!target) {
      addAIMessage(aiBubble('没找到可以撤回的那笔，你可以直接点账单卡片右下角的「撤回」。'));
      return;
    }
    var summary = '<b>' + esc(target.note) + ' -' + money(target.amount) + '</b>';
    deleteBill(target.id);
    addAIMessage('<div class="bubble ai">删了刚才那笔：' + summary + '。要重记吗？</div>' +
      actionsWrap('<button type="button" class="btn-mini primary" data-act="quick-add">重记一笔</button>' +
        miniBtn('data-cmd', '查余额', '看一眼余额', false)));
  }

  /* ---------------- 云端裁决（只做二次意见，不做主判） ---------------- */

  /**
   * 是否值得花 3 秒问云端。只有「意图层真有歧义」才值得：
   * record（缺金额是槽位问题）/ command / chitchat / howto 都是本地秒回更优。
   * @param {Object} res
   * @return {boolean}
   */
  function needsCloudVerdict(res) {
    if (!CLOUD_VERDICT_ENABLED) { return false; }
    if (!res) { return false; }
    if (res.intent === 'record' || res.intent === 'command') { return false; }
    if (res.intent === 'chitchat' || res.intent === 'howto') { return false; }
    /* 槽位已齐（意图本身没有歧义，只是数据上的指代模糊）不需要问云端裁决 */
    if (!res.missing || res.missing.length === 0) { return false; }
    return res.tier !== 'high';
  }

  /**
   * 向云端要一个「短裁决」（3s 超时即用本地结果）。
   * 只把本地 top2 作为候选传过去，降低幻觉空间。
   * @param {string} raw
   * @param {Object} res 本地分类结果
   * @param {Function} cb cb(verdict|null)
   */
  function askForVerdict(raw, res, cb) {
    var done = false;
    function finish(v) {
      if (done) { return; }
      done = true;
      clearTimeout(timer);
      cb(v);
    }
    if (!cloudReady || typeof global.AJ !== 'object' || typeof global.AJ.ask !== 'function') {
      cb(null);
      return;
    }
    var ranked = INTENT.rankIntents(res.scores || {});
    var top2 = [];
    if (ranked[0]) { top2.push(ranked[0].intent); }
    if (ranked[1]) { top2.push(ranked[1].intent); }
    var ctx = buildContext() || {};
    ctx.pending = pendingCtx ? { intent: pendingCtx.intent, missing: pendingCtx.missing, tries: pendingCtx.tries } : null;
    ctx.localIntent = {
      intent: res.intent,
      confidence: res.confidence,
      candidates: top2,
      missing: res.missing
    };
    var timer = setTimeout(function () { finish(null); }, VERDICT_TIMEOUT_MS);
    var p;
    try {
      p = global.AJ.ask(raw, ctx);
    } catch (e) {
      finish(null);
      return;
    }
    Promise.resolve(p).then(function (json) {
      if (!json || json.fallback === true) { finish(null); return; }
      if (json.intent) {
        finish({ intent: json.intent, confidence: json.confidence, missing: json.clarify ? [json.clarify] : null });
        return;
      }
      if (json.verdict && json.verdict.intent) { finish(json.verdict); return; }
      finish(null);
    }).catch(function () { finish(null); });
  }

  /**
   * 本地入口（C6）：云端不可用时的纯 fallback，只做「命令 -> 意图分发」。
   * 已删除 showParseFailure 调用：任何路径都不再回退到「没听清金额」。
   * @param {string} raw
   */
  function routeCommand(raw) {
    var text = String(raw || '').trim();
    if (!text) { return; }
    var cmd = commandMatch(text);
    if (cmd) {
      logIntent(text, 'command', 0.99, 'high', null, cmd.key);
      cmd.fn();
      return;
    }
    routeByIntent(text);
  }

  /**
   * 纯本地意图路由（本地分类 -> 分发，永不触网）。
   * @param {string} raw
   */
  function routeByIntent(raw) {
    var text = String(raw || '').trim();
    if (!text) { return; }
    var res = INTENT.classifyIntent(text, {
      now: new Date(),
      lastBill: buildIntentViewCtx().lastBill
    });
    logIntent(text, res.intent, res.confidence, res.tier, res.missing);
    dispatchByIntent(res, text, 'local');
  }

  /* ================================================================== */
  /* CSV 导出                                                            */
  /* ================================================================== */

  function csvCell(value) {
    var s = String(value === undefined || value === null ? '' : value);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function toCsv(rows) {
    var lines = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var cells = [];
      var j;
      for (j = 0; j < rows[i].length; j++) {
        cells.push(csvCell(rows[i][j]));
      }
      lines.push(cells.join(','));
    }
    return '\ufeff' + lines.join('\r\n');
  }

  function downloadCsv(filename, rows) {
    var content = toCsv(rows);
    try {
      var blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      var url = global.URL.createObjectURL(blob);
      var a = DOC.createElement('a');
      a.href = url;
      a.download = filename;
      DOC.body.appendChild(a);
      a.click();
      DOC.body.removeChild(a);
      setTimeout(function () { global.URL.revokeObjectURL(url); }, 5000);
    } catch (e) {
      addAIMessage(aiBubble('导出失败了：当前浏览器可能不支持文件下载。'));
    }
  }

  function exportAllCsv() {
    var ov = getOverview();
    // 前 6 列顺序保持与 v1 完全一致，只在末尾追加「收支」「商家」，避免破坏既有消费方
    var billsRows = [['id', '日期', '金额', '分类', '备注', '消费动机', '收支', '商家']];
    var sorted = state.bills.slice().sort(function (a, b) {
      if (a.date !== b.date) { return a.date < b.date ? 1 : -1; }
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    var i;
    for (i = 0; i < sorted.length; i++) {
      var b = sorted[i];
      billsRows.push([
        b.id,
        b.date,
        b.amount.toFixed(2),
        b.category,
        b.note,
        b.type === 'income' ? '收入' : b.motivation,
        b.type === 'income' ? '收入' : '支出',
        b.merchant || ''
      ]);
    }

    var budgetsRows = [['分类', '预算金额', '已花金额']];
    for (i = 0; i < DATA.CATEGORIES.length; i++) {
      var key = DATA.CATEGORIES[i].key;
      var ratio = DATA.CATEGORY_BUDGET_RATIO[key] || 0;
      budgetsRows.push([
        key,
        ENG.round2(state.budget.total * ratio).toFixed(2),
        ENG.round2(ov.cycleAgg.byCategory[key] || 0).toFixed(2)
      ]);
    }

    var goalsRows = [['目标名称', '目标金额', '已攒金额']];
    for (i = 0; i < state.goals.length; i++) {
      goalsRows.push([
        state.goals[i].name,
        state.goals[i].target.toFixed(2),
        state.goals[i].saved.toFixed(2)
      ]);
    }

    downloadCsv('bills.csv', billsRows);
    setTimeout(function () { downloadCsv('budgets.csv', budgetsRows); }, 350);
    setTimeout(function () { downloadCsv('goals.csv', goalsRows); }, 700);

    addAIMessage(aiBubble('已导出 3 个 CSV：bills.csv、budgets.csv、goals.csv（带 UTF-8 BOM，Excel 打开不会乱码）。'));
  }

  /* ================================================================== */
  /* 语音输入                                                            */
  /* ================================================================== */

  function setupVoice() {
    var btn = $('btnMic');
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SR) {
      btn.classList.add('disabled');
      btn.disabled = true;
      btn.title = '当前浏览器不支持语音';
      return;
    }
    var rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = function (event) {
      var text = event.results[0][0].transcript;
      if (text) { handleSend(text); }
    };
    rec.onerror = function () {
      btn.classList.remove('listening');
    };
    rec.onend = function () {
      btn.classList.remove('listening');
    };
    btn.addEventListener('click', function () {
      try {
        btn.classList.add('listening');
        rec.start();
      } catch (e) {
        btn.classList.remove('listening');
      }
    });
  }

  /* ================================================================== */
  /* 事件绑定                                                            */
  /* ================================================================== */

  /* ================================================================== */
  /* 云端对话（WorkBuddy 云服务，失败回退本地 routeCommand）           */
  /* ================================================================== */

  /**
   * 构造给大模型的精简上下文快照（只取展示/记账需要的最小字段）。
   * @param {Object} [localIntent] 本地分类器初判（C12：作为云端裁决的约束传下去）
   * @return {Object|null}
   */
  function buildContext(localIntent) {
    if (!state) { return null; }
    var ov = getOverview();
    var i;
    var recent = state.bills.slice().sort(function (a, b) {
      if (a.date !== b.date) { return a.date < b.date ? 1 : -1; }
      return (b.createdAt || 0) - (a.createdAt || 0);
    }).slice(0, 5).map(function (b) {
      return { category: b.category, amount: b.amount, note: b.note, date: b.date };
    });
    var goals = (state.goals || []).map(function (g) {
      return { name: g.name, target: g.target, saved: g.saved };
    });
    return {
      budgetTotal: state.budget ? state.budget.total : null,
      remaining: ov ? ov.remaining : null,
      todaySpent: ov ? ov.todaySpent : null,
      cycleStart: ov ? ov.cycleStart : null,
      cycleEnd: ov ? ov.cycleEnd : null,
      billCount: state.bills.length,
      recentBills: recent,
      goals: goals,
      /* C12：把「上一轮在等哪个槽位」和「本地初判」一并交给云端，减少重复追问 */
      pending: pendingCtx ? {
        intent: pendingCtx.intent,
        missing: pendingCtx.missing,
        tries: pendingCtx.tries
      } : null,
      localIntent: localIntent || null
    };
  }

  /** 把后端返回的 action 映射到本地的命令函数 */
  var COMMAND_MAP = {
    balance: showBalanceCard,
    pie: showPieCard,
    income: openIncomeModal,
    ocr: openOcrModal,
    analysis: openAnalysisSheet,
    goals: showGoalGuide,
    settings: openSettingsPage
  };

  /**
   * 消息主入口（C7）：命令 -> 本地意图分类 -> pending 续接 -> 高置信本地执行
   * -> 低置信云端二次裁决 -> 兜底 L3 澄清。
   *
   * 设计原则（§4.2.1）：
   *   1) 明确命令仍是最先短路，且「带金额不走命令」规则不变；
   *   2) 意图判断全部在本地（<1ms、断网可用），云端降级为「低置信时的第二意见」；
   *   3) 任何路径都不再回退到「没听清金额」。
   * @param {string} text
   */
  function sendToAssistant(text) {
    var raw = String(text || '').trim();
    if (!raw) { return; }

    /* P0：纠错待补金额——上一轮问「要改成多少」，这一句若为纯数字，直接改上一笔金额（不新增账单） */
    if (correctionPending && (Date.now() - correctionPending.ts) < 120000) {
      var cAmts = NLP.findAmounts(raw);
      var cBare = String(raw).replace(/[\d.]/g, '').replace(/[元块钱\s，。；、,!！?？~～|是改成到应为了吧的]/g, '');
      if (cAmts.length > 0 && cBare.length === 0) {
        var cB = findBill(correctionPending.billId);
        correctionPending = null;
        if (cB) {
          cB.amount = ENG.round2(cAmts[0].value);
          saveState(); renderAll();
          addAIMessage(aiBubble('改好了，这笔现在是 ' + money(cB.amount) + '。'));
        } else {
          addAIMessage(aiBubble('这笔已经不在账本里了（可能被撤回），直接说「奶茶 18」重新记一笔就行。'));
        }
        return;
      }
      correctionPending = null; /* 不是纯金额，清掉，正常处理 */
    }

    /* ① 明确命令（最高优先级；commandMatch 内部已实现「带金额一律记账」的 hasAmount 门控） */
    var cmd = commandMatch(raw);
    if (cmd) {
      pendingClear();
      logIntent(raw, 'command', 0.99, 'high', null, cmd.key);
      cmd.fn();
      return;
    }

    /* ② 本地意图分类（纯函数，不触网，<1ms） */
    var res = INTENT.classifyIntent(raw, {
      now: new Date(),
      lastBill: buildIntentViewCtx().lastBill
    });
    logIntent(raw, res.intent, res.confidence, res.tier, res.missing);

    /* ②.5 团购省钱指导：涉及校外餐饮 / 娱乐且「打算去」（不是记账、不是查账）时提醒先搜券。
     * 放在意图分类之后，是因为「我要查一下这个月吃了多少」这类句子同样含「吃」，
     * 只有拿到 res.intent 才能把它识别为「查消费」并放行。
     * 四重门控，保证绝不抢走记账 / 查账 / 追问：
     *   · !pendingCtx                    —— 正在追问金额的流程里不插话；
     *   · 无金额                         —— 「火锅 80」「奶茶 18」这类记账输入直接放行；
     *   · res.intent 不是 query/dataop/command —— 查余额、查花销、改删撤、命令交给原流程；
     *   · detectGroupBuy.hit             —— kind 非空、planning 为真、且不含校内场景词。
     * 注意：record / advice / chitchat / unknown 一律允许触发——「我明天和舍友去吃火锅」
     * 「周末去KTV」这类无金额的计划句本来就被判成 record，排除 record 会打死主用例。 */
    var gb = (COACH && typeof COACH.detectGroupBuy === 'function') ? COACH.detectGroupBuy(raw) : null;
    if (gb && gb.hit && !pendingCtx && NLP.findAmounts(raw).length === 0 &&
      res.intent !== 'query' && res.intent !== 'dataop' && res.intent !== 'command') {
      pendingClear();
      logIntent(raw, 'groupbuy', 0.9, 'high', null, 'groupbuy');
      /* 与 showSaveMoneyGuide 的专家卡同款外壳（.coach-bubble 只负责宽度），
       * 保证同屏多张教练卡宽度一致，不出现一张窄一张宽。 */
      addAIMessage('<div class="bubble ai coach-bubble">' + COACH.groupBuyAdvice(gb) + '</div>');
      return;
    }

    /* ③ pending 续接：用户可能是在回答上一轮的追问（也可能是换了话题） */
    if (pendingCtx) {
      if (pendingExpired()) {
        pendingClear();
      } else if (res.tier === 'high' && res.intent !== pendingCtx.intent && res.confidence >= 0.75) {
        /* 高置信的新意图：用户主动换话题，旧 pending 直接丢弃 */
        pendingClear();
      } else if ((Date.now() - pendingCtx.ts) > 30000 && NLP.findAmounts(raw).length === 0 &&
        !INTENT.detectSignals(raw).SIG_CATEGORY) {
        /* 半分钟后的「完全不含数字/品类词」输入：更像另一个话题 */
        pendingClear();
      } else if (isSlotAnswer(raw, pendingCtx)) {
        applySlotValue(pendingCtx, raw);
        return;
      }
    }

    /* ④ 高置信 -> 本地直接执行，不调云端（省掉等待，断网也能演示） */
    if (res.tier === 'high' && !needsCloudVerdict(res)) {
      dispatchByIntent(res, raw, 'local');
      return;
    }

    /* ⑤ 低置信 -> 可选云端二次裁决（3s 超时；只允许在本地 top2 内改判） */
    if (res.tier === 'low' && needsCloudVerdict(res)) {
      /* 云端真就绪才插「正在确认」气泡，否则不要闪一下再消失 */
      var thinkingRow = null;
      if (cloudReady && typeof global.AJ === 'object' && typeof global.AJ.ask === 'function') {
        addAIMessage(aiBubble('阿账正在确认…'));
        thinkingRow = chatListEl().lastElementChild;
      }
      askForVerdict(raw, res, function (verdict) {
        if (thinkingRow && thinkingRow.parentNode) {
          thinkingRow.parentNode.removeChild(thinkingRow);
        }
        var finalRes = verdict ? INTENT.mergeVerdict(res, verdict) : res;
        dispatchByIntent(finalRes, raw, verdict ? 'merged' : 'local');
      });
      return;
    }

    /* ⑥ 云端不可用 / verylow -> 本地低置信策略（L3/L4 澄清），永不回到「没听清金额」 */
    dispatchByIntent(res, raw, 'local');
  }

  function handleSend(text) {
    var raw = String(text || '').trim();
    if (!raw) { return; }
    addUserMessage(raw);
    $('chatInput').value = '';
    // 快捷指令 chips：当前发出的指令高亮为激活态（绿底），与设计稿一致
    var chips = DOC.querySelectorAll('#quickChips .chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('active', chips[i].getAttribute('data-cmd') === raw);
    }
    switchView('chat');
    /* 买谷指南 / 二次元触发词拦截：命中则本地直接给结构化回答或轻提示，不走后端记账流 */
    if (guIntercept(raw)) { return; }
    // 改为请求后端；后端不可用或返回 fallback 时，sendToAssistant 内部回退到本地逻辑
    sendToAssistant(raw);
  }

  /* ---- Dim3：按时间/预算生成动态快捷 chips + 会话级主动提示 ---- */
  var proactiveShown = false;
  /** 按时间与预算状态生成快捷 chips */
  function buildSceneChips() {
    var hour = new Date().getHours();
    var res = [];
    var ov, bs;
    try { ov = getOverview(); } catch (e) { ov = null; bs = null; }
    bs = ov && ov.budgetState ? ov.budgetState : null;
    var danger = !!bs && (bs.isOver || bs.status === 'danger');
    if (danger) { res.push({ label: '帮我看下怎么省', cmd: '怎么省钱', coach: true }); }
    res.push({ label: '查余额', cmd: '查余额' });
    res.push({ label: '本月花销饼图', cmd: '本月花销饼图' });
    res.push({ label: '记一笔', cmd: '记一笔' });
    if (hour >= 21 || hour < 2) {
      res.push({ label: '记夜宵', cmd: '夜宵' });
      res.push({ label: '今天花了多少', cmd: '今天花了多少' });
    } else if (hour >= 6 && hour < 10) {
      res.push({ label: '记早餐', cmd: '早餐' });
    }
    res.push({ label: '记收入', cmd: '记收入' });
    res.push({ label: '怎么省钱', cmd: '怎么省钱', coach: true });
    res.push({ label: '今天有啥优惠', cmd: '今天有什么优惠' });
    return res;
  }
  function renderSceneChips() {
    var box = $('quickChips');
    if (!box) { return; }
    var chips = buildSceneChips();
    /* 阿账联动（PRD §5.2 交互③）：紧张 / 超支时把「怎么省钱」chip 的文案换成
       情绪短句 —— data-cmd 一律不变，既有命令路由零改动 */
    var moodForChips = MOOD.resolveMood(safeOverview());
    if (moodForChips === 'nervous' || moodForChips === 'bankrupt') {
      for (var ci = 0; ci < chips.length; ci++) {
        if (chips[ci].cmd === '怎么省钱') { chips[ci].label = '别慌，帮我补窟窿'; break; }
      }
    }
    var html = '';
    var i;
    for (i = 0; i < chips.length; i++) {
      html += '<button class="chip' + (chips[i].coach ? ' coach-chip' : '') + '" type="button" data-cmd="' +
        esc(chips[i].cmd) + '">' + esc(chips[i].label) + '</button>';
    }
    box.innerHTML = html;
    renderMascotBar();
  }
  /**
   * 常驻「阿账对话条」：#quickChips 上方，左 36px 头像（可点 = 戳一戳）+
   * 中一句话（话术池按 mood / 语气取）+ 右箭头动作按钮（data-cmd 送 handleSend）。
   * DOM 常驻、只换文本与 data-mood，绝不 innerHTML 重建整条 —— 否则会把
   * composer 里正在输入的内容与焦点一起打掉（PRD §5.2 性能红线）。
   */
  /**
   * 播报条头像（36px 圆）按当前形象换图，情绪底色（mood-green/amber/red）三形象共用：
   *   - azhang：MOOD.moodSvg 九情绪原画（现状不变）
   *   - sprite ：存钱罐精灵头部特写（同款星星睡帽 + 棉花糖脸，坐标由 120 视窗
   *              原画以头心 (60,66)→(24,29)、0.4 倍缩放映射而来）
   *   - pro    ：记账小管家头部特写，按 profile() 参数化（配色/帽子/照片脸全跟随，
   *              帽子直接复用 petPro._hatSvg 原画，包一层 0.42 倍变换）
   */
  function mascotBarSpriteHead() {
    return '<svg viewBox="0 0 48 48" width="26" height="26" aria-hidden="true">' +
      '<circle cx="24" cy="29" r="16" fill="#FFD0DE"/>' +
      '<ellipse cx="23.2" cy="16.2" rx="18.4" ry="8" fill="#A5DBF4"/>' +
      '<path d="M35.2 12.2 Q47.2 6.6 45.6 15.4 Q44.8 20.2 40 18.6 Q36 17 35.2 13 Z" fill="#A5DBF4"/>' +
      '<path d="M45.6 10.6 l1 2.4 2.4 1 -2.4 1 -1 2.4 -1 -2.4 -2.4 -1 2.4 -1 Z" fill="#FFF3A6"/>' +
      '<ellipse cx="23.2" cy="20.6" rx="17.6" ry="3.6" fill="#EAF8FF"/>' +
      '<path d="M16 13.8 l0.7 1.6 1.6 0.7 -1.6 0.7 -0.7 1.6 -0.7 -1.6 -1.6 -0.7 1.6 -0.7 Z" fill="#FFF3A6"/>' +
      '<ellipse cx="13.2" cy="29.6" rx="2.6" ry="1.6" fill="#FF9DB8" opacity="0.65"/>' +
      '<ellipse cx="34.8" cy="29.6" rx="2.6" ry="1.6" fill="#FF9DB8" opacity="0.65"/>' +
      '<ellipse cx="18" cy="26.6" rx="1.8" ry="2.2" fill="#3A2E33"/>' +
      '<ellipse cx="30" cy="26.6" rx="1.8" ry="2.2" fill="#3A2E33"/>' +
      '<circle cx="18.6" cy="25.8" r="0.6" fill="#fff"/>' +
      '<circle cx="30.6" cy="25.8" r="0.6" fill="#fff"/>' +
      '<path d="M22 32.2 q2 1.6 4 0" fill="none" stroke="#C25E6E" stroke-width="1.1" stroke-linecap="round"/>' +
      '</svg>';
  }
  function mascotBarProHead(p) {
    var d = p || {};
    var body = d.body || '#FFD0DE';
    var line = d.line || '#7A4A55';
    var cheek = d.cheek || '#FF9DB8';
    var s = '<svg viewBox="0 0 48 48" width="26" height="26" aria-hidden="true">';
    s += '<circle cx="24" cy="30" r="15" fill="' + body + '" stroke="' + line + '" stroke-width="2"/>';
    if (d.face) {
      /* 照片脸：与 charSVG 同款圆裁剪，直接顶到脸上 */
      s += '<clipPath id="pmBarFaceClip"><circle cx="24" cy="31" r="10.5"/></clipPath>';
      s += '<image href="' + d.face + '" x="13.5" y="20.5" width="21" height="21" ' +
        'preserveAspectRatio="xMidYMid slice" clip-path="url(#pmBarFaceClip)"/>';
      s += '<circle cx="24" cy="31" r="10.5" fill="none" stroke="' + line + '" stroke-width="1.6" opacity="0.85"/>';
    } else {
      s += '<ellipse cx="12.8" cy="33" rx="2.8" ry="1.8" fill="' + cheek + '" opacity="0.6"/>';
      s += '<ellipse cx="35.2" cy="33" rx="2.8" ry="1.8" fill="' + cheek + '" opacity="0.6"/>';
      s += '<ellipse cx="18.5" cy="29" rx="3.2" ry="3.6" fill="#fff" stroke="' + line + '" stroke-width="1.1"/>';
      s += '<ellipse cx="29.5" cy="29" rx="3.2" ry="3.6" fill="#fff" stroke="' + line + '" stroke-width="1.1"/>';
      s += '<circle cx="18.5" cy="29.4" r="1.6" fill="' + line + '"/>';
      s += '<circle cx="29.5" cy="29.4" r="1.6" fill="' + line + '"/>';
      s += '<circle cx="19.1" cy="28.7" r="0.55" fill="#fff"/>';
      s += '<circle cx="30.1" cy="28.7" r="0.55" fill="#fff"/>';
      s += '<path d="M21.5 36 q2.5 2 5 0" fill="none" stroke="' + line + '" stroke-width="1.4" stroke-linecap="round"/>';
    }
    /* 帽子复用 petpro 原画：原画头心 (50,66)、头半径 36 → 本图 (24,30)、半径 15，
       即 x' = 0.42x + 3、y' = 0.42y + 2.3；类名剥掉避免吃到宠物本体的动画样式 */
    var pp = global.AJ && global.AJ.petPro;
    if (p && pp && typeof pp._hatSvg === 'function') {
      s += '<g transform="translate(3 2.3) scale(0.42)">' +
        String(pp._hatSvg(p)).replace(/ class="pm-m-[a-z-]+"/g, '') + '</g>';
    }
    s += '</svg>';
    return s;
  }
  function renderMascotBar() {
    var box = $('quickChips');
    if (!box || MOOD.missing) { return; }
    var bar = DOC.getElementById('mascotBar');
    if (!bar) {
      bar = DOC.createElement('div');
      bar.id = 'mascotBar';
      bar.className = 'mascot-bar';
      bar.setAttribute('role', 'note');
      var avBtn = DOC.createElement('button');
      avBtn.type = 'button';
      avBtn.className = 'mascot-bar-av';
      avBtn.setAttribute('aria-label', '和阿账聊聊');
      avBtn.addEventListener('click', function () { pokeMascot(avBtn); });
      var txt = DOC.createElement('span');
      txt.className = 'mascot-bar-text';
      var goBtn = DOC.createElement('button');
      goBtn.type = 'button';
      goBtn.className = 'mascot-bar-go';
      goBtn.textContent = '走一个';
      goBtn.addEventListener('click', function () {
        var c = goBtn.getAttribute('data-cmd');
        if (c) { handleSend(c); }
      });
      bar.appendChild(avBtn);
      bar.appendChild(txt);
      bar.appendChild(goBtn);
      box.parentNode.insertBefore(bar, box);
    }
    var ov = safeOverview();
    var key = MOOD.resolveMood(ov);
    var meta = MOOD.MOOD_META[key] || {};
    var av = bar.querySelector('.mascot-bar-av');
    /* 头像跟随当前形象（2026-10 用户拍板「头像跟着当前形象变」）：
       缓存键 = 情绪 + 皮肤 + 形象签名（pro 换装/传照片后签名变，强制重绘） */
    var skin = petSkin();
    var prof = null;
    if (skin === 'pro') {
      var ppMod = global.AJ && global.AJ.petPro;
      prof = (ppMod && typeof ppMod._profile === 'function') ? ppMod._profile() : null;
    }
    var pver = (skin === 'pro') ? ((prof ? prof.body : 'def') + '|' + (prof ? prof.hat : '') + '|' +
      (prof ? prof.accent : '') + '|' + (prof && prof.face ? prof.face.length : 0)) : '';
    if (av && (av.getAttribute('data-mood') !== key || av.getAttribute('data-skin') !== skin ||
        av.getAttribute('data-pver') !== pver)) {
      av.className = 'mascot-bar-av mood-' + key;
      av.setAttribute('data-mood', key);
      av.setAttribute('data-skin', skin);
      av.setAttribute('data-pver', pver);
      if (skin === 'sprite') {
        av.innerHTML = mascotBarSpriteHead();
      } else if (skin === 'pro') {
        av.innerHTML = mascotBarProHead(prof);
      } else {
        av.innerHTML = MOOD.moodSvg(key, 'mico', meta.name || key);
      }
    }
    var txt = bar.querySelector('.mascot-bar-text');
    if (txt) {
      var line = MOOD.line({ ov: ov, state: state, money: money });
      if (line) { txt.textContent = line; }
    }
    var go = bar.querySelector('.mascot-bar-go');
    var cmd = meta.cmd || '查余额';
    if (go) {
      go.setAttribute('data-cmd', cmd);
      go.setAttribute('aria-label', '发送推荐问题：' + cmd);
    }
  }
  function maybeProactiveHint() {
    if (proactiveShown) { return; }
    var ov, bs;
    try { ov = getOverview(); } catch (e) { return; }
    bs = ov && ov.budgetState ? ov.budgetState : null;
    if (bs && (bs.isOver || bs.status === 'danger')) {
      proactiveShown = true;
      addAIMessage('<div class="bubble ai">最近是不是外卖点得有点多？预算快到线啦。<br>要不要我帮你看下这几天怎么把食堂吃出性价比？</div>' +
        actionsWrap('<button type="button" class="btn-mini primary" data-cmd="怎么省钱">帮我制定省钱计划</button>' +
          '<button type="button" class="btn-mini" data-cmd="查余额">先看看余额</button>'));
      return;
    }
    /* 预算没到危险线时，再看「消费诊断」：有 high / mid 才提示，一个周期只提一次。
       这条只走 addAIMessage，不注册进意图分发表（intent.js 一个字不改）。 */
    maybeDiagHint(ov);
  }

  /**
   * 消费诊断的周期级主动提示。
   * 去重口径：settings.hintCycle 存「已提示过的周期起点」，同一周期只提一次；
   * 手清该字段即可让它在本周期再提示一次（便于 QA 验证）。
   */
  function maybeDiagHint(ov) {
    if (!ov || !DIAG || DIAG.missing) { return; }
    var st = getSettings();
    if (st.hintCycle === ov.cycle.start) { return; }
    var list = diagList(ov);
    var sev = DIAG.maxSeverity(list);
    if (sev !== 'high' && sev !== 'mid') { return; }
    st.hintCycle = ov.cycle.start;
    persistSettings();
    proactiveShown = true;
    var line = toneLine('hint.proactive', { n: list.length }) ||
      ('这个周期有 ' + list.length + ' 个地方想跟你聊聊。');
    addAIMessage(aiBubble(esc(line)) +
      actionsWrap('<button type="button" class="btn-mini primary" data-act="go-diag">看看诊断</button>'));
  }

  function switchView(view, fromBack) {
    if (!FULL_VIEWS[view] && !SIMPLE_VIEWS[view]) { return; }
    // 双 UI 门控：把视图请求映射到当前 UI 类型下可见的等价屏幕，
    // 避免代码路径（OCR / 指令 / 返回）把用户切到被隐藏的面板而留空白
    if (getUiMode() === 'simple') {
      if (!SIMPLE_VIEWS[view]) {
        // 完整版视图 → 简洁版等价屏：聊天→AI 对话、看板→预算、目标→攒钱目标、专家→理财专家
        view = ({ chat: 'sai', dash: 'sbudget', goals: 'sgoals', coach: 'scoach' })[view] || 'shome';
      }
    } else if (!FULL_VIEWS[view]) {
      view = 'chat';
    }
    var prev = DOC.body.getAttribute('data-view');
    // 记录进入子视图前的视图，供「返回」按钮使用（fromBack 为 true 时不重复入栈）
    if (prev && prev !== view && !fromBack) {
      viewHistory.push(prev);
      if (viewHistory.length > 20) { viewHistory.shift(); }
    }
    DOC.body.setAttribute('data-view', view);
    if (view === 'chat' || view === 'sai') { renderSceneChips(); maybeProactiveHint(); maybeWishReview(); }
    var tabs = DOC.querySelectorAll('#tabbar .tab, #tabbarSimple .tab');
    var i;
    for (i = 0; i < tabs.length; i++) {
      // 用 classList.toggle 保留 tab 上的其他类（如 ui-full-only），避免整类名覆盖导致门控失效
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === view);
    }
    /* 简洁版「省钱」屏：面板常驻在 #spSaveBody 内，切进来时补一次渲染，
       保证首次进入与数据变更后看到的都是最新内容（不弹遮罩、不调 openSaveHub）。 */
    if (view === 'ssave') { renderSaveHubPanel(); }
    /* 简洁版「存钱罐」屏：进入时补一次渲染，保证数字是最新的 */
    if (view === 'spiggy') {
      piggyDraft = '';
      renderSimplePiggy();
    }
    petViewHi(view);   // 攒钱/理财页打个招呼（5 分钟每页一次；管家走自己的 learn 态）
  }

  /** 「返回」按钮：回到进入当前子视图前的视图；没有历史时回当前 UI 类型的首页 */
  function goBackView() {
    var prev = viewHistory.pop() || (getUiMode() === 'simple' ? 'shome' : 'chat');
    switchView(prev, true);
  }

  function bindEvents() {
    $('btnSend').addEventListener('click', function () {
      handleSend($('chatInput').value);
    });

    $('chatInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.keyCode === 13) {
        e.preventDefault();
        handleSend($('chatInput').value);
      }
    });

    $('quickChips').addEventListener('click', function (e) {
      var target = e.target.closest ? e.target.closest('[data-cmd]') : null;
      if (target) {
        handleSend(target.getAttribute('data-cmd'));
      }
    });

    chatListEl().addEventListener('keydown', function (e) {
      /* 戳一戳键盘可达：Enter / Space 等价点击（头像 tabindex=0，PRD §5.1 无障碍） */
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar' &&
          e.keyCode !== 13 && e.keyCode !== 32) { return; }
      var mavK = e.target.closest ? e.target.closest('.avatar.ai[data-mood]') : null;
      if (mavK) {
        e.preventDefault();
        pokeMascot(mavK);
      }
    });
    chatListEl().addEventListener('click', function (e) {
      /* ---- 戳一戳：阿账头像（必须在 [data-cmd] 之前，头像本身不带 cmd）---- */
      var mav = e.target.closest ? e.target.closest('.avatar.ai[data-mood]') : null;
      if (mav) {
        pokeMascot(mav);
        return;
      }
      var dealAct = e.target.closest ? e.target.closest('[data-deal-act]') : null;
      if (dealAct) {
        handleDealAct(dealAct.getAttribute('data-deal-act'));
        return;
      }
      /* ---- 意图层待补全卡片的作答（C9：必须排在 [data-cmd] 之前）----
         槽位作答不走 handleSend，避免用户气泡里出现裸的「12」这种噪声。 */
      var pendEl = e.target.closest ? e.target.closest('[data-act="pend"]') : null;
      if (pendEl) {
        pendingAnswer(pendEl.getAttribute('data-val'), pendEl.getAttribute('data-pend'));
        return;
      }
      var target = e.target.closest ? e.target.closest('[data-cmd]') : null;
      if (target) {
        handleSend(target.getAttribute('data-cmd'));
        return;
      }
      var act = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!act) { return; }
      var name = act.getAttribute('data-act');
      /* ---- 意图层的固定出口（L4/L5/求助卡） ---- */
      if (name === 'bill-open') {
        answerBillDetail(act.getAttribute('data-bill'));
        return;
      }
      if (name === 'quick-add') {
        pendingClear();
        openQuickAddModal();
        return;
      }
      if (name === 'howto-backfill') {
        pendingClear();
        var yest = new Date();
        yest.setDate(yest.getDate() - 1);
        openQuickAddModal(null, ENG.formatDate(yest));
        return;
      }
      if (name === 'howto-undo') {
        pendingClear();
        handleDataOp({ slots: { target: 'last' }, missing: [] }, '');
        return;
      }
      if (name === 'howto-edit') {
        answerHowto({ slots: { topic: 'edit' } }, '');
        return;
      }
      if (name === 'learn-all') {
        /* 聊天气泡里的「去理财学院看全部」：视图映射交给 switchView（简洁版自动到 scoach） */
        openAcademy();
        return;
      }
      if (name === 'edit-bill') {
        openEditBillModal(act.getAttribute('data-bill'));
        return;
      }
      if (name === 'undo') {
        deleteBill(act.getAttribute('data-bill'));
        return;
      }
      if (name === 'fix-amount') {
        var fid = act.getAttribute('data-bill');
        var fv = Number(act.getAttribute('data-val'));
        var fb = findBill(fid);
        if (fb && isFinite(fv) && fv > 0) {
          fb.amount = ENG.round2(fv);
          saveState();
          renderAll();
          addAIMessage(aiBubble('改好了，这笔现在是 ' + money(fb.amount) + '。'));
        }
        return;
      }
      if (name === 'delete-bill') {
        var did = act.getAttribute('data-bill');
        if (did) { deleteBill(did); }
        return;
      }
      if (name === 'worth') {
        setBillWorth(act.getAttribute('data-bill'), act.getAttribute('data-val'));
        return;
      }
      if (name === 'cycle-yes' || name === 'cycle-no') {
        var billId = act.getAttribute('data-bill') || '';
        var yes = name === 'cycle-yes';
        var askCard = act.closest ? act.closest('.ask-card') : null;
        if (askCard) {
          var kind = askCard.getAttribute('data-kind');
          var doneText = yes
            ? (kind === 'life' ? '已选择：从现在重新算周期' : '已选择：加进本周期可用额度')
            : '已选择：只记这一笔';
          askCard.innerHTML = '<div class="ask-done">' + doneText + '</div>';
        }
        resolveCycleReset(billId, yes);
        return;
      }
      if (name === 'cooldown-buy') {
        act.parentNode.innerHTML = '<span class="tag">已选择：仍然记下这笔</span>';
        resolveCooldown(true);
      } else if (name === 'cooldown-skip') {
        act.parentNode.innerHTML = '<span class="tag green">已选择：先不买，省下了</span>';
        resolveCooldown(false);
      } else if (name === 'cool-next') {
        if (cooling) { renderCoolingQuestion(); }
      } else if (name === 'cool-answer') {
        coolingAnswer(act.getAttribute('data-val'), act);
      } else if (name === 'cool-record') {
        coolingRecord();
      } else if (name === 'cool-skip') {
        coolingSkip();
      } else if (name === 'cool-start') {
        startCoolingFlow('想买的东西', 0);
      } else if (name === 'cool-bigspend') {
        /* 大额冷静卡 → 直接进入现有剁手冷静法会话状态机第一步：
           预填商品名与金额（来自卡片 data-* 属性），与「想买 XX」路径同一入口 */
        startCoolingFlow(
          act.getAttribute('data-item') || '大额支出',
          Number(act.getAttribute('data-price')) || 0
        );
      } else if (name === 'wish-review') {
        /* 到期回访卡的三出口：与弹层里点按钮走同一个入口，避免两套逻辑漂移 */
        wishReviewDecide(act.getAttribute('data-id'), act.getAttribute('data-val'));
      } else if (name === 'wish-open') {
        openWishSheet();
      } else if (name === 'go-diag') {
        /* 诊断提示条的「看看诊断」：完整版去看板，简洁版去预算页（诊断卡在那儿） */
        switchView(getUiMode() === 'simple' ? 'sbudget' : 'dash');
      }
    });

    $('legendList').addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('li[data-cat]') : null;
      if (!li) { return; }
      var cat = li.getAttribute('data-cat');
      highlightCategory = (highlightCategory === cat) ? null : cat;
      renderDonut(getOverview());
    });

    $('goalList').addEventListener('click', function (e) {
      var addBtn = e.target.closest ? e.target.closest('[data-goal-add]') : null;
      if (addBtn) {
        openDepositModal(addBtn.getAttribute('data-goal-add'));
        return;
      }
      var delBtn = e.target.closest ? e.target.closest('[data-goal-del]') : null;
      if (delBtn) {
        var id = delBtn.getAttribute('data-goal-del');
        var goal = findGoal(id);
        if (!goal) { return; }
        var next = [];
        var i;
        for (i = 0; i < state.goals.length; i++) {
          if (state.goals[i].id !== id) { next.push(state.goals[i]); }
        }
        state.goals = next;
        saveState();
        renderGoals();
        addAIMessage(aiBubble('目标「' + esc(goal.name) + '」已删除。想重新开始随时告诉我。'));
      }
    });

    $('btnAddGoal').addEventListener('click', openGoalModal);
    $('btnSettings').addEventListener('click', openSettingsPage);
    $('btnCloseDrawer').addEventListener('click', closeDrawer);
    $('drawerMask').addEventListener('click', closeDrawer);
    $('btnSaveSettings').addEventListener('click', saveSettings);
    $('btnCycleReset').addEventListener('click', restorePaydayCycle);
    $('btnSaveOcr').addEventListener('click', saveOcrCredentials);
    $('btnClearOcr').addEventListener('click', clearOcrCredentials);

    /* ---- 顶栏「＋ 记一笔」快捷记账 ---- */
    $('btnQuickAdd').addEventListener('click', openQuickAddModal);

    /* ---- 设置抽屉 · 数据管理 ---- */
    $('btnDrawerExport').addEventListener('click', exportAllCsv);
    $('btnDrawerImport').addEventListener('click', openImportSheet);
    $('btnDrawerReset').addEventListener('click', confirmReset);

    /* ---- 常驻预算条：点击/回车跳到看板预算焦点卡 ---- */
    var budgetBar = $('budgetBar');
    if (budgetBar) {
      budgetBar.addEventListener('click', focusBudgetCard);
      budgetBar.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) {
          e.preventDefault();
          focusBudgetCard();
        }
      });
    }

    /* ---- 完整设置界面 ---- */
    bindSettingsEvents();

    /* ---- 顶部工具栏：截屏记账 / 账单分析 / 理财专家 / 更多菜单 ---- */
    $('btnOcr').addEventListener('click', openOcrModal);
    $('btnAnalysis').addEventListener('click', openAnalysisSheet);
    $('btnCoach').addEventListener('click', function () { switchView('coach'); });
    /* 看板「理财课 · 视频」卡的「全部 ›」：进理财学院并定位到学院区。
       按钮是静态节点（不会被 innerHTML 重建），只绑一次，不存在重复绑定。 */
    $('btnLearnAll').addEventListener('click', openAcademy);

    /* ---- 看板信息块的详情弹窗 ----
       理财课整行进弹窗（右侧 ↗ 仍是一步直达）；诊断 / 恩格尔 / 成就各开自己的详情。 */
    $('learnMini').addEventListener('click', function (e) {
      var row = (e.target && e.target.closest) ? e.target.closest('[data-learn]') : null;
      if (!row) { return; }
      e.preventDefault();
      openLearnResourceModal(Number(row.getAttribute('data-learn')));
    });
    $('learnMini').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') { return; }
      var row = (e.target && e.target.closest) ? e.target.closest('[data-learn]') : null;
      if (!row) { return; }
      e.preventDefault();
      openLearnResourceModal(Number(row.getAttribute('data-learn')));
    });
    if ($('btnDiagAll')) { $('btnDiagAll').addEventListener('click', openDiagAllModal); }
    /* 恩格尔 / 成就：整卡可点，键盘 Enter / 空格同效 */
    [['engelCard', openEngelModal], ['achieveCard', openAchieveModal]].forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) { return; }
      el.addEventListener('click', pair[1]);
      el.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') { return; }
        e.preventDefault();
        pair[1]();
      });
    });
    $('btnAskCoach').addEventListener('click', showAskCoachIntro);
    /* 专家面板「‹ 返回」：桌面端无底部导航，靠它回到进入专家前的视图 */
    $('btnCoachBack').addEventListener('click', goBackView);

    /* ---- 省钱：一个入口 + 一级分段（雷达 / 图谱），两个功能共用一个面板 ---- */
    $('btnSaveHub').addEventListener('click', function () { openSaveHub('radar'); });
    $('btnCloseSaveHub').addEventListener('click', closeSaveHub);
    $('saveHubSeg').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-hub]') : null;
      if (b) { switchSaveHub(b.getAttribute('data-hub')); }
    });
    $('saveHubMask').addEventListener('click', function (e) {
      if (e.target === $('saveHubMask')) { closeSaveHub(); }
    });

    /* ---- 省钱雷达：切 tab / 比价计算 / 导出日历 ---- */
    $('btnDealsCard').addEventListener('click', function () { openSaveHub('radar'); });
    $('dealsTabs').addEventListener('click', function (e) {
      var tab = e.target.closest ? e.target.closest('[data-deal-tab]') : null;
      if (!tab) { return; }
      syncDealForm();
      dealsTab = tab.getAttribute('data-deal-tab');
      renderDealsSheet();
    });
    $('dealsPane').addEventListener('click', function (e) {
      var del = e.target.closest ? e.target.closest('[data-del-row]') : null;
      if (del) {
        syncDealForm();
        dealsForm.rows.splice(Number(del.getAttribute('data-del-row')), 1);
        renderDealsSheet();
        return;
      }
      var act = e.target.closest ? e.target.closest('[data-deal-act]') : null;
      if (act) {
        var before = dealsLastResult;
        handleDealAct(act.getAttribute('data-deal-act'));
        if (dealsLastResult !== before && dealsTab === 'compare') { renderDealsSheet(); }
        return;
      }
      var sortBtn = e.target.closest ? e.target.closest('[data-real-sort]') : null;
      if (sortBtn) {
        syncDealForm();
        realSort = sortBtn.getAttribute('data-real-sort');
        renderDealsSheet();
        return;
      }
      var fillBtn = e.target.closest ? e.target.closest('[data-real-fill]') : null;
      if (fillBtn) { fillRealOffer(fillBtn.getAttribute('data-real-fill')); return; }
      var copyBtn = e.target.closest ? e.target.closest('[data-real-copy]') : null;
      if (copyBtn) { copyRealCmd(); return; }
      if (e.target.id === 'btnRsSearch') { runRealSearch(); return; }
      var target = e.target.id;
      if (target === 'btnDealCalc') { runDealCompare(); }
      else if (target === 'btnDealDemo') { fillDealDemo(); }
      else if (target === 'btnDealAdd') {
        syncDealForm();
        if (dealsForm.rows.length >= 6) { showToast('最多比 6 个平台，够用了'); return; }
        dealsForm.rows.push({
          platform: '抖音',
          price: '',
          spec: dealsForm.rows[0] ? dealsForm.rows[0].spec : '',
          ship: '', coupon: '', need: ''
        });
        renderDealsSheet();
      }
    });
    $('dealsPane').addEventListener('keydown', function (e) {
      if (e.target && e.target.id === 'rsKw' && (e.key === 'Enter' || e.keyCode === 13)) {
        e.preventDefault();
        runRealSearch();
      }
    });
    $('btnDealsCsv').addEventListener('click', function () {
      if (!dealsReady()) { return; }
      var text = DEALS.calendarCsv(new Date(), 56);
      downloadText('真实商家日历.csv', text, 'text/csv;charset=utf-8');
      showToast('已生成未来 56 天日历（日期由代码算出）');
    });
    $('btnDealsAskKfc').addEventListener('click', function () {
      closeDealsSheet();
      showKfcDealsCard();
    });

    /* ---- 省钱图谱：切 tab / 搜索 / 分类 / 打卡 / 导出（入口已并入省钱面板） ---- */
    $('btnSavingsCard').addEventListener('click', function () { openSaveHub('graph'); });
    $('savingsTabs').addEventListener('click', function (e) {
      var tab = e.target.closest ? e.target.closest('[data-sv-tab]') : null;
      if (!tab) { return; }
      savingsTab = tab.getAttribute('data-sv-tab');
      savingsEdit = null;
      renderSavingsSheet();
    });
    $('savingsPane').addEventListener('click', function (e) {
      /* 分类筛选：只重画 chips 与列表，不动搜索框，避免输入焦点丢失 */
      var chip = e.target.closest ? e.target.closest('[data-sv-cat]') : null;
      if (chip) {
        savingsCat = chip.getAttribute('data-sv-cat') || '';
        var chips = DOC.querySelectorAll('#svChips .sv-chip');
        for (var ci = 0; ci < chips.length; ci++) {
          chips[ci].classList.toggle('active', chips[ci].getAttribute('data-sv-cat') === savingsCat);
        }
        var l0 = $('svList');
        if (l0) { l0.innerHTML = savingsListHtml(); }
        var c0 = $('svCount');
        if (c0) { c0.textContent = savingsFiltered().length + ' 条'; }
        return;
      }
      var act = e.target.closest ? e.target.closest('[data-sv-act]') : null;
      if (!act) { return; }
      var id = act.getAttribute('data-sv-id');
      var what = act.getAttribute('data-sv-act');
      if (what === 'toggle') { toggleSavings(id); return; }
      if (what === 'edit-amount') {
        savingsEdit = { id: id, date: act.getAttribute('data-sv-date') };
        renderSavingsSheet();
        var inp = $('svEditInput');
        if (inp) { inp.focus(); if (inp.select) { inp.select(); } }
        return;
      }
      if (what === 'save-amount') { updateSavingsAmount(); return; }
      if (what === 'cancel-amount') { savingsEdit = null; renderSavingsSheet(); return; }
      if (what === 'toggle-all') { savingsBookAll = !savingsBookAll; renderSavingsSheet(); return; }
      if (what === 'export-md') { savingsExportMarkdown(); return; }
      if (what === 'export-csv') { savingsExportCsv(); return; }
      if (what === 'jump') {
        var target = SAV.byId(id);
        if (!target) { return; }
        savingsCat = target.cat;
        savingsQuery = '';
        savingsOpen[id] = true;
        savingsTab = 'map';
        renderSavingsSheet();
        var card = DOC.querySelector('#svList .sv-card[data-sv-id="' + id + '"]');
        if (card && card.scrollIntoView) { card.scrollIntoView({ block: 'start' }); }
        return;
      }
      if (what === 'detail') {
        savingsOpen[id] = !savingsOpen[id];
        /* 只重画列表，保持滚动位置 */
        var l1 = $('svList');
        if (l1) {
          var body = $('savingsPane').parentNode;
          var keep = body ? body.scrollTop : 0;
          l1.innerHTML = savingsListHtml();
          if (body) { body.scrollTop = keep; }
        }
        return;
      }
    });
    $('savingsPane').addEventListener('input', function (e) {
      if (!e.target || e.target.id !== 'svSearch') { return; }
      savingsQuery = e.target.value || '';
      var l = $('svList');
      if (l) { l.innerHTML = savingsListHtml(); }
      var c = $('svCount');
      if (c) { c.textContent = savingsFiltered().length + ' 条'; }
    });
    /* 改金额：回车保存、ESC 取消（ESC 要拦住，否则会把整个面板关掉） */
    $('savingsPane').addEventListener('keydown', function (e) {
      if (!e.target || e.target.id !== 'svEditInput') { return; }
      if (e.key === 'Enter' || e.keyCode === 13) {
        e.preventDefault();
        updateSavingsAmount();
      } else if (e.key === 'Escape' || e.keyCode === 27) {
        if (e.stopPropagation) { e.stopPropagation(); }
        savingsEdit = null;
        renderSavingsSheet();
      }
    });
    $('btnSavingsCsv').addEventListener('click', savingsExportCsv);
    $('btnSavingsAsk').addEventListener('click', function () {
      closeSavingsSheet();
      showSavingsTodayCard();
    });
    /* ---- 理财学院：点击条目弹详情弹窗 + 资源区复制 ---- */
    $('coachAcademy').addEventListener('click', function (e) {
      var tgt = e.target;
      var copyBtn = (tgt && tgt.closest) ? tgt.closest('[data-copy]') : null;
      if (copyBtn) {
        e.preventDefault();
        coachCopyResource(copyBtn);
        return;
      }
      var head = (tgt && tgt.closest) ? tgt.closest('.coach-lesson-head') : null;
      if (!head) { return; }
      var lesson = head.closest ? head.closest('.coach-lesson') : null;
      if (lesson) { openAcademyLessonModal(lesson.getAttribute('data-lesson')); }
    });
    /* ---- 团购省钱卡：「在聊天里问我怎么省」直接跳到聊天并弹团购答案 ----
       事件委托挂在容器 #groupBuyBody 上：renderCoachGroupBuy() 会整块重写
       innerHTML，直接绑按钮的话节点一重建就失效。 */
    var gbBox = $('groupBuyBody');
    if (gbBox) {
      gbBox.addEventListener('click', function (e) {
        var btn = (e.target && e.target.closest) ? e.target.closest('#btnGroupBuyAsk') : null;
        if (!btn) { return; }
        e.preventDefault();
        switchView('chat');
        if (COACH && typeof COACH.groupBuyAnswer === 'function') {
          addAIMessage(aiBubble(COACH.groupBuyAnswer()));
        }
      });
    }
    $('btnUndo').addEventListener('click', undoLast);
    $('btnMore').addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = $('moreMenu');
      menu.hidden = !menu.hidden;
      $('btnMore').classList.toggle('active', !menu.hidden);
    });
    $('moreMenu').addEventListener('click', function (e) {
      var item = e.target.closest ? e.target.closest('[data-act]') : null;
      $('moreMenu').hidden = true;
      $('btnMore').classList.remove('active');
      if (!item) { return; }
      var act = item.getAttribute('data-act');
      if (act === 'export') { exportAllCsv(); }
      if (act === 'import') { openImportSheet(); }
      if (act === 'reset') { confirmReset(); }
      if (act === 'piggy') { openPiggySheet(); }
      if (act === 'wish') { openWishSheet(); }
    });
    DOC.addEventListener('click', function (e) {
      var menu = $('moreMenu');
      if (!menu || menu.hidden) { return; }
      if (e.target === $('btnMore') || (e.target.closest && e.target.closest('#moreMenu'))) { return; }
      menu.hidden = true;
      $('btnMore').classList.remove('active');
    });

    /* ---- 账单分析 sheet ---- */
    $('btnCloseAnalysis').addEventListener('click', closeAnalysisSheet);
    var analysisTabsEl = $('analysisTabs');
    if (analysisTabsEl) {
      analysisTabsEl.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('[data-act="an-mode"]') : null;
        if (!t) { return; }
        var mode = t.getAttribute('data-mode');
        if (mode === 'current') {
          analysisMode = 'current';
          if (state.bills.length > 0) { analyzeCurrentBills(); }
          else { analysisData = null; renderAnalysis(); }
        } else {
          analysisMode = 'imported';
          // 切到「导入 CSV」但还没导入过文件时，清掉可能是「当前账本」的残留数据，
          // 否则 renderAnalysis 会拿旧账本数据渲染成当前账本内容。
          if (!analysisData || analysisData.source !== 'imported') {
            analysisData = null;
          }
          renderAnalysis();
        }
        syncAnalysisTabs();
      });
    }
    $('analysisMask').addEventListener('click', function (e) {
      if (e.target === $('analysisMask')) { closeAnalysisSheet(); }
    });
    $('analysisDrop').addEventListener('click', function () {
      $('analysisFile').click();
    });
    $('analysisFile').addEventListener('change', function () {
      handleAnalysisFiles(this.files);
      this.value = '';
    });
    $('analysisExcludeDup').addEventListener('change', renderAnalysis);
    $('analysisReport').addEventListener('change', function (e) {
      var sel = e.target.closest ? e.target.closest('[data-act="analysis-month"]') : null;
      if (!sel || !analysisData) { return; }
      analysisData.month = sel.value;
      renderAnalysis();
    });
    $('btnAnalysisExport').addEventListener('click', exportAnalysisMarkdown);
    $('btnAnalysisImport').addEventListener('click', confirmImportAnalysis);
    $('btnAnalysisClear').addEventListener('click', clearAnalysis);

    /* ---- 导入账单 sheet ---- */
    $('btnCloseImport').addEventListener('click', closeImportSheet);
    $('importMask').addEventListener('click', function (e) {
      if (e.target === $('importMask')) { closeImportSheet(); }
    });
    $('importDrop').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function () {
      handleImportFiles(this.files);
      this.value = '';
    });
    $('importExcludeDup').addEventListener('change', renderImportPreview);
    $('importExcludeFileDup').addEventListener('change', renderImportPreview);
    $('importMonth').addEventListener('change', function () {
      if (!importState) { return; }
      importState.month = this.value;
      renderImportPreview();
    });
    $('btnImportConfirm').addEventListener('click', confirmImportBills);
    $('btnImportClear').addEventListener('click', clearImport);
    ['importDrop'].forEach(function (id) {
      var zone = $(id);
      ['dragenter', 'dragover'].forEach(function (evt) {
        zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.add('dragging'); });
      });
      ['dragleave', 'drop'].forEach(function (evt) {
        zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.remove('dragging'); });
      });
      zone.addEventListener('drop', function (e) {
        var dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) { handleImportFiles(dt.files); }
      });
    });

    /* 拖拽上传（分析 + 截图共用视觉语言） */
    ['analysisDrop'].forEach(function (id) {
      var zone = $(id);
      ['dragenter', 'dragover'].forEach(function (evt) {
        zone.addEventListener(evt, function (e) {
          e.preventDefault();
          zone.classList.add('dragging');
        });
      });
      ['dragleave', 'drop'].forEach(function (evt) {
        zone.addEventListener(evt, function (e) {
          e.preventDefault();
          zone.classList.remove('dragging');
        });
      });
      zone.addEventListener('drop', function (e) {
        var dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
          handleAnalysisFiles(dt.files);
        }
      });
    });

    /* ---- 截屏记账弹窗 ---- */
    $('btnCloseOcr').addEventListener('click', closeOcrModal);
    $('btnOcrCancel').addEventListener('click', closeOcrModal);
    $('btnOcrRun').addEventListener('click', runOcr);
    $('ocrMask').addEventListener('click', function (e) {
      if (e.target === $('ocrMask')) { closeOcrModal(); }
    });
    $('ocrDrop').addEventListener('click', function () {
      $('ocrFile').click();
    });
    $('ocrFile').addEventListener('change', function () {
      if (this.files && this.files.length > 0) { handleOcrFile(this.files[0]); }
    });
    ['dragenter', 'dragover'].forEach(function (evt) {
      $('ocrDrop').addEventListener(evt, function (e) {
        e.preventDefault();
        $('ocrDrop').classList.add('dragging');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      $('ocrDrop').addEventListener(evt, function (e) {
        e.preventDefault();
        $('ocrDrop').classList.remove('dragging');
      });
    });
    $('ocrDrop').addEventListener('drop', function (e) {
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) { handleOcrFile(dt.files[0]); }
    });
    $('ocrDemoList').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-act="ocr-sample"]') : null;
      if (!btn) { return; }
      ocrDemoIndex = Number(btn.getAttribute('data-index'));
      ocrPendingFile = null;
      ocrImageDataUrl = '';
      ocrPreviewSuppressed = false;
      $('ocrPreview').hidden = true;
      $('ocrResult').innerHTML = '';
      $('ocrStatus').className = 'ocr-status';
      $('ocrStatus').textContent = '已选择示例小票「' + OCR.SAMPLES[ocrDemoIndex].title + '」，点「开始识别」看结果。';
    });
    $('ocrResult').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) { return; }
      var act = btn.getAttribute('data-act');
      if (act === 'ocr-confirm') {
        confirmOcrBill();
      } else if (act === 'ocr-retry') {
        $('ocrResult').innerHTML = '';
        $('ocrStatus').textContent = '可以重新选图，或再点一次「开始识别」。';
      } else if (act === 'ocr-cloud-config') {
        openOcrCloudSettings();
      } else if (act === 'ocr-cloud-app') {
        openCloudAppLink();
      } else if (act === 'ocr-giveup' || act === 'ocr-manual') {
        closeOcrModal();
        switchView('chat');
        addAIMessage(aiBubble('行，直接在下面输入就行，比如「午饭食堂 15」，我马上给你记上。'));
        var input = $('chatInput');
        if (input) { input.focus(); }
      } else if (act === 'ocr-sample') {
        var idx = Number(btn.getAttribute('data-index') || 0);
        ocrDemoIndex = idx;
        ocrPendingFile = null;
        ocrImageDataUrl = '';
        ocrPreviewSuppressed = false;
        $('ocrPreview').hidden = true;
        runOcr();
      }
    });

    /* Ctrl+V 粘贴截图 */
    DOC.addEventListener('paste', function (e) {
      if ($('ocrMask').hidden) { return; }
      var cd = e.clipboardData || global.clipboardData;
      if (!cd || !cd.items) { return; }
      var i;
      for (i = 0; i < cd.items.length; i++) {
        if (cd.items[i].type && cd.items[i].type.indexOf('image') === 0) {
          var file = cd.items[i].getAsFile();
          if (file) {
            e.preventDefault();
            handleOcrFile(file);
            return;
          }
        }
      }
    });

    $('modalMask').addEventListener('click', function (e) {
      if (e.target === $('modalMask')) { closeModal(); }
    });

    DOC.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        closeModal();
        if (!$('analysisMask').hidden) { closeAnalysisSheet(); }
        if (!$('saveHubMask').hidden) { closeSaveHub(); }
        if (!$('piggyMask').hidden) { closePiggySheet(); }
        if ($('wishMask') && !$('wishMask').hidden) { closeWishSheet(); }
        if ($('personaMask') && !$('personaMask').hidden) { closePersonaSheet(); }
        if ($('billFilterMask') && !$('billFilterMask').hidden) { closeBillFilterSheet(); }
        if (!$('ocrMask').hidden) { closeOcrModal(); }
        if ($('settingsDrawer').classList.contains('open')) { closeDrawer(); }
        if ($('modalMask').hidden && !$('settingsMask').hidden) { closeSettingsPage(); }
      }
    });

    /* ---- 存钱罐弹层 ---- */
    $('btnClosePiggy').addEventListener('click', closePiggySheet);
    $('btnPiggyCard').addEventListener('click', openPiggySheet);
    $('btnPiggyTop').addEventListener('click', openPiggySheet);
    $('piggyMask').addEventListener('click', function (e) {
      if (e.target === $('piggyMask')) { closePiggySheet(); }
    });
    /* 输入框是每次重绘出来的，事件绑在静态宿主上做委托：回车 = 存入 */
    ['piggyBody', 'spPiggyBody'].forEach(function (id) {
      var host = $(id);
      if (!host) { return; }
      host.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) {
          if (e.target && e.target.classList && e.target.classList.contains('piggy-amt-input')) {
            e.preventDefault();
            piggyDoDeposit(host);
          }
        }
      });
    });

    /* ---- 心愿单弹层（sheet）：四处入口共用同一套渲染 ---- */
    if ($('btnCloseWish')) { $('btnCloseWish').addEventListener('click', closeWishSheet); }
    if ($('btnWishCard')) { $('btnWishCard').addEventListener('click', openWishSheet); }
    if ($('btnWishTop')) { $('btnWishTop').addEventListener('click', openWishSheet); }
    if ($('wishMask')) {
      $('wishMask').addEventListener('click', function (e) {
        if (e.target === $('wishMask')) { closeWishSheet(); }
      });
    }
    if ($('wishBody')) { $('wishBody').addEventListener('click', wishPanelClick); }
    /* 简洁版首页小卡：整卡可点 */
    if ($('spWishCard')) { $('spWishCard').addEventListener('click', openWishSheet); }

    /* 消费性格测试：卡片入口 + 弹窗内容，两处都做事件委托（面板搬家不丢监听） */
    if ($('personaBody')) { $('personaBody').addEventListener('click', onPersonaClick); }
    if ($('personaSheetBody')) { $('personaSheetBody').addEventListener('click', onPersonaClick); }
    if ($('btnClosePersona')) { $('btnClosePersona').addEventListener('click', closePersonaSheet); }
    if ($('personaMask')) {
      $('personaMask').addEventListener('click', function (e) {
        if (e.target === $('personaMask')) { closePersonaSheet(); }
      });
    }

    /* 账单筛选抽屉：完整版 / 简洁版两处入口都打开同一抽屉；胶囊与全选走事件委托 */
    if ($('btnBillFilter')) { $('btnBillFilter').addEventListener('click', openBillFilterSheet); }
    if ($('btnSpBillFilter')) { $('btnSpBillFilter').addEventListener('click', openBillFilterSheet); }
    /* 列表上方筛选条里的「清除」（两版各一条） */
    if ($('billFilterBar')) { $('billFilterBar').addEventListener('click', onBillFilterClear); }
    if ($('spFilterBar')) { $('spFilterBar').addEventListener('click', onBillFilterClear); }
    if ($('btnCloseBillFilter')) { $('btnCloseBillFilter').addEventListener('click', closeBillFilterSheet); }
    if ($('btnConfirmBillFilter')) { $('btnConfirmBillFilter').addEventListener('click', confirmBillFilter); }
    if ($('btnResetBillFilter')) { $('btnResetBillFilter').addEventListener('click', resetBillFilter); }
    if ($('bfCats')) { $('bfCats').addEventListener('click', onBillFilterCap); }
    if ($('bfSources')) { $('bfSources').addEventListener('click', onBillFilterCap); }
    if ($('billFilterBody')) { $('billFilterBody').addEventListener('click', onBillFilterSelectAll); }
    if ($('billFilterMask')) {
      $('billFilterMask').addEventListener('click', function (e) {
        if (e.target === $('billFilterMask')) { closeBillFilterSheet(); }
      });
    }
    refreshBillFilterBadge();

    $('tabbar').addEventListener('click', function (e) {
      var tab = e.target.closest ? e.target.closest('.tab[data-view]') : null;
      if (tab) { switchView(tab.getAttribute('data-view')); }
    });

    /* 看板统计区的月切换 / 展开 / 类目高亮 */
    bindStatSection();
  }

  /* ================================================================== */
  /* 欢迎语 & 启动                                                       */
  /* ================================================================== */

  function addWelcome() {
    var ov = getOverview();
    var body = addAIMessage(aiBubble(ic('chat', 'bico-brand', '打招呼') + '你好呀，我是' + petDisplayName() +
      '<br>一句话就能记账，试试「中午食堂 15」。<br>想省钱 / 搞钱，去底部「理财专家」找我，剁手前也可以先让我把把关。'));
    /* 标记欢迎行：切换形象时就地改名，别让历史欢迎语还写着上一只的名字 */
    if (body && body.parentNode) { body.parentNode.setAttribute('data-welcome', '1'); }
    addAIMessage(aiBubble('当前周期 ' + esc(ov.cycle.start) + ' ~ ' + esc(ov.cycle.end) + '，总预算 ' +
      money(state.budget.total) + '，已花 ' + money(ov.cycleAgg.expense) + '。' + ov.sentence));
  }

  /**
   * 聊天页「助手名字」跟随当前萌宠形象：顶部「X · 在线」+ 已有欢迎语气泡 + 头像 aria。
   * 静态 HTML 里默认写的是「阿账 · 在线」，用户上次选的是精灵/管家时，
   * 首帧和每次切换都要按存储值纠正（2026-10 用户反馈「切换萌宠也要改名」）。
   */
  function renderChatPeerName() {
    var name = petDisplayName();
    var head = $('chatPeerName');
    if (head) { head.textContent = name + ' · 在线'; }
    var list = chatListEl();
    if (!list) { return; }
    var rows = list.querySelectorAll('.msg-row[data-welcome]');
    for (var i = 0; i < rows.length; i++) {
      var body = rows[i].querySelector('.msg-body');
      if (body) {
        body.innerHTML = body.innerHTML.replace(/你好呀，我是[^<]*/, '你好呀，我是' + name);
      }
    }
  }

  /* ================================================================== */
  /* 阿账·浮层桌面宠物（可拖动 · 复用生成的基准图素材，挂到 body）        */
  /* ================================================================== */

  var PET_POS_KEY = 'AJ_PET_POS';
  var PET_TINT = {
    chill: '#07C160', nervous: '#F59E0B', bankrupt: '#EF4444', stop: '#EF4444',
    cheer: '#07C160', mad: '#EF4444', save: '#07C160', deadline: '#F59E0B', sleep: '#5AA9E6'
  };
  var petEl = null, petDrag = false, petBubbleTimer = null, petActAt = 0, petMoved = false;
  var petActTimer = null;

  function petEnabled() {
    var st = getSettings();
    return !(st.mascot && st.mascot.pet === false);
  }

  /**
   * 三个可选宠物形象（settings.mascot.skin）：
   *   azhang 阿账         —— PNG 9 态情绪 + 顶部播报，app.js 自己的浮层
   *   sprite 存钱罐精灵   —— SVG 6 态表情，pet.js
   *   pro    记账小管家   —— 参数化小人 + 绕行小猪 + 形象工坊，petpro.js
   * 数组顺序就是「换一只」按钮的循环顺序。
   */
  var PET_SKIN_ORDER = ['azhang', 'sprite', 'pro'];
  var PET_SKIN_NAME = { azhang: '阿账', sprite: '存钱罐精灵', pro: '记账小管家' };

  /**
   * 当前宠物的显示名（聊天页标题 / 欢迎语 / AI 头像 aria / 系统提示共用）。
   * 切换形象时这些地方都要跟着改名，否则换成精灵还叫「阿账」。
   * @param {string} [skin] 不传就按当前形象
   */
  function petDisplayName(skin) {
    return PET_SKIN_NAME[skin || petSkin()] || '阿账';
  }

  /**
   * 当前宠物形象：'azhang' | 'sprite' | 'pro'。
   * 未选择（首次进入弹窗还没点）时按阿账处理 —— 保证任何渲染路径都有确定答案，
   * 弹窗只是把「默认值」换成「用户主动选择」。
   */
  function petSkin() {
    var st = getSettings();
    var s = st.mascot && st.mascot.skin;
    return (s === 'sprite' || s === 'pro') ? s : 'azhang';
  }

  /**
   * 事件源 → 反馈场景名（音效与精灵表情共用同一张表）。
   * 阿账有自己的 9 态体系（见 petPlayAct 的 map），这张表只服务「声音」和「精灵表情」。
   */
  var PET_SCENE = {
    bill_logged: 'spend',
    income_logged: 'income',
    piggy_in: 'save',
    goal_in: 'save',
    goal_done: 'save',
    piggy_out: 'income',
    impulse_flag: 'error',
    cooldown_block: 'focus',
    poke: 'poke'
  };

  /**
   * 发声：两个形象共用一套音效 + 震动（AJ.sfx）。
   * 与形象无关，所以必须在「阿账/精灵」分支之前调 —— 否则选了精灵就听不到声音。
   * @param {string} kind 事件源
   * @param {Object} [act] { amount（元）, cents（分，可选）}
   */
  function petSfx(kind, act) {
    var sfx = global.AJ && global.AJ.sfx;
    if (!sfx || typeof sfx.both !== 'function') { return; }
    var name = PET_SCENE[kind];
    if (!name) { return; }
    var a = act || {};
    /* 存钱走分档：优先用调用方给的 cents（分），没有就用 amount（元）×100 */
    var cents = (a.cents !== undefined) ? Number(a.cents)
      : (isFinite(Number(a.amount)) ? Math.round(Number(a.amount) * 100) : 0);
    sfx.both(name, { cents: cents });
  }

  function petReadPos() {
    try {
      var raw = global.localStorage ? global.localStorage.getItem(PET_POS_KEY) : null;
      if (!raw) { return null; }
      var p = JSON.parse(raw);
      if (p && typeof p.x === 'number' && typeof p.y === 'number') { return p; }
    } catch (e) {}
    return null;
  }

  function petSavePos(x, y) {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(PET_POS_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
      }
    } catch (e) {}
  }

  function petClamp(x, y) {
    var w = (petEl && petEl.offsetWidth) || 104;
    var h = (petEl && petEl.offsetHeight) || 104;
    var vw = global.innerWidth || 360, vh = global.innerHeight || 640;
    return {
      x: Math.min(Math.max(0, x), Math.max(0, vw - w)),
      y: Math.min(Math.max(0, y), Math.max(0, vh - h))
    };
  }

  function petPlace(x, y) {
    if (!petEl) { return; }
    var c = petClamp(x, y);
    petEl.style.left = c.x + 'px';
    petEl.style.top = c.y + 'px';
  }

  /**
   * 气泡自适应：宠物只有 104px 宽，气泡若按父元素宽度收缩会被压成一字一行。
   * 这里按「自然宽度 + 视口边界」重算水平位移与上下翻面（贴边时翻到宠物下方）。
   */
  function petFitBubble(b) {
    if (!b || !petEl) { return; }
    var vw = global.innerWidth || 360;
    var pr = petEl.getBoundingClientRect();
    var bw = b.offsetWidth || 0, bh = b.offsetHeight || 0;
    if (!bw) { return; }
    /* 边界优先取 App 手机框（底部导航的左右边界）：宽屏下宠物贴着框，气泡不该飘出框外 */
    var minX = 8, maxX = vw - 8;
    var tb = $('tabbar');
    if (tb) {
      var tr = tb.getBoundingClientRect();
      if (tr && tr.width) {
        minX = Math.max(minX, tr.left + 4);
        maxX = Math.min(maxX, tr.right - 4);
      }
    }
    if (maxX - minX < bw) { minX = Math.max(8, (minX + maxX - bw) / 2); }
    /* 宠物左侧的空档够宽 → 气泡贴到它左边。那块空档正是宠物让出来的，
       气泡放这儿不压任何消息；放不下才退回「上方 / 下方」的老逻辑 */
    if (pr.left - 12 - bw >= minX) {
      b.classList.add('side');
      b.classList.remove('below');
      b.style.removeProperty('--aj-bub-dx');
      return;
    }
    b.classList.remove('side');
    var cx = pr.left + pr.width / 2;
    var left = cx - bw / 2, right = cx + bw / 2;
    var dx = 0;
    if (left < minX) { dx = minX - left; }
    else if (right > maxX) { dx = maxX - right; }
    b.style.setProperty('--aj-bub-dx', Math.round(dx) + 'px');
    /* 上方空间不够（宠物被拖到顶部）→ 气泡翻到下方 */
    if (pr.top - 12 - bh < 8) { b.classList.add('below'); }
    else { b.classList.remove('below'); }
  }

  function petSay(text, tint) {
    if (!petEl || !text) { return; }
    var b = petEl.querySelector('.aj-pet-bubble');
    if (!b) { return; }
    b.textContent = text;
    b.style.borderColor = tint || '#07C160';
    b.classList.add('show');
    /* 先量再定位：文本变了宽度就变，必须重新算贴边位移 */
    petFitBubble(b);
    if (petBubbleTimer) { clearTimeout(petBubbleTimer); }
    petBubbleTimer = setTimeout(function () {
      b.classList.remove('show');
      b.style.removeProperty('--aj-bub-dx');
    }, 5200);
  }

  /** 动作粒子特效：金币上浮 / 勾选弹出 / 警告爆点（纯 DOM + CSS，无图片） */
  function petFx(kind) {
    if (!petEl) { return; }
    var host = petEl.querySelector('.aj-pet-fx');
    if (!host) { return; }
    host.innerHTML = '';
    var mark = '', cls = '', n = 0, i;
    if (kind === 'coins') { mark = '¥'; cls = 'aj-fx-coin'; n = 6; }
    else if (kind === 'check') { mark = '✓'; cls = 'aj-fx-check'; n = 1; }
    else if (kind === 'burst') { mark = '!'; cls = 'aj-fx-burst'; n = 4; }
    else { return; }
    for (i = 0; i < n; i++) {
      var sp = DOC.createElement('span');
      sp.className = 'aj-fx ' + cls;
      sp.textContent = mark;
      sp.style.setProperty('--aj-fx-i', String(i));
      /* 横向散开：奇偶两侧错开，避免 6 颗金币排成一条横线穿过脸 */
      sp.style.setProperty('--aj-fx-dx', ((i % 2 ? 1 : -1) * (7 + i * 2)) + 'px');
      host.appendChild(sp);
    }
    setTimeout(function () { if (host) { host.innerHTML = ''; } }, 1500);
  }

  /**
   * 播放一次「特殊动作」（v1.9）：跳跃 / 举牌 / 抖动 / 蹲下 / 撒彩纸 + 道具 + 金额飘字。
   * 动作加在 .aj-pet-body 上，与 .aj-pet-bob 的待机浮动分层叠加，
   * 所以宠物是「边呼吸边跳起来」，不再是替换掉待机动画后几乎看不见的小缩放。
   * @param {string} kind 事件名
   * @param {Object} [act] { amount }
   */
  function petPlayAct(kind, act) {
    if (!petEl) { return; }
    var map = {
      bill_logged: 'bill', income_logged: 'income',
      piggy_in: 'save', goal_in: 'save', goal_done: 'done',
      piggy_out: 'out',
      impulse_flag: 'mad', cooldown_block: 'stop',
      poke: 'poke', wave: 'wave'
    };
    var a = map[kind] || 'bill';
    /* 视频同款动作：大额支出 / 预算紧张 → 皱眉拨算盘（比单纯起跳更贴「心疼这笔钱」） */
    if (a === 'bill' && act && (act.big || act.tight)) { a = 'calc'; }
    petEl.setAttribute('data-act', a);

    var gain = petEl.querySelector('.aj-prop-gain');
    if (gain) {
      var amt = (act && act.amount !== undefined) ? Number(act.amount) : NaN;
      if (isFinite(amt) && amt > 0 && (a === 'bill' || a === 'save' || a === 'income')) {
        gain.textContent = (a === 'save' || a === 'income' ? '+' : '−') + money(amt);
        gain.className = 'aj-prop-gain show' + (a === 'save' || a === 'income' ? ' plus' : ' minus');
      } else {
        gain.textContent = '';
        gain.className = 'aj-prop-gain';
      }
    }

    if (petActTimer) { clearTimeout(petActTimer); }
    petActTimer = setTimeout(function () {
      if (petEl) { petEl.removeAttribute('data-act'); }
      var g = petEl && petEl.querySelector('.aj-prop-gain');
      if (g) { g.className = 'aj-prop-gain'; }
    }, 1950);
  }

  /* ================================================================== */
  /* 互动判定（v1.9）：连点彩蛋 / 夜间犯困 / 闲置打盹 / 大额·里程碑·预算 / 页面问好 */
  /* ================================================================== */

  var POKE_CONFUSED_LINES = ['干嘛呀，一直戳我…', '再戳就要收费啦！', '咋、咋啦？', '有话好好说嘛～'];
  var POKE_ANGRY_LINES = ['晕了晕了…让我缓缓（30 秒内戳我也不理你哦）', '别戳啦！戳我也戳不出钱呀！'];
  var PET_NIGHT_LINES = ['夜深了，记完这笔早点睡哦～', '这么晚还在记账，辛苦啦。', '深夜下的单，明早再看看还想要吗～'];

  function isPetNight() {
    var h = new Date().getHours();
    return h >= 23 || h < 6;
  }

  /** 今天记了几笔（含收入；petReact 调用时新账单已入账本，n 就是「这是第 n 笔」） */
  function billsTodayCount(ov) {
    var t = (ov && ov.todayStr) || (global.AJ && global.AJ.eng && ENG.formatDate(new Date()));
    if (!t) { return 0; }
    var n = 0;
    for (var i = 0; i < state.bills.length; i++) {
      if (state.bills[i].date === t) { n++; }
    }
    return n;
  }

  /** 预算紧张提醒：一个周期只主动念一次 */
  var petNudgedCycle = '';

  function petBudgetNudgeOk(ov) {
    var start = ov && ov.cycle && ov.cycle.start;
    if (!start || petNudgedCycle === start) { return false; }
    petNudgedCycle = start;
    return true;
  }

  /**
   * 给记账事件补充「场景台词」：优先级 大额 > 今日里程碑 > 预算紧张 > 深夜。
   * 台词写进 act.line，三条皮肤通道都会念（azhang 直接说 / sprite·pro 走 o.line）。
   */
  var lastNightWhisper = 0;

  function petEnrichAct(kind, act) {
    var a = act || {};
    if (kind !== 'bill_logged' && kind !== 'income_logged') { return a; }
    if (kind === 'bill_logged') {
      var amt = Number(a.amount) || 0;
      var ov = safeOverview();
      var bs = ov && ov.budgetState;
      if (amt >= 200 || (bs && bs.dailyAllowance > 0 && amt >= bs.dailyAllowance * 3)) {
        a.big = true;
        a.line = '哇，一笔就是 ' + money(amt) + '，眼睛都瞪圆了！';
      } else {
        var nToday = billsTodayCount(ov);
        if (nToday === 5) { a.line = '今天第 5 笔啦，记账小能手！'; }
        else if (nToday === 10) { a.line = '第 10 笔！你是把记账刻进 DNA 了吧？'; }
        else if (bs && !bs.isOver && bs.status === 'tight' && petBudgetNudgeOk(ov)) {
          a.tight = true;   /* 预算紧张：阿账改演「皱眉拨算盘」 */
          a.line = '预算有点紧了，接下来收着点花哦～';
        }
      }
    }
    if (!a.line && isPetNight() && Date.now() - lastNightWhisper > 600000) {
      lastNightWhisper = Date.now();
      a.line = PET_NIGHT_LINES[Math.floor(Math.random() * PET_NIGHT_LINES.length)];
    }
    return a;
  }

  /* ---- 闲置打盹：2 分钟没有动静就眯一会儿，一有动静立刻惊醒 ---- */
  var PET_IDLE_MS = 120000;
  var petIdleTimer = 0;
  var petNapping = false;

  function armPetIdle() {
    if (petIdleTimer) { global.clearTimeout(petIdleTimer); }
    petIdleTimer = global.setTimeout(petNap, PET_IDLE_MS);
  }

  function petNap() {
    petIdleTimer = 0;
    if (!petEnabled() || DOC.hidden) { armPetIdle(); return; }
    petNapping = true;
    var skin = petSkin();
    if (skin === 'sprite') {
      var sp = global.AJ && global.AJ.petSprite;
      if (sp && typeof sp.setSleep === 'function') { sp.setSleep(true); }
      if (sp && typeof sp.say === 'function') { sp.say('zzZ…先眯一会儿，有动静叫我～'); }
    } else if (skin === 'pro') {
      var pp = global.AJ && global.AJ.petPro;
      if (pp && typeof pp.setSleep === 'function') { pp.setSleep(true); }
      if (pp && typeof pp.say === 'function') { pp.say('zzZ…眯一会儿，有事叫我～'); }
    } else if (petEl && !MOOD.missing) {
      petApplyMood('sleep');
      petSay('zzZ…先眯一会儿，有动静叫我～', '#8A9BB8');
    }
  }

  /** 惊醒：复位阿账的表情 / 关掉精灵管家的睡脸；台词交给后续反应 */
  function petWake() {
    if (!petNapping) { return; }
    petNapping = false;
    var skin = petSkin();
    if (skin === 'sprite') {
      var sp = global.AJ && global.AJ.petSprite;
      if (sp && typeof sp.setSleep === 'function') { sp.setSleep(false); }
    } else if (skin === 'pro') {
      var pp = global.AJ && global.AJ.petPro;
      if (pp && typeof pp.setSleep === 'function') { pp.setSleep(false); }
    } else if (petEl && !MOOD.missing) {
      petApplyMood(MOOD.resolveMood(safeOverview()));
    }
  }

  /** 阿账拖完放下的一句（6s 节流，别每次放下都唠叨） */
  var lastAzDropLine = 0;

  function petDropLine() {
    var now = Date.now();
    if (now - lastAzDropLine < 6000) { return; }
    lastAzDropLine = now;
    petSay('搬好啦，这位置不错～', '#07C160');
    global.setTimeout(function () {
      if (petEl && !MOOD.missing) { petApplyMood(MOOD.resolveMood(safeOverview())); }
    }, 1800);
  }

  /**
   * 每日首次见面：挥手打招呼（视频同款动作）。
   * lastWave 记在设置里，同一天重开应用不再重复挥；精灵/管家有自己的 greet，不参与。
   */
  function petDailyWave() {
    if (!petEnabled() || petSkin() !== 'azhang' || !petEl || MOOD.missing) { return; }
    var st = getSettings();
    st.mascot = st.mascot || {};
    var d = new Date();
    var today = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    if (st.mascot.lastWave === today) { return; }
    st.mascot.lastWave = today;
    persistSettings();
    petWake();
    petApplyMood('cheer');
    petPlayAct('wave', null);
    petSay('你好呀，今天也一起好好记账吧～', PET_TINT['cheer'] || '#07C160');
  }

  /** 进入攒钱/理财页面打个招呼（5 分钟每页最多一次；管家有自己的 setScene('learn')，不重复） */
  var petViewHiAt = {};

  function petViewHi(view) {
    if (!petEnabled()) { return; }
    if (view !== 'coach' && view !== 'scoach' && view !== 'ssave' &&
        view !== 'goals' && view !== 'sgoals') { return; }
    if (petSkin() === 'pro') { return; }
    var now = Date.now();
    if (now - (petViewHiAt[view] || 0) < 300000) { return; }
    petViewHiAt[view] = now;
    petWake();
    var line = (view === 'goals' || view === 'sgoals')
      ? '这里能定攒钱目标，我帮你盯着进度～'
      : '这里能学省钱技巧，我陪你一起看～';
    if (petSkin() === 'sprite') {
      var sp = global.AJ && global.AJ.petSprite;
      if (sp && typeof sp.say === 'function') { sp.say(line, 'income'); }
    } else if (petEl && !MOOD.missing) {
      petPlayAct('wave', null);   /* 问好也是挥手 */
      petApplyMood('save');
      petSay(line, PET_TINT['save'] || '#07C160');
    }
  }

  /**
   * 动作回应（v1.8 核心）：针对「刚刚发生的那个动作」变脸 + 撒特效 + 说那一笔。
   * 与 petOnMoodChange 的区别：后者只看状态机当前 mood，取的是账本现状话术，
   * 会出现「刚存完钱却在说餐饮占比」的错位；这里由事件源显式带上动作数据。
   * @param {string} kind bill_logged/income_logged/piggy_in/piggy_out/cooldown_block/impulse_flag/goal_done
   * @param {Object} [act] { amount, cat, note, count }
   */
  function petReact(kind, act) {
    if (!petEnabled()) { return; }
    /* 发声与形象无关：先触发音效，再按当前形象决定谁来「演戏」。
       选了精灵/管家时阿账虽然不显示，声音照样要有 —— 三个形象共用一套反馈。 */
    petSfx(kind, act);
    petWake();          // 打盹中被记账动静吵醒
    armPetIdle();       // 重新计闲置
    act = petEnrichAct(kind, act);   // 场景台词：大额 / 里程碑 / 预算紧张 / 深夜

    var skin = petSkin();   // 只读一次设置：三个分支互斥，读多了容易各分支拿到不同值

    if (skin === 'sprite') {
      var sp = global.AJ && global.AJ.petSprite;
      if (sp && typeof sp.react === 'function') {
        var a0 = act || {};
        var cents0 = (a0.cents !== undefined) ? a0.cents
          : Math.round((Number(a0.amount) || 0) * 100);
        /* 大额对齐：精灵也用「瞪眼」脸（贴台词「眼睛都瞪圆了」），不用花钱的耷拉脸 */
        var scene0 = (a0.big && kind === 'bill_logged') ? 'focus' : (PET_SCENE[kind] || 'spend');
        /* silent：声音已由 petSfx 统一发过，这里只做表情与气泡，避免响两声 */
        sp.react(scene0, {
          cents: cents0,
          amt: isFinite(Number(a0.amount)) ? money(Number(a0.amount)) : '',
          line: a0.line || '',
          big: !!a0.big,
          silent: true
        });
      }
      return '';   // 精灵模式下阿账不参与，无 mood key
    }

    if (skin === 'pro') {
      var pp = global.AJ && global.AJ.petPro;
      if (pp && typeof pp.react === 'function') {
        var a1 = act || {};
        var cents1 = (a1.cents !== undefined) ? a1.cents
          : Math.round((Number(a1.amount) || 0) * 100);
        /* 大额对齐：管家同样瞪眼 + 星星特效（react 内部按 o.big 加 burst） */
        var scene1 = (a1.big && kind === 'bill_logged') ? 'focus' : (PET_SCENE[kind] || 'spend');
        /* 同上：silent 交给 app.js 的 petSfx 统一发声，这里只演动作与气泡 */
        pp.react(scene1, {
          cents: cents1,
          amt: isFinite(Number(a1.amount)) ? money(Number(a1.amount)) : '',
          line: a1.line || '',
          big: !!a1.big,
          silent: true
        });
      }
      return '';   // 管家模式下阿账不参与，无 mood key
    }

    if (!petEl || MOOD.missing) { return; }
    petActAt = Date.now();
    petPlayAct(kind, act);
    var key = (typeof MOOD.actionMood === 'function' && MOOD.actionMood(kind)) || 'cheer';
    petApplyMood(key);
    /* 大额支出 / 预算紧张：皱眉发愁脸 + 拨算盘动作（petPlayAct 里 bill→calc） */
    if (act && (act.big || act.tight)) { petApplyMood('nervous'); }
    if (act && act.big) { petFx('burst'); }
    else if (kind === 'piggy_in' || kind === 'goal_in' || kind === 'goal_done' || kind === 'income_logged') { petFx('coins'); }
    else if (kind === 'cooldown_block') { petFx('burst'); }
    else if (kind === 'impulse_flag' || kind === 'piggy_out') { petFx('burst'); }
    else { petFx('check'); }
    if (typeof MOOD.actionLine === 'function') {
      var text = (act && act.line) ||
        MOOD.actionLine(kind, {
          ov: safeOverview(), state: state, money: money, act: act || {}
        });
      if (text) { petSay(text, PET_TINT[key] || '#07C160'); }
    }
    return key;
  }

  /** 切换浮层宠物的情绪光环（动作动画统一由 petPlayAct 的 data-act 层负责） */
  function petApplyMood(key) {
    if (!petEl) { return; }
    var k = key || 'chill';
    var keys = ['chill', 'nervous', 'bankrupt', 'stop', 'cheer', 'mad', 'save', 'deadline', 'sleep'];
    for (var i = 0; i < keys.length; i++) { petEl.classList.remove('mood-' + keys[i]); }
    petEl.classList.add('mood-' + k);
  }

  /** mood 变化回调：记账成功/超支/拦截/存钱 时自动变脸（事件态额外弹一句） */
  function petOnMoodChange() {
    if (petEl && !MOOD.missing) {
      var ov = safeOverview();
      var key = MOOD.resolveMood(ov);
      petApplyMood(key);
      /* 动作回应（petReact）优先：它刚说完这一笔，别被账本现状文案盖掉 */
      var fresh = (Date.now() - petActAt) < 600;
      if (!fresh && (key === 'cheer' || key === 'save' || key === 'mad' || key === 'stop')) {
        var line = MOOD.line({ ov: ov, state: state, money: money });
        if (line) { petSay(line, PET_TINT[key] || '#07C160'); }
      }
    }
    applyPetVisibility();
  }

  function applyPetVisibility() {
    var on = petEnabled();
    var skin = petSkin();

    /* 阿账浮层：总开关开 且 当前选的是阿账 */
    if (petEl) {
      if (on && skin === 'azhang') { petEl.classList.remove('hidden'); }
      else { petEl.classList.add('hidden'); }
    }
    petApplyReserve();

    /* 存钱罐精灵：与阿账互斥 —— 两者都钉在右下角，同时显示会互相遮挡。
       pet.js 缺失（旧包/裁剪版）时 setActive 不存在，静默跳过。 */
    var sp = global.AJ && global.AJ.petSprite;
    if (sp && typeof sp.setActive === 'function') {
      sp.setActive(on && skin === 'sprite');
    }

    /* 记账小管家：同样三路互斥。petpro.js 未打进包里时静默跳过。 */
    var pp = global.AJ && global.AJ.petPro;
    if (pp && typeof pp.setActive === 'function') {
      pp.setActive(on && skin === 'pro');
    }
  }

  /**
   * 换宠物形象（阿账 → 存钱罐精灵 → 记账小管家 → 阿账）。
   * 三个入口共用这一份逻辑：设置页分段、首次进入弹窗、宠物右上角的 ⇄ 按钮。
   * @param {string} [target] 'azhang' | 'sprite' | 'pro'；不传就切到「下一个」
   * @param {{quiet?: boolean}} [opts] quiet=true 时不弹「已换成 X」的 ok 提示 ——
   *        调用方自己要提示（比如「自定义我的形象」在宠物总开关关掉时会补一句
   *        「请打开桌面宠物」），两条叠在一起反而吵。
   * @returns {string} 切换后的形象
   */
  function switchPetSkin(target, opts) {
    var quiet = !!(opts && opts.quiet);
    var cur = petSkin();
    var next;
    if (target === 'azhang' || target === 'sprite' || target === 'pro') {
      next = target;
    } else {
      var idx = PET_SKIN_ORDER.indexOf(cur);
      next = PET_SKIN_ORDER[(idx + 1) % PET_SKIN_ORDER.length];
    }
    if (next === cur) { return cur; }

    /* 三只宠物共用「一个位置槽」：切换前量当前宠物的实际位置，
       切换后无条件把新宠物放到同一个角落（右下缘对齐）。
       这样无论拖过谁、切换多少次，宠物都待在原地，只有形象变（2026-10 用户反馈
       「每次切换都会改位置」—— 上一版只在对方无记忆时继承一次，继承过一次后
       各自都有了记忆，再拖一只切换时另一只又跳回自己的旧位置，位置照样变）。 */
    var prevRect = currentPetRect(cur);

    getSettings().mascot = getSettings().mascot || {};
    getSettings().mascot.skin = next;
    persistSettings();
    setupFloatingPet();
    applyPetVisibility();
    inheritPetPos(next, prevRect);
    renderSettingsPage();     /* 同步设置页里「宠物形象」的勾选（自定义入口常驻，不参与） */
    renderMascotBar();        /* 播报条头像跟着换形象 */
    repaintChatAvatars(next); /* 聊天页已有 AI 头像的图案也跟着换（情绪底色保留） */
    renderChatPeerName();     /* 聊天页标题 / 欢迎语 / 头像 aria 跟着改名 */
    petGreet(next);
    if (!quiet) { showToast('已换成' + (PET_SKIN_NAME[next] || '阿账'), 'ok'); }
    return next;
  }

  /** 当前可见宠物的实际位置（实时量 rect，不读各模块的记忆存储） */
  function currentPetRect(skin) {
    var s = skin || petSkin();
    var el = petElOf(s);
    if (!el) { return null; }
    var r = el.getBoundingClientRect();
    if (!r || r.width < 5 || r.height < 5) { return null; }
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  }

  /** 按形象拿宠物根元素（阿账 #ajPet 常驻 DOM，其余由各模块挂载） */
  function petElOf(skin) {
    if (skin === 'azhang') { return petEl; }
    if (skin === 'sprite') { return DOC.querySelector('.mascot'); }
    if (skin === 'pro') { return DOC.querySelector('.pm-mascot'); }
    return null;
  }

  /**
   * 把新宠物放到 prevRect 的同一角落：右缘、底缘对齐（三只容器宽高不同，
   * 按右下对齐切换时锚点视觉不动，只有左上因体型差略有伸缩）。
   * 无条件覆盖 —— 位置槽是共享的，不保留各模块自己的旧记忆。
   */
  function inheritPetPos(skin, prevRect) {
    if (!prevRect) { return; }
    var el = petElOf(skin);
    if (!el) { return; }
    var r = el.getBoundingClientRect();
    if (!r || r.width < 5) { return; }
    var nl = Math.round(prevRect.r - r.width);
    var nt = Math.round(prevRect.b - r.height);
    if (skin === 'azhang') {
      petPlace(nl, nt);          /* petPlace 自带视口边界钳制 */
      petSavePos(nl, nt);
      return;
    }
    var mod = (skin === 'sprite') ? (global.AJ && global.AJ.petSprite)
                                  : (global.AJ && global.AJ.petPro);
    if (mod && typeof mod.setPos === 'function') { mod.setPos(nl, nt); }
  }


  /**
   * 切换后的登场问候：新形象说一句，让用户确认「换成功了」。
   * 阿账的 DOM 一直挂在 body 上（只是 hidden），精灵与管家都是 setActive 现建的，
   * 三者都等一帧再发言，避开同时重建 DOM 时的时序问题。
   */
  function petGreet(skin) {
    if (skin === 'sprite') {
      var sp = global.AJ && global.AJ.petSprite;
      /* 优先用精灵的专属招呼语（greet），老包没有这个方法时退回 poke */
      if (sp && typeof sp.greet === 'function') {
        global.setTimeout(function () { sp.greet(); }, 80);
      } else if (sp && typeof sp.react === 'function') {
        global.setTimeout(function () { sp.react('poke'); }, 80);
      }
      return;
    }
    if (skin === 'pro') {
      var pp = global.AJ && global.AJ.petPro;
      /* 管家有自己的专属招呼语（greet）；老包缺这个方法时退回 income 反应 */
      if (pp && typeof pp.greet === 'function') {
        global.setTimeout(function () { pp.greet(); }, 80);
      } else if (pp && typeof pp.react === 'function') {
        global.setTimeout(function () { pp.react('income'); }, 80);
      }
      return;
    }
    petSfx('income');
    global.setTimeout(function () { petSay('我回来啦，继续帮你盯着钱袋子～', '#07C160'); }, 80);
  }

  /* 供 pet.js 的 ⇄ 按钮调用（pet.js 不感知 app 内部实现，只认这一个出口） */
  (global.AJ = global.AJ || {}).switchPet = function () { return switchPetSkin(); };
  /* pet.js / petpro.js 的本体点击统一路由到这里：连点彩蛋、夜间、睡醒判定都在内 */
  global.AJ.petPoke = petPoke;
  /* petpro.js 工坊保存/重置形象后回调：播报条 + 聊天页头像跟着新形象变（含照片脸） */
  global.AJ.onPetProProfileChange = function () {
    renderMascotBar();
    repaintChatAvatars(petSkin());
  };

  /** 把设置页的「互动反馈」开关同步给 sfx.js（sfx 自带存储兜底，但以设置页为准） */
  function syncPetFx() {
    var sfx = global.AJ && global.AJ.sfx;
    if (sfx && typeof sfx.setEnabled === 'function') {
      sfx.setEnabled(getSettings().fx !== false);
    }
  }

  /**
   * 首次进入：让用户选宠物形象（只弹一次，选过就写进 mascot.skin）。
   * 点遮罩关闭 = 用默认的阿账，同样记下，不反复骚扰。
   */
  function maybePickPetSkin() {
    var st = getSettings();
    if (st.mascot && st.mascot.skin) { return; }   // 已经选过
    var cur = 'azhang';

    function commit() {
      getSettings().mascot = getSettings().mascot || {};
      getSettings().mascot.skin = cur;
      persistSettings();
      closeModal();
      syncPetFx();
      renderSettingsPage();
      setupFloatingPet();
      applyPetVisibility();
      renderChatPeerName();   /* 首次选完就把聊天页名字换成它 */
      /* 选完给一声反馈，让用户确认「它醒了」—— 精灵/管家走专属招呼语，
         不用 poke 的随机文案（会抽到「戳我干什么」这种反问，当欢迎语不合适） */
      var sp0 = global.AJ && global.AJ.petSprite;
      var pp0 = global.AJ && global.AJ.petPro;
      if (cur === 'sprite' && sp0 && typeof sp0.greet === 'function') { sp0.greet(); }
      else if (cur === 'sprite' && sp0 && typeof sp0.poke === 'function') { sp0.poke(); }
      else if (cur === 'pro' && pp0 && typeof pp0.greet === 'function') { pp0.greet(); }
      else if (cur === 'pro' && pp0 && typeof pp0.react === 'function') { pp0.react('income'); }
      else { petSfx('income'); }
      if (cur === 'azhang') { setTimeout(function () { petPlayAct('wave', null); }, 600); }
      showToast((PET_SKIN_NAME[cur] || '阿账') + '已就位，右下角戳戳看', 'ok');
    }

    /** 卡片里的真实形象：阿账走 moodSvg，精灵/管家直接用各自模块的形象 SVG（缺模块时退回通用图标） */
    function petPickArt(skin) {
      var sp, pp;
      if (skin === 'azhang') {
        return (typeof MOOD.moodSvg === 'function') ? MOOD.moodSvg('cheer', 'mico', '阿账') : ic('user', '', '');
      }
      if (skin === 'sprite') {
        sp = global.AJ && global.AJ.petSprite;
        return (sp && sp._svg) ? sp._svg : ic('piggy', '', '');
      }
      pp = global.AJ && global.AJ.petPro;
      return (pp && typeof pp._charSvg === 'function' && pp._charSvg()) || ic('spark', '', '');
    }

    var box = openModal(
      '<div class="pet-pick">' +
      '  <h4>选个小伙伴陪你记账</h4>' +
      '  <p class="pet-pick-sub">它会住在右下角，记账、存钱、超支时都有反应。' +
      '随时能在「设置 · 宠物形象」里更换。</p>' +
      /* 三列：390px 视口下每列约 103px，见 styles.css 的 .pet-pick-list-3。
         卡片里放三只的真实样子，不再用通用图标 */
      '  <div class="pet-pick-list pet-pick-list-3">' +
      '    <button type="button" class="pet-pick-card active" data-skin="azhang">' +
      '      <span class="ppc-ico ppc-art">' + petPickArt('azhang') + '</span>' +
      '      <b>阿账</b><small>9 种心情<br>顶部播报预算</small>' +
      '    </button>' +
      '    <button type="button" class="pet-pick-card" data-skin="sprite">' +
      '      <span class="ppc-ico ppc-art">' + petPickArt('sprite') + '</span>' +
      '      <b>存钱罐精灵</b><small>6 种表情<br>随手就能拖</small>' +
      '    </button>' +
      '    <button type="button" class="pet-pick-card" data-skin="pro">' +
      '      <span class="ppc-ico ppc-art">' + petPickArt('pro') + '</span>' +
      '      <b>记账小管家</b><small>自定义形象<br>小猪绕身</small>' +
      '    </button>' +
      '  </div>' +
      '  <button type="button" class="pet-pick-ok" id="petPickOk">就它了</button>' +
      '</div>'
    );

    var cards = box.querySelectorAll('.pet-pick-card');
    var i;
    for (i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function () {
        for (var j = 0; j < cards.length; j++) { cards[j].classList.remove('active'); }
        this.classList.add('active');
        cur = this.getAttribute('data-skin');
      });
    }
    var okBtn = box.querySelector('#petPickOk');
    if (okBtn) { okBtn.addEventListener('click', commit); }

    /* 点遮罩关闭：当作选默认阿账，别下次再弹 */
    var mask = $('modalMask');
    if (mask) {
      mask.addEventListener('click', function once(e) {
        if (e.target !== mask) { return; }
        mask.removeEventListener('click', once);
        if (!(getSettings().mascot && getSettings().mascot.skin)) { commit(); }
      });
    }
  }

  /**
   * 戳一戳（v1.9 连点彩蛋）：2.2s 内连点计数递进 ——
   *   1~2 下：正常随机反应；3~4 下：疑惑（「干嘛呀一直戳我」）；5 下起：晕/生气，
   *   同时进入 30s 冷却。冷却期不再全静默（用户反馈「触发后又不触发」：
   *   全静默看起来像坏了）—— 冷却内点它每 8s 应一声「还在晕」，只是暂停升级。
   * pet.js / petpro.js 的本体点击都路由到这里（独立打开模块时才退回本地 poke）。
   */
  var petPokeStreak = { n: 0, at: 0, coolUntil: 0, lastCoolAt: 0, lastQuickAt: 0 };
  var POKE_COOLING_LINES = ['（晕乎乎…）让我再缓缓…', '（眼前全是星星…）'];
  var POKE_QUICK_LINES = ['嗯？怎么啦？', '咋啦咋啦～', '我在听，你说～'];

  function petPoke() {
    if (!petEnabled()) { return; }
    var st = getSettings();
    if (st.mascot && st.mascot.poke === false) { return; }
    var now = Date.now();

    if (now < petPokeStreak.coolUntil) {
      /* 冷却期：低频应一声，但不升级、不重置计数 */
      if (now - petPokeStreak.lastCoolAt > 8000) {
        petPokeStreak.lastCoolAt = now;
        var coolLine = POKE_COOLING_LINES[Math.floor(Math.random() * POKE_COOLING_LINES.length)];
        var skinCool = petSkin();
        if (skinCool === 'sprite') {
          var spCool = global.AJ && global.AJ.petSprite;
          if (spCool && typeof spCool.say === 'function') { petSfx('poke'); spCool.say(coolLine, 'error'); }
        } else if (skinCool === 'pro') {
          var ppCool = global.AJ && global.AJ.petPro;
          if (ppCool && typeof ppCool.say === 'function') { petSfx('poke'); ppCool.say(coolLine, 'error'); }
        } else if (petEl && !MOOD.missing) {
          petSfx('poke');
          petApplyMood('mad');
          petSay(coolLine, '#EF5350');
        }
      }
      return;
    }

    petPokeStreak.n = (now - petPokeStreak.at < 2200) ? petPokeStreak.n + 1 : 1;
    petPokeStreak.at = now;
    var level = petPokeStreak.n >= 5 ? 'angry' : (petPokeStreak.n >= 3 ? 'confused' : 'normal');
    if (level === 'angry') {
      petPokeStreak.coolUntil = now + 30000;
      petPokeStreak.n = 0;
      petPokeStreak.lastCoolAt = now;   // 生气台词先展示，8s 后冷却回应才接管
    }
    petWake();
    armPetIdle();

    var line = null;
    if (level === 'confused') { line = POKE_CONFUSED_LINES[Math.floor(Math.random() * POKE_CONFUSED_LINES.length)]; }
    if (level === 'angry') { line = POKE_ANGRY_LINES[Math.floor(Math.random() * POKE_ANGRY_LINES.length)]; }

    var skin = petSkin();
    if (skin === 'sprite') {
      var sp = global.AJ && global.AJ.petSprite;
      if (!sp) { return; }
      if (level === 'angry') { petSfx('impulse_flag'); sp.say(line, 'error'); }
      else if (level === 'confused') { petSfx('poke'); sp.react('focus', { line: line, silent: true }); }
      else if (typeof sp.poke === 'function') { sp.poke(); }
      return;
    }

    if (skin === 'pro') {
      var pp = global.AJ && global.AJ.petPro;
      if (!pp) { return; }
      if (level === 'angry') { petSfx('impulse_flag'); pp.say(line, 'error'); }
      else if (level === 'confused') { petSfx('poke'); pp.react('focus', { line: line, silent: true }); }
      else if (typeof pp.poke === 'function') { pp.poke(); }
      return;
    }

    if (!petEl || MOOD.missing) { return; }
    if (level === 'angry') {
      petSfx('impulse_flag');
      petApplyMood('mad');
      petPlayAct('poke');
      petFx('burst');
      petSay(line, '#EF5350');
      return;
    }
    if (level === 'confused') {
      petSfx('poke');
      petApplyMood('stop');
      petPlayAct('poke');
      petSay(line, '#FF8A3D');
      return;
    }
    var ov = safeOverview(), key = MOOD.resolveMood(ov);
    petApplyMood(key);
    petPlayAct('poke');
    var hit = MOOD.poke({ ov: ov, state: state, money: money });
    if (hit && hit.text) {
      petSay(hit.text, PET_TINT[key] || '#07C160');
    } else if (now - petPokeStreak.lastQuickAt > 1200) {
      /* MOOD.poke 有 3s 防刷窗会静默 —— 连点计数期间每一下都要有反馈，
         否则用户感知不到「正在计数」，升级永远到不了（2026-10 用户反馈） */
      petPokeStreak.lastQuickAt = now;
      petSay(POKE_QUICK_LINES[Math.floor(Math.random() * POKE_QUICK_LINES.length)], PET_TINT[key] || '#07C160');
    }
    petSfx('poke');
  }

  /* 互动判定的测试出口（探针用）：不碰任何 UI 状态，只暴露只读/触发入口。
     必须放在 petPokeStreak 赋值之后 —— 对象字面量按顺序取值，放前面会抓到 undefined */
  global.AJ.petDebug = {
    enrichAct: petEnrichAct,   // 直接问「这笔会带什么台词」
    pokeStreak: petPokeStreak, // 连点计数 / 冷却窗口
    nap: petNap,               // 立刻触发打盹（不用等 2 分钟）
    isNight: isPetNight,
    billsToday: billsTodayCount,
    playAct: petPlayAct,       // 直接驱动动作（挥手/拨算盘等，探针验证动画挂载）
    react: petReact            // 完整链路：enrichAct 台词 → 变脸 → 动作（探针验证大额→拨算盘）
  };

  /**
   * 宠物的「落脚框」：右边界 + 能不能停到框外。
   * - 手机版式：以底部导航的右缘为框（宽屏时手机框居中，框外是页面留白，可以站出去）
   * - 桌面版式（无底部导航，聊天列 + 右侧面板）：以聊天列输入区的右缘为框，
   *   只能停在列内右下角 —— 列外就是右侧面板，站出去会压住预算卡
   */
  function petFrame() {
    var vw = global.innerWidth || 360;
    var tb = $('tabbar');
    if (tb) {
      var tr = tb.getBoundingClientRect();
      if (tr && tr.width > 0) { return { right: Math.min(vw, tr.right), allowOutside: true }; }
    }
    var comp = DOC.querySelector('.chat-composer');
    if (comp) {
      var cr = comp.getBoundingClientRect();
      if (cr && cr.width > 60 && cr.top > 0 && cr.top < (global.innerHeight || 640)) {
        return { right: Math.min(vw, cr.right), allowOutside: false };
      }
    }
    return { right: vw, allowOutside: false };
  }

  function petFrameRight() { return petFrame().right; }

  /** 聊天区/输入区上沿：宠物要悬在它上面，别压住输入框 */
  function petBottomLimit() {
    var vh = global.innerHeight || 640;
    var vw = global.innerWidth || 360;
    var lim = vh - 24;
    var tb = $('tabbar');
    if (tb) {
      var tr = tb.getBoundingClientRect();
      if (tr && tr.width && tr.top > 0) { lim = Math.min(lim, tr.top - 6); }
    }
    var comp = DOC.querySelector('.chat-composer');
    if (comp) {
      var cr = comp.getBoundingClientRect();
      /* 有些面板的 composer 是隐藏的（高度 0 / 屏幕外），这种不算 */
      if (cr && cr.height > 0 && cr.top > 0 && cr.top < vh) {
        lim = Math.min(lim, cr.top - 6);
      }
    }
    var vv = global.visualViewport;
    if (vv && vv.height) { lim = Math.min(lim, vv.height - 24); }
    return lim;
  }

  /**
   * 默认落脚点：右下角，悬在「输入区 + 底部导航」之上，且**不压内容**。
   * 手机框居中（框外是页面留白）→ 停到框**外侧**，一像素都不占；
   * 否则停进聊天列右下角，同时给消息列表留出让位空间（见 petApplyReserve）。
   * 首帧渲染时聊天区还没撑开，tabbar 位置偏高，所以首帧后要再算一次（见 setupFloatingPet）。
   */
  function petDefaultPos() {
    var vw = global.innerWidth || 360;
    var w = (petEl && petEl.offsetWidth) || 104;
    var fr = petFrame();
    var bottom = petBottomLimit();
    var outside = fr.allowOutside && (vw - fr.right) >= (w + 26);
    var x = outside ? (fr.right + 13) : (fr.right - w - 12);
    var y = bottom - w;
    x = Math.max(0, Math.min(x, vw - w));
    return { x: x, y: y, side: outside ? 'outside' : 'inside' };
  }

  /**
   * 让位：宠物停进手机框内时，给消息列表底部补一段空白，
   * 否则滚到底时最新一条消息正好被宠物盖住（用户反馈「压住最新消息」）。
   * 停到框外（宽屏）则不需要，直接还回去。
   * 补空的瞬间如果列表本来就在底部，要重新贴底，否则最新消息原地不动、照样被盖。
   */
  var petReservePx = -1;
  function petApplyReserve() {
    var root = DOC.documentElement;
    if (!root || !root.style) { return; }
    var val = 0;
    if (petEl) {
      var r = petEl.getBoundingClientRect();
      var hidden = petEl.classList.contains('hidden') || !r.width;
      /* 只有「脚踩在手机框内」才需要让位；停在框外（桌面宽屏）一像素都不占 */
      if (!hidden && r.right <= petFrameRight() + 2) { val = Math.round(r.height + 18); }
    }
    if (val === petReservePx) { return; }
    var grew = val > petReservePx;
    petReservePx = val;
    root.style.setProperty('--aj-pet-reserve', val + 'px');
    if (!grew) { return; }
    var list = DOC.querySelector('.chat-list');
    if (!list || !list.clientHeight) { return; }
    /* 距底 60px 以内视为「正在看最新消息」：跟着补到底，别把新消息丢在宠物身下 */
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 60) {
      list.scrollTop = list.scrollHeight;
    }
  }

  function setupFloatingPet() {
    if (MOOD.missing) { return; }
    if (petEl) { applyPetVisibility(); return; }
    petEl = DOC.createElement('div');
    petEl.id = 'ajPet';
    petEl.className = 'aj-pet mood-chill';
    /* 结构：body(动作层) > bob/swey(待机层) > face(形象) ；
       prop(道具层) 与 body 平行，动作时从旁边顶出 STOP 牌/皇冠/彩纸等具体道具，
       两层分离 → 动作叠加在待机动画之上，而不是替换掉它，所以看得见。 */
    petEl.innerHTML =
      '<div class="aj-pet-halo"></div>' +
      '<div class="aj-pet-body">' +
      '<div class="aj-pet-bob"><div class="aj-pet-sway">' +
      '<div class="aj-pet-face" role="button" tabindex="0" aria-label="阿账 桌面宠物，可拖动，点击互动"></div>' +
      '</div></div></div>' +
      '<div class="aj-pet-prop" aria-hidden="true">' +
      '<svg class="aj-prop aj-prop-stop" viewBox="0 0 64 64">' +
      '<polygon points="21,4 43,4 60,21 60,43 43,60 21,60 4,43 4,21" fill="#EF4444" stroke="#B91C1C" stroke-width="3.2" stroke-linejoin="round"/>' +
      '<rect x="15" y="27.5" width="34" height="9" rx="4.5" fill="#fff"/></svg>' +
      '<svg class="aj-prop aj-prop-check" viewBox="0 0 40 40">' +
      '<circle cx="20" cy="20" r="16" fill="#07C160"/>' +
      '<path d="M12 20.8 L17.4 26.2 L28.4 14.6" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<svg class="aj-prop aj-prop-angry" viewBox="0 0 44 30">' +
      '<path d="M3 4 L17 14 M41 4 L27 14" fill="none" stroke="#EF4444" stroke-width="4.2" stroke-linecap="round"/>' +
      '<path d="M22 17 L28 24 M28 17 L22 24" fill="none" stroke="#EF4444" stroke-width="3.4" stroke-linecap="round"/></svg>' +
      '<svg class="aj-prop aj-prop-alert" viewBox="0 0 36 34">' +
      '<path d="M18 3 L33 30 H3 Z" fill="#3B82F6" stroke="#1D4ED8" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<rect x="16.2" y="11" width="3.6" height="9.5" rx="1.8" fill="#fff"/>' +
      '<circle cx="18" cy="25" r="2.1" fill="#fff"/></svg>' +
      '<svg class="aj-prop aj-prop-crown" viewBox="0 0 44 34">' +
      '<path d="M4 28 L6.5 8.5 L15.5 17 L22 4 L28.5 17 L37.5 8.5 L40 28 Z" fill="#FBBF24" stroke="#B45309" stroke-width="2.4" stroke-linejoin="round"/></svg>' +
      /* 视频同款动作（挥手打招呼）：手臂从身侧举起，带三道动势线 */
      '<svg class="aj-prop aj-prop-wave" viewBox="0 0 44 56">' +
      '<path d="M8 52 Q10 30 22 14" fill="none" stroke="#2FA35C" stroke-width="9" stroke-linecap="round"/>' +
      '<circle cx="25" cy="11" r="8.5" fill="#2FA35C"/>' +
      '<path d="M19 4.5 l1.2-3.2 M26 3.5 l2.4-2.6 M31.5 6.5 l3-1.8" fill="none" stroke="#2FA35C" stroke-width="3" stroke-linecap="round"/></svg>' +
      /* 视频同款动作（皱眉拨算盘）：绿框算盘举到身前，珠子来回拨 */
      '<svg class="aj-prop aj-prop-abacus" viewBox="0 0 52 44">' +
      '<rect x="3" y="3" width="46" height="38" rx="7" fill="#DDF2D8" stroke="#2FA35C" stroke-width="3"/>' +
      '<line x1="12" y1="8" x2="12" y2="36" stroke="#2FA35C" stroke-width="2"/>' +
      '<line x1="26" y1="8" x2="26" y2="36" stroke="#2FA35C" stroke-width="2"/>' +
      '<line x1="40" y1="8" x2="40" y2="36" stroke="#2FA35C" stroke-width="2"/>' +
      '<line x1="6" y1="15" x2="46" y2="15" stroke="#2FA35C" stroke-width="2"/>' +
      '<line x1="6" y1="28" x2="46" y2="28" stroke="#2FA35C" stroke-width="2"/>' +
      '<g class="aj-ab-bead"><ellipse cx="18" cy="28" rx="5" ry="4" fill="#07C160"/></g>' +
      '<g class="aj-ab-bead b2"><ellipse cx="33" cy="15" rx="5" ry="4" fill="#07C160"/></g>' +
      '<ellipse cx="34" cy="28" rx="5" ry="4" fill="#4CC97E"/>' +
      '<ellipse cx="18" cy="15" rx="5" ry="4" fill="#4CC97E"/></svg>' +
      '<i class="aj-confetti"></i><i class="aj-confetti"></i><i class="aj-confetti"></i>' +
      '<i class="aj-confetti"></i><i class="aj-confetti"></i><i class="aj-confetti"></i>' +
      '<span class="aj-prop-gain"></span>' +
      '</div>' +
      '<div class="aj-pet-fx" aria-hidden="true"></div>' +
      '<div class="aj-pet-bubble" role="status" aria-live="polite"></div>' +
      /* ⇄ 换一只：常驻右上角，和精灵身上那颗是同一颗（见 pet.js 的 build） */
      '<button type="button" class="pet-swap" aria-label="换一只宠物" title="换一只宠物">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M4.5 8.5h12M13.5 5.5l3 3-3 3M19.5 15.5h-12M10.5 12.5l-3 3 3 3"/></svg>' +
      '</button>';
    DOC.body.appendChild(petEl);

    /* 换一只按钮：petEl 上的拖拽监听会把「按下」当成拖拽、把「抬起」当成戳一戳，
       所以指针与键盘事件全部拦在这里，别让它冒到容器上。 */
    var swapBtn = petEl.querySelector('.pet-swap');
    if (swapBtn) {
      var swapStop = function (e) { e.stopPropagation(); };
      swapBtn.addEventListener('pointerdown', swapStop);
      swapBtn.addEventListener('pointerup', swapStop);
      swapBtn.addEventListener('pointercancel', swapStop);
      swapBtn.addEventListener('keydown', swapStop);
      swapBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        switchPetSkin();
      });
    }

    var saved = petReadPos();
    if (saved) {
      petMoved = true;
      petPlace(saved.x, saved.y);
    } else {
      var dp = petDefaultPos();
      petPlace(dp.x, dp.y);
    }
    petApplyReserve();

    var sX = 0, sY = 0, oX = 0, oY = 0, moved = false;

    function down(e) {
      if (e.button !== undefined && e.button !== 0) { return; }
      petDrag = true; moved = false;
      try { petEl.setPointerCapture(e.pointerId); } catch (err) {}
      petEl.classList.add('dragging');
      var r = petEl.getBoundingClientRect();
      sX = e.clientX; sY = e.clientY; oX = r.left; oY = r.top;
      if (e.preventDefault) { e.preventDefault(); }
    }
    function move(e) {
      if (!petDrag) { return; }
      var dx = e.clientX - sX, dy = e.clientY - sY;
      if (!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        moved = true;
        if (!MOOD.missing) { petApplyMood('stop'); }   // 刚抓起来：愣住（判定互动之一）
      }
      petPlace(oX + dx, oY + dy);
      if (e.preventDefault) { e.preventDefault(); }
    }
    function up(e) {
      if (!petDrag) { return; }
      petDrag = false;
      petEl.classList.remove('dragging');
      try { petEl.releasePointerCapture(e.pointerId); } catch (err) {}
      var r = petEl.getBoundingClientRect();
      petSavePos(r.left, r.top);
      petApplyReserve();
      if (moved) { petMoved = true; petDropLine(); }
      if (!moved) { petPoke(); }
    }
    petEl.addEventListener('pointerdown', down);
    petEl.addEventListener('pointermove', move);
    petEl.addEventListener('pointerup', up);
    petEl.addEventListener('pointercancel', up);
    petEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        if (e.preventDefault) { e.preventDefault(); }
        petPoke();
      }
    });
    global.addEventListener('resize', function () {
      if (!petEl) { return; }
      if (!petMoved) {
        var d = petDefaultPos();
        petPlace(d.x, d.y);
        petApplyReserve();
        return;
      }
      var rr = petEl.getBoundingClientRect();
      petPlace(rr.left, rr.top);
      petApplyReserve();
    });

    /* 首帧后聊天区才撑开，tabbar/输入区位置会下移：没被用户拖过就重新贴一次 */
    setTimeout(function () {
      if (!petEl || petMoved) { return; }
      var d = petDefaultPos();
      petPlace(d.x, d.y);
      petApplyReserve();
    }, 420);
    /* 键盘弹出 / 视口高度变化（移动端）也要重新贴，否则宠物会被输入区盖住 */
    if (global.visualViewport && global.visualViewport.addEventListener) {
      global.visualViewport.addEventListener('resize', function () {
        if (!petEl || petMoved) { return; }
        var d = petDefaultPos();
        petPlace(d.x, d.y);
        petApplyReserve();
      });
    }

    petApplyMood(MOOD.resolveMood(safeOverview()));
    applyPetVisibility();
  }

  function init() {
    loadState();
    loadSavingsDb();
    /* 闲置打盹判定：页面上任何按下都算「有动静」（惊醒 + 重新计 2 分钟） */
    DOC.addEventListener('pointerdown', function () { armPetIdle(); petWake(); }, true);
    armPetIdle();
    PIGGY.load();
    /* 心愿单是独立存储键：没这个 key 的老账本 load() 返回空库且不写盘 */
    if (WISH && !WISH.missing) { WISH.load(); }
    if (!savingsReady()) { degradeSavingsUi(); }
    if (!storageOK) { showStorageTip(); }
    applyAppearance();
    applyUiMode();
    var ring = $('ringBar');
    if (ring) {
      ring.style.strokeDasharray = RING_C + ' ' + RING_C;
      ring.style.strokeDashoffset = String(RING_C);
    }
    setupVoice();
    loadRealLive();       /* 恢复上次在线抓取的真实搜索结果（比价面板用） */
    bindEvents();
    bindSimpleEvents();
    /* 阿账：mood 变化（瞬时事件触发或 TTL 回落）→ 刷新常驻对话条。
       聊天历史行的头像保持定格（情绪时间线），只有 bar 实时跟随。 */
    if (!MOOD.missing) {
      MOOD.onMoodChange(function () { renderMascotBar(); if (petEl) { petOnMoodChange(); } });
    }
    renderAll();
    setupFloatingPet();
    syncPetFx();          /* 「互动反馈」开关以设置页为准，同步给 sfx.js */
    /* 静态 HTML 里「宠物形象」默认把阿账勾上、把「量身定做」置 hidden；
       用户上次选的是精灵/管家时，这两处必须首帧就按存储值纠正，
       否则刷新后设置页显示的是错的（旧实现只在「打开设置页/切换形象」时刷新）。 */
    renderSettingsPage();
    addWelcome();
    renderChatPeerName();   /* 上次选的是精灵/管家时，首帧标题与欢迎语就用对应名字 */
    // 默认视图按 UI 类型分流：简洁版进「记账」首页，完整版进聊天（修复简洁版刷新后落空白）
    switchView(getUiMode() === 'simple' ? 'shome' : 'chat');
    initCloud();
    renderSceneChips();
    maybeProactiveHint();
    maybeWishReview();
    maybePickPetSkin();   /* 没选过宠物形象 → 弹一次，选过直接跳过 */
    setTimeout(petDailyWave, 1500);   /* 每天第一次见面：挥手打招呼 */
  }

  if (DOC.readyState === 'loading') {
    DOC.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : this);
