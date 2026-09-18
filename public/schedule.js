// Manage Employee → Schedule: picking a shift in the list, and the three dialogs
// (Add Single Shift, Add Weekly Shift, Modify Shift).
//   - A click anywhere on a row selects it.
//   - The selected shift fills in "Selected: …" and the Modify Shift dialog.
//   - [data-open-dialog] opens a dialog; [data-close-dialog], Esc, or the backdrop closes it.
//   - A dialog marked [data-open-on-load] reopens itself after the server rejected a submit.
(function () {
  var card = document.getElementById("modify-schedule");
  if (!card) return;
  var radios = document.querySelectorAll('input[name="selected_shift"]');
  var modify = document.getElementById("modify-shift");
  var modifyForm = modify.querySelector("[data-modify-form]");
  var removeForm = modify.querySelector("[data-remove-form]");
  var ranges = document.querySelectorAll("[data-selection-range]");
  var selection = card.querySelector("[data-selection]");
  var empty = card.querySelector("[data-selection-empty]");

  function selected() {
    return document.querySelector('input[name="selected_shift"]:checked');
  }

  function showSelection() {
    var shift = selected();
    selection.hidden = !shift;
    empty.hidden = Boolean(shift);
    card.querySelectorAll("[data-needs-selection]").forEach(function (button) {
      button.disabled = !shift;
    });
    if (!shift) return;

    ranges.forEach(function (el) { el.textContent = shift.dataset.range; });
    card.querySelector("[data-selection-hours]").textContent = shift.dataset.hours;
    // The forms act on this shift; the fields start from its current times.
    modifyForm.action = "/manage/schedule/" + shift.value;
    removeForm.action = "/manage/schedule/" + shift.value + "/delete";
    modifyForm.elements.start.value = shift.dataset.start;
    modifyForm.elements.end.value = shift.dataset.end;
    modifyForm.elements.note.value = shift.dataset.note;
  }

  radios.forEach(function (radio) {
    radio.addEventListener("change", showSelection);
    var row = radio.closest("tr");
    row.addEventListener("click", function (event) {
      if (radio.disabled || event.target.closest("a, button, input")) return;
      radio.checked = true;
      showSelection();
    });
  });

  card.querySelectorAll("[data-open-dialog]").forEach(function (button) {
    button.addEventListener("click", function () {
      document.getElementById(button.dataset.openDialog).showModal();
    });
  });
  card.querySelectorAll("dialog").forEach(function (dialog) {
    dialog.querySelectorAll("[data-close-dialog]").forEach(function (button) {
      button.addEventListener("click", function () { dialog.close(); });
    });
    // A click on the dialog element itself (not its contents) is a click on the backdrop.
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });
  });

  showSelection();
  // After a rejected submit the server says which dialog to put back on screen. The
  // Modify dialog keeps the values the server sent back, so it isn't refilled here.
  var reopen = card.querySelector("dialog[data-open-on-load]");
  if (reopen) {
    if (reopen === modify) {
      var shift = selected();
      if (shift) {
        ranges.forEach(function (el) { el.textContent = shift.dataset.range; });
        modifyForm.action = "/manage/schedule/" + shift.value;
        removeForm.action = "/manage/schedule/" + shift.value + "/delete";
      }
    }
    reopen.showModal();
  }
})();
