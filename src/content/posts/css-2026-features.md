---
title: CSS 2026：7 个让你删掉一半 JavaScript 的新特性
published: 2026-03-16
description: Anchor Positioning、Masonry Layout、Scroll-Driven Animations、Subgrid、OKLCH、:has()、Container Queries——这些不是提案，是已经可用的能力。
tags: [CSS, 前端]
category: 前端
draft: false
---

> 原文来源：[CSS终于不再是痛点:2026年这7个特性让你删掉一半JavaScript](https://cloud.tencent.com/developer/article/2637613) — 腾讯云开发者社区

## 一、Anchor Positioning：tooltip 噩梦的终结者

让你可以精确地把一个元素"钉"在另一个元素旁边，不需要 JavaScript，不需要绝对定位。

```css
.button {
  anchor-name: --my-trigger;
}

.tooltip {
  position: anchor(--my-trigger);
  inset-area: bottom;
}
```

不需要手动计算 `top`/`left`，不需要引入 Popper.js，更不需要监听 scroll 事件实时调整位置。

- Chrome：已支持
- Firefox / Safari：开发中

## 二、CSS Masonry Layout：瀑布流的救赎

多年的 JavaScript 折腾（Masonry.js、Flexbox hack、Grid trick），就这一行 CSS 搞定：

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  grid-template-rows: masonry;
}
```

以 100 个卡片的页面为例：

| 方案 | 首次渲染 | 滚动性能 | 额外 JS |
|---|---|---|---|
| Masonry.js | ~800ms | 差 | ~30KB |
| CSS Grid hack | ~500ms | 中等 | ~10KB |
| CSS Masonry | ~200ms | 优秀(GPU) | 0KB |

## 三、Scroll-Driven Animations：滚动动画零 JS

以前监听 scroll + requestAnimationFrame + 手动计算进度，现在声明式搞定：

```css
.feature-card {
  animation: fade-in 1s ease both;
  animation-timeline: fade-in-timeline;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(50px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

核心优势：GPU 加速 + 合成器线程执行。即使主线程在处理繁重 JS，滚动动画依然丝滑。

## 四、Subgrid：嵌套布局对齐

子 Grid 继承父 Grid 的列定义，所有卡片的内部元素自然对齐：

```css
.product-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.product-card {
  display: grid;
  grid-template-columns: subgrid;
  grid-template-rows: auto auto auto;
}
```

Chrome / Firefox / Safari 均已支持，现在就可以用。

## 五、现代色彩空间 OKLCH

RGB 色彩空间是为显示器设计的，不是为人眼设计的。用 OKLCH 做 Design Token：

```css
:root {
  --primary-100: oklch(90% 0.15 280);
  --primary-200: oklch(80% 0.15 280);
  --primary-300: oklch(70% 0.15 280);
  --primary-400: oklch(65% 0.15 280);
  --primary-500: oklch(60% 0.15 280);
}
```

亮度线性变化、视觉均匀、不需要 JS 库、渐变无脏色。三大浏览器均已支持。

## 六、`:has()` 伪类：CSS 终于会"向上看"了

以前 CSS 只能向下选择，现在可以根据子元素状态选中父元素：

```css
/* 当 input 无效时，给整个 form-field 加红色边框 */
.form-field:has(input:invalid) {
  border-color: red;
}

/* 当购物车为空时，显示空状态 */
.cart:not(:has(.cart-item)) .empty-state {
  display: block;
}
```

性能测试（10000 个元素）：`:has()` ~2ms，等效 JS ~15ms。三大浏览器均已支持。

## 七、Container Queries：响应式设计范式革命

组件不应该关心屏幕宽度，应该关心容器宽度：

```css
.card-container {
  container-type: inline-size;
}

@container (min-width: 400px) {
  .card { display: flex; }
}
```

每个卡片根据自己的容器独立决策，真正实现"一次编写，到处适用"。三大浏览器均已支持。

## 行动建议

- 新项目：直接用新特性
- 老项目：非关键功能先试水
- 核心功能：保留 fallback 做渐进增强
