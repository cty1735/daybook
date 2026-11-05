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

4. 记下主机组的**标识 ID**，替换 `.workflow/deploy.yml` 里的 `hostGroupID: daybook-prod`

   > `hostGroupID` 有两种写法，随平台版本不同：
   > - 简写：`hostGroupID: daybook-prod`
   > - 对象：`hostGroupID: {ID: daybook-prod, hostID: [<主机 UUID>]}`
   >
   > 以网页「可视化编辑」保存后生成的 YAML 为准，直接照抄最稳。

5. 提交推送，之后每次 push 到 `master` 就会自动部署

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
