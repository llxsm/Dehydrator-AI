# 协作约定（两个人）

目标：**不撞车、不漏 key、不把对方的工作弄坏。**

---

## 一、文件所有权（最重要的一条）

冲突的根本原因不是 git，是两个人改同一个文件的同一个地方。所以先分工：

| 谁 | 负责这些文件 | 别人不要动 |
|---|---|---|
| **A（你）** | `lexicon/zh-cn.v1.json`（词条）、`corpus/` | 只有你能加词条 |
| **B（同学）** | `lib/engine.mjs`、`ui/offline.template.html`、`scripts/` | 代码和界面归他 |
| 共同 | `README.md`、`CONTRIBUTING.md` | 改前喊一声 |

**为什么词条只能一个人改：** `lexicon/zh-cn.v1.json` 是单个大文件，两个人在不同位置加词条，
git 仍然会在同一片区域报冲突。而且它的格式是"少一个逗号整个产品白屏"。

**B 想加词条怎么办：** 写在一张清单里（`docs/新词条.md`），交给 A 合并。这比来回改冲突文件快得多。

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

`check-all` 会查四件事：词典 JSON 结构、密钥泄露、构建能否成功、`dist` 与 `docs` 是否一致。

---

## 六、两条绝对不要

1. **不要直接改 `dist/` 和 `docs/index.html`。**
   它们是构建产物。改完下次构建就被覆盖，你的修改会**无声消失**。
   要改就改 `ui/offline.template.html`，然后跑 `node scripts/build-offline.mjs`。

2. **不要两个人同时改同一个文件。**
   开工前在群里说一句「我在改 ui/offline.template.html」。这五个字省掉半小时。

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
