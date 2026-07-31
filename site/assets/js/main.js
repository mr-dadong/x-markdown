// XMD 官网 — 共享脚本

// 导航栏滚动状态
(function () {
  var nav = document.querySelector('.nav');
  if (!nav) return;
  var onScroll = function () {
    nav.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
})();

// 移动端菜单
(function () {
  var toggle = document.querySelector('.nav__toggle');
  var links = document.querySelector('.nav__links');
  if (!toggle || !links) return;
  toggle.addEventListener('click', function () {
    links.classList.toggle('is-open');
  });
  links.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () { links.classList.remove('is-open'); });
  });
})();

// 滚动揭示
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var items = document.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('is-visible'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
  items.forEach(function (el) { io.observe(el); });
})();
