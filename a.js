const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Root Route
app.get('/', (req, res) => {
    res.json({ success: true, message: "Radhe Astro Backend API is running successfully!" });
});


// Navamsha API Route
app.post('/api/navamsha', async (req, res) => {
    try {
            const { name, year, month, day, hour, minute, place } = req.body;

    const apiPayload = {
        date: day ? parseInt(day, 10) : 12,
        month: month ? parseInt(month, 10) : 10,
        year: year ? parseInt(year, 10) : 1990,
        hours: hour ? parseInt(hour, 10) : 10,
        minutes: minute ? parseInt(minute, 10) : 30,
        latitude: 25.2138,
        longitude: 84.9814,
        timezone: 5.5
    };
        
        const apiResponse = await fetch('https://api.navamsha.in/api/v1/astrology/kundli/advanced', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer vda_live_cc1b52dc_ie316Y9F6iGcJH-dUFheqdxGw65LLl8RbsCCnUt4EDU' // 👈 Yahan apni asli vda_live key daalna na bhulein
            },
            body: JSON.stringify(apiPayload)
        });

        const result = await apiResponse.json();
        console.log("External API Raw Output:", JSON.stringify(result, null, 2));
        
console.log("API Response Data:", JSON.stringify(result, null, 2)); // Yeh nayi line yahan dalni hai
        
        res.json({
            success: true,
            message: "Navamsha data fetched successfully",
            planetDetails: result.output || result
        });

    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Port listener
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Radhe Astro Server is running on port ${PORT}`);
});
module.exports = app;
