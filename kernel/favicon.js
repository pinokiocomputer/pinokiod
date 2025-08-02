const axios = require('axios')
const { URL } = require("url");
const { JSDOM } = require("jsdom");

class Favicon {
  async get(pageUrl) {
    let origin;
    try {
      origin = new URL(pageUrl).origin;
    } catch {
      throw new Error("Invalid URL: " + pageUrl);
    }

    const candidates = [
      "/favicon.ico",
      "/favicon.png",
      "/assets/favicon.ico",
      "/static/favicon.ico",
      "/favicon.svg",
    ];

    // 1. Try common favicon paths first
    for (const path of candidates) {
      const fullUrl = origin + path;
      if (await this.checkImageUrl(fullUrl)) return fullUrl;
    }

    // 2. Fallback to parsing HTML
    try {
      const res = await axios.get(pageUrl, { timeout: 1000 });
      const dom = new JSDOM(res.data);
      const icons = Array.from(dom.window.document.querySelectorAll("link[rel~='icon'], link[rel='apple-touch-icon']"));

      for (const icon of icons) {
        const href = icon.getAttribute("href");
        if (!href) continue;
        const resolvedUrl = new URL(href, origin).href;
        if (await this.checkImageUrl(resolvedUrl)) return resolvedUrl;
      }
    } catch {
      // Ignore HTML errors
    }

    return null;
  }

  async checkImageUrl(url) {
    try {
      const res = await axios.head(url, { timeout: 3000 });
      return res.status === 200 && res.headers["content-type"]?.startsWith("image/");
    } catch {
      return false;
    }
  }
}
module.exports = Favicon
