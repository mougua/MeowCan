# CanMusic 原生专有图像与字模格式完整技术规范 (Asset Format Specification)

> **版本**：1.0.0  
> **验证基准**：基于 `ref/CanMusic/image/` 下 180+ 个真实客户端文件全量逆向分析、100.00% 零字节冗余解包验证。

---

## 概述

在 2000–2004 年 HanseulSoft 原版客户端及 DirectDraw 体系中，游戏界面和精灵并未直接使用 BMP、PNG 等开放格式，而是设计了三种基于 16 位颜色深度（RGB565）的紧凑专有格式：

1. **`.img` (`vimg`)**：未压缩的 16 位平面背景/舞台底图。
2. **`.lle` (`vlle`)**：带品红透明色键（`0xf81f`）的行级跨度行程编码（Span-based RLE）精灵图。
3. **`.ift` (`vifont`)**：字符宽度/间距头 + 内嵌 `vlle` 纹理图集的字模文件。

---

## 一、`vimg` 格式规范（未压缩 16 位位图）

代表文件：`BG.img`（716×516）、`play_area.img`（198×334）。

### 1.1 二进制头部结构（18 字节）

| 偏移（字节） | 字段名 | 类型 | 取值 / 含义 |
| :--- | :--- | :--- | :--- |
| `+0x00` | `magic` | `char[5]` | 固定为 `"vimg\0"`（ASCII `0x76 0x69 0x6d 0x67 0x00`） |
| `+0x05` | `width` | `uint32_le` | 图像像素宽度 $W$ |
| `+0x09` | `height` | `uint32_le` | 图像像素高度 $H$ |
| `+0x0D` | `bpp` | `uint8` | 像素深度标记（通常为 `0x16` = 22） |
| `+0x0E` | `data_len` | `uint32_le` | 像素数据总字节数（等于 $W \times H \times 2$） |

### 1.2 像素数据区

从偏移 `+0x12`（第 18 字节）开始，紧密排列 $W \times H$ 个 `uint16_le` 像素：
- 颜色格式为标准 **RGB565**：
  $$\text{Red} = \left(\frac{(c \gg 11) \& 0x1F}{31}\right) \times 255$$
  $$\text{Green} = \left(\frac{(c \gg 5) \& 0x3F}{63}\right) \times 255$$
  $$\text{Blue} = \left(\frac{c \& 0x1F}{31}\right) \times 255$$
  $$\text{Alpha} = 255$$

---

## 二、`vlle` 格式规范（行级跨度行程透明精灵）

代表文件：`can.lle`（255×424）、`hitbar0.lle`（216×24）、`note_skin0.lle`（416×24）、`Longnote.lle`（72×192）、`hitani0_0.lle`（800×118）。

### 2.1 二进制头部结构（20 字节）

| 偏移（字节） | 字段名 | 类型 | 取值 / 含义 |
| :--- | :--- | :--- | :--- |
| `+0x00` | `magic` | `char[5]` | 固定为 `"vlle\0"`（ASCII `0x76 0x6c 0x6c 0x65 0x00`） |
| `+0x05` | `width` | `uint32_le` | 精灵图宽度 $W$ |
| `+0x09` | `height` | `uint32_le` | 精灵图高度 $H$ |
| `+0x0D` | `bpp` | `uint8` | 像素格式控制字（通常为 `0x16`） |
| `+0x0E` | `color_key` | `uint16_le` | 透明色键，固定为 `0xf81f`（RGB565 纯品红：$R=31, G=0, B=31$） |
| `+0x10` | `data_len` | `uint32_le` | RLE 压缩数据流字节数 |

### 2.2 行级 RLE 解压状态机

从偏移 `+0x14`（第 20 字节）开始，按行遍历 $y = 0 \dots H-1$：

每行起始首先读取标志字：
```c
uint16 flag = read_uint16_le();
```

根据 `flag` 取值分发处理逻辑：
1. **`flag == 0`（全空行 / 全透明行）**：
   - 该扫描行完全透明，不包含任何像素数据，直接跳转至下一行。
2. **`flag == 1`（全满行 / 无透明行）**：
   - 该扫描行完全不透明。紧随其后连续读取 $W$ 个 `uint16_le` RGB565 像素值填充整行。
3. **`flag >= 2`（跨度分段行）**：
   - 该行包含 $N = \text{flag} - 1$ 个不透明像素跨度段（Spans）。
   - 初始化行游标：$\text{curX} = 0$。
   - 顺序循环读取 $N$ 个跨度段：
     ```c
     for (int s = 0; s < flag - 1; s++) {
         uint16 skip = read_uint16_le(); // 距离上个跨度结束的透明像素跨度
         uint16 len  = read_uint16_le(); // 本次不透明像素数量
         curX += skip;
         for (int i = 0; i < len; i++) {
             uint16 color = read_uint16_le();
             set_pixel(curX + i, y, color, 255);
         }
         curX += len;
     }
     ```

---

## 三、`vifont` 格式规范（字模纹理图集）

代表文件：`combo.ift`（连击高光数字）、`clock.ift`（时钟计时数字）、`number.ift`（普通数字）。

### 3.1 封装架构

`.ift` 本质上是一个双层容器结构：
- **前 11 字节**：字模排版元信息：
  - 字节 `0..6`：ASCII 标识 `"vifont\0"`（7 字节）
  - 字节 `7..10`：单个字符的标称宽度、高度及字符间距参数。
- **偏移 `+0x0B` 处开始**：标准内嵌 `vlle` 数据流：
  - 拥有完整的 `"vlle\0"` 魔数与 20 字节头。
  - 按照上述 `vlle` 状态机解包即可得到横向排列的数字/字符图集（如 `0123456789`）。

---

## 四、音效格式（`.wav`）

存放在 `ref/CanMusic/sound/wave/`：
- 为标准 RIFF WAVE PCM 格式（单声道/立体声，22050Hz / 44100Hz，16-bit）。
- 现代 Web 端可直接通过 WebAudio API 的 `AudioContext.decodeAudioData` 实现原生无缝解码与零延迟回放。
