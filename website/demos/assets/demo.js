/* ============================================================
   Trevo Advisors — shared demo engine
   Reads window.SiteConfig and drives the page:
     1. theme       — apply accent/dark colors from config
     2. features     — show/hide every [data-feature] section
     3. schema       — inject LocalBusiness + AggregateRating + FAQPage JSON-LD
     4. interactions — before/after slider, FAQ accordion, lead form, mobile bar
   Progressive enhancement: with JS off, all sections render and FAQ
   answers stay open (see .no-js rule in demo.css).
   ============================================================ */
(function () {
  'use strict';

  var cfg = window.SiteConfig || {};
  var features = cfg.features || {};
  var biz = cfg.business || {};

  /* drop the no-js flag so FAQ/sliders enhance */
  document.documentElement.classList.remove('no-js');

  /* ---- 1. THEME (optional overrides; pages also set :root inline) ---- */
  if (cfg.theme) {
    var root = document.documentElement;
    if (cfg.theme.accent)     root.style.setProperty('--accent', cfg.theme.accent);
    if (cfg.theme.accentDark) root.style.setProperty('--accent-dark', cfg.theme.accentDark);
    if (cfg.theme.dark)       root.style.setProperty('--dark', cfg.theme.dark);
    if (cfg.theme.light)      root.style.setProperty('--light', cfg.theme.light);
    if (cfg.theme.muted)      root.style.setProperty('--muted', cfg.theme.muted);
  }

  /* ---- 2. FEATURE TOGGLES ----
     Every optional block carries data-feature="name".
     A feature is OFF only when explicitly set false in SiteConfig.features. */
  function applyFeatures() {
    var nodes = document.querySelectorAll('[data-feature]');
    for (var i = 0; i < nodes.length; i++) {
      var name = nodes[i].getAttribute('data-feature');
      if (features[name] === false) {
        nodes[i].hidden = true;
      } else {
        nodes[i].hidden = false;
      }
    }
  }
  applyFeatures();

  /* ---- 3. JSON-LD STRUCTURED DATA ---- */
  function injectSchema() {
    var graph = [];

    var local = {
      '@context': 'https://schema.org',
      '@type': biz.schemaType || 'LocalBusiness',
      name: biz.name,
      telephone: biz.phone,
      url: (typeof location !== 'undefined' ? location.href : undefined),
      image: biz.image,
      priceRange: biz.priceRange || '$$',
      areaServed: biz.areaServed || (biz.city ? biz.city : undefined)
    };
    if (biz.city || biz.region) {
      local.address = {
        '@type': 'PostalAddress',
        addressLocality: biz.city,
        addressRegion: biz.region,
        addressCountry: 'US'
      };
    }
    if (biz.rating && biz.reviewCount) {
      local.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: String(biz.rating),
        reviewCount: String(biz.reviewCount),
        bestRating: '5'
      };
    }
    graph.push(local);

    /* FAQPage built from the visible FAQ so the two never drift */
    if (features.faq !== false) {
      var items = document.querySelectorAll('.faq-item');
      var faqs = [];
      for (var i = 0; i < items.length; i++) {
        var q = items[i].querySelector('.faq-q');
        var a = items[i].querySelector('.faq-a');
        if (q && a) {
          faqs.push({
            '@type': 'Question',
            name: q.textContent.trim(),
            acceptedAnswer: { '@type': 'Answer', text: a.textContent.trim() }
          });
        }
      }
      if (faqs.length) {
        graph.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs });
      }
    }

    var tag = document.createElement('script');
    tag.type = 'application/ld+json';
    tag.textContent = JSON.stringify(graph.length === 1 ? graph[0] : graph);
    document.head.appendChild(tag);
  }
  try { injectSchema(); } catch (e) { /* schema is non-critical */ }

  /* ---- 4a. BEFORE / AFTER SLIDER ---- */
  function wireSlider() {
    var s = document.querySelector('.ba-slider');
    if (!s) return;
    var o = s.querySelector('.ba-overlay');
    var d = s.querySelector('.ba-divider');
    if (!o || !d) return;
    var dragging = false;
    function move(x) {
      var r = s.getBoundingClientRect();
      var p = Math.max(5, Math.min(95, (x - r.left) / r.width * 100));
      o.style.width = p + '%';
      d.style.left = p + '%';
    }
    s.addEventListener('mousedown', function (e) { dragging = true; move(e.clientX); });
    window.addEventListener('mousemove', function (e) { if (dragging) move(e.clientX); });
    window.addEventListener('mouseup', function () { dragging = false; });
    s.addEventListener('touchstart', function (e) { dragging = true; move(e.touches[0].clientX); }, { passive: true });
    window.addEventListener('touchmove', function (e) { if (dragging) move(e.touches[0].clientX); }, { passive: true });
    window.addEventListener('touchend', function () { dragging = false; });
  }
  wireSlider();

  /* ---- 4b. FAQ ACCORDION ---- */
  function wireFaq() {
    var qs = document.querySelectorAll('.faq-q');
    for (var i = 0; i < qs.length; i++) {
      qs[i].addEventListener('click', function () {
        this.parentNode.classList.toggle('open');
      });
    }
  }
  wireFaq();

  /* ---- 4c. LEAD FORM (demo: no real submission) ---- */
  function wireForms() {
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      forms[i].addEventListener('submit', function (e) {
        e.preventDefault();
        alert('This is a demo site — form submission is disabled.\n\n'
            + 'On a live site this would text ' + (biz.name || 'the business')
            + ' instantly and reply to you in seconds.\n\nWant your own? Visit trevoadvisors.com');
      });
    }
  }
  wireForms();

  /* ---- 5. CONTACT CHANNEL ----
     plan: "basic" sites have no AI agent — show a floating call/text
     widget instead. plan: "nora"/"atlas"/"argus" load the Nora chat
     widget. Controlled by cfg.plan so it follows the purchased tier. */
  function wireContactChannel() {
    var plan = cfg.plan || 'nora';
    if (plan === 'basic') {
      var fc = document.getElementById('floatingContact');
      if (!fc) return;
      fc.hidden = false;
      var toggle = fc.querySelector('.fc-toggle');
      if (toggle) {
        toggle.addEventListener('click', function () { fc.classList.toggle('open'); });
      }
      return;
    }
    if (!cfg.nora || cfg.nora.enabled === false) return;
    window.NoraConfig = {
      apiUrl: cfg.nora.apiUrl || 'https://nora-agent-lemon.vercel.app',
      trade: cfg.nora.trade,
      businessName: biz.name,
      enabledTrades: cfg.nora.enabledTrades || [cfg.nora.trade],
      accentColor: (cfg.theme && cfg.theme.accent) || '#1B6CA8'
    };
    var s = document.createElement('script');
    s.src = (cfg.nora.apiUrl || 'https://nora-agent-lemon.vercel.app') + '/widget.js';
    document.body.appendChild(s);
  }
  wireContactChannel();
})();
