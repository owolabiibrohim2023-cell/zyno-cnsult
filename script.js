/* ZYNO-CONSULT GLOBAL CONCEPT LTD
   Part 1: header (mobile menu, services dropdown, scroll shadow, active link)
   Part 2: loader (logo rolls in like a wheel, then the screen lifts away) */

/* ---------- Part 1: header ---------- */
(() => {
  const root = document.documentElement;
  const header = document.getElementById('siteHeader');
  const burger = document.getElementById('burger');
  const closeBtn = document.getElementById('navClose');
  const scrim = document.getElementById('navScrim');
  const panel = document.getElementById('navPanel');
  if (!header || !burger || !panel) return;

  const mobileQuery = window.matchMedia('(max-width: 1000px)');

  function setMenu(open) {
    const wasOpen = root.classList.contains('menu-open');
    if (open === wasOpen) return;
    root.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (open) closeBtn.focus({ preventScroll: true });
    else burger.focus({ preventScroll: true });
  }

  burger.addEventListener('click', () => setMenu(true));
  closeBtn.addEventListener('click', () => setMenu(false));
  scrim.addEventListener('click', () => setMenu(false));

    // Close the menu after tapping a link (works for links generated later too)
  panel.addEventListener('click', (e) => {
    if (!e.target.closest('a')) return;
    if (mobileQuery.matches) root.classList.remove('menu-open');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Open menu');
  });
  // Services dropdown: works with click/tap and keyboard
  const menuItems = panel.querySelectorAll('.has-menu');
  menuItems.forEach((item) => {
    const btn = item.querySelector('.submenu-btn');
    btn.addEventListener('click', () => {
      const open = !item.classList.contains('is-open');
      item.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
  });

  function closeSubmenus() {
    menuItems.forEach((item) => {
      item.classList.remove('is-open');
      item.querySelector('.submenu-btn').setAttribute('aria-expanded', 'false');
    });
  }

  // Click outside closes the desktop dropdown
  document.addEventListener('click', (e) => {
    if (!mobileQuery.matches && !e.target.closest('.has-menu')) closeSubmenus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSubmenus();
      setMenu(false);
    }
  });

  // Leaving the mobile layout closes the drawer
  mobileQuery.addEventListener('change', () => {
    root.classList.remove('menu-open');
    burger.setAttribute('aria-expanded', 'false');
    closeSubmenus();
  });

  // Shadow once the page is scrolled
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Highlight the link for the section in view (only sections that exist)
  const topLinks = [...panel.querySelectorAll('.nav__link')];
  const setActive = (id) => {
    topLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === '#' + id));
  };

    const sections = ['about', 'services', 'products', 'why-us', 'contact']
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((section) => observer.observe(section));

    window.addEventListener('scroll', () => {
      if (window.scrollY < 80) setActive('top');
    }, { passive: true });
  }
})();

/* ---------- Part 2: loader ---------- */
(() => {
  const root = document.documentElement;
  const loader = document.getElementById('loader');

  if (!loader) {
    root.classList.remove('is-loading');
    root.classList.add('is-ready');
    return;
  }

  const logo = loader.querySelector('.loader__logo');
  const bar = loader.querySelector('.loader__bar i');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ROLL_MS = 1600;                       // how long the roll takes
  const MIN_MS = reduceMotion ? 300 : 2600;   // shortest time the loader stays

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const pageLoaded = new Promise((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve, { once: true });
  });

  const fontsReady = document.fonts
    ? Promise.race([document.fonts.ready, wait(2500)])
    : Promise.resolve();

  async function rollLogo() {
    // Make sure the image is ready so it never pops in mid-roll
    try { await logo.decode(); } catch (e) { /* ignore */ }

    if (reduceMotion) {
      logo.style.transform = 'none';
      return;
    }

    const radius = logo.getBoundingClientRect().width / 2;
    const distance = window.innerWidth / 2 + radius * 2;    // start fully off-screen
    const degrees = (distance / radius) * (180 / Math.PI);  // rolling without slipping

    const anim = logo.animate(
      [
        { transform: `translateX(${-distance}px) rotate(${-degrees}deg)` },
        { transform: 'translateX(0) rotate(0deg)' }
      ],
      { duration: ROLL_MS, easing: 'cubic-bezier(.22, .7, .2, 1)', fill: 'both' }
    );
    await anim.finished.catch(() => {});
  }

  rollLogo();

  if (bar && bar.animate) {
    bar.animate(
      [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: MIN_MS, easing: 'cubic-bezier(.5, 0, .2, 1)', fill: 'forwards' }
    );
  }

  Promise.all([pageLoaded, fontsReady, wait(MIN_MS)]).then(async () => {
    loader.classList.add('is-leaving');                // screen lifts away
    await wait(reduceMotion ? 0 : 520);
    root.classList.remove('is-loading');               // unlock scroll
    root.classList.add('is-ready');                    // header and hero come in
    await wait(1100);
    loader.remove();
  });
})();

/* ---------- Part 3: About section (scroll reveal + card spotlight) ---------- */
(() => {
  // Reveal each [data-reveal] block once, when it scrolls into view
  const targets = document.querySelectorAll('[data-reveal]');
  const reveal = (el) => el.classList.add('is-in');

  if (targets.length) {
    if (!('IntersectionObserver' in window)) {
      targets.forEach(reveal);
    } else {
      const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            reveal(entry.target);
            obs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
      targets.forEach((el) => observer.observe(el));
    }
  }

  // Glow that follows the cursor inside each service card
  if (window.matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('.card').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
        card.style.setProperty('--my', (e.clientY - rect.top) + 'px');
      });
    });
  }
})();
/* ---------- Part 4: Services (prepare the line drawings) ---------- */
(() => {
  document.querySelectorAll('.svc__art svg').forEach((svg) => {
    svg.querySelectorAll('path, rect, circle, line').forEach((shape, i) => {
      shape.setAttribute('pathLength', '1');                      // lets every shape "draw" from 0 to 100%
      shape.style.transitionDelay = (0.25 + i * 0.07) + 's';      // shapes draw one after another
    });
  });
})();
/* =========================================================
   PREMIUM WHY US + CONTACT
   ========================================================= */

(() => {

  /* ---------------------------------------------
     Intersection reveal
     --------------------------------------------- */

  const revealItems = document.querySelectorAll(
    '#why-us [data-reveal], #contact [data-reveal]'
  );

  const reduceMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;


  if (
    revealItems.length &&
    'IntersectionObserver' in window &&
    !reduceMotion
  ) {

    const observer = new IntersectionObserver(
      (entries, obs) => {

        entries.forEach((entry) => {

          if (!entry.isIntersecting) return;

          entry.target.classList.add('is-in');

          obs.unobserve(entry.target);

        });

      },
      {
        threshold: 0.15,
        rootMargin: '0px 0px -8% 0px'
      }
    );


    revealItems.forEach((element) => {
      observer.observe(element);
    });

  } else {

    revealItems.forEach((element) => {
      element.classList.add('is-in');
    });

  }


  /* ---------------------------------------------
     RC number subtle count-up
     --------------------------------------------- */

  const counter = document.querySelector(
    '.why-pro__rc strong'
  );

  if (counter && !reduceMotion) {

    const target = Number(
      counter.dataset.count || 8651327
    );

    let started = false;

    const counterObserver = new IntersectionObserver(
      (entries, obs) => {

        entries.forEach((entry) => {

          if (!entry.isIntersecting || started) return;

          started = true;

          const duration = 1400;
          const start = performance.now();

          const animate = (now) => {

            const progress = Math.min(
              (now - start) / duration,
              1
            );

            const eased =
              1 - Math.pow(1 - progress, 4);

            const current = Math.floor(
              target * eased
            );

            counter.textContent =
              String(current);

            if (progress < 1) {
              requestAnimationFrame(animate);
            }

          };

          requestAnimationFrame(animate);

          obs.unobserve(entry.target);

        });

      },
      {
        threshold: .7
      }
    );

    counterObserver.observe(counter);

  }


  /* ---------------------------------------------
     Premium card cursor tilt
     --------------------------------------------- */

  const cards = document.querySelectorAll(
    '.why-pro__card, .why-pro__main'
  );


  if (
    window.matchMedia('(hover:hover)').matches &&
    !reduceMotion
  ) {

    cards.forEach((card) => {

      card.addEventListener('pointermove', (event) => {

        const rect =
          card.getBoundingClientRect();

        const x =
          (event.clientX - rect.left) /
          rect.width;

        const y =
          (event.clientY - rect.top) /
          rect.height;

        const rotateY =
          (x - .5) * 4;

        const rotateX =
          (.5 - y) * 4;

        card.style.transform =
          `translateY(-6px) perspective(900px)
           rotateX(${rotateX}deg)
           rotateY(${rotateY}deg)`;

      });


      card.addEventListener('pointerleave', () => {

        card.style.transform = '';

      });

    });

  }


  /* ---------------------------------------------
     Contact form → WhatsApp
     --------------------------------------------- */

  const form =
    document.getElementById('enquiryFormPro');

  const status =
    document.getElementById('proFormStatus');


  if (!form) return;


  form.addEventListener('submit', (event) => {

    event.preventDefault();


    if (!form.checkValidity()) {

      form.reportValidity();

      if (status) {
        status.textContent =
          'Please complete the required fields.';
      }

      return;

    }


    const data =
      new FormData(form);


    const name =
      String(data.get('name') || '').trim();

    const phone =
      String(data.get('phone') || '').trim();

    const service =
      String(data.get('service') || '').trim();

    const message =
      String(data.get('message') || '').trim();


    const whatsappMessage = [
      'Hello ZYNO-CONSULT,',
      '',
      `My name is ${name}.`,
      `I am interested in: ${service}.`,
      phone
        ? `My phone number is: ${phone}.`
        : '',
      '',
      message
    ]
      .filter(Boolean)
      .join('\n');


    const whatsappURL =
      'https://wa.me/2348080091300?text=' +
      encodeURIComponent(whatsappMessage);


    if (status) {
      status.textContent =
        'Opening WhatsApp...';
    }


    const newWindow =
      window.open(
        whatsappURL,
        '_blank',
        'noopener,noreferrer'
      );


    if (!newWindow) {
      window.location.href =
        whatsappURL;
    }


    form.reset();

  });


})();



/* =========================================================
   ZYNO PREMIUM FOOTER JS
========================================================= */

(() => {

  const footer = document.querySelector('.zy-footer');

  if (!footer) return;


  /* -----------------------------------------
     YEAR
  ----------------------------------------- */

  const year = document.getElementById('zy-footer-year');

  if (year) {
    year.textContent = new Date().getFullYear();
  }


  /* -----------------------------------------
     FOOTER REVEAL
  ----------------------------------------- */

  const revealFooter = new IntersectionObserver(
    (entries) => {

      entries.forEach((entry) => {

        if (entry.isIntersecting) {

          footer.classList.add('is-visible');

          revealFooter.unobserve(footer);

        }

      });

    },
    {
      threshold: 0.12
    }
  );

  revealFooter.observe(footer);


  /* -----------------------------------------
     BACK TO TOP
  ----------------------------------------- */

  const backTop = footer.querySelector('.zy-footer__back-top');

  if (backTop) {

    backTop.addEventListener('click', (event) => {

      event.preventDefault();

      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });

    });

  }


  /* -----------------------------------------
     MAGNETIC CTA
  ----------------------------------------- */

  const ctaButton =
    footer.querySelector('.zy-footer__cta-button');

  if (ctaButton && window.matchMedia('(pointer: fine)').matches) {

    ctaButton.addEventListener('mousemove', (event) => {

      const rect = ctaButton.getBoundingClientRect();

      const x =
        event.clientX -
        rect.left -
        rect.width / 2;

      const y =
        event.clientY -
        rect.top -
        rect.height / 2;

      ctaButton.style.transform =
        `translate(${x * 0.06}px, ${y * 0.06}px)`;

    });


    ctaButton.addEventListener('mouseleave', () => {

      ctaButton.style.transform = '';

    });

  }

})();
/* ---------- Part 6: show the Admin button only in browsers that have used the admin ---------- */
(() => {
  const btn = document.querySelector('.btn--admin');
  if (!btn) return;
  let known = false;
  try { known = !!localStorage.getItem('zyno_admin'); } catch (e) { /* ignore */ }
  btn.hidden = !known;
})();