class X {
  /****************************************************************************
  *
  *   Take advantage of Proxy to dynamically generate methods
  *
  *   let media_id = await x.uploadMedia(media, { media_category })
  *
  *   is equivalent to
  *
  *   let media_id = await x.request({
  *     method: "uploadMedia",
  *     params: [
  *       media,
  *       { media_category }
  *     ]
  *   })
  *
  ****************************************************************************/
  constructor(url) {
    this.url = url || "https://pinokio.localhost/connect/x/api"
    return new Proxy(this, {
      get(target, prop) {
        if (typeof target[prop] !== 'undefined') {
          return target[prop]; // Use real method/property if it exists
        }
        // Fallback to .call() for undefined methods
        return (...args) => target.request(prop, ...args);
      }
    });
  }
  async request(method, ...params) {
    console.log({ method, params })
    const formData = new FormData();
    for(let i=0; i<params.length; i++) {
      let arg = params[i]
      /*
      value.0: new Blob([])
      value.1: { a: 1, b: 2 }
      value.2: "hello world"
      type.0: "Blob"
      type.1: "Object"
      type.2: "String"
      */
      if (arg.constructor.name === "Object") {
        // regular javascript object => serialize into JSON
        formData.append(`value.${i}`, JSON.stringify(arg))
      } else if (typeof arg === "object") {
        // non Object objects => Blob, File
        formData.append(`value.${i}`, arg)
      } else {
        formData.append(`value.${i}`, arg)
      }
      formData.append(`type.${i}`, arg.constructor.name)
    }
    const response = await fetch(`${this.url}/${method}`, {
      method: "POST",
      body: formData,
    }).then((res) => {
      return res.json()
    });
    return response
  }
}
