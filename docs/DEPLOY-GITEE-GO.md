# DayBook 自动部署流水线

设计要点：

- Gitee Go 云端构建器是 **CentOS 7.6**，官方 Node 插件只到 **15.12.0**，而本项目要求 **Node >= 22.6**（glibc 2.28+），云端装不上也跑不起来。
- 因此云端流水线**只做触发**，真正的构建与部署在主机组（`121.89.86.53`）**本机执行**，脚本见仓库根 `deploy.sh`。
- 好处：不消耗 Gitee 免费构建额度（500 分钟/月），构建实测峰值内存仅 ~170MB，1.8GB 机器完全够用。

## 启用前置条件（必须在 Gitee 网页端完成）

1. 打开 `https://gitee.com/cty1735/daybook/gitee_go` → **开通 Gitee Go**
   （若提示无法开通，先到 `https://gitee.com/profile/account_information` 绑定手机号）
2. 进入 **主机管理** → 新建主机组（类型选「公网主机」）
3. 在主机组里点「添加主机」，Gitee 会给出一条安装命令，**在服务器上执行**：

   ```bash
   # 形如（以页面实际命令为准）：
   curl -sSL <gitee 下发的地址> | bash -s <token>
   ```

4. 记下**主机组标识**和 **Agent 的 uuid**，填进 `.workflow/deploy.yml`：

   ```yaml
   hostGroupID:
     ID: daybook-prod                                        # 主机组标识
     hostID:
       - b3082fd1-a07d-4375-9a26-4fd703c29c60                # Agent uuid（在 /root/.gitee-go-agent/*.conf 里可查）
   ```

5. 提交推送，之后每次 push 到 `master` 就会自动部署

## ⚠️ 关键的 schema 坑（2026-11-05 实测）

平台文档（help.gitee.com）里的示例是 **2021 年的旧格式**，照抄会导致**任务根本不派发、卡到超时**（表现为步骤跑满 4 分半后失败，服务器 Agent 日志里 `pull jobs response: []` 全程为空）。

正确的**新版格式**：

| 字段 | ❌ 旧（文档里的） | ✅ 新（实际可用） |
|---|---|---|
| `hostGroupID` | 字符串 `daybook-prod` | **对象** `{ID: <主机组标识>, hostID: [<agent uuid>]}` |
| `script` | 块字符串 `script: \|` | **数组** `script: [ '- 命令1', '- 命令2' ]` |
| stage | 无 `executor` | 需 `executor: []` |
| step | 无 `notify`/`strategy` | 需 `notify: []` + `strategy: {retry: '0', timeout: 30}` |
| 触发 | `branches.include` | `branches.prefix` |

三者必须同时改对，缺一个就会静默超时。判断方法：**看服务器 `/opt/.agent/<uuid>.log`**，收到任务时会打印
`pull jobs response: [{JOB ...}]`。

## 手动执行（不依赖 Gitee Go）

```bash
cd /opt/daybook/daybook
git fetch origin master && git reset --hard FETCH_HEAD
bash deploy.sh
```

## deploy.sh 做了什么

| 步骤 | 说明 |
|---|---|
| 1 | `git fetch` + `git reset --hard` 同步到最新提交 |
| 2 | `pnpm install --prod=false` 装全部 workspace 依赖 |
| 3 | 构建 web（`--base=/daybook/`）、admin（`--base=/admin/`）、api 类型检查 |
| 4 | 原子切换静态目录到 `/usr/local/nginx/html/{daybook,admin}` |
| 5 | `systemctl restart daybook-api` 并做健康检查（重试 5 次） |

## 相关路径

- 代码：`/opt/daybook/daybook`（git 仓库，remote = gitee）
- 数据库：`/opt/daybook/data/daybook.sqlite`（不受部署影响）
- 环境变量：`apps/api/.env`（已被 gitignore，`git reset --hard` 不会覆盖）
- 站点：`/usr/local/nginx/html/{daybook,admin}`
- 服务：`systemctl status daybook-api`

## 服务器上的 Gitee Go Agent

| 项 | 位置 / 值 |
|---|---|
| 二进制 | `/opt/gitee-go-runner` |
| systemd 服务 | `gitee-go-agent`（已 `enable`，开机自启） |
| 日志 | `/opt/gitee-go-agent.log`、`/opt/.agent/<uuid>.log` |
| 配置 | `/root/.gitee-go-agent/<uuid>.conf` |
| Agent uuid | `b3082fd1-a07d-4375-9a26-4fd703c29c60` |

两个安装期踩到的坑（已在 unit 里规避）：

1. **必须设 `Environment=HOME=/root`** —— 否则 Agent 启动即 `panic: $HOME is not defined`。
2. **`ExecStart` 必须带 `-f`（强制注册）** —— 否则重启后注册会被服务端拒：`400 Agent has been deleted or duplicated`。
3. 并发数用 `-c 2`（默认 10），1.8GB 内存下最多同时跑 2 个构建。

排查用：`journalctl -u gitee-go-agent -f`，或把 unit 里的 `-l info` 临时改成 `-l debug` 看任务轮询。
