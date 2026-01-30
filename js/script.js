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
        // Reverted to original fields
        const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,is_day,weather_code,wind_speed_10m&hourly=temperature_2m,rain,precipitation_probability,wind_speed_10m&timezone=auto&past_days=1&forecast_days=2&_t=${Date.now()}`
        );
        const data = await response.json();
        return data;
    } catch (error) {
        console.error("Weather API Error:", error);
        throw error;
    }
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
    const tempData = data.hourly.temperature_2m.slice(start, end);
    const windData = data.hourly.wind_speed_10m.slice(start, end);

    // Calculate relative index for the "Now" line
    const currentRelIndex = activeIndex - start;

    return { labels, rainData, probData, tempData, windData, currentRelIndex };
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
        return "Ubicación Local"; // Fallback instead of failing
    }
}

async function updateWeatherByCoords(lat, lon) {
    try {
        const weatherData = await getRealWeatherData(lat, lon);

        // Try to get name, but don't block if it fails
        let cityName = "Ubicación Detectada";
        try {
            cityName = await reverseGeocode(lat, lon);
        } catch (e) {
            console.warn("Could not retrieve city name", e);
        }

        currentCity = cityName;
        locationName.textContent = `${cityName}`;
        updateUIWithData(weatherData);
    } catch (error) {
        console.error(error);
        locationName.textContent = "Error";
        throw error;
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
const refreshIndicator = document.getElementById('refresh-indicator');

const windSpeed = document.getElementById('windSpeed');
const locationBtn = document.getElementById('locationBtn');

let rainChartInstance = null;
let currentCity = "Madrigal de la Vera";
let lastWeatherData = null;
let currentChartType = 'rain'; // 'rain', 'temp', 'wind'

async function init() {
    console.log("App Initializing...");

    if (searchBtn) searchBtn.addEventListener('click', handleSearch);
    if (locationBtn) locationBtn.addEventListener('click', handleLocationClick);

    if (cityInput) {
        cityInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSearch();
        });
    }

    // Tab Event Listeners
    document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchView(e.target.dataset.view);
        });
    });

    // Event Listeners for Stat Boxes
    const statTemp = document.getElementById('stat-temp');
    if (statTemp) statTemp.addEventListener('click', () => setChartType('temp'));

    const statRain = document.getElementById('stat-rain');
    if (statRain) statRain.addEventListener('click', () => setChartType('rain'));

    const statWind = document.getElementById('stat-wind');
    if (statWind) statWind.addEventListener('click', () => setChartType('wind'));

    // Load default city
    await updateWeather(currentCity);

    // Initialize Pull to Refresh
    initPullToRefresh();

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
        lastWeatherData = weatherData; // Save for switching
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
    if (currentTemp) currentTemp.textContent = Math.round(current.temperature_2m);
    if (windSpeed) windSpeed.textContent = `${current.wind_speed_10m} km/h`;

    const nowIso = new Date().toISOString().slice(0, 13);
    const hourIdx = weatherData.hourly.time.findIndex(t => t.startsWith(nowIso));
    const currentRainAmount = hourIdx !== -1 ? weatherData.hourly.rain[hourIdx] : 0;
    if (rain1h) rain1h.textContent = `${currentRainAmount} mm`;

    const config = getWeatherConfig(current.weather_code);
    if (weatherDesc) weatherDesc.textContent = config.desc;
    if (weatherIcon) weatherIcon.className = `ph-fill ${config.icon}`;

    const chartData = processChartData(weatherData);
    updateChart(chartData);
}

function updateTimestamp() {
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const lastUpdEl = document.getElementById('lastUpdated');
    if (lastUpdEl) lastUpdEl.textContent = timeString;
}

function setChartType(type) {
    console.log("Switching chart to:", type);
    if (currentChartType === type) return;
    currentChartType = type;

    // Update Active UI
    document.querySelectorAll('.stat-item.clickable').forEach(el => el.classList.remove('active'));

    const activeEl = document.getElementById(`stat-${type}`);
    if (activeEl) activeEl.classList.add('active');

    // Update Chart
    if (lastWeatherData) {
        const chartData = processChartData(lastWeatherData);
        updateChart(chartData);

        // Allow time for chart destroy/create then scroll
        setTimeout(() => {
            scrollToCurrentTime();
        }, 50);
    }
}

function updateChart({ labels, rainData, probData, tempData, windData, currentRelIndex }) {
    const ctxEl = document.getElementById('rainChart');
    if (!ctxEl) return;
    const ctx = ctxEl.getContext('2d');

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

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.font = 'bold 12px Inter';

            if (currentChartType === 'rain') {
                const metaProb = chart.getDatasetMeta(1);
                metaRain.data.forEach((element, index) => {
                    if (element.hidden) return;
                    const rainVal = chart.data.datasets[0].data[index];
                    if (rainVal !== null && rainVal > 0) {
                        ctx.fillStyle = '#00f2ff';
                        ctx.fillText(`${rainVal}mm`, element.x, element.y - 5);
                    }
                    const probVal = chart.data.datasets[1].data[index];
                    const probPoint = metaProb.data[index];
                    if (probPoint && probVal !== null) {
                        ctx.fillStyle = '#7000ff';
                        ctx.fillText(`${probVal}%`, probPoint.x, probPoint.y - 10);
                    }
                });
            } else {
                metaRain.data.forEach((element, index) => {
                    const val = chart.data.datasets[0].data[index];
                    if (val !== null) {
                        ctx.fillStyle = chart.data.datasets[0].borderColor;
                        ctx.fillText(`${val}`, element.x, element.y - 10);
                    }
                });
            }

            ctx.restore();
        }
    };

    // Configure Datasets based on Type
    let datasets = [];
    let y1Display = false; // Only for Rain (Probability)

    if (currentChartType === 'rain') {
        datasets = [
            {
                label: 'Lluvia (mm)',
                data: rainData,
                backgroundColor: 'rgba(0, 242, 255, 0.6)',
                borderColor: '#00f2ff',
                borderWidth: 1,
                yAxisID: 'y',
                type: 'bar',
                order: 2
            },
            {
                label: 'Probabilidad (%)',
                data: probData,
                type: 'line',
                borderColor: '#7000ff',
                backgroundColor: 'rgba(112, 0, 255, 0.1)',
                yAxisID: 'y1',
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#1a237e',
                order: 1
            }
        ];
        y1Display = true;

    } else if (currentChartType === 'temp') {
        datasets = [{
            label: 'Temperatura (°C)',
            data: tempData,
            type: 'line',
            borderColor: '#ff9800', // Orange
            backgroundColor: 'rgba(255, 152, 0, 0.2)',
            fill: true,
            yAxisID: 'y',
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#fff'
        }];

    } else if (currentChartType === 'wind') {
        datasets = [{
            label: 'Viento (km/h)',
            data: windData,
            type: 'line',
            borderColor: '#00e676', // Green
            backgroundColor: 'rgba(0, 230, 118, 0.2)',
            fill: true,
            yAxisID: 'y',
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#fff'
        }];
    }

    const hourlyBtn = document.querySelector('.tab[data-view="hourly"]');
    const isHourly = hourlyBtn && hourlyBtn.classList.contains('active');

    rainChartInstance = new Chart(ctx, {
        type: 'bar', // Default, mixed type handling in datasets
        data: {
            labels: labels,
            datasets: datasets
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
                    labels: { color: '#fff' },
                    display: true
                },
                nowLine: {
                    index: currentRelIndex
                },
                hourlyDetails: {
                    display: isHourly
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
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    title: {
                        display: true,
                        text: currentChartType === 'rain' ? 'mm' : (currentChartType === 'temp' ? '°C' : 'km/h'),
                        color: '#aaa'
                    }
                },
                y1: {
                    type: 'linear',
                    display: y1Display,
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
        if (chartContainer) chartContainer.classList.add('scroll-active');
        if (chartScrollWrapper) chartScrollWrapper.classList.add('expanded');

        // Enable detailed labels
        if (rainChartInstance) {
            rainChartInstance.options.plugins.hourlyDetails.display = true;
            rainChartInstance.update();
            rainChartInstance.resize();
        }

        setTimeout(() => {
            scrollToCurrentTime();
        }, 350);

    } else {
        if (chartContainer) chartContainer.classList.remove('scroll-active');
        if (chartScrollWrapper) chartScrollWrapper.classList.remove('expanded');

        // Disable detailed labels
        if (rainChartInstance) {
            rainChartInstance.options.plugins.hourlyDetails.display = false;
            rainChartInstance.update();
            rainChartInstance.resize();
        }

        if (chartContainer) chartContainer.scrollLeft = 0;
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
        if (!container) return;

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


function initPullToRefresh() {
    let startY = 0;
    let currentY = 0;
    let isPulling = false;
    const threshold = 100;

    if (!refreshIndicator) return;

    document.addEventListener('touchstart', (e) => {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        if (scrollTop <= 0) {
            startY = e.touches[0].clientY;
            isPulling = true;
            refreshIndicator.style.transition = 'none';
        } else {
            isPulling = false;
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!isPulling) return;

        currentY = e.touches[0].clientY;
        const diff = currentY - startY;

        if (diff > 0) {
            const resistance = Math.min(diff * 0.4, 150);
            const topPos = -100 + resistance;

            refreshIndicator.style.transform = `translateX(-50%) translateY(${topPos}px)`;

            const rotation = diff * 2;
            const icon = refreshIndicator.querySelector('i');
            if (icon) {
                icon.style.transform = `rotate(${rotation}deg)`;
                icon.style.display = 'block';
            }
        }
    }, { passive: true });

    document.addEventListener('touchend', async () => {
        if (!isPulling) return;
        isPulling = false;

        refreshIndicator.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.27)';

        const diff = currentY - startY;
        const scrollTop = window.scrollY || document.documentElement.scrollTop;

        if (diff > threshold && scrollTop <= 0) {
            refreshIndicator.classList.add('visible');
            refreshIndicator.classList.add('loading');
            refreshIndicator.style.transform = `translateX(-50%) translateY(20px)`;

            const icon = refreshIndicator.querySelector('i');
            if (icon) icon.style.transform = '';

            try {
                const minWait = new Promise(resolve => setTimeout(resolve, 1000));
                await Promise.all([updateWeather(currentCity), minWait]);

            } catch (err) {
                console.error("Refresh failed", err);
            } finally {
                setTimeout(() => {
                    refreshIndicator.classList.remove('visible');
                    refreshIndicator.classList.remove('loading');
                    refreshIndicator.style.transform = 'translateX(-50%) translateY(-100px)';
                    const icon = refreshIndicator.querySelector('i');
                    if (icon) icon.style.display = '';
                }, 500);
            }

        } else {
            refreshIndicator.style.transform = 'translateX(-50%) translateY(-100px)';
            const icon = refreshIndicator.querySelector('i');
            if (icon) icon.style.display = '';
        }

        startY = 0;
        currentY = 0;
    });
}

// Fire init when DOM is ready
document.addEventListener('DOMContentLoaded', init);
