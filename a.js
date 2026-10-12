const express = require('express');
const cors = require('cors');
const moment = require('moment');

const app = express();
app.use(cors());
app.use(express.json());

// Aapka Kundali aur Astro logic yahan hai
app.get('/', (req, res) => {
  res.send('Radhe Astro Backend API is running successfully!');
});

// Port listener zaroori hai Render ke liye
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Radhe Astro Server is running on port ${PORT}`);
});
