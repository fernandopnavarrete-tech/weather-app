/**
 * LluviaCheck - Combined Script
 * Merged API and App logic to allow running via file:// protocol without CORS errors on modules.
 */

/* --- API LAYER --- */

// Geocoding
async function getCoordinates(city) {
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

// Real Weather Data
async function getRealWeatherData(lat, lon) {
    try {
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

// Simulation/Aggregation Logic
function generateComparisonData(realData) {
    const totalRainToday = calculateDailyRain(realData);

    return {
        openMeteo: {
            name: "Open-Meteo",
            rain: totalRainToday.toFixed(1),
            confidence: "Alta"
        },
        aemet: {
            name: "AEMET",
            rain: (totalRainToday * (0.9 + Math.random() * 0.3)).toFixed(1),
            diff: "Variación moderada"
        },
        google: {
            name: "Google",
            rain: (totalRainToday * (0.8 + Math.random() * 0.4)).toFixed(1),
            diff: "Datos satelitales"
        }
    };
}

function calculateDailyRain(data) {
    const hours = data.hourly.rain;
    const start = 24;
    const end = 48;

    let sum = 0;
    for (let i = start; i < end; i++) {
        if (hours[i]) sum += hours[i];
    }
    return sum;
}

function processChartData(data) {
    const now = new Date();
    const currentHourIndex = data.hourly.time.findIndex(t => {
        const d = new Date(t);
        // Compare down to the hour
        return d.getDate() === now.getDate() && d.getHours() === now.getHours();
    });

    // Fallback if not found (rare)
    const activeIndex = currentHourIndex === -1 ? 0 : currentHourIndex;

    const start = Math.max(0, activeIndex - 12);
    const end = Math.min(data.hourly.time.length, activeIndex + 12);

    const labels = data.hourly.time.slice(start, end).map(t => {
        return new Date(t).getHours() + ":00";
    });

    // map rainData: if index represents future, return null (hide bar)
    const rainData = data.hourly.rain.slice(start, end).map((val, idx) => {
        // Calculate absolute index in the original array
        const absoluteIndex = start + idx;
        if (absoluteIndex > activeIndex) {
            return null; // It's in the future -> Hide "Real Precipitation" bar
        }
        return val;
    });

    const probData = data.hourly.precipitation_probability.slice(start, end);

    // Calculate relative index for the "Now" line
    const currentRelIndex = activeIndex - start;

    return { labels, rainData, probData, currentRelIndex };
}

function getWeatherConfig(code) {
    if (code === 0) return { desc: "Despejado", icon: "ph-sun" };
    if (code >= 1 && code <= 3) return { desc: "Parcialmente Nublado", icon: "ph-cloud-sun" };
    if (code === 45 || code === 48) return { desc: "Niebla", icon: "ph-cloud-fog" };
    if (code >= 51 && code <= 55) return { desc: "Llovizna", icon: "ph-cloud-drizzle" };
    if (code >= 61 && code <= 65) return { desc: "Lluvia", icon: "ph-cloud-rain" };
    if (code >= 80 && code <= 82) return { desc: "Chubascos", icon: "ph-cloud-rain" };
    if (code >= 95) return { desc: "Tormenta", icon: "ph-cloud-lightning" };
    return { desc: "Nublado", icon: "ph-cloud" };
}

/* --- UI CONTROLLER --- */

const cityInput = document.getElementById('cityInput');
const searchBtn = document.getElementById('searchBtn');
const locationName = document.getElementById('locationName');
const currentTemp = document.getElementById('currentTemp');
const weatherDesc = document.getElementById('weatherDesc');
const weatherIcon = document.getElementById('weatherIcon');
const rain1h = document.getElementById('rain1h');
const windSpeed = document.getElementById('windSpeed');

let rainChartInstance = null;
let currentCity = "Madrid";

async function init() {
    console.log("App Initializing...");

    // Create Last Updated Element if not exists (checked dynamically or added to HTML)

    searchBtn.addEventListener('click', handleSearch);
    cityInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    await updateWeather(currentCity);

    // Auto-refresh every 1 hour (3600000 ms)
    setInterval(() => {
        console.log(`Auto-refreshing weather for: ${currentCity}`);
        updateWeather(currentCity);
    }, 3600000);
}

async function handleSearch() {
    const city = cityInput.value.trim();
    if (!city) return;

    const orgText = searchBtn.textContent;
    searchBtn.textContent = "Buscando...";
    try {
        await updateWeather(city);
        currentCity = city;
    } catch (err) {
        alert("Error al buscar la ciudad: " + err.message);
    } finally {
        searchBtn.textContent = orgText;
    }
}

async function updateWeather(city) {
    try {
        const location = await getCoordinates(city);
        locationName.textContent = `${location.name}, ${location.country}`;

        const weatherData = await getRealWeatherData(location.latitude, location.longitude);

        const current = weatherData.current;
        currentTemp.textContent = Math.round(current.temperature_2m);
        windSpeed.textContent = `${current.wind_speed_10m} km/h`;

        const nowIso = new Date().toISOString().slice(0, 13);
        const hourIdx = weatherData.hourly.time.findIndex(t => t.startsWith(nowIso));
        const currentRainAmount = hourIdx !== -1 ? weatherData.hourly.rain[hourIdx] : 0;
        rain1h.textContent = `${currentRainAmount} mm`;

        const config = getWeatherConfig(current.weather_code);
        weatherDesc.textContent = config.desc;
        weatherIcon.className = `ph-fill ${config.icon}`;

        const chartData = processChartData(weatherData);
        updateChart(chartData);



    } catch (error) {
        console.error(error);
        locationName.textContent = "Error";
    }

    // Update timestamp
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const lastUpdEl = document.getElementById('lastUpdated');
    if (lastUpdEl) lastUpdEl.textContent = timeString;
}

function updateChart({ labels, rainData, probData, currentRelIndex }) {
    const ctx = document.getElementById('rainChart').getContext('2d');

    if (rainChartInstance) {
        rainChartInstance.destroy();
    }

    // Custom Plugin to draw "Now" line
    const nowLinePlugin = {
        id: 'nowLine',
        afterDatasetsDraw(chart, args, options) {
            const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
            const idx = options.index;
            if (idx === undefined || idx < 0) return;

            const xPos = x.getPixelForTick(idx);

            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]); // Dashed line
            ctx.moveTo(xPos, top);
            ctx.lineTo(xPos, bottom);
            ctx.stroke();

            // Optional: Add "AHORA" label
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = '10px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('AHORA', xPos, top - 5);

            ctx.restore();
        }
    };

    rainChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Lluvia (mm)',
                    data: rainData,
                    backgroundColor: 'rgba(0, 242, 255, 0.6)',
                    borderColor: '#00f2ff',
                    borderWidth: 1,
                    yAxisID: 'y'
                },
                {
                    label: 'Probabilidad (%)',
                    data: probData,
                    type: 'line',
                    borderColor: '#7000ff',
                    backgroundColor: 'rgba(112, 0, 255, 0.1)',
                    yAxisID: 'y1',
                    tension: 0.4,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    labels: { color: '#fff' }
                },
                nowLine: {
                    index: currentRelIndex // Pass the calculated index to the plugin
                }
            },
            scales: {
                x: {
                    ticks: { color: '#aaa' },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    ticks: { color: '#aaa' },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#7000ff' }
                }
            }
        },
        plugins: [nowLinePlugin]
    });
}

// Fire init when DOM is ready
document.addEventListener('DOMContentLoaded', init);
