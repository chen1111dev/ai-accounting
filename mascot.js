/**
 * mascot.js — IP 形象「阿账」情绪状态机 + 戳一戳话术池（纯函数，零 DOM、零存储，UMD）
 *
 * 定位：与 persona.js 同纪律的纯函数模块——不读 localStorage、不写 DOM、不碰 state，
 * 输入缺字段一律当 0 / 空处理，绝不抛异常。这样可以在 Node 里直接 require 做单测。
 *
 * 对外 API（window.AJ.mascot）：
 *   KEYS                  9 个 mood key（chill/nervous/bankrupt/stop/cheer/mad/save/deadline/sleep）
 *   MOOD_META             key → { name中文, priority, ttl(ms,仅瞬时态), soft, cmd }
 *   EVENT_MOOD            事件源 → 瞬时 mood 映射（app.js 五处接线共用）
 *   resolveMood(ov)       ov = getOverview() 返回值 → mood key
 *                         三层优先级：Tier A 瞬时事件 → Tier B 预算常驻 → Tier C 情境装饰
 *   onEvent(key)          瞬时事件入口：bill_logged→cheer / piggy_in→save /
 *                         impulse_flag→mad / cooldown_block→stop；重置唯一 TTL 定时器
 *   getActiveEvent()      → {key, until} | null
 *   tick()                TTL 到期回调：清 event、通知订阅者（不用 setInterval / rAF）
 *   onMoodChange(fn)      注册唯一订阅者：mood 变化时收到 (newKey, oldKey)；
 *                         newKey 为 null 表示「瞬时态回落，请按当前 ov 重算常驻态」
 *   moodSvg(key, cls, label)  → <svg class="mico mood-{key}" …>内联动态 SVG
 *                         （.m-sway/.m-react/.m-breathe/.m-blink 可动分组）
 *                         key 白名单校验，非法回落 chill
 *   poke(ctx)             戳一戳决策：ctx={ov,state,money} → {text,cmd,groupKey,mood} | null
 *                         最小间隔 3s（防刷，返回 null 时调用方只重放弹跳动画）
 *   line(ctx)             常驻对话条文案：同话术池、无节流去重（确定性取第一条）
 *   fillVars(tpl, ctx)    {xxx} 占位符替换；缺字段一律 '—'，绝不输出 undefined
 *
 * 设计依据：docs/ip-mascot-architecture.md §1-§3 + docs/ip-persona-prd.md §2-§3
 */
(function (global) {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);

  /* 真正的全局对象：浏览器 window / Node global。话术要读 AJ.tone 的当前语气，
     而 persona.js 式的 UMD 尾在 Node 里把 module.exports 当 this 传进来，
     所以单独留一个 ROOT 引用；浏览器行为与 persona.js 完全一致。 */
  var ROOT = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis : global;

  /* ------------------------------------------------------------------ */
  /* 常量：9 态元数据（PRD §2.1 状态总表 + §3.5 戳一戳动作映射的代码化）    */
  /* ------------------------------------------------------------------ */

  var KEYS = ['chill', 'nervous', 'bankrupt', 'stop', 'cheer', 'mad', 'save', 'deadline', 'sleep'];

  var MOOD_META = {
    chill:    { name: '安全·省钱中',     priority: 40,  ttl: 0,    soft: '--green-soft',  cmd: '本月花销饼图' },
    nervous:  { name: '紧张·吃土预警',   priority: 50,  ttl: 0,    soft: '--amber-soft',  cmd: '怎么省钱' },
    bankrupt: { name: '超支·破产',       priority: 60,  ttl: 0,    soft: '--danger-soft', cmd: '怎么省钱' },
    stop:     { name: '冷静期·拦截中',   priority: 100, ttl: 4000, soft: '--danger-soft', cmd: '加心愿单' },
    cheer:    { name: '记账成功·点赞',   priority: 80,  ttl: 2500, soft: '--green-soft',  cmd: '本月花销饼图' },
    mad:      { name: '冲动消费·生气',   priority: 90,  ttl: 3000, soft: '--danger-soft', cmd: '加心愿单' },
    save:     { name: '存钱罐进账·开心', priority: 70,  ttl: 3500, soft: '--green-soft',  cmd: '存一笔' },
    deadline: { name: '周期末冲刺',      priority: 30,  ttl: 0,    soft: '--amber-soft',  cmd: '查余额' },
    sleep:    { name: '深夜关怀',        priority: 20,  ttl: 0,    soft: '--text-2',      cmd: '记一笔' }
  };

  /** 事件源 → 瞬时 mood 映射（未知 key 在 onEvent 里静默忽略） */
  var EVENT_MOOD = {
    bill_logged: 'cheer',
    piggy_in: 'save',
    impulse_flag: 'mad',
    cooldown_block: 'stop'
  };

  /** 戳一戳最小间隔（ms）：间隔内重复点击不换文案，调用方只重放弹跳 */
  var POKE_GAP = 3000;

  /* ------------------------------------------------------------------ */
  /* 模块单例状态（不落盘，刷新即重置）                                    */
  /* ------------------------------------------------------------------ */

  var event = null;        /* null | { key, until }                       */
  var timer = null;        /* 唯一 setTimeout 句柄；onEvent 先 clear 再设  */
  var lastPokeAt = 0;      /* 上次戳一戳时间戳                             */
  var recent = {};         /* { G1: [1,0,2], … } 每组最近 3 条已用索引      */
  var listener = null;     /* onMoodChange 注册的唯一回调                   */

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                            */
  /* ------------------------------------------------------------------ */

  /** 非有限数一律归 0（缺字段 / null / NaN / 字符串数字都安全） */
  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /**
   * 金额格式化：优先用调用方注入的 ctx.money（app.js 的 money()，与全站文案同口径）；
   * 没有就退回内置轻量版（¥ + 两位小数 + 千分位），保证 Node 单测也能得到稳定输出。
   */
  function fmtMoney(v, ctx) {
    if (ctx && typeof ctx.money === 'function') {
      var s = ctx.money(v);
      return (s === undefined || s === null) ? '—' : String(s);
    }
    var n = num(v);
    var neg = n < 0;
    var cents = Math.round(Math.abs(n) * 100);
    var intPart = Math.floor(cents / 100);
    var frac = cents % 100;
    var str = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
      '.' + (frac < 10 ? '0' + frac : frac);
    return (neg ? '-¥' : '¥') + str;
  }

  /** 取当前语气：AJ.tone.normalize(get())，tone.js 缺失时回落 gentle */
  function toneOf() {
    try {
      var t = ROOT.AJ && ROOT.AJ.tone;
      if (t && typeof t.normalize === 'function' && typeof t.get === 'function') {
        return t.normalize(t.get());
      }
    } catch (eT) { /* 缺 tone.js 时回落 gentle */ }
    return 'gentle';
  }

  /** 目标选取：按 deadline 最近取第一条（PRD §3.1 {goal} 口径），无目标返回 null */
  function nearestGoal(ctx) {
    var st = (ctx && ctx.state) || {};
    var goals = Array.isArray(st.goals) ? st.goals : [];
    var best = null;
    for (var i = 0; i < goals.length; i++) {
      var g = goals[i];
      if (!g || typeof g !== 'object') { continue; }
      if (!best) { best = g; continue; }
      if (g.deadline && (!best.deadline || g.deadline < best.deadline)) { best = g; }
    }
    return best;
  }

  /** 目标完成度（0-100 整数，与 ENG.getGoalProjection 的 percent 同口径） */
  function goalPercent(g) {
    var t = num(g && g.target);
    var sv = num(g && g.saved);
    return t > 0 ? Math.round(Math.min(100, sv / t * 100)) : 0;
  }

  /** 按当前月度结余推算还需月数；结余为 0 时推算不出，返回 null（呈现为 '—'） */
  function goalMonths(g, ov) {
    var need = Math.max(0, num(g && g.target) - num(g && g.saved));
    var surplus = Math.max(0, num(ov && ov.monthlySurplus));
    if (need <= 0) { return 0; }
    if (surplus <= 0) { return null; }
    return Math.ceil(need / surplus);
  }

  /* ------------------------------------------------------------------ */
  /* 状态机：resolveMood / onEvent / tick / getActiveEvent / onMoodChange */
  /* ------------------------------------------------------------------ */

  /**
   * 解析当前 mood（PRD §2.1 伪代码直译）。
   * Tier C 情境态（deadline/sleep，仅预算安全时）→ Tier B 预算常驻
   * （tight→nervous、isOver||danger→bankrupt）→ Tier A 瞬时事件覆盖。
   * 零依赖 ov 以外的东西；ov 缺失时按「安全 + 非期末」兜底。
   * @param {Object} ov getOverview() 返回值，可缺省
   * @return {string} mood key
   */
  function resolveMood(ov) {
    var o = (ov && typeof ov === 'object') ? ov : {};
    var bs = (o.budgetState && typeof o.budgetState === 'object') ? o.budgetState : {};
    var cycle = (o.cycle && typeof o.cycle === 'object') ? o.cycle : {};
    var status = bs.status || 'safe';
    /* 1) Tier C：基线 chill，情境态只在预算安全时叠加 */
    var s = 'chill';
    if (status === 'safe') {
      var rd = Number(cycle.remainingDays);
      if (isFinite(rd) && rd > 0 && rd <= 3) { s = 'deadline'; }   /* P30 */
      var h = new Date().getHours();
      if (h >= 23 || h < 5) { s = 'sleep'; }                        /* P20 */
    }
    /* 2) Tier B：预算常驻 */
    if (status === 'tight') { s = 'nervous'; }                      /* P50 */
    if (bs.isOver === true || status === 'danger') { s = 'bankrupt'; } /* P60 */
    /* 3) Tier A：瞬时事件（未过期则覆盖一切） */
    var ev = getActiveEvent();
    if (ev) { s = ev.key; }
    return s;
  }

  /** 当前未过期的瞬时事件；过期未 tick 时也按 null 处理（幂等） */
  function getActiveEvent() {
    if (!event) { return null; }
    if (Date.now() >= event.until) { return null; }
    return event;
  }

  /** 通知订阅者；nk 为 null 表示「瞬时态回落，请按当前 ov 重算常驻态」 */
  function notify(newKey, oldKey) {
    if (typeof listener === 'function') {
      try { listener(newKey, oldKey); } catch (eN) { /* 订阅者异常不阻断状态机 */ }
    }
  }

  /** TTL 到期：清事件、通知订阅者。定时器只做这一件事，无闭包泄漏面。 */
  function tick() {
    timer = null;
    var old = event ? event.key : null;
    event = null;
    notify(null, old);
  }

  /**
   * 瞬时事件入口：映射到 mood、重置唯一 TTL 定时器、通知订阅者。
   * 连续记账不会堆积定时器（先 clearTimeout 再重设）；未知 key 静默忽略。
   * @param {string} key bill_logged / piggy_in / impulse_flag / cooldown_block
   * @return {Object|null} 新的 event（未知 key 返回当前 event，可能为 null）
   */
  function onEvent(key) {
    var mood = EVENT_MOOD[key];
    if (!mood) { return getActiveEvent(); }
    var old = getActiveEvent();
    if (timer !== null) { clearTimeout(timer); timer = null; }
    var ttl = (MOOD_META[mood] && MOOD_META[mood].ttl) || 0;
    event = { key: mood, until: Date.now() + ttl };
    timer = setTimeout(tick, ttl);
    notify(mood, old ? old.key : null);
    return event;
  }

  /** 订阅 mood 变化（最多 1 个订阅者；传非函数相当于取消订阅） */
  function onMoodChange(fn) {
    listener = (typeof fn === 'function') ? fn : null;
  }

  /* ------------------------------------------------------------------ */
  /* moodSvg                                                             */
  /* ------------------------------------------------------------------ */

  /** 属性转义（aria-label 防注入；浏览器里更安全，Node 单测无所谓） */
  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ------------------------------------------------------------------ */
  /* 内联 SVG 形象（动态电子宠物）：共享躯干 + 9 态表情差分                 */
  /* 内部带可动分组：.m-sway 摇摆 / .m-react 情绪反应 / .m-breathe 呼吸 /  */
  /* .m-blink 眨眼。结构与配色全在 styles.css 控制，这里只产出线条与      */
  /* currentColor，零外链、零 emoji。                                      */
  /* ------------------------------------------------------------------ */

  /** 共享躯干：奶油色皮肤 + 绿色头顶芽 + 白大褂 + 手臂；cheeks 为腮红(粉) */
  var MASCOT_SKIN =
    '<ellipse class="m-skin" cx="24" cy="15" rx="10" ry="9.5"/>' +
    '<path class="m-skin" d="M17.5 26.5c-1.7 4.5-2.5 10.5-1.7 17.5h16.4c.8-7 0-13-1.7-17.5z"/>' +
    '<path class="m-sprout-st" d="M26.5 6c-.5-1.3-.5-2.3-.1-3.3"/>' +
    '<path class="m-sprout" d="M26.4 2.7c2.6-1.2 5-1 6.7.4-1.9 1.7-4.4 2-6.7.2z"/>' +
    '<path class="m-sprout" d="M26.6 3.7c1.6.3 2.7 1 3.3 2.1-1.7.4-3-.3-3.3-2.1z"/>' +
    '<path d="M20.5 25.5l3.5 4 3.5-4"/>' +
    '<path d="M24 33h.01M24 36.5h.01M24 40h.01"/>' +
    '<rect x="17.5" y="30.5" width="4.5" height="3.6" rx=".8"/>' +
    '<path d="M20 30.5l1.5-3.4"/>' +
    '<path d="M16.8 30c-2 .8-3 2.2-3.2 4.2"/><circle cx="13.6" cy="34.8" r="1.1"/>' +
    '<path d="M31.2 30c2 .8 3 2.2 3.2 4.2"/><circle cx="34.4" cy="34.8" r="1.1"/>' +
    '<circle class="m-cheek" cx="18.6" cy="19.4" r="1.9"/>' +
    '<circle class="m-cheek" cx="29.4" cy="19.4" r="1.9"/>';

  /** 表情小部件（复用，避免重复字符串拼接） */
  function mEye(cx) {
    return '<circle class="m-eye" cx="' + cx + '" cy="15" r="2.1"/>' +
      '<circle class="m-hi" cx="' + (cx + 0.7) + '" cy="14.3" r="0.7"/>';
  }
  function mBlink(inner) { return '<g class="m-blink">' + inner + '</g>'; }
  function mBrows(kind) {
    if (kind === 'stern') { return '<path d="M17.8 12.4l4 1.1"/><path d="M30.2 12.4l-4 1.1"/>'; }
    if (kind === 'angry') { return '<path d="M17.8 13.2l4.2-1.7"/><path d="M30.2 13.2l-4.2-1.7"/>'; }
    if (kind === 'sad') { return '<path d="M18 13.6l3.6 1.2"/><path d="M30 13.6l-3.6 1.2"/>'; }
    return '';
  }
  function mSpark(cx, cy, s) {
    var d = (s || 1);
    return '<path class="m-spark" d="M' + cx + ' ' + (cy - 2.4 * d) +
      'l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z"/>';
  }

  /** 9 态表情差分（眨眼分组 + 嘴 + 眉 + 道具） */
  var MASCOT_FACE = {
    chill: mBlink(mEye(20.5) + mEye(27.5)) +
      '<path d="M21 21c1.6 1.4 3.4 1.4 5 0"/>' + mSpark(41.5, 6, 1.1),
    nervous: mBlink(mEye(20.5) + mEye(27.5)) + mBrows('sad') +
      '<path d="M21 22c.8-.8 1.7.8 2.5 0s1.7.8 2.5 0"/>' +
      '<path class="m-sweat" d="M34.6 12.4c1 1.4 1 2.6 0 3.3-1-.7-1-1.9 0-3.3z"/>' +
      '<path class="m-sweat" d="M37.2 9.6c.7 1 .7 1.9 0 2.4-.7-.5-.7-1.4 0-2.4z"/>',
    bankrupt: mBlink('<path d="M19 13.8l3.2 3M22.2 13.8l-3.2 3"/>' +
      '<path d="M25 13.8l3.2 3M28.2 13.8l-3.2 3"/>') +
      '<path d="M21 22.6c1.9-1.5 4.1-1.5 6 0"/>' +
      '<path d="M20.4 38.8h7v4h-7z"/><path d="M28.6 40h.01"/>' + mSpark(11, 6, 1),
    stop: mBlink(mEye(20.5) + mEye(27.5)) + mBrows('stern') +
      '<path d="M21.5 22h5"/>' +
      '<g class="m-sign"><path d="M36.2 2.5h5.6l3.7 3.7v5.6l-3.7 3.7h-5.6l-3.7-3.7V6.2z"/>' +
      '<path d="M34.2 9h11"/></g>',
    cheer: mBlink('<path d="M18.4 15.4c1-.9 2.2-.9 3.2 0"/><path d="M24.4 15.4c1-.9 2.2-.9 3.2 0"/>') +
      '<path d="M21 21h6c0 2.1-1.2 3.4-3 3.4S21 23.1 21 21z"/>' +
      mSpark(40, 5, 1.2) + mSpark(36, 31, 1) +
      '<circle class="m-coin" cx="35.5" cy="33" r="2.1"/>' +
      '<path class="m-coin-mark" d="M34.7 32.2l1.6 1.5M36.3 32.2l-1.6 1.5"/>',
    mad: mBlink(mEye(20.5) + mEye(27.5)) + mBrows('angry') +
      '<path d="M21.5 22.6c1.7-1.3 3.3-1.3 5 0"/><path d="M22.8 20.8h2.4"/>' +
      '<path class="m-steam" d="M36.5 11.5l2.2-2.2M37 15l2.8-.6M34 8.4l.5-2.8"/>',
    save: mBlink('<path d="M18.4 15.4c1-.9 2.2-.9 3.2 0"/><path d="M24.4 15.4c1-.9 2.2-.9 3.2 0"/>') +
      '<path d="M21 21h6c0 2.1-1.2 3.4-3 3.4S21 23.1 21 21z"/>' +
      mSpark(20.8, 13.5, .8) + mSpark(27.3, 13.5, .8) +
      '<ellipse class="m-piggy" cx="12.5" cy="37.5" rx="4" ry="2.7"/>' +
      '<path class="m-piggy" d="M10.3 35.4c.6-.9 1.7-.9 2.3 0"/><circle class="m-piggy" cx="13" cy="31.2" r="1.4"/>',
    deadline: mBlink(mEye(20.5) + mEye(27.5)) +
      '<path d="M21.5 22h5"/>' +
      '<circle class="m-clock" cx="11.5" cy="36.5" r="2.8"/><path class="m-clock" d="M13.7 38.7l2 2"/>' +
      '<path class="m-clock" d="M11.5 34.7v1.8"/>',
    sleep: mBlink('<path d="M18.4 15.6c1 .8 2.2 .8 3.2 0"/><path d="M24.4 15.6c1 .8 2.2 .8 3.2 0"/>') +
      '<circle cx="24" cy="21.6" r="1.3"/>' +
      '<g class="m-zzz"><path d="M35.5 6.5h3.2l-3.2 3.2h3.2"/>' +
      '<path d="M40.8 2.3h2.6l-2.6 2.6h2.6"/></g>'
  };

  /**
   * 生成头像内联 SVG（动态电子宠物）。key 白名单校验，非法回落 chill；
   * 内部带 .m-sway/.m-react/.m-breathe/.m-blink 可动分组，配色与动画在
   * styles.css 控制；aria-label 缺省用 MOOD_META 中文名。
   */
  function moodSvg(key, cls, label) {
    var k = KEYS.indexOf(key) !== -1 ? key : 'chill';
    var meta = MOOD_META[k];
    var aria = (label === undefined || label === null || label === '')
      ? (meta ? meta.name : k) : String(label);
    var inner = MASCOT_SKIN + (MASCOT_FACE[k] || MASCOT_FACE.chill);
    return '<svg class="' + String(cls || 'mico') + ' mood-' + k +
      '" viewBox="0 0 48 48" role="img" aria-label="' + escAttr(aria) + '">' +
      '<g class="m-sway"><g class="m-react"><g class="m-breathe">' + inner +
      '</g></g></g></svg>';
  }

  /* ------------------------------------------------------------------ */
  /* 话术池（PRD §3.2 / §3.3 原文，全部照抄；{streak} 按 Open Q4 不出现）  */
  /* ------------------------------------------------------------------ */

  /**
   * 分组话术：严格按 G1→G8 顺序取第一个 when 命中的组；
   * 每组 3 语气各一条（数组形式，方便以后加变体），组内按 recent 去重选句。
   * when(ctx) 的 ctx = { ov, state, money }。
   */
  var POOLS = [
    { key: 'G1',
      when: function (c) { return !!(c.ov && c.ov.engel && c.ov.engel.alert === true); },
      lines: {
        gentle: ['餐饮已经占了 {engel}% 啦，这顿要不要先缓缓？我把附近食堂今天最便宜的几样翻给你看看。'],
        strict: ['{engel}% 都进肚子了。明天起午饭上限 {allow}，别跟我讨价还价。'],
        rational: ['恩格尔系数 {engel}%（健康线 60%）。按这个比例外推，本周期餐饮将吃掉约 {surplus} 的月度结余。']
      } },
    { key: 'G2',
      when: function (c) {
        return num(c.ov && c.ov.piggyBalance) > 0 &&
          !!(c.state && Array.isArray(c.state.goals) && c.state.goals.length > 0);
      },
      lines: {
        gentle: ['嘿嘿，咱们的小金库已经有 {piggy} 啦，离你的 {goal} 还差 {gap}，慢慢攒，我陪你。'],
        strict: ['罐子里 {piggy}，离 {goal} 还差 {gap}。别高兴太早，继续。'],
        rational: ['存钱罐余额 {piggy}，目标「{goal}」完成 {pct}%，缺口 {gap}。']
      } },
    { key: 'G3',
      when: function (c) {
        var p = goalPercent(nearestGoal(c));
        return p >= 80 && p < 100;
      },
      lines: {
        gentle: ['{goal} 只差 {gap} 了！再攒几天就能抱回家，我比你还激动一点点。'],
        strict: ['已经 {pct}%，就差 {gap}。这时候掉链子，前面全白攒。'],
        rational: ['目标「{goal}」完成 {pct}%，缺口 {gap}；按当前月度结余 {surplus} 推算，约 {months} 个月可达，比 deadline 早。']
      } },
    { key: 'G4',
      when: function (c) { return !!(c.ov && c.ov.budgetState && c.ov.budgetState.isOver === true); },
      lines: {
        gentle: ['这个周期超了 {over}。别慌，账我替你摊开在这儿，咱们一笔一笔把它补回去。'],
        strict: ['超 {over}。接下来 {days} 天，非必要一律不准，我来盯。'],
        rational: ['周期已超支 {over}，剩余 {days} 天日均可用 0。建议冻结非必需分类支出，优先保障餐饮。']
      } },
    { key: 'G5',
      when: function (c) {
        var bs = c.ov && c.ov.budgetState;
        return !!bs && bs.status === 'danger' && bs.isOver !== true;
      },
      lines: {
        gentle: ['还剩 {days} 天，日均可用只剩 {allow}。我这几天替你把饭钱先排好，别饿着自己。'],
        strict: ['{days} 天，日均 {allow}。吃土预警已经亮了，给我收着点。'],
        rational: ['日均可用 {allow}（吃土线 20 元），剩余 {days} 天，周期预算已消耗 {spendPct}%。']
      } },
    { key: 'G6',
      when: function (c) {
        var bs = c.ov && c.ov.budgetState;
        return !!bs && bs.status === 'tight';
      },
      lines: {
        gentle: ['日均可用 {allow}，稍微有点紧。今天已经花了 {today}，剩下的我们省着用。'],
        strict: ['日均 {allow}，进偏紧区间了。今天花出去的 {today}，自己看着办。'],
        rational: ['日均可用 {allow}（安全线 40 元），今日已支出 {today}，占日均 {todayPct}%。']
      } },
    { key: 'G7',
      when: function (c) {
        return !!(c.state && num(c.state.blockedCount) >= 1 && num(c.state.savedMoney) > 0);
      },
      lines: {
        gentle: ['冷静期已经帮你拦下 {blocked} 次啦，省了 {saved}。这笔钱现在踏踏实实是你的。'],
        strict: ['{blocked} 次拦截，{saved} 没花出去。早听我的，早省心。'],
        rational: ['冷静期累计拦截 {blocked} 笔，留存 {saved}，相当于本月预算的 {savedPct}%。']
      } },
    { key: 'G8',
      when: function (c) {
        var bs = c.ov && c.ov.budgetState;
        var p = (c.ov && c.ov.engel) ? num(c.ov.engel.percent) : 0;
        return !!bs && bs.status === 'safe' && p > 0 && p <= 60;
      },
      lines: {
        gentle: ['今天一切正常，日均可用 {allow}，节奏很稳。继续保持，我给你记着呢。'],
        strict: ['现在 {allow}/天，还行。别飘，月末才是考试。'],
        rational: ['预算已消耗 {spendPct}%，周期剩余 {days} 天，日均 {allow}，月度预计结余 {surplus}。']
      } }
  ];

  /**
   * 动作回应池（v1.8）：与 poke 的「结合账本现状吐槽」不同，这一组是**针对刚刚发生的
   * 那个动作**说话——用户记了一笔就说这一笔，存了钱就说这一笔存了多少。
   * 结构：{ mood, lines:{tone:[...]}, linesNoGoal? }；占位符走 VARS，act.* 由调用方传入。
   */
  var ACTION_LINES = {
    bill_logged: { mood: 'cheer', lines: {
      gentle: ['记好啦：{cat} {amount}。今天第 {cnt} 笔，我一笔一笔都盯着呢。',
               '{cat} {amount}，收进账本。今天还剩 {remain} 能花，悠着点。'],
      strict: ['{cat} {amount}，记下。别停，把今天剩下的也报上来。',
               '又花 {amount}。今天第 {cnt} 笔，你的手比工资快。'],
      rational: ['入账：{cat} {amount}；当日累计 {today}，日均可用 {allow}。',
                 '已记录 {cat} {amount}，本周期剩余额度 {remain}。']
    } },
    income_logged: { mood: 'cheer', lines: {
      gentle: ['{amount} 到账啦，我先替你记上。这个月能不能剩下，看你怎么花。'],
      strict: ['收入 {amount} 到手。钱变多不等于可以乱花，账我盯着。'],
      rational: ['收入 {amount} 已入账，本周期剩余额度更新为 {remain}。']
    } },
    piggy_in: { mood: 'save',
      lines: {
        gentle: ['存进 {amount}，罐子里 {piggy} 啦。离「{goal}」还差 {gap}，攒着呢。',
                 '又存 {amount}，罐子到 {piggy} 了。这种快乐比拆快递持久。'],
        strict: ['{amount} 进罐子。罐里 {piggy}，还差 {gap}，别中途手痒。',
                 '存 {amount}，罐子 {piggy}。这才是钱该待的地方。'],
        rational: ['存入 {amount}；罐内余额 {piggy}，目标进度 {pct}%，缺口 {gap}。']
      },
      linesNoGoal: {
        gentle: ['存进 {amount}，罐子里 {piggy} 啦。没定目标也能攒，攒着攒着就有底气。'],
        strict: ['{amount} 进罐子，罐里 {piggy}。光存不定目标，等于闭着眼睛走路。'],
        rational: ['存入 {amount}；罐内余额 {piggy}，当前未设置储钱目标。']
      } },
    piggy_out: { mood: 'nervous', lines: {
      gentle: ['取出 {amount}，罐子剩 {piggy}。想好花在哪儿了吗？别让它又变成一杯奶茶。'],
      strict: ['{amount} 取出来了。罐里只剩 {piggy}，这次别再搬去填冲动消费的坑。'],
      rational: ['取回 {amount}，罐内余额降至 {piggy}。建议补记用途以便回溯。']
    } },
    /* 目标存款：说「目标已攒」而不是「罐子里」——两者是不同的钱 */
    goal_in: { mood: 'save', lines: {
      gentle: ['「{goal}」存进 {amount}，现在攒到 {goalSaved}，还差 {gap}。看着它长大真不错。'],
      strict: ['「{goal}」+{amount}，已攒 {goalSaved}，还差 {gap}。别到最后一公里掉链子。'],
      rational: ['目标「{goal}」存入 {amount}；累计 {goalSaved}，进度 {pct}%，缺口 {gap}。']
    } },
    cooldown_block: { mood: 'stop', lines: {
      gentle: ['STOP 得好。这波省下 {amount}，累计已经 {saved} 了。我陪你一起攒。'],
      strict: ['拦下来了，{amount} 保住。下次自己刹住，别等我举牌。'],
      rational: ['拦截成功，保留资金 {amount}；累计留存 {saved}，共 {blocked} 次。']
    } },
    impulse_flag: { mood: 'mad', lines: {
      gentle: ['等等——{amount} 的{note}？先晾 24 小时，明天还想要我陪你买。'],
      strict: ['手停下。{amount} 的{note}，占今天可用额度的 {todayPct}%，你确定？'],
      rational: ['{note} {amount} 触发冷静期：建议 24 小时后再决策，替代方案见对话。']
    } },
    goal_done: { mood: 'cheer', lines: {
      gentle: ['「{goal}」攒够啦！账面 {goalSaved}，去挑一样真正喜欢的吧。'],
      strict: ['「{goal}」达成，账面 {goalSaved}。别转头就被新欲望清空。'],
      rational: ['目标「{goal}」已达成，累计 {goalSaved}，建议结转或设定下一目标。']
    } }
  };

  /** G0 兜底池：所有分组不命中时随机取（PRD §3.3 五条原文，不分语气） */
  var FALLBACK_LINES = [
    '还一笔都没有呢。先告诉我今天的午饭花了多少，我们交个朋友。',
    '空账本，等于把钱交给了运气。第一行记什么，我听着。',
    '我还不知道你的消费习惯——记满 3 笔，我就给你画个像。',
    '别怕麻烦我，我闲着也是闲着。来，报个数。',
    '每一笔都值得被记住。今天第一笔，是什么？'
  ];

  /* ------------------------------------------------------------------ */
  /* 占位符表（PRD §3.1 变量表）：缺容器 / 缺字段一律返回 null → '—'      */
  /* ------------------------------------------------------------------ */

  var VARS = {
    engel: function (c) {
      return (c.ov && c.ov.engel && isFinite(Number(c.ov.engel.percent)))
        ? Math.round(num(c.ov.engel.percent)) : null;
    },
    piggy: function (c) {
      return c.ov ? fmtMoney(c.ov.piggyBalance, c) : null;
    },
    goal: function (c) {
      var g = nearestGoal(c);
      return g ? String(g.name || '目标') : null;
    },
    gap: function (c) {
      var g = nearestGoal(c);
      return g ? fmtMoney(Math.max(0, num(g.target) - num(g.saved)), c) : null;
    },
    pct: function (c) {
      var g = nearestGoal(c);
      return g ? goalPercent(g) : null;
    },
    months: function (c) {
      var g = nearestGoal(c);
      return g ? goalMonths(g, c.ov) : null;
    },
    days: function (c) {
      var rd = (c.ov && c.ov.cycle) ? c.ov.cycle.remainingDays : null;
      return (rd !== null && isFinite(Number(rd))) ? Math.round(num(rd)) : null;
    },
    allow: function (c) {
      var bs = c.ov && c.ov.budgetState;
      return bs ? fmtMoney(bs.dailyAllowance, c) : null;
    },
    today: function (c) {
      var bs = c.ov && c.ov.budgetState;
      return bs ? fmtMoney(bs.todaySpent, c) : null;
    },
    todayPct: function (c) {
      var bs = c.ov && c.ov.budgetState;
      return bs ? Math.round(num(bs.todaySpent) / Math.max(1, num(bs.dailyAllowance)) * 100) : null;
    },
    spendPct: function (c) {
      var bs = c.ov && c.ov.budgetState;
      return bs ? Math.round(num(bs.spendPercent)) : null;
    },
    over: function (c) {
      var bs = c.ov && c.ov.budgetState;
      return bs ? fmtMoney(bs.overBy, c) : null;
    },
    saved: function (c) {
      return c.state ? fmtMoney(c.state.savedMoney, c) : null;
    },
    blocked: function (c) {
      return c.state ? Math.round(num(c.state.blockedCount)) : null;
    },
    savedPct: function (c) {
      if (!c.state) { return null; }
      var total = num(c.state.budget && c.state.budget.total);
      return Math.round(num(c.state.savedMoney) / Math.max(1, total) * 100);
    },
    surplus: function (c) {
      return c.ov ? fmtMoney(c.ov.monthlySurplus, c) : null;
    },
    remain: function (c) {
      var bs = c.ov && c.ov.budgetState;
      return bs ? fmtMoney(bs.remaining, c) : null;
    },
    /* —— 动作上下文（act）：只在 ACTION_LINES 里用，poke/line 缺省时为 '—' —— */
    amount: function (c) {
      return (c.act && c.act.amount !== null && c.act.amount !== undefined)
        ? fmtMoney(c.act.amount, c) : null;
    },
    cat: function (c) {
      return (c.act && c.act.cat) ? String(c.act.cat) : null;
    },
    note: function (c) {
      var n = (c.act && c.act.note) ? String(c.act.note) : null;
      if (!n) { return null; }
      return n.length > 9 ? n.slice(0, 9) + '…' : n;
    },
    cnt: function (c) {
      var v = (c.act && c.act.count !== undefined) ? Number(c.act.count) : NaN;
      return isFinite(v) ? Math.round(v) : null;
    },
    goalSaved: function (c) {
      return (c.act && c.act.goalSaved !== null && c.act.goalSaved !== undefined)
        ? fmtMoney(c.act.goalSaved, c) : null;
    }
  };

  /**
   * {xxx} 占位符替换：VARS 命中 → 取值（null/undefined/非有限数 → '—'）；
   * 未知占位符 → '—'。绝不输出 undefined。
   * @param {string} tpl 带 {占位符} 的模板
   * @param {Object} ctx { ov, state, money }
   * @return {string}
   */
  function fillVars(tpl, ctx) {
    var s = String(tpl === undefined || tpl === null ? '' : tpl);
    return s.replace(/\{(\w+)\}/g, function (m0, name) {
      var fn = VARS[name];
      if (typeof fn !== 'function') { return '—'; }
      var v = null;
      try { v = fn(ctx || {}); } catch (eV) { v = null; }
      if (v === null || v === undefined) { return '—'; }
      if (typeof v === 'number' && !isFinite(v)) { return '—'; }
      return String(v);
    });
  }

  /* ------------------------------------------------------------------ */
  /* 选句：组选择 + 组内去重                                             */
  /* ------------------------------------------------------------------ */

  /** 归一化 ctx：ov / state 缺失时给空对象，保证下游取值函数不抛异常 */
  function normalizeCtx(ctx) {
    var c = ctx && typeof ctx === 'object' ? ctx : {};
    return {
      ov: (c.ov && typeof c.ov === 'object') ? c.ov : {},
      state: (c.state && typeof c.state === 'object') ? c.state : {},
      money: (typeof c.money === 'function') ? c.money : null,
      persona: c.persona || null,
      act: (c.act && typeof c.act === 'object') ? c.act : null
    };
  }

  /** 严格按 G1→G8 顺序取第一个命中组；全不命中返回 null（用 G0 兜底） */
  function firstHit(c) {
    for (var i = 0; i < POOLS.length; i++) {
      var hit = false;
      try { hit = !!POOLS[i].when(c); } catch (eW) { hit = false; }
      if (hit) { return POOLS[i]; }
    }
    return null;
  }

  /**
   * 组内选句：候选 = 未出现在 recent[gKey] 最近 3 条里的索引；
   * 全部用过则清空去重记录重来。useRandom=true 随机挑（poke），false 取第一条（bar）。
   */
  function pickIndex(gKey, len, useRandom) {
    var used = Object.prototype.hasOwnProperty.call(recent, gKey) ? recent[gKey] : [];
    var candidates = [];
    var i;
    for (i = 0; i < len; i++) {
      if (used.indexOf(i) === -1) { candidates.push(i); }
    }
    if (!candidates.length) {
      recent[gKey] = [];
      used = recent[gKey];
      for (i = 0; i < len; i++) { candidates.push(i); }
    }
    var idx = useRandom
      ? candidates[Math.floor(Math.random() * candidates.length)]
      : candidates[0];
    used.push(idx);
    while (used.length > 3) { used.shift(); }
    recent[gKey] = used;
    return idx;
  }

  /** 命中组 → 按当前语气取模板（缺失回落 gentle）→ 去重选句 → 占位符替换 */
  function groupText(group, c) {
    var tone = toneOf();
    var arr = group.lines[tone] || group.lines.gentle || [''];
    var idx = pickIndex(group.key, arr.length, true);
    return fillVars(arr[idx], c);
  }

  /* ------------------------------------------------------------------ */
  /* poke（戳一戳决策）与 line（常驻对话条文案）                           */
  /* ------------------------------------------------------------------ */

  /**
   * 戳一戳决策（architecture §1.4）：
   *   1) 距上次戳 < 3s → 刷新 lastPokeAt 并返回 null（调用方只重放弹跳动画）；
   *   2) 组选择：严格 G1→G8 顺序取第一个命中组，全不命中走 G0 兜底池（随机）；
   *   3) 组内选句：recent 去重；语气 TONE.normalize(get())，缺失回落 gentle；
   *   4) fillVars 替换占位符；cmd 取 MOOD_META[当前mood].cmd，由 app.js 送入
   *      handleSend 走既有 data-cmd 路由（零路由改动）。
   * @param {Object} ctx { ov, state, money, persona }
   * @return {Object|null} { text, cmd, groupKey, mood } | null（防刷窗口内）
   */
  function poke(ctx) {
    var now = Date.now();
    if (now - lastPokeAt < POKE_GAP) {
      lastPokeAt = now;
      return null;
    }
    lastPokeAt = now;
    var c = normalizeCtx(ctx);
    var g = firstHit(c);
    var text;
    var gKey;
    if (g) {
      text = groupText(g, c);
      gKey = g.key;
    } else {
      var idx = pickIndex('G0', FALLBACK_LINES.length, true);
      text = fillVars(FALLBACK_LINES[idx], c);
      gKey = 'G0';
    }
    var mood = resolveMood(c.ov);
    var meta = MOOD_META[mood] || MOOD_META.chill;
    return { text: text, cmd: meta.cmd, groupKey: gKey, mood: mood };
  }

  /**
   * 常驻对话条文案：同一话术池，但不做节流与随机（确定性取组内第一条），
   * 这样 renderSceneChips 反复刷新时文案稳定不闪。取不到任何命中时用兜底池第一条。
   */
  function line(ctx) {
    var c = normalizeCtx(ctx);
    var g = firstHit(c);
    if (g) {
      var tone = toneOf();
      var arr = g.lines[tone] || g.lines.gentle || [''];
      return fillVars(arr[0], c);
    }
    return fillVars(FALLBACK_LINES[0], c);
  }

  /* ------------------------------------------------------------------ */

  /**
   * 动作回应：针对刚刚发生的那一个动作说话（不是「结合账本现状吐槽」）。
   * ctx 除 { ov, state, money } 外，可带 act: { amount, cat, note, count }。
   * 有 goal 为 null 时的专属文案（linesNoGoal），避免出现「离—还差—」。
   * @param {string} key bill_logged/income_logged/piggy_in/piggy_out/cooldown_block/impulse_flag/goal_done
   * @param {Object} ctx
   * @return {string} 未知 key 返回空串（调用方自行降级到 line()）
   */
  function actionLine(key, ctx) {
    var entry = ACTION_LINES[key];
    if (!entry) { return ''; }
    var c = normalizeCtx(ctx);
    var tone = toneOf();
    var useNoGoal = !!(entry.linesNoGoal && !nearestGoal(c));
    var bag = (useNoGoal ? entry.linesNoGoal : entry.lines);
    var arr = bag[tone] || bag.gentle || [];
    if (!arr.length) { return ''; }
    var idx = Math.floor(Math.random() * arr.length);
    if (idx >= arr.length) { idx = 0; }
    return fillVars(arr[idx], c);
  }

  /** 动作默认情绪（app.js petReact 用于切光环/动画） */
  function actionMood(key) {
    var e = ACTION_LINES[key];
    return (e && e.mood) ? e.mood : null;
  }

  /* ------------------------------------------------------------------ */

  var API = {
    KEYS: KEYS,
    MOOD_META: MOOD_META,
    EVENT_MOOD: EVENT_MOOD,
    POKE_GAP: POKE_GAP,
    POOLS: POOLS,
    FALLBACK_LINES: FALLBACK_LINES,
    VARS: VARS,
    resolveMood: resolveMood,
    onEvent: onEvent,
    getActiveEvent: getActiveEvent,
    tick: tick,
    onMoodChange: onMoodChange,
    moodSvg: moodSvg,
    poke: poke,
    line: line,
    actionLine: actionLine,
    actionMood: actionMood,
    ACTION_LINES: ACTION_LINES,
    fillVars: fillVars
  };

  if (isNode) {
    module.exports = API;
  } else {
    global.AJ = global.AJ || {};
    global.AJ.mascot = API;
  }
})(typeof window !== 'undefined' ? window : this);
