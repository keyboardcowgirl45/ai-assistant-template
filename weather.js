/**
 * Weather module — uses Open-Meteo API (free, no API key needed).
 * Fetches current conditions and 3-day forecast for Singapore.
 */

const SINGAPORE_LAT = 1.3521;
const SINGAPORE_LON = 103.8198;

// WMO weather codes to human-readable descriptions
const WEATHER_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
};

async function getWeather() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${SINGAPORE_LAT}&longitude=${SINGAPORE_LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&timezone=Asia/Singapore&forecast_days=3`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[weather] API error: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`[weather] Error: ${err.message}`);
    return null;
  }
}

function formatForPrompt(data) {
  if (!data) return '';

  const lines = [];
  const c = data.current;
  const condition = WEATHER_CODES[c.weather_code] || `Code ${c.weather_code}`;

  lines.push(`KS's weather (Singapore):`);
  lines.push(`Now: ${condition}, ${c.temperature_2m}°C (feels like ${c.apparent_temperature}°C), humidity ${c.relative_humidity_2m}%, wind ${c.wind_speed_10m} km/h`);

  if (data.daily) {
    const d = data.daily;
    for (let i = 0; i < d.time.length; i++) {
      const day = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.time[i];
      const cond = WEATHER_CODES[d.weather_code[i]] || `Code ${d.weather_code[i]}`;
      const rain = d.precipitation_probability_max[i];
      lines.push(`${day}: ${cond}, ${d.temperature_2m_min[i]}–${d.temperature_2m_max[i]}°C, ${rain}% rain chance, ${d.precipitation_sum[i]}mm precip`);
    }
  }

  return lines.join('\n');
}

function needsWeather(message) {
  const msg = message.toLowerCase();
  const triggers = [
    'weather', 'forecast', 'rain', 'raining', 'sunny', 'hot',
    'temperature', 'humid', 'umbrella', 'outdoor', 'outside',
    'polo match', 'polo game', 'polo practice',
  ];
  return triggers.some(t => msg.includes(t));
}

module.exports = { getWeather, formatForPrompt, needsWeather };
