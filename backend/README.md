# MeowCan 后端

这个 Rust 服务负责账号、会话、RBAC、曲库检索和个人成绩。VOS 谱面、图片和音频属于不可变的大文件，继续由静态站点提供。

## 本地开发

1. 选择 MySQL 时，建立数据库隧道：`ssh -N -L 3307:127.0.0.1:3307 dev135`。
2. 复制 `.env.example` 为 `.env`，选择 MySQL 或 SQLite 的 `DATABASE_URL`。
3. 首次运行曲库导入：`cargo run -- import-songs ../web/public/songs.json`。该命令可以重复执行。
4. 运行后端：`cargo run`。
5. 在另一个终端进入 `web/`，运行 `bun run dev`。

服务启动时会自动执行数据库迁移。Vite 开发服务器会把 `/api` 和 `/health` 转发到 Rust 服务。

## 数据库切换

后端根据 `DATABASE_URL` 自动选择数据库，无需重新编译。

MySQL 配置示例：

```dotenv
DATABASE_URL=mysql://meowcan:replace-me@127.0.0.1:3307/meowcan
MEOWCAN_DATABASE_MAX_CONNECTIONS=5
```

SQLite 配置示例：

```dotenv
DATABASE_URL=sqlite://data/meowcan.db?mode=rwc
MEOWCAN_DATABASE_MAX_CONNECTIONS=4
```

SQLite 自动启用以下保护措施：

- WAL 日志模式，允许读取与写入并行进行。
- 10 秒 `busy_timeout`，吸收检查点或意外进程造成的短暂锁竞争。
- 进程内写事务串行化，避免延迟事务升级时出现 `SQLITE_BUSY`。
- 每个连接启用外键约束。
- `synchronous=NORMAL` 和自动 WAL 检查点。
- 会话活跃时间最多每 5 分钟更新一次，减少无意义写入。

SQLite 数据库必须位于后端本机的本地磁盘。不要将数据库文件放到 NFS、SMB、云盘挂载目录或多台机器共享的目录。生产环境只运行一个写入数据库的后端进程。需要多实例写入时，请使用 MySQL。

## 从 MySQL 迁移到 SQLite

先让 `.env` 中的 `DATABASE_URL` 指向源 MySQL，再运行：

```powershell
New-Item -ItemType Directory -Force data
cargo run -- migrate-mysql-to-sqlite "sqlite://data/meowcan.db?mode=rwc"
```

迁移命令复制账号、RBAC、会话、曲库和成绩，并保留主键。命令完成前，目标库的修改位于同一事务中。提交后，程序会逐表核对行数并执行 WAL 检查点。

确认迁移结果后，将 `.env` 改为：

```dotenv
DATABASE_URL=sqlite://data/meowcan.db?mode=rwc
```

备份时应使用 SQLite 在线备份 API、`VACUUM INTO` 或先执行 WAL 检查点。不要在服务运行时只复制 `.db` 文件而遗漏对应的 `-wal` 文件。

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

每次提交成绩时，服务在同一事务中完成插入和排名清理。每位玩家的每首曲目只保留最好的 10 条成绩。排名依次比较分数、准确率、最大连击和完成时间。
