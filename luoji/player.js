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
  const copy = blank[pages.indexOf(pg)].cloneNode(true).childNodes;
  if (pg.replaceChildren) pg.replaceChildren(...copy);
  else { pg.innerHTML = ''; [...copy].forEach((n) => pg.appendChild(n)); }   // an older browser
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
// the screen's height for story.css (--app-h): measured, as older browsers (a learning tablet's AOSP browser) know no dvh
const appHeight = () => document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
appHeight();
['resize', 'orientationchange'].forEach((t) => window.addEventListener(t, () => { appHeight(); setTimeout(appHeight, 300); }));
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
