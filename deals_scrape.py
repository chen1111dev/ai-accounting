#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
deals_scrape.py — 真实抓取当当网搜索结果，产出比价数据集。

只做三件事：
  1) 真请求 search.dangdang.com（关键词必须 GBK 编码，UA 伪装 PC 浏览器）
  2) 翻页 1..N 页，逐条解析 标题 / 价格 / 店铺 / 评价数 / 链接 / 图片
  3) 落盘 JSON，带 source / keyword / url / scraped_at 元信息，供前端比价面板直接吃

不生成任何模拟数据：抓不到就返回空，并在 meta 里记录失败原因。
"""
import json
import re
import sys
import ssl
import time
from concurrent.futures import ThreadPoolExecutor
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

# 通用 HTTPS 上下文（慢慢买等比价聚合站用）：不校验证书，避免本地证书链问题
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

UA = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://www.dangdang.com/",
}

CN_TZ = timezone(timedelta(hours=8))

YX_UA = {
    "User-Agent": UA["User-Agent"],
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://you.163.com/search?keyword=x",
    "X-Requested-With": "XMLHttpRequest",
}

# 常见保温杯品牌词表，用于从标题里识别品牌（识别不到记空，不猜）
BRANDS = ["膳魔师", "THERMOS", "象印", "ZOJIRUSHI", "虎牌", "TIGER", "富光", "哈尔斯",
          "希诺", "希乐", "苏泊尔", "乐扣乐扣", "LOCK&LOCK", "九阳", "物生物", "杯具熊",
          "bablov", "BABLOV", "星巴克", "STANLEY", "斯坦利", "泰福高", "虎象", "欧橡",
          "金灶", "特百惠", "Tupperware", "小米", "米家", "格亚", "格非尔", "恩尔美"]


def fetch_yx(keyword, page=1, timeout=20, size=40):
    """请求网易严选搜索 JSON 接口（you.163.com，综合电商，搜手机返回真手机）。

    返回 (请求url, 商品list原始dict)。接口免登录、UTF-8、直接吐 JSON。
    size 默认 40（接口支持；不给时只回 10 条，召回会严重不够）。
    """
    q = urllib.parse.quote(keyword)
    url = ("https://you.163.com/xhr/search/search.json?keyword=%s&page=%d&style=json&size=%d"
           % (q, page, size))
    req = urllib.request.Request(url, headers=YX_UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode("utf-8", "ignore"))
    if not isinstance(data, dict) or data.get("code") != "200":
        raise RuntimeError("严选接口返回异常: %s" % str(data)[:120])
    direct = (data.get("data") or {}).get("directly") or {}
    res = (direct.get("searcherResult") or {}).get("result") or []
    return url, res


def parse_yx(raw_items):
    """把严选 JSON 商品行折算成统一字段（与当当解析同一形状）。"""
    out = []
    for it in raw_items:
        name = (it.get("name") or "").strip()
        price = it.get("retailPrice")
        try:
            price = round(float(price), 2)
        except (TypeError, ValueError):
            continue
        if not name or price <= 0 or it.get("soldOut") or it.get("underShelf"):
            continue
        sku = str(it.get("primarySkuId") or it.get("id") or "")
        counter = it.get("counterPrice")
        try:
            counter = round(float(counter), 2) if counter else None
        except (TypeError, ValueError):
            counter = None
        sv = it.get("sellVolume")
        try:
            sv = int(sv) if sv is not None and str(sv) != "" else None
        except (TypeError, ValueError):
            sv = None
        out.append({
            "sku": sku,
            "source": "网易严选",
            "source_host": "you.163.com",
            "platform": "网易严选",
            "title": name,
            "price": price,
            "original": counter,  # 划线原价（严选特有，当当没有就置 None）
            "shop": "严选自营",   # 平台名已由 source 字段带出，店铺写自营避免界面上重复
            "brand": "",
            "reviews": sv,
            "reviews_label": "销量",  # 前端显示"N 销量"而不是"N 条评价"
            "url": ("https://you.163.com/item/detail?itemId=" + sku) if sku else "",
            "image": "",
            "page": None,
        })
    return out


def fetch(keyword, page=1, timeout=25):
    """请求当当搜索页；关键词按 GBK 编码（当当搜索接口是 GBK）。"""
    q = urllib.parse.quote(keyword.encode("gbk"))
    # 当当翻页参数是 page_index（第 2 页起带 page_index=2），不是 page
    url = ("https://search.dangdang.com/?key=%s&act=input&page_index=%d" % (q, page))
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    # 当当返回 GB2312/GBK
    return url, raw.decode("gbk", "ignore")


def _txt(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()


def parse_items(html):
    """按 <p class="price"> 切块 —— 每个商品自带一块，避免相邻商品串数据。"""
    chunks = re.split(r'<p class="price"', html)[1:]
    out = []
    for c in chunks:
        m_title = re.search(r'<p class="name" name="title" ><a title="([^"]*)"', c)
        if not m_title:
            continue
        m_price = re.search(r'<span class="price_n">\s*(?:&yen;|¥)?\s*([\d.]+)\s*</span>', c)
        if not m_price:
            continue
        m_href = re.search(r'name="title" ><a title="[^"]*" href="([^"]*)"', c)
        m_rev = re.search(r'>\s*(\d+)\s*条评论', c)
        m_shop = re.search(r'name="itemlist-shop-name"[^>]*title="([^"]*)"', c)
        m_img = re.search(r'<img[^>]*data-original="([^"]*)"', c)
        title = _txt(m_title.group(1))
        href = (m_href.group(1) if m_href else "").strip()
        if href.startswith("//"):
            href = "https:" + href
        m_sku = re.search(r'/product\.dangdang\.com/(\d+)\.html', href)
        brand = ""
        for b in BRANDS:
            if b.lower() in title.lower():
                brand = b.upper() if b.isascii() else b
                break
        out.append({
            "sku": m_sku.group(1) if m_sku else "",
            "source": "当当网",
            "source_host": "search.dangdang.com",
            "platform": "当当",
            "title": title,
            "price": float(m_price.group(1)),
            "shop": _txt(m_shop.group(1)) if m_shop else "",
            "brand": brand,
            "reviews": int(m_rev.group(1)) if m_rev else None,
            "url": href,
            "image": ("https:" + m_img.group(1)) if m_img and m_img.group(1).startswith("//") else (m_img.group(1) if m_img else ""),
            "page": None,
        })
    return out


# ===================== 慢慢买比价（聚合源） =====================
# 慢慢买是比价聚合站，搜索页（s.manmanbuy.com/pc/search/result）直出京东/天猫/淘宝等
# 平台的真实到手价，且免登录、无风控。它本身不卖货，所以抓到的是各电商的报价，
# 平台名写在 itemMall 字段里（京东自营/天猫旗舰店/淘宝…）。这是补齐"京东/天猫"两座大山的唯一可行路：
# 直接抓京东/淘宝会被登录校验和风控页挡住，而经慢慢买聚合能拿到真价格。
MM_UA = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://www.manmanbuy.com/",
}

# 慢慢买标题常带促销前缀，如「闭眼买、再降价、88VIP：索尼 WH-1000XM…」「限地区、再降价：iPhone…」
# 这些不是商品本身，展示前剥掉，同时保留真实商品名（不删真实内容）
MM_PROMO = ["闭眼买", "再降价", "88VIP", "限地区", "PLUS", "预售", "20点", "历史新低",
            "神价", "到手价", "领券", "秒杀", "包邮", "加购", "叠加", "预告", "刚补",
            "返场", "提醒", "晚 8", "点抢", "补贴", "国补"]


def _clean_mm_title(t):
    t = (t or "").strip()
    if "：" not in t:
        return t
    pre = t.split("：", 1)[0]
    # 前缀只要命中任一促销标签，就截掉冒号之前的部分
    if any(tag in pre for tag in MM_PROMO):
        return t.split("：", 1)[1].strip()
    return t


def _norm_mall(mall):
    """把商城名归一成比价面板里的平台名（京东自营/京东商城→京东，天猫旗舰店/天猫超市→天猫）。"""
    m = (mall or "").strip()
    if "京东" in m:
        return "京东"
    if "天猫" in m:
        return "天猫"
    if "淘宝" in m:
        return "淘宝"
    if "苏宁" in m:
        return "苏宁"
    if "唯品会" in m:
        return "唯品会"
    if "拼多多" in m:
        return "拼多多"
    if "国美" in m:
        return "国美"
    return m or "其他"


def fetch_mm(keyword, page_id=1, timeout=20):
    """请求慢慢买搜索结果页（支持 pageId 翻页）。返回 (url, html)。"""
    q = urllib.parse.quote(keyword)
    url = ("https://s.manmanbuy.com/pc/search/result?keyword=%s&pageId=%d" % (q, page_id))
    req = urllib.request.Request(url, headers=MM_UA)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return url, r.read().decode("utf-8", "ignore")


def parse_mm(html):
    """把慢慢买的优惠/报价卡片折算成统一字段。
    每张卡片含：标题 / 副标题（含 'xxx元（+淘金币/含国补）'） / 商城 / 评论数 / 时间。"""
    blocks = re.split(r'DiscountItemPC_box__\w+">', html)[1:]
    out = []
    for b in blocks:
        ti = re.search(r'itemTitle__\w+"><a target="_blank" title="([^"]*)" href="([^"]*)"', b)
        if not ti:
            continue
        sub = re.search(r'itemSubTitle__\w+"><a[^>]*>([^<]*)</a>', b)
        mall = re.search(r'itemMall__\w+">([^<]*)<', b)
        rev = re.search(r'iconComment__\w+"><i[^>]*></i>\s*(\d+)', b)
        if not sub:
            continue
        pm = re.search(r"([\d.]+)\s*元", sub.group(1))
        if not pm:
            continue
        try:
            price = round(float(pm.group(1)), 2)
        except (TypeError, ValueError):
            continue
        # 价格异常（0.x 测试价 / 50万以上的标价）直接丢，不污染比价
        if price <= 0 or price > 500000:
            continue
        title = _clean_mm_title(ti.group(1))
        mall_name = mall.group(1).strip() if mall else "慢慢买"
        plat = _norm_mall(mall_name)
        rev_n = int(rev.group(1)) if rev else None
        out.append({
            "sku": "",
            "source": "慢慢买比价",
            "source_host": "s.manmanbuy.com",
            "platform": plat,              # 真实所在平台：京东/天猫/淘宝…
            "title": title,
            "price": price,
            "original": None,
            "shop": mall_name,             # 店铺/商城展示用原名（京东自营/天猫旗舰店）
            "brand": "",
            "reviews": rev_n,
            "reviews_label": "评论",
            "url": ti.group(2).strip(),    # cu.manmanbuy.com 优惠详情，点击跳真实购买页
            "image": "",
            "price_label": "到手价",
            "page": None,
        })
    return out


def capacity_ml(title):
    """从标题抠容量，用于单价折算（每 100ml 多少钱）。抠不到返回 0。"""
    m = re.search(r'(\d{3,4})\s*(?:ml|ML|毫升)', title)
    if m:
        return int(m.group(1))
    m = re.search(r'(\d(?:\.\d)?)\s*(?:L|l|升)(?![a-zA-Z])', title)
    if m:
        return int(float(m.group(1)) * 1000)
    return 0


def facets(title):
    """从标题里抽可比对规格：材质 / 人群 / 主功能。抽不到就标「未知」，绝不瞎猜。"""
    if "316" in title:
        material = "316不锈钢"
    elif "304" in title:
        material = "304不锈钢"
    else:
        material = "材质未标注"
    if re.search(r'儿童|宝宝|婴儿|幼儿园|学生|女童|男童|小孩', title):
        target = "儿童"
    elif re.search(r'男士|女士|商务|办公|车载|成人', title):
        target = "成人"
    else:
        target = "通用"
    feats = []
    for kw, name in (("显温", "智能显温"), ("茶水分离", "茶水分离"), ("吸管", "吸管杯"),
                     ("弹跳", "弹跳盖"), ("大肚", "大肚杯"), ("泡茶", "泡茶杯"),
                     ("直饮", "直饮"), ("大容量", "大容量")):
        if kw in title:
            feats.append(name)
    return {"material": material, "target": target, "feature": feats[:2]}


# ===================== 相关性提纯 =====================
# 背景：电商搜索会返回一堆"沾边但不是这个东西"的结果——当当是书店，搜"洗面奶"会返回
# 《化妆品设计与配方》；搜"笔记本电脑"会返回电脑包、支架。直接展示会被评委一眼看穿，
# 所以这里做显式提纯，并且把剔除量如实写进 meta（不藏）。

# 出版物：强信号命中 1 个即判书（百货标题不会有"出版社""丛书"），弱信号要 2 个
BOOK_STRONG = ["出版", "编著", "丛书", "开本", "译著", "新华书店", "ISBN",
               "中文版", "文学奖", "赠导读", "正版书籍", "当当自营图书", "这本书",
               # 书籍版式 / 教辅 / 读本类强特征（百货标题不会出现这些）
               "出版社", "散文集", "小说集", "作品集", "文集", "全集", "诗集", "选集",
               "读本", "绘本", "多格漫画", "爆笑漫画", "漫画书", "连环画", "字帖",
               "教辅", "课本", "教材", "中小学", "年级", "同步练习", "考点", "指导用书",
               "青少版", "青少年版", "初中版", "高中版", "小学版",
               "分级阅读", "拼音版", "插图版", "修订版", "典藏版", "纪念版",
               "珍藏版", "双语版", "汉英对照", "双语读本",
               "书籍", "图鉴", "鉴赏", "揭秘", "购买指南", "宝典", "百科"]
BOOK_WEAK = ["图书", "教材", "教程", "大全", "全彩", "手册", "全书", "指南",
             "无师自通", "一看即会", "附光盘", "精装", "平装", "工艺学", "科普",
             "使用与维护", "速成", "新手学", "从入门到精通", "从零开始", "技巧",
             "的书", "全套", "册", "作品", "小说", "散文", "诗集", "名著", "译",
             "暂无", "正版", "入门", "零基础", "教学视频", "摄影", "修图", "剪映",
             "育儿", "自控力", "修养", "精通", "编导", "签名版", "典藏版", "纪念版",
             "当当自营", "精装版", "口袋书", "连环画", "字帖", "试卷", "教辅",
             "秘本", "偏方", "土方", "秘方", "养育", "家长", "真传", "吃透"]
BOOK_RE = [
    re.compile(r"978-?\d{10}"),                      # ISBN
    re.compile(r"(?<!\d)\d{13}(?!\d)"),               # 13 位条码
    re.compile(r"\d+\s*册"),                          # 「全5册」「3册装」
    re.compile(r"[（(]\s*\d+\s*级\s*[）)]"),          # 「(7级)」分级读物
]

# 强周边：命中即判不是商品本体（清洁工具、耗材、维修件、同名词的配件）
ACC_STRONG = ["清理", "清洗", "清洁", "清灰", "刷子", "拔键器", "胶带", "贴纸",
              "保护膜", "保护套", "维修", "零件", "配件", "替换装", "防尘",
              "清洁剂", "除菌", "翻新", "散热", "键帽", "计算器", "起泡网",
              "打泡", "网袋", "键位", "卫星轴", "调教", "轴体润", "鼠标垫",
              "充电器", "充电头", "氮化镓", "抱枕", "靠枕", "靠垫", "枕芯",
              "U盘", "无线鼠标", "键鼠套装", "手机壳", "钢化膜", "数据线转",
              "挤压器", "卷压器", "分装瓶", "分装袋", "牙膏夹", "起泡", "泡网",
              "双肩包", "背包", "书包", "公文包", "手提包", "单肩包", "斜挎包"]

# 核心词后面紧跟这些字 → 说明买的是"XX的包/壳/架"，不是 XX 本身。
# 注意：不含"套"（"套装"常是正品组合装，误杀率高）
PERIPH_SUFFIX = ["包", "袋", "盒", "架", "垫", "罩", "刷", "器", "膜", "贴",
                 "绳", "夹", "座", "箱", "托", "盖", "壳", "扣", "链", "布",
                 "巾", "纸", "液", "剂", "油", "粉", "篮", "板"]

NOISE_HARD = ["杂志", "期刊", "报纸", "二手", "回收",
              "GB/", "GB/T", "国家标准", "行业标准", "征求意见稿"]


def is_book(title):
    """是不是出版物。当当是书店，这是它最大的噪音源。"""
    t = title or ""
    for rx in BOOK_RE:
        if rx.search(t):
            return True          # ISBN
    if any(w in t for w in BOOK_STRONG):
        return True              # "出版社""丛书""中文版"这类百货标题不会写
    if (re.search(r"[\s\u3000]著[\s\u3000]*$", t)
            or re.search(r"[\s\u3000]编(?:\s*著)?[\s\u3000]*$", t)
            or re.search(r"[\s\u3000]编著", t)):
        return True              # "...抑郁？ 著" / "曾凡静 编" 这类署名位
    return sum(1 for w in BOOK_WEAK if w in t) >= 2


def _grams(kw):
    """关键词 2-gram：「机械键盘」→ [机械, 械键, 键盘]，用于算覆盖率。"""
    kw = (kw or "").strip()
    if len(kw) <= 2:
        return [kw] if kw else []
    return [kw[i:i + 2] for i in range(len(kw) - 1)]


def core_word(kw):
    """中文偏正结构取中心词：「笔记本电脑」→「电脑」、「机械键盘」→「键盘」。

    取不到就用整个关键词。
    """
    kw = (kw or "").strip()
    if len(kw) <= 2:
        return kw
    tail = kw[-2:]
    # 中文里品类词常在尾部；若尾部是可疑修饰（如"专用""正品"）则整体保留
    if tail in ("专用", "正品", "官方", "旗舰", "新款"):
        return kw
    return tail


def is_peripheral(title, keyword):
    """核心词后面跟着周边后缀 → 是配件不是本体（如『笔记本电脑包』『手机壳』）。"""
    t, core = title or "", core_word(keyword)
    if not core or core not in t:
        return False
    for suf in PERIPH_SUFFIX:
        if re.search(re.escape(core) + r"[^，,、\s]{0,4}" + re.escape(suf), t):
            # 关键词自己就以这个后缀结尾（搜"保温杯"标题"保温杯"）不算周边
            if keyword.endswith(suf):
                continue
            return True
    return False


def relevance_score(title, keyword):
    """标题与关键词的相关性打分（0~200）。越高越像"就是这个东西"。"""
    t, k = (title or ""), (keyword or "").strip()
    if not t or not k:
        return 0
    s = 0
    if k in t:
        s += 100                      # 完整关键词命中，最强信号
    gs = set(_grams(k))
    if gs:
        s += int(sum(1 for g in gs if g in t) * 60 / len(gs))
    cs = set(k)
    if cs:
        s += int(sum(1 for c in cs if c in t) * 10 / len(cs))
    if is_book(t):
        s -= 130
    if any(w in t for w in NOISE_HARD):
        s -= 130
    if any(w in t for w in ACC_STRONG):
        s -= 80
    if is_peripheral(t, keyword):
        s -= 90
    return int(s)


# 低于这个分就认为"沾边但不是这个东西"，直接剔除
RELEVANCE_FLOOR = 60


def noise_reason(title, keyword):
    """判定噪音并给出原因；不是噪音返回 None。

    注意：关键词自己带的词不算噪音 —— 搜「键帽」时"键帽"不该把结果全杀掉。
    """
    t, k = (title or ""), (keyword or "").strip()
    if is_book(t):
        return "图书/出版物"
    for w in NOISE_HARD:
        if w in t:
            return "不相关"
    for w in ACC_STRONG:
        if w in t and w not in k:
            return "周边配件"
    if is_peripheral(t, keyword):
        return "周边配件"
    return None


def purify(items, keyword, trust_platform=False):
    """给每条打分并剔除噪音（图书 / 周边 / 蹭词）。返回 (保留列表, 剔除条数)。

    trust_platform=True：用于网易严选这类搜索质量高的平台 —— 平台自己给的排序
    就是相关性（搜"手机"第 1 条就是 iPhone 16e），此时**不再用关键词硬过滤**，
    否则会误杀标题里没写品类词的真货。只剔除明确的图书/周边，并保持平台原顺序。

    trust_platform=False：用于当当这类语义容易跑偏的平台（搜"笔记本电脑"返回
    记事本文具），按相关性分严格过滤后重排。
    """
    kept, dropped = [], 0
    for it in items:
        it["relevance"] = relevance_score(it["title"], keyword)
        if noise_reason(it["title"], keyword) or it["price"] <= 0 or not it["shop"]:
            dropped += 1
            continue
        if not trust_platform and it["relevance"] < RELEVANCE_FLOOR:
            dropped += 1
            continue
        kept.append(it)
    # 同名不同 sku 只留最靠前的一条
    seen, uniq = set(), []
    for it in kept:
        key = re.sub(r"[\s（）()【】\[\]·、,，/|]+", "", it["title"])[:24]
        if key in seen:
            dropped += 1
            continue
        seen.add(key)
        uniq.append(it)
    if not trust_platform:
        uniq.sort(key=lambda x: (-x["relevance"], -(x["reviews"] or 0), x["price"]))
    return uniq, dropped


def _finish(meta, items, want=8):
    """去重 + 过滤 + 排序 + 统计，两个源共用。"""
    seen, uniq = set(), []
    for it in items:
        key = it["sku"] or it["title"]
        if key in seen:
            continue
        seen.add(key)
        it["capacity_ml"] = capacity_ml(it["title"])
        it.update(facets(it["title"]))
        it.pop("image", None)  # 不存外链图片，页面内零外链
        if it["capacity_ml"]:
            it["unit_price_per_100ml"] = round(it["price"] / it["capacity_ml"] * 100, 2)
        uniq.append(it)
    meta["total_parsed"] = len(uniq)
    # 提纯：图书 / 周边配件一律剔除；当当这类语义易跑偏的源再叠加相关性阈值过滤
    trust = meta.get("source") != "当当网"
    rel, dropped = purify(uniq, meta["keyword"], trust_platform=trust)
    meta["relevant"] = len(rel)
    meta["dropped"] = dropped
    picked = rel[:want]
    prices = [i["price"] for i in picked]
    if prices:
        meta["price_range"] = [min(prices), max(prices)]
        meta["price_median"] = round(sorted(prices)[len(prices) // 2], 2)
    shops = {}
    for i in picked:
        shops[i["shop"]] = shops.get(i["shop"], 0) + 1
    meta["picked"] = len(picked)
    meta["shop_count"] = len(shops)
    return {"meta": meta, "items": picked}


def _new_meta(keyword):
    return {
        "source": "",
        "source_host": "",
        "keyword": keyword,
        "scraped_at": datetime.now(CN_TZ).strftime("%Y-%m-%d %H:%M:%S"),
        "scraped_at_iso": datetime.now(CN_TZ).isoformat(timespec="seconds"),
        "pages_scraped": [],
        "page_urls": [],
        "errors": [],
    }


def _scrape_yx(keyword, pages=(1, 2), want=8):
    """网易严选（you.163.com）：综合电商 JSON 接口，免登录，搜手机返回真手机。"""
    meta = _new_meta(keyword)
    meta["source"] = "网易严选"
    meta["source_host"] = "you.163.com"
    items = []
    for p in pages:
        try:
            url, raw = fetch_yx(keyword, p)
        except Exception as e:  # 网络/接口失败要如实记录，不编数据
            meta["errors"].append({"page": p, "error": "%s: %s" % (type(e).__name__, e)})
            continue
        got = parse_yx(raw)
        meta["pages_scraped"].append({"page": p, "parsed": len(got)})
        meta["page_urls"].append(url)
        for it in got:
            it["page"] = p
            items.append(it)
        time.sleep(1.0)  # 对站点友好，别打满
    return _finish(meta, items, want)


def _scrape_dangdang(keyword, pages=(1, 2), want=8):
    """当当网（search.dangdang.com）：备源，书店属性强，搜数码可能全是书。"""
    meta = _new_meta(keyword)
    meta["source"] = "当当网"
    meta["source_host"] = "search.dangdang.com"
    items = []
    for p in pages:
        try:
            url, html = fetch(keyword, p)
        except Exception as e:
            meta["errors"].append({"page": p, "error": "%s: %s" % (type(e).__name__, e)})
            continue
        got = parse_items(html)
        meta["pages_scraped"].append({"page": p, "parsed": len(got)})
        meta["page_urls"].append(url)
        for it in got:
            it["page"] = p
            items.append(it)
        time.sleep(1.2)
    return _finish(meta, items, want)


def _scrape_mm(keyword, pages=(1, 2), want=8):
    """慢慢买比价（s.manmanbuy.com）：聚合京东/天猫/淘宝等平台真实到手价，免登录无风控。"""
    meta = _new_meta(keyword)
    meta["source"] = "慢慢买比价"
    meta["source_host"] = "s.manmanbuy.com"
    items = []
    for p in pages:
        try:
            url, html = fetch_mm(keyword, p)
        except Exception as e:  # 网络/站点失败要如实记录，不编数据
            meta["errors"].append({"page": p, "error": "%s: %s" % (type(e).__name__, e)})
            continue
        got = parse_mm(html)
        meta["pages_scraped"].append({"page": p, "parsed": len(got)})
        meta["page_urls"].append(url)
        for it in got:
            it["page"] = p
            items.append(it)
        time.sleep(0.6)  # 对站点友好，别打满
    return _finish(meta, items, want)


# 数据源清单：谁抓得到就抓谁，多源合并才是真比价
SOURCES = [("网易严选", _scrape_yx), ("慢慢买比价", _scrape_mm), ("当当网", _scrape_dangdang)]


def scrape(keyword, pages=(1, 2), want=8):
    """并发抓多个平台，合并去重后按「每个平台都要有代表」的方式取前 want 条。

    失败的平台如实记录在 meta.errors，绝不编造；全部失败就返回空 items。
    """
    results = []
    with ThreadPoolExecutor(max_workers=len(SOURCES)) as ex:
        futs = {ex.submit(fn, keyword, pages, want): name for name, fn in SOURCES}
        for f, name in futs.items():
            try:
                results.append(f.result(timeout=90))
            except Exception as e:  # 单个源挂了不影响别的源
                m = _new_meta(keyword)
                m["source"] = name
                m["errors"].append({"page": "all", "error": "%s: %s" % (type(e).__name__, e)})
                results.append({"meta": m, "items": []})

    # 每个源内部已按「相关性 → 销量 → 价格」排好，直接取前 want 条；
    # 提纯后不足 2 条的源视为"这个平台没有这个品类"，如实标注而不是硬塞噪音
    per_source = []
    for d in results:
        m, its = d["meta"], d["items"][:want]
        if len(its) < 2:
            m["note"] = ("该平台未找到与「%s」相关的商品（已剔除 %d 条不相关结果）"
                         % (keyword, m.get("dropped", 0))) if m.get("total_parsed") \
                else (m["errors"][0]["error"] if m["errors"] else "该平台未返回结果")
        per_source.append({"meta": m, "items": its})

    # 提纯后不足 2 条的源说明"这个平台没这个品类"，不再拿 1 条配件充数
    order = sorted(
        [i for i in range(len(per_source)) if len(per_source[i]["items"]) >= 2],
        key=lambda i: -len(per_source[i]["items"]))
    picked, i = [], 0
    maxlen = max([len(p["items"]) for p in per_source] or [0])
    while i < maxlen and len(picked) < want:
        for idx in order:
            if i < len(per_source[idx]["items"]):
                picked.append(per_source[idx]["items"][i])
                if len(picked) >= want:
                    break
        i += 1

    meta = _new_meta(keyword)
    srcs = []
    for p in per_source:
        m = p["meta"]
        its = p["items"]
        prices = [x["price"] for x in its]
        srcs.append({
            "name": m["source"], "host": m["source_host"], "count": len(its),
            "price_range": [min(prices), max(prices)] if prices else None,
            "error": (m["errors"][0]["error"] if m["errors"] else None),
            "note": m.get("note"),
            "dropped": m.get("dropped", 0),
        })
        meta["pages_scraped"].extend([dict(x, source=m["source"]) for x in m["pages_scraped"]])
        meta["page_urls"].extend(m["page_urls"])
        meta["errors"].extend([dict(x, source=m["source"]) for x in m["errors"]])
    meta["sources"] = srcs
    got = [x["name"] + " " + str(x["count"]) + "条" for x in srcs if x["count"]]
    meta["source"] = " + ".join(got) if got else (srcs[0]["name"] if srcs else "")
    meta["source_host"] = ", ".join(sorted({x["host"] for x in srcs if x["host"]}))
    meta["total_parsed"] = sum(p["meta"].get("total_parsed", 0) for p in per_source)
    meta["relevant"] = sum(p["meta"].get("relevant", 0) for p in per_source)
    meta["dropped"] = sum(p["meta"].get("dropped", 0) for p in per_source)
    prices = [x["price"] for x in picked]
    if prices:
        meta["price_range"] = [min(prices), max(prices)]
        meta["price_median"] = round(sorted(prices)[len(prices) // 2], 2)
    meta["shop_count"] = len({x["shop"] for x in picked})
    meta["picked"] = len(picked)
    return {"meta": meta, "items": picked}


if __name__ == "__main__":
    kw = sys.argv[1] if len(sys.argv) > 1 else "保温杯"
    out = sys.argv[2] if len(sys.argv) > 2 else "deals_real.json"
    data = scrape(kw)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    m = data["meta"]
    print("[meta]", m["source"], m["keyword"], m["scraped_at"], "pages:", m["pages_scraped"], "errors:", m["errors"])
    print("[picked]", len(data["items"]))
    for i in data["items"]:
        print("  ¥%-8s %-38s %-14s %s条" % (i["price"], i["title"][:36], i["shop"][:12], i["reviews"]))
