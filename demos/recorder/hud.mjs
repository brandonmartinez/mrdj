// Page-injected HUD (Camtasia-style) — runs at document_start on every page.
// A synthetic cursor follows the real DOM mouse events Playwright dispatches
// (works headless, no OS cursor), with a click ripple, keystroke chips, a
// full-screen title card, and a non-blocking caption pill for scene labels.
export const HUD = () => {
  const ensure = () => {
    if (document.getElementById('__demo_cursor')) return;
    const style = document.createElement('style');
    style.textContent = `
      #__demo_cursor{position:fixed;width:24px;height:24px;border-radius:50%;
        background:rgba(255,255,255,.18);border:2px solid #fff;
        box-shadow:0 0 10px rgba(0,0,0,.6);pointer-events:none;z-index:2147483647;
        transform:translate(-50%,-50%);left:-100px;top:-100px;transition:transform .05s}
      #__demo_cursor.down{transform:translate(-50%,-50%) scale(.8)}
      #__demo_ripple{position:fixed;width:14px;height:14px;border-radius:50%;
        pointer-events:none;z-index:2147483646;transform:translate(-50%,-50%);
        border:3px solid #7c3aed;opacity:0}
      #__demo_ripple.go{animation:__r .5s ease-out}
      @keyframes __r{0%{opacity:.9;width:14px;height:14px}100%{opacity:0;width:70px;height:70px}}
      #__demo_keys{position:fixed;bottom:30px;left:50%;transform:translateX(-50%);
        display:flex;gap:8px;z-index:2147483647;pointer-events:none;
        font-family:ui-sans-serif,system-ui,sans-serif}
      #__demo_keys .k{background:rgba(18,18,18,.92);color:#fff;
        border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:9px 14px;
        font-size:18px;font-weight:600;box-shadow:0 6px 18px rgba(0,0,0,.5)}
      #__demo_title{position:fixed;inset:0;display:flex;flex-direction:column;
        align-items:center;justify-content:center;z-index:2147483645;
        background:radial-gradient(circle at 50% 40%,#1b1430,#0a0a0a 70%);
        color:#fff;font-family:ui-sans-serif,system-ui,sans-serif;
        font-size:46px;font-weight:800;opacity:0;transition:opacity .5s;
        pointer-events:none;text-align:center;padding:0 8%}
      #__demo_title .sub{font-size:20px;font-weight:500;color:#c4b5fd;margin-top:18px}
      #__demo_caption{position:fixed;top:74px;left:50%;transform:translateX(-50%) translateY(-8px);
        z-index:2147483644;pointer-events:none;opacity:0;transition:opacity .35s,transform .35s;
        background:rgba(124,58,237,.92);color:#fff;font-family:ui-sans-serif,system-ui,sans-serif;
        font-size:18px;font-weight:700;padding:10px 20px;border-radius:999px;
        box-shadow:0 8px 24px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.25)}
      #__demo_caption.show{opacity:1;transform:translateX(-50%) translateY(0)}
    `;
    document.documentElement.appendChild(style);
    const cur = document.createElement('div'); cur.id = '__demo_cursor';
    const rip = document.createElement('div'); rip.id = '__demo_ripple';
    const keys = document.createElement('div'); keys.id = '__demo_keys';
    document.documentElement.append(cur, rip, keys);
    addEventListener('mousemove', (e) => {
      cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px';
    }, true);
    addEventListener('mousedown', (e) => {
      cur.classList.add('down');
      rip.style.left = e.clientX + 'px'; rip.style.top = e.clientY + 'px';
      rip.classList.remove('go'); void rip.offsetWidth; rip.classList.add('go');
    }, true);
    addEventListener('mouseup', () => cur.classList.remove('down'), true);
    addEventListener('keydown', (e) => {
      const label = e.key === ' ' ? 'Space' : e.key;
      const chip = document.createElement('div'); chip.className = 'k'; chip.textContent = label;
      keys.appendChild(chip);
      setTimeout(() => chip.remove(), 900);
    }, true);
    window.__demoTitle = (text, sub) => {
      let t = document.getElementById('__demo_title');
      if (!t) { t = document.createElement('div'); t.id = '__demo_title';
        document.documentElement.appendChild(t); }
      t.innerHTML = `<div>${text}</div>` + (sub ? `<div class="sub">${sub}</div>` : '');
      t.style.opacity = '1';
    };
    window.__demoTitleHide = () => {
      const t = document.getElementById('__demo_title'); if (t) t.style.opacity = '0';
    };
    window.__demoCaption = (text) => {
      let c = document.getElementById('__demo_caption');
      if (!c) { c = document.createElement('div'); c.id = '__demo_caption';
        document.documentElement.appendChild(c); }
      c.textContent = text; c.classList.add('show');
    };
    window.__demoCaptionHide = () => {
      const c = document.getElementById('__demo_caption'); if (c) c.classList.remove('show');
    };
  };
  if (document.body) ensure();
  else addEventListener('DOMContentLoaded', ensure);
  new MutationObserver(ensure).observe(document.documentElement, { childList: true });
};
