const axios = require('axios');
const https = require('https');
require('dotenv').config();

async function explore() {
  const axiosClient = axios.create({
    baseURL: process.env.REDFISH_BASE_URL,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    auth: { username: process.env.ILO_USERNAME, password: process.env.ILO_PASSWORD }
  });
  
  try {
    const sysRes = await axiosClient.get('/redfish/v1/Systems');
    if (sysRes.data.Members && sysRes.data.Members.length > 0) {
      const mainSys = sysRes.data.Members[0]['@odata.id'];
      console.log('Main Sys Path:', mainSys);
      const sysData = await axiosClient.get(mainSys);
      console.log('Sys Keys:', Object.keys(sysData.data));
      if (sysData.data.Storage) {
         console.log('System Storage Path:', sysData.data.Storage['@odata.id']);
      } else if (sysData.data.SimpleStorage) {
         console.log('System SimpleStorage Path:', sysData.data.SimpleStorage['@odata.id']);
      } else {
         console.log('No Storage in Systems/1');
      }
    }

    const chassisRes = await axiosClient.get('/redfish/v1/Chassis');
    if (chassisRes.data.Members && chassisRes.data.Members.length > 0) {
      const mainChassis = chassisRes.data.Members[0]['@odata.id'];
      console.log('Main Chassis Path:', mainChassis);
      const chassisData = await axiosClient.get(mainChassis);
      console.log('Chassis Keys:', Object.keys(chassisData.data));
    }
  } catch(e) {
    console.log("Fail:", e.message);
  }
}
explore();
