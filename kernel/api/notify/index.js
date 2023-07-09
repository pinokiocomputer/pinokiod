/*
  {
    method: "notify",
    params: {
      html: <notification html>,
      href: <link location to open>,
      target: <target for window.open()>,
      features: <windowFeatures>,
      audio: <play audio if true>,
    }
  }
(*/
module.exports = async (req, ondata, kernel) => {
  ondata(req.params, "notify")
}
