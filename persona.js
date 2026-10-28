/**
 * persona.js — 消费性格测试（纯函数，零 DOM、零存储，UMD）
 *
 * 定位：角色「阿账」——精通行为经济学与大学生心理的 AI 理财导师。
 *       根据【答题记录】与【真实账单指标】产出一份 ≤200 字的
 *       「消费性格诊断报告」（Markdown 纯文本）。
 *
 * 四大画像（得分最高项输出）：
 *   🐿️ 仓鼠型  极度克制：重视储蓄，看着余额增加最有安全感
 *   🦁 狮子型  冲动王者：情绪驱动，千金难买我乐意
 *   🦊 狐狸型  精明买手：薅羊毛达人，擅长比价、平替、凑满减
 *   🐨 考拉型  佛系干饭：恩格尔系数偏高，钱基本用来满足口腹之欲
 *
 * 边界（对齐 diagnose.js 的纪律）：不读 localStorage、不写 state、
 * 不 import 任何东西；输入缺字段一律当 0 / 空处理，绝不抛异常。
 *
 * 对外 API（window.AJ.persona）：
 *   BANK                 题库（50 道，每题恰好 4 个选项，索引 0..3 对应 A..D）
 *   LENGTHS              可选题量 [10, 30, 50]
 *   pick(len)            抽 len 道题（等距、确定性，同一档位结果可复现）
 *   metricScale(len)     该题量下账单指标的权重倍率（题量越大，真实账单越重）
 *   TYPES                四画像元数据（emoji / 名称 / 标签）
 *   score(answers, m, len) 答题字母（数组）+ 五项账单指标 + 题量 → 得分结果
 *   report(res, m)       诊断报告 Markdown（总长 ≤ LIMIT=200，代码内兜底裁剪）
 */
(function (global) {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);

  /* ------------------------------------------------------------------ */
  /* 常量                                                                */
  /* ------------------------------------------------------------------ */

  /** 报告总字数上限（str.length，UTF-16 单位；emoji 记 2，保守口径） */
  var LIMIT = 200;
  /** 裁剪时每条可变文案的最短保留长度（再短读起来就破碎了） */
  var MIN_TEXT = 4;

  /** 四画像元数据：key → {emoji, name, tag} */
  var TYPES = {
    hamster: { key: 'hamster', emoji: '🐿️', name: '仓鼠型', tag: '极度克制' },
    lion: { key: 'lion', emoji: '🦁', name: '狮子型', tag: '冲动王者' },
    fox: { key: 'fox', emoji: '🦊', name: '狐狸型', tag: '精明买手' },
    koala: { key: 'koala', emoji: '🐨', name: '考拉型', tag: '佛系干饭' }
  };

  /** 平分决胜：按固定优先序取第一个最高分（仓鼠 > 狮子 > 狐狸 > 考拉）。
      为什么是这个序：答题选项只给 0~3 的粗粒度分，平分几乎必然出现，
      必须有一条确定性规则，否则两次作答结果会漂移，报告无法复现。 */
  var TIE_ORDER = ['hamster', 'lion', 'fox', 'koala'];

  /** 题库：50 道（贴近大学生活，选项文案走幽默路线）。
      每题恰好 4 个选项，s 为四画像倾向分（0~3）。
      约定：A≈仓鼠 / B≈狮子 / C≈狐狸 / D≈考拉，即每个选项自己那一档必须是最高分，
      这样「全选同一字母」在任何题量下都稳定命中对应画像（单测会逐个字母验）。
      加题只需往数组里追加：抽题（pick）与权重（metricScale）都按题量自适应。 */
  var BANK = [
    {
      q: '生活费到账 2000，你的第一件事是？',
      opts: [
        { t: '先转 500 进存钱罐，看着数字涨才踏实', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '心心念念的那双鞋，终于可以冲了！', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '先翻翻哪家有券，能省 50 是 50', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '点顿好的犒劳自己，天大地大吃饭最大', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '室友喊你拼单奶茶，满 30 减 8，你会？',
      opts: [
        { t: '「我戒糖了」——其实是心疼这 10 块', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '「来都来了！」顺手再加个蛋糕', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '拉群算到小数点后两位，谁也别想多付', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '「都行」，跟着大家点就好', s: { hamster: 0, lion: 0, fox: 0, koala: 2 } }
      ]
    },
    {
      q: '深夜 emo 刷手机，购物车在闪闪发光，你会？',
      opts: [
        { t: '默默关掉，抱紧我的余额', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '下单！千金难买我乐意', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '加购不付款，蹲到大促再说', s: { hamster: 0, lion: 0, fox: 2, koala: 0 } },
        { t: 'emo 得先吃饱：点份烧烤外卖', s: { hamster: 0, lion: 1, fox: 0, koala: 2 } }
      ]
    },
    {
      q: '看到上一周期的账单总结，你的第一反应？',
      opts: [
        { t: '「还好还好，结余是正的」松一口气', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '「钱呢？我怎么又没钱了？」', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '「下个月每类能砍多少，我列个表」', s: { hamster: 1, lion: 0, fox: 2, koala: 0 } },
        { t: '「差不多得了，吃饱才有力气学习」', s: { hamster: 0, lion: 0, fox: 0, koala: 2 } }
      ]
    },
    {
      q: '手里有 300 块闲钱躺了半个月，你会？',
      opts: [
        { t: '塞进存钱罐，攒着攒着就习惯了', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '周末出去痛快玩一场，钱是挣来花的', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '比价三天，换成最划算的必需品', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '继续躺平，它躺着它的，我躺我的', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '月底只剩 80 块，离发生活费还有 5 天，你会？',
      opts: [
        { t: '早有预料，存钱罐留的余粮就是干这个的', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '先爽完再说，车到山前必有路', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '食堂特价窗口 + 平台满减，抠到最后一毛', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '饭不能省，泡面也得加根火腿肠', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '双十一预售，看中的外套 399，你会？',
      opts: [
        { t: '去年那件还能穿，不买就是净省 399', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '三个颜色都加购，定金先付了再说', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '翻历史成交价，确认是真低价才下手', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '外套哪有火锅香，这钱留给下馆子', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '室友过生日要凑钱买礼物，你的态度是？',
      opts: [
        { t: '提前一个月就把这笔预算留出来了', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '现场一上头，直接多出一百', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '我来找团购价，人均再压一压', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '礼物不如请大家搓一顿烧烤', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '食堂和外卖，你的真实日常是？',
      opts: [
        { t: '食堂，便宜稳定还不用等', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '看心情，心情好就点份好的', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '哪个平台券大就点哪个', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '外卖，队太长，多花几块买舒服', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '记账这件事，你坚持得怎么样？',
      opts: [
        { t: '每笔都记，月底还要复盘一遍', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '想起来才记，一补就是一个星期', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '记，顺便看看平替能省多少', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '只记得吃的，其他随缘', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '兼职发了 800 块，你的第一反应是？',
      opts: [
        { t: '存起来，离目标又近一步', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '辛苦了这么久，必须花爽一次', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '拿它凑满减，把要买的打包买', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '先给未来俩月加满鸡腿额度', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '奖学金到账 3000，你会？',
      opts: [
        { t: '一半以上进存钱罐，剩下的再说', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '一直想要的那台设备，这次拿下', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '列清单逐项比价，分批买最划算', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '先请室友搓几顿，快乐要分享', s: { hamster: 0, lion: 1, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '直播间喊「三二一，上链接」，你会？',
      opts: [
        { t: '不看直播，从源头断了心动', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '手比脑子快，先抢再说', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '先加购，下播去别处比个价', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '看直播得配夜宵，快乐要双倍', s: { hamster: 0, lion: 1, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '购物车里躺着 5 件东西，你会？',
      opts: [
        { t: '删掉 4 件，只留真正要用的', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '全结算，清空购物车超爽', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '攒到大促凑满减，一次买齐', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '吃的先买，其他的看心情', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '手机壳 / 小挂件这类小东西，你？',
      opts: [
        { t: '用到坏才换，一个能用三年', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '好看就买，抽屉里已经一抽屉', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '九块九三件套，还要再领张券', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '不买，钱留着加餐', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '视频会员连扣三个月没看，你会？',
      opts: [
        { t: '立刻关掉自动续费', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '早忘了这回事，继续扣着', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '算完使用率，改年付或找学生价', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '会员可以不看，外卖红包不能断', s: { hamster: 0, lion: 1, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '朋友安利一支 199 的护肤品，你会？',
      opts: [
        { t: '手上的还没用完，不买', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '对自己好一点，买', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '先找小样和平替，成分对一遍', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '护肤不如食补，先吃顿好的', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '开学季超市大促，你推着车会？',
      opts: [
        { t: '照清单拿，绝不临时加东西', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '一路拿，结账才发现超了', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '比克单价，只囤真划算的', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '零食区就是我的主场', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '外卖会员 15 元一个月，你买吗？',
      opts: [
        { t: '自己带饭，用不上不买', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '买，点单从来不看配送费', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '算过：月点八单以上才回本', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '买，省的配送费够加个鸡腿', s: { hamster: 0, lion: 0, fox: 1, koala: 3 } }
      ]
    },
    {
      q: '月底突然要交 200 块班费，你？',
      opts: [
        { t: '预算里早留了机动份额', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '懵了，先找室友周转一下', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '看看有券没有，能省十块是十块', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '交就交，饭钱不动就行', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '二手群出教材 15 块，全新 60，你？',
      opts: [
        { t: '用电子版或借，一分不花', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '买新的，二手多没面子', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '15 块拿下，还能再砍 5 块', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '省下的 45 块够吃两顿好的', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '社团聚餐 AA，人均 80，你？',
      opts: [
        { t: '这个月聚餐额度用完了，下次', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '去！难得热闹，加菜我请', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '先看哪家有代金券，我来订位', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '去，冲着那道招牌菜也得去', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '追的剧更新了，但明天有早八，你？',
      opts: [
        { t: '睡，剧明天再看也一样', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '再看一集，反正就一集', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '边看边薅个夜间流量包', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '熬夜得配泡面，先煮一碗', s: { hamster: 0, lion: 1, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '想买的耳机 899，你会？',
      opts: [
        { t: '现在这个还能用，先不换', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '喜欢就买，分期也要拿下', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '等大促，顺便对比三款参数', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '耳机哪有食堂新窗口香', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '游戏出了一款限定皮肤，你？',
      opts: [
        { t: '不氪，白嫖也挺香', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '限定！错过等一年，冲', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '等打折或者活动任务白拿', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '氪金不如氪饭，先吃饱', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '演唱会门票开售，你抢到的是？',
      opts: [
        { t: '压根没抢，这钱不如存着', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '内场！加价也要去', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '看台，算过性价比最高的档', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '看完必须去吃顿夜宵才算完', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '健身卡年卡 1200，你会办吗？',
      opts: [
        { t: '跑步不要钱，不办', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '办！装备也得配齐', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '先算单次成本，能去够本才办', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '练完要吃，这钱还是花在吃上', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '考证报名费 500，你的态度是？',
      opts: [
        { t: '想清楚要考才报，绝不跟风', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '报！先报了逼自己一把', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '找团报优惠、教材买二手', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '报完先犒劳自己一顿', s: { hamster: 0, lion: 1, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '回家的高铁票和飞机票差 200，你？',
      opts: [
        { t: '选最便宜的，能省就省', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '飞机，舒服重要', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '比完再叠加学生优惠', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '省下的 200 够在家吃两天好的', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '室友都在囤泡面和零食，你？',
      opts: [
        { t: '不囤，吃多少买多少', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '跟着囤，反正迟早会吃', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '整箱更便宜，算过再囤', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '囤！夜宵自由最重要', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '想喝奶茶但今天已经喝过一杯，你？',
      opts: [
        { t: '忍住，明天再说', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '想喝就喝，快乐不需要理由', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '看看有没有第二杯半价', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '奶茶配小吃，才算完整', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '买水果时，你？',
      opts: [
        { t: '够吃就行，坏了就是浪费', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '想吃的都拿，吃不完再说', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '挑当季的，便宜又好吃', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '水果是我的快乐来源，随便拿', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '快递柜超时要收 5 毛，你？',
      opts: [
        { t: '马上去取，绝不白花', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '超时就超时，懒得动', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '掐好时间，一趟全取完', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '取完顺手买瓶饮料', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '手机话费用超了 30 块，你？',
      opts: [
        { t: '下个月换更省的套餐', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '超就超了，无所谓', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '改校园套餐，还能蹭校园网', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '话费省下的都进了外卖账户', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '朋友约你去密室 / KTV，人均 100，你？',
      opts: [
        { t: '这月娱乐预算没了，下次叫我', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '去！难得开心一次', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '找团购价，我来订', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '去，唱完还得吃顿夜宵', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '看到「学生证半价」的牌子，你？',
      opts: [
        { t: '本来也不去，省 100%', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '半价！那必须安排上', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '每个能用的优惠都用一遍', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '景点一般，附近小吃倒是可以', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '期末周你想犒劳自己，方式是？',
      opts: [
        { t: '什么都不买，睡一整天', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '购物车里那件，终于有理由了', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '挑一家性价比最高的店', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '火锅烧烤奶茶，一个都不能少', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '理发店 30 和 88 的档位，你选？',
      opts: [
        { t: '30 的，能剪短就行', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '总监档，形象要紧', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '找新客优惠的那家', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '剪完去吃碗面，才算完整', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '突然要用正装面试，你？',
      opts: [
        { t: '跟同学借，不买', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '买新的，形象就是机会', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '二手平台淘一套九成新的', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '面试完必须吃顿好的压惊', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '宿舍要添置点东西，你？',
      opts: [
        { t: '能不买就不买，凑合能用', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '看上就买，住着舒服最重要', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '比完价等促销，分批入', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '先买个小锅，自己煮点东西', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '打印资料一页两毛，你？',
      opts: [
        { t: '能看电子版就不打印', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '直接打印，懒得折腾', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '攒着去学校打印店，便宜一半', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '打印完顺便买个饼', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '下雨没带伞，便利店 25 一把，你？',
      opts: [
        { t: '等雨停，或者找人蹭', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '买，淋湿感冒更亏', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '网上同款 9 块，今天先借一把', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '买伞不如买碗热汤', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '充电宝丢了，你会？',
      opts: [
        { t: '先不买，教室能借到', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '立刻下单，没电不行', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '等大促，顺便凑个满减', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '反正食堂有插座，先吃饭', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '室友说食堂新开了个窗口，你？',
      opts: [
        { t: '照旧吃我那几样', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '冲！还要加个新品', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '看看有没有试吃或者优惠', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '新窗口？那必须天天去', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '收到一笔压岁钱 / 长辈红包，你？',
      opts: [
        { t: '全部存起来，不动', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '先花一部分开心一下', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '分成几份，各有各的用途', s: { hamster: 1, lion: 0, fox: 3, koala: 0 } },
        { t: '先请家人吃顿饭', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '月底复盘发现超支 300，你？',
      opts: [
        { t: '下个月把额度压回来', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '超都超了，下月再说', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '逐笔找出可以省的那几项', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '吃的不能省，其他随便砍', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '看到别人在用很贵的东西，你？',
      opts: [
        { t: '跟我没关系，够用就行', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '有点心动，也想拥有一个', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '先找平替，功能一样就行', s: { hamster: 0, lion: 0, fox: 3, koala: 0 } },
        { t: '不如请我吃顿饭来得实在', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '朋友借钱 200，说下月还，你？',
      opts: [
        { t: '先问自己这月能不能扛住', s: { hamster: 2, lion: 0, fox: 1, koala: 0 } },
        { t: '借！朋友要紧', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '借，但记一笔到期提醒', s: { hamster: 1, lion: 0, fox: 3, koala: 0 } },
        { t: '借完这个月伙食就得紧巴了', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '抢到一张 50 元的无门槛券，你？',
      opts: [
        { t: '不为了用券而买东西', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '券都到手了，必须花掉', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '只买本来就要买的东西', s: { hamster: 1, lion: 0, fox: 3, koala: 0 } },
        { t: '换成 50 块钱的吃的', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '你的钱包 / 余额页面，多久看一次？',
      opts: [
        { t: '每天看，数字涨了才安心', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '几乎不看，怕看了心塞', s: { hamster: 0, lion: 2, fox: 0, koala: 1 } },
        { t: '每周对一次账，看哪里能省', s: { hamster: 1, lion: 0, fox: 3, koala: 0 } },
        { t: '只在点外卖的时候看', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    },
    {
      q: '如果能给一个月后的自己留句话，你会说？',
      opts: [
        { t: '「再坚持一下，余额会谢谢你」', s: { hamster: 3, lion: 0, fox: 0, koala: 0 } },
        { t: '「想买的都买了，别后悔」', s: { hamster: 0, lion: 3, fox: 0, koala: 0 } },
        { t: '「每一分都花得明明白白」', s: { hamster: 1, lion: 0, fox: 3, koala: 0 } },
        { t: '「吃好喝好，别亏待自己」', s: { hamster: 0, lion: 0, fox: 0, koala: 3 } }
      ]
    }
  ];

  /** 可选的题量：10 速测 / 30 标准 / 50 深度 */
  var LENGTHS = [10, 30, 50];
  /** 默认题量（传入非法值时回落到这里） */
  var DEFAULT_LEN = 10;

  /** 归一化题量：非数字 / 负数 / 不在档位上 → 取最接近的档位，兜底 10 */
  function normalizeLen(len) {
    var n = Number(len);
    if (!isFinite(n) || n <= 0) { return DEFAULT_LEN; }
    var best = LENGTHS[0];
    var gap = Math.abs(n - best);
    for (var i = 1; i < LENGTHS.length; i++) {
      var g = Math.abs(n - LENGTHS[i]);
      if (g < gap) { gap = g; best = LENGTHS[i]; }
    }
    return Math.min(best, BANK.length);
  }

  /**
   * 抽题：按等距步长从题库里取 len 道（确定性，无随机）。
   * 等距而非「取前 N 道」，是为了让 10 / 30 / 50 三套题都覆盖到
   * 储蓄、冲动、比价、干饭四类情境，且同一档位两次抽题结果完全一致
   * （报告可复现，单测也能断言）。
   * @param {number} len 10 / 30 / 50
   * @return {Array} 题目数组（长度 = 归一化后的题量，不会超过题库）
   */
  function pick(len) {
    var n = normalizeLen(len);
    var out = [];
    var i;
    if (n >= BANK.length) {
      for (i = 0; i < BANK.length; i++) { out.push(BANK[i]); }
      return out;
    }
    for (i = 0; i < n; i++) {
      out.push(BANK[Math.floor(i * BANK.length / n)]);
    }
    return out;
  }

  /**
   * 账单指标分的倍率：随题量走，让「答题分 : 指标分」恒定在约 6 : 4。
   * 答题满分 = 3 × 题量；指标满分 = 14 × 倍率（五项 3+3+3+3+2）。
   * 题量 10 → 倍率 2（30 : 28）；30 → 6（90 : 84）；50 → 10（150 : 140）。
   * 题量变了不用手改任何阈值，倍率自动跟上。
   */
  function metricScale(len) {
    var n = normalizeLen(len);
    return Math.max(1, Math.round(n / 5));
  }

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                            */
  /* ------------------------------------------------------------------ */

  /** 非有限数一律归 0（缺字段 / null / NaN / 字符串数字都安全） */
  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /** 选项字母 'A'..'D' → 选项索引 0..3；非法返回 -1（调用方跳过） */
  function optIndex(letter) {
    if (typeof letter !== 'string') { return -1; }
    var c = letter.charAt(0).toUpperCase();
    var i = c.charCodeAt(0) - 65; /* 'A' = 65 */
    return (i >= 0 && i < 4) ? i : -1;
  }

  /* ------------------------------------------------------------------ */
  /* 账单指标 → 画像加成分                                                */
  /* ------------------------------------------------------------------ */

  /**
   * 指标口径（与 app.js 接线约定一致，全部可缺省，缺了当 0）：
   *   engelPercent  恩格尔系数（%，engine.getEngel().percent）
   *   savingsRate   储蓄率（%，engine.getIncomeStats().savingsRate，可为 null）
   *   emotionCount  本周期情绪消费笔数（motivation==='情绪' 或 want===true）
   *   checkinCount  省钱图谱打卡次数（savings.js 打卡记录条数）
   *   piggyBalance  存钱罐余额（元，piggy.js getBalance()）
   */
  function metricScores(m, len) {
    var src = m || {};
    var engel = num(src.engelPercent);
    var rate = (src.savingsRate === null || src.savingsRate === undefined)
      ? 0 : num(src.savingsRate);
    var emotion = num(src.emotionCount);
    var checkin = num(src.checkinCount);
    var piggy = num(src.piggyBalance);

    var s = { hamster: 0, lion: 0, fox: 0, koala: 0 };

    /* 恩格尔系数高 → 考拉（钱都喂了干饭） */
    if (engel >= 55) { s.koala += 3; }
    else if (engel >= 45) { s.koala += 2; }

    /* 储蓄率高 → 仓鼠；储蓄率为负（花超了）→ 狮子有一点嫌疑 */
    if (rate >= 30) { s.hamster += 3; }
    else if (rate >= 15) { s.hamster += 2; }
    else if (rate < 0) { s.lion += 1; }

    /* 情绪消费笔数多 → 狮子 */
    if (emotion >= 6) { s.lion += 3; }
    else if (emotion >= 3) { s.lion += 2; }
    else if (emotion >= 1) { s.lion += 1; }

    /* 省钱打卡勤 → 狐狸 */
    if (checkin >= 10) { s.fox += 3; }
    else if (checkin >= 5) { s.fox += 2; }
    else if (checkin >= 1) { s.fox += 1; }

    /* 存钱罐有余额 → 仓鼠 */
    if (piggy >= 500) { s.hamster += 2; }
    else if (piggy > 0) { s.hamster += 1; }

    /* 统一乘倍率：阈值语义不随题量变，只有权重跟着题量走 */
    var scale = metricScale(len);
    for (var k in s) {
      if (Object.prototype.hasOwnProperty.call(s, k)) {
        s[k] = s[k] * scale;
      }
    }
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* 打分                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * 答题 + 账单指标 → 四画像得分与最高画像。
   * @param {Array} answers 每题所选字母（'A'..'D'），缺题 / 非法字母自动跳过
   * @param {Object} m      五项账单指标（见 metricScores），可整体缺省
   * @param {number} [len]  本次题量（10 / 30 / 50）；省略时按 answers 长度推断。
   *                        它决定两件事：① 用哪套题对齐答案（pick(len) 的顺序）；
   *                        ② 账单指标的权重倍率（metricScale）。
   * @return {{key:string, emoji:string, name:string, tag:string,
   *           scores:Object, quizScores:Object, metricScores:Object,
   *           quizLen:number, tie:boolean, total:number}}
   */
  function score(answers, m, len) {
    var quizScores = { hamster: 0, lion: 0, fox: 0, koala: 0 };
    var list = Array.isArray(answers) ? answers : [];
    /* 题量：显式传入优先，否则按答了几题推断（空答卷回落默认档） */
    var n = (typeof len === 'number' && len > 0) ? len : (list.length || DEFAULT_LEN);
    var set = pick(n);
    var i;
    for (i = 0; i < set.length && i < list.length; i++) {
      var oi = optIndex(list[i]);
      if (oi < 0) { continue; }
      var opt = set[i].opts[oi];
      if (!opt || !opt.s) { continue; }
      for (var k in quizScores) {
        if (Object.prototype.hasOwnProperty.call(quizScores, k)) {
          quizScores[k] += num(opt.s[k]);
        }
      }
    }

    var bonus = metricScores(m, n);
    var scores = {};
    var tie = false;
    var bestKey = TIE_ORDER[0];
    var bestVal = -1;
    for (var t in TIE_ORDER) {
      if (!Object.prototype.hasOwnProperty.call(TIE_ORDER, t)) { continue; }
      var key = TIE_ORDER[t];
      var val = quizScores[key] + bonus[key];
      scores[key] = val;
      if (val > bestVal) {
        bestVal = val;
        bestKey = key;
        tie = false;
      } else if (val === bestVal) {
        /* 与当前最高并列：谁先谁赢（TIE_ORDER 序），但 tie 标记要立起来 */
        tie = true;
      }
    }

    var meta = TYPES[bestKey] || TYPES.hamster;
    return {
      key: meta.key,
      emoji: meta.emoji,
      name: meta.name,
      tag: meta.tag,
      scores: scores,
      quizScores: quizScores,
      metricScores: bonus,
      quizLen: set.length,
      tie: tie,
      total: bestVal
    };
  }

  /* ------------------------------------------------------------------ */
  /* 文案                                                                */
  /* ------------------------------------------------------------------ */

  /** 金额 → 整数元（报告里不需要分位，先取整防小数撑爆字数） */
  function yuan(v) {
    return Math.round(num(v)).toString();
  }

  /**
   * 证据句：必须带真实数据（缺指标时按 0 展示，不编数字）。
   * @param {string} key 画像 key
   * @param {Object} m   归一化后的指标
   */
  function evidenceOf(key, m) {
    if (key === 'hamster') {
      return '你的储蓄率 ' + Math.round(m.savingsRate) + '%，存钱罐里还躺着 ¥' + yuan(m.piggyBalance) + '。';
    }
    if (key === 'lion') {
      return '你本周期有 ' + Math.round(m.emotionCount) + ' 笔情绪消费，钱包就是这么漏风的。';
    }
    if (key === 'fox') {
      return '你已完成 ' + Math.round(m.checkinCount) + ' 次省钱打卡，羊毛证持证上岗。';
    }
    return '你的恩格尔系数 ' + Math.round(m.engelPercent) + '%，干饭稳稳占了开销大头。';
  }

  /** 心理剖析：温柔共情，不说教 */
  function analysisOf(key) {
    if (key === 'hamster') {
      return '看着余额上涨才有安全感的你，克制不是抠，是心里有数。';
    }
    if (key === 'lion') {
      return '千金难买我乐意，快乐是真的，只是钱包偶尔跟不上心情。';
    }
    if (key === 'fox') {
      return '每一分都花在刀刃上，比价就是你的超能力，别不好意思。';
    }
    return '把日子过成美食纪录片没什么不好，胃满了心才稳。';
  }

  /** 破局建议（短版）：一句话，用在 ≤200 字的精简报告里 */
  function adviceOf(key) {
    if (key === 'hamster') {
      return '偶尔也给自己开一单小的，快乐也可以写进预算里。';
    }
    if (key === 'lion') {
      return '下单前来心愿单挂 48 小时，冷静期专治上头。';
    }
    if (key === 'fox') {
      return '省钱图谱每天打一次卡，把羊毛换成存钱罐余额。';
    }
    return '试一周食堂平替外卖，省下的钱够多加两个鸡腿。';
  }

  /**
   * 破局建议（详细版）：三条，每条 = 一个小动作 + 具体怎么做。
   * 数字一律用真实指标算（存钱罐余额 / 情绪消费笔数 / 打卡次数 / 恩格尔系数），
   * 缺数据就用保守默认值，绝不编造用户没发生过的金额。
   * @param {string} key 画像 key
   * @param {Object} met 归一化后的指标
   * @return {Array<{t:string, how:string}>}
   */
  function adviceList(key, met) {
    var src = met || {};
    var piggy = Math.round(num(src.piggyBalance));
    var emo = Math.round(num(src.emotionCount));
    var checkin = Math.round(num(src.checkinCount));
    var engel = Math.round(num(src.engelPercent));
    /* 快乐预算：存钱罐的 5%，夹在 20~200 之间；没余额时给 30 这个起步值 */
    var happy = piggy > 0 ? Math.max(20, Math.min(200, Math.round(piggy * 0.05))) : 30;
    /* 食堂平替外卖：一周 3 天 × 4 周 × 每单省 8 元（口径写在文案里，不让用户猜） */
    var mealSave = 3 * 4 * 8;

    if (key === 'hamster') {
      return [
        {
          t: '开一个「快乐预算」',
          how: '每月先从存钱罐取出 ¥' + happy + '（罐里余额的 5%），专门买一件你平时舍不得买的东西，' +
            '花完不许心疼、也不许省回去 —— 克制要留个出口，不然迟早反弹。'
        },
        {
          t: '把「不买」换成「晚买」',
          how: '想买的东西先写进心愿单，挂 48 小时冷静期；两天后还想要，就用快乐预算买。' +
            '同样是不乱花，但这一次是你选的，不是硬扛的。'
        },
        {
          t: '给每笔非刚需打个分',
          how: '记账时顺手给非必需消费标个「值不值」（1-5 分），月底回看一遍：' +
            '你要的不是更省，是把钱花在自己真正在意的地方。'
        }
      ];
    }
    if (key === 'lion') {
      return [
        {
          t: '给深夜加一道闸门',
          how: '22 点以后想买的东西，先丢进心愿单走 48 小时冷静期，第二天再看还想要不要。' +
            '你本周期有 ' + emo + ' 笔情绪消费，先把深夜那几笔拦下来，见效最快。'
        },
        {
          t: '心动时先问一句「想要还是需要」',
          how: '想要的就拍照存进心愿单，攒到周末统一处理 —— 把「立刻买」改成「排个队」，' +
            '冲动就只剩一半。'
        },
        {
          t: '给自己留一笔「冲动额度」',
          how: '每月留 ¥100 专门用来任性，额度内随便花，超了就必须等下个月。' +
            '有边界的放纵，比靠意志力硬忍要持久得多。'
        }
      ];
    }
    if (key === 'fox') {
      return [
        {
          t: '把羊毛换成余额',
          how: '你已经完成 ' + checkin + ' 次省钱打卡，接下来每打一次卡，就把这一单省下的钱' +
            '（哪怕只有 5 块）转进存钱罐 —— 省下来的钱看得见，才真的算省。'
        },
        {
          t: '比价别只比单价',
          how: '把「克单价 / 单次使用成本 / 会不会闲置」三项一起算：闲置率高的东西再便宜也是亏。' +
            '你最该省的不是买贵的钱，是买错的钱。'
        },
        {
          t: '大件先等 7 天',
          how: '超过 ¥200 的东西先等一周，这周只干一件事 —— 找更划算的渠道或者平替；' +
            '找不到再原价买也不亏，找到了就是净赚。'
        }
      ];
    }
    return [
      {
        t: '干饭不减量，先换渠道',
        how: '一周挑 3 天用食堂平替外卖，按每单省 8 元算，一个月约省 ¥' + mealSave + '。' +
          '你的恩格尔系数是 ' + engel + '%，这块是你最大的可省项，而且不用委屈胃口。'
      },
      {
        t: '给吃饭单独画条线',
        how: '把餐饮支出压在总支出的 60% 以内（现在是 ' + engel + '%），哪天超了就自己带饭一天。' +
          '不是不让你吃，是别让吃把别的快乐都吞掉。'
      },
      {
        t: '每月做一次「食堂挑战」',
        how: '挑一天只用平时一顿外卖的钱吃一天食堂，省下的钱月末存进存钱罐；' +
          '攒够一顿好的，就名正言顺去搓一顿。'
      }
    ];
  }

  /**
   * 完整方案（弹窗里展示的那份）：画像 + 证据 + 剖析 + 分点详细建议。
   * 与 report() 的区别：report 是 ≤200 字的精简版（卡片摘要 / 存储快照），
   * plan 不受字数限制，重点把「怎么做的每一步」说清楚。
   * @param {Object} res score() 的返回值；非法时自动兜底
   * @param {Object} m 五项账单指标（可缺省）
   * @return {string} Markdown
   */
  function plan(res, m) {
    var ok = res && typeof res === 'object' && TYPES[res.key];
    var r = ok ? res : score([], m);
    var meta = TYPES[r.key] || TYPES.hamster;
    var src = m || {};
    var met = {
      engelPercent: num(src.engelPercent),
      savingsRate: (src.savingsRate === null || src.savingsRate === undefined)
        ? 0 : num(src.savingsRate),
      emotionCount: num(src.emotionCount),
      checkinCount: num(src.checkinCount),
      piggyBalance: num(src.piggyBalance)
    };

    var md = '### 🧬 你的消费性格是：' + meta.emoji + meta.name + '\n';
    md += '**📊 账单画像证据**\n' + evidenceOf(r.key, met) + '\n';
    md += '**💡 财务心理剖析**\n' + analysisOf(r.key) + '\n';
    md += '**🎯 专属破局建议**\n';
    var list = adviceList(r.key, met);
    for (var i = 0; i < list.length; i++) {
      md += (i + 1) + '. **' + list[i].t + '**：' + list[i].how + '\n';
    }
    return md;
  }

  /**
   * 兜底裁剪：报告总长超 LIMIT 时，优先压最长的可变文案；
   * 全部压到最短仍超长时，硬切整串（并清掉尾部残缺的代理对）。
   */
  function clip(head, sec1, ev, sec2, an, sec3, ad) {
    var parts = [ev, an, ad];
    var i;
    for (i = 0; i < 12; i++) {
      var md = head + sec1 + parts[0] + sec2 + parts[1] + sec3 + parts[2];
      if (md.length <= LIMIT) { return md; }
      /* 找最长的一段砍 */
      var longest = 0;
      for (var j = 1; j < parts.length; j++) {
        if (parts[j].length > parts[longest].length) { longest = j; }
      }
      var over = md.length - LIMIT;
      var p = parts[longest];
      if (p.length - over > MIN_TEXT) {
        parts[longest] = p.slice(0, p.length - over) + '…';
      } else if (p.length > MIN_TEXT) {
        parts[longest] = p.slice(0, MIN_TEXT) + '…';
      } else {
        break; /* 三段都到最短了，交给硬切 */
      }
    }
    var out = head + sec1 + parts[0] + sec2 + parts[1] + sec3 + parts[2];
    if (out.length > LIMIT) {
      out = out.slice(0, LIMIT);
      /* 别把代理对切成两半 */
      var last = out.charCodeAt(out.length - 1);
      if (last >= 0xD800 && last <= 0xDBFF) { out = out.slice(0, -1); }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 报告                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * 生成诊断报告（Markdown 纯文本，≤200 字，带 Emoji）。
   * @param {Object} res score() 的返回值；非法时自动用 score([], m) 兜底
   * @param {Object} m   五项账单指标（可缺省，缺了当 0）
   * @return {string}
   */
  function report(res, m) {
    var ok = res && typeof res === 'object' && TYPES[res.key];
    var r = ok ? res : score([], m);
    /* 自愈：res 只带 key 不带 emoji / name（或字段残缺）时，从 TYPES 按 key
       取回元数据；key 也未知时兜底仓鼠。绝不把 undefined 拼进报告头。 */
    var meta = TYPES[r.key] || TYPES.hamster;
    var src = m || {};
    /* 指标统一过一遍 num，保证 evidenceOf 拿到的永远是数 */
    var met = {
      engelPercent: num(src.engelPercent),
      savingsRate: (src.savingsRate === null || src.savingsRate === undefined)
        ? 0 : num(src.savingsRate),
      emotionCount: num(src.emotionCount),
      checkinCount: num(src.checkinCount),
      piggyBalance: num(src.piggyBalance)
    };

    var head = '### 🧬 你的消费性格是：' + meta.emoji + meta.name + '\n';
    var sec1 = '**📊 账单画像证据**\n';
    var sec2 = '\n**💡 财务心理剖析**\n';
    var sec3 = '\n**🎯 专属破局建议**\n';
    var ev = evidenceOf(r.key, met);
    var an = analysisOf(r.key);
    var ad = adviceOf(r.key);

    return clip(head, sec1, ev, sec2, an, sec3, ad);
  }

  /* ------------------------------------------------------------------ */

  var API = {
    LIMIT: LIMIT,
    TYPES: TYPES,
    TIE_ORDER: TIE_ORDER,
    BANK: BANK,
    LENGTHS: LENGTHS,
    DEFAULT_LEN: DEFAULT_LEN,
    /* 兼容旧调用：等于整份题库（50 道）。新代码请用 pick(len) 拿当次那套题。 */
    QUIZ: BANK,
    normalizeLen: normalizeLen,
    metricScale: metricScale,
    pick: pick,
    adviceList: adviceList,
    score: score,
    report: report,
    plan: plan
  };

  if (isNode) {
    module.exports = API;
  } else {
    global.AJ = global.AJ || {};
    global.AJ.persona = API;
  }
})(typeof window !== 'undefined' ? window : this);
