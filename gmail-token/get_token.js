// get_token.js
const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

const creds = require('./credentials.json').installed;
const oAuth2 = new google.auth.OAuth2(
  creds.client_id,
  creds.client_secret,
  creds.redirect_uris[0]        // normally "http://localhost"
);

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const authUrl = oAuth2.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',            // forces Google to send a refresh_token
});
console.log('\nOpen this URL in a browser:\n', authUrl, '\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste the code here: ', async (code) => {
  const { tokens } = await oAuth2.getToken(code.trim());
  console.log('\n🚀  REFRESH TOKEN:\n', tokens.refresh_token, '\n');
  rl.close();
});
