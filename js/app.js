import { getCoordinates, getRealWeatherData, generateComparisonData, processChartData, getWeatherConfig } from './api.js';

// DOM Elements
const cityInput = document.getElementById('cityInput');
const searchBtn = document.getElementById('searchBtn');
const locationName = document.getElementById('locationName');
const currentTemp = document.getElementById('currentTemp');
const weatherDesc = document.getElementById('weatherDesc');
const weatherIcon = document.getElementById('weatherIcon');
const rain1h = document.getElementById('rain1h');
const windSpeed = document.getElementById('windSpeed');

// Comparison Elements
const omRain = document.getElementById('om-rain');
const aemetRain = document.getElementById('aemet-rain');
const aemetDiff = document.getElementById('aemet-diff');
const googleRain = document.getElementById('google-rain');
const googleDiff = document.getElementById('google-diff');

let rainChartInstance = null;

// Initialization
async function init() {
    searchBtn.addEventListener('click', handleSearch);
    cityInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    // Initial Load
    await updateWeather("Madrid");
}

async function handleSearch() {
    const city = cityInput.value.trim();
    if (!city) return;

    // Show loading state?
    searchBtn.textContent = "Buscando...";
    try {
        await updateWeather(city);
    } catch (err) {
        alert("Error al buscar la ciudad: " + err.message);
    } finally {
        searchBtn.textContent = "Buscar";
    }
}

async function updateWeather(city) {
    try {
        // 1. Get Coordinates
        const location = await getCoordinates(city);
        locationName.textContent = `${location.name}, ${location.country}`;

        // 2. Get Weather Data
        const weatherData = await getRealWeatherData(location.latitude, location.longitude);

        // 3. Update UI - Current Status
        const current = weatherData.current;
        currentTemp.textContent = Math.round(current.temperature_2m);
        windSpeed.textContent = `${current.wind_speed_10m} km/h`;

        // Rain 1h (Approximation from current hourly slot)
        // Find current hour in hourly arrays
        const nowIso = new Date().toISOString().slice(0, 13); // '2023-10-27T10'
        const hourIdx = weatherData.hourly.time.findIndex(t => t.startsWith(nowIso));
        const currentRainAmount = hourIdx !== -1 ? weatherData.hourly.rain[hourIdx] : 0;
        rain1h.textContent = `${currentRainAmount} mm`;

        // Icon & Desc
        const config = getWeatherConfig(current.weather_code);
        weatherDesc.textContent = config.desc;
        weatherIcon.className = `ph-fill ${config.icon}`;

        // 4. Update Charts
        const chartData = processChartData(weatherData);
        updateChart(chartData);

        // 5. Update Comparison
        const comparison = generateComparisonData(weatherData);
        omRain.textContent = `${comparison.openMeteo.rain} mm`;
        aemetRain.textContent = `${comparison.aemet.rain} mm`;
        aemetDiff.textContent = comparison.aemet.diff;
        googleRain.textContent = `${comparison.google.rain} mm`;
        googleDiff.textContent = comparison.google.diff;

    } catch (error) {
        console.error(error);
        locationName.textContent = "Error";
    }
}

function updateChart({ labels, rainData, probData }) {
    const ctx = document.getElementById('rainChart').getContext('2d');

    if (rainChartInstance) {
        rainChartInstance.destroy();
    }

    // Chart.js Configuration
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
        }
    });
}

// Start
init();
