---

# Usage

## 1. Iniitialize

First include the script

```html
<script src="https://pinokio.localhost/x.js"></script>
```

Then initialize the X object

```javascript
const x = new X()
```

## 2. Make API Calls

Now you can make API calls to X v2 API (Without worrying about authentication). For example:

```javascript
await x.tweet({ text: text })
```

The instantiated object `x` is equivalent to the `client.v2` object from [node-twitter-api-v2](https://github.com/PLhery/node-twitter-api-v2)

Read the full API documentation here: https://github.com/PLhery/node-twitter-api-v2/blob/master/doc/v2.md

---

# Examples

## 1. Minimal Post App

The authentication is automatically taken care of. You just need to make a POST request to the `/connect/x/api` endpoint, using ANY x.com API.

```html
<html>
  <body>
    <form>
      <input type='text' id='post'/>
      <input type='submit'>
    </form>
    <script src="https://pinokio.localhost/x.js"></script>
    <script>
      const x = new X()
      document.querySelector("form").addEventListener('submit', async (e) => {
        e.preventDefault()
        let text = document.querySelector("#post").value
        await x.tweet({ text: text })
      })
    </script>
  </body>
</html>
```

---

## 2. Upload Media App

```html
<html>
  <body>
    <form>
      <input type='file' id='media' name='media'>
      <input type='submit'>
    </form>
    <script src="https://pinokio.localhost/x.js"></script>
    <script>
      const x = new X()
      document.querySelector("form").addEventListener('submit', async (e) => {
        e.preventDefault()
        // 1. get the uploaded file
        let media = document.querySelector("#media").files[0]
        // 2. determine the media_type ("tweet_gif", "tweet_image", or "tweet_video")
        let type = media.type; // e.g., "image/png", "video/mp4", "image/gif"
        let media_category
        if (type.startsWith("image/")) {
          media_category = (type === "image/gif" ? "tweet_gif" : "tweet_image");
        } else if (type.startsWith("video/")) {
          media_category = "tweet_video"
        }
        // 3. upload media
        let media_id = await x.uploadMedia(media, { media_category })
        // 4. post the uploaded media
        let res = await x.tweet({ media: { media_ids: [media_id] }})
        console.log(res)
      })
    </script>
  </body>
</html>
```

---
