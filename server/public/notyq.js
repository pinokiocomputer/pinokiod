class N {
  queue = []
  constructor(options) {
    this.options = Object.assign({
      maxVisible: 5,
      //layout: "bottomCenter"
      layout: "bottomRight"
      //layout: "topRight"
    }, options)
    //this.audio = new Audio("/beep.wav")
    this.audio = new Audio("/pop.mp3")
  }
  Noty(options) {
    const o = {
      ...this.options,
      ...options
    }
    const notification = new Noty(o)
    
    this.queue.push(notification)
    notification.show();

    if (!o.silent) {
      this.audio.play()
    }

    // Check if the queue exceeds the maximum limit
    if (this.queue.length > this.options.maxVisible) {
      const oldestNotification = this.queue.shift();
      oldestNotification.close();
    }

    return notification
  }
}
