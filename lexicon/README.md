# 词库怎么改

这个目录是产品的判断力所在。**改这里之前先读三条纪律**（在 `meta.json` 的 `design_rules` 里）：
宁可漏不可误、多字优先、每条都要能回答「为什么算套路」。

## 文件结构

```
meta.json               版本、许可、类别定义（categories）、语域说明（registers）、设计纪律
entries/                词条源文件，一个类别一个文件
  fuzzy-promise.json      模糊承诺   16 条   语域：client / recruit
  unilateral.json         单方裁量   16 条   语域：legal / client / recruit
  silent-consent.json     沉默即同意 15 条   语域：legal / client
  liability-shift.json    责任转移   15 条   语域：legal / client
  duty-vague.json         虚化要求    7 条   语域：recruit / client
  comp-erosion.json       待遇缩水    2 条   语域：recruit / client
  pressure.json           隐性压力    5 条   语域：recruit / client
  buzzword.json           泡泡词     15 条   语域：client / recruit（只计水份，不算套路）
rules.zh-cn.v1.json     同句共现规则（高召回层，允许误报）
zh-cn.v1.json           **构建产物，不要手改**
```

`zh-cn.v1.json` 由源文件合并生成：运行时只读这一个文件（不用打开 8 个），
但**所有编辑都在 `entries/` 和 `meta.json` 里做**。

## 加一条词条

1. 打开对应类别的文件，在 `entries` 数组**末尾**追加一条（放末尾是为了减少和别人冲突）：

```json
{
  "id": "sc-16",
  "category": "silent_consent",
  "subtype": "consent",
  "label": "继续使用视为接受",
  "weight": 3,
  "terms": ["继续使用视为接受", "继续使用即表示同意"],
  "regex": "继续使用.{0,8}(视为|即表示).{0,6}(同意|接受)",
  "why": "条款改了，你不退出就等于同意新版本。",
  "advice": "每次收到协议变更通知，留一次书面『不同意』，是最便宜的退出方式。",
  "example": "若您在本协议变更后继续使用本服务，即视为您接受变更后的条款。",
  "evidence": "（可选但推荐）真实语料里的原句，用来证明这个说法确实存在"
}
```

2. 生成产物并自检：

```bash
node scripts/build-lexicon.mjs     # 合并 entries/*.json → zh-cn.v1.json
node scripts/check-all.mjs         # 结构 + 产物同步 + 构建 + 页面，一次跑完
```

3. 如果只想确认词库本身有没有问题：

```bash
node scripts/build-lexicon.mjs --lint    # 只跑校验
node scripts/build-lexicon.mjs --check   # 只查产物是否最新（CI 用）
```

## 校验会拦什么

`--lint` / `check-all` 会拦下这些错误（都会导致失败，不是提醒）：

- `id` 重复，或 `category` 与所在文件的声明不一致（放错文件）
- 缺 `label` / `weight` / `why` / `advice` / `example` 任一字段
- `weight` 不是 1–3 的整数
- `terms` 为空、有重复项、或有空字符串
- `regex` 有语法错误，或能匹配空串（会产生零长度命中）
- 文件的 `registers` 与 `meta.json` 里该类别的 `register` 对不上

只提醒、不失败的情况：`evidence` 缺失（存量 91 条里只有 16 条有，正在补）、
同一个词挂在两个词条上（有时是刻意的，但值得看一眼）。

## 权重怎么定

| 权重 | 含义 | 例子 |
|---|---|---|
| 3 | 直接损害你的利益，或剥夺你的救济 | 「有权随时单方解除」「视为放弃申诉」 |
| 2 | 有明显倾向，但要看上下文才定性 | 「视情况调整」「原则上不予补偿」 |
| 1 | 只是话术，读起来不舒服但不一定吃亏 | 「赋能」「闭环」「有责任心」 |

## 一个类别一个文件，不是随便分的

文件名 = `meta.json` 里 `categories` 的键，`category` 字段必须和文件一致。
加新类别要同时改三处：`meta.json` 的 `categories`、新建 `entries/<名字>.json`、
并确认 `lib/rank.mjs` 的 `CONSEQUENCE_NAMES` / 页面的 `CAT` 能显示它。
