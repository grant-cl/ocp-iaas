const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const https = require('https');
const session = require('express-session');

const { Client } = require('ldapts');

const db = require('./database');

// Initialize database on startup
db.initDatabase().then(() => {
  console.log('Database initialized successfully');
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});


// Load environment variables from .env file if it exists
try {
  require('dotenv').config();
} catch (error) {
  // dotenv is optional, continue without it if not installed
  console.log('dotenv not found, using default environment variables');
}

// Parse cluster configuration
let clustersMap = {};
let dnsServers = [];
let storageClasses = [];
let templates = [];
try {
  const clusterConfig = process.env.CLUSTER_CONFIG;
  if (clusterConfig) {
    const clusters = JSON.parse(clusterConfig);
    clustersMap = clusters.reduce((acc, cluster) => {
      acc[cluster.name] = cluster;
      return acc;
    }, {});
  }

  const dnsConfig = process.env.DNS_SERVERS;
  if (dnsConfig) {
    try {
      const parsed = JSON.parse(dnsConfig);
      if (Array.isArray(parsed)) {
        dnsServers = parsed.map(entry => String(entry).trim()).filter(Boolean);
      } else {
        dnsServers = String(dnsConfig).split(',').map(entry => entry.trim()).filter(Boolean);
      }
    } catch {
      dnsServers = String(dnsConfig).split(',').map(entry => entry.trim()).filter(Boolean);
    }
  }

  const storageConfig = process.env.STORAGE_CLASSES;
  if (storageConfig) {
    try {
      const parsed = JSON.parse(storageConfig);
      if (Array.isArray(parsed)) {
        storageClasses = parsed.map(entry => String(entry).trim()).filter(Boolean);
      } else {
        storageClasses = String(storageConfig).split(',').map(entry => entry.trim()).filter(Boolean);
      }
    } catch {
      storageClasses = String(storageConfig).split(',').map(entry => entry.trim()).filter(Boolean);
    }
  }

  const templateConfig = process.env.TEMPLATE_CONFIG;
  if (templateConfig) {
    try {
      const parsed = JSON.parse(templateConfig);
      if (Array.isArray(parsed)) {
        templates = parsed.filter(item => item && item.name).map(item => ({
          name: String(item.name),
          type: String(item.type || ''),
          os_version: String(item.os_version || '')
        }));
      }
    } catch (error) {
      console.error('Error parsing TEMPLATE_CONFIG:', error);
    }
  }
} catch (error) {
  console.error('Error parsing environment configuration:', error);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// AWX Configuration
const AWX_CONFIG = {
  hostname: process.env.AWX_HOSTNAME,
  port: 443,
  day1TemplateId: process.env.AWX_DAY1_TEMPLATE_ID,
  day2TemplateId: process.env.AWX_DAY2_TEMPLATE_ID,
  // AWX Token authentication
  token: process.env.AWX_TOKEN
};

// Function to check AWX job status
async function checkAWXJobStatus(jobId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: AWX_CONFIG.hostname,
      port: AWX_CONFIG.port,
      path: `/api/v2/jobs/${jobId}/`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AWX_CONFIG.token}`,
        'Content-Type': 'application/json'
      },
      rejectUnauthorized: false
    };

    const request = https.request(options, (response) => {
      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        try {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            const jsonData = JSON.parse(data);
            resolve({
              id: jsonData.id,
              status: jsonData.status,
              finished: jsonData.finished,
              failed: jsonData.failed,
              elapsed: jsonData.elapsed
            });
          } else {
            console.error(`AWX API error checking job ${jobId}:`, response.statusCode, data);
            reject(new Error(`AWX API error: ${response.statusCode}`));
          }
        } catch (error) {
          console.error(`Error parsing AWX job status for ${jobId}:`, error);
          reject(error);
        }
      });
    });

    request.on('error', (error) => {
      console.error(`Error checking AWX job ${jobId}:`, error);
      reject(error);
    });

    request.end();
  });
}

// Function to update running job statuses
async function updateRunningJobStatuses() {
  try {
    const submissions = await db.getAllSubmissions();
    
    // Check Day 1 running jobs
    const day1RunningSubmissions = submissions.filter(s => s.day1_status === 'running' || s.day1_status === 'submitted' || s.day1_status === 'waiting' && s.day1_job_id);
    
    // Check Day 2 running jobs
    const day2RunningSubmissions = submissions.filter(s => s.day2_status === 'running' || s.day2_status === 'submitted' || s.day2_status === 'waiting' && s.day2_job_id);

    if (day1RunningSubmissions.length > 0 || day2RunningSubmissions.length > 0) {
      console.log(`Checking status for ${day1RunningSubmissions.length} Day 1 and ${day2RunningSubmissions.length} Day 2 running jobs`);
    }
    
    // Check Day 1 jobs
    for (const submission of day1RunningSubmissions) {
      try {
        const jobStatus = await checkAWXJobStatus(submission.day1_job_id);
        console.log(`Day 1 Job ${submission.day1_job_id} status: ${jobStatus.status}, finished: ${jobStatus.finished}, failed: ${jobStatus.failed}`);
        
        if (jobStatus.finished) {
          let newStatus, notes;
          if (jobStatus.failed) {
            newStatus = 'failed';
            notes = `Day 1 AWX job completed with failure after ${jobStatus.elapsed}s`;
          } else {
            newStatus = 'completed';
            notes = `Day 1 AWX job completed successfully after ${jobStatus.elapsed}s`;
          }

          await db.updateDay1Status(submission.id, {
            day1_status: newStatus,
            day1_awx_status: jobStatus.status,
            day1_notes: notes
          });
          
          console.log(`Updated submission ${submission.id} Day 1 status to '${newStatus}'`);
        } else if (jobStatus.status !== submission.day1_awx_status) {
          await db.updateDay1Status(submission.id, {
            day1_status: jobStatus.status,
            day1_awx_status: jobStatus.status
          });
          console.log(`Updated submission ${submission.id} Day 1 AWX status to '${jobStatus.status}'`);       
        }
      } catch (error) {
        console.error(`Error checking Day 1 job ${submission.day1_job_id} for submission ${submission.id}:`, error);
      }
    }
    
    // Check Day 2 jobs
    for (const submission of day2RunningSubmissions) {
      try {
        const jobStatus = await checkAWXJobStatus(submission.day2_job_id);
        console.log(`Day 2 Job ${submission.day2_job_id} status: ${jobStatus.status}, finished: ${jobStatus.finished}, failed: ${jobStatus.failed}`);
        
        if (jobStatus.finished) {
          let newStatus, notes;
          if (jobStatus.failed) {
            newStatus = 'failed';
            notes = `Day 2 AWX job completed with failure after ${jobStatus.elapsed}s`;
          } else {
            newStatus = 'completed';
            notes = `Day 2 AWX job completed successfully after ${jobStatus.elapsed}s`;
          }
          
          await db.updateDay2Status(submission.id, {
            day2_status: newStatus,
            day2_awx_status: jobStatus.status,
            day2_notes: notes
          });
          
          console.log(`Updated submission ${submission.id} Day 2 status to '${newStatus}'`);
        } else if (jobStatus.status !== submission.day2_awx_status) {
          await db.updateDay2Status(submission.id, {
            day2_status: jobStatus.status,
            day2_awx_status: jobStatus.status
          });
          console.log(`Updated submission ${submission.id} Day 2 AWX status to '${jobStatus.status}'`);
        }
      } catch (error) {
        console.error(`Error checking Day 2 job ${submission.day2_job_id} for submission ${submission.id}:`, error);
      }
    }
    
  } catch (error) {
    console.error('Error updating running job statuses:', error);
  }
}

// LDAP Configuration
const LDAP_CONFIG = {
  server: {
    url: process.env.LDAP_URL,
    bindDN: process.env.LDAP_BIND_DN,
    bindCredentials: process.env.LDAP_BIND_PASSWORD,
    searchBase: process.env.LDAP_SEARCH_BASE,
    searchFilter: process.env.LDAP_SEARCH_CUSTOM || '(uid={{username}})',
  }
};

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true if using HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));







// Authentication middleware
function requireAuth(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Login page (unprotected)
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Login POST route
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await authenticateLdap(username, password);
    req.session.user = user;
    res.redirect('/');
  } catch (error) {
    console.error('Authentication error:', error);
    res.redirect('/login?error=1');
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/login');
  });
});

// Serve public assets (unprotected) - for CSS, JS libraries, etc
app.use('/public', express.static(path.join(__dirname, 'public')));

// API endpoint to get current user info (protected)
app.get('/api/user', requireAuth, (req, res) => {
  res.json({
    user: req.session.user,
    authenticated: true
  });
});

async function authenticateLdap(username, password) {
  console.log(`Attempting LDAP authentication with URL: ${LDAP_CONFIG.server.url}`);

  const client = new Client({
    url: LDAP_CONFIG.server.url,
    starttls: false,
  });

  try {
    await client.bind(LDAP_CONFIG.server.bindDN, LDAP_CONFIG.server.bindCredentials);

    const searchFilter = LDAP_CONFIG.server.searchFilter.replace('{{username}}', username);
    const { searchEntries } = await client.search(LDAP_CONFIG.server.searchBase, {
      filter: searchFilter,
    });

    if (searchEntries.length === 0) {
      throw new Error('Incorrect username.');
    }

    const user = searchEntries[0];
    await client.bind(user.dn, password);

    console.log('LDAP authentication successful for user:', user.uid || user.sAMAccountName);
    return {
      id: user.uid || user.sAMAccountName,
      displayName: user.displayName || user.cn,
      email: user.mail
    };
  } catch (err) {
    console.error('LDAP authentication error:', err);
    throw err;
  } finally {
    await client.unbind();
  }
}

// Default page
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'submissions.html'));
});

// Serve the form (protected)
app.get('/awx-form', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'awx-form.html'));
});

// Serve the submissions management page (protected)
app.get('/submissions', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'submissions.html'));
});

// Endpoint to fetch clusters from environment variables (protected)
app.get('/api/clusters', requireAuth, (req, res) => {
  try {
    const clusterConfig = process.env.CLUSTER_CONFIG;
    if (!clusterConfig) {
      return res.status(500).json({ error: 'CLUSTER_CONFIG environment variable not set' });
    }
    
    const clusters = JSON.parse(clusterConfig);
    // Return clusters without sensitive information
    const publicClusters = clusters.map(cluster => ({
      name: cluster.name,
      repo: cluster.repo,
      satellite: cluster.satellite
    }));
    res.json({ items: publicClusters });
  } catch (error) {
    console.error('Error parsing CLUSTER_CONFIG:', error);
    res.status(500).json({ error: 'Failed to parse CLUSTER_CONFIG' });
  }
});

// Endpoint to fetch configuration values from environment variables (protected)
app.get('/api/config', requireAuth, (req, res) => {
  res.json({
    dnsServers,
    templates
  });
});

// Endpoint to fetch storage classes from env or OpenShift (protected)
app.get('/api/storageclasses', requireAuth, async (req, res) => {
  if (storageClasses.length > 0) {
    return res.json({ items: storageClasses.map(name => ({ name })) });
  }

  const clusterName = req.query.cluster;
  const clusterConfig = clustersMap[clusterName];
  if (!clusterConfig) {
    return res.status(400).json({ error: 'Invalid or missing cluster parameter' });
  }

  const options = {
    hostname: clusterConfig.ocp_hostname,
    port: 6443,
    path: '/apis/storage.k8s.io/v1/storageclasses',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${clusterConfig.ocp_token}`,
      'Content-Type': 'application/json'
    },
    rejectUnauthorized: false
  };

  const request = https.request(options, (response) => {
    let data = '';

    response.on('data', (chunk) => {
      data += chunk;
    });

    response.on('end', () => {
      try {
        const jsonData = JSON.parse(data);
        if (response.statusCode >= 200 && response.statusCode < 300) {
          const items = Array.isArray(jsonData.items) ? jsonData.items.map(item => ({ name: item.metadata.name })) : [];
          res.json({ items });
        } else {
          console.error('OpenShift API returned error:', response.statusCode, data);
          res.status(response.statusCode).json({
            error: `OpenShift API error: ${response.statusCode}`,
            details: jsonData
          });
        }
      } catch (error) {
        console.error('Error parsing JSON response:', error);
        res.status(500).json({ error: 'Failed to parse OpenShift API response' });
      }
    });
  });

  request.on('error', (error) => {
    console.error('Error calling OpenShift API:', error);
    res.status(500).json({ error: 'Failed to fetch storage classes' });
  });

  request.end();
});

// Endpoint to fetch network attachment definitions from OpenShift (protected)
app.get('/api/network-attachment-definitions', requireAuth, async (req, res) => {
  const clusterName = req.query.cluster;
  const clusterConfig = clustersMap[clusterName];
  if (!clusterConfig) {
    return res.status(400).json({ error: 'Invalid or missing cluster parameter' });
  }
  
  const options = {
    hostname: clusterConfig.ocp_hostname,
    port: 6443,
    path: `/apis/k8s.cni.cncf.io/v1/namespaces/${clusterConfig.namespace || 'default'}/network-attachment-definitions/`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${clusterConfig.ocp_token}`,
      'Content-Type': 'application/json'
    },
    rejectUnauthorized: false // This is equivalent to curl -k (insecure)
  };

  const request = https.request(options, (response) => {
    let data = '';

    response.on('data', (chunk) => {
      data += chunk;
    });

    response.on('end', () => {
      try {
        const jsonData = JSON.parse(data);
        
        // Check if the response is successful
        if (response.statusCode >= 200 && response.statusCode < 300) {
          res.json(jsonData);
        } else {
          console.error('OpenShift API returned error:', response.statusCode, data);
          res.status(response.statusCode).json({ 
            error: `OpenShift API error: ${response.statusCode}`,
            details: jsonData 
          });
        }
      } catch (error) {
        console.error('Error parsing JSON response:', error);
        res.status(500).json({ error: 'Failed to parse OpenShift API response' });
      }
    });
  });

  request.on('error', (error) => {
    console.error('Error calling OpenShift API:', error);
    res.status(500).json({ error: 'Failed to fetch network attachment definitions' });
  });

  request.end();
});

// Endpoint to fetch namespaces from OpenShift (protected)
app.get('/api/namespaces', requireAuth, async (req, res) => {
  const clusterName = req.query.cluster;
  const clusterConfig = clustersMap[clusterName];
  if (!clusterConfig) {
    return res.status(400).json({ error: 'Invalid or missing cluster parameter' });
  }
  
  const options = {
    hostname: clusterConfig.ocp_hostname,
    port: 6443,
    path: '/api/v1/namespaces',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${clusterConfig.ocp_token}`,
      'Content-Type': 'application/json'
    },
    rejectUnauthorized: false // This is equivalent to curl -k (insecure)
  };

  const request = https.request(options, (response) => {
    let data = '';

    response.on('data', (chunk) => {
      data += chunk;
    });

    response.on('end', () => {
      try {
        const jsonData = JSON.parse(data);
        
        // Check if the response is successful
        if (response.statusCode >= 200 && response.statusCode < 300) {
          res.json(jsonData);
        } else {
          console.error('OpenShift API returned error:', response.statusCode, data);
          res.status(response.statusCode).json({ 
            error: `OpenShift API error: ${response.statusCode}`,
            details: jsonData 
          });
        }
      } catch (error) {
        console.error('Error parsing JSON response:', error);
        res.status(500).json({ error: 'Failed to parse OpenShift API response' });
      }
    });
  });

  request.on('error', (error) => {
    console.error('Error calling OpenShift API:', error);
    res.status(500).json({ error: 'Failed to fetch namespaces' });
  });

  request.end();
});

// API routes for submissions management

// Get all submissions (protected)
app.get('/api/submissions', requireAuth, async (req, res) => {
  try {
    const submissions = await db.getAllSubmissions();
    res.json(submissions);
  } catch (error) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// Get submission by ID (protected)
app.get('/api/submissions/:id', requireAuth, async (req, res) => {
  try {
    const submission = await db.getSubmissionById(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    res.json(submission);
  } catch (error) {
    console.error('Error fetching submission:', error);
    res.status(500).json({ error: 'Failed to fetch submission' });
  }
});

// Submit a saved submission to AWX Day 1 (protected)
app.post('/api/submissions/:id/day1', requireAuth, async (req, res) => {
  try {
    const submission = await db.getSubmissionById(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    // Check if Day 1 is already in progress or completed
    const day1Status = submission.day1_status || 'pending';
    if (day1Status !== 'pending' && day1Status !== 'not_started' && day1Status !== 'failed') {
      return res.status(400).json({ error: `Day 1 has already been processed (status: ${day1Status})` });
    }

    // Update Day 1 status to submitted
    console.log(`Updating submission ${req.params.id} Day 1 status to 'submitted'`);
    await db.updateDay1Status(req.params.id, { day1_status: 'submitted' });

    // Submit to AWX Day 1 template
    const extraVars = submission.form_data;
    const postData = JSON.stringify({
      extra_vars: extraVars
    });
    
    console.log('Submitting Day 1 to AWX:', postData.substring(0, 200) + '...');
    
    const options = {
      hostname: AWX_CONFIG.hostname,
      port: AWX_CONFIG.port,
      path: `/api/v2/job_templates/${AWX_CONFIG.day1TemplateId}/launch/`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AWX_CONFIG.token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      rejectUnauthorized: false
    };

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', async () => {
        try {
          const jsonData = JSON.parse(data);
          
          if (response.statusCode >= 200 && response.statusCode < 300) {
            // Update submission with Day 1 AWX job details
            console.log(`Updating submission ${req.params.id} Day 1 status to 'running' with job ID ${jsonData.id}`);
            await db.updateDay1Status(req.params.id, {
              day1_status: 'submitted',
              day1_job_id: String(jsonData.id),
              day1_job_url: `https://${AWX_CONFIG.hostname}/#/jobs/playbook/${jsonData.id}/output`,
              day1_awx_status: jsonData.status
            });

            res.json({
              message: 'Day 1 AWX template launched successfully',
              job_id: String(jsonData.id),
              job_url: `https://${AWX_CONFIG.hostname}/#/jobs/playbook/${jsonData.id}/output`,
              status: jsonData.status,
              day: 1
            });
          } else {
            // Update Day 1 status to failed
            await db.updateDay1Status(req.params.id, {
              day1_status: 'failed',
              day1_notes: `Day 1 AWX API error: ${response.statusCode} - ${data}`
            });

            res.status(response.statusCode).json({ 
              error: `Day 1 AWX API error: ${response.statusCode}`,
              details: jsonData 
            });
          }
        } catch (error) {
          console.error('Error parsing Day 1 AWX response:', error);
          await db.updateDay1Status(req.params.id, {
            day1_status: 'failed',
            day1_notes: `Failed to parse Day 1 AWX response: ${error.message}`
          });
          res.status(500).json({ error: 'Failed to parse Day 1 AWX API response' });
        }
      });
    });

    request.on('error', async (error) => {
      console.error('Error calling Day 1 AWX API:', error);
      await db.updateDay1Status(req.params.id, {
        day1_status: 'failed',
        day1_notes: `Day 1 AWX API error: ${error.message}`
      });
      res.status(500).json({ error: 'Failed to launch Day 1 AWX template' });
    });

    request.write(postData);
    request.end();

  } catch (error) {
    console.error('Error submitting Day 1 to AWX:', error);
    res.status(500).json({ error: 'Failed to submit Day 1 to AWX' });
  }
});

// Submit a saved submission to AWX Day 2 (protected)
app.post('/api/submissions/:id/day2', requireAuth, async (req, res) => {
  try {
    const submission = await db.getSubmissionById(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    // Check if Day 1 is completed
    const day1Status = submission.day1_status || 'pending';
    if (day1Status !== 'completed') {
      return res.status(400).json({ error: `Day 1 must be completed before Day 2 can start (Day 1 status: ${day1Status})` });
    }

    // Check if Day 2 is already in progress or completed
    const day2Status = submission.day2_status || 'not_started';
    if (day2Status !== 'not_started' && day2Status !== 'failed') {
      return res.status(400).json({ error: `Day 2 has already been processed (status: ${day2Status})` });
    }

    // Update Day 2 status to submitted
    console.log(`Updating submission ${req.params.id} Day 2 status to 'submitted'`);
    await db.updateDay2Status(req.params.id, { day2_status: 'submitted' });

    // Submit to AWX Day 2 template
    const extraVars = submission.form_data;
    const postData = JSON.stringify({
      extra_vars: extraVars
    });
    
    console.log('Submitting Day 2 to AWX:', postData.substring(0, 200) + '...');
    
    const options = {
      hostname: AWX_CONFIG.hostname,
      port: AWX_CONFIG.port,
      path: `/api/v2/job_templates/${AWX_CONFIG.day2TemplateId}/launch/`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AWX_CONFIG.token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      rejectUnauthorized: false
    };

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', async () => {
        try {
          const jsonData = JSON.parse(data);
          
          if (response.statusCode >= 200 && response.statusCode < 300) {
            // Update submission with Day 2 AWX job details
            console.log(`Updating submission ${req.params.id} Day 2 status to 'running' with job ID ${jsonData.id}`);
            await db.updateDay2Status(req.params.id, {
              day2_status: 'submitted',
              day2_job_id: String(jsonData.id),
              day2_job_url: `https://${AWX_CONFIG.hostname}/#/jobs/playbook/${jsonData.id}/output`,
              day2_awx_status: jsonData.status
            });

            res.json({
              message: 'Day 2 AWX template launched successfully',
              job_id: String(jsonData.id),
              job_url: `https://${AWX_CONFIG.hostname}/#/jobs/playbook/${jsonData.id}/output`,
              status: jsonData.status,
              day: 2
            });
          } else {
            // Update Day 2 status to failed
            await db.updateDay2Status(req.params.id, {
              day2_status: 'failed',
              day2_notes: `Day 2 AWX API error: ${response.statusCode} - ${data}`
            });

            res.status(response.statusCode).json({ 
              error: `Day 2 AWX API error: ${response.statusCode}`,
              details: jsonData 
            });
          }
        } catch (error) {
          console.error('Error parsing Day 2 AWX response:', error);
          await db.updateDay2Status(req.params.id, {
            day2_status: 'failed',
            day2_notes: `Failed to parse Day 2 AWX response: ${error.message}`
          });
          res.status(500).json({ error: 'Failed to parse Day 2 AWX API response' });
        }
      });
    });

    request.on('error', async (error) => {
      console.error('Error calling Day 2 AWX API:', error);
      await db.updateDay2Status(req.params.id, {
        day2_status: 'failed',
        day2_notes: `Day 2 AWX API error: ${error.message}`
      });
      res.status(500).json({ error: 'Failed to launch Day 2 AWX template' });
    });

    request.write(postData);
    request.end();

  } catch (error) {
    console.error('Error submitting Day 2 to AWX:', error);
    res.status(500).json({ error: 'Failed to submit Day 2 to AWX' });
  }
});


// Delete submission (protected)
app.delete('/api/submissions/:id', requireAuth, async (req, res) => {
  try {
    const changes = await db.deleteSubmission(req.params.id);
    if (changes === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    res.json({ message: 'Submission deleted successfully' });
  } catch (error) {
    console.error('Error deleting submission:', error);
    res.status(500).json({ error: 'Failed to delete submission' });
  }
});


// Endpoint to receive form submission and save to database (protected)
app.post('/awx/run-template', requireAuth, async (req, res) => {
  console.log('Form submission endpoint called');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  
  const extraVars = req.body.extra_vars;
  
  if (!extraVars || !extraVars.data) {
    console.error('No extra_vars or data provided in request');
    return res.status(400).json({ error: 'No form data provided' });
  }
  
  try {
    const hostname = extraVars.data.hostname;
    
    console.log(`[FORM] Checking hostname uniqueness for: "${hostname}"`);
    
    // Check if hostname already exists
    const existingSubmission = await db.checkHostnameExists(hostname);
    console.log('[FORM] Hostname check result:', existingSubmission);
    
    if (existingSubmission) {
      console.log(`[FORM] Hostname conflict detected: ${hostname} exists in submission #${existingSubmission.id}`);
      return res.status(409).json({ 
        error: `Hostname '${hostname}' already exists in submission #${existingSubmission.id}.`,
        existing_submission_id: existingSubmission.id
      });
    }

    const submissionData = {
      engineer_id: extraVars.data.engineer.id,
      engineer_name: extraVars.data.engineer.fullname,
      hostname: hostname,
      environment: extraVars.data.env,
      namespace: extraVars.data.namespace,
      service: extraVars.data.service,
      description: extraVars.data.details.description,
      form_data: extraVars
    };

    const submissionId = await db.saveSubmission(submissionData);
    console.log('Submission saved with ID:', submissionId);

    res.json({
      message: 'Submission saved successfully! You can now manage it from the submissions page.',
      submission_id: submissionId,
      status: 'not started',
      redirect_url: '/submissions'
    });

  } catch (error) {
    console.error('Error saving submission:', error);
    res.status(500).json({ error: 'Failed to save submission' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  
  // Start periodic job status checking
  const JOB_STATUS_CHECK_INTERVAL = 10000; // 10 seconds
  setInterval(updateRunningJobStatuses, JOB_STATUS_CHECK_INTERVAL);
  console.log(`Started AWX job status monitoring (checking every ${JOB_STATUS_CHECK_INTERVAL/1000}s)`);
  
  // Initial check after 5 seconds
  setTimeout(updateRunningJobStatuses, 5000);
});
