const mysql = require('mysql2');

const pool = mysql.createPool({
    host: 'localhost', // or your MySQL server IP
    user: 'root', // or another MySQL user
    password: '',
    database: 'db_dorm3', // change on what name is your database
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Error handling for the pool connection
pool.on('connection', (connection) => {
    console.log('Database connection established');
});

pool.on('error', (err) => {
    console.error('Unexpected database error', err);
});

// Use pool.promise() for async queries
module.exports = pool.promise();

