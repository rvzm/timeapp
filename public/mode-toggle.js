// The top-bar light/dark button (views/partials/nav.ejs). Switches the page at once and
// saves the choice in the background (POST /theme-mode: on the account, or in a cookie
// when logged out). Without this script the button is a plain form that reloads the page.
(function () {
  var root = document.documentElement;
  var form = document.querySelector("[data-mode-toggle]");
  if (!form) return;
  var input = form.querySelector('input[name="mode"]');
  var button = form.querySelector("button");

  // The button offers the opposite of what's showing, which with "match my device"
  // only the browser knows, and which can change while the page is open.
  function sync() {
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    input.value = next;
    button.setAttribute("aria-label", "Switch to " + next + " mode");
    button.title = "Switch to " + next + " mode";
  }
  sync();
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var body = new URLSearchParams(new FormData(form));
    var mode = input.value;
    root.setAttribute("data-mode", mode); // stops "match my device" from switching it back
    root.setAttribute("data-theme", mode);
    // The page has already switched; if saving fails it just won't be remembered.
    fetch(form.action, { method: "POST", body: body, credentials: "same-origin", redirect: "manual" }).catch(function () {});
  });
})();
