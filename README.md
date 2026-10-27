# Dehydrator AI · 文字脱水机

把长文本榨成一句真话和一个动作。

**零依赖、零配置、零 API 也能跑。** 没有 `package.json`，不需要 `npm install`，只要 Node 18+。

---

## 30 秒试运行（评审 / 工程师看这里）

```bash
node scripts/selftest.mjs
```

一条命令，九项自检：环境、词典、**单元测试**、构建、**页面（把产物放进假 DOM 真跑一遍）**、Gold 评测、端到端、模型传输、模型配置。
**不需要 key，不需要联网。** 全绿就说明这个仓库是活的。

只想跑单元测试：

```bash
node --test tests/engine.test.mjs
```

想看界面：

```bash
node scripts/serve.mjs
# 打开 http://localhost:3000
```

想启用模型（可选）：把 `DEEPSEEK_API_KEY` 设进环境变量或 `.env.local`，或者用任何 OpenAI 兼容端点（见 `.env.example`）。
**不配也完整可用**——L2 会自动降级为确定性排序，报告照样出全。

## 项目定位

一个人的合法武器库：当你必须读、又没人帮你读的时候用。

- 学生读学生手册（缺课 1/3 会怎样、申诉期几天）
- 个人开发者读合同和平台规则（哪些条款把责任推给你）
- 任何人读用户协议（你付出了什么）

## 文件索引

| 路径 | 是什么 |
|---|---|
| `docs/SPEC.md` | **输出契约**：产品的验收标准，改它等于改产品 |
| `prompts/l2-judge.md` | L2 排序官的提示词（程序直接读这个文件） |
| `corpus/gold.tsv` | 29 条人工标注，评测集 |
| `docs/index.html` | 离线版单文件页面（构建产物，勿手改） |

---

## 立刻能看到的东西

```
双击 dist/dehydrator-offline.html
```

**不需要服务器、不需要网络、不需要 API key。** 断网也能用。

- 点预设按钮，或把任意 `.txt` 拖进去（试试 `corpus/raw/学生手册2025.txt`，19.4 万字）
- 页面会告诉你：这段文字里哪几句你**真该看**、原文里**哪几个字**是坑、以及它**没写**什么

重新生成这个文件：

```
node scripts/build-offline.mjs
```

## 命令行版

```
node scripts/scan.mjs corpus/raw/学生手册.txt
node scripts/scan.mjs corpus/raw/学生手册.txt --top=8 --show=10
```

## 目录

```
lexicon/entries/*.json       91 条套路词条，按类别拆成 8 个文件（**改这里**）
lexicon/meta.json            版本、许可、类别定义、语域说明、设计纪律
lexicon/zh-cn.v1.json        词库产物（合并结果，勿手改）
lexicon/rules.zh-cn.v1.json  12 条同句共现规则（高召回层，允许误报）
lexicon/README.md            词条怎么写、校验会拦什么
lib/engine.mjs               纯函数引擎：无 import、不碰文件系统、不联网
lib/rank.mjs                 纯函数排序层：代价门槛 + 去重 + 标题（浏览器与命令行共用）
lib/pipeline.mjs             Node 侧封装：读提示词、调模型、任何一环失败就降级
lib/lexicon.mjs              词库读写层：源 → 产物合并、结构校验
lib/bundle.mjs               把引擎 + 排序层拼成浏览器可用的 IIFE
ui/offline.template.html     离线版界面模板
scripts/build-offline.mjs    打包成单文件 HTML
scripts/build-lexicon.mjs    合并词库源文件 → zh-cn.v1.json（支持 --lint / --check）
scripts/check-page.mjs       页面自检：把构建产物放进假 DOM 里真的跑一遍
scripts/scan.mjs             命令行分析
scripts/check-secrets.mjs    提交前密钥体检
corpus/raw/                  真实语料（学生手册、两份 bilibili 协议、大学章程）
```

## 架构（四段，只有第三段花 API 钱）

```
长文本
  ↓ L1 确定性：切句 + 词典 + 共现规则 → 候选句        ← 零成本、零延迟
  ↓ L1.5 确定性：代价门槛 → 有后果的句子               ← 30 条
  ↓ L2 模型：只读这 30 条，写标题和一句人话            ← 可选，无 key 自动降级
  ↓ L3 确定性：按后果去重 + 多样性排序 + 缺口检测      ← 与离线版同一条路径
```

实测（学生手册 2025 版，19.9 万字）：**198,931 字 → 8,548 句 → 3,800 个实质句 → 131 条候选 → 30 处有后果 → 10 条清单**，全流程 130 ms（不含模型）。

**离线版和命令行跑的是同一份排序代码**（`lib/rank.mjs`），不是两套实现——所以页面上的清单和终端里的清单一定一致。

## 密钥安全（三条，缺一不可）

1. **key 只放 `.env.local`**，这个文件已被 `.gitignore` 覆盖，永远不会提交。
2. **变量名不要加 `NEXT_PUBLIC_` 前缀**——加了会被打进浏览器 bundle，等于公开发布。
3. **提交前跑一次**：`node scripts/check-secrets.mjs`。它会扫工作区和 git 历史。

另外：比赛用**专用 key**（不要用平时那个），额度只充够用的；赛后删掉即可——
因为离线版不需要 key 也能完整运行。

## 词库怎么改

- 新增词条：在 `lexicon/entries/` 里找到对应类别的文件（一个类别一个文件），在 `entries` 末尾加一条，
  必须带 `why` 和 `advice`，建议带 `evidence`（真实语料里的原句）
- 新增规则：往 `lexicon/rules.zh-cn.v1.json` 的 `rules` 里加，`groups` 是两组词，
  同句内间隔不超过 `gap` 就算命中
- 改完跑 `node scripts/build-lexicon.mjs` 合并产物，再跑 `node scripts/check-all.mjs`

**不要手改 `lexicon/zh-cn.v1.json`**——它是产物，会被下一次构建覆盖。
合并只按源文件来，`check-all` 会比对两者是否一致。字段说明和校验规则见 `lexicon/README.md`。

纪律：**词条要精度，规则要召回。** 前者直接给用户看，后者只用来把句子喂给模型。

---

## 语料来源与授权

`corpus/` 下的文本**只用于算法评测与研究**，全部是公开发布的规范性文本。

| 类别 | 文件 | 性质 | 授权状态 |
|---|---|---|---|
| 政府示范合同 | 城镇房屋租赁、能源费用托管服务合同、能源费用托管框架协议、体育健身服务、商品房买卖、旅游一日游、研学旅游、养老服务 | 国家机关发布的示范文本 | 依《著作权法》第五条，不适用著作权保护 |
| 高校章程 | 江汉大学章程、江西师范大学章程 | 高校公开章程（行政性文件） | 公开可查 |
| 校内规章 | 学生手册（2025 版）、奖学金评定细则 | 学校发布的规范性文件 | 公开可查，仅节选引用 |
| 平台协议 | 哔哩哔哩用户使用协议、隐私政策 | 企业公开条款 | 仅作技术分析引用，未作修改；版权归原权利人 |
| 岗位描述 | `jd-2026-10.raw.txt` | 公开招聘信息 | **已脱敏**：企业名替换为「某车企」「某新能源车企」，不含个人姓名 |

**声明：** 本项目对上述文本只做模式匹配与结构分析，**不对任何主体作出评价或指控**。
命中结果描述的是「文本特征」，不是「主体动机」。若权利人认为引用不妥，联系我们删除。

`input/` 目录已列入 `.gitignore`，原始素材（截图、.docx、.doc）不会进入仓库。

## 提交前检查清单

```bash
node scripts/selftest.mjs     # 九项自检，全绿才能提交
node scripts/check-secrets.mjs  # 密钥体检（含 git 历史）
```

`input/`、`.env.local` 必须在 `.gitignore` 生效后被排除——在 VS Code 的「更改」列表里数一下文件数（约 45 个），确认没有它们。

