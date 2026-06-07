const http = require('http');

const data = JSON.stringify({
  fullName: "Test User UI",
  username: "testui123",
  email: "testui123_" + Date.now() + "@example.com",
  phone: "01099999999",
  password: "password123",
  role: "nurse",
  departmentId: null,
  unitId: null
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/users',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log('Response:', res.statusCode, body));
});

req.on('error', e => console.error(e));
req.write(data);
req.end();
