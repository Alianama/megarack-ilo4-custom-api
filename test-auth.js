const axios = require('axios');
const https = require('https');
require('dotenv').config();

async function test() {
  const axiosClient = axios.create({
    baseURL: process.env.REDFISH_BASE_URL,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    auth: { username: process.env.ILO_USERNAME, password: process.env.ILO_PASSWORD }
  });
  
  try {
    const res = await axiosClient.get('/redfish/v1/Systems');
    console.log("Success! Systems Data:", Object.keys(res.data));
  } catch(e) {
    console.log("Fail:", e.message);
  }
}
test();
