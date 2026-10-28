/**
 * coach.js — 理财专家模式（核心附加能力）
 *
 * 定位：除了记账与预算预警之外的「校园理财专家」。
 * 触发场景：
 *   1. 记录【娱乐 / 冲动消费 / 高溢价品牌】账单后，给出「💡 理财专家说」卡片（≤50 字）；
 *   2. 用户问「怎么省钱 / 怎么赚钱」时，输出校园场景具体建议；
 *   3. 用户表达「想买 XX」时，引导走「剁手冷静法」三步问答。
 *
 * 对外 API（window.AJ.coach）：
 *   adviceForBill(bill, alt)   -> ?string  账单触发的一条专家建议（≤50 字，不触发返回 null）
 *   saveMoneyAnswer()          -> string  「怎么省钱」结构化回答（HTML）
 *   makeMoneyAnswer()          -> string  「怎么赚钱」结构化回答（HTML）
 *   isWantBuy(text)            -> ?{item, price}  识别「想买 XX」意图
 *   COOLING_STEPS              -> 剁手冷静法三步问题定义
 *   coolingVerdict(answers)    -> {level, title, text}  三步问答后的结论
 *   ACADEMY                    -> 理财学院课程列表
 *   personalTips(state, ov)    -> [tip]  基于账本数据生成的专属建议
 */
(function (global) {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var DATA = isNode ? require('./data.js') : global.AJ.data;
  var ENG = isNode ? require('./engine.js') : global.AJ.engine;

  var ALTERNATIVES = DATA.ALTERNATIVES;
  var CATEGORY_BUDGET_RATIO = DATA.CATEGORY_BUDGET_RATIO;

  /** 专家建议硬性长度上限（用户规格：不超过 50 字） */
  var ADVICE_MAX_LEN = 50;

  /** 兜底裁剪：无论如何都不超过 50 字 */
  function fit50(text) {
    var s = String(text || '').trim();
    if (s.length <= ADVICE_MAX_LEN) { return s; }
    return s.slice(0, ADVICE_MAX_LEN - 1) + '…';
  }

  function fmtMoney(n) {
    return ENG.fmtMoney(n);
  }

  /** 金额短格式：整数不带小数，否则 1 位小数（用于卡片正文，避免 ¥12.00 太啰嗦） */
  function fmt1(n) {
    return ENG.fmt1(n);
  }

  /** 行内小图标（与 app.js 的 ic 同义；各模块独立闭包，不能跨文件取名） */
  function ic(name, cls, label) {
    return DATA.inlineIcon('i-' + name, cls, label);
  }

  /* ================================================================== */
  /* 一、账单触发规则（记账后主动建议）                                    */
  /* ================================================================== */

  /* 冲动消费（情绪 / 想要）建议轮换，避免每次同一句 */
  var IMPULSE_ADVICE = [
    '先加购物车晾 48 小时，两天后还想买再找我记。',
    '冲动是魔鬼：把商品放进收藏夹，这周过去再看。',
    '给未来的自己发条消息：「三天后还想要吗？」'
  ];

  /* 娱乐类支出建议轮换 */
  var FUN_ADVICE = [
    '校园影院、免费展览也香，娱乐预算省着点造。',
    '快乐不靠烧钱：操场、图书馆、社团活动零成本。',
    '设个娱乐月上限，花超了就用免费项目补位。'
  ];

  var adviceCursor = { impulse: 0, fun: 0 };

  /**
   * 判断一笔支出是否触发专家建议，并返回建议文案。
   * 触发优先级：高溢价品牌（有平替） > 冲动消费 > 娱乐类。
   * @param {Object} bill 归一化后的账单
   * @param {?Object} alt ENG.getAlternative(bill) 的结果（可不传，内部自算）
   * @return {?string} ≤50 字建议；不触发返回 null
   */
  function adviceForBill(bill, alt) {
    if (!bill || bill.type !== 'expense') { return null; }
    if (alt === undefined) { alt = ENG.getAlternative(bill); }

    // 1) 高溢价品牌：有校园平替
    if (alt && alt.save > 0) {
      var line = '试试' + alt.altName + '（' + ENG.fmt1(alt.altPrice) + '元），' +
        (alt.tip || '更划算') + '更香。';
      return fit50(line);
    }

    // 2) 冲动消费：情绪消费 / 想要
    if (bill.motivation === '情绪' || bill.want === true) {
      var pool = IMPULSE_ADVICE;
      var txt = pool[adviceCursor.impulse % pool.length];
      adviceCursor.impulse++;
      return fit50(txt);
    }

    // 3) 娱乐类支出
    if (bill.category === '娱乐') {
      var fpool = FUN_ADVICE;
      var ftxt = fpool[adviceCursor.fun % fpool.length];
      adviceCursor.fun++;
      return fit50(ftxt);
    }

    return null;
  }

  /* ================================================================== */
  /* 二、怎么省钱 / 怎么赚钱（校园场景具体建议）                           */
  /* ================================================================== */

  function saveMoneyAnswer() {
    return '' +
      '<div class="coach-qa-title">' + ic('bulb', 'bico-brand', '省钱攻略') + '理财专家说 · 校园省钱攻略</div>' +
      '<ol class="coach-qa-list">' +
      '<li><b>食堂平替外卖</b>：一荤一素 10 元上下，一周少点 3 次外卖立省 50+</li>' +
      '<li><b>拿铁因子</b>：奶茶咖啡改自泡茶包 / 食堂现磨，一周省 30+</li>' +
      '<li><b>二手真香</b>：教材、电子产品去校园二手群 / 闲鱼，毕业季一折捡漏</li>' +
      '<li><b>白嫖资源</b>：图书馆数据库、MOOC、校园影院和展览，免费也快乐</li>' +
      '<li><b>每周复盘</b>：周日看一次分类占比，超支的类别下周设上限</li>' +
      '</ol>' +
      '<div class="coach-qa-foot">先挑 1 条执行，比一次全改更容易坚持。</div>';
  }

  /* ------------------------------------------------------------------ */
  /* 2.5 团购省钱指导（校外餐饮 / 娱乐：先搜券再下单）                       */
  /*                                                                     */
  /* 用户诉求（逐条对应）：                                                 */
  /*   1) 只要涉及校外餐饮 / 娱乐，无论几个人（哪怕一个人），都优先提醒去     */
  /*      美团 / 抖音搜「单人套餐」或「代金券」；                            */
  /*   2) 提到多人聚餐时，提醒搜「双人餐 / 多人餐」，并算出人均差价；         */
  /*   3) 代金券通常不限人数，结账金额达标就能抵扣；                         */
  /*   4) 说明团购的本质（商家线上引流的特价套餐），并点明「团购比会员日香」   */
  /*      —— 肯德基疯狂星期四只是会员日，团购券周几去都能用。                */
  /*                                                                     */
  /* 设计约束：本段全部是纯函数，不读写 DOM、不依赖 app.js，便于 Node 单测。   */
  /* ------------------------------------------------------------------ */

  /** 校外餐饮品牌（既用于 brand 识别，也并入 FOOD_KW 的关键词扫描） */
  var GB_BRANDS = [
    '肯德基', '麦当劳', '必胜客', '塔斯汀', '华莱士', '德克士', '海底捞',
    '瑞幸', '库迪', '喜茶', 'CoCo', '蜜雪', '茶百道', '古茗', '益禾堂',
    '好想来', '达美乐'
  ];

  /** 校外餐饮关键词 */
  var FOOD_KW = [
    '吃', '火锅', '烧烤', '烤串', '烤肉', '日料', '韩料', '自助', '下馆子', '夜宵',
    '早茶', '串串', '麻辣烫', '小龙虾', '披萨', '汉堡', '炸鸡', '快餐', '奶茶', '咖啡',
    '餐厅', '聚餐'
  ].concat(GB_BRANDS);

  /** 娱乐关键词 */
  var FUN_KW = [
    'KTV', '唱K', '唱歌', '剧本杀', '密室', '桌游', '台球', '网吧', '电竞', '电影',
    '影院', '演出', '演唱会', 'livehouse', '电玩', '蹦床', '脱口秀', '展览'
  ];

  /**
   * 校内场景关键词：需求明确是「**校外**餐饮 / 娱乐」才推团购券，
   * 食堂 / 饭堂 / 宿舍这些属于校内，本来就没有美团团购，命中即一律不推。
   */
  var CAMPUS_KW = ['食堂', '饭堂', '宿舍', '校内', '校园', '学校'];

  /**
   * 过去场景关键词：命中即视为「回述已经发生的事」（昨天吃过了 / 上周聚过餐），
   * 这时推「下次去先搜券」是错的，强制 planning=false、hit=false。
   */
  var PAST_KW = ['昨天', '前天', '上次', '上周', '上个月', '之前', '刚才'];

  /** 多人信号词 */
  var MULTI_KW = [
    '舍友', '室友', '朋友', '同学', '大家', '一起', '聚餐', '团建', '请客',
    '我们', '咱', '约', '几个人', '两人', '三人', '四人', '五人'
  ];

  /** 单人信号词 */
  var SINGLE_KW = [
    '我自己', '一个人', '单人', '单独', '自己吃', '自己去', '自己玩', '就我'
  ];

  /** 「打算去做」信号词（区分「准备去吃」与「已经记账」） */
  var PLANNING_KW = [
    '去', '打算', '准备', '想', '要', '约', '周末', '今晚', '待会', '明天', '后天',
    '晚上', '中午', '想去', '要去', '准备去', '要不要', '一起', '聚餐'
  ];

  /** 明显的「不去了」反悔语气：命中则不算 planning，避免误弹团购卡 */
  var CANCEL_PAT = /(不想去|不打算|不准备|别去|不去了|算了|吃不起|不吃了)/;

  /** 中文数字（「两人 / 三个人」这类写法） */
  var CN_NUM = {
    '两': 2, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
  };

  /**
   * 数字后面紧跟这些量词时，说明是「人数 / 日期 / 份数」而不是金额。
   * 顺序有意义：'个人' 必须排在 '个' 前面，否则「3 个人」会被判成单个「个」。
   */
  var NON_AMOUNT_UNIT = [
    '个人', '人', '位', '个', '月', '日', '号', '点', '岁',
    '次', '份', '杯', '碗', '张', '天', '周', '折'
  ];

  /** 统一的转小写（关键词表里有 CoCo / KTV / livehouse 这类大小写混写） */
  function gbLower(text) {
    return String(text == null ? '' : text).toLowerCase();
  }

  /** text 是否命中 list 中任意一个关键词（大小写不敏感） */
  function gbHasAny(text, list) {
    var s = gbLower(text);
    for (var i = 0; i < list.length; i++) {
      var kw = gbLower(list[i]);
      if (kw && s.indexOf(kw) !== -1) { return true; }
    }
    return false;
  }

  /** 返回 list 中第一个命中的关键词（保持 list 顺序，便于稳定输出品牌名） */
  function gbFirstAny(text, list) {
    var s = gbLower(text);
    for (var i = 0; i < list.length; i++) {
      var kw = gbLower(list[i]);
      if (kw && s.indexOf(kw) !== -1) { return list[i]; }
    }
    return null;
  }

  /** 严格数值转换：非数字 / 空串 / 非有限值一律 NaN（禁止 Number(null) 悄悄变 0） */
  function gbToNum(v) {
    if (typeof v === 'number') { return isFinite(v) ? v : NaN; }
    if (typeof v === 'string' && v.replace(/\s/g, '') !== '') {
      var n = Number(v);
      return isFinite(n) ? n : NaN;
    }
    return NaN;
  }

  /** 数字后面的量词是否表示「非金额」 */
  function gbIsCountUnit(rest) {
    for (var i = 0; i < NON_AMOUNT_UNIT.length; i++) {
      if (rest.indexOf(NON_AMOUNT_UNIT[i]) === 0) { return true; }
    }
    return false;
  }

  /**
   * 从文本里抽金额候选：跳过「3 个人」「10 月 26 日」「2 份」这类非金额数字。
   * 只返回 > 0 的数值，顺序与出现顺序一致。
   * @param {string} raw
   * @return {Array<number>}
   */
  function gbAmounts(raw) {
    var out = [];
    var s = String(raw == null ? '' : raw);
    var re = /(\d+(?:\.\d+)?)/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      var rest = s.slice(re.lastIndex).replace(/^\s+/, '');
      if (gbIsCountUnit(rest)) { continue; }
      var v = Number(m[1]);
      if (isFinite(v) && v > 0) { out.push(v); }
    }
    return out;
  }

  /**
   * 抽取人数：优先「N 人 / N 个人 / N 位」，其次「两人 / 三个人」，
   * 都没有时若命中多人信号词则保守按 2 人算；仍无则 null。
   * @param {string} raw
   * @return {?number}
   */
  function gbPeople(raw) {
    var s = String(raw == null ? '' : raw);
    var m = s.match(/(\d{1,2})\s*(?:个)?\s*(?:人|位)/);
    if (m) {
      var n = Number(m[1]);
      if (n >= 1 && n <= 50) { return n; }
    }
    m = s.match(/([两二三四五六七八九十])\s*(?:个)?\s*(?:人|位)/);
    if (m) {
      var cn = CN_NUM[m[1]];
      if (cn && cn >= 1) { return cn; }
    }
    if (gbHasAny(s, MULTI_KW)) { return 2; }
    return null;
  }

  /**
   * 判定单人 / 多人：单人信号词优先（「我自己一个人去」），其次多人信号词，
   * 再其次按人数推断。
   * @param {string} raw
   * @param {?number} people
   * @return {string} 'single' | 'multi' | 'unknown'
   */
  function gbParty(raw, people) {
    if (gbHasAny(raw, SINGLE_KW)) { return 'single'; }
    if (gbHasAny(raw, MULTI_KW)) { return 'multi'; }
    if (people !== null && people >= 2) { return 'multi'; }
    if (people === 1) { return 'single'; }
    return 'unknown';
  }

  /**
   * 判定「是在计划去做」而不是「在记账」。
   * 关键门控：句子里有金额且句子很短（如「火锅 80」「奶茶 18」）视为纯记账，
   * 一定返回 false —— 记账优先级高于建议，绝不能被团购卡抢走。
   * @param {string} raw
   * @param {Array<number>} amounts gbAmounts(raw) 的结果
   * @return {boolean}
   */
  function gbPlanning(raw, amounts) {
    var s = String(raw == null ? '' : raw);
    if (CANCEL_PAT.test(s)) { return false; }
    /* 过去场景（昨天 / 上周 / 上次…）是回述已发生的事，不算「打算去」 */
    if (gbHasAny(s, PAST_KW)) { return false; }
    if (!gbHasAny(s, PLANNING_KW)) { return false; }
    var compact = s.replace(/\s+/g, '');
    if (amounts.length > 0 && compact.length <= 12) { return false; }
    return true;
  }

  /**
   * 团购场景识别：校外餐饮 / 娱乐 + 「打算去做」才算命中。
   * @param {string} text 用户原始输入
   * @return {{hit:boolean, kind:?string, party:string, people:?number,
   *           planning:boolean, brand:?string, amounts:Array<number>}}
   *   hit      是否命中团购场景（kind 非空 且 planning 为真；校内 / 过去场景强制 false）
   *   kind     'food'（校外餐饮，含品牌）| 'fun'（娱乐）| null
   *   party    'single' | 'multi' | 'unknown'
   *   people   人数（推断值），无法判断为 null
   *   planning 是否表示「要去 / 打算去」
   *   brand    命中的餐饮品牌名，未命中为 null
   *   amounts  句子里的金额候选（已剔除人数 / 日期 / 份数）
   */
  function detectGroupBuy(text) {
    var raw = String(text == null ? '' : text).trim();
    var result = {
      hit: false,
      kind: null,
      party: 'unknown',
      people: null,
      planning: false,
      brand: null,
      amounts: []
    };
    if (!raw) { return result; }

    result.amounts = gbAmounts(raw);
    result.kind = gbHasAny(raw, FOOD_KW) ? 'food' : (gbHasAny(raw, FUN_KW) ? 'fun' : null);
    result.brand = gbFirstAny(raw, GB_BRANDS);
    result.people = gbPeople(raw);
    result.party = gbParty(raw, result.people);
    result.planning = gbPlanning(raw, result.amounts);
    /* 命中校内场景（食堂 / 饭堂 / 宿舍 / 学校…）或过去场景（昨天 / 上周 / 上次…）
     * 一律不算团购场景：「我要吃食堂」「昨天去吃火锅」不推，「我要吃海底捞」
     * 「明天去吃火锅」照推。 */
    result.hit = (result.kind !== null) && (result.planning === true) &&
      !gbHasAny(raw, CAMPUS_KW) && !gbHasAny(raw, PAST_KW);
    return result;
  }

  /**
   * 团购后人均差价：(原价合计 - 团购价) / 人数，保留 1 位小数。
   * @param {number} originalTotal 原价合计
   * @param {number} groupTotal    团购价合计
   * @param {number} people        人数
   * @return {?number} 人均省下的钱；入参非法或人数 < 1 返回 null
   */
  function perPersonSaving(originalTotal, groupTotal, people) {
    var orig = gbToNum(originalTotal);
    var group = gbToNum(groupTotal);
    var n = gbToNum(people);
    if (isNaN(orig) || isNaN(group) || isNaN(n)) { return null; }
    if (n < 1) { return null; }
    var saving = (orig - group) / n;
    if (!isFinite(saving)) { return null; }
    return Math.round(saving * 10) / 10;
  }

  /** 极简 HTML 转义（品牌名虽然来自内部白名单，仍统一转义，避免将来改成用户输入时漏防） */
  function gbEsc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 生成「团购先搜券」卡片 HTML（与 saveMoneyAnswer 同一套 coach-qa-* 样式）。
   * @param {Object} ctx detectGroupBuy(text) 的返回对象
   * @return {string} HTML
   */
  function groupBuyAdvice(ctx) {
    var c = ctx || {};
    var isFun = (c.kind === 'fun');
    var party = (c.party === 'single' || c.party === 'multi') ? c.party : 'unknown';
    var people = (typeof c.people === 'number' && c.people >= 1) ? Math.floor(c.people) : null;
    var amounts = (c.amounts && c.amounts.length) ? c.amounts.slice() : [];
    var brand = (typeof c.brand === 'string' && c.brand) ? c.brand : null;

    var scene = isFun ? 'KTV / 剧本杀 / 电影' : '校外吃饭';
    var singleWord = isFun ? '单人畅玩' : '单人套餐';
    var multiWord = isFun ? '双人套餐 / 多人套餐' : '双人餐 / 多人餐';

    var html = '' +
      '<div class="coach-qa-title">' + ic('ticket', 'bico-brand', '团购') +
      '省钱助手 · 团购先搜券' +
      (brand && !isFun ? '（' + gbEsc(brand) + '）' : '') + '</div>' +
      '<ol class="coach-qa-list">';

    /* 规则 1（永远出现）：几个人去都要先搜券 */
    html += '<li><b>几个人去都先搜券</b>：' + scene + '下单前先在<b>美团 / 抖音</b>搜「<b>' +
      singleWord + '</b>」或「<b>代金券</b>」再下单，别到店按原价点。' +
      (party === 'single' ? '一个人去也有单人券，团购不是两个人的专利。' : '') + '</li>';

    /* 规则 2（仅多人）：双人餐 / 多人餐 + 人均差价 */
    if (party === 'multi') {
      var saveLine = '';
      if (amounts.length >= 2) {
        var sorted = amounts.slice().sort(function (a, b) { return b - a; });
        var origTotal = sorted[0];
        var groupTotal = sorted[1];
        var ppl = (people !== null) ? people : 2;
        var saving = perPersonSaving(origTotal, groupTotal, ppl);
        if (saving !== null && saving > 0) {
          saveLine = '按你提到的数算：原价合计 ' + fmt1(origTotal) + ' 元、团购价 ' +
            fmt1(groupTotal) + ' 元，' + ppl + ' 人一起去，<b>团购后人均能省 ' +
            fmt1(saving) + ' 元</b>。';
        }
      }
      if (!saveLine) {
        saveLine = isFun
          ? 'KTV / 剧本杀原价人均约 60-80，团购人均约 40-55，一般人均能省 15-25 元。'
          : '火锅 / 烤肉类原价人均约 80，团购人均约 55，一般人均能省 20-30 元。';
      }
      html += '<li><b>多人搜「' + multiWord + '」</b>：' +
        ((people !== null && people >= 3) ? '你们 ' + people + ' 人，' : '你们几位，') +
        '在美团 / 抖音搜「<b>' + multiWord + '</b>」，' + saveLine + '</li>';
    }

    /* 规则 3（永远出现）：代金券不限人数 */
    html += '<li><b>代金券通常不限人数</b>：只要结账金额达标，不管几个人去都能直接抵扣，' +
      '人多人少都不亏，付款前记得先验券。</li>';

    /* 背景说明：团购的本质 + 团购比会员日香 */
    html += '</ol><div class="coach-qa-foot">' +
      '团购不是低配：美团 / 抖音 / 大众点评的「团购」，本质是商家为了线上引流打的特价套餐。' +
      '<b>团购比会员日香</b>——肯德基疯狂星期四只是会员日，但肯德基在美团 / 抖音常年有' +
      '「19.9 元双人餐」甚至「9.9 元汉堡 + 可乐」的团购券，买了券周几去吃都行，完全不用死等周四。' +
      '</div>';

    return html;
  }

  /**
   * 团购规则文案单一数据源。
   * 聊天气泡（groupBuyAnswer）与理财专家面板（groupBuyPanelHtml）共用同一份文案，
   * 避免同一套规则在两处出现措辞漂移：
   *   chat  聊天气泡里的小标题（口语化、带情绪）
   *   panel 专家面板里的小标题（精简、标签化）
   *   body  两条路径共用的正文
   */
  var GB_RULES = {
    solo: {
      chat: '单人也有券',
      panel: '先搜券',
      body: '哪怕自己去，也先上美团 / 抖音搜「单人套餐」或「代金券」再下单'
    },
    multi: {
      chat: '多人搜套餐',
      panel: '多人搜「双人餐 / 多人餐」',
      body: '舍友聚餐搜「双人餐 / 多人餐」，火锅烧烤团购后人均一般能省 20-30 元'
    },
    voucher: {
      chat: '代金券不限人数',
      panel: '代金券不限人数',
      body: '只要结账金额达标就能抵扣，跟几个人去没关系'
    },
    member: {
      chat: '团购比会员日香',
      panel: '团购比会员日香',
      body: '肯德基疯狂星期四只是会员日，美团 / 抖音常年有 19.9 元双人餐、' +
        '9.9 元汉堡 + 可乐，买了券周几去吃都行'
    }
  };

  /** 团购「本质」说明：聊天用长句（含平台名），面板用短句（省空间） */
  var GB_ESSENCE = {
    chat: '团购＝美团 / 抖音 / 大众点评上商家为线上引流打的特价套餐，' +
      '先搜券再点单，一年能省出好几顿饭。',
    panel: '团购本质是商家线上引流的特价套餐，比会员日灵活：券随时买，周几去都能用。'
  };

  /** 面板里按顺序展示的三条规则（第 4 条「团购比会员日香」已并入 GB_ESSENCE.panel） */
  var GB_PANEL_ORDER = ['solo', 'multi', 'voucher'];

  /**
   * 「怎么省钱」指南里的团购精简版块（静态文案，无场景参数）。
   * @return {string} HTML
   */
  function groupBuyAnswer() {
    var html = '' +
      '<div class="coach-qa-title">' + ic('ticket', 'bico-brand', '团购') +
      '省钱助手 · 校外吃玩先搜团购</div>' +
      '<ol class="coach-qa-list">';
    var keys = GB_PANEL_ORDER.concat(['member']);
    for (var i = 0; i < keys.length; i++) {
      var r = GB_RULES[keys[i]];
      html += '<li><b>' + r.chat + '</b>：' + r.body + '</li>';
    }
    html += '</ol>' +
      '<div class="coach-qa-foot">' + GB_ESSENCE.chat + '</div>';
    return html;
  }

  /**
   * 理财专家面板「团购省钱」卡片正文（不含 card / card-head，只填 #groupBuyBody）。
   * 三条规则的精简版 + 一句团购本质 + 「在聊天里问我怎么省」按钮；
   * 按钮点击由 app.js 用事件委托绑定，节点重建后依然有效。
   * @return {string} HTML
   */
  function groupBuyPanelHtml() {
    var html = '' +
      '<p class="gb-lead">' + ic('ticket', 'bico-brand', '团购') +
      '校外吃玩（火锅 / 烧烤 / KTV / 剧本杀）先在美团、抖音搜团购券再下单。</p>' +
      '<ul class="gb-rules">';
    for (var i = 0; i < GB_PANEL_ORDER.length; i++) {
      var r = GB_RULES[GB_PANEL_ORDER[i]];
      html += '<li><b>' + r.panel + '</b><span>' + r.body + '</span></li>';
    }
    html += '</ul>' +
      '<p class="gb-note">' + GB_ESSENCE.panel + '</p>' +
      '<div class="gb-actions">' +
      '<button class="btn-mini" id="btnGroupBuyAsk" type="button">在聊天里问我怎么省</button>' +
      '</div>';
    return html;
  }

  function makeMoneyAnswer() {
    return '' +
      '<div class="coach-qa-title">' + ic('wallet', 'bico-brand', '搞钱路子') + '理财专家说 · 校园搞钱路子</div>' +
      '<ol class="coach-qa-list">' +
      '<li><b>勤工俭学</b>：图书馆助理 / 实验室值班 / 助教，时薪 15-25，稳定靠谱</li>' +
      '<li><b>技能变现</b>：PPT 代做、约拍、家教，校园群 / 闲鱼接单，一单 50-300</li>' +
      '<li><b>闲置回血</b>：教材、电子产品、用不上的会员挂闲鱼，毕业季集中清</li>' +
      '<li><b>奖学金</b>：国奖 8000、校奖 1000-3000，性价比最高的「赚钱」</li>' +
      '<li><b>竞赛奖金</b>：创新创业 / 程序设计大赛，拿钱同时给简历加分</li>' +
      '</ol>' +
      '<div class="coach-qa-foot warn">' + ic('alert', 'bico-warn', '防骗提醒') + '先交钱的兼职都是骗子，天上不会掉馅饼。</div>';
  }

  /* ================================================================== */
  /* 三、剁手冷静法（想买 XX 时引导）                                      */
  /* ================================================================== */

  /**
   * 识别「想买 XX」意图。
   * 注意：只匹配「想 / 打算 / 准备 买」这类购买意图，不匹配「买了」（已消费，应正常记账）。
   * @return {?{item:string, price:number}}
   */
  function isWantBuy(text) {
    var raw = String(text || '').trim();
    if (!raw) { return null; }
    // 负向意图（不想买了 / 别买 / 没想买）不触发
    if (/(不|别|没|甭|何必)(好想|想要|很想|想|买)/.test(raw)) { return null; }
    // 已完成的购买描述（含金额 + 买了/花了/充值等）-> 交给正常记账，不拦截
    if (/\d/.test(raw) && /(买了|花了|付了|充值|已购|剁手了|下单了|入手了)/.test(raw)) { return null; }

    // 强意图：句首的「我想买 / 好想买 / 打算买 / 准备买…」（避免把「心情不好想买的」这类
    // 已消费描述误判为购买意图）；弱意图：句中「心痒 / 长草 / 看中」。
    var strong = /^(?:我|俺|咱)?\s*(?:好想|很想要?|超想|想|想要|打算|准备|计划)\s*(?:买|购入|入手|下单)/;
    var weak = /(心痒|长草|看中了?)/;
    if (!strong.test(raw) && !weak.test(raw)) { return null; }

    // 金额：优先带货币单位 / 「左右」的数字，其次末尾裸数字
    var price = 0;
    var pm = raw.match(/(\d+(?:\.\d+)?)\s*(?:元|块|圆|rmb|¥|左右|上下|前后)/i) ||
      raw.match(/(\d+(?:\.\d+)?)\s*$/);
    if (pm) { price = Number(pm[1]) || 0; }

    // 商品名：剥离意图动词、量词、金额与口语词
    var item = raw
      .replace(/^(我|俺|咱)?\s*(好想|想要|很想|想|打算|准备|计划)/, '')
      .replace(/(看中了|心痒了?|长草了?)/, '')
      .replace(/^(看到|看见|瞧见|发现|觉得|感觉)/, '')
      .replace(/(买|购入|入手|下单)/g, ' ')
      .replace(/\d+(?:\.\d+)?\s*(?:元|块|圆|rmb|¥)/gi, ' ')
      .replace(/\d+(?:\.\d+)?\s*(左右|上下|前后)/g, ' ')
      .replace(/\s*\d+(?:\.\d+)?\s*$/, ' ')
      .replace(/(大概|大约|左右|差不多)/g, ' ')
      .replace(/^\s*(那个|这个|一个|一件|一台|一部|一双|一款|个|台|部|双|件|款)/, ' ')
      .replace(/[，。！？!?,~～、\s]+/g, ' ')
      .trim();

    if (!item) { return null; }
    if (item.length > 16) { item = item.slice(0, 16); }
    return { item: item, price: price };
  }

  /** 剁手冷静法三步问题定义 */
  var COOLING_STEPS = [
    {
      key: 'reason',
      q: '第 1 问 · 买它的核心原因是？',
      options: [
        { val: 'need', label: '真的需要' },
        { val: 'want', label: '就是想要' },
        { val: 'mood', label: '犒劳自己' },
        { val: 'follow', label: '别人有我也要' }
      ]
    },
    {
      key: 'freq',
      q: '第 2 问 · 买来后使用频率？',
      options: [
        { val: 'often', label: '每周都用' },
        { val: 'sometimes', label: '偶尔用用' },
        { val: 'dust', label: '说不定吃灰' }
      ]
    },
    {
      key: 'pressure',
      q: '第 3 问 · 这笔钱对你来说？',
      options: [
        { val: 'easy', label: '轻松拿下' },
        { val: 'think', label: '要掂量一下' },
        { val: 'hard', label: '咬牙 / 分期' }
      ]
    }
  ];

  /** 三步问答结论 */
  function coolingVerdict(answers) {
    var score = 0;
    var map = {
      need: 2, want: 1, mood: 0, follow: 0,
      often: 2, sometimes: 1, dust: 0,
      easy: 2, think: 1, hard: 0
    };
    for (var i = 0; i < answers.length; i++) {
      score += (map[answers[i]] || 0);
    }
    if (score >= 5) {
      return {
        level: 'ok',
        icon: 'check',
        title: '可以买',
        text: '刚需、高频、无压力，下单前记得比价，学生优惠 / 教育资格能用就用。'
      };
    }
    if (score >= 3) {
      return {
        level: 'warn',
        icon: 'alert',
        title: '建议晾 48 小时',
        text: '先加进购物车，两天后还想要，再来找我，我帮你记上这笔。'
      };
    }
    return {
      level: 'stop',
      icon: 'stop',
      title: '建议先不买',
      text: '多半是情绪 / 从众冲动。先去做别的事转移注意力，真需要了再说。'
    };
  }

  /* ================================================================== */
  /* 四、理财学院（静态知识卡）                                            */
  /* ================================================================== */

  var ACADEMY = [
    {
      id: 'cooldown',
      icon: 'clock',
      title: '剁手冷静法：48 小时法则',
      tag: '冲动消费',
      body: '想买的东西先加购物车，晾满 48 小时再决定。\n' +
        '· 80% 的冲动两天后自动消退；\n' +
        '· 仍想要的，写清「买它的核心原因」再下单；\n' +
        '· 单笔超过 50 元自动触发冷静期提醒。',
      detail: [
        { h: '一句话原理', p: '给每一笔非必需消费强行插入两天的等待期：把「我想要」和「我需要」隔开，让情绪先退潮，理性再上场。' },
        { h: '怎么走完这 48 小时', steps: [
          '加购物车、不结算，顺手记下价格和「我现在为什么想买」；',
          '定一个 48 小时后的提醒（手机日历即可）；',
          '两天后回看：还想要 → 写清「买它的核心原因」，能写出一条再买，写不出就删；',
          '删掉的那笔，把等价金额转进梦想基金——省下的钱要看得见才算省。'
        ] },
        { h: '这些信号多半是冲动', list: [
          '主播喊「最后 X 件」「X 分钟后恢复原价」；',
          '刷到别人买了，所以自己也想要；',
          '刚吵完架 / 考砸了 / 深夜 emo 时的「奖励自己」；',
          '为了凑满减而临时起意的加购。'
        ] },
        { h: '能省多少', p: '学生党每月平均能拦下 2-3 笔 50 元上下的冲动单，一学期就是 300-500 元，够一双跑鞋。' },
        { h: '本应用联动', p: '记一笔时单笔超 50 元会自动触发冷静期提醒；打了「情绪消费」标签的账单，会在账单分析里单独统计。' }
      ]
    },
    {
      id: 'latte',
      icon: 'cat-food',
      title: '拿铁因子：小钱也是钱',
      tag: '日常开销',
      body: '每天一杯 15 元奶茶，一年约 5475 元，够换一台平板。\n' +
        '· 改自泡茶包（2 元）或食堂现磨（6-10 元）；\n' +
        '· 不是不能喝，而是把「下意识买」变成「主动选择」。',
      detail: [
        { h: '什么是拿铁因子', p: '那些单笔不起眼、但天天发生的习惯性小额支出——奶茶、咖啡、打车、忘了关的自动续费。单独看都不贵，加起来是一台平板。' },
        { h: '先看清自己的「因子」', list: [
          '15 元奶茶 × 每周 5 杯 × 40 周 ≈ 3000 元/年；',
          '每天一包 8 元的小零食，一学期 ≈ 900 元；',
          '三个忘了关的自动续费会员，一年 ≈ 300 元。'
        ] },
        { h: '三步替换法', steps: [
          '打开账单分析，圈出连续 3 天以上都出现的小额支出；',
          '挑最没感觉的一项换掉：奶茶 → 自泡茶包 / 食堂现磨，打车 → 骑行 / 步行；',
          '每省下一笔就当日转进梦想基金，看得见的钱才守得住。'
        ] },
        { h: '关键心态', p: '不是戒掉，而是把「下意识买」变成「主动选择」。一周给自己留 1-2 次「快乐额度」，反而更容易长期坚持。' }
      ]
    },
    {
      id: 'engel',
      icon: 'split',
      title: '恩格尔系数：吃饭钱别超 60%',
      tag: '餐饮',
      body: '餐饮支出 ÷ 总支出超过 60%，说明吃占了大头。\n' +
        '· 健康线 50%-59%，超过就要警惕；\n' +
        '· 外卖 28 元 ≈ 食堂两荤一素 12 元，一周差出 48 元；\n' +
        '· 省下的不是饭钱，是资料费、考证费和旅行基金。',
      detail: [
        { h: '这个系数怎么算', p: '恩格尔系数 = 餐饮支出 ÷ 总支出。它原本衡量家庭贫富，放到生活费上同样好使：吃饭占比越高，能自由支配的钱越少。' },
        { h: '对照健康线', list: [
          '40% 以下：吃得很从容，保持；',
          '40%-59%：正常区间，注意别再涨；',
          '60% 以上：吃占了大头，该调整结构了。'
        ] },
        { h: '降下来的三步', steps: [
          '在账单分析里看本月餐饮占比和 Top 大额；',
          '找出最贵的 3 笔，问一句「这顿能不能换食堂」；',
          '定个小目标：下个月降 5 个百分点，省下的钱转学习资料或旅行基金。'
        ] },
        { h: '算笔账', p: '外卖均价 28 元 ≈ 食堂两荤一素 12 元。一周少点 3 次外卖省 48 元，一学期 ≈ 900 元——省下的不是饭钱，是资料费、考证费和旅行基金。' }
      ]
    },
    {
      id: 'infodiff',
      icon: 'radar',
      title: '省钱信息差：先看别人怎么省',
      tag: '节流实操',
      body: '同一样东西有人 39 买、有人 89 买，差的往往不是钱，是信息。\n' +
        '· 下单前先搜「关键词 + 省钱 / 测评 / 平替」，看别人踩过的坑；\n' +
        '· 大促前先收藏原价，别被先涨后降的假折扣骗；\n' +
        '· 信息差是零成本的：花 5 分钟搜索，常能省下一顿饭钱。',
      detail: [
        { h: '为什么有信息差', p: '同一件东西有人 39 拿下、有人 89 原价买，差的往往不是砍价能力，而是「知不知道有更便宜的渠道」。信息差是零成本的，花 5 分钟搜索常省一顿饭钱。' },
        { h: '下单前 5 分钟检查流程', steps: [
          '搜「商品名 + 测评 / 平替」，看有没有更便宜的替代款；',
          '查历史价（慢慢买、什么值得买），防「先涨后降」的假折扣；',
          '搜「平台名 + 学生 / 优惠券 / 红包」，学生认证、百亿补贴、团购券挨个过一遍；',
          '大促前先收藏原价，到手价对比再付钱。'
        ] },
        { h: '常用信息差渠道', list: [
          '拼多多 / 京东 / 淘宝的「百亿补贴」入口（认准官方标）；',
          '美团 / 抖音团购券：吃喝玩乐先搜券再下单；',
          '闲鱼「代下单」：咖啡、快递、电影票常有半价（走平台担保）；',
          '学生认证：视频音乐会员半价、打车软件送券。'
        ] },
        { h: '记住', p: '信息差会过期：攻略看发布日期，上个月的优惠这个月可能就没了。' }
      ],
      resources: [{
        type: 'copy',
        label: '红米鸡（抖音省钱博主）',
        desc: '没有固定主页链接，复制博主名去抖音搜索，看她日常怎么挑便宜货。',
        copy: '红米鸡'
      }]
    },
    {
      id: 'bloggers',
      icon: 'link',
      title: '跟着博主学省钱（B 站）',
      tag: '跟人学',
      body: '省钱干货更新最快的地方在博主主页，不在文章里：\n' +
        '· 信息差是即时更新的：这个月的奶茶价、这季度的打车券，上个月的攻略早就过期；\n' +
        '· 看真实操作比看结论有用：同一件商品怎么比价、怎么凑单，跟着点一遍就会；\n' +
        '· 关注 1-2 个就够，别刷成娱乐——看它是为了省钱，不是为了多一个刷手机的理由。',
      detail: [
        { h: '为什么看博主', p: '省钱攻略的「保鲜期」很短——这个月的奶茶券、这季度的打车补贴，上个月的教程早就失效。博主主页是少数持续更新的信息源，看真实操作也比看结论有用：同一件商品怎么比价、怎么凑单，跟着点一遍就会。' },
        { h: '这样学不跑偏', steps: [
          '先看播放量最高的入门合集，把基本概念过一遍；',
          '每学一招当天试一条，用不上的直接跳过；',
          '关注 1-2 个就够，给自己定「观看预算」：每周不超过 30 分钟。'
        ] },
        { h: '两位入门推荐（下方可直达主页）', p: '天月遥——极简省钱、消费主义祛魅，适合先建立整体框架；先天省钱圣体——薅羊毛信息差多、更新勤，适合查具体品类怎么买便宜。' },
        { h: '提醒', p: '看博主是为了省钱，不是为了多一个刷手机的理由；UP 主观点仅供参考，不构成投资建议。' }
      ],
      resources: [{
        type: 'up',
        label: '天月遥',
        desc: '消费主义克星 · 极简省钱｜《生活费不够花？给学生党的 10 条省钱建议》',
        url: 'https://m.bilibili.com/space/1023335019',
        meta: ['B 站 UP 主', '免费', '每周 ≤30 分钟'],
        detail: [
          { h: '这位 UP 主是谁', p: '做极简生活和消费主义祛魅的博主，内容偏「为什么不该买」，而不是「怎么买更便宜」。适合先建立整体框架的人——想清楚要什么，比学一百个省钱技巧更省。' },
          { h: '先看哪几条', list: [
            '《生活费不够花？给学生党的 10 条省钱建议》——入门首选，逐条对照自己能落几条；',
            '「消费主义套路」系列——看懂「限时折扣 / 第二件半价」是怎么设计你的；',
            '日常 vlog 里的记账片段——看她怎么给一笔支出分类，比听道理有用。'
          ] },
          { h: '怎么看不变成刷手机', steps: [
            '先定观看预算：每周不超过 30 分钟，超了就停；',
            '只挑标题里带「建议 / 方法 / 套路」的，纯日常 vlog 可以不看；',
            '看到想试的一条，当天在本应用里记一笔并打「值不值」标签，形成闭环。'
          ] },
          { h: '注意', p: 'UP 主也接广告，出现具体产品推荐时按广告看待；观点仅供参考，不构成投资建议。' }
        ]
      }, {
        type: 'up',
        label: '先天省钱圣体',
        desc: '19 万粉 · 极实操的薅羊毛信息差｜1.5 元喝奶茶、30 元以内半价、拼多多与打车省钱',
        url: 'https://m.bilibili.com/space/366581522',
        meta: ['B 站 UP 主', '免费', '按需查，不必追更'],
        detail: [
          { h: '这位 UP 主是谁', p: '主打「信息差 + 具体操作」：某个平台这一期有什么券、怎么凑单到最低、打车怎么叠优惠。更新快、时效性强，属于工具型账号。' },
          { h: '什么时候来找它', list: [
            '准备买一件具体的东西（耳机、球鞋、教材）之前，先搜它的对应品类视频；',
            '月底想吃顿好的但预算紧，找团购 / 券的当期视频；',
            '开学季、双 11 这种大促节点，看它的「避坑 + 凑单」总结。'
          ] },
          { h: '怎么用不踩坑', steps: [
            '先看发布日期：超过两个月的优惠基本已失效，别照着抄；',
            '认准官方入口（百亿补贴、平台券中心），UP 主给的第三方链接要多看一眼域名；',
            '别为了用券买不需要的东西——省 20 元花 80 元，是负收益。'
          ] },
          { h: '一条底线', p: '任何要求你先付「押金 / 会员费 / 拉人头」才能享受的优惠，直接跳过；真优惠不需要你先掏钱。' }
        ]
      }],
      resNote: '主页会持续更新，建议先看播放量高的入门合集再刷日常；UP 主观点不代表本应用立场，不构成投资建议。'
    },
    {
      id: 'budget',
      icon: 'bar',
      title: '50/30/20 预算法（学生版）',
      tag: '预算',
      body: '把每月生活费切成三份：\n' +
        '· 50% 必要开销：吃饭、交通、话费、学习资料；\n' +
        '· 30% 想要开销：聚餐、娱乐、服饰，可弹性压缩；\n' +
        '· 20% 储蓄与目标：梦想基金、应急金，发钱日先转走。',
      detail: [
        { h: '这个比例在做什么', p: '50/30/20 是给生活费搭骨架：50% 给「必须花的」，30% 给「想花的」，20% 强制存下来。比例不必精确，重点是「先储蓄、后消费」的顺序。' },
        { h: '以 2000 元生活费为例', steps: [
          '必要开销 1000：食堂、话费、通勤、学习资料；',
          '想要开销 600：聚餐、奶茶、娱乐、服饰；',
          '储蓄 400：发生活费当天先转进梦想基金，剩下的才拿来花；',
          '月底想要类超支？从下月额度里扣，绝不动储蓄那 400。'
        ] },
        { h: '容易分错类的', list: [
          '学习资料是「必要」，但囤课囤书是「想要」；',
          '奶茶是「想要」，哪怕天天喝也不升级成「必要」；',
          '突发医疗是「必要」，临时起意的旅行是「想要」。'
        ] },
        { h: '生活费紧张时', p: '改成 60/30/10 也行，储蓄比例可以小，但不能是 0——哪怕每月 50 元，习惯比金额重要。' }
      ]
    },
    {
      id: 'invest',
      icon: 'wallet',
      title: '零花钱理财第一课',
      tag: '理财入门',
      body: '学生理财从「不亏」开始，不追高、不碰不懂的：\n' +
        '· 先攒 3 个月生活费做应急金（货币基金 / 活期）；\n' +
        '· 再用闲钱做小额定投宽基指数，练心态不看短期涨跌；\n' +
        '· 收益率再香也先问自己：能放多久、亏 20% 慌不慌。',
      detail: [
        { h: '学生理财的目标', p: '不是赚钱，是先用小钱把习惯和心态练出来。顺序永远是：先兜底，再增值。' },
        { h: '三步走', steps: [
          '攒应急金：3 个月生活费，放货币基金或活期，随取随用——这是理财的地基；',
          '小额定投宽基指数：每周或每月固定小额（比如 50-200 元），固定日期自动扣款，不择时不盯盘；',
          '练心态：亏 10% 不慌着卖、赚 20% 不急着加码，把「能放多久、亏 20% 慌不慌」当入场前自测题。'
        ] },
        { h: '学生理财红线', list: [
          '不借钱理财、不用生活费加仓；',
          '不碰杠杆、合约、山寨币和一切「稳赚不赔」；',
          '不懂的不买——看不懂的产品，拒绝就是最好的收益。'
        ] },
        { h: '算笔账', p: '每月定投 200，四年本金 9600，按年化 3%-5% 估算收益约 600-900 元。数字不大，但毕业时你已拥有完整的投资纪律——这才是最值钱的部分。' }
      ],
      resources: [{
        type: 'video',
        label: '大学生理财扫盲（不推基金）',
        desc: '给大学生做金融祛魅，不推基金不割韭菜，先建立正确的金钱观。',
        url: 'https://www.snm0516.aisee.tv/video/BV1tj6wBDEXF/',
        meta: ['视频课', '免费', '建议一次留 40 分钟'],
        detail: [
          { h: '这节课在讲什么', p: '不是教你买什么，而是把「理财」这件事去魅：钱从哪来、花到哪去、哪些产品是在收智商税。看完你不会立刻变富，但会知道自己现在最该干的是攒应急金，而不是急着开户。' },
          { h: '为什么先看它', p: '大部分学生第一次接触理财就是被推荐基金 / 币圈，顺序反了。先把金钱观立住，再学工具，能少交很多学费——真金白银的那种。' },
          { h: '怎么用这 40 分钟', steps: [
            '找个不被打断的时间，一次看完，别开倍速——祛魅类内容跳过论证就只剩结论；',
            '边看边记「我原来以为…其实…」，看完能写出 3 条就算没白看；',
            '看到推荐具体产品的段落，直接跳过：这条视频的价值不在那儿。'
          ] },
          { h: '看完你应该能回答', list: [
            '为什么「稳赚不赔」这四个字本身就是风险信号；',
            '学生阶段最该先做的到底是攒钱、省钱还是投资；',
            '哪些「理财课」其实是在卖课、卖产品。'
          ] },
          { h: '一个提醒', p: '视频观点仅供参考，不构成投资建议；本应用不推荐任何具体产品，也不会代你下单。' }
        ]
      }, {
        type: 'video',
        label: '零基础理财入门课 · 第 1 集 + 第 5 集',
        desc: '全 20 集短课（每集 20-30 分钟），课堂时间有限，只看第 1 集打底 + 第 5 集实操。',
        url: 'https://www.snm0516.aisee.tv/video/BV1yAX5YQEAs/',
        meta: ['系列短课', '免费', '两集约 50 分钟'],
        detail: [
          { h: '为什么只挑两集', p: '整套 20 集、每集 20-30 分钟，全看完要十几个小时——大多数人的「学习计划」就死在这儿。第 1 集打底（概念框架），第 5 集上手（真实操作），两集就够你把最常用的那部分用起来。' },
          { h: '第 1 集：先建框架', list: [
            '搞清楚「资产 / 负债 / 现金流」这三个词分别对应你生活里的什么；',
            '分清「消费」和「投资」：买课囤书是消费，能带来现金流的才是投资；',
            '记住顺序：应急金 → 保障 → 再谈增值。'
          ] },
          { h: '第 5 集：直接抄操作', list: [
            '看它怎么开一个货币基金 / 定投计划，跟着点一遍（不必真投钱）；',
            '记下它的扣款日设置思路：发生活费后 1-2 天自动扣，比靠意志力靠谱；',
            '把「定投金额」换成你承受得起的数（50-200 元即可）。'
          ] },
          { h: '看完的标准', p: '能在本应用里给自己设一个「梦想基金」目标，并说清楚每月从哪笔钱里扣——这就够了，剩下的等你有闲钱再说。' }
        ]
      }],
      resNote: '资源为公开 B 站视频，经镜像站转发以保证课堂网络环境可播放；镜像不可用时可在 B 站搜索同名标题。'
    },
    {
      id: 'mooc',
      icon: 'cap',
      title: '中国大学 MOOC《个人理财》',
      tag: '系统学习',
      body: '想把理财学成体系，去跟一门完整课程：\n' +
        '· 官方课程页，含「流动性管理工具——货币市场基金」「基金定投」等章节；\n' +
        '· 先看这两节，能直接对上本页的应急金与定投建议；\n' +
        '· 免费旁听即可，不必为了证书花钱。',
      detail: [
        { h: '为什么跟课', p: '想把理财学成体系，跟一门大学正规课比自己刷短视频靠谱得多。《个人理财》是国家精品课程，免费旁听即可，不必花钱买证书。' },
        { h: '上手路径', steps: [
          '注册中国大学 MOOC，搜索「个人理财」进入课程页；',
          '点「免费旁听」（不用买认证）；',
          '优先看两章：「流动性管理工具——货币市场基金」对上应急金，「基金定投」对上定投计划；',
          '每周固定一个时段看，跟上课表更容易看完。'
        ] },
        { h: '学完你能回答', p: '应急金该放哪、定投到底投的是什么、一款理财产品合不合适自己怎么判断——这三个问题能答上来，就超过大多数同龄人了。' }
      ],
      resources: [{
        type: 'course',
        label: '中国大学 MOOC《个人理财》课程页',
        desc: '系统学习入口 · 含货币市场基金、基金定投等章节。',
        url: 'https://www.icourse163.org/course/detail.htm?cid=1207124806',
        meta: ['大学正规课', '免费旁听', '每周 1-2 小时'],
        detail: [
          { h: '这是什么课', p: '国家精品课程，讲的是个人 / 家庭层面的理财：流动性管理、基金、保险、税务基础。不是「教你暴富」那类内容，教材味重，但概念经得起推敲。' },
          { h: '为什么值得跟完', p: '短视频给你结论，课程给你推导过程。同样是「定投」，知道它为什么有效、什么情况下会失效，你才不会在跌 15% 的时候割在半山腰。' },
          { h: '上手四步', steps: [
            '注册中国大学 MOOC，搜「个人理财」进课程页；',
            '点「免费旁听」，不用买认证证书（证书对找工作几乎没用）；',
            '只挑两章先看：「流动性管理工具——货币市场基金」对上应急金，「基金定投」对上定投计划；',
            '固定每周一个时段（比如周日晚 1 小时），跟课表走比「有空再看」完成率高得多。'
          ] },
          { h: '不想学完也没关系', p: '这门课的性价比全在前两章：知道应急金该放哪、定投投的是什么，就已经比大多数同龄人清楚。剩下的章节当工具书，需要时再翻。' },
          { h: '学完你能回答', list: [
            '应急金该放货币基金还是活期，差在哪；',
            '定投到底投的是什么，为什么能摊平成本；',
            '一款理财产品合不合适自己，先看哪三个指标。'
          ] }
        ]
      }]
    },
    {
      id: 'loan',
      icon: 'alert',
      title: '警惕校园贷与超前消费',
      tag: '避坑',
      body: '凡是「零门槛、秒到账」的贷款都别碰：\n' +
        '· 真实年化往往超过 24%，违约金滚雪球；\n' +
        '· 分期买非必需品 = 给未来的自己加税；\n' +
        '· 实在紧张先找家人 / 学校勤工助学，别碰网贷。',
      detail: [
        { h: '它为什么危险', p: '校园贷的核心话术是「零门槛、秒到账」，但真正的成本藏在利率、手续费和违约金里。凡是放款前流程特别顺的，收钱时都不会客气。' },
        { h: '识别危险信号', list: [
          '「凭学生证 / 身份证就能借」「不用征信」；',
          '「日息万五」「一天只要几块钱」——换算年化约 18%，加上违约金更狠；',
          '「分期免息」却按月收手续费，实际年化常在 15% 上下；',
          '放款前先收「保证金 / 解冻费」的，是纯骗局。'
        ] },
        { h: '算笔账', p: '借 3000 元「日息 0.05%」看着一天 1.5 元，一年利息约 547 元，实际年化约 18%；一旦逾期，违约金按日滚，很容易失控。' },
        { h: '已经借了怎么办', steps: [
          '第一时间告诉家人或辅导员——这是解决成本最低的一步；',
          '翻出合同算实际年化利率，保留所有转账和聊天记录；',
          '绝不以贷养贷，也别找「反催收」中介（那是二次收割）；',
          '遇到暴力催收直接报警，法律保护你不被违法对待。'
        ] }
      ]
    },
    {
      id: 'resale',
      icon: 'swap',
      title: '闲置转让回血指南',
      tag: '搞钱',
      body: '宿舍里躺着的是钱，不是垃圾：\n' +
        '· 教材、辅导书毕业季最值钱，提前 1 个月挂闲鱼；\n' +
        '· 电子产品走平台验货，别线下先款后货；\n' +
        '· 会员时长、优惠券也能转让，积少成多。',
      detail: [
        { h: '先转变观念', p: '宿舍里躺着的是钱，不是垃圾。毕业季集中出一次闲置，回血几百到一千多很正常。' },
        { h: '出手四步', steps: [
          '拍照：实物图 + 细节图 + 瑕疵特写，瑕疵主动写明，避免售后扯皮；',
          '定价：搜同款成交价，急卖直接打 7 折，不急就挂 8 折慢慢等；',
          '挂闲鱼：标题写清「教材名 + 版本年份」或「型号 + 成色」，检索量翻倍；',
          '交易：小件走快递并在出库前拍视频，贵重走平台验货，面交选人多的地方。'
        ] },
        { h: '什么最好卖', list: [
          '教材辅导书：毕业季前 1 个月挂最值钱，考研考证资料常年有需求；',
          '数码产品：走官方验货宝，成色好基本秒出；',
          '会员时长、优惠券：低价转手，积少成多；',
          '全新未拆：留着占地方，转手几乎不亏。'
        ] },
        { h: '防坑', p: '别接受任何「先付款后发货」的私下交易；快递出库全程录像；验货宝多花的几块钱是买保障。' }
      ]
    },
    {
      id: 'work',
      icon: 'lock',
      title: '勤工俭学避坑指南',
      tag: '搞钱',
      body: '靠谱优先于钱多：\n' +
        '· 校内岗位（图书馆 / 实验室 / 助教）最稳，时薪 15-25；\n' +
        '· 家教、PPT 代做靠技能，接单先收定金；\n' +
        '· 刷单、跑分、出租账号 = 违法，给多少钱都不干。',
      detail: [
        { h: '一个原则', p: '靠谱优先于钱多：先校内后校外，先技能后体力。' },
        { h: '靠谱渠道排序', list: [
          '校内勤工助学岗：图书馆、实验室、助教，时薪 15-25，稳定且离宿舍近（去学工处登记）；',
          '家教：时薪 50-100，靠学业能力，先试讲一节再定长期；',
          '技能接单：PPT、海报、剪辑、翻译，按件计价，平台走担保。'
        ] },
        { h: '接单防坑', steps: [
          '任何要「先交押金 / 培训费 / 服装费」的兼职，直接拉黑；',
          '家教第一次上门带上同学，或提前告知室友定位；',
          '接单先收 30%-50% 定金，尾款不结不交源文件；',
          '口头承诺没用：工作量、价格、修改次数写进聊天记录。'
        ] },
        { h: '高压红线', p: '刷单、跑分、出租出借银行卡和支付账号 = 违法，可能留下案底影响考研考公——佣金再高也不碰。' }
      ]
    }
  ];

  /**
   * 学习资源的类型顺序：视频 → 课程 → UP 主主页。
   * 固定顺序是为了让看板卡与聊天气泡的「首屏内容」永远是 3 条视频 / 课程，
   * 后加入的 UP 主主页排在后面，不会把原有视频挤下去。
   */
  var LEARN_TYPE_ORDER = ['video', 'course', 'up'];

  /**
   * 聚合理财学院里所有可学习资源，供看板卡与聊天卡片共用（单一数据源，
   * 不复制任何链接，ACADEMY 内容变更后两处入口自动同步）。
   *   · 只收 type 为 video / course / up 且带合法 url 的条目（copy 型没有外链，
   *     放进来会渲染成点不动的空行，故跳过）；
   *   · 返回顺序固定为 video → course → up，同类型内保持 ACADEMY 顺序；
   *   · 每次调用返回全新数组与全新对象，外部修改不会污染 ACADEMY。
   * @return {Array<Object>} 每项 {lessonId, tag, icon, type, label, desc, url, copy}
   */
  function learningResources() {
    var out = [];
    for (var t = 0; t < LEARN_TYPE_ORDER.length; t++) {
      var want = LEARN_TYPE_ORDER[t];
      for (var i = 0; i < ACADEMY.length; i++) {
        var lesson = ACADEMY[i];
        if (!lesson || !lesson.resources || !lesson.resources.length) { continue; }
        for (var j = 0; j < lesson.resources.length; j++) {
          var r = lesson.resources[j];
          if (!r || !r.label) { continue; }
          var type = typeof r.type === 'string' ? r.type : '';
          if (type !== want) { continue; }
          if (typeof r.url !== 'string' || r.url === '') { continue; }
          out.push({
            lessonId: lesson.id || '',
            tag: lesson.tag || '',
            icon: lesson.icon || '',
            type: type,
            label: r.label,
            desc: r.desc || '',
            url: r.url,
            copy: typeof r.copy === 'string' ? r.copy : '',
            /* 详情弹窗用：meta 是顶部小标签数组，detail 是分节正文（与知识卡同结构） */
            meta: Array.isArray(r.meta) ? r.meta : [],
            detail: Array.isArray(r.detail) ? r.detail : []
          });
        }
      }
    }
    return out;
  }

  /* ================================================================== */
  /* 五、专属建议（基于账本数据动态生成）                                  */
  /* ================================================================== */

  /**
   * 根据账本数据生成 3-6 条专属建议。
   * @param {Object} state 应用状态（含 bills / budget / goals）
   * @param {Object} ov getOverview() 的结果
   * @return {Array<{level:string, icon:string, title:string, text:string}>}
   */
  function personalTips(state, ov) {
    var tips = [];
    if (!state || !ov) { return tips; }

    var bills = (state.bills || []).filter(function (b) {
      return b.type === 'expense' && b.date >= ov.cycle.start && b.date <= ov.cycle.end;
    });

    /* 1) 冲动消费扫描 */
    var impulse = bills.filter(function (b) {
      return b.motivation === '情绪' || b.want === true;
    });
    var impulseTotal = 0;
    impulse.forEach(function (b) { impulseTotal += b.amount; });
    if (impulse.length >= 2) {
      tips.push({
        level: 'warn',
        icon: 'stop',
        title: '本周期冲动消费 ' + impulse.length + ' 笔 · ' + fmtMoney(impulseTotal),
        text: '超过 2 笔就该上「剁手冷静法」了：加购物车晾 48 小时，大部分冲动会自动消退。'
      });
    }

    /* 2) 高溢价消费扫描（有平替的） */
    var hits = [];
    var weeklySave = 0;
    bills.forEach(function (b) {
      var alt = ENG.getAlternative(b);
      if (alt && alt.save > 0) {
        hits.push({ bill: b, alt: alt });
        weeklySave += alt.weeklySave;
      }
    });
    if (hits.length > 0) {
      var top = hits.slice().sort(function (a, b) { return b.alt.save - a.alt.save; })[0];
      tips.push({
        level: 'info',
        icon: 'cat-food',
        title: '发现 ' + hits.length + ' 笔高溢价消费',
        text: '全部换平替一周约省 ' + fmtMoney(weeklySave) + ' 元。最大一笔是「' +
          top.bill.note + '」，换成' + top.alt.altName + '立省 ' + fmtMoney(top.alt.save) + '。'
      });
    }

    /* 3) 恩格尔系数 */
    var engel = ov.engel || {};
    if (engel.ratio != null && engel.ratio > 0.6) {
      tips.push({
        level: 'warn',
        icon: 'pie',
        title: '恩格尔系数 ' + Math.round(engel.ratio * 100) + '% · 吃饭钱偏高',
        text: '外卖是主因：食堂两荤一素约 12 元，一周少点 3 次外卖，餐饮立省 50+。'
      });
    }

    /* 4) 储蓄率（getIncomeStats 返回百分数，如 25 表示 25%） */
    var rate = ov.incomeStats ? ov.incomeStats.savingsRate : null;
    if (rate != null && rate < 30) {
      tips.push({
        level: 'warn',
        icon: 'bar',
        title: '本周期储蓄率 ' + Math.round(rate) + '%',
        text: '健康线 30%。发钱日先转 10% 进梦想基金，剩下的再花，无痛攒钱。'
      });
    }

    /* 5) 应急金 */
    var balance = ov.incomeStats ? ov.incomeStats.balance : 0;
    if (balance < 500) {
      tips.push({
        level: 'info',
        icon: 'piggy',
        title: '先攒 500 元应急金',
        text: '手机碎屏、临时考证报名都靠它。每月存 100，5 个月就有了，再谈理财。'
      });
    }

    /* 6) 花钱速度 */
    var bs = ov.budgetState;
    var daysTotal = ov.cycle.totalDays || 30;
    var elapsed = ov.cycle.passedDays || Math.max(1, daysTotal - (ov.cycle.remainingDays || 0));
    var expected = state.budget.total * (elapsed / daysTotal);
    var spent = ov.cycleAgg ? ov.cycleAgg.expense : 0;
    if (spent > expected * 1.2 && spent > 0) {
      tips.push({
        level: 'warn',
        icon: 'clock',
        title: '花钱速度超前 ' + Math.round((spent / expected - 1) * 100) + '%',
        text: '按这个节奏月末要超支。接下来 ' + (ov.cycle.remainingDays || 0) + ' 天日均只花 ' +
          fmtMoney(bs.dailyAllowance) + '，先把外卖换成食堂。'
      });
    }

    /* 兜底：一切健康时也给一条正向建议 */
    if (tips.length === 0) {
      tips.push({
        level: 'ok',
        icon: 'alert',
        title: '本周期节奏健康',
        text: '支出、储蓄、冲动控制都在线。保持每周复盘，月底来查收成就。'
      });
    }

    return tips.slice(0, 6);
  }

  /**
   * 业务规则 5：每次记账回复都必须带一条「理财专家一句话建议」。
   * 地域绑定（业务规则 4）：优先使用《南海北区专属省钱平替库》里的点位与价格。
   * 即使这条账单没有命中平替，也必须给出兜底建议，保证「每次都有」。
   * @param {Object} bill
   * @param {?Object} ov  getOverview() 结果（用于给余额相关的兜底建议）
   * @return {string} ≤50 字
   */
  var CATEGORY_FALLBACK = {
    '餐饮': ['下一顿试试南海北区食堂一荤一素，11 元搞定。', '少点一顿外卖，一周能省 50+。'],
    '社交': ['AA 聚餐改之选 affordable：食堂二楼拼桌，人均 20 以内。', '份子钱先记下来，月底单独看这一项。'],
    '购物': ['日用品可以先去润泰超市（正门斜对面 150 米）比个价。', '不急的东西等拼多多百亿补贴，别在校内便利店买。'],
    '学习': ['打印去 17A / E2 / E3 的宿舍打印店，0.1 元/面。', '教材先看图书馆再看闲鱼，原价买最亏。'],
    '交通': ['短途共享单车月卡 10 元/月，比单次扫码省。', '去市区坐公交 K5，1.5 小时只花几块钱。'],
    '娱乐': ['娱乐-非刚需要单独看：操场夜跑和社团活动都免费。', '这周娱乐预算还稳吗？月底复盘最容易超的就是它。'],
    '居住': ['空调开 26 度，出门前检查有没有关。', '月底电费分摊时别因小钱闹矛盾。'],
    '医疗': ['校医院能开的不必校外买药，记得走医保。', '备药一次买齐，别临时在校内便利店买贵的。'],
    '其他': ['每一笔都单独看一眼，超预算的类别下周设上限。', '周日花三分钟复盘一次比什么都管用。']
  };

  var fallbackCursor = 0;

  function cooldownAdvice() {
    return '这笔属于冲动消费冷静期对象，建议先晾 24 小时。';
  }

  function oneLineAdvice(bill, ov) {
    if (!bill || bill.type !== 'expense') {
      return '收入已入账，别急着花：先把它划到这个周期的预算里。';
    }
    // 1) 有平替 -> 用平替
    var alt = ENG.getAlternative(bill);
    if (alt && alt.save > 0) {
      return '试试' + alt.altName + '（' + ENG.fmt1(alt.altPrice) + '元），' +
        (alt.tip || '更划算') + '更香。';
    }
    // 2) 非刚需 -> 冷静期提示
    if (bill.motivation === '情绪' || bill.want === true || ENG.hitsCooldownKeyword(bill)) {
      return cooldownAdvice();
    }
    // 3) 按分类给校园版兜底建议
    var pool = CATEGORY_FALLBACK[bill.category] || CATEGORY_FALLBACK['其他'];
    fallbackCursor++;
    var base = pool[fallbackCursor % pool.length];
    // 4) 余额紧张时优先说预算
    if (ov && ov.budgetState && (ov.budgetState.status === 'danger' || ov.budgetState.status === 'tight')) {
      return fit50('预算只剩 ' + fmtMoney(ov.budgetState.remaining) + '，' + base);
    }
    return fit50(base);
  }

  /* ================================================================== */
  /* 六、大额支出劝阻（「大额冷静」卡）                                     */
  /* ================================================================== */

  /**
   * 大额判定阈值（可调）：
   *   BIG_SPEND_ABS        单笔绝对金额达到该值即视为大额（元）；
   *   BIG_SPEND_DAILY_MULT 单笔超过「剩余每日可花 × 该倍数」也视为大额。
   * 两条满足任一即命中，二者取或，兜住「余额紧张时小额也是大额」的场景。
   */
  var BIG_SPEND_ABS = 500;
  var BIG_SPEND_DAILY_MULT = 3;

  /** 大额冷静卡自增序号：保证多张卡的按钮 id 不冲突（点击走 data-act 委托，id 仅用于定位） */
  var bigSpendSeq = 0;

  /**
   * 生成「理财专家说 · 大额冷静」劝阻卡。
   * 触发条件：支出账单 且（amount ≥ BIG_SPEND_ABS 或 amount > 剩余每日可花 × BIG_SPEND_DAILY_MULT），
   * amount ≤ 0 或概览数据不全则不触发。收入永不触发。
   * @param {Object} bill 刚记账的账单（app.js commitBill 产物）
   * @param {?Object} overview app.js getOverview() 概览（含 budgetState.remaining /
   *     budgetState.dailyAllowance / cycle.remainingDays，字段缺失时降级处理）
   * @return {{hit:boolean, percent:?number, days:?number, html:string}}
   *   hit     是否命中大额劝阻
   *   percent 这笔占剩余额度的百分数（剩余额度 ≤ 0 时为 null，文案改口「已超过剩余额度」）
   *   days    周期剩余天数（概览缺失时为 null）
   *   html    劝阻卡 HTML（hit=false 时为空串）
   */
  function bigSpendAdvice(bill, overview) {
    var result = { hit: false, percent: null, days: null, html: '' };
    if (!bill || bill.type === 'income') { return result; }
    var amount = Number(bill.amount);
    if (!isFinite(amount) || amount <= 0) { return result; }

    var bs = (overview && overview.budgetState) ? overview.budgetState : null;
    var daily = bs ? Number(bs.dailyAllowance) : NaN;
    var remaining = bs ? Number(bs.remaining) : NaN;
    var days = (overview && overview.cycle) ? Number(overview.cycle.remainingDays) : NaN;

    /* 触发判定：绝对阈值 或 相对每日可花的倍数阈值（数据不全时只用绝对阈值兜底） */
    var absHit = amount >= BIG_SPEND_ABS;
    var relHit = isFinite(daily) && daily > 0 && amount > daily * BIG_SPEND_DAILY_MULT;
    if (!absHit && !relHit) { return result; }

    /* 占剩余额度的百分比：剩余额度非法 / 已透支时改口「已经超过本周剩余额度」 */
    var overRemaining = (!isFinite(remaining) || remaining <= 0);
    var percent = null;
    if (!overRemaining) {
      percent = Math.round(amount / remaining * 100);
      if (!isFinite(percent)) { percent = null; }
    }

    var item = gbEsc(bill.note || bill.category || '这笔支出');
    var seq = ++bigSpendSeq;

    /* ① 占比句 */
    var line1;
    if (overRemaining) {
      line1 = '这笔 ' + fmt1(amount) + ' 元已经超过本周剩余额度，再花就要吃土了。';
    } else {
      line1 = '这笔 ' + fmt1(amount) + ' 元占你本周剩余额度 ' + percent + '%。';
    }
    /* ② 48 小时法则句 */
    var line2 = '按 48 小时法则，今晚先别拆封、别激活，先放进购物车晾 48 小时。';
    /* ③ 回头评估句 */
    var line3 = '如果 48 小时后还是想要，回来点下面的按钮正式评估一下值不值。';

    var html = '' +
      '<div class="coach-say coach-bigspend">' +
      '  <div class="coach-say-head">' + ic('alert', 'bico-warn', '大额冷静') + '<b>理财专家说 · 大额冷静</b></div>' +
      '  <div class="coach-say-body">' +
      '    <p>' + line1 + '</p>' +
      '    <p>' + line2 + '</p>' +
      '    <p>' + line3 + '</p>' +
      '  </div>' +
      '  <div class="coach-bigspend-actions">' +
      '    <button class="btn-mini" id="btnBigSpendCool' + seq + '" data-act="cool-bigspend"' +
      '      data-item="' + item + '" data-price="' + amount + '" type="button">启动剁手冷静法</button>' +
      '  </div>' +
      '</div>';

    result.hit = true;
    result.percent = percent;
    result.days = isFinite(days) ? days : null;
    result.html = html;
    return result;
  }

  var API = {
    ADVICE_MAX_LEN: ADVICE_MAX_LEN,
    adviceForBill: adviceForBill,
    oneLineAdvice: oneLineAdvice,
    saveMoneyAnswer: saveMoneyAnswer,
    makeMoneyAnswer: makeMoneyAnswer,
    /* 团购省钱指导（校外餐饮 / 娱乐：先搜券再下单） */
    detectGroupBuy: detectGroupBuy,
    groupBuyAdvice: groupBuyAdvice,
    groupBuyAnswer: groupBuyAnswer,
    groupBuyPanelHtml: groupBuyPanelHtml,
    GB_RULES: GB_RULES,
    GB_ESSENCE: GB_ESSENCE,
    perPersonSaving: perPersonSaving,
    FOOD_KW: FOOD_KW,
    FUN_KW: FUN_KW,
    CAMPUS_KW: CAMPUS_KW,
    PAST_KW: PAST_KW,
    isWantBuy: isWantBuy,
    bigSpendAdvice: bigSpendAdvice,
    BIG_SPEND_ABS: BIG_SPEND_ABS,
    BIG_SPEND_DAILY_MULT: BIG_SPEND_DAILY_MULT,
    COOLING_STEPS: COOLING_STEPS,
    coolingVerdict: coolingVerdict,
    ACADEMY: ACADEMY,
    learningResources: learningResources,
    personalTips: personalTips
  };

  if (isNode) {
    module.exports = API;
  } else {
    global.AJ = global.AJ || {};
    global.AJ.coach = API;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
