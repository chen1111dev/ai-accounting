/**
 * sfx.js — 互动反馈：音效 + 震动（WebAudio 现场合成，零音频文件、零网络请求）
 *
 * 定位：纯增强模块，**不碰任何账本数据与业务状态**。三个宠物形象共用：
 *   ① 阿账（#ajPet 浮层桌面宠物，由 app.js 的 petReact 驱动）
 *   ② 存钱罐精灵（.mascot 悬浮精灵，由 pet.js 驱动）
 *   ③ 记账小管家（.pm-mascot 悬浮精灵，由 petpro.js 驱动）
 * 所以音效必须与形象解耦，只吃「场景名 + 金额分档」两个入参，不关心谁在响。
 *
 * 音效体系源自「萌宠 pro」版（v2.1 统一）：
 *   - 存钱走「上行」音阶（1318→1760→2093→2637→3136，A6 起的五声音阶），
 *     花钱走「下行滑音」（660→330），两者在听觉上形成明确的正负对比；
 *   - 新增 learn（翻书沙沙 + 两个上行音）与成就两条专线：
 *       combo(n)      连击音高逐级上扬（每多一击升两个半音，封顶 8 击）
 *       milestone()   上行琶音 + 收尾三音和弦 + 礼花噪声
 *
 * 金额分档（存入金额，元）：
 *   0 轻微 <¥10 / 1 中间 ¥10–50 / 2 偏大 ¥50–100 / 3 最大 ≥¥100
 *   档位越高：音符越多、响度越大、越隆重；震动由一小段到四拍重锤。
 *
 * 震动降级：iOS Safari 无 navigator.vibrate，静默跳过，不影响音效。
 * 自动播放策略：必须在用户手势里 resume 一次 AudioContext，否则首次无声。
 *
 * 对外 API（window.AJ.sfx）：
 *   play(name, tier)      只出声：name ∈ save|income|focus|spend|error|poke|learn
 *   buzz(name, tier)      只震动（同 name 表）
 *   both(name, opts)      出声 + 震动（最常用）；opts.cents 决定 save 的分档
 *   combo(n)              连击音（第 n 击），只出声不震动
 *   milestone()           里程碑：琶音 + 和弦 + 礼花噪声 + 长震动
 *   tierOf(cents)         金额（分）→ 0..3 分档，供调用方自行判断
 *   isEnabled()           音效/震动开关状态
 *   setEnabled(bool)      切换开关（设置抽屉「互动反馈」绑定此处）
 *
 * 状态存独立键 ai_jizhang_sfx_v1 —— 与宠物的位置记忆（pet.js 的
 * ai_jizhang_sprite_v1、petpro.js 的 ai_jizhang_mascot_v2）完全分开，
 * 换形象不会丢掉开关偏好。
 */
(function (global) {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  if (isNode) { module.exports = {}; return; } // 纯浏览器增强模块，无单测面

  var DOC = global.document;
  var KEY = 'ai_jizhang_sfx_v1';

  /* ------------------------------------------------------------------ */
  /* 开关持久化                                                           */
  /* ------------------------------------------------------------------ */

  var settings = { enabled: true };
  try {
    var raw = global.localStorage ? global.localStorage.getItem(KEY) : null;
    if (raw) {
      var o = JSON.parse(raw);
      if (o && typeof o === 'object') { settings.enabled = o.enabled !== false; }
    }
  } catch (e) { /* 坏档 / 隐私模式：保持默认开 */ }

  function persist() {
    try {
      if (global.localStorage) { global.localStorage.setItem(KEY, JSON.stringify(settings)); }
    } catch (e) { /* 写不进去就只用内存态 */ }
  }

  function isEnabled() { return !!settings.enabled; }

  function setEnabled(v) {
    settings.enabled = !!v;
    persist();
    if (settings.enabled) { unlock(); } // 开启瞬间解一次锁，避免第一次点击才开始声
    return settings.enabled;
  }

  /* ------------------------------------------------------------------ */
  /* 金额分档                                                             */
  /* ------------------------------------------------------------------ */

  /** 金额（分）→ 分档：0 轻微(<¥10) / 1 中间(¥10–50) / 2 偏大(¥50–100) / 3 最大(≥¥100) */
  function tierOf(cents) {
    var yuan = (Number(cents) || 0) / 100;
    if (yuan >= 100) { return 3; }
    if (yuan >= 50) { return 2; }
    if (yuan >= 10) { return 1; }
    return 0;
  }

  /* ------------------------------------------------------------------ */
  /* AudioContext 与音符合成                                              */
  /* ------------------------------------------------------------------ */

  var ctx = null;
  var master = null;

  function audio() {
    if (!ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { return null; }
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.9;
        master.connect(ctx.destination);
      } catch (e) { return null; }
    }
    return ctx;
  }

  /** 浏览器自动播放策略：必须在用户手势里 resume 一次，之后才能发声 */
  function unlock() {
    var c = audio();
    if (c && c.state === 'suspended' && typeof c.resume === 'function') {
      try { c.resume(); } catch (e) { /* 老浏览器无 resume：静默 */ }
    }
  }

  /** 单个音符：at 秒后开始，dur 秒，可做滑音 */
  function tone(opt) {
    var c = audio();
    if (!c) { return; }
    try {
      var t0 = c.currentTime + (opt.at || 0);
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.type = opt.type || 'sine';
      osc.frequency.setValueAtTime(opt.f, t0);
      if (opt.slide) { osc.frequency.exponentialRampToValueAtTime(opt.slide, t0 + opt.dur); }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(opt.gain || 0.12, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + opt.dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + opt.dur + 0.05);
    } catch (e) { /* 合成失败不该打断业务 */ }
  }

  /**
   * 噪声：翻书沙沙 / 礼花绽放。
   * 用一段指数衰减的白噪声 + 高通滤波，比「叮」更像纸张与礼花。
   * @param {number} at   延迟秒数
   * @param {number} dur  持续秒数
   * @param {number} gain 峰值增益
   * @param {number} hp   高通截止频率
   */
  function noise(at, dur, gain, hp) {
    var c = audio();
    if (!c) { return; }
    try {
      var len = Math.max(1, Math.floor(c.sampleRate * dur));
      var buf = c.createBuffer(1, len, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) { d[i] = (Math.random() * 2 - 1) * (1 - i / len); }
      var src = c.createBufferSource();
      src.buffer = buf;
      var f = c.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = hp || 1200;
      var g = c.createGain();
      g.gain.setValueAtTime(gain || 0.08, c.currentTime + (at || 0));
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + (at || 0) + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(c.currentTime + (at || 0));
    } catch (e) { /* 噪声合成失败同样不该打断业务 */ }
  }

  /* ------------------------------------------------------------------ */
  /* 音效表                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * 存钱音效分档：档位越高音符越多、响度越大、越隆重。
   *   t0 轻微：两音小叮咚        t1 中间：三音 + 落袋
   *   t2 偏大：加高音 sparkle    t3 最大：五音满奏 + 结尾和弦
   * 「落袋」用 180Hz 正弦快速下滑到 120Hz，模拟硬币掉进金属罐的闷响。
   */
  var SFX_SAVE = [
    [
      { f: 1318, type: 'triangle', dur: 0.10, gain: 0.10 },
      { f: 1760, type: 'triangle', dur: 0.14, gain: 0.12, at: 0.09 }
    ],
    [
      { f: 1318, type: 'triangle', dur: 0.10, gain: 0.18 },
      { f: 1760, type: 'triangle', dur: 0.14, gain: 0.18, at: 0.09 },
      { f: 2093, type: 'triangle', dur: 0.18, gain: 0.14, at: 0.20 },
      { f: 180, type: 'sine', dur: 0.12, gain: 0.12, slide: 120, at: 0.20 }
    ],
    [
      { f: 1318, type: 'triangle', dur: 0.10, gain: 0.20 },
      { f: 1760, type: 'triangle', dur: 0.14, gain: 0.20, at: 0.08 },
      { f: 2093, type: 'triangle', dur: 0.16, gain: 0.18, at: 0.17 },
      { f: 2637, type: 'triangle', dur: 0.20, gain: 0.16, at: 0.26 },
      { f: 180, type: 'sine', dur: 0.14, gain: 0.14, slide: 120, at: 0.26 }
    ],
    [
      { f: 1318, type: 'triangle', dur: 0.10, gain: 0.22 },
      { f: 1568, type: 'triangle', dur: 0.12, gain: 0.20, at: 0.07 },
      { f: 2093, type: 'triangle', dur: 0.14, gain: 0.20, at: 0.14 },
      { f: 2637, type: 'triangle', dur: 0.18, gain: 0.18, at: 0.21 },
      { f: 3136, type: 'triangle', dur: 0.24, gain: 0.16, at: 0.28 },
      { f: 1568, type: 'sine', dur: 0.30, gain: 0.14, at: 0.36 },
      { f: 2093, type: 'sine', dur: 0.30, gain: 0.12, at: 0.36 },
      { f: 160, type: 'sine', dur: 0.16, gain: 0.16, slide: 110, at: 0.28 }
    ]
  ];

  /** 其余场景的固定音效：花钱 = 下行滑音（与存钱的上行形成听觉对比） */
  var SFX = {
    income: [
      { f: 1046, type: 'triangle', dur: 0.16, gain: 0.15 }
    ],
    focus: [
      { f: 1900, type: 'square', dur: 0.035, gain: 0.05 }
    ],
    spend: [
      { f: 660, slide: 330, type: 'sine', dur: 0.20, gain: 0.16 },
      { f: 520, type: 'triangle', dur: 0.05, gain: 0.08, at: 0.02 }
    ],
    error: [
      { f: 220, type: 'sawtooth', dur: 0.10, gain: 0.10 },
      { f: 180, type: 'sawtooth', dur: 0.14, gain: 0.10, at: 0.13 }
    ],
    poke: [
      { f: 880, type: 'triangle', dur: 0.06, gain: 0.10 }
    ],
    /* 学习理财知识：两个上行轻音（配合 noise 的翻书沙沙，见 play） */
    learn: [
      { f: 784, type: 'triangle', dur: 0.12, gain: 0.10 },
      { f: 988, type: 'triangle', dur: 0.14, gain: 0.09, at: 0.12 }
    ]
  };

  /* ------------------------------------------------------------------ */
  /* 震动表                                                               */
  /* ------------------------------------------------------------------ */

  /** 存钱分档：档位越高模式越长越强（感知强度随节奏与总时长递增） */
  var VIB_SAVE = [
    [15],                    // <¥10 轻微：一小段
    [30, 50],                // ¥10–50 中间：两拍
    [40, 60, 80],            // ¥50–100 偏大：三拍渐强
    [50, 70, 50, 120]        // ≥¥100 最大：四拍重锤收尾
  ];

  /** 其余场景的固定模式：花钱轻、聚焦极轻、出错短促 */
  var PATTERNS = {
    income: [25],
    focus: [8],
    spend: [15],
    error: [20, 40, 20],
    poke: [6],
    learn: [12, 30, 12],
    milestone: [30, 40, 30, 60, 200]
  };

  /* ------------------------------------------------------------------ */
  /* 成就两条专线：连击 / 里程碑                                          */
  /* ------------------------------------------------------------------ */

  /**
   * 连击音：第 n 击比第 1 击高 (n-1)×2 个半音，封顶 8 击（升 16 个半音）。
   * 越连越亢奋，但不会刺耳；只出声不震动（连击往往伴随一次存钱，震动已经有了）。
   * @param {number} n 当前连击数（≥1）
   */
  function combo(n) {
    if (!settings.enabled) { return; }
    unlock();
    if (!ctx || ctx.state !== 'running') { return; }
    var semi = Math.min(Math.max(1, Number(n) || 1), 8) * 2;
    var f = 880 * Math.pow(2, semi / 12);
    tone({ f: f, type: 'triangle', dur: 0.12, gain: 0.16 });
    tone({ f: f * 1.5, type: 'triangle', dur: 0.16, gain: 0.12, at: 0.09 });
  }

  /** 里程碑：五音上行琶音 + 收尾三音和弦 + 礼花噪声 + 长震动 */
  function milestone() {
    if (!settings.enabled) { return; }
    unlock();
    if (!ctx || ctx.state !== 'running') { return; }
    var base = [523, 659, 784, 1046, 1318];
    var i;
    for (i = 0; i < base.length; i++) {
      tone({ f: base[i], type: 'triangle', dur: 0.18, gain: 0.17, at: i * 0.1 });
    }
    tone({ f: 1568, type: 'sine', dur: 0.7, gain: 0.14, at: 0.52 });
    tone({ f: 1046, type: 'sine', dur: 0.7, gain: 0.12, at: 0.52 });
    tone({ f: 784, type: 'sine', dur: 0.7, gain: 0.12, at: 0.52 });
    noise(0.5, 0.5, 0.07, 2600);
    buzz('milestone');
  }

  /* ------------------------------------------------------------------ */
  /* 触发                                                                 */
  /* ------------------------------------------------------------------ */

  function play(name, tier) {
    if (!settings.enabled) { return; }
    unlock();
    if (!ctx || ctx.state !== 'running') { return; } // 没解锁成功就不出声，别硬播
    var list = (name === 'save') ? SFX_SAVE[tier || 0] : SFX[name];
    if (!list) { return; }
    for (var i = 0; i < list.length; i++) { tone(list[i]); }
    /* learn 额外补一层翻书沙沙：纯音阶听不出「在读书」，噪声才像 */
    if (name === 'learn') { noise(0.02, 0.16, 0.05, 2400); }
  }

  function buzz(name, tier) {
    if (!settings.enabled) { return; }
    try {
      if (global.navigator && typeof global.navigator.vibrate === 'function') {
        var pat = (name === 'save') ? VIB_SAVE[tier || 0] : (PATTERNS[name] || [10]);
        global.navigator.vibrate(pat);
      }
    } catch (e) { /* 不支持就静默跳过 */ }
  }

  /**
   * 最常用入口：一次给出声音 + 震动。
   * @param {string} name  save|income|focus|spend|error|poke
   * @param {Object} [opts] {cents: 金额（分），仅 save 用于分档}
   */
  function both(name, opts) {
    var o = opts || {};
    var tier = (name === 'save') ? tierOf(o.cents) : 0;
    play(name, tier);
    buzz(name, tier);
    return tier;
  }

  /* ------------------------------------------------------------------ */
  /* 首次手势解锁（一次性，绑在 document 上，任何点击都算）                  */
  /* ------------------------------------------------------------------ */

  var unlockedOnce = false;
  function bindUnlockOnce() {
    if (unlockedOnce) { return; }
    var h = function () {
      if (unlockedOnce) { return; }
      unlockedOnce = true;
      unlock();
      DOC.removeEventListener('pointerdown', h);
      DOC.removeEventListener('keydown', h);
    };
    DOC.addEventListener('pointerdown', h);
    DOC.addEventListener('keydown', h);
  }

  if (DOC.readyState === 'loading') {
    DOC.addEventListener('DOMContentLoaded', bindUnlockOnce);
  } else {
    bindUnlockOnce();
  }

  global.AJ = global.AJ || {};
  global.AJ.sfx = {
    play: play,
    buzz: buzz,
    both: both,
    combo: combo,
    milestone: milestone,
    tierOf: tierOf,
    isEnabled: isEnabled,
    setEnabled: setEnabled
  };
})(typeof window !== 'undefined' ? window : this);
