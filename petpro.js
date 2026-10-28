/**
 * petpro.js — 记账小管家：自定义形象 + 情境动作 + 绕行小猪 + 成就回馈（UMD）
 *
 * 来源：从「萌宠 pro」版整体移植，作为主版第三种可选宠物形象。
 * 与主版既有两形象并列（settings.mascot.skin）：
 *   azhang 阿账（PNG 9 态情绪，app.js 浮层）
 *   sprite 存钱罐精灵（SVG 6 态，pet.js）
 *   pro    记账小管家（本文件，参数化小人 + 绕行小猪 + 形象工坊）
 *
 * 定位：纯增强模块，**不碰任何账本数据与业务状态**。
 *
 *   ① 自定义形象：用户上传一张图 → 本地 Canvas 提取主色调 → 参数化生成
 *      「多邻国风格」卡通小人（粗描边 / 圆滚身体 / 大眼睛），可选把照片
 *      做成圆形脸贴在身上。生成结果存 localStorage，缺图时回退默认形象。
 *   ② 情境动作（待机也不呆）：
 *        idle   呼吸 + 眨眼 + 目光跟小猪；每隔十几秒随机表演数钱 / 翻书 / 投币
 *        learn  进入理财知识（教练 / 省钱助手）界面 → 戴眼镜 + 翻理财书
 *        save   举手把金币投进小猪罐（金币飞过去，小猪接住蹦一下）
 *        spend / income / error / poke 各有对应动作
 *   ③ 小猪存钱罐：通体金黄 + 红色繁体「财」，始终绕小人做椭圆轨道运动，
 *      带前后景深（近大远小、被小人遮挡）与左右撬动的走路感；
 *      小人瞳孔实时跟随小猪位置。
 *   ④ 成就回馈：连击 combo（连续存钱，音高逐级上扬）、累计里程碑横幅、
 *      金币 / 星星 / 爱心 / 音符粒子，反馈夸张但不吵。
 *   ⑤ 金额分档：存入 <¥10 / 10–50 / 50–100 / ≥¥100 四档，震动、音效、
 *      跳跃幅度逐级递进。
 *   ⑥ 音效与震动统一交给 AJ.sfx（sfx.js，三形象共用一套声效体系）；
 *      本模块只发「场景名 + 金额」，不再自带 AudioContext。
 *   ⑦ 可拖拽：按住即拖、记住位置、双击回默认位；随界面切换平滑换停靠位。
 *
 * 命名隔离（关键）：本模块的整套 CSS 类名统一加 pm- 前缀
 * （.pm-mascot / .pm-mst-* / .pm-scn-* / .pm-msk-* / .pm-m-*），
 * 因为主版 pet.js 的精灵占用着同名但语义不同的 .mascot / .mst-*；
 * JS 与 styles.css 必须同步改，grep 可交叉核对。
 *
 * 对外 API（window.AJ.petPro）：
 *   setActive(bool)     挂载 / 隐藏（重复调用安全；由 app.js 的「宠物形象」设置驱动）
 *   isActive()          当前是否挂载中
 *   react(name, opts)   name ∈ save|income|focus|spend|error|poke|learn
 *                       opts.cents 存入金额（分，save 分档用）；opts.amt 展示文本
 *                       opts.silent 为 true 时只演不响（声音已由 app.js 统一发过）
 *   greet()             登场问候（换到本形象时说一句专属招呼）
 *   poke()              等于 react('poke')
 *   setScene(name)      直接切情境（idle|learn）
 *   openStudio()        打开「自定义形象」面板
 *   isEnabled/setEnabled 音效震动开关（代理到 AJ.sfx，保持单一真相）
 *
 * 状态存独立键 ai_jizhang_mascot_v2（会迁移 pro 旧键 ai_jizhang_mascot_v1），
 * 与主版精灵的 ai_jizhang_sprite_v1、音效的 ai_jizhang_sfx_v1 完全分开。
 */
(function (global) {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  if (isNode) { module.exports = {}; return; } // 纯浏览器增强模块，无单测面

  var DOC = global.document;
  var KEY = 'ai_jizhang_mascot_v2';
  var OLD_KEY = 'ai_jizhang_mascot_v1';

  /* ================================================================== */
  /* 持久化                                                              */
  /* ================================================================== */

  var settings = { enabled: true, pos: null, profile: null, totalSaved: 0 };

  try {
    var raw = global.localStorage ? global.localStorage.getItem(KEY) : null;
    if (!raw && global.localStorage) { raw = global.localStorage.getItem(OLD_KEY); } // 迁移旧档
    if (raw) {
      var o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        settings.enabled = o.enabled !== false;
        if (o.pos && isFinite(Number(o.pos.left)) && isFinite(Number(o.pos.top))) {
          settings.pos = { left: Number(o.pos.left), top: Number(o.pos.top) };
        }
        if (o.profile && typeof o.profile === 'object') { settings.profile = o.profile; }
        settings.totalSaved = Number(o.totalSaved) || 0;
      }
    }
  } catch (e) { /* 坏档 / 隐私模式：保持默认 */ }

  function persist() {
    try {
      if (global.localStorage) { global.localStorage.setItem(KEY, JSON.stringify(settings)); }
    } catch (e) { /* 写不进去就只用内存态 */ }
  }

  /* ================================================================== */
  /* 音效出口：全部转给 AJ.sfx（sfx.js），开关也只有那一处真相            */
  /* ================================================================== */

  function sfxApi() { return (global.AJ && global.AJ.sfx) || null; }

  function isEnabled() {
    var sfx = sfxApi();
    if (sfx && typeof sfx.isEnabled === 'function') { return !!sfx.isEnabled(); }
    return !!settings.enabled;
  }

  function setEnabled(v) {
    settings.enabled = !!v;
    persist();
    var sfx = sfxApi();
    if (sfx && typeof sfx.setEnabled === 'function') { sfx.setEnabled(settings.enabled); }
    return settings.enabled;
  }

  /**
   * 本模块唯一的发声出口。
   * 'milestone' / 'combo' 是成就专用音（sfx.js 另开两个 API），
   * 其余场景名直接交给 sfx.both（它内部已带震动与开关判断）。
   * @param {string} name save|income|focus|spend|error|poke|learn|milestone|combo
   * @param {Object} [opts] {cents: 金额（分）, n: 连击数, silent: 只演不响}
   */
  function feedback(name, opts) {
    var o = opts || {};
    if (o.silent) { return; }
    var sfx = sfxApi();
    if (!sfx) { return; }
    if (name === 'milestone') {
      if (typeof sfx.milestone === 'function') { sfx.milestone(); }
      return;
    }
    if (name === 'combo') {
      if (typeof sfx.combo === 'function') { sfx.combo(o.n || 1); }
      return;
    }
    if (typeof sfx.both === 'function') { sfx.both(name, { cents: o.cents }); }
  }

  /* ================================================================== */
  /* 金额分档                                                            */
  /* ================================================================== */

  /** 存入金额（分）→ 档：0(<¥10) / 1(¥10–50) / 2(¥50–100) / 3(≥¥100) */
  function tierOf(cents) {
    var sfx = sfxApi();
    if (sfx && typeof sfx.tierOf === 'function') { return sfx.tierOf(cents); }
    var yuan = (Number(cents) || 0) / 100;
    if (yuan >= 100) { return 3; }
    if (yuan >= 50) { return 2; }
    if (yuan >= 10) { return 1; }
    return 0;
  }

  /* ================================================================== */
  /* 颜色工具                                                            */
  /* ================================================================== */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    function hx(v) {
      var n = Math.round((v + m) * 255);
      n = clamp(n, 0, 255);
      var s2 = n.toString(16);
      return s2.length < 2 ? ('0' + s2) : s2;
    }
    return '#' + hx(r) + hx(g) + hx(b);
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    var l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) { h = ((g - b) / d + (g < b ? 6 : 0)); }
      else if (mx === g) { h = (b - r) / d + 2; }
      else { h = (r - g) / d + 4; }
      h *= 60;
    }
    return { h: h, s: s, l: l };
  }

  /* ================================================================== */
  /* 图片 → 调色板（本地 Canvas，无网络、无后端）                          */
  /* ================================================================== */

  /** 把图片压成小图 dataURL（localStorage 存得起） */
  function compress(img, size, q) {
    var c = DOC.createElement('canvas');
    c.width = size; c.height = size;
    var g = c.getContext('2d');
    if (!g) { return ''; }
    var side = Math.min(img.width, img.height);
    var sx = (img.width - side) / 2, sy = (img.height - side) / 2;
    g.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    try { return c.toDataURL('image/jpeg', q || 0.72); } catch (e) { return ''; }
  }

  /**
   * 提取主色调：色相分 18 桶 + 灰度桶，取权重（数量 × 饱和度）最高的若干桶。
   * 跳过接近纯白/纯黑与低饱和的像素，避免背景色污染主体色。
   */
  function extractPalette(img) {
    var c = DOC.createElement('canvas');
    c.width = 48; c.height = 48;
    var g = c.getContext('2d');
    if (!g) { return []; }
    g.drawImage(img, 0, 0, 48, 48);
    var data;
    try { data = g.getImageData(0, 0, 48, 48).data; } catch (e) { return []; }
    var buckets = [];
    var i;
    for (i = 0; i < 18; i++) { buckets.push({ h: i * 20 + 10, w: 0, r: 0, g: 0, b: 0 }); }
    var gray = { h: 0, w: 0, r: 0, g: 0, b: 0, isGray: true };
    for (i = 0; i < data.length; i += 4) {
      var r = data[i], gg = data[i + 1], b = data[i + 2];
      var hsl = rgbToHsl(r, gg, b);
      if (hsl.l > 0.94 || hsl.l < 0.08) { continue; }          // 近白 / 近黑
      var weight = hsl.s < 0.12 ? 0.25 : (0.25 + hsl.s);        // 灰的权重低
      var bucket = hsl.s < 0.12 ? gray : buckets[Math.floor(hsl.h / 20) % 18];
      bucket.w += weight;
      bucket.r += r * weight; bucket.g += gg * weight; bucket.b += b * weight;
    }
    var out = [];
    var all = buckets.concat([gray]);
    for (i = 0; i < all.length; i++) {
      if (all[i].w <= 0) { continue; }
      out.push({
        w: all[i].w,
        r: all[i].r / all[i].w,
        g: all[i].g / all[i].w,
        b: all[i].b / all[i].w
      });
    }
    out.sort(function (a, b2) { return b2.w - a.w; });
    return out.slice(0, 5).map(function (p) {
      var hsl = rgbToHsl(p.r, p.g, p.b);
      return { h: hsl.h, s: hsl.s, l: hsl.l };
    });
  }

  /* ================================================================== */
  /* 形象 profile：调色板 → 卡通小人配色                                   */
  /* ================================================================== */

  /**
   * 由主色生成一套「粉彩卡通」配色：
   *   主体色提亮到 L∈[0.62,0.82]，描边为主体色压暗到 L≈0.28，
   *   肚皮更亮、腮红偏红、配件取第二/第三色。
   */
  function profileFromPalette(pal, variant) {
    var n = Math.max(1, pal.length);
    var pickIdx = variant % n;
    var pick = pal[pickIdx] || pal[0] || { h: 340, s: 0.6, l: 0.72 };
    // 调色板不足 3 色时，给多余变体做色相偏移，保证三个小人长得不一样
    var hueShift = (variant >= n) ? (variant + 1) * 24 : variant * 7;
    var bodyH = pick.h + hueShift;
    var bodyS = clamp(pick.s * 0.9 + 0.12, 0.32, 0.78);
    var bodyL = clamp(pick.l * 0.62 + 0.32, 0.62, 0.82);
    var acc = pal[(variant + 1) % n] || { h: (bodyH + 150) % 360, s: 0.6, l: 0.6 };
    var accH = acc.h;
    return {
      body: hslToHex(bodyH, bodyS, bodyL),
      shade: hslToHex(bodyH, bodyS * 0.9, clamp(bodyL - 0.14, 0.3, 0.7)),
      belly: hslToHex(bodyH, clamp(bodyS * 0.55, 0.2, 0.6), clamp(bodyL + 0.16, 0.7, 0.94)),
      cheek: hslToHex(clamp(bodyH, 0, 30), 0.72, 0.66),
      line: hslToHex(bodyH, clamp(bodyS * 0.8, 0.2, 0.7), 0.26),
      accent: hslToHex(accH, clamp(acc.s * 0.8 + 0.2, 0.35, 0.8), clamp(acc.l * 0.5 + 0.34, 0.52, 0.74)),
      accent2: hslToHex((accH + 24) % 360, 0.5, 0.86),
      hat: variant % 3,          // 0 星星睡帽 / 1 学士帽 / 2 呆毛 + 发带
      face: null,                // 照片脸（dataURL），由开关填
      src: 'image'
    };
  }

  /** 默认形象：白萝卜小管家（白身 + 绿芽呆毛 + 手拿绿色计算器，2026-10 用户指认的原版样子） */
  function defaultProfile() {
    return {
      body: '#FDFDF6', shade: '#E3EAD9', belly: '#FFFFFF', cheek: '#BFE3B4',
      line: '#4E5B4E', accent: '#5BB56A', accent2: '#DDF2D8',
      hat: 2, face: null, src: 'default'
    };
  }

  function profile() { return settings.profile || defaultProfile(); }

  /* ================================================================== */
  /* 小人 SVG（参数化，多邻国风格：粗描边 + 圆滚 + 大眼）                  */
  /* ================================================================== */

  var STROKE = 3.2;

  function hatSVG(p) {
    var L = p.line;
    if (p.hat === 1) {
      // 学士帽（理财学霸）
      return '<g class="pm-m-hat" stroke="' + L + '" stroke-width="' + STROKE + '" stroke-linejoin="round">' +
        '<path d="M22 30 q28 -16 56 0 q-28 16 -56 0Z" fill="' + p.accent + '"/>' +
        '<path d="M28 31 v10 q22 8 44 0 v-10" fill="' + p.accent + '"/>' +
        '<path d="M74 32 q16 6 12 22" fill="none" stroke="' + L + '" stroke-width="2.4"/>' +
        '<circle cx="86" cy="55" r="4" fill="' + p.accent2 + '" stroke="' + L + '" stroke-width="2.4"/>' +
        '</g>';
    }
    if (p.hat === 2) {
      // 呆毛 + 发带
      return '<g class="pm-m-hat" stroke="' + L + '" stroke-width="' + STROKE + '" stroke-linejoin="round">' +
        '<path d="M34 30 q16 -12 32 0" fill="' + p.accent + '"/>' +
        '<path d="M50 20 q-6 -12 4 -16 q4 8 -1 12" fill="none" stroke="' + L + '" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="66" cy="22" r="5" fill="' + p.accent2 + '" stroke="' + L + '" stroke-width="2.6"/>' +
        '</g>';
    }
    // 星星睡帽
    return '<g class="pm-m-hat" stroke="' + L + '" stroke-width="' + STROKE + '" stroke-linejoin="round">' +
      '<path d="M22 32 q28 -18 56 0 q-28 14 -56 0Z" fill="' + p.accent + '"/>' +
      '<path d="M74 30 q18 -6 20 12 q-2 10 -12 8 q-8 -2 -8 -20Z" fill="' + p.accent + '"/>' +
      '<path d="M94 24 l2.6 6.4 6.4 2.6 -6.4 2.6 -2.6 6.4 -2.6 -6.4 -6.4 -2.6 6.4 -2.6Z" fill="' + p.accent2 + '" stroke="none"/>' +
      '<path d="M20 34 q30 10 60 0" fill="none" stroke="' + L + '" stroke-width="2.6"/>' +
      '</g>';
  }

  function charSVG(p) {
    var L = p.line;
    var s = '<svg viewBox="0 0 100 112" aria-hidden="true" class="pm-m-char">';

    /* 手臂：两条，可单独做投币动作 */
    s += '<g class="pm-m-arm pm-m-arm-l" stroke="' + L + '" stroke-width="' + STROKE + '" stroke-linecap="round">' +
      '<path d="M20 62 q-9 8 -5 17" fill="none"/>' +
      '<circle class="pm-m-hand" cx="16" cy="80" r="6" fill="' + p.body + '"/>' +
      '</g>';
    s += '<g class="pm-m-arm pm-m-arm-r" stroke="' + L + '" stroke-width="' + STROKE + '" stroke-linecap="round">' +
      '<path d="M80 62 q9 8 5 17" fill="none"/>' +
      '<circle class="pm-m-hand" cx="84" cy="80" r="6" fill="' + p.body + '"/>' +
      '</g>';

    /* 脚 */
    s += '<g stroke="' + L + '" stroke-width="' + STROKE + '">' +
      '<ellipse cx="35" cy="101" rx="11" ry="7" fill="' + p.shade + '"/>' +
      '<ellipse cx="65" cy="101" rx="11" ry="7" fill="' + p.shade + '"/>' +
      '</g>';

    /* 身体（圆滚） + 肚皮 */
    s += '<ellipse class="pm-m-body" cx="50" cy="66" rx="36" ry="34" fill="' + p.body + '" stroke="' + L + '" stroke-width="' + STROKE + '"/>';
    s += '<ellipse cx="50" cy="74" rx="23" ry="21" fill="' + p.belly + '" opacity="0.95"/>';

    /* 照片脸（可选）：裁剪成圆贴在肚皮上 */
    if (p.face) {
      s += '<clipPath id="pmFaceClip"><circle cx="50" cy="70" r="19"/></clipPath>';
      s += '<image href="' + p.face + '" x="31" y="51" width="38" height="38" ' +
        'preserveAspectRatio="xMidYMid slice" clip-path="url(#pmFaceClip)"/>';
      s += '<circle cx="50" cy="70" r="19" fill="none" stroke="' + L + '" stroke-width="' + STROKE + '" opacity="0.85"/>';
    }

    /* 腮红 */
    s += '<ellipse cx="27" cy="70" rx="7" ry="4.6" fill="' + p.cheek + '" opacity="0.6"/>';
    s += '<ellipse cx="73" cy="70" rx="7" ry="4.6" fill="' + p.cheek + '" opacity="0.6"/>';

    /* 眼睛：眼白固定，瞳孔整组跟随小猪移动 */
    s += '<g class="pm-m-eyes pm-m-eyes-open">' +
      '<ellipse cx="39" cy="58" rx="8.5" ry="9.5" fill="#fff" stroke="' + L + '" stroke-width="2.6"/>' +
      '<ellipse cx="61" cy="58" rx="8.5" ry="9.5" fill="#fff" stroke="' + L + '" stroke-width="2.6"/>' +
      '<g class="pm-m-pupils">' +
      '<circle cx="39" cy="59" r="4.2" fill="' + L + '"/>' +
      '<circle cx="61" cy="59" r="4.2" fill="' + L + '"/>' +
      '<circle cx="40.6" cy="57.2" r="1.5" fill="#fff"/>' +
      '<circle cx="62.6" cy="57.2" r="1.5" fill="#fff"/>' +
      '</g></g>';
    /* 眯眼笑 */
    s += '<g class="pm-m-eyes pm-m-eyes-happy" fill="none" stroke="' + L + '" stroke-width="3.2" stroke-linecap="round">' +
      '<path d="M32 59 q7 -9 14 0"/><path d="M54 59 q7 -9 14 0"/></g>';
    /* 星星眼（大额 / 里程碑） */
    s += '<g class="pm-m-eyes pm-m-eyes-star" fill="' + L + '">' +
      '<path d="M39 50 l2.6 6.4 6.4 2.6 -6.4 2.6 -2.6 6.4 -2.6 -6.4 -6.4 -2.6 6.4 -2.6Z"/>' +
      '<path d="M61 50 l2.6 6.4 6.4 2.6 -6.4 2.6 -2.6 6.4 -2.6 -6.4 -6.4 -2.6 6.4 -2.6Z"/></g>';
    /* X 眼（出错） */
    s += '<g class="pm-m-eyes pm-m-eyes-x" fill="none" stroke="' + L + '" stroke-width="3.2" stroke-linecap="round">' +
      '<path d="M33 53 l12 12 M45 53 l-12 12"/><path d="M55 53 l12 12 M67 53 l-12 12"/></g>';
    /* 闭眼（打盹：弧线向下，app.js 闲置判定驱动，.pm-mst-sleep 态显示） */
    s += '<g class="pm-m-eyes pm-m-eyes-sleep" fill="none" stroke="' + L + '" stroke-width="3" stroke-linecap="round">' +
      '<path d="M33 60 q6 4.4 12 0"/><path d="M55 60 q6 4.4 12 0"/></g>';

    /* 嘴 */
    s += '<path class="pm-m-mouth pm-m-mouth-smile" d="M43 76 q7 6 14 0" fill="none" stroke="' + L + '" stroke-width="2.8" stroke-linecap="round"/>';
    s += '<g class="pm-m-mouth pm-m-mouth-open"><ellipse cx="50" cy="79" rx="8" ry="7" fill="' + p.shade + '" stroke="' + L + '" stroke-width="2.2"/>' +
      '<path d="M43 82 q7 6 14 0" fill="' + p.cheek + '"/></g>';
    s += '<circle class="pm-m-mouth pm-m-mouth-o" cx="50" cy="78" r="4.4" fill="' + p.shade + '" stroke="' + L + '" stroke-width="2.2"/>';
    s += '<path class="pm-m-mouth pm-m-mouth-worry" d="M42 82 q8 -7 16 0" fill="none" stroke="' + L + '" stroke-width="2.8" stroke-linecap="round"/>';
    s += '<path class="pm-m-mouth pm-m-mouth-flat" d="M43 78 h14" fill="none" stroke="' + L + '" stroke-width="2.8" stroke-linecap="round"/>';

    s += hatSVG(p);

    /* 常驻小计算器（管家的标志物，白萝卜原版形象）：右手扶着，绿壳浅绿屏。
       学习/翻书态由 CSS 隐藏，给眼镜和书让位 */
    s += '<g class="pm-m-calc" stroke="' + L + '" stroke-width="2.6" stroke-linejoin="round" transform="rotate(6 77 87)">' +
      '<rect x="66" y="74" width="22" height="26" rx="4" fill="' + p.accent + '"/>' +
      '<rect x="69" y="78" width="16" height="7" rx="1.5" fill="' + p.accent2 + '" stroke-width="1.8"/>' +
      '<path d="M69 89.5 h16 M69 94 h16 M74.5 89.5 v9 M80 89.5 v9" stroke="' + p.accent2 + '" stroke-width="1.6" fill="none"/>' +
      '</g>';

    /* 眼镜（学习态显示） */
    s += '<g class="pm-m-glasses" fill="none" stroke="' + p.accent + '" stroke-width="3">' +
      '<circle cx="39" cy="58" r="11"/><circle cx="61" cy="58" r="11"/>' +
      '<path d="M50 58 h0" /><path d="M28 56 l-8 -4"/><path d="M72 56 l8 -4"/></g>';

    /* 理财书（学习态显示，翻页动画由 CSS 驱动） */
    s += '<g class="pm-m-book">' +
      '<path class="pm-m-book-page pm-m-book-page-l" d="M18 96 q14 -6 30 -2 v14 q-16 -4 -30 2Z" fill="#FFFDF3" stroke="' + L + '" stroke-width="2.6"/>' +
      '<path class="pm-m-book-page pm-m-book-page-r" d="M82 96 q-14 -6 -30 -2 v14 q16 -4 30 2Z" fill="#FFFDF3" stroke="' + L + '" stroke-width="2.6"/>' +
      '<path class="pm-m-book-flip" d="M48 94 q-14 -5 -28 2 q14 -3 28 -2Z" fill="' + p.accent2 + '" stroke="' + L + '" stroke-width="2.2"/>' +
      '<path class="pm-m-book-line" d="M24 100 h10 M24 104 h8" stroke="' + p.accent + '" stroke-width="1.8" fill="none"/>' +
      '<path class="pm-m-book-line" d="M66 100 h10 M66 104 h8" stroke="' + p.accent + '" stroke-width="1.8" fill="none"/>' +
      '<path d="M48 96 v14" stroke="' + L + '" stroke-width="2.6"/>' +
      '</g>';

    s += '</svg>';
    return s;
  }

  /* ================================================================== */
  /* 小猪存钱罐：通体金黄 + 红色繁体「财」                                 */
  /* ================================================================== */

  function piggySVG() {
    return '<svg viewBox="0 0 56 48" aria-hidden="true" class="pm-m-piggy-svg">' +
      '<path d="M10 16 q-4 -12 6 -12 q4 0 5 6Z" fill="#E39A12" stroke="#8A5A08" stroke-width="2.6" stroke-linejoin="round"/>' +
      '<path d="M46 16 q4 -12 -6 -12 q-4 0 -5 6Z" fill="#E39A12" stroke="#8A5A08" stroke-width="2.6" stroke-linejoin="round"/>' +
      '<ellipse cx="28" cy="28" rx="23" ry="17" fill="#FFC61A" stroke="#8A5A08" stroke-width="3"/>' +
      '<path d="M12 22 q6 -8 16 -8" fill="none" stroke="#FFE79A" stroke-width="3" stroke-linecap="round" opacity="0.85"/>' +
      '<ellipse class="pm-m-piggy-slot" cx="28" cy="15" rx="8" ry="2.6" fill="#8A5A08"/>' +
      '<ellipse cx="50" cy="28" rx="7" ry="6" fill="#FFD84D" stroke="#8A5A08" stroke-width="2.6"/>' +
      '<circle cx="48.4" cy="27" r="1.4" fill="#8A5A08"/>' +
      '<circle cx="52" cy="27" r="1.4" fill="#8A5A08"/>' +
      '<circle class="pm-m-piggy-eye" cx="41" cy="23" r="2.2" fill="#4A3200"/>' +
      '<path d="M14 22 q3 -3 6 0" fill="none" stroke="#8A5A08" stroke-width="2" stroke-linecap="round"/>' +
      '<text class="pm-m-piggy-word" x="28" y="35" text-anchor="middle" ' +
      'font-family="KaiTi, STKaiti, SimSun, serif" font-size="17" font-weight="700" fill="#D92B2B">財</text>' +
      '<g stroke="#8A5A08" stroke-width="3" stroke-linecap="round">' +
      '<path class="pm-m-piggy-leg pm-m-piggy-leg-a" d="M18 43 v5"/>' +
      '<path class="pm-m-piggy-leg pm-m-piggy-leg-b" d="M38 43 v5"/>' +
      '</g></svg>';
  }

  /* ================================================================== */
  /* DOM                                                                 */
  /* ================================================================== */

  var root = null, bubble = null, charWrap = null, piggy = null, fxLayer = null,
    banner = null, comboEl = null, pupils = null;
  var active = false;
  var faceState = 'idle', bubbleOn = false, flipBubble = false, userPlaced = false;
  var faceTimer = 0, bubbleTimer = 0, actTimer = 0;
  var lastReact = { name: '', at: 0 };
  var scene = 'idle';          // idle | learn（由当前界面决定）
  var orbitT = 1.2;            // 小猪轨道相位
  var rafId = 0;
  var lastTs = 0;
  var combo = 0, comboAt = 0;

  function syncClass() {
    if (!root) { return; }
    root.className = 'pm-mascot pm-mst-' + faceState +
      (bubbleOn ? ' pm-show-bubble' : '') +
      (flipBubble ? ' pm-flip-b' : '') +
      ' pm-scn-' + scene +
      (active ? '' : ' pm-hidden');
  }

  function build() {
    if (root || !DOC.body) { return; }
    root = DOC.createElement('div');
    root.className = 'pm-mascot pm-mst-idle pm-scn-idle';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="pm-mascot-bubble"></div>' +
      '<div class="pm-mascot-banner"></div>' +
      '<div class="pm-mascot-combo"></div>' +
      '<div class="pm-mascot-fx"></div>' +
      '<div class="pm-mascot-piggy">' + piggySVG() + '</div>' +
      '<div class="pm-mascot-stage">' +
      '<div class="pm-mascot-char">' + charSVG(profile()) + '</div>' +
      '</div>' +
      /* ⇄ 换一只：与阿账 / 精灵身上那颗同 class（见 app.js 的 setupFloatingPet、pet.js 的 build）。
         放在 .pm-mascot-stage 之外 —— stage 才是拖拽/点按的监听点，按钮不进 stage 就不会误触。 */
      '<button type="button" class="pet-swap" aria-label="换一只宠物" title="换一只宠物">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M4.5 8.5h12M13.5 5.5l3 3-3 3M19.5 15.5h-12M10.5 12.5l-3 3 3 3"/></svg>' +
      '</button>';
    DOC.body.appendChild(root);
    bubble = root.querySelector('.pm-mascot-bubble');
    banner = root.querySelector('.pm-mascot-banner');
    comboEl = root.querySelector('.pm-mascot-combo');
    fxLayer = root.querySelector('.pm-mascot-fx');
    piggy = root.querySelector('.pm-mascot-piggy');
    charWrap = root.querySelector('.pm-mascot-char');
    pupils = root.querySelector('.pm-m-pupils');

    var hit = root.querySelector('.pm-mascot-stage');
    if (hit) {
      hit.addEventListener('click', function () {
        /* 走 app.js 的中央戳一戳判定（连点彩蛋 / 夜间 / 睡醒）；独立使用时退回本地 */
        if (global.AJ && typeof global.AJ.petPoke === 'function') { global.AJ.petPoke(); }
        else { react('poke'); }
      });
      enableDrag(hit);
    }
    var swap = root.querySelector('.pet-swap');
    if (swap) {
      /* 只认 AJ.switchPet 这一个人工出口：本模块不认识 app 的 settings/persist 细节 */
      swap.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      swap.addEventListener('pointerup', function (e) { e.stopPropagation(); });
      swap.addEventListener('click', function (e) {
        e.stopPropagation();
        if (global.AJ && typeof global.AJ.switchPet === 'function') { global.AJ.switchPet(); }
      });
    }
    if (settings.pos) { applyUserPos(settings.pos.left, settings.pos.top, true); }
    startOrbit();
  }

  /** 换形象后重绘小人 */
  function repaintChar() {
    if (!charWrap) { return; }
    charWrap.innerHTML = charSVG(profile());
    pupils = root ? root.querySelector('.pm-m-pupils') : null;
  }

  /* ================================================================== */
  /* 小猪绕行 + 目光跟随                                                  */
  /* ================================================================== */

  /** 椭圆轨道（.pm-mascot 容器坐标，140×112；小人中心约在 70,58） */
  var ORBIT = { cx: 70, cy: 56, rx: 46, ry: 15 };

  function startOrbit() {
    if (rafId || !root) { return; }
    var step = function (ts) {
      if (!root || !active) { rafId = 0; return; }
      if (!lastTs) { lastTs = ts; }
      var dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      if (!DOC.hidden) {
        // 存钱/投币时小猪跑快一点，平时慢慢绕
        var speed = (faceState.indexOf('save') === 0) ? 2.6 : 1.05;
        orbitT += dt * speed;
        layoutPiggy();
      }
      rafId = global.requestAnimationFrame(step);
    };
    rafId = global.requestAnimationFrame(step);
  }

  function layoutPiggy() {
    if (!piggy || !root) { return; }
    var t = orbitT;
    var cos = Math.cos(t), sin = Math.sin(t);
    var x = ORBIT.cx + ORBIT.rx * cos;
    var y = ORBIT.cy + ORBIT.ry * sin;
    var waddle = Math.sin(t * 4);                 // 左右撬动
    var hop = -Math.abs(Math.sin(t * 2)) * 4;     // 一颠一颠
    var depth = sin;                              // >0 前景（近），<0 背景（远）
    var scale = 1 + depth * 0.16;
    // 容器 140×112，小猪 46×40 → 居中偏移
    var left = x - 23;
    var top = y - 20 + hop + waddle * 1.6;
    piggy.style.transform = 'translate(' + left.toFixed(1) + 'px,' + top.toFixed(1) + 'px) ' +
      'scale(' + scale.toFixed(3) + ') rotate(' + (waddle * 7).toFixed(1) + 'deg)';
    piggy.classList.toggle('pm-behind', depth < 0);
    piggy.style.opacity = (0.82 + depth * 0.18).toFixed(2);

    // 目光跟随：瞳孔朝小猪方向偏移（SVG 用户单位；双眼中心≈容器 70,60）
    if (pupils) {
      var dx = (x - 70) * 0.11;
      var dy = (y - 60) * 0.09;
      pupils.setAttribute('transform',
        'translate(' + clamp(dx, -3.6, 3.6).toFixed(2) + ',' + clamp(dy, -2.6, 3.2).toFixed(2) + ')');
    }
  }

  /* ================================================================== */
  /* 拖拽                                                                */
  /* ================================================================== */

  function applyUserPos(left, top, silent) {
    if (!root) { return; }
    var w = root.offsetWidth || 140;
    var h = root.offsetHeight || 112;
    left = Math.max(0, Math.min(global.innerWidth - w, left));
    top = Math.max(0, Math.min(global.innerHeight - h, top));
    root.style.left = left + 'px';
    root.style.top = top + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    root.style.transform = 'none';
    userPlaced = true;
    flipBubble = left < 150;
    syncClass();
    if (!silent) {
      settings.pos = { left: left, top: top };
      persist();
    }
  }

  function resetToDefault() {
    if (!root) { return; }
    root.style.left = ''; root.style.top = '';
    root.style.right = ''; root.style.bottom = '';
    root.style.transform = '';
    userPlaced = false; flipBubble = false;
    settings.pos = null; persist();
    setFace('focus');
    showBubble('我回来啦～');
    feedback('poke');
  }

  var lastDropLine = 0;

  function enableDrag(el) {
    var dragging = false, moved = false, suppressClick = false;
    var startX = 0, startY = 0, origLeft = 0, origTop = 0, resetTimer = 0;

    el.addEventListener('pointerdown', function (e) {
      dragging = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      var r = root.getBoundingClientRect();
      origLeft = r.left; origTop = r.top;
      try { el.setPointerCapture(e.pointerId); } catch (ignore) { /* 合成事件无指针 */ }
      if (root.className.indexOf(' pm-dragging') === -1) { root.className += ' pm-dragging'; }
      // 长按 900ms（按住不动）= 回默认位。原「350ms 连点两下」判定会把用户连戳
      // 误判成双击，宠物直接跳回右下角（2026-10 用户反馈「反复点击会瞬移」的根因）。
      if (resetTimer) { global.clearTimeout(resetTimer); }
      resetTimer = global.setTimeout(function () {
        resetTimer = 0;
        if (moved || !dragging) { return; }   // 已经拖动 / 已经松手就不复位
        resetToDefault();
        suppressClick = true;                 // 抬起时不要再戳一下
      }, 900);
    });

    el.addEventListener('pointermove', function (e) {
      if (!dragging) { return; }
      var dx = e.clientX - startX, dy = e.clientY - startY;
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
      root.className = root.className.replace(/\s*pm-dragging/g, '');
      if (moved) {
        suppressClick = true;
        var r = root.getBoundingClientRect();
        settings.pos = { left: Math.round(r.left), top: Math.round(r.top) };
        persist();
        flipBubble = r.left < 150;
        syncClass();
        var now = Date.now();
        if (now - lastDropLine > 6000) {
          lastDropLine = now;
          setFace('income');
          showBubble('搬好啦，这位置不错～');
        }
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', function (e) {
      if (suppressClick) { suppressClick = false; e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
  }

  /* ================================================================== */
  /* 特效：粒子 / 金币飞行 / 横幅 / 连击                                   */
  /* ================================================================== */

  function burst(kind, n, opt) {
    if (!fxLayer) { return; }
    var o = opt || {};
    for (var i = 0; i < n; i++) {
      (function (k) {
        var el = DOC.createElement('span');
        el.className = 'pm-m pm-m-p-' + kind;
        var ang = (-Math.PI / 2) + (Math.random() - 0.5) * (o.spread || 2.4);
        var dist = (o.dist || 58) * (0.55 + Math.random() * 0.75);
        var dx = Math.cos(ang) * dist;
        var dy = Math.sin(ang) * dist;
        el.style.setProperty('--dx', dx.toFixed(1) + 'px');
        el.style.setProperty('--dy', dy.toFixed(1) + 'px');
        el.style.setProperty('--rot', (Math.random() * 720 - 360).toFixed(0) + 'deg');
        el.style.left = (46 + (Math.random() - 0.5) * 26).toFixed(0) + 'px';
        el.style.top = (54 + (Math.random() - 0.5) * 20).toFixed(0) + 'px';
        el.style.animationDelay = (k * 60 + Math.random() * 90).toFixed(0) + 'ms';
        if (kind === 'note' || kind === 'star') { el.textContent = kind === 'note' ? '♪' : '★'; }
        else if (kind === 'coin') { el.textContent = '¥'; }
        else { el.textContent = '♥'; }
        fxLayer.appendChild(el);
        global.setTimeout(function () { if (el.parentNode) { el.parentNode.removeChild(el); } }, 1500);
      })(i);
    }
  }

  /** 金币从小人手里飞到小猪罐口：投币动作的实体感 */
  function flyCoin() {
    if (!fxLayer || !piggy) { return; }
    var el = DOC.createElement('span');
    el.className = 'pm-m pm-m-p-coin pm-m-fly';
    el.textContent = '¥';
    var pr = root.getBoundingClientRect();
    var gr = piggy.getBoundingClientRect();
    var sx = 95, sy = 60;                                   // 右手举起位（容器坐标）
    var tx = gr.left - pr.left + gr.width / 2 - 6;
    var ty = gr.top - pr.top + 6;
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    fxLayer.appendChild(el);
    global.requestAnimationFrame(function () {
      el.style.transform = 'translate(' + (tx - sx).toFixed(0) + 'px,' + (ty - sy).toFixed(0) + 'px) scale(0.75)';
      el.style.opacity = '0.15';
    });
    global.setTimeout(function () { if (el.parentNode) { el.parentNode.removeChild(el); } }, 720);
  }

  function showBanner(text) {
    if (!banner) { return; }
    banner.textContent = text;
    banner.classList.add('pm-on');
    global.setTimeout(function () { banner.classList.remove('pm-on'); }, 2200);
  }

  function bumpCombo() {
    var now = Date.now();
    combo = (now - comboAt < 45000) ? combo + 1 : 1;   // 45s 内连续存钱算连击
    comboAt = now;
    if (combo >= 2 && comboEl) {
      comboEl.textContent = '×' + combo + ' 连存！';
      comboEl.classList.remove('pm-on'); void comboEl.offsetWidth;
      comboEl.classList.add('pm-on');
      feedback('combo', { n: combo });
      burst('star', Math.min(2 + combo, 7), { dist: 46 });
    }
    return combo;
  }

  /* 累计里程碑（分）：10 / 50 / 100 / 500 / 1000 元 */
  var MILESTONES = [1000, 5000, 10000, 50000, 100000];

  function checkMilestone(cents) {
    var before = settings.totalSaved;
    var after = before + (Number(cents) || 0);
    settings.totalSaved = after;
    persist();
    for (var i = 0; i < MILESTONES.length; i++) {
      var m = MILESTONES[i];
      if (before < m && after >= m) {
        var yuan = Math.round(m / 100);
        burst('coin', 12, { dist: 74, spread: 3 });
        burst('star', 8, { dist: 62 });
        showBanner('🎉 累计存下 ¥' + yuan + '！');
        setFace('milestone');
        showBubble('天呐，你已经攒了 ¥' + yuan + ' 啦！');
        feedback('milestone');
        global.setTimeout(function () { if (faceState === 'milestone') { setFace('idle'); } }, 2400);
        return true;
      }
    }
    return false;
  }

  /* ================================================================== */
  /* 表情 / 气泡 / 动作                                                   */
  /* ================================================================== */

  function setFace(state) {
    faceState = state;
    if (root) { root.className = 'pm-mascot'; void root.offsetWidth; }
    syncClass();
    if (faceTimer) { global.clearTimeout(faceTimer); }
    faceTimer = global.setTimeout(function () {
      faceState = 'idle';
      syncClass();
    }, (state.indexOf('save') === 0 || state === 'milestone') ? 2100 : 1600);
  }

  function showBubble(text) {
    if (!bubble) { return; }
    bubble.textContent = text;
    bubbleOn = true;
    syncClass();
    if (bubbleTimer) { global.clearTimeout(bubbleTimer); }
    bubbleTimer = global.setTimeout(function () { bubbleOn = false; syncClass(); }, 2600);
  }

  var LINES = {
    save: ['叮！钱钱进罐咯～', '又存下一笔，罐子更沉啦！', '攒钱使我快乐，嘿嘿。'],
    income: ['进账咯，好耶！', '收入到账，请查收～'],
    focus: ['要花多少钱呀？', '花之前，先想三秒～', '让我看看买啥…'],
    spend: ['呜…钱钱离家出走了。', '记下啦，下次少花一点点？', '花出去了，心疼一秒。'],
    error: ['咦，金额好像不对哦。', '再检查一下数字？'],
    poke: ['哼哼～我是你的记账小管家！', '戳我干什么，快去存钱呀～', '嘿嘿，好痒。'],
    learn: ['这块知识我要啃下来！', '学会一招，明天少花一笔～', '记账秘籍 +1 ！']
  };

  var LINES_SAVE_TIER = [
    '存下 {amt}，蚊子腿也是肉～',
    '叮！{amt} 进罐咯～',
    '{amt}！罐子更沉啦！',
    '哇，{amt}！大手笔！'
  ];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] || ''; }

  /**
   * 触发一次反馈。
   * 音效 + 震动默认由本模块发（走 AJ.sfx），但 app.js 的场景汇聚点会先统一发声
   * 再传 opts.silent=true，避免同一次记账响两声。
   * @param {string} name save|income|focus|spend|error|poke|learn
   * @param {Object} [opts] {cents, amt, silent}
   */
  function react(name, opts) {
    if (!active) { return false; }                      // 未挂载（用户选了别的形象）→ 静默
    if (!LINES[name]) { return false; }
    var now = Date.now();
    if (name !== 'save' && lastReact.name === name && now - lastReact.at < 1200) { return false; }
    lastReact = { name: name, at: now };
    build();
    if (!root) { return false; }
    var o = opts || {};

    if (name === 'save') {
      var tier = tierOf(o.cents);
      setFace('save pm-t' + tier);
      // 投币动作：金币飞向小猪 + 小猪接住蹦一下
      global.setTimeout(function () { flyCoin(); }, 220);
      global.setTimeout(function () {
        if (piggy) {
          piggy.classList.remove('pm-catch'); void piggy.offsetWidth;
          piggy.classList.add('pm-catch');
        }
        burst('coin', 2 + tier * 2, { dist: 40 + tier * 12 });
        if (tier >= 2) { burst('star', 3 + tier, { dist: 52 + tier * 10 }); }
      }, 480);
      showBubble(o.line || (o.amt ? LINES_SAVE_TIER[tier].replace('{amt}', o.amt) : pick(LINES.save)));
      if (tier >= 3) { burst('heart', 4, { dist: 46 }); }
      bumpCombo();
      feedback('save', { cents: o.cents, silent: o.silent });
      global.setTimeout(function () { checkMilestone(o.cents); }, 700);
      return true;
    }

    setFace(name);
    if (name === 'learn') {
      global.setTimeout(function () { burst('note', 3, { dist: 40 }); }, 400);
    } else if (name === 'spend') {
      burst('note', 2, { dist: 34 });
      if (o.big) { burst('star', 4, { dist: 52 }); }   // 大额：星星特效对齐阿账的 burst
    } else if (name === 'income') {
      burst('coin', 3, { dist: 40 });
    } else if (name === 'poke') {
      burst('heart', 2, { dist: 30 });
    }
    showBubble(o.line || pick(LINES[name]));
    feedback(name, { silent: o.silent });
    return true;
  }

  /**
   * 登场问候：用户换到本形象时说一句专属招呼。
   * 不复用 react('poke') —— poke 是随机文案，抽到「戳我干什么」当欢迎语太冲。
   */
  function greet() {
    if (!active) { return false; }
    build();
    if (!root) { return false; }
    setFace('income');
    showBubble('我是记账小管家，以后帮你把钱管住～');
    feedback('income');
    return true;
  }

  function poke() { return react('poke'); }

  /**
   * 自定义一句台词（app.js 互动判定的统一出口：连点晕了 / 深夜犯困 / 搬家等）。
   * face 省略时不换表情（配合 setSleep 保持睡脸）；不发声 —— 音效由 app.js 统一控。
   */
  function say(text, face) {
    if (!active || !text) { return false; }
    build();
    if (!root) { return false; }
    if (face) { setFace(face); }
    showBubble(String(text));
    return true;
  }

  /**
   * 打盹态开关（app.js 闲置判定用）：与 setFace 不同，sleep 会一直保持到
   * setSleep(false) —— 1.6s 自动回 idle 会把「睡着了」立刻变「醒了」，不一致。
   */
  function setSleep(on) {
    if (!active) { return false; }
    build();
    if (!root) { return false; }
    if (faceTimer) { global.clearTimeout(faceTimer); faceTimer = 0; }
    faceState = on ? 'sleep' : 'idle';
    syncClass();
    return true;
  }

  /** 待机小动作：不呆板，随机表演数钱 / 翻书 / 投币 */
  var IDLE_ACTS = ['act-count', 'act-read', 'act-save'];

  function scheduleIdleAct() {
    if (actTimer) { global.clearTimeout(actTimer); }
    var wait = 11000 + Math.random() * 9000;
    actTimer = global.setTimeout(function () {
      if (!root || !active || DOC.hidden) { scheduleIdleAct(); return; }
      if (faceState !== 'idle') { scheduleIdleAct(); return; }
      var act = IDLE_ACTS[Math.floor(Math.random() * IDLE_ACTS.length)];
      faceState = act;
      if (root) { root.className = 'pm-mascot'; void root.offsetWidth; }
      syncClass();
      if (act === 'act-save') { global.setTimeout(function () { flyCoin(); }, 300); }
      if (act === 'act-read') { global.setTimeout(function () { burst('note', 2, { dist: 34 }); }, 500); }
      if (act === 'act-count') { global.setTimeout(function () { burst('coin', 2, { dist: 30 }); }, 350); }
      if (act !== 'act-read') { feedback('poke'); }
      global.setTimeout(function () { faceState = 'idle'; syncClass(); }, 2000);
      scheduleIdleAct();
    }, wait);
  }

  /* ================================================================== */
  /* 情境：跟随界面（理财知识界面 → 学习态）                               */
  /* ================================================================== */

  /** 视为「学习理财知识」的界面 */
  var LEARN_VIEWS = { coach: 1, scoach: 1, ssave: 1, goals: 1, sgoals: 1 };

  function setScene(next) {
    if (next === scene) { return; }
    scene = next;
    syncClass();
    if (scene === 'learn') {
      react('learn');
      scheduleIdleAct();
    } else {
      setFace('idle');
    }
  }

  function watchView() {
    var apply = function () {
      var v = DOC.body ? DOC.body.getAttribute('data-view') : '';
      setScene(LEARN_VIEWS[v] ? 'learn' : 'idle');
    };
    apply();
    if (!DOC.body) { return; }
    if (global.MutationObserver) {
      var mo = new global.MutationObserver(function () { apply(); });
      mo.observe(DOC.body, { attributes: true, attributeFilter: ['data-view'] });
    }
  }

  /* ================================================================== */
  /* 自定义形象工坊                                                       */
  /* ================================================================== */

  var studio = null;
  var pending = { profiles: [], idx: 0, face: null, useFace: false };

  function studioHTML() {
    return '' +
      '<div class="pm-msk-mask" data-close="1"></div>' +
      '<div class="pm-msk-card" role="dialog" aria-label="自定义形象">' +
      '  <div class="pm-msk-head"><b>自定义我的形象</b>' +
      '    <button type="button" class="pm-msk-x" data-close="1" aria-label="关闭">×</button></div>' +
      '  <div class="pm-msk-body">' +
      '    <div class="pm-msk-preview"><div class="pm-msk-big" id="pmMskBig"></div></div>' +
      '    <div class="pm-msk-side">' +
      '      <label class="pm-msk-upload">' +
      '        <input type="file" id="pmMskFile" accept="image/*" hidden />' +
      '        <span class="pm-msk-upload-btn">📷 上传一张图，生成你的小人</span>' +
      '      </label>' +
      '      <p class="pm-msk-tip" id="pmMskTip">上传照片后会读出主色调、生成 3 个风格让你挑；现在看到的是当前小人。</p>' +
      '      <div class="pm-msk-variants" id="pmMskVars"></div>' +
      '      <label class="pm-msk-row"><span>用照片做小脸</span>' +
      '        <input type="checkbox" id="pmMskFace" /></label>' +
      '      <div class="pm-msk-acts">' +
      '        <button type="button" class="pm-msk-btn pm-msk-btn-ghost" id="pmMskReset">恢复默认</button>' +
      '        <button type="button" class="pm-msk-btn pm-msk-btn-main" id="pmMskSave">就用这个</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';
  }

  /** 把 profile 摊成 charSVG 需要的形状（照片脸按开关取舍） */
  function shownProfile(cur) {
    return {
      body: cur.body, shade: cur.shade, belly: cur.belly, cheek: cur.cheek,
      line: cur.line, accent: cur.accent, accent2: cur.accent2, hat: cur.hat,
      face: (pending.useFace && pending.face) ? pending.face : null
    };
  }

  /**
   * 同步「用照片做小脸」勾选框：没有可用照片时必须禁用（点了会闪一个空图）。
   * 面板 DOM 是复用的（关掉只是 display:none），所以每次重新显示都要重算一次，
   * 不能只在首次 build 时置一次 disabled。
   */
  function syncFaceChk() {
    if (!studio) { return; }
    var chk = studio.querySelector('#pmMskFace');
    if (!chk) { return; }
    chk.disabled = !pending.face;
    chk.checked = !!pending.useFace;
  }

  function renderStudio() {
    if (!studio) { return; }
    var big = studio.querySelector('#pmMskBig');
    var vars = studio.querySelector('#pmMskVars');
    if (!big || !vars) { return; }
    var list = pending.profiles.length ? pending.profiles : [profile()];
    var cur = list[Math.min(pending.idx, list.length - 1)];
    big.innerHTML = charSVG(shownProfile(cur));
    vars.innerHTML = '';
    for (var i = 0; i < list.length; i++) {
      (function (k) {
        var it = DOC.createElement('button');
        it.type = 'button';
        it.className = 'pm-msk-var' + (k === pending.idx ? ' pm-on' : '');
        it.innerHTML = charSVG(list[k]);
        it.addEventListener('click', function () {
          pending.idx = k;
          renderStudio();
        });
        vars.appendChild(it);
      })(i);
    }
  }

  function openStudio() {
    /* 每次打开都从已存形象反推 pending。
       否则 pending 是「空」的，预览走 shownProfile() 会把照片脸判成 null，
       打开工坊看到的小人跟角落里那只（repaintChar 用 profile() 全量）长得不一样。
       已存的 profile 视为「第 0 个变体」，没上传新图时列表里就它一个。 */
    var saved = settings.profile;
    pending = {
      profiles: [],
      idx: 0,
      face: (saved && saved.face) ? saved.face : null,
      useFace: !!(saved && saved.face)
    };
    if (studio) {
      studio.style.display = 'flex';
      syncFaceChk();
      renderStudio();
      return;
    }
    studio = DOC.createElement('div');
    studio.className = 'pm-mascot-studio';
    studio.innerHTML = studioHTML();
    DOC.body.appendChild(studio);

    studio.addEventListener('click', function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-close')) { closeStudio(); }
    });

    var file = studio.querySelector('#pmMskFile');
    var tip = studio.querySelector('#pmMskTip');
    var faceChk = studio.querySelector('#pmMskFace');

    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) { return; }
      var url = global.URL && global.URL.createObjectURL ? global.URL.createObjectURL(f) : '';
      var img = new global.Image();
      img.onload = function () {
        try {
          var pal = extractPalette(img);
          if (!pal.length) { tip.textContent = '这张图没读出颜色，换一张试试？'; return; }
          var made = [];
          for (var v = 0; v < 3; v++) { made.push(profileFromPalette(pal, v)); }
          pending.profiles = made;
          pending.idx = 0;
          pending.face = compress(img, 160, 0.72);
          pending.useFace = false;
          syncFaceChk();
          tip.textContent = '生成好啦！点下面的小人挑一个你喜欢的～';
          renderStudio();
          if (url && global.URL.revokeObjectURL) { global.URL.revokeObjectURL(url); }
        } catch (err) {
          tip.textContent = '生成失败：' + (err && err.message ? err.message : '图片读取出错');
        }
      };
      img.onerror = function () { tip.textContent = '这张图读不出来，换一张吧～'; };
      if (url) { img.src = url; }
    });

    if (faceChk) {
      faceChk.addEventListener('change', function () {
        pending.useFace = !!faceChk.checked && !!pending.face;
        renderStudio();
      });
    }
    syncFaceChk();

    var save = studio.querySelector('#pmMskSave');
    if (save) {
      save.addEventListener('click', function () {
        var list = pending.profiles.length ? pending.profiles : [defaultProfile()];
        var cur = list[Math.min(pending.idx, list.length - 1)];
        settings.profile = {
          body: cur.body, shade: cur.shade, belly: cur.belly, cheek: cur.cheek,
          line: cur.line, accent: cur.accent, accent2: cur.accent2, hat: cur.hat,
          face: (pending.useFace && pending.face) ? pending.face : null,
          src: 'image'
        };
        persist();
        repaintChar();
        setFace('save pm-t1');
        showBubble('新形象，喜欢吗？');
        feedback('poke');
        closeStudio();
        /* 播报条头像跟着新形象变（app.js 挂的钩子，缺钩子时静默跳过） */
        if (global.AJ && typeof global.AJ.onPetProProfileChange === 'function') {
          global.AJ.onPetProProfileChange();
        }
      });
    }

    var reset = studio.querySelector('#pmMskReset');
    if (reset) {
      reset.addEventListener('click', function () {
        settings.profile = null;
        persist();
        pending = { profiles: [], idx: 0, face: null, useFace: false };
        syncFaceChk();
        repaintChar();
        renderStudio();
        setFace('poke');
        showBubble('换回原来的我啦～');
        if (global.AJ && typeof global.AJ.onPetProProfileChange === 'function') {
          global.AJ.onPetProProfileChange();
        }
      });
    }

    renderStudio();
  }

  function closeStudio() {
    if (studio) { studio.style.display = 'none'; }
  }

  /* ================================================================== */
  /* 挂载控制（由 app.js 的「宠物形象」设置驱动，三形象互斥）              */
  /* ================================================================== */

  /**
   * 挂载 / 收起。
   * @param {boolean} on true 时建 DOM 并恢复停靠位；false 时隐藏并停掉所有定时器与动画帧
   */
  function setActive(on) {
    on = !!on;
    active = on;
    if (on) {
      build();
      if (root) {
        root.classList.remove('pm-hidden');
        // 重新显示时把上一次的残留表情清掉，别一出来就皱着眉
        faceState = 'idle';
        bubbleOn = false;
        syncClass();
        if (settings.pos) { applyUserPos(settings.pos.left, settings.pos.top, true); }
        startOrbit();
        scheduleIdleAct();
      }
    } else if (root) {
      root.classList.add('pm-hidden');
      if (faceTimer) { global.clearTimeout(faceTimer); faceTimer = 0; }
      if (bubbleTimer) { global.clearTimeout(bubbleTimer); bubbleTimer = 0; }
      if (actTimer) { global.clearTimeout(actTimer); actTimer = 0; }
      if (rafId && typeof global.cancelAnimationFrame === 'function') {
        global.cancelAnimationFrame(rafId);
      }
      rafId = 0;
      lastTs = 0;
    }
    return active;
  }

  function isActive() { return active; }

  /* ================================================================== */
  /* 初始化                                                              */
  /* ================================================================== */

  function init() {
    /* 不自动挂载：由 app.js 的 applyPetVisibility() 按当前形象调 setActive。
       这里只挂「界面 → 学习情境」的观察器，DOM 未建时 setScene 是安全的空操作。 */
    watchView();
  }

  if (DOC.readyState === 'loading') {
    DOC.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.AJ = global.AJ || {};
  /** 当前拖拽位置记忆：没拖过（跟随界面默认位）返回 null */
  function getPos() {
    return settings.pos ? { left: settings.pos.left, top: settings.pos.top } : null;
  }

  /** 钉到指定位置并写入记忆（app.js 切换形象时的「位置继承」用） */
  function setPos(left, top) {
    if (!root) { return false; }
    if (!isFinite(Number(left)) || !isFinite(Number(top))) { return false; }
    applyUserPos(Number(left), Number(top), false);
    return true;
  }

  global.AJ.petPro = {
    setActive: setActive,
    isActive: isActive,
    react: react,
    greet: greet,
    poke: poke,
    setScene: setScene,
    openStudio: openStudio,
    closeStudio: closeStudio,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    getPos: getPos,
    setPos: setPos,
    say: say,
    setSleep: setSleep,
    /* 排障 / 测试用 */
    _tierOf: tierOf,
    _profile: profile,
    _hatSvg: hatSVG,           /* 播报条头像复用同一顶帽子（app.js 按 profile 参数化缩放） */
    _charSvg: function () {    /* 首次选宠弹窗展示真实形象（默认白萝卜管家） */
      try { return charSVG(profile()); } catch (e) { return ''; }
    },
    _extractPalette: extractPalette
  };
})(typeof window !== 'undefined' ? window : this);
