/**
 * Cryptocurrency price module — fetches BTC and ETH prices from CoinGecko.
 * Free API, no key needed.
 */

const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';

/**
 * Fetch current BTC and ETH prices with 24h change.
 * Returns object with price data, or null on failure.
 */
async function getCryptoPrices() {
  try {
    const url = `${COINGECKO_API}?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.warn(`[crypto] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.bitcoin && !data.ethereum) return null;

    return {
      btc: {
        price: data.bitcoin?.usd,
        change24h: data.bitcoin?.usd_24h_change,
      },
      eth: {
        price: data.ethereum?.usd,
        change24h: data.ethereum?.usd_24h_change,
      },
    };
  } catch (err) {
    console.warn(`[crypto] Error fetching prices: ${err.message}`);
    return null;
  }
}

/**
 * Format crypto prices for prompt injection.
 */
function formatForPrompt(prices) {
  if (!prices) return '';

  const lines = ['KS\'s crypto portfolio prices:'];

  if (prices.btc?.price != null) {
    const dir = prices.btc.change24h >= 0 ? '+' : '';
    lines.push(`  BTC: $${prices.btc.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${dir}${prices.btc.change24h?.toFixed(2)}% 24h)`);
  }
  if (prices.eth?.price != null) {
    const dir = prices.eth.change24h >= 0 ? '+' : '';
    lines.push(`  ETH: $${prices.eth.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${dir}${prices.eth.change24h?.toFixed(2)}% 24h)`);
  }

  return lines.join('\n');
}

/**
 * Check if a message is asking about crypto/prices.
 */
function needsCrypto(message) {
  const msg = message.toLowerCase();
  const triggers = [
    'bitcoin', 'btc', 'ethereum', 'eth', 'crypto',
    'coin', 'token', 'price of', 'market', 'portfolio',
  ];
  return triggers.some(t => msg.includes(t));
}

module.exports = { getCryptoPrices, formatForPrompt, needsCrypto };
