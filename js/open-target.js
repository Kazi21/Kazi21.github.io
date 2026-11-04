/* Open the closed disclosures that contain the target of an in-page link or of the address (for example #ref-fu2023),
   so that citations and old section links still land on visible text. Used by evidence/models/. */
(function () {
  "use strict";
  function reveal(id) {
    var el = id && document.getElementById(id);
    if (!el || !el.closest) return null;
    var opened = false;
    for (var d = el.closest("details"); d; d = d.parentElement ? d.parentElement.closest("details") : null) {
      if (!d.open) { d.open = true; opened = true; }
    }
    return opened ? el : null;
  }
  function fromAddress() {
    var el = reveal(decodeURIComponent((location.hash || "").slice(1)));
    if (el) el.scrollIntoView();
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (a) reveal(decodeURIComponent(a.getAttribute("href").slice(1)));
  });
  window.addEventListener("hashchange", fromAddress);
  fromAddress();
})();
