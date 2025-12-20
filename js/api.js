/**
 * API Service Layer
 * Handles fetching from Open-Meteo and simulating other providers for the comparison features.
 */

// Geocoding to get lat/lon from city name
export async function getCoordinates(city) {
    try {
        const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=es&format=json`);
        const data = await response.json();

        if (!data.results || data.results.length === 0) {
            throw new Error("Ciudad no encontrada");
        }

        return data.results[0]; // { latitude, longitude, name, country }
    } catch (error) {
        console.error("Geocoding Error:", error);
        throw error;
    }
}

// Fetch real weather data from Open-Meteo
// We ask for current weather, hourly rain for past 24h and next 24h
export async function getRealWeatherData(lat, lon) {
    try {
        // past_days=1 gives us yesterday. forecast_days=2 gives today + tomorrow.
        // We need a contiguous block of "Past 24h" + "Next 24h"
        const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,is_day,weather_code,wind_speed_10m&hourly=temperature_2m,rain,precipitation_probability&timezone=auto&past_days=1&forecast_days=2`
        );
        const data = await response.json();
        return data;
    } catch (error) {
        console.error("Weather API Error:", error);
        throw error;
    }
}

/**
 * Weather Aggregator Simulation logic.
 * Since we don't have paid keys for AEMET/Google, we simulate them by taking the Real data
 * and adding slight "noise" or variance to simulate how different models disagree.
 */
export function generateComparisonData(realData) {
    const totalRainToday = calculateDailyRain(realData);

    return {
        openMeteo: {
            name: "Open-Meteo",
            rain: totalRainToday.toFixed(1),
            confidence: "Alta"
        },
        aemet: {
            name: "AEMET",
            rain: (totalRainToday * (0.9 + Math.random() * 0.3)).toFixed(1), // +/- variance
            diff: "Variación moderada"
        },
        google: {
            name: "Google",
            rain: (totalRainToday * (0.8 + Math.random() * 0.4)).toFixed(1),
            diff: "Datos satelitales"
        }
    };
}

// Helper: Sum up rain for "today" (first 24h of forecast roughly, simplified)
function calculateDailyRain(data) {
    // Simply summing the first 24 slots of the hourly forecast for a rough estimate
    // In a real app we'd filter by exact timestamps for "Today"
    // Open-Meteo returns hourly arrays.
    // Let's grab the next 24 hours starting from "now" index.

    // Simplification: Sum of all available hourly rain in the "current" forecast block (today)
    // The API returns 3 days (1 past, 2 future).
    // Let's just sum the middle 24h block as "Today" approximation for the demo
    const hours = data.hourly.rain;
    const start = 24; // Skip past day
    const end = 48; // End of today

    let sum = 0;
    for (let i = start; i < end; i++) {
        if (hours[i]) sum += hours[i];
    }
    return sum;
}

// Helper: Process hourly data for the chart (Previous 12h + Next 12h)
export function processChartData(data) {
    const now = new Date();
    const currentHourIndex = data.hourly.time.findIndex(t => {
        const d = new Date(t);
        return d.getHours() === now.getHours() && d.getDate() === now.getDate();
    });

    // Grab -12 to +12 hours
    const start = Math.max(0, currentHourIndex - 12);
    const end = Math.min(data.hourly.time.length, currentHourIndex + 12);

    const labels = data.hourly.time.slice(start, end).map(t => {
        return new Date(t).getHours() + ":00";
    });

    const rainData = data.hourly.rain.slice(start, end);
    const probData = data.hourly.precipitation_probability.slice(start, end);

    return { labels, rainData, probData };
}

// Helper: Map WMO codes to description & icon class
export function getWeatherConfig(code) {
    // Simplified mapping
    if (code === 0) return { desc: "Despejado", icon: "ph-sun" };
    if (code >= 1 && code <= 3) return { desc: "Parcialmente Nublado", icon: "ph-cloud-sun" };
    if (code === 45 || code === 48) return { desc: "Niebla", icon: "ph-cloud-fog" };
    if (code >= 51 && code <= 55) return { desc: "Llovizna", icon: "ph-cloud-drizzle" };
    if (code >= 61 && code <= 65) return { desc: "Lluvia", icon: "ph-cloud-rain" };
    if (code >= 80 && code <= 82) return { desc: "Chubascos", icon: "ph-cloud-rain" };
    if (code >= 95) return { desc: "Tormenta", icon: "ph-cloud-lightning" };
    return { desc: "Nublado", icon: "ph-cloud" };
}
