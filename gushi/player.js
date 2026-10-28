// The episode as a picture book: turn the pages, the voice reads each page sentence by sentence, the picture moves
// with the sentence being read, and a puzzle stops the reading until the child has solved it.
// Recordings: audio/voice.js says which text plays which file (VOICE_FILES). A page's sentences may instead be read
// in one continuous take (VOICE_TAKES: "page|sentence" → [file, start, end] seconds), so the voice flows like a told story;
// the sentence being read lights up and moves the picture as the take reaches it.
// The playing itself (one sound at a time, the iPad fixes, takes) is ../shared/audio.js, loaded before this file.
//
// Everything it needs is in the page itself (the published pages have no drawing code):
//   .pg                    a page; .beat[data-b][data-say] its sentences, .beat.after the ones read after the puzzle
//   [data-at=k]            a piece of the picture that moves (gets .go) when beat k is read; story.css says how
//   .puzzle[data-type]     find | fill | seq | sort | choose | path | color | mirror, with the picture's [data-find] [data-decoy] [data-slot]
//                          [data-choice] [data-stone] [data-seg] [data-step] [data-walker] [data-paint] [data-cell] .drag .bin;
//                          .ask = a question with .chip answers

useVoice('zh-CN', 0.9);   // not recorded yet: the device's Chinese voice
const takes = () => (typeof VOICE_TAKES !== 'undefined' ? VOICE_TAKES : {});
const takeOf = (el) => takes()[`${el.closest('.pg').dataset.pg}|${el.dataset.say}`];
onStop.push(() => document.querySelectorAll('.beat.on').forEach((e) => e.classList.remove('on')));

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
// (a series may act on a beat too, fn(pg, b): 故事大王/play.js plays the sound effects of the pieces that move)
/** @type {((pg: Element, b: number) => void)[]} */
const onBeat = [];
function applyBeat(pg, b) {
  pg.querySelectorAll('svg.scene [data-at]').forEach((e) => {
    const k = +e.dataset.at;
    if (k === b) { e.classList.remove('q', 'go'); e.getBoundingClientRect(); e.classList.add('go'); }
    else if (k < b && !e.classList.contains('go')) e.classList.add('go', 'q');
  });
  onBeat.forEach((fn) => fn(pg, b));
}

// ---------------- reading ----------------
const beats = (pg) => [...pg.querySelectorAll('.beat')];
function mark(pg, el) {
  beats(pg).forEach((x) => x.classList.toggle('on', x === el));
  applyBeat(pg, +el.dataset.b);
}
// the breath after a sentence read on its own: longer after a full stop or "……", short after a comma
const breath = (t) => (/……[”"]?$/.test(t) ? 800 : /[。！？][”"]?$/.test(t) ? 550 : /[，、]$/.test(t) ? 120 : 400);
async function readBeat(pg, el) {
  mark(pg, el);
  const tk = takeOf(el);
  const ok = await (tk ? playTake(...tk) : say(el.dataset.say, el.dataset.file));
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
  const list = beats(pg), take = takeOf;
  for (let i = from; i < list.length;) {
    const el = list[i], after = el.classList.contains('after');
    if (after && !pg.classList.contains('solved')) {
      if (btn) btn.classList.remove('is-playing');
      nowEl = null;
      return startPuzzle(pg);
    }
    const tk = take(el);
    if (!tk) {
      if (!(await readBeat(pg, el)) || !(await pause(breath(el.dataset.say)))) return;
      i++;
      continue;
    }
    // the sentences that follow in the same take play on without a break; each lights up when the voice reaches it
    let j = i + 1;
    while (j < list.length && take(list[j]) && take(list[j])[0] === tk[0] && list[j].classList.contains('after') === after) j++;
    const run = list.slice(i, j);
    let shown = -1;
    const ok = await playTake(tk[0], tk[1], take(run[run.length - 1])[2], (t) => {
      let k = 0;
      run.forEach((b, n) => { if (t >= take(b)[1] - 0.05) k = n; });
      if (k !== shown) { shown = k; mark(pg, run[k]); }
    });
    if (!ok) return;
    run.forEach((b) => b.classList.remove('on'));
    i = j;
  }
  if (id !== playId) return;
  stop();
  // a puzzle with no sentences after it (the page's last beat asks it) starts once everything is read
  if (P(pg) && !pg.classList.contains('solved')) return startPuzzle(pg);
  finished(pg);
}
function finished(pg) {
  pg.dataset.read = '1';
  document.querySelector('.pager .next').classList.toggle('ready', pg === pages[cur] && cur < pages.length - 1);
}

// ---------------- puzzles ----------------
const P = (pg) => pg.querySelector('.puzzle');
// puzzle types a series adds for itself (故事大王/play.js: build, tapwind, told): type → start(page, puzzle), called once
/** @type {Record<string, (pg: Element, pz: Element) => void>} */
const PUZZLE_PLAY = {};
async function speakThen(text, fn) { stop(); if (await say(text)) fn && fn(); }

function startPuzzle(pg) {
  const pz = P(pg);
  pg.classList.add('asking');
  pg.querySelector('.text').scrollTo({ top: 9999, behavior: 'smooth' });
  const type = pz.dataset.type;
  if (pz.dataset.started) return;
  pz.dataset.started = '1';
  if (PUZZLE_PLAY[type]) return PUZZLE_PLAY[type](pg, pz);
  if (type === 'find' && pz.dataset.demo) {   // show how: the first one gets its ring
    const first = pg.querySelector('[data-find]');
    stop();
    say(pz.dataset.demo);
    setTimeout(() => first.classList.add('found'), 1200);
  }
  if (type === 'seq') {
    nextSeq(pg);
    if (pz.dataset.demo) {   // show how: the first empty place is filled for the child
      stop();
      say(pz.dataset.demo).then((ok) => { if (ok) { pg.querySelector('[data-seq]').classList.add('filled'); nextSeq(pg); } });
    }
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
    speakThen('对啦！', () => openAsk(pg));
  } else {
    chip.classList.remove('no'); chip.getBoundingClientRect(); chip.classList.add('no');
    speakThen('再数一数。');
  }
}

function onFind(pg, t) {
  const pz = P(pg);
  if ('decoy' in t.dataset) { t.classList.remove('no'); t.getBoundingClientRect(); t.classList.add('no'); return speakThen(t.dataset.no || pz.dataset.decoySay); }
  if (t.classList.contains('found')) return;
  t.classList.add('found');
  const all = !pg.querySelector('[data-find]:not(.found)');
  // a thing with a line of its own says it first (故事大王: each pig says what he does)
  if (t.dataset.say) { stop(); say(t.dataset.say).then((ok) => ok && all && speakThen(pz.dataset.done, () => openAsk(pg))); return; }
  if (all) speakThen(pz.dataset.done, () => openAsk(pg));
}

// pattern puzzle: the next empty place pulses; a chip fills it if it is what the pattern needs
function nextSeq(pg) {
  const slots = [...pg.querySelectorAll('[data-seq]')], next = slots.find((s) => !s.classList.contains('filled'));
  slots.forEach((s) => s.classList.toggle('next', s === next));
  return next;
}
function onSeq(pg, chip) {
  const pz = P(pg), next = nextSeq(pg);
  if (!next) return;
  if (chip.dataset.v === next.dataset.seq) {
    next.classList.add('filled');
    if (!nextSeq(pg)) speakThen(pz.dataset.done, () => solved(pg));
    else { stop(); say(chip.dataset.say, chip.dataset.file); }
  } else {
    chip.classList.remove('no'); chip.getBoundingClientRect(); chip.classList.add('no');
    speakThen(chip.dataset.no || pz.dataset.wrong);
  }
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
  // the arrow cards of the hops: done ones light up, the next one pulses
  pg.querySelectorAll('[data-step]').forEach((c) => { const k = +c.dataset.step; c.classList.toggle('on', k <= n); c.classList.toggle('next', k === n + 1); });
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
    speakThen(pz.dataset.wrong, () => at && pz.dataset.next !== '0' && say(`${'一二三四五六七八九'[at - 1]}后面是几？`));
  }
}

// sorting: a finger drags a .drag over a .bin; dropped on the bin with its own value it settles in the bin's next slot,
// anywhere else it goes back home (on a wrong bin the voice says which feature does not match)
let held = null;
const scenePoint = (svgEl, e) => new DOMPoint(e.clientX, e.clientY).matrixTransform(svgEl.getScreenCTM().inverse());
function binAt(pg, p) {
  return [...pg.querySelectorAll('.bin')].find((b) => { const [x, y, w, h] = b.dataset.box.split(',').map(Number); return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h; });
}
function onSortDrop(pg, d, b) {
  if (P(pg).dataset.type === 'pour') return onPour(pg, d, b);
  const pz = P(pg), want = d.dataset.drag;
  if (!b) { d.style.transform = ''; return; }
  const got = b.dataset.bin;
  if (got !== want) {
    d.style.transform = '';
    if (d.dataset.no) return speakThen(d.dataset.no);
    const i = [...want].findIndex((c, k) => c !== got[k]);
    return speakThen(pz.dataset.wrong.split('|')[i]);
  }
  const n = pg.querySelectorAll(`.drag.placed[data-in="${got}"]`).length;
  const [sx, sy] = b.dataset.slots.split(' ')[n].split(',').map(Number);
  d.style.transform = `translate(${sx - d.dataset.x}px, ${sy - d.dataset.y}px)`;
  d.classList.add('placed');
  d.dataset.in = got;
  if (!pg.querySelector('.drag:not(.placed)')) speakThen(pz.dataset.done, () => solved(pg));
  else { stop(); say('对啦！'); }
}
// pouring (puzzle 'pour', dragged like sorting): a thing dropped on the .bin settles in its next slot and lights the next
// data-each [data-fuel] cells; every cell lit = solved. Dropped anywhere else it goes back home.
function onPour(pg, d, b) {
  const pz = P(pg);
  if (!b) { d.style.transform = ''; return; }
  const n = pg.querySelectorAll('.drag.placed').length, [sx, sy] = b.dataset.slots.split(' ')[n].split(',').map(Number);
  d.style.transform = `translate(${sx - +d.dataset.x}px, ${sy - +d.dataset.y}px)`;
  d.classList.add('placed');
  [...pg.querySelectorAll('[data-fuel]:not(.on)')].slice(0, +pz.dataset.each).forEach((c) => c.classList.add('on'));
  if (!pg.querySelector('[data-fuel]:not(.on)')) speakThen(pz.dataset.done, () => solved(pg));
  else { stop(); say(pz.dataset.lines.split('|')[n] || '对啦！'); }
}
// a tapped thing with data-pick (a route card …) names itself on its scene (svg.scene[data-pick]), so the picture can
// act it out with CSS; set again on every tap, so the acting starts over
document.addEventListener('click', (e) => {
  const t = e.target.closest('.tap[data-pick]'), sc = t && t.closest('svg.scene'), pg = sc && sc.closest('.pg');
  if (!t || !pg.classList.contains('asking')) return;
  delete sc.dataset.pick; sc.getBoundingClientRect(); sc.dataset.pick = t.dataset.pick;
});
document.addEventListener('pointerdown', (e) => {
  const d = e.target.closest('.drag'), pg = d && d.closest('.pg');
  if (!d || d.classList.contains('placed') || !pg.classList.contains('asking') || pg.classList.contains('solved')) return;
  e.preventDefault();
  const sc = /** @type {SVGGraphicsElement} */ (d).ownerSVGElement;
  held = { d, pg, sc, from: scenePoint(sc, e) };
  d.classList.add('held');
});
document.addEventListener('pointermove', (e) => {
  if (!held) return;
  const p = scenePoint(held.sc, e), b = binAt(held.pg, p);
  held.d.style.transform = `translate(${p.x - held.from.x}px, ${p.y - held.from.y}px)`;
  held.pg.querySelectorAll('.bin').forEach((x) => x.classList.toggle('over', x === b));
});
const letGo = (e) => {
  if (!held) return;
  const { d, pg, sc } = held, b = e.type === 'pointerup' && binAt(pg, scenePoint(sc, e));
  held = null;
  d.classList.remove('held');
  pg.querySelectorAll('.bin.over').forEach((x) => x.classList.remove('over'));
  onSortDrop(pg, d, b);
};
document.addEventListener('pointerup', letGo);
document.addEventListener('pointercancel', letGo);

// the colour picked on this page (each page has its own palette)
const chosen = (pg) => /** @type {HTMLElement} */ (P(pg).querySelector('.paint-chip.on')).dataset.color;
function onPaint(pg, t) {
  const pz = P(pg), color = chosen(pg);
  t.querySelectorAll('.paint').forEach((e) => e.setAttribute('fill', color));
  if (!pg.classList.contains('solved')) speakThen(pz.dataset.done, () => solved(pg));
}
// mirror: the picked colour goes into an empty cell only if it is that cell's own colour; every cell filled = solved
function onCell(pg, t) {
  const pz = P(pg), color = chosen(pg);
  if (t.classList.contains('found')) return;
  if (color !== t.dataset.cell) { t.classList.remove('no'); t.getBoundingClientRect(); t.classList.add('no'); return speakThen(pz.dataset.wrong); }
  const r = t.querySelector('.paint');
  r.setAttribute('fill', color);
  r.removeAttribute('stroke-dasharray');
  if ('blank' in t.dataset) r.setAttribute('stroke', 'none');   // "no block here": it melts into the door
  t.classList.add('found');
  if (!pg.querySelector('[data-cell]:not(.found)')) speakThen(pz.dataset.done, () => solved(pg));
  else { stop(); say('对啦！'); }
}

// ---------------- turning pages ----------------
const pages = [...document.querySelectorAll('.pg')];
let cur = 0;
// nothing is kept: a page opened again (or heard again) has its puzzle unsolved, so the child can play it again
let blank = [];
function fresh(pg) {
  if (!pg.classList.contains('asking') && !pg.classList.contains('solved')) return;
  if (held && held.pg === pg) held = null;
  pg.classList.remove('asking', 'solved', 'hinting');
  pg.replaceChildren(...blank[pages.indexOf(pg)].cloneNode(true).childNodes);
}
function show(i) {
  if (i < 0 || i >= pages.length || i === cur) return;
  stop();
  const old = pages[cur];
  old.classList.remove('on');
  old.classList.toggle('left', i > cur);
  pages[i].classList.remove('left');
  pages[i].classList.add('on');
  cur = i;
  fresh(pages[i]);
  document.querySelectorAll('.dot').forEach((d, k) => { d.classList.toggle('on', k === i); if (k === i) d.classList.add('seen'); });
  /** @type {HTMLButtonElement} */ (document.querySelector('.pager .prev')).disabled = i === 0;
  /** @type {HTMLButtonElement} */ (document.querySelector('.pager .next')).disabled = i === pages.length - 1;
  document.querySelector('.pager .next').classList.remove('ready');
  pages[i].querySelector('.text').scrollTop = 0;
  if (i > 0) narrate(pages[i]);
}

document.addEventListener('click', (e) => {
  const t = e.target, pg = t.closest('.pg');
  const hit = (sel) => t.closest(sel);
  if (hit('.start')) return show(1);
  if (hit('.sound')) { document.body.classList.remove('muted'); return cur > 0 && narrate(pages[cur]); }
  if (hit('.home')) return show(0);
  if (hit('.pager .next')) return show(cur + 1);
  if (hit('.pager .prev')) return show(cur - 1);
  if (hit('.dot')) return show(+hit('.dot').dataset.go);
  if (!pg) return;
  // always from the first sentence; a solved puzzle starts over (one half done keeps its progress)
  if (hit('.again')) { if (pg.classList.contains('solved')) fresh(pg); return narrate(pg); }
  if (hit('.chip')) return onChip(pg, hit('.chip'));
  if (hit('.add')) return onFill(pg, true);
  if (hit('.hint')) {
    pg.classList.add('hinting'); setTimeout(() => pg.classList.remove('hinting'), 1600);
    return speakThen(hit('.hint').dataset.say);
  }
  if (hit('.seq-chip')) return pg.classList.contains('asking') && onSeq(pg, hit('.seq-chip'));
  if (hit('.paint-chip')) {
    pg.querySelectorAll('.paint-chip').forEach((c) => c.classList.toggle('on', c === hit('.paint-chip')));
    return;
  }
  const tap = hit('.tap');
  if (tap && pg.classList.contains('asking') || tap && pg.classList.contains('solved')) {
    if ('find' in tap.dataset || 'decoy' in tap.dataset) return onFind(pg, tap);
    if ('slot' in tap.dataset) return onFill(pg, false);
    if ('choice' in tap.dataset) return onChoice(pg, tap);
    if ('stone' in tap.dataset) return onStone(pg, tap);
    if ('paint' in tap.dataset) return onPaint(pg, tap);
    if ('cell' in tap.dataset) return onCell(pg, tap);
  }
  if (hit('.ask .q')) return speakThen(hit('.ask').dataset.say);
  const beat = hit('.beat');
  // a sentence tapped before the page's puzzle has opened: read it, then go on reading from there (else the puzzle,
  // which opens when the reading reaches it, would never open)
  if (beat) {
    stop(); nowEl = beat;
    const before = P(pg) && !P(pg).dataset.started;
    readBeat(pg, beat).then((ok) => { if (!ok) return; stop(); if (before) narrate(pg, beats(pg).indexOf(beat) + 1); });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') show(cur + 1);
  if (e.key === 'ArrowLeft') show(cur - 1);
});
// a finger that starts on something to drag (a sorting piece, a piece of 故事大王's interactions) is the page's: without
// this a phone takes it for a scroll and cancels the drag at once (touch-action is ignored on the parts of an svg)
document.addEventListener('touchstart', (e) => { if (/** @type {Element} */ (e.target).closest('.drag, .grab')) e.preventDefault(); }, { passive: false });
let touchX = null, touchY = null;
// a swipe turns the page, but not a finger dragging something in a sorting puzzle, or on a .grab (a piece of 故事大王's
// interactions, or a whole page while the child taps it as fast as they can)
document.addEventListener('touchstart', (e) => { touchX = /** @type {Element} */ (e.target).closest('.drag, .grab') ? null : e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY;
  if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) show(cur + (dx < 0 ? 1 : -1));
  touchX = null;
}, { passive: true });

// everyone breathes and blinks in their own time
document.querySelectorAll('.rig, .rig-head, .rig-eyes, .didi-eyes').forEach((/** @type {SVGElement} */ e) => {
  e.style.animationDelay = `${-(Math.random() * 6).toFixed(2)}s`;
  if (!e.classList.contains('rig')) e.style.animationDuration = `${(4 + Math.random() * 3).toFixed(2)}s`;
});
/** @type {HTMLButtonElement} */ (document.querySelector('.pager .prev')).disabled = true;
blank = pages.map((pg) => pg.cloneNode(true));   // after the breathing delays above, so the copies keep them

// 故事大王 on a tablet: what the fairy tales add to 逻辑世界's player (../逻辑世界/player.js, loaded before this file):
// sound effects that play alongside the voice, and the interactions written by tale.js —
//   build    jobs one after another (place / smear / haul / tap); the sun moves as the work gets done
//   tapwind  tap anywhere, fast: a wind meter (0–100, +12 a tap, 60 % of it leaking away every second) blows a house
//   told     one big button, tapped once the child has told a grown-up
// What an interaction has done lives in its page (classes and data- on its elements): a page opened again is put back
// clean by player.js, so it starts fresh.

// ---------------- sound effects ----------------
// They play next to the voice (which has the one shared audio element, shared/audio.js) through Web Audio, whose
// volume can follow the wind meter even on an iPad. A page opened as a file on a computer cannot fetch its sounds:
// there they play through audio elements of their own.
const FX = { /** @type {AudioContext | null} */ ctx: null, /** @type {Map<string, Promise<AudioBuffer | null>>} */ bufs: new Map(), warm: false };
function fxCtx() {
  if (!FX.ctx) {
    const C = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (!C) return null;
    FX.ctx = new C();
  }
  if (FX.ctx.state === 'suspended') FX.ctx.resume();
  return FX.ctx;
}
/** @param {string} file */
function fxLoad(file) {
  if (!FX.bufs.has(file)) {
    const c = FX.ctx;
    FX.bufs.set(file, !c || location.protocol === 'file:' ? Promise.resolve(null)
      : fetch(AUDIO_DIR + file).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).catch(() => null));
  }
  return FX.bufs.get(file);
}
// Safari lets Web Audio play only after a tap has started it: every tap wakes it (the first one also starts loading
// every sound the page lists)
const wakeFx = () => {
  const c = fxCtx();
  if (!c || FX.warm) return;
  FX.warm = true;
  const s = c.createBufferSource();
  s.buffer = c.createBuffer(1, 1, 22050);
  s.connect(c.destination);
  s.start();
  document.querySelectorAll('[data-sfx]').forEach((e) => fxLoad(e.dataset.sfx));
};
['pointerdown', 'touchend', 'click'].forEach((t) => document.addEventListener(t, wakeFx, true));

// a child who touches the work before the voice has asked for it (a piece, the cart, the mortar, a nail; on a wind
// page the picture) starts it at once: the reading stops, the interaction opens, and that same touch counts.
// Without this the pieces just did not move until the lead-in was read (up to 20 s), which looked broken.
document.addEventListener('pointerdown', (e) => {
  const pg = pages[cur], pz = pg && P(pg), t = /** @type {Element} */ (e.target);
  if (!pz || pz.dataset.started || pg.classList.contains('solved') || !pg.contains(t)) return;
  const type = pz.dataset.type;
  const early = type === 'build' ? t.closest('.piece, .cart, .smear, .tapme') : type === 'tapwind' ? t.closest('svg.scene') : null;
  if (!early) return;
  stop();
  // the picture moves with the sentences: put everything the skipped lead-in would have moved in place at once (else
  // the wolf was still rubbing his bottom when the wind page opened early, with no blowing pose and no wind)
  const list = beats(pg), first = list.findIndex((b) => b.classList.contains('after')), upto = first < 0 ? list.length : first;
  pg.querySelectorAll('svg.scene [data-at]').forEach((x) => { if (+x.dataset.at < upto && !x.classList.contains('go')) x.classList.add('go', 'q'); });
  startPuzzle(pg);
}, true);

/** @typedef {{ set: (v: number) => void, stop: () => void }} Sound */
// play audio/<file> once (loop: until stopped) at volume gain; returns a handle to change the volume or stop it
/** @param {string} file  @returns {Sound} */
function sfx(file, gain = 0.8, loop = false) {
  /** @type {AudioBufferSourceNode | null} */ let src = null;
  /** @type {GainNode | null} */ let amp = null;
  /** @type {HTMLAudioElement | null} */ let el = null;
  let g = gain, dead = false;
  const h = {
    set(v) { g = v; if (amp) amp.gain.setTargetAtTime(v, FX.ctx.currentTime, 0.06); if (el) el.volume = Math.min(1, Math.max(0, v)); },
    stop() { dead = true; if (src) { try { src.stop(); } catch (e) { /* not started */ } } if (el) el.pause(); },
  };
  if (!file) return h;
  wakeFx();
  fxLoad(file).then((buf) => {
    if (dead) return;
    const c = FX.ctx;
    if (buf && c) {
      src = c.createBufferSource(); src.buffer = buf; src.loop = loop;
      if (loop) { src.loopStart = 0.08; src.loopEnd = Math.max(0.2, buf.duration - 0.25); }   // past the file's silent ends
      amp = c.createGain(); amp.gain.value = g;
      src.connect(amp).connect(c.destination);
      src.start();
    } else {
      el = new Audio(AUDIO_DIR + file); el.loop = loop; el.volume = Math.min(1, Math.max(0, g));
      el.play().catch(() => {});
    }
  });
  return h;
}
// sounds that go on while their page is open (a snore, the wind): stopped once the page is turned
/** @type {{ pg: Element, key: string, h: Sound }[]} */
let lasting = [];
/** @param {Element} pg  @param {Sound} h */
function whileOpen(pg, key, h) {
  lasting.filter((x) => x.pg === pg && x.key === key).forEach((x) => x.h.stop());
  lasting = lasting.filter((x) => !(x.pg === pg && x.key === key)).concat({ pg, key, h });
  return h;
}
setInterval(() => {
  lasting.filter((x) => !x.pg.classList.contains('on')).forEach((x) => x.h.stop());
  lasting = lasting.filter((x) => x.pg.classList.contains('on'));
}, 300);
// a piece with data-sfx that moves with a beat plays its sound (data-wait seconds in; data-loop: on and on)
onBeat.push((pg, b) => pg.querySelectorAll(`svg.scene [data-at="${b}"][data-sfx]`).forEach((e) => {
  setTimeout(() => {
    if (!pg.classList.contains('on')) return;
    if ('loop' in e.dataset) whileOpen(pg, e.dataset.sfx, sfx(e.dataset.sfx, 0.5, true));
    else sfx(e.dataset.sfx, 0.7);
  }, (+e.dataset.wait || 0) * 1000);
}));

// ---------------- what the characters say during an interaction ----------------
// one line after another, never cutting each other off; nothing more once the page is turned
/** @type {WeakMap<Element, Promise<any>>} */
const lineQueue = new WeakMap();
/** @param {Element} pg  @param {string} text */
function line(pg, text) {
  const q = (lineQueue.get(pg) || Promise.resolve()).then(() => {
    if (!text || pg !== pages[cur]) return true;
    stop();
    return say(text);
  });
  lineQueue.set(pg, q);
  return q;
}
// the puzzle is done: once the lines are said and the picture has moved (ms), read on (only if the page is still open)
/** @param {Element} pg */
function finish(pg, ms) {
  (lineQueue.get(pg) || Promise.resolve()).then(() => setTimeout(() => {
    if (pg === pages[cur] && pg.classList.contains('asking')) solved(pg);
  }, ms));
}
// (re)start a CSS animation on el by its class c
/** @param {Element} el */
const replay = (el, c) => { el.classList.remove(c); el.getBoundingClientRect(); el.classList.add(c); };
const go = (/** @type {Element} */ el) => replay(el, 'go');

document.addEventListener('click', (e) => {
  const how = /** @type {HTMLElement} */ (e.target).closest('.how');
  if (how) speakThen(how.dataset.say);
});
// a choice card with data-retry (it ends badly: 三只小猪, opening the door to the wolf): the picture shows what happens
// (svg.scene.oops: .oops-show appears, .not-oops and the cards hide), its reply is said, then data-retry ("we go back and
// choose again"), and the cards come back; only another card lets the story go on (parent, 2026-10-27: 直接开门就被吃掉)
document.addEventListener('click', (e) => {
  const t = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('[data-choice][data-retry]')), pg = t && t.closest('.pg');
  if (!t || !pg.classList.contains('asking') || pg.classList.contains('solved')) return;
  e.stopPropagation();
  const sc = sceneOf(pg);
  sc.classList.add('oops');
  speakThen(t.dataset.say, () => speakThen(t.dataset.retry, () => sc.classList.remove('oops')));
}, true);
// ---------------- build ----------------
/** @param {Element} el */
const jobsOf = (el) => (el.getAttribute('data-job') || '').split(' ').filter(Boolean).map(Number);
const sceneOf = (/** @type {Element} */ pg) => /** @type {SVGSVGElement} */ (pg.querySelector('svg.scene'));
/** @param {Element} pz  @returns {BuildJob[]} */
const jobsSpec = (pz) => JSON.parse(pz.getAttribute('data-jobs'));
// how many actions job i takes: a spot each, one smear, a load each, a tap each
function jobSize(sc, i, kind) {
  const els = [...sc.querySelectorAll('[data-job]')].filter((e) => jobsOf(e).includes(i));
  if (kind === 'place') return els.filter((e) => e.classList.contains('spot')).length;
  if (kind === 'smear') return 1;
  if (kind === 'haul') return els.filter((e) => e.classList.contains('haul')).reduce((n, e) => n + +e.dataset.n, 0);
  return els.filter((e) => e.classList.contains('tapme')).reduce((n, e) => n + +e.dataset.n, 0);
}
PUZZLE_PLAY.build = (pg, pz) => {
  const sc = sceneOf(pg), jobs = jobsSpec(pz);
  const total = jobs.reduce((n, j, i) => n + jobSize(sc, i, j.kind), 0);
  pz.dataset.total = String(total);
  pz.querySelector('.work').innerHTML = Array.from({ length: total }, () => '<i></i>').join('');
  startJob(pg, 0);
};
function startJob(pg, i) {
  const pz = P(pg), sc = sceneOf(pg), job = jobsSpec(pz)[i];
  pz.dataset.job = String(i);
  pz.dataset.did = pz.dataset.did || '0';
  sc.querySelectorAll('[data-job]').forEach((e) => e.classList.toggle('now', jobsOf(e).includes(i)));
  if (job.order === 'up') nextSpot(sc, i);
  // the 不会做？ button tells how to do this job
  const hint = /** @type {HTMLElement} */ (pz.querySelector('.hint'));
  if (hint) hint.dataset.say = job.intro || job.hint || pz.dataset.hint;
  // the step written out under the work: the child (or a grown-up) taps it to hear it again, in the mama voice
  const how = /** @type {HTMLElement} */ (pz.querySelector('.how'));
  if (how) { how.dataset.say = job.intro || job.hint || pz.dataset.hint; how.textContent = how.dataset.say; }
  // each step opens with a sentence that says, in words, what to do (job.intro; job 0's is in the page's own text).
  // The parent got stuck at the mortar (the work moved on without a word) and asked for words, not pointing hands.
  const opening = job.intro || (job.lines && job.lines[0]);
  if (opening) line(pg, opening);
  if (i > 0) sc.querySelectorAll('.finger').forEach((f) => f.remove());   // the first job's hand belongs to the first job
  nudgeLater(pg, true);
}
// a step left alone for a while is said once more, in words
/** @type {Map<Element, { k: number, last: number, t?: number, job?: number }>} */
const nudges = new Map();
function nudgeLater(pg, fresh) {
  const n = nudges.get(pg) || { k: 0, last: 0 }, pz = P(pg);
  if (fresh || n.job !== +pz.dataset.job) { n.k = 0; n.job = +pz.dataset.job; }
  n.last = performance.now();
  clearTimeout(n.t);
  const check = () => {
    const pz2 = P(pg);
    if (pg !== pages[cur] || !pg.classList.contains('asking') || pg.classList.contains('solved') || +pz2.dataset.job !== n.job || n.job < 0 || n.k >= 1) return;
    const idle = performance.now() - n.last;
    if (grip || idle < 8000) { n.t = setTimeout(check, 8000 - Math.min(idle, 7500)); return; }
    n.k++;
    const job = jobsSpec(pz2)[n.job];
    line(pg, job.intro || job.hint || pz2.dataset.hint);
  };
  n.t = setTimeout(check, 8000);
  nudges.set(pg, n);
}
// a job built in order: only its first empty spot lights up
function nextSpot(sc, i) {
  const spots = [...sc.querySelectorAll('.spot')].filter((s) => jobsOf(s).includes(i)).sort((a, b) => +a.dataset.order - +b.dataset.order);
  const next = spots.find((s) => !s.classList.contains('filled'));
  spots.forEach((s) => { s.classList.add('ordered'); s.classList.toggle('next', s === next); });
}
// one action of job i is done: count it, move the sun, say its line, and go on to the next job once this one is done
function act(pg, i) {
  const pz = P(pg), sc = sceneOf(pg), jobs = jobsSpec(pz), job = jobs[i];
  const did = +pz.dataset.did + 1, total = +pz.dataset.total, k = +(pz.dataset['j' + i] || 0) + 1;
  pz.dataset.did = String(did);
  pz.dataset['j' + i] = String(k);
  const dot = pz.querySelectorAll('.work i')[did - 1];
  if (dot) dot.classList.add('on');
  const sunEl = sc.querySelector('[data-sun]');
  if (sunEl) {
    const [fx0, fy0] = sunEl.dataset.from.split(',').map(Number), [tx, ty] = sunEl.dataset.to.split(',').map(Number);
    /** @type {SVGElement} */ (sunEl).style.transform = `translate(${((tx - fx0) * did) / total}px, ${((ty - fy0) * did) / total}px)`;
  }
  sc.querySelectorAll('[data-dusk]').forEach((/** @type {SVGElement} */ d) => { const [a, b] = d.dataset.dusk.split(',').map(Number); d.style.opacity = String(a + ((b - a) * did) / total); });
  if (job.lines && job.lines[k]) line(pg, job.lines[k]);
  sc.querySelectorAll(`[data-act="${i}:${k}"]`).forEach(go);   // what the picture does after action k of job i (a drop of sweat)
  if (job.order === 'up') nextSpot(sc, i);
  if (k < jobSize(sc, i, job.kind)) return;
  sc.querySelectorAll(`[data-jobdone="${i}"]`).forEach(go);
  sc.querySelectorAll('[data-job]').forEach((e) => { if (jobsOf(e).includes(i)) e.classList.add('was'); });
  if (i + 1 < jobs.length) return setTimeout(() => { if (P(pg) === pz) startJob(pg, i + 1); }, job.pause == null ? 700 : job.pause);
  pz.dataset.job = '-1';
  sc.querySelectorAll('[data-job]').forEach((e) => e.classList.remove('now'));
  setTimeout(() => sc.querySelectorAll('[data-jobdone="end"]').forEach(go), 500);
  finish(pg, 2200);
}
// a piece of a job still to come wobbles; its job may say why (先抹泥浆哦。)
function nope(pg, el) {
  replay(el, 'nope');
  const pz = P(pg), now = +pz.dataset.job, later = jobsOf(el).filter((j) => j > now)[0];
  const early = later != null && jobsSpec(pz)[later].early;
  if (early) speakThen(early);
}

/** @type {null | { pg: Element, sc: SVGSVGElement, el: SVGGElement, kind: string, job: number, from: DOMPoint, home?: number[], t0?: number, float?: boolean }} */
let grip = null;
let rolling = /** @type {Sound | null} */ (null), rollStop = 0;
// a loop that plays while the finger moves (the cart's wheels, the trowel) and stops just after it stops
function keepRolling(file) {
  if (!rolling) rolling = sfx(file, 0.6, true);
  clearTimeout(rollStop);
  rollStop = setTimeout(() => { if (rolling) rolling.stop(); rolling = null; }, 180);
}
document.addEventListener('pointerdown', (e) => {
  let t = e.target.closest('.piece, .cart, .smear, .tapme'), pg = t && t.closest('.pg');
  // a mortar step: a finger anywhere on its strip rubs, whatever lies over it (the next job's brick pile covered a third
  // of the strip and caught the finger, so rubbing there did nothing: parent, 2026-10-27)
  const here = pages[cur], sm = here && P(here) && P(here).dataset.type === 'build' && here.contains(e.target) &&
    here.classList.contains('asking') && sceneOf(here).querySelector('.smear.now:not(.full)');
  if (sm) {
    const [x, y, w, h] = sm.dataset.box.split(',').map(Number), p = scenePoint(sceneOf(here), e);
    if (p.x > x - 20 && p.x < x + w + 20 && p.y > y - 40 && p.y < y + h + 40) { t = sm; pg = here; }
  }
  if (!t || !pg.classList.contains('asking') || pg.classList.contains('solved') || P(pg).dataset.type !== 'build') return;
  nudgeLater(pg);
  busy(sceneOf(pg), true);
  const pz = P(pg), sc = sceneOf(pg), job = +pz.dataset.job, el = /** @type {SVGGElement} */ (t.classList.contains('cart') ? t.closest('.haul') : t);
  sc.classList.add('touched');
  e.preventDefault();
  if (job < 0 || !jobsOf(el).includes(job)) return nope(pg, t);
  const from = scenePoint(sc, e), spec = jobsSpec(pz)[job];
  if (el.classList.contains('tapme')) return tapIt(pg, el, job, spec);
  if (el.classList.contains('smear')) {
    if (el.classList.contains('full')) return;
    grip = { pg, sc, el, kind: 'smear', job, from };
    return smearAt(pg, from);
  }
  if (el.classList.contains('haul')) {
    if (el.classList.contains('busy')) return;
    grip = { pg, sc, el, kind: 'haul', job, from, t0: +(el.dataset.t || 0) };
    return;
  }
  if (el.classList.contains('placed')) return;
  let it = el, float = false;
  if (el.classList.contains('pile')) {   // a pile hands out one piece: a copy of its .one, dragged on top of everything
    it = /** @type {SVGGElement} */ (document.createElementNS('http://www.w3.org/2000/svg', 'g'));
    it.setAttribute('class', 'piece float');
    it.innerHTML = `<g class="lift">${el.querySelector('.one').innerHTML}</g>`;
    sc.querySelector('g[clip-path]').appendChild(it);
    float = true;
  }
  it.classList.add('held');
  grip = { pg, sc, el: it, kind: 'place', job, from, home: [+el.dataset.x, +el.dataset.y], float };
});
document.addEventListener('pointermove', (e) => {
  if (!grip) return;
  const nd = nudges.get(grip.pg);
  if (nd) nd.last = performance.now();
  const p = scenePoint(grip.sc, e);
  if (grip.kind === 'smear') return smearAt(grip.pg, p);
  if (grip.kind === 'haul') return pushCart(p);
  grip.el.style.transform = `translate(${p.x - grip.from.x}px, ${p.y - grip.from.y}px)`;
  const s = spotFor(grip, p);
  grip.sc.querySelectorAll('.spot.over').forEach((x) => x !== s && x.classList.remove('over'));
  if (s) s.classList.add('over');
});
// the picture is .busy while the child works on it (老三 sweats), and a moment after the finger lets go
/** @type {number | undefined} */ let busyOff;
function busy(sc, on) {
  clearTimeout(busyOff);
  if (on) sc.classList.add('busy'); else busyOff = setTimeout(() => sc.classList.remove('busy'), 900);
}
const release = (e) => {
  if (grip) busy(grip.sc, false);
  else document.querySelectorAll('svg.scene.busy').forEach((sc) => busy(sc, false));
  if (!grip) return;
  const g = grip;
  grip = null;
  if (g.kind !== 'place') return;
  const p = scenePoint(g.sc, e), s = e.type === 'pointerup' && spotFor(g, p), el = g.el;
  g.sc.querySelectorAll('.spot.over').forEach((x) => x.classList.remove('over'));
  el.classList.remove('held');
  if (!s) {   // slides back home
    el.style.transform = '';
    if (g.float) setTimeout(() => el.remove(), 350);
    return;
  }
  const [x, y, w, h] = s.dataset.box.split(',').map(Number);
  el.style.transform = `translate(${x + w / 2 - g.home[0]}px, ${y + h / 2 - g.home[1]}px)`;
  el.classList.add('placed');
  s.classList.add('taken');
  const spec = jobsSpec(P(g.pg))[g.job];
  setTimeout(() => {
    s.classList.add('filled');
    sfx(spec.sfx, 0.8);
    if (g.float) setTimeout(() => el.remove(), 300);
    act(g.pg, g.job);
  }, 220);
};
document.addEventListener('pointerup', release);
document.addEventListener('pointercancel', release);
// the empty spot of this job a piece dropped at p goes into: one that takes it, near enough, the nearest
function spotFor(g, p) {
  const fit = g.float ? '' : g.el.dataset.fit || '', cx = g.home[0] + p.x - g.from.x, cy = g.home[1] + p.y - g.from.y;
  let best = null, bestD = Infinity;
  g.sc.querySelectorAll('.spot.now:not(.taken)').forEach((s) => {
    if (!jobsOf(s).includes(g.job) || (s.dataset.fit || '') !== fit || (s.classList.contains('ordered') && !s.classList.contains('next'))) return;
    const [x, y, w, h] = s.dataset.box.split(',').map(Number), d = Math.hypot(x + w / 2 - cx, y + h / 2 - cy);
    if (d < Math.max(w, h) * 0.75 + 40 && d < bestD) { best = s; bestD = d; }
  });
  return best;
}
// smearing: the cells under the finger turn to mortar; 80 % covered = done
function smearAt(pg, p) {
  const el = grip.el, [x, y, w, h] = el.dataset.box.split(',').map(Number);
  const tool = /** @type {SVGGElement} */ (el.querySelector('.trowel'));
  tool.style.transform = `translate(${p.x - grip.from.x}px, ${p.y - grip.from.y}px)`;
  if (p.y < y - 60 || p.y > y + h + 60 || p.x < x - 20 || p.x > x + w + 20) return;
  const cells = el.querySelectorAll('.cell'), n = cells.length, at = Math.floor(((p.x - x) / w) * n);
  for (let k = at - 1; k <= at + 1; k++) if (cells[k]) cells[k].classList.add('on');
  keepRolling(jobsSpec(P(pg))[grip.job].sfx);
  if (el.querySelectorAll('.cell.on').length >= n * 0.8) {
    cells.forEach((c) => c.classList.add('on'));
    el.classList.add('full');
    tool.style.transform = '';
    const job = grip.job;
    grip = null;
    if (rolling) { rolling.stop(); rolling = null; }
    act(pg, job);
  }
}
// pushing the cart: it follows the finger along its road only, and stays where it is let go; at the end it tips out
function pushCart(p) {
  const el = grip.el, [[ax, ay], [bx, by]] = el.dataset.path.split(' ').map((q) => q.split(',').map(Number));
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = Math.min(1, Math.max(0, grip.t0 + ((p.x - grip.from.x) * dx + (p.y - grip.from.y) * dy) / len2));
  placeCart(el, t);
  keepRolling(jobsSpec(P(grip.pg))[grip.job].roll);
  if (t < 0.97) return;
  const pg = grip.pg, job = grip.job, spec = jobsSpec(P(pg))[job];
  grip = null;
  el.classList.add('busy', 'dump');
  sfx(spec.sfx, 0.8);
  const loads = +(el.dataset.loads || 0) + 1;
  el.dataset.loads = String(loads);
  sceneOf(pg).querySelectorAll(`[data-heap="${loads}"]`).forEach(go);
  act(pg, job);
  setTimeout(() => {   // back for the next load, filled up again
    el.classList.remove('dump');
    el.classList.add('back');
    placeCart(el, 0);
    if (loads >= +el.dataset.n) el.classList.add('empty');
    setTimeout(() => el.classList.remove('busy', 'back'), 900);
  }, 900);
}
function placeCart(el, t) {
  const [[ax, ay], [bx, by]] = el.dataset.path.split(' ').map((q) => q.split(',').map(Number));
  el.dataset.t = t.toFixed(3);
  /** @type {SVGGElement} */ (el.querySelector('.cart')).style.transform = `translate(${(bx - ax) * t}px, ${(by - ay) * t}px)`;
  el.querySelectorAll('.wheel').forEach((/** @type {SVGGElement} */ w) => { w.style.transform = `rotate(${t * 720}deg)`; });
}
// tapping: each tap counts; the hammer comes down
function tapIt(pg, el, job, spec) {
  const n = +el.dataset.n, hits = +el.dataset.hits;
  if (hits >= n) return;
  el.dataset.hits = String(hits + 1);
  replay(el, 'bang');
  sfx(spec.sfx, 0.8);
  if (hits + 1 >= n) el.classList.add('full');
  act(pg, job);
}

// ---------------- tapwind ----------------
/** @typedef {{ m: number, taps: number, k: number, hold: number, low: number, blow: number, rest: number, first: number, last: number,
 *   start: number, top: boolean, idle: boolean, slow: boolean, over: boolean, creak: number, wind: Sound, t: number }} Wind */
/** @type {Map<Element, Wind>} */
const winds = new Map();
PUZZLE_PLAY.tapwind = (pg, pz) => {
  const now = performance.now();
  const st = { m: 0, taps: 0, k: 0, hold: 0, low: 0, blow: 0, rest: 0, first: 0, last: 0, start: now, top: false, idle: false, slow: false, over: false, creak: 0,
    wind: whileOpen(pg, 'wind', sfx(pz.dataset.wind, 0, true)), t: now };
  winds.set(pg, st);
  pg.classList.add('grab');
  requestAnimationFrame(() => windFrame(pg));
};
// the count reached k: what is waiting for it moves (and plays its sound), and its line is said
function reach(pg, k) {
  const sc = sceneOf(pg), st = winds.get(pg);
  st.k = k;
  sc.querySelectorAll(`[data-wk="${k}"]`).forEach((e) => { go(e); if (e.dataset.sfx) sfx(e.dataset.sfx, 0.8); });
  const ev = JSON.parse(P(pg).dataset.ev || '{}');
  if (ev[k]) line(pg, ev[k]);
  if (k >= +P(pg).dataset.end) windOver(pg);
}
function windOver(pg) {
  const st = winds.get(pg), mode = P(pg).dataset.mode;
  st.over = true;
  if (mode === 'time') { st.m = 0; sceneOf(pg).dataset.tired = '1'; }
  finish(pg, mode === 'count' ? 1500 : mode === 'hold' ? 2200 : 2600);
}
// a tap anywhere on the page (but its buttons): more wind
document.addEventListener('pointerdown', (e) => {
  const pg = pages[cur], st = pg && winds.get(pg);
  if (!st || !pg.contains(e.target) || e.target.closest('button, .pager')) return;
  const sc = sceneOf(pg), mode = P(pg).dataset.mode;
  sc.classList.add('touched');
  st.last = performance.now();
  if (!st.first) st.first = st.last;
  if (st.over) {   // worn out: no more wind, he only pants harder
    if (mode === 'time') { sc.querySelectorAll('.pant-more').forEach((x) => replay(x, 'puff')); sfx(P(pg).dataset.pant, 0.6); }
    return;
  }
  if (st.rest > 0) return;   // catching his breath between two big gusts
  st.m = Math.min(100, st.m + 12);
  st.taps++;
  if (mode === 'count') reach(pg, st.taps);
}, true);
// while the child taps away, a tap on a sentence does not read it out
document.addEventListener('click', (e) => {
  const pg = pages[cur], st = pg && winds.get(pg);
  if (st && !st.over && pg.contains(e.target) && !e.target.closest('button')) e.stopPropagation();
}, true);
function windFrame(pg) {
  const st = winds.get(pg), pz = P(pg);
  if (!st) return;
  if (!pg.classList.contains('on') || !pz || !pz.isConnected || pz.dataset.type !== 'tapwind') {   // the page was turned
    st.wind.stop();
    winds.delete(pg);
    pg.classList.remove('grab');
    return;
  }
  const now = performance.now(), dt = Math.min(0.1, (now - st.t) / 1000), sc = sceneOf(pg), mode = pz.dataset.mode;
  st.t = now;
  if (st.rest > 0) st.rest -= dt;
  st.m *= Math.exp(-0.6 * dt);
  if (st.m < 0.5) st.m = 0;
  const m = st.m, lv = m <= 0 ? 0 : m < 45 ? 1 : m < 70 ? 2 : 3;
  sc.style.setProperty('--wind', (m / 100).toFixed(3));
  sc.dataset.lv = String(lv);
  sc.dataset.full = m >= 95 ? '1' : '';
  /** @type {SVGElement} */ (sc.querySelector('.mfill')).style.transform = `scaleY(${(m / 100).toFixed(3)})`;
  st.wind.set(m > 0 ? 0.12 + 0.75 * (m / 100) : 0);
  if (lv === 3) st.top = true;
  if (!st.over && mode === 'hold' && st.rest <= 0) {   // a big gust = about 3 s at the top; out of it for over 1 s starts it again
    if (lv === 3) { st.hold += dt; st.low = 0; } else if (st.hold > 0 && (st.low += dt) > 1) { st.hold = 0; st.low = 0; }
    if (lv === 3 && now - st.creak > 900) { st.creak = now; sfx(pz.dataset.creak, 0.55); }
    if (st.hold >= 3) {
      st.hold = 0; st.m = 0; st.rest = 1;
      replay(sc, 'gasp');
      reach(pg, st.k + 1);
    }
    if (st.first && !st.top && !st.slow && now - st.first > 4000) { st.slow = true; line(pg, pz.dataset.slow); }
  }
  sc.style.setProperty('--arc', (st.hold / 3).toFixed(3));
  if (!st.over && mode === 'time') {   // seconds of blowing: each one makes him funnier; 6 (or 45 since the first tap) and he is done
    if (m > 0) st.blow += dt;
    const sec = Math.min(+pz.dataset.end, Math.floor(st.blow));
    for (let k = st.k + 1; k <= sec; k++) reach(pg, k);
    if (!st.over && st.first && now - st.first > 45000) for (let k = st.k + 1; k <= +pz.dataset.end; k++) reach(pg, k);
  }
  if (!st.over && !st.idle && now - (st.last || st.start) > 8000) { st.idle = true; line(pg, pz.dataset.idle); }
  if (st.over && m <= 0 && now - st.last > 3000) st.wind.set(0);
  requestAnimationFrame(() => windFrame(pg));
}

// ---------------- find (逻辑世界's): a thing found plays its sound; tapped again, it does its bit once more ----------------
document.addEventListener('click', (e) => {
  const t = e.target.closest('.tap[data-find]'), pg = t && t.closest('.pg');
  if (!t || !(pg.classList.contains('asking') || pg.classList.contains('solved'))) return;
  if (t.classList.contains('found') && t.dataset.seen) replay(t, 'redo');
  t.dataset.seen = '1';
  if (t.dataset.sfx) sfx(t.dataset.sfx, 0.8);
}, true);

// ---------------- told ----------------
document.addEventListener('click', (e) => {
  const b = e.target.closest('.told'), pg = b && b.closest('.pg');
  if (!b || !pg.classList.contains('asking') || pg.classList.contains('solved')) return;
  b.classList.add('done');
  solved(pg);
});
