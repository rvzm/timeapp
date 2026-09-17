// Admin team page: the Add members dialog.
//   [data-open-dialog] opens it; [data-close-dialog], Esc, or a click on the backdrop closes it.
//   The tabs filter the one checkbox list: everyone not on this team, or only people on no team.
//   The submit button shows how many are ticked and stays disabled until at least one is.
(function () {
  var dialog = document.getElementById("add-members");
  if (!dialog) return;
  var tabs = dialog.querySelectorAll("[data-member-filter]");
  var rows = dialog.querySelectorAll(".member-list li");
  var empty = dialog.querySelector(".member-list-empty");
  var submit = dialog.querySelector("[data-member-submit]");

  function showTab(tab) {
    var onlyUnassigned = tab.dataset.memberFilter === "unassigned";
    var shown = 0;
    tabs.forEach(function (t) { t.setAttribute("aria-selected", String(t === tab)); });
    rows.forEach(function (row) {
      row.hidden = onlyUnassigned && !row.hasAttribute("data-unassigned");
      if (!row.hidden) shown++;
    });
    empty.hidden = shown > 0;
  }

  function updateSubmit() {
    var count = dialog.querySelectorAll('input[name="user_id"]:checked').length;
    submit.disabled = count === 0;
    submit.textContent = count ? "Add " + count + " selected" : "Add selected";
  }

  document.querySelector("[data-open-dialog]").addEventListener("click", function () {
    dialog.showModal();
  });
  dialog.querySelector("[data-close-dialog]").addEventListener("click", function () {
    dialog.close();
  });
  // A click on the dialog element itself (not its contents) is a click on the backdrop.
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) dialog.close();
  });
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () { showTab(tab); });
  });
  dialog.addEventListener("change", updateSubmit);
  updateSubmit();
})();
