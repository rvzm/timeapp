// Site broadcast toast (views/partials/nav.ejs), on every page.
//   The message is rendered at page load; this polls for one that starts or is dismissed
//   while the page sits open, and asks admins for the message when they start one.
(function () {
  var toast = document.getElementById("broadcast");
  if (!toast) return;
  var message = toast.querySelector(".broadcast-message");
  var startForm = document.querySelector("[data-broadcast-start]");
  var stopForm = document.querySelector("[data-broadcast-stop]");

  // Admins only: the message comes from a prompt, into the form's hidden field.
  if (startForm) {
    startForm.addEventListener("submit", function (event) {
      var typed = window.prompt("Message to show everyone on the site:", "");
      if (typed === null || !typed.trim()) return event.preventDefault(); // cancelled or blank
      if (typed.trim().length > 200) {
        event.preventDefault();
        window.alert("Keep the broadcast under 200 characters.");
        return;
      }
      startForm.elements.message.value = typed.trim();
    });
  }

  function show(data) {
    var id = data.id === null || data.id === undefined ? "" : String(data.id);
    if (id === toast.dataset.id) return; // same broadcast (or still none): nothing to do
    toast.dataset.id = id;
    message.textContent = id ? data.message : "";
    toast.hidden = !id;
    if (startForm) startForm.hidden = !!id;
    if (stopForm) stopForm.hidden = !id;
  }

  function poll() {
    fetch("/broadcast")
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) { if (data) show(data); })
      .catch(function () {}); // server restarting, offline: try again next time
  }

  setInterval(poll, 15000);
})();
