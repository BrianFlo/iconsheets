const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');


const app = express();
const PORT = 3000;

// Set up SQLite database
const db = new sqlite3.Database('finance.db');

// Set up file upload handling with multer
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.send('Server is running');
});

// POST /upload - Create table and insert CSV data
app.post('/upload', upload.single('file'), (req, res) => {
    const tableName = req.body.tableName;
  
    if (!tableName || !req.file) {
      return res.status(400).json({ error: 'Table name and CSV file are required.' });
    }
  
    const filePath = path.join(__dirname, req.file.path);
  
    // Create table if it doesn't exist
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS "${tableName}" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        memo TEXT,
        num TEXT,
        source_name TEXT,
        qty REAL,
        received REAL,
        rcvd_date TEXT,
        freight REAL,
        notes TEXT
      );
    `;
  
    db.run(createTableQuery, (err) => {
      if (err) {
        fs.unlinkSync(filePath);
        return res.status(500).json({ error: 'Failed to create table.' });
      }
  
      const insertQuery = `
        INSERT INTO "${tableName}" (date, memo, num, source_name, qty)
        VALUES (?, ?, ?, ?, ?)
      `;
  
      const stmt = db.prepare(insertQuery);
      const results = [];

      let rowIndex = 0;
  
      fs.createReadStream(filePath)
        .pipe(csv({ mapHeaders: ({ header, index }) => index })) // use index instead of header names
        .on('data', (row) => {
          rowIndex++;

        // Skip header row (rowIndex 1) and up to 2 rows after
        if (rowIndex <= 2) return;

        const date = row[2];
        const memo = row[3];
        const num = row[4];
        const source_name = row[5];
        const qty = parseInt(row[7], 10);

        // Skip if essential values are missing
        if (!date && !memo && !num && !source_name && !qty) return;

        results.push({ date, memo, num, source_name, qty });
        stmt.run([date, memo, num, source_name, qty || 0]);
      })
      .on('end', () => {
        stmt.finalize();
        fs.unlinkSync(filePath);
        res.json({ message: `Inserted ${results.length} rows into '${tableName}'.` });
      })
      .on('error', (err) => {
        fs.unlinkSync(filePath);
        res.status(500).json({ error: 'Error parsing CSV file.' });
      });
    });
  });

  // GET /table/:tableName - Fetch all rows from the given table
app.get('/table/:tableName', (req, res) => {
    const tableName = req.params.tableName;
  
    const query = `SELECT * FROM "${tableName}"`;
  
    db.all(query, [], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Error retrieving data. Table may not exist.' });
      }
      res.json({ table: tableName, rows });
    });
  });

  // DELETE /table/:tableName - Delete all rows from a table
app.delete('/table/:tableName', (req, res) => {
    const tableName = req.params.tableName;
  
    db.run(`DELETE FROM "${tableName}"`, function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to clear table.' });
      }
      res.json({ message: `Cleared ${this.changes} rows from '${tableName}'` });
    });
  });
  
  app.put('/table/:tableName', (req, res) => {
    const { id, updates } = req.body;
    const tableName = req.params.tableName;
  
    if (!id || !updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Invalid update request.' });
    }
  
    const fields = Object.keys(updates);
    const values = fields.map(f => updates[f]);
  
    const setClause = fields.map(f => `"${f}" = ?`).join(', ');
    const sql = `UPDATE "${tableName}" SET ${setClause} WHERE id = ?`;
  
    db.run(sql, [...values, id], function (err) {
      if (err) {
        return res.status(500).json({ error: 'Update failed.' });
      }
      res.json({ message: `Updated row ${id} in table '${tableName}'` });
    });
  });

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
