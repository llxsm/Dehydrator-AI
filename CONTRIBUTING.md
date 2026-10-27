# 协作约定（两个人）

目标：**不撞车、不漏 key、不把对方的工作弄坏。**

---

## 一、文件所有权（最重要的一条）

冲突的根本原因不是 git，是两个人改同一个文件的同一个地方。所以先分工：

| 谁 | 负责这些文件 | 别人不要动 |
|---|---|---|
| **A（你）** | `lexicon/`（词库源 + 规则）、`corpus/` | 词库和语料归你 |
| **B（同学）** | `lib/`（engine / rank / pipeline）、`ui/offline.template.html`、`scripts/` | 代码和界面归他 |
| 共同 | `README.md`、`CONTRIBUTING.md`、`docs/` | 改前喊一声 |

**排序口径只在一个地方：`lib/rank.mjs`。** 页面（离线版）和命令行（`l2.mjs`）都调它——
改排序、改去重、改标题生成，只改这一个文件，两边会一起变。**不要只改其中一边**，
那正是之前「页面只出原始命中、终端才出清单」的由来。

**词库已经按类别拆成 8 个文件**（`lexicon/entries/*.json`），一个类别一个文件：
两个人改不同类别时，git 不会在同一片区域报冲突。同一个文件里加词条，**加在数组末尾**。

**产物不要手改：** `lexicon/zh-cn.v1.json` 是 `entries/*.json` 合并出来的，
改完源文件必须跑一次：

```bash
node scripts/build-lexicon.mjs    # 合并产物
```

`check-all` 会比对源和产物，改了源忘了构建会被直接拦下来（并指出是哪条词条的哪个字段）。
具体字段说明见 `lexicon/README.md`。

---

## 二、每天开工的四个动作

```bash
git pull                    # 1. 先拉最新的
node scripts/check-all.mjs  # 2. 确认自己本地是好的（有问题先解决，别在坏的基础上开工）
# 3. 改代码
git commit -m "改了什么的说明"
```

**推之前再拉一次：**

```bash
git pull --rebase
git push
```

`--rebase` 会让你的提交排在对方后面，历史是一条直线，比 merge 好读。

---

## 三、冲突了怎么办（三步，别慌）

1. 打开报冲突的文件，搜索 `<<<<<<<`
2. 会看到三段：
   ```
   <<<<<<< HEAD
   对方或你已提交的版本
   =======
   你本地的版本
   >>>>>>> 你的提交
   ```
   **保留要的那份，删掉三个标记行。**
3. `git add 文件` → `git commit`

**实在搞不定就撤：**

```bash
git merge --abort        # 或者 git rebase --abort
```

退回冲突之前的状态，让对方重做一遍。**这不丢人，比交一个破文件强。**

---

## 四、key 三不（两个人各做一遍）

1. **不提交** `.env.local`（已被 `.gitignore` 覆盖，但请自己 `git status` 看一眼）
2. **不共用 key**。各用各的 DeepSeek key，各写各的 `.env.local`
3. **不加 `NEXT_PUBLIC_` 前缀**——加了这个前缀，变量会被打进浏览器，等于公开发布

`pre-commit` 钩子会自动拦这两类问题。每个人启用一次：

```bash
git config core.hooksPath .githooks
```

---

## 五、提交前跑什么

| 什么时候 | 跑什么 | 多久 |
|---|---|---|
| 每次 commit | 自动（pre-commit 钩子） | 1 秒 |
| 每次 push 前 | `node scripts/check-all.mjs` | 3 秒 |

`check-all` 会查五件事：词库源结构 + 产物是否同步、密钥泄露、构建能否成功、
`dist` 与 `docs` 是否一致、**页面脚本能不能真跑起来**（最后一项把产物放进假 DOM 里点一次「开始脱水」）。

---

## 六、三条绝对不要

1. **不要直接改 `dist/` 和 `docs/index.html`。**
   它们是构建产物。改完下次构建就被覆盖，你的修改会**无声消失**。
   要改就改 `ui/offline.template.html`，然后跑 `node scripts/build-offline.mjs`。

2. **不要直接改 `lexicon/zh-cn.v1.json`。**
   它同样是产物，源头是 `lexicon/entries/*.json`。手改会在下次构建时被覆盖，
   而且 `check-all` 会报「产物与源不一致」。改词条请改 `lexicon/entries/`。

3. **不要两个人同时改同一个文件。**
   开工前在群里说一句「我在改 ui/offline.template.html」。这五个字省掉半小时。
   词库按类别分了 8 个文件，各改各的类别就不用等。

---

## 七、新人环境（B 第一次配）

```bash
git clone <仓库地址>
cd Dehydrator-AI
node -v                 # 需要 Node 18 以上
git config core.hooksPath .githooks
cp .env.example .env.local     # 然后填自己的 key（如果要用在线版）
node scripts/check-all.mjs     # 全绿就说明环境好了
```

`node scripts/build-offline.mjs` 然后双击 `dist/dehydrator-offline.html`，能看到页面就是对的。
