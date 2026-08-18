# Wallpaper Still Studio

一个完全在浏览器本地运行的 Wallpaper Engine 网页壁纸静态导出器。导入网页壁纸项目后，可以调整完整页面构图、人物位置与大小、背景色、支撑杆效果和截帧时机，并导出高分辨率 PNG。

## 在线使用

[打开 GitHub Pages 版本](https://laishengli120.github.io/wallpaper-still-studio/)

所有项目文件只在当前浏览器中解析，不会上传到服务器；音频默认静音。

## 功能

- 读取 Wallpaper Engine 网页项目文件夹或 ZIP
- 保留完整 HTML、CSS、JavaScript、图片和 Canvas 内容
- 6K MacBook、6K 显示器及 4K 输出预设
- 直接拖动人物或图片，并同步精调滑杆
- 调整元素大小、位置、旋转、透明度、层级和翻转
- 自定义背景颜色，隐藏网页控制区域
- 莉可丽丝双人构图与静态支撑杆适配
- 支撑杆弯曲和粗细调节
- 动态页面定时截帧并导出静态 PNG
- 设置面板滚动时保持预览可见

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

打开终端显示的本地地址即可使用。

## 检查与构建

```bash
npm test
npm run build
```

推送到 `main` 分支后，GitHub Actions 会自动构建并更新 GitHub Pages。
