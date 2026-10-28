/**
 * billfilter.js — 账单筛选（纯函数，零 DOM、零存储，UMD）
 *
 * 定位：把「账单列表」的类型 / 金额 / 备注筛选抽成可单测的纯逻辑，
 *       与渲染层（app.js renderBillList / renderSimpleList）彻底解耦。
 *       完整版「本月账单流水」与简洁版「明细」共用同一套筛选语义。
 *
 * 浏览器：通过 <script src="billfilter.js"> 加载，挂载到 window.AJ.billFilter
 * Node  ：require('./billfilter.js') 直接返回 API（便于单元测试）
 *
 * 对外 API（window.AJ.billFilter）：
 *   DEFAULTS       默认空筛选 { cats: [], sources: [], min: '', max: '', note: '' }
 *   CATS          支出分类（与 DATA.CATEGORY_KEYS 一致，缺 DATA 时用内置副本兜底）
 *   SOURCES       收入分类（与 DATA.INCOME_SOURCES 一致，缺 DATA 时用内置副本兜底）
 *   normalize(f)  把任意输入整理成安全筛选对象（非法输入一律兜底，绝不抛异常）
 *   isActive(f)   是否至少启用了一个条件（按钮角标是否点亮用）
 *   activeCount(f) 启用的筛选维度数（按钮角标「筛选·N」的 N）
 *   match(bill, f) 单条账单是否通过筛选
 *   filter(bills, f) 返回通过筛选的账单数组（原序）
 *
 * 筛选语义：
 *   - 分类 / 来源都未选任何：不过滤类型（全部显示）
 *   - 选了部分：支出账单需 b.category 落在所选支出分类；收入账单需 b.source 落在所选收入分类
 *   - 两类各自独立（可只选支出 / 只选收入 / 都选）
 *   - 金额区间、备注关键词与类型选择是「与（AND）」关系
 *   - 空筛选（全空）= 显示全部（等价无筛选）
 */
(function (global) {
  'use strict';

  /** 内置副本：保证无 DATA（Node 缺 data.js / 浏览器加载顺序异常）时模块仍可独立 require / 单测 */
  var BUILTIN_CATS = ['餐饮', '社交', '购物', '学习', '交通', '娱乐', '居住', '电费', '燃气费', '医疗', '其他'];
  var BUILTIN_SOURCES = ['生活费', '兼职', '奖学金', '助学金', '红包', '退款', '其他'];

  /**
   * 取 DATA：浏览器走 window.AJ.data，Node 走 require('./data.js')。
   * 拿不到（异常 / 加载顺序）就回退 null，调用方据此用内置副本兜底。
   */
  function getData() {
    var d = null;
    try {
      if (typeof window !== 'undefined' && window.AJ && window.AJ.data) {
        d = window.AJ.data;
      } else if (typeof require !== 'undefined') {
        d = require('./data.js');
      }
    } catch (e) {
      d = null;
    }
    return d;
  }

  var DATA = getData();
  var CATS = (DATA && Array.isArray(DATA.CATEGORY_KEYS) && DATA.CATEGORY_KEYS.length)
    ? DATA.CATEGORY_KEYS.slice() : BUILTIN_CATS.slice();
  var SOURCES = (DATA && Array.isArray(DATA.INCOME_SOURCES) && DATA.INCOME_SOURCES.length)
    ? DATA.INCOME_SOURCES.slice() : BUILTIN_SOURCES.slice();

  /** 默认空筛选（导出为常量供 UI 重置时引用；运行时状态请用 normalize(DEFAULTS) 取新对象，避免引用共享） */
  var DEFAULTS = { cats: [], sources: [], min: '', max: '', note: '' };

  /** 返回一份全新的空筛选对象（避免外部改动污染 DEFAULTS） */
  function freshDefault() {
    return { cats: [], sources: [], min: '', max: '', note: '' };
  }

  /**
   * 把任意值转成数字或 ''（=不限）。
   * '' / null / undefined → ''；Number 后是有限数 → 该数；NaN / 非数字串 → ''。
   */
  function toAmount(v) {
    if (v === '' || v === null || v === undefined) { return ''; }
    var n = Number(v);
    if (!isFinite(n)) { return ''; }
    return n;
  }

  /**
   * 清洗一个候选数组：只保留「字符串」且「命中合法集合」的项，并去重。
   * 非数组 / 含非法项 / 重复项一律安全跳过，绝不抛异常。
   */
  function safeList(v, valid) {
    if (!Array.isArray(v)) { return []; }
    var seen = {};
    var out = [];
    var i;
    for (i = 0; i < v.length; i++) {
      var item = v[i];
      if (typeof item !== 'string') { continue; }
      if (valid.indexOf(item) === -1) { continue; }
      if (seen[item]) { continue; }
      seen[item] = 1;
      out.push(item);
    }
    return out;
  }

  /**
   * 把输入整理成安全筛选对象；非法输入一律兜底，绝不抛异常。
   * @param {*} f 任意（可能 null / 非对象 / 字段类型错 / 含 NaN）
   * @return {{cats:string[],sources:string[],min:(number|string),max:(number|string),note:string}}
   */
  function normalize(f) {
    if (!f || typeof f !== 'object') { return freshDefault(); }
    return {
      cats: safeList(f.cats, CATS),
      sources: safeList(f.sources, SOURCES),
      min: toAmount(f.min),
      max: toAmount(f.max),
      note: (typeof f.note === 'string') ? f.note.trim() : ''
    };
  }

  /** 是否至少启用了一个条件（空筛选返回 false） */
  function isActive(f) {
    var n = normalize(f);
    return n.cats.length > 0 || n.sources.length > 0 ||
      n.min !== '' || n.max !== '' || n.note !== '';
  }

  /** 启用的筛选维度数（0~4）：支出分类 / 收入分类 / 金额区间 / 备注关键词 */
  function activeCount(f) {
    var n = normalize(f);
    var c = 0;
    if (n.cats.length > 0) { c++; }
    if (n.sources.length > 0) { c++; }
    if (n.min !== '' || n.max !== '') { c++; }
    if (n.note !== '') { c++; }
    return c;
  }

  /**
   * 单条账单是否通过筛选。
   * @param {Object} bill 一条账单（需含 type / category / source / amount / note；缺字段按最宽松处理）
   * @param {*} f 筛选条件（内部会先 normalize，调用方无需预处理）
   * @return {boolean}
   */
  function match(bill, f) {
    if (!bill || typeof bill !== 'object') { return false; }
    var n = normalize(f);

    /* 类型筛选：分类与来源都空 → 不过滤类型；否则按各自类型独立判定（支出看 category、收入看 source） */
    var isIncome = bill.type === 'income';
    if (n.cats.length || n.sources.length) {
      if (isIncome) {
        if (n.sources.indexOf(bill.source) === -1) { return false; }
      } else {
        if (n.cats.indexOf(bill.category) === -1) { return false; }
      }
    }

    /* 金额区间：用绝对值比对；min 非空 → amount >= min；max 非空 → amount <= max */
    var amt = Number(bill.amount);
    if (!isFinite(amt)) { amt = 0; }
    if (n.min !== '' && amt < n.min) { return false; }
    if (n.max !== '' && amt > n.max) { return false; }

    /* 备注关键词：对 b.note 做 trim + 小写包含匹配；空 → 不限 */
    if (n.note !== '') {
      var note = (bill.note == null ? '' : String(bill.note));
      if (note.trim().toLowerCase().indexOf(n.note.toLowerCase()) === -1) { return false; }
    }
    return true;
  }

  /** 返回通过筛选的账单数组（原序保留）；空筛选直接返回副本 */
  function filter(bills, f) {
    if (!Array.isArray(bills)) { return []; }
    var n = normalize(f);
    if (!isActive(n)) { return bills.slice(); }
    var out = [];
    var i;
    for (i = 0; i < bills.length; i++) {
      if (match(bills[i], n)) { out.push(bills[i]); }
    }
    return out;
  }

  var API = {
    DEFAULTS: DEFAULTS,
    CATS: CATS,
    SOURCES: SOURCES,
    normalize: normalize,
    isActive: isActive,
    activeCount: activeCount,
    match: match,
    filter: filter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    global.AJ = global.AJ || {};
    global.AJ.billFilter = API;
  }
})(typeof window !== 'undefined' ? window : this);
