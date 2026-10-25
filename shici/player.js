// Tap to hear, and pictures that move with the words. All recordings are made by tools/make_poem_sounds.py
// into the poem's audio/ folder; audio/voice.js says which text plays which file (VOICE_FILES) and, for a line read
// in its rhythm ("独在，异乡，为异客。"), when each chunk starts (VOICE_MARKS, seconds).
//
// Everything it needs is in the page itself (the published pages have no drawing code):
//   [data-say="…"]                 plays the recording of that text
//   .verse[data-line=L][data-rhythm]  line L, read in its rhythm ("独在，异乡，为异客。"); its chunks are .chunk[data-i]
//   .play-line[data-line=L]        reads line L; the scene and the chunks of line L inside the same .stage move along
//   .play-poem[data-title]         the title, then every line in the same .stage, each with its own scene
//   .play-song[data-file][data-cues]  plays a song; cues = [[seconds, line], …]: the scene of the line being sung shows and moves
//   .hide-level[data-level=N]      遮字背: hides the characters with class hN in the .recite block; tap one to see it
// A scene is an <svg class="scene" data-line=L>; it gets the classes c0, c1, c2… as chunk 0, 1, 2… is read
// (poem.css turns those into the movement), and "done" when the line is over.
// The playing itself (one sound at a time, the iPad fixes) is ../shared/audio.js, loaded before this file.

useVoice('zh-CN', 0.8);   // not recorded yet: the device's Chinese voice, a little slower for poems
const marks = () => (typeof VOICE_MARKS !== 'undefined' ? VOICE_MARKS : {});

// the timers of the lit-up chunks and the moving scenes stop with the sound
let timers = [];
onStop.push(() => {
  timers.forEach(clearTimeout);
  timers = [];
  document.querySelectorAll('.chunk.on, .song-line.on').forEach((e) => e.classList.remove('on'));
});
const later = (ms, fn) => timers.push(setTimeout(fn, ms));

// put a scene back to its start, without the movement showing
function resetScene(svgEl) {
  if (!svgEl) return;
  svgEl.classList.add('quick');
  [...svgEl.classList].filter((c) => /^c\d$|^done$/.test(c)).forEach((c) => svgEl.classList.remove(c));
  svgEl.getBoundingClientRect();
  svgEl.classList.remove('quick');
}

// read line L inside stage: chunk i lights up and the scene gets class ci when the voice reaches it
async function playLine(stage, L) {
  const text = stage.querySelector(`.verse[data-line="${L}"]`).dataset.rhythm;
  const scene = stage.querySelector(`svg.scene[data-line="${L}"]`);
  const chunks = [...stage.querySelectorAll(`.chunk[data-line="${L}"]`)];
  resetScene(scene);
  const starts = marks()[text] || chunks.map((_, i) => i * 1.1);
  starts.forEach((t, i) => later(t * 1000, () => {
    chunks.forEach((c) => c.classList.toggle('on', +c.dataset.i === i));
    if (scene) scene.classList.add(`c${i}`);
  }));
  const ok = await say(text);
  chunks.forEach((c) => c.classList.remove('on'));
  if (ok && scene) scene.classList.add('done');
  return ok;
}

async function playPoem(stage, btn) {
  stop();
  const id = playId;
  nowEl = btn; btn.classList.add('is-playing');
  stage.querySelectorAll('svg.scene').forEach(resetScene);
  if (!(await say(btn.dataset.title))) return;
  const lines = [...new Set([...stage.querySelectorAll('.verse[data-line]')].map((v) => +v.dataset.line))];
  for (const L of lines) {
    const card = stage.querySelector(`.line-card[data-line="${L}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!(await pause(350)) || !(await playLine(stage, L))) return;
  }
  stop();
}

// a song with the scenes
function playSong(stage, btn) {
  stop();
  const id = playId, cues = JSON.parse(btn.dataset.cues);
  nowEl = btn; btn.classList.add('is-playing');
  const a = audioEl;
  const scenes = [...stage.querySelectorAll('svg.scene')], lines = [...stage.querySelectorAll('.song-line')];
  let shown = -1;
  const show = (k) => {
    const [t, L] = cues[k], next = cues[k + 1] ? cues[k + 1][0] : a.duration || t + 3;
    const step = Math.min(1.1, (next - t) / 3) * 1000;
    scenes.forEach((s) => s.classList.toggle('shown', +s.dataset.line === L));
    lines.forEach((e) => e.classList.toggle('on', +e.dataset.line === L));
    const sc = scenes.find((s) => +s.dataset.line === L);
    resetScene(sc);
    const n = stage.querySelectorAll(`.song-line[data-line="${L}"]`)[0].dataset.chunks;
    for (let i = 0; i < n; i++) later(i * step, () => sc.classList.add(`c${i}`));
  };
  const tick = () => {
    if (id !== playId) return;
    const k = cues.findLastIndex(([t]) => a.currentTime >= t - 0.05);
    if (k !== shown && k >= 0) { shown = k; show(k); }
    requestAnimationFrame(tick);
  };
  // the scenes start moving when the song does (a "playing" left over from a refused start finds this play cancelled)
  a.addEventListener('playing', tick, { once: true });
  say(null, btn.dataset.file).then((ok) => { if (ok) stop(); });
}

document.addEventListener('click', (e) => {
  const t = e.target;
  // a character is hidden at level N when it has the class hN (poem.css draws it as an empty box)
  const ch = t.closest('.recite .ch'), lv = ch && ch.closest('.recite').dataset.level;
  if (ch && lv && lv !== '0' && ch.classList.contains(`h${lv}`)) { ch.classList.toggle('open'); return; }
  const level = t.closest('.hide-level');
  if (level) {
    const box = level.closest('.stage').querySelector('.recite');
    const same = box.dataset.level === level.dataset.level;
    box.dataset.level = same ? '0' : level.dataset.level;
    box.querySelectorAll('.ch.open').forEach((c) => c.classList.remove('open'));
    level.parentElement.querySelectorAll('.hide-level').forEach((b) => b.classList.toggle('on', !same && b === level));
    return;
  }
  const el = t.closest('.play-song, .play-poem, .play-line, [data-say], [data-file]');
  if (!el) return;
  if (el === nowEl) { stop(); return; }   // tap again to stop
  const stage = el.closest('.stage') || document.body;
  if (el.classList.contains('play-song')) return playSong(stage, el);
  if (el.classList.contains('play-poem')) return playPoem(stage, el);
  stop();
  nowEl = el; el.classList.add('is-playing');
  const run = el.classList.contains('play-line') ? playLine(stage, +el.dataset.line)
    : el.dataset.file ? say(null, el.dataset.file) : say(el.dataset.say);
  run.then((ok) => { if (ok) stop(); });
});
