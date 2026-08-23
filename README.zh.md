# 画板（Доска）

[English](README.md) · [Русский](README.ru.md) · 中文

本地无限画板。马克笔、便利贴、文字、图片。断网也能用。可选的实时同步是本机（或局域网）上的 websocket，不是云账号。

GitHub 仓库名叫 ReView。界面上的产品名是 **Доска**。

![空画板](docs/screenshots/board.png)

## 功能

- 马克笔、荧光笔、橡皮（整对象或线段局部）
- 矩形、椭圆、箭头、便利贴、文字
- 图片：文件、粘贴、拖放、裁剪
- 撤销 / 重做、图层顺序、锁定、套索、框选
- IndexedDB 持久化（`doska-v1`）
- 可选 Yjs 房间 `doska`，地址 `ws://<host>:1234`
- 界面语言：俄语（默认）、英语、中文
- 面板外观和画纸背景是两套设置

![绘制](docs/screenshots/drawing.png)

## 运行

需要 Node 20+。

```bash
npm install
npm run dev
```

Vite 应用在 [http://localhost:5173](http://localhost:5173)，同步服务在 `ws://localhost:1234`。打开页面，画几笔，刷新后画板还在。

同步是可选的。只跑 websocket 用 `npm run server`。同一台机器上的两个浏览器，或局域网里另一台设备用主机 IP 而不是 `localhost`，会进入房间 `doska`。同步服务没有鉴权。局域网里任何能连上 `:1234` 的人都可以加入该房间。

`localhost` 和 `127.0.0.1` 是不同 origin。IndexedDB 不会跟着你换地址。选定一个用到底。

```bash
npm test
npm run build
```

![设置](docs/screenshots/settings.png)

## 布局

界面以岛屿浮在铺满屏幕的画布上。左上是文件岛（名称、撤销、缩放）。右上是在线状态和设置。底部居中是工具带。当前工具或选中对象需要样式时，样式岛会出现在工具带上方。连接和保存文案在设置面板里。

## 许可

Apache License 2.0。见 [LICENSE](LICENSE)。
