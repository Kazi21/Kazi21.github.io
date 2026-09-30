/* app.js — presentation only. The page is complete without this file.
   No simulation code, no synthetic data, no network requests except health.json.
   v0.1.1: mechanism-map highlighting (hover/focus/open lights the matching target).
   v0.1.2: workflow-step fallback for browsers without CSS :has(); native CSS otherwise. */
(function () {
  "use strict";

  function initReducedMotion() {
    var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    var apply = function () { document.documentElement.classList.toggle("reduced-motion", mq.matches); };
    apply();
    if (mq.addEventListener) mq.addEventListener("change", apply);
  }

  function initNavigation() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".site-nav a[href^='#']"));
    if (!links.length || !("IntersectionObserver" in window)) return;
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.removeAttribute("aria-current"); });
        var a = byId[e.target.id];
        if (a) a.setAttribute("aria-current", "true");
      });
    }, { rootMargin: "-40% 0px -55% 0px", threshold: 0 });
    Object.keys(byId).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) observer.observe(el);
    });
  }

  function initCopyEmail() {
    var btn = document.getElementById("copy-email");
    var state = document.getElementById("copy-state");
    if (!btn || !state) return;
    var email = btn.getAttribute("data-email") || "";
    if (!email || email.indexOf("[[") === 0 || !navigator.clipboard) { btn.hidden = true; return; }
    btn.addEventListener("click", function () {
      navigator.clipboard.writeText(email).then(function () {
        state.textContent = "Copied";
        setTimeout(function () { state.textContent = ""; }, 2000);
      }, function () {
        state.textContent = "Select the address to copy it";
      });
    });
  }


  function initMechanismMap() {
    var map = document.getElementById("nature-map");
    if (!map) return;
    var cues = Array.prototype.slice.call(map.querySelectorAll(".cue"));
    var targets = Array.prototype.slice.call(map.querySelectorAll(".targets li"));
    function light(name, on) {
      targets.forEach(function (t) {
        if (t.getAttribute("data-target") === name) t.classList.toggle("is-lit", on);
      });
    }
    function refresh() {
      targets.forEach(function (t) { t.classList.remove("is-lit"); });
      cues.forEach(function (c) { if (c.open) light(c.getAttribute("data-target"), true); });
    }
    cues.forEach(function (c) {
      var name = c.getAttribute("data-target");
      c.addEventListener("mouseenter", function () { light(name, true); });
      c.addEventListener("mouseleave", function () { if (!c.open) light(name, false); refresh(); });
      c.addEventListener("focusin", function () { light(name, true); });
      c.addEventListener("focusout", function () { refresh(); });
      c.addEventListener("toggle", refresh);
    });
  }


  function initWorkflowSteps() {
    var box = document.querySelector(".practice");
    if (!box) return;
    var supportsHas = false;
    try { supportsHas = CSS.supports("selector(:has(*))"); } catch (e) { supportsHas = false; }
    if (supportsHas) return;                       /* CSS handles the state natively */
    box.classList.add("js-enhanced");
    var inputs = Array.prototype.slice.call(box.querySelectorAll(".steps input"));
    function apply() {
      inputs.forEach(function (inp, i) {
        var n = i + 1;
        var node = box.querySelector(".p-node-" + n);
        var panel = box.querySelector(".step-panel-" + n);
        if (node) node.classList.toggle("is-selected", inp.checked);
        if (panel) panel.classList.toggle("is-selected", inp.checked);
      });
    }
    inputs.forEach(function (inp) { inp.addEventListener("change", apply); });
    apply();
  }

  function runPageSelfCheck() {
    var problems = [];
    var placeholders = document.body.innerHTML.match(/\[\[[A-Z_]+\]\]/g);
    if (placeholders) problems.push("unfilled placeholders: " + placeholders.join(", "));
    if (window.fetch) {
      fetch("health.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (h) {
        if (problems.length) console.warn("[self-check]", problems.join("; "));
        console.info("[self-check] version " + h.version + " (" + h.status + ")");
      }).catch(function () { console.warn("[self-check] health.json not reachable"); });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    initReducedMotion();
    initNavigation();
    initCopyEmail();
    initMechanismMap();
    initWorkflowSteps();
    runPageSelfCheck();
  });
})();
