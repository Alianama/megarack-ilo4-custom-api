const express = require('express');
const axios = require('axios');
const https = require('https');
const client = require('prom-client');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Set up HTTPS agent to ignore self-signed certificates (common for iLO/Redfish)
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

// Hapus tanda kutip (") jika file .env di-load secara literal oleh Docker
const REDFISH_BASE_URL = (process.env.REDFISH_BASE_URL || '').replace(/^["']|["']$/g, '');
const ILO_USERNAME = (process.env.ILO_USERNAME || '').replace(/^["']|["']$/g, '');
const ILO_PASSWORD = (process.env.ILO_PASSWORD || '').replace(/^["']|["']$/g, '');

// Axios instance with basic auth & https agent
const axiosClient = axios.create({
  baseURL: REDFISH_BASE_URL,
  httpsAgent: httpsAgent,
  auth: {
    username: ILO_USERNAME,
    password: ILO_PASSWORD
  }
});

// Setup Prometheus Metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register }); // Collect standard Node.js metrics

function getHealthValue(status) {
  if (!status) return -1;
  switch (status.toLowerCase()) {
    case 'ok': return 1;
    case 'warning': return 0.5;
    case 'critical': return 0;
    default: return -1;
  }
}

// Define Custom Metrics
const prefix = 'megarack_';
const metricLabels = ['manufacturer', 'model'];

const gSystemHealth = new client.Gauge({ name: prefix + 'system_health', help: 'System Health (1=OK, 0.5=Warning, 0=Critical, -1=Unknown)', labelNames: metricLabels, registers: [register] });
const gCpuCount = new client.Gauge({ name: prefix + 'cpu_count', help: 'CPU Count', labelNames: metricLabels, registers: [register] });
const gCpuHealth = new client.Gauge({ name: prefix + 'cpu_health', help: 'CPU Health', labelNames: metricLabels, registers: [register] });
const gMemoryGb = new client.Gauge({ name: prefix + 'memory_total_gb', help: 'Total Memory GB', labelNames: metricLabels, registers: [register] });
const gMemoryHealth = new client.Gauge({ name: prefix + 'memory_health', help: 'Memory Health', labelNames: metricLabels, registers: [register] });
const gStorageDrives = new client.Gauge({ name: prefix + 'storage_drives_count', help: 'Storage Drives Count', labelNames: metricLabels, registers: [register] });
const gStorageHealth = new client.Gauge({ name: prefix + 'storage_health', help: 'Storage Health', labelNames: metricLabels, registers: [register] });
const gPowerConsumed = new client.Gauge({ name: prefix + 'power_consumed_watts', help: 'Power Consumed in Watts', labelNames: metricLabels, registers: [register] });
const gPowerCapacity = new client.Gauge({ name: prefix + 'power_capacity_watts', help: 'Power Capacity in Watts', labelNames: metricLabels, registers: [register] });
const gPowerHealth = new client.Gauge({ name: prefix + 'power_health', help: 'Power Health', labelNames: metricLabels, registers: [register] });
const gThermalHealth = new client.Gauge({ name: prefix + 'thermal_health', help: 'Thermal Health', labelNames: metricLabels, registers: [register] });
const gFansCount = new client.Gauge({ name: prefix + 'fans_count', help: 'Total Fans', labelNames: metricLabels, registers: [register] });
const gFansOk = new client.Gauge({ name: prefix + 'fans_ok', help: 'OK Fans', labelNames: metricLabels, registers: [register] });
const gTempMax = new client.Gauge({ name: prefix + 'temp_celsius_max', help: 'Maximum Temperature in Celsius', labelNames: metricLabels, registers: [register] });

// Extracted logic for fetching Redfish JSON
async function fetchServerSummaryData() {
  const summary = {};

  // 1. Fetch Root Redfish Data
  console.log('Fetching Redfish Root from:', REDFISH_BASE_URL + '/redfish/v1');
  const rootRes = await axiosClient.get('/redfish/v1');
  const rootData = rootRes.data;

  // Dynamically retrieve paths from root response, fallback to standards
  const systemsPath  = rootData.Systems  ? rootData.Systems['@odata.id']  : '/redfish/v1/Systems';
  const chassisPath  = rootData.Chassis  ? rootData.Chassis['@odata.id']  : '/redfish/v1/Chassis';

  // 2. Fetch Systems Data (CPU, Memory, System Health)
  console.log('Fetching Systems Data:', systemsPath);
  const systemsRes = await axiosClient.get(systemsPath);
  const systemMembers = systemsRes.data.Members || [];
  
  if (systemMembers.length > 0) {
    const mainSystemPath = systemMembers[0]['@odata.id'];
    console.log('Fetching Main System:', mainSystemPath);
    const systemDataRes = await axiosClient.get(mainSystemPath);
    const sysData = systemDataRes.data;

    summary.system_manufacturer = sysData.Manufacturer || 'Unknown';
    summary.system_model = sysData.Model || 'Unknown';
    summary.system_health = sysData.Status?.Health || sysData.Status?.State || 'Unknown';
    summary.system_power_state = sysData.PowerState || 'Unknown';

    summary.cpu_count = sysData.ProcessorSummary?.Count || 0;
    summary.cpu_model = sysData.ProcessorSummary?.Model || 'Unknown';
    summary.cpu_health = sysData.ProcessorSummary?.Status?.Health || 'Unknown';

    summary.memory_total_gb = sysData.MemorySummary?.TotalSystemMemoryGiB || 0;
    summary.memory_health = sysData.MemorySummary?.Status?.Health || 'Unknown';

    summary.storage_health = 'Unknown';
    summary.storage_drives_count = 0;

    // Attempt to extract Storage info from System
    if (sysData.Storage && sysData.Storage['@odata.id']) {
      try {
        console.log('Fetching Standard Storage Data:', sysData.Storage['@odata.id']);
        const storageRes = await axiosClient.get(sysData.Storage['@odata.id']);
        summary.storage_health = storageRes.data.Status?.Health || 'Unknown';
        summary.storage_drives_count = storageRes.data.Members?.length || 0;
      } catch(e) {
        console.error('[Warning] Failed to get standard storage:', e.message);
      }
    } else if (sysData.SimpleStorage && sysData.SimpleStorage['@odata.id']) {
      try {
        console.log('Fetching Simple Storage Data:', sysData.SimpleStorage['@odata.id']);
        const storageRes = await axiosClient.get(sysData.SimpleStorage['@odata.id']);
        summary.storage_health = storageRes.data.Status?.Health || 'Unknown';
        summary.storage_drives_count = storageRes.data.Members?.length || 0;
      } catch(e) {
        console.error('[Warning] Failed to get simple storage:', e.message);
      }
    }
  }

  // 3. Fetch Chassis Data (Power, Thermal/Fans)
  console.log('Fetching Chassis Data:', chassisPath);
  const chassisRes = await axiosClient.get(chassisPath);
  const chassisMembers = chassisRes.data.Members || [];
  
  // Default Power/Thermal summary
  summary.power_consumed_watts = 0;
  summary.power_capacity_watts = 0;
  summary.power_health = 'Unknown';
  summary.thermal_health = 'Unknown';
  summary.fans_count = 0;
  summary.fans_ok = 0;
  summary.temp_celsius_max = 0;

  if (chassisMembers.length > 0) {
    const mainChassisPath = chassisMembers[0]['@odata.id'];
    console.log('Fetching Main Chassis:', mainChassisPath);
    const chassisDataRes = await axiosClient.get(mainChassisPath);
    const chassisData = chassisDataRes.data;

    // Fetch Power metrics
    if (chassisData.Power && chassisData.Power['@odata.id']) {
      try {
        console.log('Fetching Power Data:', chassisData.Power['@odata.id']);
        const powerRes = await axiosClient.get(chassisData.Power['@odata.id']);
        const pData = powerRes.data;
        
        summary.power_health = pData.Status?.Health || 'Unknown';
        const pControl = pData.PowerControl?.[0]; // Usually the first power control contains the summary
        if (pControl) {
          summary.power_consumed_watts = pControl.PowerConsumedWatts || 0;
          summary.power_capacity_watts = pControl.PowerCapacityWatts || 0;
        }
      } catch(e) {
        console.error('[Warning] Failed to fetch power data:', e.message);
      }
    }

    // Fetch Thermal metrics
    if (chassisData.Thermal && chassisData.Thermal['@odata.id']) {
      try {
        console.log('Fetching Thermal Data:', chassisData.Thermal['@odata.id']);
        const thermalRes = await axiosClient.get(chassisData.Thermal['@odata.id']);
        const tData = thermalRes.data;
        
        summary.thermal_health = tData.Status?.Health || 'Unknown';
        const fans = tData.Fans || [];
        summary.fans_count = fans.length;
        summary.fans_ok = fans.filter(f => f.Status?.Health === 'OK').length;
        
        const temps = tData.Temperatures || [];
        const validTemps = temps.map(t => t.ReadingCelsius).filter(t => t != null);
        summary.temp_celsius_max = validTemps.length > 0 ? Math.max(...validTemps) : 0;
      } catch(e) {
        console.error('[Warning] Failed to fetch thermal data:', e.message);
      }
    }
  }

  console.log('Successfully aggregated Server Data.');
  return summary;
}

// GET /api/server-summary - Original JSON API
app.get('/api/server-summary', async (req, res) => {
  try {
    const summary = await fetchServerSummaryData();
    res.json({
      success: true,
      message: 'Server Summary aggregated successfully',
      data: summary
    });
  } catch (error) {
    console.error('Redfish API Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch server data from Redfish API',
      error: error.message
    });
  }
});

// GET /metrics - Prometheus Exporter
app.get('/metrics', async (req, res) => {
  try {
    const data = await fetchServerSummaryData();
    const lbls = { manufacturer: data.system_manufacturer, model: data.system_model };

    // Update Gauges
    gSystemHealth.set(lbls, getHealthValue(data.system_health));
    gCpuCount.set(lbls, data.cpu_count);
    gCpuHealth.set(lbls, getHealthValue(data.cpu_health));
    gMemoryGb.set(lbls, data.memory_total_gb);
    gMemoryHealth.set(lbls, getHealthValue(data.memory_health));
    gStorageDrives.set(lbls, data.storage_drives_count);
    gStorageHealth.set(lbls, getHealthValue(data.storage_health));
    gPowerConsumed.set(lbls, data.power_consumed_watts);
    gPowerCapacity.set(lbls, data.power_capacity_watts);
    gPowerHealth.set(lbls, getHealthValue(data.power_health));
    gThermalHealth.set(lbls, getHealthValue(data.thermal_health));
    gFansCount.set(lbls, data.fans_count);
    gFansOk.set(lbls, data.fans_ok);
    gTempMax.set(lbls, data.temp_celsius_max);

    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    console.error('Prometheus Metrics Error:', error.message);
    res.status(500).send(error.message);
  }
});

// GET /api/thermal - For Grafana Timeseries (Temperatures & Fans)
app.get('/api/thermal', async (req, res) => {
  try {
    const rootRes = await axiosClient.get('/redfish/v1');
    const chassisPath = rootRes.data.Chassis ? rootRes.data.Chassis['@odata.id'] : '/redfish/v1/Chassis';
    const chassisRes = await axiosClient.get(chassisPath);
    const mainChassisPath = chassisRes.data.Members[0]['@odata.id'];
    const chassisDataRes = await axiosClient.get(mainChassisPath);
    const thermalPath = chassisDataRes.data.Thermal ? chassisDataRes.data.Thermal['@odata.id'] : null;

    if (!thermalPath) throw new Error("Thermal data path not found");

    const thermalRes = await axiosClient.get(thermalPath);
    
    // Format Fans for Grafana table/graph
    const fans = (thermalRes.data.Fans || []).map(f => ({
      name: f.Name || f.FanName || 'Unknown',
      reading_rpm: f.Reading || 0,
      health: f.Status?.Health || 'Unknown',
      state: f.Status?.State || 'Unknown'
    }));

    // Format Temperatures for Grafana timeseries/graph
    const temperatures = (thermalRes.data.Temperatures || []).map(t => ({
      name: t.Name || 'Unknown',
      reading_celsius: t.ReadingCelsius || 0,
      upper_threshold_critical: t.UpperThresholdCritical || null,
      health: t.Status?.Health || 'Unknown'
    }));

    res.json({ success: true, fans, temperatures });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/power - For Grafana Timeseries (Power Supplies & Capacity)
app.get('/api/power', async (req, res) => {
  try {
    const rootRes = await axiosClient.get('/redfish/v1');
    const chassisPath = rootRes.data.Chassis ? rootRes.data.Chassis['@odata.id'] : '/redfish/v1/Chassis';
    const chassisRes = await axiosClient.get(chassisPath);
    const mainChassisPath = chassisRes.data.Members[0]['@odata.id'];
    const chassisDataRes = await axiosClient.get(mainChassisPath);
    const powerPath = chassisDataRes.data.Power ? chassisDataRes.data.Power['@odata.id'] : null;

    if (!powerPath) throw new Error("Power data path not found");

    const powerRes = await axiosClient.get(powerPath);
    const pData = powerRes.data;

    // Format Power Control (Consumption)
    const power_controls = (pData.PowerControl || []).map(pc => ({
      name: pc.Name || 'System Power Control',
      consumed_watts: pc.PowerConsumedWatts || 0,
      capacity_watts: pc.PowerCapacityWatts || 0
    }));

    // Format Power Supplies
    const power_supplies = (pData.PowerSupplies || []).map(ps => ({
      name: ps.Name || 'Unknown',
      power_capacity_watts: ps.PowerCapacityWatts || 0,
      line_input_voltage: ps.LineInputVoltage || 0,
      health: ps.Status?.Health || 'Unknown',
      state: ps.Status?.State || 'Unknown'
    }));

    res.json({ success: true, power_controls, power_supplies });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/storage - For Grafana Tables (Disk Health & Capacity)
app.get('/api/storage', async (req, res) => {
  try {
    const rootRes = await axiosClient.get('/redfish/v1');
    const systemsPath = rootRes.data.Systems ? rootRes.data.Systems['@odata.id'] : '/redfish/v1/Systems';
    const systemsRes = await axiosClient.get(systemsPath);
    const mainSystemPath = systemsRes.data.Members[0]['@odata.id'];
    const systemDataRes = await axiosClient.get(mainSystemPath);
    const sysData = systemDataRes.data;

    let storagePath = null;
    if (sysData.Storage && sysData.Storage['@odata.id']) {
      storagePath = sysData.Storage['@odata.id'];
    } else if (sysData.SimpleStorage && sysData.SimpleStorage['@odata.id']) {
      storagePath = sysData.SimpleStorage['@odata.id'];
    }

    if (!storagePath) {
      return res.json({ success: true, drives: [], message: "No standard storage path found." });
    }

    const storageRes = await axiosClient.get(storagePath);
    let drives = [];

    // Simple implementation to attempt to fetch drives if Members exist
    if (storageRes.data.Members && storageRes.data.Members.length > 0) {
      const drivePromises = storageRes.data.Members.map(m => 
        axiosClient.get(m['@odata.id']).then(r => r.data).catch(() => null)
      );
      const rawDrives = await Promise.all(drivePromises);
      
      drives = rawDrives.filter(d => d !== null).map(d => ({
        name: d.Name || 'Unknown',
        capacity_gb: d.CapacityBytes ? (d.CapacityBytes / (1024 ** 3)).toFixed(2) : 0,
        protocol: d.Protocol || 'Unknown',
        media_type: d.MediaType || 'Unknown',
        health: d.Status?.Health || 'Unknown'
      }));
    }

    res.json({ success: true, drives });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start the server
app.listen(port, "0.0.0.0", () => {
  console.log('===================================================');
  console.log(`🚀 Megarack Custom BE Server running on port ${port}`);
  console.log(`📈 Metrics Endpoint  : http://localhost:${port}/metrics`);
  console.log(`📊 Summary Endpoint  : http://localhost:${port}/api/server-summary`);
  console.log(`🌡️  Thermal Endpoint  : http://localhost:${port}/api/thermal`);
  console.log(`⚡ Power Endpoint    : http://localhost:${port}/api/power`);
  console.log(`💾 Storage Endpoint  : http://localhost:${port}/api/storage`);
  console.log('===================================================');

});
