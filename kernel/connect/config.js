const fetch = require('cross-fetch')
module.exports = {
  huggingface: {
    CLIENT_ID: 'e90d4a4d-68a6-4c12-ae71-64756b5918de',
    REDIRECT_URI: 'https://pinokio.localhost/connect/huggingface',
    OAUTH_URL: 'https://huggingface.co/oauth/authorize',
    TOKEN_URL: 'https://huggingface.co/oauth/token',
    profile: {
      url: 'https://huggingface.co/api/whoami-v2',
      render: (response) => {
        return `<p><strong>Username:</strong> ${response.name || 'N/A'}</p>
  <p><strong>Full Name:</strong> ${response.fullname || 'N/A'}</p>
  <p><strong>Email:</strong> ${response.email || 'N/A'}</p>
  <p><strong>Avatar:</strong> <img src="${response.avatarUrl || ''}" alt="Avatar" style="width: 40px; height: 40px; border-radius: 50%; vertical-align: middle;"></p>`
      }
    },
    SCOPE: 'openid profile email read-repos write-repos manage-repos',
  },
  x: {
    CLIENT_ID: 'd2FQZ0U4NXpzYnRyS1hZeHBvbUc6MTpjaQ',
    REDIRECT_URI: 'https://pinokio.localhost/connect/x',
    OAUTH_URL: 'https://x.com/i/oauth2/authorize',
    TOKEN_URL: 'https://api.twitter.com/2/oauth2/token',
    SCOPE: 'tweet.write tweet.read users.read bookmark.write bookmark.read like.write like.read media.write offline.access',
    profile: {
      url: 'https://api.twitter.com/2/users/me?user.fields=profile_image_url,username',
      render: (response) => {
        return `<p><strong>Username:</strong> ${response.data.username || 'N/A'}</p>
<p><strong>Avatar:</strong> <img src="${response.data.profile_image_url || ''}" alt="Avatar" style="width: 40px; height: 40px; border-radius: 50%; vertical-align: middle;"></p>`
      }
    }
  }
}
