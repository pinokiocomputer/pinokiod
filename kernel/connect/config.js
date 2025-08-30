const fs = require('fs')
const path = require('path')
const fetch = require('cross-fetch')
module.exports = {
  pinokio: {
    CLIENT_ID: 'VmrH6TOG5Q68jTQKc9bP6hFl8oZ6LrkP',
    REDIRECT_URI: 'https://pinokio.localhost/connect/pinokio',
    OAUTH_URL: 'http://localhost:3001/oauth/authorize',
    TOKEN_URL: 'http://localhost:3001/oauth/token',
    CONTENT_TYPE: "application/json",
    profile: {
      url: 'http://localhost:3001/oauth/userinfo',
      cache: async (response, cwd) => {
        let url = response.avatar
        let filename = url.split("/").pop()
        const res = await fetch(url)
        await fs.promises.writeFile(path.resolve(cwd, filename), Buffer.from(await res.arrayBuffer()))
      },
      render: (response) => {
        console.log("RESPONSE", response)
        let image = response.avatar.split("/").pop()
        let imagePath = "/asset/connect/pinokio/" + image
        return {
          image: imagePath || '',
          items: [{
            key: "Username",
            val: response.username || "N/A",
          }, {
            key: "Email",
            val: response.email || "N/A"
          }]
        }
      }
    },
    SCOPE: 'openid profile email read-repos write-repos manage-repos write-discussions read-billing inference-api jobs webhooks',
  },
  huggingface: {
    CLIENT_ID: 'e90d4a4d-68a6-4c12-ae71-64756b5918de',
    REDIRECT_URI: 'https://pinokio.localhost/connect/huggingface',
    OAUTH_URL: 'https://huggingface.co/oauth/authorize',
    TOKEN_URL: 'https://huggingface.co/oauth/token',
    CONTENT_TYPE: "application/json",
    profile: {
      url: 'https://huggingface.co/api/whoami-v2',
      cache: async (response, cwd) => {
        let url = response.avatarUrl
        let filename = url.split("/").pop()
        const res = await fetch(url)
        await fs.promises.writeFile(path.resolve(cwd, filename), Buffer.from(await res.arrayBuffer()))
      },
      render: (response) => {
        let image = response.avatarUrl.split("/").pop()
        let imagePath = "/asset/connect/huggingface/" + image
        return {
          image: imagePath || '',
          items: [{
            key: "Username",
            val: response.name || "N/A",
          }, {
            key: "Full name",
            val: response.fullname || "N/A"
          }, {
            key: "Email",
            val: response.email || "N/A"
          }]
        }
      }
    },
    SCOPE: 'openid profile email read-repos write-repos manage-repos write-discussions read-billing inference-api jobs webhooks',
  },
  x: {
    CLIENT_ID: 'd2FQZ0U4NXpzYnRyS1hZeHBvbUc6MTpjaQ',
    REDIRECT_URI: 'https://pinokio.localhost/connect/x',
    OAUTH_URL: 'https://x.com/i/oauth2/authorize',
    TOKEN_URL: 'https://api.twitter.com/2/oauth2/token',
    //CONTENT_TYPE: "application/x-www-form-urlencoded",
    CONTENT_TYPE: "application/json",
    SCOPE: 'tweet.write tweet.read users.read bookmark.write bookmark.read like.write like.read media.write offline.access',
    profile: {
      url: 'https://api.twitter.com/2/users/me?user.fields=profile_image_url,username',
      cache: async (response, cwd) => {
        let url = response.data.profile_image_url
        let filename = url.split("/").pop()
        console.log("Fetching", { url, filename })
        const res = await fetch(url)
        await fs.promises.writeFile(path.resolve(cwd, filename), Buffer.from(await res.arrayBuffer()))
      },
      render: (response) => {
        let image = response.data.profile_image_url.split("/").pop()
        let imagePath = "/asset/connect/x/" + image
        return {
          image: imagePath || "",
          items: [{
            key: "Username",
            val: response.data.username || "N/A"
          }]
        }
      }
    }
  },
  google: {
    CLIENT_ID: '911627394513-75l6eumucknc8750pn5r5cog5sclndkr.apps.googleusercontent.com',
    REDIRECT_URI: 'https://pinokio.localhost/connect/google',
    OAUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
    TOKEN_URL: 'https://oauth2.googleapis.com/token',
    CONTENT_TYPE: "application/json",
    SCOPE: 'openid profile email https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/blogger https://www.googleapis.com/auth/photoslibrary https://www.googleapis.com/auth/photoslibrary.sharing https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.send',
    profile: {
      url: 'https://www.googleapis.com/oauth2/v2/userinfo',
      render: (response) => {
        return `<p><strong>Name:</strong> ${response.name || 'N/A'}</p>
<p><strong>Email:</strong> ${response.email || 'N/A'}</p>
<p><strong>Avatar:</strong> <img src="${response.picture || ''}" alt="Avatar" style="width: 40px; height: 40px; border-radius: 50%; vertical-align: middle;"></p>`
      }
    }
  },
  github: {
    CLIENT_ID: 'Ov23cthkE6o0xkxngT2r',
    REDIRECT_URI: 'https://pinokio.localhost/connect/github',
    OAUTH_URL: 'https://github.com/login/oauth/authorize',
    TOKEN_URL: 'https://github.com/login/oauth/access_token',
    SCOPE: 'user:email read:user repo delete_repo admin:org admin:public_key admin:repo_hook admin:org_hook gist notifications workflow write:packages read:packages write:discussion read:discussion project admin:gpg_key codespace',
    //CONTENT_TYPE: "application/x-www-form-urlencoded",
    CONTENT_TYPE: "application/json",
    profile: {
      url: 'https://api.github.com/user',
      render: (response) => {
        return `<p><strong>Username:</strong> ${response.login || 'N/A'}</p>
<p><strong>Name:</strong> ${response.name || 'N/A'}</p>
<p><strong>Email:</strong> ${response.email || 'N/A'}</p>
<p><strong>Avatar:</strong> <img src="${response.avatar_url || ''}" alt="Avatar" style="width: 40px; height: 40px; border-radius: 50%; vertical-align: middle;"></p>`
      }
    }
  },
  spotify: {
    CLIENT_ID: '',
    REDIRECT_URI: 'https://pinokio.localhost/connect/spotify',
    OAUTH_URL: 'https://accounts.spotify.com/authorize',
    TOKEN_URL: 'https://accounts.spotify.com/api/token',
    CONTENT_TYPE: "application/x-www-form-urlencoded",
    SCOPE: 'user-read-private user-read-email playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-library-modify user-library-read user-follow-modify user-follow-read',
    profile: {
      url: 'https://api.spotify.com/v1/me',
      render: (response) => {
        const avatarUrl = response.images && response.images.length > 0 
          ? response.images[0].url 
          : '';
        return `<p><strong>Username:</strong> ${response.id || 'N/A'}</p>
<p><strong>Display Name:</strong> ${response.display_name || 'N/A'}</p>
<p><strong>Email:</strong> ${response.email || 'N/A'}</p>
<p><strong>Avatar:</strong> <img src="${avatarUrl}" alt="Avatar" style="width: 40px; height: 40px; border-radius: 50%; vertical-align: middle;"></p>`
      }
    }
  },
  microsoft: {
    CLIENT_ID: '',
    REDIRECT_URI: 'https://pinokio.localhost/connect/microsoft',
    OAUTH_URL: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    TOKEN_URL: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    SCOPE: 'openid profile email User.Read User.ReadWrite Files.ReadWrite Sites.ReadWrite.All Mail.ReadWrite Mail.Send Calendars.ReadWrite Tasks.ReadWrite Notes.ReadWrite.All OnlineMeetings.ReadWrite',
    CONTENT_TYPE: "application/x-www-form-urlencoded",
    profile: {
      url: 'https://graph.microsoft.com/v1.0/me',
      render: (response) => {
        return `<p><strong>Name:</strong> ${response.displayName || 'N/A'}</p>
<p><strong>Email:</strong> ${response.mail || response.userPrincipalName || 'N/A'}</p>
<p><strong>Username:</strong> ${response.userPrincipalName || 'N/A'}</p>`
      }
    }
  }
}
