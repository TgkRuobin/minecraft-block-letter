# 字格：字符投影导出器

这是一个本地运行的字符投影生成工具。网页继续负责字体上传、字形调整和 128 × 128 预览；由 `uv` 管理的 Python 服务使用 `litemapy`，把每个字符转换为一份单层 `.litematic` 投影，最后以 TAR 一次性下载。

字体文件、字符表和生成图片只会在本机浏览器与本机服务之间传递，不会发送到外部服务器。

实现所依据的上游资料：[Litemapy 官方文档](https://litemapy.readthedocs.io/en/latest/)与 [Litemapy PyPI 页面](https://pypi.org/project/litemapy/)。

## 投影转换规则

- 浏览器先按当前设置生成严格为 128 × 128 的白底黑字 PNG 画布。
- 服务将 PNG 与白色背景合成，再转换为 8 位灰度图。
- 灰度值小于或等于 `123` 的像素设置为 `minecraft:blackstone`（黑石）。
- 灰度值大于 `123` 的像素保持为 `minecraft:air`（空气）。
- 每份投影只有一层，区域尺寸为 `128 × 1 × 128`。
- 图片列映射到 `x=0..127`，图片行映射到 `z=0..127`，所有方块固定在 `y=0`。
- 图片左上角对应 `(x=0, y=0, z=0)`；向右增加 `x`，向下增加 `z`。
- 服务以相邻两张二值图片的不同像素数作为建造成本，并为投影安排低成本顺序。
- 13 份以内使用 Held-Karp 动态规划求全局最优顺序；更多文件使用多片段贪心、多起点最近邻和 2-opt 优化，在可控时间内得到高质量顺序。
- 每个字符生成一个 `.litematic` 文件，按建造顺序装入 TAR；文件名格式为 `{序号}是{原文件名}`，例如 `1是大写字母A.litematic`。

英文大小写使用明确的中文前缀，以兼容 Windows 大小写不敏感的文件系统：

- `A` → `大写字母A.litematic`
- `a` → `小写字母a.litematic`

常见标点继续使用汉字释义，例如 `感叹号.litematic`、`斜杠.litematic`、`左圆括号.litematic`；数字、汉字等使用字符自身命名。

## 项目结构

```text
.
├── all.txt             # 默认字符表
├── index.html          # 页面结构
├── styles.css          # 页面样式
├── app.js              # Canvas 渲染与投影导出请求
├── core.js             # 字符解析和安全文件名
├── pyproject.toml      # uv 项目与 Python 依赖
├── .python-version     # 默认 Python 3.12
└── server/
    └── app.py          # FastAPI + Pillow + litemapy 转换服务
```

## 首次安装与启动

要求：

- 已安装 `uv`
- 可使用 Python 3.11 或更高版本；项目默认选择 Python 3.12
- 使用支持 JavaScript 模块、Canvas 和 FontFace API 的现代浏览器

在项目根目录执行：

```bash
uv sync
```

然后启动本地服务：

```bash
uv run uvicorn server.app:app --host 127.0.0.1 --port 8000
```

也可以使用项目保留的快捷命令：

```bash
npm run dev
```

浏览器访问：

```text
http://127.0.0.1:8000
```

现在必须通过这个 `uv` 服务打开网页，不再使用 `python -m http.server`，因为投影转换需要调用本机 `/api/export-litematics` 接口。

## 使用方式

1. 页面自动读取根目录的 `all.txt`；也可以在“源文件”区域选择其他 UTF-8 文本文件。
2. 上传 TTF 或 OTF 字体。
3. 调整字号、字重、加粗描边、斜体、横纵比例与位置。
4. 在 128 × 128 预览格中确认字形的位置与粗细。
5. 点击“导出全部投影”。
6. 浏览器先生成临时 PNG，随后本机服务计算低成本建造顺序并转换为 `.litematic`，最终下载 `字符投影_日期_时间.tar`。

换行和制表符作为排版分隔符忽略，普通空格会作为字符生成一份全空气投影。重复字符只生成一次。

## 由你执行的验证步骤

以下步骤没有在交付过程中运行，需要你在目标环境中执行。

### 1. 安装依赖

```bash
uv sync
```

预期：生成或更新 `uv.lock`，并安装 `fastapi`、`litemapy==0.11.0b0`、`pillow`、`python-multipart` 和 `uvicorn`。

### 2. 启动服务

```bash
uv run uvicorn server.app:app --host 127.0.0.1 --port 8000
```

预期：终端显示 Uvicorn 正在监听 `http://127.0.0.1:8000`。

### 3. 检查服务规则

另开终端执行：

```bash
curl http://127.0.0.1:8000/api/health
```

预期响应包含：

```json
{
  "status": "ok",
  "canvas_size": 128,
  "layers": 1,
  "y": 0,
  "threshold": 123,
  "block": "minecraft:blackstone"
}
```

### 4. 检查网页与字符命名

1. 打开 `http://127.0.0.1:8000`。
2. 确认 `all.txt` 能自动读取。
3. 确认预览格仍为 128 × 128。
4. 将鼠标悬停在 `A` 与 `a` 上，确认文件名分别为 `大写字母A.litematic` 和 `小写字母a.litematic`。
5. 检查标点名称，例如 `/` 应显示为 `斜杠.litematic`。

### 5. 导出 TAR

1. 上传一份可用的 TTF/OTF 字体。
2. 调整样式并点击“导出全部投影”。
3. 等待页面经历“生成画布”“本地服务正在排序并转换投影”“正在下载投影 TAR”三个阶段。
4. 确认浏览器下载了 `字符投影_日期_时间.tar`。

可用以下命令查看内容：

```bash
tar -tf 字符投影_YYYYMMDD_HHMMSS.tar
```

Windows 也可以使用 7-Zip 打开 TAR。确认压缩包中只有 `.litematic` 文件，文件按 `1是原文件名.litematic`、`2是原文件名.litematic` 的格式编号，并且不存在大小写文件名冲突。

### 6. 在 Litematica 中检查投影

1. 从 TAR 中解压任意一份 `.litematic`。
2. 将其放入 Minecraft/Litematica 的 schematics 目录并载入。
3. 检查投影区域尺寸为 `128 × 1 × 128`。
4. 检查所有非空气方块均为黑石 `minecraft:blackstone`。
5. 检查投影只有 `y=0` 一层，没有第二层方块。
6. 对照网页预览确认方向：网页顶部应对应投影的 `z=0` 一侧，网页左侧对应 `x=0` 一侧。

### 7. 检查阈值边缘

选择带抗锯齿边缘的字形导出。服务会把灰度 `≤123` 的像素变为黑石，把灰度 `>123` 的像素留为空气。若边缘厚度不符合预期，应调整网页中的字号、字重或“加粗描边”，阈值本身按需求固定为 `123`。

## 接口限制

- 接口：`POST /api/export-litematics`
- Multipart 字段名：`files`
- 每个文件必须是 128 × 128 PNG
- 单个临时 PNG 最大 2 MiB
- 单次最多 512 个字符
- 单次上传总量最大 64 MiB
- 任意一个文件转换失败时，整批请求返回错误，不生成不完整 TAR

## 可选的前端规则检查

字符解析与命名规则仍保留了 Node 测试。如需检查：

```bash
npm test
```

这只检查字符拆分与文件名规则，不替代 `.litematic` 的游戏内验证。
