// Timesheet export buttons.
//   Save as PDF:    opens the browser's print dialog (the page has print styles in timeapp.css)
//   Download image: renders the timesheet to a PNG with html-to-image (served from /vendor/html-to-image/)
(function () {
  var sheet = document.getElementById("timesheet");
  var status = document.querySelector("[data-export-status]");
  var printButton = document.querySelector("[data-export-print]");
  var imageButton = document.querySelector("[data-export-image]");

  function say(message) {
    if (status) status.textContent = message;
  }

  if (printButton) {
    printButton.addEventListener("click", function () {
      window.print();
    });
  }

  if (imageButton && sheet) {
    imageButton.addEventListener("click", function () {
      if (!window.htmlToImage) {
        say("The image tool didn't load. Reload the page, or use Save as PDF.");
        return;
      }

      imageButton.disabled = true;
      say("Making the image…");
      window.htmlToImage
        .toPng(sheet, { pixelRatio: 2, backgroundColor: "#ffffff" })
        .then(function (dataUrl) {
          var link = document.createElement("a");
          link.href = dataUrl;
          link.download = imageButton.getAttribute("data-filename") || "timesheet.png";
          document.body.appendChild(link);
          link.click();
          link.remove();
          say("");
        })
        .catch(function () {
          say("Couldn't make the image. Try Save as PDF instead.");
        })
        .finally(function () {
          imageButton.disabled = false;
        });
    });
  }
})();
