const Reporter = () => {
  document.querySelector("#report").addEventListener("click", async (e) => {
    e.preventDefault()
    e.stopPropagation()
    let result = await Swal.fire({
      title: '<i class="fa-solid fa-bug"></i> BUG REPORT',
      html: `<div class='desc'>
  <ol>
    <li>Download log.txt</li>
    <li>Go to the <a target="_blank" href="https://discord.gg/TQdNwadtE4">Pinokio Discord</a> #support channel</li>
    <li>Create a detailed post and attach the log.txt file.</li>
  </ol>
  <div class='footer'>
    <a download class='btn' href="/pinokio/log">Download log.txt</a>
  </div>
</div>`,
      //focusConfirm: false,
      showConfirmButton: false,
      //confirmButtonText: 'Close',
    })
  })
}
