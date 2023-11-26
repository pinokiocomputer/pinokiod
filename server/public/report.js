const Reporter = () => {
  document.querySelector("#report").addEventListener("click", async (e) => {
    e.preventDefault()
    e.stopPropagation()
    let result = await Swal.fire({
      title: '<i class="fa-solid fa-bug"></i> BUG REPORT',
      didOpen: () => {
        let btn = Swal.getPopup().querySelector('#genlog')
        let btn2 = Swal.getPopup().querySelector('.btn')
        btn.addEventListener("click", (e) => {
          e.target.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>'
          fetch("/pinokio/log", {
            method: "post",
          }).then((res) => {
            console.log("RES", res)
            btn2.classList.remove("hidden") 
            btn.classList.add("hidden")
          })
        })
      },
      html: `<div class='desc'>
  <ol>
    <li>Download logs.zip</li>
    <li>Go to the <a target="_blank" href="https://discord.gg/TQdNwadtE4">Pinokio Discord</a> #support channel</li>
    <li>Create a detailed post and attach the logs.zip file.</li>
  </ol>
  <div class='footer'>
    <a download class='hidden btn' href="/pinokio/logs.zip"><i class="fa-solid fa-download"></i> Download logs.zip</a>
    <div id='genlog' class='btn'>Generate logs.zip</div>
  </div>
</div>`,
      //focusConfirm: false,
      showConfirmButton: false,
      //confirmButtonText: 'Close',
    })
  })
}
