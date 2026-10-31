// The episode as a picture book: turn the pages, the voice reads each page sentence by sentence, the picture moves
// with the sentence being read, and a puzzle stops the reading until the child has solved it.
// Recordings: audio/voice.js says which text plays which file (VOICE_FILES). A page's sentences may instead be read
// in one continuous take (VOICE_TAKES: "page|sentence" → [file, start, end] seconds), so the voice flows like a told story;
// the sentence being read lights up and moves the picture as the take reaches it.
// The playing itself (one sound at a time, the iPad fixes, takes) is ../audio.js, loaded before this file. The puzzle
// types in files of their own (puzzles/<type>.play.js) are loaded after it; the published player.js has them joined on.
//
// Everything it needs is in the page itself (the published pages have no drawing code):
//   .pg                    a page; .beat[data-b][data-say] its sentences, .beat.after the ones read after the puzzle
//   [data-at=k]            a piece of the picture that moves (gets .go) when beat k is read; story.css says how
//   .puzzle[data-type]     find | fill | seq | sort | choose | path | color | mirror (more: puzzles/), with the picture's [data-find] [data-decoy] [data-slot]
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
// (a series may act on a beat too, fn(pg, b): shared/tale/play.js plays the sound effects of the pieces that move)
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
// puzzle types in files of their own (puzzles/<type>.play.js) and a series' own (shared/tale/play.js: build, tapwind, told):
// type → start(page, puzzle), called once
/** @type {Record<string, (pg: Element, pz: Element) => void>} */
const PUZZLE_PLAY = {};
// …and what such a type does with a tap on its page (fn(page, tapped element) → true when it took the tap) and with a
// thing dragged onto a bin (fn(page, thing, bin or null); without one a drop is sorting's)
/** @type {Record<string, (pg: Element, t: Element) => boolean | void>} */
const PUZZLE_TAP = {};
/** @type {Record<string, (pg: Element, d: HTMLElement, b: Element | null) => void>} */
const PUZZLE_DROP = {};
// a tap on a picture's .tap counts while the puzzle is asked, or after it is solved
/** @param {Element} pg */
const canTap = (pg) => pg.classList.contains('asking') || pg.classList.contains('solved');
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

// the child starts a puzzle before the voice has asked for it: the reading stops, and the picture is put where the
// skipped lead-in would have left it (every [data-at] before the first sentence read after the puzzle)
function skipLeadIn(pg) {
  stop();
  const list = beats(pg), first = list.findIndex((b) => b.classList.contains('after')), upto = first < 0 ? list.length : first;
  pg.querySelectorAll('svg.scene [data-at]').forEach((x) => { if (+x.dataset.at < upto && !x.classList.contains('go')) x.classList.add('go', 'q'); });
}
// is a card there to see? Not "no piece of the picture round it still waits for its beat": its 'out' (goes when the
// reading goes on after the puzzle) and its 'hop' (when its option is read out) wait for later beats while the card
// is already on the screen. So: not scaled to nothing, not faded out by a piece round it
/** @param {Element} el */
function cardShown(el) {
  if (!el.getBoundingClientRect().width) return false;
  for (let a = /** @type {Element | null} */ (el); a && a.tagName !== 'svg'; a = a.parentElement) if (+getComputedStyle(a).opacity === 0) return false;
  return true;
}
// a choice card counts the moment it shows, even while the voice is still reading the other options: the puzzle opens
// at that tap (capture phase, so a series' own card handling, 故事大王's data-retry, sees an open puzzle). The cards had
// shown for about 6 s before a tap did anything (龟兔赛跑 第 4 幕, 三只小猪 第 10 幕)
document.addEventListener('click', (e) => {
  const t = /** @type {Element} */ (e.target).closest('.tap[data-choice]'), pg = t && t.closest('.pg'), pz = pg && P(pg);
  if (!pz || pz.dataset.started || pg.classList.contains('solved') || !cardShown(t)) return;
  skipLeadIn(pg);
  startPuzzle(pg);
}, true);

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
    speakThen(chip.dataset.no || '再数一数。');
  }
}

function onFind(pg, t) {
  const pz = P(pg);
  if ('decoy' in t.dataset) { t.classList.remove('no'); t.getBoundingClientRect(); t.classList.add('no'); return speakThen(t.dataset.no || pz.dataset.decoySay); }
  if (t.classList.contains('found')) return;
  t.classList.add('found');
  const all = !pg.querySelector('[data-find]:not(.found)');
  // a thing with a line of its own says it first (故事大王: each pig says what he does)
  if (t.dataset.say) { stop(); say(t.dataset.say).then((ok) => { if (ok && all) speakThen(pz.dataset.done, () => openAsk(pg)); else if (ok && pz.dataset.more) say(pz.dataset.more); }); return; }
  if (all) speakThen(pz.dataset.done, () => openAsk(pg));
  else if (pz.dataset.more) speakThen(pz.dataset.more);
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
  if (PUZZLE_DROP[P(pg).dataset.type]) return PUZZLE_DROP[P(pg).dataset.type](pg, d, b);
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
  t.classList.add('found');
  if (!pg.querySelector('[data-cell]:not(.found)')) speakThen(pz.dataset.done, () => solved(pg));
  else { stop(); say('对啦！'); }
}


// a puzzle's sound effect (data-sfx), then the line
function sfxThen(pg, line) {
  stop();
  const f = P(pg).dataset.sfx;
  (f ? say(null, f) : Promise.resolve(true)).then((ok) => ok && line && say(line));
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
  const own = P(pg) && PUZZLE_TAP[P(pg).dataset.type];
  if (own && own(pg, t)) return;
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

// Playing puzzle 'beads' (written by beads.js), loaded after player.js: the beads are a tool, so the questions start at
// once. Tapping a bead slides it and every bead before it over (.moved); tapping a moved one slides it and every one
// after it back. The moved beads are always 1 … m: ten red, then white
function onBead(pg, t) {
  const i = +t.dataset.bead, back = t.classList.contains('moved');
  pg.querySelectorAll('[data-bead]').forEach((x) => { const k = +x.dataset.bead; if (back ? k >= i : k <= i) x.classList.toggle('moved', !back); });
  sfxThen(pg, '');
}
function beadsBack(pg) {
  pg.querySelectorAll('[data-bead].moved').forEach((x) => x.classList.remove('moved'));
  stop();
}
PUZZLE_PLAY.beads = (pg) => openAsk(pg);
PUZZLE_TAP.beads = (pg, t) => {
  if (t.closest('.beadsback')) { beadsBack(pg); return true; }
  const b = t.closest('.tap[data-bead]');
  if (!b || !canTap(pg)) return false;
  onBead(pg, b);
  return true;
};

// Playing puzzle 'bundle' (written by bundle.js), loaded after player.js: a tapped stick shows its number; the tenth
// ties the ten into the bundle (each flies to its place in [data-bundle]'s data-slots "x,y,angle …"), then the questions
function onStick(pg, t) {
  const bundle = pg.querySelector('[data-bundle]');
  if (bundle.classList.contains('tied') || t.classList.contains('picked')) return;
  const n = pg.querySelectorAll('[data-stick].picked').length + 1;
  t.classList.add('picked');
  t.dataset.n = String(n);
  t.querySelector('.cnt').textContent = String(n);
  stop();
  if (n < 10) return;
  const spots = bundle.dataset.slots.split(' ').map((s) => s.split(',').map(Number));
  pg.querySelectorAll('[data-stick].picked').forEach((/** @type {SVGElement} */ s) => {
    const [x, y, a] = spots[+s.dataset.n - 1];
    s.style.transform = `translate(${x - +s.dataset.x}px, ${y - +s.dataset.y}px) rotate(${a - +s.dataset.a}deg)`;
    s.classList.add('tied');
  });
  bundle.classList.add('tied');
  speakThen(P(pg).dataset.done, () => openAsk(pg));
}
PUZZLE_TAP.bundle = (pg, t) => {
  const stk = t.closest('.tap[data-stick]');
  if (!stk || !canTap(pg)) return false;
  onStick(pg, stk);
  return true;
};

// Playing the treasures and the places they go to (giveItem, giveTarget: give.js) of a 'give' puzzle or a give step,
// loaded after player.js; needs steps.play.js. One finger at a time:
//   pressed   the treasure is .up (the swallow shows, carrying it), its sound plays, [data-taken~=id] get .taken,
//             svg.scene .pz-dragging (the empty places glow)
//   moved     it follows the finger (style transform, in its parent's units), the swallow faces the way it goes (.west),
//             the place under the finger is .over
//   let go    on an empty place: it flies in (.given), the place .lit, its sound, bubble and line; on a place already lit:
//             home, and the step's full line (else miss); anywhere else: home and miss (just tapped, not moved: the hint)
/** @type {null | { pg: Element, el: SVGGElement, id: number, from: DOMPoint, moved: boolean }} */
let pzCarried = null;
// the place of this step a finger at e is over: inside its box, or up to 24 outside it
/** @param {Element} pg  @param {{ clientX: number, clientY: number }} e */
function pzPlaceAt(pg, e) {
  const k = pzStageNow(P(pg));
  return [...pzScene(pg).querySelectorAll(`.pz-to[data-step="${k}"]`)].find((to) => {
    const [x, y, w, h] = to.getAttribute('data-box').split(',').map(Number), p = pzLocal(to, e);
    return p.x > x - 24 && p.x < x + w + 24 && p.y > y - 24 && p.y < y + h + 24;
  });
}
// the treasure's things in the picture, taken (or put back)
/** @param {Element} pg  @param {Element} el */
function pzTaken(pg, el, on) {
  const id = el.getAttribute('data-give');
  pzScene(pg).querySelectorAll('[data-taken]').forEach((t) => { if (t.getAttribute('data-taken').split(' ').includes(id)) t.classList.toggle('taken', on); });
}
document.addEventListener('pointerdown', (e) => {
  const el = /** @type {SVGGElement} */ (e.target.closest('.pz-give')), pg = el && el.closest('.pg');
  if (!el || pzCarried || el.classList.contains('given') || el.classList.contains('back') || !pzLive(el)) return;
  e.preventDefault();
  pzTouched(pg, true);
  pzCarried = { pg, el, id: e.pointerId, from: pzLocal(el, e), moved: false };
  // she sets off facing the places still empty
  const sc = pzScene(pg), home = +el.getAttribute('data-x'), k = pzStageNow(P(pg));
  const xs = [...sc.querySelectorAll(`.pz-to[data-step="${k}"]:not(.lit)`)].map((to) => { const [x, , w] = to.getAttribute('data-box').split(',').map(Number); return x + w / 2; });
  el.classList.toggle('west', xs.length > 0 && xs.reduce((a, b) => a + b, 0) / xs.length < home);
  el.classList.add('up');
  sc.classList.add('pz-dragging');
  pzTaken(pg, el, true);
  pzSfx(pg, el.getAttribute('data-sfx'));
});
document.addEventListener('pointermove', (e) => {
  const c = pzCarried;
  if (!c || e.pointerId !== c.id) return;
  if (!c.el.isConnected) { pzCarried = null; return; }
  const p = pzLocal(c.el, e), dx = p.x - c.from.x, dy = p.y - c.from.y;
  if (Math.hypot(dx, dy) > 10) c.moved = true;
  c.el.style.transform = `translate(${dx}px, ${dy}px)`;
  // she turns when the finger goes clearly the other way
  const last = +(c.el.getAttribute('data-lx') || dx);
  if (dx < last - 14) c.el.classList.add('west');
  if (dx > last + 14) c.el.classList.remove('west');
  if (Math.abs(dx - last) > 14 || !c.el.hasAttribute('data-lx')) c.el.setAttribute('data-lx', String(dx));
  const over = pzPlaceAt(c.pg, e);
  pzScene(c.pg).querySelectorAll('.pz-to').forEach((to) => to.classList.toggle('over', to === over));
});
/** @param {PointerEvent} e */
const pzLetGo = (e) => {
  const c = pzCarried;
  if (!c || e.pointerId !== c.id) return;
  pzCarried = null;
  const { pg, el } = c, sc = pzScene(pg), pz = P(pg);
  sc.classList.remove('pz-dragging');
  sc.querySelectorAll('.pz-to.over').forEach((to) => to.classList.remove('over'));
  el.removeAttribute('data-lx');
  pzTouched(pg);
  if (!el.isConnected || !pz) return;
  const spec = pzStepNow(pz), to = e.type === 'pointerup' && pzPlaceAt(pg, e);
  if (to && !to.classList.contains('lit')) return pzGive(pg, el, to, spec);
  // home again: she flies it back, then the treasure is in its place again
  el.classList.remove('up');
  el.classList.add('back');
  el.style.transform = '';
  setTimeout(() => { el.classList.remove('back'); pzTaken(pg, el, false); }, 460);
  if (e.type !== 'pointerup') return;
  pzSay(pg, to ? spec.full || spec.miss : c.moved ? spec.miss : spec.hint || pz.getAttribute('data-hint'));
};
document.addEventListener('pointerup', pzLetGo);
document.addEventListener('pointercancel', pzLetGo);
// el is given to the place `to`: it flies to its middle and stays there; the place lights up and says its line (a place
// with no line of its own says the step's next one)
/** @param {Element} pg  @param {SVGGElement} el  @param {Element} to  @param {PuzzleStep} spec */
function pzGive(pg, el, to, spec) {
  const pz = P(pg), sc = pzScene(pg), [x, y, w, h] = to.getAttribute('data-box').split(',').map(Number);
  const mid = pzInScene(to, x + w / 2, y + h / 2), home = pzInScene(el, +el.getAttribute('data-x'), +el.getAttribute('data-y'));
  const m = /** @type {SVGGraphicsElement} */ (el.parentNode).getScreenCTM().inverse().multiply(sc.getScreenCTM());
  const d = new DOMPoint(mid.x - home.x, mid.y - home.y, 0, 0).matrixTransform(m);   // the way there, in el's parent's units
  el.classList.add('given');
  el.style.transform = `translate(${d.x}px, ${d.y}px)`;
  to.classList.add('lit');
  pzMark(sc, 'data-lit', to.getAttribute('data-to'));
  pzMark(sc, 'data-given', el.getAttribute('data-give'));
  if (to.querySelector('.pz-bubble')) pzReplay(to, 'pz-bub');
  pzSfx(pg, to.getAttribute('data-sfx'));
  if (to.hasAttribute('data-closeup')) { pzCloseup(pg, to); pzCheck(pg); return; }
  let line = pzLines(to)[0];
  if (!line && spec.lines) {
    const n = +(pz.getAttribute('data-said') || 0);
    line = spec.lines[n % spec.lines.length];
    pz.setAttribute('data-said', String(n + 1));
  }
  pzSay(pg, line);
  pzCheck(pg);
}

// ---------------- a place's close-up (giveTarget o.show) ----------------
// opened when the place gets its treasure and when a lit place is tapped: it pops up from the place's middle over the
// picture (moved to the end of the scene, so it is on top), the place's line is said, and it closes again once the line is
// done (at least 2.2 s). Tapped, it closes at once. Closed for good when the puzzle is solved (give.css).
/** @param {Element} sc */
function pzCloseupShut(sc) {
  sc.querySelectorAll('.pz-show.open:not(.closing)').forEach((g) => {
    g.classList.add('closing');
    g.setAttribute('data-tok', String(+(g.getAttribute('data-tok') || 0) + 1));
    setTimeout(() => { if (g.classList.contains('closing')) g.classList.remove('open', 'closing'); }, 320);
  });
}
/** @param {Element} pg  @param {Element} to */
function pzCloseup(pg, to) {
  const sc = pzScene(pg), g = sc.querySelector(`.pz-show[data-for="${to.getAttribute('data-to')}"]`);
  if (!g) return;
  pzCloseupShut(sc);
  sc.appendChild(g);
  g.classList.remove('closing');
  pzReplay(g, 'open');
  const tok = String(+(g.getAttribute('data-tok') || 0) + 1), opened = performance.now();
  g.setAttribute('data-tok', tok);
  pzSay(pg, pzLines(to)[0]).then(() => setTimeout(() => {
    if (g.getAttribute('data-tok') === tok && g.isConnected) pzCloseupShut(sc);
  }, Math.max(250, 2200 - (performance.now() - opened))));
}
document.addEventListener('pointerdown', (e) => {
  const sc = /** @type {Element} */ (e.target).closest && /** @type {Element} */ (e.target).closest('svg.scene'), pg = sc && sc.closest('.pg');
  if (!sc || !pg || !sc.querySelector('.pz-show')) return;
  if (/** @type {Element} */ (e.target).closest('.pz-show.open')) { pzCloseupShut(sc); return; }
  // a leaf still to give is picked up (give's own handler); one already given lies on its place: that is a tap on the place
  if (/** @type {Element} */ (e.target).closest('.pz-give:not(.given)')) { pzCloseupShut(sc); return; }
  pzCloseupShut(sc);
  const to = [...sc.querySelectorAll('.pz-to.lit[data-closeup]')].find((t) => {
    const [x, y, w, h] = t.getAttribute('data-box').split(',').map(Number), p = pzLocal(t, e);
    return p.x > x && p.x < x + w && p.y > y && p.y < y + h;
  });
  if (!to || !pzLive(to)) return;
  pzTouched(pg);
  pzCloseup(pg, to);
});

// Playing the things to hold down (holdSpot, hold.js) of a 'hold' puzzle or a hold step, loaded after player.js; needs
// steps.play.js. A finger on it (one at a time):
//   held      .holding (svg.scene .pz-holding), the ring fills (data-p, 0 … 1, and the ring's stroke-dashoffset) in
//             data-ms; at half .mid (svg.scene .pz-mid; both stay) and the sound of its .pz-midfx, full: .held (svg.scene
//             .pz-held), its sound, the step may be done (pzCheck)
//   let go    before it is full: the ring slowly empties (as slowly as it fills, at least 2 s for a full ring) and the
//             release line is said (the thing's own, else the step's); pressed again meanwhile, it fills on from there
// The finger may wander off the thing while it holds: only lifting it counts (a five-year-old's finger slides).
// data-p and the classes are on the page, so player.js's fresh() puts them back; the loop stops once its element is gone.

/** @type {null | { pg: Element, el: Element, id: number }} */
let pzHeld = null;
const PZ_EMPTY_MS = 2000;   // a full ring empties as slowly as it filled, and never faster than this
// the ring shows p (0 … 1)
/** @param {Element} el  @param {number} p */
function pzRing(el, p) {
  el.setAttribute('data-p', p.toFixed(3));
  const ring = el.querySelector('.pz-ring');
  if (ring) ring.setAttribute('stroke-dashoffset', (100 - 100 * p).toFixed(2));
}
// one loop per thing: fills while held, empties while not, stops when empty, full or gone
/** @type {WeakSet<Element>} */
const pzHoldLoops = new WeakSet();
/** @param {Element} pg  @param {Element} el */
function pzHoldLoop(pg, el) {
  if (pzHoldLoops.has(el)) return;
  pzHoldLoops.add(el);
  const ms = +el.getAttribute('data-ms') || 2000;
  let last = performance.now();
  const tick = (/** @type {number} */ now) => {
    const dt = Math.max(0, Math.min(100, now - last));   // a tab in the background does not jump the ring full; a frame's time may be a little before the press that started the loop
    last = now;
    if (!el.isConnected || el.classList.contains('held')) { pzHoldLoops.delete(el); return; }
    const holding = el.classList.contains('holding');
    let p = +(el.getAttribute('data-p') || 0) + (holding ? dt / ms : -dt / Math.max(ms, PZ_EMPTY_MS));
    if (p <= 0 && !holding) { pzRing(el, 0); pzHoldLoops.delete(el); return; }
    if (p >= 0.5 && !el.classList.contains('mid')) {
      const fx = el.querySelector('.pz-midfx');
      el.classList.add('mid');
      pzScene(pg).classList.add('pz-mid');
      if (fx) pzSfx(pg, fx.getAttribute('data-sfx'));
    }
    if (p >= 1) { pzRing(el, 1); pzHoldLoops.delete(el); pzHoldFull(pg, el); return; }
    pzRing(el, p);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
/** @param {Element} pg  @param {Element} el */
function pzHoldFull(pg, el) {
  if (pzHeld && pzHeld.el === el) pzHeld = null;
  el.classList.remove('holding');
  el.classList.add('held');
  pzScene(pg).classList.remove('pz-holding');
  pzScene(pg).classList.add('pz-held');
  pzTouched(pg);
  pzSfx(pg, el.getAttribute('data-sfx'));
  pzCheck(pg);
}
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.pz-hold'), pg = el && el.closest('.pg');
  if (!el || pzHeld || el.classList.contains('held') || !pzLive(el)) return;
  e.preventDefault();
  pzTouched(pg, true);
  pzHeld = { pg, el, id: e.pointerId };
  el.classList.add('holding');
  pzScene(pg).classList.add('pz-holding');
  pzHoldLoop(pg, el);
});
/** @param {PointerEvent} e */
const pzHoldUp = (e) => {
  const h = pzHeld;
  if (!h || e.pointerId !== h.id) return;
  pzHeld = null;
  const { pg, el } = h;
  el.classList.remove('holding');
  if (!el.isConnected) return;
  pzScene(pg).classList.remove('pz-holding');
  pzTouched(pg);
  if (el.classList.contains('held')) return;
  pzHoldLoop(pg, el);   // empties
  const own = [...el.children].find((c) => c.getAttribute('data-k') === 'release'), pz = P(pg);
  pzSay(pg, own ? own.getAttribute('data-say') : pz && pzStepNow(pz).release);
};
document.addEventListener('pointerup', pzHoldUp);
document.addEventListener('pointercancel', pzHoldUp);

// Playing puzzle 'pier' (written by pier.js), loaded after player.js: a board dropped on a pier sits in its next free place; the second one must make the pier's number with the
// first, or the bridge creaks and throws it back. A right pair that leaves another pier with no boards that fit is a
// dead end (the pier turns red, the boards stay until taken off: tap one, or 全部拿下来); after three, the big hint.
// The lines are in the puzzle's hidden spans, by data-k (see PierPuzzle in shared/types.d.ts).
const pierLine = (pg, k) => { const e = P(pg).querySelector(`[data-k="${k}"]`); return e ? e.dataset.say : ''; };
const onPier = (pg, b) => [...pg.querySelectorAll(`.drag.placed[data-in="${b.dataset.bin}"]`)];
// can the piers not in fixed still each get two boards, from the boards not on the fixed ones?
function pierFit(pg, fixed) {
  const used = new Set(fixed.flatMap((b) => onPier(pg, b)));
  const free = [...pg.querySelectorAll('.drag')].filter((d) => !used.has(d)).map((d) => +d.dataset.drag);
  const want = [...pg.querySelectorAll('.bin')].filter((b) => !fixed.includes(b)).map((b) => +b.dataset.bin);
  /** @param {number[]} ws  @param {number[]} vs  @returns {boolean} */
  const fit = (ws, vs) => !ws.length || vs.some((v, i) => vs.some((u, j) => j > i && u + v === ws[0] && fit(ws.slice(1), vs.filter((_, k) => k !== i && k !== j))));
  return fit(want, free);
}
function takeOff(pg, d) {
  const b = pg.querySelector(`.bin[data-bin="${d.dataset.in}"]`);
  d.classList.remove('placed');
  delete d.dataset.in; delete d.dataset.slot;
  d.style.transform = '';
  if (b) b.classList.remove('done', 'stuck');
}
PUZZLE_DROP.pier = (pg, d, b) => {
  const pz = P(pg);
  if (!b) { d.style.transform = ''; return; }
  const on = onPier(pg, b), want = +b.dataset.bin;
  if (on.length > 1) { d.style.transform = ''; return speakThen(pierLine(pg, 'full')); }
  const taken = on.map((x) => x.dataset.slot), slots = b.dataset.slots.split(' ');
  const k = slots.findIndex((_, i) => !taken.includes(String(i)));
  const [sx, sy] = slots[k].split(',').map(Number);
  d.style.transform = `translate(${sx - +d.dataset.x}px, ${sy - +d.dataset.y}px)`;
  d.classList.add('placed');
  d.dataset.in = b.dataset.bin; d.dataset.slot = String(k); d.dataset.dropped = String(Date.now());
  if (!on.length) return stop();
  const sum = +on[0].dataset.drag + +d.dataset.drag;
  if (sum !== want) {   // 嘎吱: the board is thrown back
    setTimeout(() => { if (d.dataset.in === b.dataset.bin) { takeOff(pg, d); d.classList.remove('flung'); d.getBoundingClientRect(); d.classList.add('flung'); } }, 450);
    return sfxThen(pg, pierLine(pg, `${sum > want ? 'more' : 'less'}-${want}`));
  }
  b.classList.add('done');
  const bins = [...pg.querySelectorAll('.bin')];
  if (bins.every((x) => onPier(pg, x).length === 2)) return speakThen(pz.dataset.done, () => solved(pg));
  if (pierFit(pg, [b])) { stop(); say('对啦！'); return; }
  b.classList.add('stuck');
  const tries = +(pz.dataset.tries || 0) + 1, [lo, hi] = [+on[0].dataset.drag, +d.dataset.drag].sort((x, y) => x - y);
  pz.dataset.tries = String(tries);
  speakThen(pierLine(pg, `stuck-${want}-${lo}-${hi}`) || pierLine(pg, 'stuck'), () => tries >= 3 && say(pierLine(pg, 'hint3')));
};
// a placed board tapped comes off (not the tap that ends the drag which put it there)
function offPier(pg, d) {
  if (pg.classList.contains('solved') || Date.now() - +(d.dataset.dropped || 0) < 400) return;
  takeOff(pg, d);
  stop();
}
function allOff(pg) {
  if (pg.classList.contains('solved')) return;
  pg.querySelectorAll('.drag.placed').forEach((d) => takeOff(pg, d));
  stop();
}
// 全部拿下来, and a placed board tapped
PUZZLE_TAP.pier = (pg, t) => {
  if (t.closest('.alloff')) { allOff(pg); return true; }
  const d = t.closest('.planks .drag.placed');
  if (d) { offPier(pg, d); return true; }
  return false;
};

// Playing puzzle 'pour' (written by pour.js), loaded after player.js. Dragged like sorting: a thing dropped on the .bin
// settles in its next slot and lights the next data-each [data-fuel] cells; every cell lit = solved. Dropped anywhere
// else it goes back home.
PUZZLE_DROP.pour = (pg, d, b) => {
  const pz = P(pg);
  if (!b) { d.style.transform = ''; return; }
  const n = pg.querySelectorAll('.drag.placed').length, [sx, sy] = b.dataset.slots.split(' ')[n].split(',').map(Number);
  d.style.transform = `translate(${sx - +d.dataset.x}px, ${sy - +d.dataset.y}px)`;
  d.classList.add('placed');
  [...pg.querySelectorAll('[data-fuel]:not(.on)')].slice(0, +pz.dataset.each).forEach((c) => c.classList.add('on'));
  if (!pg.querySelector('[data-fuel]:not(.on)')) speakThen(pz.dataset.done, () => solved(pg));
  else { stop(); say(pz.dataset.lines.split('|')[n] || '对啦！'); }
};

// Playing the puzzles 'tap', 'give', 'hold' and 'steps' (written by tap.js, give.js, hold.js, steps.js), loaded after
// player.js. This file is what the four share; tap.play.js, give.play.js and hold.play.js play their own things and
// need it. A tap / give / hold puzzle is a 'steps' puzzle of one step: the steps are in the block's data-steps.
//
// - A child who touches a thing of the first step before the voice has asked starts the puzzle at once (the reading
//   stops, the picture is put where the skipped sentences would have moved it), and that same touch counts.
// - Only the things of the step being done (.pz-now) can be touched; when the last of them is done (every .pz-tap
//   .full, every .pz-to .lit, every .pz-hold .held) the step's done is said, then the next step starts: svg.scene's
//   data-stage, stageIn / stageOut, and its intro said in words. After the last step, the page reads on.
// - The lines are said one after another, never cutting each other off (the same line is not queued twice), and
//   only while their page is open. Sound effects play next to the voice through 故事大王's sfx() (play.js) where the
//   page has it; 逻辑世界 has none, there they take their turn in the line of sounds.
// - A step left alone: after 8 s its hint is said once, in words; a give step shows a dashed arc from a treasure to
//   a place after 5 s (第 4 幕), and again when the hint button is tapped.
// - Everything done lives on the page (classes and data- on its elements), so player.js's fresh() puts it back.
//   再听一遍 on a two-step page starts it over from the first step (剧本: 一页里两步的互动).

const PZ_TYPES = ['tap', 'give', 'hold', 'steps'];
/** @param {Element | null} pz */
const pzIs = (pz) => !!pz && PZ_TYPES.includes(pz.dataset.type);
/** @param {Element} pz  @returns {PuzzleStep[]} */
const pzSteps = (pz) => JSON.parse(pz.getAttribute('data-steps') || '[]');
/** @param {Element} pz */
const pzStageNow = (pz) => +(pz.dataset.stage || 0);
/** @param {Element} pz  @returns {PuzzleStep} */
const pzStepNow = (pz) => pzSteps(pz)[pzStageNow(pz)] || { kind: 'tap' };
/** @param {Element} pg */
const pzScene = (pg) => /** @type {SVGSVGElement} */ (pg.querySelector('svg.scene'));
/** @param {Element} el */
const pzStepOf = (el) => +(el.getAttribute('data-step') || 0);
// can the child work on el now: its page is open and asking, and el belongs to the step being done
/** @param {Element} el */
function pzLive(el) {
  const pg = el.closest('.pg'), pz = pg && P(pg);
  return pzIs(pz) && pg === pages[cur] && pg.classList.contains('asking') && !pg.classList.contains('solved') && pzStepOf(el) === pzStageNow(pz);
}
// (re)start a CSS animation on el by its class c
/** @param {Element} el  @param {string} c */
const pzReplay = (el, c) => { el.classList.remove(c); el.getBoundingClientRect(); el.classList.add(c); };
// where a finger (or a point x, y of el's own drawing) is, in the drawing's units of el's parent (el may be moved by a
// transform of its own, its parent never is)
/** @param {Element} el  @param {{ clientX: number, clientY: number }} e */
const pzLocal = (el, e) => new DOMPoint(e.clientX, e.clientY).matrixTransform(/** @type {SVGGraphicsElement} */ (el.parentNode).getScreenCTM().inverse());
/** @param {Element} el  @returns {DOMPoint} the point (x, y) of el's parent, in svg.scene's own units */
function pzInScene(el, x, y) {
  const sc = /** @type {SVGGraphicsElement} */ (el).ownerSVGElement, par = /** @type {SVGGraphicsElement} */ (el.parentNode);
  return new DOMPoint(x, y).matrixTransform(par.getScreenCTM()).matrixTransform(sc.getScreenCTM().inverse());
}
// a list of words in an attribute of svg.scene (data-lit="window bridge"): add one
/** @param {Element} sc  @param {string} key */
function pzMark(sc, key, word) {
  const now = (sc.getAttribute(key) || '').split(' ').filter(Boolean);
  if (!now.includes(word)) sc.setAttribute(key, [...now, word].join(' '));
}

// ---------------- what is said ----------------
/** @type {WeakMap<Element, { q: Promise<any>, waiting: string[] }>} */
const pzVoices = new WeakMap();
// say text (or play file) once what is already waiting has been said; nothing once the page is turned or opened afresh
/** @param {Element} pg  @param {string | null} text  @param {string} [file]  @returns {Promise<any>} */
function pzSay(pg, text, file) {
  const pz = P(pg);
  if (!pz) return Promise.resolve(false);
  const v = pzVoices.get(pz) || { q: Promise.resolve(true), waiting: [] }, key = file || text;
  pzVoices.set(pz, v);
  if (!key || v.waiting.includes(key)) return v.q;
  v.waiting.push(key);
  v.q = v.q.then(() => {
    v.waiting.splice(v.waiting.indexOf(key), 1);
    if (!pz.isConnected || pg !== pages[cur]) return false;
    stop();
    return say(text, file);
  });
  return v.q;
}
// once everything waiting has been said
/** @param {Element} pg */
const pzSaid = (pg) => (pzVoices.get(P(pg)) || { q: Promise.resolve(true) }).q;
// a sound effect: next to the voice where the page has 故事大王's sfx(), else in the line
/** @param {Element} pg  @param {string} [file] */
function pzSfx(pg, file) {
  if (!file) return;
  const fx = /** @type {any} */ (window).sfx;
  if (typeof fx === 'function') fx(file, 0.8);
  else pzSay(pg, null, file);
}
// the lines a thing has in the picture (hidden .pz-line children)
/** @param {Element} el  @returns {string[]} */
const pzLines = (el) => [...el.children].filter((c) => c.classList.contains('pz-line')).map((c) => c.getAttribute('data-say'));

// ---------------- steps ----------------
PUZZLE_PLAY.tap = PUZZLE_PLAY.give = PUZZLE_PLAY.hold = PUZZLE_PLAY.steps = (pg) => pzStage(pg, 0);
// step k starts: its things can be touched, the picture changes, its intro is said
/** @param {Element} pg  @param {number} k */
function pzStage(pg, k) {
  const pz = P(pg), sc = pzScene(pg), spec = pzSteps(pz)[k] || /** @type {PuzzleStep} */ ({});
  pz.dataset.stage = String(k);
  sc.dataset.stage = String(k);
  sc.querySelectorAll('.pz-x, .pz-to').forEach((e) => e.classList.toggle('pz-now', pzStepOf(e) === k));
  sc.querySelectorAll('.pz-in, .pz-out').forEach((e) => e.classList.toggle('pz-on', +e.getAttribute('data-k') <= k));
  // the button and the words under it tell how to do this step
  const how = (k && spec.intro) || spec.hint || pz.dataset.hint, hint = spec.hint || spec.intro || pz.dataset.hint;
  const btn = /** @type {HTMLElement} */ (pz.querySelector('.hint')), text = /** @type {HTMLElement} */ (pz.querySelector('.pz-how'));
  if (btn && hint) btn.dataset.say = hint;
  if (text && how) { text.dataset.say = how; text.textContent = how; }
  if (k > 0 && spec.intro) pzSay(pg, spec.intro);
  pzIdle(pg);
}
// is the step being done finished? then its done line, then the next step (or the rest of the page)
/** @param {Element} pg */
function pzCheck(pg) {
  const pz = P(pg), sc = pzScene(pg), k = pzStageNow(pz);
  const left = sc.querySelector(`.pz-tap[data-step="${k}"]:not(.full), .pz-to[data-step="${k}"]:not(.lit), .pz-hold[data-step="${k}"]:not(.held)`);
  if (left || pz.dataset.over === String(k)) return;
  pz.dataset.over = String(k);
  const steps = pzSteps(pz), spec = steps[k] || /** @type {PuzzleStep} */ ({});
  if (spec.done) pzSay(pg, spec.done);
  pzSaid(pg).then(() => setTimeout(() => {
    if (!pz.isConnected || pg !== pages[cur] || !pg.classList.contains('asking')) return;
    if (k + 1 < steps.length) pzStage(pg, k + 1); else solved(pg);
  }, 600));
}

// ---------------- a step left alone ----------------
/** @type {WeakMap<Element, { last: number, stage: number, arc: boolean, said: boolean, busy: boolean }>} */
const pzIdles = new WeakMap();
// the child did something: the clock starts again and the arc goes
/** @param {Element} pg */
function pzTouched(pg, busy = false) {
  const s = pzIdles.get(P(pg));
  if (s) { s.last = performance.now(); s.busy = busy; s.arc = false; }
  pzScene(pg).querySelectorAll('.pz-arc').forEach((a) => a.remove());
}
/** @param {Element} pg */
function pzIdle(pg) {
  const pz = P(pg), had = pzIdles.get(pz);
  pzIdles.set(pz, { last: performance.now(), stage: pzStageNow(pz), arc: false, said: false, busy: false });
  if (had) return;   // already watching this puzzle
  const tick = () => {
    const s = pzIdles.get(pz);
    if (!pz.isConnected || !pg.classList.contains('asking') || pg.classList.contains('solved')) return;
    setTimeout(tick, 500);
    if (pg !== pages[cur]) return;
    const now = performance.now(), spec = pzStepNow(pz);
    if (s.busy) s.last = now;
    if (spec.kind === 'give' && !s.arc && now - s.last > 5000) { s.arc = true; pzArc(pg); }
    const hint = spec.hint || pz.dataset.hint;
    if (!s.said && hint && now - s.last > 8000) { s.said = true; pzSay(pg, hint); }
  };
  setTimeout(tick, 500);
}
// a dashed arc from a treasure still at home to a place still empty, over everything
/** @param {Element} pg */
function pzArc(pg) {
  const sc = pzScene(pg), k = pzStageNow(P(pg));
  const item = sc.querySelector(`.pz-give[data-step="${k}"]:not(.given):not(.up)`), to = sc.querySelector(`.pz-to[data-step="${k}"]:not(.lit)`);
  if (!item || !to || sc.querySelector('.pz-arc')) return;
  const [x, y, w, h] = to.getAttribute('data-box').split(',').map(Number);
  const a = pzInScene(item, +item.getAttribute('data-x'), +item.getAttribute('data-y')), b = pzInScene(to, x + w / 2, y + h / 2);
  const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - Math.max(70, Math.abs(b.x - a.x) * 0.3);
  const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'pz-arc');
  g.innerHTML = `<path d="${d}" fill="none" stroke="#3a1f0f" stroke-opacity=".5" stroke-width="9" stroke-dasharray="4 18" stroke-linecap="round"/>` +
    `<path d="${d}" fill="none" stroke="#fff6b0" stroke-width="6" stroke-dasharray="4 18" stroke-linecap="round"/>` +
    `<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="10" fill="#fff6b0" stroke="#3a1f0f" stroke-width="3"/>`;
  sc.appendChild(g);
}

// ---------------- starting early, starting over ----------------
// a finger on a thing of the first step before the voice has asked: the puzzle starts now, and this touch counts
// (capture: before tap.play.js, give.play.js and hold.play.js look at it)
document.addEventListener('pointerdown', (e) => {
  const pg = pages[cur], pz = pg && P(pg);
  if (!pzIs(pz) || pz.dataset.started || pg.classList.contains('solved') || !pg.contains(e.target) || !e.target.closest('.pz-x.pz-now')) return;
  stop();
  const list = beats(pg), first = list.findIndex((b) => b.classList.contains('after')), upto = first < 0 ? list.length : first;
  pg.querySelectorAll('svg.scene [data-at]').forEach((x) => { if (+x.getAttribute('data-at') < upto && !x.classList.contains('go')) x.classList.add('go', 'q'); });
  startPuzzle(pg);
}, true);
// 再听一遍 on a page of steps that has begun: from the first sentence and the first step
document.addEventListener('click', (e) => {
  const b = e.target.closest('.again'), pg = b && b.closest('.pg'), pz = pg && P(pg);
  if (!pz || pz.dataset.type !== 'steps' || !pz.dataset.started || pg.classList.contains('solved')) return;
  e.stopPropagation();
  fresh(pg);
  narrate(pg);
}, true);
// a click on one of these puzzles' things was taken care of on pointerdown; the written step says itself; the hint
// button shows the arc too (and player.js says it)
const pzClick = (pg, t) => {
  if (t.closest('.pz-how')) { stop(); say(t.closest('.pz-how').getAttribute('data-say')); return true; }
  if (t.closest('.hint') && pzStepNow(P(pg)).kind === 'give' && pg.classList.contains('asking')) { pzTouched(pg); pzArc(pg); }
  return !!t.closest('.pz-x');
};
PUZZLE_TAP.tap = PUZZLE_TAP.give = PUZZLE_TAP.hold = PUZZLE_TAP.steps = pzClick;
// no long-press menu on a thing held down
document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.pz-x')) e.preventDefault(); });
// these pages: no scrolling, zooming or selecting on the picture while the child presses and drags (steps.css)
document.querySelectorAll('.puzzle').forEach((pz) => { if (pzIs(pz)) pz.closest('.pg').classList.add('pz-hands'); });

// Playing the things to tap (tapSpot, tap.js) of a 'tap' puzzle or a tap step, loaded after player.js; needs
// steps.play.js. On the touch itself (not the click after it): it flashes (.flash, set again each time), plays its
// sound, its bubble pops up (.pz-bub), and its line is said. Tapped again: the same once more. A thing tapped many
// times (o.lines) says the next line each time; data-hits counts on it and on svg.scene, and it is .full after the
// last. Once the page has read on, a tap only flashes it (the voice is reading).
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.pz-tap'), pg = el && el.closest('.pg');
  if (!el || pg !== pages[cur] || !pzIs(P(pg))) return;
  if (pg.classList.contains('solved')) { if (el.classList.contains('hit')) pzReplay(el, 'flash'); return; }
  if (!pzLive(el)) return;
  e.preventDefault();
  pzTouched(pg);
  const lines = pzLines(el), n = lines.length, was = +el.getAttribute('data-hits'), more = was < n;
  pzReplay(el, 'flash');
  if (n > 1 && !more) return;   // a thing tapped many times, all of them done
  const hits = Math.min(n, was + 1);
  el.setAttribute('data-hits', String(hits));
  if (n > 1) pzScene(pg).setAttribute('data-hits', String(hits));
  el.classList.add('hit');
  if (el.querySelector('.pz-bubble')) pzReplay(el, 'pz-bub');
  pzSfx(pg, el.getAttribute('data-sfx'));
  pzSay(pg, lines[hits - 1]);
  if (hits >= n) { el.classList.add('full'); pzCheck(pg); }
});

// Playing puzzle 'trek' (written by trek.js; what each move does: 故事大王/龟兔赛跑/互动约定.md, TrekPuzzle in shared/types.d.ts).
// Loaded after player.js. 故事大王 has play.js too, whose sfx() plays a sound next to the voice; the published player.js
// has this file joined on before play.js, and 逻辑世界 has no play.js at all: so sfx() is looked for when a sound plays,
// and without it the sound plays on the voice's own element.
//
// What has been done lives on the page: the puzzle's data-m (the move being done), data-k (its steps walked), the parts'
// classes and transforms. A page opened again (or heard again once solved) is put back clean by player.js's fresh() and
// starts over; a timer left from before finds its puzzle gone (or the page turned) and does nothing.
//
// A child who touches a part of the first move before the voice has asked for it starts the work at once (as play.js's
// build does): the reading stops, the picture is put where the skipped sentences would have moved it, the touch counts.

const trekMoves = (/** @type {Element} */ pz) => /** @type {any[]} */ (JSON.parse(pz.getAttribute('data-moves')));
const trekSc = (/** @type {Element} */ pg) => /** @type {SVGSVGElement} */ (pg.querySelector('svg.scene'));
const trekNow = () => performance.now();
// move m of this puzzle is still being done, on the page open now
/** @param {HTMLElement} pz */
const trekCur = (pz, m) => pz.isConnected && pz.closest('.pg') === pages[cur] && +pz.dataset.m === m && !pz.dataset.over;
/** @param {Element} el  @param {string} c */
const trekReplay = (el, c) => { el.classList.remove(c); el.getBoundingClientRect(); el.classList.add(c); };
// the pieces of the picture matching sel move (.go), or are put back (on = false); one with data-sfx (and no data-at: a
// beat's sound is play.js's) plays it as it moves, data-wait seconds later
function trekGo(pg, sel, on = true) {
  trekSc(pg).querySelectorAll(sel).forEach((/** @type {SVGElement} */ e) => {
    if (on && !e.classList.contains('go') && e.dataset.sfx && e.dataset.at == null) {
      setTimeout(() => { if (e.isConnected && pg === pages[cur]) trekSfx(e.dataset.sfx); }, (+e.dataset.wait || 0) * 1000);
    }
    e.classList.toggle('go', on);
  });
}
// parts of move m (of the ones that take part in moves)
const trekParts = (pg, m) => [...trekSc(pg).querySelectorAll(`.trek[data-m="${m}"], .trek-seat[data-m="${m}"], .trek-rival[data-m="${m}"]`)];
const trekOne = (pg, cls, m) => /** @type {SVGGElement} */ (trekSc(pg).querySelector(`.${cls}[data-m="${m}"]`));

// ---------------- sound ----------------
function trekSfx(file, gain = 0.8) {
  if (!file) return;
  // @ts-ignore: sfx() is shared/tale/play.js's (it plays next to the voice); 逻辑世界 has none
  if (typeof sfx === 'function') { sfx(file, gain); return; }
  say(null, file);
}
// lines are said one after another, never cutting each other off (play.js's line(), but with a check made just before
// each line is said: still() false = skip it, e.g. a move's "what to do" once the child has done it already); nothing is
// said once the page is turned or put back
/** @type {WeakMap<Element, Promise<boolean>>} */
const trekQueue = new WeakMap();
/** @param {HTMLElement} pz  @param {string} text  @returns {Promise<boolean>} */
function trekSay(pz, text, still = () => true) {
  const q = (trekQueue.get(pz) || Promise.resolve(true)).then(() => {
    if (!text || !pz.isConnected || pz.closest('.pg') !== pages[cur] || !still()) return true;
    stop();
    return say(text);
  });
  trekQueue.set(pz, q);
  return q;
}

// ---------------- the race map: a head on [data-mapme] / [data-maprival] moves along its data-path ----------------
// t (0–1) is a point along the path: by data-ts (the t of each corner of the path, "0,0.25,0.5,0.6,1") when the head has
// it, else by length. A head placed with transform="translate(x y)" (drawn round 0,0: common.js's raceMap) is put at the
// point itself; one drawn in place, at its data-t (else at fallback t0), is moved from there.
/** @param {Element} el  @param {number} t */
function trekPathAt(el, t) {
  const pts = el.getAttribute('data-path').trim().split(/\s+/).map((p) => p.split(',').map(Number));
  if (pts.length < 2) return pts[0] || [0, 0];
  const len = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = len.reduce((a, b) => a + b, 0);
  let ts = (el.getAttribute('data-ts') || '').split(',').filter(Boolean).map(Number);
  if (ts.length !== pts.length) ts = pts.map((_, i) => len.slice(0, i).reduce((a, b) => a + b, 0) / total);
  const u = Math.min(ts[ts.length - 1], Math.max(ts[0], t));
  let i = 0;
  while (i < pts.length - 2 && u > ts[i + 1]) i++;
  const f = ts[i + 1] > ts[i] ? (u - ts[i]) / (ts[i + 1] - ts[i]) : 0;
  return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
}
/** @param {Element} pg  @param {string} sel  @param {number} t  @param {number} secs  @param {number} t0 */
function trekMapTo(pg, sel, t, secs, t0) {
  trekSc(pg).querySelectorAll(sel).forEach((/** @type {SVGGElement} */ el) => {
    if (!el.getAttribute('data-path')) return;
    if (el.dataset.t0 == null) el.dataset.t0 = el.hasAttribute('transform') ? 'place' : el.dataset.t != null ? el.dataset.t : String(t0);
    const [x, y] = trekPathAt(el, t), [x0, y0] = el.dataset.t0 === 'place' ? [0, 0] : trekPathAt(el, +el.dataset.t0);
    el.style.transition = secs ? `transform ${secs}s ease-out` : 'none';
    el.style.transform = `translate(${(x - x0).toFixed(1)}px, ${(y - y0).toFixed(1)}px)`;
    el.dataset.t = t.toFixed(3);   // where it is now
  });
}
// the head a walker moves on the race map: his own ([data-mapme]), or the rival's ([data-maprival]) when he is the hare (walker o.rival)
const trekMapSel = (/** @type {Element} */ w) => (/** @type {HTMLElement} */ (w).dataset.mapof === 'rival' ? '[data-maprival]' : '[data-mapme]');
const trekRange = (s) => (s || '').split(',').map(Number);

// ---------------- moves ----------------
PUZZLE_PLAY.trek = (pg, pz) => trekStart(pg, /** @type {HTMLElement} */ (pz), 0);
/** @param {Element} pg  @param {HTMLElement} pz  @param {number} m */
function trekStart(pg, pz, m) {
  const mv = trekMoves(pz)[m], sc = trekSc(pg);
  pz.dataset.m = String(m);
  pz.dataset.k = '0';
  ['over', 'acted', 'talking', 'queued', 'nudged', 'race', 'tap', 'busy', 'when'].forEach((k) => delete pz.dataset[k]);
  sc.querySelectorAll('.trek[data-m], .trek-seat[data-m], .trek-rival[data-m]').forEach((e) => e.classList.toggle('now', +e.dataset.m === m));
  trekGo(pg, `[data-on="${m}"]`);
  // what to do, in words: the 不会做？ button and the line under the work say it (move 0's is in the page's own sentences)
  const how = mv.intro || pz.dataset.hint, hint = /** @type {HTMLElement} */ (pz.querySelector('.hint')), told = pz.querySelector('.trek-how');
  if (hint) hint.dataset.say = how;
  if (told) { told.setAttribute('data-say', how); told.textContent = how; }
  if (m > 0 && mv.intro) trekSay(pz, mv.intro, () => trekCur(pz, m) && !pz.dataset.acted);
  if (mv.kind === 'race') trekRaceArm(pg, pz, m, mv, true);
  trekButtons(pg, pz, m, mv);
  trekIdle(pg, pz, m, mv);
}
// move m is done: its parts are done with, what waits for it moves, its lines are said; the next move starts after
// `wait` ms (once its own movement is over), or after the last move and its lines, the page reads on
/** @param {Element} pg  @param {HTMLElement} pz  @param {number} m */
function trekDone(pg, pz, m, wait = 400) {
  const moves = trekMoves(pz), mv = moves[m];
  pz.dataset.over = '1';
  trekParts(pg, m).forEach((e) => { e.classList.remove('now'); e.classList.add('was'); });
  trekGo(pg, `[data-done="${m}"]`);
  (mv.says || []).forEach((t) => trekSay(pz, t));
  if (m + 1 < moves.length) {
    setTimeout(() => { if (pz.isConnected && +pz.dataset.m === m && pz.closest('.pg') === pages[cur]) trekStart(pg, pz, m + 1); }, wait);
    return;
  }
  trekQueue.get(pz) || trekQueue.set(pz, Promise.resolve(true));
  trekQueue.get(pz).then(() => setTimeout(() => {
    if (pz.isConnected && pg === pages[cur] && pg.classList.contains('asking') && !pg.classList.contains('solved')) solved(pg);
  }, Math.max(wait, 600)));
}
// a move left alone for 8 s says once more what to do (a race has its own nudge)
function trekIdle(pg, pz, m, mv) {
  pz.dataset.last = String(trekNow());
  if (mv.kind === 'race') return;
  const check = () => {
    if (!trekCur(pz, m) || pz.dataset.nudged) return;
    const idle = trekNow() - +pz.dataset.last;
    if (pz.dataset.talking || pz.dataset.busy || trekHeld || trekReaching || trekShaking || idle < 8000) { setTimeout(check, 1000); return; }
    pz.dataset.nudged = '1';
    trekSay(pz, mv.intro || pz.dataset.hint, () => trekCur(pz, m));
  };
  setTimeout(check, 8000);
}
// the footprint button (and the walker) can be tapped: not while lines are said, nor once every step is walked; a
// tapManyButton not while lines are said, nor once its thing is full
function trekButtons(pg, pz, m, mv) {
  const off = !!pz.dataset.talking || +pz.dataset.k >= (mv.n || 0) || pz.dataset.race === 'lost';
  trekSc(pg).querySelectorAll(`.trek-btn[data-m="${m}"]:not(.trek-tapsbtn)`).forEach((b) => b.classList.toggle('off', off));
  trekSc(pg).querySelectorAll(`.trek-tapsbtn[data-m="${m}"]`).forEach((/** @type {SVGGElement} */ b) => {
    const t = trekTapsOf(pg, m, b.dataset.key);
    b.classList.toggle('off', !!pz.dataset.talking || !t || t.classList.contains('full'));
  });
}

// ---------------- step and race: a tap = one step ----------------
/** @param {Element} pg  @param {HTMLElement} pz  @param {number} m */
function trekTap(pg, pz, m, mv) {
  const w = trekOne(pg, 'trek-walker', m), k = +pz.dataset.k;
  if (!w || k >= mv.n || pz.dataset.talking || pz.dataset.race === 'lost') return;
  trekSc(pg).querySelectorAll(`.trek-btn[data-m="${m}"]`).forEach((b) => trekReplay(b, 'press'));
  pz.dataset.acted = '1';
  if (mv.kind === 'race') {
    pz.dataset.tap = String(trekNow());
    if (!pz.dataset.race) trekRival(pg, pz, m, mv);
  }
  if (mv.quietFrom != null && k >= mv.quietFrom) {   // the quiet stretch: a step only once the last one is over by `gap` ms
    if (w.classList.contains('stepping') || trekNow() - +(pz.dataset.end || 0) < (mv.gap == null ? 1000 : mv.gap)) return trekTooFast(pg, pz, mv);
    return trekStep(pg, pz, m, mv);
  }
  // tapped while he walks: he takes one more step straight after this one, however many taps came meanwhile
  if (w.classList.contains('stepping')) { pz.dataset.queued = '1'; return; }
  trekStep(pg, pz, m, mv);
}
function trekStep(pg, pz, m, mv) {
  const w = trekOne(pg, 'trek-walker', m), k = +pz.dataset.k, tries = pz.dataset.tries || '';
  const pts = w.dataset.pts.split(' ').map((p) => p.split(',').map(Number)), to = pts[Math.min(k + 1, pts.length - 1)];
  const pace = mv.paces && mv.paces[k] != null ? mv.paces[k] : mv.pace;   // paces[k]: step k's own pace
  const quiet = mv.quietFrom != null && k >= mv.quietFrom;
  w.style.transition = `transform ${pace}s ${mv.ease || 'ease-in-out'}`;
  w.style.setProperty('--pace', `${pace}s`);
  trekReplay(w, 'stepping');
  w.style.transform = `translate(${to[0] - pts[0][0]}px, ${to[1] - pts[0][1]}px)`;
  trekSc(pg).querySelectorAll(`.trek-leaf[data-m="${m}"]`).forEach((l) => l.classList.remove('ready'));
  trekSfx(quiet ? mv.quietSfx || mv.sfx : mv.sfx, quiet ? 0.5 : 0.8);
  if (w.dataset.map) { const [a, b] = trekRange(w.dataset.map); trekMapTo(pg, trekMapSel(w), a + ((b - a) * (k + 1)) / mv.n, pace, a); }
  setTimeout(() => trekStepped(pg, pz, m, mv, tries), pace * 1000);
}
function trekStepped(pg, pz, m, mv, tries) {
  if (!trekCur(pz, m) || (pz.dataset.tries || '') !== tries || pz.dataset.race === 'lost') return;
  const w = trekOne(pg, 'trek-walker', m), sc = trekSc(pg), k = +pz.dataset.k + 1;
  w.classList.remove('stepping');
  pz.dataset.k = w.dataset.k = String(k);
  pz.dataset.end = String(trekNow());
  sc.querySelectorAll(`.trek-trail[data-m="${m}"][data-i="${k - 1}"]`).forEach((e) => e.classList.add('on'));
  trekGo(pg, `[data-ev="${m}:${k}"]`);
  if (k >= mv.n) {
    trekButtons(pg, pz, m, mv);
    if (mv.kind === 'race') pz.dataset.race = 'won';   // the rival runs on, and comes in after him
    return trekDone(pg, pz, m, 500);
  }
  const quiet = mv.quietFrom != null && k >= mv.quietFrom;
  if (quiet) {
    w.classList.add('quiet');
    sc.querySelectorAll(`.trek-leaf[data-m="${m}"]`).forEach((l) => l.classList.add('shown'));
    trekLeafLater(pg, pz, m, mv, k);
  }
  const said = mv.lines && mv.lines[k];
  if (said && said.length) { delete pz.dataset.queued; trekTalk(pg, pz, m, mv, k, said); return; }
  if (quiet) { delete pz.dataset.queued; return; }   // a step in the quiet stretch is only ever a tap of its own
  if (pz.dataset.queued) { delete pz.dataset.queued; trekStep(pg, pz, m, mv); }
}
// the leaf turns green once the next quiet step may be taken
function trekLeafLater(pg, pz, m, mv, k) {
  setTimeout(() => {
    if (!trekCur(pz, m) || +pz.dataset.k !== k || pz.dataset.talking) return;
    trekSc(pg).querySelectorAll(`.trek-leaf[data-m="${m}"]`).forEach((l) => l.classList.add('ready'));
  }, mv.gap == null ? 1000 : mv.gap);
}
// lines after step k: he stops, nothing can be tapped until they are said (data-while="m:k" pieces show meanwhile)
async function trekTalk(pg, pz, m, mv, k, said) {
  const w = trekOne(pg, 'trek-walker', m);
  pz.dataset.talking = String(k);
  w.classList.add('talking');
  trekButtons(pg, pz, m, mv);
  trekGo(pg, `[data-while="${m}:${k}"]`);
  for (const t of said) await trekSay(pz, t);
  if (!trekCur(pz, m)) return;
  delete pz.dataset.talking;
  w.classList.remove('talking');
  trekGo(pg, `[data-while="${m}:${k}"]`, false);
  trekButtons(pg, pz, m, mv);
  pz.dataset.last = String(trekNow());
  if (mv.quietFrom != null && k >= mv.quietFrom) { pz.dataset.end = String(trekNow() - 99999); trekLeafLater(pg, pz, m, mv, k); }
}
// too fast in the quiet stretch: he does not step; the sleeper's ear twitches; "嘘……" at most once in 4 s
function trekTooFast(pg, pz, mv) {
  trekSc(pg).querySelectorAll('.hare-ear-twitch').forEach((e) => trekReplay(e, 'twitch'));
  trekSc(pg).querySelectorAll(`.trek-walker[data-m="${pz.dataset.m}"]`).forEach((w) => trekReplay(w, 'halt'));
  trekSfx(mv.fastSfx, 0.7);
  if (mv.tooFast && trekNow() - +(pz.dataset.fast || -1e9) >= 4000) {
    pz.dataset.fast = String(trekNow());
    trekSay(pz, mv.tooFast);
  }
}

// ---------------- the race: the rival runs on his own; first there wins ----------------
// a race (re)starts: the rival waits for the child's first tap, or (the first time only) 4 s
function trekRaceArm(pg, pz, m, mv, first) {
  const tries = String(+(pz.dataset.tries || 0) + 1);
  pz.dataset.tries = tries;
  delete pz.dataset.race;
  if (first) setTimeout(() => { if (trekCur(pz, m) && pz.dataset.tries === tries && !pz.dataset.race) trekRival(pg, pz, m, mv); }, 4000);
}
function trekRival(pg, pz, m, mv) {
  const r = trekOne(pg, 'trek-rival', m), body = r && /** @type {SVGGElement} */ (r.querySelector(':scope > .trek-body'));
  const tries = pz.dataset.tries, t0 = trekNow(), secs = mv.rivalTime || 9;
  pz.dataset.race = 'run';
  if (!pz.dataset.tap) pz.dataset.tap = String(t0);
  if (body) {
    body.style.transition = `transform ${secs}s linear`;
    body.style.transform = `translate(${r.dataset.dx}px, ${r.dataset.dy}px)`;
    r.classList.add('running');
  }
  setTimeout(() => { if (trekCur(pz, m) && pz.dataset.tries === tries && pz.dataset.race === 'run') trekLost(pg, pz, m, mv); }, secs * 1000);
  const [a, b] = r && r.dataset.map ? trekRange(r.dataset.map) : [];
  const tick = () => {
    if (!pz.isConnected || pz.dataset.tries !== tries || !(pz.dataset.race === 'run' || pz.dataset.race === 'won')) return;
    const f = Math.min(1, (trekNow() - t0) / (secs * 1000));
    if (a != null) trekMapTo(pg, '[data-maprival]', a + (b - a) * f, 0, a);
    // 2 s without a tap: "别停！再走一步！", once a race
    if (pz.dataset.race === 'run' && !pz.dataset.nudged && mv.nudge && trekNow() - +pz.dataset.tap > 2000) {
      pz.dataset.nudged = '1';
      trekSay(pz, mv.nudge, () => pz.dataset.race === 'run');
    }
    if (f < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
// the rival got there first: the whistle, the lines, and both go back to the start to run it again
function trekLost(pg, pz, m, mv) {
  pz.dataset.race = 'lost';
  delete pz.dataset.queued;
  trekButtons(pg, pz, m, mv);
  const r = trekOne(pg, 'trek-rival', m);
  if (r) r.classList.remove('running');
  trekSfx(mv.whistle, 0.8);
  trekGo(pg, '[data-lose]');
  (mv.lose || []).forEach((t) => trekSay(pz, t));
  trekQueue.get(pz).then(() => setTimeout(() => { if (trekCur(pz, m) && pz.dataset.race === 'lost') trekRaceReset(pg, pz, m, mv); }, 400));
}
function trekRaceReset(pg, pz, m, mv) {
  const sc = trekSc(pg), w = trekOne(pg, 'trek-walker', m), r = trekOne(pg, 'trek-rival', m);
  const body = r && /** @type {SVGGElement} */ (r.querySelector(':scope > .trek-body'));
  [w, body].forEach((el) => { if (el) { el.style.transition = 'none'; el.style.transform = ''; } });
  if (r) r.classList.remove('running');
  if (w) { w.classList.remove('stepping', 'quiet', 'talking'); w.dataset.k = '0'; }
  pz.dataset.k = '0';
  ['queued', 'nudged', 'tap', 'end'].forEach((k) => delete pz.dataset[k]);
  sc.querySelectorAll(`.trek-trail[data-m="${m}"]`).forEach((e) => e.classList.remove('on'));
  trekGo(pg, `[data-ev^="${m}:"]`, false);
  trekGo(pg, '[data-lose]', false);
  if (w && w.dataset.map) trekMapTo(pg, trekMapSel(w), trekRange(w.dataset.map)[0], 0.4, trekRange(w.dataset.map)[0]);
  if (r && r.dataset.map) trekMapTo(pg, '[data-maprival]', trekRange(r.dataset.map)[0], 0.4, trekRange(r.dataset.map)[0]);
  trekRaceArm(pg, pz, m, mv, false);
  trekButtons(pg, pz, m, mv);
}

// ---------------- tap, swipe ----------------
function trekTapOne(pg, pz, m, mv, el) {
  if (el.classList.contains('did')) return;
  el.classList.add('did');
  trekSfx(mv.sfx);
  trekDone(pg, pz, m, 500);
}
function trekRun(pg, pz, m, mv, el) {
  if (el.classList.contains('ran')) return;
  const body = /** @type {SVGGElement} */ (el.querySelector(':scope > .trek-body')), secs = parseFloat(body.style.transitionDuration) || 0.6;
  el.classList.add('ran');
  trekSfx(mv.sfx);
  if (el.dataset.back != null) return trekRunBack(pg, pz, m, el, body, secs);
  body.style.transform = `translate(${el.dataset.dx}px, ${el.dataset.dy}px)`;
  if (el.dataset.map) trekMapTo(pg, '[data-maprival]', +el.dataset.map, secs, 0);
  trekDone(pg, pz, m, secs * 1000 + 300);
}
// runner o.back: up to peak of the way (slowing), then he falls back (quicker and quicker); done once he is down
function trekRunBack(pg, pz, m, el, body, secs) {
  const f = +el.dataset.back, up = secs * 0.55, down = secs - up;
  pz.dataset.acted = '1';
  body.style.transition = `transform ${up}s cubic-bezier(.2, .7, .4, 1)`;
  body.style.transform = `translate(${+el.dataset.dx * f}px, ${+el.dataset.dy * f}px)`;
  setTimeout(() => {
    if (!trekCur(pz, m)) return;
    el.classList.add('falling');
    body.style.transition = `transform ${down}s cubic-bezier(.6, 0, .9, .6)`;
    body.style.transform = 'translate(0px, 0px)';
    setTimeout(() => {
      if (!trekCur(pz, m)) return;
      el.classList.remove('falling');
      el.classList.add('fell');
      trekDone(pg, pz, m, 500);
    }, down * 1000);
  }, up * 1000);
}

// ---------------- taps: each tapMany its n taps; all full = done ----------------
const trekTapsOf = (pg, m, key) => /** @type {SVGGElement} */ ([...trekSc(pg).querySelectorAll(`.trek-taps[data-m="${m}"]`)].find((t) => t.dataset.key === key));
// lines said after a tap (a shake, a stroke): .talking on el and data-while="m:tag" pieces meanwhile, nothing counts.
// Resolves false if the move is left meanwhile (the page turned, put back)
async function trekTold(pg, pz, m, mv, tag, said, el) {
  pz.dataset.talking = tag;
  el.classList.add('talking');
  trekButtons(pg, pz, m, mv);
  trekGo(pg, `[data-while="${m}:${tag}"]`);
  for (const t of said) await trekSay(pz, t);
  if (!trekCur(pz, m)) return false;
  delete pz.dataset.talking;
  el.classList.remove('talking');
  trekGo(pg, `[data-while="${m}:${tag}"]`, false);
  trekButtons(pg, pz, m, mv);
  pz.dataset.last = String(trekNow());
  return true;
}
async function trekTaps(pg, pz, m, mv, el) {
  const key = el.dataset.key, n = +el.dataset.n, k = +el.dataset.hits + 1;
  if (pz.dataset.talking || k > n || trekNow() - +(el.dataset.last || -1e9) < (mv.gap == null ? 300 : mv.gap)) return;
  el.dataset.last = String(trekNow());
  el.dataset.hits = String(k);
  pz.dataset.acted = '1';
  trekReplay(el, 'hit');
  trekSfx(mv.sfx);
  trekGo(pg, `[data-ev="${m}:${key}:${k}"]`);
  if (k >= n) el.classList.add('full');
  trekButtons(pg, pz, m, mv);
  const said = mv.lines && mv.lines[`${key}:${k}`];
  if (said && said.length && !(await trekTold(pg, pz, m, mv, `${key}:${k}`, said, el))) return;
  if (k < n) return;
  el.classList.add('heard');
  trekGo(pg, `[data-told="${m}:${key}"]`);
  if ([...trekSc(pg).querySelectorAll(`.trek-taps[data-m="${m}"]`)].every((t) => t.classList.contains('heard'))) trekDone(pg, pz, m, 400);
}
function trekTapsButton(pg, pz, m, mv, b) {
  const t = trekTapsOf(pg, m, b.dataset.key);
  if (!t || b.classList.contains('off')) return;
  trekReplay(b, 'press');
  trekTaps(pg, pz, m, mv, t);
}

// ---------------- shake, smooth: the shakes (strokes) counted up to n ----------------
// one more: k of n, at least 250 ms after the last one, never while lines are said
async function trekCount(pg, pz, m, mv, el, cls) {
  const k = +pz.dataset.k + 1;
  if (pz.dataset.talking || k > mv.n || trekNow() - +(pz.dataset.when || -1e9) < 250) return;
  pz.dataset.k = String(k);
  pz.dataset.when = String(trekNow());
  pz.dataset.acted = '1';
  trekReplay(el, cls);
  trekSfx(mv.sfx);
  if (mv.kind === 'smooth') trekSc(pg).style.setProperty('--calm', (k / mv.n).toFixed(3));
  trekGo(pg, `[data-ev="${m}:${k}"]`);
  const said = mv.lines && mv.lines[k];
  if (said && said.length && !(await trekTold(pg, pz, m, mv, String(k), said, el))) return;
  if (k >= mv.n) trekDone(pg, pz, m, 500);
}
// the finger on the shaker: the touch is one shake; then each turn left / right, 30 picture units on at least, one more
/** @type {null | { pg: Element, pz: HTMLElement, m: number, mv: any, el: SVGGElement, ext: number, dir: number }} */
let trekShaking = null;
function trekShake(e, pg, pz, m, mv, el) {
  trekShaking = { pg, pz, m, mv, el, ext: scenePoint(trekSc(pg), e).x, dir: 0 };
  el.classList.add('held');
  trekCount(pg, pz, m, mv, el, 'shook');
}
document.addEventListener('pointermove', (e) => {
  const s = trekShaking;
  if (!s) return;
  const x = scenePoint(trekSc(s.pg), e).x;
  if (s.dir * (x - s.ext) > 0) s.ext = x;   // on the same way: further
  else if (Math.abs(x - s.ext) >= 30) {     // turned back (or the first way set: the touch was counted already)
    const turned = s.dir !== 0;
    s.dir = Math.sign(x - s.ext);
    s.ext = x;
    if (turned && trekCur(s.pz, s.m)) trekCount(s.pg, s.pz, s.m, s.mv, s.el, 'shook');
  }
});
const trekShakeEnd = () => { if (trekShaking) { trekShaking.el.classList.remove('held'); trekShaking = null; } };
document.addEventListener('pointerup', trekShakeEnd);
document.addEventListener('pointercancel', trekShakeEnd);

// ---------------- reach: the head dragged along its line, the neck after it ----------------
/** @type {null | { pg: Element, pz: HTMLElement, m: number, mv: any, el: SVGGElement, from: DOMPoint, t0: number }} */
let trekReaching = null;
const trekReachLine = (/** @type {SVGGElement} */ el) => ['x', 'y', 'tx', 'ty', 'r'].map((k) => +el.dataset[k]);
// where the neck's --reach goes: the reacher's ancestor matching data-rig, else the first in the picture, else the picture
function trekRig(pg, el) {
  const sel = el.dataset.rig, sc = trekSc(pg);
  return /** @type {SVGElement} */ ((sel && (el.closest(sel) || sc.querySelector(sel))) || sc);
}
// the head at t (0–1) of its line, the neck with it
function trekReachAt(pg, el, t) {
  const [x, y, tx, ty] = trekReachLine(el), head = /** @type {SVGGElement} */ (el.querySelector(':scope > .trek-head'));
  el.dataset.t = t.toFixed(4);
  head.style.transform = `translate(${((tx - x) * t).toFixed(1)}px, ${((ty - y) * t).toFixed(1)}px)`;
  trekRig(pg, el).style.setProperty('--reach', t.toFixed(4));
}
// the head goes on its own from where it is to t in secs (slowing at the end); a new touch stops it
function trekReachTo(pg, el, t, secs) {
  const token = String(trekNow()), from = +(el.dataset.t || 0), t0 = trekNow();
  el.dataset.tween = token;
  const tick = () => {
    if (!el.isConnected || el.dataset.tween !== token) return;
    const f = Math.min(1, (trekNow() - t0) / (secs * 1000)), e = 1 - (1 - f) * (1 - f);
    trekReachAt(pg, el, from + (t - from) * e);
    if (f < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function trekReachGrab(e, pg, pz, m, mv, el) {
  if (el.classList.contains('reached')) return;
  delete el.dataset.tween;
  el.classList.add('held');
  pz.dataset.acted = '1';
  trekReaching = { pg, pz, m, mv, el, from: scenePoint(trekSc(pg), e), t0: +(el.dataset.t || 0) };
}
document.addEventListener('pointermove', (e) => {
  const h = trekReaching;
  if (!h) return;
  const [x, y, tx, ty] = trekReachLine(h.el), p = scenePoint(trekSc(h.pg), e), dx = tx - x, dy = ty - y;
  // where the finger has carried the head (from where it was grabbed), put back on the line
  const qx = dx * h.t0 + p.x - h.from.x, qy = dy * h.t0 + p.y - h.from.y;
  trekReachAt(h.pg, h.el, Math.min(1, Math.max(0, (qx * dx + qy * dy) / (dx * dx + dy * dy || 1))));
});
const trekReachLetGo = (/** @type {PointerEvent} */ e) => {
  const h = trekReaching;
  if (!h) return;
  trekReaching = null;
  const { pg, pz, m, mv, el } = h, [x, y, tx, ty, r] = trekReachLine(el), t = +(el.dataset.t || 0);
  el.classList.remove('held');
  pz.dataset.last = String(trekNow());
  if (e.type === 'pointerup' && trekCur(pz, m) && (1 - t) * Math.hypot(tx - x, ty - y) <= r) {
    el.classList.add('reached');
    trekReachTo(pg, el, 1, 0.25);
    trekSfx(mv.sfx);
    return trekDone(pg, pz, m, 500);
  }
  trekReachTo(pg, el, 0, 0.3 + t * 0.9);   // slowly back down
  if (trekCur(pz, m) && mv.miss && t > 0.02) { stop(); trekSay(pz, mv.miss); }
};
document.addEventListener('pointerup', trekReachLetGo);
document.addEventListener('pointercancel', trekReachLetGo);

// ---------------- drag: the rider onto the seat ----------------
/** @type {null | { pg: Element, pz: HTMLElement, m: number, mv: any, el: SVGGElement, from: DOMPoint }} */
let trekHeld = null;
function trekGrab(e, pg, pz, m, mv, el) {
  if (el.classList.contains('gone')) return;
  el.classList.remove('back');
  el.classList.add('held');
  trekHeld = { pg, pz, m, mv, el, from: scenePoint(trekSc(pg), e) };
}
document.addEventListener('pointermove', (e) => {
  if (!trekHeld) return;
  const p = scenePoint(trekSc(trekHeld.pg), e);
  trekHeld.el.style.transform = `translate(${p.x - trekHeld.from.x}px, ${p.y - trekHeld.from.y}px)`;
});
const trekLetGo = (/** @type {PointerEvent} */ e) => {
  if (!trekHeld) return;
  const { pg, pz, m, mv, el } = trekHeld;
  trekHeld = null;
  el.classList.remove('held');
  pz.dataset.last = String(trekNow());
  // on the screen, wherever the seat has been carried to: is the rider's middle on the seat (or near enough)?
  const s = trekOne(pg, 'trek-seat', m), ring = s && s.querySelector('.ghost'), body = el.firstElementChild;
  if (e.type === 'pointerup' && ring && trekCur(pz, m)) {
    const a = ring.getBoundingClientRect(), b = body.getBoundingClientRect();
    const dx = (b.left + b.width / 2 - (a.left + a.width / 2)) / (a.width / 2 + b.width * 0.35);
    const dy = (b.top + b.height / 2 - (a.top + a.height / 2)) / (a.height / 2 + b.height * 0.35);
    if (dx * dx + dy * dy <= 1) {
      el.classList.add('gone');
      s.classList.add('filled');
      trekSfx(mv.sfx);
      return trekDone(pg, pz, m, 500);
    }
  }
  el.classList.add('back');   // slides back home
  el.style.transform = '';
  if (trekCur(pz, m) && mv.miss) { stop(); trekSay(pz, mv.miss); }
};
document.addEventListener('pointerup', trekLetGo);
document.addEventListener('pointercancel', trekLetGo);

// ---------------- flags: their footprints light up ----------------
// the first flag (a): its footprints light one by one, each counted aloud (count[i]), then say.a; the second (b): its
// footprints light quickly with a ding each, then say.b. The second tapped first: both stretches light quickly, then say.ab.
async function trekFlag(pg, pz, m, mv, el) {
  const key = el.dataset.key, has = (k) => pz.dataset['flag' + k] === '1';
  if (has(key)) return;
  if (pz.dataset.busy) { if (!pz.dataset.want) pz.dataset.want = key; return; }   // the other flag, tapped while this one counts: it follows
  pz.dataset.busy = '1';
  pz.dataset.acted = '1';
  const prints = [...trekSc(pg).querySelectorAll(`.trek-count[data-m="${m}"]`)].sort((x, y) => +x.dataset.i - +y.dataset.i);
  const n = mv.count.length, A = prints.slice(0, n), B = prints.slice(n);
  const alive = () => trekCur(pz, m);
  const flag = (k) => trekSc(pg).querySelectorAll(`.trek-flag[data-m="${m}"][data-key="${k}"]`).forEach((f) => f.classList.add('did'));
  const quick = async (list) => {
    for (const p of list) {
      if (!alive()) return;
      p.classList.add('on');
      trekSfx(mv.sfx, 0.45);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const lit = (k) => { pz.dataset['flag' + k] = '1'; trekGo(pg, `[data-ev="${m}:${k}"]`); };
  flag(key);
  stop();
  let said = mv.say.b;
  if (key === 'a') {
    for (let i = 0; i < A.length; i++) {
      if (!alive()) return;
      A[i].classList.add('on');
      await Promise.all([trekSay(pz, mv.count[i], alive), new Promise((r) => setTimeout(r, 350))]);
    }
    said = mv.say.a;
  } else if (!has('a')) {   // the second flag first: the first stretch lights up too, then both are told together
    flag('a');
    await quick(A);
    if (alive()) lit('a');
    said = mv.say.ab;
  }
  if (key === 'b') await quick(B);
  if (!alive()) return;
  lit(key);
  delete pz.dataset.busy;
  pz.dataset.last = String(trekNow());
  // (the last flag's lines are said after the move is done: trekCur is false by then, so they only need the page)
  (said || []).forEach((t) => trekSay(pz, t, () => pz.isConnected && pz.closest('.pg') === pages[cur] && +pz.dataset.m === m));
  if (has('a') && has('b')) return trekDone(pg, pz, m, 300);
  const want = pz.dataset.want;
  if (want && !has(want)) trekQueue.get(pz).then(() => {
    const f = trekCur(pz, m) && !pz.dataset.busy && !has(want) && trekSc(pg).querySelector(`.trek-flag[data-m="${m}"][data-key="${want}"]`);
    delete pz.dataset.want;
    if (f) trekFlag(pg, pz, m, mv, /** @type {SVGGElement} */ (f));
  });
}

// ---------------- cards: an "if" film each ----------------
function trekCard(pg, pz, m, mv, el) {
  if (el.classList.contains('open')) return;
  trekSc(pg).querySelectorAll(`.trek-card.open[data-m="${m}"]`).forEach((c) => trekShut(c));
  const key = el.dataset.key, token = `${key}${trekNow()}`;
  pz.dataset.card = token;
  pz.dataset.acted = '1';
  el.parentNode.appendChild(el);   // on top of the other cards
  el.querySelectorAll('.play').forEach((p) => { p.classList.add('q'); p.classList.remove('go'); });
  el.getBoundingClientRect();
  el.querySelectorAll('.play').forEach((p) => p.classList.remove('q'));
  el.classList.add('open');
  el.getBoundingClientRect();
  el.querySelectorAll('.play').forEach((p) => p.classList.add('go'));
  trekGo(pg, `[data-ev="${m}:${key}"]`);
  stop();
  const still = () => trekCur(pz, m) && pz.dataset.card === token;
  const ic = mv.ifChoice && mv.ifChoice[key];
  const lines = [...(ic && document.documentElement.dataset['choice' + ic.page] === ic.choice ? [ic.say] : []), ...((mv.say && mv.say[key]) || [])];
  lines.forEach((t) => trekSay(pz, t, still));
  trekQueue.get(pz).then(() => {
    if (!still()) return;
    el.classList.add('seen');
    delete pz.dataset.card;
    pz.dataset.last = String(trekNow());
    setTimeout(() => { if (trekCur(pz, m) && !pz.dataset.card) trekShut(el); }, 700);
    if (!trekSc(pg).querySelector(`.trek-card[data-m="${m}"]:not(.seen)`)) setTimeout(() => trekCur(pz, m) && trekDone(pg, pz, m, 300), 1200);
  });
}
function trekShut(el) {
  el.classList.remove('open');
  el.classList.add('shutting');   // on its way back it is not touched: a finger meant for the card under it must reach that one
  setTimeout(() => el.classList.remove('shutting'), 600);
}

// ---------------- touches ----------------
// the part of the move being done that a finger touched (one may sit inside another: a rider on a runner's back)
/** @param {Element} t  @returns {[SVGGElement | null, SVGGElement | null]} [the part of move m, the innermost part touched] */
function trekHit(t, m) {
  const first = /** @type {SVGGElement} */ (t.closest('.trek.grab'));
  for (let x = first; x; x = /** @type {SVGGElement} */ (x.parentElement && x.parentElement.closest('.trek.grab'))) {
    if (+x.dataset.m === m && !x.classList.contains('was')) return [x, first];
  }
  return [null, first];
}
// a part of a move still to come wobbles
const trekNope = (/** @type {Element} */ g) => { if (g && !g.classList.contains('was')) trekReplay(g, 'nope'); };
// a touch on a part of the first move before the voice has asked for it starts the work (and counts)
document.addEventListener('pointerdown', (e) => {
  const pg = pages[cur], pz = pg && P(pg), t = /** @type {Element} */ (e.target);
  if (!pz || pz.dataset.type !== 'trek' || pz.dataset.started || pg.classList.contains('solved') || !pg.contains(t)) return;
  if (!trekHit(t, 0)[0]) return;
  stop();
  const list = beats(pg), first = list.findIndex((b) => b.classList.contains('after')), upto = first < 0 ? list.length : first;
  pg.querySelectorAll('svg.scene [data-at]').forEach((x) => { if (+x.dataset.at < upto && !x.classList.contains('go')) x.classList.add('go', 'q'); });
  startPuzzle(pg);
}, true);
document.addEventListener('pointerdown', (e) => {
  const pg = pages[cur], pz = /** @type {HTMLElement} */ (pg && P(pg)), t = /** @type {Element} */ (e.target);
  if (!pz || pz.dataset.type !== 'trek' || !pg.contains(t) || !t.closest('.trek.grab')) return;
  e.preventDefault();
  const m = +pz.dataset.m, [el, touched] = trekHit(t, m);
  if (!pg.classList.contains('asking') || pg.classList.contains('solved') || pz.dataset.over || !el) return trekNope(touched);
  const mv = trekMoves(pz)[m];
  pz.dataset.last = String(trekNow());
  if (el.matches('.trek-tapsbtn')) return mv.kind === 'taps' ? trekTapsButton(pg, pz, m, mv, el) : undefined;
  if (el.matches('.trek-walker, .trek-btn, .trek-leaf')) return mv.kind === 'step' || mv.kind === 'race' ? trekTap(pg, pz, m, mv) : undefined;
  if (el.matches('.trek-runner')) return trekRun(pg, pz, m, mv, el);
  if (el.matches('.trek-tapone')) return trekTapOne(pg, pz, m, mv, el);
  if (el.matches('.trek-rider')) return trekGrab(e, pg, pz, m, mv, el);
  if (el.matches('.trek-flag')) return trekFlag(pg, pz, m, mv, el);
  if (el.matches('.trek-card')) return trekCard(pg, pz, m, mv, el);
  if (el.matches('.trek-taps')) return trekTaps(pg, pz, m, mv, el);
  if (el.matches('.trek-shaker')) return trekShake(e, pg, pz, m, mv, el);
  if (el.matches('.trek-smooth')) return trekCount(pg, pz, m, mv, el, 'stroked');
  if (el.matches('.trek-reach')) return trekReachGrab(e, pg, pz, m, mv, el);
});
// the clicks that follow those touches are the trek's (a tap on the picture must not read a sentence); the line under the
// work says what to do
PUZZLE_TAP.trek = (pg, t) => {
  const how = /** @type {HTMLElement} */ (t.closest('.trek-how'));
  if (how) { speakThen(how.dataset.say); return true; }
  return !!t.closest('.trek.grab');
};
// heard again from the start while racing: the race waits for the child's first tap again
document.addEventListener('click', (e) => {
  const pg = e.target.closest('.pg'), pz = /** @type {HTMLElement} */ (pg && P(pg));
  if (!pz || pz.dataset.type !== 'trek' || !e.target.closest('.again') || pg.classList.contains('solved') || !pz.dataset.started) return;
  const m = +pz.dataset.m, mv = trekMoves(pz)[m];
  if (mv && mv.kind === 'race' && pz.dataset.race === 'run' && trekCur(pz, m)) trekRaceReset(pg, pz, m, mv);
}, true);
// a choice (choose: [data-choice]) is remembered for later pages, on <html data-choice4="B">
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-choice]'), pg = c && c.closest('.pg');
  if (!c || !(pg.classList.contains('asking') || pg.classList.contains('solved'))) return;
  document.documentElement.dataset['choice' + pg.dataset.pg] = c.dataset.choice;
}, true);
// the trek pages: no scrolling or zooming on their picture while the child taps and drags (trek.css)
document.querySelectorAll('.puzzle[data-type="trek"]').forEach((pz) => pz.closest('.pg').classList.add('trek-hands'));

// 故事大王 on a tablet: what the fairy tales add to the picture book's player (../reader/player.js, loaded before this file):
// sound effects that play alongside the voice, and the interactions written by tale.js —
//   build    jobs one after another (place / smear / haul / tap); the sun moves as the work gets done
//   tapwind  tap anywhere, fast: a wind meter (0–100, +12 a tap, 60 % of it leaking away every second) blows a house
//   told     one big button, tapped once the child has told a grown-up
// What an interaction has done lives in its page (classes and data- on its elements): a page opened again is put back
// clean by player.js, so it starts fresh.

// pages where the child drags or taps fast: no scrolling or zooming on their picture (tale.css .pg.hands)
document.querySelectorAll('.puzzle[data-type="build"], .puzzle[data-type="tapwind"]').forEach((pz) => pz.closest('.pg').classList.add('hands'));

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
  // the picture moves with the sentences: put everything the skipped lead-in would have moved in place at once (else
  // the wolf was still rubbing his bottom when the wind page opened early, with no blowing pose and no wind)
  skipLeadIn(pg);
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
