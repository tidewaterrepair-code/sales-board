// Confetti + sound effects. Because closing deals should feel amazing.
(function () {
  const canvas = document.getElementById('confetti');
  const ctx = canvas.getContext('2d');
  let parts = [];
  let raf = null;
  const COLORS = ['#ffd23f', '#3ee6a8', '#4f8cff', '#ff5c8a', '#c065ff', '#ff9f43'];

  function resize() { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; }
  addEventListener('resize', resize);
  resize();

  function burst(count = 160) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const w = canvas.width; const h = canvas.height;
    for (let i = 0; i < count; i++) {
      parts.push({
        x: w / 2 + (Math.random() - 0.5) * w * 0.3,
        y: h * 0.35,
        vx: (Math.random() - 0.5) * 22 * devicePixelRatio,
        vy: (-Math.random() * 18 - 6) * devicePixelRatio,
        s: (6 + Math.random() * 8) * devicePixelRatio,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        c: COLORS[i % COLORS.length],
        life: 0,
      });
    }
    if (!raf) tick();
  }

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts = parts.filter((p) => p.life < 220 && p.y < canvas.height + 50);
    for (const p of parts) {
      p.life++;
      p.vy += 0.45 * devicePixelRatio;
      p.vx *= 0.99;
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    raf = parts.length ? requestAnimationFrame(tick) : (ctx.clearRect(0, 0, canvas.width, canvas.height), null);
  }

  let audio = null;
  function tone(freq, start, dur, type = 'sine', vol = 0.18) {
    const t = audio.currentTime + start;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function sound(kind) {
    try {
      if (localStorage.getItem('sb_mute') === '1') return;
    } catch { /* storage blocked */ }
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (kind === 'cash') { // cha-ching!
        tone(1318, 0, 0.12, 'square', 0.08); tone(1760, 0.08, 0.5, 'square', 0.08);
        [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25 + i * 0.09, 0.4, 'triangle', 0.15));
      } else if (kind === 'point') {
        tone(880, 0, 0.08, 'triangle', 0.12); tone(1320, 0.07, 0.15, 'triangle', 0.12);
      } else if (kind === 'team') {
        tone(660, 0, 0.12, 'sine', 0.12); tone(990, 0.1, 0.25, 'sine', 0.12);
      }
    } catch { /* audio unavailable */ }
  }

  window.FX = { burst, sound };
})();
