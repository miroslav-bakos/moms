'use strict';
(() => {
  const nav = document.querySelector('.mobile-bottom-nav');
  if (!nav) return;
  const mobile = matchMedia('(max-width: 640px)');
  let scheduled = false;
  function update() {
    scheduled = false;
    if (!mobile.matches) {
      nav.style.removeProperty('top');
      document.documentElement.style.removeProperty('--mobile-nav-height');
      return;
    }
    const viewport = window.visualViewport;
    const height = nav.getBoundingClientRect().height;
    // Floating material stays the same height; home-indicator clearance is outside it.
    const bottomGap = Math.max(8, parseFloat(getComputedStyle(nav).marginBottom) || 0);
    if (!height) return;
    document.documentElement.style.setProperty('--mobile-nav-height', `${height}px`);
    // iOS can retain a stale bottom:0 anchor after scrolling/keyboard dismissal.
    // Use a top coordinate in the visible viewport instead; retain native zoom behavior.
    if (!viewport || viewport.scale !== 1) nav.style.removeProperty('top');
    else nav.style.top = `${Math.max(0, viewport.offsetTop + viewport.height - height - bottomGap)}px`;
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, {passive:true});
  window.addEventListener('pageshow', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  mobile.addEventListener('change', schedule);
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(nav);
  schedule();
})();
