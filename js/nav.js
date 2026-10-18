/* nav.js — compact section menu on narrow screens (all pages). Without JavaScript the full menu stays visible. */
(function () {
  "use strict";
  var btn = document.querySelector(".nav-toggle"), nav = document.getElementById("site-nav");
  if (!btn || !nav || !window.matchMedia) return;
  var mq = window.matchMedia("(max-width: 640px)");
  function setOpen(open) {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    nav.classList.toggle("is-collapsed", !open);
  }
  function sync() {
    if (mq.matches) { btn.hidden = false; setOpen(btn.getAttribute("aria-expanded") === "true"); }
    else { btn.hidden = true; nav.classList.remove("is-collapsed"); btn.setAttribute("aria-expanded", "false"); }
  }
  btn.addEventListener("click", function () { setOpen(btn.getAttribute("aria-expanded") !== "true"); });
  nav.addEventListener("click", function (e) { if (mq.matches && e.target.closest && e.target.closest("a")) setOpen(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && mq.matches && btn.getAttribute("aria-expanded") === "true") { setOpen(false); btn.focus(); }
  });
  if (mq.addEventListener) mq.addEventListener("change", sync); else if (mq.addListener) mq.addListener(sync);
  sync();
})();
