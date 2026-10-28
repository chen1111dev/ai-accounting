/**
 * deals.js — 省钱雷达（商家活动日历 + 比价口径引擎 + 品类价格带）
 *
 * 定位：把「今天有什么优惠」「哪天是会员日」「三家谁便宜」做成可计算、可复现的本地能力。
 *
 * 三条数据来源，严格分开标注，绝不混着说：
 *   ① 规律型活动（肯德基疯狂星期四 = 每周四、京东 PLUS 会员日 = 每月 8 号）
 *      —— 由 date.weekday 直接算真实日期，不联网，不会过期；
 *   ② 大促节点（双 11 / 618 / 38 节…）
 *      —— 固定月日 + 预热天数，按年滚动算下一次是哪天；
 *   ③ 商品实时价
 *      —— 本模块**不编造**。只用「用户抄来的价 / 传进来的报价」做口径换算，
 *         没有报价就返回价格带参考 + 明确告诉用户还差什么。
 *
 * 对外 API（window.AJ.deals）：
 *   MERCHANTS / PROMOS                  商家与打促基础数据
 *   dealsOn(date)                       当天所有活动（限时 + 常驻 + 大促预热）
 *   upcoming(days, from)                未来 N 天逐日活动
 *   nextOf(merchantId, from)            某个活动的下一次日期
 *   nextPromo(from)                     最近一场大促 + 倒计时
 *   todayCardHtml(date) / kfcCardHtml() 聊天卡片 HTML
 *   compareOffers(offers, opts)         比价：到手价 / 单价折算 / 可比性判定 / 排名
 *   findBand(item) / judgePrice()       品类价格带 + 这个价属于哪一档
 *   timingAdvice(price, date)           现在买还是等大促
 *   calendarCsv(from, days)             真实商家日历 CSV（日期由代码算出）
 */
(function (global) {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);

  /* ================================================================== */
  /* 一、商家活动：规律型（按周 / 按月），日期由代码算，永不过期            */
  /* ================================================================== */

  /**
   * rule.type
   *   weekly  : weekday 1=周一 … 7=周日
   *   monthly : day 1-28（避开月末缺日）
   *   always  : 常驻活动，每天有效
   * certainty
   *   'stable' 规律稳定（周几固定）
   *   'varies' 档期/力度常调，只能说"哪天有"，具体单品与价格以官方为准
   */
  var MERCHANTS = [
    {
      id: 'kfc', name: '肯德基', emoji: '🍗', cat: '快餐',
      place: '校门口商业街',
      title: '疯狂星期四',
      rule: { type: 'weekly', weekday: 4 },
      what: '每周四的限定特价套餐日',
      how: '校门口商业街店，走过去就行；App 里先领券再下单',
      tip: '比点外卖便宜至少 15 元（省了配送费），建议步行前往；热门单品中午就卖完了',
      coach: '疯狂星期四确实比外卖便宜 15 元以上，但每月控制在 1-2 次，别每周都去。',
      certainty: 'stable',
      source: '肯德基 App / 门店活动'
    },
    {
      id: 'mcd', name: '麦当劳', emoji: '🍟', cat: '快餐',
      place: '阳光广场',
      title: '13.9 元随心配（周一）',
      rule: { type: 'weekly', weekday: 1 },
      what: '每周一的 13.9 元套餐组合',
      how: '阳光广场店，周一点「1+1 随心配 / 13.9 元专区」，比单点省 10 元左右',
      tip: '适合月初手头紧的时候去吃；先看组合内容，别为了凑套餐加购不需要的东西',
      coach: '月初预算紧张时的兜底方案；比单点省 10 元左右，但注意充餐里有没有本来不打算买的东西。',
      certainty: 'varies',
      source: '麦当劳 App / 阳光广场门店'
    },
    {
      id: 'luckin', name: '瑞幸 / 库迪', emoji: '☕', cat: '饮品',
      place: '阳光广场',
      title: '9.9 元两杯 / 8.8 元券（周二）',
      rule: { type: 'weekly', weekday: 2 },
      what: '周二 9.9 元两杯活动，另有不定期 8.8 元券',
      how: '和舍友拼单，人均不到 5 元；走过去也就几分钟',
      tip: '每周最多 2 杯；用瑞幸 / 库迪代替喜茶、奈雪，单杯省 15-20 元',
      coach: '和舍友拼单，人均不到 5 元，是奶茶的最优解；但每周控制在 2 杯以内。',
      certainty: 'varies',
      source: '瑞幸 / 库迪 App 活动页'
    },
    /* —— 以下为「省钱图谱」同步过来的品牌固定活动，统一进雷达日历（每周几 / 每月几号） —— */
    {
      id: 'mcd-member', name: '麦当劳会员日', emoji: '🍔', cat: '快餐',
      place: '门店 / 外卖 App',
      title: '会员日领券（周一）',
      rule: { type: 'weekly', weekday: 1 },
      what: '每周一麦当劳会员日，App 领券后部分单品更便宜',
      how: '周一打开麦当劳 App 先领「会员日券」，再点单；和 13.9 随心配专区可叠加看哪个更划算',
      tip: '券的面额每周会变，先比再买；别为了用券多买不需要的东西',
      coach: '会员日券通常比平时便宜几元，周一吃麦当劳前先领券，但别为凑券加购。',
      certainty: 'varies',
      source: '麦当劳 App 会员日'
    },
    {
      id: 'dominos-mon', name: '达美乐', emoji: '🍕', cat: '快餐',
      place: '外卖 App',
      title: '外卖 8 折（周一）',
      rule: { type: 'weekly', weekday: 1 },
      what: '每周一达美乐外卖 8 折',
      how: '周一在达美乐小程序 / App 点外卖，结算自动 8 折；比平时下单省约 20%',
      tip: '仅外卖、自取不一定参与；满减与折扣不同享时选更省的',
      coach: '周一想吃披萨就等这天，8 折比平时省一笔；别每周都点。',
      certainty: 'stable',
      source: '达美乐官方活动'
    },
    {
      id: 'tastien', name: '塔斯汀', emoji: '🍔', cat: '快餐',
      place: '门店 / 外卖 App',
      title: '会员日（周二）',
      rule: { type: 'weekly', weekday: 2 },
      what: '每周二塔斯汀会员日，部分单品会员价',
      how: '周二在塔斯汀小程序领会员券，买汉堡 / 披萨更便宜',
      tip: '会员日力度每周略有不同，先看好再凑单',
      coach: '周二想吃塔斯汀就这天去，但控制在 1 次。',
      certainty: 'varies',
      source: '塔斯汀会员日'
    },
    {
      id: 'heytea-topping', name: '喜茶 / CoCo', emoji: '🧋', cat: '饮品',
      place: '门店 / 外卖 App',
      title: '免费加小料（周二）',
      rule: { type: 'weekly', weekday: 2 },
      what: '每周二喜茶 / CoCo 免费加小料（珍珠、椰果等）',
      how: '周二点单时勾选「免费加料」，奶茶口感升级不加价',
      tip: '只免基础小料，别顺手加收费配料；想省钱就用它替代周三的付费升杯',
      coach: '周二想喝奶茶就靠免费加料白嫖，比平时省 3-5 元。',
      certainty: 'varies',
      source: '喜茶 / CoCo 会员活动'
    },
    {
      id: 'dominos-wed', name: '达美乐', emoji: '🍕', cat: '快餐',
      place: '外卖 App',
      title: '外卖 7 折（周三）',
      rule: { type: 'weekly', weekday: 3 },
      what: '每周三达美乐外卖 7 折（比周一 8 折更狠）',
      how: '周三下单自动 7 折，大单更划算；和周一 8 折择低选一天',
      tip: '力度常变，以结算页为准；自取可能不参与',
      coach: '周三披萨更便宜，但每周最多 1 次，别因为打折就多吃。',
      certainty: 'stable',
      source: '达美乐官方活动'
    },
    {
      id: 'pizza', name: '必胜客', emoji: '🍕', cat: '快餐',
      place: '门店 / 外卖 App',
      title: '尖叫星期三（周三）',
      rule: { type: 'weekly', weekday: 3 },
      what: '每周三必胜客「尖叫星期三」特价',
      how: '周三在必胜客 App 看本周尖叫单品，部分半价或买一送一',
      tip: '指定单品才参与，先确认再点；别为了特价硬凑人数',
      coach: '周三想吃必胜客就等尖叫日，但每月 1-2 次足够。',
      certainty: 'varies',
      source: '必胜客官方活动'
    },
    {
      id: 'mixue', name: '蜜雪冰城', emoji: '🍦', cat: '饮品',
      place: '门店',
      title: '满 12 减 2（周三）',
      rule: { type: 'weekly', weekday: 3 },
      what: '每周三蜜雪冰城满 12 减 2',
      how: '周三凑满 12 元自动减 2，和同学拼单很容易达标',
      tip: '本就便宜，满减是锦上添花；别为凑单多喝',
      coach: '周三想喝蜜雪就凑满减，省 2 元也是省。',
      certainty: 'stable',
      source: '蜜雪冰城门店活动'
    },
    {
      id: 'chabaidao-up', name: '茶百道', emoji: '🧋', cat: '饮品',
      place: '门店 / 外卖 App',
      title: '会员升杯（周三）',
      rule: { type: 'weekly', weekday: 3 },
      what: '每周三茶百道会员升杯（中杯升大杯等）',
      how: '周三会员点单勾选升杯，免费大一号；比平时更值',
      tip: '仅会员、指定饮品；想喝就这天，但别天天喝',
      coach: '周三茶百道升杯白赚，替代平时的付费大杯。',
      certainty: 'varies',
      source: '茶百道会员活动'
    },
    {
      id: 'chabaidao-88', name: '茶百道', emoji: '🧋', cat: '饮品',
      place: '门店 / 外卖 App',
      title: '88 折（周四）',
      rule: { type: 'weekly', weekday: 4 },
      what: '每周四茶百道 88 折',
      how: '周四在茶百道点单自动 88 折，比平时省约 12%',
      tip: '和周三升杯择一即可，别两天都喝；力度以结算页为准',
      coach: '周四茶百道 88 折，但奶茶一周控制在 2 杯内。',
      certainty: 'stable',
      source: '茶百道会员活动'
    },
    {
      id: 'wallace', name: '华莱士', emoji: '🐔', cat: '快餐',
      place: '门店 / 外卖 App',
      title: '会员日买一送一（周五）',
      rule: { type: 'weekly', weekday: 5 },
      what: '每周五华莱士会员日，指定单品买一送一',
      how: '周五华莱士会员点单，汉堡 / 鸡块常买一送一，和同学拼最划算',
      tip: '指定单品参与，先确认品类；别为凑买一送一硬吃两份',
      coach: '周五华莱士买一送一适合拼单，但别每周都冲。',
      certainty: 'varies',
      source: '华莱士会员日'
    },
    {
      id: 'guming', name: '古茗', emoji: '🍵', cat: '饮品',
      place: '门店 / 外卖 App',
      title: '会员日（每月 20 号）',
      rule: { type: 'monthly', day: 20 },
      what: '每月 20 号古茗会员日，领券 / 折扣',
      how: '每月 20 号打开古茗小程序领会员券，部分饮品更便宜',
      tip: '券额每月不同，先比再买；别囤券',
      coach: '想喝古茗就等 20 号会员日，省几元。',
      certainty: 'varies',
      source: '古茗会员日'
    },
    {
      id: 'yihetang', name: '益禾堂', emoji: '🥤', cat: '饮品',
      place: '门店 / 外卖 App',
      title: '半价 / 买一送一（每月 18 号）',
      rule: { type: 'monthly', day: 18 },
      what: '每月 18 号益禾堂半价或买一送一',
      how: '每月 18 号益禾堂会员活动，指定饮品半价 / 买一送一',
      tip: '指定单品参与，拼单更值；别为凑单多喝',
      coach: '益禾堂 18 号活动力度大，但每月 1 次足够。',
      certainty: 'varies',
      source: '益禾堂会员日'
    },
    {
      id: 'haoxianglai', name: '好想来', emoji: '🛒', cat: '零食',
      place: '门店',
      title: '88 折（每月 8 号）',
      rule: { type: 'monthly', day: 8 },
      what: '每月 8 号好想来全场 88 折',
      how: '每月 8 号去好想来囤零食，结算 88 折；比平时省 12%',
      tip: '零食是隐形支出，只在清单内的东西上享受折扣，别顺手多拿',
      coach: '好想来 8 号 88 折适合囤清单零食，但别逛着逛着拿一堆。',
      certainty: 'stable',
      source: '好想来会员日'
    },
    {
      id: 'dicos', name: '德克士', emoji: '🍗', cat: '快餐',
      place: '门店 / 外卖 App',
      title: '买一送一（每月 18 号）',
      rule: { type: 'monthly', day: 18 },
      what: '每月 18 号德克士指定单品买一送一',
      how: '每月 18 号德克士会员活动，鸡块 / 汉堡常买一送一',
      tip: '指定单品参与，拼单更值；和益禾堂 18 号错峰安排',
      coach: '德克士 18 号买一送一适合拼单，但别每月都冲。',
      certainty: 'varies',
      source: '德克士会员日'
    },
    {
      id: 'haidilao', name: '海底捞', emoji: '🍲', cat: '聚餐',
      place: '门店（需学生认证）',
      title: '大学生 69 折（工作日 14-17 & 22 后）',
      rule: { type: 'weekly', weekday: [1, 2, 3, 4, 5] },
      what: '工作日 14:00-17:00 及 22:00 后，大学生认证 69 折',
      how: '用学生证 / 学信网认证后，工作日下午茶段或夜宵段去海底捞打 69 折',
      tip: '仅工作日、且限指定时段；周末和饭点不打折。先确认门店参与再约人',
      coach: '海底捞大学生 69 折很香，但只在工作日非饭点，约人前先算好时段。',
      certainty: 'stable',
      source: '海底捞大学生优惠'
    },
    {
      id: 'zym', name: '赵一鸣零食', emoji: '🍬', cat: '零食',
      place: '阳光广场',
      title: '会员日折扣 / 满减',
      rule: { type: 'always' },
      what: '不定期会员日折扣与满减',
      how: '囤零食去赵一鸣比校内便利店便宜；只买清单上的东西',
      tip: '别囤太多——零食是隐形支出，逛着逛着拿一堆最容易超支',
      coach: '比校内便利店便宜，但零食是隐形支出：只买清单上的，别逛着逛着拿一堆。',
      certainty: 'varies',
      source: '赵一鸣门店会员日公告'
    },
    {
      id: 'zunte', name: '尊特优选', emoji: '🏬', cat: '超市',
      place: '第二饭堂三楼',
      title: '校内最大超市',
      rule: { type: 'always' },
      what: '校内最大的超市，东西最全',
      how: '急用才去，不急的等网购（拼多多百亿补贴）',
      tip: '价格不一定最优，图的是方便；同样的东西润泰超市通常更便宜',
      coach: '着急用才去，价格不一定最优；不急的下单网购，价格通常更便宜。',
      certainty: 'stable',
      source: '校内实地'
    },
    {
      id: 'convenience', name: '校内便利店', emoji: '🏪', cat: '超市',
      place: '各饭堂旁（一饭三、一饭四最方便）',
      title: '应急零食 / 水 / 纸巾',
      rule: { type: 'always' },
      what: '饭堂旁的校内便利店',
      how: '买水、买纸巾可以；别在这买整箱饮料',
      tip: '溢价明显，比润泰超市贵；整箱饮料拼多多送到菜鸟驿站更便宜',
      coach: '溢价最明显的点位，只适合应急；整箱饮料走网购，均价能省一半。',
      certainty: 'stable',
      source: '校内实地'
    },
    {
      id: 'runtop', name: '润泰超市', emoji: '🛒', cat: '超市',
      place: '正门斜对面 150 米',
      title: '日常生活用品',
      rule: { type: 'always' },
      what: '校外超市，日用品价格比校内便宜',
      how: '买洗发水、纸巾这类日用品可以走到校门对面去买',
      tip: '比校内尊特优选便宜；走过去也就几分钟，顺路蹲的话不亏',
      coach: '买日用品可以走过去，比校内超市便宜；周末顺便去买，一趟搞定一个月用量。',
      certainty: 'stable',
      source: '校内实地'
    },
    {
      id: 'dormstore', name: '宿舍楼下小卖部', emoji: '🏠', cat: '超市',
      place: '宿舍楼下',
      title: '应急泡面 / 水',
      rule: { type: 'always' },
      what: '深夜应急的泡面和水',
      how: '深夜饿了应急可以买一次',
      tip: '长期在这买零食会悄悄掏空钱包，记账时往往连笔记都懒得记',
      coach: '深夜应急可以，但长期在这买零食会悄悄掏空钱包——记得单独记一笔，月底复盘会吓你一跳。',
      certainty: 'stable',
      source: '校内实地'
    }
  ];

  /* ================================================================== */
  /* 二、大促节点：固定月日，按年滚动算下一次                            */
  /* ================================================================== */

  var PROMOS = [
    { id: 'double11', name: '双11', month: 11, day: 11, warmup: 12,
      depth: '全品类，全年深度最大', bestFor: '大件、囤货、服饰' },
    { id: 'double12', name: '双12', month: 12, day: 12, warmup: 5,
      depth: '约 5%-15%，力度弱于双11', bestFor: '补漏、小件' },
    { id: 'newyear', name: '年货节', month: 1, day: 10, warmup: 10,
      depth: '食品 / 礼盒约 10%-25%', bestFor: '食品、年礼' },
    { id: 'w38', name: '38节', month: 3, day: 8, warmup: 7,
      depth: '美妆个护约 15%-30%', bestFor: '美妆、个护' },
    { id: 'p618', name: '618', month: 6, day: 18, warmup: 20,
      depth: '数码家电约 15%-30%', bestFor: '数码、家电、大件' },
    { id: 'school', name: '开学季', month: 8, day: 25, warmup: 10,
      depth: '文具 / 数码约 10%-20%', bestFor: '学生用品、笔记本' }
  ];

  /* ================================================================== */
  /* 三、日期工具（全部本地时区，避免 UTC 偏移把"今天"算错一天）           */
  /* ================================================================== */

  var WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function toDate(d) {
    if (d instanceof Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    if (typeof d === 'string') {
      var m = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) { return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); }
    }
    var t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function dateKey(d) {
    var x = toDate(d);
    return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
  }

  function addDays(d, n) {
    var x = toDate(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function daysBetween(a, b) {
    var ms = toDate(b).getTime() - toDate(a).getTime();
    return Math.round(ms / 86400000);
  }

  /** JS 的 getDay(): 0=周日 … 6=周六；本模块统一用 1=周一 … 7=周日 */
  function isoWeekday(d) {
    var w = toDate(d).getDay();
    return w === 0 ? 7 : w;
  }

  /** 行内小图标（与 app.js 的 ic 同义；模块独立闭包不能跨文件取名） */
  function dlIcon(name, cls, label) {
    var D = (typeof module !== 'undefined' && module.exports) ? require('./data.js') : global.AJ.data;
    return D.inlineIcon('i-' + name, cls, label);
  }

  /**
   * 商户品牌瓦片：真实品牌标识优先，没有则用「品牌色 + 首字」字母章兜底。
   * 视觉与分类瓦片同一套语言：淡底（bg = 品牌色 14% 透明度）+ 深墨内容（ink）。
   * 真实标识来源：联网时从 SimpleIcons 取到麦当劳 / 肯德基的官方单色图标 path，
   * 其余中国品牌在本环境无网可拉，统一用字母章（等 logo 素材齐了，往 mark 字段填 path 即可）。
   */
  /* >>> LOGOS —— 品牌真实 logo，离线内联；由 _brand/build_logos.py 生成，勿手改 */
  var LOGOS = {
    "chabaidao-88": {"u":"data:image/webp;base64,UklGRq4KAABXRUJQVlA4IKIKAADQLgCdASpIAGAAPjESiEKiISEV6u+QIAMEtABfQLxs3xm++flL7JVXfv/EVGn7HP5nSA/QHsC/qf0qPMT+yH7Fe65/sv2O91voGf5f+5da9+2nsFfsz6bfsv/27/efuR7Tn//zkT+k9qP9U/FHrgO7vq5+4/+P0yv4h9I/rn9V/Yf+mf+D/dexn1FfqBfiv8f/s34/fmJyFAAPyz+j/3H8pf75+1Xoweh3yze4B/DP5X/bPyk/u/O+0Av5R/Nf9H/af7X+xH0mfxH+z/uf5fe2L8t/tX/A/xv7cfQL/Hv6P/nP7p/i/+//j///9YHsi/ZH2gP2nTt/CDESOP6vzI0K03/HWHpYiMs9I3X71KMQb3b+Oyc0AuRgzL0lETJ3VbhcEqK9ZGI+EhQgt9b4+nS4vaaOSVI0zI+h4bR9b7ApdjSyLSSTHthiD9y8lXrTvnSq/gMKG/0xy3cuWsAEF7OQeajHcEWFXUA7XKrqOpUjp3SHNqFdt3i81+39MkF1AAD+/8tELIiCBfl3yVyz9h1lFrx/poW2j+zYWqHtxhHkG0AK7P8THin68KomxHHuIpXZXxyrdqxL5CT/8LISW1b80qIxA1SqSR6pLm9Wm3NG33Gijy3wdJ72eKJIumrD2aO5MOB0dvIaotvzzIV+xOiA91a/PRGLoVd5LdnQZCOmxNVElOzpINJdroSanOICS7k9VDxAK3KV2jXlmJI66wjMmAmJoh2nC+s976yZrTSsQ+pyo+4iDqvhE9nkbUAWprrQAyyIiTsa5ZJHiZY6j2GL3BskrdYx3uynZBWcagaeV/IUwBz7hdBmwiIAlhJCNJ5z/nYnpfj4+OHLdd96tn86FBswaBB7MaHjRL+/DPBLx72ewvX/qhch/Y3l5AkZ79SotDjVf6TKY9AaDYKTqlRQt7o59gwwffqT8ZvdbqCfG//TI6qXmwda9IO78TUNxvZYliGPl8x4ggmqBH6g1euCBQy6MxX7XByIH5SX47OZZliarNjQwLSKspuWcOrhWK/7bCp974LbVe9Ks0HDfQL/vRok92IrML6jDdV5YLSqIaV27/qzYJp5/P5usc6GuHZtZKN6LAR5NC6LkOcgWc5LNNkHsaZeq5btiO3aGc4Mhi8f7VW4LOyEO6uvx5T5TcFyWVHk8EgSNlQCiRcWgn4Xc99roHqpunU3r3HoCap/rtdrK2Vusxd37l/UEd94ilTVUhw3/0tU1ySDjrK+4SwRe/RpscKwusaB+/QN94Nv5tCsmGBMKUTF0zw8fYZ3SbvLDRS7RJNOcJIZD6/G8kjamW4BXbC1bpoSidJDyXUJAOUyAfE+/2lKXNRXW5Eh48EQfx/pCXFmYliqUHilvaCVW2nifv0rA4cHYv3YdCA5mQRmJTeBGE/bWMeRv8ziuHBO0S/5fYg5vH08p/kK16pd1c4ilJZeiLnBJinrkw6t0frOlew4WP5/OH0b5D2R860WqNTmSseQWnvGJ0EaKvMyCTpS2/eVcy32lMuEvJ3gIXmGmfHWOd7uhPgGU8Si4nL+p7d9tZWlO/gUYG+41VsNwB2G7lJ5U9/wM/7kzj/lMiexM2MB/QBrOa0fDERp3/BmZh8hv/dNpaxJteo9rTmA4oHQTU3+/JW7dKpzknOCIVmyNJnnNmWlG2g2Q8Lzxzv//8OhuzJCjCMHhqZCzlStZ7LatINbpqdix/88rNNesgvyG2D2Vp4TPjL9ZZDIiDKy97B8ZT3u3FBYLzKZz3aDlpc19olEffvzIeXc1JcaYp9IA+QFxXsFTJVF2wwo4ZCRBk89owGzS7rL6xnpe3h1eNl8CMJ6J+6CyJntywqMdMX/8FebAs1iSXatClvaXDFUDxD8yQPVi2w7yCLHf3oC4n0Nr96XX8O3oGFEolZNN4TaQ+Du/bIvhPbasruROm5ctcs5ujqgIXRGM3MfqFe9KqmZhbyJnO0AJ04Diix51Z6/P4ANglBB/cPzaGSqdcxLbXYeJiyBWh2NtPJ9TllDNc3wPjJbMdCd4Pl1pj0LXtfyLLsWgearEGIm3futfWSpzxw8JGbF1ByUHG6bmtB99qZ0ujmlYmqIII5fOYTNXJXxIptMfqf/7WZSjYUkgO8gaKTK2Lzj0mW88r1rAZe32/HCCF9vTPvy8kZlXfZjOXBWp2b7CwCrqw4LjhmCn8hipxjbktGmNwYs5OXept6fvKXysgldXYTcA8x/UZIGXNjA0WoCjH3k2Jg6hiuag/pImoMrp+O9Oaakrlxn/yCFvo1fh/cZ5/KCxAOKEfFe3Z3aVmzEwce7m9R78yT6hJS7C0xQ7/tIf0PR8r8E+UyYqNQgRX6yLT1zb5m3wRtlQLiS8ef4wWDu2NpjZF4r7FXeT+1QVKjK/R6SYsQoAX/7U1KVYXxmB84OzjpLbssuk67ydxfZ+Pr1seX44u4nvkZyuDGByDriJK3b69xspwEP27r/ucyF1bryrhfC9pvrtnzwvaG0q6h/Nk24aLLa+EtPX8/XcrL0SGUrgTdRZvOYTCMlnlZIEZ7FQHSnKVzoNjkPtX3o6pMqQrwy4ws7touddJJ+2et4OUdtWKMQKBMysxpiV9j8RcW/opVMSjNIE7XdmrSfUpc/u4CTHTZh4/nz0hdiX7bw1XP8E7hgeYwdvPxvQXrDNJNihbWCYBSr7cfi2Gqz3QyMmdliPEsSf7FdFbaQvgifJIBbD2BoISCPXtlKw124pOM9Gq5YxH/d6WLq5ZM93ed/kzu+P2Oa/dU4MCK8GrYWl7XhHyc8a1Qty7zL/0j+xNY8Z8+nHGBa4zxbXmWnOiM6VP2DGctP1vaz5qXPjp2qH6mOmtuM4CG+p6E1qieJpHyVEr3n/fB/4Ih785i3SAstdzt//oiz02LplFBuaLfjODP8VA0JHnQL3EqLNVpKwJ03WVjDobayVU6uskJMXyyuXHbTvSBT+GkqaMzsOrYuowdMunyoEJC0bJftvzwTxk/HfiCOrnUPT6y7XYL+xCgUrSQrrodepMvDvw6xQhnebKtwr+xH+AWTmo5/0N0fnZLCbxlYE/5kuMUu1igtHQjv5dpCKNk2O8cdycsoflAZCVvUIdS4+2ZJCS6izE7rvob4S3AHz10hBBMXVt090zQf7023Jkv/+RiLj8b9YPcV8ESs6uj7jhdbznJTIU1+ODAojOGI11Ld75U5SqofJ+DtvMfWWEot4Wi9Kn9TK/DROvSeKUUdB+kNuyPllYWJUlON/uFBXllFdb9nAqFuCYyp47GLNhm74bjqXLqYyo6Jl0S2OPbNzmX9TjcEHEX5BYRv3jaXxHDZRQPYbAtnTnIdAsv0vmzOOf+zdm7KeRJdKH15TbUCN5/X3PkNiUWXiFzAg1uqWloPyQKnOAKvoqtVw4fS2+xvIllrF+wQsDjGM8FPqxTOsgjTR2IqIsjy3zmR+btcbcr5L0R/V5vCn601JQgZvhp6OpkXcK7Qq8NPaj5xyKRb8zBNVonQqEMv5gJD/SVod1qOUGcATd1MATO1F0oRtxEvUxHfh31hJviBnUROhXl9co98hQgYAMVTlPRJ1VJ+mSYB5jVEKWrrPMlHQmfGPEM7I5sWmi5z/i40JPoNLlf/tBpW2ruGsdrbrCwPUMqX+YAAAAAA","k":"fit","b":"#FFFFFF","r":0.75},
    "chabaidao-up": {"u":"data:image/webp;base64,UklGRq4KAABXRUJQVlA4IKIKAADQLgCdASpIAGAAPjESiEKiISEV6u+QIAMEtABfQLxs3xm++flL7JVXfv/EVGn7HP5nSA/QHsC/qf0qPMT+yH7Fe65/sv2O91voGf5f+5da9+2nsFfsz6bfsv/27/efuR7Tn//zkT+k9qP9U/FHrgO7vq5+4/+P0yv4h9I/rn9V/Yf+mf+D/dexn1FfqBfiv8f/s34/fmJyFAAPyz+j/3H8pf75+1Xoweh3yze4B/DP5X/bPyk/u/O+0Av5R/Nf9H/af7X+xH0mfxH+z/uf5fe2L8t/tX/A/xv7cfQL/Hv6P/nP7p/i/+//j///9YHsi/ZH2gP2nTt/CDESOP6vzI0K03/HWHpYiMs9I3X71KMQb3b+Oyc0AuRgzL0lETJ3VbhcEqK9ZGI+EhQgt9b4+nS4vaaOSVI0zI+h4bR9b7ApdjSyLSSTHthiD9y8lXrTvnSq/gMKG/0xy3cuWsAEF7OQeajHcEWFXUA7XKrqOpUjp3SHNqFdt3i81+39MkF1AAD+/8tELIiCBfl3yVyz9h1lFrx/poW2j+zYWqHtxhHkG0AK7P8THin68KomxHHuIpXZXxyrdqxL5CT/8LISW1b80qIxA1SqSR6pLm9Wm3NG33Gijy3wdJ72eKJIumrD2aO5MOB0dvIaotvzzIV+xOiA91a/PRGLoVd5LdnQZCOmxNVElOzpINJdroSanOICS7k9VDxAK3KV2jXlmJI66wjMmAmJoh2nC+s976yZrTSsQ+pyo+4iDqvhE9nkbUAWprrQAyyIiTsa5ZJHiZY6j2GL3BskrdYx3uynZBWcagaeV/IUwBz7hdBmwiIAlhJCNJ5z/nYnpfj4+OHLdd96tn86FBswaBB7MaHjRL+/DPBLx72ewvX/qhch/Y3l5AkZ79SotDjVf6TKY9AaDYKTqlRQt7o59gwwffqT8ZvdbqCfG//TI6qXmwda9IO78TUNxvZYliGPl8x4ggmqBH6g1euCBQy6MxX7XByIH5SX47OZZliarNjQwLSKspuWcOrhWK/7bCp974LbVe9Ks0HDfQL/vRok92IrML6jDdV5YLSqIaV27/qzYJp5/P5usc6GuHZtZKN6LAR5NC6LkOcgWc5LNNkHsaZeq5btiO3aGc4Mhi8f7VW4LOyEO6uvx5T5TcFyWVHk8EgSNlQCiRcWgn4Xc99roHqpunU3r3HoCap/rtdrK2Vusxd37l/UEd94ilTVUhw3/0tU1ySDjrK+4SwRe/RpscKwusaB+/QN94Nv5tCsmGBMKUTF0zw8fYZ3SbvLDRS7RJNOcJIZD6/G8kjamW4BXbC1bpoSidJDyXUJAOUyAfE+/2lKXNRXW5Eh48EQfx/pCXFmYliqUHilvaCVW2nifv0rA4cHYv3YdCA5mQRmJTeBGE/bWMeRv8ziuHBO0S/5fYg5vH08p/kK16pd1c4ilJZeiLnBJinrkw6t0frOlew4WP5/OH0b5D2R860WqNTmSseQWnvGJ0EaKvMyCTpS2/eVcy32lMuEvJ3gIXmGmfHWOd7uhPgGU8Si4nL+p7d9tZWlO/gUYG+41VsNwB2G7lJ5U9/wM/7kzj/lMiexM2MB/QBrOa0fDERp3/BmZh8hv/dNpaxJteo9rTmA4oHQTU3+/JW7dKpzknOCIVmyNJnnNmWlG2g2Q8Lzxzv//8OhuzJCjCMHhqZCzlStZ7LatINbpqdix/88rNNesgvyG2D2Vp4TPjL9ZZDIiDKy97B8ZT3u3FBYLzKZz3aDlpc19olEffvzIeXc1JcaYp9IA+QFxXsFTJVF2wwo4ZCRBk89owGzS7rL6xnpe3h1eNl8CMJ6J+6CyJntywqMdMX/8FebAs1iSXatClvaXDFUDxD8yQPVi2w7yCLHf3oC4n0Nr96XX8O3oGFEolZNN4TaQ+Du/bIvhPbasruROm5ctcs5ujqgIXRGM3MfqFe9KqmZhbyJnO0AJ04Diix51Z6/P4ANglBB/cPzaGSqdcxLbXYeJiyBWh2NtPJ9TllDNc3wPjJbMdCd4Pl1pj0LXtfyLLsWgearEGIm3futfWSpzxw8JGbF1ByUHG6bmtB99qZ0ujmlYmqIII5fOYTNXJXxIptMfqf/7WZSjYUkgO8gaKTK2Lzj0mW88r1rAZe32/HCCF9vTPvy8kZlXfZjOXBWp2b7CwCrqw4LjhmCn8hipxjbktGmNwYs5OXept6fvKXysgldXYTcA8x/UZIGXNjA0WoCjH3k2Jg6hiuag/pImoMrp+O9Oaakrlxn/yCFvo1fh/cZ5/KCxAOKEfFe3Z3aVmzEwce7m9R78yT6hJS7C0xQ7/tIf0PR8r8E+UyYqNQgRX6yLT1zb5m3wRtlQLiS8ef4wWDu2NpjZF4r7FXeT+1QVKjK/R6SYsQoAX/7U1KVYXxmB84OzjpLbssuk67ydxfZ+Pr1seX44u4nvkZyuDGByDriJK3b69xspwEP27r/ucyF1bryrhfC9pvrtnzwvaG0q6h/Nk24aLLa+EtPX8/XcrL0SGUrgTdRZvOYTCMlnlZIEZ7FQHSnKVzoNjkPtX3o6pMqQrwy4ws7touddJJ+2et4OUdtWKMQKBMysxpiV9j8RcW/opVMSjNIE7XdmrSfUpc/u4CTHTZh4/nz0hdiX7bw1XP8E7hgeYwdvPxvQXrDNJNihbWCYBSr7cfi2Gqz3QyMmdliPEsSf7FdFbaQvgifJIBbD2BoISCPXtlKw124pOM9Gq5YxH/d6WLq5ZM93ed/kzu+P2Oa/dU4MCK8GrYWl7XhHyc8a1Qty7zL/0j+xNY8Z8+nHGBa4zxbXmWnOiM6VP2DGctP1vaz5qXPjp2qH6mOmtuM4CG+p6E1qieJpHyVEr3n/fB/4Ih785i3SAstdzt//oiz02LplFBuaLfjODP8VA0JHnQL3EqLNVpKwJ03WVjDobayVU6uskJMXyyuXHbTvSBT+GkqaMzsOrYuowdMunyoEJC0bJftvzwTxk/HfiCOrnUPT6y7XYL+xCgUrSQrrodepMvDvw6xQhnebKtwr+xH+AWTmo5/0N0fnZLCbxlYE/5kuMUu1igtHQjv5dpCKNk2O8cdycsoflAZCVvUIdS4+2ZJCS6izE7rvob4S3AHz10hBBMXVt090zQf7023Jkv/+RiLj8b9YPcV8ESs6uj7jhdbznJTIU1+ODAojOGI11Ld75U5SqofJ+DtvMfWWEot4Wi9Kn9TK/DROvSeKUUdB+kNuyPllYWJUlON/uFBXllFdb9nAqFuCYyp47GLNhm74bjqXLqYyo6Jl0S2OPbNzmX9TjcEHEX5BYRv3jaXxHDZRQPYbAtnTnIdAsv0vmzOOf+zdm7KeRJdKH15TbUCN5/X3PkNiUWXiFzAg1uqWloPyQKnOAKvoqtVw4fS2+xvIllrF+wQsDjGM8FPqxTOsgjTR2IqIsjy3zmR+btcbcr5L0R/V5vCn601JQgZvhp6OpkXcK7Qq8NPaj5xyKRb8zBNVonQqEMv5gJD/SVod1qOUGcATd1MATO1F0oRtxEvUxHfh31hJviBnUROhXl9co98hQgYAMVTlPRJ1VJ+mSYB5jVEKWrrPMlHQmfGPEM7I5sWmi5z/i40JPoNLlf/tBpW2ruGsdrbrCwPUMqX+YAAAAAA","k":"fit","b":"#FFFFFF","r":0.75},
    "coco":        {"u":"data:image/webp;base64,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","k":"fit","b":"#FFFFFF","r":2.8},
    "cotti":       {"u":"data:image/webp;base64,UklGRsYDAABXRUJQVlA4ILoDAABwFQCdASpgAEAAPjEYikOiIaESvf00IAMEsYBqCOiagXzVMDxdP1VywD0APKn/bf4Mv2w/YD2gKYX9a4EjDX8Nwg7wb+Xf4P5gM4U+e/5LdSfOY84O8GjN/w325fF9/sf2j8ZvaJ+Wf3L/kfar9gf8l/ov+n+37wM+ir+sxUdutjXTCYytinMFRLBFSzLAtL8PiMTwkp3a/EX8Jw2IlImaHoza1P4EBs3gSa0TgWr8sA2K/KAA/vohl84ArJ0f/5aF/8tC/+Whf8xMMSyAoZZ8PkMK9OcZsPF0yZh/gGl878zzt03Ap3wEUfP0s2ufBnqaCgonwVH62m9ymQuUssGSl3lFYkMeVVTjZR72Hzam7vEX3uj1c0d9rkAxL8ONwdPssscfMcQt//qRpHiMaWWWEjmOjmrTGvmxyFWTZwA1auPm2mTyAscgmPs2hAYMECWu5vfy4zAcye6uOItBj6TzN8rqjnba/93wn+XzJrVw31z99e3c77v6wL1O5hrAVnt4A4qeIVvhysJDAs+9fDXF/ceCv6dHHzjKMJCul1QcVSUQ5s2UMxyGCydmDAp4dAX6IX3L/jPHQ7eBGLfu5QarFJ6O4uX+odONJToODSv949KXDxTcl5aYlZ8XdNNQZeGkvf52btOvJR9xG/5ayrJ1svnDApVr4/68RXOt/bL//2OMJuNoNqFoBQLNakJ7zMsDNHqKsvuiHnfXtWPeFpcdh0w4mrbN89OaMIff7+b3oQs/9aGk7+0oE98XdgjwYiq4eqQLHtc8CdlIizv8R5CwO5m5eJgZBM6qfOpFSEhl3/MH9ZLJyPfps29/1cqAvtl3I1nzQ+MrWV2cuxPtMbXvEvcD42mjFi+Layo1/00ki6gpQJ1HL2DivL0Tyk7vtDRXIa5LttpOOpCMy76FYYXyhp/jfKpUfhcxzunFYg9s3Gd7vKTWG5e7C/+KQEhLaDx4h4zEh4GIQ//5vA9u4zOFE7PgNpiDPcD19ZsqTL/AjGwv9DeRfHHQ+tYXQSYYU9JgXrWFtrH/s/3Zdt6YSer+LMQ+WrQonucehVMVzZkgIpg/tVQTYf2ZYQSOKF+nVMOiFZQNRbt08qaZNJEaUb1zlIM6Zya/sI3301ECXs2ZVVnQUZxyB4ojJU/V0Q1JnarxQKIw8SY6vAT+QA1U6aVZo9CvQkobIsKLEMapFa7cI3/Qf67I4/PS/O2l48ReGgDbab10/sOZ//GunieGwV38yJ8ereJCXjN452QqdI3CSf4k062NB7qAAAA=","k":"full","b":"#A01C34","r":1.5},
    "dicos":       {"u":"data:image/webp;base64,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","k":"fit","b":"#FFFFFF","r":2.52},
    "dominos-mon": {"u":"data:image/webp;base64,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","k":"fit","b":"#FFFFFF","r":1.4},
    "dominos-wed": {"u":"data:image/webp;base64,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","k":"fit","b":"#FFFFFF","r":1.4},
    "guming":      {"u":"data:image/webp;base64,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","k":"fit","b":"#FFFFFF","r":3.14},
    "haidilao":    {"u":"data:image/webp;base64,UklGRkoMAABXRUJQVlA4ID4MAAAQMwCdASpgAE8APi0Sh0KhoQ0W8ugMAWJbADTIYHX3gx9c/KD2Iqk/Z/wB7AOgToDyVOPP8n9sHwR/wHsA8wD9Qf8f1Bv2x9QH6k/77/IezH+xHuA/Wj2AP5J/V+sM/cP2AP2O9Kv/vf7X4Of2o/8P+q+BP9bv+r+f+ib/13s6/tf5E+c/ff7u+w37xczWJB8Y+sX1H8nv7N+2PxZ/iPC/05+oF+I/yD+sfkV+X3IZ5r/hPQC9aPn3+I/rf7kf3H0gv530G+sf9R9wD+Q/y//Pfax8q/5zwBvCvYA/k/9W/4P+K/Hn6Uf4b/j/37/Iftb7YvzX+7/9b/FfAR/LP6N/s/7p+9P+d8G3o4/ss5dgzFqt3Hof+rjY/HHA3mB15qz+o1zcEr+KvACA0E9iK08eDYD1G46tJQdlwa778VQ7X2/BNnfKoc//7WFTXnBWXGPfGCzGMajfL6kQ2R2xl1UKVcc6rLRPPd1WPL9H4/zUTBNg7aXvCWyGyy7l64guiNVLcr/idf/YyyoOTsb1ZhNjHzAMraabVdnwnYWgHmfvcAAA/v98gOAEmbcz/dNZ2ycE4PhattGk8KbfKWrH/BiZxhEohXGPl/sQ0SBC2qk4whcYmOBM5Cz3k9SNZVNK9PawQ8EMn7jgIrNOF7enVIw98TOItg2YvIsZXHWvc6xbxuhdJ7ilx+qsM6AdG1MXIYQe9Ub89cU6On8Iz7VXtPkjTM0McO/a/6VZ720K1my6hpnFhQIGvNpQTcSHcXvKpaKx3YI1gkt5Qz5bVdWBqqlvd8z1JtC1EiSFAop11Is6fmGccKt2satEr8iKNjmZrvwM0wtnNslMTIRghqAIz+iPbU4jZBZfn/jno6bFcfJlcvXrHzjwXauAlUkUNp7iBKPI2JRgXpHbKPT7CgZJhktY2TAi2SeXWUJcXGMjzWjC9aaBsqX/DqIiXXp9cklEsgmhF5mTpnoOB0xwPEOE525458Gb6kMfTN00P1/SRRJk4Irj5YIJ2NWP3ZjjsHYl21gRUKFMEKd1xPMvf0NvC7CfkMIMjnXJVTWMAFKTupBP95GRBT+vpgDKV7jqTfykvDBGi7beFjyF7Vx1SMDKhwiVA1j4F7Id22L2ukm1NbvNKuNdCrR5uBFhcmZvD4ODYc79eGk+5sqOVLJIm9MJJLqn+OKjhe3i7eU3RCG8MZFo/ExDFfrX7GXN5yQP/wy3f95apqOVA59UndYmf7sEWJqYD+vsQGZekOs8oidJlgEaB4ByWEC9BH6fqNvzg990Xo0xWlDOUIN94BR0zp3sUygEInJ1x0EAJbiyP41maIrPhemsHRurwhmRuWKxLGZzn1da1/VuLuQaNuyzNEkWgeYtlor3CGXhQB73znu1FPVWwfA//0tovR1JxcP+p3eBCLsbCS8ednuOg0wwxT5NT288beuOnIRcvSoizKLCIo6XXAhlt+SnQHXla+lqsVLYrZlGI1DBVgY60un9tPQsP+RF7TUFFSmSdM9ihKyIegOb1E8Imc1fC+q8obaHxn2G8yzCLxiLnv8rYuuNye7qZ+Vsu8FqtgWkwNAqi+eIwi3Xrh1egWEHY1mp/qHNReBZnW/OL2DoI9GWtItTjdEXcbPAo3O/E83MqY0BrlYLS44AU60iBjDkpoDxLrwDCBarVfVTRFOzg/+6kHjetscUTPyV98mZtbVcJ7J8mxP5dSqaAPBUUnkS0dKm+756P8QLklm+7ERlEzEccPJNhBfCQB2Of+Syx/k3xEwUa1SBhAcqWZ8umShuMs3VSedtWTmnebvDQXkKGkXsf8+DHgQHcQaB5avNGiqt0lYV97cQ5TvKt8oeSrLy6GIqVu2zYRGeS8DBQ0aF6KqT/6RyJkuMiHqqXvb/6V840I9L7+uzJpHM06QKs3lS1huUidA5hhvQ5oeaYLEeOyWS+qx3NoNMQG30x00G4L7yrn3PWPVgcRGYCLzP+S4CclmPMEc0jcs46SmQAj/USGs/CKyX1Gt/X9f26Jobc7hzrjP63bzyd8QDk5GUFKi2VNj14JToCKQ54Gltnkoc+AQYc2ZXzAG/j52Qfo//t1kaAgTmpvSyS0T0CGTJPRU5OdOLSBuzmxj53sruCfHpkHII55vo9efV1QLeKAJG42eQ99vORsRqK0deN/cs+97T5o8q2RQSiMcif6B7LZ1o/yswFvrI/85Uaf8EusNwqgdxSg79PYn/5KRjF9ZR5EctdDiOfyXw7qDS2z8qBwPHJTpvSAwxUNvwNvMWehH5uCMe00VgvIar1GZh0DZ1uwnjeWRDE1bR3HsnrR9jT7E3fFjvCVOTcz+CzOicC0tqO4sklKy7v5k0AiSNOmAEpco0WbeiCf8uwllpRrTICwhvXn+OK4lG6+MfPUdDAXBC4sT3mCsM+boPTbD3qtH+wvkSCSnDIthj0+KsmQbcelzyGPGSt+9/DCsMeW7kHas1rHLHx02Sg9S7oQYK7pNdIBBfT92iakzLb9IKPD4QlHvp/ar93d8udK5eynG0qGJhSLLLOz3KEz702254I29Wrqfokfd0pshshhNSagjp9WTDe+mw/qSFxIHtp29luzwMO/s1/0ypgtpYHROGFi7NjqL7Jm4LiLtILNyEKor9oh3cfkBNluHq6uIXXSF2BSOJBqhvNyBOKvR1yZg42EVztvq9sarbKWcYqiNfYeXUrXm8URilneBpoqmTw9pQYIHPGC/7T9C+MKthnJ5cEwE+fk/4bupe/GOYKn1jrrtBIkNav1n/naFtxyOBEkeQ9EM2n4x+7nH9rf1Uwg9oWJ9cuu+mTs6AmbUm0LOaKwCHIPPtWwwgUvB9APG+HPWq0pO4+v/VeXco+pd1AehJXzJrM/iCeJcefm7Wj/biJvcLB959ddlpP7G8RdkQDx+ortUKi4UsMAz8I3+WzbEIxbCZ1+3uziedF3RZ1aZlrMQYfMLLJZVPsk6OF57cpPfQygG3nkyeR9dvj184wcb4BVRDmBdr7craeP4gVl6GG3c81cxu0ZBj+bE+8rsAqHctvwJeTmWuECHkAqpKDREjHkAKM7V4pgwsEcVoUNAOqpb1pShK3Cvxi/pUuQc87xv8Cpk36OOFmuLZ6+YsXADLoQ02cBdM+Tc25kOtM1ftyKuTu/SJZccqiXnZEYqqhsNTQHKo3YaMIsLy12dtgs3F+hvygff9W4pAZ86KNIB1HLhk3KUAQKcHnFx58gxBbphu2+OXGkJKojQT3eHTPav7pmFZxR78XdJ7+vJ0vz34kyiPbvbAB2K0rMMTun/V8kYZL8WBz6GoIvIPIlq283Mm4jf7gwknf2BhoW6sbri0dEyrutxqRHvFguY5Re+hphgNEIfvw+GZPez/9UO6hrB3MxTCe3yUQSzyDfvu+WtcABeWDpeMOsyes92R7LdV4PF18U7J6pT3C1X76wi2/kcn47Ry/hq4kHttlKo4ulKUz3TTESbXoohAENLSEJGP6duOiFXtVeJ24yjPBjl8zJje07eT38fxOHJF1nn6PmmOhfaSl0TbRGqGxttKaNQvhfFx9wFX+//BHXWk4GSmcnWDExdJ/kGOiVdW4d6oGT4FdQyUHZxfRI1IlioLRy3hnKnzTYJ1XRLIV+wpvbatmhh0J1AkCZmQyCJNGHclI7G+mQ5CSSxzpts/+e3AMFlvCBrleTj+TFZZv4+FJvS4PIrSe8M0B4AzFLgL66ZqHojVbW5Ta+1L7bVlYztSRcENAUMDtZRUNj0t0nHVcrY73OWYLPu+79M1oF7PV1636x4s9fkDbs8scg4yMMvU1fSceFa0LhgCNmpZcVPyH9J+kXF9viK/jnkAMYOTdE73AP3/Js578Vb/3FM9ne3S+t9RxaOiphzxzSdG+xqO2Q9wwYm31mPG5VPkDSp8KAjuwDe4ippzdxiNkJgj4hd2JERrby2bpk4tZ/0nrLb3F6dmlmEtj8rGja6/T7Hf1DZL1DS7ngDkPNZs1ecLnFGvzNZRGL//gdgC5o0i+Qr7/fbAvLN3/1YMP2+1kDrQ9S5uVOnCPY067pgSfhzpMxACBu70ivDOgB8Uw4pJbG/OuywZx2ZumzMT9/vGbQaBIvOzpUlY1A61TPlaDQYqlUPZl2TZxvr6yBbnkLdqjcYMP9TFQ7U25qO42gNQrw+Elom5VKbtFpjfBwUdBDWG7KQcisgAAA==","k":"fit","b":"#FFFFFF","r":1.21},
    "haoxianglai": {"u":"data:image/webp;base64,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","k":"fit","b":"#FFFFFF","r":3.77},
    "heytea-topping": {"u":"data:image/webp;base64,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","k":"fit","b":"#FFFFFF","r":1.09},
    "kfc":         {"u":"data:image/webp;base64,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","k":"fit","b":"#FFFFFF","r":2.29},
    "luckin":      {"u":"data:image/webp;base64,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","k":"full","b":"#303864","r":1.0},
    "mcd":         {"u":"data:image/webp;base64,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","k":"fit","b":"#FFFFFF","r":1.27},
    "mcd-member":  {"u":"data:image/webp;base64,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","k":"fit","b":"#FFFFFF","r":1.27},
    "mixue":       {"u":"data:image/webp;base64,UklGRnAFAABXRUJQVlA4IGQFAADwHACdASpgAEUAPjEYiUOiIaETy2ywIAMEoAzJIfQP+0nhwuWDqwzx9O/5L7gN4X/vX8a3gH6pfsr7GfqW9AD9h+sQ9AD+Af3n0qv2l+CP9j/1y+AP9dP+xWrOLnx77VaAHzNe4Zyz/G/kvwQXGv5X/sOMD6kf4D1Ifyj/D+Rn4N/x71AP4z/Kf77/ZP3K/0Xxcf5/lB+dP9/7gn8m/m/+h/O34pfYB+2/ssk8Yvr2XacV0H+Lvo0PPYPjGfe4AjVMPuVH6l69C/8aTpuDmzVNAtSWomqZV4/WJUZnYeZ29NbfR84m5KF9CYd18jlnqEAA/vnnARiCllYT//ksv/yFT/5LLuigQ4aks7bNOLq+H0gTlEeFU2GDzcEW/fXMioYP2VFYXKYPc1NSMQZ4F2Mvo+yF6S3j25nwHy9AZQ41UOCKURuZbVE9pPzlaoQn9mu/iut+E7/31t8rbqHvpS3kFBvoEIXAapcmZOontTwoBFjBJWP03N+AUtiyx/9C4KOOaFFL5PUX8eS8/RwobWOKoEPJ/3vo4fbmZnLNPTgrecMActfkCph/2uk81PTIHKMNnsdHt8fhPTWnfQ88H1tPkAr3ReHtzVQ2PwFN+TRzk7ijfdrNCwpTDEYI83Mh8Xn61w19nS/STULFWTi09QCfZP3hQuYJRHqvYduAQwW6vEwE9wnDwguTpL9ZD9ySZW2FQeW10K/DqLTUPdLcnUuaGWn4fR4z6fxqhK96zvaAIHL6wDLa5CUgMzUKF1tveR17RTi5qNfBEL6ly0NKrz3oxI2RhYi3k0qmstocw6qG6j6rPAqoMLcu3sumuyT94IGD1DUS/xkIgFGsnYe7f/hmL0HjHVoay7e4VKI1fPD/e7OZUMDybObIy2xG2/hTp/OkR8n37yuAGtYQIpLlm9uf/24vQKwA9DwdGaAV7/yV656PYz9wBVl2fV4iHLj9Du1nzWMrzzO1MnBtAkQRr5l/6CsjtFFcLF4x7os/uHWuI9a+yX//vrV7+Y230f8Tzdooo5FWy3VngxR4rv/kDqF0iBeBagCDlCufW2yyUzJBkwPpVFEq3wjgW9L6ffLYDQYTSg/D7lH8aZjHIhvyGzx+95Tn9rN/4xcNNZDWumnJt7Bm1nfP2JhuFERGgouTdfXPbA5NWO4lSMpM8GvO8/BfiUAmBhnAjlJci1W+3c+l3mC//6Uf8S5WWDfJc9z/8DgLRP+DHWsm2B7/1Ep1D0YW66BJoUBqg7O8f/vl6+jZV1I58Ws/X/6LJPn9hxfhmPwX+CHOb16kONjF+of5ASV5ceCTR1t11MCOCFeQ9VysAcFhv7qvyUInWjGVL+bz09v9IYbUqNQ/qv28Sjue/wBSSuoZ5bIufJQP20wLeL6fN9QKN2mhOGvZ9UcQ+oVFWi79r10Y+EkbYttyE/zoT/5pOTMXsU1Pv/jNA2Qt03+SVfRDyhSrafR2kJMxzmLldsnxjiJpPDSi+Ff7/WIFD99njghhvv9LJNm62no5DBLu7V+RfuLbj6vPletJtOrcbCu5KYBgzmWeN5TfWzXbCmT5zTks928CPU9G4KSr/UVVqK0FI7KMZuyI+lopYmw4nKzghk9Ke8EKZvZqfJ4dPYGUJO/Gyl3i/8ItfTBLCKKrIab22WIcDnvcmL7q968wAvAPmy2xl0AIXBqtGvuZ/Oa8ktXRRnvzczPlxYUo/2TO0KozBB/Pef4bDTRB46oUK8zdrBvlH922Of2q2KxvuDmYPLJNZvsA1zXdusra/PPKdkCqfV6ZVzNhjl9mBngIHlHZ4mr4fO4LUT8UJ6/WhWgJ0YKdfyvaZy76Fvq/HkuZyVy0gAA=","k":"full","b":"#E40058","r":1.38},
    "pizza":       {"u":"data:image/webp;base64,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","k":"fit","b":"#FFFFFF","r":1.25},
    "tastien":     {"u":"data:image/webp;base64,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","k":"full","b":"#E83C00","r":1.0},
    "wallace":     {"u":"data:image/webp;base64,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","k":"full","b":"#4C2428","r":1.0},
    "yihetang":    {"u":"data:image/webp;base64,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","k":"fit","b":"#FFFFFF","r":1.13},
    "zym":         {"u":"data:image/webp;base64,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","k":"fit","b":"#FFFFFF","r":0.79}
  };
  /* <<< LOGOS */

  var BRANDS = {
    'kfc':          { char: '肯', bg: '#E2231A24', ink: '#8A120F', mark: 'M21.893 8.23c-4.187.001-5.249 2.365-5.42 3.97-.194 1.802 1.053 3.57 4.127 3.57 1.294 0 2.14-.225 2.44-.32a.215.215 0 00.147-.166l.173-.91a.184.184 0 00-.236-.21c-.336.106-.93.252-1.685.252-1.469 0-2.53-.882-2.395-2.4.13-1.47 1.121-2.59 2.485-2.59.82 0 1.183.43 1.156 1.003v.033a.184.184 0 00.182.193h.557c.086 0 .16-.06.18-.143l.39-1.76a.215.215 0 00-.15-.255 7.21 7.21 0 00-1.95-.266zm-20.157.116a.2.2 0 00-.195.156l-.108.484a.198.198 0 00.13.23l.033.01c.208.082.45.266.348.748l-.792 3.62c-.207.987-.542 1.19-.86 1.226h-.01a.2.2 0 00-.176.157l-.102.464a.192.192 0 00.187.233h3.487c.085 0 .159-.06.177-.142l.12-.543a.184.184 0 00-.112-.21l-.022-.01c-.177-.07-.418-.224-.356-.51l.405-1.85c1.389 2.535 1.848 3.266 3.514 3.265H8.91a.181.181 0 00.177-.142l.105-.47a.195.195 0 00-.186-.238c-.376-.006-.56-.093-.935-.575l-1.932-2.614 2.51-2.088c.337-.264.748-.338.976-.368l.022-.002a.185.185 0 00.163-.144l.103-.464a.184.184 0 00-.18-.223h-3.02a.199.199 0 00-.193.155l-.102.46a.2.2 0 00.138.235c.178.069.217.24.063.366L4.046 11.7l.44-2.014a.683.683 0 01.477-.487l.025-.008a.199.199 0 00.135-.147l.106-.477a.181.181 0 00-.177-.22zm8.88 0a.2.2 0 00-.194.156l-.107.483a.19.19 0 00.122.221l.02.008c.204.077.487.274.364.758l-1.21 5.48a.182.182 0 00.178.222h2.777c.086 0 .16-.06.179-.143l.12-.547a.174.174 0 00-.098-.196 1.558 1.558 0 01-.027-.013c-.176-.086-.438-.285-.35-.67.009-.05.27-1.24.27-1.24h2.362c.086 0 .16-.06.18-.143l.221-1a.183.183 0 00-.18-.224h-2.28l.427-1.94 1.592-.003c.515 0 .672.27.642.728l-.002.024a.184.184 0 00.183.205h.587c.086 0 .16-.06.178-.144l.4-1.8a.184.184 0 00-.18-.222z' },
    'mcd':          { char: '麦', bg: '#DA291C24', ink: '#8A160E', mark: 'M17.243 3.006c2.066 0 3.742 8.714 3.742 19.478H24c0-11.588-3.042-20.968-6.766-20.968-2.127 0-4.007 2.81-5.248 7.227-1.241-4.416-3.121-7.227-5.231-7.227C3.031 1.516 0 10.888 0 22.476h3.014c0-10.763 1.658-19.47 3.724-19.47 2.066 0 3.741 8.05 3.741 17.98h2.997c0-9.93 1.684-17.98 3.75-17.98Z' },
    'mcd-member':   { char: '麦', bg: '#DA291C24', ink: '#8A160E' },
    'luckin':       { char: '瑞', bg: '#002D7224', ink: '#001A45' },
    'dominos-mon':  { char: '达', bg: '#00649124', ink: '#003D5C' },
    'dominos-wed':  { char: '达', bg: '#00649124', ink: '#003D5C' },
    'tastien':      { char: '塔', bg: '#D7282F24', ink: '#7E1419' },
    'heytea-topping': { char: '喜', bg: '#0C8A4E24', ink: '#064B2A' },
    'pizza':        { char: '必', bg: '#D8232A24', ink: '#7E1419' },
    'mixue':        { char: '蜜', bg: '#E6001224', ink: '#7E1419' },
    'chabaidao-up': { char: '茶', bg: '#1AAD1924', ink: '#0E5E0E' },
    'chabaidao-88': { char: '茶', bg: '#1AAD1924', ink: '#0E5E0E' },
    'wallace':      { char: '华', bg: '#E2231A24', ink: '#8A120F' },
    'guming':       { char: '古', bg: '#0E7A3B24', ink: '#064B2A' },
    'yihetang':     { char: '益', bg: '#C8102E24', ink: '#6E0A19' },
    'haoxianglai':  { char: '好', bg: '#F0830024', ink: '#8A4A00' },
    'dicos':        { char: '德', bg: '#E2231A24', ink: '#8A120F' },
    'haidilao':     { char: '海', bg: '#C8102E24', ink: '#6E0A19' },
    'zym':          { char: '赵', bg: '#E6001224', ink: '#7E1419' },
    'zunte':        { char: '尊', bg: '#2B6CB024', ink: '#173E66' },
    'convenience':  { char: '便', bg: '#4755692E', ink: '#1E293B' },
    'runtop':       { char: '润', bg: '#2563EB24', ink: '#173E66' },
    'dormstore':    { char: '宿', bg: '#4755692E', ink: '#1E293B' }
  };

  /** 渲染一个品牌瓦片：真实 logo > 内置图标 > 品牌色字母章（最多三级回落） */
  function brandTile(id, size) {
    var b = BRANDS[id];
    var L = LOGOS[id];
    if (!b && !L) { return ''; }
    /* size: 'md' 24px（活动行首） / 'sm' 20px（胶囊、日历芯片） / true 兼容旧调用 = sm / 省略 = 30px */
    var sz = (size === 'md' || size === 'sm') ? ' ' + size : (size === true ? ' sm' : '');
    /* kind=full 的 logo 自带品牌色实底：瓦片底色直接用图自身边色并贴边，
       这样非正方形的实底图标（库迪、蜜雪）等比缩放后也不会露出白缝 */
    var cls = 'brand-tile' + sz + (L ? ' has-logo' : '') +
      (L && L.k === 'full' ? ' bt-full' : '');
    var style = '--bc:' + (L ? L.b : b.bg) + ';--bi:' + (b ? b.ink : '#374151');
    var inner;
    if (L) {
      inner = '<img class="bt-logo" src="' + L.u + '" alt="" aria-hidden="true" decoding="async">';
    } else if (b.mark) {
      inner = '<svg class="bt-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="' + b.mark + '"></path></svg>';
    } else {
      inner = esc(b.char);
    }
    return '<span class="' + cls + '" style="' + style + '">' + inner + '</span>';
  }

  /** 条目图标：有品牌瓦片就用品牌瓦片（真实 logo / 字母章），否则退回 emoji / 线性 svg */
  function itemIcon(it, cls) {
    if (it && (BRANDS[it.id] || LOGOS[it.id])) { return brandTile(it.id, cls === 'sm'); }
    return it && it.icon ? dlIcon(it.icon, null, null) : esc(it && it.emoji ? it.emoji : '');
  }

  function weekdayCn(d) { return WEEK_CN[toDate(d).getDay()]; }

  /* ================================================================== */
  /* 四、活动计算                                                        */
  /* ================================================================== */

  function merchantById(id) {
    for (var i = 0; i < MERCHANTS.length; i++) {
      if (MERCHANTS[i].id === id) { return MERCHANTS[i]; }
    }
    return null;
  }

  /** 某个商家活动是否落在这一天 */
  function matchRule(m, d) {
    var r = m.rule || {};
    if (r.type === 'always') { return true; }
    if (r.type === 'weekly') {
      if (Array.isArray(r.weekday)) { return r.weekday.indexOf(isoWeekday(d)) !== -1; }
      return isoWeekday(d) === r.weekday;
    }
    if (r.type === 'monthly') { return toDate(d).getDate() === r.day; }
    return false;
  }

  /** 下一次（含今天）命中该活动的日期 */
  function nextOf(merchantId, from) {
    var m = merchantById(merchantId);
    if (!m) { return null; }
    var start = toDate(from || new Date());
    if (m.rule.type === 'always') { return start; }
    for (var i = 0; i < 400; i++) {
      var d = addDays(start, i);
      if (matchRule(m, d)) { return d; }
    }
    return null;
  }

  /** 最近一场大促：{promo, date, days, warming} */
  function nextPromo(from) {
    var start = toDate(from || new Date());
    var best = null;
    for (var y = start.getFullYear(); y <= start.getFullYear() + 1; y++) {
      for (var i = 0; i < PROMOS.length; i++) {
        var p = PROMOS[i];
        var dt = new Date(y, p.month - 1, p.day);
        var d = daysBetween(start, dt);
        if (d < 0) { continue; }
        if (!best || d < best.days) {
          best = { promo: p, date: dt, days: d, warming: d <= p.warmup };
        }
      }
    }
    return best;
  }

  /** 当天活动列表：[{type:'weekly'|'monthly'|'always'|'promo', merchant?, promo?, title, ...}] */
  function dealsOn(date) {
    var d = toDate(date);
    var out = [];
    var i;
    for (i = 0; i < MERCHANTS.length; i++) {
      var m = MERCHANTS[i];
      if (!matchRule(m, d)) { continue; }
      var isAlways = m.rule.type === 'always';
      out.push({
        type: isAlways ? 'always' : (m.rule.type === 'weekly' ? 'weekly' : 'monthly'),
        id: m.id, name: m.name, emoji: m.emoji, cat: m.cat,
        place: m.place || '', coach: m.coach || '',
        title: m.title, what: m.what, how: m.how, tip: m.tip,
        certainty: m.certainty, source: m.source,
        tag: isAlways ? '常驻' : (m.rule.type === 'weekly' ? (Array.isArray(m.rule.weekday) ? '工作日' : '每周' + WEEK_CN[m.rule.weekday % 7]) : '每月 ' + m.rule.day + ' 号')
      });
    }
    var np = nextPromo(d);
    if (np && np.days === 0) {
      out.push({ type: 'promo', id: np.promo.id, name: '电商大促', icon: 'spark', cat: '电商',
        title: np.promo.name + ' 当天', what: np.promo.depth, how: '当天为正式活动日，注意尾款与满减门槛',
        tip: '大促当天不是所有品类都最便宜，先看历史价再下单', certainty: 'stable',
        source: '平台官方活动页', tag: '今天' });
    } else if (np && np.days === np.promo.warmup) {
      out.push({ type: 'promo', id: np.promo.id, name: '电商大促', icon: 'clock', cat: '电商',
        title: np.promo.name + ' 预热开始（还有 ' + np.days + ' 天）', what: np.promo.depth,
        how: '先加购物车、领券，正式开卖再付；注意预售价与定金规则',
        tip: '预热期的"预售价"未必最低，别被倒计时催着下单', certainty: 'stable',
        source: '平台官方活动页', tag: '预热' });
    }
    return out;
  }

  /** 未来 N 天逐日：只有限时活动才进日历，常驻活动单独列一次，避免日历全是噪音 */
  function upcoming(days, from) {
    var start = toDate(from || new Date());
    var list = [];
    for (var i = 0; i < (days || 14); i++) {
      var d = addDays(start, i);
      var all = dealsOn(d).filter(function (x) { return x.type !== 'always'; });
      list.push({ date: dateKey(d), weekday: weekdayCn(d), offset: i, items: all });
    }
    return list;
  }

  /** 常驻活动（不进逐日日历，单独展示） */
  function alwaysDeals() {
    return dealsOn(new Date()).filter(function (x) { return x.type === 'always'; });
  }

  /* ================================================================== */
  /* 五、品类价格带（素人模式第一句回答用；不是报价）                      */
  /* ================================================================== */

  /**
   * 口径：为日常主流价位经验区间，只用于"这个价大概在什么档"，
   * 精确比价必须用真实报价（compareOffers）。充电宝一行按 10000mAh 主流容量估。
   */
  var BANDS = [
    { keys: ['充电宝', '移动电源', '充电电池'], name: '充电宝（10000mAh）', low: [40, 80], mid: [80, 150], high: [150, 300], channel: '拼多多百亿补贴 / 京东大促' },
    { keys: ['蓝牙耳机', '无线耳机', '耳机', 'airpods'], name: '蓝牙耳机', low: [50, 150], mid: [150, 500], high: [500, 1500], channel: '拼多多百亿补贴（标品）' },
    { keys: ['保温杯', '水杯', '杯子'], name: '保温杯（500ml）', low: [30, 60], mid: [60, 150], high: [150, 400], channel: '拼多多百亿补贴 / 淘宝第三方' },
    { keys: ['洗衣液'], name: '洗衣液（3L 装）', low: [15, 25], mid: [25, 45], high: [45, 80], channel: '拼多多 / 抖音直播间' },
    { keys: ['洗发水', '洗发露'], name: '洗发水（500ml）', low: [20, 40], mid: [40, 80], high: [80, 200], channel: '拼多多百亿补贴' },
    { keys: ['电动牙刷'], name: '电动牙刷', low: [80, 150], mid: [150, 350], high: [350, 800], channel: '拼多多百亿补贴' },
    { keys: ['空气炸锅'], name: '空气炸锅', low: [150, 300], mid: [300, 600], high: [600, 1200], channel: '拼多多 / 京东大促' },
    { keys: ['电饭煲', '电饭锅'], name: '电饭煲', low: [100, 250], mid: [250, 600], high: [600, 1500], channel: '京东自营大促 / 拼多多' },
    { keys: ['运动鞋', '跑鞋', '球鞋'], name: '运动鞋', low: [100, 250], mid: [250, 600], high: [600, 1500], channel: '唯品会 / 淘宝第三方' },
    { keys: ['笔记本', '电脑', '平板'], name: '笔记本（学生本）', low: [2500, 3500], mid: [3500, 5500], high: [5500, 9000], channel: '京东教育优惠 / 618' },
    { keys: ['显示器'], name: '显示器（27 寸）', low: [500, 800], mid: [800, 1500], high: [1500, 3000], channel: '京东自营 / 618' },
    { keys: ['扫地机器人', '扫地机'], name: '扫地机器人', low: [800, 1500], mid: [1500, 3000], high: [3000, 6000], channel: '京东自营大促' }
  ];

  function findBand(item) {
    var s = String(item || '').toLowerCase();
    if (!s) { return null; }
    for (var i = 0; i < BANDS.length; i++) {
      var b = BANDS[i];
      for (var j = 0; j < b.keys.length; j++) {
        if (s.indexOf(b.keys[j].toLowerCase()) !== -1) { return b; }
      }
    }
    return null;
  }

  /** 把一个价按价格带分档：入门 / 中档 / 高档 / 偏贵 */
  function judgePrice(item, price) {
    var b = findBand(item);
    var p = Number(price);
    if (!b || !isFinite(p) || p <= 0) { return null; }
    var level, label, note;
    if (p <= b.low[1]) {
      level = 'entry'; label = '入门档';
      note = '属于「' + b.name + '」的入门价位，' + b.low[0] + '-' + b.low[1] + ' 元区间内';
    } else if (p <= b.mid[1]) {
      level = 'mid'; label = '中档';
      note = '落在中档价位（' + b.mid[0] + '-' + b.mid[1] + ' 元），通常是主力款';
    } else if (p <= b.high[1]) {
      level = 'high'; label = '高档';
      note = '已到高档价位（' + b.high[0] + '-' + b.high[1] + ' 元），为品牌/功能溢价买单';
    } else {
      level = 'over'; label = '偏贵';
      note = '高于「' + b.name + '」的主流高档上限（' + b.high[1] + ' 元），先确认是不是新款/大容量版本';
    }
    return { band: b.name, bandObj: b, level: level, label: label, text: note, channel: b.channel };
  }

  /** 现在买还是等大促（口径：不承诺大促一定更便宜） */
  function timingAdvice(price, from) {
    var np = nextPromo(from);
    var p = Number(price) || 0;
    var advice;
    if (!np) {
      return { text: '按需买就行，暂时算不出最近的大促节点。', promo: null, days: null };
    }
    var days = np.days;
    var name = np.promo.name;
    if (p >= 500) {
      if (days <= 30) { advice = '单价 ' + p + ' 元属大件，距 ' + name + ' 只剩 ' + days + ' 天——不急就等，大促通常有直降或满减。'; }
      else { advice = '单价 ' + p + ' 元属大件，但距 ' + name + ' 还有 ' + days + ' 天，等下去时间成本过高——现在买，记得看有没有价保。'; }
    } else if (p > 0 && p < 100) {
      advice = '单价 ' + p + ' 元属小件，跨平台价差通常只有几块——不用为省这点钱等 ' + days + ' 天，现在比完价就买。';
    } else if (days <= 20) {
      advice = '距 ' + name + ' 还有 ' + days + ' 天——不急着用可以等；急用现在买。';
    } else {
      advice = '距最近的 ' + name + ' 还有 ' + days + ' 天，比较远——按需买就行。';
    }
    return {
      text: advice,
      promo: np.promo.name,
      days: days,
      date: dateKey(np.date),
      warming: np.warming,
      depth: np.promo.depth
    };
  }

  /* ================================================================== */
  /* 六、比价口径引擎                                                     */
  /* ================================================================== */

  var RE_MULTI = /(\d+)\s*[包瓶罐盒装袋提]?\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*(ml|毫升|l|升|g|克|kg|千克|公斤)/;
  var RE_MULTI_REV = /(\d+(?:\.\d+)?)\s*(ml|毫升|l|升|g|克|kg|千克|公斤)\s*[xX×*]\s*(\d+)\s*[包瓶罐盒装袋]?/;
  var RE_PREFIX = /(\d+(?:\.\d+)?)\s*[包瓶罐盒袋箱筒听提条支]\s*装\s*(\d+(?:\.\d+)?)\s*(ml|毫升|l|升|g|克|kg|千克|公斤)/;
  var RE_COUNT_MULTI = /(\d+(?:\.\d+)?)\s*(抽|张|片|卷|包|袋|盒|瓶|罐|听|筒|条|个|只|支|枚|件)\s*[xX×*]?\s*(\d+(?:\.\d+)?)\s*(提|箱|组|套|袋|包|盒|件)/;
  var RE_JIN_MULTI = /(\d+(?:\.\d+)?)\s*斤\s*[xX×*]\s*(\d+)/;
  var RE_JIN = /(\d+(?:\.\d+)?)\s*斤/;
  /* 充电宝/电池容量：10000mAh —— 单列一类，按元/1000mAh 折算才直观 */
  var RE_MAH = /(\d+(?:\.\d+)?)\s*(mah|毫安时|毫安)/i;
  var RE_VOL = /(\d+(?:\.\d+)?)\s*(ml|毫升|l|L|升|g|克|kg|千克|公斤)/;
  var RE_COUNT = /(\d+(?:\.\d+)?)\s*(包|抽|张|提|片|枚|卷|条|双|只|个|支|盒|袋|瓶|罐|听|筒|箱|组|套|件)/;
  var RE_NEED1 = /(?:需买|需购买|需要买|必须买|至少买|最少买|买够|买满|满|囤)\s*(\d+)\s*(?:件|个|盒|包|提|瓶|罐|袋|组|箱|套)/;
  var RE_NEED2 = /(\d+)\s*(?:件|个|盒|包|提|瓶|罐|袋|组|箱|套)\s*(?:起|以上|起售|起购)/;

  var CN_DIGIT = { '零': '0', '一': '1', '二': '2', '两': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' };

  /** 价格清洗：'¥39.9' / '39.9元' / '1,299.00' / 全角 都能读 */
  function toNum(v, dft) {
    if (v === null || v === undefined || v === '') { return dft === undefined ? null : dft; }
    if (typeof v === 'number') { return isFinite(v) ? v : (dft === undefined ? null : dft); }
    var s = String(v)
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[．]/g, '.').replace(/,/g, '');
    var m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) { return dft === undefined ? null : dft; }
    var n = parseFloat(m[0]);
    return isFinite(n) ? n : (dft === undefined ? null : dft);
  }

  function normSpecText(spec) {
    var s = String(spec || '').replace(/\s+/g, '');
    s = s.replace(/包邮|包运费|免邮|包退|包换|包安装|包配送/g, '');
    s = s.replace(/[零一二两三四五六七八九十](?=[包瓶罐盒袋箱筒听提条支个只张片抽卷])/g, function (ch) {
      return CN_DIGIT[ch] || ch;
    });
    return s;
  }

  /** 规格 -> {qty, unit}；unit 为 ml / g / 计数单位，可直接横向比单价 */
  function parseSpec(spec) {
    var s = normSpecText(spec);
    if (!s) { return { qty: null, unit: null }; }
    var m, cnt, val, u;
    m = s.match(RE_MULTI);
    if (m) {
      cnt = parseFloat(m[1]); val = parseFloat(m[2]); u = m[3].toLowerCase();
      if (u === 'l' || u === '升') { return { qty: cnt * val * 1000, unit: 'ml' }; }
      if (u === 'kg' || u === '千克' || u === '公斤') { return { qty: cnt * val * 1000, unit: 'g' }; }
      return { qty: cnt * val, unit: (u === 'ml' || u === '毫升') ? 'ml' : 'g' };
    }
    m = s.match(RE_MULTI_REV);
    if (m) {
      val = parseFloat(m[1]); u = m[2].toLowerCase(); cnt = parseFloat(m[3]);
      if (u === 'l' || u === '升') { return { qty: cnt * val * 1000, unit: 'ml' }; }
      if (u === 'kg' || u === '千克' || u === '公斤') { return { qty: cnt * val * 1000, unit: 'g' }; }
      return { qty: cnt * val, unit: (u === 'ml' || u === '毫升') ? 'ml' : 'g' };
    }
    m = s.match(RE_PREFIX);
    if (m) {
      cnt = parseFloat(m[1]); val = parseFloat(m[2]); u = m[3].toLowerCase();
      if (u === 'l' || u === '升') { return { qty: cnt * val * 1000, unit: 'ml' }; }
      if (u === 'kg' || u === '千克' || u === '公斤') { return { qty: cnt * val * 1000, unit: 'g' }; }
      return { qty: cnt * val, unit: (u === 'ml' || u === '毫升') ? 'ml' : 'g' };
    }
    m = s.match(RE_COUNT_MULTI);
    if (m) { return { qty: parseFloat(m[3]), unit: m[4] }; }
    m = s.match(RE_JIN_MULTI);
    if (m) { return { qty: parseFloat(m[1]) * 500 * parseFloat(m[2]), unit: 'g' }; }
    m = s.match(RE_JIN);
    if (m) { return { qty: parseFloat(m[1]) * 500, unit: 'g' }; }
    m = s.match(RE_MAH);
    if (m) { return { qty: parseFloat(m[1]), unit: 'mAh' }; }
    m = s.match(RE_VOL);
    if (m) {
      val = parseFloat(m[1]); u = m[2].toLowerCase();
      if (u === 'l' || u === '升') { return { qty: val * 1000, unit: 'ml' }; }
      if (u === 'kg' || u === '千克' || u === '公斤') { return { qty: val * 1000, unit: 'g' }; }
      return { qty: val, unit: (u === 'ml' || u === '毫升') ? 'ml' : 'g' };
    }
    m = s.match(RE_COUNT);
    if (m) { return { qty: parseFloat(m[1]), unit: m[2] }; }
    return { qty: null, unit: null };
  }

  /** 购买门槛：「需买 4 件」「4 件起」-> 4；没写 -> 1 */
  function parseNeed(text) {
    var s = String(text || '');
    var m = s.match(RE_NEED1) || s.match(RE_NEED2);
    if (!m) { return 1; }
    var n = parseInt(m[1], 10);
    return (isFinite(n) && n >= 1) ? n : 1;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function fmt(n) {
    if (n === null || n === undefined || !isFinite(n)) { return '—'; }
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function fmt3(n) {
    if (n === null || n === undefined || !isFinite(n)) { return '—'; }
    return (Math.round(n * 1000) / 1000).toFixed(3);
  }

  /** 折合单价的展示文案：ml/g 给每 100 单位，mAh 给每 1000mAh，其余给每个计数单位 */
  function perLabel(r) {
    if (!r || r.per === null || r.per === undefined || !isFinite(r.per)) { return '—'; }
    if (r.unit === 'ml' || r.unit === 'g') { return fmt(r.per * 100) + ' 元/100' + r.unit; }
    if (r.unit === 'mAh') { return fmt(r.per * 1000) + ' 元/1000mAh'; }
    return fmt3(r.per) + ' 元/' + r.unit;
  }

  /**
   * 比价主函数
   * @param {Array} offers [{platform,title,price,ship,coupon,spec,needQty}]
   * @param {Object} opts   {item, budget, today}
   * @return {Object} 结果（含 headline / rows / warnings / timing / budget）
   */
  function compareOffers(offers, opts) {
    opts = opts || {};
    var item = opts.item || '未命名商品';
    var today = opts.today ? toDate(opts.today) : new Date();
    var rows = [], skipped = [], i;

    offers = Array.isArray(offers) ? offers.slice(0, 20) : [];
    for (i = 0; i < offers.length; i++) {
      var o = offers[i] || {};
      var price = toNum(o.price);
      if (price === null || price <= 0 || !isFinite(price)) {
        skipped.push('第 ' + (i + 1) + ' 条：没读到有效价格，已跳过');
        continue;
      }
      var ship = toNum(o.ship, 0) || 0;
      var coupon = toNum(o.coupon, 0) || 0;
      var need = toNum(o.needQty, null);
      if (!need) { need = parseNeed((o.title || '') + ' ' + (o.spec || '')); }
      need = Math.max(1, Math.round(need || 1));
      var sp = parseSpec(o.spec);
      if (need === 1) {
        var need2 = parseNeed(String(o.spec || ''));
        if (need2 > 1) { need = need2; }
      }
      var eff = Math.max(0, price * need + ship - coupon);
      rows.push({
        platform: String(o.platform || '未知平台'),
        title: String(o.title || '').trim(),
        price: price, ship: ship, coupon: coupon, needQty: need,
        spec: String(o.spec || ''),
        eff: eff, qty: sp.qty, unit: sp.unit,
        per: (sp.qty && sp.qty > 0) ? eff / (sp.qty * need) : null
      });
    }

    if (!rows.length) {
      return {
        ok: false, item: item, rows: [], mode: 'empty', comparable: false,
        headline: '这几条里没读到有效价格——按「平台 + 价格 + 规格」给我，例如：淘宝 89 包邮 10000mAh。',
        sublines: [], warnings: skipped, skipped: skipped, timing: null, budget: null
      };
    }

    /* ---- 可比性判定：先找最大可比子集（单位相同的条目才能放一起比） ---- */
    var groups = {}, j;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.qty && r.unit) {
        if (!groups[r.unit]) { groups[r.unit] = []; }
        groups[r.unit].push(r);
      }
    }
    var mainGroup = [], mainUnit = null;
    for (var u in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, u)) { continue; }
      if (groups[u].length > mainGroup.length) { mainGroup = groups[u]; mainUnit = u; }
    }
    var covered = (mainGroup.length === rows.length && mainGroup.length > 0);
    var qtyKeys = {};
    for (j = 0; j < mainGroup.length; j++) { qtyKeys[Math.round(mainGroup[j].qty * 100)] = true; }
    var sameQty = covered && Object.keys(qtyKeys).length === 1;
    // 「需买N件」不一致时不能比整单总价：京东 99 元需买 2 件，整单 198 元，
    // 直接跟单件 89 元比会得出"贵 109 元"的假结论 —— 必须切到单价口径。
    var needKeys = {};
    for (j = 0; j < mainGroup.length; j++) { needKeys[mainGroup[j].needQty] = true; }
    var sameNeed = covered && Object.keys(needKeys).length === 1;

    var mode;
    if (rows.length === 1) { mode = 'single'; }
    else if (mainGroup.length >= 2 && covered && sameQty && sameNeed) { mode = 'total'; }
    else if (mainGroup.length >= 2 && covered) { mode = 'unit'; }
    else if (mainGroup.length >= 2) { mode = 'partial'; }
    else if (mainGroup.length === 0) { mode = 'total_nospec'; }
    else { mode = 'mixed'; }

    rows.sort(function (a, b) {
      if (mode === 'unit' || mode === 'partial') {
        var pa = a.per === null ? Infinity : a.per;
        var pb = b.per === null ? Infinity : b.per;
        if (pa !== pb) { return pa - pb; }
      }
      return a.eff - b.eff;
    });

    var best = rows[0], worst = rows[rows.length - 1];
    var save = worst.eff - best.eff;
    var multi = rows.length >= 2 && save > 0.005;

    function tag(r) {
      return '[' + r.platform + ']' + (r.title ? ' ' + r.title : '');
    }
    function perUnit(r) { return perLabel(r); }

    var headline = '', sublines = [], warnings = [];
    if (mode === 'unit') {
      var cands = mainGroup.slice().sort(function (a, b) { return a.per - b.per; });
      headline = '按折合单价，' + tag(cands[0]) + ' 最划算：' + perUnit(cands[0]) +
        '；最贵的是 [' + cands[cands.length - 1].platform + '] ' + perUnit(cands[cands.length - 1]) + '。';
      sublines.push('各家规格数量不一样，只比总价会看错——总价最低的那家单价未必最低。');
      best = cands[0];
    } else if (mode === 'partial') {
      var mainCands = mainGroup.slice().sort(function (a, b) { return a.per - b.per; });
      headline = '能对上的 ' + mainGroup.length + ' 条（都是「' + mainUnit + '」）里，' +
        tag(mainCands[0]) + ' 最划算：' + perUnit(mainCands[0]) + '。';
      var others = rows.filter(function (r) { return mainGroup.indexOf(r) === -1; });
      sublines.push('另有 ' + others.length + ' 条规格不同或没写（' +
        others.map(function (r) { return '[' + r.platform + ']'; }).join('、') +
        '），没法放进来一起比——补上规格我再算。');
      best = mainCands[0];
    } else if (mode === 'mixed') {
      headline = '这几条规格口径对不上（有的是「包」、有的是「提/瓶/克」，或者根本没写规格），没法直接说谁更便宜。';
      sublines.push('把规格对齐再看：要么都比「每包多少钱」，要么都按同一件数比总价。');
    } else if (mode === 'total_nospec') {
      headline = tag(best) + ' 到手价最低 ' + fmt(best.eff) + ' 元' +
        (multi ? '，比最贵的 [' + worst.platform + '] 省 ' + fmt(save) + ' 元' : '') + '。';
      sublines.push('你没给规格（多少包 / 多少 ml），如果各家规格不一样，这个总价差没意义——补上规格我按单价重算。');
    } else if (multi) {
      headline = tag(best) + ' 到手价最低 ' + fmt(best.eff) + ' 元，比最贵的 [' + worst.platform + '] 省 ' + fmt(save) + ' 元。';
    } else if (rows.length >= 2) {
      headline = '各家到手价基本持平（差不到 5 分钱），按运费、售后、发货地选即可。';
    } else {
      headline = '只收到 1 条报价（' + tag(best) + ' 到手 ' + fmt(best.eff) + ' 元），暂时没法比出贵不贵——再给我一个平台的价格就能比。';
    }

    /* ---- 隐性成本 ---- */
    var hasShip = rows.some(function (r) { return r.ship > 0; });
    var hasFree = rows.some(function (r) { return r.ship === 0; });
    if (hasShip && hasFree) { sublines.push('有的包邮有的要运费——运费算进来才是到手价（上面已算）。'); }
    if (rows.length >= 2 && save <= 3) { sublines.push('价差不到 3 块，这种情况优先选运费险 / 七天无理由 / 旗舰店，退货成本比差价重要。'); }
    if (rows.some(function (r) { return r.coupon > 0; })) { sublines.push('券有门槛和有效期；跨店满减要凑单的话，别为了凑单买用不上的东西。'); }
    if (rows.some(function (r) { return r.needQty > 1; })) { sublines.push('有的平台要一次买够 N 件才给这个价（明细里标了「需买N件」）——囤不了那么多，它的单价可能不如看着便宜。'); }

    /* ---- 预警：按"当前口径"的中位数找异常，避免拿 12 包的价格去比 24 包的中位价 ---- */
    var usePer = (mode === 'unit' || mode === 'partial');
    var pool = [];
    (usePer ? mainGroup : rows).forEach(function (r) {
      var v = usePer ? r.per : r.eff;
      if (v !== null && v !== undefined && isFinite(v) && v > 0) { pool.push(v); }
    });
    pool.sort(function (a, b) { return a - b; });
    var med = 0;
    if (pool.length >= 3) {
      med = pool.length % 2 ? pool[(pool.length - 1) / 2] : (pool[pool.length / 2 - 1] + pool[pool.length / 2]) / 2;
    }
    rows.forEach(function (r) {
      var v = usePer ? r.per : r.eff;
      var shown = usePer ? perLabel(r) : fmt(r.eff) + ' 元';
      if (med > 0 && v !== null && v < 0.5 * med) {
        warnings.push('[' + r.platform + '] ' + shown + ' 明显低于同口径中位价——可能规格不同 / 临期 / 二手 / 仿品，下单前核对店铺资质与规格。');
      } else if (med > 0 && v !== null && v > 1.6 * med) {
        warnings.push('[' + r.platform + '] ' + shown + ' 明显高于同口径中位价，没有品牌 / 售后优势可以放弃。');
      }
      if (r.coupon > 0 && r.coupon >= r.price * r.needQty + r.ship) {
        warnings.push('[' + r.platform + '] 券额 ≥ 应付款，数据异常，请核对活动真实性。');
      }
    });
    if (mode === 'mixed') { warnings.push('本次规格口径不一致，上面的排序只能参考，不能当作「谁更便宜」的依据。'); }

    /* ---- 预算判断 ---- */
    var budget = toNum(opts.budget, null);
    var budgetInfo = null;
    if (budget && budget > 0) {
      var cost = (mode === 'unit' || mode === 'partial') ? best.eff : best.eff;
      if (cost <= budget) {
        budgetInfo = { budget: budget, diff: round2(budget - cost), ok: true,
          text: '最低到手 ' + fmt(cost) + ' 元，比你的预算 ' + fmt(budget) + ' 元还低 ' + fmt(budget - cost) + ' 元——预算内。' };
      } else {
        budgetInfo = { budget: budget, diff: round2(cost - budget), ok: false,
          text: '最低到手 ' + fmt(cost) + ' 元，超预算 ' + fmt(cost - budget) + ' 元——要么降规格，要么等大促。' };
      }
    }

    /* ---- 时机 ---- */
    var timing = timingAdvice(best.eff, today);

    /* ---- 价格带参考 ---- */
    var bandInfo = judgePrice(item, best.eff);

    return {
      ok: true,
      item: item,
      rows: rows,
      mode: mode,
      comparable: mode !== 'mixed',
      best: best,
      worst: worst,
      save: round2(save),
      headline: headline,
      sublines: sublines,
      warnings: warnings,
      skipped: skipped,
      budget: budgetInfo,
      timing: timing,
      band: bandInfo
    };
  }

  /* ================================================================== */
  /* 七、真实商家日历 CSV（日期由代码算，不是手写）                        */
  /* ================================================================== */

  function csvCell(v) {
    var s = String(v === undefined || v === null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** 生成未来 days 天的商家日历 CSV 文本（带 BOM，Excel 打开不乱码） */
  function calendarCsv(from, days) {
    var start = toDate(from || new Date());
    var total = days || 56;
    var rows = [['日期', '星期', '活动类型', '商家/平台', '地点', '活动名称', '怎么用', '教练建议', '核实渠道']];
    rows.push(['（生成时间）', dateKey(start), '代码计算', '—', '—', '未来 ' + total + ' 天', '常驻活动只在首日列一次', '—', '本地日历算法']);

    var alwaysList = alwaysDeals();
    var first = true;
    for (var i = 0; i < total; i++) {
      var d = addDays(start, i);
      var list = dealsOn(d).filter(function (x) { return x.type !== 'always'; });
      var k;
      for (k = 0; k < list.length; k++) {
        var it = list[k];
        rows.push([
          dateKey(d), weekdayCn(d),
          it.type === 'promo' ? '大促' : (it.type === 'monthly' ? '每月固定' : '每周固定'),
          it.name, it.place || '—', it.title, it.how, it.coach || '—', it.source
        ]);
      }
      if (first) {
        for (k = 0; k < alwaysList.length; k++) {
          var a = alwaysList[k];
          rows.push([dateKey(d), weekdayCn(d), '常驻（每日）', a.name, a.place || '—', a.title, a.how, a.coach || '—', a.source]);
        }
      }
      first = false;
    }
    var lines = [];
    for (var r = 0; r < rows.length; r++) {
      lines.push(rows[r].map(csvCell).join(','));
    }
    return '\ufeff' + lines.join('\r\n');
  }

  /* ================================================================== */
  /* 八、聊天卡片 HTML                                                    */
  /* ================================================================== */

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 今天有什么优惠：限时活动 + 最近三场 + 大促倒计时 */
  function todayCardHtml(date) {
    var d = toDate(date || new Date());
    var list = dealsOn(d);
    var limited = list.filter(function (x) { return x.type !== 'always'; });
    var always = list.filter(function (x) { return x.type === 'always'; });
    var np = nextPromo(d);

    var html = '<div class="deals-card">';
    html += '<div class="deals-card-head"><b>' + dlIcon('radar') + '省钱雷达</b><span>' + dateKey(d) + ' ' + weekdayCn(d) + '</span></div>';

    if (np) {
      html += '<div class="deals-promo">' +
        '<span>' + esc(np.promo.name) + (np.days === 0 ? ' 就是今天' : ' 还有 ' + np.days + ' 天') + '</span>' +
        '<small>' + esc(np.promo.depth) + ' · 适合：' + esc(np.promo.bestFor) + '</small>' +
        '</div>';
    }

    if (limited.length) {
      html += '<div class="deals-sec">今天的限时活动</div>';
      limited.forEach(function (it) {
        html += '<div class="deals-item">' +
          '<div class="di-top">' + itemIcon(it) +
          '<b>' + esc(it.name) + ' · ' + esc(it.title) + '</b>' +
          '<span class="di-tag">' + esc(it.tag) + '</span></div>' +
          '<p>' + esc(it.what) + '</p>' +
          '<p class="di-how">' + dlIcon('bulb', 'bico-brand', '怎么做') + esc(it.how) + '</p>' +
          '<p class="di-tip">' + dlIcon('alert', 'bico-warn', '提醒') + esc(it.tip) + '</p>' +
          '</div>';
      });
    } else {
      html += '<div class="deals-empty">今天没有固定的限时活动（肯德基疯狂星期四在周四、必胜客在周三）。要去的话，我帮你查下一次是哪天。</div>';
    }

    if (always.length) {
      html += '<div class="deals-sec">常驻优惠（不用等）</div><div class="deals-always">';
      always.slice(0, 5).forEach(function (it) {
        html += '<span class="deals-pill">' + itemIcon(it, 'sm') + ' ' + esc(it.name) + '·' + esc(it.title) + '</span>';
      });
      html += '</div>';
    }

    html += '<div class="deals-actions">' +
      '<button type="button" class="btn-mini primary" data-deal-act="open-today">看 14 天日历</button>' +
      '<button type="button" class="btn-mini" data-deal-act="open-compare">比一比价格</button>' +
      '</div>';
    html += '<p class="deals-note">活动日期由本地日历按周/按月算出，真实有效；具体单品、价格与参与门店以官方页面为准，我不编价格。</p>';
    html += '</div>';
    return html;
  }

  /** 疯狂星期四专项卡片 */
  function kfcCardHtml(date) {
    var d = toDate(date || new Date());
    var next = nextOf('kfc', d);
    var isToday = isoWeekday(d) === 4;
    var delta = daysBetween(d, next);
    var html = '<div class="deals-card">';
    html += '<div class="deals-card-head"><b>' + dlIcon('cat-food') + '疯狂星期四</b><span>' + dateKey(d) + ' ' + weekdayCn(d) + '</span></div>';
    if (isToday) {
      html += '<p class="deals-hl">今天就是周四——想吃就今天去，别拖到明天。</p>';
    } else {
      html += '<p class="deals-hl">今天是' + weekdayCn(d) + '，最近一次是 <b>' + dateKey(next) + '（' + weekdayCn(next) +
        '）</b>，还有 ' + delta + ' 天。</p>';
    }
    html += '<p>规律很硬：<b>每周四</b>，不需要联网也不会记错日期。但要吃对，注意三件事：</p>' +
      '<ul class="deals-ul">' +
      '<li>当天在 App / 小程序「疯狂星期四」专区看<b>当日单品</b>，每周不一样；</li>' +
      '<li>热门单品中午就卖完，晚上去经常只剩冷门款；</li>' +
      '<li>先领券再下单，外卖价和堂食价不同，别拿外卖价当堂食价。</li>' +
      '</ul>' +
      '<p class="deals-note">具体单品与价格以肯德基官方页面为准；本卡片只负责把日子算准，不编价格。</p>' +
      '<div class="deals-actions">' +
      '<button type="button" class="btn-mini primary" data-deal-act="open-calendar">看未来 14 天</button>' +
      '</div></div>';
    return html;
  }

  /** 比价引导卡：只给价格带 + 明确还差什么，不编价格 */
  function compareIntroHtml(item, budget, date) {
    var band = findBand(item);
    var t = timingAdvice(budget || 0, date);
    var html = '<div class="deals-card">';
    html += '<div class="deals-card-head"><b>' + dlIcon('scale') + '比价 · ' + esc(item || '这个商品') + '</b><span>' + dateKey(date || new Date()) + '</span></div>';
    if (band) {
      html += '<p class="deals-hl">「' + esc(band.name) + '」主流价格带：入门 ' + band.low[0] + '-' + band.low[1] +
        ' 元 / 中档 ' + band.mid[0] + '-' + band.mid[1] + ' 元 / 高档 ' + band.high[0] + '-' + band.high[1] + ' 元。</p>';
      html += '<p>这类东西通常 <b>' + esc(band.channel) + '</b> 更便宜，同款跨平台能差 20%-40%。</p>';
    } else {
      html += '<p class="deals-hl">这个品类我没有价格带参考，但不影响比价——只要你把三家的价给我，我照样能算到手价和单价。</p>';
    }
    if (budget) {
      var j = judgePrice(item, budget);
      html += '<p>你的预算 <b>' + fmt(budget) + ' 元</b>' + (j ? '落在「' + j.label + '」档：' + esc(j.text) : '') + '。</p>';
    }
    html += '<p class="deals-note">我这边不抓电商实时价（会过期、也不合规），所以下一步要你帮一把：把看到的价按「平台 + 价格 + 规格」发我，' +
      '例如「淘宝 89 包邮 10000mAh / 拼多多 79 / 京东 99 需买 2 件」，我立刻算到手价、折单价、排最便宜的。</p>';
    html += '<div class="deals-actions">' +
      '<button type="button" class="btn-mini primary" data-deal-act="open-compare">打开比价计算器</button>' +
      '<button type="button" class="btn-mini" data-deal-act="open-today">今天有什么优惠</button>' +
      '</div>';
    if (t && t.days !== null) {
      html += '<p class="deals-timing">⏰ ' + esc(t.text) + '</p>';
    }
    html += '</div>';
    return html;
  }

  /* ================================================================== */
  /* 七、真实搜索快照（当当网公开搜索结果页，抓取时间见 meta）           */
  /*     由 deals_scrape.py 真实请求 search.dangdang.com 解析得到，      */
  /*     不含任何模拟数据；抓不到就是空数组。                            */
  /* ================================================================== */
  /* ================================================================== */
  /* 七、内置搜索快照（网易严选 + 当当，真实抓取，时间见 meta）          */
  /*     由 deals_scrape.py 真实请求电商搜索接口解析得到，不含模拟数据； */
  /*     在线抓取可用时前端优先用在线结果，这份只作离线兜底。           */
  /* ================================================================== */
  /* ================================================================== */
  /* 七、内置搜索快照（网易严选 + 当当，真实抓取，时间见 meta）          */
  /*     由 deals_scrape.py 真实请求电商搜索接口解析得到，不含模拟数据； */
  /*     在线抓取可用时前端优先用在线结果，这份只作离线兜底。           */
  /* ================================================================== */
  var REAL_SEARCH = {
  "meta": {
    "source": "网易严选 8条 + 慢慢买比价 8条 + 当当网 8条",
    "source_host": "s.manmanbuy.com, search.dangdang.com, you.163.com",
    "keyword": "保温杯",
    "scraped_at": "2026-10-28 12:46:32",
    "scraped_at_iso": "2026-10-28T12:46:32+08:00",
    "pages_scraped": [
      {
        "page": 1,
        "parsed": 40,
        "source": "网易严选"
      },
      {
        "page": 2,
        "parsed": 40,
        "source": "网易严选"
      },
      {
        "page": 1,
        "parsed": 31,
        "source": "慢慢买比价"
      },
      {
        "page": 2,
        "parsed": 31,
        "source": "慢慢买比价"
      },
      {
        "page": 1,
        "parsed": 60,
        "source": "当当网"
      },
      {
        "page": 2,
        "parsed": 60,
        "source": "当当网"
      }
    ],
    "page_urls": [
      "https://you.163.com/xhr/search/search.json?keyword=%E4%BF%9D%E6%B8%A9%E6%9D%AF&page=1&style=json&size=40",
      "https://you.163.com/xhr/search/search.json?keyword=%E4%BF%9D%E6%B8%A9%E6%9D%AF&page=2&style=json&size=40",
      "https://s.manmanbuy.com/pc/search/result?keyword=%E4%BF%9D%E6%B8%A9%E6%9D%AF&pageId=1",
      "https://s.manmanbuy.com/pc/search/result?keyword=%E4%BF%9D%E6%B8%A9%E6%9D%AF&pageId=2",
      "https://search.dangdang.com/?key=%B1%A3%CE%C2%B1%AD&act=input&page_index=1",
      "https://search.dangdang.com/?key=%B1%A3%CE%C2%B1%AD&act=input&page_index=2"
    ],
    "errors": [],
    "sources": [
      {
        "name": "网易严选",
        "host": "you.163.com",
        "count": 8,
        "price_range": [
          38.0,
          246.0
        ],
        "error": null,
        "note": null,
        "dropped": 0
      },
      {
        "name": "慢慢买比价",
        "host": "s.manmanbuy.com",
        "count": 8,
        "price_range": [
          24.59,
          60.47
        ],
        "error": null,
        "note": null,
        "dropped": 1
      },
      {
        "name": "当当网",
        "host": "search.dangdang.com",
        "count": 8,
        "price_range": [
          69.0,
          131.0
        ],
        "error": null,
        "note": null,
        "dropped": 39
      }
    ],
    "total_parsed": 259,
    "relevant": 219,
    "dropped": 40,
    "price_range": [
      29.5,
      159.0
    ],
    "price_median": 79.0,
    "shop_count": 4,
    "picked": 8
  },
  "items": [
    {
      "sku": "302056556",
      "source": "网易严选",
      "source_host": "you.163.com",
      "platform": "网易严选",
      "title": "网易严选 大容量吸管保温保冷杯 冰霸杯 316L内胆【限时免邮】",
      "price": 79.0,
      "original": 99.0,
      "shop": "严选自营",
      "brand": "",
      "reviews": 67,
      "reviews_label": "销量",
      "url": "https://you.163.com/item/detail?itemId=302056556",
      "page": 1,
      "capacity_ml": 6000,
      "material": "316不锈钢",
      "target": "通用",
      "feature": [
        "吸管杯",
        "大容量"
      ],
      "unit_price_per_100ml": 1.32,
      "relevance": 40
    },
    {
      "sku": "",
      "source": "慢慢买比价",
      "source_host": "s.manmanbuy.com",
      "platform": "天猫",
      "title": "GERM格米 运动保温杯 柠檬黄 650ml（多颜色样式任选）",
      "price": 29.55,
      "original": null,
      "shop": "天猫旗舰店",
      "brand": "",
      "reviews": null,
      "reviews_label": "评论",
      "url": "https://cu.manmanbuy.com/discuxiao_594723613.aspx",
      "price_label": "到手价",
      "page": 1,
      "capacity_ml": 650,
      "material": "材质未标注",
      "target": "通用",
      "feature": [],
      "unit_price_per_100ml": 4.55,
      "relevance": 170
    },
    {
      "sku": "11512500227",
      "source": "当当网",
      "source_host": "search.dangdang.com",
      "platform": "当当",
      "title": "智能保温杯大容量男士女高档泡茶杯316不锈钢便携商务水杯子7xr",
      "price": 131.0,
      "shop": "梦达家居专营店",
      "brand": "",
      "reviews": 5,
      "url": "https://product.dangdang.com/11512500227.html",
      "page": 1,
      "capacity_ml": 0,
      "material": "316不锈钢",
      "target": "成人",
      "feature": [
        "泡茶杯",
        "大容量"
      ],
      "relevance": 170
    },
    {
      "sku": "302047685",
      "source": "网易严选",
      "source_host": "you.163.com",
      "platform": "网易严选",
      "title": "江湖豪饮 巨无霸316不锈钢保温杯1.25L",
      "price": 159.0,
      "original": 159.0,
      "shop": "严选自营",
      "brand": "",
      "reviews": 293,
      "reviews_label": "销量",
      "url": "https://you.163.com/item/detail?itemId=302047685",
      "page": 1,
      "capacity_ml": 5000,
      "material": "316不锈钢",
      "target": "通用",
      "feature": [],
      "unit_price_per_100ml": 3.18,
      "relevance": 170
    },
    {
      "sku": "",
      "source": "慢慢买比价",
      "source_host": "s.manmanbuy.com",
      "platform": "京东",
      "title": "富光 500ml 316L不锈钢保温杯 睿智黑 滤网",
      "price": 29.5,
      "original": null,
      "shop": "京东商城",
      "brand": "",
      "reviews": null,
      "reviews_label": "评论",
      "url": "https://cu.manmanbuy.com/discuxiao_597414280.aspx",
      "price_label": "到手价",
      "page": 1,
      "capacity_ml": 500,
      "material": "316不锈钢",
      "target": "通用",
      "feature": [],
      "unit_price_per_100ml": 5.9,
      "relevance": 170
    },
    {
      "sku": "11512508527",
      "source": "当当网",
      "source_host": "search.dangdang.com",
      "platform": "当当",
      "title": "儿童保温杯女童可爱婴儿水杯子宝宝男孩小学生上学专用水壶7xr",
      "price": 91.0,
      "shop": "梦达家居专营店",
      "brand": "",
      "reviews": 3,
      "url": "https://product.dangdang.com/11512508527.html",
      "page": 2,
      "capacity_ml": 0,
      "material": "材质未标注",
      "target": "儿童",
      "feature": [],
      "relevance": 170
    },
    {
      "sku": "301098860",
      "source": "网易严选",
      "source_host": "you.163.com",
      "platform": "网易严选",
      "title": "绿珠泡茶咖啡保温杯",
      "price": 38.0,
      "original": 59.0,
      "shop": "严选自营",
      "brand": "",
      "reviews": 2320,
      "reviews_label": "销量",
      "url": "https://you.163.com/item/detail?itemId=301098860",
      "page": 1,
      "capacity_ml": 0,
      "material": "材质未标注",
      "target": "通用",
      "feature": [
        "泡茶杯"
      ],
      "relevance": 170
    },
    {
      "sku": "",
      "source": "慢慢买比价",
      "source_host": "s.manmanbuy.com",
      "platform": "京东",
      "title": "富光 316不锈钢保温杯 月光白 500ml",
      "price": 34.95,
      "original": null,
      "shop": "京东商城",
      "brand": "",
      "reviews": null,
      "reviews_label": "评论",
      "url": "https://cu.manmanbuy.com/discuxiao_597421125.aspx",
      "price_label": "到手价",
      "page": 1,
      "capacity_ml": 500,
      "material": "316不锈钢",
      "target": "通用",
      "feature": [],
      "unit_price_per_100ml": 6.99,
      "relevance": 170
    }
  ]
};

  /* ================================================================== */
  /* 导出                                                                */
  /* ================================================================== */

  var API = {
    VERSION: '1.0.0',
    MERCHANTS: MERCHANTS,
    PROMOS: PROMOS,
    BANDS: BANDS,
    /* 日期 */
    toDate: toDate, dateKey: dateKey, addDays: addDays, daysBetween: daysBetween,
    isoWeekday: isoWeekday, weekdayCn: weekdayCn,
    /* 活动 */
    dealsOn: dealsOn, upcoming: upcoming, alwaysDeals: alwaysDeals,
    nextOf: nextOf, nextPromo: nextPromo, merchantById: merchantById,
    /* 价格 */
    findBand: findBand, judgePrice: judgePrice, timingAdvice: timingAdvice,
    compareOffers: compareOffers, parseSpec: parseSpec, parseNeed: parseNeed,
    toNum: toNum, fmt: fmt, perLabel: perLabel,
    /* 导出与卡片 */
    calendarCsv: calendarCsv,
    todayCardHtml: todayCardHtml, kfcCardHtml: kfcCardHtml, compareIntroHtml: compareIntroHtml,
    brandTile: brandTile, BRANDS: BRANDS, LOGOS: LOGOS,
    /* 真实搜索快照（当当网，抓取时间见 meta.scraped_at） */
    REAL_SEARCH: REAL_SEARCH
  };

  if (isNode) {
    module.exports = API;
  } else {
    global.AJ = global.AJ || {};
    global.AJ.deals = API;
  }
})(typeof window !== 'undefined' ? window : this);
