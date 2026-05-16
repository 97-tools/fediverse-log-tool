let rawItems = [];
let currentPosts = [];
let currentHtml = '';
let currentText = '';

const $ = (id) => document.getElementById(id);

$('jsonFile').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    loadJsonText(text);
  } catch (error) {
    setStatus('loadStatus', 'ファイルを読み込めませんでした。');
  }
});

$('loadPaste').addEventListener('click', () => loadJsonText($('jsonPaste').value));
$('renderBtn').addEventListener('click', renderAll);
$('downloadHtml').addEventListener('click', () => downloadFile('fediverse-log.html', currentHtml, 'text/html'));
$('downloadTxt').addEventListener('click', () => downloadFile('fediverse-log.txt', currentText, 'text/plain'));
$('copyHtml').addEventListener('click', () => copyText(currentHtml, 'HTMLをコピーしました。'));
$('copyFusetter').addEventListener('click', () => copyText(currentText, 'ふせったー用テキストをコピーしました。'));

function loadJsonText(text) {
  try {
    const json = JSON.parse(text);
    rawItems = extractItems(json);
    if (!rawItems.length) {
      setStatus('loadStatus', '投稿が見つかりませんでした。Mastodon系outbox.json、またはMisskey系notes.jsonか確認してください。');
      return;
    }
    setStatus('loadStatus', `${rawItems.length}件の候補を読み込みました。`);
  } catch (error) {
    setStatus('loadStatus', 'JSONの形式が不正です。');
  }
}

function extractItems(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.orderedItems)) return json.orderedItems;
  if (json && Array.isArray(json.items)) return json.items;
  return [];
}

function renderAll() {
  if (!rawItems.length) {
    setStatus('resultStatus', '先にJSONを読み込んでください。');
    return;
  }
  const options = getOptions();
  currentPosts = rawItems
    .map((item) => normalizePost(item, options.showBoosts))
    .filter(Boolean)
    .filter((post) => matchPost(post, options))
    .slice(0, options.limit);

  currentHtml = buildStandaloneHtml(currentPosts, options);
  currentText = buildFusetterText(currentPosts);
  $('preview').innerHTML = buildLogHtml(currentPosts, options);
  $('outputText').value = currentHtml;
  setStatus('resultStatus', `${currentPosts.length}件を出力しました。`);
}

function getOptions() {
  return {
    includeWords: splitWords($('includeWords').value),
    excludeWords: splitWords($('excludeWords').value),
    excludeIds: splitWords($('excludeIds').value),
    limit: Math.max(1, Number($('limitCount').value || 300)),
    cwMode: document.querySelector('input[name="cwMode"]:checked').value,
    showLinks: $('showLinks').checked,
    showMedia: $('showMedia').checked,
    showTags: $('showTags').checked,
    showBoosts: $('showBoosts').checked
  };
}

function splitWords(value) {
  return String(value || '')
    .replaceAll('、', ',')
    .split(',')
    .map((word) => word.trim())
    .filter(Boolean);
}

function normalizePost(item, showBoosts) {
  return normalizeActivityPubPost(item, showBoosts) || normalizeMisskeyPost(item, showBoosts);
}

function normalizeActivityPubPost(item, showBoosts) {
  if (!item || typeof item !== 'object') return null;
  const activityType = String(item.type || '');
  if (activityType === 'Announce' && !showBoosts) return null;
  if (activityType !== 'Create' && activityType !== 'Announce') return null;

  const object = item.object && typeof item.object === 'object' ? item.object : null;
  if (!object || String(object.type || '') !== 'Note') return null;

  const rawHtml = String(object.content || '');
  const safeHtml = sanitizeHtml(rawHtml);
  const published = String(object.published || item.published || '');
  const date = formatDate(published);
  const tags = Array.isArray(object.tag)
    ? object.tag.map((tag) => String(tag && tag.name || '').replace(/^#/, '')).filter(Boolean)
    : [];
  const media = Array.isArray(object.attachment)
    ? object.attachment.map(normalizeAttachment).filter(Boolean)
    : [];

  return {
    id: String(object.id || item.id || ''),
    url: pickUrl(object.url),
    cw: String(object.summary || ''),
    contentHtml: safeHtml,
    contentText: htmlToText(safeHtml),
    date,
    tags,
    media,
    visibility: String(object.to || item.to || '')
  };
}

function normalizeMisskeyPost(item, showBoosts) {
  if (!item || typeof item !== 'object') return null;

  const hasMisskeyShape =
    Object.prototype.hasOwnProperty.call(item, 'text') ||
    Object.prototype.hasOwnProperty.call(item, 'cw') ||
    Object.prototype.hasOwnProperty.call(item, 'createdAt') ||
    Object.prototype.hasOwnProperty.call(item, 'renoteId');

  if (!hasMisskeyShape) return null;

  const isRenoteOnly = !item.text && item.renoteId;
  if (isRenoteOnly && !showBoosts) return null;

  const rawText = String(item.text || '');
  const contentHtml = textToHtml(rawText);
  const media = Array.isArray(item.files)
    ? item.files.map(normalizeMisskeyFile).filter(Boolean)
    : [];
  const tags = extractHashTags(rawText);

  return {
    id: String(item.id || ''),
    url: String(item.url || item.uri || ''),
    cw: String(item.cw || ''),
    contentHtml,
    contentText: rawText.trim(),
    date: formatDate(item.createdAt || ''),
    tags,
    media,
    visibility: String(item.visibility || '')
  };
}

function normalizeMisskeyFile(file) {
  if (!file || typeof file !== 'object') return null;
  const url = String(file.url || file.thumbnailUrl || '');
  if (!url) return null;
  return {
    url,
    name: String(file.name || file.type || '画像'),
    sensitive: Boolean(file.isSensitive)
  };
}

function extractHashTags(text) {
  const found = String(text || '').match(/#[^\s#]+/g) || [];
  return [...new Set(found.map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean))];
}

function textToHtml(text) {
  const escaped = escapeHtml(text).trim();
  if (!escaped) return '';
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function normalizeAttachment(att) {
  if (!att || typeof att !== 'object') return null;
  const url = pickUrl(att.url);
  if (!url) return null;
  return { url, name: String(att.name || '画像') };
}

function pickUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') return item;
      if (item && typeof item.href === 'string') return item.href;
    }
  }
  return '';
}

function matchPost(post, options) {
  if (post.id && options.excludeIds.includes(post.id)) return false;
  const target = `${post.cw} ${post.contentText} ${post.tags.join(' ')}`.toLowerCase();
  if (options.includeWords.length && !options.includeWords.some((word) => target.includes(word.toLowerCase()))) return false;
  if (options.excludeWords.some((word) => target.includes(word.toLowerCase()))) return false;
  return true;
}

function buildStandaloneHtml(posts, options) {
  const body = buildLogHtml(posts, options);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fediverseログ</title>
<style>${standaloneCss()}</style>
</head>
<body>
<main class="fedi-wrap">
<h1>Fediverseログ</h1>
${body}
</main>
</body>
</html>`;
}

function buildLogHtml(posts, options) {
  if (!posts.length) return '<p>条件に合う投稿がありません。</p>';
  return posts.map((post) => buildPostHtml(post, options)).join('\n');
}

function buildPostHtml(post, options) {
  const meta = [
    post.date ? `<time>${escapeHtml(post.date)}</time>` : '',
    options.showLinks && post.url ? `<a href="${escapeAttr(post.url)}" target="_blank" rel="noopener noreferrer">元の投稿</a>` : ''
  ].filter(Boolean).join('');

  const media = options.showMedia && post.media.length
    ? `<div class="fedi-media">${post.media.map((m) => `<a href="${escapeAttr(m.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.name)}</a>`).join('')}</div>`
    : '';
  const tags = options.showTags && post.tags.length
    ? `<div class="fedi-tags">${post.tags.map((tag) => `#${escapeHtml(tag)}`).join(' ')}</div>`
    : '';
  const content = `<div class="fedi-content">${post.contentHtml}</div>${media}${tags}`;

  let main = content;
  if (post.cw && options.cwMode === 'fold') {
    main = `<details class="fedi-cw"><summary class="fedi-cw-summary"><span>CW</span> ${escapeHtml(post.cw)}</summary>${content}</details>`;
  } else if (post.cw) {
    main = `<div class="fedi-cw-flat"><span>CW</span> ${escapeHtml(post.cw)}</div>${content}`;
  }

  return `<article class="fedi-item"><div class="fedi-meta">${meta}</div>${main}</article>`;
}

function buildFusetterText(posts) {
  return posts.map((post) => {
    const parts = [];
    if (post.date) parts.push(post.date);
    if (post.cw) parts.push(`CW：${post.cw}`);
    parts.push(post.contentText);
    if (post.tags.length) parts.push(post.tags.map((tag) => `#${tag}`).join(' '));
    if (post.url) parts.push(post.url);
    return parts.filter(Boolean).join('\n');
  }).join('\n\n---\n\n');
}

function sanitizeHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const allowed = new Set(['A', 'BR', 'P', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'CODE', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI']);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const remove = [];
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (!allowed.has(el.tagName)) {
      remove.push(el);
      continue;
    }
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (el.tagName === 'A' && ['href', 'target', 'rel'].includes(name)) return;
      if (name === 'class') return;
      el.removeAttribute(attr.name);
    });
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  }
  remove.forEach((el) => el.replaceWith(document.createTextNode(el.textContent || '')));
  return template.innerHTML;
}

function htmlToText(html) {
  const div = document.createElement('div');
  div.innerHTML = html.replaceAll('<br>', '\n').replaceAll('<br/>', '\n').replaceAll('<br />', '\n');
  return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function standaloneCss() {
  return `body{margin:0;background:#f7f4ef;color:#312d2a;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif;line-height:1.8}.fedi-wrap{width:min(860px,calc(100% - 28px));margin:0 auto;padding:36px 0 60px}.fedi-item{margin:14px 0;padding:16px;border:1px solid rgba(80,66,54,.16);border-radius:18px;background:rgba(255,255,255,.72)}.fedi-meta{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;color:#81766d;font-size:12px}.fedi-meta a{color:inherit}.fedi-cw-summary,.fedi-cw-flat{padding:9px 12px;border-radius:14px;background:rgba(169,135,118,.16);font-weight:700}.fedi-content p{margin:.5em 0}.fedi-tags,.fedi-media{margin-top:10px;color:#81766d;font-size:12px}.fedi-media{display:flex;gap:8px;flex-wrap:wrap}.fedi-media a{color:#a98776}`;
}

function downloadFile(name, content, type) {
  if (!content) {
    setStatus('resultStatus', '先に整形してください。');
    return;
  }
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyText(text, message) {
  if (!text) {
    setStatus('resultStatus', '先に整形してください。');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus('resultStatus', message);
  } catch (error) {
    $('outputText').focus();
    $('outputText').select();
    setStatus('resultStatus', 'コピーできない場合は、下の欄を手動コピーしてください。');
  }
}

function setStatus(id, text) {
  $(id).textContent = text;
}
