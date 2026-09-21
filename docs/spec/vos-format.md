# CanMusic / VOS 谱面与二进制容器文件格式完整规范 (VOS Format Specification)

> **版本**：1.1.0 (Comprehensive Release)  
> **制定日期**：2026-09-09  
> **验证基准**：基于 8,542 首真实 `.vos` 官方曲库、Linux PMG 逆向工程源码、官方 `CanMusic.dll` 动态库反汇编深度分析、以及全量自动化验证脚本。  
> **校验结果**：在全量 8,542 首曲库中，除官方收录的 3 首已损坏文件（2 首 0 字节空文件、1 首 64KB 截断文件）外，其余 **8,539 首实现 100.00% 零误差解析**（所有数据块和音符阵列剩余未解析字节数恒为 0）。

---

## 一、格式全景与代际演进

`.vos`（Virtual Orchestra System，虚拟管弦乐团系统）格式由韩国 HanseulSoft（한슬소프트）于 1999–2000 年首创，后在网络版《CanMusic》（2002–2003，Hangame / Music & Play）和《New CanMusic》（2004–2005，Sunny YNK / Lemonball）中持续演进。

在底层二进制存储上，`.vos` 文件分为两大截然不同的技术代际：

```
                               .vos 文件 (以首个 uint32LE 区分)
                                        │
             ┌──────────────────────────┴──────────────────────────┐
             ▼                                                     ▼
      第 1 代: Classic VOS                                   第 2 代: CanMusic 容器
    (首 uint32 = 0x00000003)                               (首 uint32 = 子文件数量, 常为 2 或 3)
             │                                                     │
    段表索引结构 (Segment Table)                            多文件流式容器 (Mini File Archive)
    - "inf" 段: 谱面信息与 13 字节音符阵列                   - "Vosctemp.trk": 16 字节谱面主数据
    - "mid" 段: 标准 SMF MIDI 伴奏                          - "VOSCTEMP.mid": 标准 SMF MIDI 伴奏
    - "EOF" 段: 结束标记与文件总大小                         - "VOSCTEMP.BMP": 选配封面/背景 (部分曲目)
```

### 全库分布统计 (8,542 首文件全量实测)

| 格式分类 | 特征魔数 / 标识 | 文件数 | 占比 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| **CanMusic Container (`VOS022`)** | `uint32 count`, `Vosctemp.trk` 含 `VOS022` | 6,914 | 80.94% | **100% 零误差解析** |
| **CanMusic Container (`VOS008`)** | `uint32 count`, `Vosctemp.trk` 含 `VOS008` | 15 | 0.18% | **100% 零误差解析** |
| **CanMusic Container (`VOS006`)** | `uint32 count`, `Vosctemp.trk` 含 `VOS006` | 10 | 0.12% | **100% 零误差解析** |
| **CanMusic Container (`VOS009`)** | `uint32 count`, `Vosctemp.trk` 含 `VOS009` | 1 | 0.01% | **100% 零误差解析** (`3700.vos`) |
| **Classic VOS (`VOS1` / `inf`)** | 首 `uint32 == 3`，含 `inf`/`mid`/`EOF` 段表 | 1,599 | 18.72% | **100% 零误差解析** |
| **官方损坏文件** | 空文件或 64KB 截断 | 3 | 0.03% | 已查明（3235、4218为空，4198截断） |
| **总计** | | **8,542** | **100.0%** | **有效曲目 100.00% 覆盖** |

---

## 二、通用数据类型与字节序规则

所有多字节整型均采用 **小端序 (Little-Endian)** 存储。

1. **基本数据类型**：
   - `uint8`：1 字节无符号整数。
   - `uint16`：2 字节无符号整数（Little-Endian）。
   - `uint32`：4 字节无符号整数（Little-Endian）。
2. **变长字符串编码**：
   - **`String8`（短字符串）**：用于 Classic VOS，结构为 `[len: uint8] + [val: char[len]]`。
   - **`String16`（标准字符串）**：用于 CanMusic Container 的 `.trk` 谱面，结构为 `[len: uint16] + [val: char[len]]`。
   - **字符集**：曲名、作者名等字符串历史编码为韩文 `EUC-KR`（或 `CP949`），部分中文魔改曲目采用 `GB2312`/`GBK`。解码时优先尝试 `EUC-KR`，失败自动降级到 `GBK` 或 `latin1`。

---

## 三、第 2 代：CanMusic / NewCanMusic 容器与全部内部文件规范（81.25% 曲目）

第 2 代 `.vos`（在早期官方也称 `.can` 格式）本质上是一个**多文件打包二进制归档容器 (Mini Archive Container)**。

### 3.1 容器外层封装结构

文件开头首个 `uint32` 记录容器内打包的**子文件条目总数 (`subfile_count`)**：
- **2 个子文件（占 6,940 首）**：`Vosctemp.trk` 与 `VOSCTEMP.mid`。
- **3 个子文件（占 1 首，`3495.vos`）**：`Vosctemp.trk`、`VOSCTEMP.mid` 以及封面背景图 `VOSCTEMP.BMP`。

紧接着顺序排布每一个子文件条目，各条目紧密相连无额外填充对齐：

```
┌─────────────────────────────────────────────────────────────┐
│ subfile_count : uint32 (通常为 2 或 3)                       │
├─────────────────────────────────────────────────────────────┤
│ ┌── 子文件条目 1 (Vosctemp.trk) ───────────────────────────┐ │
│ │ name_len  : uint32                                       │ │
│ │ name      : char[name_len] (ASCII，固定为 "Vosctemp.trk") │ │
│ │ data_len  : uint32                                       │ │
│ │ data      : uint8[data_len] (谱面核心数据流)             │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌── 子文件条目 2 (VOSCTEMP.mid) ───────────────────────────┐ │
│ │ name_len  : uint32                                       │ │
│ │ name      : char[name_len] (ASCII，固定为 "VOSCTEMP.mid") │ │
│ │ data_len  : uint32                                       │ │
│ │ data      : uint8[data_len] (标准 SMF Type 1 MIDI 数据流) │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌── 子文件条目 3 (VOSCTEMP.BMP，选配，如 3495.vos) ────────┐ │
│ │ name_len  : uint32                                       │ │
│ │ name      : char[name_len] (ASCII，"VOSCTEMP.BMP")       │ │
│ │ data_len  : uint32                                       │ │
│ │ data      : uint8[data_len] (标准 Windows BMP 图片)       │ │
│ └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

### 3.2 子文件 1：`Vosctemp.trk` 谱面核心二进制结构

`Vosctemp.trk` 存储了游戏全部下落音符、键位映射、演奏力度与难度阶层。

#### 1. 魔数与版本解析机制
前 6 字节固定为 ASCII 魔数：`"VOS022"`, `"VOS008"`, `"VOS006"`, `"VOS009"`。
- **逆向反汇编分析**：在官方 `CanMusic.dll`（地址 `0x10047e7f`）中，程序先校验前 3 字节 `"VOS"`，然后调用标准库 `atol(&magic[3])` 获取整数版本号 `version`。
- 在内部分发跳转表中：
  - `Version 6, 7, 8, 9, 22, 23` 统一走 `0x10047f2a` 处理管道；
  - 针对 `version >= 7`、`version >= 8`、`version == 9`、`version < 22` 设有局部的向下兼容分支。

#### 2. 5 个 `String16` 元数据字符串
魔数之后依次存放 5 个采用 `String16` 格式存储的元数据：
1. `title`：歌曲名称（Song Title）
2. `artist`：原曲作者 / 艺人（Artist）
3. `comment`：谱面备注 / 采谱人留言（Comment）
4. `vos_author`：谱面编配者（VOS Arranger）
5. `genre`：风格类别（Genre，如 Pop, Rock）

#### 3. 时基参数与保留填充区
```c
uint8  header_bytes_7[7];  // 预留，通常全 0
uint32 length_tt;          // Tempo-based 刻度总时长
uint32 length_rt;          // 真实物理毫秒时长基准
uint32 length_extra;       // 辅助时长参数
uint8  header_bytes_3[3];  // 预留
uint32 default_flags;      // 默认控制掩码（为 0 时官方默认设置为 0x00040004）
```
- 若 `version == 9`（例如 `3700.vos`）：额外读取 `v9_extra: uint32`，随后跳过 `1013` 字节保留区。
- 其他版本（`version == 6, 8, 22`）：跳过 `1017` 字节保留区。
- **两者的总填充跨度严格恒为 1024 字节**（7 + 1017 = 1024，或 7 + 4 + 1013 = 1024）。

#### 4. 音轨数与难度阶层声明
```c
uint32 narr;      // 乐器音轨阵列数量 (Number of Note Arrays)
uint32 num_diffs; // 难度模式数量 (通常为 1，个别多难度谱面可扩展)

// 读取 narr 个音轨描述单元
struct {
    uint8  marker;    // 固定为 0x04
    uint32 inst_type; // 对应 MIDI 乐器音色编号
} note_arr_info[narr];

// 读取 num_diffs 个难度等级描述单元
struct {
    uint8    level;     // 难度星级 (0-based，游戏 UI 显示等级为 level + 1)
    uint8    key_mode;  // 键位模式 (7 代表 7 键模式)
    String16 desc;      // 难度文本 (如 "Normal", "Hard")
    uint32   reserved;  // 预留，通常为 0
} diff_info[num_diffs];
```

#### 5. 16 字节 CanMusic Note 音符二进制结构
依次存储 `narr` 个乐器音轨的音符流。每个音轨先读 `nnote: uint32`，随后连续排布 `nnote` 个 16 字节音符：

| 字节偏移 | 字段名 | 类型 | 物理含义与功能说明 |
| :--- | :--- | :--- | :--- |
| `+0x00` | `pad0` | `uint8` | 固定零填充 `0x00` |
| `+0x01` | `time` | `uint32` | 音符触发绝对时钟刻度 (Absolute Tick) |
| `+0x05` | `note_num` | `uint8` | MIDI 键位音高 (Pitch: 0–127) |
| `+0x06` | `track` | `uint8` | MIDI 音轨/通道编号 (0–15)；实时发音状态字为 `0x90 \| track` |
| `+0x07` | `velocity` | `uint8` | MIDI 弹奏起音力度 (Velocity: 0–127) |
| `+0x08` | `is_user` | `uint8` | 交互属性：`1` = 玩家敲击音符，`0` = 伴奏自动回放音符 |
| `+0x09` | `unk1` | `uint8` | 状态保留字（通常为 `1`） |
| `+0x0A` | `is_long` | `uint8` | 音符类型：`1` = 长按音符 (Long Note)，`0` = 短音点按 (Short Note) |
| `+0x0B` | `duration` | `uint32` | 音符持续时长刻度 (Duration Ticks) |
| `+0x0F` | `bgm_flag` | `uint8` | 过滤标记：`is_user=0` 时通常为 `0xFF`，`is_user=1` 时为 `0x00` |

#### 6. VOS008+ 专用扩展时钟段
仅当 `version >= 8` 时存在：
```c
uint32 v8_count;
struct {
    uint32 time; // 时间戳
    uint8  b1;
    uint8  b2;
    uint8  b3;
    uint8  b4;
} v8_events[v8_count];
```

#### 7. 玩家 7 键按键映射表 (User Note Mapping Table)
对应每个难度 `num_diffs`，存储玩家击打音符与前端 7 条下落轨道的绑定表：
```c
uint32 nunote; // 当前难度下玩家敲击音符总数
struct {
    uint8  arr_idx; // 所属音轨数组下标 (0 <= arr_idx < narr)
    uint32 idx;     // 该音轨内的音符下标 (0 <= idx < nnote)
    uint8  key;     // 目标打击轨道编号 (0 <= key < 7，从左到右 7 个键)
} unotes[nunote];
```
> **核心判定断言**：官方驱动和逆向实现中对 `key` 均执行严格断言 `assert(key < 7)`。这直接确立了 CanMusic 的 7 键模型是刻写在乐谱二进制底层的。

#### 8. VOS007+ 附加扩展段
当 `version >= 7` 时存在，对应每个难度：
```c
uint32 v7_count;
struct {
    uint32 u1;
    uint32 u2;
    uint8  u3;
} v7_events[v7_count];
```
> 在商业曲目中，该段 `v7_count` 通常恒为 `0`（占用 4 字节的 `0x00000000`）。

#### 9. 歌词数据流 (Lyrics)
位于文件尾部（若剩余字节 >= 4 则解析）：
```c
uint32 nlyric;
struct {
    uint32   time; // 歌词触发时间戳 (Tempo Tick)
    String16 text; // 歌词字符串内容
} lyrics[nlyric];
```

---

### 3.3 子文件 2：`VOSCTEMP.mid` 伴奏结构

`VOSCTEMP.mid` 是标准的 **SMF (Standard MIDI File) Format 1** 格式文件，包含头块 `MThd` 与多个数据块 `MTrk`：
1. **`MThd` 头块**：
   - 包含文件格式（Format 1）、音轨数量（`ntrack`）和时间细分度（`division / PPQN`）。
2. **`MTrk` 音轨块**：
   - 存储伴奏各通道的 Program Change（乐器切换）、Control Change（混响、音量、声相控制）、SysEx 系统独占信息以及纯伴奏音符（`NoteOn` / `NoteOff`）。
   - 尤为关键的是：MIDI 第 0 轨中记录的 `Set Tempo` 元事件（`0xFF 0x51 0x03`）是全曲音画同步的**权威主时基**。

---

### 3.4 子文件 3：`VOSCTEMP.BMP` 背景封面图像

在极少数精选曲目中打包了该背景图文件（如 `3495.vos`）：
- 为标准的 Windows DIB/BMP 位图格式（以 ASCII `'BM'` 开头）。
- 图像分辨率多为 640×480 或 800×600，24 位真彩色，用于作为单人演奏界面的动态或静态沉浸式背景。

---

## 四、第 1 代：Classic VOS 文件结构规范（18.72% 曲目）

Classic VOS 是 2000 年单机版 VOS 的原始乐谱格式，采用经典的段表偏移架构。

### 4.1 文件头部与段表 (Segment Table)

```c
uint32 num_segs = 3; // 固定恒等于 3
struct {
    uint32 offset;   // 该段在文件内的绝对起始字节偏移
    char   name[16]; // 16 字节定长 ASCII 标识（以 \0 补齐）
} segs[3];
```

在全库 1,599 首曲目中，3 个段名固定为：
1. `name = "inf"`：谱面信息与按键音符数据块。
2. `name = "mid"`：标准 SMF Format 1 MIDI 文件数据块。
3. `name = "EOF"`：结束标记，其 `offset` 精确等于整个 `.vos` 文件的总字节大小。

### 4.2 可选的 "VOS1" 扩展头

在 `inf` 段偏移处，首先检测前 4 字节魔数：
- 若为 ASCII `"VOS1"`：
  - `version`: `uint16`（小端，通常为 1）
  - `dummy64`: `char[64]`（64 字节零填充）
  - `str1`: `String8`（短字符串，副标题或说明）
- 若非 `"VOS1"`：则直接进入基础元数据区。

### 4.3 基础元数据与 1023/1024 字节填充

依次读取 4 个短字符串（`String8`）及乐理字段：

```
title       : String8 (曲名)
artist      : String8 (原作者)
comment     : String8 (注释 / 难度描述)
vos_author  : String8 (采谱者)

song_type   : uint8   (音乐流派枚举)
ext_type    : uint8   (扩展类别)
song_length : uint32  (曲长时间刻度)
level       : uint8   (难度星级，显示为 level + 1)
```

**历史对齐填充规则**：
- 在 1,598 首曲目中，`level` 字段后固定填充 **1023 字节** 零值。
- 在极个别特殊自制谱面（如 `3292.vos`）中，填充为 **1024 字节**。
- **自适应解析法则**：检查 `cur_pos + 1023 + 22` 处是否为 14 个连续 `0x00` 字节；若不是则匹配 `cur_pos + 1024`。

### 4.4 13 字节紧凑型音符结构

在 `inf` 数据块内，循环读取乐器音轨，直到游标触及 `mid_offset`。最后一个音轨通常作为汇总的玩家演奏音轨。

```c
struct ClassicNoteArray {
    uint32      type;       // 乐器类型
    uint32      nnote;      // 音符数量
    char        dummy2[14]; // 14 字节保留对齐（恒全为 0x00）
    ClassicNote notes[nnote];
};
```

每个音符仅占 **13 字节**（相较 CanMusic 的 16 字节更加紧凑）：

| 偏移 | 字段名 | 类型 | 说明与位掩码解码 |
| :--- | :--- | :--- | :--- |
| `+0x00` | `time` | `uint32` | 触发绝对时间刻度 (Tick) |
| `+0x04` | `duration` | `uint32` | 持续时长刻度 (Tick) |
| `+0x08` | `cmd` | `uint8` | MIDI 原始命令/通道或颜色标识 |
| `+0x09` | `note_num` | `uint8` | MIDI 触发音高 (0–127) |
| `+0x0A` | `velocity` | `uint8` | 起音力度 (0–127) |
| `+0x0B` | `flags1` | `uint8` | 关键标志位：<br>• `flags1 & 0x80`：`is_user` 玩家演奏音符<br>• `(flags1 >> 4) & 0x07`：`key` 7 轨道编号 (0–6)<br>• `flags1 & 0x0F`：轨道显示颜色 (Color) |
| `+0x0C` | `flags2` | `uint8` | 扩展标志位：<br>• `flags2 & 0x80`：`is_long` 长音符标记 |

---

## 五、伴奏 MIDI 与音画同步、实时发音解耦机制

### 5.1 时间嘀嗒 (Tick) 归一化与物理绝对秒 (Second) 转换
在 VOS 体系中，谱面内部时基恒定为：
$$\text{Tempo Quarter-Note} = \frac{\text{Tick}}{768.0}$$
即 **每四分音符固定为 768 嘀嗒 (PPQ = 768)**。

在播放时，物理时间不能简单以固定比例乘算，而必须依托伴奏 MIDI 流中的 `Set Tempo` 元事件（`0xFF 0x51 0x03`）建立分段线性映射：
$$rt(tt) = rt_k + qn\_time_k \times (tt - tt_k)$$
（其中 $qn\_time_k = \frac{\text{Microseconds Per Quarter Note}}{1,000,000}$，由 MIDI 变速事件动态驱动）。

### 5.2 主客发音解耦（CanMusic 的演奏手感精髓）
1. **背景伴奏（BGM）**：被标记为 `is_user == 0` 的音符，由后端/音频线程（AudioWorklet）按时钟全自动调度合成（如鼓点、贝斯、背景合唱）。
2. **玩家演奏（Keysound）**：凡是 `is_user == 1` 的音符，**必须从背景自动回放队列中剥离、保持静音**。
3. **敲击发声**：玩家按下某轨时，若该轨在 600 tick 判定窗口内有候选音符，则播放该音符本身并结算 COOL/BAD/MISS；若音符尚未到达（如歌曲刚开始或倒计时阶段）、位于 600 tick 窗口外或该轨无音符，则依原版规则以主奏乐器与 7 键大调白键音程偏移（0, 2, 4, 5, 7, 9, 11）立即发声（八分音符时值，力度 100），且不产生判定评级、不影响分数和连击。若玩家漏键（MISS），则谱面音符自然静音。

---

## 六、CanMusic 客户端生态外围文件格式解析

在 `ref/CanMusic` 与原生客户端中，还包含配合 `.vos` 运行的外围资产：

### 6.1 `.can` 格式说明
- `.can` 文件是客户端在 Lemonball 对战大厅中为了防止玩家本地直接修改 MIDI 乐谱而重命名或网络下载保存的谱面文件。
- **其内部数据结构与第 2 代 Container `.vos` 毫无二致**，同样是打包 `Vosctemp.trk` 与 `VOSCTEMP.mid`。

### 6.2 `can*.inf` 曲目索引表
`ref/CanMusic` 中包含 `can1.inf` ~ `can18.inf`，每张表对应官方曲库的一个分类频道：
- 文件大小通常为 142,000 字节，精确划分为 500 行定长记录。
- 每行长度固定为 **284 字节**（282 字节 ASCII 字段 + 2 字节 `\r\n`）：
  - 字节 `0..23`：曲目 ID（纯数字字符串，左对齐）
  - 字节 `24..25`：难度星级（数字字符串）
  - 字节 `26..281`：曲目标题（韩文 EUC-KR 字符串，空格右补齐）

### 6.3 客户端扩展数据文件
- `CanMusic.dat` / `item.dat`：存储游戏内的金币、商城道具效果、房间房间属性的结构体数组。
- `font12.fnt`：原版客户端专用的 12 像素韩文字模点阵库。
- `clock.ift` / `combo.ift` / `number.ift`：原版连击数字与计时器序列帧纹理。

---

## 七、现代技术栈工程落地指南 (Go + Pixi.js)

### 7.1 Go 后端核心模型与解析器设计

```go
package vos

import "time"

// PlayableNote 代表归一化后的按键音符
type PlayableNote struct {
    Lane        uint8   `json:"lane"`         // 0..6 (7个轨道)
    StartSec    float64 `json:"start_sec"`    // 绝对起始秒数
    DurationSec float64 `json:"duration_sec"` // 持续时长秒数
    MidiNote    uint8   `json:"midi_note"`    // 音高 (0-127)
    Velocity    uint8   `json:"velocity"`     // 起音力度 (0-127)
    Track       uint8   `json:"track"`        // 乐器通道
    IsLong      bool    `json:"is_long"`      // 是否长按
}

// ChartSong 统一乐谱输出树（供前端通过 JSON / Protobuf 秒级拉取）
type ChartSong struct {
    Title         string         `json:"title"`
    Artist        string         `json:"artist"`
    Arranger      string         `json:"arranger"`
    Genre         string         `json:"genre"`
    Level         uint8          `json:"level"`
    Duration      time.Duration  `json:"duration"`
    PlayableNotes []PlayableNote `json:"playable_notes"`
    MidiData      []byte         `json:"-"` // 原生 MIDI 伴奏流
}
```

### 7.2 前端 Pixi.js 渲染与判定模型设计

在 Pixi.js (WebGL 2.0) 渲染架构下，强烈建议采用 **扁平连续 TypedArray 存储下落音符属性**，并在渲染帧循环中通过实例化精灵（Instanced Mesh / Container）统一绘制：

```typescript
export interface VisualNote {
  lane: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 7 轨道
  timeSec: number;                 // 绝对触发秒数 (以 AudioContext.currentTime 为时基)
  durationSec: number;             // 长音持续秒数
  isLong: boolean;
  midiNote: number;
  velocity: number;
  channel: number;
  
  // 状态机运行时标记
  judged: boolean;
  hitScore?: 'COOL' | 'GOOD' | 'BAD' | 'MISS';
}
```

**下落动力学线性变换方程**：
设判定线垂直坐标为 $Y_{\text{judge}}$，玩家下落流速倍率为 $V_{\text{speed}}$（像素/秒），则当前帧任意音符在 Pixi 画布上的 Y 坐标为：
$$Y_{\text{note}} = Y_{\text{judge}} - (t_{\text{note}} - \text{audioCtx.currentTime}) \times V_{\text{speed}}$$
当 $isLong == true$ 时，长音主体矩形顶部 Y 坐标为：
$$Y_{\text{tail}} = Y_{\text{judge}} - (t_{\text{note}} + \text{durationSec} - \text{audioCtx.currentTime}) \times V_{\text{speed}}$$

---

## 八、全量 8,542 首文件验证总结

```
[VERIFICATION REPORT SUMMARY]
================================================================
Total Files Scanned      : 8,542
Container VOS Files      : 6,940 (VOS022: 6914, VOS008: 15, VOS006: 10, VOS009: 1)
Classic VOS Files        : 1,599 (全量匹配段表 inf/mid/EOF)
100% Zero-Remainder Pass : 8,539 files
Known Broken Files       : 3 files
   - 3235.vos (0 bytes, 历史遗留空文件)
   - 4218.vos (0 bytes, 历史遗留空文件)
   - 4198.vos (64KB 截断文件，官方分发时受损)
Parser Success Rate      : 100.00% (有效曲目全覆盖)
================================================================
```
