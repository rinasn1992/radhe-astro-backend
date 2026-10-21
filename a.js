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
// Asli Navamsha API Route (vda_live key ke sath)
app.post('/api/navamsha', async (req, res) => {
    try {
        const { name, dob, tob, pob } = req.body;
        
        // Yahan aap apni real Vedic Astrology API ko call kar rahe hain
        const apiResponse = await fetch('https://api.vedicastrologyapi.com/v3-json/horoscope/navamsha-chart', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer vda_live_bc7adba0_-s513GlzBfGHLhNBeWbdz8VSTOrA_bc6pBH8xXsKlEU' // 👈 Yahan apni vda_live wali key daalni hai!
            },
            body: JSON.stringify({
                name: name,
                dob: dob,
                tob: tob,
                pob: pob
            })
        });

        const data = await apiResponse.json();

        res.json({
            success: true,
            message: "Real Navamsha data successfully fetched",
            planetDetails: data.output || data
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Port listener zaroori hai Render ke liye
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Radhe Astro Server is running on port ${PORT}`);
});
