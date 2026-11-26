'use strict';
const $ = id => document.getElementById(id);
const root = document.documentElement;

// theme: light default, toggle persists; icon color comes from CSS (currentColor = --ink)
try { if (localStorage.getItem('prawns-theme') === 'dark') root.classList.add('dark'); } catch {}
$('tgl').addEventListener('click', () => {
  root.classList.toggle('dark');
  try { localStorage.setItem('prawns-theme', root.classList.contains('dark') ? 'dark' : 'light'); } catch {}
});

// show/hide password
$('eye').addEventListener('click', () => {
  const i = $('pw');
  const show = i.type === 'password';
  i.type = show ? 'text' : 'password';
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
});
$('form').addEventListener('submit', async ev => {
  ev.preventDefault();
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
  const CAP = 12;
  const hitIdx = suffixes.indexOf(suffix);
  let shown = suffixes;
  let hidden = 0;
  if (suffixes.length > CAP) {
    shown = suffixes.slice(0, hitIdx >= CAP ? CAP - 1 : CAP);
    if (hitIdx >= CAP) shown.push(suffix);
    hidden = suffixes.length - shown.length;
  }
  $('rrows').innerHTML = shown.map(rowHtml).join('')
    + (hidden ? `<div class="rrow rmore"><button type="button" class="morebtn" id="morebtn">+ ${hidden} more</button></div>` : '');
  if (hidden) $('morebtn').addEventListener('click', () => { $('rrows').innerHTML = suffixes.map(rowHtml).join(''); });
  const scope = corpus ? `the RockYou sample (${corpus} passwords checked)` : 'the RockYou sample';
  $('verdict').textContent = found
    ? `This password is in ${scope}. Don't use it anywhere.`
    : `This password is not in ${scope}. That doesn't make it safe; this is one dataset, not every breach.`;
  $('verdict').classList.add('on');
  $('flow').classList.add('on');
});
