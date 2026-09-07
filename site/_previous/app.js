const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
if (!reducedMotion.matches && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('motion');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}
let balance = 1000, side = 'Rise', stake = 25, running = false, timer;
const get = id => document.getElementById(id);
const controls = document.querySelectorAll('[data-side], [data-stake]');
function update() {
  get('balance').textContent = balance.toLocaleString('en-US');
  get('payout').textContent = String(stake * 2);
  for (const button of controls) {
    const selected = button.dataset.side ? button.dataset.side === side : Number(button.dataset.stake) === stake;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = running;
  }
  get('seal').disabled = running || stake > balance;
}
for (const button of controls) button.addEventListener('click', () => {
  if (running) return;
  if (button.dataset.side) side = button.dataset.side;
  else stake = Number(button.dataset.stake);
  get('result').textContent = stake > balance ? 'Not enough sand. Choose a smaller stake or reset the demo.' : 'Even 50/50 demo odds. Your maximum loss is your stake.';
  update();
});
get('seal').addEventListener('click', () => {
  if (running || stake > balance) return;
  running = true;
  balance -= stake;
  const chosenSide = side, chosenStake = stake, started = Date.now();
  get('seal').textContent = 'The timeline is unfolding…';
  get('result').textContent = `${chosenSide} sealed with ${chosenStake} practice sand. The simulated window closes in 6 seconds.`;
  update();
  timer = setInterval(() => {
    const elapsed = Date.now() - started;
    get('progress').style.width = `${Math.min(100, elapsed / 60)}%`;
    if (elapsed < 6000) return;
    clearInterval(timer);
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    const outcome = random % 2 ? 'Rise' : 'Fall';
    const won = chosenSide === outcome;
    if (won) balance += chosenStake * 2;
    running = false;
    const closing = outcome === 'Rise' ? '$60,012.00' : '$59,988.00';
    get('result').textContent = won ? `${outcome} — simulated close ${closing}. A clear vision! ${chosenStake * 2} sand returned (+${chosenStake} net).` : `${outcome} — simulated close ${closing}. This timeline kept your ${chosenStake} sand. Another moment awaits.`;
    get('seal').textContent = 'Make another prophecy ↗';
    update();
  }, 100);
});
get('reset').addEventListener('click', () => {
  clearInterval(timer);
  running = false; balance = 1000; side = 'Rise'; stake = 25;
  get('progress').style.width = '0%';
  get('result').textContent = 'A fresh timeline. 1,000 practice sand restored.';
  get('seal').textContent = 'Seal my prophecy ✧';
  update();
});
update();
