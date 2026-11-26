'use strict';
const $ = id => document.getElementById(id);
const root = document.documentElement;

// theme: light default, toggle persists; icon color comes from CSS (currentColor = --ink)
try { if (localStorage.getItem('prawns-theme') === 'dark') root.classList.add('dark'); } catch {}
$('tgl').addEventListener('click', () => {
  root.classList.toggle('dark');
  try { localStorage.setItem('prawns-theme', root.classList.contains('dark') ? 'dark' : 'light'); } catch {}
});

// keep the candidate-box fade in sync with its scroll position
$('rrows').addEventListener('scroll', () => {
  const b = $('rrows');
  b.classList.toggle('more-below', b.scrollTop + b.clientHeight < b.scrollHeight - 2);
}, {passive: true});

// briefly reveal the last typed character in place of its mask dot, then let the
// dot fade back in. the real input stays type=password; only a single freshly
// typed char is shown, never the whole value, and never pasted/autofilled
// (multi-char) insertions. the hint carries an opaque background so it covers
// the dot it stands in for: without it both the char and its dot show at once.
let pwPrev = '';
let hintTimer = 0, hintRaf = 0;
const hint = $('keyhint');
function hideHint(){ clearTimeout(hintTimer); cancelAnimationFrame(hintRaf); hint.style.opacity = 0; }
// the browser's mask dot is not necessarily the font's bullet glyph, so measure
// its true advance from an offscreen password input instead of guessing it.
function dotAdvance(i, cs){
  const m = document.createElement('input');
  m.type = 'password';
  m.tabIndex = -1;
  m.setAttribute('aria-hidden', 'true');
  m.style.cssText = 'position:absolute;left:-9999px;top:-9999px;margin:0;border:0;padding:0;visibility:hidden;'
    + `font:${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily};letter-spacing:${cs.letterSpacing};`;
  document.body.appendChild(m);
  m.value = '0'.repeat(50);
  const a = m.scrollWidth;
  m.value = '0'.repeat(70);
  const b = m.scrollWidth;
  m.remove();
  const w = (b - a) / 20;
  return w > 0 && isFinite(w) ? w : 0;
}
function revealChar(ch, idx){
  const i = $('pw');
  const cs = getComputedStyle(i);
  const cv = revealChar._cv || (revealChar._cv = document.createElement('canvas').getContext('2d'));
  cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const ls = parseFloat(cs.letterSpacing) || 0;
  const cw = cv.measureText('X').width + ls;
  const dw = dotAdvance(i, cs) || cw;
  const padL = parseFloat(cs.paddingLeft) || 0;
  hint.style.font = `${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
  hint.style.letterSpacing = cs.letterSpacing;
  hint.style.width = (dw + 4) + 'px';
  hint.style.paddingLeft = '2px';
  hint.style.top = i.offsetTop + 'px';
  hint.style.height = i.offsetHeight + 'px';
  hint.textContent = ch;
  // the browser scrolls the caret into view only after the input event, so a
  // position read now would use a stale scrollLeft once the value overflows
  // the field; place the hint on the next frame, when scrolling has settled
  cancelAnimationFrame(hintRaf);
  hintRaf = requestAnimationFrame(() => {
    const cellX = i.offsetLeft + padL + idx * dw - i.scrollLeft;
    // cover the dot's whole cell (2px bleed each way for sub-pixel rounding);
    // padding-left puts the char back at the cell's exact start
    hint.style.left = (cellX - 2) + 'px';
    // appear instantly so the covered dot never ghosts through; the CSS
    // transition still applies to the fade back into the dot
    hint.style.transition = 'none';
    hint.style.opacity = 1;
    void hint.offsetHeight;
    hint.style.transition = '';
  });
  clearTimeout(hintTimer);
  hintTimer = setTimeout(hideHint, 650);
}
$('pw').addEventListener('blur', hideHint);

// show/hide password
$('eye').addEventListener('click', () => {
  const i = $('pw');
  const show = i.type === 'password';
  i.type = show ? 'text' : 'password';
  hideHint();
  $('eye').setAttribute('aria-label', show ? 'hide password' : 'show password');
  $('eye').style.color = show ? 'var(--ink)' : '';
  i.focus();
});

async function sha1hex(text){
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function note(msg){
  const n = $('note');
  n.textContent = msg || '';
  n.style.display = msg ? 'block' : 'none';
}

function esc(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let corpus = null;
fetch('/healthz').then(r => r.ok ? r.json() : null).then(h => {
  if (h && h.ready && typeof h.entries === 'number') corpus = h.entries.toLocaleString('en-US');
}).catch(() => {});

let seq = 0;
$('pw').addEventListener('input', () => {
  seq++; // invalidate any in-flight lookup
  $('flow').classList.remove('on');
  $('verdict').textContent = '';
  $('verdict').classList.remove('on');
  note('');
  const i = $('pw');
  const v = i.value, p = pwPrev;
  pwPrev = v;
  if (i.type !== 'password') { hideHint(); return; }
  let pre = 0;
  while (pre < v.length && pre < p.length && v[pre] === p[pre]) pre++;
  let suf = 0;
  while (suf < v.length - pre && suf < p.length - pre && v[v.length - 1 - suf] === p[p.length - 1 - suf]) suf++;
  if (v.length === p.length + 1 && pre + suf === p.length) revealChar(v[pre], pre);
  else hideHint();
});
$('form').addEventListener('submit', async ev => {
  ev.preventDefault();
  hideHint();
  const pw = $('pw').value;
  if (!pw) return;
  const mine = ++seq;
  note('');
  let hash;
  try { hash = await sha1hex(pw); }
  catch { note('hashing is unavailable in this browser'); return; }
  const prefix = hash.slice(0, 4), suffix = hash.slice(4);

  let data;
  try {
    const res = await fetch('/api/range/' + prefix, { headers: { 'Accept': 'application/json' } });
    if (res.status === 503) { note('the corpus is loading · try again in a moment'); return; }
    if (res.status === 429) { note('slow down a little · try again shortly'); return; }
    if (!res.ok) { note('the lookup failed · try again'); return; }
    data = await res.json();
  } catch {
    note('could not reach the server · check your connection');
    return;
  }
  if (mine !== seq) return; // a newer lookup superseded this one

  const suffixes = Array.isArray(data.suffixes) ? data.suffixes : [];
  const found = suffixes.includes(suffix);

  $('dots').textContent = '•'.repeat(pw.length);
  $('hashline').innerHTML = `<span class="box4">${prefix}</span><span style="color:var(--ink2)">${esc(suffix)}</span>`;
  $('chip').textContent = prefix;
  $('w3lbl').textContent = `${suffixes.length} suffixes`;
  $('rhead-l').textContent = `device compares · prefix ${prefix}`;
  $('rhead-r').textContent = found ? '1 match' : '0 matches';
  const rowHtml = s =>
    s === suffix
      ? `<div class="rhit"><span class="mono">${esc(s)}</span><span class="lbl">yours</span></div>`
      : `<div class="rrow"><span class="mono struck">${esc(s)}</span></div>`;
  const hitIdx = suffixes.indexOf(suffix);
  $('rrows').innerHTML = suffixes.map(rowHtml).join('');
  const scope = corpus ? `the RockYou sample (${corpus} passwords checked)` : 'the RockYou sample';
  $('verdict').textContent = found
    ? `This password is in ${scope}. Don't use it anywhere.`
    : `This password is not in ${scope}. That doesn't make it safe; this is one dataset, not every breach.`;
  $('verdict').classList.add('on');
  $('flow').classList.add('on');
  // only after .flow is visible do the box's dimensions exist; pin the match and set the fade now
  const box = $('rrows');
  if (hitIdx >= 0) {
    const hit = box.querySelector('.rhit');
    if (hit) box.scrollTop += hit.getBoundingClientRect().top - box.getBoundingClientRect().top - 6;
  }
  box.classList.toggle('more-below', box.scrollTop + box.clientHeight < box.scrollHeight - 2);
});
