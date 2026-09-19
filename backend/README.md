# MeowCan 后端

这个 Rust 服务负责账号、会话、RBAC、曲库检索和个人成绩。VOS 谱面、图片和音频属于不可变的大文件，继续由静态站点提供。

## 本地开发

1. 建立数据库隧道：`ssh -N -L 3307:127.0.0.1:3307 dev135`。
2. 复制 `.env.example` 为 `.env`，填写开发数据库密码。
3. 首次运行曲库导入：`cargo run -- import-songs ../web/public/songs.json`。该命令可以重复执行。
4. 运行后端：`cargo run`。
5. 在另一个终端进入 `web/`，运行 `bun run dev`。

服务启动时会自动执行数据库迁移。Vite 开发服务器会把 `/api` 和 `/health` 转发到 Rust 服务。

以下命令用于创建或重置管理员。密码通过环境变量传入，不会出现在进程参数中。

```powershell
$env:MEOWCAN_ADMIN_PASSWORD = '独立且足够长的密码'
cargo run -- create-admin admin@example.com Administrator
Remove-Item Env:MEOWCAN_ADMIN_PASSWORD
```

## RBAC 模型

- `player`：提交成绩，查看个人成绩。
- `moderator`：查看用户、角色和全局成绩。
- `admin`：拥有全部权限，可以分配角色和停用账号。

服务通过 `roles`、`permissions`、`user_roles` 和 `role_permissions` 维护授权关系。接口检查权限，不直接判断角色名。新注册账号只获得 `player` 角色。

会话令牌由密码学随机数生成。数据库只保存令牌的 SHA-256 摘要。浏览器通过 `HttpOnly` 和 `SameSite=Lax` Cookie 保存原始令牌。密码使用 Argon2id。生产环境必须启用 HTTPS，并设置 `MEOWCAN_COOKIE_SECURE=true`。

每次提交成绩时，服务在同一事务中完成插入和排名清理。每位玩家的每首曲目只保留最好的 5 条成绩。排名依次比较分数、准确率、最大连击和完成时间。
