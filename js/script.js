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
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,is_day,weather_code,wind_speed_10m&hourly=temperature_2m,rain,precipitation_probability&timezone=auto&past_days=1&forecast_days=2&_t=${Date.now()}`
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

async function getBrowserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Geolocalización no soportada por el navegador."));
        } else {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        lat: position.coords.latitude,
                        lon: position.coords.longitude
                    });
                },
                (error) => {
                    reject(error);
                }
            );
        }
    });
}

async function reverseGeocode(lat, lon) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
        const data = await response.json();
        const address = data.address;
        return address.city || address.town || address.village || address.municipality || "Ubicación desconocida";
    } catch (error) {
        console.error("Reverse Geocoding Error:", error);
        return "Ubicación Actual";
    }
}



async function updateWeatherByCoords(lat, lon) {
    try {
        const [weatherData, cityName] = await Promise.all([
            getRealWeatherData(lat, lon),
            reverseGeocode(lat, lon)
        ]);
        currentCity = cityName;
        locationName.textContent = `${cityName}`;
        updateUIWithData(weatherData); // Re-use UI update logic
    } catch (error) {
        console.error(error);
        locationName.textContent = "Error";
    }
    updateTimestamp();
}

/* --- UI CONTROLLER --- */

const cityInput = document.getElementById('cityInput');
const searchBtn = document.getElementById('searchBtn');
const locationName = document.getElementById('locationName');
const currentTemp = document.getElementById('currentTemp');
const weatherDesc = document.getElementById('weatherDesc');
const weatherIcon = document.getElementById('weatherIcon');
const rain1h = document.getElementById('rain1h');
const refreshIndicator = document.getElementById('refresh-indicator'); // Added for Pull to Refresh

const windSpeed = document.getElementById('windSpeed');
const locationBtn = document.getElementById('locationBtn');

let rainChartInstance = null;
let currentCity = "Madrigal de la Vera";

async function init() {
    console.log("App Initializing...");

    // Create Last Updated Element if not exists (checked dynamically or added to HTML)

    searchBtn.addEventListener('click', handleSearch);
    locationBtn.addEventListener('click', handleLocationClick);

    cityInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    // Tab Event Listeners
    document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchView(e.target.dataset.view);
        });
    });

    // Load default city
    await updateWeather(currentCity);

    // Auto-refresh every 1 hour (3600000 ms)
    setInterval(() => {
        console.log(`Auto-refreshing weather for: ${currentCity}`);
        updateWeather(currentCity);
    }, 3600000);
}

async function handleLocationClick() {
    const orgHtml = locationBtn.innerHTML;
    locationBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
    try {
        const coords = await getBrowserLocation();
        await updateWeatherByCoords(coords.lat, coords.lon);
        // Clear input to reflect we are using current loc
        cityInput.value = "";
    } catch (err) {
        alert("No se pudo obtener la ubicación: " + err.message);
    } finally {
        locationBtn.innerHTML = orgHtml;
    }
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

        updateUIWithData(weatherData);

        currentCity = city;

    } catch (error) {
        console.error(error);
        locationName.textContent = "Error";
    }

    updateTimestamp();
}

function updateUIWithData(weatherData) {
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
}

function updateTimestamp() {
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

    // Custom Plugin for Hourly Data Labels
    const hourlyDetailsPlugin = {
        id: 'hourlyDetails',
        defaults: {
            display: false
        },
        afterDatasetsDraw(chart, args, options) {
            if (!options.display) return;

            const { ctx } = chart;

            // Dataset 0: Rain (Bar), Dataset 1: Prob (Line)
            const metaRain = chart.getDatasetMeta(0);
            const metaProb = chart.getDatasetMeta(1);

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.font = 'bold 12px Inter';

            metaRain.data.forEach((element, index) => {
                // Skip if hidden
                if (element.hidden) return;

                // 1. Draw Rain Amount (mm) inside or above bar
                const rainVal = chart.data.datasets[0].data[index];
                if (rainVal !== null && rainVal > 0) {
                    ctx.fillStyle = '#00f2ff'; // Cyan
                    // Draw slightly above the bar
                    ctx.fillText(`${rainVal}mm`, element.x, element.y - 5);
                }

                // 2. Draw Probability (%) above everything (top of chart area usually, or following line)
                const probVal = chart.data.datasets[1].data[index];
                const probPoint = metaProb.data[index];
                if (probPoint && probVal !== null) {
                    ctx.fillStyle = '#7000ff'; // Purple
                    // Draw above the point
                    ctx.fillText(`${probVal}%`, probPoint.x, probPoint.y - 10);
                }
            });

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
                    pointRadius: 4, // Make points visible in detailed view (will toggle size later if needed)
                    pointBackgroundColor: '#1a237e'
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
                },
                hourlyDetails: {
                    display: false // Default off (24h view)
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
                    min: 0,
                    max: 100,
                    grid: { drawOnChartArea: false },
                    ticks: {
                        color: '#7000ff',
                        stepSize: 10
                    }
                }
            }
        },
        plugins: [nowLinePlugin, hourlyDetailsPlugin]
    });
}

function switchView(viewType) {
    const chartContainer = document.getElementById('chartContainer');
    const chartScrollWrapper = document.getElementById('chartScrollWrapper');
    const tabs = document.querySelectorAll('.tab');

    // Update Tabs UI
    tabs.forEach(t => {
        if (t.dataset.view === viewType) t.classList.add('active');
        else t.classList.remove('active');
    });

    if (viewType === 'hourly') {
        chartContainer.classList.add('scroll-active');
        chartScrollWrapper.classList.add('expanded');

        // Enable detailed labels
        if (rainChartInstance) {
            rainChartInstance.options.plugins.hourlyDetails.display = true;
            rainChartInstance.update(); // Update to render labels and new size
            // Resize logic is handled by Chart.js observing container, but sometimes needs explicit call if container animates
            rainChartInstance.resize();
        }

        // Auto-scroll to "Now"
        setTimeout(() => {
            scrollToCurrentTime();
        }, 350);

    } else {
        chartContainer.classList.remove('scroll-active');
        chartScrollWrapper.classList.remove('expanded');

        // Disable detailed labels
        if (rainChartInstance) {
            rainChartInstance.options.plugins.hourlyDetails.display = false;
            rainChartInstance.update();
            rainChartInstance.resize();
        }

        chartContainer.scrollLeft = 0;
    }
}

function scrollToCurrentTime() {
    if (!rainChartInstance) return;

    // We stored the currentRelIndex in the plugin options during updateChart
    const currentIndex = rainChartInstance.options.plugins.nowLine.index;

    // Total data points usually 24 (or active length)
    // We can infer total points from data labels length
    const totalPoints = rainChartInstance.data.labels.length;

    if (currentIndex >= 0 && totalPoints > 0) {
        const container = document.getElementById('chartContainer');
        const scrollWidth = container.scrollWidth;
        const clientWidth = container.clientWidth;

        // Approximate pixel position of the bar center
        const barWidth = scrollWidth / totalPoints;
        const targetX = (currentIndex * barWidth) - (clientWidth / 2) + (barWidth / 2);

        container.scrollTo({
            left: targetX,
            behavior: 'smooth'
        });
    }
}


async function init() {
    console.log("App Initializing...");

    // Create Last Updated Element if not exists (checked dynamically or added to HTML)

    searchBtn.addEventListener('click', handleSearch);
    cityInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    // Tab Event Listeners
    document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchView(e.target.dataset.view);
        });
    });

    await updateWeather(currentCity);

    // Initialize Pull to Refresh
    initPullToRefresh();

    // Auto-refresh every 1 hour (3600000 ms)
    setInterval(() => {
        console.log(`Auto-refreshing weather for: ${currentCity}`);
        updateWeather(currentCity);
    }, 3600000);
}

function initPullToRefresh() {
    let startY = 0;
    let currentY = 0; // Track current Y to calculate distance correctly
    let isPulling = false;
    const threshold = 100; // px to trigger refresh

    document.addEventListener('touchstart', (e) => {
        // Only trigger if at top of page
        if (window.scrollY === 0) {
            startY = e.touches[0].clientY;
            isPulling = true;
            // No transition while pulling for instant feedback
            refreshIndicator.style.transition = 'none';
        } else {
            isPulling = false;
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!isPulling) return;

        currentY = e.touches[0].clientY;
        const diff = currentY - startY;

        // Only allow pulling down (positive diff)
        if (diff > 0) {
            // Visualize the pull
            // Add resistance: log or sqrt
            const resistance = Math.min(diff * 0.4, 150); // Cap max pull

            // Move the indicator down into view (it starts at -100px)
            // We want it to appear as we pull. 
            // -100 + resistance (e.g. up to 150) -> max 50px
            const topPos = -100 + resistance;

            refreshIndicator.style.transform = `translateX(-50%) translateY(${topPos}px)`;

            // Rotate spinner based on pull distance
            const rotation = diff * 2;
            const icon = refreshIndicator.querySelector('i');
            if (icon) {
                icon.style.transform = `rotate(${rotation}deg)`;
                icon.style.display = 'block'; // Show icon while pulling
            }
        }
    }, { passive: true });

    document.addEventListener('touchend', async () => {
        if (!isPulling) return;
        isPulling = false;

        // Restore transition for smooth snap back
        refreshIndicator.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.27)';

        const diff = currentY - startY;

        if (diff > threshold && window.scrollY === 0) {
            // Trigger Refresh
            refreshIndicator.classList.add('visible');
            refreshIndicator.classList.add('loading');
            refreshIndicator.style.transform = `translateX(-50%) translateY(20px)`; // Snap to visible position

            const icon = refreshIndicator.querySelector('i');
            if (icon) icon.style.transform = ''; // Reset inline rotation so animation takes over

            try {
                // await updateWeather(currentCity); // This function updates the UI
                /* 
                   Wait, updateWeather expects 'city' string. 
                   If we are using location button, currentCity might be "Madrid" or "Madrigal de la Vera".
                   It should work fine.
                */
                const minWait = new Promise(resolve => setTimeout(resolve, 1000)); // Ensure at least 1s spinner
                await Promise.all([updateWeather(currentCity), minWait]);

            } catch (err) {
                console.error("Refresh failed", err);
            } finally {
                // Hide after small delay
                setTimeout(() => {
                    refreshIndicator.classList.remove('visible');
                    refreshIndicator.classList.remove('loading');
                    refreshIndicator.style.transform = 'translateX(-50%) translateY(-100px)';
                    // Reset inline styles
                    const icon = refreshIndicator.querySelector('i');
                    if (icon) icon.style.display = '';
                }, 500);
            }

        } else {
            // Snap back
            refreshIndicator.style.transform = 'translateX(-50%) translateY(-100px)';
            const icon = refreshIndicator.querySelector('i');
            if (icon) icon.style.display = '';
        }

        // Reset vars
        startY = 0;
        currentY = 0;
    });
}

// Fire init when DOM is ready
document.addEventListener('DOMContentLoaded', init);
