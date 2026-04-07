const Database = require('better-sqlite3');
const path = require('path');

// Database file path
const DB_PATH = path.join(__dirname, 'data', 'submissions.db');

// Initialize database
function initDatabase() {
  return new Promise((resolve, reject) => {
    try {
      const db = new Database(DB_PATH);
      console.log('Connected to SQLite database');

      // Create submissions table
      db.exec(`
        CREATE TABLE IF NOT EXISTS submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          engineer_id TEXT NOT NULL,
          engineer_name TEXT NOT NULL,
          hostname TEXT NOT NULL,
          environment TEXT NOT NULL,
          namespace TEXT NOT NULL,
          service TEXT NOT NULL,
          description TEXT,
          form_data TEXT NOT NULL,
          day1_job_id TEXT,
          day1_job_url TEXT,
          day1_status TEXT,
          day1_awx_status TEXT,
          day1_notes TEXT,
          day2_job_id TEXT,
          day2_job_url TEXT,
          day2_status TEXT,
          day2_awx_status TEXT,
          day2_notes TEXT,
          notes TEXT
        )
      `);
      
      console.log('Submissions table ready');
      db.close();
      resolve();
    } catch (err) {
      console.error('Error initializing database:', err);
      reject(err);
    }
  });
}

// Save form submission to database
function saveSubmission(submissionData) {
  return new Promise((resolve, reject) => {
    try {
      const db = new Database(DB_PATH);
      
      const stmt = db.prepare(`
        INSERT INTO submissions (
          engineer_id, engineer_name, hostname, environment, namespace, 
          service, description, form_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        submissionData.engineer_id,
        submissionData.engineer_name,
        submissionData.hostname,
        submissionData.environment,
        submissionData.namespace,
        submissionData.service,
        submissionData.description,
        JSON.stringify(submissionData.form_data)
      );
      
      db.close();
      resolve(result.lastInsertRowid);
    } catch (err) {
      console.error('Error saving submission:', err);
      reject(err);
    }
  });
}

// Get all submissions
function getAllSubmissions() {
  return new Promise((resolve, reject) => {
    try {
      const db = new Database(DB_PATH);
      
      const rows = db.prepare(`
        SELECT id, created_at, updated_at, engineer_id, engineer_name, 
               hostname, environment, namespace, service, description, 
               day1_status, day1_job_id, day1_job_url, day1_awx_status, day1_notes,
               day2_status, day2_job_id, day2_job_url, day2_awx_status, day2_notes
        FROM submissions 
        ORDER BY created_at DESC
      `).all();
      
      db.close();
      resolve(rows);
    } catch (err) {
      console.error('Error fetching submissions:', err);
      reject(err);
    }
  });
}

// Get submission by ID
function getSubmissionById(id) {
  return new Promise((resolve, reject) => {
    try {
      const db = new Database(DB_PATH);
      
      const row = db.prepare(`
        SELECT * FROM submissions WHERE id = ?
      `).get(id);
      
      if (row && row.form_data) {
        try {
          row.form_data = JSON.parse(row.form_data);
        } catch (parseErr) {
          console.error('Error parsing form_data:', parseErr);
        }
      }
      
      db.close();
      resolve(row);
    } catch (err) {
      console.error('Error fetching submission:', err);
      reject(err);
    }
  });
}

// Update Day 1 status and job info
function updateDay1Status(id, updates) {
  return new Promise((resolve, reject) => {
    try {
      const db = new Database(DB_PATH);
      
      const fields = [];
      const values = [];
      
      if (updates.day1_status !== undefined) {
        fields.push('day1_status = ?');
        values.push(updates.day1_status);
      }
      if (updates.day1_job_id !== undefined) {
        fields.push('day1_job_id = ?');
        values.push(updates.day1_job_id);
      }
      if (updates.day1_job_url !== undefined) {
        fields.push('day1_job_url = ?');
        values.push(updates.day1_job_url);
      }
      if (updates.day1_awx_status !== undefined) {
        fields.push('day1_awx_status = ?');
        values.push(updates.day1_awx_status);
      }
      if (updates.day1_notes !== undefined) {
        fields.push('day1_notes = ?');
        values.push(updates.day1_notes);
      }
      
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      
      const query = `UPDATE submissions SET ${fields.join(', ')} WHERE id = ?`;
      
      const result = db.prepare(query).run(...values);
      
      db.close();
      resolve(result.changes);
    } catch (err) {
      console.error('Error updating Day 1 status:', err);
      reject(err);
    }
  });
}

// Update Day 2 status and job info
function updateDay2Status(id, updates) {
  return new Promise((resolve, reject) => {
    try {
      const db = new Database(DB_PATH);
      
      const fields = [];
      const values = [];
      
      if (updates.day2_status !== undefined) {
        fields.push('day2_status = ?');
        values.push(updates.day2_status);
      }
      if (updates.day2_job_id !== undefined) {
        fields.push('day2_job_id = ?');
        values.push(updates.day2_job_id);
      }
      if (updates.day2_job_url !== undefined) {
        fields.push('day2_job_url = ?');
        values.push(updates.day2_job_url);
      }
      if (updates.day2_awx_status !== undefined) {
        fields.push('day2_awx_status = ?');
        values.push(updates.day2_awx_status);
      }
      if (updates.day2_notes !== undefined) {
        fields.push('day2_notes = ?');
        values.push(updates.day2_notes);
      }
      
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      
      const query = `UPDATE submissions SET ${fields.join(', ')} WHERE id = ?`;
      
      const result = db.prepare(query).run(...values);
      
      db.close();
      resolve(result.changes);
    } catch (err) {
      console.error('Error updating Day 2 status:', err);
      reject(err);
    }
  });
}

// Delete submission
function deleteSubmission(id) {
  return new Promise((resolve, reject) => {
    try {
      const db = new Database(DB_PATH);
      
      const result = db.prepare('DELETE FROM submissions WHERE id = ?').run(id);
      
      db.close();
      resolve(result.changes);
    } catch (err) {
      console.error('Error deleting submission:', err);
      reject(err);
    }
  });
}

// Check if hostname already exists
function checkHostnameExists(hostname) {
  console.log(`[DB] Checking hostname: "${hostname}"`);
  return new Promise((resolve, reject) => {
    try {
      const db = new Database(DB_PATH);
      
      const row = db.prepare('SELECT id, hostname FROM submissions WHERE hostname = ?').get(hostname);
      
      console.log(`[DB] Query result for hostname "${hostname}":`, row);
      db.close();
      resolve(row); // Returns the existing submission if found, null if not found
    } catch (err) {
      console.error('Error checking hostname:', err);
      reject(err);
    }
  });
}


module.exports = {
  initDatabase,
  saveSubmission,
  getAllSubmissions,
  getSubmissionById,
  updateDay1Status,
  updateDay2Status,
  deleteSubmission,
  checkHostnameExists
};
