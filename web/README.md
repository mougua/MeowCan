# MeowCan - CanMusic 现代网页版 (Pixi.js)

基于现代 Web 技术（Pixi.js v8、WebAudio、TypeScript 和 Vite）对经典老游戏《CanMusic》（以及 Lemonball 时代的 New CanMusic）进行网页端复刻。账号、RBAC、曲库检索和成绩由 `../backend/` 中的 Rust 服务提供。后端不可用时，游戏会回退到离线曲库。

---

## 🌟 核心特性

1. **原生 7 键核心音游玩法**：
   - 经典键位：`[S] [D] [F] [SPACE] [J] [K] [L]`（兼容易上手的 `[A] [S] [D] [SPACE] [J] [K] [L]` 以及小键盘/数字键 `1~7`）。
   - 下落音符动力学：$Y_{\text{note}} = Y_{\text{judge}} - (t_{\text{note}} - t_{\text{now}}) \times V_{\text{speed}}$。
   - 原版心形糖果音符（16 种原版配色）。
   - 长按音符（Long Note）连带彩虹光轨与尾部释放判定。
   - 原版判定槽底栏（`hitbar0`）与心形爆炸打击粒子动画（`hitani0_0`）。
   - 判定等级：`COOL`（±45ms）、`GOOD`（±90ms）、`BAD`（±140ms）、`MISS`。
   - 原版高光连击数字特效（`combo.ift` 闪亮黄绿艺术字）。

2. **零延迟 WebAudio 实时按键发声（Keysound）与伴奏**：
   - 遵循 CanMusic 的核心精髓——**主客发音解耦**：
     - 玩家负责敲击的音符（`is_user == 1`）从背景音轨中剥离，保持静音；当且仅当玩家敲中时，实时向 WebAudio 软音源触发对应 MIDI 音高与力度的 `NoteOn` 指令；若漏键（MISS），则真实漏音。
     - 背景伴奏（BGM）通过超前调度机制（Lookahead Scheduler）在毫秒级严格对齐播放。
     - 内置 General MIDI 合成引擎（钢琴、电吉他、贝斯、管弦乐、Lead/Pad 以及第 10 通道通用爵士打击乐组），完全纯本地离线运行，无需外置几十兆的声卡波表文件。
     - 原版 WAV 音效还原（点击、加速、减速、击打音效）。

3. **双代际 .VOS 谱面全格式纯前端零依赖解析**：
   - **第 2 代 CanMusic 容器（VOS022 / VOS008 / VOS006 / VOS009）**：解包 `Vosctemp.trk` 与 `VOSCTEMP.mid`，解析 16 字节 Note 与 7 键映射表。
   - **第 1 代 Classic VOS（inf / mid / EOF 段表架构）**：解析 13 字节紧凑型音符与自适应 1023/1024 字节填充。
   - 基于 MIDI 伴奏第 0 音轨中的 `Set Tempo`（`0xFF 0x51 0x03`）元事件构建分段线性时间曲线，将 VOS 内部固定四分音符刻度（PPQ = 768）精准折算为绝对物理秒。
   - 内置 `EUC-KR`（韩文原版）与 `GBK`（中文版）字符集解码器。

4. **原版美术资源 100% 精确原版游戏还原**：
   - 原版游戏解析了 CanMusic 专有的 16 位位图格式 `vimg`（`BG.img`、`play_area.img`）。
   - 原版游戏解析了 RLE 行程透明精灵格式 `vlle`（`can.lle`、`hitbar0.lle`、`note_skin0.lle`、`Longnote.lle`、`hitani.lle`）。
   - 原版游戏解析了字模纹理格式 `vifont`（`combo.ift`、`clock.ift`、`number.ift`）。
   - 复原了原版左侧半透明粉色易拉罐（Can）演奏台与右侧韩瑟软体（HanseulSoft）街机 PDA 监控终端。

5. **丰富的功能与自由曲库**：
   - 内置曲库浏览器：收录了《Canon in d》、《The Least 100sec(Long Ver.)》、《FIRE》、《胡桃夹子》、《巴赫组曲》、《K.O.F 97》等曲目，涵盖 Lv.1 到 Lv.8+。
   - 自由拖放：可将电脑中任意 `.vos` 文件直接拖拽进浏览器窗口，秒级加载演奏。
   - 速度档位调节：使用原版 1～14 档速度与 MUSIC_TIME 时间轴（默认 8 档约 125 px/s，最高 14 档 500 px/s），并以小数像素位置平滑渲染；演奏中 `←` / `↓` 减速、`↑` / `→` 加速，未演奏时上下键用于在歌单中选歌、左右键用于调速。
   - 自动演示模式（Auto-Play）：一键开启/关闭 AI 自动全连演奏，方便练习与纯听歌欣赏。

---

## 🚀 启动与运行方式

先按照 `../backend/README.md` 启动 Rust 服务。然后在项目 `web` 目录下，使用 Bun 或 Node.js 启动前端：

### 使用 Bun（推荐，秒启）：
```bash
# 开发模式（热重载）
bun run dev

# 或构建预览模式
bun run preview
```

### 使用 Node / npm：
```bash
npm run dev
# 或
npm run build && npm run preview
```

启动后在浏览器打开终端提示的地址（例如 `http://localhost:3000` 或 `http://localhost:4173`）即可全屏畅玩！
