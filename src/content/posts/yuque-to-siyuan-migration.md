---
title: 语雀到思源笔记迁移教程：一步步导出、清洗与导入
published: 2026-03-16
description: 面向实操的迁移教程：从语雀导出到思源导入的完整步骤、脚本示例与常见问题排查（公开版已脱敏）。
tags: [知识库, 迁移, Markdown, 思源, 教程]
category: 教程
draft: false
---

> 说明：本文为公开教程版本，已移除真实账号、IP、域名与 Token，并使用占位符。

## 0. 你将完成什么

完成一次可复用的迁移流程：

1. 从语雀分页导出全部文档
2. 清洗内容（文件名、图片链接、Lake/HTML）
3. 分批导入思源
4. 抽样校验与失败补导

> 建议把“导出 + 清洗”放在本地运行，服务器仅用于思源导入，稳定性更好。

## 1. 准备工作

### 1.1 准备凭据（不要写入公开文档）

- 语雀：浏览器登录后的 Cookie + `x-csrf-token`
- 思源：Kernel API Token

### 1.2 准备环境

- Python 3.9+
- 常见依赖：`requests`、`beautifulsoup4`（如需要 HTML 表格清洗）

## 2. 语雀分页导出文档

语雀文档列表接口默认分页，必须手动循环拉取。

```python
import time

def get_docs(book_id):
    all_docs, offset = [], 0
    while True:
        url = f'https://www.yuque.com/api/books/{book_id}/docs?offset={offset}&limit=100'
        data = curl_get(url)  # 你自己的请求封装
        if not data or 'data' not in data or not data['data']:
            break
        all_docs.extend(data['data'])
        if len(data['data']) < 100:
            break
        offset += 100
        time.sleep(0.5)
    return all_docs


def get_doc_content(doc_id, book_id):
    data = curl_get(f'https://www.yuque.com/api/docs/{doc_id}?book_id={book_id}')
    if not data or 'data' not in data:
        return None
    doc = data['data']
    return {
        'title': doc['title'],
        'body': doc.get('content') or doc.get('body_asl') or ''
    }
```

要点：**优先读 `content`，再兜底 `body_asl`**。

## 3. 清洗内容（决定成败）

### 3.1 清洗文件名与图片链接

```python
import re

def clean_filename(name):
    return re.sub(r'[\\/:*?"<>|]', '_', name)


def clean_image_url(content):
    pattern = r'(https://cdn\.nlark\.com/[^)\s]+?\.(?:png|jpg|jpeg|gif|webp))#[^)\s]*'
    return re.sub(pattern, r'\1', content)
```

### 3.2 处理 Lake/HTML 结构

常见症状：

- 导入后出现大量 HTML 标签
- 表格挤成一团
- 列表/段落结构丢失

处理策略（按类型）：

- 普通段落：剥离标签后按段落重组
- 表格文档：解析 HTML 表格，再重建 Markdown 表格
- 混合文档：保留可用 Markdown，对异常片段定向替换

> 核心原则：优先恢复**可读性**，不必执着于 100% 格式还原。

## 4. 分批导入思源

```python
import time
import requests
from pathlib import Path

def import_to_siyuan(book_dir, book_name, siyuan_api, siyuan_token, notebook_id):
    md_files = list(Path(book_dir).glob('*.md'))
    headers = {
        'Authorization': f'Token {siyuan_token}',
        'Content-Type': 'application/json'
    }

    for index, md_file in enumerate(md_files, 1):
        content = md_file.read_text(encoding='utf-8')
        payload = {
            'notebook': notebook_id,
            'path': f'/{book_name}/{md_file.stem}',
            'markdown': content
        }
        requests.post(f'{siyuan_api}/filetree/createDocWithMd', headers=headers, json=payload, timeout=30)

        if index % 5 == 0:
            time.sleep(2)
```

建议节奏：

- 每篇之间停一下
- 每 5 篇停 2 秒
- 大规模迁移时，分批导入更稳

## 5. 抽样校验与补导

建议抽样检查：

- 文档总数是否一致
- 表格是否可读
- 图片是否正常显示

失败文档单独记录，手工补导即可。

## 6. 常见问题排查

### 6.1 只拿到前 20 篇文档

- 原因：接口默认分页
- 解决：显式处理 `offset` 和 `limit`

### 6.2 导入后“乱码”

- 原因：Lake/HTML 没清洗
- 解决：按类型转换为可读 Markdown/纯文本

### 6.3 图片显示异常

- 原因：图片 URL 带锚点
- 解决：清洗 `#` 后面的片段

### 6.4 资源不足导致卡死

- 解决：降低导入频率，把导出/清洗放本地

## 7. 推荐执行清单

1. 备份语雀与思源数据
2. 本地导出语雀文档列表与正文
3. 清洗文件名、图片链接、Lake/HTML
4. 分批导入思源
5. 抽样校验与失败补导

## 8. 结语

迁移的关键不在“导入工具”，而在**内容清洗与节奏控制**。按照“导出 → 清洗 → 导入 → 校验”的流程执行，稳定性会大幅提升。
