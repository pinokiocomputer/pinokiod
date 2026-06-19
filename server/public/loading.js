const LoadingDialog = {
  start: (msg) => {
    Swal.fire({
      html: `<i class="fa-solid fa-circle-notch fa-spin"></i> ${msg}`,
      customClass: {
        container: "loader-container",
        popup: "loader-popup",
        htmlContainer: "loader-dialog",
        footer: "hidden",
        actions: "hidden"
      }
    });
  },
  end: () => {
    Swal.close()
  }
}
