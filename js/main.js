/* ============================================================
   PERSONAL - Portfolio Scripts
   Sticky navbar, smooth scroll, scroll-spy, counter, mobile menu
   ============================================================ */
(function () {
  'use strict';

  var header = document.getElementById('header');
  var navMenu = document.getElementById('nav-menu');
  var navToggle = document.getElementById('nav-toggle');
  var navLinks = document.querySelectorAll('.nav-link');

  /* ---------- Sticky navbar ---------- */
  function onScroll() {
    if (header) {
      header.classList.toggle('scrolled', window.scrollY > 60);
    }
    updateActiveLink();
  }

  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Scroll-spy: active menu link ---------- */
  var sections = Array.prototype.slice
    .call(document.querySelectorAll('main section[id], footer[id]'))
    .map(function (sec) {
      return { el: sec, id: sec.id };
    });

  function updateActiveLink() {
    var pos = window.scrollY + header.offsetHeight + 80;
    var currentId = '';
    sections.forEach(function (item) {
      if (pos >= item.el.offsetTop) {
        currentId = item.id;
      }
    });
    navLinks.forEach(function (link) {
      var href = link.getAttribute('href');
      link.classList.toggle('active', href === '#' + currentId);
    });
  }

  /* ---------- Smooth scrolling ---------- */
  navLinks.forEach(function (link) {
    link.addEventListener('click', function (e) {
      var targetId = link.getAttribute('href');
      if (targetId && targetId.charAt(0) === '#') {
        var target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          var offset = target.getBoundingClientRect().top + window.pageYOffset - header.offsetHeight;
          window.scrollTo({ top: offset, behavior: 'smooth' });
        }
      }
      closeMenu();
    });
  });

  /* ---------- Mobile menu ---------- */
  function closeMenu() {
    if (navMenu && navMenu.classList.contains('open')) {
      navMenu.classList.remove('open');
      if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
    }
  }

  if (navToggle) {
    navToggle.addEventListener('click', function () {
      var open = navMenu.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* ---------- Counter animation on scroll ---------- */
  var counters = Array.prototype.slice.call(document.querySelectorAll('[data-count]'));

  function animateCounter(el) {
    var target = parseInt(el.getAttribute('data-count'), 10);
    var duration = 2000;
    var startTime = null;

    function format(n) {
      return n.toLocaleString('en-US');
    }

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = format(Math.floor(eased * target));
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = format(target);
      }
    }

    requestAnimationFrame(step);
  }

  if ('IntersectionObserver' in window) {
    var counterObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCounter(entry.target);
            counterObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    counters.forEach(function (c) {
      counterObserver.observe(c);
    });
  } else {
    counters.forEach(function (c) {
      c.textContent = parseInt(c.getAttribute('data-count'), 10).toLocaleString('en-US');
    });
  }

  /* ---------- Newsletter form (prevent reload) ---------- */
  var form = document.getElementById('newsletter-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('input[type="email"]');
      if (input && input.value.trim()) {
        input.value = '';
        input.blur();
      }
    });
  }

  onScroll();
})();