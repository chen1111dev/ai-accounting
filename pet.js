/**
 * pet.js — 存钱罐精灵：右下角悬浮吉祥物（可选宠物形象之一，UMD）
 *
 * 定位：纯增强模块，**不碰任何账本数据与业务状态**。
 *   ① 悬浮精灵：粉色棉花糖身体 + 蓝色星星睡帽 + 条纹衫 + 黄色小兔伙伴，
 *      内联 SVG 手绘，fixed 定位不占文档流；idle 呼吸 + 眨眼；
 *      存钱 / 记账 / 出错时切换表情动画 + 气泡话术；
 *   ② 随界面移动：不同页面有不同的默认停靠位（CSS 按 body[data-view] 驱动，
 *      带平滑过渡），切页时精灵会滑过去；
 *   ③ 可拖拽：按住即拖，随手放下并记住位置（localStorage）；
 *      双击 / 双击点按回到默认停靠位；
 *   ④ 金额分档反馈（存入金额，元）：<10 轻微 / 10–50 中间 / 50–100 偏大 / ≥100 最大，
 *      跳跃动画由小到夸张，音效与震动统一交给 AJ.sfx（两个形象共用一套声效）；
 *   ⑤ 不自动挂载：由 app.js 按「宠物形象」设置调 setActive(true/false) 控制，
 *      与阿账浮层（#ajPet）互斥 —— 两者都钉在右下角，同时出现会打架。
 *
 * 与阿账的分工（用户可二选一）：
 *   阿账     —— 9 态情绪状态机 + PNG 形象 + 顶部对话条，情绪表达最完整
 *   存钱罐精灵 —— 6 态表情 + SVG 手绘 + 拖拽更顺手，视觉更轻松
 *
 * 对外 API（window.AJ.petSprite）：
 *   setActive(bool)     挂载 / 隐藏（重复调用安全）
 *   isActive()          当前是否挂载中
 *   react(name, opts)   触发反馈：name ∈ save|income|focus|spend|error|poke
 *                       opts.cents：存入金额（分），决定 save 的分档强度
 *                       opts.amt：展示金额文本
 *   poke()              等于 react('poke')
 *
 * 状态存独立键 ai_jizhang_sprite_v1（只存拖拽位置），开关状态在 sfx.js。
 */
(function (global) {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  if (isNode) { module.exports = {}; return; } // 纯浏览器增强模块，无单测面

  var DOC = global.document;
  var KEY = 'ai_jizhang_sprite_v1';

  /* ------------------------------------------------------------------ */
  /* 拖拽位置持久化（只管位置，不管开关）                                    */
  /* ------------------------------------------------------------------ */

  var store = { pos: null }; // pos: {left, top}（CSS px）
  try {
    var raw = global.localStorage ? global.localStorage.getItem(KEY) : null;
    if (raw) {
      var o = JSON.parse(raw);
      if (o && typeof o === 'object' && o.pos &&
          isFinite(Number(o.pos.left)) && isFinite(Number(o.pos.top))) {
        store.pos = { left: Number(o.pos.left), top: Number(o.pos.top) };
      }
    }
  } catch (e) { /* 坏档 / 隐私模式：保持默认 */ }

  function persist() {
    try {
      if (global.localStorage) { global.localStorage.setItem(KEY, JSON.stringify(store)); }
    } catch (e) { /* 写不进去就只用内存态 */ }
  }

  /* ------------------------------------------------------------------ */
  /* 金额分档 → 动画强度（音效分档由 AJ.sfx 自己算，保持同源）                */
  /* ------------------------------------------------------------------ */

  /** 金额（分）→ 分档 0..3，与 sfx.js 的 tierOf 同口径 */
  function tierOf(cents) {
    var sfx = global.AJ && global.AJ.sfx;
    if (sfx && typeof sfx.tierOf === 'function') { return sfx.tierOf(cents); }
    var yuan = (Number(cents) || 0) / 100;
    if (yuan >= 100) { return 3; }
    if (yuan >= 50) { return 2; }
    if (yuan >= 10) { return 1; }
    return 0;
  }

  /** 统一出口：音效 + 震动都走 sfx.js（缺模块时静默，主流程不受影响） */
  function feedback(name, opts) {
    var sfx = global.AJ && global.AJ.sfx;
    if (sfx && typeof sfx.both === 'function') { sfx.both(name, opts); }
  }

  /* ------------------------------------------------------------------ */
  /* 精灵 DOM（内联 SVG，无外部图片）                                       */
  /* 造型：粉色棉花糖身体 + 蓝色星星睡帽 + 条纹衫 + 黄色小兔伙伴            */
  /* ------------------------------------------------------------------ */

  var root = null;
  var bubble = null;
  var faceTimer = 0;
  var bubbleTimer = 0;
  var lastReact = { name: '', at: 0 };
  /** 类名集中管理：表情态 / 气泡态 / 气泡方向分开存，避免定时器互相覆盖 */
  var faceState = 'idle';
  var bubbleOn = false;
  var flipBubble = false;   // 精灵贴左屏时气泡翻向右展开
  var userPlaced = false;   // 被用户拖拽过 → 不再跟随界面默认停靠位

  function syncClass() {
    if (!root) { return; }
    root.className = 'mascot mst-' + faceState + (bubbleOn ? ' show-bubble' : '') +
      (flipBubble ? ' flip-b' : '');
  }

  var SPRITE_SVG = '' +
    '<svg viewBox="0 0 120 124" aria-hidden="true">' +
    /* ---- 星星睡帽（先画，盖在头顶） ---- */
    '  <ellipse cx="58" cy="34" rx="46" ry="20" fill="#A5DBF4"/>' +
    '  <path d="M88 24 Q118 14 114 36 Q112 48 100 44 Q90 40 88 30 Z" fill="#A5DBF4"/>' +
    '  <path d="M114 20 l2.6 6 6 2.6 -6 2.6 -2.6 6 -2.6 -6 -6 -2.6 6 -2.6 Z" fill="#FFF3A6"/>' +
    /* 帽檐（奶白波浪） */
    '  <ellipse cx="58" cy="45" rx="44" ry="9" fill="#EAF8FF"/>' +
    /* 帽面小星星 */
    '  <path d="M40 28 l1.8 4 4 1.8 -4 1.8 -1.8 4 -1.8 -4 -4 -1.8 4 -1.8 Z" fill="#FFF3A6"/>' +
    '  <path d="M66 20 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6 Z" fill="#FFF3A6"/>' +
    '  <path d="M80 34 l1.4 3 3 1.4 -3 1.4 -1.4 3 -1.4 -3 -3 -1.4 3 -1.4 Z" fill="#FFF3A6"/>' +
    /* ---- 棉花糖身体（圆 + 一圈绒球） ---- */
    '  <circle cx="100" cy="66" r="7.5" fill="#FFC8D8"/>' +
    '  <circle cx="88.3" cy="94.3" r="7.5" fill="#FFC8D8"/>' +
    '  <circle cx="60" cy="106" r="7.5" fill="#FFC8D8"/>' +
    '  <circle cx="31.7" cy="94.3" r="7.5" fill="#FFC8D8"/>' +
    '  <circle cx="20" cy="66" r="7.5" fill="#FFC8D8"/>' +
    '  <circle cx="31.7" cy="37.7" r="7.5" fill="#FFC8D8"/>' +
    '  <circle cx="88.3" cy="37.7" r="7.5" fill="#FFC8D8"/>' +
    '  <circle cx="60" cy="66" r="40" fill="#FFD0DE"/>' +
    /* 腮红 */
    '  <ellipse cx="33" cy="72" rx="6.5" ry="4" fill="#FF9DB8" opacity="0.65"/>' +
    '  <ellipse cx="87" cy="72" rx="6.5" ry="4" fill="#FF9DB8" opacity="0.65"/>' +
    /* ---- 眼睛：默认豆豆眼 ---- */
    '  <g class="m-eyes m-eyes-open">' +
    '    <ellipse cx="45" cy="64" rx="4.4" ry="5.4" fill="#3A2E33"/>' +
    '    <ellipse cx="75" cy="64" rx="4.4" ry="5.4" fill="#3A2E33"/>' +
    '    <circle cx="46.6" cy="61.8" r="1.5" fill="#fff"/>' +
    '    <circle cx="76.6" cy="61.8" r="1.5" fill="#fff"/>' +
    '  </g>' +
    /* 开心眯眼 ^^ */
    '  <g class="m-eyes m-eyes-happy" fill="none" stroke="#3A2E33" stroke-width="3" stroke-linecap="round">' +
    '    <path d="M40 65 q5 -7 10 0"/>' +
    '    <path d="M70 65 q5 -7 10 0"/>' +
    '  </g>' +
    /* X 眼（出错） */
    '  <g class="m-eyes m-eyes-x" fill="none" stroke="#3A2E33" stroke-width="3" stroke-linecap="round">' +
    '    <path d="M41 60 l8 8 M49 60 l-8 8"/>' +
    '    <path d="M71 60 l8 8 M79 60 l-8 8"/>' +
    '  </g>' +
    /* 闭眼（打盹：弧线向下，app.js 闲置判定驱动，.mst-sleep 态显示） */
    '  <g class="m-eyes m-eyes-sleep" fill="none" stroke="#3A2E33" stroke-width="2.6" stroke-linecap="round">' +
    '    <path d="M40 64 q5 3.4 10 0"/>' +
    '    <path d="M70 64 q5 3.4 10 0"/>' +
    '  </g>' +
    /* ---- 嘴巴们 ---- */
    '  <path class="m-mouth m-mouth-smile" d="M55 78 q5 4 10 0" fill="none" stroke="#C25E6E" stroke-width="2.6" stroke-linecap="round"/>' +
    '  <g class="m-mouth m-mouth-open">' +
    '    <ellipse cx="60" cy="80" rx="6.5" ry="5" fill="#C25E6E"/>' +
    '    <path d="M55 83 q5 4 10 0" fill="#FF9DB8"/>' +
    '  </g>' +
    '  <circle class="m-mouth m-mouth-o" cx="60" cy="79" r="3.4" fill="#C25E6E"/>' +
    '  <path class="m-mouth m-mouth-worry" d="M54 82 q6 -5 12 0" fill="none" stroke="#C25E6E" stroke-width="2.6" stroke-linecap="round"/>' +
    '  <path class="m-mouth m-mouth-flat" d="M54 79 h12" fill="none" stroke="#C25E6E" stroke-width="2.6" stroke-linecap="round"/>' +
    /* ---- 条纹衫（蓝底白条 + 波点） ---- */
    '  <rect x="30" y="88" width="60" height="26" rx="9" fill="#7EC8EC"/>' +
    '  <rect x="30" y="94" width="60" height="5" fill="#EAF8FF"/>' +
    '  <rect x="30" y="105" width="60" height="5" fill="#EAF8FF"/>' +
    '  <circle cx="42" cy="102" r="1.8" fill="#EAF8FF"/>' +
    '  <circle cx="60" cy="91.5" r="1.8" fill="#EAF8FF"/>' +
    '  <circle cx="78" cy="102" r="1.8" fill="#EAF8FF"/>' +
    /* ---- 黄色小兔伙伴（右侧） ---- */
    '  <g>' +
    '    <ellipse cx="101" cy="80" rx="4" ry="11" fill="#FFE27A" transform="rotate(-14 101 80)"/>' +
    '    <ellipse cx="111" cy="80" rx="4" ry="11" fill="#FFE27A" transform="rotate(14 111 80)"/>' +
    '    <ellipse cx="106" cy="99" rx="12" ry="13" fill="#FFE27A"/>' +
    '    <ellipse cx="101.5" cy="82" rx="1.6" ry="6" fill="#FFC98A" transform="rotate(-14 101.5 82)"/>' +
    '    <ellipse cx="110.5" cy="82" rx="1.6" ry="6" fill="#FFC98A" transform="rotate(14 110.5 82)"/>' +
    '    <circle cx="102" cy="96" r="1.8" fill="#3A2E33"/>' +
    '    <circle cx="110" cy="96" r="1.8" fill="#3A2E33"/>' +
    '    <path d="M103.5 101 q2.5 2 5 0" fill="none" stroke="#C2903B" stroke-width="1.6" stroke-linecap="round"/>' +
    '  </g>' +
    /* ---- 脚 ---- */
    '  <ellipse cx="44" cy="114" rx="9" ry="6" fill="#FFC8D8"/>' +
    '  <ellipse cx="76" cy="114" rx="9" ry="6" fill="#FFC8D8"/>' +
    '</svg>';

  var LINES = {
    save: ['叮！钱钱进罐咯～', '又存下一笔，罐子更沉啦！', '攒钱使我快乐，嘿嘿。'],
    income: ['进账咯，好耶！', '收入到账，请查收～'],
    focus: ['要花多少钱呀？', '花之前，先想三秒～', '让我看看买啥…'],
    spend: ['呜…钱钱离家出走了。', '记下啦，下次少花一点点？', '花出去了，心疼一秒。'],
    error: ['咦，金额好像不对哦。', '再检查一下数字？'],
    poke: ['哼哼～我是存钱罐精灵！', '戳我干什么，快去存钱呀～', '嘿嘿，好痒。']
  };

  /** 存钱分档话术：档位越高越激动（{amt} 会替换成金额） */
  var LINES_SAVE_TIER = [
    '存下 {amt}，蚊子腿也是肉～',
    '叮！{amt} 进罐咯～',
    '{amt}！罐子更沉啦！',
    '哇，{amt}！大手笔！'
  ];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] || ''; }

  function build() {
    if (root || !DOC.body) { return; }
    root = DOC.createElement('div');
    root.className = 'mascot mst-idle';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="mascot-bubble"></div>' +
      '<div class="mascot-stage">' +
      '  <span class="mascot-coin">¥</span>' +
      '  <span class="mascot-coin">¥</span>' +
      '  <span class="mascot-coin">¥</span>' +
      '  <div class="mascot-pig">' + SPRITE_SVG + '</div>' +
      '</div>' +
      /* ⇄ 换一只：和阿账身上那颗是同一个 class（见 app.js 的 setupFloatingPet）。
         放在 .mascot-pig 之外 —— pig 才是拖拽/点按的监听点，按钮不进 pig 就不会误触。 */
      '<button type="button" class="pet-swap" aria-label="换一只宠物" title="换一只宠物">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M4.5 8.5h12M13.5 5.5l3 3-3 3M19.5 15.5h-12M10.5 12.5l-3 3 3 3"/></svg>' +
      '</button>';
    DOC.body.appendChild(root);
    bubble = root.querySelector('.mascot-bubble');
    var swap = root.querySelector('.pet-swap');
    if (swap) {
      /* 只认 AJ.switchPet 这一个人工出口：pet.js 不认识 app 的 settings/persist 细节 */
      swap.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      swap.addEventListener('click', function (e) {
        e.stopPropagation();
        if (global.AJ && typeof global.AJ.switchPet === 'function') { global.AJ.switchPet(); }
      });
    }
    var pig = root.querySelector('.mascot-pig');
    if (pig) {
      pig.addEventListener('click', function () {
      /* 走 app.js 的中央戳一戳判定（连点彩蛋 / 夜间 / 睡醒）；独立使用时退回本地 */
      if (global.AJ && typeof global.AJ.petPoke === 'function') { global.AJ.petPoke(); }
      else { react('poke'); }
    });
      enableDrag(pig);
    }
    // 上次拖拽过 → 恢复用户放置的位置
    if (store.pos) {
      applyUserPos(store.pos.left, store.pos.top, true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 拖拽                                                                  */
  /* ------------------------------------------------------------------ */

  /** 把精灵钉到指定 left/top（脱离 right/bottom + 视图位移的 CSS 锚定） */
  function applyUserPos(left, top, silent) {
    if (!root) { return; }
    var w = root.offsetWidth || 96;
    var h = root.offsetHeight || 104;
    left = Math.max(0, Math.min(global.innerWidth - w, left));
    top = Math.max(0, Math.min(global.innerHeight - h, top));
    root.style.left = left + 'px';
    root.style.top = top + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    root.style.transform = 'none';   // 清掉各视图的 translateX 位移
    userPlaced = true;
    flipBubble = left < 130;          // 太靠左时气泡翻向右展开
    syncClass();
    if (!silent) {
      store.pos = { left: left, top: top };
      persist();
    }
  }

  /** 长按复位：回到「跟随界面」的默认停靠位（由 enableDrag 的 900ms 长按触发） */
  function resetToDefault() {
    if (!root) { return; }
    root.style.left = '';
    root.style.top = '';
    root.style.right = '';
    root.style.bottom = '';
    root.style.transform = '';
    userPlaced = false;
    flipBubble = false;
    store.pos = null;
    persist();
    setFace('focus');
    showBubble('我回来啦～');
    feedback('poke');
  }

  /** 睡帽小互动：搬起时紧张，放下时说一句（6s 节流，别每次放下都唠叨） */
  var lastDropLine = 0;

  function enableDrag(pig) {
    var dragging = false;
    var moved = false;
    var suppressClick = false;
    var startX = 0, startY = 0, origLeft = 0, origTop = 0;
    var resetTimer = 0;

    pig.addEventListener('pointerdown', function (e) {
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      var r = root.getBoundingClientRect();
      origLeft = r.left;
      origTop = r.top;
      try { pig.setPointerCapture(e.pointerId); } catch (ignore) { /* 合成事件无指针 */ }
      if (root.className.indexOf(' dragging') === -1) { root.className += ' dragging'; }
      // 长按 900ms（按住不动）= 回默认位。
      // 原来这里用「350ms 内连点两下」判定 —— 用户想多戳几下看反应，第二下就被误判成
      // 双击，整个宠物跳回右下角（2026-10 用户反馈「反复点击会瞬移」的根因）。
      // 按住不动 900ms 才复位：poke 随便连点都不会动位置，与复位彻底解耦。
      if (resetTimer) { global.clearTimeout(resetTimer); }
      resetTimer = global.setTimeout(function () {
        resetTimer = 0;
        if (moved || !dragging) { return; }   // 已经拖动 / 已经松手就不复位
        resetToDefault();
        suppressClick = true;                 // 抬起时不要再戳一下
      }, 900);
    });

    pig.addEventListener('pointermove', function (e) {
      if (!dragging) { return; }
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 5) { return; }
      if (!moved) { setFace('focus'); }   // 刚抓起来：紧张脸（判定互动之一）
      moved = true;
      if (resetTimer) { global.clearTimeout(resetTimer); resetTimer = 0; }
      applyUserPos(origLeft + dx, origTop + dy, true);
    });

    var end = function () {
      if (!dragging) { return; }
      dragging = false;
      if (resetTimer) { global.clearTimeout(resetTimer); resetTimer = 0; }
      root.className = root.className.replace(/\s*dragging/g, '');
      if (moved) {
        suppressClick = true;   // 拖拽结尾的 click 不应触发 poke
        var r = root.getBoundingClientRect();
        store.pos = { left: Math.round(r.left), top: Math.round(r.top) };
        persist();
        flipBubble = r.left < 130;
        syncClass();
        var now = Date.now();
        if (now - lastDropLine > 6000) {
          lastDropLine = now;
          setFace('income');
          showBubble('搬好啦，这里视野不错～');
        }
      }
    };
    pig.addEventListener('pointerup', end);
    pig.addEventListener('pointercancel', end);

    // 拖拽结尾的 click 吃掉，不戳出 poke
    pig.addEventListener('click', function (e) {
      if (suppressClick) {
        suppressClick = false;
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    }, true); // 捕获阶段拦截，跑在普通 click 监听之前
  }

  /* ------------------------------------------------------------------ */
  /* 表情与气泡                                                            */
  /* ------------------------------------------------------------------ */

  /** 切表情：state 形如 'idle' / 'save' / 'save t3'（空格分隔的类） */
  function setFace(state) {
    faceState = state;
    // 先归零并强制一次 reflow：连续同名触发时动画也能从头重放
    if (root) { root.className = 'mascot'; void root.offsetWidth; }
    syncClass();
    if (faceTimer) { global.clearTimeout(faceTimer); }
    // 表情停留 1.6s 后回 idle；动画定义在状态类上，重设类名即可重放
    faceTimer = global.setTimeout(function () {
      faceState = 'idle';
      syncClass();
    }, 1600);
  }

  function showBubble(text) {
    if (!bubble) { return; }
    bubble.textContent = text;
    bubbleOn = true;
    syncClass();
    if (bubbleTimer) { global.clearTimeout(bubbleTimer); }
    bubbleTimer = global.setTimeout(function () {
      bubbleOn = false;
      syncClass();
    }, 2600);
  }

  /**
   * 触发一次反馈：表情动画 + 气泡必做。
   * 音效 + 震动默认由本模块发（独立使用时可直接调），
   * 但 app.js 的场景汇聚点会先统一发声再传 opts.silent=true，避免同一次记账响两声。
   * 同名事件 1.2s 内只算一次，避免连续 input 抖动刷屏。
   * @param {string} name save|income|focus|spend|error|poke
   * @param {Object} [opts] {cents: 存入金额（分，save 用），amt: 展示金额文本，silent: 不再发声}
   */
  function react(name, opts) {
    if (!LINES[name]) { return false; }
    var now = Date.now();
    if (lastReact.name === name && now - lastReact.at < 1200) { return false; }
    lastReact = { name: name, at: now };
    if (!root) { return false; }        // 未挂载（用户选了阿账）→ 静默
    var o = opts || {};
    var tier = (name === 'save') ? tierOf(o.cents) : 0;
    setFace(name === 'save' ? ('save t' + tier) : name);
    var line;
    if (o.line) {
      /* app.js 互动判定（夜间 / 大额 / 里程碑 / 预算紧张）带来的定制台词 */
      line = o.line;
    } else if (name === 'save' && o.amt) {
      line = LINES_SAVE_TIER[tier].replace('{amt}', o.amt);
    } else {
      line = pick(LINES[name]);
    }
    showBubble(line);
    if (!o.silent) { feedback(name, o); }
    return true;
  }

  /**
   * 登场问候：用户从阿账换到精灵时用。
   * 不复用 react('poke') —— poke 是随机文案，抽到「戳我干什么」这类话当欢迎语太冲。
   * 固定一句专属招呼，表情给笑脸 + 一声轻音效。
   */
  function greet() {
    if (!root) { return false; }
    setFace('income');
    showBubble('我搬过来啦，以后陪你一起记账～');
    feedback('income');
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* 挂载控制（由 app.js 的「宠物形象」设置驱动）                            */
  /* ------------------------------------------------------------------ */

  var active = false;

  function setActive(on) {
    on = !!on;
    active = on;
    if (on) {
      build();
      if (root) {
        root.classList.remove('is-hidden');
        // 重新显示时把上一次的残留表情清掉，别一出来就皱着眉
        faceState = 'idle';
        bubbleOn = false;
        syncClass();
      }
    } else if (root) {
      root.classList.add('is-hidden');
      if (faceTimer) { global.clearTimeout(faceTimer); faceTimer = 0; }
      if (bubbleTimer) { global.clearTimeout(bubbleTimer); bubbleTimer = 0; }
    }
    return active;
  }

  function isActive() { return active; }

  function poke() { return react('poke'); }

  /**
   * 自定义一句台词（app.js 互动判定的统一出口：连点晕了 / 深夜犯困 / 搬家等）。
   * face 省略时不换表情（配合 setSleep 保持睡脸）；不发声 —— 音效由 app.js 统一控。
   */
  function say(text, face) {
    if (!root || !text) { return false; }
    if (face) { setFace(face); }
    showBubble(String(text));
    return true;
  }

  /**
   * 打盹态开关（app.js 闲置判定用）：与 setFace 不同，sleep 会一直保持到
   * setSleep(false) —— 1.6s 自动回 idle 会把「睡着了」立刻变「醒了」，不一致。
   */
  function setSleep(on) {
    if (!root) { return false; }
    if (faceTimer) { global.clearTimeout(faceTimer); faceTimer = 0; }
    faceState = on ? 'sleep' : 'idle';
    syncClass();
    return true;
  }

  global.AJ = global.AJ || {};
  /** 当前拖拽位置记忆：没拖过（跟随界面默认位）返回 null */
  function getPos() {
    return store.pos ? { left: store.pos.left, top: store.pos.top } : null;
  }

  /** 钉到指定位置并写入记忆（app.js 切换形象时的「位置继承」用） */
  function setPos(left, top) {
    if (!root) { return false; }
    if (!isFinite(Number(left)) || !isFinite(Number(top))) { return false; }
    applyUserPos(Number(left), Number(top), false);
    return true;
  }

  global.AJ.petSprite = {
    setActive: setActive,
    isActive: isActive,
    react: react,
    greet: greet,
    poke: poke,
    say: say,
    setSleep: setSleep,
    getPos: getPos,
    setPos: setPos,
    /* 仅暴露给排障/测试用 */
    _tierOf: tierOf,
    _svg: SPRITE_SVG           /* 首次选宠弹窗展示真实形象（app.js petPickArt） */
  };
})(typeof window !== 'undefined' ? window : this);
