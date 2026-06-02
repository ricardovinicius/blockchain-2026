const express = require('express');
const path = require('path');

const app = express();

app.use(express.static(path.join(__dirname, 'frontend')));

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
