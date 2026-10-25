// The episode as a picture book: turn the pages, the voice reads each page sentence by sentence, the picture moves
// with the sentence being read, and a puzzle stops the reading until the child has solved it.
// Recordings come from tools/make_poem_sounds.py (same voice as 诗词世界): audio/voice.js says which text plays which file.
//
// Everything it needs is in the page itself (the published pages have no drawing code):
//   .pg                    a page; .beat[data-b][data-say] its sentences, .beat.after the ones read after the puzzle
//   [data-at=k]            a piece of the picture that moves (gets .go) when beat k is read; story.css says how
//   .puzzle[data-type]     find | fill | choose | path | color, with the picture's [data-find] [data-decoy] [data-slot]
//                          [data-choice] [data-stone] [data-seg] [data-walker] [data-paint]; .ask = a question with .chip answers

const AUDIO_DIR = 'audio/';
let zhVoice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  zhVoice = vs.find((v) => v.lang === 'zh-CN') || vs.find((v) => v.lang.startsWith('zh')) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
const files = () => (typeof VOICE_FILES !== 'undefined' ? VOICE_FILES : {});

// one thing plays at a time; stop() cancels everything that is waiting
let playId = 0, nowAudio = null, nowEl = null, audioEl = null;
function stop() {
  playId++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (nowAudio) nowAudio.pause();
  if (nowEl) nowEl.classList.remove('is-playing');
  document.querySelectorAll('.beat.on').forEach((e) => e.classList.remove('on'));
  nowAudio = nowEl = null;
}
// play a recorded text; resolves true when it ends, false if this play was cancelled
function say(text) {
  const id = playId;
  return new Promise((done) => {
    if (id !== playId || !text) return done(id === playId);
    const file = files()[text];
    if (file) {
      // one element for everything: once a tap has played it, Safari lets it play on its own afterwards
      const a = audioEl || (audioEl = new Audio());
      a.src = AUDIO_DIR + file;
      nowAudio = a;
      a.onended = a.onerror = () => done(id === playId);
      // playing refused (the browser wants a tap first): show the sound button, and still wait about as long as
      // the sentence, so the picture keeps the pace of the story
      a.play().then(() => document.body.classList.remove('muted'))
        .catch(() => { document.body.classList.add('muted'); setTimeout(() => done(id === playId), 250 * text.length); });
    } else {   // not recorded yet: the device's Chinese voice
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN'; u.rate = 0.9;
      if (zhVoice) u.voice = zhVoice;
      u.onend = u.onerror = () => done(id === playId);
      speechSynthesis.speak(u);
    }
  });
}
const pause = (ms) => { const id = playId; return new Promise((r) => setTimeout(() => r(id === playId), ms)); };
const hidden = (pg, sel) => pg.querySelector(sel);

// ---------------- the picture ----------------
function resetScene(pg) {
  const sc = pg.querySelector('svg.scene');
  if (!sc) return;
  sc.classList.add('quick');
  sc.querySelectorAll('[data-at]').forEach((e) => e.classList.remove('go', 'q'));
  sc.getBoundingClientRect();
  sc.classList.remove('quick');
}
// beat b: its pieces move; pieces of earlier beats that have not moved yet are put in place at once
function applyBeat(pg, b) {
  pg.querySelectorAll('svg.scene [data-at]').forEach((e) => {
    const k = +e.dataset.at;
    if (k === b) { e.classList.remove('q', 'go'); e.getBoundingClientRect(); e.classList.add('go'); }
    else if (k < b && !e.classList.contains('go')) e.classList.add('go', 'q');
  });
}

// ---------------- reading ----------------
const beats = (pg) => [...pg.querySelectorAll('.beat')];
async function readBeat(pg, el) {
  beats(pg).forEach((x) => x.classList.toggle('on', x === el));
  applyBeat(pg, +el.dataset.b);
  const ok = await say(el.dataset.say);
  el.classList.remove('on');
  return ok;
}
async function narrate(pg, from = 0) {
  stop();
  const id = playId;
  const btn = pg.querySelector('.again');
  if (btn) { nowEl = btn; btn.classList.add('is-playing'); }
  // no waiting before the first sentence: it must start inside the tap that turned the page, or Safari blocks the sound
  if (from === 0) resetScene(pg);
  for (const el of beats(pg).slice(from)) {
    if (el.classList.contains('after') && !pg.classList.contains('solved')) {
      if (btn) btn.classList.remove('is-playing');
      nowEl = null;
      return startPuzzle(pg);
    }
    if (!(await readBeat(pg, el)) || !(await pause(350))) return;
  }
  if (id === playId) { stop(); finished(pg); }
}
function finished(pg) {
  pg.dataset.read = '1';
  document.querySelector('.pager .next').classList.toggle('ready', pg === pages[cur] && cur < pages.length - 1);
}

// ---------------- puzzles ----------------
const P = (pg) => pg.querySelector('.puzzle');
async function speakThen(text, fn) { stop(); if (await say(text)) fn && fn(); }

function startPuzzle(pg) {
  const pz = P(pg);
  pg.classList.add('asking');
  pg.querySelector('.text').scrollTo({ top: 9999, behavior: 'smooth' });
  const type = pz.dataset.type;
  if (pz.dataset.started) return;
  pz.dataset.started = '1';
  if (type === 'find') {   // show how: the first apple gets its ring
    const first = pg.querySelector('[data-find]');
    stop();
    say(pz.dataset.demo);
    setTimeout(() => first.classList.add('found'), 1200);
  }
  if (type === 'path') {   // show how: the first step onto stone 1
    stop();
    say(pz.dataset.first);
    setTimeout(() => stepTo(pg, 1), 900);
  }
}

function openAsk(pg) {
  const a = P(pg).querySelector('.ask:not(.ok)');
  if (!a) return solved(pg);
  a.classList.add('on');
  speakThen(a.dataset.say);
}
function solved(pg) {
  if (pg.classList.contains('solved')) return;
  pg.classList.add('solved');
  const from = beats(pg).findIndex((b) => b.classList.contains('after'));
  if (from >= 0) narrate(pg, from); else finished(pg);
}

function onChip(pg, chip) {
  const ask = chip.closest('.ask');
  if (!ask.classList.contains('on')) return;   // already answered
  if ('ok' in chip.dataset) {
    chip.classList.add('right'); ask.classList.add('ok'); ask.classList.remove('on');
    speakThen(hidden(pg, '[data-say="对啦！"]').dataset.say, () => openAsk(pg));
  } else {
    chip.classList.remove('no'); chip.getBoundingClientRect(); chip.classList.add('no');
    speakThen(hidden(pg, '[data-say="再数一数。"]').dataset.say);
  }
}

function onFind(pg, t) {
  const pz = P(pg);
  if ('decoy' in t.dataset) { t.classList.remove('no'); t.getBoundingClientRect(); t.classList.add('no'); return speakThen(pz.dataset.decoySay); }
  if (t.classList.contains('found')) return;
  t.classList.add('found');
  if (!pg.querySelector('[data-find]:not(.found)')) speakThen(pz.dataset.done, () => openAsk(pg));
}

function onFill(pg, add) {
  const pz = P(pg), slots = [...pg.querySelectorAll('[data-slot]')];
  const filled = slots.filter((s) => s.classList.contains('filled'));
  if (add) { const s = slots.find((x) => !x.classList.contains('filled')); if (s) s.classList.add('filled'); }
  else if (filled.length) filled[filled.length - 1].classList.remove('filled');
  const n = +pz.dataset.have + slots.filter((s) => s.classList.contains('filled')).length, need = +pz.dataset.need;
  pz.querySelector('.total b').textContent = n;
  if (n === need) speakThen(pz.dataset.enough, () => { if (!pz.querySelector('.ask.on, .ask.ok')) openAsk(pg); });
  else if (n > need) speakThen(pz.dataset.more);
  else { stop(); say(`现在有 ${n} 个。`); }
}

function onChoice(pg, t) {
  pg.querySelectorAll('[data-choice]').forEach((c) => c.classList.toggle('found', c === t));
  speakThen(t.dataset.say, () => { if (!pg.classList.contains('solved')) solved(pg); });
}

function stepTo(pg, n) {
  const st = pg.querySelector(`[data-stone="${n}"]`), w = pg.querySelector('[data-walker]');
  const dx = +st.dataset.x - +w.dataset.x, dy = +st.dataset.y - +w.dataset.y, s = +(st.dataset.s || 1);
  w.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
  const hop = w.querySelector('.hopper');
  hop.classList.remove('hop'); hop.getBoundingClientRect(); hop.classList.add('hop');
  const seg = pg.querySelector(`[data-seg="${n - 1}"]`);
  if (seg) seg.classList.add('on');
  st.classList.add('found');
  w.dataset.at = n;
}
function onStone(pg, t) {
  const pz = P(pg), w = pg.querySelector('[data-walker]'), at = +(w.dataset.at || 0), n = +pz.dataset.n;
  if (at >= n) return;
  if (t.dataset.stone === String(at + 1)) {
    stepTo(pg, at + 1);
    if (at + 1 === n) setTimeout(() => speakThen(pz.dataset.done, () => solved(pg)), 600);
    else stop();
  } else if (!t.classList.contains('found')) {
    t.classList.remove('no'); t.getBoundingClientRect(); t.classList.add('no');
    speakThen(pz.dataset.wrong, () => at && say(`${at} 后面是几？`));
  }
}

let paintColor = null;
function onPaint(pg, t) {
  const pz = P(pg);
  paintColor = paintColor || pz.querySelector('.paint-chip.on').dataset.color;
  t.querySelectorAll('.paint').forEach((e) => e.setAttribute('fill', paintColor));
  if (!pg.classList.contains('solved')) speakThen(pz.dataset.done, () => solved(pg));
}

// ---------------- turning pages ----------------
const pages = [...document.querySelectorAll('.pg')];
let cur = 0;
function show(i) {
  if (i < 0 || i >= pages.length || i === cur) return;
  stop();
  const old = pages[cur];
  old.classList.remove('on');
  old.classList.toggle('left', i > cur);
  pages[i].classList.remove('left');
  pages[i].classList.add('on');
  cur = i;
  document.querySelectorAll('.dot').forEach((d, k) => { d.classList.toggle('on', k === i); if (k === i) d.classList.add('seen'); });
  document.querySelector('.pager .prev').disabled = i === 0;
  document.querySelector('.pager .next').disabled = i === pages.length - 1;
  document.querySelector('.pager .next').classList.remove('ready');
  pages[i].querySelector('.text').scrollTop = 0;
  if (i > 0) narrate(pages[i]);
}

document.addEventListener('click', (e) => {
  const t = e.target, pg = t.closest('.pg');
  const hit = (sel) => t.closest(sel);
  if (hit('.start')) return show(1);
  if (hit('.home')) return show(0);
  if (hit('.pager .next')) return show(cur + 1);
  if (hit('.pager .prev')) return show(cur - 1);
  if (hit('.dot')) return show(+hit('.dot').dataset.go);
  if (!pg) return;
  if (hit('.again')) return nowEl === hit('.again') ? stop() : narrate(pg);
  if (hit('.chip')) return onChip(pg, hit('.chip'));
  if (hit('.add')) return onFill(pg, true);
  if (hit('.hint')) {
    pg.classList.add('hinting'); setTimeout(() => pg.classList.remove('hinting'), 1600);
    return speakThen(hit('.hint').dataset.say);
  }
  if (hit('.paint-chip')) {
    pg.querySelectorAll('.paint-chip').forEach((c) => c.classList.toggle('on', c === hit('.paint-chip')));
    paintColor = hit('.paint-chip').dataset.color;
    return;
  }
  const tap = hit('.tap');
  if (tap && pg.classList.contains('asking') || tap && pg.classList.contains('solved')) {
    if ('find' in tap.dataset || 'decoy' in tap.dataset) return onFind(pg, tap);
    if ('slot' in tap.dataset) return onFill(pg, false);
    if ('choice' in tap.dataset) return onChoice(pg, tap);
    if ('stone' in tap.dataset) return onStone(pg, tap);
    if ('paint' in tap.dataset) return onPaint(pg, tap);
  }
  if (hit('.ask .q')) return speakThen(hit('.ask').dataset.say);
  const beat = hit('.beat');
  if (beat) { stop(); nowEl = beat; readBeat(pg, beat).then((ok) => ok && stop()); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') show(cur + 1);
  if (e.key === 'ArrowLeft') show(cur - 1);
});
let touchX = null, touchY = null;
document.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY;
  if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) show(cur + (dx < 0 ? 1 : -1));
  touchX = null;
}, { passive: true });

// everyone breathes and blinks in their own time
document.querySelectorAll('.rig, .rig-head, .rig-eyes, .didi-eyes').forEach((e) => {
  e.style.animationDelay = `${-(Math.random() * 6).toFixed(2)}s`;
  if (!e.classList.contains('rig')) e.style.animationDuration = `${(4 + Math.random() * 3).toFixed(2)}s`;
});
document.querySelector('.pager .prev').disabled = true;
